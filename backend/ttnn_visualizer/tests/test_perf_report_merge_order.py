# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""How the real tt-perf-report orders and admits a merged report.

Since 1.5.0 a merged report keeps the order its rows had before merging, so
`tracingMode`, which only decides whether rows are first sorted by host time,
now decides the sequence link resolution sees. `performanceReportQueryKey.ts`
and CONVENTIONS.md rest on that; these tests fail if a later release reverts it.
"""

from pathlib import Path
from unittest import mock

import pytest
from ttnn_visualizer.csv_queries import (
    MAX_PERFORMANCE_REPORT_DEVICES,
    OpsPerformanceReportQueries,
)
from ttnn_visualizer.exceptions import DataFormatError
from ttnn_visualizer.models import Instance
from ttnn_visualizer.tests.smoke_capture import smoke_rows, write_ops_perf


def _instance(tmp_path: Path, rows) -> Instance:
    write_ops_perf(tmp_path, rows)
    return Instance(instance_id="merge-order", performance_path=str(tmp_path))


@pytest.fixture
def out_of_host_order(tmp_path):
    """Two ops on two devices, Untilize first in the file but Embeddings first by
    host time: the order a trace-captured run's capture-time stamps can give."""
    untilize, embeddings = smoke_rows()[0:2], smoke_rows()[2:4]
    for host_start, row in zip((200, 201), untilize):
        row["HOST START TS"] = str(host_start)
    for host_start, row in zip((100, 101), embeddings):
        row["HOST START TS"] = str(host_start)
    return _instance(tmp_path, untilize + embeddings)


@pytest.mark.parametrize(
    ("tracing_mode", "expected"),
    [(False, ["Embeddings", "Untilize"]), (True, ["Untilize", "Embeddings"])],
)
def test_tracing_mode_decides_the_order_of_merged_rows(
    out_of_host_order, tracing_mode, expected
):
    report = OpsPerformanceReportQueries.generate_report(
        out_of_host_order,
        merge_devices=True,
        hide_host_ops=True,
        tracing_mode=tracing_mode,
    )["report"]

    assert [row["raw_op_code"] for row in report] == expected


def test_a_capture_naming_more_devices_than_any_real_one_is_refused(tmp_path):
    """tt-perf-report's overlap sweep costs rows x devices, so a device per row is
    quadratic; the count is refused before the library ever sees the file."""
    template = smoke_rows()[0]
    rows = [
        {**template, "DEVICE ID": str(device)}
        for device in range(MAX_PERFORMANCE_REPORT_DEVICES + 1)
    ]

    with (
        mock.patch(
            "ttnn_visualizer.csv_queries.perf_report.generate_perf_report"
        ) as generate,
        pytest.raises(DataFormatError, match="devices"),
    ):
        OpsPerformanceReportQueries.generate_report(_instance(tmp_path, rows))

    generate.assert_not_called()
