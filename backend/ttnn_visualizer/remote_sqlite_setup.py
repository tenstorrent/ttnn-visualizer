# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import re

from ttnn_visualizer.decorators import remote_exception_handler
from ttnn_visualizer.enums import ConnectionTestStates
from ttnn_visualizer.exceptions import RemoteSqliteException
from ttnn_visualizer.models import RemoteConnection
from ttnn_visualizer.ssh_client import get_client

MINIMUM_SQLITE_VERSION = "3.38.0"


def find_sqlite_binary(connection):
    """Check if SQLite is installed on the remote machine and return its path."""
    ssh_client = get_client(connection)
    try:
        stdin, stdout, stderr = ssh_client.exec_command("which sqlite3")
        binary_path = stdout.read().decode().strip()
        error = stderr.read().decode().strip()
        if binary_path:
            print(f"SQLite binary found at: {binary_path}")
            return binary_path
        elif error:
            print(f"Error checking SQLite binary: {error}")
        return None
    except Exception as e:
        raise RemoteSqliteException(
            message=f"Error finding SQLite binary: {str(e)}",
            status=ConnectionTestStates.FAILED,
        )


def is_sqlite_executable(ssh_client, binary_path):
    """Check if the SQLite binary is executable by trying to run it."""
    try:
        stdin, stdout, stderr = ssh_client.exec_command(f"{binary_path} --version")
        output = stdout.read().decode().strip()
        error = stderr.read().decode().strip()
        stdout.channel.recv_exit_status()
        if error:
            raise Exception(f"Error while trying to run SQLite binary: {error}")

        version = get_sqlite_version(output)
        if not is_version_at_least(version, MINIMUM_SQLITE_VERSION):
            raise Exception(
                f"SQLite version {version} is below the required minimum of {MINIMUM_SQLITE_VERSION}."
            )

        print(f"SQLite binary at {binary_path} is executable. Version: {version}")
        return True

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
        client = get_client(remote_connection)
        is_sqlite_executable(client, remote_connection.sqliteBinaryPath)
    except Exception as e:
        raise RemoteSqliteException(message=str(e), status=ConnectionTestStates.FAILED)


def get_sqlite_path(connection: RemoteConnection):
    try:
        path = find_sqlite_binary(connection)
        if path:
            return path
    except Exception as e:
        raise RemoteSqliteException(message=str(e), status=ConnectionTestStates.FAILED)
