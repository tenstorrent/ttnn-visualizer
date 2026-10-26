# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""The L1 peak per operation, with circular buffers and intra-op tensors. #2154

A port of `src/functions/l1PeakDecomposition.ts`, `resolveAddressLifetimes` included;
mirror a change there. `buffers` records only tensors that survive an operation, so the
peak comes from replaying the captured graph.
"""

import math
import re
from dataclasses import dataclass, field
from enum import Enum
from typing import (
    Callable,
    Dict,
    Iterable,
    List,
    Mapping,
    Optional,
    Sequence,
    Set,
    Tuple,
)

from ttnn_visualizer.models import L1_BUFFER_TYPES, Buffer, BufferType

# `L1_NUM_CORES`: the bank count a node without `max_size_per_bank` falls back to.
DEFAULT_BANK_COUNT = 64
NO_CONSUMER_OPERATION_ID = -1
# `DEALLOCATE_OP_NAME_LIST` in `src/definitions/Deallocate.ts`.
DEALLOCATE_OPERATION_NAMES = frozenset({"ttnn.deallocate", "ttnn::deallocate"})

_CPP_ENUM_PREFIX = "BufferType::"


class ResidentKind(str, Enum):
    CIRCULAR_BUFFER = "circular-buffer"
    # Allocated and freed inside one operation, so never in a post-op snapshot.
    INTERMEDIATE_TENSOR = "intermediate-tensor"
    PERSISTENT_TENSOR = "persistent-tensor"
    # Still allocated after its last real consumer; the only freeable class.
    STALE_TENSOR = "stale-tensor"


class Precision(str, Enum):
    EXACT = "exact"
    # A node never says which cores (#2027), so two residents may not share one.
    UPPER_BOUND = "upper-bound"


def js_number(value: object) -> float:
    """`Number(value)` as the app reads a graph param."""
    if value is None:
        return 0.0
    if isinstance(value, bool):
        return float(value)
    if isinstance(value, (int, float)):
        return float(value)
    if not isinstance(value, str):
        return math.nan
    text = value.strip()
    if text == "":
        return 0.0
    if text[:2].lower() in ("0x", "0o", "0b"):
        try:
            return float(int(text, 0))
        except ValueError:
            return math.nan
    if "_" in text or text.lower().strip("+-") in ("inf", "infinity", "nan"):
        return {
            "Infinity": math.inf,
            "+Infinity": math.inf,
            "-Infinity": -math.inf,
        }.get(text, math.nan)
    try:
        return float(text)
    except ValueError:
        return math.nan


def _address(params: Dict) -> Optional[float]:
    # A null address read as 0 would collide with real buffers there.
    raw = params.get("address")
    if raw is None:
        return None
    address = js_number(raw)
    return address if math.isfinite(address) else None


def _buffer_type(value: object) -> Optional[BufferType]:
    """`toBufferType`: an enum value, its name, or its C++ name."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        try:
            return BufferType(value)
        except ValueError:
            return None
    if isinstance(value, float):
        return _buffer_type(int(value)) if value.is_integer() else None
    if not isinstance(value, str):
        return None
    if re.fullmatch(r"[0-9]+", value):
        return _buffer_type(int(value))
    if value.startswith(_CPP_ENUM_PREFIX):
        value = value[len(_CPP_ENUM_PREFIX) :]
    return BufferType.__members__.get(value)


def _is_l1_node(params: Dict) -> bool:
    # Keyed on `type`, which every capture emits; some omit `buffer_type`.
    return _buffer_type(params.get("type")) in L1_BUFFER_TYPES


def _param(params: Dict, key: str) -> float:
    """A param as the app reads it: missing is undefined, so NaN, while null is 0."""
    return js_number(params[key]) if key in params else math.nan


def _per_bank_bytes(params: Dict, bank_count: int) -> float:
    if "max_size_per_bank" in params:
        return js_number(params["max_size_per_bank"])
    cores = _param(params, "num_cores")
    divisor = cores if cores and not math.isnan(cores) else float(bank_count)
    size = _param(params, "size")
    if divisor == 0:
        # As JavaScript divides: no bank count is no figure, not an error.
        return (
            math.nan if size == 0 or math.isnan(size) else math.copysign(math.inf, size)
        )
    return size / divisor


def _params(node: object) -> Optional[Dict]:
    if not isinstance(node, dict):
        return None
    params = node.get("params")
    return params if isinstance(params, dict) else None


def _node_type(node: object) -> object:
    return node.get("node_type") if isinstance(node, dict) else None


def _intermediates(
    operations: Iterable[Tuple[int, Sequence[object]]],
) -> Set[Tuple[int, float, int]]:
    """Allocations an operation also frees, keyed by its id and their address's occurrence.

    Keyed by id across every operation, as `findIntermediates` is, so two operations that
    share an id share their keys.
    """
    found: Set[Tuple[int, float, int]] = set()
    for operation_id, nodes in operations:
        seen: Dict[float, int] = {}
        live: Dict[float, int] = {}
        for node in nodes:
            params = _params(node)
            address = _address(params) if params and _is_l1_node(params) else None
            if address is None:
                continue
            node_type = _node_type(node)
            if node_type == "buffer_allocate":
                occurrence = seen.get(address, 0) + 1
                seen[address] = occurrence
                live[address] = occurrence
            elif node_type == "buffer_deallocate" and address in live:
                found.add((operation_id, address, live.pop(address)))
    return found


@dataclass
class _Tensor:
    bytes: float
    intermediate: bool


@dataclass
class _State:
    tensors: Dict[float, _Tensor] = field(default_factory=dict)
    circular_buffers: Dict[float, float] = field(default_factory=dict)
    allocations_seen: Dict[float, int] = field(default_factory=dict)


def _apply(
    node: object,
    state: _State,
    operation_id: int,
    bank_count: int,
    intermediates: Set[Tuple[int, float, int]],
) -> bool:
    """Apply one node; True when it changed occupancy."""
    params = _params(node)
    if params is None:
        return False
    node_type = _node_type(node)

    if node_type == "circular_buffer_deallocate_all":
        if not state.circular_buffers:
            return False
        state.circular_buffers.clear()
        return True

    if node_type == "circular_buffer_allocate":
        address = _address(params)
        # A globally allocated CB is a view onto an L1 tensor already counted. #1651
        if _param(params, "globally_allocated") == 1 or address is None:
            return False
        state.circular_buffers[address] = _param(params, "size")
        return True

    address = _address(params) if _is_l1_node(params) else None
    if address is None:
        return False

    if node_type == "buffer_allocate":
        occurrence = state.allocations_seen.get(address, 0) + 1
        state.allocations_seen[address] = occurrence
        state.tensors[address] = _Tensor(
            _per_bank_bytes(params, bank_count),
            (operation_id, address, occurrence) in intermediates,
        )
        return True

    if node_type == "buffer_deallocate":
        return state.tensors.pop(address, None) is not None

    return False


@dataclass
class Resident:
    address: float
    # Per bank, as `max_size_per_bank` is.
    bytes: float
    kind: ResidentKind
    # The last operation that really consumed the tensor; None for a circular buffer.
    last_used_by_operation_id: Optional[int]


@dataclass
class Decomposition:
    """One operation's tightest instant, split by what each resident is."""

    operation_id: int
    total_bytes: float
    circular_buffer_bytes: float
    intermediate_tensor_bytes: float
    persistent_tensor_bytes: float
    stale_tensor_bytes: float
    precision: Precision
    contributors: List[Resident]
    # Allocations dropped at this operation's boundary because the snapshot freed them.
    reconciled_away_count: int = 0


def _kind(tensor: _Tensor, last_use: Optional[int], operation_id: int) -> ResidentKind:
    # Intermediate first: the graph shows this occurrence freed here, while the last
    # use is inferred from whichever tensor once sat at this address.
    if tensor.intermediate:
        return ResidentKind.INTERMEDIATE_TENSOR
    if (
        last_use is not None
        and last_use > NO_CONSUMER_OPERATION_ID
        and last_use < operation_id
    ):
        return ResidentKind.STALE_TENSOR
    return ResidentKind.PERSISTENT_TENSOR


def _total(totals: Mapping[ResidentKind, float]) -> float:
    # Added in the app's order: from Python 3.12, `sum()` can differ in the last bit.
    return (
        totals[ResidentKind.CIRCULAR_BUFFER]
        + totals[ResidentKind.INTERMEDIATE_TENSOR]
        + totals[ResidentKind.PERSISTENT_TENSOR]
        + totals[ResidentKind.STALE_TENSOR]
    )


def _total_bytes(
    state: _State, operation_id: int, last_use_by_address: Mapping[float, int]
) -> float:
    """`_measure`'s `total_bytes`, without building a resident per entry.

    Summed in the same order, so the figure matches bit for bit: most instants are
    measured only to be beaten, and this is what they are compared on.
    """
    totals = {kind: 0.0 for kind in ResidentKind}
    for size in state.circular_buffers.values():
        totals[ResidentKind.CIRCULAR_BUFFER] += size
    for address, tensor in state.tensors.items():
        kind = _kind(tensor, last_use_by_address.get(address), operation_id)
        totals[kind] += tensor.bytes
    return _total(totals)


def _measure(
    state: _State, operation_id: int, last_use_by_address: Mapping[float, int]
) -> Decomposition:
    contributors: List[Resident] = []
    totals = {kind: 0.0 for kind in ResidentKind}

    for address, size in state.circular_buffers.items():
        totals[ResidentKind.CIRCULAR_BUFFER] += size
        contributors.append(Resident(address, size, ResidentKind.CIRCULAR_BUFFER, None))

    for address, tensor in state.tensors.items():
        last_use = last_use_by_address.get(address)
        kind = _kind(tensor, last_use, operation_id)
        totals[kind] += tensor.bytes
        contributors.append(Resident(address, tensor.bytes, kind, last_use))

    return Decomposition(
        operation_id=operation_id,
        total_bytes=_total(totals),
        circular_buffer_bytes=totals[ResidentKind.CIRCULAR_BUFFER],
        intermediate_tensor_bytes=totals[ResidentKind.INTERMEDIATE_TENSOR],
        persistent_tensor_bytes=totals[ResidentKind.PERSISTENT_TENSOR],
        stale_tensor_bytes=totals[ResidentKind.STALE_TENSOR],
        precision=(
            Precision.UPPER_BOUND
            if len(state.circular_buffers) + len(state.tensors) > 1
            else Precision.EXACT
        ),
        contributors=contributors,
    )


@dataclass
class L1PeakResult:
    by_operation_id: Dict[int, Decomposition]
    peak: Optional[Decomposition]
    reconciled_away_count: int
    capacity_bytes: Optional[int]
    # The peak is past the device's own L1, so the replay is not a measurement.
    exceeds_capacity: bool


def build_l1_peak(
    operations: Sequence[Tuple[int, Callable[[], Sequence[object]]]],
    snapshot_by_operation_id: Mapping[int, List[Buffer]],
    last_use_by_address: Mapping[float, int],
    bank_count: Optional[int] = None,
    capacity_bytes: Optional[int] = None,
    keep_contributors: bool = False,
) -> L1PeakResult:
    """Replay each operation's graph, in execution order, keeping its tightest instant.

    Each operation comes with a callable that reads its graph, so a caller can parse
    one at a time. Each graph is read once, unless an operation id repeats: then every
    graph is read first for its intermediates, which `findIntermediates` keys by id
    across every operation.

    Only the peak keeps its `contributors` unless `keep_contributors`: the tool reads
    no other operation's, and every operation's runs to hundreds of thousands of
    residents on a large capture. The app keeps them all, so the parity test asks to.
    """
    banks = bank_count if bank_count is not None else DEFAULT_BANK_COUNT
    operation_ids = [operation_id for operation_id, _ in operations]
    shared_intermediates = (
        _intermediates((operation_id, read()) for operation_id, read in operations)
        if len(set(operation_ids)) < len(operation_ids)
        else None
    )
    state = _State()
    by_operation_id: Dict[int, Decomposition] = {}
    reconciled_away = 0
    peak: Optional[Decomposition] = None

    for operation_id, read in operations:
        nodes = read()
        intermediates = (
            shared_intermediates
            if shared_intermediates is not None
            else _intermediates([(operation_id, nodes)])
        )
        state.allocations_seen.clear()
        # Seeded from the state carried in, so a first node that frees is measured too.
        tightest = _measure(state, operation_id, last_use_by_address)
        for node in nodes:
            if _apply(node, state, operation_id, banks, intermediates) and (
                _total_bytes(state, operation_id, last_use_by_address)
                > tightest.total_bytes
            ):
                tightest = _measure(state, operation_id, last_use_by_address)

        # The snapshot is what survived: the graph under-reports frees (#2025).
        snapshot = snapshot_by_operation_id.get(operation_id)
        reconciled_here = 0
        if snapshot is not None:
            survivors = {
                buffer.address: buffer
                for buffer in snapshot
                if buffer.buffer_type in L1_BUFFER_TYPES
            }
            for address in list(state.tensors):
                if address not in survivors:
                    del state.tensors[address]
                    reconciled_here += 1
            # A survivor the replay never saw is an allocation the graph dropped.
            for address, buffer in survivors.items():
                state.tensors[address] = _Tensor(buffer.max_size_per_bank, False)
        reconciled_away += reconciled_here

        # Reconciliation can add residents, so this instant can hold the peak.
        after = _measure(state, operation_id, last_use_by_address)
        # A program's circular buffers stop occupying L1 when it stops executing.
        state.circular_buffers.clear()

        best = after if after.total_bytes > tightest.total_bytes else tightest
        best.reconciled_away_count = reconciled_here
        by_operation_id[operation_id] = best
        # Strictly greater, so the peak names the first operation to reach it.
        is_peak = best.total_bytes > 0 and (
            peak is None or best.total_bytes > peak.total_bytes
        )
        if is_peak:
            if peak is not None and not keep_contributors:
                peak.contributors = []
            peak = best
        if is_peak or keep_contributors:
            best.contributors.sort(key=lambda resident: -resident.bytes)
        else:
            best.contributors = []

    return L1PeakResult(
        by_operation_id=by_operation_id,
        peak=peak,
        reconciled_away_count=reconciled_away,
        capacity_bytes=capacity_bytes,
        exceeds_capacity=(
            capacity_bytes is not None
            and peak is not None
            and peak.total_bytes > capacity_bytes
        ),
    )


def last_valid_consumer(
    consumers: Iterable[int], operation_names_by_id: Mapping[int, str]
) -> int:
    """`getLastValidConsumer`: the latest consumer that isn't a deallocate call."""
    last = NO_CONSUMER_OPERATION_ID
    for consumer in consumers:
        if consumer <= last:
            continue
        if (
            operation_names_by_id.get(consumer, "").lower()
            in DEALLOCATE_OPERATION_NAMES
        ):
            continue
        last = consumer
    return last


@dataclass
class AddressLifetimes:
    last_use_by_address: Dict[float, int]
    # Addresses hosting more than one lifetime, left unclassified: stale is a floor. #2029
    unattributable_stale_address_count: int


def resolve_address_lifetimes(
    tensors: Iterable[Tuple[int, Optional[int], object, List[int]]],
    operation_names_by_id: Mapping[int, str],
) -> AddressLifetimes:
    """Last real use per address, where that has one answer.

    `tensors` is every operation's inputs and outputs, as (tensor id, address, buffer
    type, consumers).
    """
    last_use_by_tensor: Dict[int, Tuple[int, int]] = {}
    for tensor_id, tensor_address, buffer_type, consumers in tensors:
        if tensor_address is None or buffer_type not in L1_BUFFER_TYPES:
            continue
        last_use_by_tensor[tensor_id] = (
            tensor_address,
            last_valid_consumer(consumers, operation_names_by_id),
        )

    uses_by_address: Dict[float, List[int]] = {}
    for used_address, last_use in last_use_by_tensor.values():
        uses_by_address.setdefault(used_address, []).append(last_use)

    last_use_by_address: Dict[float, int] = {}
    unattributable = 0
    for address, uses in uses_by_address.items():
        # A tensor only deallocate calls consumed has no last use to be late against.
        real = [use for use in uses if use > NO_CONSUMER_OPERATION_ID]
        if len(real) == 1:
            last_use_by_address[address] = real[0]
        elif len(real) > 1:
            unattributable += 1
    return AddressLifetimes(last_use_by_address, unattributable)


def _ranked(entry: Decomposition) -> Tuple[bool, float, int]:
    """`compareTotalsDescending`, then lower id: NaN last, since it orders against nothing."""
    total = entry.total_bytes
    if math.isnan(total):
        return (True, 0.0, entry.operation_id)
    return (False, -total, entry.operation_id)


def _composition(entry: Decomposition) -> Tuple[object, ...]:
    # As the app's joined string key: every NaN is one key, and -0 already equals 0.
    return tuple(
        "NaN" if math.isnan(value) else value
        for value in (
            entry.total_bytes,
            entry.circular_buffer_bytes,
            entry.intermediate_tensor_bytes,
            entry.persistent_tensor_bytes,
            entry.stale_tensor_bytes,
        )
    )


def top_compositions(
    entries: Iterable[Decomposition], count: int
) -> List[Tuple[Decomposition, List[int]]]:
    """`getTopL1PeakOperations`: the largest, one per distinct composition.

    Repeated layers are byte-identical, so each composition is kept once, with the
    later operations that repeat it.
    """
    by_composition: Dict[Tuple[object, ...], Tuple[Decomposition, List[int]]] = {}
    for entry in sorted(entries, key=_ranked):
        key = _composition(entry)
        if key in by_composition:
            by_composition[key][1].append(entry.operation_id)
        else:
            by_composition[key] = (entry, [])
    return list(by_composition.values())[:count]


__all__ = [
    "DEFAULT_BANK_COUNT",
    "AddressLifetimes",
    "Decomposition",
    "L1PeakResult",
    "Precision",
    "Resident",
    "ResidentKind",
    "build_l1_peak",
    "js_number",
    "last_valid_consumer",
    "resolve_address_lifetimes",
    "top_compositions",
]
