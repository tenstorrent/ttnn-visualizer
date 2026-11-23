# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""A synthetic Blackhole capture of the stall counters and CB waits in tt-metal's column
shapes: CB sums over cores, `[]` for an op without a compute kernel, and on the first such
op after a compute op, that op's CB sums again. The values are round figures."""

from pathlib import Path
from typing import Dict, List, NamedTuple, Optional, Tuple, Union

from ttnn_visualizer.tests.hardware_counter_capture import (
    BLACKHOLE_PREAMBLE,
    STATS,
    stat_column,
    write_device_log,
)
from ttnn_visualizer.tests.smoke_capture import smoke_rows, write_ops_perf

CB_WAIT_FRONT = "DEVICE COMPUTE CB WAIT FRONT [ns]"
CB_RESERVE_BACK = "DEVICE COMPUTE CB RESERVE BACK [ns]"
CORE_COUNT = "CORE COUNT"
KERNEL_DURATION = "DEVICE KERNEL DURATION [ns]"
PER_CORE_KERNEL = "DEVICE KERNEL DURATION PER CORE AVG [ns]"
COMPUTE_KERNEL_SOURCE = "COMPUTE KERNEL SOURCE"
# An average core's kernel time as a share of the op's, whose cores start apart.
PER_CORE_SHARE = 0.75

RATIO_LABELS = ("Stall Overlap T0", "Stall Overlap T1", "Stall Overlap T2")
PERCENT_LABELS = (
    "T0 Instrn Issue Rate",
    "T1 Instrn Issue Rate",
    "T2 Instrn Issue Rate",
    "Thread 0 Stall Rate",
    "Thread 1 Stall Rate",
    "Thread 2 Stall Rate",
    "Any-Thread Stall Rate",
    "Unpack Idle Wait T0",
    "Unpack Waiting on Pack (T0)",
    "THCON Idle Wait T0",
    "CFG Idle Wait T0",
    "MOVE Idle Wait T0",
    "Semaphore Zero Wait T0",
    "Semaphore Full Wait T0",
    "SrcA Clear Wait",
    "SrcB Clear Wait",
    "Math Idle Wait T1",
    "Math Waiting on Unpack (T1)",
    "SFPU Idle Wait T1",
    "Semaphore Zero Wait T1",
    "Semaphore Full Wait T1",
    "SrcA Valid Wait",
    "SrcB Valid Wait",
    "Pack Idle Wait T2",
    "Pack Waiting on Math (T2)",
    "Semaphore Zero Wait T2",
    "Semaphore Full Wait T2",
    "Data Hazard Stall Rate",
    "Math Scoreboard Stall Rate",
    # One label for each of the other groups, so the capture reads as filling them.
    "FPU Util",
    "Packer Utilization",
    "Unpacker0 Busy T0 Util",
)
Stats = Tuple[float, float, float, float]
# One op's counters: a label's average, or its min, median, max and average.
Counters = Dict[str, Union[float, Stats]]


class StallOp(NamedTuple):
    """One fixture row: its counters, CB sums over its cores, cores and kernel."""

    cores: int
    kernel_ns: int
    compute_kernel: bool
    cb_wait_front_ns: Optional[int] = None
    cb_reserve_back_ns: Optional[int] = None
    counters: Optional[Counters] = None


def _stats(value: Union[float, Stats]) -> Stats:
    if isinstance(value, tuple):
        return value
    return value * 0.9, value, value * 1.1, value


# Starved of input, as a matmul reading DRAM is: its unpack core polls cb_wait_front for
# three quarters of the kernel while its counters show almost no stall.
INPUT_STARVED: Counters = {
    "T0 Instrn Issue Rate": 3.1,
    "T1 Instrn Issue Rate": 10.8,
    "T2 Instrn Issue Rate": 8.1,
    "Thread 0 Stall Rate": 2.0,
    "Thread 1 Stall Rate": 0.6,
    "Thread 2 Stall Rate": 11.2,
    "Any-Thread Stall Rate": 13.5,
    "THCON Idle Wait T0": 1.5,
    "Unpack Idle Wait T0": 0.5,
    "CFG Idle Wait T0": 0.1,
    "Math Idle Wait T1": 0.6,
    "SFPU Idle Wait T1": 0.6,
    "Semaphore Full Wait T1": 0.1,
    "Semaphore Zero Wait T2": 76.4,
    "Pack Idle Wait T2": 1.9,
    "Stall Overlap T0": 0.02,
    "Stall Overlap T1": 0.013,
    "Stall Overlap T2": 0.786,
    "FPU Util": 9.4,
    "Packer Utilization": 8.0,
    "Unpacker0 Busy T0 Util": 8.0,
}

# Bound by its unpacker, as an SFPU op can be: the stall rate beats the CB poll.
UNPACK_BOUND: Counters = {
    "T0 Instrn Issue Rate": 0.5,
    "T1 Instrn Issue Rate": 68.0,
    "T2 Instrn Issue Rate": 1.1,
    "Thread 0 Stall Rate": 27.7,
    "Thread 1 Stall Rate": 0.2,
    "Thread 2 Stall Rate": 0.7,
    "Any-Thread Stall Rate": 28.5,
    "Unpack Idle Wait T0": 27.8,
    # Zero on average once rounded, but not on every core.
    "CFG Idle Wait T0": (0.0, 0.0, 0.05, 0.0004),
    "Math Idle Wait T1": 0.2,
    "SFPU Idle Wait T1": 0.2,
    "Semaphore Zero Wait T2": 87.3,
    "Pack Idle Wait T2": 0.6,
    "Stall Overlap T0": 0.278,
    "Stall Overlap T1": 0.005,
    "Stall Overlap T2": 0.88,
    "FPU Util": 0.3,
    "Packer Utilization": 1.0,
    "Unpacker0 Busy T0 Util": 30.0,
}

# Blocked on output space, its pack core polling cb_reserve_back; its math pipeline
# also stalls on the scoreboard.
OUTPUT_BLOCKED: Counters = {
    "T0 Instrn Issue Rate": 6.4,
    "T1 Instrn Issue Rate": 33.7,
    "T2 Instrn Issue Rate": 8.4,
    "Thread 0 Stall Rate": 3.7,
    "Thread 1 Stall Rate": 3.9,
    "Thread 2 Stall Rate": 1.8,
    "Any-Thread Stall Rate": 9.0,
    "Unpack Idle Wait T0": 3.3,
    "CFG Idle Wait T0": 0.6,
    "Math Idle Wait T1": 0.7,
    "SFPU Idle Wait T1": 0.3,
    "Semaphore Full Wait T1": 3.4,
    "Semaphore Zero Wait T2": 71.3,
    "Pack Idle Wait T2": 1.5,
    "Data Hazard Stall Rate": 6.0,
    "Math Scoreboard Stall Rate": 33.2,
    "Stall Overlap T0": 0.039,
    "Stall Overlap T1": 0.044,
    "Stall Overlap T2": 0.731,
    "FPU Util": 11.7,
    "Packer Utilization": 9.0,
    "Unpacker0 Busy T0 Util": 12.0,
}

# A math stall no named wait explains.
UNNAMED_STALL: Counters = {
    "T0 Instrn Issue Rate": 2.0,
    "T1 Instrn Issue Rate": 20.0,
    "T2 Instrn Issue Rate": 2.0,
    "Thread 0 Stall Rate": 1.0,
    "Thread 1 Stall Rate": 40.0,
    "Thread 2 Stall Rate": 1.0,
    "Any-Thread Stall Rate": 40.5,
    "Stall Overlap T0": 0.0,
    "Stall Overlap T1": 0.0,
    "Stall Overlap T2": 0.0,
    "FPU Util": 20.0,
    "Packer Utilization": 2.0,
    "Unpacker0 Busy T0 Util": 2.0,
}

COMPUTE = True
NO_COMPUTE = False

# Device 0's twelve smoke rows, in order, as these ops.
STALL_OPS: Tuple[StallOp, ...] = (
    StallOp(88, 26_000, COMPUTE, 1_742_400, 330_000, INPUT_STARVED),
    StallOp(120, 6_700, COMPUTE, 150_360, 7_200, UNPACK_BOUND),
    StallOp(8, 17_000, COMPUTE, 51_000, 72_080, OUTPUT_BLOCKED),
    StallOp(8, 6_200, COMPUTE, 2_480, 160, UNNAMED_STALL),
    # A concat: no compute kernel, yet the previous op's CB sums again.
    StallOp(120, 7_700, NO_COMPUTE, 2_480, 160),
    # A slice: no compute kernel and no CB sums.
    StallOp(120, 3_800, NO_COMPUTE),
    StallOp(64, 1_700, NO_COMPUTE),
    StallOp(64, 1_700, NO_COMPUTE),
    StallOp(1, 1_000, NO_COMPUTE),
    StallOp(1, 1_000, NO_COMPUTE),
    StallOp(9, 21_300, NO_COMPUTE),
    # A compute op whose counters were never recorded, its CB waits still timed.
    StallOp(32, 11_600, COMPUTE, 92_800, 9_280),
)

INPUT_STARVED_POSITION = 0
UNPACK_BOUND_POSITION = 1
OUTPUT_BLOCKED_POSITION = 2
UNNAMED_STALL_POSITION = 3
STALE_CB_POSITION = 4
NO_CB_POSITION = 5
UNRECORDED_POSITION = 11

KERNEL_SOURCE = (
    "['ttnn/cpp/ttnn/operations/eltwise/unary/device/kernels/compute/k.cpp']"
)


def _counter_cells(counters: Optional[Counters]) -> Dict[str, str]:
    cells: Dict[str, str] = {}
    for label in (*PERCENT_LABELS, *RATIO_LABELS):
        ratio = label in RATIO_LABELS
        if counters is None:
            values: Tuple[Optional[float], ...] = (None,) * len(STATS)
        else:
            values = _stats(counters.get(label, 0.0))
        for stat, value in zip(STATS, values):
            cells[stat_column(label, stat, ratio)] = (
                "" if value is None else repr(value)
            )
    return cells


def _cell(value: Optional[int]) -> str:
    return "" if value is None else str(value)


def _stall_row(row: Dict[str, str], op: StallOp, sum_profiling: bool) -> Dict[str, str]:
    return {
        **row,
        CORE_COUNT: str(op.cores),
        KERNEL_DURATION: str(op.kernel_ns),
        PER_CORE_KERNEL: str(round(op.kernel_ns * PER_CORE_SHARE)),
        COMPUTE_KERNEL_SOURCE: KERNEL_SOURCE if op.compute_kernel else "[]",
        CB_WAIT_FRONT: _cell(op.cb_wait_front_ns if sum_profiling else None),
        CB_RESERVE_BACK: _cell(op.cb_reserve_back_ns if sum_profiling else None),
        **_counter_cells(op.counters),
    }


def stall_rows(sum_profiling: bool = True) -> List[Dict[str, str]]:
    """Device 0's smoke rows as `STALL_OPS`, the counter columns after every other."""
    template = [row for row in smoke_rows() if row["DEVICE ID"] == "0"]
    assert len(template) == len(STALL_OPS)
    return [_stall_row(row, op, sum_profiling) for row, op in zip(template, STALL_OPS)]


def two_device_stall_rows(device_1: Dict[int, StallOp]) -> List[Dict[str, str]]:
    """Both devices' smoke rows, each device's nth op as `STALL_OPS[n]`, except where
    `device_1` gives device 1's nth op its own."""
    rows = []
    seen = {"0": 0, "1": 0}
    for row in smoke_rows():
        device = row["DEVICE ID"]
        position = seen[device]
        seen[device] += 1
        op = STALL_OPS[position]
        if device == "1":
            op = device_1.get(position, op)
        rows.append(_stall_row(row, op, sum_profiling=True))
    assert seen == {"0": len(STALL_OPS), "1": len(STALL_OPS)}
    return rows


def write_stall_capture(directory: Path, sum_profiling: bool = True) -> Path:
    destination = write_ops_perf(directory, stall_rows(sum_profiling))
    write_device_log(directory, BLACKHOLE_PREAMBLE)
    return destination


def counter_average(position: int, label: str) -> float:
    counters = STALL_OPS[position].counters
    assert counters is not None
    return _stats(counters.get(label, 0.0))[3]


def kernel_share(position: int, total_ns: int) -> float:
    op = STALL_OPS[position]
    return round(total_ns / op.cores / op.kernel_ns * 100, 3)


def per_core_kernel_us(position: int) -> float:
    return round(STALL_OPS[position].kernel_ns * PER_CORE_SHARE) / 1000
