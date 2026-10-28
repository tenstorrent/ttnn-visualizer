# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""A performance CSV naming more devices than any real capture is refused.

Two tt-perf-report passes cost rows x devices, and a crafted file giving each
device its own op code makes every row a pass that prints a warning listing the
devices it missed. See `MAX_PERFORMANCE_REPORT_DEVICES`.
"""

import sys
import threading
from pathlib import Path
from unittest import mock

import pytest
from ttnn_visualizer.csv_queries import (
    MAX_PERF_REPORT_OUTPUT_CHARS,
    MAX_PERFORMANCE_REPORT_DEVICES,
    OpsPerformanceReportQueries,
    _perf_report_output_bounded,
)
from ttnn_visualizer.exceptions import DataFormatError
from ttnn_visualizer.extensions import db
from ttnn_visualizer.models import Instance, InstanceTable
from ttnn_visualizer.tests.smoke_capture import smoke_rows, write_ops_perf

REPORT_ENDPOINT = "/api/performance/perf-results/report"
GENERATE_PERF_REPORT = "ttnn_visualizer.csv_queries.perf_report.generate_perf_report"


def _device_rows(device_count: int, distinct_op_codes: bool = False):
    """One smoke row per device, each with its own op code when asked: the shape
    that makes every row its own merge pass."""
    template = smoke_rows()[0]
    return [
        {
            **template,
            "DEVICE ID": str(device),
            "HOST START TS": str(device),
            **({"OP CODE": f"Op{device}"} if distinct_op_codes else {}),
        }
        for device in range(device_count)
    ]


def _instance(tmp_path: Path, rows) -> Instance:
    write_ops_perf(tmp_path, rows)
    return Instance(instance_id="device-cap", performance_path=str(tmp_path))


def test_a_capture_over_the_ceiling_is_refused_before_the_library_runs(tmp_path):
    rows = _device_rows(MAX_PERFORMANCE_REPORT_DEVICES + 1)

    with (
        mock.patch(GENERATE_PERF_REPORT) as generate,
        pytest.raises(DataFormatError, match="devices"),
    ):
        OpsPerformanceReportQueries.generate_report(_instance(tmp_path, rows))

    generate.assert_not_called()


def test_a_capture_at_the_ceiling_is_generated(tmp_path):
    rows = _device_rows(MAX_PERFORMANCE_REPORT_DEVICES)

    with mock.patch(GENERATE_PERF_REPORT) as generate:
        OpsPerformanceReportQueries.generate_report(_instance(tmp_path, rows))

    generate.assert_called_once()


def test_device_ids_are_counted_as_the_library_reads_them(tmp_path):
    """ "1" and "1.0" are one device to tt-perf-report and "host" none, so a
    capture spelling its ids oddly is not refused for devices it does not have."""
    rows = _device_rows(MAX_PERFORMANCE_REPORT_DEVICES)
    rows += [
        {**rows[1], "DEVICE ID": "1.0"},
        {**rows[1], "DEVICE ID": "host"},
    ]

    with mock.patch(GENERATE_PERF_REPORT) as generate:
        OpsPerformanceReportQueries.generate_report(_instance(tmp_path, rows))

    generate.assert_called_once()


def test_the_library_s_warnings_never_reach_stdout(tmp_path, capsys):
    """At the ceiling a crafted file still merges, one row per pass, and each pass
    warns about every device the op is missing from. All of it is held to a
    bounded buffer for the debug log, not written to the worker's stdout."""
    rows = _device_rows(MAX_PERFORMANCE_REPORT_DEVICES, distinct_op_codes=True)

    with mock.patch("ttnn_visualizer.csv_queries.logger") as logger:
        OpsPerformanceReportQueries.generate_report(_instance(tmp_path, rows))

    assert capsys.readouterr().out == ""
    logged = [call.args for call in logger.debug.call_args_list]
    kept = [args[1] for args in logged if args[0] == "tt-perf-report output: %s"]
    assert kept and len(kept[0]) <= MAX_PERF_REPORT_OUTPUT_CHARS
    assert any(
        args[0] == "tt-perf-report output: %d further characters dropped"
        for args in logged
    )


def test_overlapping_builds_on_threads_leave_stdout_as_they_found_it():
    """Builds A and B on two threads, B starting while A holds the redirect and
    finishing after it. Overlapping, B would save A's buffer as the stdout to
    restore and put it back last, leaving every later print in a finished
    build's buffer. Taking turns, B waits for A to finish first."""
    stdout = sys.stdout
    b_entered, a_exited = threading.Event(), threading.Event()

    def build_a():
        with _perf_report_output_bounded():
            # Overlapping, B gets in here; taking turns, it cannot until A is done.
            b_entered.wait(timeout=0.5)
        a_exited.set()

    def build_b():
        with _perf_report_output_bounded():
            b_entered.set()
            a_exited.wait(timeout=5)

    threads = [threading.Thread(target=build_a), threading.Thread(target=build_b)]
    threads[0].start()
    threads[1].start()
    for thread in threads:
        thread.join(timeout=10)

    assert sys.stdout is stdout


@pytest.fixture
def over_the_ceiling_instance(app, tmp_path):
    write_ops_perf(tmp_path, _device_rows(MAX_PERFORMANCE_REPORT_DEVICES + 1))
    with app.app_context():
        db.session.add(
            InstanceTable(
                instance_id="pytest-device-cap",
                active_report={},
                performance_path=str(tmp_path),
            )
        )
        db.session.commit()
    return "pytest-device-cap"


def test_the_report_route_refuses_it_as_unprocessable(
    client, over_the_ceiling_instance
):
    response = client.get(
        REPORT_ENDPOINT, query_string={"instanceId": over_the_ceiling_instance}
    )

    assert response.status_code == 422
    assert "devices" in response.get_data(as_text=True)
