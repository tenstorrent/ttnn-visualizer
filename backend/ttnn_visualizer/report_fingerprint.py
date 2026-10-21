# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Tell one run in a report folder from another run later written to the same name.

Stored report links key a report by its folder name, which a re-run or a sync over
an older copy reuses (#2069). A fingerprint lets the client spot that the folder now
holds a different run. It is built from content, not mtimes: sync and upload stamp
files with the time they arrived, and a report must fingerprint the same as its
synced copy.
"""

from __future__ import annotations

import logging
import sqlite3
from functools import lru_cache
from pathlib import Path
from typing import Optional

from ttnn_visualizer.utils import newest_ops_perf_file

logger = logging.getLogger(__name__)

# Bumped when the recipe changes, so fingerprints from the old recipe read as a
# different run rather than one that happens to match.
RUN_FINGERPRINT_VERSION = "v1"

PROFILER_DATABASE_NAME = "db.sqlite"
PERFORMANCE_DEVICE_LOG_NAME = "profile_log_device.csv"
CAPTURE_TIMESTAMP_KEY = "capture_timestamp_ns"

# Listings fingerprint every folder on each request; one entry per folder state.
_FINGERPRINT_CACHE_SIZE = 1024


def profiler_run_fingerprint(report_dir: Path) -> Optional[str]:
    """Fingerprint of the memory report in ``report_dir``, or None if unreadable."""
    database_path = report_dir / PROFILER_DATABASE_NAME
    try:
        stat = database_path.stat()
    except OSError:
        return None
    # mtime only keys the cache; the value itself must survive a copy.
    return _profiler_fingerprint(
        str(database_path.resolve()), stat.st_mtime_ns, stat.st_size
    )


def performance_run_fingerprint(report_dir: Path) -> Optional[str]:
    """Fingerprint of the performance report in ``report_dir``, or None if incomplete."""
    try:
        perf_file = newest_ops_perf_file(report_dir)
        if perf_file is None:
            return None
        perf_size = perf_file.stat().st_size
        device_log_size = (report_dir / PERFORMANCE_DEVICE_LOG_NAME).stat().st_size
    except OSError:
        return None
    # Captures name the CSV after their timestamp, so the name carries the run.
    return f"{RUN_FINGERPRINT_VERSION}:{perf_file.name}:{perf_size}:{device_log_size}"


@lru_cache(maxsize=_FINGERPRINT_CACHE_SIZE)
def _profiler_fingerprint(
    database_path: str, _modified_ns: int, size: int
) -> Optional[str]:
    try:
        # as_uri() percent-encodes, so a folder name holding '?' or '#' stays a path.
        connection = sqlite3.connect(
            f"{Path(database_path).as_uri()}?mode=ro", uri=True
        )
    except sqlite3.Error:
        logger.warning("Unable to open %s to fingerprint it", database_path)
        return None
    try:
        # SQLite grows in whole pages, so two different runs often share a size;
        # the operation count separates most of them in one cheap query.
        operation_count = connection.execute(
            "SELECT COUNT(*) FROM operations"
        ).fetchone()[0]
        capture_timestamp = _read_capture_timestamp(connection)
    except sqlite3.Error:
        logger.warning("Unable to read %s to fingerprint it", database_path)
        return None
    finally:
        connection.close()
    return (
        f"{RUN_FINGERPRINT_VERSION}:{size}:{operation_count}:{capture_timestamp or ''}"
    )


def _read_capture_timestamp(connection: sqlite3.Connection) -> Optional[str]:
    # Only newer TT-NN writes report_metadata; a legacy database has no table.
    has_metadata = connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'report_metadata'"
    ).fetchone()
    if not has_metadata:
        return None
    row = connection.execute(
        "SELECT value FROM report_metadata WHERE key = ?", (CAPTURE_TIMESTAMP_KEY,)
    ).fetchone()
    return row[0] if row else None
