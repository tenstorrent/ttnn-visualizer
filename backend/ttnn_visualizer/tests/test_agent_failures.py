# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""The `errors`, `dram_fallbacks` and `l1_peak` tools, read from a report database. #2154

`test_agent_failure_parity.py` holds the ports to the app; these hold what the tools read
from the database around them, and what each answer says.
"""

import json
import re
import sqlite3
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple
from unittest.mock import patch

import pytest
from ttnn_visualizer.agent import (
    allocation_failures,
    bounds,
    failures,
    linking,
    operations,
    server,
)
from ttnn_visualizer.agent.handles import ReportRegistry, load_report
from ttnn_visualizer.queries import DatabaseQueries

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
    inputs: Sequence[Tuple[int, int, int]] = (),
    outputs: Sequence[Tuple[int, int, int]] = (),
    buffers: Sequence[Tuple] = (),
    devices: Sequence[Tuple[int, int, int]] = ((0, 1499136, 64),),
    errors_table: bool = True,
    arguments_table: bool = True,
    buffers_table: bool = True,
) -> Tuple[ReportRegistry, str]:
    directory = tmp_path / "profiler"
    directory.mkdir()
    schema = (
        _SCHEMA
        if buffers_table
        else re.sub(r"CREATE TABLE buffers \([^;]*\);", "", _SCHEMA)
    )
    connection = sqlite3.connect(directory / "db.sqlite")
    try:
        connection.executescript(
            schema
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
        connection.executemany("INSERT INTO input_tensors VALUES (?, ?, ?)", inputs)
        connection.executemany("INSERT INTO output_tensors VALUES (?, ?, ?)", outputs)
        if buffers_table:
            connection.executemany(
                "INSERT INTO buffers VALUES (?, 0, ?, ?, ?, 0)", buffers
            )
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


def _ranked_report(
    tmp_path: Path,
    rows_by_rank: Dict[int, Dict[str, Sequence[Tuple]]],
    unranked: Sequence[str] = (),
    errors_table: bool = True,
) -> Tuple[ReportRegistry, str]:
    """Every table `_report` writes, with `rank` on each but `unranked`.

    `rows_by_rank` holds each rank's whole rows per table, without the rank. An
    unranked table holds every rank's rows with nothing to tell them apart.
    """
    directory = tmp_path / "profiler"
    directory.mkdir()
    schema = (_SCHEMA + (_ERRORS if errors_table else "") + _ARGUMENTS).replace(
        " UNIQUE", ""
    )
    for table in re.findall(r"CREATE TABLE (\w+) \(", schema):
        if table not in unranked:
            schema = schema.replace(
                f"CREATE TABLE {table} (", f"CREATE TABLE {table} (rank int, "
            )
    connection = sqlite3.connect(directory / "db.sqlite")
    try:
        connection.executescript(schema)
        for rank, rows_by_table in rows_by_rank.items():
            for table, rows in rows_by_table.items():
                for row in rows:
                    values = tuple(row) if table in unranked else (rank, *row)
                    placeholders = ", ".join("?" * len(values))
                    connection.execute(
                        f"INSERT INTO {table} VALUES ({placeholders})", values
                    )
        connection.commit()
    finally:
        connection.close()
    registry = ReportRegistry()
    return registry, str(load_report(registry, profiler_path=str(directory))["handle"])


def _tensor_row(tensor_id: int, address: int, buffer_type: int) -> Tuple:
    return (
        tensor_id,
        "Shape([1, 32])",
        "BFLOAT16",
        "TILE",
        None,
        0,
        address,
        buffer_type,
    )


def _retry_rows(rank: int) -> Dict[str, Sequence[Tuple]]:
    """One rank's `ttnn.conv2d` failing to allocate L1 and retried into DRAM. Its
    output's `device_tensors` address differs per rank."""
    return {
        "operations": [(1, "ttnn.conv2d", 1.0), (2, "ttnn.conv2d", 1.0)],
        "errors": [(1, "ttnn.conv2d", "TT_THROW", _OUT_OF_MEMORY, "", "")],
        "tensors": [_tensor_row(20, 5000, 0)],
        "device_tensors": [(20, 0, 5000 + rank)],
        "output_tensors": [(2, 0, 20)],
        "buffers": [(2, 0, 5000, 1024, 0, 0)],
        "devices": [(0, 1499136, 64)],
        "captured_graph": [(2, json.dumps([_circular_buffer(6000, 300)]))],
    }


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


def _circular_buffer(
    address: int,
    size: int,
    core_range_set: Optional[str] = None,
    device_id: Optional[int] = None,
) -> Dict:
    params = {"address": str(address), "size": str(size), "globally_allocated": "0"}
    if core_range_set is not None:
        params["core_range_set"] = core_range_set
    if device_id is not None:
        params["device_id"] = str(device_id)
    return {"node_type": "circular_buffer_allocate", "params": params}


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

    def test_a_second_error_on_one_operation_is_unattached(self, tmp_path):
        """As `select_errors_by_operation` attaches them: an operation shows one error,
        the first, and only that one reads the operation's graph."""
        registry, handle = _report(
            tmp_path,
            operations=[(1, "ttnn.add")],
            errors=[
                (1, "ttnn.add", "TT_THROW", "first"),
                (1, "ttnn.add", "TT_THROW", "second"),
            ],
            graphs=[(1, [_start("Add")])],
        )

        listed = failures.errors(registry, handle)["errors"]

        assert [error["attached"] for error in listed] == [True, False]
        assert [error["failed_device_operations"] for error in listed] == [["Add"], []]

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

    def test_a_message_is_read_for_a_failure_only_up_to_the_bound(self, tmp_path):
        """The patterns cost the square of a crafted message's length. The port reads
        the whole message, as the app does; the tool reads a prefix."""
        padded = "x" * failures.MAX_PARSED_MESSAGE_CHARS + _OUT_OF_MEMORY
        registry, handle = _report(
            tmp_path,
            operations=[(1, "ttnn.conv2d"), (2, "ttnn.conv2d")],
            errors=[
                (1, "ttnn.conv2d", "TT_THROW", padded),
                (2, "ttnn.conv2d", "TT_THROW", _OUT_OF_MEMORY),
            ],
        )

        cut, whole = failures.errors(registry, handle)["errors"]

        assert "allocation_failure" not in cut
        assert whole["allocation_failure"]["kind"] == "bank_out_of_memory"
        assert allocation_failures.parse_allocation_failure(padded) is not None

    def test_a_long_core_range_is_cut_like_a_message(self, tmp_path):
        core_range = "{(x=0,y=0) - (x=7,y=7)}" * 100
        message = (
            f"Statically allocated circular buffers on core range {core_range} grow to "
            "1600000 B which is beyond max L1 size of 1499136 B"
        )
        registry, handle = _report(
            tmp_path,
            operations=[(1, "ttnn.conv2d")],
            errors=[(1, "ttnn.conv2d", "TT_THROW", message)],
        )

        error = failures.errors(registry, handle)["errors"][0]

        failure = error["allocation_failure"]
        assert failure["core_range"] == core_range[: failures.MAX_ERROR_TEXT_CHARS]
        assert failure["core_range_full_length"] == len(core_range)
        assert error["diagnosis"]["reason"] == "beyond_end_of_l1"

    def test_failed_device_operations_are_capped_and_counted(self, tmp_path):
        """A graph left with every scope open would name each one, in every answer
        that carries the error."""
        names = [
            f"Op{index}" for index in range(failures.MAX_FAILED_DEVICE_OPERATIONS + 5)
        ]
        registry, handle = _report(
            tmp_path,
            operations=[(1, "ttnn.conv2d")],
            errors=[(1, "ttnn.conv2d", "TT_THROW", _OUT_OF_MEMORY)],
            graphs=[(1, [_start(name) for name in names])],
        )

        listed = failures.errors(registry, handle, limit=1)["errors"][0]
        carried = linking.operation_detail(registry, handle, operation_id=1)["error"]

        for error in (listed, carried):
            assert (
                error["failed_device_operations"]
                == names[: failures.MAX_FAILED_DEVICE_OPERATIONS]
            )
            assert error["failed_device_operation_count"] == len(names)

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

    def test_repeats_of_a_composition_are_capped_and_counted(self, tmp_path):
        """`limit` caps the compositions; one composition can repeat thousands of times."""
        repeats = failures.MAX_REPEAT_OPERATION_IDS + 5
        registry, handle = _report(
            tmp_path,
            operations=[
                (operation_id, "ttnn.add") for operation_id in range(1, repeats + 2)
            ],
            graphs=[
                (operation_id, [_circular_buffer(5000, 300)])
                for operation_id in range(1, repeats + 2)
            ],
        )

        top = failures.l1_peak(registry, handle, limit=1)["top_operations"]

        assert len(top) == 1
        assert top[0]["also_at"] == list(
            range(2, failures.MAX_REPEAT_OPERATION_IDS + 2)
        )
        assert top[0]["also_at_count"] == repeats

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

    def test_a_replay_past_any_finite_size_is_withheld(self, tmp_path):
        """A device with no banks divides a node's size by zero, as JavaScript would."""
        node = {
            "node_type": "buffer_allocate",
            "params": {"address": "100", "type": "L1", "size": "64", "num_cores": "0"},
        }
        registry, handle = _report(
            tmp_path,
            operations=[(1, "ttnn.add")],
            graphs=[(1, [node])],
            devices=[(0, 3000, 0)],
        )

        result = failures.l1_peak(registry, handle)

        assert (result["usable"], result["peak"]) == (False, None)
        assert "past any finite size" in result["reason"]

    def test_a_limit_keeps_the_largest_compositions(self, tmp_path):
        registry, handle = _report(
            tmp_path,
            operations=[(operation_id, "ttnn.add") for operation_id in (1, 2, 3)],
            graphs=[
                (1, [_circular_buffer(5000, 100)]),
                (2, [_circular_buffer(5000, 300)]),
                (3, [_circular_buffer(5000, 200)]),
            ],
        )

        top = failures.l1_peak(registry, handle, limit=2)["top_operations"]

        assert [(entry["operation_id"], entry["total_bytes"]) for entry in top] == [
            (2, 300),
            (3, 200),
        ]

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

    def test_a_tensor_past_its_last_consumer_is_stale_and_read_once(self, tmp_path):
        """Every operation that reads a tensor carries the same row of it, so its last
        consumer is found once rather than once per reader."""
        registry, handle = _report(
            tmp_path,
            operations=[(operation_id, "ttnn.add") for operation_id in range(1, 6)],
            graphs=[(1, [_allocate(100, 1000)]), (5, [_circular_buffer(5000, 300)])],
            tensors=[(10, None, 100, 1)],
            inputs=[(operation_id, 0, 10) for operation_id in (2, 3, 4)],
            outputs=[(1, 0, 10)],
            buffers=[(operation_id, 100, 1000, 1) for operation_id in range(1, 6)],
        )

        with patch.object(
            failures.peak_replay,
            "last_valid_consumer",
            wraps=failures.peak_replay.last_valid_consumer,
        ) as found:
            peak = failures.l1_peak(registry, handle)["peak"]

        assert (peak["operation_id"], peak["stale_tensor_bytes"]) == (5, 1000)
        assert [
            entry["last_used_by_operation_id"] for entry in peak["contributors"]
        ] == [
            4,
            None,
        ]
        found.assert_called_once()

    def test_each_captured_graph_is_parsed_once(self, tmp_path):
        """Intermediates come from the graph the replay parsed, ids being unique."""
        registry, handle = _report(
            tmp_path,
            operations=[(1, "ttnn.add"), (2, "ttnn.add")],
            graphs=[
                (1, [_allocate(100, 1000), _free(100)]),
                (2, [_circular_buffer(5000, 300)]),
            ],
        )

        with patch.object(failures.json, "loads", wraps=json.loads) as parse:
            peak = failures.l1_peak(registry, handle)["peak"]

        assert parse.call_count == 2
        assert (peak["operation_id"], peak["intermediate_tensor_bytes"]) == (1, 1000)

    def test_it_answers_without_the_arguments_table(self, tmp_path):
        """The replay reads no operation's arguments, so it needs no such table."""
        registry, handle = _report(
            tmp_path,
            operations=[(1, "ttnn.add")],
            graphs=[(1, [_circular_buffer(5000, 300)])],
            arguments_table=False,
        )

        assert failures.l1_peak(registry, handle)["peak"]["total_bytes"] == 300

    def test_a_report_without_a_device_is_refused(self, tmp_path):
        registry, handle = _report(tmp_path, operations=[(1, "ttnn.add")], devices=[])

        with pytest.raises(ValueError, match="no devices row"):
            failures.l1_peak(registry, handle)

    def test_the_replay_is_read_once_per_handle_and_rank(self, tmp_path):
        """It reads every operation and replays every graph, and the errors tool sends
        an agent here on every out-of-memory question."""
        registry, handle = _report(
            tmp_path,
            operations=[(1, "ttnn.add"), (2, "ttnn.add")],
            graphs=[(1, [_circular_buffer(100, 4096)]), (2, [_allocate(200, 1024)])],
        )

        with patch.object(
            failures, "report_l1_peak", wraps=failures.report_l1_peak
        ) as read:
            first = failures.l1_peak(registry, handle)
            again = failures.l1_peak(registry, handle, limit=1)

        read.assert_called_once()
        assert again["peak"] == first["peak"]
        assert len(again["top_operations"]) == 1

    def test_only_the_peak_keeps_its_residents(self, tmp_path):
        """The cached replay would otherwise pin every operation's residents."""
        registry, handle = _report(
            tmp_path,
            operations=[(1, "ttnn.add"), (2, "ttnn.add")],
            graphs=[(1, [_circular_buffer(100, 4096)]), (2, [_allocate(200, 1024)])],
        )

        failures.l1_peak(registry, handle)
        report = registry.cached_report(
            handle, lambda _: {}, variant=failures.CacheVariant.L1_PEAK
        )[None]

        assert report.result.peak.operation_id == 1
        assert [
            len(entry.contributors) for entry in report.result.by_operation_id.values()
        ] == [1, 0]

    def test_a_refused_replay_is_not_kept(self, tmp_path):
        registry, handle = _report(tmp_path, operations=[(1, "ttnn.add")], devices=[])

        with patch.object(
            failures, "report_l1_peak", wraps=failures.report_l1_peak
        ) as read:
            for _ in range(2):
                with pytest.raises(ValueError, match="no devices row"):
                    failures.l1_peak(registry, handle)

        assert read.call_count == 2


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

    def test_a_tensor_written_without_a_rank_is_read_at_any_rank(self, tmp_path):
        """As `serialize_inputs_outputs` reads it: a table without `rank` holds rank 0
        for every rank, so rank 1's output row finds its tensor there."""
        registry, handle = _ranked_report(
            tmp_path,
            {
                1: {
                    "operations": [(1, "ttnn.matmul", 1.0)],
                    "operation_arguments": [(1, "memory_config", _L1_CONFIG)],
                    "tensors": [_tensor_row(20, 5000, 0)],
                    "output_tensors": [(1, 0, 20)],
                }
            },
            unranked=["tensors"],
        )

        result = failures.dram_fallbacks(registry, handle, rank=1)

        assert [entry["operation_id"] for entry in result["fallbacks"]] == [1]

    def test_every_rank_answers_where_every_table_carries_rank(self, tmp_path):
        registry, handle = _ranked_report(
            tmp_path, {rank: _retry_rows(rank) for rank in (0, 1)}
        )

        listed = failures.dram_fallbacks(registry, handle, rank=1)["fallbacks"]
        detail = linking.operation_detail(registry, handle, operation_id=2, rank=1)

        assert [entry["operation_id"] for entry in listed] == [2]
        assert detail["dram_fallback"]["signal"] == "retry_after_failure"

    @pytest.mark.parametrize("table", ["device_tensors", "operation_arguments"])
    def test_fallbacks_are_refused_where_a_table_they_read_spans_ranks(
        self, tmp_path, table
    ):
        """Without `rank` on `device_tensors`, `query_tensors` joins it by tensor id
        alone, so another rank's address can enter `device_addresses`, which the
        view check prefers over the tensor's own."""
        registry, handle = _ranked_report(
            tmp_path, {rank: _retry_rows(rank) for rank in (0, 1)}, unranked=[table]
        )

        with pytest.raises(ValueError, match="cannot be attributed to rank 1"):
            failures.dram_fallbacks(registry, handle, rank=1)
        detail = linking.operation_detail(registry, handle, operation_id=2, rank=1)

        assert "dram_fallback" not in detail
        assert "dram_fallback is withheld" in detail["caveat"]

    def test_the_peak_reads_no_device_addresses_so_answers_without_their_rank(
        self, tmp_path
    ):
        registry, handle = _ranked_report(
            tmp_path,
            {rank: _retry_rows(rank) for rank in (0, 1)},
            unranked=["device_tensors"],
        )

        assert failures.l1_peak(registry, handle, rank=1)["peak"]["total_bytes"] == 300

    def test_fallbacks_need_the_buffers_table(self, tmp_path):
        """`query_tensors` joins `buffers` for a size where `tensors` has none, as
        most captures' does, so without it the tool cannot answer."""
        registry, handle = _report(
            tmp_path, operations=[(1, "ttnn.add")], buffers_table=False
        )

        loaded = load_report(
            ReportRegistry(), profiler_path=registry.get(handle).profiler_path
        )

        assert "dram_fallbacks" in loaded["unanswerable"]
        assert "errors" in loaded["answerable"]

    @pytest.mark.parametrize("graph", [{"node_type": "function_start"}, "Add", None, 7])
    def test_a_captured_graph_that_is_not_a_list_is_read_as_empty(
        self, tmp_path, graph
    ):
        """The app's functions would throw on one, so the golden cannot hold it."""
        registry, handle = _report(
            tmp_path,
            operations=[(1, "ttnn.add")],
            errors=[(1, "ttnn.add", "TT_THROW", "boom")],
            graphs=[(1, graph)],
        )

        error = failures.errors(registry, handle)["errors"][0]
        result = failures.l1_peak(registry, handle)

        assert error["failed_device_operations"] == []
        assert (result["usable"], result["peak"]) == (True, None)

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
                bounds.GraphTooLargeError, match="past the 10 operation_detail"
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
            peak = failures.l1_peak(registry, handle, rank=0)
            with pytest.raises(bounds.GraphTooLargeError, match="an error lookup"):
                failures.errors(registry, handle, rank=1)
            with pytest.raises(bounds.GraphTooLargeError, match="the replay"):
                failures.l1_peak(registry, handle, rank=1)

        assert result["errors"][0]["failed_device_operations"] == ["Conv2d"]
        assert peak["rank"] == 0


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

    def test_a_retry_at_the_window_s_edge_is_found_and_one_past_it_is_not(
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

    def test_its_failure_is_read_on_the_detail_s_connection(self, tmp_path):
        """And only that operation's error rows: the table holds every error's stack
        trace in the run. The fallbacks read them all, once per handle."""
        registry, handle = _report(
            tmp_path,
            operations=[(1, "ttnn.conv2d"), (2, "ttnn.add")],
            errors=[
                (1, "ttnn.conv2d", "TT_THROW", _OUT_OF_MEMORY),
                (2, "ttnn.add", "TT_THROW", "another error"),
            ],
        )
        failures.dram_fallbacks(registry, handle)

        with (
            patch.object(
                operations.sqlite3, "connect", wraps=sqlite3.connect
            ) as connect,
            patch.object(
                DatabaseQueries,
                "query_error_records",
                autospec=True,
                side_effect=DatabaseQueries.query_error_records,
            ) as read,
        ):
            detail = linking.operation_detail(registry, handle, operation_id=1)

        assert detail["error"]["diagnosis"]["reason"] == "not_enough_free_space"
        assert connect.call_count == 1
        assert [call.args[1] for call in read.call_args_list] == [{"operation_id": 1}]

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

    def test_the_fallbacks_are_read_once_per_rank(self, tmp_path):
        """Each rank's retry follows its own failure, so a cache shared across ranks
        would answer one rank with the other's."""

        def retried_after(failed: int) -> Dict[str, Sequence[Tuple]]:
            return {
                "operations": [
                    (1, "ttnn.conv2d" if failed == 1 else "ttnn.add", 1.0),
                    (2, "ttnn.conv2d" if failed == 2 else "ttnn.add", 1.0),
                    (3, "ttnn.conv2d", 1.0),
                ],
                "errors": [(failed, "ttnn.conv2d", "TT_THROW", _OUT_OF_MEMORY, "", "")],
                "tensors": [_tensor_row(20, 5000, 0)],
                "output_tensors": [(3, 0, 20)],
            }

        registry, handle = _ranked_report(
            tmp_path, {0: retried_after(1), 1: retried_after(2)}
        )

        with patch.object(
            failures, "report_dram_fallbacks", wraps=failures.report_dram_fallbacks
        ) as read:
            details = [
                linking.operation_detail(registry, handle, operation_id=3, rank=rank)
                for rank in (0, 1, 0)
            ]

        assert read.call_count == 2
        assert [
            detail["dram_fallback"]["failed_operation_id"] for detail in details
        ] == [
            1,
            2,
            1,
        ]

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

    def test_no_errors_table_reads_no_graph_so_needs_no_graph_rank(self, tmp_path):
        """Without an errors table no graph is read for an error, so a `captured_graph`
        without `rank` cannot misattribute one; the answer says the table is missing.
        The circular buffers do read the graph, so they alone are withheld."""
        registry, handle = _ranked_report(
            tmp_path,
            {rank: {"operations": [(1, "ttnn.add", 1.0)]} for rank in (0, 1)},
            unranked=["captured_graph"],
            errors_table=False,
        )

        listed = failures.errors(registry, handle, rank=1)
        detail = linking.operation_detail(registry, handle, operation_id=1, rank=1)

        assert listed["errors"] == []
        assert "predates the errors table" in listed["caveat"]
        assert "error is withheld" not in detail["caveat"]
        assert "circular_buffers is withheld" in detail["caveat"]
        assert "circular_buffers" not in detail

    def test_an_empty_errors_table_needs_no_graph_rank_either(self, tmp_path):
        registry, handle = _ranked_report(
            tmp_path,
            {rank: {"operations": [(1, "ttnn.add", 1.0)]} for rank in (0, 1)},
            unranked=["captured_graph"],
        )

        listed = failures.errors(registry, handle, rank=1)
        detail = linking.operation_detail(registry, handle, operation_id=1, rank=1)

        assert listed["errors"] == []
        assert "error is withheld" not in detail["caveat"]
        assert "circular_buffers is withheld" in detail["caveat"]

    def test_a_listed_error_needs_its_graph_rank(self, tmp_path):
        """With `rank` on `errors` but not on `captured_graph`, the error's failed
        device operations could come from another rank's graph."""
        registry, handle = _ranked_report(
            tmp_path,
            {
                0: {
                    "operations": [(1, "ttnn.conv2d", 1.0)],
                    "errors": [(1, "ttnn.conv2d", "TT_THROW", _OUT_OF_MEMORY, "", "")],
                    "captured_graph": [(1, json.dumps([_start("Conv2d")]))],
                },
                1: {
                    "operations": [(1, "ttnn.conv2d", 1.0)],
                    "errors": [(1, "ttnn.conv2d", "TT_THROW", _OUT_OF_MEMORY, "", "")],
                },
            },
            unranked=["captured_graph"],
        )

        with pytest.raises(ValueError, match="cannot be attributed to rank 1"):
            failures.errors(registry, handle, rank=1)
        detail = linking.operation_detail(registry, handle, operation_id=1, rank=1)

        assert "error" not in detail
        assert "error is withheld" in detail["caveat"]
        assert "dram_fallback is withheld" not in detail["caveat"]

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

    def test_it_carries_the_circular_buffers_each_device_operation_allocated(
        self, tmp_path
    ):
        """Read from an older capture's `counter` ids, with a mesh's copies folded and
        the enclosing scope's repeat of them left out, as the app shows them."""
        graph = [
            {"node_type": "capture_start", "params": {}},
            _start("ttnn::tilize"),
            _start("TilizeDeviceOperation"),
            {"node_type": "circular_buffer_deallocate_all", "params": {}},
            *(
                _circular_buffer(5000, 4096, "{[(x=0,y=0) - (x=7,y=7)]}", device)
                for device in range(8)
            ),
            _end("TilizeDeviceOperation"),
            _end("ttnn::tilize"),
        ]
        for counter, node in enumerate(graph):
            node["counter"] = counter
        registry, handle = _report(
            tmp_path, operations=[(1, "ttnn.tilize")], graphs=[(1, graph)]
        )

        buffers = linking.operation_detail(registry, handle, operation_id=1)[
            "circular_buffers"
        ]

        assert buffers["circular_buffer_count"] == 1
        assert buffers["device_operation_count"] == 1
        (device_operation,) = buffers["device_operations"]
        assert device_operation["name"] == "TilizeDeviceOperation"
        assert device_operation["max_bytes_per_core"] == 4096
        assert device_operation["circular_buffers"] == [
            {
                "address": 5000,
                "size_per_core": 4096,
                "core_range_set": "{[(x=0,y=0) - (x=7,y=7)]}",
                "core_count": 64,
                "device_count": 8,
                "globally_allocated": False,
            }
        ]

    def test_an_operation_without_a_graph_row_has_no_circular_buffers_field(
        self, tmp_path
    ):
        """No row says nothing about the operation's buffers; an empty graph says it
        allocated none."""
        registry, handle = _report(
            tmp_path,
            operations=[(1, "ttnn.add"), (2, "ttnn.add")],
            graphs=[(2, [])],
        )

        unrecorded = linking.operation_detail(registry, handle, operation_id=1)
        empty = linking.operation_detail(registry, handle, operation_id=2)

        assert "circular_buffers" not in unrecorded
        assert empty["circular_buffers"]["circular_buffer_count"] == 0
        assert empty["circular_buffers"]["device_operations"] == []

    def test_a_report_without_the_graph_table_has_no_circular_buffers_field(
        self, tmp_path
    ):
        registry, handle = _report(tmp_path, operations=[(1, "ttnn.add")])
        connection = sqlite3.connect(
            Path(registry.get(handle).profiler_path) / "db.sqlite"
        )
        try:
            connection.execute("DROP TABLE captured_graph")
            connection.commit()
        finally:
            connection.close()

        detail = linking.operation_detail(registry, handle, operation_id=1)

        assert "circular_buffers" not in detail
        assert "withheld" not in (detail.get("caveat") or "")

    def test_its_circular_buffers_are_read_from_the_rank_asked_for(self, tmp_path):
        registry, handle = _two_rank_report(
            tmp_path,
            errors_ranked=True,
            graphs={
                rank: [
                    {"node_type": "capture_start", "params": {}},
                    _start("Conv2d"),
                    _circular_buffer(address, 1024, "{[0-0 - 0-0]}"),
                    _end("Conv2d"),
                ]
                for rank, address in ((0, 100), (1, 200))
            },
        )

        detail = linking.operation_detail(registry, handle, operation_id=1, rank=1)

        (device_operation,) = detail["circular_buffers"]["device_operations"]
        assert [row["address"] for row in device_operation["circular_buffers"]] == [200]

    def test_a_graph_past_the_bound_withholds_only_the_circular_buffers(self, tmp_path):
        """Without an error, the read the bound refuses is the circular buffers' alone,
        so the rest of the detail still answers."""
        registry, handle = _report(
            tmp_path,
            operations=[(1, "ttnn.add")],
            graphs=[(1, [_start("Add"), _circular_buffer(100, 1024)])],
        )

        with patch.object(bounds, "MAX_CAPTURED_GRAPH_CHARS", 10):
            detail = linking.operation_detail(registry, handle, operation_id=1)

        assert detail["name"] == "ttnn.add"
        assert "circular_buffers" not in detail
        assert "circular_buffers is withheld" in detail["caveat"]


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
