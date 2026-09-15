# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""The profiler-database tools: `agent/operations.py`. #2012

These build a SQLite report on disk rather than using the `make_report` fixture,
which registers an instance through the Flask app. The surface under test takes
neither an app nor a database session -- reaching for the fixture would test a
coupling the tools deliberately do not have.
"""

import sqlite3
from pathlib import Path

import pytest
from ttnn_visualizer.agent import operations as agent_operations
from ttnn_visualizer.agent.bounds import MAX_LIMIT
from ttnn_visualizer.agent.handles import ReportRegistry, load_report

# Column order follows a real report's `.schema`; `buffer_type` is text here and
# an integer in `_INTEGER_BUFFER_TYPE_SQL` below, because captures exist with
# each and the tools read the column rather than the annotation.
_REPORT_SQL = """
CREATE TABLE operations (operation_id int UNIQUE, name text, duration float);
CREATE TABLE buffers (
    operation_id int,
    device_id int,
    address int,
    max_size_per_bank int,
    buffer_type text,
    buffer_layout int
);
CREATE TABLE tensors (
    tensor_id int UNIQUE,
    shape text,
    dtype text,
    layout text,
    memory_config text,
    device_id int,
    address int,
    buffer_type text,
    size int
);
CREATE TABLE device_tensors (tensor_id int, device_id int, address int);
CREATE TABLE input_tensors (operation_id int, input_index int, tensor_id int);
CREATE TABLE output_tensors (operation_id int, output_index int, tensor_id int);
CREATE TABLE devices (
    device_id int,
    num_y_cores int,
    num_x_cores int,
    num_y_compute_cores int,
    num_x_compute_cores int,
    worker_l1_size int,
    l1_num_banks int,
    l1_bank_size int,
    address_at_first_l1_bank int,
    address_at_first_l1_cb_buffer int,
    num_banks_per_storage_core int,
    num_compute_cores int,
    num_storage_cores int,
    total_l1_memory int,
    total_l1_for_tensors int,
    total_l1_for_interleaved_buffers int,
    total_l1_for_sharded_buffers int,
    cb_limit int
);

INSERT INTO operations VALUES
    (1, 'ttnn.from_torch', 0.5),
    (2, 'ttnn.conv2d', 1.5),
    (3, 'ttnn.MatMul', 2.5);

-- Op 2 holds the largest footprint, and the 1000-byte DRAM buffer at address
-- 100 stays live across all three: a sum across operations would count it three
-- times, which is what makes the per-type peak a maximum rather than a total.
INSERT INTO buffers VALUES
    (1, 0, 100, 1000, 'DRAM', 0),
    (2, 0, 100, 1000, 'DRAM', 0),
    (2, 0, 200, 4096, 'L1', 0),
    (2, 0, 300, 512, 'L1_SMALL', 0),
    (3, 0, 100, 1000, 'DRAM', 0),
    (3, 0, 400, 2048, 'L1', 0);

INSERT INTO tensors VALUES
    (10, 'Shape([1, 1, 32, 32])', 'DataType.BFLOAT16', 'Layout.TILE', '{}', 0, 100, 'DRAM', 2048),
    (11, 'Shape([1, 1, 64, 64])', 'DataType.FLOAT32', 'Layout.ROW_MAJOR', '{}', 0, 200, 'L1', 16384),
    (12, 'Shape([1, 1, 32, 64])', 'DataType.BFLOAT8_B', 'Layout.TILE', '{}', 0, 300, 'L1', 4096);

INSERT INTO input_tensors VALUES (2, 0, 10), (2, 1, 11);
INSERT INTO output_tensors VALUES (1, 0, 10), (2, 0, 12);

INSERT INTO devices (
    device_id, worker_l1_size, l1_num_banks, l1_bank_size,
    num_compute_cores, total_l1_for_tensors
) VALUES (0, 1499136, 64, 1370848, 64, 0);
"""

# `SCHEMA_V2` stores `buffer_type` as an integer, so the name lookup is a real
# schema rather than defensive coding: `BufferType.L1` is 1.
_INTEGER_BUFFER_TYPE_SQL = """
CREATE TABLE operations (operation_id int UNIQUE, name text, duration float);
CREATE TABLE buffers (
    operation_id int,
    device_id int,
    address int,
    max_size_per_bank int,
    buffer_type int,
    buffer_layout int
);
CREATE TABLE tensors (
    tensor_id int UNIQUE,
    shape text,
    dtype text,
    layout text,
    memory_config text,
    device_id int,
    address int,
    buffer_type int
);
CREATE TABLE input_tensors (operation_id int, input_index int, tensor_id int);
CREATE TABLE output_tensors (operation_id int, output_index int, tensor_id int);
CREATE TABLE devices (
    device_id int,
    num_y_cores int,
    num_x_cores int,
    num_y_compute_cores int,
    num_x_compute_cores int,
    worker_l1_size int,
    l1_num_banks int,
    l1_bank_size int,
    address_at_first_l1_bank int,
    address_at_first_l1_cb_buffer int,
    num_banks_per_storage_core int,
    num_compute_cores int,
    num_storage_cores int,
    total_l1_memory int,
    total_l1_for_tensors int,
    total_l1_for_interleaved_buffers int,
    total_l1_for_sharded_buffers int,
    cb_limit int
);

INSERT INTO operations VALUES (1, 'ttnn.conv2d', 1.0);
INSERT INTO buffers VALUES (1, 0, 100, 4096, 1, 0);
INSERT INTO devices (
    device_id, worker_l1_size, l1_num_banks, l1_bank_size,
    num_compute_cores, total_l1_for_tensors
) VALUES (0, 1499136, 64, 1370848, 64, 0);
"""

# Two ranks, each with its own operation 1 -- the collision the rank scope
# exists to prevent (#1842).
_RANKED_REPORT_SQL = """
CREATE TABLE operations (
    operation_id int,
    name text,
    duration float,
    rank int NOT NULL DEFAULT 0,
    UNIQUE(operation_id, rank)
);
CREATE TABLE buffers (
    operation_id int,
    device_id int,
    address int,
    max_size_per_bank int,
    buffer_type text,
    buffer_layout int,
    rank int NOT NULL DEFAULT 0
);
CREATE TABLE tensors (
    tensor_id int,
    shape text,
    dtype text,
    layout text,
    memory_config text,
    device_id int,
    address int,
    buffer_type text,
    size int,
    rank int NOT NULL DEFAULT 0,
    UNIQUE(tensor_id, rank)
);
CREATE TABLE input_tensors (
    operation_id int, input_index int, tensor_id int, rank int NOT NULL DEFAULT 0
);
CREATE TABLE output_tensors (
    operation_id int, output_index int, tensor_id int, rank int NOT NULL DEFAULT 0
);
CREATE TABLE devices (
    device_id int,
    num_y_cores int,
    num_x_cores int,
    num_y_compute_cores int,
    num_x_compute_cores int,
    worker_l1_size int,
    l1_num_banks int,
    l1_bank_size int,
    address_at_first_l1_bank int,
    address_at_first_l1_cb_buffer int,
    num_banks_per_storage_core int,
    num_compute_cores int,
    num_storage_cores int,
    total_l1_memory int,
    total_l1_for_tensors int,
    total_l1_for_interleaved_buffers int,
    total_l1_for_sharded_buffers int,
    cb_limit int,
    rank int NOT NULL DEFAULT 0
);

INSERT INTO operations VALUES
    (1, 'op_on_rank_zero', 1.0, 0),
    (1, 'op_on_rank_one', 2.0, 1);
INSERT INTO buffers VALUES
    (1, 0, 100, 1024, 'L1', 0, 0),
    (1, 0, 100, 8192, 'L1', 0, 1);
INSERT INTO devices (
    device_id, worker_l1_size, l1_num_banks, l1_bank_size,
    num_compute_cores, total_l1_for_tensors, rank
) VALUES (0, 1499136, 64, 1370848, 64, 0, 0);
"""

# Buffers on two devices, so a summed total spans them.
_TWO_DEVICE_SQL = """
CREATE TABLE operations (operation_id int UNIQUE, name text, duration float);
CREATE TABLE buffers (
    operation_id int,
    device_id int,
    address int,
    max_size_per_bank int,
    buffer_type text,
    buffer_layout int
);
CREATE TABLE devices (
    device_id int,
    num_y_cores int,
    num_x_cores int,
    num_y_compute_cores int,
    num_x_compute_cores int,
    worker_l1_size int,
    l1_num_banks int,
    l1_bank_size int,
    address_at_first_l1_bank int,
    address_at_first_l1_cb_buffer int,
    num_banks_per_storage_core int,
    num_compute_cores int,
    num_storage_cores int,
    total_l1_memory int,
    total_l1_for_tensors int,
    total_l1_for_interleaved_buffers int,
    total_l1_for_sharded_buffers int,
    cb_limit int
);

INSERT INTO operations VALUES (1, 'ttnn.all_gather', 1.0);
INSERT INTO buffers VALUES (1, 0, 100, 1024, 'L1', 0), (1, 1, 100, 1024, 'L1', 0);
INSERT INTO devices (
    device_id, worker_l1_size, l1_num_banks, l1_bank_size, num_compute_cores
) VALUES (1, 1499136, 64, 1370848, 64), (0, 1499136, 64, 1370848, 64);
"""


def _wide_report_sql(rows: int) -> str:
    """`_REPORT_SQL` plus enough operations to exceed the cap.

    A report smaller than `MAX_LIMIT` cannot tell a capped answer from an
    honoured one, so a cap test needs one that is larger.
    """
    return _REPORT_SQL + "".join(
        f"INSERT INTO operations VALUES ({index}, 'ttnn.filler', 0.1);\n"
        f"INSERT INTO buffers VALUES ({index}, 0, {index}, {index}, 'L1', 0);\n"
        for index in range(100, 100 + rows)
    )


def write_report(directory: Path, sql: str = _REPORT_SQL) -> str:
    """Build a profiler report directory and return its path."""
    directory.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(directory / "db.sqlite")
    try:
        connection.executescript(sql)
        connection.commit()
    finally:
        connection.close()
    return str(directory)


@pytest.fixture
def loaded(tmp_path):
    """A registry with one report loaded, and the handle it was given."""

    def _loaded(sql: str = _REPORT_SQL, name: str = "profiler"):
        registry = ReportRegistry()
        path = write_report(tmp_path / name, sql)
        handle = load_report(registry, profiler_path=path)["handle"]
        return registry, handle

    return _loaded


class TestMemoryProfile:
    def test_it_ranks_operations_by_footprint(self, loaded):
        registry, handle = loaded()

        result = agent_operations.memory_profile(registry, handle)

        assert [op["operation_id"] for op in result["operations"]] == [2, 3, 1]
        assert result["operations"][0]["total"] == 1000 + 4096 + 512
        assert result["operations"][0]["by_buffer_type"] == {
            "DRAM": 1000,
            "L1": 4096,
            "L1_SMALL": 512,
        }
        assert result["operation_count"] == 3

    def test_a_peak_is_the_largest_footprint_not_a_sum_across_the_run(self, loaded):
        """Buffers stay live across operations, so the report lists the same
        allocation under each one it survived. Adding those up would report a
        DRAM peak of 3000 for a single 1000-byte buffer."""
        registry, handle = loaded()

        result = agent_operations.memory_profile(registry, handle)

        assert result["peak_by_buffer_type"] == {
            "DRAM": 1000,
            "L1": 4096,
            "L1_SMALL": 512,
        }

    def test_sizes_carry_the_unit_and_the_geometry_to_read_them_against(self, loaded):
        """A per-bank figure divided by a device-wide capacity understates usage
        by the bank count, so neither the unit nor the denominator is left for
        the caller to assume."""
        registry, handle = loaded()

        result = agent_operations.memory_profile(registry, handle)

        assert result["size_unit"] == "bytes_per_bank"
        assert result["device"]["l1_bank_size"] == 1370848
        assert result["device"]["l1_num_banks"] == 64
        assert result["device"]["geometry_from_device"] == 0
        # The report holds no DRAM capacity. Said explicitly, because an agent
        # given L1 limits and silence on DRAM would assume one was checked.
        assert result["device"]["dram_capacity"] is None
        assert "per bank" in result["note"]

    def test_one_buffer_type_can_be_selected(self, loaded):
        registry, handle = loaded()

        result = agent_operations.memory_profile(registry, handle, buffer_type="l1")

        assert result["buffer_type"] == "L1"
        assert result["peak_by_buffer_type"] == {"L1": 4096}
        assert [op["operation_id"] for op in result["operations"]] == [2, 3]

    def test_a_buffer_type_the_report_lacks_is_refused_with_what_it_holds(self, loaded):
        """An empty result would read as "this report allocates no TRACE memory"
        rather than "TRACE is not a thing here"."""
        registry, handle = loaded()

        with pytest.raises(ValueError, match="DRAM, L1, L1_SMALL"):
            agent_operations.memory_profile(registry, handle, buffer_type="TRACE")

    def test_a_limit_is_capped_rather_than_honoured(self, loaded):
        registry, handle = loaded(_wide_report_sql(MAX_LIMIT + 50), name="wide")

        result = agent_operations.memory_profile(registry, handle, limit=10_000)

        assert result["operation_count"] == MAX_LIMIT + 53
        assert result["returned"] == MAX_LIMIT
        assert len(result["operations"]) == MAX_LIMIT

    def test_buffers_across_devices_say_the_total_adds_them(self, loaded):
        registry, handle = loaded(_TWO_DEVICE_SQL, name="two-device")

        result = agent_operations.memory_profile(registry, handle)

        assert result["operations"][0]["total"] == 2048
        assert "span 2 devices" in result["caveat"]
        # Device 1 is the first row in this fixture, so this pins that the
        # geometry names the device it came from rather than assuming zero.
        assert result["device"]["devices"] == 2
        assert result["device"]["geometry_from_device"] == 1

    def test_an_integer_buffer_type_column_is_named(self, loaded):
        """Older reports store `buffer_type` as the enum's value."""
        registry, handle = loaded(_INTEGER_BUFFER_TYPE_SQL, name="legacy")

        result = agent_operations.memory_profile(registry, handle)

        assert result["peak_by_buffer_type"] == {"L1": 4096}


class TestOperationDetail:
    def test_it_describes_the_tensors_the_operation_refers_to(self, loaded):
        registry, handle = loaded()

        result = agent_operations.operation_detail(registry, handle, 2)

        assert result["name"] == "ttnn.conv2d"
        assert result["input_count"] == 2
        assert result["output_count"] == 1
        assert [item["tensor_id"] for item in result["inputs"]] == [10, 11]
        assert result["inputs"][1]["shape"] == "Shape([1, 1, 64, 64])"
        assert result["inputs"][1]["dtype"] == "DataType.FLOAT32"
        assert result["inputs"][1]["layout"] == "Layout.ROW_MAJOR"
        assert result["outputs"][0]["tensor_id"] == 12

    def test_the_two_size_fields_are_in_different_units(self, loaded):
        """`tensors.size` is a whole-tensor byte count and an allocation total is
        per bank. Both appear in this one response, and nothing about the field
        names says they cannot be compared."""
        registry, handle = loaded()

        result = agent_operations.operation_detail(registry, handle, 2)

        assert result["tensor_size_unit"] == "bytes"
        assert result["allocation_size_unit"] == "bytes_per_bank"
        assert result["inputs"][1]["size"] == 16384
        assert result["allocations"]["L1"] == {"buffers": 1, "size": 4096}
        assert result["allocations"]["DRAM"] == {"buffers": 1, "size": 1000}

    def test_a_runaway_tensor_list_is_capped_but_the_count_is_not(self, loaded):
        """The cap is a guard against a malformed report rather than a slice an
        agent should expect to hit, so the untruncated count is returned beside
        the list and says the list is short."""
        extra = "".join(
            f"INSERT INTO input_tensors VALUES (3, {index}, 10);\n"
            for index in range(MAX_LIMIT + 5)
        )
        registry, handle = loaded(_REPORT_SQL + extra, name="runaway")

        result = agent_operations.operation_detail(registry, handle, 3)

        assert result["input_count"] == MAX_LIMIT + 5
        assert len(result["inputs"]) == MAX_LIMIT

    def test_an_unknown_operation_is_refused(self, loaded):
        registry, handle = loaded()

        with pytest.raises(ValueError, match="no operation 99"):
            agent_operations.operation_detail(registry, handle, 99)


class TestFindOperations:
    def test_it_matches_a_name_case_insensitively(self, loaded):
        """Op names are spelled `ttnn.MatMul` in some captures and
        `ttnn.matmul` in others, and an agent types whichever it saw."""
        registry, handle = loaded()

        result = agent_operations.find_operations(
            registry, handle, name_contains="matmul"
        )

        assert [op["name"] for op in result["operations"]] == ["ttnn.MatMul"]

    def test_the_match_count_is_the_whole_match_not_the_returned_slice(self, loaded):
        """An agent that sees `returned` alone cannot tell a complete answer from
        a truncated one."""
        registry, handle = loaded()

        result = agent_operations.find_operations(registry, handle, limit=1)

        assert result["match_count"] == 3
        assert result["returned"] == 1
        assert len(result["operations"]) == 1

    def test_a_limit_is_capped_rather_than_honoured(self, loaded):
        registry, handle = loaded(_wide_report_sql(MAX_LIMIT + 50), name="wide")

        result = agent_operations.find_operations(registry, handle, limit=10_000)

        assert result["match_count"] == MAX_LIMIT + 53
        assert result["returned"] == MAX_LIMIT
        assert len(result["operations"]) == MAX_LIMIT

    def test_the_duration_is_labelled_as_host_time(self, loaded):
        """`operations.duration` is host wall time; `top_ops` answers the device
        question. The two differ, and only one of them is named here."""
        registry, handle = loaded()

        result = agent_operations.find_operations(registry, handle)

        assert result["duration_unit"] == "host_seconds"


class TestTensorFlow:
    def test_it_names_the_producing_and_consuming_operations(self, loaded):
        """An operation *outputs* the tensor it produced, so the producer comes
        from `output_tensors` -- the SQL in `query_producers_consumers` aliases
        those two the other way round and the unpacking corrects it, which is
        exactly the kind of thing to pin."""
        registry, handle = loaded()

        result = agent_operations.tensor_flow(registry, handle, 10)

        assert [op["operation_id"] for op in result["producers"]] == [1]
        assert result["producers"][0]["name"] == "ttnn.from_torch"
        assert [op["operation_id"] for op in result["consumers"]] == [2]
        assert result["consumers"][0]["name"] == "ttnn.conv2d"

    def test_it_returns_the_tensor_with_its_size_unit(self, loaded):
        registry, handle = loaded()

        result = agent_operations.tensor_flow(registry, handle, 11)

        assert result["tensor"]["shape"] == "Shape([1, 1, 64, 64])"
        assert result["tensor"]["size"] == 16384
        assert result["tensor"]["size_unit"] == "bytes"

    def test_an_unknown_tensor_is_refused(self, loaded):
        registry, handle = loaded()

        with pytest.raises(ValueError, match="no tensor 99"):
            agent_operations.tensor_flow(registry, handle, 99)


class TestRankScope:
    def test_a_multi_host_report_is_read_at_rank_zero_and_says_so(self, loaded):
        registry, handle = loaded(_RANKED_REPORT_SQL, name="ranked")

        result = agent_operations.find_operations(registry, handle)

        assert result["multi_host"] is True
        assert result["rank"] == 0
        assert [op["name"] for op in result["operations"]] == ["op_on_rank_zero"]
        assert "rank 0 only" in result["caveat"]

    def test_a_requested_rank_selects_that_rank(self, loaded):
        """Both ranks hold an operation 1. Reading them together would collide
        two different operations under one id."""
        registry, handle = loaded(_RANKED_REPORT_SQL, name="ranked")

        result = agent_operations.find_operations(registry, handle, rank=1)

        assert result["rank"] == 1
        assert [op["name"] for op in result["operations"]] == ["op_on_rank_one"]

    def test_the_rank_reaches_the_allocation_figures_too(self, loaded):
        registry, handle = loaded(_RANKED_REPORT_SQL, name="ranked")

        zero = agent_operations.memory_profile(registry, handle)
        one = agent_operations.memory_profile(registry, handle, rank=1)

        assert zero["peak_by_buffer_type"] == {"L1": 1024}
        assert one["peak_by_buffer_type"] == {"L1": 8192}

    def test_a_single_host_report_carries_no_rank_caveat(self, loaded):
        """A caveat on every response is one an agent learns to skip."""
        registry, handle = loaded()

        result = agent_operations.find_operations(registry, handle)

        assert result["multi_host"] is False
        assert result["rank"] is None
        assert "caveat" not in result


class TestProfilerDatabase:
    def test_a_handle_without_a_profiler_path_is_refused_readably(self, tmp_path):
        """The performance-only case. An agent gets told which path it is
        missing, not a stack trace from sqlite."""
        registry = ReportRegistry()
        (tmp_path / "ops_perf_results_x.csv").write_text("ID\n", encoding="utf-8")
        handle = load_report(registry, performance_path=str(tmp_path))["handle"]

        with pytest.raises(
            agent_operations.ProfilerDatabaseMissingError, match="profiler_path"
        ):
            agent_operations.memory_profile(registry, handle)

    def test_the_report_is_opened_read_only(self, tmp_path):
        """A tool surface has no business writing to a capture."""
        path = write_report(tmp_path / "profiler")
        registry = ReportRegistry()
        handle = load_report(registry, profiler_path=path)["handle"]
        agent_operations.memory_profile(registry, handle)

        instance = registry.get(handle)
        with agent_operations._profiler_db(instance) as queries:
            with pytest.raises(sqlite3.OperationalError, match="readonly"):
                queries.query_runner.execute_query("DELETE FROM buffers")
