# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import logging
import subprocess
from pathlib import Path
from typing import List, Optional, Union

from ttnn_visualizer.enums import ConnectionTestStates
from ttnn_visualizer.exceptions import (
    AuthenticationException,
    AuthenticationFailedException,
    NoValidConnectionsError,
    RemoteConnectionException,
    SSHException,
)
from ttnn_visualizer.models import RemoteConnection

logger = logging.getLogger(__name__)


class SSHClient:
    """
    Centralized SSH client that handles all SSH/SFTP operations with consistent
    error handling and logging.
    """

    def __init__(self, connection: RemoteConnection):
        self.connection = connection
        self._base_ssh_cmd = self._build_base_ssh_cmd()
        self._base_sftp_cmd = self._build_base_sftp_cmd()

    def _build_base_ssh_cmd(self) -> List[str]:
        """Build the base SSH command with common options."""
        cmd = ["ssh", "-o", "PasswordAuthentication=no"]

        if self.connection.port != 22:
            cmd.extend(["-p", str(self.connection.port)])

        cmd.append(f"{self.connection.username}@{self.connection.host}")
        return cmd

    def _build_base_sftp_cmd(self) -> List[str]:
        """Build the base SFTP command with common options."""
        cmd = ["sftp", "-o", "PasswordAuthentication=no"]

        if self.connection.port != 22:
            cmd.extend(["-P", str(self.connection.port)])

        cmd.extend(["-b", "-"])  # Read commands from stdin
        cmd.append(f"{self.connection.username}@{self.connection.host}")
        return cmd

    def _handle_subprocess_error(self, e: subprocess.CalledProcessError):
        """
        Convert subprocess SSH errors to appropriate SSH exceptions.

        :param e: The subprocess.CalledProcessError
        :raises: SSHException, AuthenticationException, or NoValidConnectionsError
        """
        stderr = e.stderr.lower() if e.stderr else ""
        raw_error = e.stderr.strip() if e.stderr else "No stderr output"

        # Log the raw SSH error for debugging
        logger.warning(
            f"SSH error for {self.connection.username}@{self.connection.host}: {raw_error}"
        )

        # Store raw error for exceptions that need it
        self._last_raw_error = raw_error

        # Check for authentication failures
        if any(
            auth_err in stderr
            for auth_err in [
                "permission denied",
                "authentication failed",
                "publickey",
                "password",
                "host key verification failed",
            ]
        ):
            raise AuthenticationException(
                f"SSH authentication failed: {self.connection.username}@{self.connection.host}: Permission denied (publickey,password)"
            )

        # Check for connection failures (including DNS resolution failures)
        elif any(
            conn_err in stderr
            for conn_err in [
                "connection refused",
                "network is unreachable",
                "no route to host",
                "name or service not known",
                "could not resolve hostname",
                "connection timed out",
                "nodename nor servname provided",
            ]
        ):
            raise NoValidConnectionsError(f"SSH connection failed: {e.stderr}")

        # Check for general SSH protocol errors
        elif "ssh:" in stderr or "protocol" in stderr:
            raise SSHException(f"SSH protocol error: {e.stderr}")

        # Default to generic SSH exception
        else:
            raise SSHException(f"SSH command failed: {e.stderr}")

    def execute_command(self, command: str, timeout: int = 30) -> str:
        """
        Execute a command on the remote server via SSH.

        :param command: The command to execute
        :param timeout: Timeout in seconds
        :return: Command output (stdout)
        :raises: AuthenticationException, NoValidConnectionsError, SSHException
        """
        ssh_cmd = self._base_ssh_cmd + [command]

        logger.debug(f"Executing SSH command on {self.connection.host}: {command}")

        try:
            result = subprocess.run(
                ssh_cmd, capture_output=True, text=True, check=True, timeout=timeout
            )
            return result.stdout
        except subprocess.CalledProcessError as e:
            if e.returncode == 255:  # SSH protocol errors
                self._handle_subprocess_error(e)
            else:
                raise SSHException(f"Command failed: {e.stderr}")
        except subprocess.TimeoutExpired:
            logger.warning(
                f"SSH command timed out for {self.connection.username}@{self.connection.host}: {command}"
            )
            raise SSHException(f"SSH command timed out: {command}")

    def test_connection(self) -> bool:
        """
        Test SSH connection by running a simple command.

        :return: True if connection successful
        :raises: AuthenticationFailedException, RemoteConnectionException
        """
        try:
            log_message = f"Testing SSH connection to {self.connection.username}@{self.connection.host}"
            if self.connection.port != 22:
                log_message += f" on port {self.connection.port}"
            logger.info(log_message)

            self.execute_command("echo 'SSH connection test'", timeout=10)
            return True
        except AuthenticationException as e:
            # Convert to AuthenticationFailedException for proper HTTP 422 response
            user_message = (
                "SSH authentication failed. This application requires SSH key-based authentication. "
                "Please ensure your SSH public key is added to the authorized_keys file on the remote server. "
                "Password authentication is not supported."
            )
            logger.info(
                f"SSH authentication failed for {self.connection.username}@{self.connection.host}"
            )
            # Get the raw error details from the last SSH operation
            raw_error = getattr(self, "_last_raw_error", None)
            raise AuthenticationFailedException(message=user_message, detail=raw_error)
        except NoValidConnectionsError as ssh_err:
            user_message = (
                f"Unable to establish SSH connection to {self.connection.host}. "
                "Please check the hostname, port, and network connectivity. "
                "Ensure SSH key-based authentication is properly configured."
            )
            # Get the raw error details from the last SSH operation
            raw_error = getattr(self, "_last_raw_error", None)
            raise RemoteConnectionException(
                message=user_message,
                status=ConnectionTestStates.FAILED,
                detail=raw_error,
            )
        except SSHException as ssh_err:
            # Add debug logging to understand what we're getting
            logger.debug(f"SSHException caught in test_connection: '{str(ssh_err)}'")

            # Check if this is a timeout - should match original "SSH connection test timed out" message
            ssh_err_str = str(ssh_err).lower()
            if "timed out" in ssh_err_str or "timeout" in ssh_err_str:
                timeout_message = "SSH connection test timed out"
                logger.warning(
                    f"SSH timeout for {self.connection.username}@{self.connection.host}: {timeout_message}"
                )
                # Store timeout as raw error
                raw_error = str(ssh_err)
                raise RemoteConnectionException(
                    message=timeout_message,
                    status=ConnectionTestStates.FAILED,
                    detail=raw_error,
                )
            else:
                # This should match the original SSHException handling:
                # "SSH connection error to {host}: {str(ssh_err)}. Ensure SSH key-based authentication is properly configured."
                user_message = f"SSH connection error to {self.connection.host}: {str(ssh_err)}. Ensure SSH key-based authentication is properly configured."
                logger.warning(
                    f"SSH error for {self.connection.username}@{self.connection.host}: {user_message}"
                )
                raw_error = getattr(self, "_last_raw_error", str(ssh_err))
                raise RemoteConnectionException(
                    message=user_message,
                    status=ConnectionTestStates.FAILED,
                    detail=raw_error,
                )

    def read_file(self, remote_path: str, timeout: int = 30) -> Optional[bytes]:
        """
        Read a remote file using SSH cat command.

        :param remote_path: Path to the remote file
        :param timeout: Timeout in seconds
        :return: File contents as bytes, or None if file not found
        :raises: AuthenticationException, NoValidConnectionsError, SSHException
        """
        path = Path(remote_path)
        logger.info(f"Reading remote file {path}")

        try:
            result = self.execute_command(f"cat '{path}'", timeout=timeout)
            return result.encode("utf-8")
        except SSHException as e:
            if "No such file" in str(e) or "cannot open" in str(e):
                return None
            raise

    def check_path_exists(
        self, remote_path: Union[str, Path], timeout: int = 10
    ) -> bool:
        """
        Check if a remote path exists.

        :param remote_path: Path to check
        :param timeout: Timeout in seconds
        :return: True if path exists
        """
        path = Path(remote_path)
        logger.debug(f"Checking if remote path exists: {path}")

        try:
            self.execute_command(f"test -e '{path}'", timeout=timeout)
            return True
        except SSHException:
            return False

    def download_file(
        self,
        remote_path: Union[str, Path],
        local_path: Union[str, Path],
        timeout: int = 300,
    ):
        """
        Download a file using SFTP.

        :param remote_path: Remote file path
        :param local_path: Local destination path
        :param timeout: Timeout in seconds
        :raises: AuthenticationException, NoValidConnectionsError, SSHException
        """
        remote_path = Path(remote_path)
        local_path = Path(local_path)

        # Ensure local directory exists
        local_path.parent.mkdir(parents=True, exist_ok=True)

        # SFTP commands to execute
        sftp_commands = f"get '{remote_path}' '{local_path}'\nquit\n"

        logger.debug(f"Downloading: {remote_path} -> {local_path}")

        try:
            result = subprocess.run(
                self._base_sftp_cmd,
                input=sftp_commands,
                capture_output=True,
                text=True,
                check=True,
                timeout=timeout,
            )
            logger.debug(f"Downloaded successfully: {remote_path} -> {local_path}")
        except subprocess.CalledProcessError as e:
            if e.returncode == 255:  # SSH protocol errors
                self._handle_subprocess_error(e)
            else:
                logger.error(
                    f"SFTP error for {self.connection.username}@{self.connection.host} downloading {remote_path}: {e.stderr}"
                )
                raise SSHException(f"Failed to download {remote_path}")
        except subprocess.TimeoutExpired:
            logger.error(
                f"SFTP timeout for {self.connection.username}@{self.connection.host} downloading file: {remote_path}"
            )
            raise SSHException(f"Timeout downloading {remote_path}")

    def get_file_stat(
        self, remote_path: Union[str, Path], timeout: int = 10
    ) -> Optional[dict]:
        """
        Get file statistics for a remote path.

        :param remote_path: Remote file path
        :param timeout: Timeout in seconds
        :return: Dict with file stats or None if file doesn't exist
        """
        path = Path(remote_path)

        try:
            # Use stat command to get file information
            result = self.execute_command(
                f"stat -c '%s %Y %F' '{path}' 2>/dev/null || echo 'NOT_FOUND'",
                timeout=timeout,
            )

            if result.strip() == "NOT_FOUND":
                return None

            parts = result.strip().split(" ", 2)
            if len(parts) >= 3:
                return {"size": int(parts[0]), "mtime": int(parts[1]), "type": parts[2]}
        except (SSHException, ValueError):
            return None

        return None

    def list_directory(
        self, remote_path: Union[str, Path], timeout: int = 30
    ) -> List[str]:
        """
        List contents of a remote directory.

        :param remote_path: Remote directory path
        :param timeout: Timeout in seconds
        :return: List of file/directory names
        """
        path = Path(remote_path)

        try:
            result = self.execute_command(
                f"ls -1 '{path}' 2>/dev/null", timeout=timeout
            )
            return [line.strip() for line in result.split("\n") if line.strip()]
        except SSHException:
            return []
