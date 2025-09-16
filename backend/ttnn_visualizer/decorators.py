# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import logging
import re
from functools import wraps

from flask import abort, request, session
from ttnn_visualizer.enums import ConnectionTestStates
from ttnn_visualizer.exceptions import (
    AuthenticationException,
    AuthenticationFailedException,
    NoProjectsException,
    NoValidConnectionsError,
    RemoteConnectionException,
    SSHException,
)
from ttnn_visualizer.instances import get_or_create_instance

logger = logging.getLogger(__name__)


def with_instance(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        from flask import current_app

        instance_id = request.args.get("instanceId")

        if not instance_id:
            current_app.logger.error("No instanceId present on request, returning 404")
            abort(404)

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
            session["instances"] = session.get("instances", []) + [instance.instance_id]

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
        except AuthenticationException as err:
            # Log the detailed error for debugging, but don't show full traceback
            current_app.logger.warning(
                f"SSH authentication failed for {connection.username}@{connection.host}: SSH key authentication required"
            )

            # Return user-friendly error message about SSH keys
            user_message = (
                "SSH authentication failed. This application requires SSH key-based authentication. "
                "Please ensure your SSH public key is added to the authorized_keys file on the remote server. "
                "Password authentication is not supported."
            )

            raise AuthenticationFailedException(
                message=user_message,
                status=ConnectionTestStates.FAILED,
            )
        except FileNotFoundError as err:
            current_app.logger.error(f"File not found: {str(err)}")
            raise RemoteConnectionException(
                status=ConnectionTestStates.FAILED,
                message=f"Unable to open path: {str(err)}",
            )
        except NoProjectsException as err:
            current_app.logger.error(f"No projects: {str(err)}")
            raise RemoteConnectionException(
                status=ConnectionTestStates.FAILED,
                message=f"No projects found at remote location: {str(err)}",
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

    return remote_handler


def local_only(f):
    from flask import current_app

    @wraps(f)
    def decorated_function(*args, **kwargs):
        if current_app.config["SERVER_MODE"]:
            abort(403, description="Endpoint not accessible")

        return f(*args, **kwargs)

    return decorated_function
