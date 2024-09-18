import json
import logging
import os
from pathlib import Path
from stat import S_ISDIR
from typing import List

import paramiko
from paramiko.agent import Agent
from paramiko.client import SSHClient
from paramiko.ssh_exception import (
    SSHException,
    AuthenticationException,
    NoValidConnectionsError,
)
from pydantic import BaseModel

# TODO Setup application wide logging configurations
logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

TEST_CONFIG_FILE = "config.json"
REPORT_DATA_DIRECTORY = Path(__file__).parent.absolute().joinpath("data")
ACTIVE_DATA_DIRECTORY = Path(REPORT_DATA_DIRECTORY).joinpath("active")


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


class RemoteFolderException(Exception):
    def __init__(self, message, status):
        super().__init__(message)
        self.message = message
        self.status = status


class NoProjectsException(RemoteFolderException):
    pass


def remote_exception_handler(func):
    def remote_handler(*args, **kwargs):
        connection = args[0]
        try:
            return func(*args, **kwargs)
        except AuthenticationException as err:
            raise RemoteFolderException(
                status=403, message=f"Unable to authenticate: {str(err)}"
            )
        except FileNotFoundError as err:
            raise RemoteFolderException(
                status=500, message=f"Unable to open path {connection.path}: {str(err)}"
            )
        except NoProjectsException as err:
            raise RemoteFolderException(
                status=400,
                message=f"No projects found at remote location: {connection.path}: {str(err)}",
            )
        except NoValidConnectionsError as err:
            raise RemoteFolderException(
                status=500,
                message=f"Unable to connect to host {connection.host}: {str(err)}",
            )

        except IOError as err:
            raise RemoteFolderException(
                status=400,
                message=f"Error opening remote folder {connection.path}: {str(err)}",
            )
        except SSHException as err:
            raise RemoteFolderException(
                status=500, message=f"Error connecting to host {connection.host}: {err}"
            )

    return remote_handler


@remote_exception_handler
def get_client(remote_connection: RemoteConnection) -> SSHClient:
    """
    Paramiko will use the local SSH agent for keys
    :param remote_connection:
    :return:
    """
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.load_system_host_keys()
    ssh_config_path = os.getenv("SSH_CONFIG_PATH", "~/.ssh/config")
    use_agent = os.getenv("USE_SSH_AGENT", True)
    connection_args = dict()
    if use_agent:
        logger.info(
            f"Connecting to remote host {remote_connection.host} using SSH agent"
        )
        agent = Agent()
        logger.info(f"Found {len(agent.get_keys())} in agent")
        if not agent.get_keys():
            raise SSHException("No keys found")
        connection_args.update({"look_for_keys": True})
    else:
        logger.info(
            f"Connecting to remote host {remote_connection.host} using public keys"
        )
        config_path = Path(ssh_config_path).expanduser()
        config = paramiko.SSHConfig.from_path(config_path).lookup(
            remote_connection.host
        )
        if not config:
            raise SSHException(f"Host not found in SSH config {remote_connection.host}")
        keyfile_path = config["identityfile"].pop()
        connection_args.update({"key_filename": keyfile_path, "look_for_keys": False})

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.load_system_host_keys()
    ssh.connect(
        remote_connection.host,
        port=remote_connection.port,
        username=remote_connection.username,
        **connection_args,
    )
    return ssh


@remote_exception_handler
def read_remote_file(remote_connection):
    logger.info(f"Opening remote file {remote_connection.path}")
    ssh_client = get_client(remote_connection)
    with ssh_client.open_sftp() as sftp:
        path = Path(remote_connection.path)
        directory_path = str(path.parent)
        file_name = str(path.name)
        sftp.chdir(path=directory_path)
        file = sftp.open(filename=file_name)
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
        raise NoProjectsException(
            status=400, message=error
        )
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
            report_directory = Path(config).parent
            try:
                attributes = sftp.lstat(str(config))
                config_file = sftp.open(str(config), "rb")
                data = json.loads(config_file.read())
                remote_folder_data.append(
                    RemoteFolder(
                        remotePath=str(report_directory),
                        testName=data["report_name"],
                        lastModified=attributes.st_mtime,
                    )
                )
                config_file.close()
            except IOError as err:
                logger.info(f"Error reading remote folders: {err}")
                raise FileNotFoundError(f"Failed to read config from {config}: {err}")
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
        raise NoProjectsException(error)
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


@remote_exception_handler
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
        destination_dir = Path(
            REPORT_DATA_DIRECTORY, remote_connection.name, report_folder
        )
        if not Path(destination_dir).exists():
            Path(destination_dir).mkdir(parents=True, exist_ok=True)
        for directory, files in sftp_walk(sftp, remote_folder.remotePath):
            sftp.chdir(str(directory))
            for file in files:
                sftp.get(file, str(Path(destination_dir, file)))


@remote_exception_handler
def check_remote_path(remote_connection):
    ssh_client = get_client(remote_connection)
    get_remote_folder_config_paths(remote_connection, ssh_client)
