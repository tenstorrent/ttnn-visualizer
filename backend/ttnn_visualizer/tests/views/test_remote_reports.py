# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

from http import HTTPStatus
from pathlib import Path
from unittest.mock import patch

from ttnn_visualizer.models import RemoteReportFolder


def _remote_connection_payload():
    return {
        "name": "test-remote",
        "username": "tester",
        "host": "remote.example.com",
        "port": 22,
        "profilerPath": "/remote/profiler/reports",
        "performancePath": "/remote/performance/reports",
    }


def _write_valid_performance_report(report_dir: Path) -> None:
    report_dir.mkdir(parents=True)
    (report_dir / "profile_log_device.csv").write_text("x")
    (report_dir / "tracy_profile_log_host.tracy").write_bytes(b"x")
    (report_dir / "ops_perf_results_0.csv").write_text("x")


def test_remote_profiler_returns_204_when_no_reports(client):
    with patch("ttnn_visualizer.views.get_remote_profiler_folders", return_value=[]):
        response = client.post(
            "/api/remote/profiler-reports", json=_remote_connection_payload()
        )

    assert response.status_code == HTTPStatus.NO_CONTENT
    assert response.data == b""


def test_remote_profiler_returns_json_when_reports_exist(app, client):
    app.config["REMOTE_DATA_DIRECTORY"] = Path(app.config["REMOTE_DATA_DIRECTORY"])

    folders = [
        RemoteReportFolder(
            reportName="resnet50",
            remotePath="/remote/profiler/reports/resnet50",
            lastModified=100,
        )
    ]
    expected_local_path = str(
        Path(app.config["REMOTE_DATA_DIRECTORY"])
        / "remote.example.com"
        / app.config["PROFILER_DIRECTORY_NAME"]
        / "resnet50"
    )

    with (
        patch(
            "ttnn_visualizer.views.get_remote_profiler_folders", return_value=folders
        ),
        patch(
            "ttnn_visualizer.views.read_last_synced_file", return_value=123
        ) as read_last_synced,
    ):
        response = client.post(
            "/api/remote/profiler-reports", json=_remote_connection_payload()
        )

    assert response.status_code == HTTPStatus.OK
    data = response.get_json()
    assert isinstance(data, list)
    assert len(data) == 1
    assert data[0]["reportName"] == "resnet50"
    assert data[0]["remotePath"] == "/remote/profiler/reports/resnet50"
    assert data[0]["lastModified"] == 100
    assert data[0]["lastSynced"] == 123
    read_last_synced.assert_called_once_with(expected_local_path)


def test_remote_performance_returns_204_when_no_reports(client):
    with patch("ttnn_visualizer.views.get_remote_performance_folders", return_value=[]):
        response = client.post(
            "/api/remote/performance-reports", json=_remote_connection_payload()
        )

    assert response.status_code == HTTPStatus.NO_CONTENT
    assert response.data == b""


def test_remote_performance_returns_json_when_reports_exist(app, client):
    app.config["REMOTE_DATA_DIRECTORY"] = Path(app.config["REMOTE_DATA_DIRECTORY"])

    folders = [
        RemoteReportFolder(
            reportName="bert",
            remotePath="/remote/performance/reports/bert",
            lastModified=200,
        )
    ]
    expected_local_path = str(
        Path(app.config["REMOTE_DATA_DIRECTORY"])
        / "remote.example.com"
        / app.config["PERFORMANCE_DIRECTORY_NAME"]
        / "bert"
    )

    with (
        patch(
            "ttnn_visualizer.views.get_remote_performance_folders", return_value=folders
        ),
        patch(
            "ttnn_visualizer.views.read_last_synced_file", return_value=456
        ) as read_last_synced,
    ):
        response = client.post(
            "/api/remote/performance-reports", json=_remote_connection_payload()
        )

    assert response.status_code == HTTPStatus.OK
    data = response.get_json()
    assert isinstance(data, list)
    assert len(data) == 1
    assert data[0]["reportName"] == "bert"
    assert data[0]["remotePath"] == "/remote/performance/reports/bert"
    assert data[0]["lastModified"] == 200
    assert data[0]["lastSynced"] == 456
    read_last_synced.assert_called_once_with(expected_local_path)


def test_remote_use_returns_404_when_profiler_not_synced_locally(app, client, tmp_path):
    app.config["REMOTE_DATA_DIRECTORY"] = str(tmp_path)
    app.config["SERVER_MODE"] = False

    response = client.post(
        "/api/remote/use",
        json={
            "connection": _remote_connection_payload(),
            "profiler": {
                "reportName": "resnet50",
                "remotePath": "/remote/profiler/reports/resnet50",
                "lastModified": 1,
            },
        },
    )

    assert response.status_code == HTTPStatus.NOT_FOUND
    assert "not synced locally" in response.get_json()["error"]


def test_remote_use_returns_404_when_performance_not_synced_locally(
    app, client, tmp_path
):
    app.config["REMOTE_DATA_DIRECTORY"] = str(tmp_path)
    app.config["SERVER_MODE"] = False

    response = client.post(
        "/api/remote/use",
        json={
            "connection": _remote_connection_payload(),
            "performance": {
                "reportName": "bert",
                "remotePath": "/remote/performance/reports/bert",
                "lastModified": 1,
            },
        },
    )

    assert response.status_code == HTTPStatus.NOT_FOUND
    assert "not synced locally" in response.get_json()["error"]


def test_remote_use_ok_when_profiler_synced_locally(app, client, tmp_path):
    app.config["REMOTE_DATA_DIRECTORY"] = str(tmp_path)
    app.config["SERVER_MODE"] = False
    report_dir = (
        tmp_path
        / "remote.example.com"
        / app.config["PROFILER_DIRECTORY_NAME"]
        / "resnet50"
    )
    report_dir.mkdir(parents=True)
    (report_dir / "db.sqlite").write_text("x")

    response = client.post(
        "/api/remote/use",
        json={
            "connection": _remote_connection_payload(),
            "profiler": {
                "reportName": "resnet50",
                "remotePath": "/remote/profiler/reports/resnet50",
                "lastModified": 1,
            },
        },
    )

    assert response.status_code == HTTPStatus.OK


def test_remote_use_ok_when_performance_synced_locally(app, client, tmp_path):
    app.config["REMOTE_DATA_DIRECTORY"] = str(tmp_path)
    app.config["SERVER_MODE"] = False
    report_dir = (
        tmp_path
        / "remote.example.com"
        / app.config["PERFORMANCE_DIRECTORY_NAME"]
        / "bert"
    )
    _write_valid_performance_report(report_dir)

    with patch("ttnn_visualizer.views.update_instance") as update_instance:
        response = client.post(
            "/api/remote/use",
            json={
                "connection": _remote_connection_payload(),
                "performance": {
                    "reportName": "bert",
                    "remotePath": "/remote/performance/reports/bert",
                    "lastModified": 1,
                },
            },
        )

    assert response.status_code == HTTPStatus.OK
    update_instance.assert_called_once()
    assert update_instance.call_args.kwargs["performance_name"] == "bert"


def test_remote_use_sanitises_traversal_performance_report_name(app, client, tmp_path):
    """Traversal segments must not escape the connection's report base."""
    app.config["REMOTE_DATA_DIRECTORY"] = str(tmp_path)
    app.config["SERVER_MODE"] = False

    victim = (
        tmp_path / "other-host" / app.config["PERFORMANCE_DIRECTORY_NAME"] / "victim"
    )
    _write_valid_performance_report(victim)

    with patch("ttnn_visualizer.views.update_instance") as update_instance:
        response = client.post(
            "/api/remote/use",
            json={
                "connection": _remote_connection_payload(),
                "performance": {
                    "reportName": "../../other-host/performance-reports/victim",
                    "remotePath": "/remote/performance/reports/bert",
                    "lastModified": 1,
                },
            },
        )

    # Collapses to segment "victim" under remote.example.com — not the other host.
    assert response.status_code == HTTPStatus.NOT_FOUND
    assert "not synced locally" in response.get_json()["error"]
    update_instance.assert_not_called()


def test_remote_use_rejects_dotdot_report_name(app, client, tmp_path):
    app.config["REMOTE_DATA_DIRECTORY"] = str(tmp_path)
    app.config["SERVER_MODE"] = False

    response = client.post(
        "/api/remote/use",
        json={
            "connection": _remote_connection_payload(),
            "performance": {
                "reportName": "..",
                "remotePath": "/remote/performance/reports/bert",
                "lastModified": 1,
            },
        },
    )

    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert "Invalid report name" in response.get_json()["error"]
