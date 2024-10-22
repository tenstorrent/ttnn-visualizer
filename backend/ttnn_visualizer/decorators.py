from functools import wraps
from flask import request, abort
from pathlib import Path

from ttnn_visualizer.sessions import get_or_create_tab_session
from ttnn_visualizer.utils import get_report_path


def with_session(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        from flask import current_app

        tab_id = request.args.get("tabId")

        if not tab_id:
            current_app.logger.error("No tabId present on request, returning 404")
            abort(404)

        session_query_data = get_or_create_tab_session(tab_id=tab_id)
        session = session_query_data.to_pydantic()

        if not session.active_report:
            current_app.logger.error(
                f"No active report exists for tabId {tab_id}, returning 404"
            )
            # Raise 404 if report_path is missing or does not exist
            abort(404)

        kwargs["session"] = session
        return func(*args, **kwargs)

    return wrapper


def remote_exception_handler(func):
    def remote_handler(*args, **kwargs):
        from flask import current_app

        from paramiko.ssh_exception import AuthenticationException
        from paramiko.ssh_exception import NoValidConnectionsError
        from paramiko.ssh_exception import SSHException
        from ttnn_visualizer.exceptions import (
            RemoteFolderException,
            NoProjectsException,
        )

        connection = args[0]

        try:
            return func(*args, **kwargs)
        except (AuthenticationException, NoValidConnectionsError, SSHException) as err:
            error_type = type(err).__name__
            current_app.logger.error(
                f"{error_type} while connecting to {connection.host}: {str(err)}"
            )
            raise RemoteFolderException(status=500, message=f"{error_type}: {str(err)}")
        except (FileNotFoundError, IOError) as err:
            current_app.logger.error(
                f"Error accessing remote file at {connection.path}: {str(err)}"
            )
            raise RemoteFolderException(status=400, message=f"File error: {str(err)}")
        except NoProjectsException as err:
            current_app.logger.error(
                f"No projects found at {connection.path}: {str(err)}"
            )
            raise RemoteFolderException(status=400, message=f"No projects: {str(err)}")

    return remote_handler
