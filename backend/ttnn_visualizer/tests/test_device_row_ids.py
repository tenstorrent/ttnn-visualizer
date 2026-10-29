# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Merged rows name the per-device rows they stand for (#2177).

With devices unmerged, the frontend links every device's row of an operation
through the merged report's `device_row_ids`, read from tt-perf-report's own
`merge_device_rows` rather than reproduced. These check what that field claims
against the unmerged report, and that reading it can never cost the report.
"""

import logging
from pathlib import Path
from typing import Dict, List

import pytest
from tt_perf_report import perf_report
from ttnn_visualizer import csv_queries
from ttnn_visualizer.agent import tools
from ttnn_visualizer.agent.handles import ReportRegistry, load_report
from ttnn_visualizer.csv_queries import OpsPerformanceReportQueries
from ttnn_visualizer.extensions import db
from ttnn_visualizer.models import Instance, InstanceTable
from ttnn_visualizer.tests.smoke_capture import (
    SMOKE_CAPTURE_DIR,
    smoke_rows,
    write_ops_perf,
)

REPORT_ENDPOINT = "/api/performance/perf-results/report"
DEVICE_OP_TYPE = "tt_dnn_device"

# One operation per entry, in host order: (op code, {device: kernel duration}).
# Device 2 never runs the first Untilize, so its rows pair one op later than a
# file-position grouping would; the AllGather is a collective, which the merge
# keeps by device rather than by duration.
CRAFTED_FILE_ORDER = [
    ("Untilize", 0, 100),
    ("AllGather", 2, 50),
    ("Untilize", 1, 300),
    ("AllGather", 0, 50),
    ("Transpose", 2, 900),
    ("AllGather", 1, 50),
    ("Transpose", 0, 100),
    ("Transpose", 1, 100),
]
# Report ids count the header and from 1, so the first data row is 2.
CRAFTED_GROUPS = [{2, 4}, {3, 5, 7}, {6, 8, 9}]


def _generate(instance: Instance, **options) -> List[Dict]:
    return OpsPerformanceReportQueries.generate_report(
        instance, hide_host_ops=True, tracing_mode=False, **options
    )["report"]


def _smoke_instance() -> Instance:
    smoke_rows()  # skips when the capture is absent
    return Instance(
        instance_id="pytest-device-row-ids", performance_path=str(SMOKE_CAPTURE_DIR)
    )


def _crafted_instance(tmp_path: Path) -> Instance:
    template = smoke_rows()[0]
    rows = [
        {
            **template,
            "OP CODE": op_code,
            "DEVICE ID": str(device),
            "HOST START TS": str(1000 + position),
            "DEVICE KERNEL DURATION [ns]": str(duration),
        }
        for position, (op_code, device, duration) in enumerate(CRAFTED_FILE_ORDER)
    ]
    write_ops_perf(tmp_path, rows)
    return Instance(
        instance_id="pytest-device-row-ids-crafted", performance_path=str(tmp_path)
    )


def _members_by_row(report: List[Dict]) -> Dict[str, List[int]]:
    return {row["id"]: row["device_row_ids"] for row in report}


def test_merged_rows_partition_the_unmerged_device_rows():
    instance = _smoke_instance()
    merged = _generate(instance, merge_devices=True, device_row_ids=True)
    unmerged = _generate(instance, merge_devices=False)
    unmerged_by_id = {int(row["id"]): row for row in unmerged}

    members = [member for row in merged for member in row.get("device_row_ids", [])]
    device_row_ids = {
        row_id
        for row_id, row in unmerged_by_id.items()
        if row["op_type"] == DEVICE_OP_TYPE
    }
    assert len(members) == len(set(members))
    assert set(members) == device_row_ids

    for row in merged:
        assert int(row["id"]) in row["device_row_ids"]
        assert {
            unmerged_by_id[member]["raw_op_code"] for member in row["device_row_ids"]
        } == {row["raw_op_code"]}


def test_a_device_missing_an_op_pairs_by_op_not_by_position(tmp_path):
    merged = _generate(
        _crafted_instance(tmp_path), merge_devices=True, device_row_ids=True
    )
    members = _members_by_row(merged)

    assert sorted(map(set, members.values()), key=min) == CRAFTED_GROUPS
    for row_id, row_members in members.items():
        assert int(row_id) in row_members


@pytest.mark.parametrize(
    "options",
    [
        {"merge_devices": False, "device_row_ids": True},
        {"merge_devices": True},
    ],
    ids=["unmerged", "not-asked-for"],
)
def test_the_field_is_absent_unless_asked_of_a_merged_report(options):
    report = _generate(_smoke_instance(), **options)

    assert report
    assert not any("device_row_ids" in row for row in report)


def test_the_agent_does_not_ask_for_it(tmp_path):
    write_ops_perf(tmp_path, smoke_rows())
    registry = ReportRegistry()
    handle = load_report(registry, performance_path=str(tmp_path))["handle"]

    report = tools.canonical_report(registry, handle)["report"]

    assert report
    assert not any("device_row_ids" in row for row in report)


def test_a_failed_read_leaves_the_report_whole(monkeypatch, caplog):
    def _unreadable(merged):
        raise KeyError("ORIGINAL_ROW")

    monkeypatch.setattr(csv_queries, "_read_merged_device_rows", _unreadable)
    instance = _smoke_instance()

    with caplog.at_level(logging.WARNING, logger=csv_queries.logger.name):
        report = _generate(instance, merge_devices=True, device_row_ids=True)

    assert len(report) == len(_generate(instance, merge_devices=True))
    assert not any("device_row_ids" in row for row in report)
    assert "merged device rows" in caplog.text


def test_an_upstream_rename_is_logged_rather_than_silent(monkeypatch, caplog):
    # Renaming the constant would rename the column the merge writes too, so a
    # rename is simulated by a merge that writes no column under the old name.
    merge_device_rows = perf_report.merge_device_rows
    monkeypatch.setattr(
        perf_report,
        "merge_device_rows",
        lambda df: merge_device_rows(df).drop(columns=[perf_report.MERGED_ROWS_COLUMN]),
    )

    with caplog.at_level(logging.WARNING, logger=csv_queries.logger.name):
        report = _generate(_smoke_instance(), merge_devices=True, device_row_ids=True)

    assert report
    assert not any("device_row_ids" in row for row in report)
    assert "named none of their members" in caplog.text


def test_the_names_it_reads_are_still_upstream():
    """A rename would leave every report without the field, so pin both names."""
    assert callable(perf_report.merge_device_rows)
    assert perf_report.MERGED_ROWS_COLUMN == "MERGED ORIGINAL ROWS"


def test_the_merge_is_put_back_after_a_build():
    merge_device_rows = perf_report.merge_device_rows

    _generate(_smoke_instance(), merge_devices=True, device_row_ids=True)

    assert perf_report.merge_device_rows is merge_device_rows


def test_a_worker_abort_still_propagates_and_the_merge_is_put_back(monkeypatch):
    """gunicorn's timeout handler exits from its own frame mid-build; the wrapper
    must neither swallow that nor leave itself installed. #2183"""

    def _worker_abort(df):
        raise SystemExit(1)

    monkeypatch.setattr(perf_report, "merge_device_rows", _worker_abort)

    with pytest.raises(SystemExit):
        _generate(_smoke_instance(), merge_devices=True, device_row_ids=True)

    assert perf_report.merge_device_rows is _worker_abort


@pytest.fixture
def smoke_instance_id(app):
    smoke_rows()  # skips when the capture is absent
    with app.app_context():
        db.session.add(
            InstanceTable(
                instance_id="pytest-device-row-ids-route",
                active_report={},
                performance_path=str(SMOKE_CAPTURE_DIR),
            )
        )
        db.session.commit()
    return "pytest-device-row-ids-route"


@pytest.mark.parametrize("merge_devices", ["true", "false"])
def test_the_route_asks_for_it_only_when_merged(
    client, smoke_instance_id, merge_devices
):
    response = client.get(
        REPORT_ENDPOINT,
        query_string={"instanceId": smoke_instance_id, "merge_devices": merge_devices},
    )

    assert response.status_code == 200
    report = response.get_json()["report"]
    assert report
    assert all(
        ("device_row_ids" in row) == (merge_devices == "true")
        for row in report
        if row["op_type"] == DEVICE_OP_TYPE
    )
