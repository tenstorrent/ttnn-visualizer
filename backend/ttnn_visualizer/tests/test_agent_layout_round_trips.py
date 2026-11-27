# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Chains of layout and memory moves that undo themselves: `layout_round_trips`. #2174

The search over pure inputs first, then the tool over a memory report database. The
linked answer, with device time, is in `test_agent_linking.py`.
"""

import pytest
from ttnn_visualizer.agent import linking, server
from ttnn_visualizer.agent.layout_round_trips import (
    MAX_ROUND_TRIP_MOVES,
    TensorState,
    enum_suffix,
    find_round_trips,
    is_layout_move,
    move_operation_ids,
    tensor_state,
)
from ttnn_visualizer.tests.memory_report_db import load_memory_report

_DRAM = TensorState("ROW_MAJOR", "DRAM", "INTERLEAVED")
_TILED = TensorState("TILE", "DRAM", "INTERLEAVED")
_SHARDED = TensorState("TILE", "L1", "HEIGHT_SHARDED")
_TILED_L1 = TensorState("TILE", "L1", "INTERLEAVED")


def _chain(states, moves=None):
    """Moves 1..n in a line, move i reading tensor 10+i-1 and writing 10+i."""
    count = len(states) - 1
    operation_ids = list(moves or range(1, count + 1))
    inputs = {
        operation_id: [9 + index] for index, operation_id in enumerate(operation_ids, 1)
    }
    outputs = {
        operation_id: [10 + index]
        for index, operation_id in enumerate(operation_ids, 1)
    }
    state_by_tensor = {9 + index: state for index, state in enumerate(states, 1)}
    return operation_ids, inputs, outputs, state_by_tensor


def _trips(states):
    return [trip.operation_ids for trip in find_round_trips(*_chain(states))]


class TestNames:
    @pytest.mark.parametrize(
        "name",
        ["ttnn.to_layout", "ttnn::tilize", "TTNN.UNTILIZE", "ttnn.reshard", "move"],
    )
    def test_a_move_is_recognised_with_or_without_its_prefix(self, name):
        assert is_layout_move(name)

    @pytest.mark.parametrize(
        "name", ["ttnn.typecast", "ttnn.to_dtype", "ttnn.matmul", "ttnn.moved", None]
    )
    def test_anything_else_is_not_a_move(self, name):
        assert not is_layout_move(name)

    @pytest.mark.parametrize("value", ["Layout.TILE", "Layout::TILE", "TILE", "tile"])
    def test_each_spelling_of_a_layout_reads_the_same(self, value):
        assert enum_suffix(value) == "TILE"

    def test_the_memory_layout_comes_from_the_parsed_memory_config(self):
        state = tensor_state(
            "Layout.TILE",
            "L1",
            {"memory_layout": "TensorMemoryLayout::HEIGHT_SHARDED", "shard_spec": {}},
        )

        assert state == _SHARDED

    def test_an_unparsed_memory_config_leaves_the_memory_layout_unknown(self):
        assert tensor_state("Layout.TILE", None, None) == TensorState(
            "TILE", None, None
        )


class TestFindRoundTrips:
    def test_a_tilize_undone_by_an_untilize_is_one(self):
        assert _trips([_DRAM, _TILED, _DRAM]) == [[1, 2]]

    def test_a_shard_and_unshard_is_one(self):
        assert _trips([_TILED, _SHARDED, _TILED]) == [[1, 2]]

    def test_three_moves_through_l1_are_one(self):
        assert _trips([_DRAM, _TILED, _TILED_L1, _DRAM]) == [[1, 2, 3]]

    def test_a_chain_that_does_not_return_is_none(self):
        assert _trips([_DRAM, _TILED, _SHARDED]) == []

    def test_moves_that_change_nothing_seen_are_not_a_round_trip(self):
        # Two reshards whose shard specs the state cannot see.
        assert _trips([_SHARDED, _SHARDED, _SHARDED]) == []

    def test_a_round_trip_is_the_shortest_chain_that_returns(self):
        # Tilize, untilize, tilize: one round trip and a move left over, which
        # starts nothing because its output never comes back.
        assert _trips([_DRAM, _TILED, _DRAM, _TILED]) == [[1, 2]]

    def test_back_to_back_round_trips_are_both_listed(self):
        assert _trips([_DRAM, _TILED, _DRAM, _SHARDED, _DRAM]) == [[1, 2], [3, 4]]

    def test_a_trip_is_not_listed_again_from_its_second_move(self):
        # From move 2, TILED -> DRAM -> TILED would be a round trip of its own.
        assert _trips([_DRAM, _TILED, _DRAM, _TILED, _DRAM]) == [[1, 2], [3, 4]]

    def test_a_chain_longer_than_the_bound_is_not_found(self):
        states = [_DRAM] + [_TILED] * MAX_ROUND_TRIP_MOVES + [_DRAM]

        assert _trips(states) == []

    def test_a_chain_at_the_bound_is_found(self):
        states = [_DRAM] + [_TILED] * (MAX_ROUND_TRIP_MOVES - 1) + [_DRAM]

        assert _trips(states) == [list(range(1, MAX_ROUND_TRIP_MOVES + 1))]

    def test_each_branch_of_a_fan_is_searched(self):
        # Move 1 tilizes tensor 10 into 11, which moves 2 and 3 both read: 2
        # untilizes it back, 3 shards it and never returns.
        inputs = {1: [10], 2: [11], 3: [11]}
        outputs = {1: [11], 2: [12], 3: [13]}
        states = {10: _DRAM, 11: _TILED, 12: _DRAM, 13: _SHARDED}

        trips = find_round_trips([1, 2, 3], inputs, outputs, states)

        assert [trip.operation_ids for trip in trips] == [[1, 2]]
        assert trips[0].tensor_ids == [10, 11, 12]
        assert trips[0].states == [_DRAM, _TILED, _DRAM]

    def test_a_tensor_with_no_state_ends_the_chain(self):
        operation_ids, inputs, outputs, states = _chain([_DRAM, _TILED, _DRAM])
        del states[11]

        assert find_round_trips(operation_ids, inputs, outputs, states) == []


class TestMoveOperationIds:
    def test_only_single_tensor_moves_to_a_new_tensor_are_moves(self):
        names = {
            1: "ttnn.to_layout",
            2: "ttnn.to_memory_config",
            3: "ttnn.to_layout",
            4: "ttnn.matmul",
            5: "ttnn::deallocate",
            6: "ttnn.untilize",
        }
        inputs = {1: [10], 2: [11], 3: [12, 13], 4: [14], 6: [16]}
        outputs = {1: [20], 2: [11], 3: [22], 4: [24], 6: [26]}

        # 2 hands back its input, 3 reads two tensors, 4 is no move, 5 is not kept.
        assert move_operation_ids(names, {1, 2, 3, 4, 6}, inputs, outputs) == [1, 6]


_SCHEMA = """
CREATE TABLE operations (operation_id int UNIQUE, name text, duration float);
CREATE TABLE tensors (
    tensor_id int UNIQUE, shape text, dtype text, layout text, memory_config text,
    device_id int, address int, buffer_type text
);
CREATE TABLE input_tensors (operation_id int, input_index int, tensor_id int);
CREATE TABLE output_tensors (operation_id int, output_index int, tensor_id int);
"""

_INTERLEAVED_DRAM = (
    "MemoryConfig(memory_layout=TensorMemoryLayout::INTERLEAVED,"
    "buffer_type=BufferType::DRAM,shard_spec=std::nullopt)"
)
_HEIGHT_SHARDED_L1 = (
    "MemoryConfig(memory_layout=TensorMemoryLayout::HEIGHT_SHARDED,"
    "buffer_type=BufferType::L1,shard_spec=std::nullopt)"
)


def _tensor(tensor_id, layout, memory_config):
    return (
        "tensors",
        (tensor_id, "Shape([1, 32])", "DataType.BFLOAT16", layout, memory_config, 0)
        + (None, None),
    )


# Tensor 10 is handed to the model: nothing produces it, so no edge reaches op 1.
# Op 1 tilizes it, op 2 untilizes it back; op 3 shards that, op 4 adds, and op 5
# unshards the sum, which is not a round trip because op 4 sits between.
_ROUND_TRIP_ROWS = [
    ("operations", (1, "ttnn.to_layout", 0.1)),
    ("operations", (2, "ttnn::to_layout", 0.1)),
    ("operations", (3, "ttnn.interleaved_to_sharded", 0.1)),
    ("operations", (4, "ttnn.add", 0.1)),
    ("operations", (5, "ttnn.sharded_to_interleaved", 0.1)),
    _tensor(10, "Layout.ROW_MAJOR", _INTERLEAVED_DRAM),
    _tensor(11, "Layout::TILE", _INTERLEAVED_DRAM),
    _tensor(12, "ROW_MAJOR", _INTERLEAVED_DRAM),
    _tensor(13, "Layout.ROW_MAJOR", _HEIGHT_SHARDED_L1),
    _tensor(14, "Layout.ROW_MAJOR", _HEIGHT_SHARDED_L1),
    _tensor(15, "Layout.ROW_MAJOR", _INTERLEAVED_DRAM),
    ("input_tensors", (1, 0, 10)),
    ("output_tensors", (1, 0, 11)),
    ("input_tensors", (2, 0, 11)),
    ("output_tensors", (2, 0, 12)),
    ("input_tensors", (3, 0, 12)),
    ("output_tensors", (3, 0, 13)),
    ("input_tensors", (4, 0, 13)),
    ("output_tensors", (4, 0, 14)),
    ("input_tensors", (5, 0, 14)),
    ("output_tensors", (5, 0, 15)),
]


@pytest.fixture
def round_trip_report(tmp_path):
    return load_memory_report(tmp_path, _SCHEMA, _ROUND_TRIP_ROWS)


class TestLayoutRoundTripsTool:
    def test_it_finds_a_round_trip_from_a_tensor_nothing_produced(
        self, round_trip_report
    ):
        registry, handle = round_trip_report

        result = linking.layout_round_trips(registry, handle)

        assert result["round_trip_count"] == 1
        assert result["move_operation_count"] == 4
        (trip,) = result["round_trips"]
        assert [operation["operation_id"] for operation in trip["operations"]] == [1, 2]
        assert trip["tensor_ids"] == [10, 11, 12]
        assert trip["from_state"] == {
            "layout": "ROW_MAJOR",
            "buffer_type": "DRAM",
            "memory_layout": "INTERLEAVED",
        }
        assert trip["through_states"] == [
            {"layout": "TILE", "buffer_type": "DRAM", "memory_layout": "INTERLEAVED"}
        ]

    def test_unlinked_it_gives_no_time_and_says_why(self, round_trip_report):
        registry, handle = round_trip_report

        result = linking.layout_round_trips(registry, handle)

        assert "device_time_total" not in result
        assert "device_time" not in result["round_trips"][0]
        assert "device_time" not in result["round_trips"][0]["operations"][0]
        assert linking.ROUND_TRIPS_UNLINKED_CAVEAT in result["caveat"]
        assert linking.ROUND_TRIP_SHARD_SPEC_CAVEAT in result["caveat"]
        assert result["operation_link"]["status"] != "linked"

    def test_the_limit_caps_the_list_but_not_the_count(self, tmp_path):
        rows = list(_ROUND_TRIP_ROWS)
        # A second round trip: op 6 tilizes op 5's output and op 7 untilizes it.
        rows += [
            ("operations", (6, "ttnn.tilize", 0.1)),
            ("operations", (7, "ttnn.untilize", 0.1)),
            _tensor(16, "Layout.TILE", _INTERLEAVED_DRAM),
            _tensor(17, "Layout.ROW_MAJOR", _INTERLEAVED_DRAM),
            ("input_tensors", (6, 0, 15)),
            ("output_tensors", (6, 0, 16)),
            ("input_tensors", (7, 0, 16)),
            ("output_tensors", (7, 0, 17)),
        ]
        registry, handle = load_memory_report(tmp_path, _SCHEMA, rows)

        result = linking.layout_round_trips(registry, handle, limit=1)

        assert result["round_trip_count"] == 2
        assert len(result["round_trips"]) == 1
        assert result["truncated"] is True

    def test_a_report_with_no_edges_says_so(self, tmp_path):
        registry, handle = load_memory_report(
            tmp_path, _SCHEMA, [("operations", (1, "ttnn.to_layout", 0.1))]
        )

        result = linking.layout_round_trips(registry, handle)

        assert result["round_trip_count"] == 0
        assert "no tensor edge" in result["caveat"]

    def test_it_is_served_with_an_operation_link_template(self, round_trip_report):
        registry, handle = round_trip_report
        tool = server._tool_table(registry)["layout_round_trips"]

        result = tool["handler"]({"handle": handle})

        assert "{operation_id}" in result["app_link_template"]
