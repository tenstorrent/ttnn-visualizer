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
the frontend suite's cases, which catches drift in this port only: a change to the app's
matcher fails nothing here, so it must be mirrored by hand -- the TypeScript side points
back to this module for that reason. A shared run id would replace both (#1800).

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
from typing import Dict, List, NamedTuple, Optional, Sequence, Set, Tuple

from tt_perf_report.perf_report import HOST_OP_MARKER
from ttnn_visualizer.agent import operations, tools
from ttnn_visualizer.agent.bounds import MAX_LIMIT
from ttnn_visualizer.agent.handles import CacheVariant, ReportRegistry
from ttnn_visualizer.csv_queries import SIGNPOST_OP_TYPE
from ttnn_visualizer.models import Instance

logger = logging.getLogger(__name__)

# Microseconds, as tt-perf-report writes `device_time`.
DEVICE_TIME_UNIT = "us"

# The captured graph a link will read, at the one rank it links: the size query takes
# the read's own rank filter. `query_device_operations` holds every graph at once, so
# this is checked in SQL before any is loaded. Across 85 local captures the largest
# total is 55.6 MB, so the bound is ~18x anything seen: it refuses a pathological
# file, never a real one.
MAX_CAPTURED_GRAPH_CHARS = 1 << 30

# How tt-metal marks a `function_end` that closed a scope whose launch threw. Graph
# params are strings; only `program_cache_hit` is converted when serialised. A boolean
# is accepted too, in case a later serialiser converts it -- the app reads it the same.
_ABORTED_PARAM_VALUE = "true"


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


class UnlinkedReason(str, Enum):
    """Why a row on a linked pair has no profiler operation. Exhaustive: host ops
    and signposts are kept out of the alignment, and every other row either
    aligned or came after the last one that did."""

    SIGNPOST = "signpost"
    HOST_OP = "host_op"
    PAST_PROFILER_CAPTURE = "past_profiler_capture"


class DeviceOperation(NamedTuple):
    """One device operation a profiler operation launched, in launch order."""

    operation_id: int
    name: str


class UnlinkedRows(NamedTuple):
    """The rows a linked pair left without an operation, counted by why.

    Counted rather than listed so the answer stays one size whatever the capture: a
    report with hundreds of host ops would otherwise outweigh the rows `top_ops` was
    asked for. The first row past the profiler capture is named because it is the
    one place the two reports stopped agreeing; host ops and signposts are expected.
    """

    by_reason: Dict[str, int]
    first_past_profiler_capture_id: Optional[str]

    @property
    def total(self) -> int:
        return sum(self.by_reason.values())


@dataclass(frozen=True)
class OperationLink:
    status: LinkStatus
    rank: Optional[int] = None
    reason: Optional[str] = None
    # Which captured order matched, for a reader asking why two reports linked.
    matched_on: Optional[MatchedOn] = None
    operation_by_perf_id: Dict[str, int] = field(default_factory=dict)
    perf_rows_by_operation: Dict[int, List[Dict]] = field(default_factory=dict)
    # The rows of a linked pair without an operation. Only `top_ops` returns them:
    # the rows have no operation, so they belong to no one operation's detail.
    unlinked: Optional[UnlinkedRows] = None

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
    and only when both orders hold the same operations, since alignment tolerating
    trailing rows would let a shorter list match. `_device_operation_names` already
    drops a start its capture never closed from both orders, so names read from a
    graph always pass; the check guards orders assembled any other way. The raw orders are tried before either collapse, so a
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
    """One operation's device operation names, in each captured order.

    Only device operations that completed are named: one whose launch threw never
    reached the device, so it has no perf row, and left in it would take the next
    same-named row and shift every later row onto the wrong operation. Newer captures
    close a failed scope with a `function_end` marked `aborted`; older ones leave the
    `function_start` unclosed. Each end closes the latest open start of its name.
    Mirrors `getLinkableDeviceOperations` in
    `src/functions/linkableDeviceOperations.ts`.
    """
    names: Dict[NodeOrder, List[str]] = {order: [] for order in NodeOrder}
    if not raw:
        return names
    try:
        nodes = json.loads(raw)
    except ValueError as error:
        raise UnreadableGraphError(str(error)) from None
    if not isinstance(nodes, list):
        raise UnreadableGraphError("not a list of nodes")

    lifecycle: List[Tuple[NodeOrder, str, Dict]] = []
    for node in nodes:
        if not isinstance(node, dict):
            continue
        try:
            order = NodeOrder(node.get("node_type"))
        except ValueError:
            continue
        # A lifecycle node without a name is refused, not skipped: dropping it
        # shortens the order, and a prefix match can still mark the link linked
        # with later rows on the wrong operation. The app differs here. A nameless
        # `function_start` breaks it outright, since `getDeviceOperationNameList`
        # (`src/hooks/useAPI.tsx`) reads `params.name` unguarded. A nameless
        # `function_end` closes nothing there, so its start is quietly left out
        # rather than refused. tt-metal copies the start's name onto the end, so no
        # real capture takes either path.
        params = node.get("params")
        name = params.get("name") if isinstance(params, dict) else None
        if not isinstance(name, str) or not isinstance(params, dict):
            raise UnreadableGraphError(f"a {order.value} node carries no name")
        lifecycle.append((order, name, params))

    open_starts: List[Tuple[str, int]] = []
    completed: Set[int] = set()
    for index, (order, name, params) in enumerate(lifecycle):
        if order is NodeOrder.FUNCTION_START:
            open_starts.append((name, index))
            continue
        for position in range(len(open_starts) - 1, -1, -1):
            if open_starts[position][0] == name:
                aborted = params.get("aborted")
                if aborted is not True and aborted != _ABORTED_PARAM_VALUE:
                    completed.update((open_starts[position][1], index))
                del open_starts[position]
                break

    for index, (order, name, _) in enumerate(lifecycle):
        if index in completed and is_device_operation(name):
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


def _canonical_rows(registry: ReportRegistry, handle: str) -> List[Dict]:
    return list(tools.canonical_report(registry, handle).get("report", []))


def _unlinked_reason(row: Dict) -> UnlinkedReason:
    if row.get("op_type") == SIGNPOST_OP_TYPE:
        return UnlinkedReason.SIGNPOST
    if is_host_op_row(row):
        return UnlinkedReason.HOST_OP
    return UnlinkedReason.PAST_PROFILER_CAPTURE


def unlinked_rows(
    rows: Sequence[Dict], operation_by_perf_id: Dict[str, int]
) -> UnlinkedRows:
    """The rows a linked pair left without an operation, and why."""
    by_reason = {reason.value: 0 for reason in UnlinkedReason}
    first_past_capture: Optional[str] = None
    for row in rows:
        perf_id = str(row.get("id"))
        if perf_id in operation_by_perf_id:
            continue
        reason = _unlinked_reason(row)
        by_reason[reason.value] += 1
        if (
            reason is UnlinkedReason.PAST_PROFILER_CAPTURE
            and first_past_capture is None
        ):
            first_past_capture = perf_id
    return UnlinkedRows(by_reason, first_past_capture)


def _read_profiler_side(
    instance: Instance,
) -> Tuple[Optional[int], Dict[int, Dict[NodeOrder, List[str]]], int, bool]:
    """Rank, device operation names per operation, device count, captured-graph flag.

    Each graph is reduced to its device operation names, so only the names outlive
    this call: a captured graph is the largest column in the report, and the match
    needs none of the rest. The read is not streamed -- `query_device_operations`
    returns every matching graph at once -- which is what `MAX_CAPTURED_GRAPH_CHARS`
    bounds.
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
        graph_filters = operations.scoped(queries, "captured_graph", scope)
        graph_size = queries.query_captured_graph_size(filters=graph_filters)
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
        for device_operation in queries.query_device_operations(filters=graph_filters):
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
        # Distinct ids, as the app counts them: `fetchDevices` drops repeated device
        # ids (#425) before the count reaches the matcher, and a raw row count would
        # expect a different number of copies per operation from the collapse.
        num_devices = len(
            {
                device.device_id
                for device in queries.query_devices(
                    filters=operations.scoped(queries, "devices", scope)
                )
            }
        )
    return scope.rank, names_by_operation, num_devices, has_graph


class _UncachedLink(Exception):
    """A link built from a read that failed and might not fail again.

    Raised out of the cache so the next call retries, as the canonical report and the
    generation cache under it already do -- a link cached from a passing failure
    would contradict a `top_ops` that later read the same report fine.
    """

    def __init__(self, link: OperationLink):
        super().__init__(link.reason)
        self.link = link


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
    # A profiler database `top_ops` never needed must not cost it its answer. Not
    # cached: a locked database raises the same `sqlite3.Error` as a corrupt one, and
    # re-reading a corrupt one fails on its first query.
    except sqlite3.Error as error:
        logger.warning("profiler database unreadable for the link: %s", error)
        raise _UncachedLink(
            OperationLink(
                LinkStatus.UNAVAILABLE,
                reason=f"the profiler database could not be read: {_redacted(error)}",
            )
        ) from None
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
        all_rows = _canonical_rows(registry, handle)
    # Broad on purpose: tt-perf-report raises whatever its parse hits, and a CSV it
    # cannot read must cost `operation_detail` its perf rows, not the whole answer
    # about a profiler operation that was read fine. The traceback is logged because
    # this also catches bugs of our own, which nothing re-raises. Not cached, as the
    # canonical report is not: a temp-file failure in tt-perf-report can pass.
    except Exception as error:
        logger.warning(
            "performance report unreadable for the link: %s", error, exc_info=True
        )
        raise _UncachedLink(
            OperationLink(
                LinkStatus.UNAVAILABLE,
                rank=rank,
                reason=f"the performance report could not be read: {_redacted(error)}",
            )
        ) from None

    orders = device_operation_orders(names_by_operation)
    # The match runs against the app's pinned link view
    # (`LINKED_PERFORMANCE_REPORT_FILTERS`): devices merged, host ops hidden, no
    # signpost range. Host ops have no device operation to pair with, and alignment
    # is positional, so one host op mid-report would shift every later row.
    #
    # Filtered from `top_ops`'s canonical snapshot rather than generated again,
    # because `hide_host_ops` only drops rows: tt-perf-report filters on
    # `HOST_OP_MARKER` and keeps each surviving row's id, which is its CSV position.
    # `TestLinkViewEndToEnd` pins that against the real generator, and `TestLinkView`
    # pins the rest of the canonical projection to the app's link view.
    match = match_device_operations(
        orders[NodeOrder.FUNCTION_START],
        orders[NodeOrder.FUNCTION_END],
        [row for row in all_rows if not is_host_op_row(row)],
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
        unlinked=unlinked_rows(all_rows, operation_by_perf_id),
    )


def operation_link(registry: ReportRegistry, handle: str) -> OperationLink:
    """The link for one handle, resolved once: it reads every captured graph.

    A link that failed on a read which might succeed next time is returned without
    being cached, so the next call tries again.
    """
    try:
        return registry.cached_report(
            handle,
            lambda instance: _build_link(registry, handle, instance),
            variant=CacheVariant.OPERATION_LINK,
        )
    except _UncachedLink as uncached:
        return uncached.link


# The one full statement of what `operation_id` means; the tool description points
# here rather than restating it, so the two cannot drift.
TOP_OPS_LINK_NOTE = (
    "operation_id is the profiler database id for this row, to pass to "
    "operation_provenance or operation_detail, and it belongs to the rank named in "
    "operation_link. It is null on every row when the two reports did not link. On a "
    "linked pair it is null for a row with no profiler operation: a host op, a "
    "signpost, or a row past the end of a profiler capture that stopped before the "
    "performance one did -- matched_rows says how many rows linked, "
    "unlinked_by_reason counts every row that did not by why, including rows the "
    "ranking leaves out for having no value for the metric, and "
    "first_past_profiler_capture_id names the first row past the profiler capture."
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
    response = link.as_response()
    # Only a handle with a profiler report has an operation_id worth explaining.
    if registry.get(handle).profiler_path:
        response["note"] = TOP_OPS_LINK_NOTE
    if link.status is LinkStatus.LINKED and link.unlinked is not None:
        response["unlinked_row_count"] = link.unlinked.total
        response["unlinked_by_reason"] = link.unlinked.by_reason
        response["first_past_profiler_capture_id"] = (
            link.unlinked.first_past_profiler_capture_id
        )
    result["operation_link"] = response
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
    "TOP_OPS_LINK_NOTE",
    "DeviceOperation",
    "LinkStatus",
    "MatchedOn",
    "NodeOrder",
    "OperationLink",
    "UnlinkedReason",
    "UnlinkedRows",
    "collapse_multidevice_operations",
    "device_operation_orders",
    "is_device_operation",
    "is_host_op_row",
    "match_device_operations",
    "operation_detail",
    "operation_link",
    "top_ops",
    "unlinked_rows",
]
