# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Performance rows rolled up by the model-code line that launched them. #2359

A port of `getSourceLineGroups` in `src/functions/perfSourceLines.ts`, the stacked
table's Source line grouping; mirror a change there. The rows are the canonical
report's, whose devices are merged, so there is no per-device key. Each row's
operation and each operation's call site come in from `linking`, which owns the join,
so this module reads neither report.
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import Callable, Dict, List, Mapping, Optional, Sequence, Tuple

from ttnn_visualizer.agent.bounds import cut_op_code

# `TOP_OP_CODE_COUNT` in `perfSourceLines.ts`.
TOP_OP_CODE_COUNT = 3
# A line inside a loop can link thousands of operations; the count says how many.
MAX_LISTED_OPERATION_IDS = 20

SOURCE_LINES_NOTE = (
    "Each performance row is filed under frame 0 of its linked memory report "
    "operation's stack trace, the call site operation_provenance gives, keyed by full "
    "path and line, as the performance view's stacked table groups by Source line. "
    "Device time is summed per line, as tt-perf-report's Device_Time_Sum_us sums it, "
    "so device_time_share_percent of device_time_total adds up to 100 across every "
    "group; the graph view takes an operation's slowest row instead. Every row but a "
    "signpost adds to row_count; only a positive device time adds to device_time. "
    "kind unlinked holds the rows with no linked operation, counted by why in "
    "unlinked_by_reason: host ops, which the app's stacked table hides by default, and "
    "rows past the end of the memory report capture. kind no_trace holds rows whose "
    "operation recorded no stack trace this tool can read. operation_ids are the "
    "memory report database's, in the order the rows first name them."
)


class SourceLineKind(str, Enum):
    """`SourceLineGroupKind`."""

    LINE = "line"
    UNLINKED = "unlinked"
    NO_TRACE = "no_trace"


@dataclass
class SourceLineGroup:
    kind: SourceLineKind
    call_site: Optional[Dict[str, object]]
    device_time: float = 0.0
    row_count: int = 0
    device_time_by_op_code: Dict[str, float] = field(default_factory=dict)
    # Insertion-ordered, so the ids keep the order the rows first name them.
    operation_ids: Dict[int, None] = field(default_factory=dict)
    unlinked_by_reason: Dict[str, int] = field(default_factory=dict)

    @property
    def sort_key(self) -> Tuple[float, str, str, str]:
        """`getSourceLineGroupKey`'s order behind the device time: kind, path, line."""
        site = self.call_site or {}
        return (
            -self.device_time,
            self.kind.value,
            str(site.get("file", "")),
            str(site.get("line", "")),
        )

    def top_op_codes(self) -> List[Tuple[str, float]]:
        """`getTopOpCodes`: the op codes with the most device time, ties by name."""
        return sorted(
            self.device_time_by_op_code.items(), key=lambda item: (-item[1], item[0])
        )[:TOP_OP_CODE_COUNT]


def source_line_groups(
    rows: Sequence[Dict],
    operation_by_perf_id: Mapping[str, int],
    call_site_by_operation: Mapping[int, Optional[Dict[str, object]]],
    device_time: Callable[[Dict], Optional[float]],
    unlinked_reason: Callable[[Dict], str],
) -> List[SourceLineGroup]:
    """`getSourceLineGroups` over rows signposts are already out of, largest first.

    `device_time` is the countable device time (`isCountableDeviceTime`), and
    `unlinked_reason` says why a row has no operation.
    """
    group_by_key: Dict[Tuple[str, object, object], SourceLineGroup] = {}
    for row in rows:
        operation_id = operation_by_perf_id.get(str(row.get("id")))
        site = (
            None if operation_id is None else call_site_by_operation.get(operation_id)
        )
        if operation_id is None:
            kind = SourceLineKind.UNLINKED
        elif site is None:
            kind = SourceLineKind.NO_TRACE
        else:
            kind = SourceLineKind.LINE
        key = (
            kind.value,
            None if site is None else site["file"],
            None if site is None else site["line"],
        )
        group = group_by_key.get(key)
        if group is None:
            group = group_by_key[key] = SourceLineGroup(kind, site)
        group.row_count += 1
        timed = device_time(row)
        if timed is not None:
            group.device_time += timed
            op_code = str(row.get("raw_op_code") or "")
            group.device_time_by_op_code[op_code] = (
                group.device_time_by_op_code.get(op_code, 0.0) + timed
            )
        if operation_id is not None:
            group.operation_ids.setdefault(operation_id, None)
        else:
            reason = unlinked_reason(row)
            group.unlinked_by_reason[reason] = (
                group.unlinked_by_reason.get(reason, 0) + 1
            )
    return sorted(group_by_key.values(), key=lambda group: group.sort_key)


def group_entry(
    group: SourceLineGroup,
    call_site_entry: Callable[[Optional[Dict[str, object]]], Optional[Dict]],
    share: Callable[[float], Optional[float]],
) -> Dict[str, object]:
    operation_ids = list(group.operation_ids)
    entry: Dict[str, object] = {
        "kind": group.kind.value,
        "call_site": call_site_entry(group.call_site),
        "device_time": round(group.device_time, 3),
        "device_time_share_percent": share(group.device_time),
        "row_count": group.row_count,
        "top_op_codes": [
            {**cut_op_code("op_code", op_code), "device_time": round(time, 3)}
            for op_code, time in group.top_op_codes()
        ],
        "operation_ids": operation_ids[:MAX_LISTED_OPERATION_IDS],
        "operation_count": len(operation_ids),
    }
    if group.kind is SourceLineKind.UNLINKED:
        entry["unlinked_by_reason"] = dict(sorted(group.unlinked_by_reason.items()))
    return entry


__all__ = [
    "MAX_LISTED_OPERATION_IDS",
    "SOURCE_LINES_NOTE",
    "TOP_OP_CODE_COUNT",
    "SourceLineGroup",
    "SourceLineKind",
    "group_entry",
    "source_line_groups",
]
