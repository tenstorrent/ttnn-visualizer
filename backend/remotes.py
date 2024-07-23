import json
from pathlib import Path
from stat import S_ISDIR
from typing import List

import paramiko
from paramiko.client import SSHClient
from paramiko.ssh_exception import SSHException
from pydantic import BaseModel

TEST_CONFIG_FILE = 'config.json'
REPORT_DATA_DIRECTORY = Path(__file__).parent.absolute().joinpath('data')
ACTIVE_DATA_DIRECTORY = Path(REPORT_DATA_DIRECTORY).joinpath('active')


class RemoteConnection(BaseModel):
    name: str
    username: str
    host: str
    port: int
    path: str


class StatusMessage(BaseModel):
    status: int
    message: str


class RemoteFolder(BaseModel):
    testName: str
    remotePath: str
    lastModified: int


class NoProjectsException(BaseException):
    pass


def get_client(remote_connection: RemoteConnection) -> SSHClient:
    """
    Paramiko will use the local SSH agent for keys
    :param remote_connection:
    :return:
    """
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.load_system_host_keys()
    ssh.connect(remote_connection.host, look_for_keys=True, port=remote_connection.port,
                username=remote_connection.username)
    return ssh


def get_remote_folder_config_paths(ssh_client, remote_path) -> List[str]:
    """
    Given a remote path return a list of report config files
    :param ssh_client:
    :param remote_path:
    :return:
    """
    project_configs = []
    with ssh_client.open_sftp() as sftp:
        all_files = sftp.listdir_attr(remote_path)
        top_level_directories = filter(lambda e: S_ISDIR(e.st_mode), all_files)
        for directory in top_level_directories:
            dirname = Path(remote_path, directory.filename)
            directory_files = sftp.listdir(str(dirname))
            if TEST_CONFIG_FILE in directory_files:
                project_configs.append(Path(dirname, TEST_CONFIG_FILE))
    return project_configs


def get_remote_folders(ssh_client: SSHClient, remote_configs: List[str]) -> List[RemoteFolder]:
    """
    Given a list of remote config paths return a list of RemoteFolder objects
    :param ssh_client:
    :param remote_configs:
    :return:
    """
    remote_folder_data = []
    with ssh_client.open_sftp() as sftp:
        for config in remote_configs:
            report_directory = Path(config).parent
            try:
                attributes = sftp.lstat(str(config))
                config_file = sftp.open(str(config), 'rb')
                data = json.loads(config_file.read())
                remote_folder_data.append(
                    RemoteFolder(
                        remotePath=str(report_directory),
                        testName=data['report_name'],
                        lastModified=attributes.st_mtime
                    )
                )
                config_file.close()
            except IOError as err:
                raise FileNotFoundError(f"Failed to read config from {config}: {err}")

    return remote_folder_data


def get_remote_test_folders(remote_connection: RemoteConnection) -> List[RemoteFolder]:
    """
    Return a list of remote folders given a remote connection
    Checks for directories containing a config.json file
    :param remote_connection:
    :return:
    """
    client = get_client(remote_connection)
    remote_config_paths = get_remote_folder_config_paths(client, remote_connection.path)
    return get_remote_folders(client, remote_config_paths)


def sftp_walk(sftp, remote_path):
    """
    SFTP implementation of os.walk
    :param sftp: Connected SFTP client
    :param remote_path:
    :return:
    """
    path_to_copy = remote_path
    files = []
    folders = []
    for f in sftp.listdir_attr(remote_path):
        if S_ISDIR(f.st_mode):
            folders.append(f.filename)
        else:
            files.append(f.filename)
    if files:
        yield path_to_copy, files
    for folder in folders:
        new_path = Path(remote_path, folder)
        for x in sftp_walk(sftp, str(new_path)):
            yield x


def sync_test_folders(remote_connection: RemoteConnection, remote_folder: RemoteFolder):
    """
    Synchronize remote test folders to local storage
    Remote folders will be synchronized to REPORT_DATA_DIR
    :param remote_connection:
    :param remote_folder:
    :return:
    """
    client = get_client(remote_connection)
    with client.open_sftp() as sftp:
        report_folder = Path(remote_folder.remotePath).name
        destination_dir = Path(REPORT_DATA_DIRECTORY, remote_connection.name, report_folder)
        if not Path(destination_dir).exists():
            Path(destination_dir).mkdir(parents=True, exist_ok=True)
        for directory, files in sftp_walk(sftp, remote_folder.remotePath):
            sftp.chdir(str(directory))
            for file in files:
                sftp.get(file, str(Path(destination_dir, file)))


def check_remote_path(remote_connection):
    try:
        ssh_client = get_client(remote_connection)
    except SSHException as error:
        return StatusMessage(status=500, message=str(error))
    with ssh_client.open_sftp() as sftp:
        try:
            sftp.listdir(remote_connection.path)
        except FileNotFoundError:
            return StatusMessage(status=400,
                                 message=f"Path {remote_connection.path} does not exist")
        try:
            remote_folders = get_remote_test_folders(remote_connection)
            if not remote_folders:
                return StatusMessage(status=400,
                                     message=f"No test folders found in {remote_connection.path}")
        except FileNotFoundError as err:
            return StatusMessage(status=500, message=str(err))
    return StatusMessage(status=200, message="success")
