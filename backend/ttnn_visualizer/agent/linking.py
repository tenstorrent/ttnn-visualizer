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
person looking at the same report to different operations. `TestMatcherParity` pins
the cases the frontend's own suite pins. A shared run id would replace both (#1800).

This module sits above `tools` and `operations` and is the only one that reads both,
which is what keeps those two from importing each other.
"""

import json
import logging
from collections import Counter
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, NamedTuple, Optional, Sequence

from ttnn_visualizer.agent import operations, tools
from ttnn_visualizer.agent.bounds import MAX_LIMIT
from ttnn_visualizer.agent.handles import ReportRegistry
from ttnn_visualizer.models import Instance

logger = logging.getLogger(__name__)

# The performance view the match runs against, which is the app's pinned link view
# (`LINKED_PERFORMANCE_REPORT_FILTERS`) rather than `top_ops`'s canonical one. Host ops
# have no device operation to pair with, and alignment is positional, so one host op
# mid-report would shift every later row and fail the whole match. The ids survive the
# filter -- tt-perf-report numbers rows by their CSV position -- so a linked id is the
# same id `top_ops` returns.
LINK_PROJECTION_OVERRIDES: Dict[str, object] = {"hide_host_ops": True}

_LINK_VARIANT = "operation_link"
_LINKED_REPORT_VARIANT = "linked_report"

SIGNPOST_OP_TYPE = "signpost"


class LinkStatus(str, Enum):
    LINKED = "linked"
    # Both halves were read and they do not describe the same run, or not in an order
    # this match can recover.
    UNLINKED = "unlinked"
    # One half is missing, so whether they match was never asked.
    UNAVAILABLE = "unavailable"


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
    matched_on: Optional[str] = None
    operation_by_perf_id: Dict[str, int] = field(default_factory=dict)
    perf_rows_by_operation: Dict[int, List[Dict]] = field(default_factory=dict)

    def as_response(self) -> Dict[str, object]:
        response: Dict[str, object] = {"status": self.status.value}
        if self.status is LinkStatus.LINKED:
            response["rank"] = self.rank
            response["matched_on"] = self.matched_on
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


def _align_collapsed(
    device_operations: Sequence[DeviceOperation],
    rows: Sequence[Dict],
    num_devices: int,
) -> List[Dict]:
    if num_devices <= 1:
        return []
    collapsed = collapse_multidevice_operations(device_operations, num_devices)
    # A smaller subset can prefix-match and falsely mark a report linked, so the
    # collapse must account for every operation exactly once per device.
    if len(collapsed) * num_devices != len(device_operations):
        return []
    return _align(collapsed, rows)


class Match(NamedTuple):
    device_operations: List[DeviceOperation]
    rows: List[Dict]
    matched_on: str


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

    def attempt(
        candidates: Sequence[DeviceOperation], collapsed: bool, label: str
    ) -> Optional[Match]:
        if collapsed:
            matched = _align_collapsed(candidates, alignable, num_devices)
            operations_matched = collapse_multidevice_operations(
                candidates, num_devices
            )
        else:
            matched = _align(candidates, alignable)
            operations_matched = list(candidates)
        if not matched:
            return None
        return Match(operations_matched, matched, label)

    first = attempt(function_start, False, "function_start")
    if first:
        return first
    if Counter(function_start) != Counter(function_end):
        return None
    return (
        attempt(function_end, False, "function_end")
        or attempt(function_start, True, "function_start_collapsed")
        or attempt(function_end, True, "function_end_collapsed")
    )


def _device_operation_orders(
    captured_graphs: Dict[int, str], operation_ids: Sequence[int]
) -> Dict[str, List[DeviceOperation]]:
    """Both launch orders, walked in the order the operations list holds them.

    The frontend walks `GET /operations`, which is `operations` in table order, and
    each operation's captured graph in node order. Ids are not re-sorted here for the
    same reason: re-sorting would be a different match.
    """
    orders: Dict[str, List[DeviceOperation]] = {
        "function_start": [],
        "function_end": [],
    }
    for operation_id in operation_ids:
        raw = captured_graphs.get(operation_id)
        if not raw:
            continue
        try:
            nodes = json.loads(raw)
        except ValueError:
            # One unreadable graph drops that operation's device ops, which fails the
            # positional match outright rather than shifting it silently.
            logger.warning("captured graph for operation %s is not JSON", operation_id)
            continue
        for node in nodes if isinstance(nodes, list) else []:
            if not isinstance(node, dict):
                continue
            node_type = node.get("node_type")
            if node_type not in orders:
                continue
            params = node.get("params")
            name = params.get("name") if isinstance(params, dict) else None
            if isinstance(name, str) and is_device_operation(name):
                orders[node_type].append(DeviceOperation(operation_id, name))
    return orders


def _linked_rows(registry: ReportRegistry, handle: str) -> List[Dict]:
    report = registry.cached_report(
        handle,
        lambda instance: tools._generate_canonical_report(
            instance, **LINK_PROJECTION_OVERRIDES
        ),
        variant=_LINKED_REPORT_VARIANT,
    )
    return list(report.get("report", []))


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
        with operations._profiler_db(instance) as queries:
            # Rank 0, which is what the app links against. The CSV carries no rank,
            # so which host's operations it pairs with is the app's convention
            # rather than something the report states -- hence `rank` in the
            # response.
            scope = operations._rank_scope(queries, None)
            operation_ids = [
                operation.operation_id
                for operation in queries.query_operations(
                    filters=operations._scoped(queries, "operations", scope)
                )
            ]
            captured_graphs = {
                device_operation.operation_id: device_operation.captured_graph
                for device_operation in queries.query_device_operations(
                    filters=operations._scoped(queries, "captured_graph", scope)
                )
            }
            num_devices = len(
                list(
                    queries.query_devices(
                        filters=operations._scoped(queries, "devices", scope)
                    )
                )
            )
    except operations.ProfilerDatabaseMissingError as error:
        return OperationLink(LinkStatus.UNAVAILABLE, reason=str(error))

    if not captured_graphs:
        return OperationLink(
            LinkStatus.UNAVAILABLE,
            rank=scope.rank,
            reason=(
                "this capture records no captured graph, so it holds no device "
                "operations to align against the performance rows"
            ),
        )

    try:
        rows = _linked_rows(registry, handle)
    # Broad on purpose: tt-perf-report raises whatever its parse hits, and a CSV it
    # cannot read must cost `operation_detail` its perf rows, not the whole answer
    # about a profiler operation that was read fine.
    except Exception as error:
        logger.warning("linked performance view failed: %s", error)
        return OperationLink(
            LinkStatus.UNAVAILABLE,
            rank=scope.rank,
            reason=f"the performance report could not be read: {error}",
        )

    orders = _device_operation_orders(captured_graphs, operation_ids)
    match = match_device_operations(
        orders["function_start"], orders["function_end"], rows, num_devices
    )
    if match is None:
        return OperationLink(
            LinkStatus.UNLINKED,
            rank=scope.rank,
            reason=(
                "the device operations this profiler report launched do not line up, "
                "in order, with the performance rows -- usually two different runs, or "
                "a capture that stopped early. No id is guessed; use find_operations "
                "with the op name instead."
            ),
        )

    operation_by_perf_id: Dict[str, int] = {}
    perf_rows_by_operation: Dict[int, List[Dict]] = {}
    for operation, row in zip(match.device_operations, match.rows):
        perf_id = str(row.get("id"))
        operation_by_perf_id[perf_id] = operation.operation_id
        perf_rows_by_operation.setdefault(operation.operation_id, []).append(row)
    return OperationLink(
        LinkStatus.LINKED,
        rank=scope.rank,
        matched_on=match.matched_on,
        operation_by_perf_id=operation_by_perf_id,
        perf_rows_by_operation=perf_rows_by_operation,
    )


def operation_link(registry: ReportRegistry, handle: str) -> OperationLink:
    """The link for one handle, resolved once: it reads every captured graph."""
    return registry.cached_report(
        handle,
        lambda instance: _build_link(registry, handle, instance),
        variant=_LINK_VARIANT,
    )


_TOP_OPS_LINK_NOTE = (
    "operation_id is the profiler database id for this row, to pass to "
    "operation_provenance, operation_detail or memory_profile at the rank named in "
    "operation_link. It is null for a row with no profiler operation -- a host op or "
    "signpost -- and on every row when the two reports did not link."
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
    result["operation_link"] = {**link.as_response(), "note": _TOP_OPS_LINK_NOTE}
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
    response = link.as_response()
    if link.status is LinkStatus.LINKED and result.get("rank") != link.rank:
        # The link pairs the CSV with one rank's operations, and ids restart per rank,
        # so another rank's operation N is not the one these rows belong to.
        response = {
            "status": LinkStatus.UNAVAILABLE.value,
            "reason": (
                f"performance rows are linked to rank {link.rank} only; "
                f"this operation was read at rank {result.get('rank')}"
            ),
        }
    elif link.status is LinkStatus.LINKED:
        rows = link.perf_rows_by_operation.get(int(operation_id), [])
        result["perf_rows"] = [
            {
                "id": row.get("id"),
                "op_code": row.get("op_code") or row.get("raw_op_code"),
                "device_time": tools._rounded(tools._as_number(row.get("device_time"))),
                "cores": tools._as_number(row.get("cores")),
                "bound": row.get("bound") or None,
            }
            for row in rows[:MAX_LIMIT]
        ]
        result["perf_row_count"] = len(rows)
        # Microseconds, as `top_ops` reports them. Stated because this response's
        # other duration is host seconds, and the two invite being compared.
        result["device_time_unit"] = "us"
    result["operation_link"] = response
    return result


__all__ = [
    "LINK_PROJECTION_OVERRIDES",
    "DeviceOperation",
    "LinkStatus",
    "OperationLink",
    "collapse_multidevice_operations",
    "is_device_operation",
    "match_device_operations",
    "operation_detail",
    "operation_link",
    "top_ops",
]
