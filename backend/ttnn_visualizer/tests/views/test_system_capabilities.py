# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

from unittest.mock import patch


def test_capabilities_include_os_processor_remote_sync_methods(client):
    with patch("ttnn_visualizer.views.shutil") as mock_shutil:
        mock_shutil.which.side_effect = lambda cmd: (
            "/usr/bin/sftp" if cmd == "sftp" else None
        )
        response = client.get("/api/system-capabilities")
    assert response.status_code == 200
    data = response.get_json()
    assert "os" in data
    assert "processor" in data
    assert "remote_sync_methods" in data
    assert "sftp" in data["remote_sync_methods"]
    assert "rsync" in data["remote_sync_methods"]
    assert data["remote_sync_methods"]["sftp"] is True
    assert data["remote_sync_methods"]["rsync"] is False


def test_remote_sync_methods_false_when_binaries_missing(client):
    with patch("ttnn_visualizer.views.shutil") as mock_shutil:
        mock_shutil.which.return_value = None
        response = client.get("/api/system-capabilities")
    assert response.status_code == 200
    data = response.get_json()
    assert data["remote_sync_methods"]["sftp"] is False
    assert data["remote_sync_methods"]["rsync"] is False


def test_remote_sync_methods_sftp_true_when_which_returns_path(client):
    with patch("ttnn_visualizer.views.shutil") as mock_shutil:
        mock_shutil.which.side_effect = lambda cmd: (
            "/usr/bin/sftp" if cmd == "sftp" else None
        )
        response = client.get("/api/system-capabilities")
    assert response.status_code == 200
    data = response.get_json()
    assert data["remote_sync_methods"]["sftp"] is True
    assert data["remote_sync_methods"]["rsync"] is False


def test_remote_sync_methods_rsync_true_when_which_returns_path(client):
    with patch("ttnn_visualizer.views.shutil") as mock_shutil:
        mock_shutil.which.side_effect = lambda cmd: (
            "/usr/bin/rsync" if cmd == "rsync" else None
        )
        response = client.get("/api/system-capabilities")
    assert response.status_code == 200
    data = response.get_json()
    assert data["remote_sync_methods"]["sftp"] is False
    assert data["remote_sync_methods"]["rsync"] is True


def test_system_capabilities_response_shape(client):
    with patch("ttnn_visualizer.views.shutil") as mock_shutil:
        mock_shutil.which.return_value = None
        response = client.get("/api/system-capabilities")
    assert response.status_code == 200
    assert "remote_sync_methods" in response.get_json()


def test_health_endpoint(client):
    assert client.get("/api/up").status_code == 200
    assert client.head("/api/up").status_code == 200
