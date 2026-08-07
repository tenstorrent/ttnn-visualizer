# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Pins the identity-file contract the SSH config host picker depends on.

An empty identity file must leave ``~/.ssh/config`` in play so a Host alias keeps
its ProxyJump, IdentityFile and friends; a set identity file must isolate the run.
"""

import os
import shlex
import subprocess
from unittest.mock import patch

import pytest
from pydantic import ValidationError
from ttnn_visualizer.models import (
    MAX_REMOTE_PATH_LENGTH,
    MlirServerConnection,
    RemoteConnection,
)
from ttnn_visualizer.ssh_client import SSHClient


def _connection(**overrides) -> RemoteConnection:
    fields = {
        "name": "lab",
        "username": "alice",
        "host": "work-gpu",
        "port": 22,
        "profilerPath": "/reports",
    }
    fields.update(overrides)
    return RemoteConnection(**fields)


def _mlir_connection(**overrides) -> MlirServerConnection:
    fields = {
        "name": "mlir",
        "username": "alice",
        "host": "work-gpu",
        "sshPort": 22,
        "port": 8080,
    }
    fields.update(overrides)
    return MlirServerConnection(**fields)


def test_base_commands_honour_ssh_config_without_an_identity_file():
    client = SSHClient(_connection())

    for cmd in (client._base_ssh_cmd, client._base_sftp_cmd):
        assert "-F" not in cmd
        assert os.devnull not in cmd
        assert "IdentitiesOnly=yes" not in cmd
        assert "-i" not in cmd
        assert "BatchMode=yes" in cmd
        assert "alice@work-gpu" in cmd


def test_base_commands_isolate_the_run_when_an_identity_file_is_set():
    client = SSHClient(_connection(identityFile="/tmp/id_ed25519"))

    for cmd in (client._base_ssh_cmd, client._base_sftp_cmd):
        assert cmd[cmd.index("-F") + 1] == os.devnull
        assert "IdentitiesOnly=yes" in cmd
        assert cmd[cmd.index("-i") + 1] == "/tmp/id_ed25519"


def test_base_commands_omit_the_port_flag_for_the_default_port():
    client = SSHClient(_connection(port=22))

    assert "-p" not in client._base_ssh_cmd
    assert "-P" not in client._base_sftp_cmd


def test_base_commands_pass_a_non_default_port():
    client = SSHClient(_connection(port=2222))

    assert client._base_ssh_cmd[client._base_ssh_cmd.index("-p") + 1] == "2222"
    assert client._base_sftp_cmd[client._base_sftp_cmd.index("-P") + 1] == "2222"


# The target lands in option position in every one of these argvs, so a username or
# host starting with "-" would be read as an option — "-oProxyCommand=…" is executed
# through a shell — rather than as the machine to connect to.
@pytest.mark.parametrize(
    "overrides",
    [
        {"username": "-oProxyCommand=touch /tmp/pwned"},
        # No slash: the host is collapsed to a basename first, which already defuses a
        # payload carrying a path separator but leaves a bare option intact.
        {"host": "-oProxyCommand=id"},
    ],
    ids=["username", "host"],
)
def test_connection_rejects_an_option_like_ssh_target(overrides):
    with pytest.raises(ValidationError, match="must not start with '-'"):
        _connection(**overrides)


# Pydantic's lax mode coerces bytes and bytearray to str *after* our "before" validators
# run, so passing a non-string through to Pydantic would let a leading "-" survive.
@pytest.mark.parametrize(
    "overrides",
    [
        {"username": b"-oProxyCommand=id"},
        {"host": bytearray(b"-oProxyCommand=id")},
    ],
    ids=["username-bytes", "host-bytearray"],
)
def test_connection_rejects_a_non_string_ssh_target(overrides):
    with pytest.raises(ValidationError, match="must be a string"):
        _connection(**overrides)


# MlirServerConnection reaches ssh through to_remote_connection, so it runs the same
# username and host validators and has to refuse the same values.
@pytest.mark.parametrize(
    "overrides",
    [
        {"username": b"-oProxyCommand=id"},
        {"host": bytearray(b"-oProxyCommand=id")},
    ],
    ids=["username-bytes", "host-bytearray"],
)
def test_mlir_server_connection_rejects_a_non_string_ssh_target(overrides):
    with pytest.raises(ValidationError, match="must be a string"):
        _mlir_connection(**overrides)


@pytest.mark.parametrize(
    "overrides",
    [
        {"username": "-oProxyCommand=touch /tmp/pwned"},
        {"host": "-oProxyCommand=id"},
    ],
    ids=["username", "host"],
)
def test_mlir_server_connection_rejects_an_option_like_ssh_target(overrides):
    with pytest.raises(ValidationError, match="must not start with '-'"):
        _mlir_connection(**overrides)


# Both models feed the same "user@host" argv token, so an empty username would reach
# ssh as the bare target "@host" rather than failing validation.
@pytest.mark.parametrize("username", ["", "   "], ids=["empty", "whitespace"])
def test_connection_rejects_an_empty_username(username):
    with pytest.raises(ValidationError, match="must not be empty"):
        _connection(username=username)


@pytest.mark.parametrize("username", ["", "   "], ids=["empty", "whitespace"])
def test_mlir_server_connection_rejects_an_empty_username(username):
    with pytest.raises(ValidationError, match="must not be empty"):
        _mlir_connection(username=username)


# The empty-username rule is enforced after stripping, so padding has to survive as a
# trimmed username rather than being rejected along with it.
def test_connection_accepts_a_padded_username():
    assert _connection(username="  alice  ").username == "alice"


def test_mlir_server_connection_accepts_a_padded_username():
    assert _mlir_connection(username="  alice  ").username == "alice"


# Report paths are interpolated into remote shell commands, so they carry a validator
# of their own rather than relying on call-site quoting as the only defence.
@pytest.mark.parametrize("field", ["profilerPath", "performancePath"])
@pytest.mark.parametrize(
    "path",
    [
        "reports",
        "tt-metal/generated/ttnn/reports",
        "~/tt-metal/generated/ttnn/reports",
        "./reports",
    ],
    ids=["bare", "relative", "tilde", "dot-relative"],
)
def test_connection_rejects_a_path_that_is_not_absolute(field, path):
    with pytest.raises(ValidationError, match="must be an absolute path"):
        _connection(**{field: path})


@pytest.mark.parametrize("field", ["profilerPath", "performancePath"])
@pytest.mark.parametrize(
    "path",
    ["/reports\nrm -rf /", "/reports\x00/etc", "/reports\treports", "/reports\x7f"],
    ids=["newline", "nul", "tab", "delete"],
)
def test_connection_rejects_a_path_with_control_characters(field, path):
    # A newline splits one remote command into two, and NUL reaches subprocess as
    # ValueError("embedded null byte") — a 500 rather than a validation message.
    with pytest.raises(ValidationError, match="must not contain control characters"):
        _connection(**{field: path})


@pytest.mark.parametrize("field", ["profilerPath", "performancePath"])
def test_connection_rejects_an_over_long_path(field):
    with pytest.raises(ValidationError, match="must be at most"):
        _connection(**{field: "/" + "a" * MAX_REMOTE_PATH_LENGTH})


@pytest.mark.parametrize("field", ["profilerPath", "performancePath"])
def test_connection_rejects_a_non_string_path(field):
    # Pydantic coerces bytes to str after "before" validators run, so a non-string has
    # to be refused here rather than left to the field type.
    with pytest.raises(ValidationError, match="must be a string"):
        _connection(**{field: b"/reports"})


@pytest.mark.parametrize("field", ["profilerPath", "performancePath"])
def test_connection_strips_padding_from_a_path(field):
    assert getattr(_connection(**{field: "  /reports  "}), field) == "/reports"


# An unconfigured path is a supported state, so emptiness must not be mistaken for a
# rejected value: report discovery skips a path it was not given.
@pytest.mark.parametrize("path", ["", "   "], ids=["empty", "whitespace"])
def test_connection_accepts_an_empty_profiler_path(path):
    assert _connection(profilerPath=path).profilerPath == ""


def test_connection_accepts_an_absent_performance_path():
    assert _connection(performancePath=None).performancePath is None


@pytest.mark.parametrize("path", ["", "   "], ids=["empty", "whitespace"])
def test_connection_accepts_an_empty_performance_path(path):
    assert _connection(performancePath=path).performancePath == ""


# A path that survives validation can still contain shell metacharacters, which is why
# quoting at the call site remains the primary defence.
@pytest.mark.parametrize(
    "path",
    ["/reports; touch /tmp/pwned", "/reports/$(id)", "/remote/o'brien/reports"],
    ids=["semicolon", "substitution", "apostrophe"],
)
def test_connection_accepts_an_absolute_path_containing_shell_metacharacters(path):
    assert _connection(profilerPath=path).profilerPath == path


# `scp -O` expands its remote path through a shell on the far side, so delivering the
# target as one argv element is not protection on its own — the path half needs quoting.
def test_upload_file_quotes_the_remote_path_in_the_scp_target(tmp_path):
    remote_path = "/remote/o'brien/reports/model.mlir"
    local_file = tmp_path / "model.mlir"
    local_file.write_text("x")
    client = SSHClient(_connection())

    with patch(
        "subprocess.run",
        return_value=subprocess.CompletedProcess(args=["scp"], returncode=0),
    ) as run:
        client.upload_file(str(local_file), remote_path)

    target = run.call_args[0][0][-1]
    assert target.startswith("alice@work-gpu:")
    assert shlex.split(target.split(":", 1)[1]) == [remote_path]


# MlirServerConnection has no report paths of its own but builds a RemoteConnection
# with an empty profiler path, so the validator must not break MLIR flows.
def test_mlir_server_connection_still_converts_to_a_remote_connection():
    remote = _mlir_connection().to_remote_connection()

    assert remote.profilerPath == ""
    assert remote.host == "work-gpu"
