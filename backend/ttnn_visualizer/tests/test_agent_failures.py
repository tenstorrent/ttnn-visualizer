# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""The `errors`, `dram_fallbacks` and `l1_peak` tools, read from a report database. #2154

`test_agent_failure_parity.py` holds the ports to the app; these hold what the tools read
from the database around them, and what each answer says.
"""

import json
import sqlite3
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple
from unittest.mock import patch

import pytest
from ttnn_visualizer.agent import bounds, failures, linking, server
from ttnn_visualizer.agent.handles import ReportRegistry, load_report

_SCHEMA = """
CREATE TABLE operations (operation_id int UNIQUE, name text, duration float);
CREATE TABLE buffers (
    operation_id int, device_id int, address int, max_size_per_bank int,
    buffer_type int, buffer_layout int
);
CREATE TABLE tensors (
    tensor_id int UNIQUE, shape text, dtype text, layout text, memory_config text,
    device_id int, address int, buffer_type int
);
CREATE TABLE device_tensors (tensor_id int, device_id int, address int);
CREATE TABLE input_tensors (operation_id int, input_index int, tensor_id int);
CREATE TABLE output_tensors (operation_id int, output_index int, tensor_id int);
CREATE TABLE devices (device_id int, worker_l1_size int, l1_num_banks int);
CREATE TABLE captured_graph (operation_id int, captured_graph text);
"""
_ERRORS = """
CREATE TABLE errors (
    operation_id int, operation_name text, error_type text, error_message text,
    stack_trace text, timestamp text
);
"""
_ARGUMENTS = (
    "CREATE TABLE operation_arguments (operation_id int, name text, value text);"
)

_OUT_OF_MEMORY = (
    "TT_THROW @ bank_manager.cpp:123: tt::exception\ninfo:\nOut of Memory: Not enough "
    "space to allocate 3276800 B L1 buffer across 4 banks, where each bank needs to "
    "store 819200 B, but bank size is 1382720 B (allocated: 1000000 B, free: 382720 B, "
    "largest free block: 300000 B)\nbacktrace:\n --- tt::tt_metal::Allocator::allocate"
)
_L1_CONFIG = "MemoryConfig(memory_layout=TensorMemoryLayout::INTERLEAVED,buffer_type=BufferType::L1,shard_spec=std::nullopt)"


def _report(
    tmp_path: Path,
    operations: Sequence[Tuple[int, str]],
    errors: Sequence[Tuple] = (),
    graphs: Sequence[Tuple[int, List[Dict]]] = (),
    arguments: Sequence[Tuple[int, str, str]] = (),
    tensors: Sequence[Tuple] = (),
    outputs: Sequence[Tuple[int, int, int]] = (),
    buffers: Sequence[Tuple] = (),
    devices: Sequence[Tuple[int, int, int]] = ((0, 1499136, 64),),
    errors_table: bool = True,
    arguments_table: bool = True,
) -> Tuple[ReportRegistry, str]:
    directory = tmp_path / "profiler"
    directory.mkdir()
    connection = sqlite3.connect(directory / "db.sqlite")
    try:
        connection.executescript(
            _SCHEMA
            + (_ERRORS if errors_table else "")
            + (_ARGUMENTS if arguments_table else "")
        )
        connection.executemany("INSERT INTO operations VALUES (?, ?, 1.0)", operations)
        if errors_table:
            connection.executemany(
                "INSERT INTO errors VALUES (?, ?, ?, ?, '', '')", errors
            )
        if arguments_table:
            connection.executemany(
                "INSERT INTO operation_arguments VALUES (?, ?, ?)", arguments
            )
        connection.executemany(
            "INSERT INTO captured_graph VALUES (?, ?)",
            [(operation_id, json.dumps(nodes)) for operation_id, nodes in graphs],
        )
        connection.executemany(
            "INSERT INTO tensors VALUES (?, 'Shape([1, 32])', 'BFLOAT16', 'TILE', ?, 0, ?, ?)",
            tensors,
        )
        connection.executemany("INSERT INTO output_tensors VALUES (?, ?, ?)", outputs)
        connection.executemany("INSERT INTO buffers VALUES (?, 0, ?, ?, ?, 0)", buffers)
        connection.executemany("INSERT INTO devices VALUES (?, ?, ?)", devices)
        connection.commit()
    finally:
        connection.close()
    registry = ReportRegistry()
    return registry, str(load_report(registry, profiler_path=str(directory))["handle"])


def _two_rank_report(
    tmp_path: Path, errors_ranked: bool, graphs: Dict[int, List[Dict]]
) -> Tuple[ReportRegistry, str]:
    """`ttnn.conv2d` failing on each rank, with `rank` on every table but `errors`
    unless `errors_ranked`, and each rank's graph for it from `graphs`.

    Without the column the one error row stands for both ranks, as an older errors
    table's does.
    """
    directory = tmp_path / "profiler"
    directory.mkdir()
    schema = (
        _SCHEMA
        + _ARGUMENTS
        + (
            _ERRORS.replace("timestamp text", "timestamp text, rank int")
            if errors_ranked
            else _ERRORS
        )
    )
    for table in (
        "operations",
        "buffers",
        "tensors",
        "device_tensors",
        "input_tensors",
        "output_tensors",
        "devices",
        "captured_graph",
        "operation_arguments",
    ):
        schema = schema.replace(
            f"CREATE TABLE {table} (", f"CREATE TABLE {table} (rank int, "
        )
    schema = schema.replace("operation_id int UNIQUE", "operation_id int")
    connection = sqlite3.connect(directory / "db.sqlite")
    try:
        connection.executescript(schema)
        for rank in (0, 1):
            connection.execute(
                "INSERT INTO operations VALUES (?, 1, 'ttnn.conv2d', 1.0)", (rank,)
            )
            connection.execute(
                "INSERT INTO devices VALUES (?, 0, 1499136, 64)", (rank,)
            )
            connection.execute(
                "INSERT INTO captured_graph VALUES (?, 1, ?)",
                (rank, json.dumps(graphs[rank])),
            )
        connection.executemany(
            "INSERT INTO errors VALUES (1, 'ttnn.conv2d', 'TT_THROW', ?, '', ''"
            + (", ?)" if errors_ranked else ")"),
            (
                [(_OUT_OF_MEMORY, 0), (_OUT_OF_MEMORY, 1)]
                if errors_ranked
                else [(_OUT_OF_MEMORY,)]
            ),
        )
        connection.commit()
    finally:
        connection.close()
    registry = ReportRegistry()
    return registry, str(load_report(registry, profiler_path=str(directory))["handle"])


def _start(name: str) -> Dict:
    return {"node_type": "function_start", "params": {"name": name}}


def _end(name: str) -> Dict:
    return {"node_type": "function_end", "params": {"name": name}}


def _allocate(address: int, per_bank: int, buffer_type: str = "L1") -> Dict:
    return {
        "node_type": "buffer_allocate",
        "params": {
            "address": str(address),
            "type": buffer_type,
            "size": str(per_bank * 64),
            "num_cores": "64",
            "max_size_per_bank": str(per_bank),
        },
    }


def _free(address: int) -> Dict:
    return {
        "node_type": "buffer_deallocate",
        "params": {"address": str(address), "type": "L1"},
    }


def _circular_buffer(address: int, size: int) -> Dict:
    return {
        "node_type": "circular_buffer_allocate",
        "params": {
            "address": str(address),
            "size": str(size),
            "globally_allocated": "0",
        },
    }


class TestErrors:
    def test_an_allocation_failure_is_diagnosed_on_the_operation_it_stopped(
        self, tmp_path
    ):
        registry, handle = _report(
            tmp_path,
            operations=[(1, "ttnn.from_torch"), (2, "ttnn.conv2d")],
            errors=[(2, "ttnn.conv2d", "TT_THROW", _OUT_OF_MEMORY)],
            graphs=[(2, [_start("ttnn.conv2d"), _start("Conv2d")])],
        )

        result = failures.errors(registry, handle)

        error = result["errors"][0]
        assert (error["operation_id"], error["attached"]) == (2, True)
        assert error["failed_device_operations"] == ["Conv2d"]
        assert error["allocation_failure"]["kind"] == "bank_out_of_memory"
        assert error["allocation_failure"]["free_bytes"] == 382720
        assert error["diagnosis"]["reason"] == "not_enough_free_space"

    def test_an_error_the_report_could_not_place_is_unattached(self, tmp_path):
        """The importer files an orphan at a base id that can name another operation."""
        registry, handle = _report(
            tmp_path,
            operations=[(1, "ttnn.add")],
            errors=[
                (
                    1,
                    "ttnn.memory_repro",
                    "incomplete_operation",
                    "Operation 'ttnn.memory_repro' started but never completed (likely crashed)",
                )
            ],
            graphs=[(1, [_start("Add")])],
        )

        error = failures.errors(registry, handle)["errors"][0]

        assert error["attached"] is False
        assert error["failed_device_operations"] == []
        assert "allocation_failure" not in error

    def test_a_long_message_is_cut_and_says_how_long_it_was(self, tmp_path):
        message = "x" * (failures.MAX_ERROR_TEXT_CHARS + 5)
        registry, handle = _report(
            tmp_path,
            operations=[(1, "ttnn.add")],
            errors=[(1, "ttnn.add", "TT_THROW", message)],
        )

        error = failures.errors(registry, handle)["errors"][0]

        assert len(error["error_message"]) == failures.MAX_ERROR_TEXT_CHARS
        assert error["error_message_full_length"] == len(message)

    def test_a_limit_shortens_the_list_but_not_the_count(self, tmp_path):
        registry, handle = _report(
            tmp_path,
            operations=[(1, "ttnn.add")],
            errors=[
                (1, "ttnn.add", "TT_THROW", f"error {index}") for index in range(3)
            ],
        )

        result = failures.errors(registry, handle, limit=2)

        assert (result["error_count"], result["returned"]) == (3, 2)

    def test_a_report_without_the_errors_table_says_it_cannot_tell(self, tmp_path):
        registry, handle = _report(
            tmp_path, operations=[(1, "ttnn.add")], errors_table=False
        )

        result = failures.errors(registry, handle)

        assert result["errors"] == []
        assert "predates the errors table" in result["caveat"]


class TestDramFallbacks:
    def test_an_op_that_asked_for_l1_and_landed_in_dram_is_listed_by_name(
        self, tmp_path
    ):
        registry, handle = _report(
            tmp_path,
            operations=[(1, "ttnn.add"), (2, "ttnn.matmul")],
            arguments=[(2, "memory_config", _L1_CONFIG)],
            tensors=[(20, None, 5000, 0)],
            outputs=[(2, 0, 20)],
        )

        result = failures.dram_fallbacks(registry, handle)

        assert result["fallbacks"] == [
            {
                "operation_name": "ttnn.matmul",
                "operation_id": 2,
                "dram_output_count": 1,
                "output_count": 1,
                "signal": "argument_mismatch",
                "requested_buffer_type": "L1",
            }
        ]

    def test_a_retry_after_a_recorded_l1_failure_names_the_failed_op(self, tmp_path):
        registry, handle = _report(
            tmp_path,
            operations=[(1, "ttnn.conv2d"), (2, "ttnn.conv2d")],
            errors=[(1, "ttnn.conv2d", "TT_THROW", _OUT_OF_MEMORY)],
            tensors=[(20, None, 5000, 0)],
            outputs=[(2, 0, 20)],
        )

        fallback = failures.dram_fallbacks(registry, handle)["fallbacks"][0]

        assert fallback["signal"] == "retry_after_failure"
        assert (fallback["operation_id"], fallback["failed_operation_id"]) == (2, 1)

    def test_a_limit_keeps_the_earliest_and_counts_them_all(self, tmp_path):
        registry, handle = _report(
            tmp_path,
            operations=[(operation_id, "ttnn.add") for operation_id in (3, 1, 2)],
            arguments=[
                (operation_id, "memory_config", _L1_CONFIG)
                for operation_id in (1, 2, 3)
            ],
            tensors=[
                (20 + operation_id, None, 5000 + operation_id, 0)
                for operation_id in (1, 2, 3)
            ],
            outputs=[
                (operation_id, 0, 20 + operation_id) for operation_id in (1, 2, 3)
            ],
        )

        result = failures.dram_fallbacks(registry, handle, limit=2)

        assert result["fallback_count"] == 3
        assert [entry["operation_id"] for entry in result["fallbacks"]] == [1, 2]


class TestL1Peak:
    def test_the_peak_counts_circular_buffers_and_intermediates_the_buffers_table_lacks(
        self, tmp_path
    ):
        registry, handle = _report(
            tmp_path,
            operations=[(1, "ttnn.from_torch"), (2, "ttnn.conv2d")],
            graphs=[
                (1, [_allocate(100, 1000)]),
                (2, [_circular_buffer(5000, 3000), _allocate(200, 2000), _free(200)]),
            ],
            buffers=[(1, 100, 1000, 1), (2, 100, 1000, 1)],
        )

        result = failures.l1_peak(registry, handle)

        peak = result["peak"]
        assert (peak["operation_id"], peak["operation_name"]) == (2, "ttnn.conv2d")
        assert peak["total_bytes"] == 6000
        assert (
            peak["circular_buffer_bytes"],
            peak["intermediate_tensor_bytes"],
            peak["persistent_tensor_bytes"],
        ) == (3000, 2000, 1000)
        assert peak["precision"] == "upper-bound"
        assert [entry["kind"] for entry in peak["contributors"]] == [
            "circular-buffer",
            "intermediate-tensor",
            "persistent-tensor",
        ]
        assert result["usable"] is True
        assert result["size_unit"] == "bytes_per_bank"

    def test_repeated_layers_are_listed_once_with_where_they_repeat(self, tmp_path):
        layer = [_circular_buffer(5000, 3000)]
        registry, handle = _report(
            tmp_path,
            operations=[(1, "ttnn.conv2d"), (2, "ttnn.conv2d"), (3, "ttnn.add")],
            graphs=[(1, layer), (2, layer), (3, [_circular_buffer(5000, 100)])],
        )

        top = failures.l1_peak(registry, handle)["top_operations"]

        assert [(entry["operation_id"], entry["also_at"]) for entry in top] == [
            (1, [2]),
            (3, []),
        ]

    def test_a_peak_has_its_largest_residents_and_a_count_of_all(self, tmp_path):
        nodes = [
            _circular_buffer(1000 + index, 10 + index)
            for index in range(failures.MAX_PEAK_CONTRIBUTORS + 3)
        ]
        registry, handle = _report(
            tmp_path, operations=[(1, "ttnn.conv2d")], graphs=[(1, nodes)]
        )

        peak = failures.l1_peak(registry, handle)["peak"]

        assert len(peak["contributors"]) == failures.MAX_PEAK_CONTRIBUTORS
        assert peak["contributor_count"] == failures.MAX_PEAK_CONTRIBUTORS + 3
        assert (
            peak["contributors"][0]["bytes"] == 10 + failures.MAX_PEAK_CONTRIBUTORS + 2
        )

    def test_a_replay_past_the_device_l1_is_withheld(self, tmp_path):
        """A refusal that still gave the figures would be read as a measurement."""
        registry, handle = _report(
            tmp_path,
            operations=[(1, "ttnn.conv2d")],
            graphs=[(1, [_circular_buffer(5000, 4000)])],
            devices=[(0, 3000, 64)],
        )

        result = failures.l1_peak(registry, handle)

        assert (result["usable"], result["peak"]) == (False, None)
        assert "top_operations" not in result
        assert "4000 bytes per bank" in result["reason"]

    def test_a_report_with_no_l1_activity_says_so(self, tmp_path):
        registry, handle = _report(
            tmp_path,
            operations=[(1, "ttnn.add")],
            devices=[(0, 1499136, 64), (1, 1499136, 64)],
        )

        result = failures.l1_peak(registry, handle)

        assert (result["usable"], result["peak"]) == (True, None)
        assert result["reason"] == "This report records no L1 activity."
        # Nothing was summed, so there is nothing for the device caveat to qualify.
        assert "caveat" not in result

    def test_a_multi_device_peak_says_it_summed_the_devices(self, tmp_path):
        registry, handle = _report(
            tmp_path,
            operations=[(1, "ttnn.add")],
            graphs=[(1, [_circular_buffer(5000, 100)])],
            devices=[(0, 1499136, 64), (1, 1499136, 64), (1, 1499136, 64)],
        )

        assert "covers 2 devices" in failures.l1_peak(registry, handle)["caveat"]

    def test_a_report_without_a_device_is_refused(self, tmp_path):
        registry, handle = _report(tmp_path, operations=[(1, "ttnn.add")], devices=[])

        with pytest.raises(ValueError, match="no devices row"):
            failures.l1_peak(registry, handle)


class TestHowTheDatabaseIsRead:
    def test_an_l1_small_buffer_survives_the_operation_boundary(self, tmp_path):
        """L1_SMALL occupies L1, so the snapshot the replay reconciles against holds it."""
        registry, handle = _report(
            tmp_path,
            operations=[(1, "ttnn.from_torch"), (2, "ttnn.conv2d")],
            graphs=[
                (1, [_allocate(300, 500, "L1_SMALL")]),
                (2, [_circular_buffer(5000, 100)]),
            ],
            buffers=[(1, 300, 500, 3), (2, 300, 500, 3)],
        )

        peak = failures.l1_peak(registry, handle)["peak"]

        assert (peak["operation_id"], peak["persistent_tensor_bytes"]) == (2, 500)

    def test_a_repeated_device_row_is_read_as_the_app_reads_it(self, tmp_path):
        """`fetchDevices` keeps the first id's place and its last row's values."""
        registry, handle = _report(
            tmp_path,
            operations=[(1, "ttnn.conv2d")],
            graphs=[(1, [_circular_buffer(5000, 4000)])],
            devices=[(0, 1499136, 64), (0, 3000, 64)],
        )

        result = failures.l1_peak(registry, handle)

        assert (result["worker_l1_size"], result["usable"]) == (3000, False)

    def test_a_figure_that_is_not_finite_reaches_the_client_as_null(self, tmp_path):
        """A device with no banks divides a node's size by zero, as JavaScript would."""
        node = {
            "node_type": "buffer_allocate",
            "params": {"address": "100", "type": "L1", "size": "64", "num_cores": "0"},
        }
        registry, handle = _report(
            tmp_path,
            operations=[(1, "ttnn.add")],
            graphs=[(1, [node])],
            devices=[(0, None, 0)],
        )

        result = failures.l1_peak(registry, handle)

        assert result["peak"]["total_bytes"] is None
        json.dumps(result, allow_nan=False)

    def test_an_older_table_without_rank_is_read_at_rank_0(self, tmp_path):
        """Graphs and errors written before the rank column belong to every rank."""
        directory = tmp_path / "profiler"
        directory.mkdir()
        connection = sqlite3.connect(directory / "db.sqlite")
        connection.executescript(
            _SCHEMA.replace(
                "CREATE TABLE operations (operation_id int UNIQUE, name text, duration float);",
                "CREATE TABLE operations (operation_id int, name text, duration float, rank int);",
            )
            + _ERRORS
            + _ARGUMENTS
        )
        connection.execute("INSERT INTO operations VALUES (1, 'ttnn.conv2d', 1.0, 1)")
        connection.execute(
            "INSERT INTO errors VALUES (1, 'ttnn.conv2d', 'TT_THROW', ?, '', '')",
            (_OUT_OF_MEMORY,),
        )
        connection.execute(
            "INSERT INTO captured_graph VALUES (1, ?)",
            (json.dumps([_start("Conv2d")]),),
        )
        connection.execute("INSERT INTO devices VALUES (0, 1499136, 64)")
        connection.commit()
        connection.close()
        registry = ReportRegistry()
        handle = str(load_report(registry, profiler_path=str(directory))["handle"])

        result = failures.errors(registry, handle, rank=1)

        assert result["errors"][0]["failed_device_operations"] == ["Conv2d"]
        assert "multi-host report read at rank 1" in result["caveat"]
        for tool in (failures.dram_fallbacks, failures.l1_peak):
            assert (
                "multi-host report read at rank 1"
                in tool(registry, handle, rank=1)["caveat"]
            )

    def test_a_captured_graph_past_the_bound_is_not_read(self, tmp_path):
        """Each tool loads every graph it matches at once, so each asks the size first."""
        registry, handle = _report(
            tmp_path,
            operations=[(1, "ttnn.conv2d")],
            errors=[(1, "ttnn.conv2d", "TT_THROW", _OUT_OF_MEMORY)],
            graphs=[(1, [_start("Conv2d")])],
        )

        with patch.object(bounds, "MAX_CAPTURED_GRAPH_CHARS", 10):
            with pytest.raises(
                bounds.GraphTooLargeError, match="past the 10 the replay"
            ):
                failures.l1_peak(registry, handle)
            with pytest.raises(
                bounds.GraphTooLargeError, match="past the 10 an error lookup"
            ):
                failures.errors(registry, handle)
            with pytest.raises(
                bounds.GraphTooLargeError, match="past the 10 an error lookup"
            ):
                linking.operation_detail(registry, handle, operation_id=1)

    def test_the_bound_counts_only_the_rank_the_tool_reads(self, tmp_path):
        """The graph read is rank-filtered in SQL, so a bound of exactly rank 0's size
        is exceeded by the two ranks together and met by the rank actually read."""
        rank_zero = [_start("Conv2d")]
        registry, handle = _two_rank_report(
            tmp_path, errors_ranked=True, graphs={0: rank_zero, 1: rank_zero * 4}
        )

        with patch.object(
            bounds, "MAX_CAPTURED_GRAPH_CHARS", len(json.dumps(rank_zero))
        ):
            result = failures.errors(registry, handle, rank=0)
            with pytest.raises(bounds.GraphTooLargeError):
                failures.errors(registry, handle, rank=1)

        assert result["errors"][0]["failed_device_operations"] == ["Conv2d"]


class TestOperationDetail:
    def test_it_carries_the_operation_s_error_and_likely_fallback(self, tmp_path):
        registry, handle = _report(
            tmp_path,
            operations=[(1, "ttnn.conv2d"), (2, "ttnn.conv2d")],
            errors=[(1, "ttnn.conv2d", "TT_THROW", _OUT_OF_MEMORY)],
            tensors=[(20, None, 5000, 0)],
            outputs=[(2, 0, 20)],
        )

        failed = linking.operation_detail(registry, handle, operation_id=1)
        retried = linking.operation_detail(registry, handle, operation_id=2)

        assert failed["error"]["diagnosis"]["reason"] == "not_enough_free_space"
        assert "dram_fallback" not in failed
        assert retried["dram_fallback"]["signal"] == "retry_after_failure"
        assert "error" not in retried

    def test_a_retry_at_the_window_s_edge_is_found_without_reading_the_whole_report(
        self, tmp_path
    ):
        registry, handle = _report(
            tmp_path,
            operations=[
                (1, "ttnn.conv2d"),
                (2, "ttnn.add"),
                (3, "ttnn.add"),
                (4, "ttnn.conv2d"),
                (5, "ttnn.conv2d"),
            ],
            errors=[(1, "ttnn.conv2d", "TT_THROW", _OUT_OF_MEMORY)],
            tensors=[(20, None, 5000, 0), (21, None, 6000, 0)],
            outputs=[(4, 0, 20), (5, 0, 21)],
        )

        retry = linking.operation_detail(registry, handle, operation_id=4)
        later = linking.operation_detail(registry, handle, operation_id=5)

        assert retry["dram_fallback"]["failed_operation_id"] == 1
        assert "dram_fallback" not in later

    def test_the_fallbacks_are_read_once_per_handle(self, tmp_path):
        """Each answer needs every operation's tensors, which a walk would read again."""
        registry, handle = _report(
            tmp_path, operations=[(1, "ttnn.add"), (2, "ttnn.add")]
        )

        with patch.object(
            failures, "report_dram_fallbacks", wraps=failures.report_dram_fallbacks
        ) as read:
            linking.operation_detail(registry, handle, operation_id=1)
            linking.operation_detail(registry, handle, operation_id=2)
            failures.dram_fallbacks(registry, handle)

        read.assert_called_once()

    def test_its_error_is_withheld_where_the_errors_rows_span_ranks(self, tmp_path):
        """With `rank` on `operations` and not on `errors`, the rank-0 fallback would
        attach rank 0's error to rank 1's operation. `errors` and `dram_fallbacks`
        refuse that; the detail answers without the fields it cannot attribute."""
        graph = [_start("Conv2d")]
        registry, handle = _two_rank_report(
            tmp_path, errors_ranked=False, graphs={0: graph, 1: graph}
        )

        detail = linking.operation_detail(registry, handle, operation_id=1, rank=1)

        assert detail["name"] == "ttnn.conv2d"
        assert "error" not in detail
        assert "dram_fallback" not in detail
        assert "error is withheld" in detail["caveat"]
        assert "dram_fallback is withheld" in detail["caveat"]
        for tool in (failures.errors, failures.dram_fallbacks):
            with pytest.raises(ValueError, match="cannot be attributed to rank"):
                tool(registry, handle, rank=1)

    def test_it_carries_the_error_as_the_errors_tool_lists_it(self, tmp_path):
        registry, handle = _report(
            tmp_path,
            operations=[(1, "ttnn.conv2d")],
            errors=[(1, "ttnn.conv2d", "TT_THROW", _OUT_OF_MEMORY)],
            graphs=[(1, [_start("Conv2d")])],
        )

        listed = failures.errors(registry, handle)["errors"][0]
        carried = linking.operation_detail(registry, handle, operation_id=1)["error"]

        assert carried == {
            key: value
            for key, value in listed.items()
            if key not in ("operation_id", "operation_name", "attached")
        }

    def test_it_answers_without_the_arguments_table(self, tmp_path):
        registry, handle = _report(
            tmp_path, operations=[(1, "ttnn.add")], arguments_table=False
        )

        detail = linking.operation_detail(registry, handle, operation_id=1)

        assert detail["name"] == "ttnn.add"
        assert "dram_fallback" not in detail


class TestInventoryAndTransport:
    def test_a_full_report_answers_all_three(self, tmp_path):
        registry, handle = _report(tmp_path, operations=[(1, "ttnn.add")])

        answerable = registry.get(handle)
        loaded = load_report(ReportRegistry(), profiler_path=answerable.profiler_path)

        assert {"errors", "dram_fallbacks", "l1_peak"} <= set(loaded["answerable"])

    @pytest.mark.parametrize(
        ("tool", "arguments"),
        [("errors", {}), ("dram_fallbacks", {"limit": 5}), ("l1_peak", {"limit": 5})],
    )
    def test_each_answers_over_the_server_in_valid_json(
        self, tmp_path, tool, arguments
    ):
        registry, handle = _report(
            tmp_path,
            operations=[(1, "ttnn.conv2d"), (2, "ttnn.conv2d")],
            errors=[(1, "ttnn.conv2d", "TT_THROW", _OUT_OF_MEMORY)],
            graphs=[(2, [_circular_buffer(5000, 300), _allocate(100, 100)])],
            tensors=[(20, None, 5000, 0)],
            outputs=[(2, 0, 20)],
        )

        response = server.handle_message(
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {"name": tool, "arguments": {"handle": handle, **arguments}},
            },
            server._tool_table(registry),
        )

        result = response["result"]
        assert not result.get("isError")
        payload = json.loads(result["content"][0]["text"])
        json.dumps(payload, allow_nan=False)
        assert payload["handle"] == handle
