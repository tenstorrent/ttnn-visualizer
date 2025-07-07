# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import logging
import re
from ttnn_visualizer.enums import ConnectionTestStates


from functools import wraps
from flask import abort, request, session
from ttnn_visualizer.exceptions import (
    AuthenticationException,
    NoValidConnectionsError,
    SSHException,
    RemoteConnectionException,
    NoProjectsException,
    RemoteSqliteException,
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
            current_app.logger.error(f"Failed to get or create instance with ID: {instance_id}")
            abort(500)
            
        instance = instance_query_data.to_pydantic()

        kwargs["instance"] = instance

        if 'instances' not in session:
            session['instances'] = []

        if instance.instance_id not in session['instances']:
            session['instances'] = session.get('instances', []) + [instance.instance_id]

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
            current_app.logger.error(f"Authentication failed {err}")
            raise RemoteConnectionException(
                status=ConnectionTestStates.FAILED,
                message=f"Unable to authenticate: {str(err)}",
            )
        except FileNotFoundError as err:
            current_app.logger.error(f"File not found: {str(err)}")
            raise RemoteConnectionException(
                status=ConnectionTestStates.FAILED,
                message=f"Unable to open path {connection.path}: {str(err)}",
            )
        except NoProjectsException as err:
            current_app.logger.error(f"No projects: {str(err)}")
            raise RemoteConnectionException(
                status=ConnectionTestStates.FAILED,
                message=f"No projects found at remote location: {connection.path}",
            )
        except NoValidConnectionsError as err:
            current_app.logger.error(f"No valid connections: {str(err)}")
            message = re.sub(r"\[.*?]", "", str(err)).strip()
            raise RemoteConnectionException(
                status=ConnectionTestStates.FAILED,
                message=f"{message}",
            )

        except RemoteSqliteException as err:
            current_app.logger.error(f"Remote Sqlite exception: {str(err)}")
            message = err.message
            if "No such file" in str(err):
                message = "Unable to open SQLite binary, check path"
            raise RemoteConnectionException(
                status=ConnectionTestStates.FAILED, message=message
            )
        except IOError as err:
            message = f"Error opening remote folder {connection.path}: {str(err)}"
            if "Name or service not known" in str(err):
                message = f"Unable to connect to {connection.host} - check hostname"
            raise RemoteConnectionException(
                status=ConnectionTestStates.FAILED,
                message=message,
            )
        except SSHException as err:
            if str(err) == "No existing session":
                message = "Authentication failed - check credentials and ssh-agent"
            else:
                err_message = re.sub(r"\[.*?]", "", str(err)).strip()
                message = f"Error connecting to host {connection.host}: {err_message}"

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
