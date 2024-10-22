from typing import List, Optional
import paramiko
import os
from pathlib import Path
from paramiko.agent import Agent
from paramiko.ssh_exception import SSHException
from ttnn_visualizer.models import RemoteConnection, StatusMessage
from ttnn_visualizer.enums import ConnectionTestStates
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

    return {"key_filename": config["identityfile"].pop(), "look_for_keys": False}


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


def check_connection(remote_connection: RemoteConnection) -> StatusMessage:
    client: Optional[paramiko.SSHClient] = None
    try:
        client = get_client(remote_connection)

        stdin, stdout, stderr = client.exec_command('echo "test connection"')  # type: ignore
        output = stdout.read().decode().strip()
        if output != "test connection":
            return StatusMessage(
                status=ConnectionTestStates.FAILED.value,
                message="The SSH connection was established, but the server returned an unexpected response.",
            )

        # If the connection and command execution are successful
        return StatusMessage(
            status=ConnectionTestStates.OK.value,
            message="SSH connection established.",
        )

    except paramiko.AuthenticationException as e:
        message = f"An SSH-related error occurred {str(e)}"
        logger.error(message)
        return StatusMessage(
            status=ConnectionTestStates.FAILED.value,
            message="Authentication failed. Please verify your SSH credentials.",
        )
    except paramiko.SSHException as e:
        message = f"An SSH-related error occurred {str(e)}"
        logger.error(message)

        if "No existing session" in str(e):
            message = f"Authentication Failed"

        return StatusMessage(status=ConnectionTestStates.FAILED.value, message=message)
    except Exception as e:
        message = f"An SSH-related error occurred {str(e)}"
        logger.error(message)
        message = "Unable to Connect to Host"
        return StatusMessage(
            status=ConnectionTestStates.FAILED.value,
            message=f"{message}",
        )
    finally:
        if client:
            try:
                client.close()
            except:
                pass


def check_directory(remote_connection: RemoteConnection) -> StatusMessage:
    client: Optional[paramiko.SSHClient] = None
    try:
        client = get_client(remote_connection)
        # Check if the specified directory exists
        stdin, stdout, stderr = client.exec_command(f"ls {remote_connection.path}")  # type: ignore
        error = stderr.read().decode().strip()
        if error:
            message = f"An SSH-related error occurred {str(error)}"
            logger.error(message)
            return StatusMessage(
                status=ConnectionTestStates.FAILED.value,
                message=f"Invalid Folder Path",
            )

        # If the directory check is successful
        return StatusMessage(
            status=ConnectionTestStates.OK.value,
            message="Provided path is accessible.",
        )

    except Exception as e:
        message = f"An SSH-related error occurred {str(e)}"
        logger.error(message)
        return StatusMessage(
            status=ConnectionTestStates.FAILED.value,
            message=f"Error accessing directory",
        )
    finally:
        if client:
            try:
                client.close()
            except:
                pass


def test_ssh_connection(remote_connection: RemoteConnection) -> list[StatusMessage]:
    status_results: List[StatusMessage] = []
    # Perform the connection check and add the result
    status_results.append(check_connection(remote_connection))

    has_failures = any(
        status.status != ConnectionTestStates.OK.value for status in status_results
    )
    # Perform the directory check and add the result
    if not has_failures:
        status_results.append(check_directory(remote_connection))
    return status_results


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
