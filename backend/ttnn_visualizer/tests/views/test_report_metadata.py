# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import sqlite3
import tempfile
from pathlib import Path

from ttnn_visualizer.extensions import db
from ttnn_visualizer.models import InstanceTable


def test_report_metadata_returns_422_when_table_missing(app, client):
    """When the report DB has no report_metadata table, return 422 (old DB)."""
    with tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False) as f:
        path = f.name
    try:
        # Minimal DB so path is valid; no report_metadata table
        conn = sqlite3.connect(path)
        conn.execute(
            "CREATE TABLE operations (operation_id int, name text, duration float)"
        )
        conn.commit()
        conn.close()

        with app.app_context():
            instance = InstanceTable(
                instance_id="test-no-metadata",
                active_report={},
                profiler_path=path,
            )
            db.session.add(instance)
            db.session.commit()

        response = client.get(
            "/api/report_metadata",
            query_string={"instanceId": "test-no-metadata"},
        )

        assert response.status_code == 422
        data = response.get_json()
        assert data is not None
        assert "error" in data
        assert "metadata" in data["error"].lower()
        assert "does not exist" in data["error"].lower()
    finally:
        Path(path).unlink(missing_ok=True)


def test_report_metadata_returns_metadata_on_success(app, client):
    """When the report DB has report_metadata table, return 200 and key-value list."""
    with tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False) as f:
        path = f.name
    try:
        conn = sqlite3.connect(path)
        conn.executescript(
            """
            CREATE TABLE report_metadata (key text UNIQUE, value text);
            INSERT INTO report_metadata VALUES ('schema_version', '2');
            INSERT INTO report_metadata VALUES ('capture_timestamp_ns', '1773424287168605099');
            INSERT INTO report_metadata VALUES ('total_duration_ns', '22119664963');
        """
        )
        conn.commit()
        conn.close()

        with app.app_context():
            instance = InstanceTable(
                instance_id="test-with-metadata",
                active_report={},
                profiler_path=path,
            )
            db.session.add(instance)
            db.session.commit()

        response = client.get(
            "/api/report_metadata",
            query_string={"instanceId": "test-with-metadata"},
        )

        assert response.status_code == 200
        data = response.get_json()
        assert isinstance(data, list)
        assert len(data) == 3
        keys = {row["key"] for row in data}
        assert keys == {"schema_version", "capture_timestamp_ns", "total_duration_ns"}
        by_key = {row["key"]: row["value"] for row in data}
        assert by_key["schema_version"] == "2"
        assert by_key["capture_timestamp_ns"] == "1773424287168605099"
        assert by_key["total_duration_ns"] == "22119664963"
    finally:
        Path(path).unlink(missing_ok=True)
