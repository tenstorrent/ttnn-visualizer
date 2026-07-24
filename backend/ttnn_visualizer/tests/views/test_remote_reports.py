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


def _write_valid_performance_report(
    report_dir: Path, *, with_tracy: bool = True
) -> None:
    report_dir.mkdir(parents=True)
    (report_dir / "profile_log_device.csv").write_text("x")
    (report_dir / "ops_perf_results_0.csv").write_text("x")
    if with_tracy:
        (report_dir / "tracy_profile_log_host.tracy").write_bytes(b"x")


def test_remote_profiler_returns_204_when_no_reports(app, client):
    app.config["SERVER_MODE"] = False

    with patch("ttnn_visualizer.views.get_remote_profiler_folders", return_value=[]):
        response = client.post(
            "/api/remote/profiler-reports", json=_remote_connection_payload()
        )

    assert response.status_code == HTTPStatus.NO_CONTENT
    assert response.data == b""


def test_remote_profiler_returns_json_when_reports_exist(app, client):
    app.config["SERVER_MODE"] = False
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


def test_remote_performance_returns_204_when_no_reports(app, client):
    app.config["SERVER_MODE"] = False

    with patch("ttnn_visualizer.views.get_remote_performance_folders", return_value=[]):
        response = client.post(
            "/api/remote/performance-reports", json=_remote_connection_payload()
        )

    assert response.status_code == HTTPStatus.NO_CONTENT
    assert response.data == b""


def test_remote_performance_returns_json_when_reports_exist(app, client):
    app.config["SERVER_MODE"] = False
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


def test_remote_use_prefers_remote_path_basename_over_display_report_name(
    app, client, tmp_path
):
    """Sync writes under Path(remotePath).name; config report_name is display-only."""
    app.config["REMOTE_DATA_DIRECTORY"] = str(tmp_path)
    app.config["SERVER_MODE"] = False
    folder_basename = "2026_07_23_12_00_00"
    report_dir = (
        tmp_path
        / "remote.example.com"
        / app.config["PROFILER_DIRECTORY_NAME"]
        / folder_basename
    )
    report_dir.mkdir(parents=True)
    (report_dir / "db.sqlite").write_text("x")

    with patch("ttnn_visualizer.views.update_instance") as update_instance:
        response = client.post(
            "/api/remote/use",
            json={
                "connection": _remote_connection_payload(),
                "profiler": {
                    "reportName": "pretty-display-name",
                    "remotePath": f"/remote/profiler/reports/{folder_basename}",
                    "lastModified": 1,
                },
            },
        )

    assert response.status_code == HTTPStatus.OK
    update_instance.assert_called_once()
    assert update_instance.call_args.kwargs["profiler_name"] == folder_basename


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


def test_remote_use_ok_when_performance_synced_without_tracy(app, client, tmp_path):
    """TT-Metal may omit tracy_profile_log_host.tracy; mount must still succeed."""
    app.config["REMOTE_DATA_DIRECTORY"] = str(tmp_path)
    app.config["SERVER_MODE"] = False
    report_dir = (
        tmp_path
        / "remote.example.com"
        / app.config["PERFORMANCE_DIRECTORY_NAME"]
        / "2026_07_23_19_22_39"
    )
    _write_valid_performance_report(report_dir, with_tracy=False)

    with patch("ttnn_visualizer.views.update_instance") as update_instance:
        response = client.post(
            "/api/remote/use",
            json={
                "connection": _remote_connection_payload(),
                "performance": {
                    "reportName": "2026_07_23_19_22_39",
                    "remotePath": "/remote/performance/reports/2026_07_23_19_22_39",
                    "lastModified": 1,
                },
            },
        )

    assert response.status_code == HTTPStatus.OK
    update_instance.assert_called_once()


def test_remote_use_sanitises_traversal_in_remote_path(app, client, tmp_path):
    """Traversal in remotePath must not escape the connection's report base."""
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
                    "reportName": "bert",
                    "remotePath": "/remote/performance/reports/../../other-host/performance-reports/victim",
                    "lastModified": 1,
                },
            },
        )

    # Collapses to segment "victim" under remote.example.com — not the other host.
    assert response.status_code == HTTPStatus.NOT_FOUND
    assert "not synced locally" in response.get_json()["error"]
    update_instance.assert_not_called()


def test_remote_use_rejects_dotdot_remote_path_segment(app, client, tmp_path):
    app.config["REMOTE_DATA_DIRECTORY"] = str(tmp_path)
    app.config["SERVER_MODE"] = False

    response = client.post(
        "/api/remote/use",
        json={
            "connection": _remote_connection_payload(),
            "performance": {
                "reportName": "bert",
                "remotePath": "/remote/performance/reports/..",
                "lastModified": 1,
            },
        },
    )

    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert "Invalid report name" in response.get_json()["error"]


def test_remote_use_forbidden_when_server_mode(app, client):
    """Mounting a locally synced remote report is @local_only under SERVER_MODE."""
    assert app.config["SERVER_MODE"] is True

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

    assert response.status_code == HTTPStatus.FORBIDDEN


def test_remote_profiler_reports_forbidden_when_server_mode(app, client):
    assert app.config["SERVER_MODE"] is True

    response = client.post(
        "/api/remote/profiler-reports", json=_remote_connection_payload()
    )

    assert response.status_code == HTTPStatus.FORBIDDEN


def test_remote_performance_reports_forbidden_when_server_mode(app, client):
    assert app.config["SERVER_MODE"] is True

    response = client.post(
        "/api/remote/performance-reports", json=_remote_connection_payload()
    )

    assert response.status_code == HTTPStatus.FORBIDDEN


def test_remote_test_forbidden_when_server_mode(app, client):
    assert app.config["SERVER_MODE"] is True

    response = client.post("/api/remote/test", json=_remote_connection_payload())

    assert response.status_code == HTTPStatus.FORBIDDEN


def test_remote_sync_forbidden_when_server_mode(app, client):
    assert app.config["SERVER_MODE"] is True

    response = client.post(
        "/api/remote/sync",
        json={
            "connection": _remote_connection_payload(),
            "profiler": {
                "reportName": "resnet50",
                "remotePath": "/remote/profiler/reports/resnet50",
                "lastModified": 1,
            },
        },
    )

    assert response.status_code == HTTPStatus.FORBIDDEN
