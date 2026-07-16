# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

from http import HTTPStatus
from pathlib import Path

from ttnn_visualizer.local_remote_reports import (
    list_local_synced_performance_folders,
    list_local_synced_profiler_folders,
    local_synced_report_path,
)
from ttnn_visualizer.models import RemoteConnection
from ttnn_visualizer.utils import update_last_synced


def _connection(host: str = "bh-lb-01") -> RemoteConnection:
    return RemoteConnection(
        name="test",
        username="user",
        host=host,
        port=22,
        profilerPath="/remote/profiler/reports",
        performancePath="/remote/performance/reports",
    )


def _write_valid_performance_report(report_dir: Path) -> None:
    report_dir.mkdir(parents=True)
    (report_dir / "profile_log_device.csv").write_text("x")
    (report_dir / "tracy_profile_log_host.tracy").write_bytes(b"x")
    (report_dir / "ops_perf_results_0.csv").write_text("x")


def test_list_local_synced_profiler_folders(tmp_path: Path):
    host = "bh-lb-01"
    report_dir = tmp_path / host / "profiler-reports" / "resnet50"
    report_dir.mkdir(parents=True)
    (report_dir / "db.sqlite").write_text("x")
    update_last_synced(report_dir)

    folders = list_local_synced_profiler_folders(
        _connection(host), tmp_path, "profiler-reports"
    )

    assert len(folders) == 1
    assert folders[0].reportName == "resnet50"
    assert folders[0].remotePath.endswith("/resnet50")
    assert folders[0].lastSynced is not None
    assert folders[0].lastModified == folders[0].lastSynced


def test_list_local_uses_mtime_when_last_synced_missing(tmp_path: Path):
    host = "bh-lb-01"
    report_dir = tmp_path / host / "profiler-reports" / "resnet50"
    report_dir.mkdir(parents=True)
    (report_dir / "db.sqlite").write_text("x")
    expected_mtime = int(report_dir.stat().st_mtime)

    folders = list_local_synced_profiler_folders(
        _connection(host), tmp_path, "profiler-reports"
    )

    assert len(folders) == 1
    assert folders[0].lastSynced is None
    assert folders[0].lastModified == expected_mtime


def test_list_local_synced_performance_folders(tmp_path: Path):
    host = "bh-lb-01"
    report_dir = tmp_path / host / "performance-reports" / "2026_07_14_18_51_53"
    report_dir.mkdir(parents=True)
    (report_dir / "profile_log_device.csv").write_text("x")
    (report_dir / "tracy_profile_log_host.tracy").write_text("x")
    (report_dir / "ops_perf_results_2026_07_14_18_51_53.csv").write_text("x")
    update_last_synced(report_dir)

    folders = list_local_synced_performance_folders(
        _connection(host), tmp_path, "performance-reports"
    )

    assert len(folders) == 1
    assert folders[0].reportName == "2026_07_14_18_51_53"
    assert folders[0].lastSynced is not None


def test_list_local_skips_dirs_without_marker(tmp_path: Path):
    host = "bh-lb-01"
    empty = tmp_path / host / "performance-reports" / "empty"
    empty.mkdir(parents=True)

    folders = list_local_synced_performance_folders(
        _connection(host), tmp_path, "performance-reports"
    )

    assert folders == []


def test_list_local_skips_incomplete_performance_folder(tmp_path: Path):
    host = "bh-lb-01"
    incomplete = tmp_path / host / "performance-reports" / "partial"
    incomplete.mkdir(parents=True)
    # Device log alone is not enough — need tracy + ops_perf_results* too.
    (incomplete / "profile_log_device.csv").write_text("x")

    folders = list_local_synced_performance_folders(
        _connection(host), tmp_path, "performance-reports"
    )

    assert folders == []


def test_list_local_skips_ops_perf_results_directory(tmp_path: Path):
    """A directory named ops_perf_results* must not satisfy the file marker check."""
    host = "bh-lb-01"
    report_dir = tmp_path / host / "performance-reports" / "partial"
    report_dir.mkdir(parents=True)
    (report_dir / "profile_log_device.csv").write_text("x")
    (report_dir / "tracy_profile_log_host.tracy").write_bytes(b"x")
    (report_dir / "ops_perf_results_0").mkdir()

    folders = list_local_synced_performance_folders(
        _connection(host), tmp_path, "performance-reports"
    )

    assert folders == []


def test_list_local_skips_profiler_folder_without_db(tmp_path: Path):
    host = "bh-lb-01"
    incomplete = tmp_path / host / "profiler-reports" / "partial"
    incomplete.mkdir(parents=True)
    (incomplete / "config.json").write_text("{}")

    folders = list_local_synced_profiler_folders(
        _connection(host), tmp_path, "profiler-reports"
    )

    assert folders == []


def _local_reports_connection_payload(host: str) -> dict:
    return {
        "name": "test-remote",
        "username": "tester",
        "host": host,
        "port": 22,
        "profilerPath": "/remote/profiler/reports",
        "performancePath": "/remote/performance/reports",
    }


def test_local_profiler_reports_endpoint_forbidden_when_server_mode(app, client):
    """Disk-only local list APIs are @local_only and must 403 in hosted SERVER_MODE."""
    assert app.config["SERVER_MODE"] is True

    response = client.post(
        "/api/remote/local-profiler-reports",
        json=_local_reports_connection_payload("remote.example.com"),
    )

    assert response.status_code == HTTPStatus.FORBIDDEN


def test_local_performance_reports_endpoint_forbidden_when_server_mode(app, client):
    """Disk-only local list APIs are @local_only and must 403 in hosted SERVER_MODE."""
    assert app.config["SERVER_MODE"] is True

    response = client.post(
        "/api/remote/local-performance-reports",
        json=_local_reports_connection_payload("remote.example.com"),
    )

    assert response.status_code == HTTPStatus.FORBIDDEN


def test_local_profiler_reports_endpoint(app, client, tmp_path: Path):
    app.config["SERVER_MODE"] = False
    app.config["REMOTE_DATA_DIRECTORY"] = tmp_path
    app.config["PROFILER_DIRECTORY_NAME"] = "profiler-reports"

    host = "remote.example.com"
    report_dir = tmp_path / host / "profiler-reports" / "resnet50"
    report_dir.mkdir(parents=True)
    (report_dir / "db.sqlite").write_text("x")
    update_last_synced(report_dir)

    response = client.post(
        "/api/remote/local-profiler-reports",
        json=_local_reports_connection_payload(host),
    )

    assert response.status_code == HTTPStatus.OK
    data = response.get_json()
    assert len(data) == 1
    assert data[0]["reportName"] == "resnet50"


def test_local_profiler_reports_endpoint_400_when_connection_invalid(app, client):
    app.config["SERVER_MODE"] = False

    response = client.post(
        "/api/remote/local-profiler-reports",
        json={
            "name": "test-remote",
            "username": "tester",
            # host required; port out of range triggers ValidationError
            "port": 0,
            "profilerPath": "/remote/profiler/reports",
        },
    )

    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert response.get_json()["error"] == "Invalid connection data"


def test_local_profiler_reports_endpoint_400_when_connection_missing(app, client):
    app.config["SERVER_MODE"] = False

    response = client.post("/api/remote/local-profiler-reports", json={})

    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert response.get_json()["error"] == "Missing connection data"


def test_local_performance_reports_endpoint(app, client, tmp_path: Path):
    app.config["SERVER_MODE"] = False
    app.config["REMOTE_DATA_DIRECTORY"] = tmp_path
    app.config["PERFORMANCE_DIRECTORY_NAME"] = "performance-reports"

    host = "remote.example.com"
    report_dir = tmp_path / host / "performance-reports" / "perf-run"
    _write_valid_performance_report(report_dir)
    update_last_synced(report_dir)

    response = client.post(
        "/api/remote/local-performance-reports",
        json=_local_reports_connection_payload(host),
    )

    assert response.status_code == HTTPStatus.OK
    data = response.get_json()
    assert len(data) == 1
    assert data[0]["reportName"] == "perf-run"


def test_local_profiler_reports_endpoint_contains_crafted_host(
    app, client, tmp_path: Path
):
    """Traversal-looking hosts sanitise to a single segment under REMOTE_DATA_DIRECTORY."""
    app.config["SERVER_MODE"] = False
    app.config["REMOTE_DATA_DIRECTORY"] = tmp_path
    app.config["PROFILER_DIRECTORY_NAME"] = "profiler-reports"

    crafted_host = "../escape"
    safe_host = "escape"
    report_dir = tmp_path / safe_host / "profiler-reports" / "resnet50"
    report_dir.mkdir(parents=True)
    (report_dir / "db.sqlite").write_text("x")

    resolved = local_synced_report_path(
        tmp_path, safe_host, "profiler-reports", "resnet50"
    ).resolve()
    assert resolved.is_relative_to(tmp_path.resolve())

    response = client.post(
        "/api/remote/local-profiler-reports",
        json=_local_reports_connection_payload(crafted_host),
    )

    assert response.status_code == HTTPStatus.OK
    assert response.get_json()[0]["reportName"] == "resnet50"


def test_local_profiler_reports_endpoint_400_when_host_is_dotdot(app, client):
    app.config["SERVER_MODE"] = False

    response = client.post(
        "/api/remote/local-profiler-reports",
        json=_local_reports_connection_payload(".."),
    )

    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert response.get_json()["error"] == "Invalid connection data"


def test_local_performance_reports_endpoint_204_when_empty(app, client):
    app.config["SERVER_MODE"] = False

    response = client.post(
        "/api/remote/local-performance-reports",
        json=_local_reports_connection_payload("missing-host"),
    )

    assert response.status_code == HTTPStatus.NO_CONTENT
