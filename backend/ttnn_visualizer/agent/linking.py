# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""The join between a performance row and the profiler operation that launched it.

The two halves of a report number different things: `top_ops` ids are rows of the
performance CSV, and every profiler tool takes the database's `operation_id`. Nothing
in either report carries the other's id -- the captured graph records no device
operation id, and the CSV records no profiler operation -- so an agent holding the
slowest row had no way to ask where in the model it came from.

The app already answers this for the report link, by aligning the sequence of device
operations each profiler operation launched against the performance rows, in order.
This is a port of that match (`src/functions/deviceOperationMatching.ts`) rather than a
second answer to the same question: two joins that disagreed would send an agent and a
person looking at the same report to different operations. `TestMatcherParity` restates
the frontend suite's cases. A shared run id would replace both (#1800).

This module sits above `tools` and `operations` and is the only one that reads both,
which is what keeps those two from importing each other.
"""

import json
import logging
import re
import sqlite3
import tempfile
from collections import Counter
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, NamedTuple, Optional, Sequence, Tuple

from tt_perf_report.perf_report import HOST_OP_MARKER
from ttnn_visualizer.agent import operations, tools
from ttnn_visualizer.agent.bounds import MAX_LIMIT
from ttnn_visualizer.agent.handles import CacheVariant, ReportRegistry
from ttnn_visualizer.csv_queries import SIGNPOST_OP_TYPE
from ttnn_visualizer.models import Instance

logger = logging.getLogger(__name__)

# The view the match runs against: the app's pinned link view
# (`LINKED_PERFORMANCE_REPORT_FILTERS`) -- devices merged, host ops hidden, no signpost
# range. Host ops have no device operation to pair with, and alignment is positional,
# so one host op mid-report would shift every later row and fail the whole match.
#
# It is derived from `top_ops`'s canonical snapshot rather than generated again,
# because `hide_host_ops` only drops rows: tt-perf-report filters on `HOST_OP_MARKER`
# and keeps each surviving row's id, which is its CSV position. On three local
# captures, one with 65 host ops, the filtered canonical rows equal a
# `hide_host_ops=True` run on id, op code, op type, device time, cores and bound.
# `TestLinkViewEndToEnd` pins that against the real generator, and this mapping pins
# that nothing else about the canonical projection has drifted from the app's.
LINK_VIEW: Dict[str, object] = {**tools.CANONICAL_PROJECTION, "hide_host_ops": True}

# Microseconds, as tt-perf-report writes `device_time`.
DEVICE_TIME_UNIT = "us"

# The captured graph a link will read, summed across ranks. `query_device_operations`
# holds every graph at once, so this is checked in SQL before any is loaded. Across 85
# local captures the largest total is 55.6 MB, so the bound is ~18x anything seen:
# it refuses a pathological file, never a real one.
MAX_CAPTURED_GRAPH_CHARS = 1 << 30


class LinkStatus(str, Enum):
    LINKED = "linked"
    # Both halves were read and they do not describe the same run, or not in an order
    # this match can recover.
    UNLINKED = "unlinked"
    # One half is missing or unreadable, so whether they match was never asked.
    UNAVAILABLE = "unavailable"


class NodeOrder(str, Enum):
    """Which captured order a device operation sequence was read in."""

    FUNCTION_START = "function_start"
    FUNCTION_END = "function_end"


class MatchedOn(str, Enum):
    FUNCTION_START = "function_start"
    FUNCTION_END = "function_end"
    FUNCTION_START_COLLAPSED = "function_start_collapsed"
    FUNCTION_END_COLLAPSED = "function_end_collapsed"


class DeviceOperation(NamedTuple):
    """One device operation a profiler operation launched, in launch order."""

    operation_id: int
    name: str


@dataclass(frozen=True)
class OperationLink:
    status: LinkStatus
    rank: Optional[int] = None
    reason: Optional[str] = None
    # Which captured order matched, for a reader asking why two reports linked.
    matched_on: Optional[MatchedOn] = None
    operation_by_perf_id: Dict[str, int] = field(default_factory=dict)
    perf_rows_by_operation: Dict[int, List[Dict]] = field(default_factory=dict)

    def as_response(self) -> Dict[str, object]:
        response: Dict[str, object] = {"status": self.status.value}
        if self.status is LinkStatus.LINKED:
            response["rank"] = self.rank
            response["matched_on"] = self.matched_on.value if self.matched_on else None
            response["matched_rows"] = len(self.operation_by_perf_id)
        if self.reason:
            response["reason"] = self.reason
        return response


def is_device_operation(name: str) -> bool:
    """`isDeviceOperation` in `src/functions/filterOperations.ts`, kept identical."""
    return (
        name != ""
        and "(torch)" not in name
        and "::" not in name
        and "ttnn." not in name
    )


def _align(
    device_operations: Sequence[DeviceOperation], rows: Sequence[Dict]
) -> List[Dict]:
    """Pair each device operation with the row at its index, or nothing at all.

    Trailing rows are tolerated, as the frontend tolerates them. A partial match is
    never returned: a prefix that happened to agree is not evidence the rest does.
    """
    if not device_operations or len(device_operations) > len(rows):
        return []
    if any(
        rows[index].get("raw_op_code") != operation.name
        for index, operation in enumerate(device_operations)
    ):
        return []
    return list(rows[: len(device_operations)])


def collapse_multidevice_operations(
    device_operations: Sequence[DeviceOperation], num_devices: int
) -> List[DeviceOperation]:
    """Keep one of each device operation recorded exactly once per device.

    Some multi-device captures record each device operation once per device and
    others once, and nothing in the report says which (#1810). So this is the
    fallback for the duplicated shape, tried only once the raw list has failed.
    """
    if num_devices <= 1:
        return list(device_operations)
    counts = Counter(device_operations)
    collapsed: List[DeviceOperation] = []
    seen = set()
    for operation in device_operations:
        if operation not in seen and counts[operation] == num_devices:
            collapsed.append(operation)
            seen.add(operation)
    return collapsed


class Match(NamedTuple):
    device_operations: List[DeviceOperation]
    rows: List[Dict]
    matched_on: MatchedOn


def _attempt(
    candidates: Sequence[DeviceOperation],
    rows: Sequence[Dict],
    matched_on: MatchedOn,
    num_devices: Optional[int] = None,
) -> Optional[Match]:
    """One alignment, collapsed first when `num_devices` is given."""
    if num_devices is None:
        operations_to_align = list(candidates)
    else:
        if num_devices <= 1:
            return None
        operations_to_align = collapse_multidevice_operations(candidates, num_devices)
        # A smaller subset can prefix-match and falsely mark a report linked, so the
        # collapse must account for every operation exactly once per device.
        if len(operations_to_align) * num_devices != len(candidates):
            return None
    aligned = _align(operations_to_align, rows)
    return Match(operations_to_align, aligned, matched_on) if aligned else None


# TODO(#1936): join on `operation_executions.global_call_count` where a capture
# carries it, and keep this positional match as the fallback for older captures.
def match_device_operations(
    function_start: Sequence[DeviceOperation],
    function_end: Sequence[DeviceOperation],
    rows: Sequence[Dict],
    num_devices: int,
) -> Optional[Match]:
    """`matchDeviceOperationOrdersToPerf`, tried in the same order.

    Start order first, because most captures are parent-first. End order is the
    fallback for nested operations whose child is enqueued before its parent (#1860),
    and only when both orders hold the same operations: an interrupted capture can
    drop function-end events, and alignment tolerating trailing rows would let the
    shorter list match. The raw orders are tried before either collapse, so a
    spurious collapsed prefix cannot pre-empt a complete end-order match.
    """
    alignable = [row for row in rows if row.get("op_type") != SIGNPOST_OP_TYPE]

    first = _attempt(function_start, alignable, MatchedOn.FUNCTION_START)
    if first:
        return first
    if Counter(function_start) != Counter(function_end):
        return None
    return (
        _attempt(function_end, alignable, MatchedOn.FUNCTION_END)
        or _attempt(
            function_start, alignable, MatchedOn.FUNCTION_START_COLLAPSED, num_devices
        )
        or _attempt(
            function_end, alignable, MatchedOn.FUNCTION_END_COLLAPSED, num_devices
        )
    )


class UnreadableGraphError(ValueError):
    """A captured graph that is not a JSON list of nodes."""


class GraphTooLargeError(ValueError):
    """More captured graph than the link will hold in memory to read."""


def _redacted(error: Exception) -> str:
    """An error's text with the system temp directory masked.

    tt-perf-report works through temp files and names them when it fails. A reason is
    returned to whoever called the tool, and where its temp files live is not part of
    the answer; the full text goes to the log.

    Masked only as a whole path component: on Linux the directory is `/tmp`, and a
    plain replace also ate the start of the `tmpXXXX` names `tempfile` gives its files.
    """
    directory = re.escape(tempfile.gettempdir())
    return re.sub(rf"(?<![\w.-]){directory}(?![\w.-])", "<tmp>", str(error))


def _device_operation_names(raw: Optional[str]) -> Dict[NodeOrder, List[str]]:
    """One operation's device operation names, in each captured order."""
    names: Dict[NodeOrder, List[str]] = {order: [] for order in NodeOrder}
    if not raw:
        return names
    try:
        nodes = json.loads(raw)
    except ValueError as error:
        raise UnreadableGraphError(str(error)) from None
    if not isinstance(nodes, list):
        raise UnreadableGraphError("not a list of nodes")
    for node in nodes:
        if not isinstance(node, dict):
            continue
        try:
            order = NodeOrder(node.get("node_type"))
        except ValueError:
            continue
        # A lifecycle node without a name is refused, not skipped: dropping it
        # shortens the order, and a prefix match can still mark the link linked
        # with later rows on the wrong operation. The app cannot read it either --
        # `getDeviceOperationNameList` reads `params.name` unguarded.
        params = node.get("params")
        name = params.get("name") if isinstance(params, dict) else None
        if not isinstance(name, str):
            raise UnreadableGraphError(f"a {order.value} node carries no name")
        if is_device_operation(name):
            names[order].append(name)
    return names


def device_operation_orders(
    names_by_operation: Dict[int, Dict[NodeOrder, List[str]]],
) -> Dict[NodeOrder, List[DeviceOperation]]:
    """Both launch orders, with operations walked by id.

    By id because that is the order the app matches in: `GET /operations` sorts on
    `operation_id` (`views.py`) before the frontend builds either list, and table order
    can differ from it. Within an operation, nodes keep their captured order.
    """
    orders: Dict[NodeOrder, List[DeviceOperation]] = {order: [] for order in NodeOrder}
    for operation_id in sorted(names_by_operation):
        for order, names in names_by_operation[operation_id].items():
            orders[order].extend(DeviceOperation(operation_id, name) for name in names)
    return orders


def is_host_op_row(row: Dict) -> bool:
    """`perf_report.is_host_op`, applied to a row this package has already parsed."""
    return HOST_OP_MARKER in str(row.get("op_code") or "")


def _link_view_rows(registry: ReportRegistry, handle: str) -> List[Dict]:
    report = tools.canonical_report(registry, handle)
    return [row for row in report.get("report", []) if not is_host_op_row(row)]


def _read_profiler_side(
    instance: Instance,
) -> Tuple[Optional[int], Dict[int, Dict[NodeOrder, List[str]]], int, bool]:
    """Rank, device operation names per operation, device count, captured-graph flag.

    Graphs are parsed as they are read and only the names kept: a captured graph is
    the largest column in the report, and the match needs none of the rest.
    """
    with operations.profiler_db(instance) as queries:
        # Rank 0, which is what the app links against. The CSV carries no rank, so
        # which host's operations it pairs with is the app's convention rather than
        # something the report states -- hence `rank` in the response.
        scope = operations.rank_scope(queries, None)
        # Both tables are filtered to that rank below, and the filter no-ops on one
        # without the column: graphs from every rank would then collide on id, and
        # the device count would sum the ranks.
        operations.refuse_unattributable(queries, scope, "captured_graph", "devices")
        graph_size = queries.query_captured_graph_size()
        if graph_size > MAX_CAPTURED_GRAPH_CHARS:
            raise GraphTooLargeError(
                f"this capture holds {graph_size:,} characters of captured graph, "
                f"past the {MAX_CAPTURED_GRAPH_CHARS:,} the link will read"
            )
        operation_ids = {
            operation.operation_id
            for operation in queries.query_operations(
                filters=operations.scoped(queries, "operations", scope)
            )
        }
        names_by_operation: Dict[int, Dict[NodeOrder, List[str]]] = {}
        has_graph = False
        for device_operation in queries.query_device_operations(
            filters=operations.scoped(queries, "captured_graph", scope)
        ):
            has_graph = True
            if device_operation.operation_id not in operation_ids:
                continue
            try:
                names_by_operation[device_operation.operation_id] = (
                    _device_operation_names(device_operation.captured_graph)
                )
            except UnreadableGraphError as error:
                raise UnreadableGraphError(
                    f"the captured graph for operation "
                    f"{device_operation.operation_id} cannot be read ({error})"
                ) from None
        num_devices = sum(
            1
            for _ in queries.query_devices(
                filters=operations.scoped(queries, "devices", scope)
            )
        )
    return scope.rank, names_by_operation, num_devices, has_graph


def _build_link(
    registry: ReportRegistry, handle: str, instance: Instance
) -> OperationLink:
    if not instance.performance_path:
        return OperationLink(
            LinkStatus.UNAVAILABLE,
            reason="this handle was loaded without a performance_path",
        )
    if not instance.profiler_path:
        return OperationLink(
            LinkStatus.UNAVAILABLE,
            reason="this handle was loaded without a profiler_path",
        )

    try:
        rank, names_by_operation, num_devices, has_graph = _read_profiler_side(instance)
    except operations.ProfilerDatabaseMissingError as error:
        return OperationLink(LinkStatus.UNAVAILABLE, reason=str(error))
    # A profiler database `top_ops` never needed must not cost it its answer. Cached
    # like any other outcome, so a broken file is reported once rather than re-read
    # on every call.
    except sqlite3.Error as error:
        logger.warning("profiler database unreadable for the link: %s", error)
        return OperationLink(
            LinkStatus.UNAVAILABLE,
            reason=f"the profiler database could not be read: {_redacted(error)}",
        )
    except (GraphTooLargeError, operations.UnattributableRankError) as error:
        logger.warning("%s", error)
        return OperationLink(LinkStatus.UNAVAILABLE, reason=str(error))
    except UnreadableGraphError as error:
        # Refused rather than skipped: dropping one operation's device ops shifts
        # every later one, and repeated names after it can still align -- a
        # misattribution that reads as a link. The app does not link this capture
        # either; the graph breaks `GET /operations`.
        logger.warning("%s", error)
        return OperationLink(LinkStatus.UNAVAILABLE, reason=str(error))

    if not has_graph:
        return OperationLink(
            LinkStatus.UNAVAILABLE,
            rank=rank,
            reason=(
                "this capture records no captured graph, so it holds no device "
                "operations to align against the performance rows"
            ),
        )

    try:
        rows = _link_view_rows(registry, handle)
    # Broad on purpose: tt-perf-report raises whatever its parse hits, and a CSV it
    # cannot read must cost `operation_detail` its perf rows, not the whole answer
    # about a profiler operation that was read fine.
    except Exception as error:
        logger.warning("performance report unreadable for the link: %s", error)
        return OperationLink(
            LinkStatus.UNAVAILABLE,
            rank=rank,
            reason=f"the performance report could not be read: {_redacted(error)}",
        )

    orders = device_operation_orders(names_by_operation)
    match = match_device_operations(
        orders[NodeOrder.FUNCTION_START],
        orders[NodeOrder.FUNCTION_END],
        rows,
        num_devices,
    )
    if match is None:
        return OperationLink(
            LinkStatus.UNLINKED,
            rank=rank,
            reason=(
                "the device operations this profiler report launched do not line up, "
                "in order, with the performance rows -- usually two different runs, or "
                "a performance capture that stopped early. No id is guessed; use "
                "find_operations with the op name instead."
            ),
        )

    operation_by_perf_id: Dict[str, int] = {}
    perf_rows_by_operation: Dict[int, List[Dict]] = {}
    for operation, row in zip(match.device_operations, match.rows):
        operation_by_perf_id[str(row.get("id"))] = operation.operation_id
        perf_rows_by_operation.setdefault(operation.operation_id, []).append(row)
    return OperationLink(
        LinkStatus.LINKED,
        rank=rank,
        matched_on=match.matched_on,
        operation_by_perf_id=operation_by_perf_id,
        perf_rows_by_operation=perf_rows_by_operation,
    )


def operation_link(registry: ReportRegistry, handle: str) -> OperationLink:
    """The link for one handle, resolved once: it reads every captured graph."""
    return registry.cached_report(
        handle,
        lambda instance: _build_link(registry, handle, instance),
        variant=CacheVariant.OPERATION_LINK,
    )


# The one full statement of what `operation_id` means; the tool description points
# here rather than restating it, so the two cannot drift.
TOP_OPS_LINK_NOTE = (
    "operation_id is the profiler database id for this row, to pass to "
    "operation_provenance or operation_detail, and it belongs to the rank named in "
    "operation_link. It is null on every row when the two reports did not link. On a "
    "linked pair it is null for a row with no profiler operation: a host op, a "
    "signpost, or a row past the end of a profiler capture that stopped before the "
    "performance one did -- matched_rows says how many rows linked."
)


def top_ops(
    registry: ReportRegistry,
    handle: str,
    by: str = "device_time",
    limit: Optional[int] = None,
) -> Dict[str, object]:
    """`tools.top_ops`, with each row's profiler operation id where one is known."""
    result = tools.top_ops(registry, handle, by=by, limit=limit)
    link = operation_link(registry, handle)
    ops = result.get("ops")
    for row in ops if isinstance(ops, list) else []:
        row["operation_id"] = link.operation_by_perf_id.get(str(row.get("id")))
    result["operation_link"] = {**link.as_response(), "note": TOP_OPS_LINK_NOTE}
    return result


def operation_detail(
    registry: ReportRegistry,
    handle: str,
    operation_id: int,
    rank: Optional[int] = None,
) -> Dict[str, object]:
    """`operations.operation_detail`, with the performance rows it launched."""
    result = operations.operation_detail(
        registry, handle, operation_id=operation_id, rank=rank
    )
    link = operation_link(registry, handle)
    if link.status is LinkStatus.LINKED and result.get("rank") != link.rank:
        # The link pairs the CSV with one rank's operations, and ids restart per rank,
        # so another rank's operation N is not the one these rows belong to.
        result["operation_link"] = OperationLink(
            LinkStatus.UNAVAILABLE,
            rank=link.rank,
            reason=(
                f"performance rows are linked to rank {link.rank} only; "
                f"this operation was read at rank {result.get('rank')}"
            ),
        ).as_response()
        return result
    if link.status is LinkStatus.LINKED:
        rows = link.perf_rows_by_operation.get(int(operation_id), [])
        result["perf_rows"] = [tools.project_row(row) for row in rows[:MAX_LIMIT]]
        result["perf_row_count"] = len(rows)
        # Stated because this response's other duration is host seconds, and the two
        # invite being compared.
        result["device_time_unit"] = DEVICE_TIME_UNIT
    result["operation_link"] = link.as_response()
    return result


__all__ = [
    "DEVICE_TIME_UNIT",
    "MAX_CAPTURED_GRAPH_CHARS",
    "LINK_VIEW",
    "TOP_OPS_LINK_NOTE",
    "DeviceOperation",
    "LinkStatus",
    "MatchedOn",
    "NodeOrder",
    "OperationLink",
    "collapse_multidevice_operations",
    "device_operation_orders",
    "is_device_operation",
    "is_host_op_row",
    "match_device_operations",
    "operation_detail",
    "operation_link",
    "top_ops",
]
