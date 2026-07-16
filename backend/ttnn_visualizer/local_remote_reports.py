# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Discover already-synced remote reports on local disk (no SSH)."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Callable, List, Optional

from ttnn_visualizer.models import RemoteConnection, RemoteReportFolder
from ttnn_visualizer.utils import read_last_synced_file

logger = logging.getLogger(__name__)

PROFILER_REQUIRED_FILES = frozenset({"db.sqlite"})
PERFORMANCE_REQUIRED_FILES = frozenset(
    {"profile_log_device.csv", "tracy_profile_log_host.tracy"}
)
PERFORMANCE_OPS_PERF_PREFIX = "ops_perf_results"


def is_valid_local_profiler_report_dir(directory: Path) -> bool:
    """True when the folder has the files needed to load a memory/profiler report."""
    return all((directory / name).is_file() for name in PROFILER_REQUIRED_FILES)


def is_valid_local_performance_report_dir(directory: Path) -> bool:
    """True when the folder has the files needed to load a performance report.

    Matches local performance folder listing / upload validation:
    profile_log_device.csv, tracy_profile_log_host.tracy, and ops_perf_results*.
    """
    if not all((directory / name).is_file() for name in PERFORMANCE_REQUIRED_FILES):
        return False
    try:
        return any(directory.glob(f"{PERFORMANCE_OPS_PERF_PREFIX}*"))
    except OSError:
        return False


def _synthetic_remote_path(configured_path: Optional[str], report_name: str) -> str:
    """Build a remotePath whose final segment is the local folder name (used by /use)."""
    if configured_path:
        return f"{configured_path.rstrip('/')}/{report_name}"
    return report_name


def list_local_synced_report_folders(
    *,
    remote_data_directory: Path,
    host: str,
    report_directory_name: str,
    configured_remote_path: Optional[str],
    is_valid_report_dir: Callable[[Path], bool],
) -> List[RemoteReportFolder]:
    """
    List report folders under REMOTE_DATA_DIRECTORY/<host>/<report_directory_name>/.

    Matches the layout written by sync_remote_*_folders / PathResolver.
    Only directories that pass ``is_valid_report_dir`` are included.
    """
    host_reports_dir = remote_data_directory / host / report_directory_name
    if not host_reports_dir.is_dir():
        logger.info("No local synced reports directory at %s", host_reports_dir)
        return []

    folders: List[RemoteReportFolder] = []
    try:
        entries = host_reports_dir.iterdir()
    except OSError:
        logger.warning("Unable to list local synced reports at %s", host_reports_dir)
        return []

    for entry in entries:
        if not entry.is_dir() or entry.name.startswith("."):
            continue
        if not is_valid_report_dir(entry):
            logger.debug("Skipping incomplete local report folder: %s", entry)
            continue

        last_synced = read_last_synced_file(str(entry))
        # Without a remote lastModified, treat synced copies as current so select
        # does not force an SSH refresh while offline.
        try:
            mtime = int(entry.stat().st_mtime)
        except OSError:
            mtime = 0
        last_modified = last_synced if last_synced is not None else mtime

        folders.append(
            RemoteReportFolder(
                reportName=entry.name,
                remotePath=_synthetic_remote_path(configured_remote_path, entry.name),
                lastModified=last_modified,
                lastSynced=last_synced,
            )
        )

    folders.sort(key=lambda folder: folder.lastModified, reverse=True)
    return folders


def list_local_synced_profiler_folders(
    connection: RemoteConnection,
    remote_data_directory: Path,
    profiler_directory_name: str,
) -> List[RemoteReportFolder]:
    if not connection.profilerPath:
        return []
    return list_local_synced_report_folders(
        remote_data_directory=remote_data_directory,
        host=connection.host,
        report_directory_name=profiler_directory_name,
        configured_remote_path=connection.profilerPath,
        is_valid_report_dir=is_valid_local_profiler_report_dir,
    )


def list_local_synced_performance_folders(
    connection: RemoteConnection,
    remote_data_directory: Path,
    performance_directory_name: str,
) -> List[RemoteReportFolder]:
    if not connection.performancePath:
        return []
    return list_local_synced_report_folders(
        remote_data_directory=remote_data_directory,
        host=connection.host,
        report_directory_name=performance_directory_name,
        configured_remote_path=connection.performancePath,
        is_valid_report_dir=is_valid_local_performance_report_dir,
    )
