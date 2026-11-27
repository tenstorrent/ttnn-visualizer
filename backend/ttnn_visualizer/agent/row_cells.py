# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""A performance report column read as the app's `enrichRowData` reads it. #2440

`enrichRowData` in `src/functions/enrichPerfRowData.ts` reads some text columns with
`parseFloat`, `cores` with `parseInt(…, 10)`, and some only where the cell is truthy, so
`"1abc"` is 1 and `"1_0"` is 1 where Python's `float` refuses the one and reads 10 for the
other. A tool that ranks, reports or sums one of these columns reads it here, so the
number is the app's: the text metrics and the detail fields beside them. The app parses
a few more (the seven `*_kernel_duration` columns, `pm_ideal_ns` and `available_cores`),
which `perf_detail` and `perf_flags` still read on their own (#2449). `tools`, `perf_detail` and `perf_flags`
all read these columns, and `perf_detail` sits below the other two, so the table lives in
neither; mirror a change in `enrichRowData` here.
"""

from typing import Callable, Dict, FrozenSet, Optional

from ttnn_visualizer.agent.js_values import (
    js_is_finite,
    js_parse_float,
    js_parse_int,
    js_truthy,
)


def parse_filled_float(value: object) -> Optional[float]:
    """`value ? parseFloat(value) : null`, which may be NaN."""
    return js_parse_float(value) if js_truthy(value) else None


def parse_int(value: object) -> float:
    """`parseInt(value, 10)` as a float, which may be NaN."""
    return float(js_parse_int(value))


_READS: Dict[str, Callable[[object], Optional[float]]] = {
    "device_time": js_parse_float,
    "op_to_op_gap": js_parse_float,
    "total_percent": js_parse_float,
    "cores": parse_int,
    "dram": parse_filled_float,
    "dram_percent": parse_filled_float,
    "flops": parse_filled_float,
    "flops_percent": parse_filled_float,
}

# The columns read here; `tools.metric_number` reads any other with `finite_number`.
COLUMNS: FrozenSet[str] = frozenset(_READS)


def read(column: str, cell: object) -> Optional[float]:
    """`column`'s cell as the app reads it, NaN and infinity kept, for a port that
    restates what the app does with them."""
    return _READS[column](cell)


def cell_number(column: str, cell: object) -> Optional[float]:
    """`column`'s cell as the app reads it, or None where that is null, NaN or infinite:
    either of the last two would reach the client as invalid JSON."""
    value = read(column, cell)
    return value if value is not None and js_is_finite(value) else None


__all__ = ["COLUMNS", "cell_number", "parse_filled_float", "parse_int", "read"]
