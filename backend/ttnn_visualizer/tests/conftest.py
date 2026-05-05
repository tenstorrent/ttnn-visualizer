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
from ttnn_visualizer.tests.report_schemas import SCHEMA_V2


@pytest.fixture
def app():
    """Create a Flask app with test config and in-memory instance store."""
    tmpdir = tempfile.mkdtemp()
    try:
        settings = {
            "TESTING": True,
            "SQLALCHEMY_DATABASE_URI": "sqlite:///:memory:",
            "SERVER_MODE": True,
            "USE_WEBSOCKETS": True,
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

        instance_id = make_report(inserts_sql="", schema_sql=SCHEMA_V2)

    *inserts_sql* is an optional script with the ``INSERT`` statements for
    that test's data.  *schema_sql* defaults to ``SCHEMA_V2`` (the current
    baseline schema) and can be overridden to test backwards compatibility with
    older schema versions.  Both arguments are optional so a bare
    ``make_report()`` call produces an empty database with the default schema.

    The inner function registers the database as a profiler instance and
    returns the ``instance_id`` string to pass as ``?instanceId=`` in API
    requests.  All temporary files are removed automatically after the test.
    """
    paths = []
    counter = [0]

    def _make(inserts_sql="", schema_sql=SCHEMA_V2):
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
