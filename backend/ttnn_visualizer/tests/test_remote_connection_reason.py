# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Pins the machine-readable reason a remote connection test's status line carries.

The client classifies a test's outcome for usage events from this field, never from
``message``, which is written for people and names the host. These tests hold each
failure to its class, keep the field off the upload responses that share
``StatusMessage``, and keep the TypeScript copy of the enum in step.
"""

import re
from http import HTTPStatus
from pathlib import Path
from unittest.mock import patch

import pytest
from ttnn_visualizer.enums import ConnectionTestStates, RemoteConnectionFailureReason
from ttnn_visualizer.exceptions import (
    AuthenticationException,
    AuthenticationFailedException,
    HostKeyVerificationFailedException,
    NoValidConnectionsError,
    RemoteConnectionException,
    SSHException,
)
from ttnn_visualizer.models import (
    ConnectionStatusMessage,
    RemoteConnection,
    StatusMessage,
    connection_status,
    connection_status_from_exception,
)
from ttnn_visualizer.ssh_client import SSHClient

_CONNECTION_STATUS_TS = (
    Path(__file__).resolve().parents[3] / "src" / "definitions" / "ConnectionStatus.ts"
)
_REASON_FIELD = "reason"


def _connection() -> RemoteConnection:
    return RemoteConnection(
        name="lab",
        username="alice",
        host="work-gpu",
        port=22,
        profilerPath="/reports",
    )


def _remote_connection_payload():
    return {
        "name": "test-remote",
        "username": "tester",
        "host": "remote.example.com",
        "port": 22,
        "profilerPath": "/remote/profiler/reports",
    }


def test_the_typescript_reason_enum_matches():
    body = re.search(
        r"export enum RemoteConnectionFailureReason {(.*?)^}",
        _CONNECTION_STATUS_TS.read_text(encoding="utf-8"),
        re.DOTALL | re.MULTILINE,
    )
    assert body is not None, "No RemoteConnectionFailureReason in ConnectionStatus.ts"

    assert set(re.findall(r"=\s*'([^']+)'", body.group(1))) == {
        member.value for member in RemoteConnectionFailureReason
    }


def test_the_connection_verdicts_carry_their_own_reason():
    assert (
        AuthenticationFailedException("denied").reason
        == RemoteConnectionFailureReason.AUTH_FAILED
    )
    assert (
        HostKeyVerificationFailedException("untrusted").reason
        == RemoteConnectionFailureReason.HOST_KEY_REJECTED
    )
    assert (
        RemoteConnectionException("odd", status=ConnectionTestStates.FAILED).reason
        is None
    )


@pytest.mark.parametrize(
    "raised, reason",
    [
        pytest.param(
            NoValidConnectionsError("refused"),
            RemoteConnectionFailureReason.UNREACHABLE,
            id="unreachable",
        ),
        pytest.param(
            SSHException("Connection timed out"),
            RemoteConnectionFailureReason.UNREACHABLE,
            id="timeout",
        ),
        pytest.param(
            AuthenticationException("Permission denied"),
            RemoteConnectionFailureReason.AUTH_FAILED,
            id="auth",
        ),
        pytest.param(SSHException("kex_exchange_identification"), None, id="other"),
    ],
)
def test_each_test_connection_failure_is_classified(raised, reason):
    client = SSHClient(_connection())

    with patch.object(SSHClient, "execute_command", side_effect=raised):
        with pytest.raises(RemoteConnectionException) as excinfo:
            client.test_connection()

    assert excinfo.value.reason == reason


def test_a_status_line_without_a_verdict_stays_a_plain_status_message():
    # `StatusMessage` is also the NPE upload response and part of every MLIR upload
    # entry; neither may gain the field.
    line = connection_status(ConnectionTestStates.OK, "SSH connection established")

    assert type(line) is StatusMessage
    assert _REASON_FIELD not in line.model_dump()


def test_a_classified_failure_widens_the_line_and_serialises_its_value():
    error = RemoteConnectionException(
        "Unable to establish SSH connection to work-gpu.",
        status=ConnectionTestStates.FAILED,
        reason=RemoteConnectionFailureReason.UNREACHABLE,
    )

    line = connection_status_from_exception(error)

    assert isinstance(line, ConnectionStatusMessage)
    assert line.model_dump()[_REASON_FIELD] == "unreachable"


@pytest.mark.parametrize(
    "raised, status_code, reason",
    [
        pytest.param(
            AuthenticationFailedException("SSH authentication failed."),
            HTTPStatus.UNPROCESSABLE_ENTITY,
            "auth_failed",
            id="auth_verdict",
        ),
        pytest.param(
            RemoteConnectionException(
                "Unable to establish SSH connection.",
                status=ConnectionTestStates.FAILED,
                reason=RemoteConnectionFailureReason.UNREACHABLE,
            ),
            HTTPStatus.OK,
            "unreachable",
            id="unreachable_line",
        ),
        pytest.param(
            RemoteConnectionException(
                "SSH connection error.", status=ConnectionTestStates.FAILED
            ),
            HTTPStatus.OK,
            None,
            id="unclassified_line",
        ),
    ],
)
def test_the_route_returns_the_reason_on_the_connection_line(
    app, client, raised, status_code, reason
):
    app.config["SERVER_MODE"] = False

    with patch("ttnn_visualizer.views.test_ssh_connection", side_effect=raised):
        response = client.post("/api/remote/test", json=_remote_connection_payload())

    assert response.status_code == status_code
    line = response.get_json()[0]
    assert line["status"] == ConnectionTestStates.FAILED.value
    assert line.get(_REASON_FIELD) == reason
