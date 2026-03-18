# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""
Pytest fixtures for API tests.
"""

import shutil
import tempfile
from pathlib import Path

import pytest
from ttnn_visualizer.app import create_app
from ttnn_visualizer.extensions import db


@pytest.fixture
def app():
    """Create a Flask app with test config and in-memory instance store."""
    tmpdir = tempfile.mkdtemp()
    try:
        settings = {
            "TESTING": True,
            "SQLALCHEMY_DATABASE_URI": "sqlite:///:memory:",
            "SERVER_MODE": True,
            "APP_DATA_DIRECTORY": tmpdir,
            "REPORT_DATA_DIRECTORY": tmpdir,
            "LOCAL_DATA_DIRECTORY": str(Path(tmpdir) / "local"),
            "REMOTE_DATA_DIRECTORY": str(Path(tmpdir) / "remote"),
        }
        app = create_app(settings_override=settings)
        with app.app_context():
            db.create_all()
        yield app
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


@pytest.fixture
def client(app):
    """Flask test client for API requests (GET, POST, etc.)."""
    return app.test_client()
