# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import json
import logging
import re
import time
import subprocess
from pathlib import Path
from stat import S_ISDIR
from threading import Thread
from typing import List, Optional

from flask import current_app

from ttnn_visualizer.decorators import remote_exception_handler
from ttnn_visualizer.enums import ConnectionTestStates
from ttnn_visualizer.exceptions import (
    NoProjectsException,
    RemoteConnectionException,
    SSHException,
    AuthenticationException,
    NoValidConnectionsError
)
from ttnn_visualizer.models import RemoteConnection, RemoteReportFolder
from ttnn_visualizer.sockets import (
    FileProgress,
    FileStatus,
    emit_file_status,
)
from ttnn_visualizer.utils import update_last_synced

logger = logging.getLogger(__name__)

TEST_CONFIG_FILE = "config.json"
TEST_PROFILER_FILE = "profile_log_device.csv"
REPORT_DATA_DIRECTORY = Path(__file__).parent.absolute().joinpath("data")


def handle_ssh_subprocess_error(e: subprocess.CalledProcessError, remote_connection: RemoteConnection):
    """
    Convert subprocess SSH errors to appropriate SSH exceptions.

    :param e: The subprocess.CalledProcessError
    :param remote_connection: The RemoteConnection object for context
    :raises: SSHException, AuthenticationException, or NoValidConnectionsError
    """
    stderr = e.stderr.lower() if e.stderr else ""

    # Check for authentication failures
    if any(auth_err in stderr for auth_err in [
        "permission denied",
        "authentication failed",
        "publickey",
        "password",
        "host key verification failed"
    ]):
        raise AuthenticationException(f"SSH authentication failed: {e.stderr}")

    # Check for connection failures
    elif any(conn_err in stderr for conn_err in [
        "connection refused",
        "network is unreachable",
        "no route to host",
        "name or service not known",
        "connection timed out"
    ]):
        raise NoValidConnectionsError(f"SSH connection failed: {e.stderr}")

    # Check for general SSH protocol errors
    elif "ssh:" in stderr or "protocol" in stderr:
        raise SSHException(f"SSH protocol error: {e.stderr}")

    # Default to generic SSH exception
    else:
        raise SSHException(f"SSH command failed: {e.stderr}")


def start_background_task(task, *args):
    with current_app.app_context():
        if current_app.config["USE_WEBSOCKETS"]:
            with current_app.app_context():
                # Use SocketIO's background task mechanism if available
                from ttnn_visualizer.extensions import socketio

                socketio.start_background_task(task, *args)
        else:
            # Use a basic thread if WebSockets are not enabled
            thread = Thread(target=task, args=args)
            thread.start()


def resolve_file_path(remote_connection, file_path: str) -> str:
    """
    Resolve the file path if it contains a wildcard ('*') by using glob on the remote machine.

    :param remote_connection: A RemoteConnection object containing the remote connection information.
    :param file_path: The file path, which may include wildcards.
    :return: The resolved file path.
    :raises FileNotFoundError: If no files match the pattern.
    """
    if "*" in file_path:
        # Build SSH command to list files matching the pattern
        ssh_cmd = [
            "ssh",
            f"{remote_connection.username}@{remote_connection.host}",
        ]

        # Handle non-standard SSH port
        if remote_connection.port != 22:
            ssh_cmd.extend(["-p", str(remote_connection.port)])

        # Add the ls command
        ssh_cmd.append(f"ls -1 {file_path}")

        try:
            result = subprocess.run(
                ssh_cmd,
                capture_output=True,
                text=True,
                check=True
            )

            files = result.stdout.strip().splitlines()

            if not files or (len(files) == 1 and files[0] == ""):
                raise FileNotFoundError(f"No files found matching pattern: {file_path}")

            # Return the first file found
            return files[0]

        except subprocess.CalledProcessError as e:
            logger.error(f"SSH command failed: {e}")
            logger.error(f"stderr: {e.stderr}")

            # Check if it's an SSH-specific error (authentication, connection, etc.)
            if e.returncode == 255:  # SSH returns 255 for SSH protocol errors
                handle_ssh_subprocess_error(e, remote_connection)
            else:
                # File not found or other command error
                raise FileNotFoundError(f"No files found matching pattern: {file_path}")
        except Exception as e:
            logger.error(f"Error resolving file path: {e}")
            raise FileNotFoundError(f"Error resolving file path: {file_path}")

    return file_path



def get_cluster_desc_path(remote_connection: RemoteConnection) -> Optional[str]:
    """
    List all folders matching '/tmp/umd_*' on the remote machine, filter for those containing
    'cluster_descriptor.yaml', and return the full path to the most recently modified YAML file.

    :param remote_connection: RemoteConnection object containing SSH connection details.
    :return: Full path to the most recently modified 'cluster_descriptor.yaml' file, or None.
    """
    latest_yaml_path = None
    latest_mod_time = 0
    cluster_desc_file = "cluster_descriptor.yaml"

    try:
        # Build SSH command to list folders matching '/tmp/umd_*'
        ssh_cmd = [
            "ssh",
            f"{remote_connection.username}@{remote_connection.host}",
        ]

        # Handle non-standard SSH port
        if remote_connection.port != 22:
            ssh_cmd.extend(["-p", str(remote_connection.port)])

        # Add the ls command
        ssh_cmd.append("ls -1d /tmp/umd_* 2>/dev/null")

        # Execute SSH command to list folders
        result = subprocess.run(
            ssh_cmd,
            capture_output=True,
            text=True,
            check=False  # Don't raise exception on non-zero exit (in case no folders found)
        )

        # Get the list of folders
        folder_paths = result.stdout.strip().splitlines() if result.stdout.strip() else []

        if not folder_paths:
            logger.info("No folders found matching the pattern '/tmp/umd_*'")
            return None

        # Check each folder for 'cluster_descriptor.yaml' and track the most recent one
        for folder in folder_paths:
            yaml_file_path = f"{folder}/{cluster_desc_file}"

            # Build SSH command to check if file exists and get its modification time
            stat_cmd = [
                "ssh",
                f"{remote_connection.username}@{remote_connection.host}",
            ]

            if remote_connection.port != 22:
                stat_cmd.extend(["-p", str(remote_connection.port)])

            # Use stat to get modification time (seconds since epoch)
            stat_cmd.append(f"stat -c %Y '{yaml_file_path}' 2>/dev/null")

            try:
                stat_result = subprocess.run(
                    stat_cmd,
                    capture_output=True,
                    text=True,
                    check=True
                )

                mod_time = float(stat_result.stdout.strip())

                # Update the latest file if this one is newer
                if mod_time > latest_mod_time:
                    latest_mod_time = mod_time
                    latest_yaml_path = yaml_file_path
                    logger.info(
                        f"Found newer {cluster_desc_file}: {yaml_file_path}"
                    )

            except subprocess.CalledProcessError as e:
                # Check if it's an SSH-specific error
                if e.returncode == 255:  # SSH returns 255 for SSH protocol errors
                    handle_ssh_subprocess_error(e, remote_connection)
                else:
                    # File not found or other command error
                    logger.debug(f"'{cluster_desc_file}' not found in: {folder}")
                    continue
            except ValueError:
                logger.debug(f"'{cluster_desc_file}' not found in: {folder}")
                continue

        if latest_yaml_path:
            logger.info(
                f"Most recently modified {cluster_desc_file}: {latest_yaml_path}"
            )
        else:
            logger.info(
                f"No {cluster_desc_file} files found in any '/tmp/umd_*' folders"
            )
        return latest_yaml_path

    except Exception as e:
        logger.error(f"Error retrieving {cluster_desc_file} path: {e}")
        raise RemoteConnectionException(
            message=f"Failed to get '{cluster_desc_file}' path",
            status=ConnectionTestStates.FAILED,
        )


@remote_exception_handler
def get_cluster_desc(remote_connection: RemoteConnection):
    cluster_path = get_cluster_desc_path(remote_connection)
    if cluster_path:
        return read_remote_file(remote_connection, cluster_path)
    else:
        return None


def is_excluded(file_path, exclude_patterns):
    """Check if a file path should be excluded based on patterns."""
    for pattern in exclude_patterns:
        if pattern in file_path:
            return True
    return False


@remote_exception_handler
def sync_files_and_directories(
    remote_connection: RemoteConnection, remote_profiler_folder: str, destination_dir: Path, exclude_patterns=None, sid=None
):
    """Download files and directories using SFTP with progress reporting."""
    exclude_patterns = exclude_patterns or []

    # Ensure the destination directory exists
    destination_dir.mkdir(parents=True, exist_ok=True)

    logger.info(f"Starting SFTP sync from {remote_profiler_folder} to {destination_dir}")

    # First, get list of all files and directories
    logger.info("Getting remote file and directory lists...")
    all_files = get_remote_file_list(remote_connection, remote_profiler_folder, exclude_patterns)
    all_dirs = get_remote_directory_list(remote_connection, remote_profiler_folder, exclude_patterns)

    logger.info(f"Found {len(all_files)} files and {len(all_dirs)} directories to sync")

    # Create local directory structure
    logger.info("Creating local directory structure...")
    for remote_dir in all_dirs:
        try:
            # Calculate relative path from the base remote folder
            relative_path = Path(remote_dir).relative_to(remote_profiler_folder)
            local_dir = destination_dir / relative_path
            local_dir.mkdir(parents=True, exist_ok=True)
        except ValueError:
            # Skip if remote_dir is not relative to remote_profiler_folder
            continue

    # Download files with progress reporting
    total_files = len(all_files)
    finished_files = 0

    logger.info(f"Starting download of {total_files} files...")

    for remote_file in all_files:
        try:
            # Calculate relative path from the base remote folder
            relative_path = Path(remote_file).relative_to(remote_profiler_folder)
            local_file = destination_dir / relative_path

            # Download the file using SFTP
            download_single_file_sftp(remote_connection, remote_file, local_file)

            finished_files += 1

            # Emit progress
            progress = FileProgress(
                current_file_name=str(relative_path),
                number_of_files=total_files,
                percent_of_current=100,  # We don't get per-file progress with SFTP
                finished_files=finished_files,
                status=FileStatus.DOWNLOADING,
            )

            if current_app.config["USE_WEBSOCKETS"]:
                emit_file_status(progress, sid)

            if finished_files % 10 == 0:  # Log every 10 files
                logger.info(f"Downloaded {finished_files}/{total_files} files")

        except ValueError:
            # Skip if remote_file is not relative to remote_profiler_folder
            logger.warning(f"Skipping file outside base folder: {remote_file}")
            continue
        except Exception as e:
            logger.error(f"Failed to download {remote_file}: {e}")
            # Continue with other files rather than failing completely
            continue

    # Create a .last-synced file in directory
    update_last_synced(destination_dir)

    # Emit final status
    final_progress = FileProgress(
        current_file_name="",
        number_of_files=total_files,
        percent_of_current=100,
        finished_files=finished_files,
        status=FileStatus.FINISHED,
    )

    if current_app.config["USE_WEBSOCKETS"]:
        emit_file_status(final_progress, sid)

    logger.info(f"SFTP sync completed. Downloaded {finished_files}/{total_files} files.")


def get_remote_file_list(remote_connection: RemoteConnection, remote_folder: str, exclude_patterns=None) -> List[str]:
    """Get a list of all files in the remote directory recursively, applying exclusion patterns."""
    exclude_patterns = exclude_patterns or []

    # Build SSH command to find all files recursively
    ssh_cmd = ["ssh"]

    # Handle non-standard SSH port
    if remote_connection.port != 22:
        ssh_cmd.extend(["-p", str(remote_connection.port)])

    ssh_cmd.extend([
        f"{remote_connection.username}@{remote_connection.host}",
        f"find '{remote_folder}' -type f"
    ])

    try:
        result = subprocess.run(
            ssh_cmd,
            capture_output=True,
            text=True,
            check=True,
            timeout=60
        )

        all_files = result.stdout.strip().splitlines()

        # Filter out excluded files
        filtered_files = []
        for file_path in all_files:
            if not is_excluded(file_path, exclude_patterns):
                filtered_files.append(file_path.strip())

        return filtered_files

    except subprocess.CalledProcessError as e:
        if e.returncode == 255:  # SSH protocol errors
            handle_ssh_subprocess_error(e, remote_connection)
            return []
        else:
            logger.error(f"Error getting file list: {e.stderr}")
            return []
    except subprocess.TimeoutExpired:
        logger.error(f"Timeout getting file list from: {remote_folder}")
        return []
    except Exception as e:
        logger.error(f"Error getting file list: {e}")
        return []


def get_remote_directory_list(remote_connection: RemoteConnection, remote_folder: str, exclude_patterns=None) -> List[str]:
    """Get a list of all directories in the remote directory recursively, applying exclusion patterns."""
    exclude_patterns = exclude_patterns or []

    # Build SSH command to find all directories recursively
    ssh_cmd = ["ssh"]

    # Handle non-standard SSH port
    if remote_connection.port != 22:
        ssh_cmd.extend(["-p", str(remote_connection.port)])

    ssh_cmd.extend([
        f"{remote_connection.username}@{remote_connection.host}",
        f"find '{remote_folder}' -type d"
    ])

    try:
        result = subprocess.run(
            ssh_cmd,
            capture_output=True,
            text=True,
            check=True,
            timeout=60
        )

        all_dirs = result.stdout.strip().splitlines()

        # Filter out excluded directories
        filtered_dirs = []
        for dir_path in all_dirs:
            if not is_excluded(dir_path, exclude_patterns):
                filtered_dirs.append(dir_path.strip())

        return filtered_dirs

    except subprocess.CalledProcessError as e:
        if e.returncode == 255:  # SSH protocol errors
            handle_ssh_subprocess_error(e, remote_connection)
            return []
        else:
            logger.error(f"Error getting directory list: {e.stderr}")
            return []
    except subprocess.TimeoutExpired:
        logger.error(f"Timeout getting directory list from: {remote_folder}")
        return []
    except Exception as e:
        logger.error(f"Error getting directory list: {e}")
        return []


def download_single_file_sftp(remote_connection: RemoteConnection, remote_file: str, local_file: Path):
    """Download a single file using SFTP."""
    # Ensure local directory exists
    local_file.parent.mkdir(parents=True, exist_ok=True)

    # Build SFTP command
    sftp_cmd = ["sftp"]

    # Handle non-standard SSH port
    if remote_connection.port != 22:
        sftp_cmd.extend(["-P", str(remote_connection.port)])

    # Add batch mode and other options
    sftp_cmd.extend([
        "-b", "-",  # Read commands from stdin
        f"{remote_connection.username}@{remote_connection.host}"
    ])

    # SFTP commands to execute
    sftp_commands = f"get '{remote_file}' '{local_file}'\nquit\n"

    try:
        result = subprocess.run(
            sftp_cmd,
            input=sftp_commands,
            capture_output=True,
            text=True,
            check=True,
            timeout=300  # 5 minute timeout per file
        )

        logger.debug(f"Downloaded: {remote_file} -> {local_file}")

    except subprocess.CalledProcessError as e:
        if e.returncode == 255:  # SSH protocol errors
            handle_ssh_subprocess_error(e, remote_connection)
        else:
            logger.error(f"Error downloading file {remote_file}: {e.stderr}")
            raise RuntimeError(f"Failed to download {remote_file}")
    except subprocess.TimeoutExpired:
        logger.error(f"Timeout downloading file: {remote_file}")
        raise RuntimeError(f"Timeout downloading {remote_file}")
    except Exception as e:
        logger.error(f"Error downloading file {remote_file}: {e}")
        raise RuntimeError(f"Failed to download {remote_file}")


def get_remote_profiler_folder_from_config_path(
    remote_connection: RemoteConnection, config_path: str
) -> RemoteReportFolder:
    """Read a remote config file and return RemoteFolder object."""
    try:
        # Build SSH command to get file modification time
        stat_cmd = [
            "ssh",
            f"{remote_connection.username}@{remote_connection.host}",
        ]

        # Handle non-standard SSH port
        if remote_connection.port != 22:
            stat_cmd.extend(["-p", str(remote_connection.port)])

        # Get modification time using stat command
        stat_cmd.append(f"stat -c %Y '{config_path}' 2>/dev/null")

        stat_result = subprocess.run(
            stat_cmd,
            capture_output=True,
            text=True,
            check=True
        )

        last_modified = int(float(stat_result.stdout.strip()))

        # Build SSH command to read file content
        cat_cmd = [
            "ssh",
            f"{remote_connection.username}@{remote_connection.host}",
        ]

        if remote_connection.port != 22:
            cat_cmd.extend(["-p", str(remote_connection.port)])

        # Read file content using cat command
        cat_cmd.append(f"cat '{config_path}'")

        cat_result = subprocess.run(
            cat_cmd,
            capture_output=True,
            text=True,
            check=True
        )

        # Parse JSON data
        data = json.loads(cat_result.stdout)
        report_name = data.get("report_name")
        logger.info(f"********* report_name: {report_name}")

        return RemoteReportFolder(
            remotePath=str(Path(config_path).parent),
            reportName=report_name,
            lastModified=last_modified,
        )

    except subprocess.CalledProcessError as e:
        logger.error(f"SSH command failed while reading config: {e}")
        logger.error(f"stderr: {e.stderr}")

        # Check if it's an SSH-specific error (authentication, connection, etc.)
        if e.returncode == 255:  # SSH returns 255 for SSH protocol errors
            handle_ssh_subprocess_error(e, remote_connection)
            # This line never executes as handle_ssh_subprocess_error raises an exception
            return RemoteReportFolder(
                remotePath=str(Path(config_path).parent),
                reportName="",
                lastModified=int(time.time()),
            )
        else:
            # Fall back to current time if we can't get modification time
            return RemoteReportFolder(
                remotePath=str(Path(config_path).parent),
                reportName="",
                lastModified=int(time.time()),
            )
    except (json.JSONDecodeError, ValueError) as e:
        logger.error(f"Error parsing config file {config_path}: {e}")
        # Fall back to current time and no report name
        return RemoteReportFolder(
            remotePath=str(Path(config_path).parent),
            reportName="",
            lastModified=int(time.time()),
        )


def get_remote_performance_folder(
    remote_connection: RemoteConnection, profile_folder: str
) -> RemoteReportFolder:
    """Get remote performance folder info and return RemoteFolder object."""
    performance_name = profile_folder.split("/")[-1]
    remote_path = profile_folder

    # Get modification time using subprocess SSH command
    try:
        ssh_command = ["ssh"]
        if remote_connection.port != 22:
            ssh_command.extend(["-p", str(remote_connection.port)])
        ssh_command.extend([f"{remote_connection.username}@{remote_connection.host}", f"stat -c %Y '{profile_folder}'"])

        result = subprocess.run(ssh_command, capture_output=True, text=True, timeout=30)

        if result.returncode == 0:
            last_modified = int(result.stdout.strip())
        else:
            # If stat fails, handle SSH errors
            if result.returncode == 255:
                handle_ssh_subprocess_error(subprocess.CalledProcessError(result.returncode, ssh_command, result.stdout, result.stderr), remote_connection)
            logger.warning(f"Could not get modification time for {profile_folder}, using current time")
            last_modified = int(time.time())
    except (subprocess.TimeoutExpired, subprocess.CalledProcessError, ValueError) as e:
        logger.warning(f"Error getting modification time for {profile_folder}: {e}, using current time")
        last_modified = int(time.time())

    return RemoteReportFolder(
        remotePath=str(remote_path),
        reportName=str(performance_name),
        lastModified=last_modified,
    )


@remote_exception_handler
def read_remote_file(
    remote_connection,
    remote_path=None,
):
    """Read a remote file using SSH cat command."""
    if remote_path:
        path = Path(remote_path)
    else:
        path = Path(remote_connection.profilerPath)

    logger.info(f"Reading remote file {path}")

    # Build SSH command to read the file
    ssh_cmd = ["ssh"]

    # Handle non-standard SSH port
    if remote_connection.port != 22:
        ssh_cmd.extend(["-p", str(remote_connection.port)])

    ssh_cmd.extend([
        f"{remote_connection.username}@{remote_connection.host}",
        f"cat '{path}'"
    ])

    try:
        result = subprocess.run(
            ssh_cmd,
            capture_output=True,
            check=True,
            timeout=30
        )
        return result.stdout
    except subprocess.CalledProcessError as e:
        if e.returncode == 255:  # SSH protocol errors
            handle_ssh_subprocess_error(e, remote_connection)
            return None
        else:
            # File not found or other command error
            logger.error(f"File not found or cannot be read: {path}")
            return None
    except subprocess.TimeoutExpired:
        logger.error(f"Timeout reading remote file: {path}")
        return None
    except Exception as e:
        logger.error(f"Error reading remote file {path}: {e}")
        return None


@remote_exception_handler
def check_remote_path_for_reports(remote_connection):
    """Check the remote path for config files."""
    remote_config_paths = find_folders_by_files(
        remote_connection, remote_connection.profilerPath, [TEST_CONFIG_FILE]
    )
    if not remote_config_paths:
        raise NoProjectsException(
            message="No projects found at path", status=ConnectionTestStates.FAILED
        )
    return True


@remote_exception_handler
def check_remote_path_exists(remote_connection: RemoteConnection, path_key: str):
    """Check if a remote path exists using SSH test command."""
    path = getattr(remote_connection, path_key)

    # Build SSH command to test if path exists
    ssh_cmd = ["ssh"]

    # Handle non-standard SSH port
    if remote_connection.port != 22:
        ssh_cmd.extend(["-p", str(remote_connection.port)])

    ssh_cmd.extend([
        f"{remote_connection.username}@{remote_connection.host}",
        f"test -d '{path}'"
    ])

    try:
        result = subprocess.run(
            ssh_cmd,
            capture_output=True,
            check=True,
            timeout=10
        )
        # If command succeeds, directory exists
        return True
    except subprocess.CalledProcessError as e:
        if e.returncode == 255:  # SSH protocol errors
            handle_ssh_subprocess_error(e, remote_connection)
        else:
            # Directory does not exist or is inaccessible
            if path_key == "performancePath":
                message = "Performance directory does not exist or cannot be accessed"
            else:
                message = "Profiler directory does not exist or cannot be accessed"

            logger.error(message)
            raise RemoteConnectionException(
                message=message, status=ConnectionTestStates.FAILED
            )
    except subprocess.TimeoutExpired:
        logger.error(f"Timeout checking remote path: {path}")
        raise RemoteConnectionException(
            message=f"Timeout checking remote path: {path}",
            status=ConnectionTestStates.FAILED
        )


def find_folders_by_files(
    remote_connection: RemoteConnection, root_folder: str, file_names: List[str]
) -> List[str]:
    """Given a remote path, return a list of top-level folders that contain any of the specified files."""
    matched_folders: List[str] = []

    # Build SSH command to find directories in root_folder
    ssh_cmd = ["ssh"]

    # Handle non-standard SSH port
    if remote_connection.port != 22:
        ssh_cmd.extend(["-p", str(remote_connection.port)])

    ssh_cmd.extend([
        f"{remote_connection.username}@{remote_connection.host}",
        f"find '{root_folder}' -maxdepth 1 -type d -not -path '{root_folder}'"
    ])

    try:
        result = subprocess.run(
            ssh_cmd,
            capture_output=True,
            text=True,
            check=True,
            timeout=30
        )

        directories = result.stdout.strip().splitlines()

        # For each directory, check if it contains any of the specified files
        for directory in directories:
            directory = directory.strip()
            if not directory:
                continue

            # Build SSH command to check for files in this directory
            file_checks = []
            for file_name in file_names:
                file_checks.append(f"test -f '{directory}/{file_name}'")

            # Use OR logic to check if any of the files exist
            check_cmd = ["ssh"]
            if remote_connection.port != 22:
                check_cmd.extend(["-p", str(remote_connection.port)])

            check_cmd.extend([
                f"{remote_connection.username}@{remote_connection.host}",
                f"({' || '.join(file_checks)})"
            ])

            try:
                check_result = subprocess.run(
                    check_cmd,
                    capture_output=True,
                    check=True,
                    timeout=10
                )
                # If command succeeds, at least one file exists
                matched_folders.append(directory)
            except subprocess.CalledProcessError:
                # None of the files exist in this directory, skip it
                continue

        return matched_folders

    except subprocess.CalledProcessError as e:
        if e.returncode == 255:  # SSH protocol errors
            handle_ssh_subprocess_error(e, remote_connection)
            # This line should never be reached as handle_ssh_subprocess_error raises an exception
            return []
        else:
            logger.error(f"Error finding folders: {e.stderr}")
            return []
    except subprocess.TimeoutExpired:
        logger.error(f"Timeout finding folders in: {root_folder}")
        return []
    except Exception as e:
        logger.error(f"Error finding folders: {e}")
        return []


@remote_exception_handler
def get_remote_performance_folders(
    remote_connection: RemoteConnection,
) -> List[RemoteReportFolder]:
    """Return a list of remote folders containing a profile_log_device file."""
    if remote_connection.performancePath is None:
        error = "Performance path is not configured for this connection"
        logger.error(error)
        raise NoProjectsException(status=ConnectionTestStates.FAILED, message=error)

    performance_paths = find_folders_by_files(
        remote_connection, remote_connection.performancePath, [TEST_PROFILER_FILE]
    )
    if not performance_paths:
        error = f"No profiler paths found at {remote_connection.performancePath}"
        logger.info(error)
        raise NoProjectsException(status=ConnectionTestStates.FAILED, message=error)
    remote_folder_data = []
    for path in performance_paths:
        remote_folder_data.append(get_remote_performance_folder(remote_connection, path))
    return remote_folder_data


@remote_exception_handler
def get_remote_profiler_folders(
    remote_connection: RemoteConnection,
) -> List[RemoteReportFolder]:
    """Return a list of remote folders containing a config.json file."""
    remote_config_paths = find_folders_by_files(
        remote_connection, remote_connection.profilerPath, [TEST_CONFIG_FILE]
    )
    if not remote_config_paths:
        error = f"No projects found at {remote_connection.profilerPath}"
        logger.info(error)
        raise NoProjectsException(status=ConnectionTestStates.FAILED, message=error)
    remote_folder_data = []
    for config_path in remote_config_paths:
        remote_folder = get_remote_profiler_folder_from_config_path(
            remote_connection, str(Path(config_path).joinpath(TEST_CONFIG_FILE))
        )
        remote_folder_data.append(remote_folder)
    return remote_folder_data


@remote_exception_handler
def sync_remote_profiler_folders(
    remote_connection: RemoteConnection,
    remote_folder_path: str,
    path_prefix: str,
    exclude_patterns: Optional[List[str]] = None,
    sid=None,
):
    """Main function to sync test folders, handles both compressed and individual syncs."""
    profiler_folder = Path(remote_folder_path).name
    destination_dir = Path(
        REPORT_DATA_DIRECTORY, path_prefix, remote_connection.host, current_app.config["PROFILER_DIRECTORY_NAME"], profiler_folder
    )
    destination_dir.mkdir(parents=True, exist_ok=True)

    sync_files_and_directories(
        remote_connection, remote_folder_path, destination_dir, exclude_patterns, sid
    )


@remote_exception_handler
def sync_remote_performance_folders(
    remote_connection: RemoteConnection,
    path_prefix: str,
    profile: RemoteReportFolder,
    exclude_patterns: Optional[List[str]] = None,
    sid=None,
):
    remote_folder_path = profile.remotePath
    profile_folder = Path(remote_folder_path).name
    destination_dir = Path(
        REPORT_DATA_DIRECTORY,
        path_prefix,
        remote_connection.host,
        current_app.config["PERFORMANCE_DIRECTORY_NAME"],
        profile_folder,
    )
    destination_dir.mkdir(parents=True, exist_ok=True)
    sync_files_and_directories(
        remote_connection, remote_folder_path, destination_dir, exclude_patterns, sid
    )
