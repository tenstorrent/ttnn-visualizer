# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""The failure tools' database reads, against the routes the app reads instead. #2154

`test_agent_failure_parity.py` pins the ports to the app's functions given identical
inputs. These pin the inputs. The tools build them from the database, while the app
builds them from `/api/operations`, `/api/operation-buffers` and `/api/devices`, so a
serialiser change would move one and not the other. A fixture is served through the real
routes, read as the app's hooks read the JSON, fed to the same ports, and compared with
`report_l1_peak` and `report_dram_fallbacks`, which keep every figure the tools' answers
are cut from.
"""

import json
import re
from http import HTTPStatus
from pathlib import Path
from typing import Callable, Dict, List, Sequence, Tuple, TypeVar

import pytest
from ttnn_visualizer.agent import allocation_failures, dram_fallbacks, failures, l1_peak
from ttnn_visualizer.agent.handles import PROFILER_DB_FILE, ReportRegistry
from ttnn_visualizer.agent.operations import RankScope, profiler_db, rank_scope
from ttnn_visualizer.extensions import db
from ttnn_visualizer.models import L1_BUFFER_TYPES, Buffer, BufferType, InstanceTable
from ttnn_visualizer.queries import DatabaseQueries
from ttnn_visualizer.tests.test_agent_failure_parity import (
    _fallback_operation,
    _graph_readers,
    _lifetime_tensors,
)
from ttnn_visualizer.tests.test_agent_failures import (
    _ARGUMENTS,
    _ERRORS,
    _L1_CONFIG,
    _OUT_OF_MEMORY,
    _SCHEMA,
    _allocate,
    _circular_buffer,
    _free,
    _ranked_report,
    _retry_rows,
    _start,
    _tensor_row,
)

_TABLES = tuple(re.findall(r"CREATE TABLE (\w+) \(", _SCHEMA + _ERRORS + _ARGUMENTS))
_INSTANCE_ID = "adapter-parity"
_L1 = BufferType.L1.value
_L1_SMALL = BufferType.L1_SMALL.value
_DRAM = BufferType.DRAM.value
_L1_VALUES = frozenset(entry.value for entry in L1_BUFFER_TYPES)


def _allocate_unsized(address: int, size: int) -> Dict:
    """An allocation with no `max_size_per_bank` or core count, so the device's bank
    count sizes it."""
    return {
        "node_type": "buffer_allocate",
        "params": {
            "address": str(address),
            "type": "L1",
            "size": str(size),
            "num_cores": "0",
        },
    }


# The L1 and L1_SMALL buffers each operation leaves, as (address, bytes per bank, type).
# Interleaved, so reading both types in one query would order them differently.
_LIVE_AFTER: Dict[int, List[Tuple[int, int, int]]] = {
    1: [(100, 1000, _L1), (700, 1000, _L1_SMALL), (600, 1000, _L1)],
    2: [
        (100, 1000, _L1),
        (700, 1000, _L1_SMALL),
        (600, 1000, _L1),
        (300, 500, _L1_SMALL),
    ],
    3: [
        (100, 1000, _L1),
        (700, 1000, _L1_SMALL),
        (600, 1000, _L1),
        (300, 500, _L1_SMALL),
        (400, 1600, _L1),
    ],
    **{
        operation_id: [
            (100, 1000, _L1),
            (700, 1000, _L1_SMALL),
            (600, 1000, _L1),
            (400, 1600, _L1),
        ]
        for operation_id in range(4, 10)
    },
}

# 10 is read twice, 16 read but never produced, and 11 read last by a deallocate. 5 fails
# to allocate L1 and 6 retries it into DRAM; 7 asks for L1 and lands in DRAM.
_RUN: Dict[str, Sequence[Tuple]] = {
    "operations": [
        (1, "ttnn.from_torch", 1.0),
        (2, "ttnn.add", 1.0),
        (3, "ttnn.matmul", 1.0),
        (4, "ttnn.deallocate", 1.0),
        (5, "ttnn.conv2d", 1.0),
        (6, "ttnn.conv2d", 1.0),
        (7, "ttnn.matmul", 1.0),
        (8, "ttnn.reshape", 1.0),
        (9, "ttnn.typecast", 1.0),
    ],
    "errors": [(5, "ttnn.conv2d", "TT_THROW", _OUT_OF_MEMORY, "", "")],
    "operation_arguments": [
        (operation_id, "memory_config", _L1_CONFIG) for operation_id in range(5, 10)
    ],
    "tensors": [
        _tensor_row(10, 100, _L1),
        _tensor_row(11, 300, _L1_SMALL),
        _tensor_row(12, 400, _L1),
        _tensor_row(13, 9000, _DRAM),
        _tensor_row(14, 9500, _DRAM),
        _tensor_row(15, 9500, _DRAM),
        _tensor_row(16, 600, _L1),
        _tensor_row(17, 9500, _DRAM),
    ],
    # 15 is a view of 14, so 8 is no fallback. 17 shares 15's address on device 0 but not
    # on device 1, so it is no view, and 9, asking for L1, is one.
    "device_tensors": [
        (14, 0, 9500),
        (14, 1, 9600),
        (15, 0, 9500),
        (15, 1, 9600),
        (17, 0, 9500),
        (17, 1, 9700),
    ],
    "input_tensors": [
        (2, 0, 10),
        (2, 1, 16),
        (3, 0, 10),
        (3, 1, 11),
        (4, 0, 11),
        (5, 0, 12),
        (6, 0, 12),
        (7, 0, 13),
        (8, 0, 14),
        (9, 0, 15),
    ],
    "output_tensors": [
        (1, 0, 10),
        (2, 0, 11),
        (3, 0, 12),
        (6, 0, 13),
        (7, 0, 14),
        (8, 0, 15),
        (9, 0, 17),
    ],
    "buffers": [
        (operation_id, 0, address, size, buffer_type, 0)
        for operation_id, live in _LIVE_AFTER.items()
        for address, size, buffer_type in live
    ],
    # The app keeps device 0 in its first row's place with its last row's values.
    "devices": [(0, 1499136, 64), (1, 1499136, 64), (0, 1400000, 40)],
    "captured_graph": [
        (operation_id, json.dumps(nodes))
        for operation_id, nodes in (
            (1, [_allocate(100, 1000)]),
            (
                2,
                [
                    _circular_buffer(5000, 3000),
                    _allocate(300, 500, "L1_SMALL"),
                    _allocate(200, 2000),
                    _free(200),
                ],
            ),
            (3, [_allocate(400, 1600), _allocate_unsized(450, 64000), _free(450)]),
            (4, [_free(300)]),
            (5, [_start("ttnn.conv2d"), _circular_buffer(6000, 300)]),
            (6, [_circular_buffer(6000, 9000)]),
        )
    ],
}


@pytest.fixture(params=["single-host", "two-ranks"])
def report(request, tmp_path) -> Tuple[ReportRegistry, str]:
    """The run alone, and beside another rank's that the default rank must not read."""
    if request.param == "single-host":
        return _ranked_report(tmp_path, {0: _RUN}, unranked=_TABLES)
    return _ranked_report(tmp_path, {0: _RUN, 1: _retry_rows(1)})


@pytest.fixture
def instance_id(app, report) -> str:
    """The same database registered as the app instance its routes read."""
    registry, handle = report
    with app.app_context():
        db.session.add(
            InstanceTable(
                instance_id=_INSTANCE_ID,
                active_report={},
                profiler_path=str(
                    Path(str(registry.get(handle).profiler_path), PROFILER_DB_FILE)
                ),
            )
        )
        db.session.commit()
    return _INSTANCE_ID


def _get(client, instance_id: str, path: str, **params: object) -> List[Dict]:
    response = client.get(path, query_string={"instanceId": instance_id, **params})
    assert response.status_code == HTTPStatus.OK, response.get_data(as_text=True)
    return response.get_json()


def _fetch_operations(client, instance_id: str) -> List[Dict]:
    """`/api/operations` as `fetchOperations` hands it to the hooks: an input that an
    earlier operation output is read as that output."""
    output_by_tensor_id: Dict[int, Dict] = {}
    operations = _get(client, instance_id, "/api/operations")
    for operation in operations:
        output_by_tensor_id.update(
            (tensor["id"], tensor) for tensor in operation["outputs"]
        )
        operation["inputs"] = [
            output_by_tensor_id.get(tensor["id"], tensor)
            for tensor in operation["inputs"]
        ]
    return operations


def _fetch_devices(client, instance_id: str) -> List[Dict]:
    """`fetchDevices`: each id in its first row's place, with its last row's values."""
    rows = _get(client, instance_id, "/api/devices")
    return list({device["device_id"]: device for device in rows}.values())


def _snapshot(client, instance_id: str) -> Dict[int, List[Buffer]]:
    """`useL1PeakDecomposition`'s snapshot: each operation's L1 buffers, then its
    L1_SMALL ones."""
    snapshot: Dict[int, List[Buffer]] = {}
    for buffer_type in (BufferType.L1, BufferType.L1_SMALL):
        rows = _get(
            client,
            instance_id,
            "/api/operation-buffers",
            buffer_type=buffer_type.value,
        )
        for row in rows:
            snapshot.setdefault(row["id"], []).extend(
                Buffer(
                    row["id"],
                    entry["device_id"],
                    entry["address"],
                    entry["size"],
                    BufferType(entry["buffer_type"]),
                )
                for entry in row["buffers"]
                # `isL1BufferType` reads only a number, where `Buffer` would take a
                # name; the replay reconciles against no other type.
                if entry["buffer_type"] in _L1_VALUES
            )
    return snapshot


def _allocation_failures(operations: List[Dict]) -> Dict[int, Dict]:
    """`useAllocationFailures`' map, read from each operation's serialised error.

    The app builds it only once the memory report links to a performance report. That
    gate is the app's alone, so it is left out here.
    """
    failure_by_operation_id: Dict[int, Dict] = {}
    for operation in operations:
        failure = allocation_failures.parse_allocation_failure(
            (operation["error"] or {}).get("error_message")
        )
        if failure is not None:
            failure_by_operation_id[operation["id"]] = failure
    return failure_by_operation_id


_Read = TypeVar("_Read")


def _read_database(
    report: Tuple[ReportRegistry, str],
    build: Callable[[DatabaseQueries, RankScope], _Read],
) -> _Read:
    """What the tool reads from the database, at the rank the routes default to."""
    registry, handle = report
    with profiler_db(registry.get(handle)) as queries:
        return build(queries, rank_scope(queries, None))


def test_the_l1_peak_reads_the_database_as_the_app_reads_its_routes(
    client, report, instance_id
):
    operations = _fetch_operations(client, instance_id)
    devices = _fetch_devices(client, instance_id)
    device = devices[0]
    names = {operation["id"]: operation["name"] for operation in operations}
    lifetimes = l1_peak.resolve_address_lifetimes(_lifetime_tensors(operations), names)
    result = l1_peak.build_l1_peak(
        _graph_readers(operations),
        _snapshot(client, instance_id),
        lifetimes.last_use_by_address,
        bank_count=device["l1_num_banks"],
        capacity_bytes=device["worker_l1_size"],
    )

    read = _read_database(report, failures.report_l1_peak)

    assert read.result == result
    assert read.lifetimes == lifetimes
    assert read.names == names
    assert (read.device_id, read.device_count, read.bank_count) == (
        device["device_id"],
        len(devices),
        device["l1_num_banks"],
    )
    # Else a fixture that reached no resident of a kind would agree vacuously.
    entries = result.by_operation_id.values()
    assert all(
        any(getattr(entry, figure) for entry in entries)
        for figure in (
            "circular_buffer_bytes",
            "intermediate_tensor_bytes",
            "persistent_tensor_bytes",
            "stale_tensor_bytes",
        )
    )


def test_the_fallbacks_read_the_database_as_the_app_reads_its_routes(
    client, report, instance_id
):
    operations = _fetch_operations(client, instance_id)
    fallbacks = dram_fallbacks.dram_fallbacks(
        [_fallback_operation(operation) for operation in operations],
        _allocation_failures(operations),
    )

    read = _read_database(report, failures.report_dram_fallbacks)

    assert read.by_operation_id == fallbacks
    assert read.names == {
        operation["id"]: operation["name"] for operation in operations
    }
    assert {fallback["signal"] for fallback in fallbacks.values()} == {
        signal.value for signal in dram_fallbacks.DramFallbackSignal
    }
