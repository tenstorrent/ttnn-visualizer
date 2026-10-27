# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Parity between the agent's L1 pressure and the performance view's. #2172

`operations._compute_l1_pressure` restates `computeL1PressureForOperation`: per-device
windows, the dedupe, clip and merge of each device's L1 extents, and the most
constrained device. This test feeds the port curated and seeded buffers and devices
and writes its answers to a golden file, and `tests/l1PressureParity.spec.ts` asserts
the app's function gives the same answers from the same rows.

Only cases where the port answers at all: it returns `None` for an operation without
buffer rows or a report without device geometry, where the app falls back to its
L1 markers.

    pnpm run agent:parity-golden    <- regenerates tests/data/l1PressureParity.json
"""

import random
from typing import Dict, List, Optional

from ttnn_visualizer.agent import operations
from ttnn_visualizer.models import Buffer, BufferType, Device
from ttnn_visualizer.tests.parity_golden import Golden

GOLDEN = Golden("l1PressureParity")
_SEED = 2172

_FIGURES = (
    "device_id",
    "fullness_pct",
    "free_segments",
    "largest_free_block",
    "largest_free_pct",
    "allocated_bytes",
)


def _device(
    device_id: int,
    start: int = 0,
    bank: int = 1000,
    worker: Optional[int] = None,
) -> Dict[str, int]:
    return {
        "device_id": device_id,
        "address_at_first_l1_cb_buffer": start,
        "l1_bank_size": bank,
        "worker_l1_size": start + bank if worker is None else worker,
    }


def _buffer(device_id: int, address: int, size: int) -> Dict[str, int]:
    return {"device_id": device_id, "address": address, "size": size}


def _as_device(fields: Dict[str, int]) -> Device:
    return Device(
        device_id=fields["device_id"],
        num_y_cores=0,
        num_x_cores=0,
        num_y_compute_cores=0,
        num_x_compute_cores=0,
        worker_l1_size=fields["worker_l1_size"],
        l1_num_banks=0,
        l1_bank_size=fields["l1_bank_size"],
        address_at_first_l1_bank=0,
        address_at_first_l1_cb_buffer=fields["address_at_first_l1_cb_buffer"],
        num_banks_per_storage_core=0,
        num_compute_cores=0,
        total_l1_memory=0,
        total_l1_for_tensors=0,
        total_l1_for_interleaved_buffers=0,
        total_l1_for_sharded_buffers=0,
        cb_limit=0,
    )


def _as_buffer(fields: Dict[str, int]) -> Buffer:
    return Buffer(
        operation_id=1,
        device_id=fields["device_id"],
        address=fields["address"],
        max_size_per_bank=fields["size"],
        buffer_type=BufferType.L1,
    )


def _case(devices: List[Dict[str, int]], buffers: List[Dict[str, int]]) -> Dict:
    windows = operations._device_l1_windows([_as_device(item) for item in devices])
    pressure = operations._compute_l1_pressure(
        [_as_buffer(item) for item in buffers], windows
    )
    assert pressure is not None, "a golden case must be one the port answers"
    return {
        "devices": devices,
        "buffers": buffers,
        "expected": {key: pressure[key] for key in _FIGURES},  # type: ignore[literal-required]
    }


def _curated_cases() -> List[Dict]:
    """Each rule once, since a random layout rarely lands on a tie or a boundary."""
    one = [_device(0)]
    return [
        # One extent, flush with the window's start, and one floating inside it.
        _case(one, [_buffer(0, 0, 200)]),
        _case(one, [_buffer(0, 300, 100)]),
        # A full window has no free segment at all.
        _case(one, [_buffer(0, 0, 1000)]),
        # The window starts at the first circular-buffer address, and ends at the
        # bank size or `worker_l1_size`, whichever is lower.
        _case([_device(0, start=100, bank=1000)], [_buffer(0, 100, 100)]),
        _case([_device(0, start=100, bank=1000, worker=800)], [_buffer(0, 600, 100)]),
        # Extents clipped at both edges, and one wholly outside.
        _case([_device(0, start=100)], [_buffer(0, 50, 100), _buffer(0, 1050, 100)]),
        _case([_device(0, start=100)], [_buffer(0, 0, 50), _buffer(0, 1200, 10)]),
        # Overlapping and adjacent extents merge.
        _case(one, [_buffer(0, 0, 100), _buffer(0, 50, 100), _buffer(0, 150, 50)]),
        # Rows at one address keep the largest.
        _case(one, [_buffer(0, 100, 50), _buffer(0, 100, 300), _buffer(0, 100, 10)]),
        # A zero-size row occupies nothing and splits no gap.
        _case(one, [_buffer(0, 100, 100), _buffer(0, 500, 0), _buffer(0, 800, 100)]),
        # The most constrained device is the fragmented one, not the fullest.
        _case(
            [_device(0), _device(1)],
            [
                _buffer(0, 0, 100),
                _buffer(0, 450, 100),
                _buffer(0, 900, 100),
                _buffer(1, 0, 600),
            ],
        ),
        # Equal on every figure: the lowest `device_id`, in whatever order it is read.
        _case(
            [_device(3), _device(1)],
            [_buffer(3, 0, 100), _buffer(1, 0, 100)],
        ),
        # Equal largest free block and fullness: the most allocated.
        _case(
            [_device(0), _device(1, bank=2000)],
            [_buffer(0, 0, 100), _buffer(1, 900, 200)],
        ),
        # A device with no geometry of its own borrows the first device's window.
        _case([_device(0, start=100)], [_buffer(5, 100, 300)]),
        _case(
            [_device(0), _device(1, bank=0)],
            [_buffer(0, 0, 100), _buffer(1, 0, 400)],
        ),
        # A device holding nothing can be the most constrained, when its window is
        # smaller than the free space another device has left.
        _case([_device(0), _device(1, bank=500)], [_buffer(0, 0, 100)]),
        # Rows on other devices only: an empty device decides.
        _case([_device(0), _device(1)], [_buffer(1, 0, 900)]),
    ]


def _random_cases(rng: random.Random) -> List[Dict]:
    cases = []
    for _ in range(40):
        devices = [
            _device(
                device_id,
                start=rng.choice([0, 0, 100, 250]),
                bank=rng.choice([0, 500, 1000, 1000, 1500]),
            )
            for device_id in range(rng.randint(1, 4))
        ]
        if all(item["l1_bank_size"] == 0 for item in devices):
            devices[0]["l1_bank_size"] = 1000
            devices[0]["worker_l1_size"] = (
                devices[0]["address_at_first_l1_cb_buffer"] + 1000
            )
        buffers = [
            _buffer(
                rng.randrange(len(devices) + 1),
                rng.randrange(0, 1600, 25),
                rng.choice([0, 25, 50, 100, 200, 400]),
            )
            for _ in range(rng.randint(1, 10))
        ]
        cases.append(_case(devices, buffers))
    return cases


def _generate_golden() -> Dict:
    return {
        "_comment": (
            "Generated by backend/ttnn_visualizer/tests/test_agent_l1_pressure_parity.py "
            "from the agent's port. Do not edit by hand; run pnpm run agent:parity-golden."
        ),
        "cases": _curated_cases() + _random_cases(random.Random(_SEED)),
    }


def test_the_port_reproduces_the_golden():
    GOLDEN.check(_generate_golden())


def test_the_golden_reaches_the_device_rules():
    """A golden whose answers all came from device 0 would never check the pick."""
    cases = _generate_golden()["cases"]

    assert {case["expected"]["device_id"] for case in cases} >= {0, 1, 5}
    assert any(case["expected"]["free_segments"] == 0 for case in cases)
    assert any(case["expected"]["free_segments"] >= 3 for case in cases)


def test_the_ts_spec_reads_this_golden():
    GOLDEN.check_spec_reads_it()
