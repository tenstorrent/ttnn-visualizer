# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""How the real tt-perf-report orders a merged report.

Since 1.5.0 a merged report keeps the order its rows had before merging, so
`tracingMode`, which only decides whether rows are first sorted by host time,
now decides the sequence link resolution sees. `performanceReportQueryKey.ts`
and CONVENTIONS.md rest on that; these tests fail if a later release reverts it.
"""

from pathlib import Path

import pytest
from ttnn_visualizer.csv_queries import OpsPerformanceReportQueries
from ttnn_visualizer.models import Instance
from ttnn_visualizer.tests.smoke_capture import smoke_rows, write_ops_perf


def _instance(tmp_path: Path, rows) -> Instance:
    write_ops_perf(tmp_path, rows)
    return Instance(instance_id="merge-order", performance_path=str(tmp_path))


def _out_of_host_order(untilize, embeddings):
    """Untilize first in the file but Embeddings first by host time: the order a
    trace-captured run's capture-time stamps can give."""
    for host_start, row in enumerate(untilize, start=200):
        row["HOST START TS"] = str(host_start)
    for host_start, row in enumerate(embeddings, start=100):
        row["HOST START TS"] = str(host_start)
    return untilize + embeddings


@pytest.fixture(params=["two devices", "one device"])
def out_of_host_order(request, tmp_path):
    """Each op on both smoke devices, or on device 0 alone: merging runs on a
    single-device report too, so the order holds there as well."""
    rows = smoke_rows()
    if request.param == "two devices":
        untilize, embeddings = rows[0:2], rows[2:4]
    else:
        untilize, embeddings = [rows[0]], [rows[2]]
    assert {row["DEVICE ID"] for row in untilize + embeddings} == (
        {"0", "1"} if request.param == "two devices" else {"0"}
    )
    return _instance(tmp_path, _out_of_host_order(untilize, embeddings))


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
