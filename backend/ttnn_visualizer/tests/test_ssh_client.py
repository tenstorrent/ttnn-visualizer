# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Pins the identity-file contract the SSH config host picker depends on.

An empty identity file must leave ``~/.ssh/config`` in play so a Host alias keeps
its ProxyJump, IdentityFile and friends; a set identity file must isolate the run.
"""

import os

import pytest
from pydantic import ValidationError
from ttnn_visualizer.models import MlirServerConnection, RemoteConnection
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
