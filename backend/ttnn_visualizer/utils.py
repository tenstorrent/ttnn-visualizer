# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import dataclasses
import enum
import json
import logging
from functools import wraps
from pathlib import Path
import time
import re
from timeit import default_timer
from typing import Callable, Optional, Dict, Any

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


def timer(f: Callable):
    @wraps(f)
    def wrapper(*args, **kwargs):
        start_time = default_timer()
        response = f(*args, **kwargs)
        total_elapsed_time = default_timer() - start_time
        logger.info(f"{f.__name__}: Elapsed time: {total_elapsed_time:0.4f} seconds")
        return response

    return wrapper


def get_profiler_path(profile_name, current_app, remote_connection=None):
    """
    Gets the profiler path for the given profile_name.

    :param profile_name: The name of the profiler directory.
    :param current_app: Flask current application object.
    :param report_name: Optional name of the report directory under which the profiler resides.

    :return: Profiler path as a string.
    """
    local_dir = Path(current_app.config["LOCAL_DATA_DIRECTORY"])
    remote_dir = Path(current_app.config["REMOTE_DATA_DIRECTORY"])

    # Check if there's an associated RemoteConnection
    if remote_connection:
        # Use the remote directory if a remote connection exists
        base_dir = Path(remote_dir).joinpath(remote_connection.host)
    else:
        # Default to local directory if no remote connection is present
        base_dir = local_dir

    if not remote_connection:
        profile_dir = base_dir / "profiles"
    else:
        profile_dir = base_dir / "profiler"

    # Construct the profiler path
    profiler_path = profile_dir / profile_name

    return str(profiler_path)


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
        report_path = Path(base_dir).joinpath(active_report.get("report_name"))
        target_path = str(Path(report_path).joinpath(database_file_name))

        return target_path
    else:
        return ""

def get_npe_path(npe_name, current_app):
    local_dir = Path(current_app.config["LOCAL_DATA_DIRECTORY"])

    npe_path = local_dir / "npe"

    return str(npe_path)

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


MEMORY_CONFIG_PATTERN = re.compile(r"MemoryConfig\((.*)\)$")
MEMORY_LAYOUT_PATTERN = re.compile(r"memory_layout=([A-Za-z_:]+)")
SHARD_SPEC_PATTERN = re.compile(
    r"shard_spec=ShardSpec\(grid=\{(\[.*?\])\},shape=\{(\d+),\s*(\d+)\},orientation=ShardOrientation::([A-Z_]+),halo=(\d+)\)"
)


def parse_memory_config(memory_config: Optional[str]) -> Optional[Dict[str, Any]]:
    if not memory_config:  # Handle None or empty string
        return None

    memory_config_match = MEMORY_CONFIG_PATTERN.match(memory_config)
    if not memory_config_match:
        return None

    captured_string = memory_config_match.group(1)

    memory_layout_match = MEMORY_LAYOUT_PATTERN.search(captured_string)
    memory_layout = memory_layout_match.group(1) if memory_layout_match else None

    shard_spec_match = SHARD_SPEC_PATTERN.search(captured_string)
    if shard_spec_match:
        shard_spec = {
            "grid": shard_spec_match.group(1),
            "shape": [int(shard_spec_match.group(2)), int(shard_spec_match.group(3))],
            "orientation": shard_spec_match.group(4),
            "halo": int(shard_spec_match.group(5)),
        }
    else:
        shard_spec = "std::nullopt"

    return {
        "memory_layout": memory_layout,
        "shard_spec": shard_spec,
    }


def read_version_from_package_json() -> str:
    root_directory = Path(__file__).parent.parent.parent
    file_path = root_directory / "package.json"
    try:
        with open(file_path, "r") as file:
            content = json.load(file)
            return content["version"]
    except FileNotFoundError:
        raise FileNotFoundError(f"The file {file_path} was not found.")
    except KeyError:
        raise KeyError("The 'version' key was not found in the package.json file.")
