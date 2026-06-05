# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

from http import HTTPStatus
from typing import Optional

from flask import jsonify
from ttnn_visualizer.enums import ConnectionTestStates


def error_response(
    status: HTTPStatus,
    message: Optional[str] = None,
    detail: Optional[str] = None,
    sync_method: Optional[str] = None,
):
    payload = {"error": message or status.phrase}
    if detail:
        payload["detail"] = detail
    if sync_method:
        payload["syncMethod"] = sync_method
    return jsonify(payload), status


def response_bad_request(message: Optional[str] = None, detail: Optional[str] = None):
    return error_response(HTTPStatus.BAD_REQUEST, message, detail)


def response_not_found(message: Optional[str] = None, detail: Optional[str] = None):
    return error_response(HTTPStatus.NOT_FOUND, message, detail)


def response_unprocessable_entity(
    message: Optional[str] = None, detail: Optional[str] = None
):
    return error_response(HTTPStatus.UNPROCESSABLE_ENTITY, message, detail)


def response_internal_server_error(
    message: Optional[str] = None, detail: Optional[str] = None
):
    return error_response(HTTPStatus.INTERNAL_SERVER_ERROR, message, detail)


def response_forbidden(message: Optional[str] = None, detail: Optional[str] = None):
    return error_response(HTTPStatus.FORBIDDEN, message, detail)


class RemoteConnectionException(Exception):
    def __init__(
        self,
        message,
        status: ConnectionTestStates,
        http_status_code: Optional[HTTPStatus] = None,
        detail: Optional[str] = None,
        sync_method: Optional[str] = None,
    ):
        super().__init__(message)
        self.message = message
        self.status = status
        self.detail = detail
        self._http_status_code = http_status_code
        # Transport actually used for the failed run, when known (sftp/scp).
        # Lets callers report the real method instead of re-reading the
        # process-global fallback cache, which can be stale for this run.
        self.sync_method = sync_method

    @property
    def http_status(self):
        # Use custom HTTP status code if provided
        if self._http_status_code is not None:
            return self._http_status_code

        # Default behavior
        if self.status == ConnectionTestStates.FAILED:
            return HTTPStatus.INTERNAL_SERVER_ERROR
        if self.status == ConnectionTestStates.WARNING:
            return HTTPStatus.OK
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


class HostKeyVerificationFailedException(RemoteConnectionException):
    """Exception for untrusted SSH host keys that should return HTTP 422."""

    def __init__(
        self,
        message,
        status: ConnectionTestStates = ConnectionTestStates.FAILED,
        detail: Optional[str] = None,
    ):
        super().__init__(
            message=message,
            status=status,
            http_status_code=HTTPStatus.UNPROCESSABLE_ENTITY,
            detail=detail,
        )


class NoReportsException(RemoteConnectionException):
    pass


class DatabaseFileNotFoundException(Exception):
    pass


class ReportNotLoadedException(Exception):
    """Instance exists but the requested report kind is not loaded.

    Used as a uniform 404 signal across profiler and performance routes so
    the global error handler can render a single response shape. Subclass
    per report kind and override ``DEFAULT_MESSAGE`` so call sites read as
    ``raise ProfilerReportNotLoadedException()`` without having to repeat
    the body string.
    """

    DEFAULT_MESSAGE = "Report is not loaded for this instance"

    def __init__(self, message: Optional[str] = None) -> None:
        super().__init__(message or self.DEFAULT_MESSAGE)


class ProfilerReportNotLoadedException(ReportNotLoadedException):
    """Instance has no memory profiler database path configured."""

    DEFAULT_MESSAGE = "No profiler report loaded for this instance"


class PerformanceReportNotLoadedException(ReportNotLoadedException):
    """Instance has no performance report directory configured."""

    DEFAULT_MESSAGE = "No performance report loaded for this instance"


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


class HostKeyVerificationException(SSHException):
    """Raised when SSH rejects an unknown host key (BatchMode cannot prompt)."""

    pass


class NoValidConnectionsError(SSHException):
    """Raised when SSH connection cannot be established"""

    pass


class RemoteFileReadException(Exception):
    """Raised when a remote file cannot be read"""

    def __init__(
        self,
        message: str,
        http_status_code: HTTPStatus = HTTPStatus.INTERNAL_SERVER_ERROR,
        detail: Optional[str] = None,
    ):
        super().__init__(message)
        self.message = message
        self._http_status_code = http_status_code
        self.detail = detail

    @property
    def http_status(self):
        return self._http_status_code
