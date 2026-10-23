# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""The circular-buffer port behind `operation_detail`'s `circular_buffers`. #2185

`test_agent_failure_parity.py` holds `summarise` to the app's `processMemoryAllocations`;
these hold the parts the shared golden cannot: `select_read`, which stands for a lookup
inline in a component, the response, and the `counter` ids the app renames before it
reads a graph.
"""

import math
from typing import Dict, List, Optional

import pytest
from ttnn_visualizer.agent import circular_buffers
from ttnn_visualizer.agent.bounds import MAX_LIMIT
from ttnn_visualizer.agent.circular_buffers import (
    _js_template,
    _parse_int,
    cores_in_range,
    fold_devices,
    operation_circular_buffers,
    select_read,
    summarise,
)

_CAPTURE_START: Dict = {"id": 0, "node_type": "capture_start", "params": {}}


def _start(node_id: int, name: str) -> Dict:
    return {"id": node_id, "node_type": "function_start", "params": {"name": name}}


def _end(node_id: int) -> Dict:
    return {"id": node_id, "node_type": "function_end", "params": {}}


def _free_all(node_id: int) -> Dict:
    return {"id": node_id, "node_type": "circular_buffer_deallocate_all", "params": {}}


def _cb(
    node_id: int,
    address: int = 100,
    size: int = 4096,
    core_range_set: Optional[str] = "{[0-0 - 1-1]}",
    device_id: object = None,
    globally_allocated: str = "0",
) -> Dict:
    params: Dict = {
        "address": str(address),
        "size": str(size),
        "globally_allocated": globally_allocated,
    }
    if core_range_set is not None:
        params["core_range_set"] = core_range_set
    if device_id is not None:
        params["device_id"] = device_id
    return {"id": node_id, "node_type": "circular_buffer_allocate", "params": params}


def _in_scope(*body: Dict, name: str = "Tilize") -> List[Dict]:
    """One device operation, in the real order: free all, allocate, end."""
    return [_CAPTURE_START, _start(1, name), _free_all(2), *body, _end(99)]


def _rows(nodes: List[Dict]) -> List[circular_buffers.CircularBufferRow]:
    return [
        row
        for snapshot in select_read(summarise(nodes))
        for row in snapshot.allocations
    ]


class TestCoresInRange:
    @pytest.mark.parametrize(
        ("range_set", "count"),
        [
            ("{[(x=0,y=0) - (x=7,y=7)]}", 64),
            ("{[0-0 - 7-7]}", 64),
            ("{[0-1 - 10-4], [0-5 - 5-5]}", 50),
            # Overlapping rectangles count each core once.
            ("{[0-0 - 1-1], [1-1 - 2-2]}", 7),
            ("{[(x=3,y=3) - (x=0,y=0)]}", 16),
            ("{}", 0),
            ("", 0),
        ],
    )
    def test_it_counts_the_distinct_cores(self, range_set, count):
        assert len(cores_in_range(range_set)) == count

    def test_both_syntaxes_name_the_same_cores(self):
        assert cores_in_range("{[(x=1,y=2) - (x=2,y=2)]}") == ((1, 2), (2, 2))
        assert cores_in_range("{[1-2 - 2-2]}") == ((1, 2), (2, 2))

    @pytest.mark.parametrize("range_set", [None, 7, ["{[0-0 - 0-0]}"]])
    def test_a_range_that_is_not_a_string_is_no_cores(self, range_set):
        assert cores_in_range(range_set) == ()

    def test_other_scripts_digits_are_not_coordinates(self):
        # JavaScript's `\d` is ASCII only, so neither side reads these.
        assert cores_in_range("{[١-١ - ٢-٢]}") == ()


class TestJavaScriptReads:
    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            ("4096", 4096),
            (" 4096", 4096),
            ("4096abc", 4096),
            ("-12", -12),
            (2048, 2048),
            (2048.7, 2048),
            ("0x10", 0),
            ("٤", math.nan),
            ("abc", math.nan),
            ("", math.nan),
            (None, math.nan),
        ],
    )
    def test_parse_int_reads_as_parse_int_does(self, value, expected):
        parsed = _parse_int(value)
        if isinstance(expected, float) and math.isnan(expected):
            assert math.isnan(parsed)
        else:
            assert parsed == expected

    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            (12, "12"),
            (12.0, "12"),
            (math.nan, "NaN"),
            (None, "null"),
            (True, "true"),
            ("{}", "{}"),
            (circular_buffers._MISSING, "undefined"),
        ],
    )
    def test_a_template_renders_as_javascript_does(self, value, expected):
        assert _js_template(value) == expected


class TestSummarise:
    def test_older_counter_ids_read_as_ids_do(self):
        with_ids = _in_scope(_cb(3), _cb(4, address=200))
        with_counters = [
            {
                **{key: value for key, value in node.items() if key != "id"},
                "counter": node["id"],
            }
            for node in with_ids
        ]

        assert summarise(with_counters) == summarise(with_ids)
        assert [
            snapshot.operation_id for snapshot in summarise(with_counters).snapshots
        ] == [1]

    def test_a_graph_without_any_ids_still_folds_one_scope(self):
        nodes = [
            {key: value for key, value in node.items() if key != "id"}
            for node in _in_scope(_cb(3, device_id=0), _cb(4, device_id=1))
        ]

        (row,) = _rows(nodes)

        assert row.device_count == 2

    def test_a_mesh_s_copies_are_one_row(self):
        nodes = _in_scope(*(_cb(10 + device, device_id=device) for device in range(4)))

        (row,) = _rows(nodes)

        assert (row.device_count, row.core_count, row.node_id) == (4, 4, 10)

    def test_a_device_id_as_a_string_is_the_same_device(self):
        nodes = _in_scope(_cb(3, device_id=1), _cb(4, device_id="1"))

        assert [row.device_count for row in _rows(nodes)] == [1, 1]

    def test_a_repeat_on_one_device_is_its_own_row(self):
        nodes = _in_scope(
            _cb(3, device_id=0),
            _cb(4, device_id=1),
            _cb(5, device_id=0),
            _cb(6, device_id=1),
        )

        assert [row.device_count for row in _rows(nodes)] == [2, 2]

    def test_a_globally_allocated_buffer_is_a_row_without_bytes(self):
        nodes = _in_scope(_cb(3, size=1024), _cb(4, size=8192, globally_allocated="1"))

        (snapshot,) = select_read(summarise(nodes))

        assert [row.globally_allocated for row in snapshot.allocations] == [False, True]
        assert snapshot.max_bytes == 1024

    def test_an_empty_or_missing_range_is_unattributed(self):
        nodes = _in_scope(
            _cb(3, size=1024, core_range_set="{}"),
            _cb(4, address=200, size=2048, core_range_set=None),
        )

        (snapshot,) = select_read(summarise(nodes))

        assert snapshot.by_core == {"?": 3072}
        assert (snapshot.max_bytes, snapshot.unattributed_bytes) == (0, 3072)

    def test_per_core_bytes_take_the_fullest_device(self):
        nodes = _in_scope(
            _cb(3, size=1024, core_range_set="{[0-0 - 0-0]}", device_id=0),
            _cb(4, address=200, size=2048, core_range_set="{[0-0 - 0-0]}", device_id=0),
            _cb(5, size=1024, core_range_set="{[0-0 - 0-0]}", device_id=1),
        )

        (snapshot,) = select_read(summarise(nodes))

        assert snapshot.by_core == {"0,0": 3072}

    def test_an_unparseable_size_is_not_a_figure(self):
        nodes = _in_scope(
            _cb(3),
            {
                **_cb(4, address=200),
                "params": {**_cb(4)["params"], "address": "200", "size": "abc"},
            },
        )

        (snapshot,) = select_read(summarise(nodes))

        assert math.isnan(snapshot.by_core["0,0"])
        assert snapshot.max_bytes == 0
        response = operation_circular_buffers(nodes)
        assert (
            response["device_operations"][0]["circular_buffers"][1]["size_per_core"]
            is None
        )

    def test_the_first_node_is_skipped_as_the_app_skips_it(self):
        nodes = [_start(1, "Tilize"), _cb(3), _end(99)]

        assert summarise(nodes).snapshots == []

    def test_a_free_all_snapshots_the_buffers_it_frees(self):
        """The older order; every local capture frees before it allocates instead."""
        nodes = [_CAPTURE_START, _start(1, "Tilize"), _cb(3), _free_all(4), _end(99)]

        (snapshot,) = summarise(nodes).snapshots

        assert [row.node_id for row in snapshot.allocations] == [3]

    def test_a_second_batch_in_one_scope_is_dropped_as_the_app_drops_it(self):
        """The first batch is snapshotted at the free that starts the second, so the
        scope's end, finding a snapshot already taken, keeps the first. No local capture
        has two batches in one scope."""
        nodes = _in_scope(_cb(3), _free_all(4), _cb(5, address=200))

        (snapshot,) = summarise(nodes).snapshots

        assert [row.node_id for row in snapshot.allocations] == [3]

    def test_a_buffer_outside_any_scope_is_never_snapshotted(self):
        nodes = [_CAPTURE_START, _cb(1), _free_all(2)]

        assert summarise(nodes) == circular_buffers.Summary([], set())

    def test_a_node_that_is_not_a_dict_or_has_no_params_is_passed_over(self):
        nodes = _in_scope(
            "not a node",
            {"id": 3, "node_type": "circular_buffer_allocate", "params": None},
            _cb(4),
        )

        assert [row.node_id for row in _rows(nodes)] == [4]


class TestFreeAll:
    def test_a_free_all_does_not_take_the_last_device_operation_s_buffers(self):
        """Every capture frees before it allocates, so the second scope's free releases
        the first's buffers; the app took them as the second's until #2185."""
        nodes = [
            _CAPTURE_START,
            _start(1, "Embeddings"),
            _free_all(2),
            _cb(3, address=100, device_id=0),
            _end(4),
            _start(5, "Embeddings"),
            _free_all(6),
            _cb(7, address=200, device_id=1),
            _end(8),
        ]

        snapshots = select_read(summarise(nodes))

        assert [
            [row.node_id for row in snapshot.allocations] for snapshot in snapshots
        ] == [[3], [7]]


def _per_device(
    name: str, devices: List[object], addresses: List[int], first_id: int
) -> List[Dict]:
    """One scope per device, as older mesh captures write them."""
    nodes: List[Dict] = []
    node_id = first_id
    for device in devices:
        nodes += [_start(node_id, name), _free_all(node_id + 1)]
        node_id += 2
        order = addresses if device != devices[-1] else list(reversed(addresses))
        for address in order:
            nodes.append(_cb(node_id, address=address, device_id=device))
            node_id += 1
        nodes.append(_end(node_id))
        node_id += 1
    return nodes


class TestFoldDevices:
    def test_each_device_s_scope_with_the_same_buffers_is_one_entry(self):
        """The last device allocates them in the opposite order, as devices can."""
        nodes = [_CAPTURE_START, *_per_device("Matmul", [0, 1, 2, 3], [100, 200], 10)]

        (entry,) = fold_devices(select_read(summarise(nodes)))

        assert [row.address for row in entry.allocations] == [100, 200]
        assert [row.device_count for row in entry.allocations] == [4, 4]
        response = operation_circular_buffers(nodes)
        assert response["circular_buffer_count"] == 2
        assert response["device_operations"][0]["device_count"] == 4

    def test_a_repeat_on_a_device_already_folded_is_another_entry(self):
        nodes = [_CAPTURE_START, *_per_device("Tilize", [0, 1, 0, 1], [100], 10)]

        entries = fold_devices(select_read(summarise(nodes)))

        assert [entry.allocations[0].device_count for entry in entries] == [2, 2]

    def test_one_device_s_repeated_launches_are_not_folded(self):
        nodes = [_CAPTURE_START, *_per_device("Tilize", [None, None], [100], 10)]

        assert len(fold_devices(select_read(summarise(nodes)))) == 2

    def test_different_buffers_or_names_are_not_folded(self):
        nodes = [
            _CAPTURE_START,
            *_per_device("ReduceScatter", [0], [100], 10),
            *_per_device("ReduceScatter", [1], [300], 20),
            *_per_device("AllGather", [2], [100], 30),
        ]

        assert len(fold_devices(select_read(summarise(nodes)))) == 3

    def test_it_leaves_the_snapshots_it_folds_unchanged(self):
        snapshots = select_read(
            summarise([_CAPTURE_START, *_per_device("Matmul", [0, 1], [100], 10)])
        )

        fold_devices(snapshots)

        assert [snapshot.allocations[0].device_count for snapshot in snapshots] == [
            1,
            1,
        ]


class TestSelectRead:
    def test_an_enclosing_scope_s_copy_of_its_child_s_buffers_is_left_out(self):
        nodes = [
            _CAPTURE_START,
            _start(1, "ttnn::to_layout"),
            _start(2, "ttnn::tilize"),
            _start(3, "Tilize"),
            _free_all(4),
            _cb(5),
            _end(6),
            _end(7),
            _end(8),
        ]
        summary = summarise(nodes)

        assert [snapshot.name for snapshot in summary.snapshots] == [
            "Tilize",
            "ttnn::tilize",
            "ttnn::to_layout",
        ]
        assert [snapshot.name for snapshot in select_read(summary)] == ["Tilize"]

    def test_sibling_device_operations_are_each_kept(self):
        nodes = [
            _CAPTURE_START,
            _start(1, "ttnn::matmul"),
            _start(2, "Matmul"),
            _free_all(3),
            _cb(4),
            _end(5),
            _start(6, "Untilize"),
            _free_all(7),
            _cb(8, address=200),
            _end(9),
            _end(10),
        ]

        assert [snapshot.name for snapshot in select_read(summarise(nodes))] == [
            "Matmul",
            "Untilize",
        ]


class TestResponse:
    def test_it_counts_rows_and_globally_allocated_ones(self):
        nodes = _in_scope(
            _cb(3, device_id=0),
            _cb(4, device_id=1),
            _cb(5, address=200, globally_allocated="1"),
        )

        response = operation_circular_buffers(nodes)

        assert response["circular_buffer_count"] == 2
        assert response["globally_allocated_count"] == 1
        assert response["device_operation_count"] == 1
        assert response["size_unit"] == "bytes_per_core"
        assert "truncated" not in response

    def test_rows_are_capped_across_device_operations_and_counted_in_full(self):
        per_operation = 30
        nodes: List[Dict] = [_CAPTURE_START, _start(1, "ttnn::op")]
        node_id = 10
        for operation in range(5):
            nodes += [_start(node_id, f"Device{operation}"), _free_all(node_id + 1)]
            node_id += 2
            for buffer in range(per_operation):
                nodes.append(_cb(node_id, address=1000 + buffer))
                node_id += 1
            nodes.append(_end(node_id))
            node_id += 1
        nodes.append(_end(node_id))

        response = operation_circular_buffers(nodes)

        listed = [
            row
            for operation in response["device_operations"]
            for row in operation["circular_buffers"]
        ]
        assert len(listed) == MAX_LIMIT
        assert response["circular_buffer_count"] == 5 * per_operation
        assert response["device_operation_count"] == 5
        assert response["truncated"] is True
        assert [
            operation["circular_buffer_count"]
            for operation in response["device_operations"]
        ] == [per_operation] * 4
