# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Each compute thread's stalls from tt-metal's hardware counters, beside the CB polls its
sum zones time, which the counters cannot see; for the counters route and
`stall_breakdown`. #2372"""

import csv
from enum import Enum
from typing import (
    Callable,
    Dict,
    List,
    Mapping,
    NamedTuple,
    Optional,
    Sequence,
    TextIO,
    Tuple,
)

from ttnn_visualizer import hardware_counters
from ttnn_visualizer.cells import whole_number
from ttnn_visualizer.hardware_counters import (
    CAPTURE_FLAG,
    COMPUTE_KERNEL_SOURCE_COLUMN,
    ROW_KEY_STATS,
    CaptureGroup,
    CounterHeader,
    CounterReader,
    CounterStat,
    cell_value,
    has_compute_kernel,
)

SUM_PROFILING_FLAG = "--enable-sum-profiling"
# instrn fills the thread figures and unpack and pack the math pipeline stall rates; fpu
# completes tt-metal's one-pass capture for the same ops' utilization.
STALL_GROUPS = (
    CaptureGroup.INSTRN,
    CaptureGroup.UNPACK,
    CaptureGroup.PACK,
    CaptureGroup.FPU,
)
STALL_COUNTER_GROUPS = ",".join(group.value for group in STALL_GROUPS)
STALL_CAPTURE_FLAGS = (
    f"{CAPTURE_FLAG}={STALL_COUNTER_GROUPS} for the thread figures and "
    f"{SUM_PROFILING_FLAG} for the CB waits"
)
# What fills each part of an op's stalls, worded as a counter's fill hint is.
COUNTERS_FILL_HINT = hardware_counters.fill_hint(STALL_GROUPS)
CB_WAITS_FILL_HINT = f"filled when the capture ran with {SUM_PROFILING_FLAG}"

CORE_COUNT_COLUMN = "CORE COUNT"
KERNEL_DURATION_COLUMN = "DEVICE KERNEL DURATION [ns]"
PER_CORE_KERNEL_COLUMN = "DEVICE KERNEL DURATION PER CORE AVG [ns]"

# Past what a JSON number holds exactly, which no real core count nears.
_MAX_CORE_COUNT = 2**53 - 1
_DECIMALS = 3
_NS_PER_US = 1000


class PipelineThread(str, Enum):
    T0 = "t0"
    T1 = "t1"
    T2 = "t2"


class ThreadRole(str, Enum):
    UNPACK = "unpack"
    MATH = "math"
    PACK = "pack"


class CbWaitZone(str, Enum):
    """tt-metal's sum zones around the compute kernel's CB polls."""

    WAIT_FRONT = "cb_wait_front"
    RESERVE_BACK = "cb_reserve_back"


class StallSource(str, Enum):
    HARDWARE_COUNTER = "hardware_counter"
    INSTRUMENTATION = "instrumentation"


class StallState(str, Enum):
    FILLED = "filled"
    NOT_CAPTURED = "not_captured"
    NO_VALUE = "no_value"
    # tt-metal repeats the previous program's CB sums on an op without a compute kernel.
    IGNORED = "ignored"


# tools/tracy/device_post_proc_config.py: TRISC0 times cb_wait_front, TRISC2 cb_reserve_back.
CB_WAIT_COLUMNS: Dict[CbWaitZone, str] = {
    CbWaitZone.WAIT_FRONT: "DEVICE COMPUTE CB WAIT FRONT [ns]",
    CbWaitZone.RESERVE_BACK: "DEVICE COMPUTE CB RESERVE BACK [ns]",
}

# The raw CSV columns a row's stalls read besides its counters.
RAW_COLUMNS: Tuple[str, ...] = (
    *CB_WAIT_COLUMNS.values(),
    CORE_COUNT_COLUMN,
    KERNEL_DURATION_COLUMN,
    PER_CORE_KERNEL_COLUMN,
    COMPUTE_KERNEL_SOURCE_COLUMN,
)


class ThreadLabels(NamedTuple):
    thread: PipelineThread
    role: ThreadRole
    issue_rate: str
    stall_rate: str
    stall_overlap: str
    # tt-llk's per-thread waits; the srcA/srcB ones are shared signals, read as its
    # hardware reference reads them: valid waits are math's, clear waits unpack's.
    waits: Tuple[str, ...]
    # Shares of the cycles a math instruction was ready, not of the counted cycles.
    math_pipeline_stalls: Tuple[str, ...] = ()
    cb_zone: Optional[CbWaitZone] = None
    # Waits on an earlier stage, high whenever one holds the pipeline up: a symptom.
    downstream_waits: Tuple[str, ...] = ()


THREADS: Tuple[ThreadLabels, ...] = (
    ThreadLabels(
        PipelineThread.T0,
        ThreadRole.UNPACK,
        "T0 Instrn Issue Rate",
        "Thread 0 Stall Rate",
        "Stall Overlap T0",
        waits=(
            "Unpack Idle Wait T0",
            "Unpack Waiting on Pack (T0)",
            "THCON Idle Wait T0",
            "CFG Idle Wait T0",
            "MOVE Idle Wait T0",
            "Semaphore Zero Wait T0",
            "Semaphore Full Wait T0",
            "SrcA Clear Wait",
            "SrcB Clear Wait",
        ),
        cb_zone=CbWaitZone.WAIT_FRONT,
    ),
    ThreadLabels(
        PipelineThread.T1,
        ThreadRole.MATH,
        "T1 Instrn Issue Rate",
        "Thread 1 Stall Rate",
        "Stall Overlap T1",
        waits=(
            "Math Idle Wait T1",
            "Math Waiting on Unpack (T1)",
            "SFPU Idle Wait T1",
            "Semaphore Zero Wait T1",
            "Semaphore Full Wait T1",
            "SrcA Valid Wait",
            "SrcB Valid Wait",
        ),
        math_pipeline_stalls=("Data Hazard Stall Rate", "Math Scoreboard Stall Rate"),
        downstream_waits=("Math Waiting on Unpack (T1)",),
    ),
    ThreadLabels(
        PipelineThread.T2,
        ThreadRole.PACK,
        "T2 Instrn Issue Rate",
        "Thread 2 Stall Rate",
        "Stall Overlap T2",
        waits=(
            "Pack Idle Wait T2",
            "Pack Waiting on Math (T2)",
            "Semaphore Zero Wait T2",
            "Semaphore Full Wait T2",
        ),
        cb_zone=CbWaitZone.RESERVE_BACK,
        # Semaphore Zero Wait T2 is the packer waiting for math's result.
        downstream_waits=("Pack Waiting on Math (T2)", "Semaphore Zero Wait T2"),
    ),
)


def has_thread_counters(header: CounterHeader) -> bool:
    """Whether the capture holds the instrn group's per-thread stall rates."""
    return any(thread.stall_rate in header.columns for thread in THREADS)


def wait_labels_absent(header: CounterHeader) -> List[str]:
    """The named waits a capture with the thread counters lacks: none on Wormhole or
    Blackhole, whose instrn group fills every one."""
    if not has_thread_counters(header):
        return []
    return [
        label
        for thread in THREADS
        for label in thread.waits
        if label not in header.columns
    ]


def cb_waits_ignored(compute_kernel: Optional[bool]) -> bool:
    """Whether a row's CB sums are a copy of the previous program's, as tt-metal writes
    them on an op without a compute kernel. The counters route and `stall_breakdown`
    read them by this rule; the `riscs` include group does not yet (#2376)."""
    return compute_kernel is False


def _rounded(value: float) -> float:
    return round(value, _DECIMALS)


def _number(row: Mapping[str, object], column: str) -> Optional[float]:
    return cell_value(row.get(column))


def _positive(row: Mapping[str, object], column: str) -> Optional[float]:
    number = _number(row, column)
    return number if number is not None and number > 0 else None


def core_count(row: Mapping[str, object]) -> Optional[int]:
    """The row's `CORE COUNT`, which the CB sums divide by, or None where it is not a
    positive whole number a JSON answer can hold."""
    count = whole_number(row.get(CORE_COUNT_COLUMN))
    return count if count is not None and 0 < count <= _MAX_CORE_COUNT else None


class _Stat(NamedTuple):
    """A counter's average across the op's cores, with its minimum and maximum."""

    avg: float
    min: Optional[float]
    max: Optional[float]

    @property
    def reads_zero(self) -> bool:
        return (self.max if self.max is not None else self.avg) == 0

    def answer(self) -> Dict[str, Optional[float]]:
        return {"avg": self.avg, "min": self.min, "max": self.max}


class _Named(NamedTuple):
    label: str
    stat: _Stat

    def answer(self) -> Dict[str, object]:
        return {"label": self.label, **self.stat.answer()}


def _stat(read: CounterReader, label: str) -> Optional[_Stat]:
    stats = {stat: read(label, stat) for stat, _ in ROW_KEY_STATS}
    average = stats[CounterStat.AVG]
    if average is None:
        return None
    return _Stat(average, stats[CounterStat.MIN], stats[CounterStat.MAX])


def _by_average(readings: List[_Named]) -> List[_Named]:
    return sorted(readings, key=lambda reading: reading.stat.avg, reverse=True)


def _answer(stat: Optional[_Stat]) -> Optional[Dict[str, Optional[float]]]:
    return None if stat is None else stat.answer()


class _ThreadCounters(NamedTuple):
    issue_rate: Optional[_Stat]
    stall_rate: Optional[_Stat]
    stall_overlap: Optional[_Stat]
    # Above 0 on some core, by average.
    waits: List[_Named]
    zero_waits: List[str]
    # None for a thread with no math pipeline.
    math_pipeline_stalls: Optional[List[_Named]]

    def answer(self) -> Dict[str, object]:
        answer: Dict[str, object] = {
            "issue_rate": _answer(self.issue_rate),
            "stall_rate": _answer(self.stall_rate),
            "stall_overlap": _answer(self.stall_overlap),
            "waits": [wait.answer() for wait in self.waits],
            "zero_waits": self.zero_waits,
        }
        if self.math_pipeline_stalls is not None:
            answer["math_pipeline_stalls"] = [
                stall.answer() for stall in self.math_pipeline_stalls
            ]
        return answer


def _thread_counters(
    thread: ThreadLabels, read: CounterReader, header: CounterHeader
) -> _ThreadCounters:
    waits: List[_Named] = []
    zero_waits: List[str] = []
    for label in thread.waits:
        stat = _stat(read, label) if label in header.columns else None
        if stat is None:
            continue
        if stat.reads_zero:
            zero_waits.append(label)
        else:
            waits.append(_Named(label, stat))
    pipeline_stalls: Optional[List[_Named]] = None
    if thread.math_pipeline_stalls:
        pipeline_stalls = _by_average(
            [
                _Named(label, stat)
                for label in thread.math_pipeline_stalls
                if (stat := _stat(read, label)) is not None
            ]
        )
    return _ThreadCounters(
        _stat(read, thread.issue_rate),
        _stat(read, thread.stall_rate),
        _stat(read, thread.stall_overlap),
        _by_average(waits),
        zero_waits,
        pipeline_stalls,
    )


class _CbWait(NamedTuple):
    """tt-metal sums a zone's time over the op's cores: the per-core average divides it
    by the op's core count, and the share is of the op's kernel duration."""

    sum_us: float
    per_core_us: Optional[float]
    kernel_share_percent: Optional[float]

    @classmethod
    def of(
        cls, total_ns: float, cores: Optional[int], kernel_ns: Optional[float]
    ) -> "_CbWait":
        per_core_ns = total_ns / cores if cores is not None else None
        return cls(
            _rounded(total_ns / _NS_PER_US),
            None if per_core_ns is None else _rounded(per_core_ns / _NS_PER_US),
            (
                _rounded(per_core_ns / kernel_ns * 100)
                if per_core_ns is not None and kernel_ns is not None
                else None
            ),
        )

    def answer(self) -> Dict[str, Optional[float]]:
        return {
            "sum_us": self.sum_us,
            "per_core_us": self.per_core_us,
            "kernel_share_percent": self.kernel_share_percent,
        }


class _OpCells(NamedTuple):
    """The raw cells an op's stalls read besides its counters."""

    compute_kernel: Optional[bool]
    cores: Optional[int]
    kernel_ns: Optional[float]
    per_core_kernel_ns: Optional[float]
    sums: Dict[CbWaitZone, Optional[float]]

    @classmethod
    def of(cls, row: Mapping[str, object]) -> "_OpCells":
        return cls(
            has_compute_kernel(row),
            core_count(row),
            _positive(row, KERNEL_DURATION_COLUMN),
            _positive(row, PER_CORE_KERNEL_COLUMN),
            {zone: _number(row, column) for zone, column in CB_WAIT_COLUMNS.items()},
        )

    def cb_wait(self, zone: Optional[CbWaitZone]) -> Optional[_CbWait]:
        """The zone's poll, for a row whose CB waits are filled: held, and not ignored."""
        total = self.sums[zone] if zone is not None else None
        if total is None or cb_waits_ignored(self.compute_kernel):
            return None
        return _CbWait.of(total, self.cores, self.kernel_ns)


def _cb_state(cells: _OpCells, sum_profiled: Callable[[], bool]) -> StallState:
    held = any(total is not None for total in cells.sums.values())
    if cb_waits_ignored(cells.compute_kernel):
        return StallState.IGNORED if held else StallState.NO_VALUE
    if held:
        return StallState.FILLED
    return StallState.NO_VALUE if sum_profiled() else StallState.NOT_CAPTURED


def _part(state: StallState, fill_hint: str) -> Dict[str, object]:
    """A part's state, and what fills it where the capture lacks it, as a counter's
    absence names its fill hint."""
    return {
        "state": state.value,
        "fill_hint": fill_hint if state is StallState.NOT_CAPTURED else None,
    }


class _ThreadStall(NamedTuple):
    """The figures a thread's part in the largest stall is read from."""

    stall_rate: Optional[float]
    cb_zone: Optional[CbWaitZone]
    cb_wait: Optional[_CbWait]


class _ThreadRead(NamedTuple):
    labels: ThreadLabels
    counters: Optional[_ThreadCounters]
    cb_wait: Optional[_CbWait]

    def stall(self) -> _ThreadStall:
        rate = self.counters.stall_rate if self.counters else None
        return _ThreadStall(
            rate.avg if rate else None, self.labels.cb_zone, self.cb_wait
        )


class _Stall(NamedTuple):
    percent: float
    # The thread's index in `THREADS`.
    thread: int
    # The CB poll that set it; None for the thread's stall rate.
    zone: Optional[CbWaitZone]


def _largest_stall(threads: Sequence[_ThreadStall]) -> Optional[_Stall]:
    """The largest of the threads' stall rates and CB poll shares, never their sum: a
    TRISC can poll a CB while instructions it already issued stall."""
    largest: Optional[_Stall] = None
    for index, thread in enumerate(threads):
        figures: List[Tuple[Optional[float], Optional[CbWaitZone]]] = [
            (thread.stall_rate, None)
        ]
        if thread.cb_wait is not None:
            figures.append((thread.cb_wait.kernel_share_percent, thread.cb_zone))
        for percent, zone in figures:
            if percent is not None and (largest is None or percent > largest.percent):
                largest = _Stall(percent, index, zone)
    return largest


def _stalled_us(
    stall: _Stall, threads: Sequence[_ThreadStall], per_core_kernel_ns: Optional[float]
) -> Optional[float]:
    """The stalled share as an average core's time: a CB poll's own per-core figure, or a
    stall rate, a share of each core's counted cycles, of the per-core kernel time."""
    if stall.zone is not None:
        cb_wait = threads[stall.thread].cb_wait
        return cb_wait.per_core_us if cb_wait else None
    if per_core_kernel_ns is None:
        return None
    return _rounded(stall.percent / 100 * per_core_kernel_ns / _NS_PER_US)


def _largest_wait(stall: _Stall, thread: _ThreadRead) -> Optional[Dict[str, object]]:
    """The wait behind the largest stall: the CB poll itself, or the stalled thread's
    named wait with the highest average, which can read above its stall rate and is
    marked downstream where it waits on an earlier stage."""
    if stall.zone is not None:
        return {
            "label": stall.zone.value,
            "source": StallSource.INSTRUMENTATION.value,
            "percent": stall.percent,
            "downstream": False,
        }
    counters = thread.counters
    if counters is None or not counters.waits:
        return None
    top = counters.waits[0]
    return {
        "label": top.label,
        "source": StallSource.HARDWARE_COUNTER.value,
        "percent": top.stat.avg,
        "downstream": top.label in thread.labels.downstream_waits,
    }


def _stall_answer(
    stall: Optional[_Stall],
    threads: List[_ThreadRead],
    stalls: Sequence[_ThreadStall],
    per_core_kernel_ns: Optional[float],
) -> Dict[str, object]:
    if stall is None:
        return dict.fromkeys(
            ("stalled_percent", "stalled_us", "stalled_thread", "largest_wait")
        )
    thread = threads[stall.thread]
    return {
        "stalled_percent": stall.percent,
        "stalled_us": _stalled_us(stall, stalls, per_core_kernel_ns),
        "stalled_thread": thread.labels.thread.value,
        "largest_wait": _largest_wait(stall, thread),
    }


def _thread_answer(thread: _ThreadRead) -> Dict[str, object]:
    zone = thread.labels.cb_zone
    return {
        "thread": thread.labels.thread.value,
        "role": thread.labels.role.value,
        "hardware_counters": thread.counters.answer() if thread.counters else None,
        "instrumentation": (
            {zone.value: thread.cb_wait.answer()}
            if thread.cb_wait is not None and zone is not None
            else None
        ),
    }


def operation_stalls(
    row: Mapping[str, object],
    read: CounterReader,
    header: CounterHeader,
    sum_profiled: Callable[[], bool],
) -> Dict[str, object]:
    """One op's stalls per thread. `row` holds its raw CSV cells for `RAW_COLUMNS`;
    `sum_profiled` says whether any op of the capture has a CB wait, asked only of a
    compute op with none, so a caller reading one row reads the others only then."""
    cells = _OpCells.of(row)
    cb_state = _cb_state(cells, sum_profiled)

    counted = has_thread_counters(header)
    threads = [
        _ThreadRead(
            labels,
            _thread_counters(labels, read, header) if counted else None,
            cells.cb_wait(labels.cb_zone),
        )
        for labels in THREADS
    ]

    if not counted:
        counter_state = StallState.NOT_CAPTURED
    elif all(
        thread.counters is None or thread.counters.stall_rate is None
        for thread in threads
    ):
        counter_state = StallState.NO_VALUE
        threads = [thread._replace(counters=None) for thread in threads]
    else:
        counter_state = StallState.FILLED

    stalls = [thread.stall() for thread in threads]
    return {
        "has_compute_kernel": cells.compute_kernel,
        "counters": _part(counter_state, COUNTERS_FILL_HINT),
        "cb_waits": _part(cb_state, CB_WAITS_FILL_HINT),
        "core_count": cells.cores,
        "kernel_duration_us": (
            None if cells.kernel_ns is None else _rounded(cells.kernel_ns / _NS_PER_US)
        ),
        **_stall_answer(
            _largest_stall(stalls), threads, stalls, cells.per_core_kernel_ns
        ),
        "threads": [_thread_answer(thread) for thread in threads],
    }


def stalled_us(
    row: Mapping[str, object], read: CounterReader, header: CounterHeader
) -> Optional[float]:
    """`operation_stalls`'s `stalled_us`, read from the thread stall rates and CB sums
    alone, so many ops can be ranked before a few are answered in full."""
    cells = _OpCells.of(row)
    counted = has_thread_counters(header)
    stalls = [
        _ThreadStall(
            read(labels.stall_rate, CounterStat.AVG) if counted else None,
            labels.cb_zone,
            cells.cb_wait(labels.cb_zone),
        )
        for labels in THREADS
    ]
    stall = _largest_stall(stalls)
    return (
        None if stall is None else _stalled_us(stall, stalls, cells.per_core_kernel_ns)
    )


def has_cb_waits(row: Mapping[str, object]) -> bool:
    """Whether a row carries a CB wait a compute kernel recorded."""
    return not cb_waits_ignored(has_compute_kernel(row)) and any(
        _number(row, column) is not None for column in CB_WAIT_COLUMNS.values()
    )


_CB_ROW_COLUMNS = (COMPUTE_KERNEL_SOURCE_COLUMN, *CB_WAIT_COLUMNS.values())


def capture_has_cb_waits(source: TextIO) -> bool:
    """Whether any op of a CSV carries a CB wait, which only sum profiling writes; read
    up to the first that does."""
    with hardware_counters.readable_csv():
        rows = csv.reader(source)
        header = next(rows, [])
        indexes = {
            name: header.index(name) for name in _CB_ROW_COLUMNS if name in header
        }
        if not set(CB_WAIT_COLUMNS.values()) & indexes.keys():
            return False
        for row in rows:
            width = len(row)
            cells = {
                name: row[index] for name, index in indexes.items() if index < width
            }
            if has_cb_waits(cells):
                return True
    return False


__all__ = [
    "CB_WAITS_FILL_HINT",
    "CB_WAIT_COLUMNS",
    "CORE_COUNT_COLUMN",
    "COUNTERS_FILL_HINT",
    "KERNEL_DURATION_COLUMN",
    "PER_CORE_KERNEL_COLUMN",
    "RAW_COLUMNS",
    "STALL_CAPTURE_FLAGS",
    "STALL_COUNTER_GROUPS",
    "STALL_GROUPS",
    "SUM_PROFILING_FLAG",
    "THREADS",
    "CbWaitZone",
    "PipelineThread",
    "StallSource",
    "StallState",
    "ThreadLabels",
    "ThreadRole",
    "capture_has_cb_waits",
    "cb_waits_ignored",
    "core_count",
    "has_cb_waits",
    "has_thread_counters",
    "operation_stalls",
    "stalled_us",
    "wait_labels_absent",
]
