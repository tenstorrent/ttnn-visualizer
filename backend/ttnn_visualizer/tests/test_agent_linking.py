# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""The performance-row to profiler-operation join: `agent/linking.py`.

Two properties matter more than coverage here. The match must agree with the app's
own report link, or an agent and a person looking at one report are sent to
different operations -- so `TestMatcherParity` restates the frontend suite's cases
(`tests/deviceOperationMatching.spec.ts`). And a pair that does not link must say so
and leave every id null, because a guessed id answers confidently about the wrong
operation.
"""

import json
import sqlite3
from pathlib import Path
from typing import Dict, List, Optional
from unittest.mock import patch

import pytest
from ttnn_visualizer.agent import linking, tools
from ttnn_visualizer.agent.handles import ReportRegistry, load_report
from ttnn_visualizer.agent.linking import DeviceOperation, LinkStatus
from ttnn_visualizer.tests.test_device_log_columns import (
    MODERN_HEADER,
    write_device_log,
)


def op(name: str, operation_id: int) -> DeviceOperation:
    return DeviceOperation(operation_id, name)


def perf_row(name: str, row_id: int, op_type: Optional[str] = "tt_dnn_device"):
    return {
        "id": str(row_id),
        "raw_op_code": name,
        "op_code": name,
        "device_time": "1.0",
        "op_type": op_type,
    }


def perf_rows_for(names: List[str]):
    return [perf_row(name, index) for index, name in enumerate(names)]


def duplicated_per_device(names: List[str], num_devices: int):
    return [
        op(name, index + 1)
        for index, name in enumerate(names)
        for _ in range(num_devices)
    ]


def matched(start, end, rows, num_devices):
    match = linking.match_device_operations(start, end, rows, num_devices)
    if match is None:
        return []
    return [
        (operation.name, operation.operation_id, row["id"])
        for operation, row in zip(match.device_operations, match.rows)
    ]


class TestMatcherParity:
    """The frontend suite's cases, so the two joins cannot drift apart unnoticed."""

    def test_signposts_are_dropped_before_aligning(self):
        rows = [perf_row("start", 0, "signpost"), *perf_rows_for(["Alpha"])]
        rows[1]["id"] = "1"
        assert matched([op("Alpha", 1)], [op("Alpha", 1)], rows, 1) == [
            ("Alpha", 1, "1")
        ]

    def test_a_row_with_an_unresolved_op_type_is_kept(self):
        rows = [perf_row("Alpha", 0, None)]
        assert matched([op("Alpha", 1)], [op("Alpha", 1)], rows, 1) == [
            ("Alpha", 1, "0")
        ]

    def test_it_collapses_a_report_that_records_each_op_once_per_device(self):
        ops = duplicated_per_device(["Alpha", "Beta", "Gamma"], 2)
        assert matched(ops, ops, perf_rows_for(["Alpha", "Beta", "Gamma"]), 2) == [
            ("Alpha", 1, "0"),
            ("Beta", 2, "1"),
            ("Gamma", 3, "2"),
        ]

    def test_it_matches_when_the_devices_table_is_empty(self):
        ops = [op("Alpha", 1), op("Beta", 2)]
        assert len(matched(ops, ops, perf_rows_for(["Alpha", "Beta"]), 0)) == 2

    def test_a_single_device_report_keeps_repeated_ops(self):
        ops = [op("Alpha", 1), op("Alpha", 1), op("Beta", 2)]
        assert len(matched(ops, ops, perf_rows_for(["Alpha", "Alpha", "Beta"]), 1)) == 3

    def test_trailing_rows_are_tolerated(self):
        ops = [op("Alpha", 1)]
        rows = perf_rows_for(["Alpha", "HostOp", "HostOp"])
        assert matched(ops, ops, rows, 1) == [("Alpha", 1, "0")]

    @pytest.mark.parametrize(
        "ops, names, num_devices",
        [
            ([op("Alpha", 1), op("Beta", 2)], ["Alpha", "Gamma"], 1),
            ([op("Alpha", 1), op("Beta", 2)], ["Alpha", "Gamma"], 2),
            ([op("Alpha", 1), op("Beta", 2), op("Gamma", 3)], ["Alpha", "Beta"], 1),
            ([], ["Alpha"], 1),
            # The direct pass agrees on a prefix, then the collapse rejects it.
            (duplicated_per_device(["Alpha", "Beta"], 2), ["Alpha", "Alpha"], 2),
        ],
    )
    def test_no_partial_match_is_returned(self, ops, names, num_devices):
        assert matched(ops, ops, perf_rows_for(names), num_devices) == []

    def test_it_falls_back_to_function_end_order_for_nested_ops(self):
        start = [op("SparseMatmulDeviceOperation", 59), op("UnaryDeviceOperation", 59)]
        end = [op("UnaryDeviceOperation", 59), op("SparseMatmulDeviceOperation", 59)]
        rows = perf_rows_for(["UnaryDeviceOperation", "SparseMatmulDeviceOperation"])

        match = linking.match_device_operations(start, end, rows, 1)

        assert match is not None and match.matched_on == "function_end"

    def test_complete_end_order_beats_a_spurious_collapsed_start_prefix(self):
        start = [
            op("Pad", 1),
            op("Pad", 1),
            op("Matmul", 2),
            op("Outer", 3),
            op("Inner", 3),
        ]
        end = [
            op("Pad", 1),
            op("Pad", 1),
            op("Matmul", 2),
            op("Inner", 3),
            op("Outer", 3),
        ]
        rows = perf_rows_for(["Pad", "Pad", "Matmul", "Inner", "Outer"])

        assert [name for name, _, _ in matched(start, end, rows, 2)] == [
            "Pad",
            "Pad",
            "Matmul",
            "Inner",
            "Outer",
        ]

    def test_a_duplicated_nested_sequence_matches_on_the_collapsed_end_pass(self):
        start = [op("Outer", 1), op("Outer", 1), op("Inner", 1), op("Inner", 1)]
        end = [op("Inner", 1), op("Inner", 1), op("Outer", 1), op("Outer", 1)]

        match = linking.match_device_operations(
            start, end, perf_rows_for(["Inner", "Outer"]), 2
        )

        assert match is not None
        assert [operation.name for operation in match.device_operations] == [
            "Inner",
            "Outer",
        ]
        assert match.matched_on == "function_end_collapsed"

    def test_a_collapsed_end_prefix_omitting_unduplicated_ops_is_rejected(self):
        start = [
            op("Outer", 1),
            op("Inner", 1),
            op("Outer", 1),
            op("Inner", 1),
            op("Matmul", 2),
        ]
        end = [
            op("Inner", 1),
            op("Outer", 1),
            op("Inner", 1),
            op("Outer", 1),
            op("Matmul", 2),
        ]

        assert matched(start, end, perf_rows_for(["Inner", "Outer", "Matmul"]), 2) == []

    def test_start_order_is_preferred_when_both_align(self):
        start = [op("Alpha", 10), op("Alpha", 20)]
        end = [op("Alpha", 20), op("Alpha", 10)]

        assert [
            operation_id
            for _, operation_id, _ in matched(
                start, end, perf_rows_for(["Alpha", "Alpha"]), 1
            )
        ] == [10, 20]

    @pytest.mark.parametrize(
        "start, end, names",
        [
            ([op("Outer", 1), op("Inner", 1)], [op("Inner", 1)], ["Inner", "Outer"]),
            (
                [op("Outer", 1), op("Inner", 1)],
                [op("Inner", 1), op("Different", 1)],
                ["Inner", "Different"],
            ),
            (
                [op("Alpha", 1), op("Alpha", 1), op("Beta", 1)],
                [op("Alpha", 1), op("Beta", 1), op("Beta", 1)],
                ["Alpha", "Beta", "Beta"],
            ),
        ],
        ids=["incomplete", "different-operation", "different-duplicate-counts"],
    )
    def test_end_order_is_refused_unless_it_holds_the_same_operations(
        self, start, end, names
    ):
        assert matched(start, end, perf_rows_for(names), 1) == []

    def test_collapse_keeps_only_keys_seen_once_per_device(self):
        ops = [op("Alpha", 1), op("Alpha", 1), op("Beta", 2)]
        assert linking.collapse_multidevice_operations(ops, 1) == ops
        assert [o.name for o in linking.collapse_multidevice_operations(ops, 2)] == [
            "Alpha"
        ]

    @pytest.mark.parametrize(
        "name, expected",
        [
            ("MatmulDeviceOperation", True),
            ("ttnn.matmul", False),
            ("Tensor::to_device", False),
            ("aten::add (torch)", False),
            ("", False),
        ],
    )
    def test_device_operation_names_match_the_frontend_filter(self, name, expected):
        assert linking.is_device_operation(name) is expected


def _graph(*names: str) -> str:
    nodes: List[Dict[str, object]] = [{"node_type": "capture_start", "params": None}]
    for name in names:
        nodes.append({"node_type": "function_start", "params": {"name": name}})
    for name in reversed(names):
        nodes.append({"node_type": "function_end", "params": {"name": name}})
    return json.dumps(nodes)


_PROFILER_SQL = """
CREATE TABLE operations (operation_id int UNIQUE, name text, duration float);
CREATE TABLE captured_graph (operation_id int, captured_graph text);
CREATE TABLE devices (device_id int, l1_num_banks int, l1_bank_size int);
CREATE TABLE buffers (
    operation_id int, device_id int, address int, max_size_per_bank int,
    buffer_type text, buffer_layout int
);
CREATE TABLE tensors (
    tensor_id int UNIQUE, shape text, dtype text, layout text, memory_config text,
    device_id int, address int, buffer_type text
);
CREATE TABLE input_tensors (operation_id int, input_index int, tensor_id int);
CREATE TABLE output_tensors (operation_id int, output_index int, tensor_id int);
INSERT INTO devices VALUES (0, 64, 1370848);
INSERT INTO operations VALUES
    (1, 'ttnn.from_torch', 0.1),
    (2, 'ttnn.matmul', 0.2),
    (3, 'ttnn.add', 0.3);
"""


def _write_profiler(directory: Path, graphs: Optional[dict]) -> str:
    directory.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(directory / "db.sqlite")
    try:
        connection.executescript(_PROFILER_SQL)
        if graphs is None:
            connection.execute("DROP TABLE captured_graph")
        else:
            connection.executemany(
                "INSERT INTO captured_graph VALUES (?, ?)", list(graphs.items())
            )
        connection.commit()
    finally:
        connection.close()
    return str(directory)


_GRAPHS = {
    # Host-side work only, so it launches no device operation.
    1: _graph("ttnn.from_torch", "Tensor::to_device"),
    2: _graph("ttnn.matmul", "MatmulDeviceOperation"),
    3: _graph("ttnn.add", "BinaryNgDeviceOperation"),
}

# CSV row numbers, as tt-perf-report assigns them: not 1..n, and not the profiler's
# ids, which is the whole reason the join is needed.
_LINKED_ROWS = [
    perf_row("signpost-start", 2, "signpost"),
    perf_row("MatmulDeviceOperation", 3),
    perf_row("BinaryNgDeviceOperation", 5),
]
_CANONICAL_ROWS = [
    _LINKED_ROWS[0],
    _LINKED_ROWS[1],
    {**perf_row("HostOnlyOp", 4, "tt_dnn_cpu"), "device_time": None},
    {**_LINKED_ROWS[2], "device_time": "9.0"},
]


def _report_for(instance, **overrides):
    rows = _LINKED_ROWS if overrides.get("hide_host_ops") else _CANONICAL_ROWS
    return {"report": rows, "stacked_report": [], "signposts": []}


@pytest.fixture
def linked(tmp_path):
    def _linked(graphs: Optional[dict] = _GRAPHS, profiler=True, performance=True):
        registry = ReportRegistry()
        perf_dir = tmp_path / "perf"
        perf_dir.mkdir(exist_ok=True)
        write_device_log(perf_dir, MODERN_HEADER, [])
        handle = load_report(
            registry,
            profiler_path=(
                _write_profiler(tmp_path / "profiler", graphs) if profiler else None
            ),
            performance_path=str(perf_dir) if performance else None,
        )["handle"]
        return registry, handle

    return _linked


class TestTopOpsLink:
    def test_each_row_carries_its_profiler_operation_id(self, linked):
        registry, handle = linked()
        with patch.object(tools, "_generate_canonical_report", side_effect=_report_for):
            result = linking.top_ops(registry, handle)

        by_id = {row["id"]: row["operation_id"] for row in result["ops"]}
        assert by_id["3"] == 2
        assert by_id["5"] == 3
        assert result["operation_link"]["status"] == LinkStatus.LINKED.value
        assert result["operation_link"]["matched_rows"] == 2

    def test_the_match_reads_the_link_view_not_the_canonical_one(self, linked):
        """A host op mid-report would shift every later row out of position."""
        registry, handle = linked()
        with patch.object(
            tools, "_generate_canonical_report", side_effect=_report_for
        ) as generate:
            linking.top_ops(registry, handle)
            linking.top_ops(registry, handle, by="op_to_op_gap")

        # Once per projection, however many questions are asked.
        assert generate.call_count == 2
        assert any(
            call.kwargs.get("hide_host_ops") is True for call in generate.call_args_list
        )

    def test_the_canonical_projection_still_keeps_host_ops(self, linked):
        """Caching the link view must not leak its filter into `top_ops`'s rows."""
        registry, handle = linked()
        with patch.object(tools, "_generate_canonical_report", side_effect=_report_for):
            linking.operation_link(registry, handle)
            result = linking.top_ops(registry, handle)

        assert result["op_count"] == len(_CANONICAL_ROWS)

    def test_an_unlinked_pair_says_so_and_guesses_nothing(self, linked):
        registry, handle = linked(
            graphs={**_GRAPHS, 3: _graph("ttnn.add", "SomethingElse")}
        )
        with patch.object(tools, "_generate_canonical_report", side_effect=_report_for):
            result = linking.top_ops(registry, handle)

        assert result["operation_link"]["status"] == LinkStatus.UNLINKED.value
        assert "find_operations" in result["operation_link"]["reason"]
        assert all(row["operation_id"] is None for row in result["ops"])

    def test_a_performance_only_handle_still_answers(self, linked):
        registry, handle = linked(profiler=False)
        with patch.object(tools, "_generate_canonical_report", side_effect=_report_for):
            result = linking.top_ops(registry, handle)

        assert result["operation_link"]["status"] == LinkStatus.UNAVAILABLE.value
        assert result["ops"]

    def test_a_capture_without_a_captured_graph_is_unavailable(self, linked):
        registry, handle = linked(graphs=None)
        with patch.object(tools, "_generate_canonical_report", side_effect=_report_for):
            link = linking.operation_link(registry, handle)

        assert link.status is LinkStatus.UNAVAILABLE
        assert "captured graph" in (link.reason or "")


class TestOperationDetailLink:
    def test_it_lists_the_rows_an_operation_launched(self, linked):
        registry, handle = linked()
        with patch.object(tools, "_generate_canonical_report", side_effect=_report_for):
            result = linking.operation_detail(registry, handle, operation_id=2)

        assert [row["id"] for row in result["perf_rows"]] == ["3"]
        assert result["perf_row_count"] == 1
        assert result["device_time_unit"] == "us"
        assert result["duration_unit"] == "host_seconds"

    def test_an_operation_that_launched_nothing_has_no_rows(self, linked):
        registry, handle = linked()
        with patch.object(tools, "_generate_canonical_report", side_effect=_report_for):
            result = linking.operation_detail(registry, handle, operation_id=1)

        assert result["perf_rows"] == []
        assert result["operation_link"]["status"] == LinkStatus.LINKED.value

    def test_a_profiler_only_handle_omits_perf_rows(self, linked):
        registry, handle = linked(performance=False)

        result = linking.operation_detail(registry, handle, operation_id=2)

        assert "perf_rows" not in result
        assert result["operation_link"]["status"] == LinkStatus.UNAVAILABLE.value

    def test_an_unreadable_performance_report_costs_only_the_perf_rows(self, linked):
        registry, handle = linked()
        with patch.object(
            tools, "_generate_canonical_report", side_effect=ValueError("bad csv")
        ):
            result = linking.operation_detail(registry, handle, operation_id=2)

        assert result["name"] == "ttnn.matmul"
        assert "perf_rows" not in result
        assert "bad csv" in result["operation_link"]["reason"]
