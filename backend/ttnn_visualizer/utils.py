import dataclasses
import enum
import io
import logging
import pickle
from functools import wraps
from pathlib import Path
import time
from timeit import default_timer
from typing import Callable, Optional

import torch

logger = logging.getLogger(__name__)


LAST_SYNCED_FILE_NAME = ".last-synced"


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


def compare_tensors(tensor1, tensor2):
    """Compare two tensors and return their absolute difference."""
    if tensor1.size() != tensor2.size():
        raise ValueError("Tensors must have the same shape to be compared")

    # Compute the absolute difference
    diff_tensor = torch.abs(tensor1 - tensor2)

    # Convert the tensor to a JSON-serializable format
    diff_serializable = diff_tensor.tolist()  # Convert to a list for JSON

    return diff_serializable


def read_remote_tensor(remote_connection, remote_folder, tensor_id):
    report_path = remote_folder.remotePath
    tensors_folder = Path(report_path).joinpath("tensors")
    tensor_file_name = f"{tensor_id}.pt"
    from ttnn_visualizer.sftp_operations import read_remote_file

    tensor_content = read_remote_file(
        remote_connection, Path(tensors_folder, tensor_file_name)
    )
    if tensor_content:
        buffer = io.BytesIO(tensor_content)
        model = torch.load(buffer, map_location="cpu")
        return model


def make_torch_json_serializable(data):
    """Recursively convert PyTorch tensors and complex data structures to JSON-serializable types."""
    if isinstance(data, torch.Tensor):
        return data.tolist()  # Convert tensor to list
    elif isinstance(data, dict):
        return {key: make_torch_json_serializable(value) for key, value in data.items()}
    elif isinstance(data, list):
        return [make_torch_json_serializable(item) for item in data]
    elif isinstance(data, tuple):
        return tuple(make_torch_json_serializable(item) for item in data)
    else:
        return data  # Return the data as is if it's already JSON-serializable


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
    last_synced_path = Path(directory) / LAST_SYNCED_FILE_NAME

    # Return None if the file does not exist
    if not last_synced_path.exists():
        return None

    # Read and return the timestamp as an integer
    with last_synced_path.open("r") as file:
        timestamp = int(file.read().strip())

    return timestamp


def update_last_synced(directory: Path) -> None:
    """Creates a file called '.last-synced' with the current timestamp in the specified directory."""
    last_synced_path = Path(directory) / LAST_SYNCED_FILE_NAME

    # Get the current Unix timestamp
    timestamp = int(time.time())

    # Write the timestamp to the .last-synced file
    with last_synced_path.open("w") as file:
        logger.info(f"Updating last synced for directory {directory}")
        file.write(str(timestamp))
