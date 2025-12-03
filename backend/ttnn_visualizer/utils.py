# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import dataclasses
import enum
import json
import logging
import os
import re
import shutil
import sys
import time
from functools import wraps
from pathlib import Path
from timeit import default_timer
from typing import Any, Callable, Dict, Optional

logger = logging.getLogger(__name__)

LAST_SYNCED_FILE_NAME = ".last-synced"


def get_app_data_directory(tt_metal_home: Optional[str], application_dir: str) -> str:
    """
    Calculate the APP_DATA_DIRECTORY based on TT_METAL_HOME or fallback to application_dir.

    Args:
        tt_metal_home: Path to TT-Metal home directory, or None
        application_dir: Fallback application directory path

    Returns:
        Path to the app data directory
    """
    if tt_metal_home and tt_metal_home.strip():
        return str(Path(tt_metal_home).expanduser() / "generated" / "ttnn-visualizer")
    return application_dir


def find_gunicorn_path() -> tuple[str, Optional[str]]:
    """
    Find the gunicorn executable, prioritizing the same bin directory as ttnn-visualizer.

    Returns:
        tuple: (gunicorn_path, warning_message)
            - gunicorn_path: Full path to the gunicorn executable to use
            - warning_message: Warning message if there are any issues finding gunicorn
              (e.g., multiple installations, falling back to PATH, or not found),
              or None if found without conflicts.
    """
    # Get the directory where ttnn-visualizer was run from
    ttnn_visualizer_path = Path(sys.argv[0]).resolve()
    bin_dir = ttnn_visualizer_path.parent

    # Look for gunicorn in the same directory
    expected_gunicorn = bin_dir / "gunicorn"

    if (
        expected_gunicorn.exists()
        and expected_gunicorn.is_file()
        and os.access(expected_gunicorn, os.X_OK)
    ):
        # Found gunicorn in the same bin directory and it's executable
        gunicorn_path = str(expected_gunicorn)

        # Check if there's a different gunicorn in PATH
        path_gunicorn = shutil.which("gunicorn")
        warning_message = None

        if path_gunicorn and Path(path_gunicorn).resolve() != expected_gunicorn:
            warning_message = (
                f"⚠️  WARNING: Multiple gunicorn installations detected!\n"
                f"   Using: {gunicorn_path}\n"
                f"   Found in PATH: {path_gunicorn}\n"
                f"   This may cause version conflicts. Consider using a virtual environment."
            )

        return gunicorn_path, warning_message

    # If file exists but isn't executable, add a warning about that
    if expected_gunicorn.exists() and expected_gunicorn.is_file():
        warning_message = (
            f"⚠️  WARNING: gunicorn found at {expected_gunicorn} but it's not executable!\n"
            f"   Falling back to PATH. Fix permissions with: chmod +x {expected_gunicorn}"
        )
        path_gunicorn = shutil.which("gunicorn")
        if path_gunicorn:
            return path_gunicorn, warning_message
        # If not in PATH either, return error with permission hint
        error_message = (
            f"❌ ERROR: gunicorn found at {expected_gunicorn} but it's not executable!\n"
            f"   Not found in PATH either.\n"
            f"   Fix permissions with: chmod +x {expected_gunicorn}"
        )
        return "gunicorn", error_message

    # Fall back to PATH
    path_gunicorn = shutil.which("gunicorn")

    if path_gunicorn:
        warning_message = (
            f"⚠️  WARNING: gunicorn not found in {bin_dir}\n"
            f"   Falling back to gunicorn from PATH: {path_gunicorn}\n"
            f"   This may cause issues if different versions are installed."
        )
        return path_gunicorn, warning_message

    # Not found anywhere - return "gunicorn" and let subprocess.run fail with a clear error
    warning_message = (
        f"❌ ERROR: gunicorn not found!\n"
        f"   Expected location: {expected_gunicorn}\n"
    )
    return "gunicorn", warning_message


class PathResolver:
    """Centralized path resolution for both TT-Metal and upload/sync modes."""

    def __init__(self, current_app):
        self.current_app = current_app
        self.tt_metal_home = current_app.config.get("TT_METAL_HOME")
        self.is_direct_report_mode = bool(self.tt_metal_home)

    def get_base_report_path(self, report_type: str, remote_connection=None):
        """
        Get the base path for a report type (profiler/performance).

        Args:
            report_type: Either 'profiler' or 'performance'
            remote_connection: Optional remote connection for upload/sync mode

        Returns:
            Path object to the base directory for this report type
        """
        if self.is_direct_report_mode:
            tt_metal_base = Path(self.tt_metal_home) / "generated"
            if report_type == "profiler":
                return tt_metal_base / "ttnn" / "reports"
            elif report_type == "performance":
                return tt_metal_base / "profiler" / "reports"
            else:
                raise ValueError(f"Unknown report type: {report_type}")
        else:
            # Upload/sync mode - use existing logic
            local_dir = Path(self.current_app.config["LOCAL_DATA_DIRECTORY"])
            remote_dir = Path(self.current_app.config["REMOTE_DATA_DIRECTORY"])

            if remote_connection:
                base_dir = remote_dir / remote_connection.host
            else:
                base_dir = local_dir

            if report_type == "profiler":
                return base_dir / self.current_app.config["PROFILER_DIRECTORY_NAME"]
            elif report_type == "performance":
                return base_dir / self.current_app.config["PERFORMANCE_DIRECTORY_NAME"]
            else:
                raise ValueError(f"Unknown report type: {report_type}")

    def get_profiler_path(self, profiler_name: str, remote_connection=None):
        """Get the full path to a profiler report's db.sqlite file."""
        if not profiler_name:
            return ""

        base_path = self.get_base_report_path("profiler", remote_connection)

        if self.is_direct_report_mode and not base_path.exists():
            logger.warning(f"TT-Metal profiler reports not found: {base_path}")
            return ""

        profiler_path = base_path / profiler_name
        target_path = profiler_path / self.current_app.config["SQLITE_DB_PATH"]

        return str(target_path)

    def get_performance_path(self, performance_name: str, remote_connection=None):
        """Get the full path to a performance report directory."""
        base_path = self.get_base_report_path("performance", remote_connection)

        if self.is_direct_report_mode and not base_path.exists():
            logger.warning(f"TT-Metal performance reports not found: {base_path}")
            return ""

        performance_path = base_path / performance_name
        return str(performance_path)

    def get_mode_info(self):
        """Get information about the current mode for debugging/display."""
        if self.is_direct_report_mode:
            return {
                "mode": "tt_metal",
                "tt_metal_home": self.tt_metal_home,
                "profiler_base": str(
                    Path(self.tt_metal_home) / "generated" / "ttnn" / "reports"
                ),
                "performance_base": str(
                    Path(self.tt_metal_home) / "generated" / "profiler" / "reports"
                ),
            }
        else:
            return {
                "mode": "upload_sync",
                "local_dir": str(self.current_app.config["LOCAL_DATA_DIRECTORY"]),
                "remote_dir": str(self.current_app.config["REMOTE_DATA_DIRECTORY"]),
            }

    def validate_tt_metal_setup(self):
        """Validate that TT-Metal directories exist and are accessible."""
        if not self.is_direct_report_mode:
            return True, "Not in TT-Metal mode"

        tt_metal_base = Path(self.tt_metal_home)
        if not tt_metal_base.exists():
            return False, f"TT_METAL_HOME directory does not exist: {tt_metal_base}"

        generated_dir = tt_metal_base / "generated"
        if not generated_dir.exists():
            return False, f"TT-Metal generated directory not found: {generated_dir}"

        profiler_base = self.get_base_report_path("profiler")
        performance_base = self.get_base_report_path("performance")

        messages = []
        if not profiler_base.exists():
            messages.append(f"Profiler reports directory not found: {profiler_base}")
        if not performance_base.exists():
            messages.append(
                f"Performance reports directory not found: {performance_base}"
            )

        if messages:
            return False, "; ".join(messages)

        return True, "TT-Metal setup is valid"


def str_to_bool(string_value):
    return string_value.lower() in ("yes", "true", "t", "1")


def is_running_in_container():
    """
    Detect if running inside a container (Docker, Podman, Kubernetes, etc.).

    Uses multiple detection methods for robustness:
    1. /.dockerenv file (Docker-specific, fastest check)
    2. /proc/self/cgroup contains container indicators
    3. Container-specific environment variables

    Returns:
        bool: True if running in a container, False otherwise
    """
    # Method 1: Check for /.dockerenv (Docker-specific, most common)
    if os.path.exists("/.dockerenv"):
        logger.info("Container detected via /.dockerenv file")
        return True

    # Method 2: Check cgroup for container indicators
    try:
        with open("/proc/self/cgroup", "r") as f:
            content = f.read()
            # Check for various container runtimes
            container_indicators = ["docker", "containerd", "lxc", "kubepods"]
            if any(indicator in content for indicator in container_indicators):
                logger.info(
                    f"Container detected via /proc/self/cgroup: {content[:100]}"
                )
                return True
    except (FileNotFoundError, PermissionError):
        # Not on Linux or no permission to read cgroup
        pass

    # Method 3: Check for container-specific environment variables
    container_env_vars = [
        "KUBERNETES_SERVICE_HOST",  # Kubernetes
        "KUBERNETES_PORT",  # Kubernetes
        "container",  # systemd-nspawn and others
    ]

    for env_var in container_env_vars:
        if os.getenv(env_var):
            logger.info(f"Container detected via environment variable: {env_var}")
            return True

    return False


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

    :return: Performance path as a string.
    """
    resolver = PathResolver(current_app)
    return resolver.get_performance_path(performance_name, remote_connection)


def get_profiler_path(profiler_name, current_app, remote_connection=None):
    """
    Gets the report path for the given active_report object.
    :param profiler_name: The name of the report directory.
    :param current_app: Flask current application
    :param remote_connection: Remote connection model instance

    :return: profiler_path as a string
    """
    resolver = PathResolver(current_app)
    return resolver.get_profiler_path(profiler_name, remote_connection)


def create_path_resolver(current_app):
    """Create a PathResolver instance for the current app."""
    return PathResolver(current_app)


def get_available_reports(current_app):
    """
    Get available reports in the current mode.

    Returns a dict with 'profiler' and 'performance' keys containing lists of available reports.
    This is a convenience function for views that need to discover available reports.
    """
    resolver = PathResolver(current_app)

    reports = {"profiler": [], "performance": []}

    # Get profiler reports
    try:
        profiler_base = resolver.get_base_report_path("profiler")
        if profiler_base.exists():
            for report_dir in profiler_base.iterdir():
                if report_dir.is_dir():
                    db_file = report_dir / current_app.config["SQLITE_DB_PATH"]
                    if db_file.exists():
                        reports["profiler"].append(
                            {
                                "name": report_dir.name,
                                "path": str(report_dir),
                                "modified": report_dir.stat().st_mtime,
                            }
                        )
    except Exception as e:
        logger.warning(f"Error reading profiler reports: {e}")

    # Get performance reports
    try:
        performance_base = resolver.get_base_report_path("performance")
        if performance_base.exists():
            for report_dir in performance_base.iterdir():
                if report_dir.is_dir():
                    # Check for typical performance files
                    has_perf_files = any(
                        (report_dir / filename).exists()
                        for filename in [
                            "profile_log_device.csv",
                            "tracy_profile_log_host.tracy",
                        ]
                    ) or any(report_dir.glob("ops_perf_results*.csv"))

                    if has_perf_files:
                        reports["performance"].append(
                            {
                                "name": report_dir.name,
                                "path": str(report_dir),
                                "modified": report_dir.stat().st_mtime,
                            }
                        )
    except Exception as e:
        logger.warning(f"Error reading performance reports: {e}")

    # Sort by modification time (newest first)
    reports["profiler"].sort(key=lambda x: x["modified"], reverse=True)
    reports["performance"].sort(key=lambda x: x["modified"], reverse=True)

    return reports


def get_npe_path(npe_name, current_app):
    local_dir = Path(current_app.config["LOCAL_DATA_DIRECTORY"])

    npe_path = local_dir / current_app.config["NPE_DIRECTORY_NAME"]

    return str(npe_path)


def get_cluster_descriptor_path(instance):
    if not instance.profiler_path:
        return None

    cluster_descriptor_path = Path(instance.profiler_path).parent / Path(
        "cluster_descriptor.yaml"
    )

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
