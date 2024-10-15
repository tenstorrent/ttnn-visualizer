from functools import wraps
from flask import request, abort
from pathlib import Path

from ttnn_visualizer.sessions import get_or_create_tab_session
from ttnn_visualizer.utils import get_report_path


REPORT_OVERRIDE = {
    # Name of the folder under local
    "name": "636093565"
}


def with_report_path(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        from flask import current_app

        if REPORT_OVERRIDE:
            # Add the report path to the view's arguments
            kwargs["report_path"] = get_report_path(REPORT_OVERRIDE, current_app)
            return func(*args, **kwargs)

        tab_id = request.args.get("tabId")

        if not tab_id:
            abort(404)

        session, created = get_or_create_tab_session(tab_id=tab_id)
        active_report = session.get("active_report", None)

        active_report = {
            "name" "636093565",
        }

        if not active_report:
            # Raise 404 if report_path is missing or does not exist
            abort(404)

        report_path = get_report_path(active_report, current_app)
        if not Path(report_path).exists():
            abort(404)

        # Add the report path to the view's arguments
        kwargs["report_path"] = report_path
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
