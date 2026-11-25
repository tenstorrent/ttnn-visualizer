# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""A synthetic counter capture: the smoke rows with counter columns in the header
shapes tt-metal's `tools/tracy/perf_counter_analysis.py` writes."""

from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

from ttnn_visualizer.csv_queries import DeviceLogProfilerQueries
from ttnn_visualizer.tests.smoke_capture import smoke_rows, write_ops_perf
from ttnn_visualizer.tests.test_device_log_columns import MODERN_HEADER

STATS = ("Min", "Median", "Max", "Avg")

# Captured with fpu, unpack, instrn and l1_0, and a label this version does not know.
PERCENT_LABELS = (
    "FPU Util",
    "SFPU Util",
    "MATH Util",
    "Unpacker0 Busy T0 Util",
    "Unpacker1 Busy T0 Util",
    "Thread 0 Stall Rate",
    "L1 Total Bandwidth Util",
    "NOC Ring 0 Util",
    "Renamed Busy Metric",
)
RATIO_LABELS = ("Unpacker-to-Math Data Flow (srcA)",)
FULL_GRID_COLUMNS = (
    "Avg SFPU util on full grid (%)",
    "Avg FPU util on full grid (%)",
    "Avg Math util on full grid (%)",
)
UNKNOWN_LABEL = "Renamed Busy Metric"

# A device op whose compute kernel never ran records no counters at all.
NO_COMPUTE_EVERY = 5

BLACKHOLE_PREAMBLE = "ARCH: blackhole, CHIP_FREQ[MHz]: 1350, Max Compute Cores: 130"
WORMHOLE_PREAMBLE = "ARCH: wormhole_b0, CHIP_FREQ[MHz]: 1000, Max Compute Cores: 64"


def stat_column(label: str, stat: str, ratio: bool = False) -> str:
    return f"{label} {stat} ({'ratio' if ratio else '%'})"


def counter_columns() -> List[str]:
    return [
        *(stat_column(label, stat) for label in PERCENT_LABELS for stat in STATS),
        *(stat_column(label, stat, True) for label in RATIO_LABELS for stat in STATS),
        *FULL_GRID_COLUMNS,
    ]


def label_values(label_index: int, position: int) -> Tuple[float, float, float, float]:
    """Min, Median, Max and Avg for one label on one row, distinct for each."""
    base = 5.0 * (label_index + 1) + position
    return base - 2.0, base, base + 2.0, base + 0.25


def is_counted(position: int) -> bool:
    return position % NO_COMPUTE_EVERY != NO_COMPUTE_EVERY - 1


def _counter_cells(position: int) -> Dict[str, str]:
    if not is_counted(position):
        return {column: "" for column in counter_columns()}
    cells: Dict[str, str] = {}
    labels = [*PERCENT_LABELS, *RATIO_LABELS]
    for index, label in enumerate(labels):
        ratio = label in RATIO_LABELS
        for stat, value in zip(STATS, label_values(index, position)):
            cells[stat_column(label, stat, ratio)] = repr(
                value / 100 if ratio else value
            )
    for index, column in enumerate(FULL_GRID_COLUMNS):
        cells[column] = repr(1.5 * (index + 1) + position)
    return cells


def counter_rows(
    rows: Optional[Sequence[Dict[str, str]]] = None,
) -> List[Dict[str, str]]:
    """`rows`, or the smoke rows, with the counter columns after every other column."""
    return [
        {**row, **_counter_cells(position)}
        for position, row in enumerate(rows if rows is not None else smoke_rows())
    ]


def write_device_log(directory: Path, preamble: str = BLACKHOLE_PREAMBLE) -> Path:
    path = directory / DeviceLogProfilerQueries.DEVICE_LOG_FILE
    path.write_text(f"{preamble}\n{MODERN_HEADER}\n", encoding="utf-8")
    return path


def write_counter_capture(directory: Path, preamble: str = BLACKHOLE_PREAMBLE) -> Path:
    """A counter capture and its device log in `directory`."""
    destination = write_ops_perf(directory, counter_rows())
    write_device_log(directory, preamble)
    return destination
