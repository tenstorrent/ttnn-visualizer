# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import json
import logging
import re
import time
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
    ssh_client = get_client(remote_connection)

    if "*" in file_path:
        command = f"ls -1 {file_path}"
        stdin, stdout, stderr = ssh_client.exec_command(command)
        files = stdout.read().decode().splitlines()
        ssh_client.close()

        if not files:
            raise FileNotFoundError(f"No files found matching pattern: {file_path}")

        # Return the first file found
        return files[0]

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


@remote_exception_handler
def sync_files_and_directories(
    client, remote_profiler_folder: str, destination_dir: Path, exclude_patterns=None, sid=None
):
    """Download files and directories sequentially in one unified loop."""
    exclude_patterns = (
        exclude_patterns or []
    )  # Default to an empty list if not provided

    with client.open_sftp() as sftp:
        # Ensure the destination directory exists
        destination_dir.mkdir(parents=True, exist_ok=True)
        finished_files = 0  # Initialize finished files counter

        # Recursively handle files and folders in the current directory
        def download_directory_contents(remote_dir, local_dir):
            # Ensure the local directory exists
            local_dir.mkdir(parents=True, exist_ok=True)

            # Get files and folders in the remote directory
            files, folders = walk_sftp_directory(sftp, remote_dir)
            total_files = len(files)

            # Function to download a file with progress reporting
            def download_file(remote_file_path, local_file_path, index):
                nonlocal finished_files
                # Download file with progress callback
                logger.info(f"Downloading {remote_file_path}")
                download_file_with_progress(
                    sftp,
                    remote_file_path,
                    local_file_path,
                    sid,
                    total_files,
                    finished_files,
                )
                logger.info(f"Finished downloading {remote_file_path}")
                finished_files += 1

            # Download all files in the current directory
            for index, file in enumerate(files, start=1):
                remote_file_path = f"{remote_dir}/{file}"
                local_file_path = Path(local_dir, file)

                # Skip files that match any exclusion pattern
                if is_excluded(remote_file_path, exclude_patterns):
                    logger.info(f"Skipping {remote_file_path} (excluded by pattern)")
                    continue

                download_file(remote_file_path, local_file_path, index)

            # Recursively handle subdirectories
            for folder in folders:
                remote_subdir = f"{remote_dir}/{folder}"
                local_subdir = local_dir / folder
                if is_excluded(remote_subdir, exclude_patterns):
                    logger.info(
                        f"Skipping directory {remote_subdir} (excluded by pattern)"
                    )
                    continue
                download_directory_contents(remote_subdir, local_subdir)

        # Start downloading from the root folder
        download_directory_contents(remote_profiler_folder, destination_dir)

        # Create a .last-synced file in directory
        update_last_synced(destination_dir)

        # Emit final status
        final_progress = FileProgress(
            current_file_name="",  # No specific file for the final status
            number_of_files=0,
            percent_of_current=100,
            finished_files=finished_files,
            status=FileStatus.FINISHED,
        )

        if current_app.config["USE_WEBSOCKETS"]:
            emit_file_status(final_progress, sid)
        logger.info("All files downloaded. Final progress emitted.")


def download_file_with_progress(
    sftp, remote_path, local_path, sid, total_files, finished_files
):
    """Download a file and emit progress using FileProgress."""
    try:

        def download_progress_callback(transferred, total):
            percent_of_current = (transferred / total) * 100
            progress = FileProgress(
                current_file_name=remote_path,
                number_of_files=total_files,
                percent_of_current=percent_of_current,
                finished_files=finished_files,
                status=FileStatus.DOWNLOADING,
            )
            emit_file_status(progress, sid)

        # Perform the download
        sftp.get(remote_path, str(local_path), callback=download_progress_callback)

    except OSError as e:
        logger.error(f"Error downloading file {remote_path} to {local_path}: {str(e)}")
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
    client = get_client(remote_connection)
    profiler_folder = Path(remote_folder_path).name
    destination_dir = Path(
        REPORT_DATA_DIRECTORY, path_prefix, remote_connection.host, current_app.config["PROFILER_DIRECTORY_NAME"], profiler_folder
    )
    destination_dir.mkdir(parents=True, exist_ok=True)

    sync_files_and_directories(
        client, remote_folder_path, destination_dir, exclude_patterns, sid
    )


@remote_exception_handler
def sync_remote_performance_folders(
    remote_connection: RemoteConnection,
    path_prefix: str,
    profile: RemoteReportFolder,
    exclude_patterns: Optional[List[str]] = None,
    sid=None,
):
    client = get_client(remote_connection)
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
        client, remote_folder_path, destination_dir, exclude_patterns, sid
    )
