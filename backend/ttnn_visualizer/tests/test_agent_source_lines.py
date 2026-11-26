# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Performance rows by the call site of their linked operation: `source_lines`. #2359

`TestGrouping` restates the rules of `getSourceLineGroups` (`src/functions/
perfSourceLines.ts`) on the pure port; the rest runs the tool over a linked report built
as `test_agent_linking.py` builds one, with a `stack_traces` table added.
"""

import sqlite3
from pathlib import Path
from typing import Dict
from unittest.mock import patch

import pytest
from ttnn_visualizer.agent import (
    failures,
    linking,
    operations,
    server,
    source_lines,
    tools,
)
from ttnn_visualizer.agent.bounds import MAX_DETAILED_LIMIT
from ttnn_visualizer.agent.handles import ReportRegistry, load_report
from ttnn_visualizer.agent.source_lines import SourceLineKind, source_line_groups
from ttnn_visualizer.queries import DatabaseQueries
from ttnn_visualizer.tests.smoke_capture import smoke_rows, write_ops_perf
from ttnn_visualizer.tests.test_agent_linking import _GRAPHS as _LINKED_GRAPHS
from ttnn_visualizer.tests.test_agent_linking import (  # noqa: F401 (fixture)
    _graph,
    _perf_row,
    _write_profiler,
    _write_ranked_profiler,
    linked,
)

_OPERATIONS = [
    (1, "ttnn.from_torch"),
    (2, "ttnn.matmul"),
    (3, "ttnn.add"),
    (4, "ttnn.relu"),
]
_GRAPHS = {
    # Host-side work only, so it launches no device operation and no row.
    1: _graph("ttnn.from_torch", "Tensor::to_device"),
    2: _graph("ttnn.matmul", "MatmulDeviceOperation"),
    3: _graph("ttnn.add", "BinaryNgDeviceOperation"),
    4: _graph("ttnn.relu", "UnaryDeviceOperation"),
}
_ROWS = [
    _perf_row("signpost-start", 2, "signpost"),
    {**_perf_row("MatmulDeviceOperation", 3), "device_time": "3.0"},
    {**_perf_row("aten::add (torch)", 4, "python_fallback"), "device_time": ""},
    {**_perf_row("BinaryNgDeviceOperation", 5), "device_time": "9.0"},
    {**_perf_row("UnaryDeviceOperation", 6), "device_time": "4.0"},
    # Past the end of the memory report capture: no operation launched it.
    {**_perf_row("UnaryDeviceOperation", 7), "device_time": "1.5"},
]


def _trace(path: str, line: int, function: str = "forward") -> str:
    return (
        f'  File "{path}", line {line}, in {function}\n'
        "    x = ttnn.op(x)\n"
        '  File "/harness/run.py", line 1, in <module>\n'
        "    main()\n"
    )


# Two files share a basename, and ops 2 and 4 share a line, so the key is the full path.
_TRACES = {
    2: _trace("/model/a/block.py", 10),
    3: _trace("/model/b/block.py", 10, "mlp"),
    4: _trace("/model/a/block.py", 10),
}


def _add_traces(profiler_path: str, traces: Dict[int, object]) -> None:
    """A `stack_traces` table with no `rank` column, as a single-host capture writes."""
    connection = sqlite3.connect(Path(profiler_path, "db.sqlite"))
    try:
        connection.execute(
            "CREATE TABLE stack_traces (operation_id int, stack_trace text)"
        )
        connection.executemany(
            "INSERT INTO stack_traces VALUES (?, ?)", list(traces.items())
        )
        connection.commit()
    finally:
        connection.close()


def _add_ranked_traces(
    profiler_path: str, traces_by_rank: Dict[int, Dict[int, str]]
) -> None:
    """A `stack_traces` table carrying `rank`, as a multi-host capture writes."""
    connection = sqlite3.connect(Path(profiler_path, "db.sqlite"))
    try:
        connection.execute(
            "CREATE TABLE stack_traces "
            "(operation_id int, stack_trace text, rank int NOT NULL DEFAULT 0)"
        )
        connection.executemany(
            "INSERT INTO stack_traces VALUES (?, ?, ?)",
            [
                (operation_id, trace, rank)
                for rank, traces in traces_by_rank.items()
                for operation_id, trace in traces.items()
            ],
        )
        connection.commit()
    finally:
        connection.close()


@pytest.fixture
def traced(linked, tmp_path):
    def _traced(traces=_TRACES, rows=_ROWS, graphs=_GRAPHS, table=True):
        path = _write_profiler(tmp_path / "traced", graphs, operations=_OPERATIONS)
        if table:
            _add_traces(path, traces)
        registry, handle, _ = linked(profiler_path=path, rows=rows)
        return registry, handle

    return _traced


def _by_location(result):
    return {
        (
            (group["call_site"] or {}).get("file"),
            (group["call_site"] or {}).get("line"),
        ): group
        for group in result["groups"]
    }


class TestGrouping:
    """`getSourceLineGroups`' rules, on the port alone."""

    @staticmethod
    def _groups(rows, operation_by_perf_id, sites):
        return source_line_groups(
            rows,
            operation_by_perf_id,
            sites,
            tools.countable_device_time,
            lambda row: "host_op",
        )

    def test_a_row_with_no_device_time_counts_as_a_row_only(self):
        site = {"file": "/m.py", "line": 1, "function": "f", "code": None}
        rows = [
            {"id": "1", "raw_op_code": "A", "device_time": "2.0"},
            {"id": "2", "raw_op_code": "B", "device_time": ""},
            {"id": "3", "raw_op_code": "C", "device_time": "-1"},
        ]

        [group] = self._groups(rows, {"1": 7, "2": 7, "3": 8}, {7: site, 8: site})

        assert group.row_count == 3
        assert group.device_time == 2.0
        assert group.device_time_by_op_code == {"A": 2.0}
        assert list(group.operation_ids) == [7, 8]

    def test_top_op_codes_rank_by_device_time_then_name(self):
        site = {"file": "/m.py", "line": 1, "function": "f", "code": None}
        times = {"D": 1.0, "C": 5.0, "B": 3.0, "A": 3.0}
        rows = [
            {"id": str(index), "raw_op_code": code, "device_time": str(time)}
            for index, (code, time) in enumerate(times.items())
        ]

        [group] = self._groups(rows, {row["id"]: 1 for row in rows}, {1: site})

        assert group.top_op_codes() == [("C", 5.0), ("A", 3.0), ("B", 3.0)]
        assert len(group.top_op_codes()) == source_lines.TOP_OP_CODE_COUNT

    def test_ties_on_device_time_break_by_kind_then_path_then_line(self):
        def site(path, line):
            return {"file": path, "line": line, "function": "f", "code": None}

        rows = [
            {"id": str(index), "raw_op_code": "A", "device_time": "1.0"}
            for index in range(5)
        ]
        sites = {1: site("/b.py", 2), 2: site("/a.py", 9), 3: site("/a.py", 10)}
        groups = self._groups(
            rows, {"0": 1, "1": 2, "2": 3, "3": 4}, {**sites, 4: None}
        )

        assert [
            (group.kind, (group.call_site or {}).get("line")) for group in groups
        ] == [
            (SourceLineKind.LINE, 10),  # "10" sorts before "9", as the app's key does
            (SourceLineKind.LINE, 9),
            (SourceLineKind.LINE, 2),
            (SourceLineKind.NO_TRACE, None),
            (SourceLineKind.UNLINKED, None),
        ]

    def test_paths_differing_only_in_case_order_by_code_point(self):
        """Pinned because it differs from the app: `localeCompare` would put
        `/model.py` first, and code point order puts `/Model.py` first."""
        rows = [
            {"id": str(index), "raw_op_code": "A", "device_time": "1.0"}
            for index in range(2)
        ]
        sites = {
            1: {"file": "/model.py", "line": 1, "function": "f", "code": None},
            2: {"file": "/Model.py", "line": 1, "function": "f", "code": None},
        }

        groups = self._groups(rows, {"0": 1, "1": 2}, sites)

        assert [(group.call_site or {}).get("file") for group in groups] == [
            "/Model.py",
            "/model.py",
        ]

    def test_a_timed_row_without_an_op_code_is_filed_under_an_empty_one(self):
        site = {"file": "/m.py", "line": 1, "function": "f", "code": None}
        rows = [{"id": "1", "raw_op_code": None, "device_time": "2.0"}]

        [group] = self._groups(rows, {"1": 1}, {1: site})

        assert group.top_op_codes() == [("", 2.0)]

    def test_operation_ids_keep_first_seen_order_and_list_a_bounded_prefix(self):
        site = {"file": "/m.py", "line": 1, "function": "f", "code": None}
        count = source_lines.MAX_LISTED_OPERATION_IDS + 5
        rows = [
            {"id": str(index), "raw_op_code": "A", "device_time": "1.0"}
            for index in range(count)
        ]
        mapping = {str(index): count - index for index in range(count)}

        [group] = self._groups(rows, mapping, dict.fromkeys(mapping.values(), site))
        entry = source_lines.group_entry(group, failures.call_site_entry, lambda _: 1)

        assert entry["operation_count"] == count
        assert entry["operation_ids"] == list(range(count, 5, -1))


class TestSourceLines:
    def test_rows_are_summed_per_full_path_and_line(self, traced):
        registry, handle = traced()

        result = linking.source_lines_by_call_site(registry, handle)

        groups = _by_location(result)
        a, b = groups[("/model/a/block.py", 10)], groups[("/model/b/block.py", 10)]
        assert a["device_time"] == 7.0
        assert a["row_count"] == 2
        assert a["operation_ids"] == [2, 4]
        assert [code["op_code"] for code in a["top_op_codes"]] == [
            "UnaryDeviceOperation",
            "MatmulDeviceOperation",
        ]
        assert a["call_site"]["function"] == "forward"
        assert a["call_site"]["code"] == "x = ttnn.op(x)"
        assert b["device_time"] == 9.0
        assert b["call_site"]["function"] == "mlp"
        assert result["device_time_total"] == 17.5
        assert result["device_time_unit"] == tools.DEVICE_TIME_UNIT
        assert [group["kind"] for group in result["groups"]] == [
            "line",
            "line",
            "unlinked",
        ]
        assert result["groups"][0]["call_site"]["file"] == "/model/b/block.py"

    def test_the_shares_are_of_the_rows_read_and_add_up(self, traced):
        registry, handle = traced()

        result = linking.source_lines_by_call_site(registry, handle)

        assert [group["device_time_share_percent"] for group in result["groups"]] == [
            tools.share_percent(time, 17.5) for time in (9.0, 7.0, 1.5)
        ]

    def test_rows_without_an_operation_are_one_group_counted_by_why(self, traced):
        registry, handle = traced()

        result = linking.source_lines_by_call_site(registry, handle)

        [unlinked] = [g for g in result["groups"] if g["kind"] == "unlinked"]
        assert unlinked["call_site"] is None
        assert unlinked["row_count"] == 2
        assert unlinked["device_time"] == 1.5
        assert unlinked["operation_ids"] == []
        assert unlinked["unlinked_by_reason"] == {
            "host_op": 1,
            "past_profiler_capture": 1,
        }
        # Signposts are left out altogether, as the stacked table leaves them out.
        assert result["row_count"] == 5

    @pytest.mark.parametrize(
        "trace",
        [None, "no frame in this text", '  File "/m.py", line 0, in f\n'],
        # Line 0 is the one case the app answers differently: it groups it as a line.
        ids=["missing", "frameless", "line-zero-diverges-from-app"],
    )
    def test_an_operation_without_a_readable_trace_is_its_own_group(
        self, traced, trace
    ):
        traces = {key: value for key, value in _TRACES.items() if key != 3}
        if trace is not None:
            traces[3] = trace
        registry, handle = traced(traces=traces)

        result = linking.source_lines_by_call_site(registry, handle)

        [untraced] = [g for g in result["groups"] if g["kind"] == "no_trace"]
        assert untraced["call_site"] is None
        assert untraced["operation_ids"] == [3]
        assert untraced["device_time"] == 9.0
        assert "1 linked operations, launching 1 rows, have no source line" in (
            result["caveat"]
        )

    def test_the_untraced_caveat_holds_when_the_limit_leaves_that_group_out(
        self, traced
    ):
        traces = {key: value for key, value in _TRACES.items() if key != 3}
        registry, handle = traced(traces=traces)

        result = linking.source_lines_by_call_site(registry, handle, limit=1)

        assert [group["kind"] for group in result["groups"]] == ["no_trace"]
        assert result["rest"]["group_count"] == 2
        assert "1 linked operations, launching 1 rows" in result["caveat"]

    def test_the_untraced_caveat_holds_when_the_page_starts_past_that_group(
        self, traced
    ):
        traces = {key: value for key, value in _TRACES.items() if key != 3}
        registry, handle = traced(traces=traces)

        result = linking.source_lines_by_call_site(registry, handle, offset=1)

        assert "no_trace" not in [group["kind"] for group in result["groups"]]
        assert "rest" not in result
        assert "1 linked operations, launching 1 rows" in result["caveat"]

    def test_a_partitioned_run_carries_its_caveat(self, traced):
        registry, handle = traced()

        with patch.object(
            tools, "partitioned_caveat", return_value="Partitioned run caveat."
        ):
            result = linking.source_lines_by_call_site(registry, handle)

        assert result["caveat"] == "Partitioned run caveat."

    def test_with_no_countable_device_time_the_shares_are_null(self, traced):
        """`share_percent` has no share of nothing, where the app shows 0%."""
        rows = [
            {**row, "device_time": ""} if row["op_type"] != "signpost" else row
            for row in _ROWS
        ]
        registry, handle = traced(rows=rows)

        result = linking.source_lines_by_call_site(registry, handle, limit=1)

        assert result["device_time_total"] == 0
        assert result["row_count"] == 5
        assert all(
            group["device_time_share_percent"] is None for group in result["groups"]
        )
        assert result["rest"]["device_time_share_percent"] is None
        assert (
            sum(group["row_count"] for group in result["groups"])
            + result["rest"]["row_count"]
            == 5
        )

    def test_operations_with_one_frame_0_share_one_site(self, traced):
        """Shared by frame 0, not by trace text, so traces whose outer frames differ
        per call are not all held to the end of the read. #2364"""
        traces = {
            operation_id: _trace("/model/a/block.py", 10).replace(
                "line 1, in <module>", f"line {operation_id}, in <module>"
            )
            for operation_id in (2, 3, 4)
        }
        registry, handle = traced(traces=traces)
        read_call_sites = failures.read_call_sites
        read = []

        def recorded(*args, **kwargs):
            read.append(read_call_sites(*args, **kwargs))
            return read[-1]

        with patch.object(failures, "read_call_sites", side_effect=recorded):
            result = linking.source_lines_by_call_site(registry, handle)

        (sites,) = read
        assert len({id(sites[operation_id]) for operation_id in (2, 3, 4)}) == 1
        assert _by_location(result)[("/model/a/block.py", 10)]["operation_ids"] == [
            2,
            3,
            4,
        ]

    def test_a_blob_trace_reads_as_no_trace(self, traced):
        """A trace stored as a BLOB names no frame, as `getCallSiteFrame` reads a
        non-string, rather than failing the whole answer. #2364"""
        traces: Dict[int, object] = {**_TRACES, 3: _TRACES[3].encode()}
        registry, handle = traced(traces=traces)

        result = linking.source_lines_by_call_site(registry, handle)

        (untraced,) = [g for g in result["groups"] if g["kind"] == "no_trace"]
        assert untraced["operation_ids"] == [3]
        assert ("/model/a/block.py", 10) in _by_location(result)

    def test_an_unknown_signpost_is_refused_before_the_link_is_asked(self, traced):
        # Unlinked as well, so the order of the two refusals decides which is raised.
        registry, handle = traced(rows=_ROWS[:4])

        with pytest.raises(ValueError, match="no signpost named 'missing'"):
            linking.source_lines_by_call_site(
                registry, handle, start_signpost="missing"
            )

    def test_a_fully_traced_report_carries_no_caveat(self, traced):
        registry, handle = traced()

        assert "caveat" not in linking.source_lines_by_call_site(registry, handle)

    def test_a_signpost_range_groups_the_window_and_scopes_the_link(self, traced):
        registry, handle = traced()

        result = linking.source_lines_by_call_site(
            registry, handle, start_signpost="signpost-start"
        )

        # The fixture's window drops the signpost and the matmul row after it.
        a = _by_location(result)[("/model/a/block.py", 10)]
        assert a["device_time"] == 4.0
        assert a["operation_ids"] == [4]
        assert result["device_time_total"] == 14.5
        assert result["projection"]["start_signpost"] == "signpost-start"
        assert result["operation_link"]["scope"] == linking.WHOLE_REPORT_SCOPE
        assert result["operation_link"]["note"] == linking.SOURCE_LINES_RANGED_LINK_NOTE
        assert result["operation_link"]["matched_rows"] == 3
        # Of the window's total, not of the whole report's 17.5. #2364
        assert [group["device_time_share_percent"] for group in result["groups"]] == [
            tools.share_percent(group["device_time"], 14.5)
            for group in result["groups"]
        ]

    def test_the_limit_caps_the_groups_and_rest_sums_the_others(self, traced):
        registry, handle = traced()

        result = linking.source_lines_by_call_site(registry, handle, limit=1)

        assert (result["offset"], result["returned"], result["next_offset"]) == (
            0,
            1,
            1,
        )
        assert result["group_count"] == 3
        assert result["rest"] == {
            "group_count": 2,
            "device_time": 8.5,
            "device_time_share_percent": tools.share_percent(8.5, 17.5),
            "row_count": 4,
        }

    def test_the_limit_is_capped(self, traced):
        registry, handle = traced()

        with patch.object(source_lines, "source_line_groups") as grouped:
            grouped.return_value = [
                source_lines.SourceLineGroup(SourceLineKind.NO_TRACE, None)
            ] * (MAX_DETAILED_LIMIT + 3)
            result = linking.source_lines_by_call_site(registry, handle, limit=1000)

        assert result["returned"] == MAX_DETAILED_LIMIT
        assert result["next_offset"] == MAX_DETAILED_LIMIT
        assert result["rest"]["group_count"] == 3

    def test_offset_pages_to_every_group(self, traced):
        registry, handle = traced()
        whole = linking.source_lines_by_call_site(registry, handle)

        pages = []
        offset = 0
        # Bounded, so a next_offset that never moves fails rather than spins.
        while offset is not None and len(pages) <= whole["group_count"]:
            pages.append(
                linking.source_lines_by_call_site(
                    registry, handle, limit=1, offset=offset
                )
            )
            offset = pages[-1]["next_offset"]

        assert [(page["offset"], page["returned"]) for page in pages] == [
            (0, 1),
            (1, 1),
            (2, 1),
        ]
        assert [group for page in pages for group in page["groups"]] == whole["groups"]
        assert whole["next_offset"] is None
        assert "rest" not in whole

    def test_rest_sums_only_the_groups_after_the_page(self, traced):
        registry, handle = traced()

        middle = linking.source_lines_by_call_site(registry, handle, limit=1, offset=1)
        last = linking.source_lines_by_call_site(registry, handle, limit=1, offset=2)

        # Groups rank b (9.0), a (7.0), then unlinked (1.5, 2 rows).
        assert _by_location(middle).keys() == {("/model/a/block.py", 10)}
        assert middle["rest"] == {
            "group_count": 1,
            "device_time": 1.5,
            "device_time_share_percent": tools.share_percent(1.5, 17.5),
            "row_count": 2,
        }
        assert "rest" not in last
        assert last["next_offset"] is None

    def test_a_later_page_keeps_the_shares_of_every_group(self, traced):
        registry, handle = traced()

        result = linking.source_lines_by_call_site(registry, handle, offset=1)

        assert result["device_time_total"] == 17.5
        assert [group["device_time_share_percent"] for group in result["groups"]] == [
            tools.share_percent(time, 17.5) for time in (7.0, 1.5)
        ]
        # A last page cut short by the ranking's end, not by the limit.
        assert (result["returned"], result["next_offset"]) == (2, None)
        assert "rest" not in result

    def test_a_page_of_a_signpost_range_pages_the_window(self, traced):
        registry, handle = traced()
        window = linking.source_lines_by_call_site(
            registry, handle, start_signpost="signpost-start"
        )

        result = linking.source_lines_by_call_site(
            registry, handle, start_signpost="signpost-start", limit=1, offset=1
        )

        # Paged against the window's groups, not the whole report's.
        assert result["group_count"] == window["group_count"]
        assert result["groups"] == window["groups"][1:2]
        # The window has 3 groups, so one is left after the page, and rest is it.
        assert window["group_count"] == 3
        assert result["next_offset"] == 2
        assert result["rest"]["group_count"] == 1
        assert result["rest"]["device_time"] == window["groups"][2]["device_time"]

    def test_a_page_starts_at_the_top_unless_given_an_offset(self, traced):
        registry, handle = traced()

        unset = linking.source_lines_by_call_site(registry, handle)

        assert unset == linking.source_lines_by_call_site(registry, handle, offset=0)
        assert unset["offset"] == 0

    def test_an_offset_past_the_end_returns_nothing_and_says_where(self, traced):
        registry, handle = traced()

        result = linking.source_lines_by_call_site(registry, handle, offset=50)

        assert (result["offset"], result["returned"], result["next_offset"]) == (
            3,
            0,
            None,
        )
        assert result["groups"] == []
        assert "rest" not in result

    @pytest.mark.parametrize(
        "offset, message",
        [
            (-1, "offset must be 0 or more"),
            ("two", "offset must be a whole number"),
            (1.5, "offset must be a whole number"),
            (True, "offset must be a whole number"),
        ],
    )
    def test_a_bad_offset_is_refused_before_the_report_is_read(
        self, traced, offset, message
    ):
        registry, handle = traced()

        with patch.object(tools, "canonical_report") as read:
            with pytest.raises(ValueError, match=message):
                linking.source_lines_by_call_site(registry, handle, offset=offset)

        read.assert_not_called()

    def test_traces_are_read_once_per_handle_whatever_the_range(self, traced):
        registry, handle = traced()

        with patch.object(
            DatabaseQueries,
            "query_stack_traces",
            autospec=True,
            side_effect=DatabaseQueries.query_stack_traces,
        ) as read:
            linking.source_lines_by_call_site(registry, handle)
            linking.source_lines_by_call_site(
                registry, handle, start_signpost="signpost-start"
            )

        assert read.call_count == 1

    def test_traces_are_read_in_batches(self, traced):
        registry, handle = traced()

        with (
            patch.object(failures, "STACK_TRACE_IDS_PER_READ", 2),
            patch.object(
                DatabaseQueries,
                "query_stack_traces",
                autospec=True,
                side_effect=DatabaseQueries.query_stack_traces,
            ) as read,
        ):
            result = linking.source_lines_by_call_site(registry, handle)

        # Ops 2, 3 and 4 linked: two reads of at most two ids.
        assert read.call_count == 2
        assert len(_by_location(result)) == 3

    def test_it_refuses_a_report_that_did_not_link(self, traced):
        # The unary rows go, so the device operation sequence finds no row for op 4.
        registry, handle = traced(rows=_ROWS[:4])

        with pytest.raises(ValueError, match="linked to the memory report"):
            linking.source_lines_by_call_site(registry, handle)

    @pytest.mark.parametrize("table", [True, False], ids=["empty", "absent"])
    def test_it_refuses_a_capture_that_records_no_stack_traces(self, traced, table):
        registry, handle = traced(traces={}, table=table)

        with pytest.raises(ValueError, match="records no stack traces"):
            linking.source_lines_by_call_site(registry, handle)

    @pytest.mark.parametrize(
        "trace",
        ["#0 0x7f00 in tt::tt_metal::Program::compile()\n", ""],
        ids=["cpp-backtrace", "empty"],
    )
    def test_it_refuses_traces_that_name_no_python_frame(self, traced, trace):
        """As the app disables Source line when no operation has a call site. #2364"""
        registry, handle = traced(traces={2: trace, 3: trace, 4: trace})

        with pytest.raises(ValueError, match="stack trace names a Python frame"):
            linking.source_lines_by_call_site(registry, handle)

    def test_a_dense_read_streams_every_trace_once(self, linked, tmp_path):
        """Past the scan threshold the traces are read in one pass, with the same
        answer the batched read gives."""
        path = _write_profiler(tmp_path / "dense", _GRAPHS, operations=_OPERATIONS)
        _add_traces(path, _TRACES)
        registry, handle, _ = linked(profiler_path=path, rows=_ROWS)
        batched = linking.source_lines_by_call_site(registry, handle)
        # A fresh registry, so its call sites are read again rather than reused. Not a
        # second `linked` call: its patches would stop in the wrong order and leak.
        registry = ReportRegistry()
        handle = load_report(
            registry, profiler_path=path, performance_path=str(tmp_path / "perf")
        )["handle"]

        with (
            patch.object(failures, "STACK_TRACE_SCAN_IDS", 1),
            patch.object(
                DatabaseQueries,
                "iter_stack_traces",
                autospec=True,
                side_effect=DatabaseQueries.iter_stack_traces,
            ) as streamed,
            patch.object(
                DatabaseQueries, "query_stack_traces", autospec=True
            ) as batches,
        ):
            result = linking.source_lines_by_call_site(registry, handle)

        assert streamed.call_count == 1
        assert batches.call_count == 0
        assert result["groups"] == batched["groups"]

    @pytest.mark.parametrize("rank", [None, 0])
    # 0 takes the streamed read, which every capture past the threshold takes.
    @pytest.mark.parametrize("scan_ids", [failures.STACK_TRACE_SCAN_IDS, 0])
    def test_a_multi_host_report_files_rows_by_the_linked_ranks_traces(
        self, linked, tmp_path, rank, scan_ids
    ):
        # Rank 1's operation 2 has a trace of its own; filed under rank 0's rows,
        # it would name a path rank 0 never ran.
        path = _write_ranked_profiler(tmp_path / "ranked", _LINKED_GRAPHS)
        _add_ranked_traces(
            path,
            {
                1: {2: _trace("/rank1/model.py", 7), 3: _trace("/rank1/model.py", 8)},
                0: {2: _trace("/rank0/model.py", 1), 3: _trace("/rank0/model.py", 2)},
            },
        )
        registry, handle, _ = linked(profiler_path=path)

        with patch.object(failures, "STACK_TRACE_SCAN_IDS", scan_ids):
            result = linking.source_lines_by_call_site(registry, handle, rank=rank)

        files = {
            group["call_site"]["file"]
            for group in result["groups"]
            if group["call_site"] is not None
        }
        assert files == {"/rank0/model.py"}
        assert result["rank"] == 0
        assert "multi-host report read at rank 0" in result["caveat"]

    def test_it_refuses_a_rank_whose_traces_are_all_on_another_rank(
        self, linked, tmp_path
    ):
        """The capture records traces, but none at the linked rank. #2364"""
        path = _write_ranked_profiler(tmp_path / "ranked", _LINKED_GRAPHS)
        _add_ranked_traces(path, {1: {2: _trace("/rank1/model.py", 7)}})
        registry, handle, _ = linked(profiler_path=path)

        with pytest.raises(ValueError, match="at rank 0 names a Python frame"):
            linking.source_lines_by_call_site(registry, handle)

    def test_a_multi_host_report_with_rankless_traces_is_refused(
        self, linked, tmp_path
    ):
        """Traces that cannot be told apart by rank would file one rank's call sites
        under another's rows."""
        path = _write_ranked_profiler(tmp_path / "ranked", _LINKED_GRAPHS)
        _add_traces(path, {2: _trace("/m.py", 1)})
        registry, handle, _ = linked(profiler_path=path)

        with pytest.raises(operations.UnattributableRankError, match="stack_traces"):
            linking.source_lines_by_call_site(registry, handle)

    def test_it_refuses_a_rank_a_single_host_report_lacks(self, traced):
        registry, handle = traced()

        with pytest.raises(ValueError, match="holds rank 0 only"):
            linking.source_lines_by_call_site(registry, handle, rank=1)

    def test_it_refuses_a_rank_other_than_the_linked_one(self, linked, tmp_path):
        path = _write_ranked_profiler(tmp_path / "ranked", _LINKED_GRAPHS)
        _add_ranked_traces(path, {0: {2: _trace("/m.py", 1)}})
        registry, handle, _ = linked(profiler_path=path)

        with pytest.raises(
            ValueError, match="linked to rank 0 only; the grouping was read at rank 1"
        ):
            linking.source_lines_by_call_site(registry, handle, rank=1)

    def test_load_report_lists_it_only_with_both_reports_and_traces(self, tmp_path):
        traced_path = _write_profiler(
            tmp_path / "traced", _GRAPHS, operations=_OPERATIONS
        )
        _add_traces(traced_path, _TRACES)
        untraced_path = _write_profiler(
            tmp_path / "untraced", _GRAPHS, operations=_OPERATIONS
        )
        performance = tmp_path / "performance"
        performance.mkdir()
        write_ops_perf(performance, smoke_rows())

        def answerable(profiler_path, performance_path):
            return load_report(
                ReportRegistry(),
                profiler_path=profiler_path,
                performance_path=performance_path,
            )["answerable"]

        assert "source_lines" in answerable(traced_path, str(performance))
        assert "source_lines" not in answerable(traced_path, None)
        assert "source_lines" not in answerable(untraced_path, str(performance))
        # Listed by its tables alone: an empty table is answerable, and the call
        # itself refuses it, saying the capture records no stack traces.
        empty_path = _write_profiler(
            tmp_path / "empty", _GRAPHS, operations=_OPERATIONS
        )
        _add_traces(empty_path, {})
        assert "source_lines" in answerable(empty_path, str(performance))

    def test_the_server_routes_it_with_a_link_template(self, traced):
        registry, handle = traced()

        result = server._tool_table(registry)["source_lines"]["handler"](
            {"handle": handle, "limit": 1, "offset": 1}
        )

        assert "{operation_id}" in result["app_link_template"]
        assert result["note"] == source_lines.SOURCE_LINES_NOTE
        assert (result["offset"], result["next_offset"]) == (1, 2)

    def test_the_server_offers_offset_and_describes_paging(self, traced):
        registry, _ = traced()

        tool = server._tool_table(registry)["source_lines"]

        assert tool["schema"]["properties"]["offset"]["type"] == "integer"
        assert source_lines.PAGING in tool["description"]

    def test_the_server_offers_path_contains_and_describes_it(self, traced):
        registry, handle = traced()

        tool = server._tool_table(registry)["source_lines"]
        result = tool["handler"]({"handle": handle, "path_contains": "/model/a/"})

        assert tool["schema"]["properties"]["path_contains"]["type"] == "string"
        assert source_lines.PATH_FILTER in tool["description"]
        assert source_lines.PATH_FILTER in source_lines.SOURCE_LINES_NOTE
        assert result["group_count"] == 1


class TestPathFilter:
    """`path_contains` scopes the groups to a path, the shares staying of every row
    read. #2401"""

    def test_it_keeps_the_matching_lines_ignoring_case_and_spaces(self, traced):
        registry, handle = traced()

        result = linking.source_lines_by_call_site(
            registry, handle, path_contains=" /MODEL/A/ "
        )

        assert _by_location(result).keys() == {("/model/a/block.py", 10)}
        assert result["group_count"] == 1
        assert result["path_contains"] == " /MODEL/A/ "

    def test_the_shares_stay_of_every_row_read(self, traced):
        registry, handle = traced()

        result = linking.source_lines_by_call_site(
            registry, handle, path_contains="/model/a/"
        )

        [group] = result["groups"]
        assert result["device_time_total"] == 17.5
        assert result["row_count"] == 5
        assert group["device_time_share_percent"] == tools.share_percent(7.0, 17.5)
        assert result["matching_row_count"] == 2
        assert result["matching_device_time"] == 7.0
        assert result["matching_device_time_share_percent"] == tools.share_percent(
            7.0, 17.5
        )

    def test_it_leaves_out_the_pathless_groups_and_says_so(self, traced):
        traces = {key: value for key, value in _TRACES.items() if key != 3}
        registry, handle = traced(traces=traces)

        result = linking.source_lines_by_call_site(
            registry, handle, path_contains="block.py"
        )

        assert [group["kind"] for group in result["groups"]] == ["line"]
        assert (
            "path_contains leaves out the no_trace group (1 row) and the unlinked "
            "group (2 rows), which have no path"
        ) in result["caveat"]
        # The untraced caveat still counts every row read, not the matching ones.
        assert "1 linked operations, launching 1 rows" in result["caveat"]

    def test_a_filter_over_a_report_with_only_lines_adds_no_caveat(self, traced):
        rows = [row for row in _ROWS if row["id"] not in ("4", "7")]
        registry, handle = traced(rows=rows)

        result = linking.source_lines_by_call_site(
            registry, handle, path_contains="block.py"
        )

        assert "caveat" not in result
        assert result["group_count"] == 2

    def test_it_pages_and_rests_over_the_matching_groups(self, traced):
        registry, handle = traced()

        first = linking.source_lines_by_call_site(
            registry, handle, path_contains="block.py", limit=1
        )
        second = linking.source_lines_by_call_site(
            registry, handle, path_contains="block.py", limit=1, offset=1
        )

        assert first["group_count"] == 2
        assert (first["returned"], first["next_offset"]) == (1, 1)
        # The unlinked group is neither a page's nor rest's.
        assert first["rest"] == {
            "group_count": 1,
            "device_time": 7.0,
            "device_time_share_percent": tools.share_percent(7.0, 17.5),
            "row_count": 2,
        }
        assert first["matching_device_time"] == 16.0
        assert _by_location(second).keys() == {("/model/a/block.py", 10)}
        assert second["next_offset"] is None
        assert "rest" not in second

    def test_a_filter_matching_nothing_returns_no_groups(self, traced):
        registry, handle = traced()

        result = linking.source_lines_by_call_site(
            registry, handle, path_contains="/elsewhere/"
        )

        assert (result["group_count"], result["groups"]) == (0, [])
        assert result["next_offset"] is None
        assert "rest" not in result
        assert (result["matching_row_count"], result["matching_device_time"]) == (
            0,
            0.0,
        )
        assert result["device_time_total"] == 17.5

    def test_spaces_alone_filter_nothing(self, traced):
        registry, handle = traced()

        unfiltered = linking.source_lines_by_call_site(registry, handle)
        spaces = linking.source_lines_by_call_site(registry, handle, path_contains="  ")

        assert unfiltered.pop("path_contains") is None
        assert spaces.pop("path_contains") == "  "
        assert spaces == unfiltered
        assert "matching_row_count" not in spaces

    def test_a_long_filter_is_echoed_cut(self, traced):
        registry, handle = traced()
        needle = "x" * (failures.MAX_CALL_SITE_TEXT_CHARS + 1)

        result = linking.source_lines_by_call_site(
            registry, handle, path_contains=needle
        )

        assert result["path_contains"] == needle[: failures.MAX_CALL_SITE_TEXT_CHARS]
        assert result["path_contains_full_length"] == len(needle)

    def test_it_filters_a_signpost_range_by_the_window(self, traced):
        registry, handle = traced()

        result = linking.source_lines_by_call_site(
            registry, handle, start_signpost="signpost-start", path_contains="/a/"
        )

        [group] = result["groups"]
        # The window drops the matmul row, so a's 7.0 is 4.0, of the window's 14.5.
        assert group["device_time"] == 4.0
        assert result["device_time_total"] == 14.5
        assert result["matching_device_time_share_percent"] == tools.share_percent(
            4.0, 14.5
        )

    def test_it_matches_the_whole_path_not_the_cut_one(self, traced):
        deep = "/" + "d" * failures.MAX_CALL_SITE_TEXT_CHARS + "/tail/block.py"
        registry, handle = traced(traces={**_TRACES, 3: _trace(deep, 10, "mlp")})

        result = linking.source_lines_by_call_site(
            registry, handle, path_contains="/tail/"
        )

        [group] = result["groups"]
        assert group["call_site"]["file_full_length"] == len(deep)
