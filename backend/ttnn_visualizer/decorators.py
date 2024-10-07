from functools import wraps
from flask import request, abort
from pathlib import Path


def with_report_path(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        target_report_path = getattr(request, "report_path", None)
        if not target_report_path or not Path(target_report_path).exists():
            # Raise 404 if report_path is missing or does not exist
            abort(404)

        # Add the report path to the view's arguments
        kwargs["report_path"] = target_report_path
        return func(*args, **kwargs)

    return wrapper


from ttnn_visualizer.exceptions import RemoteFolderException, NoProjectsException


def remote_exception_handler(func):
    def remote_handler(*args, **kwargs):
        from flask import current_app

        from paramiko.ssh_exception import AuthenticationException
        from paramiko.ssh_exception import NoValidConnectionsError
        from paramiko.ssh_exception import SSHException

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
