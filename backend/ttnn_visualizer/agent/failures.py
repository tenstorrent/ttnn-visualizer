# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""What went wrong in a run: recorded errors, likely DRAM fallbacks, the L1 peak. #2154

Each answer reads the profiler database the way the app's routes do, so it agrees with
what the app shows for the same report.
"""

import json
import math
from collections import defaultdict
from dataclasses import dataclass
from functools import partial
from typing import (
    Callable,
    Dict,
    Iterable,
    List,
    NamedTuple,
    Optional,
    Sequence,
    Tuple,
    TypeVar,
    Union,
)

from ttnn_visualizer.agent import allocation_failures
from ttnn_visualizer.agent import dram_fallbacks as fallback_rules
from ttnn_visualizer.agent import l1_peak as peak_replay
from ttnn_visualizer.agent.bounds import bounded, ensure_graph_readable
from ttnn_visualizer.agent.handles import CacheVariant, ReportRegistry
from ttnn_visualizer.agent.operations import (
    BUFFER_SIZE_UNIT,
    RankScope,
    UnattributableRankError,
    profiler_db,
    rank_caveat,
    rank_scope,
    refuse_unattributable,
    scoped,
)
from ttnn_visualizer.agent.scope_outcomes import failed_device_operation_names
from ttnn_visualizer.models import (
    L1_BUFFER_TYPES,
    ErrorRecord,
    InputTensor,
    Operation,
    OutputTensor,
    Tensor,
)
from ttnn_visualizer.queries import DatabaseQueries
from ttnn_visualizer.serializers import (
    error_key,
    rank_or_zero,
    select_error_for_operation,
    select_errors_by_operation,
)

# A message carries tt-metal's header and backtrace; the part a diagnosis reads is first.
MAX_ERROR_TEXT_CHARS = 1000
# The peak's largest residents; the rest are counted.
MAX_PEAK_CONTRIBUTORS = 20
# The tables behind each answer's figures, so its rank refusal covers every one.
_ERROR_TABLES = ("errors", "captured_graph")
_FALLBACK_TABLES = (
    "operation_arguments",
    "tensors",
    "input_tensors",
    "output_tensors",
    "errors",
)

ERRORS_NOTE = (
    "Rows of the report's errors table. error_type incomplete_operation means the "
    "operation started and never completed, so the run most likely crashed inside it. "
    "attached is false for an error the report could not place on an operation of that "
    "id and name; the app shows those at report level. failed_device_operations are "
    "the device operations in the operation's captured graph whose launch did not "
    "complete. allocation_failure is read out of the message when it is one of "
    "tt-metal's four allocation failures, and diagnosis says from its figures why it "
    "did not fit. requested_bytes is the whole request across num_banks; "
    "bytes_per_bank, bank_size_bytes and the allocator's figures are per bank. An "
    "unattached error's operation_id can name an unrelated operation, so do not fill "
    "app_link_template with it."
)
DRAM_FALLBACKS_NOTE = (
    "Inferred, not recorded: tt-metal writes nothing when an operation falls back to "
    "DRAM. argument_mismatch: the operation's memory config arguments all asked for "
    "L1, yet every output it allocated itself is in DRAM. retry_after_failure: an "
    "operation of the same name ran within "
    f"{fallback_rules.RETRY_WINDOW_OPERATIONS} operations of one that failed to "
    "allocate L1, with its outputs in DRAM. An output that may be a view of a DRAM "
    "input is not counted."
)
L1_PEAK_NOTE = (
    "Replays each operation's captured graph against the post-op buffers snapshot, so "
    "it counts circular buffers and tensors allocated and freed inside an operation, "
    "which memory_profile cannot. Sizes are bytes per bank. upper-bound precision "
    "means the residents were summed without knowing they share a core, since the "
    "capture does not say which cores each occupies; exact means one resident. Stale "
    "tensors are still allocated after their last real consumer, the only class "
    "freeing earlier would help; intermediates are allocated and freed inside the "
    "operation. Circular buffers stop occupying L1 when their program ends."
)


def _truncated(field: str, text: Optional[str]) -> Dict[str, object]:
    if not text:
        return {field: text}
    if len(text) <= MAX_ERROR_TEXT_CHARS:
        return {field: text}
    return {
        field: text[:MAX_ERROR_TEXT_CHARS],
        f"{field}_full_length": len(text),
    }


def _error_records(
    queries: DatabaseQueries, scope: RankScope, operation_id: Optional[int] = None
) -> List[ErrorRecord]:
    # Reports written before the errors table existed have none to show.
    if not queries.has_table("errors"):
        return []
    return list(
        queries.query_error_records(
            scoped(queries, "errors", scope, operation_id=operation_id)
        )
    )


def _operations(queries: DatabaseQueries, scope: RankScope) -> List[Operation]:
    operations = list(queries.query_operations(scoped(queries, "operations", scope)))
    operations.sort(key=lambda operation: operation.operation_id)
    return operations


def _graphs(
    queries: DatabaseQueries,
    scope: RankScope,
    operation_ids: Optional[List[int]] = None,
) -> Dict[Tuple[int, int], str]:
    """Raw captured graphs, as `serialize_operations` keys them; a later row wins."""
    filters = (
        scoped(queries, "captured_graph", scope)
        if operation_ids is None
        else scoped(queries, "captured_graph", scope, operation_id=operation_ids)
    )
    return {
        (graph.operation_id, graph.rank): graph.captured_graph
        for graph in queries.query_device_operations(filters)
    }


def _graphs_checked(
    queries: DatabaseQueries, scope: RankScope, operation_ids: List[int]
) -> Dict[Tuple[int, int], str]:
    """`_graphs` for these operations, refused past `MAX_CAPTURED_GRAPH_CHARS`."""
    filters = scoped(queries, "captured_graph", scope, operation_id=operation_ids)
    ensure_graph_readable(queries, filters, "an error lookup")
    return _graphs(queries, scope, operation_ids)


def _graph_for(
    graphs: Dict[Tuple[int, int], str], operation: Operation
) -> List[object]:
    raw = rank_or_zero(graphs, operation.operation_id, operation.rank)
    if not raw:
        return []
    try:
        nodes = json.loads(raw)
    except ValueError:
        return []
    return nodes if isinstance(nodes, list) else []


def _allocation_fields(message: Optional[str]) -> Dict[str, object]:
    failure = allocation_failures.parse_allocation_failure(message)
    if failure is None:
        return {}
    return {
        "allocation_failure": failure,
        "diagnosis": allocation_failures.diagnose(failure),
    }


def _error_entry(error: ErrorRecord, graph: List[object]) -> Dict[str, object]:
    """One error as `errors` lists it and `operation_detail` carries it."""
    return {
        "error_type": error.error_type,
        "timestamp": error.timestamp,
        **_truncated("error_message", error.error_message),
        **_truncated("stack_trace", error.stack_trace),
        "failed_device_operations": failed_device_operation_names(graph),
        **_allocation_fields(error.error_message),
    }


def errors(
    registry: ReportRegistry,
    handle: str,
    limit: Optional[int] = None,
    rank: Optional[int] = None,
) -> Dict[str, object]:
    """The report's recorded errors, each with its allocation failure diagnosed."""
    count = bounded(limit)
    instance = registry.get(handle)
    with profiler_db(instance) as queries:
        scope = rank_scope(queries, rank)
        refuse_unattributable(queries, scope, *_ERROR_TABLES)
        has_errors_table = queries.has_table("errors")
        records = _error_records(queries, scope)
        operations = (
            list(
                queries.query_operations_with_errors(
                    scoped(queries, "operations", scope)
                )
            )
            if records
            else []
        )
        attached = select_errors_by_operation(records, operations)
        operation_by_error = {
            id(attached[key]): operation
            for operation in operations
            if (key := error_key(operation)) in attached
        }
        shown = records[:count]
        shown_ids = sorted(
            {
                operation_by_error[id(error)].operation_id
                for error in shown
                if id(error) in operation_by_error
            }
        )
        graphs = _graphs_checked(queries, scope, shown_ids) if shown_ids else {}

    listed = []
    for error in shown:
        operation = operation_by_error.get(id(error))
        listed.append(
            {
                "operation_id": error.operation_id,
                "operation_name": error.operation_name,
                "attached": operation is not None,
                **_error_entry(
                    error,
                    _graph_for(graphs, operation) if operation is not None else [],
                ),
            }
        )

    response: Dict[str, object] = {
        "handle": handle,
        "error_count": len(records),
        "returned": len(listed),
        "errors": listed,
        "note": ERRORS_NOTE,
        **scope.as_response(),
    }
    caveats: List[str] = [caveat] if (caveat := rank_caveat(scope)) else []
    if not has_errors_table:
        caveats.append(
            "This report predates the errors table, so it cannot say whether the run "
            "recorded an error."
        )
    if caveats:
        response["caveat"] = " ".join(caveats)
    return response


@dataclass
class _ReportOperations:
    """Operations in id order, with what `/api/operations` attaches to each."""

    operations: List[Operation]
    arguments_by_operation_id: Dict[int, List[Tuple[str, Optional[str]]]]
    inputs_by_operation_id: Dict[int, List[Tensor]]
    outputs_by_operation_id: Dict[int, List[Tensor]]
    consumers_by_tensor_id: Dict[int, List[int]]


def _report_operations(
    queries: DatabaseQueries,
    scope: RankScope,
    with_arguments: bool = False,
    with_consumers: bool = False,
) -> _ReportOperations:
    operations = _operations(queries, scope)
    arguments_by_operation_id: Dict[int, List[Tuple[str, Optional[str]]]] = defaultdict(
        list
    )
    if with_arguments:
        for argument in queries.query_operation_arguments(
            scoped(queries, "operation_arguments", scope)
        ):
            arguments_by_operation_id[argument.operation_id].append(
                (argument.name, argument.value)
            )

    input_rows = list(
        queries.query_input_tensors(scoped(queries, "input_tensors", scope))
    )
    output_rows = list(
        queries.query_output_tensors(scoped(queries, "output_tensors", scope))
    )
    tensors = {
        (tensor.tensor_id, tensor.rank): tensor
        for tensor in queries.query_tensors(scoped(queries, "tensors", scope))
    }
    consumers_by_tensor_id: Dict[int, List[int]] = {}
    links = (
        {
            (link.tensor_id, link.rank): link
            for link in queries.query_producers_consumers(rank=scope.rank)
        }
        if with_consumers
        else {}
    )

    def attach(
        rows: Iterable[Union[InputTensor, OutputTensor]],
    ) -> Dict[int, List[Tensor]]:
        # As `serialize_inputs_outputs`: a row without its tensor is skipped.
        tensors_by_operation_id: Dict[int, List[Tensor]] = defaultdict(list)
        for row in rows:
            tensor = rank_or_zero(tensors, row.tensor_id, row.rank)
            if tensor is None:
                continue
            link = rank_or_zero(links, row.tensor_id, row.rank)
            consumers_by_tensor_id[tensor.tensor_id] = link.consumers if link else []
            tensors_by_operation_id[row.operation_id].append(tensor)
        return tensors_by_operation_id

    return _ReportOperations(
        operations,
        arguments_by_operation_id,
        inputs_by_operation_id=attach(input_rows),
        outputs_by_operation_id=attach(output_rows),
        consumers_by_tensor_id=consumers_by_tensor_id,
    )


def _failure_by_operation_id(
    queries: DatabaseQueries, scope: RankScope, operations: List[Operation]
) -> Dict[int, Dict]:
    records = _error_records(queries, scope)
    if not records:
        return {}
    attached = select_errors_by_operation(records, operations)
    failures: Dict[int, Dict] = {}
    for operation in operations:
        error = attached.get(error_key(operation))
        failure = allocation_failures.parse_allocation_failure(
            error.error_message if error else None
        )
        if failure is not None:
            failures[operation.operation_id] = failure
    return failures


class DramFallbackReport(NamedTuple):
    """Every likely fallback by operation id, and each operation's name."""

    by_operation_id: Dict[int, Dict[str, object]]
    names: Dict[int, str]


def report_dram_fallbacks(
    queries: DatabaseQueries, scope: RankScope
) -> DramFallbackReport:
    """The likely fallbacks at the rank, read from every operation there."""
    report = _report_operations(queries, scope, with_arguments=True)
    fallback_by_operation_id = fallback_rules.dram_fallbacks(
        [
            fallback_rules.FallbackOperation(
                id=operation.operation_id,
                name=operation.name,
                arguments=report.arguments_by_operation_id.get(
                    operation.operation_id, []
                ),
                inputs=report.inputs_by_operation_id.get(operation.operation_id, []),
                outputs=report.outputs_by_operation_id.get(operation.operation_id, []),
            )
            for operation in report.operations
        ],
        _failure_by_operation_id(queries, scope, report.operations),
    )
    return DramFallbackReport(
        by_operation_id=fallback_by_operation_id,
        names={
            operation.operation_id: operation.name for operation in report.operations
        },
    )


def dram_fallbacks(
    registry: ReportRegistry,
    handle: str,
    limit: Optional[int] = None,
    rank: Optional[int] = None,
) -> Dict[str, object]:
    """Likely L1-to-DRAM fallbacks, in operation order."""
    count = bounded(limit)
    instance = registry.get(handle)
    with profiler_db(instance) as queries:
        scope = rank_scope(queries, rank)
        refuse_unattributable(queries, scope, *_FALLBACK_TABLES)
        report = _cached_dram_fallbacks(registry, handle, queries, scope)

    listed = [
        {"operation_name": report.names.get(operation_id), **fallback}
        for operation_id, fallback in sorted(report.by_operation_id.items())
    ][:count]
    response: Dict[str, object] = {
        "handle": handle,
        "fallback_count": len(report.by_operation_id),
        "returned": len(listed),
        "fallbacks": listed,
        "note": DRAM_FALLBACKS_NOTE,
        **scope.as_response(),
    }
    caveats: List[str] = [caveat] if (caveat := rank_caveat(scope)) else []
    if caveats:
        response["caveat"] = " ".join(caveats)
    return response


def _whole(value: object) -> object:
    """A float byte count or address as an int when it is one, and None when not finite."""
    if isinstance(value, float):
        if not math.isfinite(value):
            return None
        if value.is_integer():
            return int(value)
    return value


def _decomposition(
    entry: peak_replay.Decomposition, contributors: bool
) -> Dict[str, object]:
    shown: Dict[str, object] = {
        "operation_id": entry.operation_id,
        "total_bytes": _whole(entry.total_bytes),
        "circular_buffer_bytes": _whole(entry.circular_buffer_bytes),
        "intermediate_tensor_bytes": _whole(entry.intermediate_tensor_bytes),
        "persistent_tensor_bytes": _whole(entry.persistent_tensor_bytes),
        "stale_tensor_bytes": _whole(entry.stale_tensor_bytes),
        "precision": entry.precision.value,
        "reconciled_away_count": entry.reconciled_away_count,
    }
    if contributors:
        shown["contributors"] = [
            {
                "address": _whole(resident.address),
                "bytes": _whole(resident.bytes),
                "kind": resident.kind.value,
                "last_used_by_operation_id": resident.last_used_by_operation_id,
            }
            for resident in entry.contributors[:MAX_PEAK_CONTRIBUTORS]
        ]
        shown["contributor_count"] = len(entry.contributors)
    return shown


def _top_operations(
    by_operation_id: Dict[int, peak_replay.Decomposition],
    names: Dict[int, str],
    count: int,
) -> List[Dict[str, object]]:
    """Largest first, one entry per distinct composition: repeated layers are identical."""
    return [
        {
            **_decomposition(entry, contributors=False),
            "operation_name": names.get(entry.operation_id),
            "also_at": also_at,
        }
        for entry, also_at in peak_replay.top_compositions(
            by_operation_id.values(), count
        )
    ]


@dataclass
class L1PeakReport:
    result: peak_replay.L1PeakResult
    lifetimes: peak_replay.AddressLifetimes
    names: Dict[int, str]
    # The device the bank count and L1 size are one of, and how many the report holds.
    device_id: int
    device_count: int
    bank_count: int


def report_l1_peak(queries: DatabaseQueries, scope: RankScope) -> L1PeakReport:
    """The replay, the address lifetimes it read, and the device it was judged against."""
    devices = list(queries.query_devices(scoped(queries, "devices", scope)))
    if not devices:
        raise ValueError(
            "this report has no devices row, so there is no bank count or L1 size to "
            "replay its captured graph against"
        )
    # As `fetchDevices`: the first id keeps its place, and a later row of it wins.
    devices = list({entry.device_id: entry for entry in devices}.values())
    device = devices[0]
    ensure_graph_readable(
        queries, scoped(queries, "captured_graph", scope), "the replay"
    )
    report = _report_operations(queries, scope, with_consumers=True)
    names = {operation.operation_id: operation.name for operation in report.operations}
    # Every row of a tensor attaches the same one, with the same consumers, so one per
    # id spares finding its last consumer again for each operation that read it.
    tensor_by_id = {
        tensor.tensor_id: tensor
        for side in (report.inputs_by_operation_id, report.outputs_by_operation_id)
        for operation in report.operations
        for tensor in side.get(operation.operation_id, [])
    }
    lifetimes = peak_replay.resolve_address_lifetimes(
        (
            (
                tensor.tensor_id,
                tensor.address,
                tensor.buffer_type,
                report.consumers_by_tensor_id.get(tensor.tensor_id, []),
            )
            for tensor in tensor_by_id.values()
        ),
        names,
    )
    snapshot: Dict[int, List] = {
        operation.operation_id: [] for operation in report.operations
    }
    for buffer_type in sorted(L1_BUFFER_TYPES, key=lambda entry: entry.value):
        for buffer in queries.query_buffers(
            scoped(queries, "buffers", scope, buffer_type=buffer_type.value)
        ):
            snapshot.setdefault(buffer.operation_id, []).append(buffer)
    graphs = _graphs(queries, scope)
    result = peak_replay.build_l1_peak(
        [
            (operation.operation_id, partial(_graph_for, graphs, operation))
            for operation in report.operations
        ],
        snapshot,
        lifetimes.last_use_by_address,
        bank_count=device.l1_num_banks,
        capacity_bytes=device.worker_l1_size,
    )
    return L1PeakReport(
        result=result,
        lifetimes=lifetimes,
        names=names,
        device_id=device.device_id,
        device_count=len(devices),
        bank_count=device.l1_num_banks,
    )


def l1_peak(
    registry: ReportRegistry,
    handle: str,
    limit: Optional[int] = None,
    rank: Optional[int] = None,
) -> Dict[str, object]:
    """The run's L1 peak per bank and what it is made of, with the top operations."""
    count = bounded(limit)
    instance = registry.get(handle)
    with profiler_db(instance) as queries:
        scope = rank_scope(queries, rank)
        refuse_unattributable(
            queries,
            scope,
            "captured_graph",
            "buffers",
            "tensors",
            "input_tensors",
            "output_tensors",
            "devices",
        )
        # Cached once only the peak keeps its residents: every operation's would pin
        # about 100 MB on the largest local capture.
        report = _cached_per_rank(
            registry, handle, CacheVariant.L1_PEAK, queries, scope, report_l1_peak
        )

    result, lifetimes = report.result, report.lifetimes
    caveats: List[str] = [caveat] if (caveat := rank_caveat(scope)) else []
    if result.peak is not None and report.device_count > 1:
        caveats.append(
            f"This report covers {report.device_count} devices. The replay cannot "
            "separate them, since captures label circular buffers and tensors with "
            "different device ids, so occupancy is summed across devices while the "
            "L1 size it is judged against is one device's."
        )
    if lifetimes.unattributable_stale_address_count:
        caveats.append(
            f"Stale is a floor: {lifetimes.unattributable_stale_address_count} "
            "addresses were used by more than one tensor, so their residents are "
            "counted as persistent."
        )
    if result.reconciled_away_count:
        caveats.append(
            f"{result.reconciled_away_count} allocations the graph left live were "
            "dropped at an operation boundary because the buffers snapshot had freed "
            "them; the graph under-reports frees."
        )

    response: Dict[str, object] = {
        "handle": handle,
        "size_unit": BUFFER_SIZE_UNIT,
        "worker_l1_size": result.capacity_bytes,
        "l1_num_banks": report.bank_count,
        "geometry_from_device": report.device_id,
        "operations_replayed": len(result.by_operation_id),
        "note": L1_PEAK_NOTE,
        **scope.as_response(),
    }
    if result.peak is None:
        response["peak"] = None
        response["usable"] = True
        response["reason"] = "This report records no L1 activity."
    elif result.exceeds_capacity:
        # A refusal that still gives the figures underneath is not a refusal.
        response["peak"] = None
        response["usable"] = False
        total = _whole(result.peak.total_bytes)
        reaches = "past any finite size" if total is None else f"{total} bytes per bank"
        response["reason"] = (
            f"The replay reaches {reaches}, "
            f"past the {result.capacity_bytes} of L1 a core has, so it describes no "
            "reachable state and its figures are withheld. Causes: occupancy summed "
            "across devices, a capture that cannot be replayed (a whole run under one "
            "operation, or frees with no address), or residents on disjoint cores, "
            "which this model does not represent."
        )
    else:
        response["usable"] = True
        response["peak"] = {
            **_decomposition(result.peak, contributors=True),
            "operation_name": report.names.get(result.peak.operation_id),
        }
        response["top_operations"] = _top_operations(
            result.by_operation_id, report.names, count
        )
    if caveats:
        response["caveat"] = " ".join(caveats)
    return response


_PerRank = TypeVar("_PerRank")


def _cached_per_rank(
    registry: ReportRegistry,
    handle: str,
    variant: CacheVariant,
    queries: DatabaseQueries,
    scope: RankScope,
    build: Callable[[DatabaseQueries, RankScope], _PerRank],
) -> _PerRank:
    """`build` once per handle and rank. A build that raises is not kept."""
    # One pinned entry holding every rank, so a rank read cannot evict a scoped report.
    by_rank: Dict[Optional[int], _PerRank] = registry.cached_report(
        handle, lambda _: {}, variant=variant
    )
    if scope.rank not in by_rank:
        by_rank[scope.rank] = build(queries, scope)
    return by_rank[scope.rank]


def _cached_dram_fallbacks(
    registry: ReportRegistry, handle: str, queries: DatabaseQueries, scope: RankScope
) -> DramFallbackReport:
    """Read once per handle and rank: one operation's needs every operation's tensors."""
    return _cached_per_rank(
        registry,
        handle,
        CacheVariant.DRAM_FALLBACKS,
        queries,
        scope,
        report_dram_fallbacks,
    )


def operation_failure_fields(
    registry: ReportRegistry,
    handle: str,
    queries: DatabaseQueries,
    scope: RankScope,
    operation: Operation,
) -> Tuple[Dict[str, object], Optional[str]]:
    """The error and likely DRAM fallback `operation_detail` adds for one operation,
    as its `detail_fields`.

    Both are optional, unlike in `errors` and `dram_fallbacks`: the rest of the detail
    answers without them. So where their rows cannot be attributed to the rank, they
    are left out, and the caveat returned says why, rather than refusing the whole
    detail.
    """
    fields: Dict[str, object] = {}
    withheld: List[str] = []
    if _attributable(queries, scope, _ERROR_TABLES, withheld, "error"):
        error = select_error_for_operation(
            _error_records(queries, scope, operation.operation_id), operation
        )
        if error is not None:
            graphs = _graphs_checked(queries, scope, [operation.operation_id])
            fields["error"] = _error_entry(error, _graph_for(graphs, operation))
    if queries.has_table("operation_arguments") and _attributable(
        queries, scope, _FALLBACK_TABLES, withheld, "dram_fallback"
    ):
        report = _cached_dram_fallbacks(registry, handle, queries, scope)
        fallback = report.by_operation_id.get(operation.operation_id)
        if fallback is not None:
            fields["dram_fallback"] = fallback
    return fields, " ".join(withheld) or None


def _attributable(
    queries: DatabaseQueries,
    scope: RankScope,
    tables: Sequence[str],
    withheld: List[str],
    field: str,
) -> bool:
    """Whether `field` can be read for the rank; if not, `withheld` says why."""
    try:
        refuse_unattributable(queries, scope, *tables)
    except UnattributableRankError as error:
        withheld.append(f"{field} is withheld: {error}")
        return False
    return True


__all__ = [
    "DRAM_FALLBACKS_NOTE",
    "ERRORS_NOTE",
    "L1_PEAK_NOTE",
    "MAX_ERROR_TEXT_CHARS",
    "MAX_PEAK_CONTRIBUTORS",
    "DramFallbackReport",
    "L1PeakReport",
    "dram_fallbacks",
    "errors",
    "l1_peak",
    "operation_failure_fields",
    "report_dram_fallbacks",
    "report_l1_peak",
]
