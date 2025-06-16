# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

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


def get_performance_path(performance_name, current_app, remote_connection=None):
    """
    Gets the path for the given performance_name.

    :param performance_name: The name of the performance directory.
    :param current_app: Flask current application object.
    :param remote_connection: Remote connection model instance

    :return: Profiler path as a string.
    """
    local_dir = Path(current_app.config["LOCAL_DATA_DIRECTORY"])
    remote_dir = Path(current_app.config["REMOTE_DATA_DIRECTORY"])

    if remote_connection:
        base_dir = Path(remote_dir).joinpath(remote_connection.host)
    else:
        base_dir = local_dir

    profiler_dir = base_dir / current_app.config["PERFORMANCE_DIRECTORY_NAME"]
    performance_path = profiler_dir / performance_name

    return str(performance_path)


def get_profiler_path(profiler_name, current_app, remote_connection=None):
    """
    Gets the report path for the given active_report object.
    :param profiler_name: The name of the report directory.
    :param current_app: Flask current application
    :param remote_connection: Remote connection model instance

    :return: profiler_path as a string
    """
    database_file_name = current_app.config["SQLITE_DB_PATH"]
    local_dir = current_app.config["LOCAL_DATA_DIRECTORY"]
    remote_dir = current_app.config["REMOTE_DATA_DIRECTORY"]

    if profiler_name:
        if remote_connection:
            base_dir = Path(remote_dir).joinpath(remote_connection.host)
        else:
            base_dir = local_dir

        profiler_path = base_dir / current_app.config["PROFILER_DIRECTORY_NAME"] / profiler_name
        target_path = profiler_path / database_file_name

        return str(target_path)
    else:
        return ""

def get_npe_path(npe_name, current_app):
    local_dir = Path(current_app.config["LOCAL_DATA_DIRECTORY"])

    npe_path = local_dir / current_app.config["NPE_DIRECTORY_NAME"]

    return str(npe_path)


def get_cluster_descriptor_path(instance):
    if not instance.profiler_path:
        return None

    cluster_descriptor_path = Path(instance.profiler_path).parent / Path("cluster_descriptor.yaml")

    if not cluster_descriptor_path.exists():
        return None

    return str(cluster_descriptor_path)


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

