# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""The hardware counters a report's rows carry: a headline subset, and only when the
capture has them, so the table payload stays as it was (#2330). #2371"""

from unittest.mock import patch

import orjson
import pytest
from ttnn_visualizer import hardware_counters
from ttnn_visualizer.csv_queries import (
    REPORT_ROW_ID_OFFSET,
    OpsPerformanceReportQueries,
)
from ttnn_visualizer.models import Instance
from ttnn_visualizer.tests.hardware_counter_capture import (
    PERCENT_LABELS,
    counter_rows,
    is_counted,
    label_values,
    stat_column,
    write_counter_capture,
)
from ttnn_visualizer.tests.smoke_capture import smoke_rows, write_ops_perf

# The headline columns the synthetic capture has: no pack or l1_1 group.
CAPTURED_KEYS = {
    "hw_fpu_util",
    "hw_sfpu_util",
    "hw_math_util",
    "hw_unpacker0_busy",
    "hw_unpacker1_busy",
    "hw_l1_bandwidth_util",
    "hw_noc_ring0_util",
    "hw_grid_fpu_util",
    "hw_grid_sfpu_util",
    "hw_grid_math_util",
}


@pytest.fixture
def smoke(tmp_path):
    write_ops_perf(tmp_path / "smoke", smoke_rows())
    return Instance(instance_id="smoke", performance_path=str(tmp_path / "smoke"))


@pytest.fixture
def counted(tmp_path):
    write_counter_capture(tmp_path / "counted")
    return Instance(instance_id="counted", performance_path=str(tmp_path / "counted"))


def _counter_keys(row):
    return {key for key in row if key in hardware_counters.REPORT_ROW_KEYS}


class TestWithoutCounters:
    def test_the_envelope_says_the_report_has_no_counters(self, smoke):
        assert (
            OpsPerformanceReportQueries.generate_report(smoke)["has_hardware_counters"]
            is False
        )

    def test_no_row_gains_a_counter_key(self, smoke):
        report = OpsPerformanceReportQueries.generate_report(
            smoke, detail_columns=True
        )["report"]

        assert report
        assert not any(_counter_keys(row) for row in report)

    def test_the_payload_is_what_it_was_before_counters(self, smoke):
        """Generated as if the counter columns were never looked for."""
        payload = OpsPerformanceReportQueries.generate_report_json(smoke)

        with patch(
            "ttnn_visualizer.csv_queries.hardware_counters.report_columns",
            return_value={},
        ):
            before = OpsPerformanceReportQueries.generate_report(smoke)

        assert payload == orjson.dumps(before)


class TestWithCounters:
    def test_the_envelope_says_the_report_has_counters(self, counted):
        assert (
            OpsPerformanceReportQueries.generate_report(counted)[
                "has_hardware_counters"
            ]
            is True
        )

    def test_a_capture_of_no_headline_group_has_counters_but_no_row_key(self, tmp_path):
        """An instrn-only capture: the rows cannot say it has counters, the envelope can."""
        rows = [
            {**row, stat_column("T1 Instrn Issue Rate", "Avg"): "12.5"}
            for row in smoke_rows()
        ]
        write_ops_perf(tmp_path / "instrn", rows)
        instance = Instance(
            instance_id="instrn", performance_path=str(tmp_path / "instrn")
        )

        generated = OpsPerformanceReportQueries.generate_report(instance)

        assert generated["has_hardware_counters"] is True
        assert not any(_counter_keys(row) for row in generated["report"])

    def test_the_apps_rows_carry_the_captured_headline_averages_only(self, counted):
        report = OpsPerformanceReportQueries.generate_report(counted)["report"]

        assert report
        assert all(_counter_keys(row) == CAPTURED_KEYS for row in report)

    def test_the_rows_grow_by_at_most_the_headline_subset(self, counted, smoke):
        counted_report = OpsPerformanceReportQueries.generate_report(counted)["report"]
        plain_report = OpsPerformanceReportQueries.generate_report(smoke)["report"]

        grown = set(counted_report[0]) - set(plain_report[0])

        assert grown == CAPTURED_KEYS
        assert len(grown) <= len(
            hardware_counters.HEADLINE_UNITS + hardware_counters.FULL_GRID_UNITS
        )

    def test_a_value_is_the_raw_rows_average_and_a_blank_one_is_null(self, counted):
        report = OpsPerformanceReportQueries.generate_report(counted)["report"]

        for row in report:
            position = int(row["id"]) - REPORT_ROW_ID_OFFSET
            *_, average = label_values(PERCENT_LABELS.index("SFPU Util"), position)
            expected = average if is_counted(position) else None
            assert row["hw_sfpu_util"] == expected, row["id"]

        assert any(row["hw_fpu_util"] is None for row in report)

    def test_the_minimum_and_maximum_reach_only_the_agents_rows(self, counted):
        app = OpsPerformanceReportQueries.generate_report(counted)["report"]
        agent = OpsPerformanceReportQueries.generate_report(
            counted, detail_columns=True
        )["report"]

        assert "hw_fpu_util_min" not in app[0]
        row = next(row for row in agent if row["hw_fpu_util"] is not None)
        position = int(row["id"]) - REPORT_ROW_ID_OFFSET
        minimum, _, maximum, _ = label_values(
            PERCENT_LABELS.index("FPU Util"), position
        )
        assert (row["hw_fpu_util_min"], row["hw_fpu_util_max"]) == (minimum, maximum)

    def test_the_counter_columns_change_no_other_field(self, counted, smoke):
        counted_report = OpsPerformanceReportQueries.generate_report(counted)["report"]
        plain_report = OpsPerformanceReportQueries.generate_report(smoke)["report"]

        assert [
            {key: value for key, value in row.items() if key not in CAPTURED_KEYS}
            for row in counted_report
        ] == plain_report


def test_the_envelope_counts_the_devices_the_csv_names(smoke):
    """The smoke capture is two devices, so a merged row is one of two devices' rows."""
    assert OpsPerformanceReportQueries.generate_report(smoke)["device_count"] == 2


def test_the_synthetic_capture_writes_tt_metals_header_shapes(tmp_path):
    """The fixture's columns are the strings tt-metal writes, ratio ones included."""
    header = list(counter_rows()[0])

    assert "FPU Util Min (%)" in header
    assert "Unpacker-to-Math Data Flow (srcA) Avg (ratio)" in header
    assert header[-3:] == [
        "Avg SFPU util on full grid (%)",
        "Avg FPU util on full grid (%)",
        "Avg Math util on full grid (%)",
    ]
