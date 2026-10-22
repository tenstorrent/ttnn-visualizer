# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""`op_breakdown`: the performance view's stacked table, with the op-to-op gap added.

Its grouping is tt-perf-report's stacked report's, which is what the app's stacked table
shows, so `TestStackedReportParity` holds the two together through the real generator.
"""

import contextlib
import io
import math
from unittest.mock import patch

import pytest
from ttnn_visualizer.agent import tools
from ttnn_visualizer.agent.handles import ReportRegistry, load_report
from ttnn_visualizer.csv_queries import OpsPerformanceReportQueries
from ttnn_visualizer.tests.smoke_capture import signpost, smoke_rows, write_ops_perf
from ttnn_visualizer.tests.test_agent_tools import _perf_report, _row, _signposts_in
from ttnn_visualizer.tests.test_device_log_columns import (
    MODERN_HEADER,
    write_device_log,
)


def _host_op(name, **overrides):
    return _row(
        op_code=name,
        op_type="python_fallback",
        op_category="Host",
        device_time="",
        op_to_op_gap="",
        total_percent="",
        **overrides,
    )


def _signpost_row(name):
    return _row(
        op_code=f"{name} (signpost)",
        op_type="signpost",
        op_category="",
        device_time="",
        op_to_op_gap="",
        total_percent="",
    )


def _breakdown(tmp_path, rows, **arguments):
    registry = ReportRegistry()
    write_device_log(tmp_path, MODERN_HEADER, [])
    load_report(registry, performance_path=str(tmp_path))
    with patch.object(
        tools, "_generate_canonical_report", return_value=_perf_report(rows)
    ):
        return tools.op_breakdown(registry, "report-1", **arguments)


def _by_key(result):
    return {group[result["grouped_by"]]: group for group in result["groups"]}


class TestOpBreakdown:
    @pytest.fixture(autouse=True)
    def signposted(self):
        with _signposts_in("report-1"):
            yield

    def test_an_op_is_its_op_codes_first_word(self, tmp_path):
        """tt-perf-report adds a matmul's shape to `op_code` and names a host op
        `(torch) <op>`, and the stacked table keeps only the first word of either."""
        rows = [
            _row(op_code="MatmulDeviceOperation 32 x 64 x 128", device_time="10"),
            _row(op_code="MatmulDeviceOperation 32 x 64 x 128", device_time="20"),
            _row(op_code="MatmulDeviceOperation 1 x 2 x 3", device_time="5"),
            _host_op("(torch) cat"),
            _host_op("(torch) reshape"),
        ]

        result = _breakdown(tmp_path, rows)
        groups = _by_key(result)

        assert result["grouped_by"] == "op"
        assert set(groups) == {"MatmulDeviceOperation", "(torch)"}
        assert groups["MatmulDeviceOperation"]["count"] == 3
        assert groups["MatmulDeviceOperation"]["device_time"] == 35.0
        assert groups["(torch)"]["count"] == 2
        assert groups["(torch)"]["device_time"] == 0.0

    def test_signposts_are_left_out(self, tmp_path):
        rows = [_signpost_row("PERF_START"), _row(), _signpost_row("PERF_END")]

        result = _breakdown(tmp_path, rows)

        assert result["row_count"] == 1
        assert [group["op"] for group in result["groups"]] == ["Matmul"]

    def test_a_category_groups_by_op_category(self, tmp_path):
        rows = [
            _row(op_code="Matmul", op_category="Compute", device_time="30"),
            _row(op_code="Conv2d", op_category="Compute", device_time="10"),
            _row(op_code="AllGather", op_category="CCL", device_time="60"),
            _host_op("(torch) cat"),
        ]

        result = _breakdown(tmp_path, rows, group_by="op_category")

        assert result["grouped_by"] == "op_category"
        assert [
            (group["op_category"], group["count"], group["device_time"])
            for group in result["groups"]
        ] == [("CCL", 1, 60.0), ("Compute", 2, 40.0), ("Host", 1, 0.0)]

    def test_a_groups_gap_and_total_percent_are_summed_over_its_rows(self, tmp_path):
        rows = [
            _row(op_code="A", op_to_op_gap="3", total_percent="10"),
            _row(op_code="A", op_to_op_gap="4", total_percent="20"),
        ]

        group = _breakdown(tmp_path, rows)["groups"][0]

        assert (group["count"], group["op_to_op_gap"], group["total_percent"]) == (
            2,
            7.0,
            30.0,
        )

    def test_each_share_is_of_its_own_total(self, tmp_path):
        """Device time against device time, gap against gap: one op can hold most of
        the device time and little of the dispatch gap."""
        rows = [
            _row(op_code="A", device_time="75", op_to_op_gap="10", total_percent="40"),
            _row(op_code="B", device_time="25", op_to_op_gap="30", total_percent="60"),
        ]

        result = _breakdown(tmp_path, rows)
        groups = _by_key(result)

        assert result["device_time_total"] == 100.0
        assert result["op_to_op_gap_total"] == 40.0
        assert groups["A"]["device_time_share_percent"] == 75.0
        assert groups["A"]["op_to_op_gap_share_percent"] == 25.0
        assert groups["B"]["op_to_op_gap_share_percent"] == 75.0
        assert groups["B"]["total_percent"] == 60.0

    def test_a_share_keeps_three_significant_figures(self, tmp_path):
        """As `operation_detail`'s shares do, so a sliver reads as one, not as 0."""
        rows = [
            _row(op_code="Big", device_time="123456"),
            _row(op_code="Sliver", device_time="1"),
        ]

        groups = _by_key(_breakdown(tmp_path, rows))

        assert groups["Big"]["device_time_share_percent"] == 100.0
        assert groups["Sliver"]["device_time_share_percent"] == 0.00081

    def test_device_time_counts_only_positive_figures(self, tmp_path):
        """`countable_device_time`, as `operation_detail` counts a share."""
        rows = [
            _row(op_code="A", device_time="-5"),
            _row(op_code="A", device_time="10"),
        ]

        assert _breakdown(tmp_path, rows)["groups"][0]["device_time"] == 10.0

    def test_groups_past_the_limit_are_summed_so_the_shares_still_add_up(
        self, tmp_path
    ):
        rows = [
            _row(op_code="A", device_time="50", op_to_op_gap="1", total_percent="5"),
            _row(op_code="B", device_time="30", op_to_op_gap="2", total_percent="6"),
            _row(op_code="C", device_time="15", op_to_op_gap="3", total_percent="7"),
            _row(op_code="D", device_time="5", op_to_op_gap="4", total_percent="8"),
        ]

        result = _breakdown(tmp_path, rows, limit=2)

        assert (result["group_count"], result["returned"]) == (4, 2)
        assert [group["op"] for group in result["groups"]] == ["A", "B"]
        rest = result["rest"]
        assert (rest["group_count"], rest["count"], rest["device_time"]) == (2, 2, 20.0)
        assert (rest["op_to_op_gap"], rest["total_percent"]) == (7.0, 15.0)
        assert rest["op_to_op_gap_share_percent"] == 70.0
        shares = [group["device_time_share_percent"] for group in result["groups"]]
        assert sum(shares) + rest["device_time_share_percent"] == 100.0

    def test_every_group_returned_leaves_no_rest(self, tmp_path):
        assert "rest" not in _breakdown(tmp_path, [_row()])

    def test_the_order_follows_the_metric_asked_for(self, tmp_path):
        rows = [
            _row(op_code="Busy", device_time="90", op_to_op_gap="1"),
            _row(op_code="Waiting", device_time="10", op_to_op_gap="99"),
        ]

        by_time = _breakdown(tmp_path, rows)
        by_gap = _breakdown(tmp_path, rows, by="op_to_op_gap")

        assert [group["op"] for group in by_time["groups"]] == ["Busy", "Waiting"]
        assert [group["op"] for group in by_gap["groups"]] == ["Waiting", "Busy"]
        assert by_gap["metric"] == "op_to_op_gap"

    def test_ties_order_by_name_and_a_row_without_a_name_comes_last(self, tmp_path):
        rows = [
            _row(op_code="", device_time="10"),
            _row(op_code="Beta", device_time="10"),
            _row(op_code="Alpha", device_time="10"),
        ]

        result = _breakdown(tmp_path, rows)

        assert [group["op"] for group in result["groups"]] == ["Alpha", "Beta", None]

    def test_no_device_time_gives_no_share_rather_than_a_division_error(self, tmp_path):
        result = _breakdown(tmp_path, [_host_op("(torch) cat")])

        assert result["groups"][0]["device_time_share_percent"] is None
        assert result["groups"][0]["op_to_op_gap_share_percent"] is None

    def test_a_non_finite_cell_counts_as_no_time(self, tmp_path):
        rows = [
            _row(op_code="A", device_time="nan", op_to_op_gap="inf"),
            _row(op_code="A", device_time="10", op_to_op_gap="2"),
        ]

        group = _breakdown(tmp_path, rows)["groups"][0]

        assert (group["count"], group["device_time"], group["op_to_op_gap"]) == (
            2,
            10.0,
            2.0,
        )

    def test_a_range_reaches_the_generator_and_is_echoed(self, tmp_path):
        registry = ReportRegistry()
        write_device_log(tmp_path, MODERN_HEADER, [])
        load_report(registry, performance_path=str(tmp_path))
        with patch.object(
            tools, "_generate_canonical_report", return_value=_perf_report([_row()])
        ) as generate:
            result = tools.op_breakdown(
                registry, "report-1", start_signpost="A", end_signpost="B"
            )

        assert generate.call_args.kwargs == {"start_signpost": "A", "end_signpost": "B"}
        assert result["projection"]["start_signpost"] == "A"
        assert result["projection"]["signpost_range_ignored"] is False

    @pytest.mark.parametrize(
        "arguments, message",
        [
            ({"group_by": "op_code"}, "unknown grouping 'op_code'"),
            ({"by": "flops"}, "unknown metric 'flops'"),
        ],
    )
    def test_an_unknown_grouping_or_rate_is_refused_before_generating(
        self, tmp_path, arguments, message
    ):
        """A sum of FLOPS or core counts per group is not a quantity, as in diff_reports."""
        registry = ReportRegistry()
        write_device_log(tmp_path, MODERN_HEADER, [])
        load_report(registry, performance_path=str(tmp_path))
        with patch.object(tools, "_generate_canonical_report") as generate:
            with pytest.raises(ValueError, match=message):
                tools.op_breakdown(registry, "report-1", **arguments)

        generate.assert_not_called()

    def test_a_partitioned_run_is_caveated(self, tmp_path):
        rows = [_row(sub_device_id="0"), _row(op_code="AllGather", sub_device_id="1")]

        result = _breakdown(tmp_path, rows)

        assert "2 sub-devices" in result["caveat"]

    def test_the_note_says_how_rows_are_grouped(self, tmp_path):
        note = _breakdown(tmp_path, [_row()])["note"]

        assert "first word" in note
        assert "(torch)" in note
        assert "Signposts are left out" in note


def test_a_range_over_a_report_without_signposts_says_it_read_the_whole(tmp_path):
    """tt-perf-report reads the whole file for it, and the projection must say so."""
    with _signposts_in():
        result = _breakdown(tmp_path, [_row()], start_signpost="A", end_signpost="B")

    assert result["projection"]["signpost_range_ignored"] is True


class TestStackedReportParity:
    """The same rows through tt-perf-report's stacked report, which the app's stacked
    table shows, and through `op_breakdown`. Host ops and a signpost are added to the
    smoke capture, since it has neither and both are grouped by rule."""

    def _capture(self, tmp_path):
        rows = smoke_rows()
        template = rows[0]
        host_ops = [
            {**template, "OP TYPE": "python_fallback", "OP CODE": name}
            for name in ("(torch) cat", "(torch) reshape", "(torch) cat")
        ]
        rows = rows[:3] + host_ops + [signpost("PERF_MARK", rows[3])] + rows[3:]
        directory = tmp_path / "capture"
        write_ops_perf(directory, rows)
        return directory

    @pytest.mark.parametrize(
        "stacked_group_by, group_by", [(None, "op"), ("category", "op_category")]
    )
    def test_the_groups_match_the_stacked_report(
        self, tmp_path, stacked_group_by, group_by
    ):
        directory = self._capture(tmp_path)
        registry = ReportRegistry()
        handle = load_report(registry, performance_path=str(directory))["handle"]

        with contextlib.redirect_stdout(io.StringIO()):
            stacked = OpsPerformanceReportQueries.generate_report(
                registry.get(handle),
                **tools.CANONICAL_PROJECTION,
                no_stacked_report=False,
                group_by=stacked_group_by,
            )["stacked_report"]
        result = tools.op_breakdown(registry, handle, group_by=group_by, limit=100)

        theirs = {row["op_code"]: row for row in stacked}
        ours = {group[group_by]: group for group in result["groups"]}
        assert stacked
        assert set(ours) == set(theirs)
        for key, group in ours.items():
            assert group["count"] == int(float(theirs[key]["Ops_count"]))
            # The stacked CSV writes device time and shares to two decimals, and a
            # share here keeps three significant figures.
            assert group["device_time"] == pytest.approx(
                float(theirs[key]["Device_Time_Sum_us"]), abs=1e-2
            )
            share = group["device_time_share_percent"] or 0.0
            figure = 10 ** (math.floor(math.log10(share)) - 2) if share else 0.0
            assert share == pytest.approx(float(theirs[key]["%"]), abs=5e-3 + figure)
        if group_by == "op":
            assert ours["(torch)"]["count"] == 3
