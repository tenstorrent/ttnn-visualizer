# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""
API tests for tensor endpoints, including optional tensor_lifetime support.
"""

import sqlite3
import tempfile
from http import HTTPStatus
from pathlib import Path

import pytest
from ttnn_visualizer.extensions import db
from ttnn_visualizer.models import InstanceTable

INSTANCE_ID = "pytest-tensors"

# Schema without tensor_lifetime — simulates older report databases.
_LEGACY_SCHEMA_SQL = """
CREATE TABLE operations (operation_id int UNIQUE, name text, duration float);
CREATE TABLE tensors (
    tensor_id int UNIQUE,
    shape text,
    dtype text,
    layout text,
    memory_config text,
    device_id int,
    address int,
    buffer_type int
);
CREATE TABLE input_tensors (operation_id int, input_index int, tensor_id int);
CREATE TABLE output_tensors (operation_id int, output_index int, tensor_id int);
CREATE TABLE buffers (
    operation_id int,
    device_id int,
    address int,
    max_size_per_bank int,
    buffer_type int
);
CREATE TABLE local_tensor_comparison_records (
    tensor_id int,
    golden_tensor_id int,
    matches int,
    desired_pcc float,
    actual_pcc float
);
CREATE TABLE global_tensor_comparison_records (
    tensor_id int,
    golden_tensor_id int,
    matches int,
    desired_pcc float,
    actual_pcc float
);
INSERT INTO operations VALUES (1, 'op_a', 1.0);
INSERT INTO tensors VALUES (10, '(2, 4)', 'bfloat16', 'TILE', '{}', 0, 200, 0);
INSERT INTO tensors VALUES (20, '(1,)', 'float32', 'ROW_MAJOR', '{}', 0, 300, 0);
INSERT INTO output_tensors VALUES (1, 0, 10);
INSERT INTO input_tensors VALUES (1, 0, 20);
INSERT INTO buffers VALUES (1, 0, 200, 512, 0);
INSERT INTO buffers VALUES (1, 0, 300, 256, 0);
"""

# Schema with tensor_lifetime, all fields populated for tensor 10.
_LIFETIME_SCHEMA_SQL = (
    _LEGACY_SCHEMA_SQL
    + """
CREATE TABLE tensor_lifetime (
    tensor_id int UNIQUE,
    producer_operation_id int,
    last_use_operation_id int,
    deallocate_operation_id int,
    producer_source_file text,
    producer_source_line int,
    last_use_source_file text,
    last_use_source_line int
);
INSERT INTO tensor_lifetime VALUES (
    10,
    1,
    3,
    5,
    'model.py',
    42,
    'train.py',
    99
);
"""
)

# Schema with tensor_lifetime, but some fields are NULL for tensor 20.
_PARTIAL_LIFETIME_SQL = (
    _LEGACY_SCHEMA_SQL
    + """
CREATE TABLE tensor_lifetime (
    tensor_id int UNIQUE,
    producer_operation_id int,
    last_use_operation_id int,
    deallocate_operation_id int,
    producer_source_file text,
    producer_source_line int,
    last_use_source_file text,
    last_use_source_line int
);
INSERT INTO tensor_lifetime VALUES (20, 1, NULL, NULL, NULL, NULL, NULL, NULL);
"""
)


def _write_db(path: str, sql: str) -> None:
    conn = sqlite3.connect(path)
    conn.executescript(sql)
    conn.commit()
    conn.close()


def _register_instance(app, sqlite_path: str, instance_id: str = INSTANCE_ID) -> None:
    with app.app_context():
        existing = InstanceTable.query.filter_by(instance_id=instance_id).first()
        if existing:
            db.session.delete(existing)
            db.session.commit()
        row = InstanceTable(
            instance_id=instance_id,
            active_report={},
            profiler_path=sqlite_path,
        )
        db.session.add(row)
        db.session.commit()


# ---------------------------------------------------------------------------
# /api/tensors — list endpoint
# ---------------------------------------------------------------------------


def test_tensors_list_no_lifetime_table_returns_null_lifetime(app, client):
    """Older databases without tensor_lifetime should return lifetime: null."""
    with tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False) as f:
        path = f.name
    try:
        _write_db(path, _LEGACY_SCHEMA_SQL)
        _register_instance(app, path)

        response = client.get("/api/tensors", query_string={"instanceId": INSTANCE_ID})
        assert response.status_code == HTTPStatus.OK

        data = response.get_json()
        assert isinstance(data, list)
        assert len(data) == 2

        for tensor in data:
            assert "lifetime" in tensor
            assert tensor["lifetime"] is None
    finally:
        Path(path).unlink(missing_ok=True)


def test_tensors_list_with_full_lifetime(app, client):
    """Tensors with a tensor_lifetime row should include a populated lifetime object."""
    with tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False) as f:
        path = f.name
    try:
        _write_db(path, _LIFETIME_SCHEMA_SQL)
        _register_instance(app, path)

        response = client.get("/api/tensors", query_string={"instanceId": INSTANCE_ID})
        assert response.status_code == HTTPStatus.OK

        data = response.get_json()
        tensor_map = {t["id"]: t for t in data}

        # Tensor 10 has a full lifetime row.
        t10 = tensor_map[10]
        assert t10["lifetime"] is not None
        assert t10["lifetime"]["producer_operation_id"] == 1
        assert t10["lifetime"]["last_use_operation_id"] == 3
        assert t10["lifetime"]["deallocate_operation_id"] == 5
        assert t10["lifetime"]["producer_source_file"] == "model.py"
        assert t10["lifetime"]["producer_source_line"] == 42
        assert t10["lifetime"]["last_use_source_file"] == "train.py"
        assert t10["lifetime"]["last_use_source_line"] == 99

        # tensor_id must not appear inside the nested lifetime object.
        assert "tensor_id" not in t10["lifetime"]

        # Tensor 20 has no lifetime row — should still be a dict (table exists)
        # but all values are None.
        t20 = tensor_map[20]
        assert t20["lifetime"] is not None
        assert all(v is None for v in t20["lifetime"].values())
    finally:
        Path(path).unlink(missing_ok=True)


def test_tensors_list_partial_lifetime_fields_are_nullable(app, client):
    """A tensor_lifetime row with some NULL fields is serialised with None values."""
    with tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False) as f:
        path = f.name
    try:
        _write_db(path, _PARTIAL_LIFETIME_SQL)
        _register_instance(app, path)

        response = client.get("/api/tensors", query_string={"instanceId": INSTANCE_ID})
        assert response.status_code == HTTPStatus.OK

        data = response.get_json()
        tensor_map = {t["id"]: t for t in data}

        t20 = tensor_map[20]
        assert t20["lifetime"] is not None
        assert t20["lifetime"]["producer_operation_id"] == 1
        assert t20["lifetime"]["last_use_operation_id"] is None
        assert t20["lifetime"]["deallocate_operation_id"] is None
        assert t20["lifetime"]["producer_source_file"] is None
        assert t20["lifetime"]["producer_source_line"] is None
        assert t20["lifetime"]["last_use_source_file"] is None
        assert t20["lifetime"]["last_use_source_line"] is None

        # Tensor 10 has no lifetime row at all — all fields should be None.
        t10 = tensor_map[10]
        assert t10["lifetime"] is not None
        assert all(v is None for v in t10["lifetime"].values())
    finally:
        Path(path).unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# /api/tensors/<tensor_id> — detail endpoint
# ---------------------------------------------------------------------------


def test_tensor_detail_no_lifetime_table(app, client):
    """Detail endpoint returns lifetime: null when table is absent."""
    with tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False) as f:
        path = f.name
    try:
        _write_db(path, _LEGACY_SCHEMA_SQL)
        _register_instance(app, path)

        response = client.get(
            "/api/tensors/10", query_string={"instanceId": INSTANCE_ID}
        )
        assert response.status_code == HTTPStatus.OK

        data = response.get_json()
        assert data["tensor_id"] == 10
        assert "lifetime" in data
        assert data["lifetime"] is None
    finally:
        Path(path).unlink(missing_ok=True)


def test_tensor_detail_with_lifetime(app, client):
    """Detail endpoint includes a populated lifetime object when the table exists."""
    with tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False) as f:
        path = f.name
    try:
        _write_db(path, _LIFETIME_SCHEMA_SQL)
        _register_instance(app, path)

        response = client.get(
            "/api/tensors/10", query_string={"instanceId": INSTANCE_ID}
        )
        assert response.status_code == HTTPStatus.OK

        data = response.get_json()
        assert data["tensor_id"] == 10
        lifetime = data["lifetime"]
        assert lifetime is not None
        assert lifetime["producer_operation_id"] == 1
        assert lifetime["last_use_operation_id"] == 3
        assert lifetime["deallocate_operation_id"] == 5
        assert lifetime["producer_source_file"] == "model.py"
        assert lifetime["producer_source_line"] == 42
        assert lifetime["last_use_source_file"] == "train.py"
        assert lifetime["last_use_source_line"] == 99
        assert "tensor_id" not in lifetime
    finally:
        Path(path).unlink(missing_ok=True)


def test_tensor_detail_not_found(app, client):
    """Requesting a non-existent tensor returns 404."""
    with tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False) as f:
        path = f.name
    try:
        _write_db(path, _LEGACY_SCHEMA_SQL)
        _register_instance(app, path)

        response = client.get(
            "/api/tensors/9999", query_string={"instanceId": INSTANCE_ID}
        )
        assert response.status_code == HTTPStatus.NOT_FOUND
    finally:
        Path(path).unlink(missing_ok=True)
