import os
import zipfile

from ttnn_visualizer.decorators import remote_exception_handler
from ttnn_visualizer.enums import ConnectionTestStates
from ttnn_visualizer.exceptions import RemoteConnectionException, RemoteSqliteException
from ttnn_visualizer.models import RemoteConnection
from ttnn_visualizer.queries import DatabaseQueries
from ttnn_visualizer.serializers import serialize_operations
from ttnn_visualizer.ssh_client import get_client


def get_download_url(os_type, arch):
    """Get the download URL based on OS and architecture."""
    download_url = {
        "linux_x64": "https://www.sqlite.org/2024/sqlite-tools-linux-x64-3460100.zip",
        "linux_x86": "https://www.sqlite.org/2024/sqlite-tools-linux-x86-3410000.zip",
        "macos_x64": "https://www.sqlite.org/2024/sqlite-tools-osx-x64-3460100.zip",
        "windows_x64": "https://www.sqlite.org/2024/sqlite-tools-win-x64-3460100.zip",
        "windows_x86": "https://www.sqlite.org/2024/sqlite-tools-win32-x86-3410000.zip",
    }.get(f"{os_type}_{arch}")

    if not download_url:
        raise Exception(f"Unsupported OS or architecture: {os_type}, {arch}")

    print(f"Download URL for {os_type} {arch}: {download_url}")
    return download_url


def check_dns_resolution(ssh_client):
    """Check if DNS resolution is working on the remote machine."""
    try:
        stdin, stdout, stderr = ssh_client.exec_command("nslookup google.com")
        stdout_output = stdout.read().decode().strip()
        if "can't find" in stdout_output or "NXDOMAIN" in stdout_output:
            raise Exception("DNS resolution failed.")
        print("DNS resolution is working.")
    except Exception as e:
        raise Exception(f"Failed to check DNS resolution: {str(e)}")


def check_internet_connectivity(ssh_client):
    """Check if the remote machine has internet access."""
    try:
        stdin, stdout, stderr = ssh_client.exec_command("ping -c 1 google.com")
        exit_status = stdout.channel.recv_exit_status()
        if exit_status == 0:
            print("Internet connection is available on the remote machine.")
        else:
            raise Exception("Remote machine does not have internet access.")
    except Exception as e:
        raise Exception(f"Failed to check internet connectivity: {str(e)}")


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
            status=ConnectionTestStates.FAILED.value,
        )


def determine_os(ssh_client):
    """Determine the operating system of the remote machine."""
    try:
        stdin, stdout, stderr = ssh_client.exec_command("uname -s")
        os_type = stdout.read().decode().strip()
        print(f"Detected OS type: {os_type}")
        if os_type == "Linux":
            return "linux"
        elif os_type == "Darwin":
            return "macos"
        elif "MINGW" in os_type or "CYGWIN" in os_type:
            return "windows"
        else:
            raise Exception(f"Unsupported OS type: {os_type}")
    except Exception as e:
        raise Exception(f"Error determining remote OS: {str(e)}")


def determine_architecture(ssh_client):
    """Determine the system architecture (x86 or x64)."""
    try:
        stdin, stdout, stderr = ssh_client.exec_command("uname -m")
        arch = stdout.read().decode().strip()
        print(f"Detected architecture: {arch}")
        if arch in ["x86_64", "aarch64"]:
            return "x64"
        elif arch in ["i386", "i686"]:
            return "x86"
        else:
            raise Exception(f"Unsupported architecture: {arch}")
    except Exception as e:
        raise Exception(f"Error determining architecture: {str(e)}")


def create_directory_if_not_exists(ssh_client, directory_path):
    """Create the directory if it doesn't exist."""
    try:
        stdin, stdout, stderr = ssh_client.exec_command(f"mkdir -p {directory_path}")
        exit_status = stdout.channel.recv_exit_status()  # Wait for command to finish
        if exit_status != 0:
            raise Exception(
                f"Failed to create directory {directory_path}: {stderr.read().decode().strip()}"
            )
        print(f"Ensured directory {directory_path} exists.")
    except Exception as e:
        raise Exception(f"Error creating directory {directory_path}: {str(e)}")


def ensure_write_permissions(ssh_client, directory_path):
    """Check if the specified directory is writable."""
    try:
        # Attempt to create a test file in the specified directory
        test_file_path = os.path.join(directory_path, "testfile")
        print(f"Checking write permissions for: {directory_path}")
        stdin, stdout, stderr = ssh_client.exec_command(f"touch {test_file_path}")
        exit_status = stdout.channel.recv_exit_status()  # Wait for command to finish

        if exit_status != 0:
            error = stderr.read().decode().strip()
            raise Exception(f"No write permissions for {directory_path}: {error}")

        # Clean up the test file
        ssh_client.exec_command(f"rm {test_file_path}")
        print(f"Write permissions confirmed for {directory_path}.")

    except Exception as e:
        raise Exception(f"Error checking write permissions: {str(e)}")


def extract_zip_file_with_python(ssh_client, zip_path, extract_to):
    """Extracts a ZIP file using Python's zipfile module."""
    try:
        print(f"Downloading {zip_path} to the local machine for extraction...")
        sftp_client = ssh_client.open_sftp()

        # Download the zip file to a temporary location
        local_zip_path = "/tmp/sqlite.zip"
        sftp_client.get(zip_path, local_zip_path)
        print(f"Downloaded {zip_path} to local path {local_zip_path}.")

        # Ensure the extraction directory exists
        create_directory_if_not_exists(ssh_client, extract_to)

        # Extract using Python's zipfile module
        print(f"Starting extraction of {local_zip_path} to {extract_to}...")
        with zipfile.ZipFile(local_zip_path, "r") as zip_ref:
            zip_ref.extractall(extract_to)  # Extract to the specified directory
        print(f"Successfully extracted {local_zip_path} to {extract_to}")

        # Clean up: remove the downloaded ZIP file
        os.remove(local_zip_path)
        print(f"Removed local zip file {local_zip_path}")

    except Exception as e:
        raise Exception(f"Failed to extract {zip_path}: {str(e)}")


def download_sqlite(ssh_client, sqlite_download_folder, os_type, arch):
    """Download and install SQLite for the appropriate OS and architecture."""
    download_url = get_download_url(os_type, arch)

    # Attempting to download using curl
    try:
        print(f"Attempting to download SQLite for {os_type} {arch} using curl...")
        download_command = f"curl -k -o {sqlite_download_folder}/sqlite.zip {download_url}"  # -k disables SSL verification

        print(f"Executing command: {download_command}")
        stdin, stdout, stderr = ssh_client.exec_command(download_command)

        # Capture output
        stdout_output = stdout.read().decode().strip()
        stderr_output = stderr.read().decode().strip()
        exit_status = stdout.channel.recv_exit_status()

        if exit_status != 0:
            print(
                f"curl failed with exit status {exit_status} and the following error:\n{stderr_output}"
            )
            raise Exception("curl failed. Attempting to use wget...")

        print("SQLite downloaded successfully using curl.")

    except Exception as e:
        print(f"Error during download with curl: {str(e)}")
        print("Attempting to use wget...")

        # If curl fails, try with wget
        try:
            print(f"Attempting to download SQLite for {os_type} {arch} using wget...")
            download_command = f"wget --no-check-certificate -O {sqlite_download_folder}/sqlite.zip {download_url}"
            print(f"Executing command: {download_command}")

            stdin, stdout, stderr = ssh_client.exec_command(download_command)
            stdout_output = stdout.read().decode().strip()
            stderr_output = stderr.read().decode().strip()
            exit_status = stdout.channel.recv_exit_status()

            if exit_status != 0:
                print(
                    f"wget failed with exit status {exit_status} and the following error:\n{stderr_output}"
                )
                raise Exception("Failed to download SQLite with wget.")

            print("SQLite downloaded successfully using wget.")

        except Exception as e:
            raise Exception(f"Failed to download SQLite: {str(e)}")

    # Check if the file exists and is not empty
    check_file_command = f"ls -lh {sqlite_download_folder}/sqlite.zip"
    stdin, stdout, stderr = ssh_client.exec_command(check_file_command)
    stdout_output = stdout.read().decode().strip()
    stderr_output = stderr.read().decode().strip()
    print(f"File check output:\n{stdout_output}\n{stderr_output}")

    # Extract the ZIP file using Python's zipfile module
    extract_zip_file_with_python(
        ssh_client, f"{sqlite_download_folder}/sqlite.zip", sqlite_download_folder
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

        print(f"SQLite binary at {binary_path} is executable. Version: {output}")

    except Exception as e:
        raise Exception(f"Error checking SQLite executability: {str(e)}")


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
        raise RemoteSqliteException(
            message=str(e), status=ConnectionTestStates.FAILED.value
        )


def move_sqlite_binary(ssh_client, download_folder, target_binary_path):
    """Move the downloaded SQLite binary to the target bin folder."""
    # Extract the parent folder of the target binary path
    target_folder = os.path.dirname(target_binary_path)

    # Move the binary from download_folder (e.g., /tmp/sqlite3) to the target path (e.g., /foo/bar/sqlite3)
    move_command = f"mv {download_folder}/sqlite3 {target_binary_path}"
    stdin, stdout, stderr = ssh_client.exec_command(move_command)
    exit_status = stdout.channel.recv_exit_status()

    if exit_status != 0:
        raise Exception(
            f"Failed to move SQLite binary: {stderr.read().decode().strip()}"
        )

    print(f"SQLite binary moved to {target_binary_path}")


def setup_sqlite_binary(ssh_client, remote_connection: RemoteConnection):
    """Setup SQLite binary on remote server."""
    SQLITE_BINARY_PATH = (
        remote_connection.sqlite_binary_path
    )  # Path provided (e.g., /foo/bar/sqlite3)
    sqlite_folder = os.path.dirname(SQLITE_BINARY_PATH)

    # Extract the parent folder (e.g., /foo/bar)
    sqlite_download_folder = "/tmp"  # Download to /tmp

    # Step 1: Check if there's already an existing SQLite binary
    check_internet_connectivity(ssh_client)

    sqlite_path = find_sqlite_binary(ssh_client)
    if sqlite_path:
        print(f"Using existing SQLite binary at: {sqlite_path}")
        is_sqlite_executable(ssh_client, sqlite_path)
    else:
        # Step 2: Download and extract if no SQLite binary found
        os_type = determine_os(ssh_client)
        arch = determine_architecture(ssh_client)

        # Ensure the directory where SQLite will be installed exists
        create_directory_if_not_exists(ssh_client, sqlite_folder)
        ensure_write_permissions(ssh_client, sqlite_folder)

        # Download the binary to /tmp
        download_sqlite(ssh_client, sqlite_download_folder, os_type, arch)

        # After download, move the extracted binary to the final bin folder (e.g., /foo/bar/sqlite3)
        move_sqlite_binary(ssh_client, sqlite_download_folder, SQLITE_BINARY_PATH)

        # Check if the binary is now executable
        is_sqlite_executable(ssh_client, SQLITE_BINARY_PATH)
        print(f"SQLite installed at: {SQLITE_BINARY_PATH}")
