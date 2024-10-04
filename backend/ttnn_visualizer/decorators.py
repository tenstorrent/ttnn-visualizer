from functools import wraps
from flask import request, abort
from pathlib import Path

from paramiko import AuthenticationException, SSHException
from paramiko.ssh_exception import NoValidConnectionsError
from ttnn_visualizer.remotes import logger, RemoteFolderException, NoProjectsException


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
