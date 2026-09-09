# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Report handles for a stateless tool surface.

The HTTP API keys reports on an `instanceId` the browser holds and `@with_instance`
resolves from the database. A tool call has neither, so a report is loaded once by
path and addressed afterwards by an opaque handle. Nothing here touches the
database or a Flask app context -- the query classes only need a path. #1995
"""

from pathlib import Path
from typing import Dict, List, Optional

from ttnn_visualizer.csv_queries import (
    DeviceLogProfilerQueries,
    OpsPerformanceQueries,
)
from ttnn_visualizer.models import Instance

# The SQLite database a profiler report carries. Named here rather than imported
# because the agent surface reads no tables yet; its presence is what tells an
# agent whether the operation and tensor questions are answerable at all.
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

    def clear(self) -> None:
        self._instances.clear()
        self._next_id = 1


def _resolved_directory(label: str, path: Optional[str]) -> Optional[str]:
    if path is None:
        return None
    resolved = Path(path).expanduser().resolve()
    if not resolved.is_dir():
        raise ValueError(f"{label} is not a directory: {resolved}")
    return str(resolved)


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

    perf_csv = None
    if instance.performance_path:
        perf_csv = next(
            iter(sorted(Path(instance.performance_path).glob("ops_perf_results*.csv"))),
            None,
        )
    record("top_ops", perf_csv is not None)

    performance_path = instance.performance_path
    profiler_path = instance.profiler_path
    record(
        "zone_timings",
        performance_path is not None
        and Path(performance_path, DeviceLogProfilerQueries.DEVICE_LOG_FILE).is_file(),
    )
    record(
        "operations",
        profiler_path is not None and Path(profiler_path, PROFILER_DB_FILE).is_file(),
    )

    return {
        "answerable": available,
        "unanswerable": missing,
        "performance_csv": perf_csv.name if perf_csv else None,
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
