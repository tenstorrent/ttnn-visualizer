# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Reachability check, upload proxy, and MLIR→JSON conversion for an MLIR server.

The MLIR HTTP server (Model Explorer) runs on a remote machine the user has SSH
access to (e.g. ``aus-wh-05``) and listens on that machine's loopback interface.
The connection test SSHes to the host and runs ``curl`` against the endpoint on
the remote's ``localhost``.

Uploads/conversions are proxied through this backend over SSH: the file is copied
to the remote host, then ``curl`` runs *on the remote* against that machine's
``http://127.0.0.1:<port>`` (same path as the connection test), avoiding browser
CORS when the SPA POSTs to a different origin. The flow is:

1. POST the model file to ``/apipost/v1/upload`` → server stores it in a temp dir
   and returns ``{"path": <server_path>}``.
2. POST ``/apipost/v1/send_command`` (``convert``) with that ``modelPath``,
   trying each known adapter id (``tt_adapter``, then ``builtin_mlir``) until one
   is registered → server returns the graph JSON, which we normalise into the
   viewer's ``GraphBundle`` shape (``{"graphs": [...]}``).
"""

import json
import logging
import os
import re
import shlex
import tempfile
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Tuple

from ttnn_visualizer.enums import ConnectionTestStates
from ttnn_visualizer.exceptions import (
    AuthenticationFailedException,
    RemoteConnectionException,
    SSHException,
)
from ttnn_visualizer.models import MlirServerConnection, RemoteConnection, StatusMessage
from ttnn_visualizer.ssh_client import SSHClient

logger = logging.getLogger(__name__)

MLIR_UPLOAD_PATH = "/apipost/v1/upload"
MLIR_SEND_COMMAND_PATH = "/apipost/v1/send_command"
# Model Explorer reads ``request.files['file']`` (singular).
MLIR_UPLOAD_FIELD = "file"
# All Model Explorer adapters expose conversion under the ``convert`` command.
MLIR_CONVERT_CMD_ID = "convert"
# Adapter ids to try, in priority order. Tenstorrent's TT-Explorer fork uses
# ``tt_adapter``; ``builtin_mlir`` is the upstream native MLIR adapter.
MLIR_CONVERT_EXTENSION_IDS = ("tt_adapter", "builtin_mlir")
# TF (.pb/.pbtxt/.graphdef), TFLite (.tflite), TFJS/JAX (.json/.pb),
# PyTorch ExportedProgram (.pt2), MLIR (.mlir/.mlirbc).
# Keep in sync with `MLIR_SERVER_ACCEPTED_EXTENSIONS` in
# `src/definitions/MlirServer.ts` (frontend `accept` filter) and the upload-path
# constant there — the two stacks validate against the same list independently.
MLIR_SERVER_ACCEPTED_EXTENSIONS = (
    ".pb",
    ".pbtxt",
    ".graphdef",
    ".tflite",
    ".json",
    ".pt2",
    ".mlir",
    ".mlirbc",
)

_CURL_CONNECT_TIMEOUT_SECONDS = 5
_ENDPOINT_TEST_TIMEOUT_SECONDS = 30
_UPLOAD_TIMEOUT_SECONDS = 60
_CONVERT_TIMEOUT_SECONDS = 60  # TODO: Ensure this is sufficient with larger models
# Let curl's own ``--max-time`` fire first; the subprocess timeout is a backstop.
_CURL_TIMEOUT_GRACE_SECONDS = 10
# curl prints this when it never received an HTTP response (e.g. connection refused).
_CURL_NO_RESPONSE_CODE = "000"
# Model Explorer rejects unknown adapter ids with ``Extension "<id>" not found``.
_EXTENSION_NOT_FOUND_RE = re.compile(r'Extension\s+"[^"]+"\s+not found', re.IGNORECASE)


@dataclass
class MlirConversionResult:
    """Outcome of upload+convert. ``graph_json`` is set only on success."""

    status: StatusMessage
    graph_json: Optional[str] = None


def is_supported_mlir_server_file(filename: str) -> bool:
    return bool(filename) and filename.lower().endswith(MLIR_SERVER_ACCEPTED_EXTENSIONS)


def _remote_upload_url(port: int) -> str:
    return f"http://127.0.0.1:{port}{MLIR_UPLOAD_PATH}"


def _remote_send_command_url(port: int) -> str:
    return f"http://127.0.0.1:{port}{MLIR_SEND_COMMAND_PATH}"


def _endpoint_unreachable_message(connection: RemoteConnection, port: int) -> str:
    return (
        f"MLIR server not reachable at "
        f"http://localhost:{port}{MLIR_UPLOAD_PATH} on {connection.host} - check MLIR is running on host"
    )


def test_mlir_server_connection(
    connection: MlirServerConnection,
) -> List[StatusMessage]:
    """Probe the MLIR upload endpoint on ``connection`` over SSH.

    Returns a list of ``StatusMessage`` mirroring ``/remote/test`` so the
    frontend can render the SSH and endpoint checks the same way.
    """
    remote = connection.to_remote_connection()
    http_port = connection.port
    statuses: List[StatusMessage] = []

    def add_status(status, message, detail=None):
        statuses.append(StatusMessage(status=status, message=message, detail=detail))

    # One client for both the SSH test and the curl probe — the base ssh command
    # is built once and reused (each call still spawns its own ssh subprocess).
    client = SSHClient(remote)

    # Reuse the remote-connection SSH test for identical auth/host-key handling.
    try:
        client.test_connection()
        add_status(
            ConnectionTestStates.OK,
            f"SSH connection to {remote.host} established",
        )
    except AuthenticationFailedException as e:
        add_status(ConnectionTestStates.FAILED, e.message, getattr(e, "detail", None))
        return statuses
    except RemoteConnectionException as e:
        add_status(e.status, e.message, getattr(e, "detail", None))
        return statuses

    curl_cmd = (
        "curl -s -o /dev/null -w '%{http_code}' "
        f"--connect-timeout {_CURL_CONNECT_TIMEOUT_SECONDS} {shlex.quote(_remote_upload_url(http_port))}"
    )

    try:
        output = client.execute_command(
            curl_cmd, timeout=_ENDPOINT_TEST_TIMEOUT_SECONDS
        )
    except SSHException as e:
        # curl exits non-zero (e.g. connection refused) when the server is down.
        add_status(
            ConnectionTestStates.FAILED,
            _endpoint_unreachable_message(remote, http_port),
            detail=str(e),
        )
        return statuses

    http_code = (output or "").strip()
    if not http_code or http_code == _CURL_NO_RESPONSE_CODE:
        add_status(
            ConnectionTestStates.FAILED,
            _endpoint_unreachable_message(remote, http_port),
        )
    else:
        add_status(ConnectionTestStates.OK, "MLIR server reachable")

    return statuses


def _fail(message: str, detail: Optional[str] = None) -> MlirConversionResult:
    return MlirConversionResult(
        status=StatusMessage(
            status=ConnectionTestStates.FAILED, message=message, detail=detail
        )
    )


def _upload_file_to_server(
    client: SSHClient,
    connection: RemoteConnection,
    port: int,
    file_bytes: bytes,
    safe_filename: str,
) -> Tuple[Optional[str], Optional[MlirConversionResult]]:
    """SCP the file to the remote host and POST it to the MLIR upload endpoint.

    On failure returns ``(None, MlirConversionResult)`` carrying the error.
    """
    upload_url = _remote_upload_url(port)
    logger.info(
        "Uploading %s to MLIR server on %s (%s)",
        safe_filename,
        connection.host,
        upload_url,
    )

    with tempfile.NamedTemporaryFile(
        suffix=Path(safe_filename).suffix, delete=False
    ) as tmp:
        tmp.write(file_bytes)
        local_path = tmp.name

    remote_path = f"/tmp/ttnn_viz_upload_{os.getpid()}_{uuid.uuid4().hex}{Path(safe_filename).suffix}"
    upload_form_arg = shlex.quote(f"{MLIR_UPLOAD_FIELD}=@{remote_path}")
    curl_cmd = (
        "curl -sS -H 'Expect:' -w '\\n%{http_code}' "
        f"--connect-timeout {_CURL_CONNECT_TIMEOUT_SECONDS} "
        f"--max-time {_UPLOAD_TIMEOUT_SECONDS} "
        f"-F {upload_form_arg} "
        f"{shlex.quote(upload_url)}"
    )

    started = time.perf_counter()
    try:
        client.upload_file(local_path, remote_path, timeout=_UPLOAD_TIMEOUT_SECONDS)
        stdout = client.execute_command(
            curl_cmd, timeout=_UPLOAD_TIMEOUT_SECONDS + _CURL_TIMEOUT_GRACE_SECONDS
        )
    except SSHException as e:
        elapsed = time.perf_counter() - started
        return None, _fail(
            f"Could not upload to MLIR server on {connection.host} "
            f"(failed after {elapsed:.0f}s)",
            detail=str(e),
        )
    finally:
        Path(local_path).unlink(missing_ok=True)
        try:
            client.execute_command(
                f"rm -f {shlex.quote(remote_path)}",
                timeout=_CURL_CONNECT_TIMEOUT_SECONDS,
            )
        except SSHException:
            pass

    elapsed = time.perf_counter() - started
    logger.info("MLIR upload of %s took %.2fs", safe_filename, elapsed)

    stdout = (stdout or "").strip()
    body, _, http_code = stdout.rpartition("\n")
    http_code = http_code.strip()

    if not http_code.isdigit() or http_code == _CURL_NO_RESPONSE_CODE:
        return None, _fail(
            f"Could not reach MLIR server on {connection.host} "
            f"(no response after {elapsed:.0f}s)",
            detail=body or None,
        )

    http_code_int = int(http_code)
    if not 200 <= http_code_int < 300:
        return None, _fail(
            f"MLIR server rejected the upload (HTTP {http_code_int})",
            detail=body.strip() or None,
        )

    try:
        server_path = json.loads(body).get("path")
    except json.JSONDecodeError:
        server_path = None

    if not server_path:
        return None, _fail(
            "MLIR server did not return an uploaded file path",
            detail=body.strip() or None,
        )

    return server_path, None


def _normalise_convert_response(
    response_text: str,
) -> Tuple[Optional[str], Optional[str]]:
    """Map a Model Explorer convert response to a ``GraphBundle`` JSON string.

    Returns ``(graph_json, error)``. The adapter returns ``{"graphs": [...]}`` or
    ``{"graphCollections": [{"label", "graphs"}]}``; ``send_command`` returns
    ``{"error": ...}`` when the command raises.
    """
    try:
        data = json.loads(response_text)
    except json.JSONDecodeError:
        return None, "Conversion returned a non-JSON response"

    if not isinstance(data, dict):
        return None, "Unexpected conversion response"

    if data.get("error"):
        return None, str(data["error"])

    if "graphs" in data:
        graphs = data["graphs"]
    elif "graphCollections" in data:
        graphs = [
            graph
            for collection in data["graphCollections"]
            for graph in collection.get("graphs", [])
        ]
    else:
        return None, "Conversion response had no graphs"

    return json.dumps({"graphs": graphs}), None


def _is_extension_missing(error: str) -> bool:
    """True when ``send_command`` rejected the adapter id (so we try the next)."""
    return _EXTENSION_NOT_FOUND_RE.search(error) is not None


def _convert_with_extension(
    client: SSHClient,
    connection: RemoteConnection,
    port: int,
    server_path: str,
    extension_id: str,
) -> Tuple[Optional[str], Optional[str]]:
    """POST a single ``convert`` command on the remote host. Returns ``(graph_json, error)``."""
    payload = json.dumps(
        {
            "cmdId": MLIR_CONVERT_CMD_ID,
            "extensionId": extension_id,
            "modelPath": server_path,
            "settings": {},
            "deleteAfterConversion": True,
        }
    )
    convert_url = _remote_send_command_url(port)
    curl_cmd = (
        "curl -sS -X POST -H 'Content-Type: application/json' "
        f"--connect-timeout {_CURL_CONNECT_TIMEOUT_SECONDS} "
        f"--max-time {_CONVERT_TIMEOUT_SECONDS} "
        f"-d {shlex.quote(payload)} {shlex.quote(convert_url)}"
    )

    logger.info(
        "Converting %s via %s on %s", server_path, extension_id, connection.host
    )

    started = time.perf_counter()
    try:
        stdout = client.execute_command(
            curl_cmd, timeout=_CONVERT_TIMEOUT_SECONDS + _CURL_TIMEOUT_GRACE_SECONDS
        )
    except SSHException as e:
        return None, str(e)

    logger.info(
        "MLIR convert via %s took %.2fs", extension_id, time.perf_counter() - started
    )

    return _normalise_convert_response(stdout or "")


def _convert_model_on_server(
    client: SSHClient, connection: RemoteConnection, port: int, server_path: str
) -> MlirConversionResult:
    """Convert the uploaded model, trying each known adapter id in turn.

    Model Explorer adapter ids vary by deployment: Tenstorrent's TT-Explorer
    fork registers ``tt_adapter``, while the upstream native MLIR adapter is
    ``builtin_mlir``. We can't list them reliably (``get_extensions`` hangs on
    some deployments), so we POST ``convert`` with each candidate and fall
    through only on an "extension not found" rejection.
    """
    last_error: Optional[str] = None

    for extension_id in MLIR_CONVERT_EXTENSION_IDS:
        graph_json, error = _convert_with_extension(
            client, connection, port, server_path, extension_id
        )
        if error is None:
            return MlirConversionResult(
                status=StatusMessage(status=ConnectionTestStates.OK, message="Success"),
                graph_json=graph_json,
            )

        last_error = error
        if not _is_extension_missing(error):
            # A real conversion/transport error — don't mask it by trying others.
            break

    return _fail("MLIR conversion failed", detail=last_error)


def upload_and_convert_mlir(
    connection: MlirServerConnection,
    file_bytes: bytes,
    filename: str,
) -> MlirConversionResult:
    """Upload ``file_bytes`` to the MLIR server on ``connection`` and convert to graph JSON."""
    safe_filename = Path(filename).name
    if not is_supported_mlir_server_file(safe_filename):
        return _fail(
            "Unsupported file type. Accepted formats: "
            + ", ".join(MLIR_SERVER_ACCEPTED_EXTENSIONS)
        )

    remote = connection.to_remote_connection()
    http_port = connection.port
    client = SSHClient(remote)
    server_path, upload_error = _upload_file_to_server(
        client, remote, http_port, file_bytes, safe_filename
    )
    if upload_error is not None:
        return upload_error

    assert server_path is not None
    return _convert_model_on_server(client, remote, http_port, server_path)
