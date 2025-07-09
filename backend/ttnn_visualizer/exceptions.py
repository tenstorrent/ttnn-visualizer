# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

from http import HTTPStatus

from ttnn_visualizer.enums import ConnectionTestStates


class RemoteConnectionException(Exception):
    def __init__(self, message, status: ConnectionTestStates):
        super().__init__(message)
        self.message = message
        self.status = status

    @property
    def http_status(self):
        if self.status == ConnectionTestStates.FAILED:
            return HTTPStatus.INTERNAL_SERVER_ERROR
        if self.status == ConnectionTestStates.OK:
            return HTTPStatus.OK


class NoProjectsException(RemoteConnectionException):
    pass


class RemoteSqliteException(Exception):
    def __init__(self, message, status):
        super().__init__(message)
        self.message = message
        self.status = status


class DatabaseFileNotFoundException(Exception):
    pass


class DataFormatError(Exception):
    pass


class InvalidReportPath(Exception):
    pass


class InvalidProfilerPath(Exception):
    pass


class SSHException(Exception):
    """Base SSH exception for subprocess SSH operations"""
    pass


class AuthenticationException(SSHException):
    """Raised when SSH authentication fails"""
    pass


class NoValidConnectionsError(SSHException):
    """Raised when SSH connection cannot be established"""
    pass
