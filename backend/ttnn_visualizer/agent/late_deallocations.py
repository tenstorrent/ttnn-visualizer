# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Tensors held past their last use, as Buffer Summary's late-deallocation overlay. #2156

A port of `src/functions/lateDeallocation.ts`, with `getUniqueBuffersByOperation` and
`buildTensorsByOperationByAddress`; mirror a change there. `holds` is this module's own:
the app's run starts, each followed to where it ends.
"""

from dataclasses import dataclass
from enum import Enum
from itertools import groupby
from operator import itemgetter
from typing import (
    Dict,
    Iterable,
    Iterator,
    List,
    Mapping,
    NamedTuple,
    Optional,
    Sequence,
    Set,
    Tuple,
)

from ttnn_visualizer.agent.cells import whole_number
from ttnn_visualizer.models import Tensor

NO_CONSUMER_OPERATION_ID = -1
# `DEALLOCATE_OP_NAME_LIST` in `src/definitions/Deallocate.ts`.
DEALLOCATE_OPERATION_NAMES = frozenset({"ttnn.deallocate", "ttnn::deallocate"})


@dataclass(frozen=True, slots=True)
class HeldTensor:
    """`TensorDeallocationReport`: allocated at an operation after its last use."""

    tensor_id: int
    address: int
    bytes_per_bank: int
    last_use_operation_id: int


class Ending(str, Enum):
    DEALLOCATED = "deallocated"
    # Left the snapshot, or its address went to another tensor, with no deallocate call.
    FREED_OTHERWISE = "freed_otherwise"
    HELD_TO_END = "held_to_end"


@dataclass
class Hold:
    """One tensor at one address, held over consecutive operations past its last use."""

    tensor_id: int
    address: int
    last_use_operation_id: int
    first_operation_id: int
    last_operation_id: int
    operations_held: int = 0
    bytes_per_bank: int = 0
    byte_operations: int = 0
    ending: Ending = Ending.HELD_TO_END
    deallocated_at: Optional[int] = None
    # Whether it carried on past an operation that recorded none of these buffers.
    bridged: bool = False


class HeldTensors(NamedTuple):
    held_by_operation: Dict[int, List[HeldTensor]]
    buffered_operation_ids: Set[int]


def is_deallocate(name: object) -> bool:
    """Whether an operation of this name is a deallocate call; NULL reads as `?? ''`."""
    return isinstance(name, str) and name.lower() in DEALLOCATE_OPERATION_NAMES


def last_valid_consumer(
    consumers: Iterable[int], operation_names_by_id: Mapping[int, str]
) -> int:
    """`getLastValidConsumer`: the latest consumer that isn't a deallocate call."""
    last = NO_CONSUMER_OPERATION_ID
    for consumer in consumers:
        if consumer <= last:
            continue
        if is_deallocate(operation_names_by_id.get(consumer)):
            continue
        last = consumer
    return last


def buffer_sizes_by_operation(
    operation_ids: Sequence[int], buffers: Iterable[Tuple[object, int, object]]
) -> Iterator[Dict[int, int]]:
    """`getUniqueBuffersByOperation`: each operation's largest buffer per address, in
    `operation_ids` order, from (operation id, address, size per bank) rows in
    operation order. One operation's rows are held at a time."""
    # Coerced per operation, not per row: the key runs 3.2M times on one capture.
    groups = (
        (key if isinstance(key, int) else whole_number(key), rows)
        for key, rows in groupby(buffers, key=itemgetter(0))
    )
    pending = next(groups, None)
    for operation_id in operation_ids:
        while pending is not None and (pending[0] is None or pending[0] < operation_id):
            pending = next(groups, None)
        sizes: Dict[int, int] = {}
        if pending is not None and pending[0] == operation_id:
            for _, address, raw_size in pending[1]:
                if not address:
                    continue
                size = (
                    raw_size if isinstance(raw_size, int) else whole_number(raw_size)
                ) or 0
                if address not in sizes or size > sizes[address]:
                    sizes[address] = size
            pending = next(groups, None)
        yield sizes


def late_deallocation_report(
    tensor_id: int,
    address: int,
    bytes_per_bank: int,
    operation_id: int,
    consumers: Optional[Sequence[int]],
    operation_names_by_id: Mapping[int, str],
    last_use_by_tensor_id: Dict[int, int],
) -> Optional[HeldTensor]:
    """`getLateDeallocationReport`; `last_use_by_tensor_id` is its consumer cache."""
    if not consumers:
        return None
    last_use = last_use_by_tensor_id.get(tensor_id)
    if last_use is None:
        last_use = last_valid_consumer(consumers, operation_names_by_id)
        last_use_by_tensor_id[tensor_id] = last_use
    if last_use <= NO_CONSUMER_OPERATION_ID or last_use >= operation_id:
        return None
    return HeldTensor(tensor_id, address, bytes_per_bank, last_use)


def held_tensors_by_operation(
    operation_ids: Sequence[int],
    inputs_by_operation_id: Mapping[int, Sequence[Tensor]],
    outputs_by_operation_id: Mapping[int, Sequence[Tensor]],
    sizes_by_operation: Iterable[Mapping[int, int]],
    consumers_by_tensor_id: Mapping[int, Sequence[int]],
    operation_names_by_id: Mapping[int, str],
) -> HeldTensors:
    """`buildLateDeallocationReports`' `reportsByOpId`, over
    `buildTensorsByOperationByAddress`, with the operations that recorded any of these
    buffers."""
    holder_by_address: Dict[int, Tensor] = {}
    last_use_by_tensor_id: Dict[int, int] = {}
    held_by_operation: Dict[int, List[HeldTensor]] = {}
    buffered: Set[int] = set()
    for operation_id, sizes in zip(operation_ids, sizes_by_operation):
        deallocated = (
            inputs_by_operation_id.get(operation_id, ())
            if is_deallocate(operation_names_by_id.get(operation_id))
            else ()
        )
        deallocated_ids = {tensor.tensor_id for tensor in deallocated}
        for side in (inputs_by_operation_id, outputs_by_operation_id):
            for tensor in side.get(operation_id, ()):
                if (
                    tensor.address is not None
                    and tensor.tensor_id not in deallocated_ids
                ):
                    holder_by_address[tensor.address] = tensor
        held: List[HeldTensor] = []
        for address, size in sizes.items():
            holder = holder_by_address.get(address)
            if holder is None:
                continue
            report = late_deallocation_report(
                holder.tensor_id,
                address,
                size,
                operation_id,
                consumers_by_tensor_id.get(holder.tensor_id),
                operation_names_by_id,
                last_use_by_tensor_id,
            )
            if report is not None:
                held.append(report)
        if held:
            held_by_operation[operation_id] = held
        if sizes:
            buffered.add(operation_id)
        _forget_gone_holders(holder_by_address, sizes, deallocated)
    return HeldTensors(held_by_operation, buffered)


def _forget_gone_holders(
    holder_by_address: Dict[int, Tensor],
    sizes: Mapping[int, int],
    deallocated: Sequence[Tensor],
) -> None:
    """`forgetGoneHolders`. A later buffer at a gone tensor's address is another
    tensor's: drop a holder whose buffer left a recorded snapshot, or that a deallocate
    call freed.

    `deallocated` is the call's inputs, while a hold's ending reads the deallocate calls
    among the tensor's consumers; both come from the `input_tensors` rows."""
    if sizes:
        for address in [
            address for address in holder_by_address if address not in sizes
        ]:
            del holder_by_address[address]
    for tensor in deallocated:
        if tensor.address is None:
            continue
        holder = holder_by_address.get(tensor.address)
        if holder is not None and holder.tensor_id == tensor.tensor_id:
            del holder_by_address[tensor.address]


def run_start_count(
    operation_ids: Sequence[int], held_by_operation: Mapping[int, Sequence[HeldTensor]]
) -> int:
    """`selectLateDeallocationRunStarts(...).length`, the count beside the L1 toggle."""
    count = 0
    previous: Set[Tuple[int, int]] = set()
    for operation_id in operation_ids:
        held = held_by_operation.get(operation_id)
        if not held:
            previous = set()
            continue
        keys = {(entry.tensor_id, entry.address) for entry in held}
        if keys - previous:
            count += 1
        previous = keys
    return count


def deallocations_by_tensor_id(
    consumers_by_tensor_id: Mapping[int, Sequence[int]],
    operation_names_by_id: Mapping[int, str],
) -> Dict[int, List[int]]:
    """The deallocate calls each tensor is an input of, in operation order."""
    deallocations: Dict[int, List[int]] = {}
    for tensor_id, consumers in consumers_by_tensor_id.items():
        calls = sorted(
            consumer
            for consumer in consumers
            if is_deallocate(operation_names_by_id.get(consumer))
        )
        if calls:
            deallocations[tensor_id] = calls
    return deallocations


def _end(hold: Hold, next_operation_id: Optional[int], calls: Sequence[int]) -> None:
    """How a hold ended before `next_operation_id`, or with the capture when None."""
    for call in calls:
        # A deallocate's own snapshot can still show the buffer it frees.
        if hold.last_operation_id <= call and (
            next_operation_id is None or call <= next_operation_id
        ):
            hold.ending, hold.deallocated_at = Ending.DEALLOCATED, call
            return
    if next_operation_id is not None:
        hold.ending = Ending.FREED_OTHERWISE


def holds(
    operation_ids: Sequence[int],
    held_by_operation: Mapping[int, Sequence[HeldTensor]],
    buffered_operation_ids: Set[int],
    deallocate_calls_by_tensor_id: Mapping[int, Sequence[int]],
) -> List[Hold]:
    """The app's runs followed to their end, carried across operations that recorded
    none of these buffers, where the app starts each one again."""
    open_holds: Dict[Tuple[int, int], Hold] = {}
    ended: List[Hold] = []
    skipped = False
    for operation_id in operation_ids:
        if operation_id not in buffered_operation_ids:
            skipped = skipped or bool(open_holds)
            continue
        current: Dict[Tuple[int, int], Hold] = {}
        for entry in held_by_operation.get(operation_id, ()):
            key = (entry.tensor_id, entry.address)
            hold = open_holds.pop(key, None)
            if hold is None:
                hold = Hold(
                    entry.tensor_id,
                    entry.address,
                    entry.last_use_operation_id,
                    first_operation_id=operation_id,
                    last_operation_id=operation_id,
                )
            elif skipped:
                hold.bridged = True
            hold.last_operation_id = operation_id
            hold.operations_held += 1
            hold.bytes_per_bank = max(hold.bytes_per_bank, entry.bytes_per_bank)
            hold.byte_operations += entry.bytes_per_bank
            current[key] = hold
        for hold in open_holds.values():
            _end(
                hold,
                operation_id,
                deallocate_calls_by_tensor_id.get(hold.tensor_id, ()),
            )
            ended.append(hold)
        open_holds = current
        skipped = False
    for hold in open_holds.values():
        _end(hold, None, deallocate_calls_by_tensor_id.get(hold.tensor_id, ()))
    return ended + list(open_holds.values())


__all__ = [
    "DEALLOCATE_OPERATION_NAMES",
    "NO_CONSUMER_OPERATION_ID",
    "Ending",
    "HeldTensor",
    "HeldTensors",
    "Hold",
    "buffer_sizes_by_operation",
    "deallocations_by_tensor_id",
    "held_tensors_by_operation",
    "holds",
    "is_deallocate",
    "last_valid_consumer",
    "late_deallocation_report",
    "run_start_count",
]
