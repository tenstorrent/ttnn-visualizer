# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Parity between the agent's late deallocations and Buffer Summary's. #2156

`late_deallocations.buffer_sizes_by_operation`, `held_tensors_by_operation` and
`run_start_count` restate `getUniqueBuffersByOperation`, `buildTensorsByOperationByAddress`,
`buildLateDeallocationReports` and `selectLateDeallocationRunStarts`. This test feeds the
port curated and seeded operations and buffers, shaped as `/api/operations` and
`/api/operation-buffers` serve them, and writes its answers to a golden file, and
`tests/agentLateDeallocationParity.spec.ts` asserts the app's functions give the same
answers from the same rows.

`holds` goes past the app, so `test_agent_late_deallocations.py` holds it instead.

    pnpm run agent:parity-golden    <- regenerates tests/data/agentLateDeallocationParity.json
"""

import random
from typing import Dict, List, Mapping, Optional, Sequence

from ttnn_visualizer.agent import late_deallocations as late
from ttnn_visualizer.models import Tensor
from ttnn_visualizer.tests.parity_golden import Golden

GOLDEN = Golden("agentLateDeallocationParity")
_SEED = 2156

# Repeats weight the random cases towards ordinary operations and reused addresses.
_NAMES = (
    "ttnn.add",
    "ttnn.matmul",
    "ttnn.add",
    "ttnn.deallocate",
    "TTNN::Deallocate",
    None,
)
_ADDRESSES = (None, 0, 100, 200, 300, 400)
_TENSOR_ADDRESSES = _ADDRESSES + (100, 200, 300)
_SIZES = (None, 0, 16, 32, 64)


def _tensor(
    tensor_id: int, address: Optional[int], consumers: Sequence[int] = ()
) -> Dict:
    return {"id": tensor_id, "address": address, "consumers": list(consumers)}


def _operation(
    operation_id: int,
    name: Optional[str] = "ttnn.add",
    inputs: Sequence[Dict] = (),
    outputs: Sequence[Dict] = (),
) -> Dict:
    return {
        "id": operation_id,
        "name": name,
        "inputs": list(inputs),
        "outputs": list(outputs),
    }


def _buffer(address: Optional[int], size: Optional[int], device_id: int = 0) -> Dict:
    return {"device_id": device_id, "address": address, "size": size}


def _as_tensor(fields: Dict) -> Tensor:
    return Tensor(
        fields["id"],
        "Shape([1])",
        "BFLOAT16",
        "TILE",
        None,
        0,
        fields["address"],
        None,
        [],
    )


def _answers(operations: List[Dict], buffers_by_operation: List[Dict]) -> Dict:
    operation_ids = [operation["id"] for operation in operations]
    consumers = {
        tensor["id"]: tensor["consumers"]
        for operation in operations
        for tensor in operation["inputs"] + operation["outputs"]
    }
    rows = [
        (entry["id"], buffer["address"], buffer["size"])
        for entry in buffers_by_operation
        for buffer in entry["buffers"]
    ]
    held = late.held_tensors_by_operation(
        operation_ids,
        {
            op["id"]: [_as_tensor(tensor) for tensor in op["inputs"]]
            for op in operations
        },
        {
            op["id"]: [_as_tensor(tensor) for tensor in op["outputs"]]
            for op in operations
        },
        late.buffer_sizes_by_operation(operation_ids, rows),
        consumers,
        {operation["id"]: operation["name"] for operation in operations},
    )
    return {
        "held": [
            [
                operation_id,
                [
                    {
                        "tensor_id": entry.tensor_id,
                        "address": entry.address,
                        "last_use_operation_id": entry.last_use_operation_id,
                        "size": entry.bytes_per_bank,
                    }
                    for entry in entries
                ],
            ]
            for operation_id, entries in held.held_by_operation.items()
        ],
        "run_start_count": late.run_start_count(operation_ids, held.held_by_operation),
    }


def _case(operations: List[Dict], buffers: Mapping[int, List[Dict]]) -> Dict:
    """Every operation is listed in the buffers too, as the route lists it."""
    buffers_by_operation = [
        {"id": operation["id"], "buffers": buffers.get(operation["id"], [])}
        for operation in operations
    ]
    return {
        "operations": operations,
        "buffersByOperation": buffers_by_operation,
        "expected": _answers(operations, buffers_by_operation),
    }


def _snapshots(
    first: int, last: int, address: int = 100, size: int = 64
) -> Dict[int, List[Dict]]:
    return {
        operation_id: [_buffer(address, size)]
        for operation_id in range(first, last + 1)
    }


def _curated_cases() -> List[Dict]:
    """Each rule once, since a random report rarely lands on a boundary."""
    produced = _tensor(10, 100, [2])
    used = _operation(2, inputs=[produced])
    return [
        # A tensor held at every operation after its last use.
        _case(
            [_operation(1, outputs=[produced]), used, _operation(3), _operation(4)],
            _snapshots(1, 4),
        ),
        # A tensor at address 0 or none is never matched to a buffer.
        _case(
            [
                _operation(1, outputs=[_tensor(11, 0, [2]), _tensor(12, None, [2])]),
                _operation(2, inputs=[_tensor(11, 0, [2]), _tensor(12, None, [2])]),
                _operation(3),
            ],
            {3: [_buffer(0, 64), _buffer(100, 16)]},
        ),
        # A buffer at address 0 or none is dropped.
        _case(
            [_operation(1, outputs=[produced]), used, _operation(3)],
            {3: [_buffer(0, 64), _buffer(None, 32), _buffer(100, 16)]},
        ),
        # A null size compares as 0, against a size before or after it.
        _case(
            [_operation(1, outputs=[produced]), used]
            + [_operation(3), _operation(4), _operation(5)],
            {
                3: [_buffer(100, None)],
                4: [_buffer(100, None), _buffer(100, 32)],
                5: [_buffer(100, 32), _buffer(100, None)],
            },
        ),
        # One address on several devices: the largest, and one of equal ones.
        _case(
            [_operation(1, outputs=[produced]), used, _operation(3), _operation(4)],
            {
                3: [_buffer(100, 16, 0), _buffer(100, 64, 1), _buffer(100, 32, 2)],
                4: [_buffer(100, 64, 0), _buffer(100, 64, 1)],
            },
        ),
        # Consumed by deallocate calls only, whatever their case, is never held; a
        # deallocate after a real use leaves that use the last.
        _case(
            [
                _operation(
                    1, outputs=[_tensor(10, 100, [3]), _tensor(11, 200, [2, 4])]
                ),
                _operation(2, "ttnn.matmul", inputs=[_tensor(11, 200, [2, 4])]),
                _operation(3, "ttnn.deallocate", inputs=[_tensor(10, 100, [3])]),
                _operation(4, "TTNN::Deallocate", inputs=[_tensor(11, 200, [2, 4])]),
                _operation(5),
            ],
            {
                operation_id: [_buffer(100, 64), _buffer(200, 32)]
                for operation_id in range(2, 6)
            },
        ),
        # No consumers at all.
        _case(
            [_operation(1, outputs=[_tensor(10, 100)]), _operation(2)],
            _snapshots(1, 2),
        ),
        # A last use at the operation itself is not late there.
        _case(
            [
                _operation(1, outputs=[_tensor(10, 100, [3])]),
                _operation(2),
                _operation(3, inputs=[_tensor(10, 100, [3])]),
                _operation(4),
            ],
            _snapshots(1, 4),
        ),
        # A consumer with a null name, or none in the list, is a real use.
        _case(
            [
                _operation(1, outputs=[_tensor(10, 100, [2]), _tensor(11, 200, [9])]),
                _operation(2, None, inputs=[_tensor(10, 100, [2])]),
                _operation(3),
            ],
            {3: [_buffer(100, 64), _buffer(200, 32)]},
        ),
        # An address reassigned to another tensor: the latest is the one held.
        _case(
            [
                _operation(1, outputs=[produced]),
                used,
                _operation(3),
                _operation(4, outputs=[_tensor(11, 100, [5])]),
                _operation(5, inputs=[_tensor(11, 100, [5])]),
                _operation(6),
            ],
            _snapshots(1, 6),
        ),
        # A run that breaks where its buffer leaves the snapshot; one back at its
        # address later is not its tensor's.
        _case(
            [_operation(1, outputs=[produced]), used]
            + [_operation(operation_id) for operation_id in range(3, 7)],
            {
                3: [_buffer(100, 64)],
                4: [_buffer(100, 64)],
                5: [_buffer(200, 64)],
                6: [_buffer(100, 64)],
            },
        ),
        # An operation with no buffers between two held rows ends the run.
        _case(
            [_operation(1, outputs=[produced]), used]
            + [_operation(operation_id) for operation_id in range(3, 6)],
            {3: [_buffer(100, 64)], 5: [_buffer(100, 64)]},
        ),
        # Held entries keep the order an address was first seen in, and the largest
        # size seen there.
        _case(
            [
                _operation(
                    1,
                    outputs=[
                        _tensor(10, 100, [2]),
                        _tensor(11, 200, [2]),
                        _tensor(12, 300, [2]),
                    ],
                ),
                _operation(2),
                _operation(3),
            ],
            {
                3: [
                    _buffer(300, 8),
                    _buffer(100, 16),
                    _buffer(200, 4),
                    _buffer(100, 64),
                    _buffer(300, 2),
                ]
            },
        ),
        # Inputs then outputs: an in-place output takes its input's address.
        _case(
            [
                _operation(1, outputs=[produced]),
                _operation(2, inputs=[produced], outputs=[_tensor(11, 100, [3])]),
                _operation(3, inputs=[_tensor(11, 100, [3])]),
                _operation(4),
            ],
            _snapshots(1, 4),
        ),
        # A tensor joining a run starts one; several starting together count once.
        _case(
            [
                _operation(
                    1,
                    outputs=[
                        _tensor(10, 100, [2]),
                        _tensor(11, 200, [2]),
                        _tensor(12, 300, [3]),
                    ],
                ),
                _operation(2),
                _operation(3),
                _operation(4),
            ],
            {
                3: [_buffer(100, 64), _buffer(200, 32), _buffer(300, 16)],
                4: [_buffer(100, 64), _buffer(200, 32), _buffer(300, 16)],
            },
        ),
    ]


def _random_case(rng: random.Random) -> Dict:
    """Tensors used soon after they are made, and snapshots that mostly keep the
    addresses made so far: a random tensor that is never held checks little."""
    count = rng.randint(4, 10)
    tensors = []
    for tensor_id in range(10, 10 + rng.randint(2, 7)):
        producer = rng.randint(1, count - 2)
        soon = list(range(producer + 1, min(count, producer + 4) + 1))
        used = 0 if rng.random() < 0.15 else rng.randint(1, len(soon))
        consumers = sorted(rng.sample(soon, used))
        tensors.append(
            (producer, _tensor(tensor_id, rng.choice(_TENSOR_ADDRESSES), consumers))
        )
    operations = [
        _operation(
            operation_id,
            rng.choice(_NAMES),
            inputs=[
                tensor for _, tensor in tensors if operation_id in tensor["consumers"]
            ],
            outputs=[
                tensor for producer, tensor in tensors if producer == operation_id
            ],
        )
        for operation_id in range(1, count + 1)
    ]
    buffers: Dict[int, List[Dict]] = {}
    for operation_id in range(1, count + 1):
        made = {
            tensor["address"]
            for producer, tensor in tensors
            if producer <= operation_id
        }
        addresses = [
            address
            for address in _ADDRESSES
            if (address in made and rng.random() < 0.8) or rng.random() < 0.15
        ]
        rng.shuffle(addresses)
        rows = [
            _buffer(address, rng.choice(_SIZES), device_id)
            for address in addresses
            for device_id in range(rng.choice([1, 1, 2, 3]))
        ]
        if rng.random() < 0.3:
            rng.shuffle(rows)
        buffers[operation_id] = [] if rng.random() < 0.15 else rows
    return _case(operations, buffers)


def _generate_golden() -> Dict:
    rng = random.Random(_SEED)
    return {
        "_comment": (
            "Generated by backend/ttnn_visualizer/tests/"
            "test_agent_late_deallocation_parity.py from the agent's port. Do not edit "
            "by hand; run pnpm run agent:parity-golden."
        ),
        "cases": _curated_cases() + [_random_case(rng) for _ in range(40)],
    }


def test_the_port_reproduces_the_golden():
    GOLDEN.check(_generate_golden())


def test_the_golden_reaches_each_rule():
    """A golden in which nothing is held, or every run is one row, would check little."""
    expected = [case["expected"] for case in _generate_golden()["cases"]]
    entries = [entry for case in expected for _, held in case["held"] for entry in held]

    assert any(case["run_start_count"] >= 2 for case in expected)
    assert any(len(held) >= 3 for case in expected for _, held in case["held"])
    assert sum(1 for case in expected if not case["held"]) >= 5
    assert {0, 16, 32, 64} <= {entry["size"] for entry in entries}


def test_the_ts_spec_reads_this_golden():
    GOLDEN.check_spec_reads_it()
