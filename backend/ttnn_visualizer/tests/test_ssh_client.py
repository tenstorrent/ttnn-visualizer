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


def test_mlir_server_connection_rejects_an_option_like_ssh_target():
    with pytest.raises(ValidationError, match="must not start with '-'"):
        MlirServerConnection(
            name="mlir",
            username="-oProxyCommand=touch /tmp/pwned",
            host="work-gpu",
            sshPort=22,
            port=8080,
        )
