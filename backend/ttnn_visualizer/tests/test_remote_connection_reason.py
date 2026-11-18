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
import subprocess
from http import HTTPStatus
from pathlib import Path
from unittest.mock import patch

import pytest
from ttnn_visualizer.decorators import remote_exception_handler
from ttnn_visualizer.enums import (
    ConnectionTestStates,
    HostKeyIssue,
    RemoteConnectionFailureReason,
)
from ttnn_visualizer.exceptions import (
    AuthenticationException,
    AuthenticationFailedException,
    ConnectionDroppedError,
    HostKeyVerificationException,
    HostKeyVerificationFailedException,
    NoValidConnectionsError,
    RemoteConnectionException,
    SSHException,
    UnreachableHostException,
)
from ttnn_visualizer.models import (
    ConnectionStatusMessage,
    HostKeyStatus,
    RemoteConnection,
    StatusMessage,
    connection_status,
    connection_status_from_exception,
)
from ttnn_visualizer.sftp_operations import (
    RemoteReportPathOutcome,
    RemoteReportSearchResults,
    RemoteSearchRootState,
    check_remote_path_for_reports,
)
from ttnn_visualizer.ssh_client import SSHClient, raise_for_ssh_subprocess_error
from ttnn_visualizer.tests.frontend_parity import typescript_enum_values

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
    assert typescript_enum_values(
        _CONNECTION_STATUS_TS, "RemoteConnectionFailureReason"
    ) == {member.value for member in RemoteConnectionFailureReason}


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
        pytest.param(
            HostKeyVerificationException("Host key verification failed."),
            RemoteConnectionFailureReason.HOST_KEY_REJECTED,
            id="host_key",
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


def test_a_connection_lost_during_the_test_says_it_was_lost_not_refused():
    client = SSHClient(_connection())

    with patch.object(
        SSHClient,
        "execute_command",
        side_effect=ConnectionDroppedError("Connection reset by peer"),
    ):
        with pytest.raises(RemoteConnectionException) as excinfo:
            client.test_connection()

    assert excinfo.value.reason == RemoteConnectionFailureReason.UNREACHABLE
    assert "lost" in excinfo.value.message
    assert "hostname" not in excinfo.value.message


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


@pytest.mark.parametrize(
    "raised, reason",
    [
        pytest.param(
            NoValidConnectionsError("refused"),
            RemoteConnectionFailureReason.UNREACHABLE,
            id="unreachable",
        ),
        pytest.param(
            ConnectionDroppedError("Connection reset by peer"),
            RemoteConnectionFailureReason.UNREACHABLE,
            id="dropped",
        ),
        # Nothing classifies an unexpected local or SSH error, so it is never read as a
        # misconfigured path. A file read that matches nothing is one: only sync and file
        # reads raise it, never a connection test, so there is no path for it to blame.
        pytest.param(
            FileNotFoundError("No files found matching pattern"),
            None,
            id="file_read_found_nothing",
        ),
        pytest.param(IOError("Permission denied"), None, id="unexpected_io_error"),
        pytest.param(SSHException("kex_exchange_identification"), None, id="other"),
    ],
)
def test_the_remote_exception_handler_classifies_each_failure(app, raised, reason):
    @remote_exception_handler
    def operation(connection):
        raise raised

    with app.app_context():
        with pytest.raises(RemoteConnectionException) as excinfo:
            operation(_connection())

    assert excinfo.value.reason == reason


@pytest.mark.parametrize(
    "stderr",
    [
        "Connection reset by peer\r\n",
        "client_loop: send disconnect: Broken pipe\r\n",
    ],
)
def test_a_connection_lost_mid_command_is_classified_as_dropped(stderr):
    error = subprocess.CalledProcessError(255, ["ssh"], output="", stderr=stderr)

    with pytest.raises(ConnectionDroppedError):
        raise_for_ssh_subprocess_error(error, _connection())


def test_a_reset_during_the_handshake_is_a_connection_that_never_came_up():
    # Not a dropped connection: the hostname or port is the usual cause, which the
    # refused advice names. Both carry ``UNREACHABLE``, so only the message differs.
    error = subprocess.CalledProcessError(
        255,
        ["ssh"],
        output="",
        stderr="kex_exchange_identification: read: Connection reset by peer\r\n",
    )

    with pytest.raises(NoValidConnectionsError) as excinfo:
        raise_for_ssh_subprocess_error(error, _connection())

    assert not isinstance(excinfo.value, ConnectionDroppedError)


def test_too_many_authentication_failures_is_an_auth_failure():
    # Common for anyone with many keys in ssh-agent: the server gives up before the right one.
    error = subprocess.CalledProcessError(
        255,
        ["ssh"],
        output="",
        stderr="Received disconnect from 10.0.0.1 port 22:2: Too many authentication failures\r\n",
    )

    with pytest.raises(AuthenticationException):
        raise_for_ssh_subprocess_error(error, _connection())


def test_a_dropped_connection_says_it_was_lost_not_refused():
    error = UnreachableHostException.for_dropped_connection("work-gpu")

    assert error.reason == RemoteConnectionFailureReason.UNREACHABLE
    assert "lost" in error.message
    assert "hostname" not in error.message
    assert not error.is_connection_verdict


def test_an_unreachable_host_names_the_host_and_its_class():
    error = UnreachableHostException.for_host("work-gpu", detail="ssh: refused")

    assert error.reason == RemoteConnectionFailureReason.UNREACHABLE
    assert "work-gpu" in error.message
    assert error.detail == "ssh: refused"
    # A line in the list, not the whole answer: the other checks still report.
    assert not error.is_connection_verdict


def test_a_connection_lost_mid_search_keeps_its_class_on_the_path(app):
    with (
        app.app_context(),
        patch(
            "ttnn_visualizer.sftp_operations.find_folders_by_files",
            side_effect=NoValidConnectionsError("dropped"),
        ),
    ):
        searches = check_remote_path_for_reports(_connection())

    assert searches.profiler is not None
    assert searches.profiler.error_reason == RemoteConnectionFailureReason.UNREACHABLE


@pytest.mark.parametrize(
    "outcome, reason",
    [
        pytest.param(
            RemoteReportPathOutcome(
                root_state=RemoteSearchRootState.UNKNOWN,
                error_message="Unable to establish SSH connection.",
                error_reason=RemoteConnectionFailureReason.UNREACHABLE,
            ),
            "unreachable",
            id="connection_lost_mid_search",
        ),
        pytest.param(
            RemoteReportPathOutcome(root_state=RemoteSearchRootState.UNKNOWN),
            None,
            id="search_never_settled",
        ),
        pytest.param(
            RemoteReportPathOutcome(root_state=RemoteSearchRootState.MISSING),
            "report_path_failed",
            id="missing_path",
        ),
        pytest.param(
            RemoteReportPathOutcome(root_state=RemoteSearchRootState.NOT_A_DIRECTORY),
            "report_path_failed",
            id="not_a_directory",
        ),
        pytest.param(
            RemoteReportPathOutcome(
                root_state=RemoteSearchRootState.UNKNOWN,
                error_message="Permission denied accessing '/remote/profiler'.",
                error_reason=RemoteConnectionFailureReason.REPORT_PATH_FAILED,
            ),
            "report_path_failed",
            id="unreadable_path",
        ),
        pytest.param(
            RemoteReportPathOutcome(
                root_state=RemoteSearchRootState.UNKNOWN,
                error_message="SSH connection error to work-gpu: odd.",
            ),
            None,
            id="unclassified_failure",
        ),
    ],
)
def test_a_path_line_blames_the_path_only_when_the_search_settled_it(
    app, client, outcome, reason
):
    app.config["SERVER_MODE"] = False

    with (
        patch("ttnn_visualizer.views.test_ssh_connection"),
        patch(
            "ttnn_visualizer.views.check_remote_path_for_reports",
            return_value=RemoteReportSearchResults(profiler=outcome, performance=None),
        ),
    ):
        response = client.post("/api/remote/test", json=_remote_connection_payload())

    assert response.status_code == HTTPStatus.OK
    connection_line, path_line = response.get_json()
    assert connection_line["status"] == ConnectionTestStates.OK.value
    assert path_line["status"] == ConnectionTestStates.FAILED.value
    assert path_line.get(_REASON_FIELD) == reason


def test_a_host_key_verdict_carries_both_the_key_and_its_class(app, client):
    app.config["SERVER_MODE"] = False
    host_key = HostKeyStatus(issue=HostKeyIssue.UNKNOWN, host="work-gpu", port=22)

    with patch(
        "ttnn_visualizer.views.test_ssh_connection",
        side_effect=HostKeyVerificationFailedException(
            "Host key not trusted.", host_key=host_key
        ),
    ):
        response = client.post("/api/remote/test", json=_remote_connection_payload())

    assert response.status_code == HTTPStatus.UNPROCESSABLE_ENTITY
    (line,) = response.get_json()
    assert line[_REASON_FIELD] == "host_key_rejected"
    assert line["hostKey"]["host"] == "work-gpu"
