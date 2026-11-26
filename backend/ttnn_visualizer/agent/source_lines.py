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

from collections import Counter, defaultdict
from dataclasses import dataclass, field
from enum import Enum
from typing import Callable, DefaultDict, Dict, List, Mapping, Optional, Sequence, Tuple

from ttnn_visualizer.agent.bounds import cut_op_code
from ttnn_visualizer.agent.report_diff import as_answered

CallSite = Dict[str, object]

# `TOP_OP_CODE_COUNT` in `perfSourceLines.ts`.
TOP_OP_CODE_COUNT = 3
# A line inside a loop can link thousands of operations; the count says how many.
MAX_LISTED_OPERATION_IDS = 20

PAGING = (
    "The groups are a page of the ranking: pass next_offset as offset for the next, "
    "so every call site can be reached. rest sums only the groups after the page, so "
    "the first page's shares and rest's add up to 100; a later page's fall short by "
    "the groups before it, which are in neither the page nor rest."
)

PATH_FILTER = (
    "path_contains keeps only the line groups whose full path contains it, ignoring "
    "case and the spaces around it (spaces alone filter nothing), and leaves out the unlinked and no_trace groups, which have no path. "
    "group_count, offset, next_offset and rest then count the matching groups only, "
    "while device_time_total and every share stay of every row read, so a filtered "
    "first page's shares and rest's add up to matching_device_time_share_percent "
    "rather than 100."
)

SOURCE_LINES_NOTE = (
    "Each performance row is filed under frame 0 of its linked memory report "
    "operation's stack trace, the call site operation_provenance gives, keyed by full "
    "path and line, as the performance view's stacked table groups by Source line. "
    "Device time is summed per line, as tt-perf-report's Device_Time_Sum_us sums it, "
    "so device_time_share_percent of device_time_total adds up to 100 across every "
    "group; the graph view takes an operation's slowest row instead. Every row but a "
    "signpost adds to row_count; only a positive device time adds to device_time. kind "
    "unlinked holds the rows with no linked operation, counted by why in "
    "unlinked_by_reason: host ops, which the app's stacked table hides by default, and "
    "rows past the end of the memory report capture. kind no_trace holds rows whose "
    "operation recorded no stack trace this tool can read, including a frame at line 0 "
    "or past 2**31, which the app groups as a line. An operation with several stack "
    "traces is filed under its first, where the app's operations list keeps its last. "
    "The app's table also follows its range slider, so its shares match these only "
    "over the same rows. operation_ids are the memory report database's, in the order "
    "the rows first name them. Groups with equal device time are ordered by kind, path "
    "and line as text, and top_op_codes with equal device time by op code, each by "
    "code point, where the app compares them by locale: two paths can swap when they "
    "differ in case or punctuation (_, - or a dot), and of tied op codes so differing, "
    "a different 3 can be listed. With no countable device time at all, every "
    "device_time_share_percent is null, where the app shows 0%. "
    + PAGING
    + " "
    + PATH_FILTER
)


class SourceLineKind(str, Enum):
    """`SourceLineGroupKind`."""

    LINE = "line"
    UNLINKED = "unlinked"
    NO_TRACE = "no_trace"


@dataclass
class SourceLineGroup:
    kind: SourceLineKind
    call_site: Optional[CallSite]
    device_time: float = 0.0
    row_count: int = 0
    device_time_by_op_code: DefaultDict[str, float] = field(
        default_factory=lambda: defaultdict(float)
    )
    # Insertion-ordered, so the ids keep the order the rows first name them.
    operation_ids: Dict[int, None] = field(default_factory=dict)
    unlinked_by_reason: Counter = field(default_factory=Counter)

    @property
    def sort_key(self) -> Tuple[float, str, str, str]:
        """`getSourceLineGroupKey`'s order behind the device time: kind, path, line,
        each as text. Compared by code point, where the app's `localeCompare` is
        locale-aware: the two agree on ASCII letters and digits of one case, and can
        differ on case or on punctuation such as `_`, `-` and `.`, where paths in one
        directory often first differ."""
        site = self.call_site or {}
        return (
            -self.device_time,
            self.kind.value,
            str(site.get("file", "")),
            str(site.get("line", "")),
        )

    def top_op_codes(self) -> List[Tuple[str, float]]:
        """`getTopOpCodes`: the op codes with the most device time, ties by name, by
        code point where the app compares by locale, so a tie of op codes differing
        in case or punctuation can keep a different 3."""
        return sorted(
            self.device_time_by_op_code.items(), key=lambda item: (-item[1], item[0])
        )[:TOP_OP_CODE_COUNT]


def source_line_groups(
    rows: Sequence[Dict],
    operation_by_perf_id: Mapping[str, int],
    call_site_by_operation: Mapping[int, Optional[CallSite]],
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
        if site is not None:
            kind = SourceLineKind.LINE
            key: Tuple[str, object, object] = (kind.value, site["file"], site["line"])
        else:
            kind = (
                SourceLineKind.UNLINKED
                if operation_id is None
                else SourceLineKind.NO_TRACE
            )
            key = (kind.value, None, None)
        group = group_by_key.get(key)
        if group is None:
            group = group_by_key[key] = SourceLineGroup(kind, site)
        group.row_count += 1
        timed = device_time(row)
        if timed is not None:
            group.device_time += timed
            # The app keys by `raw_op_code` as is; a row without one is filed as "".
            group.device_time_by_op_code[str(row.get("raw_op_code") or "")] += timed
        if operation_id is not None:
            group.operation_ids.setdefault(operation_id, None)
        else:
            group.unlinked_by_reason[unlinked_reason(row)] += 1
    return sorted(group_by_key.values(), key=lambda group: group.sort_key)


def group_entry(
    group: SourceLineGroup,
    call_site_entry: Callable[[Optional[CallSite]], Optional[Dict[str, object]]],
    share: Callable[[float], Optional[float]],
) -> Dict[str, object]:
    operation_ids = list(group.operation_ids)
    entry: Dict[str, object] = {
        "kind": group.kind.value,
        "call_site": call_site_entry(group.call_site),
        "device_time": as_answered(group.device_time),
        "device_time_share_percent": share(group.device_time),
        "row_count": group.row_count,
        "top_op_codes": [
            {**cut_op_code("op_code", op_code), "device_time": as_answered(time)}
            for op_code, time in group.top_op_codes()
        ],
        "operation_ids": operation_ids[:MAX_LISTED_OPERATION_IDS],
        "operation_count": len(operation_ids),
    }
    if group.kind is SourceLineKind.UNLINKED:
        entry["unlinked_by_reason"] = dict(sorted(group.unlinked_by_reason.items()))
    return entry


__all__ = [
    "CallSite",
    "MAX_LISTED_OPERATION_IDS",
    "PAGING",
    "PATH_FILTER",
    "SOURCE_LINES_NOTE",
    "TOP_OP_CODE_COUNT",
    "SourceLineGroup",
    "SourceLineKind",
    "group_entry",
    "source_line_groups",
]
