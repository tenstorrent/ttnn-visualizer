# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import logging
import re
from functools import wraps
from typing import Any, Callable

from flask import abort, request, session
from ttnn_visualizer.enums import ConnectionTestStates
from ttnn_visualizer.exceptions import (
    AuthenticationException,
    AuthenticationFailedException,
    HostKeyVerificationException,
    HostKeyVerificationFailedException,
    NoValidConnectionsError,
    RemoteConnectionException,
    RemoteFileReadException,
    SSHException,
    response_forbidden,
)
from ttnn_visualizer.instances import get_or_create_instance
from ttnn_visualizer.ssh_client import SSH_AUTH_FAILURE_MESSAGE

logger = logging.getLogger(__name__)


def with_instance(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        from flask import current_app

        instance_id = request.args.get("instanceId")

        if not instance_id:
            current_app.logger.error("No instanceId present on request, returning 400")
            abort(400, description="Missing required query parameter: instanceId")

        instance_query_data = get_or_create_instance(instance_id=instance_id)

        # Handle case where get_or_create_instance returns None due to database error
        if instance_query_data is None:
            current_app.logger.error(
                f"Failed to get or create instance with ID: {instance_id}"
            )
            abort(500)

        instance = instance_query_data.to_pydantic()

        kwargs["instance"] = instance

        if "instances" not in session:
            session["instances"] = []

        if instance.instance_id not in session["instances"]:
            max_reports = current_app.config["SESSION_MAX_UPLOADED_REPORTS"]
            session["instances"] = (
                session.get("instances", []) + [instance.instance_id]
            )[-max_reports:]

        return func(*args, **kwargs)

    return wrapper


def remote_exception_handler(func):
    from flask import current_app

    def remote_handler(*args, **kwargs):
        if kwargs.get("connection", None):
            connection = kwargs["connection"]
        elif kwargs.get("remote_connection", None):
            connection = kwargs["remote_connection"]
        else:
            connection = args[0]
        try:
            return func(*args, **kwargs)
        except HostKeyVerificationException as err:
            current_app.logger.warning(
                "SSH host key not trusted for %s@%s:%s",
                connection.username,
                connection.host,
                connection.port,
            )
            raise HostKeyVerificationFailedException(
                message=str(err),
                status=ConnectionTestStates.FAILED,
            )
        except AuthenticationException as err:
            current_app.logger.warning(
                f"SSH authentication failed for {connection.username}@{connection.host}: SSH key authentication required"
            )
            raise AuthenticationFailedException(
                message=SSH_AUTH_FAILURE_MESSAGE,
                status=ConnectionTestStates.FAILED,
            )
        except FileNotFoundError as err:
            current_app.logger.error(f"File not found: {str(err)}")
            raise RemoteConnectionException(
                status=ConnectionTestStates.FAILED,
                message=f"Unable to open path: {str(err)}",
            )
        except NoValidConnectionsError as err:
            current_app.logger.warning(
                f"SSH connection failed for {connection.username}@{connection.host}: {str(err)}"
            )

            # Provide user-friendly message for connection issues
            user_message = (
                f"Unable to establish SSH connection to {connection.host}. "
                "Please check the hostname, port, and network connectivity. "
                "Ensure SSH key-based authentication is properly configured."
            )

            raise RemoteConnectionException(
                status=ConnectionTestStates.FAILED,
                message=user_message,
            )

        except IOError as err:
            message = f"Error opening remote folder: {str(err)}"
            if "Name or service not known" in str(err):
                message = f"Unable to connect to {connection.host} - check hostname"
            raise RemoteConnectionException(
                status=ConnectionTestStates.FAILED,
                message=message,
            )
        except SSHException as err:
            if str(err) == "No existing session":
                message = "SSH authentication failed. Please ensure SSH keys are configured and ssh-agent is running."
            else:
                err_message = re.sub(r"\[.*?]", "", str(err)).strip()
                message = f"SSH connection error to {connection.host}: {err_message}. Ensure SSH key-based authentication is properly configured."

            raise RemoteConnectionException(
                status=ConnectionTestStates.FAILED, message=message
            )
        except RemoteFileReadException:
            raise
        except RemoteConnectionException:
            # Already a domain-shaped error with its own http_status / detail;
            # rewrapping it via the catch-all below would silently drop any
            # custom http_status_code (e.g. 422 for "path unreadable") and
            # downgrade it to the default 500.
            raise
        except Exception as err:
            # Catch any other unhandled exceptions
            current_app.logger.exception(
                f"Unexpected error during remote operation for {connection}: {str(err)}"
            )
            raise RemoteConnectionException(
                status=ConnectionTestStates.FAILED,
                message=str(err),
            )

    return remote_handler


def local_only(f):
    from flask import current_app

    @wraps(f)
    def decorated_function(*args, **kwargs):
        if current_app.config["SERVER_MODE"]:
            abort(403, description="Endpoint not accessible")

        return f(*args, **kwargs)

    return decorated_function


DIRECT_REPORT_MODE_DELETE_REFUSAL = (
    "Reports read from TT_METAL_HOME are not managed by TT-NN Visualizer "
    "and cannot be deleted."
)


def refuse_in_direct_report_mode(f: Callable[..., Any]) -> Callable[..., Any]:
    """Refuse a report delete when the paired listing reads the TT-Metal tree.

    In direct-report mode ``GET /profiler`` and ``GET /performance`` list
    ``$TT_METAL_HOME/generated/...``, which the app neither created nor manages. Saying so
    is more honest than a 404 against a local data directory the client never saw listed.

    Returns the refusal rather than calling ``abort`` so the body carries the reason as
    ``{"error": ...}``, which is the shape the SPA's ``getResponseError`` reads.
    """
    from flask import current_app
    from ttnn_visualizer.utils import create_path_resolver

    @wraps(f)
    def decorated_function(*args: Any, **kwargs: Any) -> Any:
        if create_path_resolver(current_app).is_direct_report_mode:
            return response_forbidden(DIRECT_REPORT_MODE_DELETE_REFUSAL)

        return f(*args, **kwargs)

    return decorated_function
