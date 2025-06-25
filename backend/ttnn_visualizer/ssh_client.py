# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import paramiko
import os
from pathlib import Path
from paramiko.agent import Agent
from paramiko.ssh_exception import SSHException

from ttnn_visualizer.decorators import remote_exception_handler
from ttnn_visualizer.models import RemoteConnection
import logging

logger = logging.getLogger(__name__)


def initialize_ssh_client():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.load_system_host_keys()
    return ssh


def get_connection_args(remote_connection: RemoteConnection) -> dict:
    use_agent = os.getenv("USE_SSH_AGENT", "true").lower() == "true"
    ssh_config_path = Path(os.getenv("SSH_CONFIG_PATH", "~/.ssh/config")).expanduser()

    if use_agent:
        agent = Agent()
        keys = agent.get_keys()
        if not keys:
            logger.error("No keys found in agent")
            raise SSHException("No keys found")
        return {"look_for_keys": True}

    config = paramiko.SSHConfig.from_path(ssh_config_path).lookup(
        remote_connection.host
    )
    if not config:
        raise SSHException(f"Host not found in SSH config {remote_connection.host}")

    return {"key_filename": config["identityfile"].pop(), "look_for_keys": False}  # type: ignore


@remote_exception_handler
def get_client(remote_connection: RemoteConnection) -> paramiko.SSHClient:
    ssh = initialize_ssh_client()
    connection_args = get_connection_args(remote_connection)

    ssh.connect(
        remote_connection.host,
        port=remote_connection.port,
        username=remote_connection.username,
        **connection_args,
    )
    return ssh


def check_permissions(client, directory):
    """Check if write and delete permissions are available in the remote directory."""
    test_file = Path(directory) / "test_permission_file.txt"
    touch_command = f"touch {test_file}"
    remove_command = f"rm {test_file}"

    stdin, stdout, stderr = client.exec_command(touch_command)
    error = stderr.read().decode().strip()
    if error:
        raise Exception(f"No permission to create files in {directory}: {error}")

    stdin, stdout, stderr = client.exec_command(remove_command)
    error = stderr.read().decode().strip()
    if error:
        raise Exception(f"No permission to delete files in {directory}: {error}")

    return True


def check_gzip_exists(client):
    """Check if gzip and tar exist on the remote server."""
    stdin, stdout, stderr = client.exec_command("which gzip && which tar")
    result = stdout.read().decode().strip()
    if not result:
        return False
    return True
