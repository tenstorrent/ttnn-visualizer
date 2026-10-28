# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""`diff_reports` against run-to-run noise (#2155): thresholds, groups one report
lacks, repeated captures, captures on different hardware, and tensor signatures.

Two captures of the same code never time an operation identically, so a diff that calls
every move a change hands an agent noise ranked beside the regression it was asked
about. The base behaviour — grouping, ranges, the partitioned caveat — is pinned in
`test_agent_tools.py`.
"""

import json
from unittest.mock import patch

import pytest
from ttnn_visualizer.agent import op_signatures, report_diff, server, tools
from ttnn_visualizer.agent.bounds import MAX_DETAILED_LIMIT, MAX_LIMIT
from ttnn_visualizer.agent.handles import ReportRegistry, load_report
from ttnn_visualizer.csv_queries import (
    DegradedPerformanceReport,
    DeviceLogProfilerQueries,
    ResolvedSignposts,
)
from ttnn_visualizer.exceptions import DataFormatError
from ttnn_visualizer.tests.smoke_capture import (
    signposted_rows,
    smoke_rows,
    write_ops_perf,
)
from ttnn_visualizer.tests.test_agent_perf_detail import ANSWER_BUDGET_BYTES
from ttnn_visualizer.tests.test_agent_tools import _perf_report, _row, _signposts_in
from ttnn_visualizer.tests.test_device_log_columns import (
    MODERN_HEADER,
    PREAMBLE,
    write_device_log,
)


@pytest.fixture(autouse=True)
def one_device():
    """A capture with no CSV, as most here are, names one device as a real CSV does:
    otherwise no capture would record a device count."""
    read = tools._resolve_signposts

    def resolve(instance):
        try:
            return read(instance)
        except (DataFormatError, OSError):
            return ResolvedSignposts({}, True, 1)

    with patch.object(tools, "_resolve_signposts", side_effect=resolve):
        yield


def _registry(tmp_path, count=2, preambles=None):
    """`count` handles, `report-1` on, each on its own capture with a device log."""
    registry = ReportRegistry()
    for index in range(count):
        directory = tmp_path / f"capture-{index + 1}"
        directory.mkdir()
        log = write_device_log(directory, MODERN_HEADER, [])
        if preambles is not None:
            log.write_text(
                log.read_text(encoding="utf-8").replace(PREAMBLE, preambles[index]),
                encoding="utf-8",
            )
        load_report(registry, performance_path=str(directory))
    return registry


def _diff(registry, rows_by_handle, **arguments):
    """`diff_reports` of report-1 against report-2, each handle generating its rows."""
    with patch.object(
        tools,
        "_generate_canonical_report",
        side_effect=lambda instance, **_: _perf_report(
            rows_by_handle[instance.instance_id]
        ),
    ):
        return tools.diff_reports(registry, "report-1", "report-2", **arguments)


def _ops(**device_time_by_op_code):
    return [
        _row(id=str(position + 2), op_code=op_code, device_time=str(device_time))
        for position, (op_code, device_time) in enumerate(
            device_time_by_op_code.items()
        )
    ]


def _partly_measured(measured, time, calls=4):
    """`calls` calls of one Conv, the first `measured` of them timed at `time`."""
    return [
        _row(
            id=str(n + 2),
            op_code="Conv",
            device_time=str(time) if n < measured else "",
        )
        for n in range(calls)
    ]


def _side(*captures):
    """A side of a diff from each capture's {group: (total, calls, measured calls)}."""
    return report_diff.Side.of(
        [
            {
                group: report_diff.GroupTotal(*figures)
                for group, figures in groups.items()
            }
            for groups in captures
        ]
    )


class TestClassify:
    """`report_diff.classify` alone: where each group goes, with no report behind it."""

    THRESHOLDS = report_diff.Thresholds(min_percent=5.0, min_delta=1.0)

    def test_each_group_lands_in_exactly_one_list(self):
        before = _side(
            {
                "Moved": (10.0, 1, 1),
                "Still": (10.0, 1, 1),
                "Gone": (3.0, 1, 1),
                "Blank": (0.0, 2, 0),
                "Host": (0.0, 1, 0),
            }
        )
        after = _side(
            {
                "Moved": (20.0, 1, 1),
                "Still": (10.2, 1, 1),
                "Added": (4.0, 1, 1),
                "Blank": (8.0, 2, 2),
                "Host": (0.0, 1, 0),
            }
        )

        comparison = report_diff.classify(before, after, self.THRESHOLDS)

        (change,) = comparison.changes
        assert (change.group, change.delta) == ("Moved", 10.0)
        assert comparison.within_threshold_count == 1
        assert comparison.new == ["Added"]
        assert comparison.missing == ["Gone"]
        # Never given a figure, a host op says nothing about this metric.
        assert comparison.unmeasured == ["Blank"]
        assert comparison.inconsistent == []

    def test_captures_disagreeing_on_a_group_make_it_inconsistent(self):
        before = _side({"Routed": (10.0, 2, 2)}, {"Routed": (5.0, 1, 1)})
        after = _side({"Routed": (10.0, 2, 2)}, {"Routed": (10.0, 2, 2)})

        comparison = report_diff.classify(before, after, self.THRESHOLDS)

        assert comparison.inconsistent == ["Routed"]
        assert comparison.changes == [] and comparison.within_threshold_count == 0

    def test_every_list_breaks_a_tie_by_group(self):
        """One order for every list, so an answer cut at its limit is the same each
        time it is asked."""
        both = {
            "Slower B": (10.0, 1, 1),
            "Slower A": (10.0, 1, 1),
            "Gone B": (2.0, 1, 1),
            "Gone A": (2.0, 1, 1),
        }
        before = _side({**both, "Odd B": (3.0, 1, 1), "Odd A": (3.0, 1, 1)}, both)
        later = {
            "Slower B": (20.0, 1, 1),
            "Slower A": (20.0, 1, 1),
            "Added B": (2.0, 1, 1),
            "Added A": (2.0, 1, 1),
        }
        after = _side(later, later)

        comparison = report_diff.classify(before, after, self.THRESHOLDS)

        assert [change.group for change in comparison.changes] == [
            "Slower A",
            "Slower B",
        ]
        assert comparison.new == ["Added A", "Added B"]
        assert comparison.missing == ["Gone A", "Gone B"]
        assert comparison.inconsistent == ["Odd A", "Odd B"]


class TestThresholds:
    @pytest.mark.parametrize(
        "before, after, counted",
        [
            pytest.param(100.0, 104.0, False, id="4% of a long op"),
            pytest.param(100.0, 105.0, True, id="5% of a long op"),
            pytest.param(1.0, 1.5, False, id="50% but half a microsecond"),
            pytest.param(20.0, 21.0, True, id="exactly 5% and 1 us"),
            pytest.param(22.6, 23.73, True, id="exactly 5%, which floats put under"),
            pytest.param(22.6, 23.729, False, id="a nanosecond under 5%"),
            pytest.param(100.0, 90.0, True, id="faster counts as much as slower"),
        ],
    )
    def test_a_move_is_a_change_only_past_both_thresholds(
        self, tmp_path, before, after, counted
    ):
        result = _diff(
            _registry(tmp_path),
            {"report-1": _ops(Matmul=before), "report-2": _ops(Matmul=after)},
        )

        assert [change["op_code"] for change in result["changes"]] == (
            ["Matmul"] if counted else []
        )
        assert result["within_threshold_count"] == (0 if counted else 1)

    def test_exactly_min_percent_counts_however_its_calls_sum(self, tmp_path):
        """Summed call by call, 200 calls of 2.3 us come to 460.00000000000153 us."""

        def calls(time):
            return [
                _row(id=str(n + 2), op_code="Matmul", device_time=str(time))
                for n in range(200)
            ]

        result = _diff(
            _registry(tmp_path), {"report-1": calls(2.3), "report-2": calls(2.415)}
        )

        (change,) = result["changes"]
        assert (change["delta"], change["delta_percent"]) == (23.0, 5.0)

    def test_the_answer_says_which_thresholds_it_applied(self, tmp_path):
        result = _diff(
            _registry(tmp_path),
            {"report-1": _ops(Matmul=100.0), "report-2": _ops(Matmul=120.0)},
        )

        assert result["thresholds"] == {
            "min_percent": 5.0,
            "min_delta": 1.0,
            "min_delta_unit": "us",
        }
        assert result["changes"] == [
            {
                "op_code": "Matmul",
                "device_time_before": 100.0,
                "device_time_after": 120.0,
                "delta": 20.0,
                "delta_percent": 20.0,
                "count_before": 1,
                "count_after": 1,
            }
        ]
        assert (result["change_count"], result["returned"]) == (1, 1)
        assert "never as a change" in result["note"]

    def test_returned_counts_the_changes_a_limit_lets_through(self, tmp_path):
        result = _diff(
            _registry(tmp_path),
            {
                "report-1": _ops(A=10.0, B=10.0, C=10.0),
                "report-2": _ops(A=20.0, B=30.0, C=40.0),
            },
            limit=2,
        )

        assert (result["returned"], result["change_count"]) == (2, 3)

    def test_lower_thresholds_show_smaller_moves(self, tmp_path):
        result = _diff(
            _registry(tmp_path),
            {"report-1": _ops(Matmul=100.0), "report-2": _ops(Matmul=104.0)},
            min_percent=1,
            min_delta=0,
        )

        assert result["thresholds"]["min_percent"] == 1.0
        assert [change["delta_percent"] for change in result["changes"]] == [4.0]

    def test_zero_thresholds_list_every_move_but_no_float_noise(self, tmp_path):
        """A nanosecond is the smallest move an answer shows; summed in another order,
        equal figures differ by about 1e-16, which must not count."""

        def rows(order):
            return [
                _row(id=str(position + 2), op_code=op_code, device_time=str(time))
                for position, (op_code, time) in enumerate(order)
            ]

        before = [("Matmul", 100.0), ("Add", 0.1), ("Add", 0.2), ("Add", 0.3)]
        after = [("Matmul", 100.001), ("Add", 0.3), ("Add", 0.2), ("Add", 0.1)]

        result = _diff(
            _registry(tmp_path),
            {"report-1": rows(before), "report-2": rows(after)},
            min_percent=0,
            min_delta=0,
        )

        assert sum(time for _, time in before[1:]) != sum(time for _, time in after[1:])
        assert [change["op_code"] for change in result["changes"]] == ["Matmul"]
        assert result["within_threshold_count"] == 1

    def test_a_move_from_zero_has_no_percentage_to_miss(self, tmp_path):
        before = [_row(op_code="Matmul", op_to_op_gap="0")]
        after = [_row(op_code="Matmul", op_to_op_gap="5.0")]

        result = _diff(
            _registry(tmp_path),
            {"report-1": before, "report-2": after},
            by="op_to_op_gap",
        )

        (change,) = result["changes"]
        assert change["delta"] == 5.0
        assert change["delta_percent"] is None

    def test_total_percent_is_floored_in_percentage_points(self, tmp_path):
        before = [_row(op_code="Matmul", total_percent="2.0")]
        after = [_row(op_code="Matmul", total_percent="2.15")]

        result = _diff(
            _registry(tmp_path),
            {"report-1": before, "report-2": after},
            by="total_percent",
        )

        assert result["thresholds"]["min_delta"] == 0.1
        assert result["thresholds"]["min_delta_unit"] == "percentage_points"
        assert [change["op_code"] for change in result["changes"]] == ["Matmul"]

    @pytest.mark.parametrize(
        "argument, value",
        [
            ("min_percent", -1),
            ("min_delta", "lots"),
            ("min_percent", True),
            ("min_delta", float("nan")),
        ],
    )
    def test_a_threshold_must_be_a_number_of_at_least_zero(
        self, tmp_path, argument, value
    ):
        with pytest.raises(ValueError, match=f"{argument} must be a number"):
            tools.diff_reports(
                _registry(tmp_path), "report-1", "report-2", **{argument: value}
            )

    @pytest.mark.parametrize(
        "argument, value",
        [("min_delta", "9" * 5000), ("repeats_a", "report-3," * 1000)],
    )
    def test_a_refusal_echoes_a_long_argument_cut_short(
        self, tmp_path, argument, value
    ):
        with pytest.raises(ValueError) as refused:
            tools.diff_reports(
                _registry(tmp_path), "report-1", "report-2", **{argument: value}
            )

        message = str(refused.value)
        assert message.startswith(argument)
        assert f"({len(repr(value))} characters)" in message
        assert len(message) < 200

    def test_every_summable_metric_has_a_floor_and_a_unit(self):
        """A metric added to `ADDITIVE_METRICS` alone would fail every call by it."""
        assert set(report_diff.DIFF_METRICS) == tools.ADDITIVE_METRICS

    def test_an_unknown_match_is_refused_with_the_choices(self, tmp_path):
        with pytest.raises(ValueError, match="op_code, signature"):
            tools.diff_reports(
                _registry(tmp_path), "report-1", "report-2", match="shape"
            )

    def test_a_threshold_given_as_a_numeric_string_is_read_as_its_number(
        self, tmp_path
    ):
        """As `limit` is: a client that serialises numbers as text still means them."""
        registry = _registry(tmp_path)

        result = _diff(
            registry,
            {"report-1": _ops(Matmul=10.0), "report-2": _ops(Matmul=10.4)},
            min_percent="5",
            min_delta="0.1",
        )

        assert result["thresholds"]["min_percent"] == 5.0
        assert result["thresholds"]["min_delta"] == 0.1
        assert result["within_threshold_count"] == 1


class TestGroupsOneReportLacks:
    def test_they_are_listed_apart_and_never_as_a_change(self, tmp_path):
        result = _diff(
            _registry(tmp_path),
            {
                "report-1": _ops(Matmul=10.0, Retired=3.0),
                "report-2": _ops(Matmul=10.0, Small=5.0, Large=7.0),
            },
        )

        assert result["changes"] == []
        assert result["new"] == [
            {"op_code": "Large", "device_time_after": 7.0, "count_after": 1},
            {"op_code": "Small", "device_time_after": 5.0, "count_after": 1},
        ]
        assert result["missing"] == [
            {"op_code": "Retired", "device_time_before": 3.0, "count_before": 1}
        ]
        assert (result["new_count"], result["missing_count"]) == (2, 1)

    def test_a_limit_shortens_each_list_but_not_its_count(self, tmp_path):
        result = _diff(
            _registry(tmp_path),
            {"report-1": _ops(Matmul=10.0), "report-2": _ops(A=1.0, B=2.0, C=3.0)},
            limit=1,
        )

        assert [entry["op_code"] for entry in result["new"]] == ["C"]
        assert result["new_count"] == 3

    def test_the_totals_cover_every_group(self, tmp_path):
        result = _diff(
            _registry(tmp_path),
            {
                "report-1": _ops(Matmul=10.0, Retired=10.0),
                "report-2": _ops(Matmul=10.0, Added=15.0),
            },
        )

        assert result["device_time_total_before"] == 20.0
        assert result["device_time_total_after"] == 25.0
        assert result["delta_total"] == 5.0
        assert result["delta_total_percent"] == 25.0

    def test_equal_totals_move_by_zero_rather_than_float_noise(self, tmp_path):
        """Summed in another order these twelve figures differ by about 1e-14, which
        read as a delta of -0.0 and a percentage of -1.23e-14."""
        times = [2.687, 16.949, 15.275, 5.101, 9.909, 8.99]
        times += [13.032, 15.774, 1.877, 0.567, 16.715, 8.655]
        reordered = [16.715, 1.877, 13.032, 0.567, 8.99, 8.655]
        reordered += [15.275, 16.949, 5.101, 9.909, 15.774, 2.687]

        def rows(order):
            return [
                _row(
                    id=str(position + 2),
                    op_code=f"Op{times.index(time)}",
                    device_time=str(time),
                )
                for position, time in enumerate(order)
            ]

        result = _diff(
            _registry(tmp_path), {"report-1": rows(reordered), "report-2": rows(times)}
        )

        assert sum(times) != sum(reordered)
        assert repr(result["delta_total"]) == "0.0"
        assert repr(result["delta_total_percent"]) == "0.0"


class TestUnmeasuredGroups:
    def test_an_op_with_no_figure_on_one_side_is_unmeasured_not_new(self, tmp_path):
        """tt-perf-report blanks an invalid duration, as four UpSample calls in a local
        SEG encoder capture are; they still ran, so they are neither new nor missing."""
        before = [
            _row(id=str(n + 2), op_code="UpSample", device_time="") for n in range(4)
        ]
        after = [
            _row(id=str(n + 2), op_code="UpSample", device_time="27.0")
            for n in range(4)
        ]

        result = _diff(_registry(tmp_path), {"report-1": before, "report-2": after})

        assert (result["new"], result["missing"], result["changes"]) == ([], [], [])
        assert result["unmeasured"] == [
            {
                "op_code": "UpSample",
                "count_before": 4,
                "count_after": 4,
                "measured_before": 0,
                "measured_after": 4,
            }
        ]
        assert "1 groups ran in both reports with no device_time" in result["caveat"]

    def test_an_op_with_no_figure_on_either_side_is_left_out(self, tmp_path):
        """A host op never has a device time, so it has nothing to say about one."""
        host = [_row(id="2", op_code="(torch) contiguous", device_time="")]
        rows = {
            "report-1": host + _ops(Matmul=10.0),
            "report-2": host + _ops(Matmul=10.0),
        }

        result = _diff(_registry(tmp_path), rows)

        assert result["unmeasured"] == [] and "caveat" not in result
        assert result["within_threshold_count"] == 1

    def test_a_change_over_fewer_measured_calls_says_so(self, tmp_path):
        before = [
            _row(id=str(n + 2), op_code="Conv", device_time="10.0") for n in range(4)
        ]
        after = [
            _row(id=str(n + 2), op_code="Conv", device_time="" if n < 2 else "10.0")
            for n in range(4)
        ]

        result = _diff(_registry(tmp_path), {"report-1": before, "report-2": after})

        (change,) = result["changes"]
        assert (change["count_before"], change["count_after"]) == (4, 4)
        assert (change["measured_before"], change["measured_after"]) == (4, 2)

    def test_a_new_or_missing_group_over_fewer_measured_calls_says_so(self, tmp_path):
        """Two of four calls timed at 10 µs would otherwise read as four totalling 20."""
        pool = [{**row, "op_code": "Pool"} for row in _partly_measured(2, 10.0)]

        result = _diff(
            _registry(tmp_path),
            {"report-1": _partly_measured(2, 10.0), "report-2": pool},
        )

        assert result["missing"] == [
            {
                "op_code": "Conv",
                "device_time_before": 20.0,
                "count_before": 4,
                "measured_before": 2,
            }
        ]
        assert result["new"] == [
            {
                "op_code": "Pool",
                "device_time_after": 20.0,
                "count_after": 4,
                "measured_after": 2,
            }
        ]

    def test_a_fully_measured_change_carries_no_measured_counts(self, tmp_path):
        result = _diff(
            _registry(tmp_path),
            {"report-1": _ops(Matmul=10.0), "report-2": _ops(Matmul=20.0)},
        )

        assert "measured_before" not in result["changes"][0]


class TestRepeats:
    def test_each_side_is_the_median_of_its_captures(self, tmp_path):
        """One slow outlier among three captures moves a mean, not a median."""
        registry = _registry(tmp_path, count=6)
        rows = {
            "report-1": _ops(Matmul=10.0),
            "report-3": _ops(Matmul=11.0),
            "report-4": _ops(Matmul=30.0),
            "report-2": _ops(Matmul=12.0),
            "report-5": _ops(Matmul=12.5),
            "report-6": _ops(Matmul=11.9),
        }

        result = _diff(
            registry,
            rows,
            repeats_a=["report-3", "report-4"],
            repeats_b=["report-5", "report-6"],
        )

        (change,) = result["changes"]
        assert (change["device_time_before"], change["device_time_after"]) == (
            11.0,
            12.0,
        )
        assert result["repeats_before"] == ["report-3", "report-4"]
        assert result["repeats_after"] == ["report-5", "report-6"]
        assert result["delta_total"] == 1.0

    def test_a_group_only_some_captures_hold_is_inconsistent(self, tmp_path):
        registry = _registry(tmp_path, count=4)
        rows = {
            "report-1": _ops(Matmul=10.0, Flaky=1.0),
            "report-3": _ops(Matmul=10.0),
            "report-2": _ops(Matmul=10.0, Flaky=1.0),
            "report-4": _ops(Matmul=10.0, Flaky=1.0),
        }

        result = _diff(registry, rows, repeats_a=["report-3"], repeats_b=["report-4"])

        assert result["inconsistent"] == [
            {"op_code": "Flaky", "calls_before": [1, 0], "calls_after": [1, 1]}
        ]
        assert result["new"] == [] and result["missing"] == []
        assert result["within_threshold_count"] == 1

    def test_inconsistent_groups_come_largest_first(self, tmp_path):
        """Ranked as the other lists are, so a cap keeps the groups that matter."""
        registry = _registry(tmp_path, count=4)
        rows = {
            "report-1": _ops(Matmul=10.0, Aside=1.0, Bulky=40.0),
            "report-3": _ops(Matmul=10.0),
            "report-2": _ops(Matmul=10.0),
            "report-4": _ops(Matmul=10.0),
        }

        result = _diff(
            registry, rows, repeats_a=["report-3"], repeats_b=["report-4"], limit=1
        )

        assert [entry["op_code"] for entry in result["inconsistent"]] == ["Bulky"]
        assert result["inconsistent_count"] == 2

    def test_a_ranged_diff_with_repeats_reads_each_window_once(self, tmp_path):
        """More windows than the snapshot cache keeps, asked again with another metric,
        another threshold and the other match: no window is generated twice."""
        registry = _registry(tmp_path, count=6)
        generated = []

        def generate(instance, **_):
            generated.append(instance.instance_id)
            return _perf_report(_ops(Matmul=10.0))

        arguments = {
            "start_signpost": "PERF_DECODE",
            "end_signpost": "PERF_DECODE_END",
            "repeats_a": ["report-3", "report-4"],
            "repeats_b": ["report-5", "report-6"],
        }
        signatures = op_signatures.Signatures(["in0 1x1x32x32"], False)
        with (
            _signposts_in(*(f"report-{number}" for number in range(1, 7))),
            patch.object(tools, "_generate_canonical_report", side_effect=generate),
            patch.object(tools, "_op_signatures", return_value=signatures),
        ):
            tools.diff_reports(registry, "report-1", "report-2", **arguments)
            tools.diff_reports(
                registry, "report-1", "report-2", by="op_to_op_gap", **arguments
            )
            tools.diff_reports(
                registry, "report-1", "report-2", min_percent=1, **arguments
            )
            tools.diff_reports(
                registry, "report-1", "report-2", match="signature", **arguments
            )

        assert sorted(generated) == [f"report-{number}" for number in range(1, 7)]

    def test_a_repeat_s_report_is_read_for_its_totals_and_not_kept(self, tmp_path):
        """The compared captures keep theirs, as any tool's read does, for the questions
        that follow a diff; a repeat's would hold a whole report its totals already
        summarise."""
        registry = _registry(tmp_path, count=4)
        generated = []

        def generate(instance, **_):
            generated.append(instance.instance_id)
            return _perf_report(_ops(Matmul=10.0))

        with patch.object(tools, "_generate_canonical_report", side_effect=generate):
            tools.diff_reports(
                registry,
                "report-1",
                "report-2",
                repeats_a=["report-3"],
                repeats_b=["report-4"],
            )
            generated.clear()
            for number in range(1, 5):
                tools.canonical_report(registry, f"report-{number}")

        assert generated == ["report-3", "report-4"]

    def test_captures_that_ran_a_group_unequally_often_are_inconsistent(self, tmp_path):
        """A median of totals over different call counts compares different work."""
        registry = _registry(tmp_path, count=4)
        twice = [
            _row(id=str(n + 2), op_code="Routed", device_time="5.0") for n in range(2)
        ]
        once = [_row(id="2", op_code="Routed", device_time="5.0")]
        rows = {
            "report-1": twice,
            "report-3": once,
            "report-2": twice,
            "report-4": twice,
        }

        result = _diff(registry, rows, repeats_a=["report-3"], repeats_b=["report-4"])

        assert result["inconsistent"] == [
            {"op_code": "Routed", "calls_before": [2, 1], "calls_after": [2, 2]}
        ]
        assert result["changes"] == [] and result["within_threshold_count"] == 0

    def test_a_repeat_with_no_figure_makes_its_group_unmeasured(self, tmp_path):
        """Not a median over the captures that measured it, which would read the blank
        repeat as agreeing."""
        registry = _registry(tmp_path, count=4)

        def calls(time):
            return [
                _row(id=str(n + 2), op_code="Conv", device_time=time) for n in range(2)
            ]

        rows = {
            "report-1": calls("10.0"),
            "report-3": calls(""),
            "report-2": calls("10.0"),
            "report-4": calls("10.0"),
        }

        result = _diff(registry, rows, repeats_a=["report-3"], repeats_b=["report-4"])

        assert result["changes"] == []
        assert result["unmeasured"] == [
            {
                "op_code": "Conv",
                "count_before": 2,
                "count_after": 2,
                "measured_before": 0,
                "measured_after": 2,
            }
        ]

    def test_a_change_over_repeats_gives_the_median_measured_calls(self, tmp_path):
        """Calls measured 4, 2 and 4 times read as 4, the count behind the median
        total, not the fewest."""
        registry = _registry(tmp_path, count=4)
        rows = {
            "report-1": _partly_measured(4, 10.0),
            "report-3": _partly_measured(2, 10.0),
            "report-4": _partly_measured(4, 10.0),
            "report-2": _partly_measured(3, 20.0),
        }

        result = _diff(registry, rows, repeats_a=["report-3", "report-4"])

        (change,) = result["changes"]
        assert (change["measured_before"], change["measured_after"]) == (4, 3)

    @pytest.mark.parametrize(
        "after, median",
        [
            pytest.param([(4, 10.0), (2, 40.0), (4, 40.0)], 80.0, id="the middle one"),
            pytest.param(
                [(4, 10.0), (2, 40.0)], 60.0, id="the two an even count averages"
            ),
        ],
    )
    def test_a_median_from_a_partly_measured_capture_says_so(
        self, tmp_path, after, median
    ):
        """Totals and measured calls sort differently here, so the median total is a
        partial sum: without its coverage it would read as a speed-up."""
        registry = _registry(tmp_path, count=1 + len(after))
        handles = ["report-2", *(f"report-{n}" for n in range(3, 2 + len(after)))]
        rows = {"report-1": _partly_measured(4, 40.0)}
        for handle, (measured, time) in zip(handles, after):
            rows[handle] = _partly_measured(measured, time)

        result = _diff(registry, rows, repeats_b=handles[1:])

        (change,) = result["changes"]
        assert change["device_time_after"] == median
        assert (change["measured_before"], change["measured_after"]) == (4, 2)

    def test_a_one_sided_group_ranks_by_its_median_not_an_outlier(self, tmp_path):
        """One slow repeat must not carry a small group past the cap ahead of a bigger
        one, so new and missing rank by the figure each entry gives."""
        registry = _registry(tmp_path, count=6)
        rows = {}
        for handle, outlier in (
            ("report-1", 1.0),
            ("report-3", 1.0),
            ("report-4", 1000.0),
        ):
            rows[handle] = _ops(Matmul=10.0, GoneOutlier=outlier, GoneSteady=10.0)
        for handle, outlier in (
            ("report-2", 1.0),
            ("report-5", 1.0),
            ("report-6", 1000.0),
        ):
            rows[handle] = _ops(Matmul=10.0, NewOutlier=outlier, NewSteady=10.0)

        result = _diff(
            registry,
            rows,
            repeats_a=["report-3", "report-4"],
            repeats_b=["report-5", "report-6"],
            limit=1,
        )

        assert [entry["op_code"] for entry in result["new"]] == ["NewSteady"]
        assert [entry["op_code"] for entry in result["missing"]] == ["GoneSteady"]

    def test_a_side_total_is_the_median_of_its_captures_totals(self, tmp_path):
        """Not the sum of each group's median, which is no capture's total."""
        registry = _registry(tmp_path, count=4)
        rows = {
            "report-1": _ops(A=10.0, B=1.0),
            "report-3": _ops(A=1.0, B=10.0),
            "report-4": _ops(A=5.0, B=5.0),
            "report-2": _ops(A=5.0, B=5.0),
        }

        result = _diff(registry, rows, repeats_a=["report-3", "report-4"])

        assert result["device_time_total_before"] == 11.0

    def test_four_repeats_a_side_are_taken(self, tmp_path):
        registry = _registry(tmp_path, count=6)
        rows = {f"report-{n}": _ops(Matmul=10.0) for n in range(1, 7)}

        result = _diff(
            registry, rows, repeats_a=["report-3", "report-4", "report-5", "report-6"]
        )

        assert result["repeats_before"] == [
            "report-3",
            "report-4",
            "report-5",
            "report-6",
        ]

    def test_a_repeat_lacking_a_named_signpost_is_refused_before_generating(
        self, tmp_path
    ):
        registry = _registry(tmp_path, count=3)

        def resolve(instance):
            names = (
                {"PERF_PREFILL": [0]}
                if instance.instance_id == "report-3"
                else {"PERF_DECODE": [0], "PERF_DECODE_END": [1]}
            )
            return ResolvedSignposts(names, True)

        with (
            patch.object(tools, "_resolve_signposts", side_effect=resolve),
            patch.object(tools, "_generate_canonical_report") as generate,
        ):
            with pytest.raises(ValueError, match="'report-3': no signpost named"):
                tools.diff_reports(
                    registry,
                    "report-1",
                    "report-2",
                    start_signpost="PERF_DECODE",
                    end_signpost="PERF_DECODE_END",
                    repeats_a=["report-3"],
                )

        generate.assert_not_called()

    def test_without_repeats_there_is_no_inconsistent_list(self, tmp_path):
        result = _diff(
            _registry(tmp_path),
            {"report-1": _ops(Matmul=10.0), "report-2": _ops(Matmul=10.0)},
        )

        assert "inconsistent" not in result
        assert "repeats_before" not in result

    @pytest.mark.parametrize(
        "repeats",
        [
            pytest.param("report-3", id="a bare handle"),
            pytest.param([3], id="not a handle"),
            pytest.param([f"report-{n}" for n in range(3, 8)], id="six captures"),
        ],
    )
    def test_repeats_must_be_a_short_list_of_handles(self, tmp_path, repeats):
        with pytest.raises(ValueError, match="repeats_a"):
            tools.diff_reports(
                _registry(tmp_path), "report-1", "report-2", repeats_a=repeats
            )

    def test_a_capture_given_twice_is_refused_before_generating(self, tmp_path):
        """Counted twice it would sway a median; on both sides it diffs to nothing."""
        registry = ReportRegistry()
        for name in ("a", "b"):
            write_ops_perf(tmp_path / name, smoke_rows())
        for name in ("a", "a", "b"):
            load_report(registry, performance_path=str(tmp_path / name))

        with patch.object(tools, "_generate_canonical_report") as generate:
            with pytest.raises(
                ValueError, match="'report-1' and 'report-2' are the same capture"
            ):
                tools.diff_reports(
                    registry, "report-1", "report-3", repeats_a=["report-2"]
                )
            with pytest.raises(ValueError, match="'report-3' is given twice"):
                tools.diff_reports(registry, "report-3", "report-3")

        generate.assert_not_called()

    def test_a_range_only_some_captures_can_honour_is_refused(self, tmp_path):
        registry = _registry(tmp_path, count=4)

        with (
            _signposts_in("report-1", "report-2", "report-3"),
            patch.object(tools, "_generate_canonical_report") as generate,
        ):
            with pytest.raises(ValueError, match="'report-4' holds no signposts"):
                tools.diff_reports(
                    registry,
                    "report-1",
                    "report-2",
                    start_signpost="PERF_DECODE",
                    repeats_a=["report-3"],
                    repeats_b=["report-4"],
                )

        generate.assert_not_called()


class TestRepeatsAtTheEdges:
    def test_a_new_group_a_repeat_left_blank_says_why_its_figure_is_null(
        self, tmp_path
    ):
        """No capture gave it a figure on that side, which its measured calls say."""
        registry = _registry(tmp_path, count=3)
        rows = {
            "report-1": _ops(Matmul=10.0),
            "report-2": _ops(Matmul=10.0, Pool=5.0),
            "report-3": [
                *_ops(Matmul=10.0),
                _row(id="3", op_code="Pool", device_time=""),
            ],
        }

        result = _diff(registry, rows, repeats_b=["report-3"])

        assert result["new"] == [
            {
                "op_code": "Pool",
                "device_time_after": None,
                "count_after": 1,
                "measured_after": 0,
            }
        ]

    def test_new_ranks_a_group_with_no_figure_by_its_largest_capture(self, tmp_path):
        """Pool's 5 µs capture outranks Add's 3 µs median, so a limit of 1 keeps it."""
        registry = _registry(tmp_path, count=3)
        rows = {
            "report-1": _ops(Matmul=10.0),
            "report-2": _ops(Matmul=10.0, Pool=5.0, Add=3.0),
            "report-3": [
                *_ops(Matmul=10.0),
                _row(id="3", op_code="Pool", device_time=""),
                _row(id="4", op_code="Add", device_time="3.0"),
            ],
        }

        result = _diff(registry, rows, repeats_b=["report-3"], limit=1)

        assert result["new_count"] == 2
        assert [entry["op_code"] for entry in result["new"]] == ["Pool"]

    def test_a_group_only_a_later_repeat_ran_is_inconsistent_not_new(self, tmp_path):
        """The side that never ran it gives one zero per capture."""
        registry = _registry(tmp_path, count=4)
        rows = {
            "report-1": _ops(Matmul=10.0),
            "report-2": _ops(Matmul=10.0),
            "report-3": _ops(Matmul=10.0),
            "report-4": _ops(Matmul=10.0, Late=2.0),
        }

        result = _diff(registry, rows, repeats_a=["report-3"], repeats_b=["report-4"])

        assert result["inconsistent"] == [
            {"op_code": "Late", "calls_before": [0, 0], "calls_after": [0, 1]}
        ]
        assert result["new"] == []

    def test_no_repeats_answers_as_a_plain_diff(self, tmp_path):
        registry = _registry(tmp_path)

        result = _diff(
            registry,
            {"report-1": _ops(Matmul=10.0), "report-2": _ops(Matmul=10.0)},
            repeats_a=[],
        )

        assert not {"repeats_before", "repeats_after", "inconsistent"} & set(result)


def _degraded_once(handle, window=None):
    """Matmul at 10 µs in report-1 and 20 µs elsewhere; `handle`'s first report, or its
    first of `window`, comes back degraded with every row lost."""
    degraded = iter([True])

    def generate(instance, **overrides):
        time = 10.0 if instance.instance_id == "report-1" else 20.0
        report = _perf_report(_ops(Matmul=time))
        asked = window is None or overrides.get("start_signpost") == window.start
        if instance.instance_id == handle and asked and next(degraded, False):
            raise DegradedPerformanceReport({**report, "report": []})
        return report

    return patch.object(tools, "_generate_canonical_report", side_effect=generate)


class TestDegradedReports:
    """A report generated with swallowed errors may only be missing rows by chance,
    so its totals go when it does: kept, they would outlast it and disagree with the
    handle's next read."""

    def test_a_degraded_repeat_is_read_again_by_the_next_diff(self, tmp_path):
        registry = _registry(tmp_path, count=3)

        with _degraded_once("report-3"):
            first = tools.diff_reports(
                registry, "report-1", "report-2", repeats_b=["report-3"]
            )
            healthy = tools.canonical_report(registry, "report-3")
            second = tools.diff_reports(
                registry, "report-1", "report-2", repeats_b=["report-3"]
            )

        assert first["inconsistent"] == [
            {"op_code": "Matmul", "calls_before": [1], "calls_after": [1, 0]}
        ]
        assert report_diff.degraded_caveat(["report-3"]) in first["caveat"]
        assert "skipped errors" not in second.get("caveat", "")
        assert [row["device_time"] for row in healthy["report"]] == ["20.0"]
        (change,) = second["changes"]
        assert (change["device_time_before"], change["device_time_after"]) == (
            10.0,
            20.0,
        )
        assert second["inconsistent"] == []

    def test_a_degraded_window_s_totals_go_when_it_is_evicted(self, tmp_path):
        """A compared capture keeps its degraded window, but only until two other
        windows evict it; its totals, in a larger cache, would have outlived it."""
        registry = _registry(tmp_path)
        window = tools.SignpostRange("PERF_DECODE", "PERF_DECODE_END")
        bounds = {"start_signpost": window.start, "end_signpost": window.end}

        with (
            _signposts_in("report-1", "report-2"),
            _degraded_once("report-1", window),
        ):
            first = tools.diff_reports(registry, "report-1", "report-2", **bounds)
            for handle in ("report-1", "report-2"):
                tools.canonical_report(registry, handle, tools.SignpostRange("A", "B"))
            healthy = tools.canonical_report(registry, "report-1", window)
            second = tools.diff_reports(registry, "report-1", "report-2", **bounds)

        # The lost row reads as new, which the caveat says it may be.
        assert [entry["op_code"] for entry in first["new"]] == ["Matmul"]
        assert report_diff.degraded_caveat(["report-1"]) in first["caveat"]
        assert [row["device_time"] for row in healthy["report"]] == ["10.0"]
        (change,) = second["changes"]
        assert (change["device_time_before"], change["device_time_after"]) == (
            10.0,
            20.0,
        )


class TestCapturesOnDifferentHardware:
    def test_a_different_architecture_or_clock_is_caveated_not_refused(self, tmp_path):
        registry = _registry(
            tmp_path,
            preambles=[
                "ARCH: wormhole_b0, CHIP_FREQ[MHz]: 1000, Max Compute Cores: 64",
                "ARCH: blackhole, CHIP_FREQ[MHz]: 1350, Max Compute Cores: 130",
            ],
        )

        result = _diff(
            registry, {"report-1": _ops(Matmul=10.0), "report-2": _ops(Matmul=6.0)}
        )

        assert result["mismatched"] == {
            "arch": {"report-1": "wormhole_b0", "report-2": "blackhole"},
            "clock_mhz": {"report-1": 1000.0, "report-2": 1350.0},
            "max_compute_cores": {"report-1": 64.0, "report-2": 130.0},
        }
        assert "differ in arch, clock_mhz and max_compute_cores" in result["caveat"]
        # The captures' own text stays in the data, out of the server's prose.
        assert "blackhole" not in result["caveat"]
        assert [change["op_code"] for change in result["changes"]] == ["Matmul"]

    def test_the_facts_are_read_as_the_flags_read_them(self, tmp_path):
        """By the reader the flags count cores with, which finds a field past a
        byte-order mark or a missing comma, so the two cannot disagree on a device."""
        registry = _registry(
            tmp_path,
            preambles=[
                "\ufeffARCH: wormhole_b0, CHIP_FREQ[MHz]: 1000 Max Compute Cores: 64",
                PREAMBLE.replace("64", "56"),
            ],
        )

        result = _diff(
            registry, {"report-1": _ops(Matmul=10.0), "report-2": _ops(Matmul=10.0)}
        )

        assert result["mismatched"] == {
            "max_compute_cores": {"report-1": 64, "report-2": 56}
        }
        assert "unverified" not in result

    def test_a_different_device_count_is_caveated(self, tmp_path):
        registry = _registry(tmp_path)
        devices = {"report-1": 8, "report-2": 1}

        with patch.object(
            tools,
            "_resolve_signposts",
            side_effect=lambda instance: ResolvedSignposts(
                {}, True, devices[instance.instance_id]
            ),
        ):
            result = _diff(
                registry, {"report-1": _ops(Matmul=10.0), "report-2": _ops(Matmul=10.0)}
            )

        assert result["mismatched"] == {"device_count": {"report-1": 8, "report-2": 1}}

    def test_a_fact_only_some_captures_record_is_named_unverified(self, tmp_path):
        """Left out, the answer would read as checked: the capture with no device log
        could have run on other hardware."""
        registry = _registry(tmp_path)
        (tmp_path / "capture-2" / DeviceLogProfilerQueries.DEVICE_LOG_FILE).unlink()

        result = _diff(
            registry, {"report-1": _ops(Matmul=10.0), "report-2": _ops(Matmul=10.0)}
        )

        assert "mismatched" not in result
        assert result["unverified"] == {
            "arch": ["report-2"],
            "clock_mhz": ["report-2"],
            "max_compute_cores": ["report-2"],
        }
        assert (
            "Not every capture records arch, clock_mhz or max_compute_cores"
            in result["caveat"]
        )

    def test_a_fact_no_capture_records_is_unverified_for_every_handle(self, tmp_path):
        """Unknown on every side is not equal, so silence would read as checked."""
        registry = _registry(tmp_path)
        for capture in ("capture-1", "capture-2"):
            (tmp_path / capture / DeviceLogProfilerQueries.DEVICE_LOG_FILE).unlink()

        result = _diff(
            registry, {"report-1": _ops(Matmul=10.0), "report-2": _ops(Matmul=10.0)}
        )

        both = ["report-1", "report-2"]
        assert result["unverified"] == {
            "arch": both,
            "clock_mhz": both,
            "max_compute_cores": both,
        }
        assert (
            "Not every capture records arch, clock_mhz or max_compute_cores"
            in result["caveat"]
        )

    def test_an_unreadable_device_count_is_unverified_and_the_diff_answered(
        self, tmp_path
    ):
        registry = _registry(tmp_path)

        def resolve(instance):
            if instance.instance_id == "report-2":
                raise DataFormatError("the performance CSV could not be read")
            return ResolvedSignposts({}, True, 1)

        with patch.object(tools, "_resolve_signposts", side_effect=resolve):
            result = _diff(
                registry, {"report-1": _ops(Matmul=10.0), "report-2": _ops(Matmul=6.0)}
            )

        assert result["unverified"] == {"device_count": ["report-2"]}
        assert [change["op_code"] for change in result["changes"]] == ["Matmul"]

    def test_a_repeat_on_other_hardware_and_one_with_no_log_are_both_named(
        self, tmp_path
    ):
        registry = _registry(
            tmp_path,
            count=3,
            preambles=[
                PREAMBLE,
                PREAMBLE,
                PREAMBLE.replace("CHIP_FREQ[MHz]: 1000", "CHIP_FREQ[MHz]: 1350"),
            ],
        )
        (tmp_path / "capture-2" / DeviceLogProfilerQueries.DEVICE_LOG_FILE).unlink()
        rows = {handle: _ops(Matmul=10.0) for handle in ("report-1", "report-2")}
        rows["report-3"] = _ops(Matmul=10.0)

        result = _diff(registry, rows, repeats_b=["report-3"])

        assert result["mismatched"] == {
            "clock_mhz": {"report-1": 1000, "report-3": 1350}
        }
        assert result["unverified"] == {
            "arch": ["report-2"],
            "clock_mhz": ["report-2"],
            "max_compute_cores": ["report-2"],
        }
        assert "The captures differ in clock_mhz" in result["caveat"]
        assert "Not every capture records arch" in result["caveat"]


class TestMetricCaveats:
    @pytest.mark.parametrize(
        "metric, phrase",
        [
            ("op_to_op_gap", "host time between operations"),
            ("total_percent", "device time and op-to-op gap together"),
        ],
    )
    def test_a_metric_moved_by_more_than_the_op_says_so(self, tmp_path, metric, phrase):
        result = _diff(
            _registry(tmp_path),
            {"report-1": [_row()], "report-2": [_row()]},
            by=metric,
        )

        assert phrase in result["caveat"]

    def test_device_time_needs_none(self, tmp_path):
        result = _diff(
            _registry(tmp_path), {"report-1": [_row()], "report-2": [_row()]}
        )

        assert "caveat" not in result


def _transpose_reshaped(rows, duration_ns=None):
    """The smoke capture with its second Transpose call on a taller input, and that
    call's kernel time on both devices set to `duration_ns`."""
    rows = [dict(row) for row in rows]
    second_call = [row for row in rows if row["OP CODE"] == "Transpose"][2:]
    for row in second_call:
        for column in ("INPUT_0_Y", "OUTPUT_0_Y"):
            row[column] = "64"
        if duration_ns is not None:
            row["DEVICE KERNEL DURATION [ns]"] = str(duration_ns)
    return rows


def _every_slot_filled(rows, duration_ns=None):
    """The smoke capture with every tensor slot of each LayerNorm call a copy of its
    first input, which runs its signature past the cut, and its kernel time set to
    `duration_ns`."""
    rows = [dict(row) for row in rows]
    for row in rows:
        if row["OP CODE"] != "LayerNorm":
            continue
        for column in list(row):
            if column.startswith(("INPUT_", "OUTPUT_")):
                field = column.split("_", 2)[2]
                row[column] = row[f"INPUT_0_{field}"]
        if duration_ns is not None:
            row["DEVICE KERNEL DURATION [ns]"] = str(duration_ns)
    return rows


class TestSignatures:
    """Through the real generator: a signature is found by the CSV position a row's
    report id names, which a mocked report cannot exercise."""

    @staticmethod
    def _registry(tmp_path, before, after):
        registry = ReportRegistry()
        for name, rows in (("before", before), ("after", after)):
            write_ops_perf(tmp_path / name, rows)
            load_report(registry, performance_path=str(tmp_path / name))
        return registry

    def test_a_signature_splits_an_op_code_by_its_tensors(self, tmp_path):
        """By op code the slower shape's move is spread over both shapes' time."""
        before = _transpose_reshaped(smoke_rows())
        registry = self._registry(
            tmp_path, before, _transpose_reshaped(before, duration_ns=37_000)
        )

        by_op_code = tools.diff_reports(registry, "report-1", "report-2")
        by_signature = tools.diff_reports(
            registry, "report-1", "report-2", match="signature"
        )

        (op_code_change,) = by_op_code["changes"]
        assert op_code_change["op_code"] == "Transpose"
        assert op_code_change["delta_percent"] == pytest.approx(25.0, abs=0.5)
        (signature_change,) = by_signature["changes"]
        assert signature_change["raw_op_code"] == "Transpose"
        assert signature_change["signature"].startswith(
            "in0 1x1x64x128 TILE BFLOAT16 DRAM_INTERLEAVED"
        )
        # Uncut, a signature tells its group apart by itself.
        assert "signature_full_length" not in signature_change
        assert "signature_digest" not in signature_change
        assert signature_change["delta_percent"] == pytest.approx(50.0, abs=0.5)
        assert by_signature["grouped_by"] == "signature"
        assert report_diff.SIGNATURE_NOISE_CAVEAT in by_signature["caveat"]

    def test_a_signature_is_found_inside_a_signpost_window(self, tmp_path):
        """A windowed row keeps its CSV position as its id, signposts counted, so its
        signature is still the one written on its row."""
        before = _transpose_reshaped(signposted_rows())
        registry = self._registry(
            tmp_path, before, _transpose_reshaped(before, duration_ns=37_000)
        )

        result = tools.diff_reports(
            registry,
            "report-1",
            "report-2",
            match="signature",
            start_signpost="PERF_START",
            end_signpost="PERF_END",
        )

        (change,) = result["changes"]
        assert change["raw_op_code"] == "Transpose"
        assert change["signature"].startswith(
            "in0 1x1x64x128 TILE BFLOAT16 DRAM_INTERLEAVED"
        )
        assert result["projection"]["start_signpost"] == "PERF_START"

    def test_a_tensor_on_another_device_of_a_mesh_is_the_same_signature(self, tmp_path):
        moved = [
            {
                column: (
                    value.replace("DEV_0_", "DEV_1_", 1)
                    if column.endswith("_MEMORY")
                    else value
                )
                for column, value in row.items()
            }
            for row in smoke_rows()
        ]
        registry = self._registry(tmp_path, smoke_rows(), moved)

        result = tools.diff_reports(registry, "report-1", "report-2", match="signature")

        assert (result["new"], result["missing"], result["changes"]) == ([], [], [])

    def test_handles_on_one_capture_read_its_signatures_once(self, tmp_path):
        registry = ReportRegistry()
        for name in ("a", "b"):
            write_ops_perf(tmp_path / name, smoke_rows())
        for name in ("a", "b", "a"):
            load_report(registry, performance_path=str(tmp_path / name))
        reads = []
        read = op_signatures.read_signatures

        def counted(source):
            reads.append(source)
            return read(source)

        with patch.object(op_signatures, "read_signatures", side_effect=counted):
            tools.diff_reports(registry, "report-1", "report-2", match="signature")
            tools.diff_reports(registry, "report-3", "report-2", match="signature")

        assert len(reads) == 2

    def test_captures_recording_sizes_differently_are_caveated(self, tmp_path):
        """A newer capture writes `32[32]`, an older one `32`."""

        def newer(rows):
            renamed = []
            for row in rows:
                copy = {}
                for column, value in row.items():
                    if column.split("_")[0] in ("INPUT", "OUTPUT") and column[-2:] in (
                        "_W",
                        "_Z",
                        "_Y",
                        "_X",
                    ):
                        copy[f"{column}_PAD[LOGICAL]"] = (
                            f"{value}[{value}]" if value else ""
                        )
                    else:
                        copy[column] = value
                renamed.append(copy)
            return renamed

        registry = self._registry(tmp_path, smoke_rows(), newer(smoke_rows()))

        result = tools.diff_reports(registry, "report-1", "report-2", match="signature")

        assert result["mismatched"]["tensor_sizes"] == {
            "report-1": "padded",
            "report-2": "padded[logical]",
        }
        assert "record tensor sizes differently" in result["caveat"]
        assert (result["new"], result["missing"]) == ([], [])

    def test_an_unreadable_csv_is_refused_for_signatures_too(
        self, tmp_path, event_log_directory
    ):
        """As it is when matching by op code: the agent's to fix, not a crash."""
        registry = self._registry(tmp_path, smoke_rows(), smoke_rows())
        csv_path = tmp_path / "after" / "ops_perf_results.csv"
        csv_path.write_bytes(csv_path.read_bytes() + b"Transpose,\xff\xfe\n")

        response = server.handle_message(
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {
                    "name": "diff_reports",
                    "arguments": {
                        "handle_a": "report-1",
                        "handle_b": "report-2",
                        "match": "signature",
                    },
                },
            },
            server._tool_table(registry),
        )

        text = response["result"]["content"][0]["text"]
        assert response["result"]["isError"] is True
        assert text.startswith("'report-2': the performance CSV could not be read")

    def test_a_signature_groups_by_the_raw_op_code(self, tmp_path):
        """tt-perf-report suffixes a matmul's op code with its shapes; a signature
        holds them already, so both rows here are one signature group."""
        rows = [
            _row(
                id="2",
                op_code="Matmul 32 x 64",
                raw_op_code="Matmul",
                device_time="10.0",
            ),
            _row(
                id="3",
                op_code="Matmul 32 x 128",
                raw_op_code="Matmul",
                device_time="10.0",
            ),
        ]
        signatures = op_signatures.Signatures(["in0 1x1x32x64"] * 2, False)
        with (
            patch.object(tools, "_op_signatures", return_value=signatures),
            patch.object(
                tools,
                "_generate_canonical_report",
                side_effect=lambda instance, **_: _perf_report(rows),
            ),
        ):
            result = tools.diff_reports(
                _registry(tmp_path),
                "report-1",
                "report-2",
                match="signature",
                min_percent=0,
                min_delta=0,
            )

        assert result["within_threshold_count"] == 1
        assert result["changes"] == []

    def test_a_row_past_the_signatures_read_groups_under_none(self, tmp_path):
        """A row whose id names no position the CSV read gave still counts, rather
        than failing the diff."""

        def rows(time):
            return [
                _row(
                    id="2", op_code="Matmul", raw_op_code="Matmul", device_time="10.0"
                ),
                _row(
                    id="999", op_code="Matmul", raw_op_code="Matmul", device_time=time
                ),
            ]

        reports = {"report-1": rows("10.0"), "report-2": rows("20.0")}
        signatures = op_signatures.Signatures(["in0 1x1x32x64"], False)
        with (
            patch.object(tools, "_op_signatures", return_value=signatures),
            patch.object(
                tools,
                "_generate_canonical_report",
                side_effect=lambda instance, **_: _perf_report(
                    reports[instance.instance_id]
                ),
            ),
        ):
            result = tools.diff_reports(
                _registry(tmp_path), "report-1", "report-2", match="signature"
            )

        (change,) = result["changes"]
        assert (change["raw_op_code"], change["signature"]) == ("Matmul", None)
        assert result["within_threshold_count"] == 1

    def test_a_rewritten_capture_never_mixes_its_signatures_and_rows(self, tmp_path):
        """A signature is found by the position a row names, so both must come from one
        capture: after a rewrite a diff answers from what it read before, and one that
        needs a new read is refused."""
        before = _transpose_reshaped(signposted_rows())
        rewritten = self._registry(
            tmp_path / "op-code-first",
            before,
            _transpose_reshaped(before, duration_ns=37_000),
        )
        registry = self._registry(
            tmp_path, before, _transpose_reshaped(before, duration_ns=37_000)
        )
        tools.diff_reports(rewritten, "report-1", "report-2")
        tools.diff_reports(registry, "report-1", "report-2", match="signature")
        write_ops_perf(tmp_path / "op-code-first" / "after", before[:-1])
        write_ops_perf(tmp_path / "after", before[:-1])

        result = tools.diff_reports(registry, "report-1", "report-2", match="signature")

        (change,) = result["changes"]
        assert change["signature"].startswith("in0 1x1x64x128")
        # An op code diff reads no signatures, so they would be read from the rewrite.
        with pytest.raises(ValueError, match="has changed since it was first read"):
            tools.diff_reports(rewritten, "report-1", "report-2", match="signature")
        with pytest.raises(ValueError, match="has changed since it was first read"):
            tools.diff_reports(
                registry,
                "report-1",
                "report-2",
                match="signature",
                start_signpost="PERF_START",
                end_signpost="PERF_END",
            )

    def test_a_diff_by_op_code_reads_no_signatures(self, tmp_path):
        """They are a second read of the CSV, which a compared capture leaves to the
        first signature diff; that one sums them from the reports already kept."""
        registry = _registry(tmp_path)
        rows = {"report-1": _ops(Matmul=10.0), "report-2": _ops(Matmul=20.0)}
        signatures = op_signatures.Signatures(["in0 1x1x32x32"], False)

        with (
            patch.object(tools, "_read_op_signatures", return_value=signatures) as read,
            patch.object(
                tools,
                "_generate_canonical_report",
                side_effect=lambda instance, **_: _perf_report(
                    rows[instance.instance_id]
                ),
            ) as generate,
        ):
            by_op_code = tools.diff_reports(registry, "report-1", "report-2")
            read.assert_not_called()
            by_signature = tools.diff_reports(
                registry, "report-1", "report-2", match="signature"
            )

        assert [change["op_code"] for change in by_op_code["changes"]] == ["Matmul"]
        assert [change["raw_op_code"] for change in by_signature["changes"]] == [
            "Matmul"
        ]
        assert read.call_count == 2
        assert generate.call_count == 2

    def test_signatures_unreadable_beside_the_totals_are_refused_later(self, tmp_path):
        """A repeat's signatures are read with its totals, since its report is dropped
        after; unreadable then but readable when asked, they would be missing from what
        the diff compares, so a fresh handle is asked for."""
        registry = _registry(tmp_path, count=3)
        failures = [OSError("busy")]

        def read(_instance):
            if failures:
                raise failures.pop()
            return op_signatures.Signatures(["in0 1x1x32x32"], False)

        rows = {handle: _ops(Matmul=10.0) for handle in ("report-1", "report-2")}
        rows["report-3"] = _ops(Matmul=10.0)
        with patch.object(tools, "_read_op_signatures", side_effect=read):
            _diff(registry, rows, repeats_b=["report-3"])
            assert failures == []
            with pytest.raises(
                ValueError, match="'report-3'.*could not be read when its totals were"
            ):
                _diff(registry, rows, match="signature", repeats_b=["report-3"])

    def test_a_long_signature_is_cut_and_its_length_given(self, tmp_path):
        registry = self._registry(
            tmp_path,
            _every_slot_filled(smoke_rows()),
            _every_slot_filled(smoke_rows(), duration_ns=30_000),
        )

        result = tools.diff_reports(registry, "report-1", "report-2", match="signature")

        (change,) = result["changes"]
        assert len(change["signature"]) == report_diff.MAX_SIGNATURE_CHARS
        assert change["signature_full_length"] > report_diff.MAX_SIGNATURE_CHARS
        assert len(change["signature_digest"]) == report_diff.SIGNATURE_DIGEST_CHARS

    def test_signatures_cut_alike_are_told_apart_by_their_digests(self, tmp_path):
        """A last output's height moved from 32 to 64 keeps the cut and the length, so
        only the digest tells the new group from the missing one."""
        before = _every_slot_filled(smoke_rows())
        after = [dict(row) for row in before]
        for row in after:
            if row["OP CODE"] == "LayerNorm":
                row["OUTPUT_2_Y"] = "64"
        registry = self._registry(tmp_path, before, after)

        result = tools.diff_reports(registry, "report-1", "report-2", match="signature")

        (added,), (gone,) = result["new"], result["missing"]
        named = ("raw_op_code", "signature", "signature_full_length")
        assert [added[field] for field in named] == [gone[field] for field in named]
        assert added["signature_digest"] != gone["signature_digest"]

    def test_a_capture_without_tensor_columns_is_refused_before_generating(
        self, tmp_path
    ):
        bare = [
            {
                column: value
                for column, value in row.items()
                if not column.startswith(("INPUT_", "OUTPUT_"))
            }
            for row in smoke_rows()
        ]
        registry = self._registry(tmp_path, smoke_rows(), bare)

        with patch.object(tools, "_generate_canonical_report") as generate:
            with pytest.raises(ValueError, match="behind 'report-2' has no INPUT_n"):
                tools.diff_reports(registry, "report-1", "report-2", match="signature")

        generate.assert_not_called()


class TestSignatureKeys:
    """Which group a row's signature puts it in, through a mocked report."""

    @staticmethod
    def _diff(tmp_path, rows):
        registry = _registry(tmp_path)
        signatures = op_signatures.Signatures(["in0 1x1x32x32"], False)
        with patch.object(tools, "_read_op_signatures", return_value=signatures):
            return _diff(registry, rows, match="signature")

    @pytest.mark.parametrize("row_id", [None, "x"])
    def test_a_row_whose_id_names_no_position_has_an_empty_signature(
        self, tmp_path, row_id
    ):
        rows = {
            "report-1": [_row(id=row_id, device_time="10.0")],
            "report-2": [_row(id=row_id, device_time="20.0")],
        }

        (change,) = self._diff(tmp_path, rows)["changes"]

        assert (change["raw_op_code"], change["signature"]) == ("Matmul", None)

    def test_a_row_with_no_op_code_is_in_no_group(self, tmp_path):
        unnamed = {"op_code": "", "raw_op_code": ""}
        rows = {
            "report-1": [_row(id="2"), _row(id="3", **unnamed, device_time="10.0")],
            "report-2": [_row(id="2"), _row(id="3", **unnamed, device_time="90.0")],
        }

        result = self._diff(tmp_path, rows)

        assert result["within_threshold_count"] == 1
        for listed in ("changes", "new", "missing", "unmeasured"):
            assert result[listed] == []

    def test_an_op_code_past_the_cut_is_cut_as_a_signature_is(self, tmp_path):
        long_code = "Matmul" + "x" * report_diff.MAX_SIGNATURE_CHARS
        rows = {
            "report-1": [_row(op_code=long_code, device_time="10.0")],
            "report-2": [_row(op_code=long_code, device_time="20.0")],
        }

        (change,) = _diff(_registry(tmp_path), rows)["changes"]

        assert change["op_code"] == long_code[: report_diff.MAX_SIGNATURE_CHARS]
        assert change["op_code_full_length"] == len(long_code)
        assert len(change["op_code_digest"]) == report_diff.SIGNATURE_DIGEST_CHARS


class TestAnswerBudget:
    @pytest.fixture(autouse=True)
    def _never_touch_the_real_event_log(self, event_log_directory):
        """Any tools/call reaches the recorder; none may write outside tmp_path."""

    @pytest.mark.parametrize("match", sorted(report_diff.DIFF_MATCHES))
    def test_every_list_full_fits_the_budget(self, tmp_path, match):
        """Every list at its cap, every change partly measured, op codes as long as a
        real one and signatures past their cut, on two captures a side on different
        hardware."""
        registry = _registry(
            tmp_path,
            count=4,
            preambles=[PREAMBLE, PREAMBLE.replace("1000", "1350"), PREAMBLE, PREAMBLE],
        )
        groups = 2 * MAX_LIMIT

        def rows(after, flaky):
            def named(kind, index):
                return f"{kind:<72}{index:08d}"

            ops = []
            for index in range(groups):
                times = ("400.0", "") if after else ("100.0", "100.0")
                ops += [(named("Changed", index), time) for time in times]
            one_sided = "New" if after else "Missing"
            ops += [(named(one_sided, index), "50.0") for index in range(groups)]
            blank = "5.0" if after else ""
            ops += [(named("Unmeasured", index), blank) for index in range(groups)]
            if flaky:
                ops += [(named("Flaky", index), "1.0") for index in range(groups)]
            return [
                _row(id=str(position + 2), op_code=op_code, device_time=time)
                for position, (op_code, time) in enumerate(ops)
            ]

        reports = {
            "report-1": rows(after=False, flaky=True),
            "report-3": rows(after=False, flaky=False),
            "report-2": rows(after=True, flaky=True),
            "report-4": rows(after=True, flaky=True),
        }
        long_signatures = [f"in0 {position:0400d}" for position in range(5 * groups)]
        arguments = {
            "handle_a": "report-1",
            "handle_b": "report-2",
            "repeats_a": ["report-3"],
            "repeats_b": ["report-4"],
            "limit": MAX_LIMIT,
            "match": match,
        }
        with (
            patch.object(
                tools,
                "_generate_canonical_report",
                side_effect=lambda instance, **_: _perf_report(
                    reports[instance.instance_id]
                ),
            ),
            patch.object(
                tools,
                "_op_signatures",
                return_value=op_signatures.Signatures(long_signatures, True),
            ),
        ):
            response = server.handle_message(
                {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "tools/call",
                    "params": {"name": "diff_reports", "arguments": arguments},
                },
                server._tool_table(registry),
            )

        assert not response["result"].get("isError"), response
        text = response["result"]["content"][0]["text"]
        assert len(text.encode()) < ANSWER_BUDGET_BYTES
        result = json.loads(text)
        cap = MAX_DETAILED_LIMIT if match == "signature" else MAX_LIMIT
        assert len(result["changes"]) == cap
        beside = ("new", "missing", "unmeasured", "inconsistent")
        assert [len(result[name]) for name in beside] == [MAX_DETAILED_LIMIT] * 4
        if match == "op_code":
            # A signature splits each call apart, so only op codes are partly measured.
            assert all(change["measured_after"] == 1 for change in result["changes"])
        assert "mismatched" in result


class TestSchema:
    @pytest.fixture
    def properties(self):
        return server._tool_table(ReportRegistry())["diff_reports"]["schema"][
            "properties"
        ]

    def test_it_declares_the_new_arguments_with_their_defaults(self, properties):
        assert properties["match"]["enum"] == ["op_code", "signature"]
        assert "Defaults to 5." in properties["min_percent"]["description"]
        assert "device_time 1 us" in properties["min_delta"]["description"]
        for name, metric in report_diff.DIFF_METRICS.items():
            assert f"{name} {metric.min_delta:g} {metric.unit}" in (
                properties["min_delta"]["description"]
            )
        for side in ("repeats_a", "repeats_b"):
            assert properties[side]["maxItems"] == report_diff.MAX_CAPTURES_PER_SIDE - 1

    def test_thresholds_reach_the_tool_by_the_names_the_schema_gives(
        self, tmp_path, event_log_directory
    ):
        """A rename on one side of the schema and the tool's arguments fails here."""
        with patch.object(
            tools,
            "_generate_canonical_report",
            side_effect=lambda instance, **_: _perf_report(_ops(Matmul=10.0)),
        ):
            response = server.handle_message(
                {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "tools/call",
                    "params": {
                        "name": "diff_reports",
                        "arguments": {
                            "handle_a": "report-1",
                            "handle_b": "report-2",
                            "min_percent": 2.5,
                            "min_delta": 0.25,
                        },
                    },
                },
                server._tool_table(_registry(tmp_path)),
            )

        assert not response["result"].get("isError"), response
        result = json.loads(response["result"]["content"][0]["text"])
        assert result["thresholds"] == {
            "min_percent": 2.5,
            "min_delta": 0.25,
            "min_delta_unit": "us",
        }

    def test_a_malformed_argument_comes_back_as_a_refusal(
        self, tmp_path, event_log_directory
    ):
        response = server.handle_message(
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {
                    "name": "diff_reports",
                    "arguments": {
                        "handle_a": "report-1",
                        "handle_b": "report-2",
                        "repeats_a": "report-3",
                    },
                },
            },
            server._tool_table(_registry(tmp_path)),
        )

        assert response["result"]["isError"] is True
        assert "repeats_a must be a list of handles" in (
            response["result"]["content"][0]["text"]
        )
