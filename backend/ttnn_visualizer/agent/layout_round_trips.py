# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Chains of layout and memory moves that end where they started (#2174).

A tilize undone by an untilize, or an interleaved tensor sharded and unsharded again,
costs device time and leaves the tensor as it was. Finding one by hand means walking
`tensor_flow` a step at a time; this reads every move at once.

Pure code: the tool in `linking.py` reads the graph and the tensors, and this decides
which chains are round trips.
"""

from dataclasses import dataclass
from typing import AbstractSet, Dict, List, Mapping, Optional, Sequence, Set

# Operations that change only where or how a tensor is stored. Names are compared with
# their `ttnn.` or `ttnn::` prefix removed. `typecast` and `to_dtype` are left out: a
# change of dtype is often a deliberate precision choice rather than a layout one.
LAYOUT_MOVE_OPERATIONS = frozenset(
    {
        "to_layout",
        "tilize",
        "untilize",
        "tilize_with_val_padding",
        "untilize_with_unpadding",
        "to_memory_config",
        "interleaved_to_sharded",
        "sharded_to_interleaved",
        "reshard",
        "move",
    }
)

# Bounds the search through a fan of moves. Tilize, shard, reshard, unshard and
# untilize is five, the longest plausible chain that undoes itself.
MAX_ROUND_TRIP_MOVES = 6

_OPERATION_PREFIXES = ("ttnn.", "ttnn::")


def _bare_name(name: str) -> str:
    lowered = name.strip().lower()
    for prefix in _OPERATION_PREFIXES:
        if lowered.startswith(prefix):
            return lowered[len(prefix) :]
    return lowered


def is_layout_move(name: Optional[str]) -> bool:
    return name is not None and _bare_name(name) in LAYOUT_MOVE_OPERATIONS


def enum_suffix(value: Optional[str]) -> Optional[str]:
    """`Layout.TILE`, `Layout::TILE` and `TILE` alike read as `TILE`."""
    if not value:
        return None
    return value.rsplit("::", 1)[-1].rsplit(".", 1)[-1].strip().upper() or None


@dataclass(frozen=True)
class TensorState:
    """Where and how a tensor is stored. The shard spec is not part of it: the parser
    reads only the older `ShardSpec(...)` form, so a newer capture's would read as
    absent on both sides of a reshard."""

    layout: Optional[str]
    buffer_type: Optional[str]
    memory_layout: Optional[str]

    def as_response(self) -> Dict[str, Optional[str]]:
        return {
            "layout": self.layout,
            "buffer_type": self.buffer_type,
            "memory_layout": self.memory_layout,
        }


def tensor_state(
    layout: Optional[str], buffer_type: Optional[str], memory_config: object
) -> TensorState:
    """A tensor's state from its raw layout, its buffer type by name, and its memory
    config as `parse_memory_config` leaves it."""
    memory_layout = (
        memory_config.get("memory_layout") if isinstance(memory_config, dict) else None
    )
    return TensorState(
        layout=enum_suffix(layout),
        buffer_type=enum_suffix(buffer_type),
        memory_layout=enum_suffix(memory_layout),
    )


@dataclass(frozen=True)
class RoundTrip:
    # In the order they ran.
    operation_ids: List[int]
    # The tensor the first move read, then each move's output.
    tensor_ids: List[int]
    states: List[TensorState]


def move_operation_ids(
    names: Mapping[int, str],
    kept: AbstractSet[int],
    inputs_by_operation: Mapping[int, Sequence[int]],
    outputs_by_operation: Mapping[int, Sequence[int]],
) -> List[int]:
    """The kept operations that move one tensor into a new one, in id order.

    A move that hands back the tensor it was given changed nothing, so it is no step.
    """
    moves = []
    for operation_id in sorted(kept):
        inputs = inputs_by_operation.get(operation_id, ())
        outputs = outputs_by_operation.get(operation_id, ())
        if (
            is_layout_move(names.get(operation_id))
            and len(inputs) == 1
            and len(outputs) == 1
            and inputs[0] != outputs[0]
        ):
            moves.append(operation_id)
    return moves


def find_round_trips(
    moves: Sequence[int],
    inputs_by_operation: Mapping[int, Sequence[int]],
    outputs_by_operation: Mapping[int, Sequence[int]],
    state_by_tensor: Mapping[int, TensorState],
) -> List[RoundTrip]:
    """Every shortest chain of moves whose last output is stored as its first input was.

    Each move starts a search unless an earlier trip already holds it, so a long
    trip is not listed again from its second move. Within one search, a branch
    stops at the first state that matches the start: past it the chain is a round
    trip followed by something else.
    """
    moves_by_input: Dict[int, List[int]] = {}
    for operation_id in moves:
        moves_by_input.setdefault(inputs_by_operation[operation_id][0], []).append(
            operation_id
        )

    used: Set[int] = set()
    trips: List[RoundTrip] = []
    for start in moves:
        if start in used:
            continue
        start_tensor = inputs_by_operation[start][0]
        start_state = state_by_tensor.get(start_tensor)
        if start_state is None:
            continue
        found = _search(
            [start],
            [start_tensor],
            start_state,
            used,
            moves_by_input,
            outputs_by_operation,
            state_by_tensor,
        )
        for trip in found:
            used.update(trip.operation_ids)
        trips.extend(found)
    return trips


def _search(
    path: List[int],
    tensors: List[int],
    start_state: TensorState,
    used: AbstractSet[int],
    moves_by_input: Mapping[int, List[int]],
    outputs_by_operation: Mapping[int, Sequence[int]],
    state_by_tensor: Mapping[int, TensorState],
) -> List[RoundTrip]:
    # Recursive: the depth is bounded by `MAX_ROUND_TRIP_MOVES`.
    output = outputs_by_operation[path[-1]][0]
    state = state_by_tensor.get(output)
    if state is None:
        return []
    chain = tensors + [output]
    states = [state_by_tensor[tensor] for tensor in chain]
    if len(path) >= 2 and state == start_state:
        if any(middle != start_state for middle in states[1:-1]):
            return [RoundTrip(list(path), chain, states)]
    if len(path) >= MAX_ROUND_TRIP_MOVES:
        return []
    found: List[RoundTrip] = []
    for following in moves_by_input.get(output, ()):
        if following not in used and following not in path:
            found.extend(
                _search(
                    path + [following],
                    chain,
                    start_state,
                    used,
                    moves_by_input,
                    outputs_by_operation,
                    state_by_tensor,
                )
            )
    return found


__all__ = [
    "LAYOUT_MOVE_OPERATIONS",
    "MAX_ROUND_TRIP_MOVES",
    "RoundTrip",
    "TensorState",
    "enum_suffix",
    "find_round_trips",
    "is_layout_move",
    "move_operation_ids",
    "tensor_state",
]
