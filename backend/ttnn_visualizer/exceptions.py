# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

from http import HTTPStatus
from typing import Optional

from ttnn_visualizer.enums import ConnectionTestStates


class RemoteConnectionException(Exception):
    def __init__(
        self,
        message,
        status: ConnectionTestStates,
        http_status_code: Optional[HTTPStatus] = None,
        detail: Optional[str] = None,
    ):
        super().__init__(message)
        self.message = message
        self.status = status
        self.detail = detail
        self._http_status_code = http_status_code

    @property
    def http_status(self):
        # Use custom HTTP status code if provided
        if self._http_status_code is not None:
            return self._http_status_code

        # Default behavior
        if self.status == ConnectionTestStates.FAILED:
            return HTTPStatus.INTERNAL_SERVER_ERROR
        if self.status == ConnectionTestStates.OK:
            return HTTPStatus.OK


class AuthenticationFailedException(RemoteConnectionException):
    """Exception for SSH authentication failures that should return HTTP 422"""

    def __init__(
        self,
        message,
        status: ConnectionTestStates = ConnectionTestStates.FAILED,
        detail: Optional[str] = None,
    ):
        super().__init__(
            message=message,
            status=status,
            http_status_code=HTTPStatus.UNPROCESSABLE_ENTITY,  # 422
            detail=detail,
        )


class NoProjectsException(RemoteConnectionException):
    pass


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
