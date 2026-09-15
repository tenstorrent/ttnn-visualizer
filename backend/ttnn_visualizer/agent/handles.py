# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Report handles for a stateless tool surface.

The HTTP API keys reports on an `instanceId` the browser holds and `@with_instance`
resolves from the database. A tool call has neither, so a report is loaded once by
path and addressed afterwards by an opaque handle. Nothing here touches the
database or a Flask app context -- the query classes only need a path. #1995
"""

import sqlite3
from pathlib import Path
from typing import Callable, Dict, List, Optional

from ttnn_visualizer.csv_queries import (
    DeviceLogProfilerQueries,
    OpsPerformanceQueries,
)
from ttnn_visualizer.models import Instance

# The SQLite database a profiler report carries. Named here rather than imported
# because the agent surface once read no tables; its presence is what makes the
# operation, memory and tensor questions answerable, and `agent.operations`
# opens it read-only by this name. #2012
PROFILER_DB_FILE = "db.sqlite"


class UnknownHandleError(ValueError):
    """Raised when a tool is called with a handle that was never loaded."""


class ReportRegistry:
    """Process-local handle → `Instance` map.

    A cache of one would be wrong here: `diff_reports` needs two reports live at
    the same time, which is the whole point of the tool.
    """

    def __init__(self) -> None:
        self._instances: Dict[str, Instance] = {}
        self._reports: Dict[str, Dict] = {}
        self._next_id = 1

    def add(self, profiler_path: Optional[str], performance_path: Optional[str]) -> str:
        handle = f"report-{self._next_id}"
        self._next_id += 1
        self._instances[handle] = Instance(
            instance_id=handle,
            profiler_path=profiler_path,
            performance_path=performance_path,
        )
        return handle

    def get(self, handle: str) -> Instance:
        try:
            return self._instances[handle]
        except KeyError:
            known = ", ".join(sorted(self._instances)) or "none"
            raise UnknownHandleError(
                f"unknown handle {handle!r}; loaded handles: {known}"
            ) from None

    def cached_report(self, handle: str, build: Callable[[Instance], Dict]) -> Dict:
        """Generate a report once per handle.

        `generate_report` re-parses the CSV, shells through tt-perf-report and
        writes three temp files; an agent asking four questions of one report
        should pay for that once. The cache lives here rather than in a module
        global so its lifetime is the registry's — a fresh registry, in a test or
        a new session, starts empty by construction.
        """
        report = self._reports.get(handle)
        if report is None:
            report = build(self.get(handle))
            self._reports[handle] = report
        return report

    def clear(self) -> None:
        self._instances.clear()
        self._reports.clear()
        self._next_id = 1


def _resolved_directory(label: str, path: Optional[str]) -> Optional[str]:
    if path is None:
        return None
    resolved = Path(path).expanduser().resolve()
    if not resolved.is_dir():
        raise ValueError(f"{label} is not a directory: {resolved}")
    return str(resolved)


def _has_operations_table(profiler_path: Optional[str]) -> bool:
    """Whether the profiler database can actually be read, not merely that it exists.

    Presence of the file is not enough: a zero-byte `db.sqlite` opens as a valid
    empty database, so a presence check advertised all four database tools and
    then failed each with "no such table" -- the precise thing this function
    exists to avoid. One `sqlite_master` lookup is cheaper than the call an agent
    would otherwise spend finding out.
    """
    if profiler_path is None:
        return False
    db_file = Path(profiler_path, PROFILER_DB_FILE)
    if not db_file.is_file():
        return False
    try:
        connection = sqlite3.connect(f"file:{db_file}?mode=ro", uri=True)
    except sqlite3.Error:
        return False
    try:
        return (
            connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
                ("operations",),
            ).fetchone()
            is not None
        )
    except sqlite3.Error:
        # A truncated or non-SQLite file reaching this point is a broken capture,
        # and "cannot answer" is the honest inventory entry for it.
        return False
    finally:
        connection.close()


def _inventory(instance: Instance) -> Dict[str, object]:
    """What this report can actually answer.

    Reported up front because the three report kinds are independent: a Blaze-style
    run is performance-only, and an agent that assumes otherwise spends calls
    discovering it one error at a time.
    """
    available: List[str] = []
    missing: List[str] = []

    def record(name: str, present: bool) -> None:
        (available if present else missing).append(name)

    # The selector the tools actually read through, not a second glob. Picking
    # the lexicographically first file here while `get_local_ops_perf_file_path`
    # picks the newest meant `load_report` could name one capture and `top_ops`
    # analyse another in a directory holding two.
    perf_csv = None
    if instance.performance_path:
        try:
            perf_csv = Path(
                OpsPerformanceQueries.get_local_ops_perf_file_path(instance)
            )
        except Exception:
            perf_csv = None
    record("top_ops", perf_csv is not None)

    performance_path = instance.performance_path
    profiler_path = instance.profiler_path
    record(
        "zone_timings",
        performance_path is not None
        and Path(performance_path, DeviceLogProfilerQueries.DEVICE_LOG_FILE).is_file(),
    )

    # One database answers all four of these, so they are recorded together
    # rather than probed per tool: a report either carries it or carries none of
    # them.
    has_database = _has_operations_table(profiler_path)
    for tool_name in (
        "find_operations",
        "operation_detail",
        "memory_profile",
        "tensor_flow",
    ):
        record(tool_name, has_database)

    return {
        # Tool names only. `operations` used to appear here whenever a `db.sqlite`
        # was present, but no such tool was registered — so the list handed an
        # agent a name it could not call.
        "answerable": available,
        "unanswerable": missing,
        "performance_csv": perf_csv.name if perf_csv else None,
        # Kept as a key, and now empty: the database questions have tools. What
        # stays unexposed is page-level (`buffer_pages`), which is millions of rows
        # on an ordinary capture and needs a different shape than a tool response.
        "data_present_without_tools": [],
    }


def load_report(
    registry: ReportRegistry,
    profiler_path: Optional[str] = None,
    performance_path: Optional[str] = None,
) -> Dict[str, object]:
    """Register a report by path and describe what it holds."""
    if profiler_path is None and performance_path is None:
        raise ValueError("one of profiler_path or performance_path is required")

    profiler = _resolved_directory("profiler_path", profiler_path)
    performance = _resolved_directory("performance_path", performance_path)
    handle = registry.add(profiler, performance)
    instance = registry.get(handle)

    metadata: Dict[str, str] = {}
    if (
        instance.performance_path
        and Path(
            instance.performance_path, DeviceLogProfilerQueries.DEVICE_LOG_FILE
        ).is_file()
    ):
        metadata = DeviceLogProfilerQueries.read_capture_metadata(instance)

    return {
        "handle": handle,
        "profiler_path": profiler,
        "performance_path": performance,
        "capture": metadata,
        **_inventory(instance),
    }


__all__ = [
    "OpsPerformanceQueries",
    "ReportRegistry",
    "UnknownHandleError",
    "load_report",
]
