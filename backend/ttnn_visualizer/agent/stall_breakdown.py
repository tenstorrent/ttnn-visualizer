# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Where each op's compute kernel stalled and waited, per thread: tt-metal's hardware
counters beside the circular-buffer polls its sum zones time. #2372"""

import heapq
from enum import Enum
from typing import Dict, Iterable, List, Optional, Tuple

from ttnn_visualizer import hardware_counters, pipeline_stalls
from ttnn_visualizer.agent import tools
from ttnn_visualizer.agent.bounds import (
    MAX_DETAILED_LIMIT,
    MAX_OP_CODE_CHARS,
    bounded,
    cut_op_code,
    echoed,
    shown_op_code,
)
from ttnn_visualizer.agent.handles import CacheVariant, ReportRegistry
from ttnn_visualizer.cells import finite_number, whole_number
from ttnn_visualizer.csv_queries import OpsPerformanceReportQueries
from ttnn_visualizer.device_architecture import DeviceArchitecture
from ttnn_visualizer.hardware_counters import CaptureGroup, CounterTable
from ttnn_visualizer.models import Instance

MAX_PERF_IDS = MAX_DETAILED_LIMIT
MAX_LISTED_OP_CODES = 20

# The groups this tool reads; fpu, which the recommended capture adds, it does not.
_READ_GROUPS = (CaptureGroup.INSTRN, CaptureGroup.UNPACK, CaptureGroup.PACK)

# The canonical rows carry each raw column a row's stalls read under the report's key.
_REPORT_KEY_BY_COLUMN = {
    column: key
    for key, column in {
        **OpsPerformanceReportQueries.PASSTHROUGH_COLUMNS,
        **OpsPerformanceReportQueries.DETAIL_COLUMNS,
    }.items()
}


class Selection(str, Enum):
    TOP_DEVICE_TIME = "top_device_time"
    PERF_IDS = "perf_ids"
    OP_CODE = "op_code"


STALL_BREAKDOWN_NOTE = (
    "Each op's compute kernel per thread: t0 unpack, t1 math, t2 pack. "
    "hardware_counters are tt-metal's Tensix counters, each the avg, min and max across "
    "the cores that ran the kernel, as a share of the cycles the counters ran on each "
    "core: issue_rate is cycles the thread issued an instruction, stall_rate cycles "
    "its next one was blocked, and waits are the named wait conditions by avg, those "
    "reading 0 on every core named in zero_waits. stall_overlap is no share but "
    "tt-llk's ratio of the thread's waits summed over its cycles: 0.79 means they add "
    "up to 79% of them, and it can pass 1. tt-llk counts each wait apart from "
    "the stall rate rather than as a split of it, so waits overlap each other and the "
    "stall rate, never add up to it, and can read above it; Semaphore Zero Wait T2, the "
    "packer waiting for math's result, reads high whenever math or a stage before it "
    "holds the pipeline up. math_pipeline_stalls are "
    "shares of the cycles a math instruction was ready. instrumentation is tt-metal's "
    "sum zones (--enable-sum-profiling) around the RISC-V polls the counters cannot "
    "see, so a stall rate near 0 does not mean the op never waited: cb_wait_front on "
    "the unpack core, waiting for input, and cb_reserve_back on the pack core, waiting "
    "for output space. The CSV sums each over the op's cores; per_core_us divides it "
    "by core_count, the CSV's CORE COUNT, so it reads low where fewer cores ran the "
    "kernel, and kernel_share_percent is that over the op's kernel duration. An op "
    "without a compute kernel has no counters, and its CB columns, a copy of the "
    "previous op's, are ignored. counters and cb_waits each give their state, with a "
    "fill_hint where the capture lacks them. stalled_percent is the largest of the "
    "op's thread stall rates and CB poll shares, never their sum. stalled_us estimates "
    "it as an average core's time, and ranks the ops: a CB poll's per_core_us, or a "
    "stall rate times the op's per-core average kernel duration, since the counters "
    "count each core's own cycles. stalled_thread is the thread it came from and "
    "largest_wait the wait behind it: the CB poll, or that thread's highest named "
    "wait, null when none reads above 0. downstream marks a wait on an earlier stage, "
    "such as Semaphore Zero Wait T2: a symptom, so read the threads before it. "
    "Rows are merged across devices, so a multi-device op's figures are the row "
    "tt-perf-report keeps: the slowest device's, or the first device's for an "
    "all-gather, reduce-scatter or all-reduce."
)

NO_SUM_PROFILING_CAVEAT = (
    "This capture has no CB wait figures, so the time the unpack and pack cores spent "
    "polling circular buffers is missing, and the counters cannot see it: a stall rate "
    "near 0 does not mean an op did not wait for data. Capture with "
    f"{pipeline_stalls.SUM_PROFILING_FLAG} as well."
)


def _raw_cells(row: Dict) -> Dict[str, object]:
    """A report row's cells for the raw columns a row's stalls read."""
    return {
        column: row.get(_REPORT_KEY_BY_COLUMN[column])
        for column in pipeline_stalls.RAW_COLUMNS
    }


def _ops(rows: Iterable[Dict]) -> List[Dict]:
    return [row for row in rows if not tools.is_signpost_row(row)]


def _op_codes(row: Dict) -> Tuple[str, ...]:
    return tuple(
        str(row.get(key) or "").strip().casefold() for key in ("raw_op_code", "op_code")
    )


def _by_op_code(rows: List[Dict], op_code: str) -> List[Dict]:
    wanted = op_code.strip().casefold()
    matched = [row for row in rows if wanted in _op_codes(row)]
    if matched:
        return matched
    known = list(
        dict.fromkeys(code for row in rows if (code := tools.raw_op_code(row)))
    )
    listed = ", ".join(shown_op_code(code) for code in known[:MAX_LISTED_OP_CODES])
    more = len(known) - MAX_LISTED_OP_CODES
    raise ValueError(
        f"no operation has the op code {shown_op_code(op_code)}; this report's raw op "
        f"codes are {listed or 'none'}" + (f" and {more} more" if more > 0 else "")
    )


def _require_perf_ids(perf_ids: object) -> List[str]:
    if not isinstance(perf_ids, list) or not perf_ids:
        raise ValueError(
            "perf_ids must be a non-empty list of performance row ids; omit it for the "
            "costliest ops by device time"
        )
    if len(perf_ids) > MAX_PERF_IDS:
        raise ValueError(f"perf_ids takes at most {MAX_PERF_IDS} ids")
    ids: List[str] = []
    for perf_id in perf_ids:
        if isinstance(perf_id, bool) or not isinstance(perf_id, (str, int)):
            raise ValueError(
                f"perf_ids holds {echoed(perf_id)}, which is not a performance row id"
            )
        if str(perf_id) not in ids:
            ids.append(str(perf_id))
    return ids


def _sum_profiling(registry: ReportRegistry, handle: str) -> bool:
    """Whether any op of the report carries a CB wait, which only sum profiling writes;
    read once per handle, since a capture without it is read to its end."""

    def build(_instance: Instance) -> bool:
        rows = tools.canonical_report(registry, handle).get("report", [])
        return any(pipeline_stalls.has_cb_waits(_raw_cells(row)) for row in _ops(rows))

    return registry.cached_report(handle, build, variant=CacheVariant.SUM_PROFILING)


def _op_entry(row: Dict, table: CounterTable, sum_profiling: bool) -> Dict[str, object]:
    stalls = pipeline_stalls.operation_stalls(
        _raw_cells(row),
        table.reader(tools.csv_position(row)),
        table.header,
        lambda: sum_profiling,
    )
    return {
        **tools.project_row(row),
        "device": whole_number(row.get("device")),
        **stalls,
    }


def _rank_key(stalled_us: object, device_time: object) -> Tuple[bool, float, float]:
    """Most stalled device time first; ops with none last, costliest first."""
    stalled = finite_number(stalled_us)
    return (
        stalled is None,
        -(stalled or 0.0),
        -(finite_number(device_time) or 0.0),
    )


def _ranked(entries: List[Dict[str, object]]) -> List[Dict[str, object]]:
    return sorted(
        entries,
        key=lambda entry: _rank_key(entry["stalled_us"], entry.get("device_time")),
    )


def _most_stalled(rows: List[Dict], table: CounterTable, count: int) -> List[Dict]:
    """The `count` rows `_ranked` puts first, each ranked on its stalled time alone: a
    decode loop calls one op code thousands of times."""

    def key(row: Dict) -> Tuple[bool, float, float]:
        stalled = pipeline_stalls.stalled_us(
            _raw_cells(row), table.reader(tools.csv_position(row)), table.header
        )
        return _rank_key(stalled, tools.metric_value(row))

    return heapq.nsmallest(count, rows, key=key)


def _capture(
    table: CounterTable, architecture: DeviceArchitecture, sum_profiling: bool
) -> Dict[str, object]:
    """Which of the groups it reads the capture filled, as `hw_utilisation` names them,
    and whether it had sum profiling, with what fills either where it lacks one."""
    states = hardware_counters.group_states(table.header, architecture)
    groups = {group.value: states[group].value for group in _READ_GROUPS}
    capture: Dict[str, object] = {
        "capture_groups": groups,
        "sum_profiling": sum_profiling,
    }
    filled = hardware_counters.GroupState.FILLED.value
    if not sum_profiling or any(state != filled for state in groups.values()):
        capture["fill_hint"] = f"Capture with {pipeline_stalls.STALL_CAPTURE_FLAGS}."
    return capture


def stall_breakdown(
    registry: ReportRegistry,
    handle: str,
    perf_ids: Optional[List[object]] = None,
    op_code: Optional[str] = None,
    limit: Optional[int] = None,
) -> Dict[str, object]:
    """Each selected op's stalls per thread, ranked by stalled device time."""
    if perf_ids is not None and op_code is not None:
        raise ValueError("pass perf_ids or op_code, not both")
    ids = _require_perf_ids(perf_ids) if perf_ids is not None else None
    if op_code is not None:
        if not isinstance(op_code, str):
            raise ValueError(f"op_code must be text, not {echoed(op_code)}")
        if len(op_code) > MAX_OP_CODE_CHARS:
            raise ValueError(
                f"op_code is {len(op_code):,} characters; a tool shows an op code of "
                f"at most {MAX_OP_CODE_CHARS}"
            )
    count = bounded(limit, MAX_DETAILED_LIMIT)

    table = tools.counter_table(registry, handle)
    if not pipeline_stalls.has_thread_counters(table.header):
        raise ValueError(
            f"the performance CSV behind {handle!r} has no per-thread stall counters, "
            "which tt-metal's instrn group writes, and its CB waits alone are out of "
            f"scope. Capture with {pipeline_stalls.STALL_CAPTURE_FLAGS}."
        )
    rows = tools.canonical_report(registry, handle).get("report", [])
    ops = _ops(rows)
    sum_profiling = _sum_profiling(registry, handle)

    # The ops a selection names, and the ones it reads: an op code's calls are ranked
    # before the limit cuts them, the costliest ops by device time after.
    if ids is not None:
        selection = Selection.PERF_IDS
        matched = chosen = tools.perf_rows(rows, ids)
    elif op_code is not None:
        selection = Selection.OP_CODE
        matched = _by_op_code(ops, op_code)
        chosen = _most_stalled(matched, table, count)
    else:
        selection = Selection.TOP_DEVICE_TIME
        matched = tools.costliest_rows(ops)
        chosen = matched[:count]

    entries = _ranked([_op_entry(row, table, sum_profiling) for row in chosen])

    architecture = tools.device_architecture(registry, handle)
    report_total = sum(tools.countable_device_time(row) or 0.0 for row in ops)
    result: Dict[str, object] = {
        "handle": handle,
        **tools.device_time_header(report_total),
        "architecture": architecture.value or None,
        **_capture(table, architecture, sum_profiling),
        "selection": selection.value,
        **(cut_op_code("op_code", op_code) if op_code is not None else {}),
        "matched": len(matched),
        "returned": len(entries),
        "ops": entries,
        "note": STALL_BREAKDOWN_NOTE,
    }
    absent = pipeline_stalls.wait_labels_absent(table.header)
    if absent:
        result["wait_labels_absent"] = absent
    caveats = [
        tools.partitioned_caveat(rows),
        None if sum_profiling else NO_SUM_PROFILING_CAVEAT,
    ]
    if any(caveats):
        result["caveat"] = " ".join(caveat for caveat in caveats if caveat)
    return result


__all__ = [
    "MAX_LISTED_OP_CODES",
    "MAX_PERF_IDS",
    "NO_SUM_PROFILING_CAVEAT",
    "STALL_BREAKDOWN_NOTE",
    "Selection",
    "stall_breakdown",
]
