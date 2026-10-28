# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Likely L1-to-DRAM fallbacks, inferred: tt-metal records none of them. #2154

A port of `src/functions/getDramFallbacks.ts` and the constants in
`src/definitions/DramFallback.ts`; mirror a change there.
"""

import re
from dataclasses import dataclass, field
from enum import Enum
from math import prod
from typing import Dict, List, Optional, Sequence, Tuple

from ttnn_visualizer.agent.allocation_failures import (
    BANK_KINDS,
    is_l1_buffer_type,
)
from ttnn_visualizer.agent.js_values import JS_WHITESPACE, js_number, js_trim
from ttnn_visualizer.models import L1_BUFFER_TYPES, BufferType, Tensor
from ttnn_visualizer.utils import (
    MEMORY_CONFIG_PATTERN,
    parse_memory_config_buffer_type,
)


class DramFallbackSignal(str, Enum):
    ARGUMENT_MISMATCH = "argument_mismatch"
    RETRY_AFTER_FAILURE = "retry_after_failure"


# A script's retry is usually the next call, but a conversion op can sit between the
# two. A judgement, not a measurement: no report to hand contains a retry.
RETRY_WINDOW_OPERATIONS = 3

# An L1 intermediate says nothing about where the output goes.
_IGNORED_ARGUMENT = re.compile(r"intermediate")
# `\Z`, ASCII digits and JavaScript's whitespace, as JavaScript reads `$`, `\d` and `\s`.
_SHAPE = re.compile(
    r"^(?:Shape|torch\.Size)\(\[([0-9," + re.escape(JS_WHITESPACE) + r"]*)\]\)\Z"
)


@dataclass
class FallbackOperation:
    """One operation as `/api/operations` serves it, in the fields a fallback reads."""

    id: int
    name: str
    arguments: List[Tuple[str, Optional[str]]] = field(default_factory=list)
    inputs: List[Tensor] = field(default_factory=list)
    outputs: List[Tensor] = field(default_factory=list)


def _addresses(tensor: Tensor) -> Dict[Optional[int], int]:
    """Where the tensor sits on each device; the scalar address fills its own device."""
    by_device: Dict[Optional[int], int] = {
        device: address
        for device, address in enumerate(tensor.device_addresses or [])
        if address is not None
    }
    if tensor.address is not None and tensor.device_id not in by_device:
        by_device[tensor.device_id] = tensor.address
    return by_device


def _element_count(shape: object) -> Optional[float]:
    """The element count, None when the shape can't be read, NaN where JavaScript's is."""
    match = _SHAPE.match(shape) if isinstance(shape, str) else None
    if match is None:
        return None
    # `Number("1 2")` is NaN, and a NaN count differs from every other.
    return prod(
        js_number(part) for part in match.group(1).split(",") if js_trim(part) != ""
    )


def _may_alias(output: Tensor, source: Tensor) -> bool:
    """Whether the output may be a view of the input: same size, same address everywhere."""
    output_count = _element_count(output.shape)
    source_count = _element_count(source.shape)
    if (
        output_count is not None
        and source_count is not None
        and output_count != source_count
    ):
        return False
    output_addresses = _addresses(output)
    source_addresses = _addresses(source)
    if not output_addresses or not source_addresses:
        return True
    shared = [device for device in output_addresses if device in source_addresses]
    return bool(shared) and all(
        output_addresses[device] == source_addresses[device] for device in shared
    )


def _fallback_outputs(operation: FallbackOperation) -> Optional[Dict[str, int]]:
    """The DRAM outputs the op allocated itself, unless it kept one in L1."""
    if any(output.buffer_type in L1_BUFFER_TYPES for output in operation.outputs):
        return None
    dram_inputs = [
        source for source in operation.inputs if source.buffer_type is BufferType.DRAM
    ]
    dram_outputs = [
        output
        for output in operation.outputs
        if output.buffer_type is BufferType.DRAM
        and not any(_may_alias(output, source) for source in dram_inputs)
    ]
    if not dram_outputs:
        return None
    return {
        "operation_id": operation.id,
        "dram_output_count": len(dram_outputs),
        "output_count": len(operation.outputs),
    }


def _requested_buffer_types(operation: FallbackOperation) -> List[Optional[BufferType]]:
    """The buffer type each memory config argument declares, None where unknown."""
    requested: List[Optional[BufferType]] = []
    for name, value in operation.arguments:
        # A whole `MemoryConfig(...)` only: a tensor repr ending in one is no request.
        if (
            _IGNORED_ARGUMENT.search(name)
            or not isinstance(value, str)
            or MEMORY_CONFIG_PATTERN.match(value) is None
        ):
            continue
        declared = parse_memory_config_buffer_type(value)
        requested.append(BufferType.__members__.get(declared) if declared else None)
    return requested


def _l1_request(operation: FallbackOperation) -> Optional[BufferType]:
    """The L1 type the op's memory configs ask for, unless any asks for something else."""
    requested = _requested_buffer_types(operation)
    if requested and all(entry in L1_BUFFER_TYPES for entry in requested):
        return requested[0]
    return None


def _is_l1_output_failure(failure: Dict, failed: FallbackOperation) -> bool:
    """Whether the failure shows the op tried to put its output in L1."""
    if failure["kind"] in BANK_KINDS:
        return is_l1_buffer_type(
            failure.get("buffer_type")
        ) and BufferType.DRAM not in _requested_buffer_types(failed)
    # A circular-buffer failure concerns the program's buffers, so only the op's own
    # L1 request ties it to the output.
    return _l1_request(failed) is not None


def _argument_mismatch(operation: FallbackOperation) -> Optional[Dict[str, object]]:
    outputs = _fallback_outputs(operation)
    requested = _l1_request(operation) if outputs else None
    if outputs is None or requested is None:
        return None
    return {
        **outputs,
        "signal": DramFallbackSignal.ARGUMENT_MISMATCH.value,
        "requested_buffer_type": requested.name,
    }


def _retries_after_failure(
    operations: Sequence[FallbackOperation], failure_by_operation_id: Dict[int, Dict]
) -> Dict[int, Dict[str, object]]:
    """Retries of ops that failed to allocate L1, keyed by the retry's operation id."""
    retries: Dict[int, Dict[str, object]] = {}
    if not failure_by_operation_id:
        return retries
    for index, failed in enumerate(operations):
        failure = failure_by_operation_id.get(failed.id)
        if failure is None or not _is_l1_output_failure(failure, failed):
            continue
        window = operations[index + 1 : index + 1 + RETRY_WINDOW_OPERATIONS]
        # Only the first same-named op counts: if it stayed in L1, the retry worked.
        retry = next((entry for entry in window if entry.name == failed.name), None)
        outputs = _fallback_outputs(retry) if retry is not None else None
        if outputs is not None:
            # A later failure overwrites, crediting a retry to the nearest failure.
            retries[outputs["operation_id"]] = {
                **outputs,
                "signal": DramFallbackSignal.RETRY_AFTER_FAILURE.value,
                "failed_operation_id": failed.id,
                "failed_operation_name": failed.name,
            }
    return retries


def dram_fallbacks(
    operations: Sequence[FallbackOperation], failure_by_operation_id: Dict[int, Dict]
) -> Dict[int, Dict[str, object]]:
    """Likely fallbacks by operation id; operations must be in id order.

    A recorded failure followed by DRAM outranks a bare argument mismatch on the same op.
    """
    retries = _retries_after_failure(operations, failure_by_operation_id)
    fallbacks: Dict[int, Dict[str, object]] = {}
    for operation in operations:
        fallback = retries.get(operation.id) or _argument_mismatch(operation)
        if fallback is not None:
            fallbacks[operation.id] = fallback
    return fallbacks


__all__ = [
    "RETRY_WINDOW_OPERATIONS",
    "DramFallbackSignal",
    "FallbackOperation",
    "dram_fallbacks",
]
