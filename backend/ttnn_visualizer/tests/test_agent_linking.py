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

import csv
import json
import sqlite3
import tempfile
from pathlib import Path
from typing import Dict, List, Optional
from unittest.mock import patch

import pytest
from ttnn_visualizer.agent import linking, server, tools
from ttnn_visualizer.agent.bounds import MAX_LIMIT
from ttnn_visualizer.agent.handles import CacheVariant, ReportRegistry, load_report
from ttnn_visualizer.agent.linking import (
    DeviceOperation,
    LinkStatus,
    MatchedOn,
    UnlinkedReason,
)
from ttnn_visualizer.tests.test_device_log_columns import (
    MODERN_HEADER,
    write_device_log,
)


def _op(name: str, operation_id: int) -> DeviceOperation:
    return DeviceOperation(operation_id, name)


def _perf_row(name: str, row_id: int, op_type: Optional[str] = "tt_dnn_device"):
    return {
        "id": str(row_id),
        "raw_op_code": name,
        "op_code": name,
        "device_time": "1.0",
        "op_type": op_type,
    }


def _perf_rows_for(names: List[str]):
    return [_perf_row(name, index) for index, name in enumerate(names)]


def _duplicated_per_device(names: List[str], num_devices: int):
    return [
        _op(name, index + 1)
        for index, name in enumerate(names)
        for _ in range(num_devices)
    ]


def _matched(start, end, rows, num_devices):
    match = linking.match_device_operations(start, end, rows, num_devices)
    if match is None:
        return []
    return [
        (operation.name, operation.operation_id, row["id"])
        for operation, row in zip(match.device_operations, match.rows)
    ]


class TestMatcherParity:
    """The frontend suite's cases (`tests/deviceOperationMatching.spec.ts`).

    This catches drift in the port only. A change to the app's matcher fails nothing
    here, so a case added there has to be added here too; the spec says so.
    """

    def test_a_multi_device_report_recording_each_op_once_matches_directly(self):
        """#1810: two devices, one entry per device op, and a genuinely repeated
        `Pad` that the collapse mistakes for per-device duplication."""
        ops = [
            _op("PadDeviceOperation", 5),
            _op("TransposeDeviceOperation", 5),
            _op("PadDeviceOperation", 5),
            _op("MatmulDeviceOperation", 6),
        ]
        rows = _perf_rows_for(
            [
                "PadDeviceOperation",
                "TransposeDeviceOperation",
                "PadDeviceOperation",
                "MatmulDeviceOperation",
            ]
        )

        assert [row_id for _, _, row_id in _matched(ops, ops, rows, 2)] == [
            "0",
            "1",
            "2",
            "3",
        ]
        # The collapse alone keeps only the twice-seen `Pad`, so only the direct
        # pass links this report.
        assert len(linking.collapse_multidevice_operations(ops, 2)) == 1

    def test_leading_interleaved_and_trailing_signposts_are_all_dropped(self):
        """#1943: the ids are the rows' own, so they still join the unfiltered report."""
        ops = [_op("Alpha", 1), _op("Beta", 2), _op("Gamma", 3)]
        rows = [
            _perf_row("tt_forward_START", 0, "signpost"),
            _perf_row("Alpha", 1),
            _perf_row("phase_start", 2, "signpost"),
            _perf_row("Beta", 3),
            _perf_row("Gamma", 4),
            _perf_row("phase_end", 5, "signpost"),
            _perf_row("tt_forward_END", 6, "signpost"),
        ]

        assert [row_id for _, _, row_id in _matched(ops, ops, rows, 1)] == [
            "1",
            "3",
            "4",
        ]

    def test_signposts_are_dropped_before_aligning(self):
        rows = [_perf_row("start", 0, "signpost"), _perf_row("Alpha", 1)]
        assert _matched([_op("Alpha", 1)], [_op("Alpha", 1)], rows, 1) == [
            ("Alpha", 1, "1")
        ]

    def test_signposts_are_dropped_on_the_collapsed_fallback_too(self):
        ops = _duplicated_per_device(["Alpha", "Beta"], 2)
        rows = [
            _perf_row("start", 0, "signpost"),
            _perf_row("Alpha", 1),
            _perf_row("Beta", 2),
        ]
        assert _matched(ops, ops, rows, 2) == [("Alpha", 1, "1"), ("Beta", 2, "2")]

    def test_a_report_that_disagrees_once_signposts_are_dropped_is_rejected(self):
        ops = [_op("Alpha", 1), _op("Beta", 2)]
        rows = [_perf_row("Alpha", 0), _perf_row("marker", 1, "signpost")]
        assert _matched(ops, ops, rows, 1) == []

    def test_a_row_with_an_unresolved_op_type_is_kept(self):
        rows = [_perf_row("Alpha", 0, None)]
        assert _matched([_op("Alpha", 1)], [_op("Alpha", 1)], rows, 1) == [
            ("Alpha", 1, "0")
        ]

    def test_it_collapses_a_report_that_records_each_op_once_per_device(self):
        ops = _duplicated_per_device(["Alpha", "Beta", "Gamma"], 2)
        assert _matched(ops, ops, _perf_rows_for(["Alpha", "Beta", "Gamma"]), 2) == [
            ("Alpha", 1, "0"),
            ("Beta", 2, "1"),
            ("Gamma", 3, "2"),
        ]

    def test_it_collapses_a_32_device_report_to_the_merged_rows(self):
        ops = _duplicated_per_device(["Alpha", "Beta"], 32)
        assert len(_matched(ops, ops, _perf_rows_for(["Alpha", "Beta"]), 32)) == 2

    def test_it_matches_when_the_devices_table_is_empty(self):
        ops = [_op("Alpha", 1), _op("Beta", 2)]
        assert len(_matched(ops, ops, _perf_rows_for(["Alpha", "Beta"]), 0)) == 2

    def test_a_single_device_report_keeps_repeated_ops(self):
        ops = [_op("Alpha", 1), _op("Alpha", 1), _op("Beta", 2)]
        rows = _perf_rows_for(["Alpha", "Alpha", "Beta"])
        assert len(_matched(ops, ops, rows, 1)) == 3

    def test_trailing_rows_are_tolerated(self):
        ops = [_op("Alpha", 1)]
        rows = _perf_rows_for(["Alpha", "HostOp", "HostOp"])
        assert _matched(ops, ops, rows, 1) == [("Alpha", 1, "0")]

    @pytest.mark.parametrize(
        "ops, names, num_devices",
        [
            ([_op("Alpha", 1), _op("Beta", 2)], ["Alpha", "Gamma"], 1),
            ([_op("Alpha", 1), _op("Beta", 2)], ["Alpha", "Gamma"], 2),
            (
                [_op("Alpha", 1), _op("Beta", 2), _op("Gamma", 3)],
                ["Alpha", "Beta"],
                1,
            ),
            ([], ["Alpha"], 1),
            # The direct pass agrees on a prefix, then the collapse rejects it.
            (_duplicated_per_device(["Alpha", "Beta"], 2), ["Alpha", "Alpha"], 2),
        ],
    )
    def test_no_partial_match_is_returned(self, ops, names, num_devices):
        assert _matched(ops, ops, _perf_rows_for(names), num_devices) == []

    def test_it_falls_back_to_function_end_order_for_nested_ops(self):
        start = [
            _op("SparseMatmulDeviceOperation", 59),
            _op("UnaryDeviceOperation", 59),
        ]
        end = [
            _op("UnaryDeviceOperation", 59),
            _op("SparseMatmulDeviceOperation", 59),
        ]
        rows = _perf_rows_for(["UnaryDeviceOperation", "SparseMatmulDeviceOperation"])

        match = linking.match_device_operations(start, end, rows, 1)

        assert match is not None and match.matched_on is MatchedOn.FUNCTION_END

    def test_complete_end_order_beats_a_spurious_collapsed_start_prefix(self):
        start = [
            _op("Pad", 1),
            _op("Pad", 1),
            _op("Matmul", 2),
            _op("Outer", 3),
            _op("Inner", 3),
        ]
        end = [
            _op("Pad", 1),
            _op("Pad", 1),
            _op("Matmul", 2),
            _op("Inner", 3),
            _op("Outer", 3),
        ]
        rows = _perf_rows_for(["Pad", "Pad", "Matmul", "Inner", "Outer"])

        assert [name for name, _, _ in _matched(start, end, rows, 2)] == [
            "Pad",
            "Pad",
            "Matmul",
            "Inner",
            "Outer",
        ]

    def test_a_duplicated_nested_sequence_matches_on_the_collapsed_end_pass(self):
        start = [_op("Outer", 1), _op("Outer", 1), _op("Inner", 1), _op("Inner", 1)]
        end = [_op("Inner", 1), _op("Inner", 1), _op("Outer", 1), _op("Outer", 1)]

        match = linking.match_device_operations(
            start, end, _perf_rows_for(["Inner", "Outer"]), 2
        )

        assert match is not None
        assert [operation.name for operation in match.device_operations] == [
            "Inner",
            "Outer",
        ]
        assert match.matched_on is MatchedOn.FUNCTION_END_COLLAPSED

    def test_a_collapsed_end_prefix_omitting_unduplicated_ops_is_rejected(self):
        start = [
            _op("Outer", 1),
            _op("Inner", 1),
            _op("Outer", 1),
            _op("Inner", 1),
            _op("Matmul", 2),
        ]
        end = [
            _op("Inner", 1),
            _op("Outer", 1),
            _op("Inner", 1),
            _op("Outer", 1),
            _op("Matmul", 2),
        ]
        rows = _perf_rows_for(["Inner", "Outer", "Matmul"])

        assert _matched(start, end, rows, 2) == []

    def test_start_order_is_preferred_when_both_align(self):
        start = [_op("Alpha", 10), _op("Alpha", 20)]
        end = [_op("Alpha", 20), _op("Alpha", 10)]
        rows = _perf_rows_for(["Alpha", "Alpha"])

        assert [
            operation_id for _, operation_id, _ in _matched(start, end, rows, 1)
        ] == [
            10,
            20,
        ]

    @pytest.mark.parametrize(
        "start, end, names",
        [
            (
                [_op("Outer", 1), _op("Inner", 1)],
                [_op("Inner", 1)],
                ["Inner", "Outer"],
            ),
            (
                [_op("Outer", 1), _op("Inner", 1)],
                [_op("Inner", 1), _op("Different", 1)],
                ["Inner", "Different"],
            ),
            (
                [_op("Alpha", 1), _op("Alpha", 1), _op("Beta", 1)],
                [_op("Alpha", 1), _op("Beta", 1), _op("Beta", 1)],
                ["Alpha", "Beta", "Beta"],
            ),
        ],
        ids=["incomplete", "different-operation", "different-duplicate-counts"],
    )
    def test_end_order_is_refused_unless_it_holds_the_same_operations(
        self, start, end, names
    ):
        assert _matched(start, end, _perf_rows_for(names), 1) == []

    def test_collapse_keeps_only_keys_seen_once_per_device(self):
        ops = [_op("Alpha", 1), _op("Alpha", 1), _op("Beta", 2)]
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


class TestLinkView:
    def test_the_canonical_projection_is_the_apps_link_view_but_for_host_ops(self):
        """`LINKED_PERFORMANCE_REPORT_FILTERS`: merged, host ops hidden, no range.

        The link filters host ops out of the canonical rows itself, so everything
        else about the projection must already be the app's link view, or a change
        to it would move the link silently.
        """
        assert tools.CANONICAL_PROJECTION["merge_devices"] is True
        assert tools.CANONICAL_PROJECTION["hide_host_ops"] is False
        assert "start_signpost" not in tools.CANONICAL_PROJECTION
        assert "end_signpost" not in tools.CANONICAL_PROJECTION


class TestLinkViewEndToEnd:
    """Filtering the canonical rows must equal what the app links against.

    The mocked tests below hand both views identical ids by construction, so only the
    real generator can show that tt-perf-report keeps each row's id through
    `hide_host_ops` and drops nothing but host ops.
    """

    SMOKE_CAPTURE = Path("scripts/fixtures/smoke-performance-report")

    def _capture_with_a_host_op(self, tmp_path) -> Path:
        source = self.SMOKE_CAPTURE / "ops_perf_results.csv"
        if not source.is_file():
            pytest.skip(f"{source} is not present")
        rows = list(csv.DictReader(source.open()))
        # Mid-report, so a filter that renumbered would shift every later id.
        host_op = {
            **rows[len(rows) // 2],
            "OP CODE": "aten::add (torch)",
            "OP TYPE": "python_fallback",
        }
        rows.insert(len(rows) // 2, host_op)
        destination = tmp_path / "with-host-op"
        destination.mkdir()
        with (destination / "ops_perf_results.csv").open("w", newline="") as out:
            writer = csv.DictWriter(out, fieldnames=list(rows[0].keys()))
            writer.writeheader()
            writer.writerows(rows)
        return destination

    def test_the_filtered_canonical_rows_are_the_link_view(self, tmp_path):
        registry = ReportRegistry()
        capture = self._capture_with_a_host_op(tmp_path)
        handle = load_report(registry, performance_path=str(capture))["handle"]
        instance = registry.get(handle)

        canonical = tools._generate_canonical_report(instance)["report"]
        hidden = tools._generate_canonical_report(instance, hide_host_ops=True)[
            "report"
        ]
        derived = [row for row in canonical if not linking.is_host_op_row(row)]

        assert len(derived) < len(canonical)
        assert [(row["id"], row.get("raw_op_code")) for row in derived] == [
            (row["id"], row.get("raw_op_code")) for row in hidden
        ]


def _graph(*names: str, nested: bool = True) -> str:
    """A captured graph; `nested` closes names in reverse, as a parent wraps a child."""
    nodes: List[Dict[str, object]] = [{"node_type": "capture_start", "params": None}]
    for name in names:
        nodes.append({"node_type": "function_start", "params": {"name": name}})
    for name in reversed(names) if nested else names:
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
"""

_OPERATIONS = [(1, "ttnn.from_torch"), (2, "ttnn.matmul"), (3, "ttnn.add")]

# The two rank-scoped columns `operation_detail` checks, plus the tables the link
# itself reads, all carrying `rank` so a two-rank report is attributable.
_RANKED_PROFILER_SQL = """
CREATE TABLE operations (
    operation_id int, name text, duration float, rank int NOT NULL DEFAULT 0
);
CREATE TABLE captured_graph (
    operation_id int, captured_graph text, rank int NOT NULL DEFAULT 0
);
CREATE TABLE devices (
    device_id int, l1_num_banks int, l1_bank_size int, rank int NOT NULL DEFAULT 0
);
CREATE TABLE buffers (
    operation_id int, device_id int, address int, max_size_per_bank int,
    buffer_type text, buffer_layout int, rank int NOT NULL DEFAULT 0
);
CREATE TABLE tensors (
    tensor_id int, shape text, dtype text, layout text, memory_config text,
    device_id int, address int, buffer_type text, rank int NOT NULL DEFAULT 0
);
CREATE TABLE input_tensors (
    operation_id int, input_index int, tensor_id int, rank int NOT NULL DEFAULT 0
);
CREATE TABLE output_tensors (
    operation_id int, output_index int, tensor_id int, rank int NOT NULL DEFAULT 0
);
"""


def _write_profiler(
    directory: Path,
    graphs: Optional[dict],
    operations=_OPERATIONS,
    devices: int = 1,
) -> str:
    directory.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(directory / "db.sqlite")
    try:
        connection.executescript(_PROFILER_SQL)
        connection.executemany(
            "INSERT INTO operations VALUES (?, ?, 0.1)", list(operations)
        )
        connection.executemany(
            "INSERT INTO devices VALUES (?, 64, 1370848)",
            [(device,) for device in range(1, devices)],
        )
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


# Rank 1's graphs launch nothing rank 0's rows hold, so reading them changes the match.
_OTHER_RANK_GRAPHS = {
    operation_id: _graph(name, "OtherRankDeviceOperation")
    for operation_id, name in [*_OPERATIONS, (4, "ttnn.relu")]
}


def _write_ranked_profiler(
    directory: Path, graphs: dict, rank_zero_devices: int = 1
) -> str:
    """Two ranks, where rank 1 differs from rank 0 in every table the link reads.

    So a read that leaks rank 1 changes the result rather than repeating rank 0's:
    its graphs are written after rank 0's and launch other device operations, it has
    more devices, and it holds an operation 4 that rank 0 has only an orphan graph
    for.
    """
    directory.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(directory / "db.sqlite")
    try:
        connection.executescript(_RANKED_PROFILER_SQL)
        connection.executemany(
            "INSERT INTO operations VALUES (?, ?, 0.1, 0)", _OPERATIONS
        )
        connection.executemany(
            "INSERT INTO operations VALUES (?, ?, 0.1, 1)",
            [*_OPERATIONS, (4, "ttnn.relu")],
        )
        connection.executemany(
            "INSERT INTO captured_graph VALUES (?, ?, 0)",
            [*graphs.items(), (4, _graph("ttnn.relu", "OrphanDeviceOperation"))],
        )
        connection.executemany(
            "INSERT INTO captured_graph VALUES (?, ?, 1)",
            list(_OTHER_RANK_GRAPHS.items()),
        )
        connection.executemany(
            "INSERT INTO devices VALUES (?, 64, 1370848, ?)",
            [(device, 0) for device in range(rank_zero_devices)]
            + [(device, 1) for device in range(rank_zero_devices + 2)],
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
# ids, which is the whole reason the join is needed. The host op sits mid-report, so
# a link run over the canonical rows rather than the link view would fail.
_CANONICAL_ROWS = [
    _perf_row("signpost-start", 2, "signpost"),
    _perf_row("MatmulDeviceOperation", 3),
    {**_perf_row("aten::add (torch)", 4, "python_fallback"), "device_time": "0.5"},
    {**_perf_row("BinaryNgDeviceOperation", 5), "device_time": "9.0"},
]


def _report_for(rows):
    def generate(instance, **overrides):
        return {"report": rows, "stacked_report": [], "signposts": []}

    return generate


@pytest.fixture
def linked(tmp_path):
    """A registry with one handle, and the canonical report patched in for it."""

    patches = []

    def _linked(
        graphs: Optional[dict] = _GRAPHS,
        profiler=True,
        performance=True,
        rows=_CANONICAL_ROWS,
        profiler_path: Optional[str] = None,
        **profiler_options,
    ):
        registry = ReportRegistry()
        perf_dir = tmp_path / "perf"
        perf_dir.mkdir(exist_ok=True)
        write_device_log(perf_dir, MODERN_HEADER, [])
        if profiler_path is None and profiler:
            profiler_path = _write_profiler(
                tmp_path / "profiler", graphs, **profiler_options
            )
        handle = load_report(
            registry,
            profiler_path=profiler_path,
            performance_path=str(perf_dir) if performance else None,
        )["handle"]
        patcher = patch.object(
            tools, "_generate_canonical_report", side_effect=_report_for(rows)
        )
        patches.append(patcher)
        generate = patcher.start()
        return registry, handle, generate

    yield _linked
    for patcher in patches:
        patcher.stop()


class TestTopOpsLink:
    def test_each_row_carries_its_profiler_operation_id(self, linked):
        registry, handle, _ = linked()

        result = linking.top_ops(registry, handle)

        by_id = {row["id"]: row["operation_id"] for row in result["ops"]}
        assert by_id["3"] == 2
        assert by_id["5"] == 3
        assert result["operation_link"]["status"] == LinkStatus.LINKED.value
        assert result["operation_link"]["matched_rows"] == 2
        assert result["operation_link"]["matched_on"] == "function_start"

    def test_a_host_op_row_has_no_operation_id(self, linked):
        registry, handle, _ = linked()

        result = linking.top_ops(registry, handle)

        assert {row["id"]: row["operation_id"] for row in result["ops"]}["4"] is None

    def test_the_report_is_generated_once(self, linked):
        """The link view is filtered from the canonical snapshot, not run again."""
        registry, handle, generate = linked()

        linking.top_ops(registry, handle)
        linking.top_ops(registry, handle, by="op_to_op_gap")
        linking.operation_detail(registry, handle, operation_id=2)

        generate.assert_called_once()

    def test_the_canonical_projection_still_keeps_host_ops(self, linked):
        registry, handle, _ = linked()

        linking.operation_link(registry, handle)
        result = linking.top_ops(registry, handle)

        assert result["op_count"] == len(_CANONICAL_ROWS)

    def test_operations_are_matched_in_id_order_not_table_order(self, linked):
        """The app sorts `GET /operations` by id before matching (`views.py`).

        The walk follows the captured graph rows, so those are reversed too.
        """
        registry, handle, _ = linked(
            graphs=dict(reversed(list(_GRAPHS.items()))),
            operations=list(reversed(_OPERATIONS)),
        )

        result = linking.top_ops(registry, handle)

        assert result["operation_link"]["status"] == LinkStatus.LINKED.value
        assert {row["id"]: row["operation_id"] for row in result["ops"]}["3"] == 2

    def test_an_unlinked_pair_says_so_and_guesses_nothing(self, linked):
        registry, handle, _ = linked(
            graphs={**_GRAPHS, 3: _graph("ttnn.add", "SomethingElse")}
        )

        result = linking.top_ops(registry, handle)

        link = result["operation_link"]
        assert link["status"] == LinkStatus.UNLINKED.value
        assert "find_operations" in link["reason"]
        assert "matched_rows" not in link and "matched_on" not in link
        assert all(row["operation_id"] is None for row in result["ops"])

    def test_every_unlinked_row_is_counted_by_its_reason(self, linked):
        """`top_ops` ranks only rows with a value for its metric, so a signpost
        never appears among its rows; this is the only place it is accounted
        for. Rows 6 and 7 are past the last operation the profiler captured."""
        registry, handle, _ = linked(
            rows=[
                *_CANONICAL_ROWS,
                _perf_row("MatmulDeviceOperation", 6),
                _perf_row("MatmulDeviceOperation", 7),
            ]
        )

        link = linking.top_ops(registry, handle)["operation_link"]

        assert link["unlinked_by_reason"] == {
            UnlinkedReason.SIGNPOST.value: 1,
            UnlinkedReason.HOST_OP.value: 1,
            UnlinkedReason.PAST_PROFILER_CAPTURE.value: 2,
        }
        assert link["first_past_profiler_capture_id"] == "6"
        assert link["unlinked_row_count"] == 4
        assert link["matched_rows"] + link["unlinked_row_count"] == 6

    def test_a_capture_that_ran_to_the_end_names_no_first_row_past_it(self, linked):
        registry, handle, _ = linked()

        link = linking.top_ops(registry, handle)["operation_link"]

        assert (
            link["unlinked_by_reason"][UnlinkedReason.PAST_PROFILER_CAPTURE.value] == 0
        )
        assert link["first_past_profiler_capture_id"] is None

    def test_the_unlinked_rows_cost_the_same_however_many_there_are(self, linked):
        """Counted, not listed: hundreds of host ops must not outweigh the ranking."""
        host_ops = [
            _perf_row(f"op-{index} (torch)", 100 + index, "python_fallback")
            for index in range(MAX_LIMIT * 5)
        ]
        registry, handle, _ = linked(rows=[*_CANONICAL_ROWS, *host_ops])

        link = linking.top_ops(registry, handle, limit=1)["operation_link"]

        assert link["unlinked_row_count"] == MAX_LIMIT * 5 + 2
        assert not any(isinstance(value, list) for value in link.values())
        # The note is a fixed string; everything else is a handful of scalars.
        assert len(json.dumps({**link, "note": None})) < 400

    def test_an_unlinked_pair_counts_no_unlinked_rows(self, linked):
        """Every row is unlinked then, which `status` already says."""
        registry, handle, _ = linked(
            graphs={**_GRAPHS, 3: _graph("ttnn.add", "SomethingElse")}
        )

        link = linking.top_ops(registry, handle)["operation_link"]

        assert "unlinked_by_reason" not in link and "unlinked_row_count" not in link

    def test_operation_detail_carries_no_unlinked_rows(self, linked):
        """They belong to no operation, so they are not any one operation's detail."""
        registry, handle, _ = linked()

        result = linking.operation_detail(registry, handle, operation_id=2)

        assert "unlinked_by_reason" not in result["operation_link"]

    def test_a_performance_only_handle_still_answers(self, linked):
        registry, handle, _ = linked(profiler=False)

        result = linking.top_ops(registry, handle)

        assert result["operation_link"]["status"] == LinkStatus.UNAVAILABLE.value
        assert "note" not in result["operation_link"]
        assert result["ops"]

    def test_a_handle_with_a_profiler_report_carries_the_note(self, linked):
        registry, handle, _ = linked()

        link = linking.top_ops(registry, handle)["operation_link"]

        assert link["note"] == linking.TOP_OPS_LINK_NOTE

    def test_a_profiler_directory_without_a_database_still_answers(
        self, linked, tmp_path
    ):
        empty = tmp_path / "no-database"
        empty.mkdir()
        registry, handle, _ = linked(profiler_path=str(empty))

        result = linking.top_ops(registry, handle)

        assert result["ops"]
        assert result["operation_link"]["status"] == LinkStatus.UNAVAILABLE.value
        assert "db.sqlite" in result["operation_link"]["reason"]

    def test_an_unreadable_profiler_database_still_answers(self, linked, tmp_path):
        """A database `top_ops` never needed must not cost it its answer."""
        broken = tmp_path / "broken"
        broken.mkdir()
        (broken / "db.sqlite").write_bytes(b"this is not a database" * 100)
        registry, handle, _ = linked(profiler_path=str(broken))

        result = linking.top_ops(registry, handle)

        assert result["ops"]
        assert result["operation_link"]["status"] == LinkStatus.UNAVAILABLE.value
        assert "could not be read" in result["operation_link"]["reason"]


class TestGraphReading:
    def test_a_capture_without_a_captured_graph_is_unavailable(self, linked):
        registry, handle, _ = linked(graphs=None)

        link = linking.operation_link(registry, handle)

        assert link.status is LinkStatus.UNAVAILABLE
        assert "captured graph" in (link.reason or "")

    @pytest.mark.parametrize("graph", ["{not json", '{"node_type": "x"}'])
    def test_an_unreadable_graph_refuses_the_link_rather_than_shifting_it(
        self, linked, graph, caplog
    ):
        """Skipping one operation's device ops could still align, wrongly."""
        registry, handle, _ = linked(graphs={**_GRAPHS, 2: graph})

        link = linking.operation_link(registry, handle)

        assert link.status is LinkStatus.UNAVAILABLE
        assert "operation 2" in (link.reason or "")
        assert not link.operation_by_perf_id
        assert "operation 2" in caplog.text

    def test_nodes_that_are_not_lifecycle_nodes_are_skipped(self, linked):
        graph = json.dumps(
            [
                "not a node",
                {"node_type": "capture_start", "params": None},
                {"node_type": "buffer_allocate", "params": "text"},
                {"node_type": "function_start", "params": {"name": "Matmul"}},
                {"node_type": "function_end", "params": {"name": "Matmul"}},
            ]
        )
        rows = [_perf_row("Matmul", 7)]
        registry, handle, _ = linked(graphs={2: graph}, rows=rows)

        link = linking.operation_link(registry, handle)

        assert link.status is LinkStatus.LINKED
        assert link.operation_by_perf_id == {"7": 2}

    @pytest.mark.parametrize("params", [None, "text", {}, {"name": 7}])
    @pytest.mark.parametrize("node_type", ["function_start", "function_end"])
    def test_a_lifecycle_node_without_a_name_refuses_the_link(
        self, linked, node_type, params
    ):
        """Dropping it shortens the order, and a prefix can still align wrongly."""
        nodes = json.loads(_GRAPHS[2])
        nodes.insert(1, {"node_type": node_type, "params": params})
        registry, handle, _ = linked(graphs={**_GRAPHS, 2: json.dumps(nodes)})

        link = linking.operation_link(registry, handle)

        assert link.status is LinkStatus.UNAVAILABLE
        assert "operation 2" in (link.reason or "")
        assert node_type in (link.reason or "")
        assert not link.operation_by_perf_id

    def test_a_child_first_capture_links_on_function_end(self, linked):
        """#1860: the child's workload is enqueued, and profiled, before its parent."""
        rows = [_perf_row("Inner", 7), _perf_row("Outer", 8)]
        registry, handle, _ = linked(
            graphs={2: _graph("ttnn.matmul", "Outer", "Inner")}, rows=rows
        )

        link = linking.operation_link(registry, handle)

        assert link.matched_on is MatchedOn.FUNCTION_END
        assert link.operation_by_perf_id == {"7": 2, "8": 2}

    def test_a_multi_device_capture_links_on_the_collapse(self, linked):
        """The device count comes from the `devices` table."""
        graphs = {
            2: _graph("ttnn.matmul", "Matmul", "Matmul", nested=False),
            3: _graph("ttnn.add", "Add", "Add", nested=False),
        }
        rows = [_perf_row("Matmul", 7), _perf_row("Add", 8)]
        registry, handle, _ = linked(graphs=graphs, rows=rows, devices=2)

        link = linking.operation_link(registry, handle)

        assert link.matched_on is MatchedOn.FUNCTION_START_COLLAPSED
        assert link.operation_by_perf_id == {"7": 2, "8": 3}

    @pytest.mark.parametrize(
        "devices, launches, linked_status",
        [
            # One device written twice: a raw count of 2 would collapse the two
            # launches onto one row, which the app refuses.
            (1, 2, LinkStatus.UNLINKED),
            # Two devices each written twice: a raw count of 4 would expect four
            # copies, and refuse a pair the app links.
            (2, 2, LinkStatus.LINKED),
        ],
        ids=["one-device-twice", "two-devices-twice"],
    )
    def test_devices_are_counted_by_distinct_id_as_the_app_counts_them(
        self, linked, tmp_path, devices, launches, linked_status
    ):
        """`fetchDevices` drops repeated device ids (#425) before matching."""
        graphs = {2: _graph("ttnn.matmul", *(["Matmul"] * launches), nested=False)}
        path = _write_profiler(tmp_path / "duplicated", graphs, devices=devices)
        connection = sqlite3.connect(Path(path) / "db.sqlite")
        try:
            connection.execute("INSERT INTO devices SELECT * FROM devices")
            connection.commit()
        finally:
            connection.close()
        registry, handle, _ = linked(profiler_path=path, rows=[_perf_row("Matmul", 7)])

        link = linking.operation_link(registry, handle)

        assert link.status is linked_status

    def test_a_multi_host_capture_links_at_rank_zero_only(self, linked, tmp_path):
        """Graphs, operations and devices are each read at rank 0.

        Rank 1 differs in all three, and the collapse needs rank 0's device count
        exactly, so a read that leaked rank 1 from any one of them would not link.
        """
        graphs = {
            2: _graph("ttnn.matmul", "Matmul", "Matmul", nested=False),
            3: _graph("ttnn.add", "Add", "Add", nested=False),
        }
        path = _write_ranked_profiler(tmp_path / "ranked", graphs, rank_zero_devices=2)
        rows = [_perf_row("Matmul", 7), _perf_row("Add", 8)]
        registry, handle, _ = linked(profiler_path=path, rows=rows)

        link = linking.operation_link(registry, handle)

        assert link.status is LinkStatus.LINKED
        assert link.rank == 0
        assert link.matched_on is MatchedOn.FUNCTION_START_COLLAPSED
        assert link.operation_by_perf_id == {"7": 2, "8": 3}

    @pytest.mark.parametrize("table", ["captured_graph", "devices"])
    def test_a_multi_host_table_without_rank_refuses_the_link(
        self, linked, tmp_path, table
    ):
        """The rank filter no-ops on that table, so its rows would span both ranks."""
        path = _write_ranked_profiler(tmp_path / "ranked", _GRAPHS)
        connection = sqlite3.connect(Path(path) / "db.sqlite")
        try:
            connection.execute(f"ALTER TABLE {table} DROP COLUMN rank")
            connection.commit()
        finally:
            connection.close()
        registry, handle, _ = linked(profiler_path=path)

        link = linking.operation_link(registry, handle)

        assert link.status is LinkStatus.UNAVAILABLE
        assert f"`{table}`" in (link.reason or "")
        assert not link.operation_by_perf_id


class TestOperationDetailLink:
    def test_it_lists_the_rows_an_operation_launched(self, linked):
        registry, handle, _ = linked()

        result = linking.operation_detail(registry, handle, operation_id=3)

        assert result["perf_rows"] == [
            {
                "id": "5",
                "op_code": "BinaryNgDeviceOperation",
                "device_time": 9.0,
                "cores": None,
                "bound": None,
            }
        ]
        assert result["perf_row_count"] == 1
        assert result["device_time_unit"] == linking.DEVICE_TIME_UNIT
        assert result["duration_unit"] == "host_seconds"

    def test_perf_rows_are_capped_and_the_full_count_kept(self, linked):
        count = MAX_LIMIT + 5
        rows = [_perf_row("Matmul", index) for index in range(count)]
        graph = _graph("ttnn.matmul", *(["Matmul"] * count), nested=False)
        registry, handle, _ = linked(graphs={2: graph}, rows=rows)

        result = linking.operation_detail(registry, handle, operation_id=2)

        assert len(result["perf_rows"]) == MAX_LIMIT
        assert result["perf_row_count"] == count

    def test_an_operation_that_launched_nothing_has_no_rows(self, linked):
        registry, handle, _ = linked()

        result = linking.operation_detail(registry, handle, operation_id=1)

        assert result["perf_rows"] == []
        assert result["operation_link"]["status"] == LinkStatus.LINKED.value

    def test_a_profiler_only_handle_omits_perf_rows(self, linked):
        registry, handle, _ = linked(performance=False)

        result = linking.operation_detail(registry, handle, operation_id=2)

        assert "perf_rows" not in result
        assert result["operation_link"]["status"] == LinkStatus.UNAVAILABLE.value

    def test_an_unreadable_performance_report_costs_only_the_perf_rows(
        self, linked, caplog
    ):
        registry, handle, generate = linked()
        generate.side_effect = ValueError("bad csv")

        result = linking.operation_detail(registry, handle, operation_id=2)

        assert result["name"] == "ttnn.matmul"
        assert "perf_rows" not in result
        assert "bad csv" in result["operation_link"]["reason"]
        # The broad catch also swallows our own bugs, so the traceback is kept.
        (record,) = [r for r in caplog.records if "bad csv" in r.getMessage()]
        assert record.exc_info is not None

    def test_another_ranks_operation_gets_no_perf_rows(self, linked, tmp_path):
        """Ids restart per rank, so rank 1's operation 2 is not rank 0's."""
        path = _write_ranked_profiler(tmp_path / "ranked", _GRAPHS)
        registry, handle, _ = linked(profiler_path=path)

        other = linking.operation_detail(registry, handle, operation_id=2, rank=1)
        linked_rank = linking.operation_detail(registry, handle, operation_id=2, rank=0)

        assert "perf_rows" not in other
        assert other["operation_link"]["status"] == LinkStatus.UNAVAILABLE.value
        assert "rank 0" in other["operation_link"]["reason"]
        assert "rank 1" in other["operation_link"]["reason"]
        assert [row["id"] for row in linked_rank["perf_rows"]] == ["3"]
        assert linked_rank["operation_link"]["rank"] == 0


class TestServerRouting:
    """Reverting either handler to its unlinked tool must fail something."""

    @pytest.fixture(autouse=True)
    def _never_touch_the_real_event_log(self, event_log_directory):
        """Any tools/call reaches the recorder; none may write outside tmp_path."""

    def _call(self, registry, name, arguments):
        response = server.handle_message(
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {"name": name, "arguments": arguments},
            },
            server._tool_table(registry),
        )
        assert response is not None and not response["result"].get("isError")
        return json.loads(response["result"]["content"][0]["text"])

    def test_top_ops_carries_the_link(self, linked):
        registry, handle, _ = linked()

        result = self._call(registry, "top_ops", {"handle": handle})

        assert result["operation_link"]["status"] == LinkStatus.LINKED.value
        assert all("operation_id" in row for row in result["ops"])

    def test_operation_detail_carries_the_link(self, linked):
        registry, handle, _ = linked()

        result = self._call(
            registry, "operation_detail", {"handle": handle, "operation_id": 2}
        )

        assert result["operation_link"]["status"] == LinkStatus.LINKED.value
        assert [row["id"] for row in result["perf_rows"]] == ["3"]


class TestLinkCache:
    def test_the_profiler_database_is_read_once_per_handle(self, linked):
        """The link reads every captured graph, so it is paid for once."""
        registry, handle, _ = linked()

        with patch.object(
            linking.operations,
            "profiler_db",
            wraps=linking.operations.profiler_db,
        ) as opened:
            linking.top_ops(registry, handle)
            linking.top_ops(registry, handle, by="op_to_op_gap")
            linking.operation_link(registry, handle)

        opened.assert_called_once()

    def test_a_link_refused_for_what_the_file_holds_is_cached(self, linked):
        """An unreadable graph stays unreadable, so it is reported once."""
        registry, handle, _ = linked(graphs={**_GRAPHS, 2: "{not json"})

        with patch.object(
            linking.operations,
            "profiler_db",
            wraps=linking.operations.profiler_db,
        ) as opened:
            first = linking.operation_link(registry, handle)
            second = linking.operation_link(registry, handle)

        assert first.status is LinkStatus.UNAVAILABLE
        assert second is first
        opened.assert_called_once()

    def test_a_performance_report_that_failed_once_is_read_again(self, linked):
        """As the canonical report is: a temp-file error in tt-perf-report can pass,
        and a cached failure would contradict a later `top_ops` that read it fine."""
        registry, handle, generate = linked()
        report = _report_for(_CANONICAL_ROWS)(None)
        generate.side_effect = [OSError("too many open files"), report]

        first = linking.operation_detail(registry, handle, operation_id=2)
        second = linking.top_ops(registry, handle)

        assert first["operation_link"]["status"] == LinkStatus.UNAVAILABLE.value
        assert second["operation_link"]["status"] == LinkStatus.LINKED.value
        assert {row["id"]: row["operation_id"] for row in second["ops"]}["3"] == 2

    def test_a_profiler_database_that_failed_once_is_read_again(self, linked):
        """A locked database raises the same `sqlite3.Error` a corrupt one does."""
        registry, handle, _ = linked()
        real = linking.operations.profiler_db
        calls = []

        def locked_once(instance):
            calls.append(instance)
            if len(calls) == 1:
                raise sqlite3.OperationalError("database is locked")
            return real(instance)

        with patch.object(linking.operations, "profiler_db", side_effect=locked_once):
            first = linking.operation_link(registry, handle)
            second = linking.operation_link(registry, handle)

        assert first.status is LinkStatus.UNAVAILABLE
        assert "database is locked" in (first.reason or "")
        assert second.status is LinkStatus.LINKED

    def test_variants_of_one_handle_are_cached_apart(self, linked):
        registry, handle, _ = linked()
        built: List[CacheVariant] = []

        def build(variant):
            def _build(instance):
                built.append(variant)
                return variant.value

            return _build

        for _ in range(2):
            for variant in CacheVariant:
                assert (
                    registry.cached_report(handle, build(variant), variant=variant)
                    == variant.value
                )

        assert sorted(built) == sorted(CacheVariant)

        registry.clear()
        assert not registry._reports


class TestLinkBounds:
    def test_a_captured_graph_past_the_bound_is_not_read(self, linked):
        registry, handle, _ = linked()

        with patch.object(linking, "MAX_CAPTURED_GRAPH_CHARS", 10):
            link = linking.operation_link(registry, handle)

        assert link.status is LinkStatus.UNAVAILABLE
        assert "past the 10" in (link.reason or "")

    def test_the_bound_counts_only_the_rank_the_link_reads(self, linked, tmp_path):
        """The graph read is rank-filtered in SQL, so other ranks are never held.

        A bound of exactly rank 0's size is exceeded by the two ranks together and
        met by the rank actually read.
        """
        path = _write_ranked_profiler(tmp_path / "ranked", _GRAPHS)
        connection = sqlite3.connect(Path(path) / "db.sqlite")
        try:
            (rank_zero_size,) = connection.execute(
                "SELECT SUM(LENGTH(captured_graph)) FROM captured_graph WHERE rank = 0"
            ).fetchone()
        finally:
            connection.close()
        registry, handle, _ = linked(profiler_path=path)

        with patch.object(linking, "MAX_CAPTURED_GRAPH_CHARS", rank_zero_size):
            link = linking.operation_link(registry, handle)

        assert link.status is LinkStatus.LINKED
        assert link.rank == 0

    def test_the_bound_is_far_past_any_real_capture(self):
        """Pinned as a literal: lowering it is a policy change, not a refactor."""
        assert linking.MAX_CAPTURED_GRAPH_CHARS == 1 << 30

    @pytest.mark.parametrize("directory", [tempfile.gettempdir(), "/tmp"])
    def test_a_reason_does_not_carry_the_temp_directory(
        self, linked, monkeypatch, directory
    ):
        """`/tmp` is Linux's, and prefixes the `tmpXXXX` names `tempfile` gives files."""
        monkeypatch.setattr(linking.tempfile, "gettempdir", lambda: directory)
        registry, handle, generate = linked()
        generate.side_effect = ValueError(
            f"cannot parse {directory}/tmpabc123.csv, nor /var{directory}/x"
        )

        reason = linking.operation_link(registry, handle).reason or ""

        assert "<tmp>/tmpabc123.csv" in reason
        assert f"/var{directory}/x" in reason
