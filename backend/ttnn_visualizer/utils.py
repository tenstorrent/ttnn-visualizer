import dataclasses
import enum
import logging
from functools import wraps
from pathlib import Path
import time
from timeit import default_timer
from typing import Callable, Optional

logger = logging.getLogger(__name__)


def str_to_bool(string_value):
    return string_value.lower() in ("yes", "true", "t", "1")


@dataclasses.dataclass
class SerializeableDataclass:
    def to_dict(self) -> dict:
        # Convert the dataclass to a dictionary and handle Enums.
        return {
            key: (value.value if isinstance(value, enum.Enum) else value)
            for key, value in dataclasses.asdict(self).items()
        }


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
    :param current_app: Flask current application
    :param remote_connection: Remote connection model instance

    :return: report_path as a string
    """
    database_file_name = current_app.config["SQLITE_DB_PATH"]
    local_dir = current_app.config["LOCAL_DATA_DIRECTORY"]
    remote_dir = current_app.config["REMOTE_DATA_DIRECTORY"]

    if active_report:
        # Check if there's an associated RemoteConnection
        if remote_connection:
            # Use the remote directory if a remote connection exists
            base_dir = Path(remote_dir).joinpath(remote_connection.host)
        else:
            # Default to local directory if no remote connection is present
            base_dir = local_dir

        # Construct the full report path
        report_path = Path(base_dir).joinpath(active_report.get("name"))
        target_path = str(Path(report_path).joinpath(database_file_name))

        return target_path
    else:
        return ""


def read_last_synced_file(directory: str) -> Optional[int]:
    """Reads the '.last-synced' file in the specified directory and returns the timestamp as an integer, or None if not found."""
    last_synced_path = Path(directory) / ".last-synced"

    # Return None if the file does not exist
    if not last_synced_path.exists():
        return None

    # Read and return the timestamp as an integer
    with last_synced_path.open("r") as file:
        timestamp = int(file.read().strip())

    return timestamp


def update_last_synced(directory: Path) -> None:
    """Creates a file called '.last-synced' with the current timestamp in the specified directory."""
    # Convert directory to Path object and create .last-synced file path
    last_synced_path = Path(directory) / ".last-synced"

    # Get the current Unix timestamp
    timestamp = int(time.time())

    # Write the timestamp to the .last-synced file
    with last_synced_path.open("w") as file:
        logger.info(f"Updating last synced for directory {directory}")
        file.write(str(timestamp))
