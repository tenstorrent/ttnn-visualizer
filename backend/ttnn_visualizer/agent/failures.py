# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""What went wrong in a run: recorded errors, likely DRAM fallbacks, the L1 peak. #2154

Each answer reads the profiler database the way the app's routes do, so it agrees with
what the app shows for the same report.
"""

import math
from collections import defaultdict
from dataclasses import dataclass
from functools import partial
from typing import (
    Dict,
    Iterable,
    List,
    NamedTuple,
    Optional,
    Sequence,
    Tuple,
    Union,
)

from ttnn_visualizer.agent import allocation_failures, circular_buffers
from ttnn_visualizer.agent import dram_fallbacks as fallback_rules
from ttnn_visualizer.agent import l1_peak as peak_replay
from ttnn_visualizer.agent.bounds import (
    MAX_LIMIT,
    GraphTooLargeError,
    bounded,
    ensure_graph_readable,
)
from ttnn_visualizer.agent.captured_graph import UnreadableGraphError, parse_graph
from ttnn_visualizer.agent.handles import TOOL_TABLES, CacheVariant, ReportRegistry
from ttnn_visualizer.agent.operations import (
    BUFFER_SIZE_UNIT,
    RankScope,
    cached_per_rank,
    caveat_field,
    profiler_db,
    rank_scope,
    refuse_unattributable,
    scoped,
    scoped_devices,
    unattributable_reason,
    withheld_caveat,
)
from ttnn_visualizer.agent.scope_outcomes import failed_device_operation_names
from ttnn_visualizer.agent.tool_names import McpToolName
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
# The failure patterns are unanchored and lazy, so a crafted message costs the square of
# its length; the longest real one across 141 local captures is 14,248 characters.
MAX_PARSED_MESSAGE_CHARS = 32_768
# A crash leaves one or two launches open; a graph left with every scope open names all.
MAX_FAILED_DEVICE_OPERATIONS = 20
# The peak's largest residents; the rest are counted.
MAX_PEAK_CONTRIBUTORS = 20
# Repeats of one composition listed; one capture repeats a composition 9,679 times.
MAX_REPEAT_OPERATION_IDS = 20
# The tables behind each answer's figures, so its rank refusal covers every one.
# `query_tensors` joins `device_tensors` by id alone where it has no `rank`.
_FALLBACK_TABLES = (
    "operation_arguments",
    "tensors",
    "device_tensors",
    "input_tensors",
    "output_tensors",
    "errors",
)
# Not `device_tensors`: the replay reads a tensor's own address, never its devices'.
_L1_PEAK_TABLES = (
    "captured_graph",
    "buffers",
    "tensors",
    "input_tensors",
    "output_tensors",
    "devices",
)

ERRORS_NOTE = (
    "Rows of the report's errors table. error_type incomplete_operation means the "
    "operation started and never completed, so the run most likely crashed inside it. "
    "attached is false for an error the report could not place on an operation of that "
    "id and name; the app shows those at report level. failed_device_operations are "
    "the device operations in the operation's captured graph whose launch did not "
    f"complete, at most {MAX_FAILED_DEVICE_OPERATIONS}; failed_device_operation_count "
    "counts them all. allocation_failure is read out of the message when it is one of "
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
    "operation. Circular buffers stop occupying L1 when their program ends. also_at "
    f"lists at most {MAX_REPEAT_OPERATION_IDS} of the operations that repeat a "
    "composition, and also_at_count counts them all."
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
    reader: str,
    operation_ids: Optional[List[int]] = None,
) -> Dict[Tuple[int, int], str]:
    """Raw captured graphs, as `serialize_operations` keys them; a later row wins.

    Refused past `MAX_CAPTURED_GRAPH_CHARS`, measured with the filters the read uses.
    """
    filters = (
        scoped(queries, "captured_graph", scope)
        if operation_ids is None
        else scoped(queries, "captured_graph", scope, operation_id=operation_ids)
    )
    ensure_graph_readable(queries, filters, reader)
    return {
        (graph.operation_id, graph.rank): graph.captured_graph
        for graph in queries.query_device_operations(filters)
    }


def _graph_for(
    graphs: Dict[Tuple[int, int], str], operation: Operation
) -> List[object]:
    """For `errors` and `l1_peak`, which read an unreadable graph as empty, where the
    app would throw; `operation_detail` withholds what it would take from one."""
    raw = rank_or_zero(graphs, operation.operation_id, operation.rank)
    if not raw:
        return []
    try:
        return parse_graph(raw)
    except UnreadableGraphError:
        return []


def _allocation_failure(message: Optional[str]) -> Optional[Dict[str, object]]:
    """`parse_allocation_failure` on the part of a message a real failure fits in."""
    return allocation_failures.parse_allocation_failure(
        message[:MAX_PARSED_MESSAGE_CHARS] if isinstance(message, str) else message
    )


def _allocation_fields(message: Optional[str]) -> Dict[str, object]:
    failure = _allocation_failure(message)
    if failure is None:
        return {}
    shown = dict(failure)
    core_range = failure.get("core_range")
    if isinstance(core_range, str):
        shown.update(_truncated("core_range", core_range))
    return {
        "allocation_failure": shown,
        "diagnosis": allocation_failures.diagnose(failure),
    }


def _error_entry(
    error: ErrorRecord, graph: Optional[List[object]]
) -> Dict[str, object]:
    """One error as `errors` lists it and `operation_detail` carries it; a None graph,
    one that could not be read, leaves out the failed device operations it names."""
    entry: Dict[str, object] = {
        "error_type": error.error_type,
        "timestamp": error.timestamp,
        **_truncated("error_message", error.error_message),
        **_truncated("stack_trace", error.stack_trace),
    }
    if graph is not None:
        failed = failed_device_operation_names(graph)
        entry["failed_device_operations"] = failed[:MAX_FAILED_DEVICE_OPERATIONS]
        entry["failed_device_operation_count"] = len(failed)
    entry.update(_allocation_fields(error.error_message))
    return entry


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
        has_errors_table = queries.has_table("errors")
        refuse_unattributable(queries, scope, "errors")
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
        graphs: Dict[Tuple[int, int], str] = {}
        # Only a listed error reads a graph, so only then must the graph's rank be known.
        if shown_ids:
            refuse_unattributable(queries, scope, "captured_graph")
            graphs = _graphs(queries, scope, "an error lookup", shown_ids)

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

    predates = (
        []
        if has_errors_table
        else [
            "This report predates the errors table, so it cannot say whether the run "
            "recorded an error."
        ]
    )
    response: Dict[str, object] = {
        "handle": handle,
        "error_count": len(records),
        "returned": len(listed),
        "errors": listed,
        "note": ERRORS_NOTE,
        **scope.as_response(),
        **caveat_field(scope, *predates),
    }
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
    # Neither port reads `size`, and the joins that find one are most of this read's cost.
    tensors = {
        (tensor.tensor_id, tensor.rank): tensor
        for tensor in queries.query_tensors(
            scoped(queries, "tensors", scope), size_from_buffers=False
        )
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
        failure = _allocation_failure(error.error_message if error else None)
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
        **caveat_field(scope),
    }
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
            "also_at": also_at[:MAX_REPEAT_OPERATION_IDS],
            "also_at_count": len(also_at),
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
    devices = scoped_devices(queries, scope)
    if not devices:
        raise ValueError(
            "this report has no devices row, so there is no bank count or L1 size to "
            "replay its captured graph against"
        )
    device = devices[0]
    graphs = _graphs(queries, scope, "the replay")
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
    # By value, as the app reads them, so a report storing names reads none (#2196).
    for buffer_type in sorted(L1_BUFFER_TYPES, key=lambda entry: entry.value):
        for buffer in queries.query_buffers(
            scoped(queries, "buffers", scope, buffer_type=buffer_type.value)
        ):
            snapshot.setdefault(buffer.operation_id, []).append(buffer)
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
        refuse_unattributable(queries, scope, *_L1_PEAK_TABLES)
        # Cached once only the peak keeps its residents: every operation's would pin
        # about 100 MB on the largest local capture.
        report = cached_per_rank(
            registry, handle, CacheVariant.L1_PEAK, queries, scope, report_l1_peak
        )

    result, lifetimes = report.result, report.lifetimes
    caveats: List[str] = []
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
    response.update(caveat_field(scope, *caveats))
    return response


def _cached_dram_fallbacks(
    registry: ReportRegistry, handle: str, queries: DatabaseQueries, scope: RankScope
) -> DramFallbackReport:
    """Read once per handle and rank: one operation's needs every operation's tensors."""
    return cached_per_rank(
        registry,
        handle,
        CacheVariant.DRAM_FALLBACKS,
        queries,
        scope,
        report_dram_fallbacks,
    )


def _operation_graph(
    queries: DatabaseQueries, scope: RankScope, operation: Operation
) -> Tuple[Optional[List[object]], Optional[str]]:
    """The operation's nodes, else None and why they cannot be read; None with no
    reason is a report with no graph for it."""
    try:
        rows = _graphs(queries, scope, "operation_detail", [operation.operation_id])
    except GraphTooLargeError as error:
        return None, str(error)
    raw = rank_or_zero(rows, operation.operation_id, operation.rank)
    if raw is None:
        return None, None
    try:
        return parse_graph(raw), None
    except UnreadableGraphError:
        return None, "the operation's captured graph is not a JSON list of nodes"


def operation_failure_fields(
    registry: ReportRegistry,
    handle: str,
    queries: DatabaseQueries,
    scope: RankScope,
    operation: Operation,
    circular_buffer_limit: int = MAX_LIMIT,
) -> Tuple[Dict[str, object], Optional[str]]:
    """The error, likely DRAM fallback and circular buffers `operation_detail` adds for
    one operation, as its `detail_fields`. `circular_buffer_limit` caps the circular
    buffers listed, as `include` caps the perf rows beside them.

    All are optional, unlike in `errors` and `dram_fallbacks`: the rest of the detail
    answers without them. So where their rows cannot be attributed to the rank, they
    are left out, and the caveat returned says why, rather than refusing the whole
    detail.
    """
    fields: Dict[str, object] = {}
    withheld: List[str] = []
    # The error and the circular buffers read the same row, so it is read once and
    # both withhold what they take from it alike.
    read: List[Tuple[Optional[List[object]], Optional[str]]] = []

    def graph() -> Tuple[Optional[List[object]], Optional[str]]:
        if not read:
            read.append(_operation_graph(queries, scope, operation))
        return read[0]

    if _attributable(queries, scope, ("errors",), withheld, "error"):
        error = select_error_for_operation(
            _error_records(queries, scope, operation.operation_id), operation
        )
        if error is not None and _attributable(
            queries, scope, ("captured_graph",), withheld, "error"
        ):
            nodes, unreadable = graph()
            if unreadable is not None:
                # Read as empty, it would claim no device operation failed.
                withheld.append(
                    f"error.failed_device_operations is withheld: {unreadable}"
                )
                fields["error"] = _error_entry(error, None)
            else:
                fields["error"] = _error_entry(error, nodes or [])
    # A report without the table, or without a row for this operation, says nothing
    # about its circular buffers, which a count of zero would claim it did.
    if queries.has_table("captured_graph") and _attributable(
        queries, scope, ("captured_graph",), withheld, "circular_buffers"
    ):
        nodes, unreadable = graph()
        if unreadable is not None:
            # Read as empty, it would claim the operation allocated none.
            withheld.append(f"circular_buffers is withheld: {unreadable}")
        elif nodes is not None:
            buffers = circular_buffers.operation_circular_buffers(
                nodes, circular_buffer_limit
            )
            fields["circular_buffers"] = buffers
            unrecorded = buffers["unrecorded_launch_count"]
            if unrecorded:
                launches = "launch" if unrecorded == 1 else "launches"
                withheld.append(
                    f"circular_buffers has {unrecorded} device operation {launches} "
                    "whose circular buffers the graph did not record, most likely a "
                    "cached program relaunched; the graph records a program's "
                    "buffers only at its first launch, so they are unknown, not zero"
                )
            unlisted = buffers["unlisted_circular_buffer_count"]
            if unlisted:
                unlisted_buffers = "buffer" if unlisted == 1 else "buffers"
                withheld.append(
                    f"circular_buffers leaves out {unlisted} circular "
                    f"{unlisted_buffers} missing from their device operation's "
                    "snapshot, as a graph cut off mid-launch or a launch whose buffers "
                    "run in two batches leaves them, so "
                    "circular_buffer_count and device_operation_count leave them out "
                    "and their bytes per core are unknown"
                )
    if all(
        queries.has_table(table) for table in TOOL_TABLES[McpToolName.DRAM_FALLBACKS]
    ) and _attributable(queries, scope, _FALLBACK_TABLES, withheld, "dram_fallback"):
        report = _cached_dram_fallbacks(registry, handle, queries, scope)
        fallback = report.by_operation_id.get(operation.operation_id)
        if fallback is not None:
            fields["dram_fallback"] = fallback
    return fields, " ".join(_sentence(entry) for entry in withheld) or None


def _sentence(text: str) -> str:
    # Several reasons share one caveat; unended, they would run into each other.
    return text if text.endswith(".") else f"{text}."


def _attributable(
    queries: DatabaseQueries,
    scope: RankScope,
    tables: Sequence[str],
    withheld: List[str],
    field: str,
) -> bool:
    """Whether `field` can be read for the rank; if not, `withheld` says why."""
    reason = unattributable_reason(queries, scope, *tables)
    if reason is not None:
        withheld.append(withheld_caveat([field], reason))
    return reason is None


__all__ = [
    "DRAM_FALLBACKS_NOTE",
    "ERRORS_NOTE",
    "L1_PEAK_NOTE",
    "MAX_ERROR_TEXT_CHARS",
    "MAX_FAILED_DEVICE_OPERATIONS",
    "MAX_PARSED_MESSAGE_CHARS",
    "MAX_PEAK_CONTRIBUTORS",
    "MAX_REPEAT_OPERATION_IDS",
    "DramFallbackReport",
    "L1PeakReport",
    "dram_fallbacks",
    "errors",
    "l1_peak",
    "operation_failure_fields",
    "report_dram_fallbacks",
    "report_l1_peak",
]
