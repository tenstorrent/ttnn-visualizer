import json
import os
from pathlib import Path
import tarfile
from stat import S_ISDIR
from typing import List

from paramiko.client import SSHClient
from paramiko.sftp_client import SFTPClient
import logging
from ttnn_visualizer.decorators import remote_exception_handler
from ttnn_visualizer.exceptions import NoProjectsException
from ttnn_visualizer.models import RemoteConnection, RemoteFolder
from ttnn_visualizer.ssh_client import check_gzip_exists, check_permissions, get_client

logger = logging.getLogger(__name__)

TEST_CONFIG_FILE = "config.json"
REPORT_DATA_DIRECTORY = Path(__file__).parent.absolute().joinpath("data")


@remote_exception_handler
def read_remote_file(remote_connection):
    logger.info(f"Opening remote file {remote_connection.path}")
    ssh_client = get_client(remote_connection)
    with ssh_client.open_sftp() as sftp:
        path = Path(remote_connection.path)
        directory_path = str(path.parent)
        file_name = str(path.name)
        sftp.chdir(path=directory_path)
        with sftp.open(filename=file_name) as file:
            content = file.read()
            return content


@remote_exception_handler
def get_remote_folder_config_paths(remote_connection, ssh_client) -> List[str]:
    """
    Given a remote path return a list of report config files
    :param ssh_client:
    :param remote_connection
    :return:
    """
    remote_path = remote_connection.path
    project_configs = []
    with ssh_client.open_sftp() as sftp:
        all_files = sftp.listdir_attr(remote_path)
        top_level_directories = filter(lambda e: S_ISDIR(e.st_mode), all_files)
        for directory in top_level_directories:
            dirname = Path(remote_path, directory.filename)
            directory_files = sftp.listdir(str(dirname))
            if TEST_CONFIG_FILE in directory_files:
                project_configs.append(Path(dirname, TEST_CONFIG_FILE))
    if not project_configs:
        error = f"No projects found at remote path: {remote_path}"
        logger.info(error)
        raise NoProjectsException(status=400, message=error)
    return project_configs


@remote_exception_handler
def get_remote_folders(
    ssh_client: SSHClient, remote_configs: List[str]
) -> List[RemoteFolder]:
    """
    Given a list of remote config paths return a list of RemoteFolder objects
    :param ssh_client:
    :param remote_configs:
    :return:
    """
    remote_folder_data = []
    with ssh_client.open_sftp() as sftp:
        for config in remote_configs:
            remote_folder_data.append(read_remote_config(sftp, config))
    return remote_folder_data


@remote_exception_handler
def get_remote_test_folders(remote_connection: RemoteConnection) -> List[RemoteFolder]:
    """
    Return a list of remote folders given a remote connection
    Checks for directories containing a config.json file
    :param remote_connection:
    :return:
    """
    client = get_client(remote_connection)
    remote_config_paths = get_remote_folder_config_paths(remote_connection, client)
    if not remote_config_paths:
        error = f"No projects found at {remote_connection.path}"
        logger.info(error)
        raise NoProjectsException(status=400, message=error)
    return get_remote_folders(client, remote_config_paths)


def walk_sftp_directory(sftp, remote_path):
    """
    SFTP implementation of os.walk
    :param sftp: Connected SFTP client
    :param remote_path:
    :return:
    """
    files = []
    folders = []
    for f in sftp.listdir_attr(remote_path):
        if S_ISDIR(f.st_mode):
            folders.append(f.filename)
        else:
            files.append(f.filename)
    return files, folders


@remote_exception_handler
def check_remote_path(remote_connection):
    ssh_client = get_client(remote_connection)
    get_remote_folder_config_paths(remote_connection, ssh_client)


def read_remote_config(sftp: SFTPClient, config_path: str):
    attributes = sftp.lstat(str(config_path))
    with sftp.open(str(config_path), "rb") as config_file:
        data = json.loads(config_file.read())
        return RemoteFolder(
            remotePath=str(Path(config_path).parent),
            testName=data["report_name"],
            lastModified=attributes.st_mtime,
        )


@remote_exception_handler
def sync_files_individually(client, remote_folder: RemoteFolder, destination_dir):
    with client.open_sftp() as sftp:
        destination_dir.mkdir(parents=True, exist_ok=True)
        files, folders = walk_sftp_directory(sftp, remote_folder.remotePath)

        for file in files:
            remote_file_path = f"{remote_folder.remotePath}/{file}"
            local_file_path = Path(destination_dir, file)

            logger.info(f"Downloading file: {remote_file_path} to {local_file_path}")
            sftp.get(remote_file_path, str(local_file_path))

        for folder in folders:
            remote_subdir = f"{remote_folder.remotePath}/{folder}"
            local_subdir = Path(destination_dir, folder)
            local_subdir.mkdir(parents=True, exist_ok=True)

            subdir_files, _ = walk_sftp_directory(sftp, remote_subdir)
            for sub_file in subdir_files:
                remote_file_path = f"{remote_subdir}/{sub_file}"
                local_file_path = Path(local_subdir, sub_file)
                logger.info(
                    f"Downloading file: {remote_file_path} to {local_file_path}"
                )
                sftp.get(remote_file_path, str(local_file_path))


@remote_exception_handler
def sync_test_folders(
    remote_connection: RemoteConnection, remote_folder: RemoteFolder, path_prefix: str
):
    client = get_client(remote_connection)

    gzip_exists = check_gzip_exists(client)

    report_folder = Path(remote_folder.remotePath).name
    destination_dir = Path(
        REPORT_DATA_DIRECTORY,
        path_prefix,
        remote_connection.host,
        report_folder,
    )
    destination_dir.mkdir(parents=True, exist_ok=True)

    check_permissions(client, remote_folder.remotePath)

    if gzip_exists:
        try:
            remote_tar_path = f"{remote_folder.remotePath}.tar.gz"
            compress_command = (
                f"tar -czf {remote_tar_path} -C {remote_folder.remotePath} ."
            )
            stdin, stdout, stderr = client.exec_command(compress_command)
            error = stderr.read().decode().strip()
            if error:
                raise Exception("Compression failed")

            local_tar_path = Path(destination_dir, f"{report_folder}.tar.gz")
            logger.info(f"Downloading compressed folder: {local_tar_path}")

            with client.open_sftp() as sftp:
                sftp.get(remote_tar_path, str(local_tar_path))

            with tarfile.open(local_tar_path, "r:gz") as tar:
                tar.extractall(path=destination_dir)

            os.remove(local_tar_path)

            client.exec_command(f"rm {remote_tar_path}")
        except Exception:
            logger.error("Compression failed, falling back to individual sync.")
            sync_files_individually(client, remote_folder, destination_dir)
    else:
        logger.info("gzip/tar not found, syncing files individually.")
        sync_files_individually(client, remote_folder, destination_dir)
