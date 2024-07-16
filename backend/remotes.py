import json
import os.path
from pathlib import Path
from stat import S_ISDIR

import paramiko
from paramiko.ssh_exception import SSHException
from pydantic import BaseModel

TEST_CONFIG_FILE = 'config.json'
REPORT_DATA_DIRECTORY = Path(__file__).parent.absolute().joinpath('data')
ACTIVE_DATA_DIRECTORY = Path(REPORT_DATA_DIRECTORY).joinpath('active')


class RemoteConnection(BaseModel):
    name: str
    host: str
    port: int
    path: str


class StatusMessage(BaseModel):
    status: int
    message: str


class RemoteFolder(BaseModel):
    testName: str
    remotePath: str
    lastModified: str


class NoProjectsException(BaseException):
    pass


def get_client(remote_connection, ssh_config="~/.ssh/config"):
    config_path = Path(ssh_config).expanduser()
    config = paramiko.SSHConfig.from_path(config_path).lookup(remote_connection.host)
    if not config:
        raise SSHException(f"Host not found in SSH config {remote_connection.host}")

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.load_system_host_keys()
    keyfile_path = config['identityfile'][0]
    ssh.connect(remote_connection.host, look_for_keys=False, key_filename=keyfile_path, port=remote_connection.port)
    return ssh


def get_remote_folder_config_paths(ssh_client, remote_path):
    project_configs = []
    with ssh_client.open_sftp() as sftp:
        top_level_directories = list(filter(lambda e: S_ISDIR(e.st_mode), sftp.listdir_attr(remote_path)))
        for directory in top_level_directories:
            dirname = Path(remote_path).joinpath(directory.filename)
            directory_files = sftp.listdir(str(dirname))
            if TEST_CONFIG_FILE in directory_files:
                project_configs.append(str(Path(dirname).joinpath(TEST_CONFIG_FILE)))
    return project_configs


def get_remote_folders(ssh_client, remote_configs):
    remote_folder_data = []
    with ssh_client.open_sftp() as sftp:
        for config in remote_configs:
            report_directory = str(Path(config).parent)
            try:
                attributes = sftp.lstat(config)
                f = sftp.open(config, 'rb')
                data = json.loads(f.read())
                remote_folder_data.append(
                    RemoteFolder(
                        remotePath=report_directory,
                        testName=data['report_name'],
                        lastModified=str(attributes.st_mtime))
                )
                f.close()
            except IOError as err:
                raise FileNotFoundError(f"Failed to read config from {config}: {err}")

    return remote_folder_data


def get_remote_test_folders(remote_connection):
    client = get_client(remote_connection)
    remote_config_paths = get_remote_folder_config_paths(client, remote_path=remote_connection.path)
    folders = get_remote_folders(client, remote_configs=remote_config_paths)
    return folders


def sftp_walk(sftp, remote_path):
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
        new_path = os.path.join(remote_path, folder)
        for x in sftp_walk(sftp, new_path):
            yield x


def sync_test_folders(remote_connection: RemoteConnection, remote_folder: RemoteFolder):
    client = get_client(remote_connection)
    with client.open_sftp() as sftp:
        report_folder = Path(remote_folder.remotePath).name
        destination_dir = Path(REPORT_DATA_DIRECTORY).joinpath(remote_connection.name).joinpath(report_folder)
        if not Path(destination_dir).exists():
            Path(destination_dir).mkdir(parents=True, exist_ok=True)
        for directory, files in sftp_walk(sftp, remote_folder.remotePath):
            sftp.chdir(str(directory))
            for file in files:
                sftp.get(file, str(Path(destination_dir).joinpath(file)))


def check_remote_path(remote_connection):
    try:
        ssh_client = get_client(remote_connection)
    except SSHException as error:
        return StatusMessage(status=500, message=str(error))
    with ssh_client.open_sftp() as sftp:
        try:
            path_to_check = remote_connection.path
            sftp.listdir(str(path_to_check))
        except FileNotFoundError as err:
            print(err)
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
