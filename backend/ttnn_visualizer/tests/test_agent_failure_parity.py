# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Parity between the agent's ports and the app's TypeScript they restate. #2154

The agent restates `parseAllocationFailure.ts`, `scopeOutcomes.ts`, `getDramFallbacks.ts`,
`resolveAddressLifetimes`, `l1PeakDecomposition.ts` and the circular-buffer half of
`processMemoryAllocations.ts` (#2185) in Python. This test feeds the ports
a seeded matrix of inputs and writes their answers to a golden file, and
`tests/agentFailureParity.spec.ts` asserts the app's functions give the same answers. A
change on either side then fails a test instead of drifting.

    pnpm run agent:parity-golden    <- regenerates tests/data/agentFailureParity.json
"""

import math
import random
from functools import partial
from types import SimpleNamespace
from typing import Callable, Dict, List, Optional, Tuple

import pytest
from ttnn_visualizer.agent import (
    allocation_failures,
    circular_buffers,
    dram_fallbacks,
    l1_peak,
)
from ttnn_visualizer.agent.scope_outcomes import failed_device_operation_names
from ttnn_visualizer.models import Buffer, BufferType
from ttnn_visualizer.tests.captured_graphs import CORE_RANGE_SET, CapturedGraph
from ttnn_visualizer.tests.parity_golden import Golden, round_trip

GOLDEN = Golden("agentFailureParity")
_SEED = 2154


def _camel(name: str) -> str:
    head, *rest = name.split("_")
    return head + "".join(part.title() for part in rest)


def _camel_keys(entry: Dict) -> Dict:
    return {_camel(key): value for key, value in entry.items()}


def _messages() -> List[str]:
    """Every allocation failure kind and figure branch, some wrapped as tt-metal stores them."""
    messages: List[str] = []
    for buffer_type in ("L1", "L1_SMALL", "DRAM", "UNKNOWN"):
        for per_bank, bank, figures in (
            (819200, 1382720, None),
            (2000000, 1382720, None),
            (2000000, 1382720, (1000, 1381720, 1381720)),
            (819200, 1382720, (1000000, 382720, 300000)),
            (819200, 1382720, (300000, 1082720, 300000)),
            (819200, 1382720, (563520, 819200, 300000)),
            (819200, 1382720, (300000, 1082720, 900000)),
            (819200, 1382720, (563520, 819200, 819200)),
        ):
            request = per_bank * 4
            plain = (
                f"Out of Memory: Not enough space to allocate {request} B {buffer_type} "
                f"buffer across 4 banks, where each bank needs to store {per_bank} B, but "
                "bank size is "
            )
            if figures is None:
                messages += [plain + f"only {bank} B", plain + f"{bank} B"]
                continue
            allocated, free, largest = figures
            stats = (
                f"(allocated: {allocated} B, free: {free} B, largest free block: "
                f"{largest} B)"
            )
            messages.append(plain + f"{bank} B {stats}")
            dependencies = (
                "Out of Memory: Not enough space after considering dependencies to "
                f"allocate {request} B {buffer_type} across 4 banks ({per_bank} B per "
                f"bank), bank size is {bank} B {stats}"
            )
            messages.append(dependencies)
            for placeable, largest_placeable in ((0, 0), (900000, 819200)):
                messages.append(
                    f"{dependencies}. After subtracting 1 dependency range(s) and 2 "
                    f"additional occupied range(s), {placeable} B remained placeable "
                    f"across 2 window(s), largest {largest_placeable} B"
                )
    messages += [
        "Statically allocated circular buffers on core range [(x=0,y=0) - (x=7,y=7)] "
        "grow to 1600000 B which is beyond max L1 size of 1499136 B",
        "Statically allocated circular buffers in program 166 clash with L1 buffers on "
        "core range [(x=0,y=0) - (x=4,y=7)]. L1 buffer allocated at 600256 and static "
        "circular buffer region ends at 621824",
        "Operation 'ttnn.add' started but never completed (likely crashed)",
        "Out of Memory: a message this app does not know",
        "",
    ]
    # The stored message wraps the text in a TT_FATAL header and a backtrace.
    return [
        (
            f"TT_FATAL @ bank_manager.cpp:123: false\ninfo:\n{message}\nbacktrace:\n --- f()"
            if index % 3 == 0
            else message
        )
        for index, message in enumerate(messages)
    ]


# The byte counts are formatted differently on each side, so a diagnosis's wording is
# compared by which of these fragments, common to both, its sentence carries.
DETAIL_PHRASES = [
    "more than an empty bank holds",
    "could not use it",
    "space reserved by other allocators overlaps it",
    "leave a placeable window",
    "no single block holds",
    "Short by",
    "free space inside the interleaved region",
    "so it may be short by more",
    "is also limited to the interleaved region",
    "past the end of L1",
    "overlap the L1 buffer at",
]


def _allocation_failure_cases() -> List[Dict]:
    cases = []
    for message in _messages():
        failure = allocation_failures.parse_allocation_failure(message)
        diagnosis = allocation_failures.diagnose(failure) if failure else None
        cases.append(
            {
                "message": message,
                "failure": _camel_keys(failure) if failure else None,
                "reason": diagnosis["reason"] if diagnosis else None,
                "phrases": (
                    [
                        phrase
                        for phrase in DETAIL_PHRASES
                        if phrase in diagnosis["detail"]
                    ]
                    if diagnosis
                    else None
                ),
            }
        )
    return cases


_GRAPH_NAMES = ["Matmul", "ttnn.matmul", "Conv2d", "ttnn::to", "(torch) add"]


def _scope(node_type: str, name: str, level: Optional[int] = None, **params) -> Dict:
    node: Dict = {"node_type": node_type, "params": {"name": name, **params}}
    if level is not None:
        node["stacking_level"] = level
    return node


def _curated_graphs() -> List[List[Dict]]:
    """Each scope rule once, since a random graph rarely lands on a boundary."""
    start, end = "function_start", "function_end"
    return [
        # A sibling at the same level closes the scope older tt-metal left open.
        [
            _scope(start, "Matmul", 1),
            _scope(start, "Conv2d", 1),
            _scope(end, "Conv2d"),
            _scope(end, "Matmul"),
        ],
        # A deeper one nests, and so does one in a capture without levels.
        [
            _scope(start, "Matmul", 1),
            _scope(start, "Conv2d", 2),
            _scope(end, "Conv2d"),
            _scope(end, "Matmul"),
        ],
        [
            _scope(start, "Matmul"),
            _scope(start, "Conv2d"),
            _scope(end, "Conv2d"),
            _scope(end, "Matmul"),
        ],
        # An aborted end, an end closing the scopes inside it, one with nothing open, one left open.
        [_scope(start, "Matmul"), _scope(end, "Matmul", aborted="true")],
        [_scope(start, "Matmul"), _scope(start, "Conv2d"), _scope(end, "Matmul")],
        [_scope(end, "Matmul"), _scope(start, "Conv2d")],
        # Nodes with null params, no name or no type.
        [
            {"node_type": start, "params": None},
            {"node_type": start, "params": {}},
            {"params": {"name": "Matmul"}},
            {"node_type": end, "params": None},
        ],
    ]


def _failed_device_operation_cases(rng: random.Random) -> List[Dict]:
    cases = [
        {"nodes": nodes, "failed": failed_device_operation_names(nodes)}
        for nodes in _curated_graphs()
    ]
    for _ in range(80):
        nodes: List[Dict] = []
        levelled = rng.random() < 0.5
        for _ in range(rng.randint(0, 10)):
            if rng.random() < 0.55:
                node: Dict = {
                    "node_type": "function_start",
                    "params": {"name": rng.choice(_GRAPH_NAMES)},
                }
                if levelled and rng.random() < 0.9:
                    node["stacking_level"] = rng.randint(0, 3)
            else:
                node = {
                    "node_type": "function_end",
                    "params": {"name": rng.choice(_GRAPH_NAMES)},
                }
                node["params"].update(
                    rng.choice(
                        [
                            {},
                            {},
                            {"aborted": "true"},
                            {"aborted": True},
                            {"aborted": "false"},
                        ]
                    )
                )
            nodes.append(node)
        cases.append({"nodes": nodes, "failed": failed_device_operation_names(nodes)})
    return cases


def _memory_config(buffer_type: str) -> str:
    return f"MemoryConfig(buffer_type=BufferType::{buffer_type})"


_FALLBACK_ERRORS = [
    "Out of Memory: Not enough space to allocate 32 B L1 buffer across 4 banks, where "
    "each bank needs to store 8 B, but bank size is only 4 B",
    "Out of Memory: Not enough space to allocate 32 B DRAM buffer across 4 banks, where "
    "each bank needs to store 8 B, but bank size is only 4 B",
    "Statically allocated circular buffers on core range [(x=0,y=0) - (x=7,y=7)] grow "
    "to 1600000 B which is beyond max L1 size of 1499136 B",
    "Operation 'ttnn.add' started but never completed (likely crashed)",
]


def _tensor(rng: random.Random, tensor_id: int) -> Dict:
    buffer_type = rng.choice([0, 0, 1, 3, None])
    address = rng.choice([None, 1000, 2000]) if buffer_type is not None else None
    return {
        "id": tensor_id,
        "shape": rng.choice(
            [
                "Shape([1, 32, 32])",
                "Shape([1, 1024])",
                "torch.Size([32, 32])",
                "?",
                "Shape([1 2])",
            ]
        ),
        "address": address,
        "device_id": rng.choice([0, 1]),
        "device_addresses": rng.choice([[], [address], [None, 1000], [1000, 2000]]),
        "buffer_type": buffer_type,
    }


def _fallback_operation(operation: Dict) -> dram_fallbacks.FallbackOperation:
    def tensor(entry: Dict) -> SimpleNamespace:
        buffer_type = entry["buffer_type"]
        return SimpleNamespace(
            **{
                **entry,
                "buffer_type": None if buffer_type is None else BufferType(buffer_type),
            }
        )

    return dram_fallbacks.FallbackOperation(
        id=operation["id"],
        name=operation["name"],
        arguments=[
            (argument["name"], argument["value"]) for argument in operation["arguments"]
        ],
        inputs=[tensor(entry) for entry in operation["inputs"]],  # type: ignore[misc]
        outputs=[tensor(entry) for entry in operation["outputs"]],  # type: ignore[misc]
    )


def _dram(tensor_id: int, address: int = 5000) -> Dict:
    return {
        "id": tensor_id,
        "shape": "Shape([1, 32])",
        "address": address,
        "device_id": 0,
        "device_addresses": [address],
        "buffer_type": 0,
    }


def _l1(tensor_id: int) -> Dict:
    return {**_dram(tensor_id, 6000), "buffer_type": 1}


def _operation(
    operation_id: int,
    name: str,
    outputs: List[Dict],
    error: Optional[str] = None,
    request: Optional[str] = None,
) -> Dict:
    return {
        "id": operation_id,
        "name": name,
        "arguments": (
            []
            if request is None
            else [{"name": "memory_config", "value": _memory_config(request)}]
        ),
        "inputs": [],
        "outputs": outputs,
        "error": None if error is None else {"error_message": error},
    }


def _curated_fallback_runs() -> List[List[Dict]]:
    """Each retry rule once: in the window, at its edge, past it, kept in L1, a CB failure
    with and without an L1 request, and a later failure overwriting an earlier one."""
    oom_l1, oom_dram, cb = _FALLBACK_ERRORS[0], _FALLBACK_ERRORS[1], _FALLBACK_ERRORS[2]
    # Unreadable shapes count as NaN, which equals nothing, so this output is no view.
    unreadable = {**_dram(10), "shape": "Shape([1 2])"}
    view_like = {
        **_operation(1, "ttnn.reshape", [unreadable], request="L1"),
        "inputs": [{**unreadable, "id": 11}],
    }
    # Against an input's 2 at the same address, a count of 3 is no view, so it flags,
    # and an unreadable shape can't rule a view out. A count of 2 may be a view, so it
    # doesn't flag where a NaN would: that holds the trim, not just the regex.
    # JavaScript's `\s` takes a BOM and not U+001C, Python's the reverse.
    shape_whitespace = [
        [
            {
                **_operation(
                    1, "ttnn.reshape", [{**_dram(10), "shape": shape}], request="L1"
                ),
                "inputs": [{**_dram(11), "shape": "Shape([2])"}],
            }
        ]
        for shape in (
            "Shape([1,\ufeff3])",
            "Shape([1,\x1c3])",
            "Shape([\u00a03 ])",
            "Shape([1,\ufeff2])",
            "Shape([\u00a02 ])",
            # A dimension of whitespace alone is dropped, so these count 2 too.
            "Shape([2,\ufeff])",
            "Shape([2,])",
        )
    ]
    return [
        [view_like],
        *shape_whitespace,
        [
            _operation(1, "ttnn.matmul", [], oom_l1),
            _operation(2, "ttnn.matmul", [_dram(1)]),
        ],
        [
            _operation(1, "ttnn.matmul", [], oom_l1),
            _operation(2, "ttnn.add", []),
            _operation(3, "ttnn.add", []),
            _operation(4, "ttnn.matmul", [_dram(9)]),
        ],
        [
            _operation(1, "ttnn.matmul", [], oom_l1),
            _operation(2, "ttnn.add", []),
            _operation(3, "ttnn.add", []),
            _operation(4, "ttnn.add", []),
            _operation(5, "ttnn.matmul", [_dram(2)]),
        ],
        [
            _operation(1, "ttnn.matmul", [], oom_l1),
            _operation(2, "ttnn.matmul", [_l1(3)]),
        ],
        [
            _operation(1, "ttnn.matmul", [], oom_dram),
            _operation(2, "ttnn.matmul", [_dram(4)]),
        ],
        [
            _operation(1, "ttnn.conv2d", [], cb, "L1"),
            _operation(2, "ttnn.conv2d", [_dram(5)]),
        ],
        [
            _operation(1, "ttnn.conv2d", [], cb),
            _operation(2, "ttnn.conv2d", [_dram(6)]),
        ],
        [
            _operation(1, "ttnn.matmul", [], oom_l1, "DRAM"),
            _operation(2, "ttnn.matmul", [_dram(7)]),
        ],
        [
            _operation(1, "ttnn.matmul", [], oom_l1),
            _operation(2, "ttnn.matmul", [], oom_l1),
            _operation(3, "ttnn.matmul", [_dram(8)], request="L1"),
        ],
    ]


def _dram_fallback_case(operations: List[Dict]) -> Dict:
    failures = {
        operation["id"]: failure
        for operation in operations
        if (
            failure := allocation_failures.parse_allocation_failure(
                (operation["error"] or {}).get("error_message")
            )
        )
    }
    fallbacks = dram_fallbacks.dram_fallbacks(
        [_fallback_operation(operation) for operation in operations], failures
    )
    return {
        "operations": operations,
        "fallbacks": [
            [operation_id, _app_fallback(fallback)]
            for operation_id, fallback in fallbacks.items()
        ],
    }


def _dram_fallback_cases(rng: random.Random) -> List[Dict]:
    cases = [_dram_fallback_case(run) for run in _curated_fallback_runs()]
    tensor_id = 0
    for _ in range(30):
        operations = []
        for operation_id in range(1, rng.randint(2, 6)):
            arguments = [
                {
                    "name": rng.choice(
                        [
                            "memory_config",
                            "output_mem_config",
                            "intermediate_memory_config",
                        ]
                    ),
                    "value": rng.choice(
                        [
                            _memory_config("L1"),
                            _memory_config("DRAM"),
                            _memory_config("L1_SMALL"),
                            "MemoryConfig(memory_layout=TensorMemoryLayout::INTERLEAVED)",
                            "Tensor(MemoryConfig(buffer_type=BufferType::L1))",
                            "tt::tt_metal::" + _memory_config("L1"),
                            None,
                        ]
                    ),
                }
                for _ in range(rng.randint(0, 2))
            ]
            inputs: List[Dict] = []
            outputs: List[Dict] = []
            for side, count in (
                (inputs, rng.randint(0, 2)),
                (outputs, rng.randint(0, 2)),
            ):
                for _ in range(count):
                    tensor_id += 1
                    side.append(_tensor(rng, tensor_id))
            operations.append(
                {
                    "id": operation_id,
                    "name": rng.choice(["ttnn.matmul", "ttnn.conv2d"]),
                    "arguments": arguments,
                    "inputs": inputs,
                    "outputs": outputs,
                    "error": (
                        {"error_message": rng.choice(_FALLBACK_ERRORS)}
                        if rng.random() < 0.35
                        else None
                    ),
                }
            )
        cases.append(_dram_fallback_case(operations))
    return cases


def _app_fallback(fallback: Dict) -> Dict:
    entry = _camel_keys(fallback)
    if "requestedBufferType" in entry:
        entry["requestedBufferType"] = BufferType[entry["requestedBufferType"]].value
    return entry


def _lifetime_tensors(operations: List[Dict]):
    for operation in operations:
        for side in ("inputs", "outputs"):
            for tensor in operation[side]:
                buffer_type = tensor["buffer_type"]
                yield (
                    tensor["id"],
                    tensor["address"],
                    None if buffer_type is None else BufferType(buffer_type),
                    tensor["consumers"],
                )


def _address_lifetime_cases(rng: random.Random) -> List[Dict]:
    cases = []
    for _ in range(40):
        count = rng.randint(1, 6)
        names = {
            operation_id: rng.choice(
                ["ttnn.add", "ttnn.deallocate", "TTNN::Deallocate"]
            )
            for operation_id in range(1, count + 1)
        }
        operations = []
        for operation_id in range(1, count + 1):
            tensors = [
                {
                    "id": rng.randint(1, 8),
                    "address": rng.choice([None, 100, 200, 300]),
                    "buffer_type": rng.choice([0, 1, 3, None]),
                    "consumers": sorted(
                        rng.sample(
                            range(1, count + 3), rng.randint(0, min(3, count + 2))
                        )
                    ),
                }
                for _ in range(rng.randint(0, 3))
            ]
            operations.append(
                {
                    "id": operation_id,
                    "name": names[operation_id],
                    "inputs": tensors[:1],
                    "outputs": tensors[1:],
                }
            )
        lifetimes = l1_peak.resolve_address_lifetimes(
            _lifetime_tensors(operations), names
        )
        cases.append(
            {
                "operations": operations,
                "lastUseByAddress": sorted(lifetimes.last_use_by_address.items()),
                "unattributableStaleAddressCount": lifetimes.unattributable_stale_address_count,
            }
        )
    return cases


def _graph_node(rng: random.Random) -> Dict:
    kind = rng.choice(
        [
            "buffer_allocate",
            "buffer_allocate",
            "buffer_deallocate",
            "circular_buffer_allocate",
            "circular_buffer_deallocate_all",
            "function_start",
            "capture_start",
        ]
    )
    if kind in ("function_start", "capture_start"):
        return {
            "node_type": kind,
            "params": None if kind == "capture_start" else {"name": "Op"},
        }
    address = rng.choice(["100", "200", 300, "0x190", None, "abc"])
    if kind == "circular_buffer_allocate":
        return {
            "node_type": kind,
            "params": {
                "address": address,
                "size": rng.choice(["4096", 2048]),
                "globally_allocated": rng.choice(["0", "1", 0]),
            },
        }
    if kind == "circular_buffer_deallocate_all":
        return {"node_type": kind, "params": {}}
    params: Dict = {
        "address": address,
        "type": rng.choice(["L1", "L1_SMALL", "DRAM", "BufferType::L1", "1", "\u00b2"]),
        "size": rng.choice(["65536", 32768]),
        "num_cores": rng.choice(["0", 0, "8", 4]),
    }
    if rng.random() < 0.7:
        params["max_size_per_bank"] = rng.choice(["1024", 2048, "512"])
    return {"node_type": kind, "params": params}


def _snapshot_buffers(snapshot: Dict[int, List[Dict]]) -> Dict[int, List[Buffer]]:
    return {
        operation_id: [
            Buffer(
                operation_id, 0, entry["address"], entry["size"], entry["buffer_type"]
            )
            for entry in buffers
        ]
        for operation_id, buffers in snapshot.items()
    }


def _app_decomposition(entry: l1_peak.Decomposition) -> Dict:
    return {
        "operationId": entry.operation_id,
        "totalBytes": entry.total_bytes,
        "circularBufferBytes": entry.circular_buffer_bytes,
        "intermediateTensorBytes": entry.intermediate_tensor_bytes,
        "persistentTensorBytes": entry.persistent_tensor_bytes,
        "staleTensorBytes": entry.stale_tensor_bytes,
        "precision": entry.precision.value,
        "contributors": [
            {
                "address": resident.address,
                "bytes": resident.bytes,
                "kind": resident.kind.value,
                "lastUsedByOperationId": resident.last_used_by_operation_id,
            }
            for resident in entry.contributors
        ],
        "reconciledAwayCount": entry.reconciled_away_count,
    }


def _graph_readers(
    operations: List[Dict],
) -> List[Tuple[int, Callable[[], List[Dict]]]]:
    """`build_l1_peak`'s input: each operation's id, and a callable reading its graph."""
    return [
        (operation["id"], partial(list, operation["device_operations"]))
        for operation in operations
    ]


def _l1_peak_case(
    operations: List[Dict],
    snapshot: Dict[int, List[Dict]],
    last_use: Dict[float, int],
    bank_count: Optional[int],
    capacity: Optional[int],
) -> Dict:
    result = l1_peak.build_l1_peak(
        _graph_readers(operations),
        _snapshot_buffers(snapshot),
        last_use,
        bank_count=bank_count,
        capacity_bytes=capacity,
        # The app keeps every operation's residents; the tool keeps only the peak's.
        keep_contributors=True,
    )
    return {
        "operations": operations,
        "snapshot": sorted(snapshot.items()),
        "lastUseByAddress": sorted(last_use.items()),
        "bankCount": bank_count,
        "capacityBytes": capacity,
        "result": {
            "byOperationId": [
                [operation_id, _app_decomposition(entry)]
                for operation_id, entry in result.by_operation_id.items()
            ],
            "peakOperationId": result.peak.operation_id if result.peak else None,
            "reconciledAwayCount": result.reconciled_away_count,
            "capacityBytes": result.capacity_bytes,
            "exceedsCapacity": result.exceeds_capacity,
        },
    }


def _l1_peak_cases(rng: random.Random) -> List[Dict]:
    allocate = {
        "node_type": "buffer_allocate",
        "params": {"address": "100", "type": "L1", "size": "1000", "num_cores": "1"},
    }
    free = {
        "node_type": "buffer_deallocate",
        "params": {"address": "100", "type": "L1"},
    }
    # Two operations sharing an id share their intermediates, as `findIntermediates` keys them.
    cases = [
        _l1_peak_case(
            [
                {"id": 1, "device_operations": [allocate, free]},
                {"id": 1, "device_operations": [allocate]},
            ],
            {},
            {},
            64,
            None,
        ),
        # Every memory node with null params, which the replay skips.
        _l1_peak_case(
            [
                {
                    "id": 1,
                    "device_operations": [
                        {"node_type": node_type, "params": None}
                        for node_type in (
                            "buffer_allocate",
                            "buffer_deallocate",
                            "circular_buffer_allocate",
                            "circular_buffer_deallocate_all",
                        )
                    ],
                }
            ],
            {},
            {},
            64,
            None,
        ),
        # Figures as `Number` reads them: after JavaScript's whitespace but not Python's,
        # and never with an underscore, which Python's `int(…, 0)` takes.
        _l1_peak_case(
            [
                {
                    "id": 1,
                    "device_operations": [
                        {
                            "node_type": "buffer_allocate",
                            "params": {
                                "address": "\ufeff100",
                                "type": "L1",
                                "size": "\u30001000",
                                "num_cores": "\ufeff2",
                            },
                        },
                        {
                            "node_type": "buffer_allocate",
                            "params": {
                                "address": "0x1_0",
                                "type": "L1",
                                "size": "1000",
                                "num_cores": "1",
                            },
                        },
                        {
                            "node_type": "buffer_allocate",
                            "params": {
                                "address": "\x1c200",
                                "type": "L1",
                                "size": "1000",
                                "num_cores": "\x1c2",
                            },
                        },
                    ],
                }
            ],
            {},
            {},
            64,
            None,
        ),
    ]
    for _ in range(30):
        operations: List[Dict] = [
            {
                "id": operation_id,
                "device_operations": [
                    _graph_node(rng) for _ in range(rng.randint(0, 9))
                ],
            }
            for operation_id in range(1, rng.randint(2, 6))
        ]
        snapshot: Dict[int, List[Dict]] = {
            operation["id"]: [
                {
                    "address": rng.choice([100, 200, 300, 400]),
                    "size": rng.choice([1024, 4096]),
                    "buffer_type": rng.choice([0, 1, 3]),
                }
                for _ in range(rng.randint(0, 2))
            ]
            for operation in operations
            if rng.random() < 0.8
        }
        last_use: Dict[float, int] = {
            address: rng.randint(-1, 5)
            for address in (100, 200, 300, 400)
            if rng.random() < 0.5
        }
        bank_count: Optional[int] = rng.choice([None, 64, 120])
        capacity: Optional[int] = rng.choice([None, 1499136, 3000])
        cases.append(
            _l1_peak_case(operations, snapshot, last_use, bank_count, capacity)
        )
    return cases


def _json_number(value: float) -> object:
    # JSON holds no NaN or Infinity, so those travel as the strings `Number()` reads.
    if math.isfinite(value):
        return value
    return "NaN" if math.isnan(value) else ("Infinity" if value > 0 else "-Infinity")


def _top_operation_case(entries: List[List[float]], count: int) -> Dict:
    decompositions = [
        l1_peak.Decomposition(
            operation_id=int(fields[0]),
            total_bytes=fields[1],
            circular_buffer_bytes=fields[2],
            intermediate_tensor_bytes=fields[3],
            persistent_tensor_bytes=fields[4],
            stale_tensor_bytes=fields[5],
            precision=l1_peak.Precision.EXACT,
            contributors=[],
        )
        for fields in entries
    ]
    return {
        "entries": [[_json_number(value) for value in fields] for fields in entries],
        "count": count,
        "top": [
            [entry.operation_id, also_at]
            for entry, also_at in l1_peak.top_compositions(decompositions, count)
        ],
    }


def _top_operation_cases(rng: random.Random) -> List[Dict]:
    nan, inf = math.nan, math.inf
    # A tie broken by id, a repeat, the count cutting a list, and the non-finite
    # totals a device with no banks reaches -- each once, since a random list
    # rarely holds all of them.
    cases = [
        _top_operation_case(
            [
                [3, 4096, 4096, 0, 0, 0],
                [1, 4096, 0, 4096, 0, 0],
                [2, 4096, 4096, 0, 0, 0],
                [4, 1024, 1024, 0, 0, 0],
            ],
            2,
        ),
        _top_operation_case(
            [
                [1, nan, nan, 0, 0, 0],
                [2, inf, inf, 0, 0, 0],
                [3, nan, nan, 0, 0, 0],
                [4, inf, inf, 0, 0, 0],
                [5, -0.0, 0, 0, 0, -0.0],
                [6, 0, 0, 0, 0, 0],
            ],
            10,
        ),
    ]
    sizes = [0, 512, 1024, inf, nan]
    for _ in range(20):
        entries = []
        for operation_id in rng.sample(range(1, 30), rng.randint(0, 12)):
            parts = [rng.choice(sizes) for _ in range(4)]
            entries.append([operation_id, sum(parts), *parts])
        cases.append(_top_operation_case(entries, rng.randint(1, 10)))
    return cases


# Every `core_range_set` form a capture writes: legacy and current corners, a union of
# rectangles, reversed corners, and the empty set.
_CORE_RANGE_SETS = [
    CORE_RANGE_SET,
    "{[0-0 - 1-1]}",
    "{[0-0 - 1-0], [1-0 - 1-1]}",
    "{[1-1 - 0-0]}",
    "{}",
]


# Never `params: null`, an unparseable size or a missing `core_range_set` below: the app
# throws on each, and no capture writes one, so `test_agent_circular_buffers.py` holds
# the port's reading of them instead.
def _curated_cb_graphs() -> List[List[object]]:
    mesh = CapturedGraph().start("ttnn::add").start("BinaryNg").free_all()
    for device in range(4):
        mesh.cb(device_id=device)
    repeat = CapturedGraph().start("Matmul").free_all()
    # The last is device 1 again, written as a capture that emits it as a string does.
    for device_id in (0, 1, 0, 1, "1"):
        repeat.cb(device_id=device_id)
    return [
        # Every local capture's order: free all, allocate, end.
        mesh.end().end().nodes,
        repeat.end().nodes,
        # The order the app's free-all branch was written for.
        CapturedGraph().start("Tilize").cb().cb("200").free_all().end().nodes,
        # A second batch in one scope; the scope keeps the first.
        CapturedGraph().start("Conv").free_all().cb().free_all().cb("200").end().nodes,
        # Each enclosing scope snapshots its child's buffers again.
        CapturedGraph()
        .start("ttnn::to_layout")
        .start("ttnn::tilize")
        .start("Tilize")
        .free_all()
        .cb()
        .end()
        .end()
        .end()
        .nodes,
        # Globally allocated, every range form, and a tensor between them.
        CapturedGraph()
        .start("Sharded")
        .free_all()
        .cb(globally_allocated="1")
        .cb(globally_allocated=1)
        .tensor()
        .cb(core_range_set=_CORE_RANGE_SETS[1], size=2048)
        .cb(core_range_set=_CORE_RANGE_SETS[2], size="1024abc")
        .cb(core_range_set=_CORE_RANGE_SETS[3], address=300)
        .cb(core_range_set=_CORE_RANGE_SETS[4], device_id="abc")
        .end()
        .nodes,
        # Sibling device operations in every capture's order: each one's free releases
        # the last one's buffers, which must not be taken as its own. #2185
        CapturedGraph()
        .start("ttnn::embedding")
        .start("Embeddings")
        .free_all()
        .cb(device_id=0)
        .end()
        .start("Embeddings")
        .free_all()
        .cb("200", device_id=1)
        .end()
        .end()
        .nodes,
        # A buffer before any scope opens joins the next scope's snapshot.
        CapturedGraph().cb().start("Late").cb("200").end().nodes,
        # Figures after JavaScript's whitespace, which Python's `str.strip` keeps, and
        # after Python's, which JavaScript's does not skip: device "\x1c1" is no device.
        CapturedGraph()
        .start("Whitespace")
        .free_all()
        .cb(size="\ufeff4096", device_id=1)
        .cb("\u3000200", device_id="\ufeff1")
        .cb("300", device_id="\x1c1")
        .end()
        .nodes,
    ]


def _cb_graph(rng: random.Random) -> List[object]:
    graph = CapturedGraph()
    depth = 0
    for _ in range(rng.randint(1, 24)):
        kind = rng.choice(["start", "start", "end", "free", "cb", "cb", "cb", "tensor"])
        if kind == "start":
            graph.start(rng.choice(["Tilize", "Matmul", "ttnn::add"]))
            depth += 1
        elif kind == "end" and depth:
            graph.end()
            depth -= 1
        elif kind == "free":
            graph.free_all()
        elif kind == "tensor":
            graph.tensor()
        elif kind == "cb":
            params: Dict = {
                "core_range_set": rng.choice(_CORE_RANGE_SETS),
                "globally_allocated": rng.choice(["0", "1", 0, 1]),
            }
            device = rng.choice([0, 1, "1", "", None])
            if device is not None:
                params["device_id"] = device
            graph.cb(
                rng.choice(["100", "200", 300]),
                rng.choice(["4096", 2048, "1024abc"]),
                **params,
            )
    for _ in range(depth):
        graph.end()
    return graph.nodes


def _app_snapshot(snapshot: circular_buffers.Snapshot) -> Dict:
    """`CBPressureSnapshot`, less each row's expanded `cores` and its `nodeId`."""
    figures = [
        snapshot.max_bytes,
        snapshot.unattributed_bytes,
        *snapshot.by_core.values(),
    ]
    assert all(math.isfinite(value) for value in figures), "a size the app reads as NaN"
    return {
        "byCore": snapshot.by_core,
        "maxBytes": snapshot.max_bytes,
        "unattributedBytes": snapshot.unattributed_bytes,
        "allocations": [
            {
                "address": row.address,
                "size": row.size,
                "numCores": row.core_count,
                "coreRangeSet": row.core_range_set,
                "allocateOperationId": row.allocate_operation_id,
                "allocateOperationName": row.allocate_operation_name,
                "globallyAllocated": row.globally_allocated,
                "deviceCount": row.device_count,
            }
            for row in snapshot.allocations
        ],
    }


def _circular_buffer_cases(rng: random.Random) -> List[Dict]:
    graphs = _curated_cb_graphs() + [_cb_graph(rng) for _ in range(40)]
    return [
        {
            "nodes": nodes,
            "snapshots": [
                [snapshot.operation_id, _app_snapshot(snapshot)]
                for snapshot in circular_buffers.summarise(nodes).snapshots
            ],
        }
        for nodes in graphs
    ]


def _generate_golden() -> Dict:
    rng = random.Random(_SEED)
    return {
        "_comment": (
            "Generated by backend/ttnn_visualizer/tests/test_agent_failure_parity.py from "
            "the agent's ports. Do not edit by hand; run pnpm run agent:parity-golden."
        ),
        "detailPhrases": DETAIL_PHRASES,
        "allocationFailures": _allocation_failure_cases(),
        "failedDeviceOperations": _failed_device_operation_cases(rng),
        "dramFallbacks": _dram_fallback_cases(rng),
        "addressLifetimes": _address_lifetime_cases(rng),
        "l1Peak": _l1_peak_cases(rng),
        "topOperations": _top_operation_cases(rng),
        "circularBuffers": _circular_buffer_cases(rng),
    }


def test_the_ports_reproduce_the_golden():
    GOLDEN.check(_generate_golden())


def test_the_golden_exercises_every_branch():
    """A matrix that never reached a branch would leave it unchecked on both sides."""
    golden = _generate_golden()
    kinds = {
        case["failure"]["kind"]
        for case in golden["allocationFailures"]
        if case["failure"]
    }
    reasons = {
        case["reason"] for case in golden["allocationFailures"] if case["reason"]
    }
    signals = {
        fallback["signal"]
        for case in golden["dramFallbacks"]
        for _, fallback in case["fallbacks"]
    }
    resident_kinds = {
        contributor["kind"]
        for case in golden["l1Peak"]
        for _, entry in case["result"]["byOperationId"]
        for contributor in entry["contributors"]
    }

    assert kinds == {kind.value for kind in allocation_failures.AllocationFailureKind}
    assert reasons == {
        reason.value for reason in allocation_failures.AllocationFailureReason
    }
    assert signals == {signal.value for signal in dram_fallbacks.DramFallbackSignal}
    assert resident_kinds == {kind.value for kind in l1_peak.ResidentKind}
    assert {
        phrase
        for case in golden["allocationFailures"]
        for phrase in case["phrases"] or []
    } == set(DETAIL_PHRASES)
    assert any(case["failed"] for case in golden["failedDeviceOperations"])
    assert any(
        case["unattributableStaleAddressCount"] for case in golden["addressLifetimes"]
    )
    assert any(case["result"]["exceedsCapacity"] for case in golden["l1Peak"])
    assert any(
        entry["reconciledAwayCount"]
        for case in golden["l1Peak"]
        for _, entry in case["result"]["byOperationId"]
    )
    assert any(
        also_at for case in golden["topOperations"] for _, also_at in case["top"]
    )
    assert any(
        len(case["top"]) < len(case["entries"]) for case in golden["topOperations"]
    )
    rows = [
        row
        for case in golden["circularBuffers"]
        for _, snapshot in case["snapshots"]
        for row in snapshot["allocations"]
    ]
    assert any(row["deviceCount"] > 1 for row in rows)
    assert any(row["globallyAllocated"] for row in rows)
    assert any(row["numCores"] == 0 for row in rows)
    assert any(row["allocateOperationId"] is None for row in rows)
    assert any(
        snapshot["unattributedBytes"]
        for case in golden["circularBuffers"]
        for _, snapshot in case["snapshots"]
    )
    # A repeat on one device: two rows of one identity in one snapshot.
    assert any(
        len(identities) > len(set(identities))
        for case in golden["circularBuffers"]
        for identities in (
            [
                (row["address"], row["size"], row["coreRangeSet"])
                for _, snapshot in case["snapshots"]
                for row in snapshot["allocations"]
            ],
        )
    )
    # Snapshots taken at a free-all and at a scope's end, and a graph with several.
    taken_at = {
        case["nodes"][next_id]["node_type"]
        for case in golden["circularBuffers"]
        for next_id in _snapshot_triggers(case["nodes"])
    }
    assert taken_at == {"circular_buffer_deallocate_all", "function_end"}
    assert any(len(case["snapshots"]) > 1 for case in golden["circularBuffers"])


def _snapshot_triggers(nodes: List[Dict]) -> List[int]:
    """The index of the node at which each snapshot of `nodes` is taken."""
    triggers = []
    for index in range(1, len(nodes)):
        before = {
            snapshot.operation_id: snapshot
            for snapshot in circular_buffers.summarise(nodes[:index]).snapshots
        }
        after = {
            snapshot.operation_id: snapshot
            for snapshot in circular_buffers.summarise(nodes[: index + 1]).snapshots
        }
        if before != after:
            triggers.append(index)
    return triggers


def test_the_tool_s_replay_differs_only_in_the_residents_it_keeps():
    """The tool drops every operation's residents but the peak's, and skips building
    them for an instant it only compares; neither may change a figure."""
    rng = random.Random(_SEED)
    for case in _l1_peak_cases(rng):
        args = (
            _graph_readers(case["operations"]),
            _snapshot_buffers(dict(case["snapshot"])),
            dict(case["lastUseByAddress"]),
        )
        kwargs = {
            "bank_count": case["bankCount"],
            "capacity_bytes": case["capacityBytes"],
        }
        full = l1_peak.build_l1_peak(*args, **kwargs, keep_contributors=True)
        trimmed = l1_peak.build_l1_peak(*args, **kwargs)

        for operation_id, entry in full.by_operation_id.items():
            kept = trimmed.by_operation_id[operation_id]
            expected = (
                entry.contributors
                if full.peak is not None and kept is trimmed.peak
                else []
            )
            assert kept.contributors == expected
            assert round_trip(
                {**_app_decomposition(kept), "contributors": []}
            ) == round_trip({**_app_decomposition(entry), "contributors": []})
        assert (trimmed.peak and trimmed.peak.operation_id) == (
            full.peak and full.peak.operation_id
        )


def test_a_node_that_is_not_an_object_is_skipped():
    """The app's functions throw on one, so the golden cannot hold it."""
    nodes = [1, "Matmul", None, [], {"node_type": "function_start"}]

    result = l1_peak.build_l1_peak([(1, partial(list, nodes))], {}, {})

    assert failed_device_operation_names(nodes) == []
    assert result.peak is None


@pytest.mark.parametrize("nodes", [{"node_type": "function_start"}, "Matmul", None, 7])
def test_a_graph_that_is_not_a_list_names_no_failure(nodes):
    """The app's replay throws on one, so the golden cannot hold it."""
    assert failed_device_operation_names(nodes) == []


def test_the_ts_spec_reads_this_golden():
    GOLDEN.check_spec_reads_it()
