# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import re

from ttnn_visualizer.decorators import remote_exception_handler
from ttnn_visualizer.enums import ConnectionTestStates
from ttnn_visualizer.exceptions import RemoteSqliteException, SSHException
from ttnn_visualizer.models import RemoteConnection
from ttnn_visualizer.ssh_client import SSHClient

MINIMUM_SQLITE_VERSION = "3.38.0"


def _execute_ssh_command(remote_connection: RemoteConnection, command: str) -> str:
    """Execute an SSH command and return the output."""
    ssh_client = SSHClient(remote_connection)
    try:
        return ssh_client.execute_command(command, timeout=30)
    except SSHException as e:
        raise RemoteSqliteException(
            message=str(e),
            status=ConnectionTestStates.FAILED,
        )


def find_sqlite_binary(connection):
    """Check if SQLite is installed on the remote machine and return its path."""
    try:
        output = _execute_ssh_command(connection, "which sqlite3")
        binary_path = output.strip()
        if binary_path:
            print(f"SQLite binary found at: {binary_path}")
            return binary_path
        return None
    except RemoteSqliteException:
        # Re-raise RemoteSqliteException as-is
        raise
    except Exception as e:
        raise RemoteSqliteException(
            message=f"Error finding SQLite binary: {str(e)}",
            status=ConnectionTestStates.FAILED,
        )


def is_sqlite_executable(remote_connection: RemoteConnection, binary_path):
    """Check if the SQLite binary is executable by trying to run it."""
    try:
        output = _execute_ssh_command(remote_connection, f"{binary_path} --version")
        version_output = output.strip()

        version = get_sqlite_version(version_output)
        if not is_version_at_least(version, MINIMUM_SQLITE_VERSION):
            raise Exception(
                f"SQLite version {version} is below the required minimum of {MINIMUM_SQLITE_VERSION}."
            )

        print(f"SQLite binary at {binary_path} is executable. Version: {version}")
        return True

    except RemoteSqliteException:
        # Re-raise RemoteSqliteException as-is
        raise
    except Exception as e:
        raise Exception(f"Error checking SQLite executability: {str(e)}")


def get_sqlite_version(version_output):
    """Extract and return the SQLite version number from the output."""
    match = re.search(r"(\d+\.\d+\.\d+)", version_output)
    if match:
        return match.group(1)
    else:
        raise ValueError("Could not parse SQLite version from output.")


def is_version_at_least(version, minimum_version):
    """Check if the provided version is at least the minimum version."""
    version_parts = [int(v) for v in version.split(".")]
    minimum_parts = [int(v) for v in minimum_version.split(".")]

    return version_parts >= minimum_parts


@remote_exception_handler
def check_sqlite_path(remote_connection: RemoteConnection):
    try:
        is_sqlite_executable(remote_connection, remote_connection.sqliteBinaryPath)
    except Exception as e:
        raise RemoteSqliteException(message=str(e), status=ConnectionTestStates.FAILED)


def get_sqlite_path(connection: RemoteConnection):
    try:
        path = find_sqlite_binary(connection)
        if path:
            return path
    except Exception as e:
        raise RemoteSqliteException(message=str(e), status=ConnectionTestStates.FAILED)
