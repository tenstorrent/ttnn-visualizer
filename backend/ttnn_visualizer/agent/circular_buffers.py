# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""The circular buffers each device operation in an operation's captured graph allocated. #2185

A port of the circular-buffer half of `processMemoryAllocations`
(`src/functions/processMemoryAllocations.ts`), with `createCbSlotKeys` and `cbDeviceKey`
(`src/functions/cbDeviceSlots.ts`) and `getCoresInRangeList` (`src/functions/math.ts`);
mirror a change there. `updateDeviceOperationId` (`src/hooks/useAPI.tsx`) renames an
older capture's `counter` to `id` before the app reads a graph, so the port reads either.
"""

import math
import re
from dataclasses import dataclass, field, replace
from functools import lru_cache
from typing import (
    Callable,
    Dict,
    FrozenSet,
    List,
    Optional,
    Sequence,
    Set,
    Tuple,
    Union,
)

from ttnn_visualizer.agent.bounds import MAX_LIMIT
from ttnn_visualizer.agent.l1_peak import js_number

# `SINGLE_DEVICE_KEY`: a graph with no device dimension accumulates into one bucket.
SINGLE_DEVICE_KEY = "single"
# The bucket for circular buffers whose `core_range_set` resolves to no cores.
UNATTRIBUTED_CORE = "?"
SIZE_UNIT = "bytes_per_core"

CIRCULAR_BUFFERS_NOTE = (
    "From the operation's captured graph, as the app's per-core CB view reads it: one "
    "entry per device operation that allocated circular buffers. Sizes are bytes per "
    "core, not per bank, so they do not add to allocations. A mesh records each "
    "circular buffer once per device; those copies are one row whose device_count "
    "says how many devices allocated it, and a device operation each device ran with "
    "the same buffers is one entry with its own device_count. So "
    "circular_buffer_count counts buffers, not their copies; a device operation run "
    "twice on one device is two entries. A globally allocated circular buffer is a view "
    "onto an L1 tensor already counted, so it adds no L1. max_bytes_per_core is the "
    "largest circular-buffer total on any one core; a circular buffer whose core range "
    "is empty is counted in unattributed_bytes instead. core_range_set lists inclusive "
    "core rectangles and core_count counts the distinct cores they cover. At most "
    f"{MAX_LIMIT} rows are listed; the counts cover them all."
)

_FUNCTION_START = "function_start"
_FUNCTION_END = "function_end"
_ALLOCATE = "circular_buffer_allocate"
_DEALLOCATE_ALL = "circular_buffer_deallocate_all"

# ASCII, as JavaScript's `\d` is; Python's would also match other scripts' digits.
_CORE_RANGE_RECT_RE = re.compile(r"\[([^\]]+)\]")
_CORE_COORD_RE = re.compile(r"\(x=(\d+),y=(\d+)\)|(\d+)-(\d+)", re.ASCII)
_LEADING_INTEGER_RE = re.compile(r"[+-]?\d+", re.ASCII)


class _Missing:
    """A key absent from a node's params, which JavaScript reads as `undefined`."""


_MISSING = _Missing()

Number = Union[int, float]


def _parse_int(value: object) -> Number:
    """`parseInt(value, 10)`: the leading integer of its string form, else NaN."""
    if isinstance(value, _Missing) or value is None:
        return math.nan
    if isinstance(value, bool):
        text = "true" if value else "false"
    elif isinstance(value, float):
        if not math.isfinite(value):
            return math.nan
        text = str(int(value))
    else:
        text = str(value)
    match = _LEADING_INTEGER_RE.match(text.lstrip())
    return int(match.group(0)) if match else math.nan


def _js_template(value: object) -> str:
    """`${value}`: how a value renders inside the app's identity string."""
    if isinstance(value, _Missing):
        return "undefined"
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, float):
        if math.isnan(value):
            return "NaN"
        if math.isinf(value):
            return "Infinity" if value > 0 else "-Infinity"
        if value.is_integer():
            return str(int(value))
    return str(value)


def _js_max(left: Number, right: Number) -> Number:
    """`Math.max`, which is NaN when either side is."""
    if math.isnan(left) or math.isnan(right):
        return math.nan
    return max(left, right)


@lru_cache(maxsize=4096)
def _cores_in_range_text(range_set: str) -> Tuple[Tuple[int, int], ...]:
    cores: Dict[Tuple[int, int], None] = {}
    for rect in _CORE_RANGE_RECT_RE.finditer(range_set):
        corners: List[Tuple[int, int]] = []
        for match in _CORE_COORD_RE.finditer(rect.group(1)):
            if match.group(1) is not None:
                corners.append((int(match.group(1)), int(match.group(2))))
            else:
                corners.append((int(match.group(3)), int(match.group(4))))
            if len(corners) == 2:
                break
        if len(corners) != 2:
            continue
        (ax, ay), (bx, by) = corners
        for x in range(min(ax, bx), max(ax, bx) + 1):
            for y in range(min(ay, by), max(ay, by) + 1):
                cores.setdefault((x, y), None)
    return tuple(cores)


def cores_in_range(range_set: object) -> Tuple[Tuple[int, int], ...]:
    """`getCoresInRangeList`: the distinct (x, y) cores a `core_range_set` covers.

    Reads `{[(x=0,y=0) - (x=7,y=7)]}` and `{[0-0 - 7-7]}`, unions of rectangles, and
    `{}`. Not a string is no cores; the app would throw, and no capture emits one.
    """
    if not isinstance(range_set, str):
        return ()
    return _cores_in_range_text(range_set)


def _normalised_device_id(device_id: object) -> Optional[float]:
    """`normaliseDeviceId`: a finite `Number(device_id)`, else None."""
    if isinstance(device_id, _Missing) or device_id is None or device_id == "":
        return None
    number = js_number(device_id)
    return number if math.isfinite(number) else None


def _device_key(device_id: object) -> str:
    """`cbDeviceKey`."""
    normalised = _normalised_device_id(device_id)
    return SINGLE_DEVICE_KEY if normalised is None else _js_template(normalised)


def _slot_keys() -> Callable[[str, str], str]:
    """`createCbSlotKeys`: a same-device repeat gets its own slot, not a fold."""
    repeats: Dict[str, int] = {}

    def slot(identity: str, device_key: str) -> str:
        repeat_key = f"{identity}|{device_key}"
        repeat = repeats.get(repeat_key, 0) + 1
        repeats[repeat_key] = repeat
        return f"{identity}|{repeat}"

    return slot


def _is_globally_allocated(value: object) -> bool:
    # `rawGlobalFlag === '1' || rawGlobalFlag === 1`; a boolean is neither.
    if isinstance(value, bool):
        return False
    return value == "1" or (isinstance(value, (int, float)) and value == 1)


def _node_id(node: Dict) -> object:
    """`id`, else the `counter` an older capture carries instead, else undefined."""
    if "id" in node:
        return node["id"]
    return node.get("counter", _MISSING)


def _defined(value: object) -> object:
    return None if isinstance(value, _Missing) else value


@dataclass
class CircularBufferRow:
    """`CBAllocationSummary`, without the expanded `cores`."""

    node_id: object
    address: Number
    # Per core.
    size: Number
    core_count: int
    core_range_set: object
    allocate_operation_id: object
    allocate_operation_name: object
    globally_allocated: bool
    device_count: int
    # Not in the app's summary: the devices `device_count` counts, for `fold_devices`.
    device_keys: FrozenSet[str] = frozenset()


@dataclass
class Snapshot:
    """`CBPressureSnapshot`, keyed by the `function_start` id it was taken for."""

    operation_id: object
    # The scope's name, which the app reads from its stack rather than the snapshot.
    name: object
    by_core: Dict[str, Number]
    max_bytes: Number
    unattributed_bytes: Number
    allocations: List[CircularBufferRow]


@dataclass
class Summary:
    # In the order `cbPressureByOpId` holds them: first set, last value.
    snapshots: List[Snapshot] = field(default_factory=list)
    # The innermost `function_start` of every allocation, which is the snapshot the
    # app reads beside its rows.
    allocating_operation_ids: Set[object] = field(default_factory=set)


@dataclass
class _Scope:
    id: object
    name: object


@dataclass
class _Live:
    row: CircularBufferRow
    device_keys: Set[str]


def summarise(nodes: Sequence[object]) -> Summary:
    """The circular-buffer snapshots `processMemoryAllocations` builds, as `cbPressureByOpId`.

    Every snapshot is kept, including the copies each enclosing scope takes of the same
    live buffers at its `function_end`; `select_read` keeps the ones the app shows.
    """
    snapshots: Dict[object, Snapshot] = {}
    allocating: Set[object] = set()
    scopes: List[_Scope] = []
    bytes_by_device_core: Dict[str, Number] = {}
    unattributed_by_device: Dict[str, Number] = {}
    live: List[_Live] = []
    live_by_slot: Dict[str, _Live] = {}
    slot_of = _slot_keys()

    def snapshot(scope: _Scope) -> None:
        if not live and not bytes_by_device_core and not unattributed_by_device:
            return
        by_core: Dict[str, Number] = {}
        max_bytes: Number = 0
        for key, size in bytes_by_device_core.items():
            core = key[key.index("|") + 1 :]
            per_core = _js_max(by_core.get(core, 0), size)
            by_core[core] = per_core
            if per_core > max_bytes:
                max_bytes = per_core
        unattributed: Number = 0
        for size in unattributed_by_device.values():
            unattributed = _js_max(unattributed, size)
        if unattributed_by_device:
            by_core[UNATTRIBUTED_CORE] = unattributed
        # Copied, because a later device still bumps a live row's count.
        snapshots[scope.id] = Snapshot(
            scope.id,
            _defined(scope.name),
            by_core,
            max_bytes,
            unattributed,
            [
                replace(entry.row, device_keys=frozenset(entry.device_keys))
                for entry in live
            ],
        )

    # The app's loop starts past the first node, which a capture makes `capture_start`.
    for node in nodes[1:]:
        if not isinstance(node, dict):
            continue
        node_type = node.get("node_type")
        raw_params = node.get("params")
        params: Dict = raw_params if isinstance(raw_params, dict) else {}

        if node_type == _FUNCTION_START:
            scopes.append(_Scope(_node_id(node), params.get("name", _MISSING)))
        current = scopes[-1] if scopes else None

        if node_type == _ALLOCATE and isinstance(raw_params, dict):
            if current is not None:
                allocating.add(current.id)
            size = _parse_int(params.get("size", _MISSING))
            range_set = params.get("core_range_set", _MISSING)
            cores = cores_in_range(range_set)
            globally_allocated = _is_globally_allocated(
                params.get("globally_allocated")
            )
            device_key = _device_key(params.get("device_id", _MISSING))
            if not globally_allocated:
                if not cores:
                    unattributed_by_device[device_key] = (
                        unattributed_by_device.get(device_key, 0) + size
                    )
                else:
                    for x, y in cores:
                        key = f"{device_key}|{x},{y}"
                        bytes_by_device_core[key] = (
                            bytes_by_device_core.get(key, 0) + size
                        )

            address = _parse_int(params.get("address", _MISSING))
            identity = "|".join(
                _js_template(part)
                for part in (
                    current.id if current is not None else _MISSING,
                    address,
                    size,
                    range_set,
                    globally_allocated,
                )
            )
            slot = slot_of(identity, device_key)
            existing = live_by_slot.get(slot)
            if existing is not None:
                existing.device_keys.add(device_key)
                existing.row.device_count = len(existing.device_keys)
            else:
                entry = _Live(
                    CircularBufferRow(
                        node_id=_defined(_node_id(node)),
                        address=address,
                        size=size,
                        core_count=len(cores),
                        core_range_set=_defined(range_set),
                        allocate_operation_id=(
                            _defined(current.id) if current is not None else None
                        ),
                        allocate_operation_name=(
                            _defined(current.name) if current is not None else None
                        ),
                        globally_allocated=globally_allocated,
                        device_count=1,
                    ),
                    {device_key},
                )
                live.append(entry)
                live_by_slot[slot] = entry

        if node_type == _DEALLOCATE_ALL:
            # The innermost open scope's, when it allocated one: a capture frees before
            # it allocates, so otherwise these are the previous scope's, which its
            # `function_end` already snapshotted.
            if current is not None and any(
                entry.row.allocate_operation_id == _defined(current.id)
                for entry in live
            ):
                snapshot(current)
            bytes_by_device_core.clear()
            unattributed_by_device.clear()
            live = []
            live_by_slot = {}
            slot_of = _slot_keys()

        if node_type == _FUNCTION_END:
            # A scope that ends with buffers still live is attributed them, unless a
            # `circular_buffer_deallocate_all` already snapshotted it.
            if current is not None and live and current.id not in snapshots:
                snapshot(current)
            if scopes:
                scopes.pop()

    return Summary(list(snapshots.values()), allocating)


def select_read(summary: Summary) -> List[Snapshot]:
    """The snapshots the app shows: those of a scope that allocated circular buffers.

    The app reads `cbPressureByOpId` only at a circular buffer's row, for its innermost
    `function_start` (`DeviceOperationsFullRender.tsx`). An enclosing scope's snapshot
    repeats its child's buffers and is never read; across 49 local captures those are
    three in four. Held by `test_agent_circular_buffers.py`, not the shared golden: the
    app's lookup is inline in a component, not a function the golden can replay.
    """
    return [
        snapshot
        for snapshot in summary.snapshots
        if snapshot.operation_id in summary.allocating_operation_ids
    ]


def _devices(snapshot: Snapshot) -> FrozenSet[str]:
    return frozenset().union(*(row.device_keys for row in snapshot.allocations))


def _row_key(row: CircularBufferRow) -> Tuple[str, ...]:
    # Rendered, so rows of mixed types still sort.
    return tuple(
        _js_template(part)
        for part in (
            row.address,
            row.size,
            row.core_range_set,
            row.globally_allocated,
        )
    )


def _signature(snapshot: Snapshot) -> Tuple[object, ...]:
    # Sorted: devices can allocate the same buffers in a different order.
    return (snapshot.name, tuple(sorted(map(_row_key, snapshot.allocations))))


def fold_devices(snapshots: Sequence[Snapshot]) -> List[Snapshot]:
    """One entry for a device operation each device of a mesh ran with the same buffers.

    The app folds a mesh's copies of a buffer only within one scope. Most mesh captures
    give each device a scope of its own -- 12 of the 13 local ones, all but the newest
    -- so the app lists the same device operation once per device, and a count over
    its sections multiplies by the device count. This folds those sections as the app
    folds rows: same name and same buffers, in any order, on devices none of them
    shares. Not in the app, so not in the shared golden. A
    repeat on a device already in the entry is a real second launch and stays its own
    entry, as one-device captures repeat a program inside one operation.
    """
    folded: List[Snapshot] = []
    latest: Dict[Tuple[object, ...], Snapshot] = {}
    for snapshot in snapshots:
        key = _signature(snapshot)
        entry = latest.get(key)
        if entry is not None and not _devices(entry) & _devices(snapshot):
            # Paired by key, in the entry's order; equal signatures make it one-to-one.
            others = sorted(snapshot.allocations, key=_row_key)
            merged = list(entry.allocations)
            order = sorted(
                range(len(merged)), key=lambda index: _row_key(merged[index])
            )
            for index, other in zip(order, others):
                devices = merged[index].device_keys | other.device_keys
                merged[index] = replace(
                    merged[index], device_keys=devices, device_count=len(devices)
                )
            entry.allocations = merged
            continue
        entry = replace(snapshot, allocations=list(snapshot.allocations))
        folded.append(entry)
        latest[key] = entry
    return folded


def _figure(value: Number) -> Optional[Number]:
    # JSON holds no NaN; a size no capture writes reads as unknown.
    return value if math.isfinite(value) else None


def response(snapshots: Sequence[Snapshot]) -> Dict[str, object]:
    """`operation_detail`'s `circular_buffers`, with at most `MAX_LIMIT` rows listed."""
    remaining = MAX_LIMIT
    device_operations: List[Dict[str, object]] = []
    for snapshot in snapshots:
        if remaining <= 0:
            break
        rows = snapshot.allocations[:remaining]
        remaining -= len(rows)
        device_operations.append(
            {
                "name": snapshot.name,
                "device_count": len(_devices(snapshot)),
                "circular_buffer_count": len(snapshot.allocations),
                "max_bytes_per_core": _figure(snapshot.max_bytes),
                "unattributed_bytes": _figure(snapshot.unattributed_bytes),
                "circular_buffers": [
                    {
                        "address": _figure(row.address),
                        "size_per_core": _figure(row.size),
                        "core_range_set": row.core_range_set,
                        "core_count": row.core_count,
                        "device_count": row.device_count,
                        "globally_allocated": row.globally_allocated,
                    }
                    for row in rows
                ],
            }
        )
    rows_total = sum(len(snapshot.allocations) for snapshot in snapshots)
    result: Dict[str, object] = {
        "circular_buffer_count": rows_total,
        "globally_allocated_count": sum(
            row.globally_allocated
            for snapshot in snapshots
            for row in snapshot.allocations
        ),
        "device_operation_count": len(snapshots),
        "device_operations": device_operations,
        "size_unit": SIZE_UNIT,
        "note": CIRCULAR_BUFFERS_NOTE,
    }
    if rows_total > MAX_LIMIT:
        result["truncated"] = True
    return result


def operation_circular_buffers(nodes: Sequence[object]) -> Dict[str, object]:
    """The circular buffers an operation's captured graph allocated, as the app shows
    them but with a mesh's per-device sections folded."""
    return response(fold_devices(select_read(summarise(nodes))))


__all__ = [
    "CIRCULAR_BUFFERS_NOTE",
    "SINGLE_DEVICE_KEY",
    "SIZE_UNIT",
    "CircularBufferRow",
    "Snapshot",
    "Summary",
    "cores_in_range",
    "fold_devices",
    "operation_circular_buffers",
    "response",
    "select_read",
    "summarise",
]
