# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Tests for the MLIR upload/convert proxy.

Covers the pure helpers in ``mlir`` (response normalisation, adapter
fallback, file-type guard) and the ``/api/remote/mlir/upload`` endpoint,
including the path-traversal regression mandated for upload handlers.
"""

import json
from http import HTTPStatus
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

import pytest
from pydantic import ValidationError
from ttnn_visualizer.enums import ConnectionTestStates
from ttnn_visualizer.mlir import (
    MlirConversionResult,
    _convert_model_on_server,
    _is_extension_missing,
    _normalise_convert_response,
    is_supported_mlir_server_file,
    upload_and_convert_mlir,
)
from ttnn_visualizer.models import MlirServerConnection, RemoteConnection, StatusMessage

# Model Explorer HTTP port on the remote host's loopback — not SSH (see ``mlir_http_port``).
MLIR_HTTP_PORT = 8080


@pytest.fixture
def mlir_server_connection() -> MlirServerConnection:
    return MlirServerConnection(
        name="test",
        username="user",
        host="remote.test",
        sshPort=22,
        port=MLIR_HTTP_PORT,
    )


@pytest.fixture
def mlir_connection(mlir_server_connection: MlirServerConnection) -> RemoteConnection:
    return mlir_server_connection.to_remote_connection()


@pytest.fixture
def mlir_http_port(mlir_server_connection: MlirServerConnection) -> int:
    return mlir_server_connection.port


# ---- MlirServerConnection --------------------------------------------------


def test_mlir_server_connection_model_validate():
    connection = MlirServerConnection.model_validate(
        {
            "name": "lab",
            "username": "user",
            "host": "remote.test",
            "sshPort": 2222,
            "port": 8080,
            "identityFile": "/home/user/.ssh/id_ed25519",
        }
    )
    remote = connection.to_remote_connection()
    assert remote.port == 2222
    assert remote.profilerPath == ""
    assert remote.identityFile == "/home/user/.ssh/id_ed25519"
    assert connection.port == 8080


def test_mlir_server_connection_strips_whitespace():
    connection = MlirServerConnection.model_validate(
        {"username": "  user  ", "host": " remote.test ", "port": 8080}
    )
    assert connection.username == "user"
    assert connection.host == "remote.test"


def test_mlir_server_connection_rejects_empty_host():
    with pytest.raises(ValidationError):
        MlirServerConnection.model_validate(
            {"username": "user", "host": "  ", "port": 8080}
        )


# ---- is_supported_mlir_server_file ----------------------------------------


def test_is_supported_mlir_server_file_accepts_known_extensions():
    assert is_supported_mlir_server_file("model.mlir")
    assert is_supported_mlir_server_file("graph.json")
    assert is_supported_mlir_server_file("net.pt2")


def test_is_supported_mlir_server_file_is_case_insensitive():
    assert is_supported_mlir_server_file("MODEL.MLIR")


def test_is_supported_mlir_server_file_rejects_unknown_and_empty():
    assert not is_supported_mlir_server_file("notes.txt")
    assert not is_supported_mlir_server_file("")


# ---- _is_extension_missing -------------------------------------------------


def test_is_extension_missing_matches_send_command_rejection():
    assert _is_extension_missing('Exception: Extension "tt_adapter" not found')


def test_is_extension_missing_ignores_real_errors():
    assert not _is_extension_missing("Conversion failed: invalid MLIR module")


def test_is_extension_missing_ignores_unrelated_not_found():
    assert not _is_extension_missing("model file not found on disk")


# ---- _normalise_convert_response ------------------------------------------


def test_normalise_passes_through_graphs_shape():
    graph_json, error = _normalise_convert_response(
        json.dumps({"graphs": [{"id": "g", "nodes": []}]})
    )
    assert error is None
    assert json.loads(graph_json) == {"graphs": [{"id": "g", "nodes": []}]}


def test_normalise_flattens_graph_collections():
    payload = json.dumps(
        {
            "graphCollections": [
                {"label": "a", "graphs": [{"id": "g1"}]},
                {"label": "b", "graphs": [{"id": "g2"}]},
            ]
        }
    )
    graph_json, error = _normalise_convert_response(payload)
    assert error is None
    assert json.loads(graph_json) == {"graphs": [{"id": "g1"}, {"id": "g2"}]}


def test_normalise_surfaces_server_error():
    graph_json, error = _normalise_convert_response(
        json.dumps({"error": "Extension not found"})
    )
    assert graph_json is None
    assert error == "Extension not found"


def test_normalise_rejects_non_json():
    graph_json, error = _normalise_convert_response("<html>500</html>")
    assert graph_json is None
    assert "non-JSON" in error


def test_normalise_rejects_response_without_graphs():
    graph_json, error = _normalise_convert_response(json.dumps({"unexpected": 1}))
    assert graph_json is None
    assert "no graphs" in error


# ---- _convert_model_on_server: adapter fallback ---------------------------


def test_convert_falls_through_to_next_adapter_on_not_found(
    mlir_connection, mlir_http_port
):
    """First adapter ("tt_adapter") missing → retry with "builtin_mlir"."""
    calls = []

    def fake_convert(_client, _connection, _port, _server_path, extension_id):
        calls.append(extension_id)
        if extension_id == "tt_adapter":
            return None, 'Extension "tt_adapter" not found'
        return json.dumps({"graphs": []}), None

    with patch(
        "ttnn_visualizer.mlir._convert_with_extension", side_effect=fake_convert
    ):
        result = _convert_model_on_server(
            None, mlir_connection, mlir_http_port, "/tmp/model.mlir"
        )

    # `StatusMessage` coerces the enum to its int value, so compare against
    # `.value` (the same contract the views and frontend rely on).
    assert result.status.status == ConnectionTestStates.OK.value
    assert result.graph_json == json.dumps({"graphs": []})
    assert calls == ["tt_adapter", "builtin_mlir"]


def test_convert_does_not_mask_real_error_with_fallback(
    mlir_connection, mlir_http_port
):
    """A genuine conversion error must short-circuit, not try other adapters."""
    calls = []

    def fake_convert(_client, _connection, _port, _server_path, extension_id):
        calls.append(extension_id)
        return None, "Conversion failed: invalid MLIR module"

    with patch(
        "ttnn_visualizer.mlir._convert_with_extension", side_effect=fake_convert
    ):
        result = _convert_model_on_server(
            None, mlir_connection, mlir_http_port, "/tmp/model.mlir"
        )

    assert result.status.status == ConnectionTestStates.FAILED.value
    assert result.status.detail == "Conversion failed: invalid MLIR module"
    # Stopped after the first adapter — no fall-through.
    assert calls == ["tt_adapter"]


# ---- upload_and_convert_mlir: guards --------------------------------------


def test_upload_and_convert_rejects_unsupported_file_before_upload(
    mlir_server_connection,
):
    with patch("ttnn_visualizer.mlir._upload_file_to_server") as mock_upload:
        result = upload_and_convert_mlir(mlir_server_connection, b"data", "notes.txt")

    assert result.status.status == ConnectionTestStates.FAILED.value
    assert "Unsupported file type" in result.status.message
    mock_upload.assert_not_called()


# ---- /api/remote/mlir/upload endpoint -------------------------------------


def _ok_conversion() -> MlirConversionResult:
    return MlirConversionResult(
        status=StatusMessage(status=ConnectionTestStates.OK, message="Success"),
        graph_json=json.dumps({"graphs": [{"id": "g", "nodes": []}]}),
    )


def test_upload_endpoint_forbidden_when_server_mode(app, client, make_report):
    """The upload proxy is @local_only and must 403 in hosted SERVER_MODE."""
    instance_id = make_report()
    assert app.config["SERVER_MODE"] is True

    response = client.post(
        "/api/remote/mlir/upload",
        query_string={"instanceId": instance_id},
        data=_mlir_upload_form_data(),
        content_type="multipart/form-data",
    )

    assert response.status_code == HTTPStatus.FORBIDDEN


def test_get_mlir_endpoint_forbidden_when_server_mode(app, client, make_report):
    """Persisted MLIR JSON is @local_only and must 403 in hosted SERVER_MODE."""
    instance_id = make_report()
    assert app.config["SERVER_MODE"] is True

    response = client.get("/api/mlir", query_string={"instanceId": instance_id})

    assert response.status_code == HTTPStatus.FORBIDDEN


def _mlir_upload_form_data(file_data=b"{}", filename="model.mlir", **overrides):
    data = {
        "files": (BytesIO(file_data), filename),
        "host": "remote.test",
        "username": "user",
        "sshPort": "22",
        "port": "8080",
    }
    data.update(overrides)
    return data


def test_upload_endpoint_requires_files_and_port(app, client, make_report):
    instance_id = make_report()
    app.config["SERVER_MODE"] = False

    no_files = client.post(
        "/api/remote/mlir/upload",
        query_string={"instanceId": instance_id},
        data={"host": "remote.test", "username": "user", "port": "8080"},
        content_type="multipart/form-data",
    )
    assert no_files.status_code == HTTPStatus.BAD_REQUEST

    no_connection = client.post(
        "/api/remote/mlir/upload",
        query_string={"instanceId": instance_id},
        data={"files": (BytesIO(b"{}"), "model.mlir"), "port": "8080"},
        content_type="multipart/form-data",
    )
    assert no_connection.status_code == HTTPStatus.BAD_REQUEST


def test_upload_endpoint_returns_graph_and_persists_json(app, client, make_report):
    """Success returns the converted graph + name and writes it under MLIR dir."""
    instance_id = make_report()
    app.config["LOCAL_DATA_DIRECTORY"] = Path(app.config["LOCAL_DATA_DIRECTORY"])
    app.config["SERVER_MODE"] = False

    with patch(
        "ttnn_visualizer.views.upload_and_convert_mlir", return_value=_ok_conversion()
    ):
        response = client.post(
            "/api/remote/mlir/upload",
            query_string={"instanceId": instance_id},
            data=_mlir_upload_form_data(b"ignored", "my_model.mlir"),
            content_type="multipart/form-data",
        )

    assert response.status_code == HTTPStatus.OK, response.get_data(as_text=True)
    body = response.get_json()
    assert body["status"] == ConnectionTestStates.OK.value
    assert body["name"] == "my_model"
    assert body["graph"] == {"graphs": [{"id": "g", "nodes": []}]}

    mlir_root = (
        Path(app.config["LOCAL_DATA_DIRECTORY"]) / app.config["MLIR_DIRECTORY_NAME"]
    ).resolve()
    assert (mlir_root / "my_model.json").is_file()


def test_upload_endpoint_failure_returns_status_without_graph(app, client, make_report):
    instance_id = make_report()
    app.config["LOCAL_DATA_DIRECTORY"] = Path(app.config["LOCAL_DATA_DIRECTORY"])
    app.config["SERVER_MODE"] = False

    failure = MlirConversionResult(
        status=StatusMessage(
            status=ConnectionTestStates.FAILED, message="MLIR conversion failed"
        )
    )
    with patch("ttnn_visualizer.views.upload_and_convert_mlir", return_value=failure):
        response = client.post(
            "/api/remote/mlir/upload",
            query_string={"instanceId": instance_id},
            data=_mlir_upload_form_data(b"x", "model.mlir"),
            content_type="multipart/form-data",
        )

    assert response.status_code == HTTPStatus.OK
    body = response.get_json()
    assert body["status"] == ConnectionTestStates.FAILED.value
    assert "graph" not in body


def test_upload_endpoint_traversal_filename_stays_in_mlir_dir(app, client, make_report):
    """A crafted filename must not write the persisted JSON outside the MLIR dir.

    The view derives the on-disk name from the upload filename, so a
    ``../escape.mlir`` must collapse to ``escape.json`` inside the MLIR
    directory rather than escaping it.
    """
    instance_id = make_report()
    app.config["LOCAL_DATA_DIRECTORY"] = Path(app.config["LOCAL_DATA_DIRECTORY"])
    app.config["SERVER_MODE"] = False

    with patch(
        "ttnn_visualizer.views.upload_and_convert_mlir", return_value=_ok_conversion()
    ):
        response = client.post(
            "/api/remote/mlir/upload",
            query_string={"instanceId": instance_id},
            data=_mlir_upload_form_data(b"x", "../escape.mlir"),
            content_type="multipart/form-data",
        )

    assert response.status_code == HTTPStatus.OK, response.get_data(as_text=True)

    local_root = Path(app.config["LOCAL_DATA_DIRECTORY"]).resolve()
    mlir_root = (local_root / app.config["MLIR_DIRECTORY_NAME"]).resolve()

    for path in local_root.rglob("*"):
        if path.is_file():
            assert (
                mlir_root in path.resolve().parents
            ), f"File escaped MLIR directory: {path.resolve()}"

    assert (mlir_root / "escape.json").is_file()
