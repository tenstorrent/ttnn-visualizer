# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""The circular-buffer port behind `operation_detail`'s `circular_buffers`. #2185

`test_agent_failure_parity.py` holds `summarise` to the app's `processMemoryAllocations`;
these hold the parts the shared golden cannot: `select_read`, which stands for a lookup
inline in a component, the response, and the `counter` ids `parse_graph` renames as the
app does before it reads a graph.
"""

import json
import math
from typing import List

import pytest
from ttnn_visualizer.agent import circular_buffers
from ttnn_visualizer.agent.bounds import MAX_LIMIT
from ttnn_visualizer.agent.captured_graph import parse_graph
from ttnn_visualizer.agent.circular_buffers import (
    cores_in_range,
    fold_devices,
    operation_circular_buffers,
    select_read,
    summarise,
)
from ttnn_visualizer.tests.captured_graphs import CapturedGraph


def _device_operation(name: str = "Tilize") -> CapturedGraph:
    """One device operation opened in the real order: it frees, then allocates."""
    return CapturedGraph().start(name).free_all()


def _addresses(nodes: List[object]) -> List[object]:
    return [
        row.address
        for snapshot in select_read(summarise(nodes))
        for row in snapshot.allocations
    ]


def _rows(nodes: List[object]) -> List[circular_buffers.CircularBufferRow]:
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


class TestSummarise:
    def test_older_counter_ids_read_as_ids_do(self):
        with_ids = _device_operation().cb().cb(200).end().nodes
        with_counters = [
            {
                **{key: value for key, value in node.items() if key != "id"},
                "counter": node["id"],
            }
            for node in with_ids
            if isinstance(node, dict)
        ]

        parsed = parse_graph(json.dumps(with_counters))

        assert summarise(parsed) == summarise(with_ids)
        assert [snapshot.operation_id for snapshot in summarise(parsed).snapshots] == [
            1
        ]

    def test_a_graph_without_any_ids_still_folds_one_scope(self):
        graph = _device_operation().cb(device_id=0).cb(device_id=1).end()
        nodes: List[object] = [
            {key: value for key, value in node.items() if key != "id"}
            for node in graph.nodes
            if isinstance(node, dict)
        ]

        (row,) = _rows(nodes)

        assert row.device_count == 2

    def test_a_mesh_s_copies_are_one_row(self):
        graph = _device_operation()
        for device in range(4):
            graph.cb(device_id=device)

        (row,) = _rows(graph.end().nodes)

        # Node 3 is the first device's: capture start, scope start and free come first.
        assert (row.device_count, row.core_count, row.node_id) == (4, 4, 3)

    def test_a_device_id_as_a_string_is_the_same_device(self):
        nodes = _device_operation().cb(device_id=1).cb(device_id="1").end().nodes

        assert [row.device_count for row in _rows(nodes)] == [1, 1]

    def test_a_device_id_after_javascript_s_whitespace_is_the_same_device(self):
        nodes = _device_operation().cb(device_id=1).cb(device_id="\ufeff1").end().nodes

        assert [row.device_count for row in _rows(nodes)] == [1, 1]

    def test_a_repeat_on_one_device_is_its_own_row(self):
        graph = _device_operation()
        for device in (0, 1, 0, 1):
            graph.cb(device_id=device)

        assert [row.device_count for row in _rows(graph.end().nodes)] == [2, 2]

    def test_a_globally_allocated_buffer_is_a_row_without_bytes(self):
        nodes = (
            _device_operation()
            .cb(size=1024)
            .cb(200, size=8192, globally_allocated="1")
            .end()
            .nodes
        )

        (snapshot,) = select_read(summarise(nodes))

        assert [row.globally_allocated for row in snapshot.allocations] == [False, True]
        assert snapshot.max_bytes == 1024

    def test_an_empty_or_missing_range_is_unattributed(self):
        nodes = (
            _device_operation()
            .cb(size=1024, core_range_set="{}")
            .cb(200, size=2048, core_range_set=None)
            .end()
            .nodes
        )

        (snapshot,) = select_read(summarise(nodes))

        assert snapshot.by_core == {"?": 3072}
        assert (snapshot.max_bytes, snapshot.unattributed_bytes) == (0, 3072)

    def test_per_core_bytes_take_the_fullest_device(self):
        one_core = "{[0-0 - 0-0]}"
        nodes = (
            _device_operation()
            .cb(size=1024, core_range_set=one_core, device_id=0)
            .cb(200, size=2048, core_range_set=one_core, device_id=0)
            .cb(size=1024, core_range_set=one_core, device_id=1)
            .end()
            .nodes
        )

        (snapshot,) = select_read(summarise(nodes))

        assert snapshot.by_core == {"0,0": 3072}

    def test_an_unparseable_size_is_not_a_figure(self):
        nodes = _device_operation().cb().cb(200, size="abc").end().nodes

        (snapshot,) = select_read(summarise(nodes))

        assert math.isnan(snapshot.by_core["0,0"])
        assert snapshot.max_bytes == 0
        response = operation_circular_buffers(nodes)
        assert (
            response["device_operations"][0]["circular_buffers"][1]["size_per_core"]
            is None
        )

    @pytest.mark.parametrize("digits", ["9" * 309, "9" * 5000])
    def test_a_figure_past_the_float_range_is_no_figure(self, digits):
        # `parseInt` reads it as Infinity, which the answer cannot carry as a number.
        nodes = _device_operation().cb(digits, size=digits).end().nodes

        (row,) = operation_circular_buffers(nodes)["device_operations"][0][
            "circular_buffers"
        ]

        assert (row["address"], row["size_per_core"]) == (None, None)

    def test_an_address_past_2_to_the_53_rounds_as_the_app_s_does(self):
        nodes = _device_operation().cb("9007199254740993").end().nodes

        (row,) = operation_circular_buffers(nodes)["device_operations"][0][
            "circular_buffers"
        ]

        assert row["address"] == 9007199254740992

    def test_the_first_node_is_skipped_as_the_app_skips_it(self):
        nodes = CapturedGraph().start("Tilize").cb().end().nodes[1:]

        assert summarise(nodes).snapshots == []

    def test_a_free_all_snapshots_the_buffers_it_frees(self):
        """The older order; every local capture frees before it allocates instead."""
        nodes = CapturedGraph().start("Tilize").cb().free_all().end().nodes

        (snapshot,) = summarise(nodes).snapshots

        assert [row.address for row in snapshot.allocations] == [100]

    def test_a_second_batch_in_one_scope_is_dropped_as_the_app_drops_it(self):
        """The first batch is snapshotted at the free that starts the second, so the
        scope's end, finding a snapshot already taken, keeps the first. No local capture
        has two batches in one scope."""
        nodes = _device_operation().cb().free_all().cb(200).end().nodes

        (snapshot,) = summarise(nodes).snapshots

        assert [row.address for row in snapshot.allocations] == [100]

    def test_a_buffer_outside_any_scope_is_never_snapshotted(self):
        nodes = CapturedGraph().cb().free_all().nodes

        assert summarise(nodes) == circular_buffers.Summary([], set())

    def test_a_node_that_is_not_a_dict_or_has_no_params_is_passed_over(self):
        nodes = (
            _device_operation()
            .add("not a node")
            .add({"node_type": "circular_buffer_allocate", "params": None})
            .cb(200)
            .end()
            .nodes
        )

        assert _addresses(nodes) == [200]


class TestFreeAll:
    def test_a_free_all_does_not_take_the_last_device_operation_s_buffers(self):
        """Every capture frees before it allocates, so the second scope's free releases
        the first's buffers; the app took them as the second's until #2185."""
        nodes = (
            _device_operation("Embeddings")
            .cb(100, device_id=0)
            .end()
            .start("Embeddings")
            .free_all()
            .cb(200, device_id=1)
            .end()
            .nodes
        )

        snapshots = select_read(summarise(nodes))

        assert [
            [row.address for row in snapshot.allocations] for snapshot in snapshots
        ] == [[100], [200]]


def _per_device(
    graph: CapturedGraph, name: str, devices: List[object], addresses: List[int]
) -> CapturedGraph:
    """One scope per device, as older mesh captures write them; the last device
    allocates in the opposite order, as devices can."""
    for device in devices:
        graph.start(name).free_all(device)
        order = addresses if device != devices[-1] else list(reversed(addresses))
        for address in order:
            graph.cb(address, device_id=device)
        graph.end()
    return graph


class TestFoldDevices:
    def test_each_device_s_scope_with_the_same_buffers_is_one_entry(self):
        nodes = _per_device(CapturedGraph(), "Matmul", [0, 1, 2, 3], [100, 200]).nodes

        (entry,) = fold_devices(select_read(summarise(nodes)))

        assert [row.address for row in entry.allocations] == [100, 200]
        assert [row.device_count for row in entry.allocations] == [4, 4]
        response = operation_circular_buffers(nodes)
        assert response["circular_buffer_count"] == 2
        assert response["device_operations"][0]["device_count"] == 4

    def test_a_repeat_on_a_device_already_folded_is_another_entry(self):
        nodes = _per_device(CapturedGraph(), "Tilize", [0, 1, 0, 1], [100]).nodes

        entries = fold_devices(select_read(summarise(nodes)))

        assert [entry.allocations[0].device_count for entry in entries] == [2, 2]

    def test_a_device_major_order_folds_as_a_launch_major_one_does(self):
        """A per-device `launch_op` wrapping several device operations writes each
        device's launches together, so the next device's first launch must fold into
        the earliest entry it fits, not the latest."""
        graph = CapturedGraph()
        for device in [0, 0, 1, 1]:
            _per_device(graph, "Tilize", [device], [100])

        entries = fold_devices(select_read(summarise(graph.nodes)))

        assert [entry.allocations[0].device_count for entry in entries] == [2, 2]
        assert operation_circular_buffers(graph.nodes)["circular_buffer_count"] == 2

    def test_one_device_s_repeated_launches_are_not_folded(self):
        nodes = _per_device(CapturedGraph(), "Tilize", [None, None], [100]).nodes

        assert len(fold_devices(select_read(summarise(nodes)))) == 2

    def test_different_buffers_or_names_are_not_folded(self):
        graph = CapturedGraph()
        _per_device(graph, "ReduceScatter", [0], [100])
        _per_device(graph, "ReduceScatter", [1], [300])
        _per_device(graph, "AllGather", [2], [100])

        assert len(fold_devices(select_read(summarise(graph.nodes)))) == 3

    def test_it_leaves_the_snapshots_it_folds_unchanged(self):
        snapshots = select_read(
            summarise(_per_device(CapturedGraph(), "Matmul", [0, 1], [100]).nodes)
        )

        fold_devices(snapshots)

        assert [snapshot.allocations[0].device_count for snapshot in snapshots] == [
            1,
            1,
        ]


class TestSelectRead:
    def test_an_enclosing_scope_s_copy_of_its_child_s_buffers_is_left_out(self):
        nodes = (
            CapturedGraph()
            .start("ttnn::to_layout")
            .start("ttnn::tilize")
            .start("Tilize")
            .free_all()
            .cb()
            .end()
            .end()
            .end()
            .nodes
        )
        summary = summarise(nodes)

        assert [snapshot.name for snapshot in summary.snapshots] == [
            "Tilize",
            "ttnn::tilize",
            "ttnn::to_layout",
        ]
        assert [snapshot.name for snapshot in select_read(summary)] == ["Tilize"]

    def test_sibling_device_operations_are_each_kept(self):
        nodes = (
            CapturedGraph()
            .start("ttnn::matmul")
            .start("Matmul")
            .free_all()
            .cb()
            .end()
            .start("Untilize")
            .free_all()
            .cb(200)
            .end()
            .end()
            .nodes
        )

        assert [snapshot.name for snapshot in select_read(summarise(nodes))] == [
            "Matmul",
            "Untilize",
        ]


class TestUnrecordedLaunches:
    """A graph records a program's circular buffers only at its first launch."""

    def test_a_relaunch_that_recorded_none_is_counted_not_dropped(self):
        nodes = (
            _device_operation("Matmul")
            .cb()
            .cb(200)
            .end()
            .start("Matmul")
            .free_all()
            .end()
            .start("Matmul")
            .free_all()
            .end()
            .nodes
        )

        response = operation_circular_buffers(nodes)

        assert response["device_operation_count"] == 1
        assert response["circular_buffer_count"] == 2
        assert response["unrecorded_launch_count"] == 2
        assert response["unrecorded_device_operations"] == [
            {"name": "Matmul", "launch_count": 2, "device_count": 1}
        ]

    def test_a_mesh_s_per_device_relaunches_are_one_launch(self):
        graph = CapturedGraph()
        for device in [0, 1, 0, 1]:
            graph.start("Untilize").free_all(device).end()

        response = operation_circular_buffers(graph.nodes)

        assert response["device_operation_count"] == 0
        assert response["unrecorded_launch_count"] == 2
        assert response["unrecorded_device_operations"] == [
            {"name": "Untilize", "launch_count": 2, "device_count": 2}
        ]

    def test_an_enclosing_scope_is_not_a_launch(self):
        nodes = (
            CapturedGraph()
            .start("ttnn::matmul")
            .start("Matmul")
            .free_all()
            .cb()
            .end()
            .end()
            .nodes
        )

        response = operation_circular_buffers(nodes)

        assert response["unrecorded_launch_count"] == 0
        assert response["unrecorded_device_operations"] == []

    def test_a_graph_that_launched_nothing_is_a_real_zero(self):
        nodes = CapturedGraph().start("ttnn::reshape").end().nodes

        response = operation_circular_buffers(nodes)

        assert response["circular_buffer_count"] == 0
        assert response["unrecorded_launch_count"] == 0


class TestResponse:
    def test_it_counts_rows_and_globally_allocated_ones(self):
        nodes = (
            _device_operation()
            .cb(device_id=0)
            .cb(device_id=1)
            .cb(200, globally_allocated="1")
            .end()
            .nodes
        )

        response = operation_circular_buffers(nodes)

        assert response["circular_buffer_count"] == 2
        assert response["globally_allocated_count"] == 1
        assert response["device_operation_count"] == 1
        assert response["size_unit"] == "bytes_per_bank"
        assert "truncated" not in response

    def test_a_long_core_range_is_cut_and_its_cores_still_counted(self):
        # Every core its own rectangle, as Blackhole captures write them.
        cores = [(x, y) for x in range(10) for y in range(8)]
        long_range = (
            "{" + ", ".join(f"[(x={x},y={y}) - (x={x},y={y})]" for x, y in cores) + "}"
        )
        nodes = _device_operation().cb(core_range_set=long_range).cb(200).end().nodes

        long_row, short_row = operation_circular_buffers(nodes)["device_operations"][0][
            "circular_buffers"
        ]

        limit = circular_buffers.MAX_CORE_RANGE_SET_CHARS
        assert long_row["core_range_set"] == long_range[:limit]
        assert long_row["core_range_set_full_length"] == len(long_range)
        assert long_row["core_count"] == len(cores)
        assert "core_range_set_full_length" not in short_row

    def test_rows_are_capped_across_device_operations_and_counted_in_full(self):
        per_operation = 30
        graph = CapturedGraph().start("ttnn::op")
        for operation in range(5):
            graph.start(f"Device{operation}").free_all()
            for buffer in range(per_operation):
                graph.cb(1000 + buffer)
            graph.end()

        response = operation_circular_buffers(graph.end().nodes)

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
