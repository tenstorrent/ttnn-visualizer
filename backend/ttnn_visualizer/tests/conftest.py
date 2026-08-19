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
from ttnn_visualizer import usage
from ttnn_visualizer.app import create_app
from ttnn_visualizer.extensions import db
from ttnn_visualizer.models import InstanceTable
from ttnn_visualizer.tests.fixture_settings import base_test_settings
from ttnn_visualizer.tests.report_schemas import SCHEMA_V2
from ttnn_visualizer.usage import (
    _RETIRED_RECORDING_ENV_VAR,
    LOG_SIZE_CHECK_INTERVAL_BYTES,
    RUN_ID_ENV_VAR,
    USAGE_DISABLED_ENV_VAR,
)


@pytest.fixture
def app():
    """Create a Flask app with test config and an isolated app SQLite file.

    Uses a file-backed database (not ``:memory:``) so Alembic's migration
    connection and the app's pool see the same on-disk database. The settings, and why
    several are pinned rather than inherited from the environment, live in
    :func:`ttnn_visualizer.tests.fixture_settings.base_test_settings`.
    """
    tmpdir = tempfile.mkdtemp()
    try:
        app = create_app(settings_override=base_test_settings(tmpdir))
        yield app
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


@pytest.fixture
def client(app):
    """Flask test client for API requests (GET, POST, etc.)."""
    return app.test_client()


@pytest.fixture
def usage_directory(tmp_path, monkeypatch):
    """Redirect the usage log into a temporary directory and reset per-process state.

    Shared rather than module-local because both the writer's own tests and the ingest
    endpoint's need it, and the consequence of a test forgetting it is not a failure but
    an append to the developer's real ``~/.ttnn-visualizer/usage``.
    """
    directory = tmp_path / "usage"
    monkeypatch.setattr(usage, "USAGE_DIRECTORY", directory)
    monkeypatch.setattr(usage, "_run_id", None)
    # Primed rather than zeroed, so the first append of every test performs the size
    # check instead of inheriting a fresh interval from whichever test ran before.
    monkeypatch.setattr(usage, "_bytes_since_size_check", LOG_SIZE_CHECK_INTERVAL_BYTES)
    # Both latches are sticky by design, so a test that trips one would otherwise leave
    # the next test with a full log or with its first warning already spent.
    monkeypatch.setattr(usage, "_log_full", False)
    monkeypatch.setattr(usage, "_write_failure_logged", False)
    # Keyed on the path, so a fresh `tmp_path` invalidates it anyway — reset regardless,
    # since relying on that couples every test to the fixture's choice of directory.
    monkeypatch.setattr(usage, "_ensured_directory", None)
    # Sticky by design too, so a test that trips a warn-once would otherwise leave the
    # next one with that warning already spent.
    monkeypatch.setattr(usage, "_warned_env_vars", set())
    monkeypatch.delenv(RUN_ID_ENV_VAR, raising=False)
    monkeypatch.delenv(USAGE_DISABLED_ENV_VAR, raising=False)
    # The retired name is no longer read, but a developer who still exports it would
    # otherwise get the deprecation warning on every test that records.
    monkeypatch.delenv(_RETIRED_RECORDING_ENV_VAR, raising=False)

    return directory


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
    returns the ``instance_id`` string to pass as the ``instanceId`` query parameter
    in API requests (e.g. ``query_string={"instanceId": instance_id}``).  All
    temporary files are removed automatically after the test.
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
