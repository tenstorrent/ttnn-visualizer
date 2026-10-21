# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Why an allocation failed, read out of the error tt-metal recorded for it. #2154

A port of `src/functions/parseAllocationFailure.ts`; mirror a change there.
"""

import re
from enum import Enum
from typing import Dict, Optional

from ttnn_visualizer.models import BufferType


class AllocationFailureKind(str, Enum):
    # `tt_metal/impl/allocator/bank_manager.cpp`
    BANK_OUT_OF_MEMORY = "bank_out_of_memory"
    BANK_OUT_OF_MEMORY_WITH_DEPENDENCIES = "bank_out_of_memory_with_dependencies"
    # `tt_metal/impl/program/program.cpp`
    CIRCULAR_BUFFERS_BEYOND_L1 = "circular_buffers_beyond_l1"
    CIRCULAR_BUFFERS_CLASH = "circular_buffers_clash"


class AllocationFailureReason(str, Enum):
    NOT_ENOUGH_FREE_SPACE = "not_enough_free_space"
    FRAGMENTED = "fragmented"
    FREE_BLOCK_COULD_HOLD_IT = "free_block_could_hold_it"
    LARGER_THAN_EMPTY_BANK = "larger_than_empty_bank"
    BEYOND_END_OF_L1 = "beyond_end_of_l1"
    OVERLAPS_L1_BUFFER = "overlaps_l1_buffer"


BANK_KINDS = frozenset(
    {
        AllocationFailureKind.BANK_OUT_OF_MEMORY,
        AllocationFailureKind.BANK_OUT_OF_MEMORY_WITH_DEPENDENCIES,
    }
)

# Each restates a tt-metal format string, unanchored: the stored message wraps it in a
# `TT_FATAL` header and a trailing backtrace.
_BANK_OUT_OF_MEMORY = re.compile(
    r"Out of Memory: Not enough space to allocate (\d+) B (\w+) buffer across (\d+) "
    r"banks, where each bank needs to store (\d+) B, but bank size is (?:only )?(\d+) B"
    r"(?: \(allocated: (\d+) B, free: (\d+) B, largest free block: (\d+) B\))?"
)
_BANK_OUT_OF_MEMORY_WITH_DEPENDENCIES = re.compile(
    r"Out of Memory: Not enough space after considering dependencies to allocate (\d+) "
    r"B (\w+) across (\d+) banks \((\d+) B per bank\), bank size is (\d+) B "
    r"\(allocated: (\d+) B, free: (\d+) B, largest free block: (\d+) B\)"
    r"(?:\. After subtracting \d+ dependency range\(s\) and \d+ additional occupied "
    r"range\(s\), (\d+) B remained placeable across \d+ window\(s\), largest (\d+) B)?"
)
_CIRCULAR_BUFFERS_BEYOND_L1 = re.compile(
    r"Statically allocated circular buffers on core range (.+?) grow to (\d+) B which "
    r"is beyond max L1 size of (\d+) B"
)
_CIRCULAR_BUFFERS_CLASH = re.compile(
    r"Statically allocated circular buffers in program \d+ clash with L1 buffers on "
    r"core range (.+?)\. L1 buffer allocated at (\d+) and static circular buffer "
    r"region ends at (\d+)"
)

_L1_BUFFER_TYPES = frozenset({BufferType.L1.name, BufferType.L1_SMALL.name})


def _count(value: Optional[str]) -> Optional[int]:
    return None if value is None else int(value)


def _buffer_type(name: str) -> Optional[str]:
    """The buffer type tt-metal named, or None for one this app does not know."""
    return name if name in BufferType.__members__ else None


def parse_allocation_failure(message: object) -> Optional[Dict[str, object]]:
    """The allocation failure an error message records, or None for any other error."""
    if not isinstance(message, str):
        return None

    for kind, pattern in (
        (AllocationFailureKind.BANK_OUT_OF_MEMORY, _BANK_OUT_OF_MEMORY),
        (
            AllocationFailureKind.BANK_OUT_OF_MEMORY_WITH_DEPENDENCIES,
            _BANK_OUT_OF_MEMORY_WITH_DEPENDENCIES,
        ),
    ):
        match = pattern.search(message)
        if match is None:
            continue
        groups = match.groups()
        size, buffer_type, num_banks, per_bank, bank_size = groups[:5]
        allocated, free, largest_free = groups[5:8]
        placeable, largest_placeable = groups[8:] if len(groups) > 8 else (None, None)
        return {
            "kind": kind.value,
            "buffer_type": _buffer_type(buffer_type),
            "requested_bytes": int(size),
            "num_banks": int(num_banks),
            "bytes_per_bank": int(per_bank),
            "bank_size_bytes": int(bank_size),
            # Older tt-metal stops at the bank size, without the allocator statistics.
            "allocated_bytes": _count(allocated),
            "free_bytes": _count(free),
            "largest_free_block_bytes": _count(largest_free),
            # What is left of the free blocks large enough once other allocators' ranges
            # are taken out, so not free space; only the dependency-aware check reports it.
            "placeable_bytes": _count(placeable),
            "largest_placeable_bytes": _count(largest_placeable),
        }

    match = _CIRCULAR_BUFFERS_BEYOND_L1.search(message)
    if match is not None:
        core_range, region_end, max_l1 = match.groups()
        return {
            "kind": AllocationFailureKind.CIRCULAR_BUFFERS_BEYOND_L1.value,
            "core_range": core_range,
            "circular_buffer_region_end": int(region_end),
            "max_l1_bytes": int(max_l1),
        }

    match = _CIRCULAR_BUFFERS_CLASH.search(message)
    if match is not None:
        core_range, l1_address, region_end = match.groups()
        return {
            "kind": AllocationFailureKind.CIRCULAR_BUFFERS_CLASH.value,
            "core_range": core_range,
            "l1_buffer_address": int(l1_address),
            "circular_buffer_region_end": int(region_end),
        }

    return None


def _bytes(count: int) -> str:
    return f"{count:,} B"


# tt-metal clamps only interleaved L1 to an address limit, but counts free space past it;
# the message does not say whether the buffer was sharded.
_INTERLEAVED_L1_CAVEAT = (
    "An interleaved L1 buffer can use only the part of that free space inside the "
    "interleaved region"
)
_INTERLEAVED_L1_BLOCK_CAVEAT = (
    "An interleaved L1 buffer is also limited to the interleaved region."
)


def _diagnosis(reason: AllocationFailureReason, detail: str) -> Dict[str, str]:
    return {"reason": reason.value, "detail": detail}


def _bank_diagnosis(failure: Dict) -> Optional[Dict[str, str]]:
    per_bank = failure["bytes_per_bank"]
    free = failure["free_bytes"]
    largest = failure["largest_free_block_bytes"]
    needed = _bytes(per_bank)
    is_l1 = failure["buffer_type"] == BufferType.L1.name

    # Ahead of the free figures: no amount of freeing makes room for this.
    if per_bank > failure["bank_size_bytes"]:
        return _diagnosis(
            AllocationFailureReason.LARGER_THAN_EMPTY_BANK,
            f"Needs {needed} per bank, more than an empty bank holds "
            f"({_bytes(failure['bank_size_bytes'])}): it cannot fit in this buffer type "
            f"spread across {failure['num_banks']} banks.",
        )

    if free is None or largest is None:
        return None

    if largest >= per_bank:
        fits = f"The largest free block, {_bytes(largest)}, could hold the {needed} per bank"
        if (
            failure["kind"]
            != AllocationFailureKind.BANK_OUT_OF_MEMORY_WITH_DEPENDENCIES
        ):
            # The plain error fires only when no free block is large enough, so the
            # request rounded up to the minimum allocation size outgrew this one.
            return _diagnosis(
                AllocationFailureReason.FREE_BLOCK_COULD_HOLD_IT,
                f"{fits}, but the allocator could not use it; the message does not say why.",
            )
        reserved = (
            f"{fits}, but space reserved by other allocators overlaps it."
            if failure["largest_placeable_bytes"] is None
            else f"{fits}, but other allocators' reservations leave a placeable window "
            f"of at most {_bytes(failure['largest_placeable_bytes'])}."
        )
        return _diagnosis(
            AllocationFailureReason.FREE_BLOCK_COULD_HOLD_IT,
            f"{reserved} {_INTERLEAVED_L1_BLOCK_CAVEAT}" if is_l1 else reserved,
        )

    if free >= per_bank:
        fragmented = (
            f"{_bytes(free)} free per bank, but no single block holds {needed}; the "
            f"largest is {_bytes(largest)}."
        )
        return _diagnosis(
            AllocationFailureReason.FRAGMENTED,
            f"{fragmented} {_INTERLEAVED_L1_CAVEAT}." if is_l1 else fragmented,
        )

    shortfall = (
        f"Short by {_bytes(per_bank - free)} per bank: needs {needed}, "
        f"{_bytes(free)} free."
    )
    return _diagnosis(
        AllocationFailureReason.NOT_ENOUGH_FREE_SPACE,
        (
            f"{shortfall} {_INTERLEAVED_L1_CAVEAT}, so it may be short by more."
            if is_l1
            else shortfall
        ),
    )


def diagnose(failure: Dict) -> Optional[Dict[str, str]]:
    """Why the allocation did not fit, from its figures; None when they cannot say."""
    kind = failure["kind"]
    if kind in BANK_KINDS:
        return _bank_diagnosis(failure)
    if kind == AllocationFailureKind.CIRCULAR_BUFFERS_BEYOND_L1:
        return _diagnosis(
            AllocationFailureReason.BEYOND_END_OF_L1,
            f"The circular buffers run "
            f"{_bytes(failure['circular_buffer_region_end'] - failure['max_l1_bytes'])} "
            "past the end of L1.",
        )
    return _diagnosis(
        AllocationFailureReason.OVERLAPS_L1_BUFFER,
        f"The circular buffers overlap the L1 buffer at address "
        f"{failure['l1_buffer_address']} by "
        f"{_bytes(failure['circular_buffer_region_end'] - failure['l1_buffer_address'])}.",
    )


def is_l1_buffer_type(name: Optional[str]) -> bool:
    return name in _L1_BUFFER_TYPES


__all__ = [
    "BANK_KINDS",
    "AllocationFailureKind",
    "AllocationFailureReason",
    "diagnose",
    "is_l1_buffer_type",
    "parse_allocation_failure",
]
