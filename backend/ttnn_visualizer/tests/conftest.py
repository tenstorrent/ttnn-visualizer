# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""
Pytest fixtures for API tests.
"""

import shutil
import sqlite3
import tempfile
from pathlib import Path

import pytest
from ttnn_visualizer.app import create_app
from ttnn_visualizer.extensions import db
from ttnn_visualizer.models import InstanceTable


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


@pytest.fixture
def make_report(app):
    """Fixture that creates a temporary SQLite report database.

    Yields an inner function::

        instance_id = make_report(schema_sql, inserts_sql="")

    *schema_sql* should contain the ``CREATE TABLE`` statements for the schema
    version under test.  *inserts_sql* is an optional second script with the
    ``INSERT`` statements for that test's data.  The two scripts are executed
    separately so that schema constants can be reused across tests while only
    the data varies.

    The inner function registers the database as a profiler instance and
    returns the ``instance_id`` string to pass as ``?instanceId=`` in API
    requests.  All temporary files are removed automatically after the test.
    """
    paths = []
    counter = [0]

    def _make(schema_sql, inserts_sql=""):
        counter[0] += 1
        instance_id = f"pytest-make-report-{counter[0]}"

        with tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False) as f:
            path = f.name
        paths.append(path)

        conn = sqlite3.connect(path)
        conn.executescript(schema_sql)
        if inserts_sql:
            conn.executescript(inserts_sql)
        conn.commit()
        conn.close()

        with app.app_context():
            existing = InstanceTable.query.filter_by(instance_id=instance_id).first()
            if existing:
                db.session.delete(existing)
                db.session.commit()
            db.session.add(
                InstanceTable(
                    instance_id=instance_id,
                    active_report={},
                    profiler_path=path,
                )
            )
            db.session.commit()

        return instance_id

    yield _make

    for path in paths:
        Path(path).unlink(missing_ok=True)
