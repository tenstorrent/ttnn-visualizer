# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""`isDemo` and `runFingerprint` on the profiler and performance report listings.

The frontend records a hosted pick of a listed folder as `demo` or `upload` from this
flag alone, so the listing is the single owner of the demo rule.
"""

import sqlite3
from http import HTTPStatus
from pathlib import Path

import pytest
from ttnn_visualizer.extensions import db
from ttnn_visualizer.models import InstanceTable
from ttnn_visualizer.report_fingerprint import (
    performance_run_fingerprint,
    profiler_run_fingerprint,
)


def _make_profiler_report(root: Path, name: str) -> None:
    (root / name).mkdir(parents=True)
    (root / name / "db.sqlite").write_bytes(b"")


def _make_readable_profiler_report(root: Path, name: str) -> None:
    (root / name).mkdir(parents=True)
    connection = sqlite3.connect(root / name / "db.sqlite")
    connection.execute("CREATE TABLE operations (operation_id int)")
    connection.close()


def _make_performance_report(root: Path, name: str) -> None:
    (root / name).mkdir(parents=True)
    (root / name / "profile_log_device.csv").write_text("")
    (root / name / "ops_perf_results.csv").write_text("")


@pytest.mark.parametrize(
    ("endpoint", "directory_key", "make_report_dir", "demo_name"),
    [
        (
            "/api/profiler",
            "PROFILER_DIRECTORY_NAME",
            _make_profiler_report,
            "demo_n300-llama",
        ),
        (
            "/api/performance",
            "PERFORMANCE_DIRECTORY_NAME",
            _make_performance_report,
            "DEMO_N300-LLAMA",
        ),
    ],
)
@pytest.mark.parametrize("server_mode", [True, False])
def test_listing_marks_demo_folders_only_under_server_mode(
    app,
    client,
    make_report,
    endpoint,
    directory_key,
    make_report_dir,
    demo_name,
    server_mode,
):
    app.config["SERVER_MODE"] = server_mode
    root = Path(app.config["LOCAL_DATA_DIRECTORY"]) / app.config[directory_key]
    make_report_dir(root, demo_name)
    make_report_dir(root, "my-report")

    response = client.get(endpoint, query_string={"instanceId": make_report()})

    assert response.status_code == HTTPStatus.OK, response.get_data(as_text=True)
    is_demo_by_path = {
        folder["path"]: folder["isDemo"] for folder in response.get_json()
    }
    if server_mode:
        # Hosted listings never show another session's uploads, so only the demo appears.
        assert is_demo_by_path == {demo_name: True}
    else:
        assert is_demo_by_path == {demo_name: False, "my-report": False}


@pytest.mark.parametrize(
    ("endpoint", "directory_key", "make_report_dir", "run_fingerprint"),
    [
        (
            "/api/profiler",
            "PROFILER_DIRECTORY_NAME",
            _make_readable_profiler_report,
            profiler_run_fingerprint,
        ),
        (
            "/api/performance",
            "PERFORMANCE_DIRECTORY_NAME",
            _make_performance_report,
            performance_run_fingerprint,
        ),
    ],
)
def test_listing_carries_each_folders_run_fingerprint(
    app, client, make_report, endpoint, directory_key, make_report_dir, run_fingerprint
):
    app.config["SERVER_MODE"] = False
    root = Path(app.config["LOCAL_DATA_DIRECTORY"]) / app.config[directory_key]
    make_report_dir(root, "my-report")

    response = client.get(endpoint, query_string={"instanceId": make_report()})

    assert response.status_code == HTTPStatus.OK, response.get_data(as_text=True)
    [folder] = response.get_json()
    # Present even when null, so the client can tell "unknown" from "not sent".
    assert folder["runFingerprint"] is not None
    assert folder["runFingerprint"] == run_fingerprint(root / "my-report")


def test_report_fingerprints_describe_the_active_reports(app, client, tmp_path):
    profiler_dir = tmp_path / "memory"
    _make_readable_profiler_report(tmp_path, "memory")
    performance_dir = tmp_path / "performance"
    _make_performance_report(tmp_path, "performance")

    with app.app_context():
        db.session.add(
            InstanceTable(
                instance_id="fingerprints",
                active_report={},
                profiler_path=str(profiler_dir / "db.sqlite"),
                performance_path=str(performance_dir),
            )
        )
        db.session.commit()

    response = client.get(
        "/api/report-fingerprints", query_string={"instanceId": "fingerprints"}
    )

    assert response.status_code == HTTPStatus.OK
    assert response.get_json() == {
        "profiler": profiler_run_fingerprint(profiler_dir),
        "performance": performance_run_fingerprint(performance_dir),
    }
    assert None not in response.get_json().values()


def test_report_fingerprints_are_null_without_active_reports(app, client):
    with app.app_context():
        db.session.add(InstanceTable(instance_id="no-reports", active_report={}))
        db.session.commit()

    response = client.get(
        "/api/report-fingerprints", query_string={"instanceId": "no-reports"}
    )

    assert response.status_code == HTTPStatus.OK
    assert response.get_json() == {"profiler": None, "performance": None}
