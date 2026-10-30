# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import argparse
import csv
import io
import json
import logging
import os
import re
import sys
import tempfile
import threading
import traceback
import warnings
from array import array
from bisect import bisect_right
from collections import Counter, defaultdict
from contextlib import contextmanager, redirect_stdout
from dataclasses import dataclass, field
from functools import lru_cache
from io import StringIO
from pathlib import Path
from typing import (
    IO,
    Callable,
    Dict,
    Hashable,
    Iterable,
    Iterator,
    List,
    Literal,
    NamedTuple,
    Optional,
    Sequence,
    Set,
    Tuple,
    Union,
    cast,
    overload,
)

import _sitebuiltins
import matplotlib
import matplotlib.pyplot as plt
import numpy as np
import orjson
import pandas as pd
import zstd
from tt_perf_report import perf_report
from ttnn_visualizer.exceptions import (
    DataFormatError,
    InvalidSignpostRange,
    PerformanceReportNotLoadedException,
    PerfReportExit,
)
from ttnn_visualizer.models import Instance
from ttnn_visualizer.utils import newest_ops_perf_file

logger = logging.getLogger(__name__)

# The server only ever draws figures to files, and the default can resolve to an
# interactive GUI backend (macosx), which has no business in a web worker. Forced,
# so a user's MPLBACKEND can't change it.
matplotlib.use("Agg")


def _close_figures_opened_since(open_before: Set[int]) -> None:
    """Close the figures tt-perf-report opened and never closed (#2135).

    pyplot keeps every figure alive until it is closed. Closing only the new ones,
    rather than `plt.close("all")`, leaves figures that already existed alone. The
    figure registry is process-global, so a threaded worker could still see another
    request's figure here; the default gevent worker doesn't yield mid-generation.
    """
    for figure_number in set(plt.get_fignums()) - open_before:
        plt.close(figure_number)


class _BoundedOutput(io.TextIOBase):
    """A text sink keeping only its first `limit` characters."""

    def __init__(self, limit: int):
        self._limit = limit
        self._kept: List[str] = []
        self._size = 0
        self.dropped = 0

    def writable(self) -> bool:
        return True

    def write(self, text: str) -> int:
        room = self._limit - self._size
        if room > 0:
            self._kept.append(text[:room])
            self._size += min(len(text), room)
        self.dropped += max(0, len(text) - max(room, 0))
        return len(text)

    def getvalue(self) -> str:
        return "".join(self._kept)


# Held while `sys.stdout` points at one report's buffer. The redirect is
# process-wide, so two builds on different threads overlapping it could restore
# stdout out of order and leave it on a finished build's buffer.
_PERF_REPORT_OUTPUT_LOCK = threading.Lock()


@contextmanager
def _perf_report_output_bounded():
    """Hold tt-perf-report's printing to a bounded buffer, logged at debug level.

    Builds take turns: under the default gevent worker the library call never
    yields, so the lock is never contended; under threads they already share the
    GIL for this CPU-bound call.
    """
    output = _BoundedOutput(MAX_PERF_REPORT_OUTPUT_CHARS)
    try:
        with _PERF_REPORT_OUTPUT_LOCK, redirect_stdout(output):
            yield
    finally:
        if output.getvalue().strip():
            logger.debug("tt-perf-report output: %s", output.getvalue().strip())
        if output.dropped:
            logger.debug(
                "tt-perf-report output: %d further characters dropped", output.dropped
            )


@contextmanager
def _stacked_report_plot_skipped():
    """Stop tt-perf-report drawing the stacked-report PNG, which nothing reads.

    A closed figure still holds its canvas and renderer in a reference cycle, so its
    buffer (hundreds of MB on a large capture) lives until the cyclic GC runs; not
    drawing at all also saves most of the generation time. tt-perf-report has no
    option for this, so it clears the module's `HAS_MATPLOTLIB`, which only
    `plot_stacked_report` reads (1.5.0); the stacked CSV is written before the plot.
    The tests pin the flag, in case an upstream rename silently brings the plot back.
    """
    has_matplotlib = perf_report.HAS_MATPLOTLIB
    perf_report.HAS_MATPLOTLIB = False
    try:
        yield
    finally:
        perf_report.HAS_MATPLOTLIB = has_matplotlib


_PERF_REPORT_DIR = os.path.dirname(os.path.abspath(perf_report.__file__))

# Stdlib frames that sit between a library's call and the `SystemExit`: the `exit()`
# builtin and `ArgumentParser.error`. `sys.exit` is C, so it adds no frame.
_EXIT_HELPER_FILES = frozenset(
    os.path.abspath(path)
    for path in (_sitebuiltins.__file__, argparse.__file__)
    if path is not None
)


def _raised_by_perf_report(error: BaseException) -> bool:
    """Whether tt-perf-report's own code raised this `SystemExit`.

    Decided by the innermost frame once the stdlib exit helpers are passed over, not
    by tt-perf-report being anywhere on the stack: gunicorn's timeout handler
    (`Worker.handle_abort`) exits from a frame of its own while tt-perf-report is
    still running, and that exit must propagate. #2183
    """
    frames = traceback.extract_tb(error.__traceback__)
    while frames and os.path.abspath(frames[-1].filename) in _EXIT_HELPER_FILES:
        frames.pop()
    return bool(frames) and (
        os.path.dirname(os.path.abspath(frames[-1].filename)) == _PERF_REPORT_DIR
    )


# Cell values after NaN sanitization; matches LocalCSVQueryRunner.execute_query.
CSVCell = Optional[Union[str, float, int]]
CSVQueryResult = Union[
    List[List[CSVCell]],
    List[Dict[str, CSVCell]],
]
# Filter values are compared against the column's parsed dtype, so an int64
# column needs an int: `timer_id == "5"` matches nothing. `None` means isna().
CSVFilters = Dict[str, Optional[Union[str, int]]]

# The `OP TYPE` a `signpost()` marker carries, and the `op_type` a report row is
# given for one. Named because the agent's report link drops these rows before
# aligning, and must agree with what is written here.
SIGNPOST_OP_TYPE = "signpost"

# A report row's id is its line in the CSV: data rows count from 0, plus one for
# the header and one because lines number from 1. Report rows, the `signposts` list
# and a refusal are all numbered this way, so each names the row a reader sees.
REPORT_ROW_ID_OFFSET = 2

# Raw CSV columns a signpost is read from. tt-perf-report orders rows by the host
# start time before it resolves a signpost, unless tracing mode is on.
_OP_TYPE_COLUMN = "OP TYPE"
_OP_CODE_COLUMN = "OP CODE"
_HOST_START_COLUMN = "HOST START TS"
# Read in the same pass for the agent's `load_report`, which reports the device count.
_DEVICE_ID_COLUMN = "DEVICE ID"

# A row's program and whether the program cache held it. Older captures lack both.
PROGRAM_HASH_COLUMN = "PROGRAM HASH"
PROGRAM_CACHE_HIT_COLUMN = "PROGRAM CACHE HIT"

# The device log's timestamp, which no row may hold negative.
_CYCLES_COLUMN = "time[cycles since reset]"

# Signpost names a refusal lists. A capture can emit one per layer or iteration;
# the list is there to show a typo its neighbours, not to inventory the report.
MAX_LISTED_SIGNPOSTS = 20

# Rows per chunk when filtering a file rather than holding it. Large enough that
# the per-chunk overhead stays negligible, small enough that a ~288 MB capture
# never lands in memory whole.
CSV_CHUNK_SIZE = 50_000

# Ceiling on zone starts held open while pairing. A well-formed capture can only
# have one open per (slot, core, RISC, nesting level) at a time -- the widest
# local capture is 32 slots x 130 cores x 5 RISCs, so ~21k -- while a malformed
# one can open a zone on every row and never close it, which is 724k on that
# same file. Ten times the legitimate worst case bounds the map at roughly 40 MB
# and still cannot be reached by a real log. Past it, starts are counted rather
# than kept, so the total reports what it could pair and says what it dropped.
MAX_OPEN_ZONE_STARTS = 200_000

# Zone markers, a start and an end each, a RISC's L1 profiler buffer holds per kernel
# run beside the firmware and kernel zones' slots: PROFILER_L1_OPTIONAL_MARKER_COUNT.
L1_ZONE_MARKER_CAPACITY = 250
# The device profiler's own zones, such as a full buffer's flush partway through a run.
PROFILER_ZONE_PREFIX = "PROFILER-"
# The firmware's own zones, in slots of their own, as tt-metal's device analyses match
# them: a firmware zone wraps each run, and a kernel zone starts it.
FIRMWARE_ZONE_SUFFIX = "-FW"
KERNEL_ZONE_SUFFIX = "-KERNEL"
RESERVED_ZONE_SUFFIXES = (FIRMWARE_ZONE_SUFFIX, KERNEL_ZONE_SUFFIX)
# How a timestamped data row's `type` begins (TS_DATA and kin); it shares the buffer.
TIMESTAMPED_PHASE_PREFIX = "TS_"
# Flushes tt-metal writes only in accumulate mode, where one buffer spans several runs.
ACCUMULATE_FLUSH_ZONES = frozenset({"PROFILER-DRAM-PUSH", "PROFILER-NOC-FLUSH"})
# Ceiling on core-RISC timelines followed at once: one per slot, core and RISC, so about
# 21k on the widest local capture, where a malformed log can start one on every row.
MAX_ZONE_TIMELINES = 200_000
# Distinct zone names counted for a refusal to list; a malformed log can name every row.
MAX_COUNTED_ZONE_NAMES = 1_000

# Serialised reports kept per process. The cache is shared by every user, instance
# and comparison report the worker serves, so four entries only cover one session's
# toggle-back path (a linked report, the current view and two recent filter shapes)
# when little else is being served. The bound is on count, not bytes: a 20k-row
# report is about 22 MB of JSON, so a worker can keep roughly 90 MB alive for its
# lifetime. Each `group_by` value is its own entry with a full copy of the rows.
MAX_CACHED_PERFORMANCE_REPORTS = 4

# Ceiling on distinct `DEVICE ID`s in a performance CSV. Two tt-perf-report passes
# cost rows x devices: `merge_device_rows` walks every device for each op it
# merges, in Python, and 1.5.0's overlap sweep scans every row once per device. A
# real capture merges one op per device per pass, which is linear, but a crafted
# file giving each device its own op code makes every row a pass. Measured, such a
# row costs about 0.34 us per device on top of the ~110-175 us an honest row costs,
# so at this ceiling a crafted upload costs about twice what an honest one of the
# same size does. The upload limit bounds the size; this bounds the amplification.
# A Galaxy is 32 devices, so this is eight of them in one CSV.
MAX_PERFORMANCE_REPORT_DEVICES = 256

# tt-perf-report's output kept per report, for the debug log. It prints a warning
# per merge pass, listing every device the op is missing from, so a crafted file
# can print gigabytes; the rest is dropped.
MAX_PERF_REPORT_OUTPUT_CHARS = 64 * 1024


@dataclass
class CoreSpan:
    """One core's kernel zones for one operation, in that core's cycles.

    `start` and `end` bound every RISC's kernel on the core, which is how tt-metal
    measures `DEVICE KERNEL DURATION PER CORE`.
    """

    start: int
    end: int
    risc_cycles: Dict[str, int]

    def add(self, risc: str, start: int, end: int) -> None:
        self.start = min(self.start, start)
        self.end = max(self.end, end)
        self.risc_cycles[risc] = self.risc_cycles.get(risc, 0) + end - start


# A `(run host ID, PCIe slot)` pair: one operation's call on one device, as a perf
# row's global call count and device name it.
DeviceRun = Tuple[int, int]
# Cycles on the device's own counter, start and end inclusive.
CycleWindow = Tuple[int, int]


@dataclass(frozen=True)
class SpanRequest:
    """One perf row's kernel zones to collect: its run, and its firmware window.

    A traced op's replays share one run and slot, so the window -- the row's own
    `DEVICE FW START CYCLE` to `DEVICE FW END CYCLE` -- is what tells one replay's
    zones from the next. None takes every zone of the run, for a row without one.
    """

    run: DeviceRun
    window: Optional[CycleWindow] = None


class _RunRequests:
    """One run's requests, and which of them hold a zone.

    One device runs one op at a time, so a run's firmware windows do not overlap,
    and the one that can hold a zone is the last to start at or before it: a
    binary search, rather than a scan of every replay for every zone, which on a
    trace of a thousand replays is the difference between a read and a hang.
    """

    def __init__(self, requests: List[SpanRequest]) -> None:
        windowed = sorted(
            (request for request in requests if request.window is not None),
            key=lambda request: cast(CycleWindow, request.window),
        )
        self.starts = [cast(CycleWindow, request.window)[0] for request in windowed]
        self.windowed = windowed
        # At most one: requests are a set, and a windowless one is its run alone.
        self.whole = [request for request in requests if request.window is None]

    def holding(self, start: int, end: int) -> List[SpanRequest]:
        held = list(self.whole)
        index = bisect_right(self.starts, start) - 1
        if index >= 0:
            request = self.windowed[index]
            if end <= cast(CycleWindow, request.window)[1]:
                held.append(request)
        return held


@dataclass
class CoreSpans:
    """What `query_core_spans` read: each request's cores, and what the log held."""

    spans: Dict[SpanRequest, Dict[Tuple[int, int], CoreSpan]]
    # Every requested run with at least one paired kernel zone, inside a window or not.
    zoned: Set[DeviceRun]
    # `_ZonePairer.pairing`'s counts per run, for runs where anything failed to pair.
    pairing: Dict[DeviceRun, Dict[str, int]]
    # Kernel rows of a requested run ID that `_whole_number_rows` left out, by run host
    # ID: the slot itself may be what is broken.
    malformed: Dict[int, int]


# One core's RISC on one device: `(PCIe slot, core_x, core_y, RISC processor type)`.
RiscTimeline = Tuple[int, int, int, str]


@dataclass(slots=True)
class ZoneRepeats:
    """One zone's starts on one RISC timeline, and the cycles between them in a run."""

    occurrences: int = 0
    # Runs the zone started in, and those whose zone markers filled the L1 buffer.
    runs: int = 0
    full_runs: int = 0
    intervals: "array[int]" = field(default_factory=lambda: array("q"))


def interval_statistics(
    timelines: Iterable[ZoneRepeats],
) -> Optional[Tuple[float, int, int]]:
    """The median, min and max cycles of some timelines' intervals together."""
    cycles = [
        np.frombuffer(repeats.intervals, dtype=np.int64)
        for repeats in timelines
        if repeats.intervals
    ]
    if not cycles:
        return None
    pooled = np.concatenate(cycles)
    return float(np.median(pooled)), int(pooled.min()), int(pooled.max())


# int64 holds [-2**63, 2**63), and a float holds both ends exactly.
_INT64_END = 2.0**63
_INT64_MAX = np.uint64(2**63 - 1)
# What `_whole_number_rows` leaves out, as the caveats that count it say.
UNREADABLE_NUMBER_REASON = (
    "that is not a number or does not fit a 64-bit integer, or a negative cycle count"
)


def _fits_int64(numbers: pd.Series) -> np.ndarray:
    """Whether each cell holds an int64, checked in the column's own dtype: read as
    floats, an int64 column's top 512 values would round up to 2**63."""
    if pd.api.types.is_signed_integer_dtype(numbers):
        return np.ones(len(numbers), dtype=bool)
    if pd.api.types.is_unsigned_integer_dtype(numbers):
        return (numbers <= _INT64_MAX).to_numpy()
    # A cell that made the column floats rounded it too, so the top end is a float's.
    values = numbers.to_numpy(dtype=float)
    # NaN fails both comparisons, so a cell that is not a number is left out too.
    return (values >= -_INT64_END) & (values < _INT64_END)


def _whole_number_rows(
    chunk: pd.DataFrame, columns: Sequence[str], *, non_negative: Sequence[str]
) -> Tuple[pd.DataFrame, np.ndarray]:
    """The rows whose ``columns`` all hold int64s, none of ``non_negative`` below
    zero, those columns as int64, and the mask that chose them, so each caller counts
    the rest its own way. Two non-negative values kept differ by less than 2**63."""
    numbers = chunk[list(columns)].apply(pd.to_numeric, errors="coerce")
    readable: np.ndarray = np.ones(len(chunk), dtype=bool)
    for column in columns:
        readable &= _fits_int64(numbers[column])
    for column in non_negative:
        readable &= (numbers[column] >= 0).to_numpy()
    # A blank cell elsewhere makes pandas read a column as floats; keys stay ints.
    whole = chunk[readable].assign(
        **{column: numbers[column][readable].astype("int64") for column in columns}
    )
    return whole, readable


@dataclass(slots=True)
class _OpenRun:
    """What a RISC timeline's current run has recorded, as far as the log has read."""

    run_id: int
    # The run's place on its timeline, so one run's zones never pair another's.
    seq: int = 0
    # Zone markers since the run began or the profiler last flushed, which empties it.
    markers: int = 0
    full: bool = False
    # A profiler zone since the zone last started, which would taint the next interval.
    flush_pending: bool = False
    starts: int = 0
    last_start: Optional[int] = None


@dataclass
class ZoneIntervals:
    """What `query_zone_intervals` read of one zone."""

    timelines: Dict[RiscTimeline, ZoneRepeats]
    # Starts per zone name across the log, for a refusal to list, and whether names past
    # `MAX_COUNTED_ZONE_NAMES` went uncounted; the zone asked for is always counted.
    zone_starts: Counter
    zone_names_capped: bool
    pairing: Dict[str, int]
    # Intervals left out: across one of the profiler's own zones, or out of time order.
    across_flush: int
    out_of_order: int
    # Whether the log holds an accumulate-mode flush, which the per-run count misreads.
    accumulated: bool
    # Whether the log records timestamped data, which shares the buffer with zones.
    timestamped: bool
    # Rows that `_whole_number_rows` left out.
    malformed: int
    # Rows of timelines past `MAX_ZONE_TIMELINES`, which were not followed.
    untracked: int
    # The zone's own starts left out for either reason, which a refusal reports.
    malformed_starts: int
    untracked_starts: int


class _ZonePairer:
    """Pairs each zone start with the end that closes it, under the open-start ceiling.

    Shared by the zone queries so the pairing rule and what it counts cannot drift
    between them. A key names one zone on one physical core, RISC and run; what
    else it holds is the caller's business.
    """

    def __init__(
        self,
        start_token: str,
        end_token: str,
        group: Optional[Callable[[tuple], Hashable]] = None,
    ) -> None:
        self.start_token = start_token
        self.end_token = end_token
        self.open_starts: Dict[tuple, int] = {}
        self.unpaired_ends = 0
        self.dropped_starts = 0
        # What each count is also kept by, so a caller can read the counts of some
        # keys' groups alone -- one operation's run, say -- rather than the log's.
        self.group = group
        self.unpaired_ends_by: Counter = Counter()
        self.dropped_starts_by: Counter = Counter()

    def offer(self, key: tuple, phase: str, cycles: Union[int, float]) -> Optional[int]:
        """Take one row; return its start's cycles when the row is an end that paired."""
        if phase == self.start_token:
            if (
                len(self.open_starts) >= MAX_OPEN_ZONE_STARTS
                and key not in self.open_starts
            ):
                self.dropped_starts += 1
                if self.group is not None:
                    self.dropped_starts_by[self.group(key)] += 1
            else:
                self.open_starts[key] = int(cycles)
            return None
        if phase != self.end_token:
            return None
        start = self.open_starts.pop(key, None)
        if start is None:
            self.unpaired_ends += 1
            if self.group is not None:
                self.unpaired_ends_by[self.group(key)] += 1
        return start

    def pairing_by_group(self) -> Dict[Hashable, Dict[str, int]]:
        """`pairing`'s counts for each group that has any, without logging them."""
        assert self.group is not None, "constructed without a group"
        open_starts = Counter(self.group(key) for key in self.open_starts)
        groups = (
            set(open_starts) | set(self.unpaired_ends_by) | set(self.dropped_starts_by)
        )
        return {
            group: {
                "unmatched_starts": open_starts[group],
                "unmatched_ends": self.unpaired_ends_by[group],
                "dropped_starts": self.dropped_starts_by[group],
            }
            for group in groups
        }

    def pairing(self, log_file: str) -> Dict[str, int]:
        """What did not pair, in both directions, returned rather than only logged.

        A capture stopped mid-zone leaves *starts* open, which is the truncation
        case, and a capture whose first chunk begins mid-zone leaves ends without
        starts. Either way the figures describe only what paired, and a caller
        cannot see that from the figures themselves.
        """
        pairing = {
            "unmatched_starts": len(self.open_starts),
            "unmatched_ends": self.unpaired_ends,
            # Non-zero only past `MAX_OPEN_ZONE_STARTS`, which a well-formed
            # capture cannot reach. Reported so a bounded read is never mistaken
            # for a complete one.
            "dropped_starts": self.dropped_starts,
        }
        if any(pairing.values()):
            logger.info(
                "%s: %d zone starts and %d ends did not pair; %d starts dropped "
                "at the open-zone ceiling",
                log_file,
                pairing["unmatched_starts"],
                pairing["unmatched_ends"],
                pairing["dropped_starts"],
            )
        return pairing


@dataclass(frozen=True)
class _PerformanceReportSource:
    path: str
    modified_ns: int
    changed_ns: int
    inode: int
    size: int


@dataclass(frozen=True)
class _PerformanceReportOptions:
    start_signpost: Optional[str]
    end_signpost: Optional[str]
    print_signposts: bool
    hide_host_ops: bool
    merge_devices: bool
    tracing_mode: bool
    group_by: Optional[str]
    no_stacked_report: bool
    detail_columns: bool


class LocalCSVQueryRunner:
    def __init__(
        self,
        file_path: Union[str, Path],
        offset: int = 0,
        max_rows: Optional[int] = None,
        stream: bool = False,
        strip_columns: bool = False,
    ):
        self.file_path = file_path
        self.offset = offset
        # Only safe when the caller wants the first N rows of the file. A query
        # that filters must see every row, or it silently answers from a prefix.
        self.max_rows = max_rows
        # Load the header only and leave the rows to `execute_filtered_query`.
        # A filter still has to see every row, but it does not have to hold them
        # all at once, and the device-log routes are not `@local_only`.
        self.stream = stream
        # Device log headers carry a leading space on every field after the
        # first. Stripping here keeps `self.df` and every chunk consistent.
        self.strip_columns = strip_columns
        self.df: Optional[pd.DataFrame] = None

    def __enter__(self):
        # Load the CSV file
        try:
            self.df = pd.read_csv(
                self.file_path,
                skiprows=self.offset,
                nrows=0 if self.stream else self.max_rows,
            )
        except (pd.errors.EmptyDataError, pd.errors.ParserError) as error:
            raise self._unparseable(error) from error

        if self.strip_columns:
            self.df.columns = self.df.columns.str.strip()
        return self

    def _unparseable(self, error: Exception) -> DataFormatError:
        """A truncated or ragged file is the caller's data, not a server fault.

        `pd.read_csv` raises `EmptyDataError` for a header-only capture and
        `ParserError` for a ragged one. Left to propagate they reach the
        catch-all as a 500 with a traceback, which is both the wrong status and
        a log the caller controls. See #1946.
        """
        return DataFormatError(
            f"{Path(self.file_path).name} could not be parsed: {error}"
        )

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.df = None

    def get_csv_header(self) -> Dict[str, int]:
        if self.df is None:
            raise RuntimeError(
                "DataFrame is not loaded. Ensure the runner is used within a context."
            )
        return {col: idx + 1 for idx, col in enumerate(self.df.columns)}

    def execute_query(
        self,
        columns: Optional[List[str]] = None,
        filters: Optional[CSVFilters] = None,
        as_dict: bool = False,
        limit: Optional[int] = None,
    ) -> CSVQueryResult:
        """
        Executes a query on the loaded DataFrame with optional limit.
        :param columns: List of columns to select.
        :param filters: Dictionary of column-value pairs to filter the rows.
        :param as_dict: Whether to return results as a list of dictionaries.
        :param limit: Maximum number of rows to return.
        :return: List of lists or dictionaries containing the result rows.
        """
        if self.df is None:
            raise RuntimeError(
                "DataFrame is not loaded. Ensure the runner is used within a context."
            )

        if self.stream:
            raise RuntimeError(
                "This runner holds only the header. Use execute_filtered_query()."
            )

        df_filtered = self._apply_filters(self.df, filters)

        # Select specified columns
        if columns:
            result_df = df_filtered[columns]
        else:
            result_df = df_filtered

        # Apply limit if specified
        if limit is not None:
            result_df = result_df.head(limit)

        return self._as_result(result_df, as_dict)

    def execute_filtered_query(
        self,
        filters: CSVFilters,
        columns: Optional[List[str]] = None,
        as_dict: bool = False,
        limit: Optional[int] = None,
    ) -> CSVQueryResult:
        """Filter the file a chunk at a time, holding only what matched.

        `execute_query` filters a frame that is already resident, so its peak
        cost is the whole file plus a copy of every matching row -- on a real
        capture, ~288 MB plus a 200k-row copy to answer with 100 rows. This
        reads `CSV_CHUNK_SIZE` rows at a time and stops as soon as `limit` rows
        have matched, so a zone that matches early never pays for the rest of
        the file. Without a `limit` it still reaches EOF, but only the matches
        accumulate. See #1946.
        """
        frames: List[pd.DataFrame] = []
        collected = 0

        try:
            chunks = pd.read_csv(
                self.file_path, skiprows=self.offset, chunksize=CSV_CHUNK_SIZE
            )
            for chunk in chunks:
                if self.strip_columns:
                    chunk.columns = chunk.columns.str.strip()

                matched = self._apply_filters(chunk, filters)
                if limit is not None:
                    matched = matched.head(limit - collected)

                if not matched.empty:
                    frames.append(matched)
                    collected += len(matched)

                if limit is not None and collected >= limit:
                    break
        except (pd.errors.EmptyDataError, pd.errors.ParserError) as error:
            raise self._unparseable(error) from error

        if not frames:
            return []

        result_df = pd.concat(frames)
        if columns:
            result_df = result_df[columns]

        return self._as_result(result_df, as_dict)

    @staticmethod
    def _apply_filters(df: pd.DataFrame, filters: Optional[CSVFilters]) -> pd.DataFrame:
        """Narrow `df` to the rows matching every column-value pair."""
        if not filters:
            return df

        for col, value in filters.items():
            if value is None:
                df = df[df[col].isna()]
            else:
                df = df[df[col] == value]

        return df

    @staticmethod
    def _as_result(result_df: pd.DataFrame, as_dict: bool) -> CSVQueryResult:
        """Sanitize NaN to None and shape the rows for the caller."""
        sanitized_df = result_df.applymap(lambda x: None if pd.isna(x) else x)

        if as_dict:
            sanitized_columns = {
                col: col.replace(" ", "_") for col in sanitized_df.columns
            }
            sanitized_df = sanitized_df.copy()
            sanitized_df.rename(columns=sanitized_columns, inplace=True)
            return sanitized_df.to_dict(orient="records")

        return sanitized_df.values.tolist()


class NPEQueries:
    NPE_FOLDER = "npe_viz"
    MANIFEST_FILE = "manifest.json"

    @staticmethod
    def get_npe_manifest(instance: Instance):
        if not instance.performance_path:
            raise PerformanceReportNotLoadedException()
        file_path = Path(
            instance.performance_path,
            NPEQueries.NPE_FOLDER,
            NPEQueries.MANIFEST_FILE,
        )
        with open(file_path, "r") as f:
            return json.load(f)

    @staticmethod
    def get_npe_timeline(instance: Instance, filename: str):
        if not filename:
            raise ValueError("filename is required")

        if not instance.performance_path:
            raise PerformanceReportNotLoadedException()

        file_path = Path(instance.performance_path, NPEQueries.NPE_FOLDER, filename)

        if filename.endswith(".zst"):
            with open(file_path, "rb") as file:
                compressed_data = file.read()
                uncompressed_data = zstd.uncompress(compressed_data)
                return json.loads(uncompressed_data)
        else:
            with open(file_path, "r") as f:
                return json.load(f)


class DeviceLogMeta(NamedTuple):
    """What `/api/performance/device-log/meta` serves of the device log's first line."""

    architecture: Optional[str] = None
    frequency: Optional[int] = None
    # Null on captures whose first line names no count, which most older ones are.
    max_cores: Optional[int] = None


# Searched for anywhere on the line, so a missing comma or a leading BOM still reads. A
# number of ten digits or more is no count, rather than an int too long to parse.
_META_ARCHITECTURE = re.compile(r"ARCH:\s*([\w\d_]+)")
_META_FREQUENCY = re.compile(r"CHIP_FREQ\[MHz\]:\s*(\d{1,9})(?!\d)")
_META_MAX_CORES = re.compile(r"Max Compute Cores:\s*(\d{1,9})(?!\d)")
# The meta reads only the first line, and a log with no newline must not be read whole.
_META_LINE_LIMIT = 65536


def parse_device_meta(line: str) -> DeviceLogMeta:
    """The architecture, clock and core count a device log's first line names."""
    architecture = _META_ARCHITECTURE.search(line)
    frequency = _META_FREQUENCY.search(line)
    max_cores = _META_MAX_CORES.search(line)
    return DeviceLogMeta(
        architecture=architecture.group(1) if architecture else None,
        frequency=int(frequency.group(1)) if frequency else None,
        max_cores=int(max_cores.group(1)) if max_cores else None,
    )


class DeviceLogProfilerQueries:
    DEVICE_LOG_FILE = "profile_log_device.csv"
    # What the zone queries index, in the order they index it: they read each row
    # by position, so the order is part of the contract.
    _ZONE_COLUMNS = (
        "zone name",
        "RISC processor type",
        "PCIe slot",
        "core_x",
        "core_y",
        "run host ID",
        _CYCLES_COLUMN,
    )
    # The same columns as a set to check a header against. Kept apart from
    # REQUIRED_DEVICE_LOG_COLUMNS because only the zone queries need them; see the
    # comment in `_zone_phase` before folding the two together.
    ZONE_SUMMARY_COLUMNS = frozenset(_ZONE_COLUMNS)
    # The columns the span and interval readers hold as whole numbers.
    _WHOLE_NUMBER_COLUMNS = (
        "PCIe slot",
        "core_x",
        "core_y",
        "run host ID",
        _CYCLES_COLUMN,
    )
    # The column that marks a zone's start and end, with its two tokens, in the
    # order one is preferred when a capture has both. Two spellings of the same
    # fact, neither required: a current capture writes `type` as ZONE_START /
    # ZONE_END, and a pre-rename one `zone phase` as begin/end (`PRE_RENAME_HEADER`
    # pins that shape). The agent inventory reads this too, so it never lists a
    # log `core_spread` or `zone_intervals` would refuse.
    ZONE_PHASE_TOKENS: Dict[str, Tuple[str, str]] = {
        "type": ("ZONE_START", "ZONE_END"),
        "zone phase": ("begin", "end"),
    }
    # Only the columns something downstream depends on. Everything else in the
    # file is passed through untouched, because which columns exist varies by
    # producer and gating on them rejects captures that work fine: the segformer
    # demo reports have no "meta data", the smoke fixture has no "run ID", and a
    # current tt-metal adds "trace id" / "trace id counter" that none of the
    # others have.
    REQUIRED_DEVICE_LOG_COLUMNS = [
        "timer_id",  # query_by_timer_id filters on it
        "zone name",  # query_zone_statistics filters on it
        # No query here reads this one. It is the join key back to
        # `ops_perf_results` (#1941), and `PerformanceLog` declares it required,
        # so a capture without it would be served to a client expecting it.
        "run host ID",
    ]
    # Every column `zone_timings` needs: `__enter__` refuses a log without the
    # required ones, and `query_zone_summary` then groups by the rest. The agent
    # inventory checks this set so it never lists a log the tool would refuse.
    ZONE_TIMINGS_COLUMNS = frozenset(REQUIRED_DEVICE_LOG_COLUMNS) | ZONE_SUMMARY_COLUMNS

    # The `type` column's vocabulary, as tt-metal writes it. Deliberately not
    # required -- older captures predate the column -- but pinned here so the
    # fixture tests have one list to check against rather than a copy each.
    # `scripts/smoke_test.py` keeps its own copy because it does not import
    # this package.
    DEVICE_LOG_ENTRY_TYPES = frozenset({"ZONE_START", "ZONE_END", "TS_DATA"})

    def __init__(
        self,
        instance: Instance,
        max_rows: Optional[int] = None,
        stream: bool = False,
    ):
        """Read the device log for ``instance``.

        ``max_rows`` stops `pd.read_csv` short. A real capture is ~724k rows and
        ~288 MB parsed, so a route that only ever serves the first N rows should
        pass it. A route that filters must not: `query_zone_statistics` has to
        see the whole file to know what matched.

        ``stream`` is what such a route passes instead. The header is loaded so
        the columns can still be validated, and `query_zone_statistics` walks
        the rows in chunks rather than holding them. See #1946.
        """
        self.instance = instance
        self.max_rows = max_rows
        self.stream = stream
        self.runner: Optional[LocalCSVQueryRunner] = None

    def __enter__(self):
        """
        Determine the appropriate query runner based on the instance's remote connection.
        """
        if not self.instance.performance_path:
            raise PerformanceReportNotLoadedException()
        self.runner = LocalCSVQueryRunner(
            file_path=Path(self.instance.performance_path).joinpath(
                self.DEVICE_LOG_FILE
            ),
            offset=1,  # Skip the first line for device log files
            max_rows=self.max_rows,
            stream=self.stream,
            # Every field after the first carries a leading space in the header.
            strip_columns=True,
        )

        self.runner.__enter__()

        self._require_columns(self.runner.df)

        return self

    def _require_columns(self, df: pd.DataFrame) -> None:
        """Refuse a capture whose header is missing a column we name.

        Serving a short row is how #1941 went unnoticed: the header used to be
        overwritten positionally, so a file with the right column *count* was
        relabelled rather than rejected.
        """
        missing = [
            column
            for column in self.REQUIRED_DEVICE_LOG_COLUMNS
            if column not in df.columns
        ]
        if missing:
            raise DataFormatError(
                f"{self.DEVICE_LOG_FILE} is missing expected columns: "
                f"{', '.join(missing)}"
            )

    def __exit__(self, exc_type, exc_val, exc_tb):
        """
        Ensure resources are cleaned up when exiting the context.
        """
        if self.runner:
            self.runner.__exit__(exc_type, exc_val, exc_tb)

    def query_by_timer_id(self, timer_id: int, as_dict: bool = False) -> CSVQueryResult:
        """Filter rows by a specific timer_id.

        `timer_id` is an int64 column, so this takes an `int`: comparing it
        against a `str` silently matched nothing.
        """
        if self.runner is None:
            raise RuntimeError(
                "DeviceLogProfilerQueries must be used as a context manager"
            )
        return self.runner.execute_query(
            columns=[],
            filters={"timer_id": timer_id},
            as_dict=as_dict,
        )

    def query_zone_statistics(
        self, zone_name: str, as_dict: bool = False, limit: Optional[int] = None
    ) -> CSVQueryResult:
        """
        Example query: Retrieve statistics for a specific zone name.
        """
        if self.runner is None:
            raise RuntimeError(
                "DeviceLogProfilerQueries must be used as a context manager"
            )
        # Chunked: a single zone matches 200k+ rows on a real capture, and the
        # route is reachable by anyone under SERVER_MODE.
        return self.runner.execute_filtered_query(
            filters={"zone name": zone_name},
            as_dict=as_dict,
            limit=limit,
        )

    @overload
    def get_all_entries(
        self, as_dict: Literal[False] = False, limit: Optional[int] = None
    ) -> List[List[CSVCell]]: ...

    @overload
    def get_all_entries(
        self, as_dict: Literal[True], limit: Optional[int] = None
    ) -> List[Dict[str, CSVCell]]: ...

    def get_all_entries(
        self, as_dict: bool = False, limit: Optional[int] = None
    ) -> CSVQueryResult:
        """
        Fetch all entries from the device log.
        """
        if self.runner is None:
            raise RuntimeError(
                "DeviceLogProfilerQueries must be used as a context manager"
            )
        return self.runner.execute_query(columns=None, as_dict=as_dict, limit=limit)

    @classmethod
    def read_capture_metadata(cls, instance: Instance) -> Dict[str, str]:
        """The `ARCH: …, CHIP_FREQ[MHz]: …` line every device log opens with.

        `__enter__` skips it (`offset=1`) because pandas would read it as a
        header, so the only way to the clock is to read the line directly — and
        without the clock a cycle count cannot be turned into a duration.

        An unreadable file, or a first line that is not UTF-8, gives `{}` rather
        than raising: the clock is then unknown, and callers must treat it so.
        A broken device log must not fail `load_report` for a capture whose ops
        perf CSV is fine. #2184
        """
        if not instance.performance_path:
            raise PerformanceReportNotLoadedException()
        path = Path(instance.performance_path, cls.DEVICE_LOG_FILE)
        try:
            with open(path, "rb") as handle:
                first_line = handle.readline(_META_LINE_LIMIT).decode("utf-8")
        except (OSError, UnicodeDecodeError):
            return {}

        metadata: Dict[str, str] = {}
        for field in first_line.split(","):
            key, separator, value = field.partition(":")
            if separator:
                metadata[key.strip()] = value.strip()
        return metadata

    def _zone_phase(self, purpose: str) -> Tuple[Optional[str], str, str]:
        """Check the columns the zone queries index, and pick the phase spelling.

        Returns the column that marks a zone's start and end with its two tokens,
        or `(None, "", "")` for a capture that marks neither.
        """
        if self.runner is None:
            raise RuntimeError(
                "DeviceLogProfilerQueries must be used as a context manager"
            )

        # Checked here rather than added to `REQUIRED_DEVICE_LOG_COLUMNS`: that
        # list gates every route, and its comment records that gating on columns
        # a query does not read rejects captures which work fine. These are the
        # ones the zone queries index, so a capture missing one fails here with a
        # reason instead of a `KeyError` mid-parse.
        available = set(self.runner.df.columns if self.runner.df is not None else [])
        missing = sorted(self.ZONE_SUMMARY_COLUMNS - available)
        if missing:
            raise DataFormatError(
                f"{self.DEVICE_LOG_FILE} cannot be {purpose}; missing: "
                f"{', '.join(missing)}"
            )

        # Reading only `type` counted a pre-rename begin *and* its end as two
        # occurrences and discarded the duration between them -- one invocation
        # reported as two, which is worse than reporting none.
        for column, (start_token, end_token) in self.ZONE_PHASE_TOKENS.items():
            if column in available:
                return column, start_token, end_token
        return None, "", ""

    def _required_zone_phase(self, purpose: str, needs: str) -> Tuple[str, str, str]:
        """`_zone_phase` for a query that cannot read a log without one: ``needs`` says
        what the log then lacks."""
        phase_column, start_token, end_token = self._zone_phase(purpose)
        if phase_column is None:
            raise DataFormatError(
                f"{self.DEVICE_LOG_FILE} marks no zone starts or ends (neither a "
                f"`type` nor a `zone phase` column), so {needs}"
            )
        return phase_column, start_token, end_token

    def _zone_chunks(self, columns: List[str]) -> Iterator[pd.DataFrame]:
        """The log in `CSV_CHUNK_SIZE` chunks, holding only ``columns``.

        A parse failure surfaces while iterating, so it is turned into the
        runner's `DataFormatError` here rather than in each caller's loop.
        """
        runner = self.runner
        assert runner is not None, "checked by `_zone_phase`"
        wanted = set(columns)
        try:
            chunks = pd.read_csv(
                runner.file_path,
                skiprows=runner.offset,
                chunksize=CSV_CHUNK_SIZE,
                # The header carries a leading space on every field after the
                # first, so the names are matched stripped.
                usecols=lambda name: name.strip() in wanted,
            )
            for chunk in chunks:
                chunk.columns = chunk.columns.str.strip()
                yield chunk
        except (pd.errors.EmptyDataError, pd.errors.ParserError) as error:
            raise runner._unparseable(error) from error

    @classmethod
    def device_log_path(cls, instance: Instance) -> Optional[Path]:
        """The report's device log, or None where it has none: a directory is none."""
        if not instance.performance_path:
            return None
        path = Path(instance.performance_path, cls.DEVICE_LOG_FILE)
        return path if path.is_file() else None

    @classmethod
    def read_device_meta(cls, instance: Instance) -> Optional[DeviceLogMeta]:
        """The device log's first line as `/api/performance/device-log/meta` reads it,
        or None where the report has no device log.

        The route and the agent's flags read the device's core count through this one
        reader, so they cannot disagree about a device. Decoded leniently: a stray byte
        anywhere in the first block of the file must not cost the line.
        """
        path = cls.device_log_path(instance)
        if path is None:
            return None
        with open(path, "r", encoding="utf-8", errors="ignore") as handle:
            return parse_device_meta(handle.readline(_META_LINE_LIMIT).strip())

    @classmethod
    def clock_mhz(cls, instance: Instance) -> Optional[int]:
        """The device clock the log's first line names, or None where it names none.

        A zero clock is none: no cycle count can be read as time against it. The
        agent's inventory, `core_spread` and `zone_intervals` all ask this, so each
        tool is listed exactly when it can read cycles as time.
        """
        meta = cls.read_device_meta(instance)
        return meta.frequency if meta is not None and meta.frequency else None

    def query_zone_summary(self) -> Tuple[List[Dict[str, object]], Dict[str, int]]:
        """Aggregate the whole log into one row per (zone, RISC).

        The two existing zone queries both need you to already know the zone you
        are looking for — `query_zone_statistics` takes a name and
        `query_by_timer_id` takes an id. Nothing answers "what is in this
        capture", which is the first question anyone asks of a log they did not
        produce, so an agent handed this file has no way in.

        Durations come from pairing each `ZONE_START` with the `ZONE_END` that
        closes it on the same physical core, RISC and run. The open starts are
        held in a dict rather than the rows, so a pair split across two chunks
        still matches and peak memory tracks concurrently-open zones (tens)
        rather than the file (~288 MB, ~724k rows). Cycles are a per-core
        counter, so a difference is only meaningful within one core — which is
        what the pairing key has to guarantee.

        A core is `(PCIe slot, core_x, core_y)`, not `(core_x, core_y)`: the two
        captures in `reports/` span 32 and 8 slots, so coordinates alone collide
        across devices and one device's start would close against another's end.

        Returns the summary and a count of what did not pair. A truncated
        capture leaves starts open, which is invisible in a total that reports
        only what matched.
        """
        phase_column, start_token, end_token = self._zone_phase("summarised by zone")

        occurrences: Dict[tuple, int] = defaultdict(int)
        cycle_totals: Dict[tuple, int] = defaultdict(int)
        cores_seen: Dict[tuple, set] = defaultdict(set)
        zone_keys: List[tuple] = []
        pairer = _ZonePairer(start_token, end_token)

        columns = list(self._ZONE_COLUMNS) + ([phase_column] if phase_column else [])

        for chunk in self._zone_chunks(columns):
            # Zipped column-wise rather than `itertuples`, which renames any
            # field that is not a valid identifier -- "zone name" arrives as
            # `_1` and every lookup by name silently misses.
            for values in zip(*(chunk[column] for column in columns)):
                zone = str(values[0]).strip()
                if not zone or zone == "nan":
                    continue
                risc = str(values[1]).strip()
                cycles = values[6]
                phase = str(values[7]).strip() if phase_column else ""

                zone_key = (zone, risc)
                if zone_key not in cores_seen:
                    zone_keys.append(zone_key)
                # Slot included: coordinates repeat on every device.
                core = (values[2], values[3], values[4])
                cores_seen[zone_key].add(core)

                if not phase_column:
                    occurrences[zone_key] += 1
                    continue

                start = pairer.offer((zone, risc, core, values[5]), phase, cycles)
                if start is None:
                    continue

                occurrences[zone_key] += 1
                cycle_totals[zone_key] += int(cycles) - start

        summary = []
        for zone, risc in zone_keys:
            zone_key = (zone, risc)
            count = occurrences[zone_key]
            total_cycles = cycle_totals[zone_key]
            summary.append(
                {
                    "zone": zone,
                    "risc": risc,
                    "occurrences": count,
                    "cores": len(cores_seen[zone_key]),
                    "total_cycles": total_cycles if phase_column else None,
                    "mean_cycles": (
                        round(total_cycles / count, 1)
                        if phase_column and count
                        else None
                    ),
                }
            )

        # Costliest first: the reason to ask is to find where the time went. A
        # capture with neither boundary column has no durations to sort on, so it
        # falls back to the count.
        summary.sort(
            key=lambda entry: (
                int(entry["total_cycles"] or 0),
                int(entry["occurrences"] or 0),
            ),
            reverse=True,
        )

        pairing = pairer.pairing(self.DEVICE_LOG_FILE)
        return summary, pairing

    def query_core_spans(self, requests: Set[SpanRequest]) -> CoreSpans:
        """Each core's kernel zones for the given perf rows' runs and windows.

        A perf row's `GLOBAL CALL COUNT` is the `run host ID` of its zones, and its
        `DEVICE ID` is their `PCIe slot`. Keying on both keeps one device's cores
        apart from another's, whose cycle counters are not comparable. Neither
        tells a traced op's replays apart, nor one capture's run from another's
        that reused its call counts, so a request with a firmware window takes
        only the zones inside it: that reproduces tt-metal's per-core figures on
        traced captures, and a log beside another run's perf CSV leaves the
        window empty.

        Rows of other runs are dropped a chunk at a time before pairing, so the
        open starts held are only the requested runs'. Pairing counts are kept per
        run, so a caller reads only its own operations'. A kernel row whose slot,
        core or cycles `_whole_number_rows` cannot read is left out and counted
        rather than failing every operation's read.
        """
        # Spread is a spread of durations, and without a phase there are none.
        phase_column, start_token, end_token = self._required_zone_phase(
            "split into per-core kernel spans", "it holds no kernel durations"
        )

        spans: Dict[SpanRequest, Dict[Tuple[int, int], CoreSpan]] = {
            request: {} for request in requests
        }
        by_run: Dict[DeviceRun, List[SpanRequest]] = defaultdict(list)
        for request in requests:
            by_run[request.run].append(request)
        lookup = {run: _RunRequests(wanted) for run, wanted in by_run.items()}
        zoned: Set[DeviceRun] = set()
        malformed: Counter = Counter()
        run_ids = {run_id for run_id, _ in by_run}
        # The key ends `(…, slot, x, y, run_id)`; its run is the run ID and slot.
        pairer = _ZonePairer(
            start_token, end_token, group=lambda key: (key[-1], key[2])
        )
        columns = list(self._ZONE_COLUMNS) + [phase_column]

        for chunk in self._zone_chunks(columns):
            # A run cell that is not a number makes pandas read the chunk's run IDs
            # as strings, which match no requested run, so they are read as numbers
            # first: the stray cell, not its chunk, is what is left out.
            chunk = chunk.assign(
                **{"run host ID": pd.to_numeric(chunk["run host ID"], errors="coerce")}
            )
            # The run filter first: it is a numeric hash test, and it leaves the
            # string work below the requested runs' rows.
            chunk = chunk[chunk["run host ID"].isin(run_ids)]
            # BRISC-, NCRISC- and TRISC-KERNEL: the firmware zones wrap them, and
            # tt-metal's per-core figures read the kernels.
            chunk = chunk[
                chunk["zone name"]
                .astype(str)
                .str.strip()
                .str.endswith(KERNEL_ZONE_SUFFIX)
            ]
            whole, readable = _whole_number_rows(
                chunk, self._WHOLE_NUMBER_COLUMNS, non_negative=(_CYCLES_COLUMN,)
            )
            if not readable.all():
                malformed.update(chunk["run host ID"][~readable].astype(int).tolist())
            chunk = whole
            for zone, risc, slot, x, y, run_id, cycles, phase in zip(
                *(chunk[column].tolist() for column in columns)
            ):
                run = (run_id, slot)
                wanted = lookup.get(run)
                if wanted is None:
                    continue
                risc = str(risc).strip()
                start = pairer.offer(
                    (str(zone).strip(), risc, slot, x, y, run_id),
                    str(phase).strip(),
                    cycles,
                )
                if start is None:
                    continue
                end = cycles
                zoned.add(run)
                for request in wanted.holding(start, end):
                    cores = spans[request]
                    span = cores.setdefault((x, y), CoreSpan(start, end, {}))
                    span.add(risc, start, end)

        pairer.pairing(self.DEVICE_LOG_FILE)
        return CoreSpans(
            spans=spans,
            zoned=zoned,
            pairing=cast(Dict[DeviceRun, Dict[str, int]], pairer.pairing_by_group()),
            malformed=dict(malformed),
        )

    def query_zone_intervals(self, zone: str) -> ZoneIntervals:
        """Cycles from each start of ``zone`` to its next in one run, per RISC timeline.

        tt-metal writes each RISC's markers in time order, so a run ends as its rows
        arrive: at a kernel start, which also parts a traced op's replays, or a new run
        host ID. The trace columns are not read: they can change partway through a run.
        """
        phase_column, start_token, end_token = self._required_zone_phase(
            "read for zone intervals", "no zone start can be told apart"
        )
        columns = list(self._ZONE_COLUMNS) + [phase_column]
        # Each kept row's flags ride beside its cells, named apart from any log column.
        row_columns = [*columns, "_kernel_start", "_marker", "_flush"]

        timelines: Dict[RiscTimeline, ZoneRepeats] = {}
        open_runs: Dict[RiscTimeline, _OpenRun] = {}
        zone_starts: Counter = Counter()
        pairer = _ZonePairer(start_token, end_token)
        across_flush = out_of_order = malformed = untracked = 0
        malformed_starts = untracked_starts = displaced = 0
        accumulated = timestamped = zone_names_capped = False
        # A firmware or kernel zone has its own slot, so a full buffer never cuts it.
        reserved_zone = zone.endswith(RESERVED_ZONE_SUFFIXES)
        # A firmware zone starts before the kernel start that opens its run, so it pairs
        # by run host ID; any other zone pairs within its own run.
        firmware_zone = zone.endswith(FIRMWARE_ZONE_SUFFIX)

        def close(timeline: RiscTimeline, run: _OpenRun) -> None:
            if not run.starts:
                return
            repeats = timelines[timeline]
            repeats.runs += 1
            if run.full and not reserved_zone:
                repeats.full_runs += 1

        for chunk in self._zone_chunks(columns):
            names = chunk["zone name"].astype(str).str.strip()
            phases = chunk[phase_column].astype(str).str.strip()
            starts = phases == start_token
            timestamped = timestamped or (
                not reserved_zone
                and bool(phases.str.startswith(TIMESTAMPED_PHASE_PREFIX).any())
            )
            for name, count in names[starts].value_counts().items():
                if (
                    name == zone
                    or name in zone_starts
                    or len(zone_starts) < MAX_COUNTED_ZONE_NAMES
                ):
                    zone_starts[name] += count
                else:
                    zone_names_capped = True
            # Firmware and kernel zones have slots of their own, outside the L1 cap.
            reserved = names.str.endswith(RESERVED_ZONE_SUFFIXES)
            kernel_starts = names.str.endswith(KERNEL_ZONE_SUFFIX) & starts
            markers = ~reserved & (starts | (phases == end_token))
            if reserved_zone:
                # Nothing counts markers for a zone the cap never cuts.
                markers = markers & False
            flushes = markers & names.str.startswith(PROFILER_ZONE_PREFIX)
            accumulated = accumulated or bool(
                (flushes & names.isin(ACCUMULATE_FLUSH_ZONES)).any()
            )
            wanted = names == zone
            kept = kernel_starts | markers | wanted
            chunk = chunk[kept].assign(
                **{
                    "zone name": names[kept],
                    "RISC processor type": chunk["RISC processor type"][kept]
                    .astype(str)
                    .str.strip(),
                    phase_column: phases[kept],
                    "_kernel_start": kernel_starts[kept],
                    "_marker": markers[kept],
                    "_flush": flushes[kept],
                }
            )

            whole, readable = _whole_number_rows(
                chunk, self._WHOLE_NUMBER_COLUMNS, non_negative=(_CYCLES_COLUMN,)
            )
            malformed += int((~readable).sum())
            malformed_starts += int(
                (~readable & (wanted & starts)[kept].to_numpy()).sum()
            )
            chunk = whole

            for (
                name,
                risc,
                slot,
                x,
                y,
                run_id,
                cycles,
                phase,
                kernel_start,
                marker,
                flush,
            ) in zip(*(chunk[column].tolist() for column in row_columns)):
                timeline = (slot, x, y, risc)
                run = open_runs.get(timeline)
                if run is None:
                    if len(open_runs) >= MAX_ZONE_TIMELINES:
                        untracked += 1
                        untracked_starts += name == zone and phase == start_token
                        continue
                    run = open_runs[timeline] = _OpenRun(run_id)
                elif run.run_id != run_id or kernel_start:
                    close(timeline, run)
                    run = open_runs[timeline] = _OpenRun(run_id, seq=run.seq + 1)

                if flush:
                    run.markers = 0
                    run.flush_pending = run.flush_pending or name != zone
                elif marker:
                    run.markers += 1
                    run.full = run.full or run.markers >= L1_ZONE_MARKER_CAPACITY
                if name != zone:
                    continue
                key = (timeline, run_id if firmware_zone else run.seq)
                if phase != start_token:
                    pairer.offer(key, phase, cycles)
                    continue
                # The pairer keeps one open start a key, so a start replaced unended
                # would otherwise go uncounted.
                displaced += key in pairer.open_starts
                pairer.offer(key, phase, cycles)
                repeats = timelines.setdefault(timeline, ZoneRepeats())
                repeats.occurrences += 1
                run.starts += 1
                if run.last_start is not None and cycles < run.last_start:
                    out_of_order += 1
                    continue
                if run.last_start is not None:
                    if run.flush_pending:
                        across_flush += 1
                    else:
                        repeats.intervals.append(cycles - run.last_start)
                run.flush_pending = False
                run.last_start = cycles

        for timeline, run in open_runs.items():
            close(timeline, run)
        pairing = pairer.pairing(self.DEVICE_LOG_FILE)
        pairing["unmatched_starts"] += displaced
        return ZoneIntervals(
            timelines=timelines,
            zone_starts=zone_starts,
            zone_names_capped=zone_names_capped,
            pairing=pairing,
            across_flush=across_flush,
            out_of_order=out_of_order,
            accumulated=accumulated,
            timestamped=timestamped,
            malformed=malformed,
            untracked=untracked,
            malformed_starts=malformed_starts,
            untracked_starts=untracked_starts,
        )

    @staticmethod
    def get_raw_csv(instance: Instance):
        if not instance.performance_path:
            raise PerformanceReportNotLoadedException()
        file_path = Path(
            instance.performance_path, DeviceLogProfilerQueries.DEVICE_LOG_FILE
        )
        with open(file_path, "r") as f:
            return f.read()


class OpsPerformanceQueries:
    PERF_RESULTS_PREFIX = "ops_perf_results"

    def __init__(self, instance: Instance):
        """
        Initialize the performance profiler with a instance object.
        """
        self.instance = instance
        self.runner: Optional[LocalCSVQueryRunner] = None

    def __enter__(self):
        """

        :return:
        """
        file_path = OpsPerformanceQueries.get_local_ops_perf_file_path(self.instance)
        self.runner = LocalCSVQueryRunner(file_path=file_path, offset=0)
        self.runner.__enter__()
        self.runner.df.columns = self.runner.df.columns.str.strip()

        return self

    @staticmethod
    def get_local_ops_perf_file_path(instance):
        if not instance.performance_path:
            raise PerformanceReportNotLoadedException()
        performance_path = Path(instance.performance_path)

        latest_file = newest_ops_perf_file(performance_path)
        if latest_file is None:
            raise FileNotFoundError(
                f"No performance results file found at {performance_path}"
            )
        return str(latest_file)

    @staticmethod
    def get_remote_ops_perf_file_path(instance):
        from ttnn_visualizer.sftp_operations import resolve_file_path

        remote_profile_folder = instance.remote_profile_folder.remotePath
        return resolve_file_path(
            instance.remote_connection,
            f"{remote_profile_folder}/{OpsPerformanceQueries.PERF_RESULTS_PREFIX}*",
        )

    @staticmethod
    def get_raw_csv(instance):
        with open(OpsPerformanceQueries.get_local_ops_perf_file_path(instance)) as f:
            return f.read()

    def __exit__(self, exc_type, exc_val, exc_tb):
        """
        Clean up resources when exiting the context.
        """
        if self.runner:
            self.runner.__exit__(exc_type, exc_val, exc_tb)

    def query_by_op_code(self, op_code: str, as_dict: bool = False) -> CSVQueryResult:
        """
        Query for rows with a specific OP CODE.
        """
        if self.runner is None:
            raise RuntimeError(
                "OpsPerformanceQueries must be used as a context manager"
            )
        return self.runner.execute_query(
            filters={"OP CODE": op_code}, as_dict=as_dict, columns=None
        )

    @overload
    def get_all_entries(
        self, as_dict: Literal[False] = False, limit: Optional[int] = None
    ) -> List[List[CSVCell]]: ...

    @overload
    def get_all_entries(
        self, as_dict: Literal[True], limit: Optional[int] = None
    ) -> List[Dict[str, CSVCell]]: ...

    def get_all_entries(
        self, as_dict: bool = False, limit: Optional[int] = None
    ) -> CSVQueryResult:
        """
        Fetch all entries from the performance log.
        """
        if self.runner is None:
            raise RuntimeError(
                "OpsPerformanceQueries must be used as a context manager"
            )
        return self.runner.execute_query(columns=[], as_dict=as_dict, limit=limit)

    @staticmethod
    def get_all_folders(directory: str) -> List[str]:
        """
        Get a list of all folder names in the specified directory.

        :param directory: Path to the /profiles directory.
        :return: List of folder names.
        """
        try:
            return [
                folder.name for folder in Path(directory).iterdir() if folder.is_dir()
            ]
        except Exception as e:
            raise RuntimeError(f"Error accessing directory: {e}")


def _intern_detail_cells(row: Dict) -> None:
    """Share one copy of each repeated cell: kernel paths repeat across a run's rows."""
    for key in OpsPerformanceReportQueries.DETAIL_COLUMNS:
        value = row.get(key)
        if isinstance(value, str):
            row[key] = sys.intern(value)


class OpsPerformanceReportQueries:
    REPORT_COLUMN_HEADERS = {
        "id": "ID",
        "total_percent": "Total %",
        "bound": "Bound",
        "op_code": "OP Code",
        "device": "Device",
        "device_time": "Device Time",
        "op_to_op_gap": "Op-to-Op Gap",
        "cores": "Cores",
        "dram": "DRAM",
        "dram_percent": "DRAM %",
        "flops": "FLOPs",
        "flops_percent": "FLOPs %",
        "math_fidelity": "Math Fidelity",
        "output_datatype": "Output Datatype",
        "input_0_datatype": "Input 0 Datatype",
        "input_1_datatype": "Input 1 Datatype",
        "dram_sharded": "DRAM Sharded",
        "input_0_memory": "Input 0 Memory",
        "inner_dim_block_size": "Inner Dim Block Size",
        "output_subblock_h": "Output Subblock H",
        "output_subblock_w": "Output Subblock W",
        "global_call_count": "Global Call Count",
        "sub_device_id": "Sub Device ID",
        "available_cores": "Available Cores",
        "op_category": "Op Category",
        "bound_analysis": "Bound Analysis",
        "advice": "Advice",
        "raw_op_code": "Raw OP Code",
    }

    STACKED_REPORT_COLUMNS = [
        "%",
        "OP Code Joined",
        "Device_Time_Sum_us",
        "Ops_count",
        "Op_Category",
        "Flops_min",
        "Flops_max",
        "Flops_mean",
        "Flops_std",
        "Flops_weighted_mean",
    ]

    STACKED_REPORT_COLUMNS_WITH_DEVICE = [
        "%",
        "OP Code Joined",
        "Device",
        "Device_Time_Sum_us",
        "Ops_count",
        "Op_Category",
        "Flops_min",
        "Flops_max",
        "Flops_mean",
        "Flops_std",
        "Flops_weighted_mean",
    ]

    PASSTHROUGH_COLUMNS = {
        "pm_ideal_ns": "PM IDEAL [ns]",
        "device_kernel_duration": "DEVICE KERNEL DURATION [ns]",
        "brisc_kernel_duration": "DEVICE BRISC KERNEL DURATION [ns]",
        "ncrisc_kernel_duration": "DEVICE NCRISC KERNEL DURATION [ns]",
        "trisc0_kernel_duration": "DEVICE TRISC0 KERNEL DURATION [ns]",
        "trisc1_kernel_duration": "DEVICE TRISC1 KERNEL DURATION [ns]",
        "trisc2_kernel_duration": "DEVICE TRISC2 KERNEL DURATION [ns]",
        "erisc_kernel_duration": "DEVICE ERISC KERNEL DURATION [ns]",
        "device_fw_start_cycle": "DEVICE FW START CYCLE",
        "device_fw_end_cycle": "DEVICE FW END CYCLE",
        "metal_trace_id": "METAL TRACE ID",
        "metal_trace_replay_session_id": "METAL TRACE REPLAY SESSION ID",
    }

    # Raw columns the app does not show, copied only when `detail_columns` asks, so the
    # app's rows keep their size (#2159). The agent tools read them (#2153).
    DETAIL_COLUMNS = {
        "raw_math_fidelity": "MATH FIDELITY",
        "device_kernel_duration_per_core_min": "DEVICE KERNEL DURATION PER CORE MIN [ns]",
        "device_kernel_duration_per_core_max": "DEVICE KERNEL DURATION PER CORE MAX [ns]",
        "device_kernel_duration_per_core_avg": "DEVICE KERNEL DURATION PER CORE AVG [ns]",
        "device_kernel_first_to_last_start": "DEVICE KERNEL FIRST TO LAST START [ns]",
        "device_compute_cb_wait_front": "DEVICE COMPUTE CB WAIT FRONT [ns]",
        "device_compute_cb_reserve_back": "DEVICE COMPUTE CB RESERVE BACK [ns]",
        "dispatch_total_cq_cmd_op_time": "DISPATCH TOTAL CQ CMD OP TIME [ns]",
        "dispatch_go_send_wait_time": "DISPATCH GO SEND WAIT TIME [ns]",
        "compute_kernel_source": "COMPUTE KERNEL SOURCE",
        "compute_kernel_hash": "COMPUTE KERNEL HASH",
        "data_movement_kernel_source": "DATA MOVEMENT KERNEL SOURCE",
        "data_movement_kernel_hash": "DATA MOVEMENT KERNEL HASH",
        "pm_compute_ns": "PM COMPUTE [ns]",
        "pm_bandwidth_ns": "PM BANDWIDTH [ns]",
        "pm_fpu_util": "PM FPU UTIL (%)",
        "noc_util": "NOC UTIL (%)",
        "multicast_noc_util": "MULTICAST NOC UTIL (%)",
        "dram_bw_util": "DRAM BW UTIL (%)",
        "dram_bw_util_per_ctrl": "DRAM BW UTIL PER CTRL (%)",
        "eth_bw_util": "ETH BW UTIL (%)",
        "npe_cong_impact": "NPE CONG IMPACT (%)",
    }

    DEFAULT_START_SIGNPOST = None
    DEFAULT_END_SIGNPOST = None
    DEFAULT_IGNORE_SIGNPOSTS = True
    DEFAULT_PRINT_SIGNPOSTS = True
    DEFAULT_MIN_PERCENTAGE = 0.5
    DEFAULT_ID_RANGE = None
    DEFAULT_ARCH = None
    DEFAULT_NO_ADVICE = False
    DEFAULT_TRACING_MODE = False
    DEFAULT_RAW_OP_CODES = True
    DEFAULT_NO_HOST_OPS = False
    DEFAULT_NO_STACKED_REPORT = False
    DEFAULT_DETAIL_COLUMNS = False
    DEFAULT_NO_STACK_BY_IN0 = True
    DEFAULT_MERGE_DEVICES = True
    DEFAULT_STACKED_CSV_FILE = None  # Stacked report CSV output file
    DEFAULT_NO_SUMMARY = False
    DEFAULT_SUMMARY_FILE = None  # Stacked report output file
    DEFAULT_CLASSIC_COLORS = False  # Colour scheme for plotted stacked report
    DEFAULT_GROUP_BY = None  # Group by method for stacked report

    @classmethod
    def _resolve_report_column_indexes(cls, header):
        header_index_by_name = {
            column_name: index for index, column_name in enumerate(header)
        }
        column_indexes = {}

        # The --csv puts a column's unit in its header ("Device Time [μs]"), so a
        # table name is looked up under the label tt-perf-report writes it with.
        csv_labels = perf_report.report_csv_column_labels
        for column, header_name in cls.REPORT_COLUMN_HEADERS.items():
            column_indexes[column] = header_index_by_name.get(
                csv_labels.get(header_name, header_name)
            )

        return column_indexes

    @classmethod
    def _parse_report_row(cls, column_indexes, row):
        return {
            column: cls._unescape_csv_formula(row[index])
            for column, index in column_indexes.items()
            if index is not None and index < len(row)
        }

    @staticmethod
    def _unescape_csv_formula(value):
        # tt-perf-report prefixes formula-like strings with an apostrophe for CSV safety.
        if (
            isinstance(value, str)
            and len(value) > 1
            and value[0] == "'"
            and value[1] in "=+-@\t\r"
        ):
            return value[1:]
        return value

    @staticmethod
    def extract_signposts(csv_file, resolved: "ResolvedSignposts"):
        """The raw rows, and the signposts a range can name.

        Signpost names are not unique, but tt-perf-report resolves a name to one of
        its rows, so the list holds one entry per name at that row.
        """
        logger.info("Reading raw CSV for signpost extraction...")
        csv_file.seek(0)
        ops_perf_results = list(csv.DictReader(csv_file))
        return ops_perf_results, resolved.listing()

    @staticmethod
    def set_op_type_from_results(processed_row, idx, ops_perf_results):
        if 0 <= idx < len(ops_perf_results):
            processed_row["op_type"] = ops_perf_results[idx].get(_OP_TYPE_COLUMN)
        else:
            processed_row["op_type"] = None

        return processed_row

    @staticmethod
    def cleanup_temp_files(files):
        for file in files:
            if isinstance(file, tempfile._TemporaryFileWrapper):
                file_path = file.name
            else:
                file_path = file
            if os.path.exists(file_path):
                try:
                    os.unlink(file_path)
                    logger.info(f"Deleted temporary file: {file_path}")
                except Exception as e:
                    logger.warning(f"Could not delete temporary file {file_path}: {e}")

    @staticmethod
    def set_hash_from_results(processed_row, idx, ops_perf_results):
        if 0 <= idx < len(ops_perf_results):
            hash_value = ops_perf_results[idx].get(PROGRAM_HASH_COLUMN)
            processed_row["hash"] = hash_value if hash_value else None

            cache_hit_value = ops_perf_results[idx].get(PROGRAM_CACHE_HIT_COLUMN)
            if cache_hit_value == "True":
                processed_row["cache_hit"] = True
            elif cache_hit_value == "False":
                processed_row["cache_hit"] = False
            else:
                processed_row["cache_hit"] = None
        else:
            processed_row["hash"] = None
            processed_row["cache_hit"] = None

        return processed_row

    @staticmethod
    def report_source(instance) -> "_PerformanceReportSource":
        """The CSV a report would be generated from now, and its identity on disk.

        The newest `ops_perf_results` file, so a capture written later is a
        different source, and so is the same file rewritten in place.
        """
        source_path = Path(
            OpsPerformanceQueries.get_local_ops_perf_file_path(instance)
        ).resolve()
        source_stat = source_path.stat()
        return _PerformanceReportSource(
            path=str(source_path),
            modified_ns=source_stat.st_mtime_ns,
            changed_ns=source_stat.st_ctime_ns,
            inode=source_stat.st_ino,
            size=source_stat.st_size,
        )

    @classmethod
    def generate_report(cls, instance, **kwargs) -> Dict:
        """Build the performance report afresh; the caller owns the dicts it gets.

        Never cached: holding dicts costs over twice the memory of their JSON. A
        caller that only serialises the report should use `generate_report_json`.
        """
        try:
            return cls.generate_report_strict(instance, **kwargs)
        except DegradedPerformanceReport as degraded:
            return degraded.report

    @classmethod
    def generate_report_strict(cls, instance, **kwargs) -> Dict:
        """`generate_report`, but a report built with swallowed errors is raised.

        `DegradedPerformanceReport` carries it, so a caller that keeps reports
        beyond one request can keep a partial one apart from a healthy one.
        """
        source = cls.report_source(instance)
        return _generate_performance_report(source, cls._report_options(**kwargs))

    @classmethod
    def generate_report_json(cls, instance, **kwargs) -> bytes:
        """The performance report as JSON, reusing a cached one when nothing changed."""
        source = cls.report_source(instance)
        try:
            return _cached_generate_performance_report_json(
                source, cls._report_options(**kwargs)
            )
        except DegradedPerformanceReport as degraded:
            return orjson.dumps(degraded.report)

    @classmethod
    def _report_options(cls, **kwargs) -> _PerformanceReportOptions:
        return _PerformanceReportOptions(
            start_signpost=kwargs.get("start_signpost", cls.DEFAULT_START_SIGNPOST),
            end_signpost=kwargs.get("end_signpost", cls.DEFAULT_END_SIGNPOST),
            print_signposts=kwargs.get("print_signposts", cls.DEFAULT_PRINT_SIGNPOSTS),
            hide_host_ops=kwargs.get("hide_host_ops", cls.DEFAULT_NO_HOST_OPS),
            merge_devices=kwargs.get("merge_devices", cls.DEFAULT_MERGE_DEVICES),
            tracing_mode=kwargs.get("tracing_mode", cls.DEFAULT_TRACING_MODE),
            group_by=kwargs.get("group_by", cls.DEFAULT_GROUP_BY),
            no_stacked_report=kwargs.get(
                "no_stacked_report", cls.DEFAULT_NO_STACKED_REPORT
            ),
            detail_columns=kwargs.get("detail_columns", cls.DEFAULT_DETAIL_COLUMNS),
        )

    @classmethod
    def _generate_report_uncached(
        cls, raw_csv: str, options: _PerformanceReportOptions
    ):
        csv_file = StringIO(raw_csv)

        # Validate that we have CSV data with rows
        csv_lines = raw_csv.strip().split("\n")
        logger.info(f"CSV has {len(csv_lines)} lines (header + data rows)")

        if len(csv_lines) < 2:
            raise DataFormatError(
                f"CSV must have at least header + 1 data row, got {len(csv_lines)} lines"
            )

        # Resolved before generating, so a range tt-perf-report would answer from
        # other rows is refused without running it, and the `signposts` list below
        # offers only ranges this accepts.
        resolved_signposts = read_signposts(csv_file, options.tracing_mode)
        check_signpost_range(
            resolved_signposts, options.start_signpost, options.end_signpost
        )
        _check_device_count(resolved_signposts)

        # Determine if we should skip stacked report
        data_row_count = len(csv_lines) - 1
        no_stacked_report = options.no_stacked_report

        if data_row_count <= 1:
            logger.info("Skipping stacked report generation: insufficient data rows")
            no_stacked_report = True

        # A swallowed failure still returns a report, but one that may only be
        # missing rows by chance (EMFILE, a full temp dir), so it must not be cached.
        degraded = False

        try:
            csv_summary_file = tempfile.NamedTemporaryFile(delete=False)
            csv_output_file = tempfile.NamedTemporaryFile(suffix=".csv", delete=False)
            # The perf_report library creates files with format: {csv_summary_name}.csv and {csv_summary_name}.png
            summary_csv_path = f"{csv_summary_file.name}.csv"
            summary_png_path = f"{csv_summary_file.name}.png"
            csv_summary_file.close()
            csv_output_file.close()

            start_signpost = options.start_signpost
            end_signpost = options.end_signpost
            print_signposts = options.print_signposts
            no_host_ops = options.hide_host_ops
            merge_devices = options.merge_devices
            tracing_mode = options.tracing_mode
            group_by = options.group_by

            if start_signpost or end_signpost:
                ignore_signposts = False
            else:
                ignore_signposts = cls.DEFAULT_IGNORE_SIGNPOSTS

            open_figures = set(plt.get_fignums())
            try:
                with _stacked_report_plot_skipped(), _perf_report_output_bounded():
                    perf_report.generate_perf_report(
                        [csv_file],
                        start_signpost,
                        end_signpost,
                        ignore_signposts,
                        print_signposts,
                        cls.DEFAULT_MIN_PERCENTAGE,
                        cls.DEFAULT_ID_RANGE,
                        cls.DEFAULT_ARCH,
                        csv_output_file.name,
                        cls.DEFAULT_NO_ADVICE,
                        tracing_mode,
                        cls.DEFAULT_RAW_OP_CODES,
                        no_host_ops,
                        cls.DEFAULT_NO_SUMMARY,
                        group_by,
                        cls.DEFAULT_CLASSIC_COLORS,
                        csv_summary_file.name,
                        no_stacked_report,
                        cls.DEFAULT_NO_STACK_BY_IN0,
                        cls.DEFAULT_STACKED_CSV_FILE,
                        not merge_devices,
                    )
            except SystemExit as e:
                # tt-perf-report calls sys.exit(1) on unparseable inputs (e.g. missing
                # DEVICE ID). Convert library exits so the MCP server stays up and the
                # HTTP route returns 422, while letting worker aborts propagate. #2183
                if not _raised_by_perf_report(e):
                    raise
                logger.exception("tt-perf-report exited while loading report")
                # Only a genuine int is echoed: `sys.exit("...")` carries free text.
                exit_code = (
                    e.code
                    if isinstance(e.code, int) and not isinstance(e.code, bool)
                    else None
                )
                raise PerfReportExit(exit_code) from e
            except Exception as e:
                logger.error(f"Error loading report: {e}")
                logger.error(f"Full traceback:\n{traceback.format_exc()}")
                raise DataFormatError(e)
            finally:
                _close_figures_opened_since(open_figures)

            try:
                ops_perf_results, signposts = cls.extract_signposts(
                    csv_file, resolved_signposts
                )
            except Exception as e:
                logger.error(f"Error extracting signposts: {e}")
                ops_perf_results = []
                signposts = []
                degraded = True

            logger.info(f"Found {len(signposts)} signposts...")

            report: List[Dict] = []

            try:
                logger.info(f"Processing CSV output file: {csv_output_file.name}")
                if os.path.exists(csv_output_file.name):
                    try:
                        with open(csv_output_file.name, newline="") as csvfile:
                            reader = csv.reader(csvfile, delimiter=",")
                            header = next(reader, None)

                            if not header:
                                logger.warning(
                                    "CSV output file is empty, no report data generated"
                                )
                                report = []
                            else:
                                column_indexes = cls._resolve_report_column_indexes(
                                    header
                                )
                                id_index = column_indexes.get("id")
                                passthrough_columns = (
                                    {**cls.PASSTHROUGH_COLUMNS, **cls.DETAIL_COLUMNS}
                                    if options.detail_columns
                                    else cls.PASSTHROUGH_COLUMNS
                                )
                                for row in reader:
                                    try:
                                        if id_index is None or id_index >= len(row):
                                            raise ValueError(
                                                "Report row is missing its ID"
                                            )

                                        op_id = int(row[id_index])
                                        idx = op_id - REPORT_ROW_ID_OFFSET

                                        processed_row = cls._parse_report_row(
                                            column_indexes, row
                                        )

                                        if (
                                            "advice" in processed_row
                                            and processed_row["advice"]
                                        ):
                                            processed_row["advice"] = processed_row[
                                                "advice"
                                            ].split(" • ")
                                        else:
                                            processed_row["advice"] = []

                                        for (
                                            key,
                                            value,
                                        ) in passthrough_columns.items():
                                            if 0 <= idx < len(ops_perf_results):
                                                processed_row[key] = ops_perf_results[
                                                    idx
                                                ].get(value)
                                            else:
                                                processed_row[key] = None
                                        if options.detail_columns:
                                            _intern_detail_cells(processed_row)

                                        # Get the op type from the raw file for this row as it is not returned from tt-perf-report
                                        cls.set_op_type_from_results(
                                            processed_row, idx, ops_perf_results
                                        )

                                        cls.set_hash_from_results(
                                            processed_row, idx, ops_perf_results
                                        )

                                        report.append(processed_row)
                                    except (ValueError, IndexError) as e:
                                        logger.error(f"Error processing row {row}: {e}")
                                        continue
                    except csv.Error as e:
                        logger.error(f"CSV parsing error: {e}")
                        raise DataFormatError() from e
                else:
                    logger.warning(
                        f"CSV output file not created: {csv_output_file.name}"
                    )
            except Exception as e:
                logger.error(f"Error processing CSV output file: {e}")
                report = []
                degraded = True

            stacked_report: List[Dict] = []

            if not no_stacked_report:
                try:
                    logger.info(f"Processing stacked report file: {summary_csv_path}")
                    if os.path.exists(summary_csv_path):
                        try:
                            with open(summary_csv_path, newline="") as csvfile:
                                reader = csv.reader(csvfile, delimiter=",")
                                next(reader, None)

                                # Use the appropriate column list based on merge_devices flag
                                stacked_columns = (
                                    cls.STACKED_REPORT_COLUMNS_WITH_DEVICE
                                    if not merge_devices
                                    else cls.STACKED_REPORT_COLUMNS
                                )

                                for row in reader:
                                    processed_row = {
                                        column: row[index]
                                        for index, column in enumerate(stacked_columns)
                                        if index < len(row)
                                    }

                                    # Map "OP Code Joined" to "op_code" for consistency with non-stacked report
                                    if "OP Code Joined" in processed_row:
                                        processed_row["op_code"] = processed_row[
                                            "OP Code Joined"
                                        ]
                                        del processed_row["OP Code Joined"]

                                    stacked_report.append(processed_row)
                        except csv.Error as e:
                            logger.error(f"CSV parsing error in stacked report: {e}")
                            raise DataFormatError() from e
                    else:
                        logger.warning(
                            f"Stacked report file not created: {summary_csv_path}"
                        )
                except Exception as e:
                    logger.error(f"Error processing stacked report: {e}")
                    # Don't raise, just log - stacked report is optional
                    degraded = True
            else:
                logger.info("Skipping stacked report processing as per configuration")

            result = {
                "report": report,
                "stacked_report": stacked_report,
                "signposts": signposts,
                # True when a range was asked of a report with no signposts, which
                # tt-perf-report answers with the whole file: the rows are not the
                # window the range names, and a reader must be told.
                "signpost_range_ignored": signpost_range_ignored(
                    resolved_signposts, options.start_signpost, options.end_signpost
                ),
            }
            if degraded:
                raise DegradedPerformanceReport(result)
            return result

        finally:
            # Ensure cleanup always happens, even if exceptions are raised
            cls.cleanup_temp_files(
                [csv_output_file, summary_csv_path, summary_png_path, csv_summary_file]
            )


@dataclass
class ResolvedSignposts:
    """Each signpost name's rows, in the order tt-perf-report resolves a bound.

    `generate_perf_report` sorts rows by `HOST START TS` before it filters, unless
    tracing mode is on, so a bound names its signpost's earliest occurrence by host
    time rather than its first in the file -- the end its second when it names the
    start too. The window is then cut by file position. Rows are numbered by file
    position here, which is also how report rows are numbered.
    """

    positions_by_name: Dict[str, List[int]]
    sorted_by_host_time: bool
    # Distinct finite `DEVICE ID`s the rows name, read as numbers as tt-perf-report
    # reads them, or None when the CSV has no such column.
    device_count: Optional[int] = None

    def _in_bound_order(self) -> List[Tuple[str, List[int]]]:
        return sorted(self.positions_by_name.items(), key=lambda item: item[1][0])

    def listing(self) -> List[Dict[str, object]]:
        """One entry per name, at the row a bound on that name resolves to.

        Ordered by those rows, so a picker that offers only later entries as an end
        offers only ranges `check_signpost_range` accepts.
        """
        return [
            {"id": positions[0] + REPORT_ROW_ID_OFFSET, "op_code": name}
            for name, positions in self._in_bound_order()
        ]

    def occurrences(self) -> List[Tuple[str, int]]:
        """Each name with how often it occurs, in `listing`'s order."""
        return [(name, len(positions)) for name, positions in self._in_bound_order()]


def resolve_signposts(
    csv_file: IO[str], tracing_mode: bool = False, low_memory: bool = False
) -> ResolvedSignposts:
    """Read a perf CSV's signposts as `generate_perf_report` orders them.

    The read and sort are pandas', as the library's are, so equal timestamps order
    the same way in both. Only the columns it needs are parsed. The file is rewound
    before and after, so the caller can hand it on.

    `low_memory` parses in chunks, as tt-perf-report does not: on every local
    capture it resolves the same positions, and peaks at a fraction of the memory.
    A chunk can type a column apart from the rest, though -- one non-numeric host
    time leaves ints and strings that cannot be sorted together -- so a host time
    or device id read that way is read again as text, still in chunks: the text a
    whole-file parse keeps for a column it cannot type.
    """
    wanted = {_OP_TYPE_COLUMN, _OP_CODE_COLUMN, _HOST_START_COLUMN, _DEVICE_ID_COLUMN}

    def read(columns: Set[str], as_text: bool = False) -> pd.DataFrame:
        csv_file.seek(0)
        # Its warning is about a mixed column, which is read again below.
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", pd.errors.DtypeWarning)
            return pd.read_csv(
                csv_file,
                usecols=lambda column: column in columns,
                low_memory=low_memory,
                dtype=str if as_text else None,
            )

    rows = read(wanted)
    if low_memory:
        # The two the answer depends on: the sort, and the distinct-device count.
        for column in (_HOST_START_COLUMN, _DEVICE_ID_COLUMN):
            if column in rows.columns and pd.api.types.infer_dtype(
                rows[column], skipna=True
            ).startswith("mixed"):
                rows[column] = read({column}, as_text=True)[column]
    csv_file.seek(0)

    sorted_by_host_time = _HOST_START_COLUMN in rows.columns and not tracing_mode
    if sorted_by_host_time:
        rows = rows.sort_values(by=_HOST_START_COLUMN)

    positions_by_name: Dict[str, List[int]] = defaultdict(list)
    if _OP_TYPE_COLUMN in rows.columns and _OP_CODE_COLUMN in rows.columns:
        # A nameless signpost cannot be asked for: tt-perf-report matches on the
        # name, and a missing one never equals anything.
        signposts = rows[
            (rows[_OP_TYPE_COLUMN] == SIGNPOST_OP_TYPE) & rows[_OP_CODE_COLUMN].notna()
        ]
        for position, name in zip(signposts.index, signposts[_OP_CODE_COLUMN]):
            positions_by_name[str(name)].append(int(position))

    device_count = None
    if _DEVICE_ID_COLUMN in rows.columns:
        # "1" and "1.0" are one device to the library, and text it cannot read as
        # a number none, so they are counted as it counts them.
        device_ids = pd.to_numeric(rows[_DEVICE_ID_COLUMN], errors="coerce")
        device_count = int(device_ids[np.isfinite(device_ids)].nunique())
    return ResolvedSignposts(dict(positions_by_name), sorted_by_host_time, device_count)


def read_signposts(
    csv_file: IO[str], tracing_mode: bool = False, low_memory: bool = False
) -> ResolvedSignposts:
    """`resolve_signposts`, with an unreadable capture answered as the caller's data.

    `EmptyDataError` and `ParserError` are both `ValueError`s: a ragged or
    truncated capture is the caller's data, answered as such rather than a 500.
    Shared by the report route and the agent tools, so a bad capture reads the
    same through either.
    """
    try:
        return resolve_signposts(csv_file, tracing_mode, low_memory)
    except ValueError as error:
        raise DataFormatError(
            f"could not read the report's signposts: {error}"
        ) from error


def _check_device_count(signposts: ResolvedSignposts) -> None:
    """Refuse a capture naming more devices than any real one, before generating."""
    if (
        signposts.device_count is not None
        and signposts.device_count > MAX_PERFORMANCE_REPORT_DEVICES
    ):
        raise DataFormatError(
            f"the report names {signposts.device_count} devices, more than the "
            f"{MAX_PERFORMANCE_REPORT_DEVICES} a performance report can have"
        )


def signpost_range_ignored(
    signposts: ResolvedSignposts,
    start_signpost: Optional[str],
    end_signpost: Optional[str],
) -> bool:
    """Whether a range was asked of a report with no signposts to narrow it by.

    tt-perf-report answers that with the whole file. The range is not wrong so much
    as inapplicable -- a comparison report captured without signposts is the usual
    case -- so the report is returned whole, and says so.
    """
    return bool(start_signpost or end_signpost) and not signposts.positions_by_name


def check_signpost_range(
    signposts: ResolvedSignposts,
    start_signpost: Optional[str],
    end_signpost: Optional[str],
) -> None:
    """Refuse a signpost range tt-perf-report would answer from different rows.

    `filter_by_signpost` only warns about a name it cannot find. With neither name
    found it falls back to the rows after the last signpost, and with one found it
    drops the other bound, so a mistyped name returns a full-looking report of the
    wrong window. An end that falls before the start returns no rows at all.

    A report with no signposts at all is answered, not refused: tt-perf-report then
    uses the whole file and says so rather than picking some other window, and the
    report carries a `signpost_range_ignored` flag so a reader is told too.

    Ids are the ones the report and its `signposts` list give rows, so a refusal
    names the same row a reader sees.
    """
    if signpost_range_ignored(signposts, start_signpost, end_signpost):
        return
    if not start_signpost and not end_signpost:
        return

    positions_by_name = signposts.positions_by_name

    def occurrences(name: str) -> List[int]:
        if name in positions_by_name:
            return positions_by_name[name]
        names = [str(entry["op_code"]) for entry in signposts.listing()]
        listed = ", ".join(repr(known) for known in names[:MAX_LISTED_SIGNPOSTS])
        if len(names) > MAX_LISTED_SIGNPOSTS:
            listed += f" and {len(names) - MAX_LISTED_SIGNPOSTS} more"
        raise InvalidSignpostRange(
            f"no signpost named {name!r} in this report; it holds {listed}"
        )

    start = occurrences(start_signpost)[0] if start_signpost else None
    if not end_signpost:
        return

    end_occurrences = occurrences(end_signpost)
    end_is_second = end_signpost == start_signpost
    if end_is_second and len(end_occurrences) < 2:
        raise InvalidSignpostRange(
            f"signpost {end_signpost!r} occurs once, so it cannot bound both ends "
            "of a range: a range that starts and ends on one name ends at its "
            "second occurrence"
        )
    end = end_occurrences[1 if end_is_second else 0]

    if start is not None and end < start:
        order = "host start time" if signposts.sorted_by_host_time else "file position"
        raise InvalidSignpostRange(
            f"end signpost {end_signpost!r} resolves to id "
            f"{end + REPORT_ROW_ID_OFFSET}, before start signpost {start_signpost!r} "
            f"at id {start + REPORT_ROW_ID_OFFSET}, so this range holds no rows: the "
            f"start is its name's first occurrence by {order} and the end its "
            f"{'second' if end_is_second else 'first'}"
        )


class DegradedPerformanceReport(Exception):
    """A report generated with swallowed errors, raised so no cache keeps it.

    `lru_cache` only skips raised results, so the partial report rides on the
    exception; the agent's registry likewise keeps it per handle, not shared.
    """

    def __init__(self, report: Dict):
        super().__init__("performance report generated with swallowed errors")
        self.report = report


def _generate_performance_report(
    source: _PerformanceReportSource, options: _PerformanceReportOptions
) -> Dict:
    csv_path = Path(source.path)
    raw_csv = csv_path.read_text()
    try:
        return OpsPerformanceReportQueries._generate_report_uncached(raw_csv, options)
    except PerfReportExit as e:
        # Named here, not in the cached generator, so its signature stays
        # (raw_csv, options). The basename only: hosted error bodies reach users.
        raise PerfReportExit(e.exit_code, subject=csv_path.name) from e.__cause__


@lru_cache(maxsize=MAX_CACHED_PERFORMANCE_REPORTS)
def _cached_generate_performance_report_json(
    source: _PerformanceReportSource, options: _PerformanceReportOptions
) -> bytes:
    # Bytes rather than the dicts: under half the memory, a hit skips
    # serialisation, and callers sharing an entry cannot modify it.
    return orjson.dumps(_generate_performance_report(source, options))


def clear_performance_report_cache() -> None:
    _cached_generate_performance_report_json.cache_clear()
