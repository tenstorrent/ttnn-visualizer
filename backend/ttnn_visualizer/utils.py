import logging
from functools import wraps
from pathlib import Path
from timeit import default_timer
from typing import Callable

logger = logging.getLogger(__name__)


def str_to_bool(string_value):
    return string_value.lower() in ("yes", "true", "t", "1")


def timer(f: Callable):
    @wraps(f)
    def wrapper(*args, **kwargs):

        start_time = default_timer()
        response = f(*args, **kwargs)
        total_elapsed_time = default_timer() - start_time
        logger.info(f"{f.__name__}: Elapsed time: {total_elapsed_time:0.4f} seconds")
        return response

    return wrapper


def get_report_path(active_report, current_app, remote_connection=None):
    """
    Gets the report path for the given active_report object.
    :param active_report: Dictionary representing the active report.
    :return: report_path as a string
    """
    database_file_name = current_app.config["SQLITE_DB_PATH"]
    local_dir = current_app.config["LOCAL_DATA_DIRECTORY"]
    remote_dir = current_app.config["REMOTE_DATA_DIRECTORY"]

    if active_report:
        # Check if there's an associated RemoteConnection
        if remote_connection:
            # Use the remote directory if a remote connection exists
            base_dir = Path(remote_dir).joinpath(remote_connection.get("host"))
        else:
            # Default to local directory if no remote connection is present
            base_dir = local_dir

        # Construct the full report path
        report_path = Path(base_dir).joinpath(active_report.get("name"))
        target_path = str(Path(report_path).joinpath(database_file_name))

        return target_path
    else:
        return ""
