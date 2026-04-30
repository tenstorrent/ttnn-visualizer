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


def test_remote_profiler_returns_204_when_no_reports(client):
    with patch("ttnn_visualizer.views.get_remote_profiler_folders", return_value=[]):
        response = client.post(
            "/api/remote/profiler", json=_remote_connection_payload()
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

    with (
        patch(
            "ttnn_visualizer.views.get_remote_profiler_folders", return_value=folders
        ),
        patch("ttnn_visualizer.views.read_last_synced_file", return_value=123),
    ):
        response = client.post(
            "/api/remote/profiler", json=_remote_connection_payload()
        )

    assert response.status_code == HTTPStatus.OK
    data = response.get_json()
    assert isinstance(data, list)
    assert len(data) == 1
    assert data[0]["reportName"] == "resnet50"
    assert data[0]["remotePath"] == "/remote/profiler/reports/resnet50"
    assert data[0]["lastModified"] == 100
    assert data[0]["lastSynced"] == 123


def test_remote_performance_returns_204_when_no_reports(client):
    with patch("ttnn_visualizer.views.get_remote_performance_folders", return_value=[]):
        response = client.post(
            "/api/remote/performance", json=_remote_connection_payload()
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

    with (
        patch(
            "ttnn_visualizer.views.get_remote_performance_folders", return_value=folders
        ),
        patch("ttnn_visualizer.views.read_last_synced_file", return_value=456),
    ):
        response = client.post(
            "/api/remote/performance", json=_remote_connection_payload()
        )

    assert response.status_code == HTTPStatus.OK
    data = response.get_json()
    assert isinstance(data, list)
    assert len(data) == 1
    assert data[0]["reportName"] == "bert"
    assert data[0]["remotePath"] == "/remote/performance/reports/bert"
    assert data[0]["lastModified"] == 200
    assert data[0]["lastSynced"] == 456
