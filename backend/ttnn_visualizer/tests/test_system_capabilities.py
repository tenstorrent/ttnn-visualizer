# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

from unittest.mock import patch

from flask import Flask
from ttnn_visualizer.views import _get_system_capabilities


def test_capabilities_include_os_processor_remote_sync_methods():
    """GET /api/system_capabilities returns os, processor, and remote_sync_methods."""
    app = Flask(__name__)
    with app.app_context():
        with patch("ttnn_visualizer.views.shutil") as mock_shutil:
            mock_shutil.which.side_effect = lambda cmd: (
                "/usr/bin/sftp" if cmd == "sftp" else None
            )
            caps = _get_system_capabilities()
    assert "os" in caps
    assert "processor" in caps
    assert "remote_sync_methods" in caps
    assert "sftp" in caps["remote_sync_methods"]
    assert "rsync" in caps["remote_sync_methods"]


def test_remote_sync_methods_false_when_binaries_missing():
    """sftp and rsync are false when which returns None for both."""
    app = Flask(__name__)
    with app.app_context():
        with patch("ttnn_visualizer.views.shutil") as mock_shutil:
            mock_shutil.which.return_value = None
            caps = _get_system_capabilities()
    assert caps["remote_sync_methods"]["sftp"] is False
    assert caps["remote_sync_methods"]["rsync"] is False


def test_remote_sync_methods_sftp_true_when_which_returns_path():
    """sftp is true when sftp binary is on PATH."""
    app = Flask(__name__)
    with app.app_context():
        with patch("ttnn_visualizer.views.shutil") as mock_shutil:
            mock_shutil.which.side_effect = lambda cmd: (
                "/usr/bin/sftp" if cmd == "sftp" else None
            )
            caps = _get_system_capabilities()
    assert caps["remote_sync_methods"]["sftp"] is True
    assert caps["remote_sync_methods"]["rsync"] is False


def test_remote_sync_methods_rsync_true_when_which_returns_path():
    """rsync is true when rsync binary is on PATH."""
    app = Flask(__name__)
    with app.app_context():
        with patch("ttnn_visualizer.views.shutil") as mock_shutil:
            mock_shutil.which.side_effect = lambda cmd: (
                "/usr/bin/rsync" if cmd == "rsync" else None
            )
            caps = _get_system_capabilities()
    assert caps["remote_sync_methods"]["sftp"] is False
    assert caps["remote_sync_methods"]["rsync"] is True
