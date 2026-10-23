# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Report handles for a stateless tool surface.

The HTTP API keys reports on an `instanceId` the browser holds and `@with_instance`
resolves from the database. A tool call has neither, so a report is loaded once by
path and addressed afterwards by an opaque handle. Nothing here touches the
application's database or a Flask app context -- the query classes only need a
path. (The report's own SQLite file is read, to answer what a report can
answer; that is the capture, not the app's session.) #1995
"""

import csv
import sqlite3
from collections import OrderedDict
from enum import Enum
from pathlib import Path
from typing import Callable, Dict, Hashable, List, Optional, Tuple, TypeVar, cast

from ttnn_visualizer.csv_queries import (
    PROGRAM_CACHE_HIT_COLUMN,
    PROGRAM_HASH_COLUMN,
    DeviceLogProfilerQueries,
    OpsPerformanceQueries,
)
from ttnn_visualizer.models import Instance

# The SQLite database a profiler report carries. Named here rather than imported
# because the agent surface once read no tables; its presence is what makes the
# operation, memory and tensor questions answerable, and `agent.operations`
# opens it read-only by this name. #2012
PROFILER_DB_FILE = "db.sqlite"

Cached = TypeVar("Cached")


class CacheVariant(str, Enum):
    """What a handle caches. One builder per member, which is what types the cache."""

    CANONICAL_REPORT = "canonical_report"
    OPERATION_LINK = "operation_link"
    # Which signposts the performance CSV holds, read without generating a report.
    SIGNPOSTS = "signposts"
    # The performance CSV the handle's first read came from, so a later read can
    # tell whether it is still reading the same capture.
    SOURCE = "source"
    # The detail fields no row of the whole report carries, read once per handle.
    EMPTY_DETAIL_FIELDS = "empty_detail_fields"
    # Likely DRAM fallbacks by rank, which every `operation_detail` call reads.
    DRAM_FALLBACKS = "dram_fallbacks"
    # The L1 peak replay by rank, which reads every operation and captured graph.
    L1_PEAK = "l1_peak"


# Snapshots narrowed by a scope -- a signpost range -- kept at once, across every
# handle. Each is a generated report of up to a whole report's rows, and an agent
# walking per-layer signposts asks for many, so they are evicted least recently
# used rather than pinned; an evicted range costs a full regeneration, since
# nothing underneath keeps generated dicts. Two is one `diff_reports` pair, and
# each one more holds another report's rows for the life of the process.
# The detail columns add about 3% to each, since their repeated cells are interned.
MAX_SCOPED_REPORTS = 2


class UnknownHandleError(ValueError):
    """Raised when a tool is called with a handle that was never loaded."""


class UnsharedSnapshot(Exception):
    """Raised by a builder whose snapshot only the asking handle may keep.

    A report generated with swallowed errors is one: kept under a `share_key`,
    every later handle on that capture would read it, so loading the report again
    would no longer regenerate it.
    """

    def __init__(self, snapshot: object):
        super().__init__("snapshot kept by its handle alone")
        self.snapshot = snapshot


class ReportRegistry:
    """Process-local handle → `Instance` map.

    A cache of one would be wrong here: `diff_reports` needs two reports live at
    the same time, which is the whole point of the tool.
    """

    def __init__(self) -> None:
        self._instances: Dict[str, Instance] = {}
        self._reports: Dict[Tuple[Hashable, CacheVariant], object] = {}
        self._scoped_reports: (
            "OrderedDict[Tuple[Hashable, CacheVariant, Hashable], object]"
        ) = OrderedDict()
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

    def cached_report(
        self,
        handle: str,
        build: Callable[[Instance], Cached],
        variant: CacheVariant = CacheVariant.CANONICAL_REPORT,
        scope: Hashable = None,
        share_key: Hashable = None,
    ) -> Cached:
        """Keep one report snapshot per handle, variant and scope.

        `generate_report` re-parses the CSV, shells through tt-perf-report and
        writes three temp files; an agent asking four questions of one report
        should pay for that once. This cache pins one snapshot per handle for the
        registry's lifetime: a loaded handle keeps answering from it even if the
        source changes, and a fresh registry starts empty by construction. The
        MCP server runs in its own process, so nothing here is shared with the
        HTTP app.

        `variant` keeps what is derived from the report apart from the report
        itself: the operation link reads every captured graph, so it is resolved
        once per handle beside the snapshot it was matched against.

        `scope` keeps a narrowed read of the same report -- a signpost range, see
        `tools.SignpostRange` -- apart from the whole one. Unlike the unscoped
        snapshots, scoped ones are not pinned: at most `MAX_SCOPED_REPORTS` are
        kept, least recently used first out.

        `share_key` keeps one snapshot for every handle that names the same key
        rather than one per handle. Handles are never released, so an agent that
        calls `load_report` again on an unchanged capture would otherwise pin
        another whole copy of its report each time. A key never equals a handle:
        handles are strings and the keys passed are not. A builder that raises
        `UnsharedSnapshot` has its snapshot kept under the handle instead, and
        that copy answers the handle before the shared one is asked.
        """
        owners = [handle] if share_key is None else [handle, share_key]
        for owner in owners:
            found, snapshot = self._lookup(owner, variant, scope)
            if found:
                # Each variant has one builder, so the key fixes the type it stored.
                return cast(Cached, snapshot)

        try:
            snapshot, owner = build(self.get(handle)), owners[-1]
        except UnsharedSnapshot as unshared:
            snapshot, owner = unshared.snapshot, handle
        self._store(owner, variant, scope, snapshot)
        return cast(Cached, snapshot)

    def _lookup(
        self, owner: Hashable, variant: CacheVariant, scope: Hashable
    ) -> Tuple[bool, object]:
        if scope is None:
            key = (owner, variant)
            return key in self._reports, self._reports.get(key)
        scoped_key = (owner, variant, scope)
        if scoped_key not in self._scoped_reports:
            return False, None
        self._scoped_reports.move_to_end(scoped_key)
        return True, self._scoped_reports[scoped_key]

    def _store(
        self, owner: Hashable, variant: CacheVariant, scope: Hashable, snapshot: object
    ) -> None:
        if scope is None:
            self._reports[(owner, variant)] = snapshot
            return
        self._scoped_reports[(owner, variant, scope)] = snapshot
        while len(self._scoped_reports) > MAX_SCOPED_REPORTS:
            self._scoped_reports.popitem(last=False)

    def clear(self) -> None:
        self._instances.clear()
        self._reports.clear()
        self._scoped_reports.clear()
        self._next_id = 1


def _resolved_directory(label: str, path: Optional[str]) -> Optional[str]:
    if path is None:
        return None
    resolved = Path(path).expanduser().resolve()
    if not resolved.is_dir():
        raise ValueError(f"{label} is not a directory: {resolved}")
    return str(resolved)


# The tables each database tool reads, so answerability is decided per tool
# rather than from one probe. Kept here, beside the inventory that consumes it,
# because `agent.operations` imports this module; it has to stay in step with
# the queries those tools actually run.
TOOL_TABLES: Dict[str, frozenset] = {
    # Not `stack_traces`, even though `called_from` reads it: the raw `no such
    # table` that justified requiring it cannot happen any more, because
    # `query_operation_ids_by_stack_trace` and `query_stack_traces` each guard for
    # the table now. Requiring it withdrew the name search from a capture that can
    # answer it, which is the opposite of the call made for `operation_provenance`
    # below — and that call is the better one. A `called_from` search on a capture
    # with no traces says so in its caveat instead.
    "find_operations": frozenset({"operations"}),
    "memory_profile": frozenset({"buffers", "operations"}),
    "operation_detail": frozenset(
        {"operations", "buffers", "tensors", "input_tensors", "output_tensors"}
    ),
    "tensor_flow": frozenset(
        {"operations", "tensors", "input_tensors", "output_tensors"}
    ),
    # `stack_traces` is not required, because the tool answers the argument half
    # without it and says in the response that the capture recorded no call site --
    # 8 of 86 local captures hold the table with no rows. That reasoning covers a
    # table that is empty; a table that is *absent* is handled in `queries.py`,
    # where `query_stack_traces` now guards like its neighbours rather than letting
    # SQLite's `no such table` reach the agent. #2021
    "operation_provenance": frozenset({"operations", "operation_arguments"}),
    # The errors table is optional: a report that predates it is answered with a caveat.
    "errors": frozenset({"operations"}),
    # `buffers` as the app needs it: `/api/operations` joins it for a tensor's size.
    "dram_fallbacks": frozenset(
        {
            "operations",
            "operation_arguments",
            "buffers",
            "tensors",
            "input_tensors",
            "output_tensors",
        }
    ),
    "l1_peak": frozenset(
        {
            "operations",
            "captured_graph",
            "buffers",
            "devices",
            "tensors",
            "input_tensors",
            "output_tensors",
        }
    ),
}


def _readable_tables(profiler_path: Optional[str]) -> frozenset:
    """The tables a profiler database actually holds, or nothing.

    Presence of the file is not enough, twice over. A zero-byte `db.sqlite`
    opens as a valid empty database, and a truncated capture can hold
    `operations` while missing `buffers` or `tensors` -- either way a presence
    check advertised all four tools and then failed them with "no such table",
    the precise thing this function exists to avoid. One `sqlite_master` read
    answers for every tool and is cheaper than the calls an agent would
    otherwise spend finding out.
    """
    if profiler_path is None:
        return frozenset()
    db_file = Path(profiler_path, PROFILER_DB_FILE)
    if not db_file.is_file():
        return frozenset()
    try:
        connection = sqlite3.connect(f"file:{db_file}?mode=ro", uri=True)
    except sqlite3.Error:
        return frozenset()
    try:
        return frozenset(
            name
            for (name,) in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        )
    except sqlite3.Error:
        # A truncated or non-SQLite file reaching this point is a broken capture,
        # and "cannot answer" is the honest inventory entry for it.
        return frozenset()
    finally:
        connection.close()


# Columns tt-perf-report requires before it can produce a report without exiting.
TOP_OPS_REQUIRED_COLUMNS = frozenset({"OP CODE", "OP TYPE", "DEVICE ID"})


def _csv_columns(path: Optional[Path]) -> frozenset:
    """The CSV's header names, or nothing when it cannot be read."""
    if path is None:
        return frozenset()
    try:
        with path.open(newline="") as source:
            return frozenset(next(csv.reader(source), []))
    except (OSError, UnicodeDecodeError, csv.Error):
        return frozenset()


def _scan_csv(
    path: Path, encoding: Optional[str], skip_preamble: bool
) -> Tuple[List[str], bool]:
    """The header row, and whether any non-blank line follows it."""
    with path.open(encoding=encoding, newline="") as source:
        if skip_preamble:
            source.readline()
        # Blank lines before the header are skipped, as pandas skips them.
        header = next(
            (row for row in csv.reader(source) if any(c.strip() for c in row)), []
        )
        # Read to the end rather than stopping at the first row: the tools
        # decode the whole file, so a bad byte anywhere has to be found here.
        # Line by line, so a large capture is never held in memory.
        has_data_row = False
        for line in source:
            has_data_row = has_data_row or bool(line.strip())
    return header, has_data_row


def _csv_problem(
    path: Path,
    required: frozenset,
    *,
    encoding: Optional[str] = None,
    skip_preamble: bool = False,
    strip_header: bool = False,
) -> Optional[str]:
    """Why the tool reading this CSV would fail on it, or None when it would not.

    The keywords mirror how that tool reads the file, so the check refuses
    exactly what the read would: `encoding` is what it decodes with (None is the
    locale's), `skip_preamble` drops a first line it skips, and `strip_header`
    strips header cells it strips.
    """
    try:
        header, has_data_row = _scan_csv(path, encoding, skip_preamble)
    except OSError as error:
        return f"unreadable: {error.strerror or error}"
    except UnicodeDecodeError as error:
        return f"not {error.encoding} text (byte {error.start} cannot be decoded)"
    except csv.Error as error:
        return f"malformed header: {error}"

    if not header:
        return "empty"
    if strip_header:
        header = [cell.strip() for cell in header]
    absent = required - set(header)
    if absent:
        return f"missing columns: {', '.join(sorted(absent))}"
    if not has_data_row:
        return "no data rows"
    return None


def _perf_csv_problem(path: Optional[Path]) -> Optional[str]:
    """Why tt-perf-report cannot report on this CSV, or None when it can.

    None too when there is no CSV, which `performance_csv` being null already says.
    """
    if path is None:
        return None
    return _csv_problem(path, TOP_OPS_REQUIRED_COLUMNS)


def _perf_csv(instance: Instance) -> Optional[Path]:
    """The ops perf CSV the tools read, or None when the handle has none."""
    # The selector the tools actually read through, not a second glob. Picking
    # the lexicographically first file here while `get_local_ops_perf_file_path`
    # picks the newest meant `load_report` could name one capture and `top_ops`
    # analyse another in a directory holding two.
    if not instance.performance_path:
        return None
    try:
        return Path(OpsPerformanceQueries.get_local_ops_perf_file_path(instance))
    except Exception:
        return None


def perf_csv_columns(instance: Instance) -> frozenset:
    """The header of the ops perf CSV the tools read, or nothing without one."""
    return _csv_columns(_perf_csv(instance))


def _device_log_answerable(performance_path: Optional[str]) -> bool:
    """Whether `profile_log_device.csv` decodes cleanly, has the columns `zone_timings`
    reads, and holds at least one data row. #2184"""
    if performance_path is None:
        return False
    path = Path(performance_path, DeviceLogProfilerQueries.DEVICE_LOG_FILE)
    if not path.is_file():
        return False
    # pandas decodes it as UTF-8, `__enter__` skips the `ARCH: …` line, and the
    # header's leading spaces are stripped before any column is looked up.
    problem = _csv_problem(
        path,
        DeviceLogProfilerQueries.ZONE_TIMINGS_COLUMNS,
        encoding="utf-8",
        skip_preamble=True,
        strip_header=True,
    )
    return problem is None


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

    perf_csv = _perf_csv(instance)
    perf_columns = _csv_columns(perf_csv)
    # Both tools run tt-perf-report, which needs its key columns and a data row.
    perf_csv_problem = _perf_csv_problem(perf_csv)
    perf_ready = perf_csv is not None and perf_csv_problem is None
    record("top_ops", perf_ready)
    # Older captures carry neither column, and every count would then be zero.
    record(
        "program_cache",
        perf_ready and {PROGRAM_HASH_COLUMN, PROGRAM_CACHE_HIT_COLUMN} <= perf_columns,
    )

    performance_path = instance.performance_path
    profiler_path = instance.profiler_path
    record("zone_timings", _device_log_answerable(performance_path))

    # Per tool, against the tables it reads. A partial capture can answer
    # `find_operations` and none of the rest, and saying so is the whole point
    # of this list.
    tables = _readable_tables(profiler_path)
    for tool_name, required in TOOL_TABLES.items():
        record(tool_name, required <= tables)

    return {
        # Tool names only. `operations` used to appear here whenever a `db.sqlite`
        # was present, but no such tool was registered — so the list handed an
        # agent a name it could not call.
        "answerable": available,
        "unanswerable": missing,
        "performance_csv": perf_csv.name if perf_csv else None,
        # Why `top_ops` and `program_cache` are unanswerable when a CSV is present,
        # so an agent can tell an empty capture from a corrupt one.
        "performance_csv_problem": perf_csv_problem,
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
    "perf_csv_columns",
]
