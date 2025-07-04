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
from paramiko.client import SSHClient
from paramiko.sftp_client import SFTPClient

from ttnn_visualizer.decorators import remote_exception_handler
from ttnn_visualizer.enums import ConnectionTestStates
from ttnn_visualizer.exceptions import NoProjectsException, RemoteConnectionException
from ttnn_visualizer.models import RemoteConnection, RemoteReportFolder
from ttnn_visualizer.sockets import (
    FileProgress,
    FileStatus,
    emit_file_status,
)
from ttnn_visualizer.ssh_client import get_client
from ttnn_visualizer.utils import update_last_synced

logger = logging.getLogger(__name__)

TEST_CONFIG_FILE = "config.json"
TEST_PROFILER_FILE = "profile_log_device.csv"
REPORT_DATA_DIRECTORY = Path(__file__).parent.absolute().joinpath("data")


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
            raise FileNotFoundError(f"No files found matching pattern: {file_path}")
        except Exception as e:
            logger.error(f"Error resolving file path: {e}")
            raise FileNotFoundError(f"Error resolving file path: {file_path}")

    return file_path


def calculate_folder_size(client: SSHClient, folder_path: str) -> int:
    """Calculate the total size of the folder before compression."""
    stdin, stdout, stderr = client.exec_command(f"du -sb {folder_path}")
    size_info = stdout.read().decode().strip().split("\t")[0]
    return int(size_info)


def get_cluster_desc_path(ssh_client) -> Optional[str]:
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
        # Command to list all folders matching '/tmp/umd_*'
        list_folders_command = "ls -1d /tmp/umd_* 2>/dev/null"
        stdin, stdout, stderr = ssh_client.exec_command(list_folders_command)

        # Get the list of folders
        folder_paths = stdout.read().decode().splitlines()

        if not folder_paths:
            logger.info("No folders found matching the pattern '/tmp/umd_*'")
            return None

        # Check each folder for 'cluster_descriptor.yaml' and track the most recent one
        with ssh_client.open_sftp() as sftp:
            for folder in folder_paths:
                yaml_file_path = f"{folder}/{cluster_desc_file}"
                try:
                    # Check if 'cluster_descriptor.yaml' exists and get its modification time
                    attributes = sftp.stat(yaml_file_path)
                    mod_time = attributes.st_mtime  # Modification time

                    # Update the latest file if this one is newer
                    if mod_time > latest_mod_time:
                        latest_mod_time = mod_time
                        latest_yaml_path = yaml_file_path
                        logger.info(
                            f"Found newer {cluster_desc_file}': {yaml_file_path}"
                        )

                except FileNotFoundError:
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
    finally:
        ssh_client.close()


@remote_exception_handler
def get_cluster_desc(remote_connection: RemoteConnection):
    client = get_client(remote_connection)
    cluster_path = get_cluster_desc_path(client)
    if cluster_path:
        return read_remote_file(remote_connection, cluster_path)
    else:
        return None


def walk_sftp_directory(sftp: SFTPClient, remote_path: str):
    """SFTP implementation of os.walk."""
    files, folders = [], []
    for f in sftp.listdir_attr(remote_path):
        if S_ISDIR(f.st_mode if f.st_mode else 0):
            folders.append(f.filename)
        else:
            files.append(f.filename)
    return files, folders


def is_excluded(file_path, exclude_patterns):
    """Check if the file matches any exclusion pattern."""
    return any(re.search(pattern, file_path) for pattern in exclude_patterns)


def parse_rsync_progress(line):
    """Parse rsync progress output and extract file info and progress percentage."""
    # rsync progress line format: "filename\n    transferred/total bytes  XX%  speed  time_remaining"
    # Example: "     32,768  10%  123.45kB/s    0:00:02"

    # Check for file transfer progress (contains percentage)
    if "%" in line and any(char.isdigit() for char in line):
        # Extract percentage
        percent_match = re.search(r'(\d+)%', line)
        if percent_match:
            return float(percent_match.group(1))

    return None


def parse_rsync_file_info(line):
    """Extract current file being transferred from rsync output."""
    # rsync outputs the filename, often followed by progress info on the next line
    # Skip lines that are just progress info (start with spaces and contain numbers/%)
    if line.strip() and not line.startswith(' ') and not '%' in line:
        # This is likely a filename
        return line.strip()
    return None


@remote_exception_handler
def sync_files_and_directories(
    remote_connection: RemoteConnection, remote_profiler_folder: str, destination_dir: Path, exclude_patterns=None, sid=None
):
    """Download files and directories using rsync with progress reporting."""
    exclude_patterns = exclude_patterns or []

    # Ensure the destination directory exists
    destination_dir.mkdir(parents=True, exist_ok=True)

    # Build rsync command
    cmd = [
        "rsync",
        "-avz",           # archive mode, verbose, compress
        "--progress",     # show progress for each file
        "--human-readable",  # human readable output
    ]

    # Add exclude patterns
    for pattern in exclude_patterns:
        cmd.extend(["--exclude", pattern])

    # Build source and destination
    source = f"{remote_connection.username}@{remote_connection.host}:{remote_profiler_folder}/"
    cmd.extend([source, str(destination_dir)])

    # Handle non-standard SSH port
    if remote_connection.port != 22:
        cmd.extend(["-e", f"ssh -p {remote_connection.port}"])

    logger.info(f"Starting rsync with command: {' '.join(cmd)}")

    # Execute rsync with progress monitoring
    sync_with_rsync_progress(cmd, sid)

    # Create a .last-synced file in directory
    update_last_synced(destination_dir)

    # Emit final status
    final_progress = FileProgress(
        current_file_name="",
        number_of_files=0,
        percent_of_current=100,
        finished_files=0,
        status=FileStatus.FINISHED,
    )

    if current_app.config["USE_WEBSOCKETS"]:
        emit_file_status(final_progress, sid)
    logger.info("rsync completed. Final progress emitted.")


def sync_with_rsync_progress(cmd, sid):
    """Execute rsync and parse progress output for websocket updates."""
    try:
        # Start rsync process
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            universal_newlines=True
        )

        current_file = ""
        finished_files = 0

        # Read output line by line
        if process.stdout:
            for line in process.stdout:
                if line.strip():
                    logger.debug(f"rsync output: {line.strip()}")

                # Check if this is a filename
                filename = parse_rsync_file_info(line)
                if filename:
                    current_file = filename
                    logger.info(f"Started transferring: {current_file}")

                # Check for progress percentage
                progress_percent = parse_rsync_progress(line)
                if progress_percent is not None and current_file:
                    # Emit progress update
                    progress = FileProgress(
                        current_file_name=current_file,
                        number_of_files=0,  # rsync doesn't give us total count upfront
                        percent_of_current=progress_percent,
                        finished_files=finished_files,
                        status=FileStatus.DOWNLOADING,
                    )

                    if current_app.config["USE_WEBSOCKETS"]:
                        emit_file_status(progress, sid)

                    # If we reached 100%, increment finished files
                    if progress_percent >= 100:
                        finished_files += 1
                        logger.info(f"Finished transferring: {current_file}")

        # Wait for process to complete
        return_code = process.wait()

        if return_code != 0:
            logger.error(f"rsync failed with return code {return_code}")
            raise subprocess.CalledProcessError(return_code, cmd)

        logger.info("rsync completed successfully")

    except subprocess.CalledProcessError as e:
        logger.error(f"rsync command failed: {e}")
        raise
    except Exception as e:
        logger.error(f"Error during rsync execution: {e}")
        raise


def get_remote_profiler_folder_from_config_path(
    sftp: SFTPClient, config_path: str
) -> RemoteReportFolder:
    """Read a remote config file and return RemoteFolder object."""
    attributes = sftp.lstat(str(config_path))
    with sftp.open(str(config_path), "rb") as config_file:
        data = json.loads(config_file.read())

        report_name = data.get("report_name")
        logger.info(f"********* report_name: {report_name}")

        return RemoteReportFolder(
            remotePath=str(Path(config_path).parent),
            reportName=report_name,
            lastModified=(
                int(attributes.st_mtime) if attributes.st_mtime else int(time.time())
            ),
        )


def get_remote_performance_folder(
    sftp: SFTPClient, profile_folder: str
) -> RemoteReportFolder:
    """Read a remote config file and return RemoteFolder object."""
    attributes = sftp.stat(str(profile_folder))
    performance_name = profile_folder.split("/")[-1]
    remote_path = profile_folder
    last_modified = (
        int(attributes.st_mtime) if attributes.st_mtime else int(time.time())
    )
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
    """Read a remote file."""
    ssh_client = get_client(remote_connection)
    with ssh_client.open_sftp() as sftp:
        if remote_path:
            path = Path(remote_path)
        else:
            path = Path(remote_connection.profilerPath)

        logger.info(f"Opening remote file {path}")
        directory_path = str(path.parent)
        file_name = str(path.name)

        try:
            sftp.chdir(path=directory_path)
            with sftp.open(filename=file_name) as file:
                content = file.read()
                return content
        except FileNotFoundError:
            logger.error(f"File not found: {path}")
            return None
        except IOError as e:
            logger.error(f"Error reading remote file {path}: {e}")
            return None


@remote_exception_handler
def check_remote_path_for_reports(remote_connection):
    """Check the remote path for config files."""
    ssh_client = get_client(remote_connection)
    remote_config_paths = find_folders_by_files(
        ssh_client, remote_connection.profilerPath, [TEST_CONFIG_FILE]
    )
    if not remote_config_paths:
        raise NoProjectsException(
            message="No projects found at path", status=ConnectionTestStates.FAILED
        )
    return True


@remote_exception_handler
def check_remote_path_exists(remote_connection: RemoteConnection, path_key: str):
    client = get_client(remote_connection)
    sftp = client.open_sftp()
    # Attempt to list the directory to see if it exists
    try:
        sftp.stat(getattr(remote_connection, path_key))
    except IOError as e:
        # Directory does not exist or is inaccessible
        if path_key == "performancePath":
            message = "Performance directory does not exist or cannot be accessed"
        else:
            message = "Profiler directory does not exist or cannot be accessed"

        logger.error(message)
        raise RemoteConnectionException(
            message=message, status=ConnectionTestStates.FAILED
        )


def find_folders_by_files(
    ssh_client, root_folder: str, file_names: List[str]
) -> List[str]:
    """Given a remote path, return a list of top-level folders that contain any of the specified files."""
    matched_folders: List[str] = []
    with ssh_client.open_sftp() as sftp:
        all_files = sftp.listdir_attr(root_folder)
        top_level_directories = filter(lambda e: S_ISDIR(e.st_mode), all_files)

        for directory in top_level_directories:
            dirname = Path(root_folder, directory.filename)
            directory_files = sftp.listdir(str(dirname))

            # Check if any of the specified file names exist in the directory
            if any(file_name in directory_files for file_name in file_names):
                matched_folders.append(str(dirname))

    return matched_folders


@remote_exception_handler
def get_remote_performance_folders(
    remote_connection: RemoteConnection,
) -> List[RemoteReportFolder]:
    """Return a list of remote folders containing a profile_log_device file."""
    client = get_client(remote_connection)
    performance_paths = find_folders_by_files(
        client, remote_connection.performancePath, [TEST_PROFILER_FILE]
    )
    if not performance_paths:
        error = f"No profiler paths found at {remote_connection.performancePath}"
        logger.info(error)
        raise NoProjectsException(status=ConnectionTestStates.FAILED, message=error)
    remote_folder_data = []
    with client.open_sftp() as sftp:
        for path in performance_paths:
            remote_folder_data.append(get_remote_performance_folder(sftp, path))
        return remote_folder_data


@remote_exception_handler
def get_remote_profiler_folders(
    remote_connection: RemoteConnection,
) -> List[RemoteReportFolder]:
    """Return a list of remote folders containing a config.json file."""
    client = get_client(remote_connection)
    remote_config_paths = find_folders_by_files(
        client, remote_connection.profilerPath, [TEST_CONFIG_FILE]
    )
    if not remote_config_paths:
        error = f"No projects found at {remote_connection.profilerPath}"
        logger.info(error)
        raise NoProjectsException(status=ConnectionTestStates.FAILED, message=error)
    remote_folder_data = []
    with client.open_sftp() as sftp:
        for config_path in remote_config_paths:
            remote_folder = get_remote_profiler_folder_from_config_path(
                sftp, str(Path(config_path).joinpath(TEST_CONFIG_FILE))
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
