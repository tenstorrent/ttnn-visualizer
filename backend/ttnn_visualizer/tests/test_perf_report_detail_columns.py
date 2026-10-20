# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""The raw columns the app does not show, copied into a row only when asked. #2153

Off for the app, whose rows would roughly double in size for columns it never reads
(#2159); on for the agent tools, through the same reader as every other column.
"""

import pytest
from ttnn_visualizer.csv_queries import (
    REPORT_ROW_ID_OFFSET,
    OpsPerformanceReportQueries,
)
from ttnn_visualizer.models import Instance
from ttnn_visualizer.tests.smoke_capture import smoke_rows, write_ops_perf

DETAIL_COLUMNS = OpsPerformanceReportQueries.DETAIL_COLUMNS


@pytest.fixture
def smoke(tmp_path):
    rows = smoke_rows()
    write_ops_perf(tmp_path, rows)
    return Instance(instance_id="test", performance_path=str(tmp_path)), rows


def test_the_apps_rows_do_not_carry_them(smoke):
    instance, _ = smoke

    report = OpsPerformanceReportQueries.generate_report(instance)["report"]

    assert report
    assert not any(key in row for row in report for key in DETAIL_COLUMNS)


def test_asked_for_they_come_from_the_raw_row_a_report_row_names(smoke):
    instance, raw_rows = smoke

    report = OpsPerformanceReportQueries.generate_report(instance, detail_columns=True)[
        "report"
    ]

    assert report
    for row in report:
        raw = raw_rows[int(row["id"]) - REPORT_ROW_ID_OFFSET]
        assert {key: row[key] for key in DETAIL_COLUMNS} == {
            key: raw.get(header) for key, header in DETAIL_COLUMNS.items()
        }


def test_a_column_the_capture_lacks_is_none_on_every_row(smoke):
    """The smoke capture predates the Ethernet utilisation column."""
    instance, raw_rows = smoke
    assert DETAIL_COLUMNS["eth_bw_util"] not in raw_rows[0]

    report = OpsPerformanceReportQueries.generate_report(instance, detail_columns=True)[
        "report"
    ]

    assert {row["eth_bw_util"] for row in report} == {None}


def test_asking_leaves_the_apps_columns_as_they_were(smoke):
    instance, _ = smoke

    plain = OpsPerformanceReportQueries.generate_report(instance)["report"]
    detailed = OpsPerformanceReportQueries.generate_report(
        instance, detail_columns=True
    )["report"]

    assert [
        {key: value for key, value in row.items() if key not in DETAIL_COLUMNS}
        for row in detailed
    ] == plain
