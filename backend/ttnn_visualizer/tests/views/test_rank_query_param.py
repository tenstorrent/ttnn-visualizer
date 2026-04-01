# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""
API tests for optional ``?rank=`` filtering on multi-host report databases.
"""

import sqlite3
import tempfile
from http import HTTPStatus
from pathlib import Path

from ttnn_visualizer.extensions import db
from ttnn_visualizer.models import InstanceTable

INSTANCE_ID = "pytest-rank-filter"
LEGACY_INSTANCE_ID = "pytest-legacy-no-rank"

# Pre-rank schema (no ``rank`` columns) — same shape as historical profiler DBs.
_LEGACY_REPORT_SQL = """
CREATE TABLE devices (
    device_id int,
    num_y_cores int,
    num_x_cores int,
    num_y_compute_cores int,
    num_x_compute_cores int,
    worker_l1_size int,
    l1_num_banks int,
    l1_bank_size int,
    address_at_first_l1_bank int,
    address_at_first_l1_cb_buffer int,
    num_banks_per_storage_core int,
    num_compute_cores int,
    total_l1_memory int,
    total_l1_for_tensors int,
    total_l1_for_interleaved_buffers int,
    total_l1_for_sharded_buffers int,
    cb_limit int
);
CREATE TABLE captured_graph (operation_id int, captured_graph text);
CREATE TABLE buffers (
    operation_id int,
    device_id int,
    address int,
    max_size_per_bank int,
    buffer_type int
);
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
CREATE TABLE operation_arguments (
    operation_id int,
    name text,
    value text
);
CREATE TABLE stack_traces (operation_id int, stack_trace text);
CREATE TABLE input_tensors (
    operation_id int,
    input_index int,
    tensor_id int
);
CREATE TABLE output_tensors (
    operation_id int,
    output_index int,
    tensor_id int
);
CREATE TABLE operations (operation_id int UNIQUE, name text, duration float);
CREATE TABLE buffer_pages (
    operation_id INT,
    device_id INT,
    address INT,
    core_y INT,
    core_x INT,
    bank_id INT,
    page_index INT,
    page_address INT,
    page_size INT,
    buffer_type INT
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
INSERT INTO operations VALUES (1, 'legacy_op', 0.5);
INSERT INTO tensors VALUES (1, '(1,)', 'float32', 'TILE', '{}', 0, 100, 0);
INSERT INTO output_tensors VALUES (1, 0, 1);
INSERT INTO buffers VALUES (1, 0, 100, 4096, 0);
INSERT INTO devices VALUES
(0, 4, 4, 2, 2, 1024, 4, 256, 0, 0, 1, 2, 4096, 2048, 2048, 2048, 256);
"""

# Minimal schema with rank on all tables the list/detail endpoints touch.
_RANKED_REPORT_SQL = """
CREATE TABLE operations (
    operation_id int UNIQUE,
    name text,
    duration float,
    rank int NOT NULL DEFAULT 0
);
INSERT INTO operations VALUES (1, 'op_r0', 1.0, 0), (2, 'op_r1', 2.0, 1);

CREATE TABLE operation_arguments (
    operation_id int,
    name text,
    value text,
    rank int NOT NULL DEFAULT 0
);

CREATE TABLE stack_traces (
    operation_id int,
    stack_trace text,
    rank int NOT NULL DEFAULT 0
);

CREATE TABLE input_tensors (
    operation_id int,
    input_index int,
    tensor_id int,
    rank int NOT NULL DEFAULT 0
);

CREATE TABLE output_tensors (
    operation_id int,
    output_index int,
    tensor_id int,
    rank int NOT NULL DEFAULT 0
);
INSERT INTO output_tensors VALUES (1, 0, 100, 0), (2, 0, 200, 1);

CREATE TABLE tensors (
    tensor_id int,
    shape text,
    dtype text,
    layout text,
    memory_config text,
    device_id int,
    address int,
    buffer_type int,
    rank int NOT NULL DEFAULT 0,
    size int,
    UNIQUE(tensor_id, rank)
);
INSERT INTO tensors VALUES
(100, '(1,)', 'float32', 'TILE', '{}', 0, 0, 0, 0, 4096),
(200, '(2,)', 'float32', 'TILE', '{}', 0, 0, 0, 1, 8192);

CREATE TABLE devices (
    device_id int,
    num_y_cores int,
    num_x_cores int,
    num_y_compute_cores int,
    num_x_compute_cores int,
    worker_l1_size int,
    l1_num_banks int,
    l1_bank_size int,
    address_at_first_l1_bank int,
    address_at_first_l1_cb_buffer int,
    num_banks_per_storage_core int,
    num_compute_cores int,
    total_l1_memory int,
    total_l1_for_tensors int,
    total_l1_for_interleaved_buffers int,
    total_l1_for_sharded_buffers int,
    cb_limit int,
    rank int NOT NULL DEFAULT 0
);
INSERT INTO devices VALUES
(0, 4, 4, 2, 2, 1024, 4, 256, 0, 0, 1, 2, 4096, 2048, 2048, 2048, 256, 0),
(1, 4, 4, 2, 2, 1024, 4, 256, 0, 0, 1, 2, 4096, 2048, 2048, 2048, 256, 1);

CREATE TABLE errors (
    operation_id int,
    operation_name text,
    error_type text,
    error_message text,
    stack_trace text,
    timestamp text,
    rank int NOT NULL DEFAULT 0
);
INSERT INTO errors VALUES
(1, 'op_r0', 'TypeError', 'oops', 'trace0', 't0', 0),
(2, 'op_r1', 'ValueError', 'nope', 'trace1', 't1', 1);

CREATE TABLE buffers (
    operation_id int,
    device_id int,
    address int,
    max_size_per_bank int,
    buffer_type int,
    buffer_layout int,
    rank int NOT NULL DEFAULT 0
);
INSERT INTO buffers VALUES (1, 0, 100, 512, 0, 0, 0), (2, 0, 200, 1024, 0, 0, 1);

CREATE TABLE buffer_pages (
    operation_id int,
    device_id int,
    address int,
    core_y int,
    core_x int,
    bank_id int,
    page_index int,
    page_address int,
    page_size int,
    buffer_type int,
    rank int NOT NULL DEFAULT 0
);
INSERT INTO buffer_pages VALUES
(1, 0, 100, 0, 0, 0, 0, 100, 4096, 0, 0),
(2, 0, 200, 0, 0, 0, 0, 200, 4096, 0, 1);

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
"""


def _write_ranked_report_db(path: str) -> None:
    conn = sqlite3.connect(path)
    conn.executescript(_RANKED_REPORT_SQL)
    conn.commit()
    conn.close()


def _write_legacy_report_db(path: str) -> None:
    conn = sqlite3.connect(path)
    conn.executescript(_LEGACY_REPORT_SQL)
    conn.commit()
    conn.close()


def _register_profiler_instance(
    app, sqlite_path: str, instance_id: str = INSTANCE_ID
) -> None:
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


def test_operations_list_without_rank_returns_all_ranks(app, client):
    with tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False) as f:
        path = f.name
    try:
        _write_ranked_report_db(path)
        _register_profiler_instance(app, path)

        response = client.get(
            "/api/operations",
            query_string={"instanceId": INSTANCE_ID},
        )
        assert response.status_code == HTTPStatus.OK
        data = response.get_json()
        assert isinstance(data, list)
        assert len(data) == 2
        names = {op["name"] for op in data}
        assert names == {"op_r0", "op_r1"}
    finally:
        Path(path).unlink(missing_ok=True)


def test_operations_list_rank_filter_limits_operations_and_nested_tensors(app, client):
    with tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False) as f:
        path = f.name
    try:
        _write_ranked_report_db(path)
        _register_profiler_instance(app, path)

        r0 = client.get(
            "/api/operations",
            query_string={"instanceId": INSTANCE_ID, "rank": "0"},
        )
        assert r0.status_code == HTTPStatus.OK
        data0 = r0.get_json()
        assert len(data0) == 1
        assert data0[0]["name"] == "op_r0"
        assert data0[0]["rank"] == 0
        assert len(data0[0]["outputs"]) == 1
        assert data0[0]["outputs"][0]["id"] == 100
        assert data0[0]["outputs"][0]["rank"] == 0

        r1 = client.get(
            "/api/operations",
            query_string={"instanceId": INSTANCE_ID, "rank": "1"},
        )
        assert r1.status_code == HTTPStatus.OK
        data1 = r1.get_json()
        assert len(data1) == 1
        assert data1[0]["name"] == "op_r1"
        assert data1[0]["outputs"][0]["id"] == 200
        assert data1[0]["outputs"][0]["rank"] == 1
    finally:
        Path(path).unlink(missing_ok=True)


def test_tensors_list_rank_filter(app, client):
    with tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False) as f:
        path = f.name
    try:
        _write_ranked_report_db(path)
        _register_profiler_instance(app, path)

        r0 = client.get(
            "/api/tensors",
            query_string={"instanceId": INSTANCE_ID, "rank": "0"},
        )
        assert r0.status_code == HTTPStatus.OK
        t0 = r0.get_json()
        assert len(t0) == 1
        assert t0[0]["id"] == 100
        assert t0[0]["rank"] == 0

        r1 = client.get(
            "/api/tensors",
            query_string={"instanceId": INSTANCE_ID, "rank": "1"},
        )
        assert r1.status_code == HTTPStatus.OK
        t1 = r1.get_json()
        assert len(t1) == 1
        assert t1[0]["id"] == 200
        assert t1[0]["rank"] == 1
    finally:
        Path(path).unlink(missing_ok=True)


def test_tensor_detail_rank_filter(app, client):
    with tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False) as f:
        path = f.name
    try:
        _write_ranked_report_db(path)
        _register_profiler_instance(app, path)

        ok = client.get(
            "/api/tensors/100",
            query_string={"instanceId": INSTANCE_ID, "rank": "0"},
        )
        assert ok.status_code == HTTPStatus.OK
        assert ok.get_json()["tensor_id"] == 100
        assert ok.get_json()["rank"] == 0

        missing = client.get(
            "/api/tensors/100",
            query_string={"instanceId": INSTANCE_ID, "rank": "1"},
        )
        assert missing.status_code == HTTPStatus.NOT_FOUND
    finally:
        Path(path).unlink(missing_ok=True)


def test_devices_list_rank_filter(app, client):
    with tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False) as f:
        path = f.name
    try:
        _write_ranked_report_db(path)
        _register_profiler_instance(app, path)

        r0 = client.get(
            "/api/devices",
            query_string={"instanceId": INSTANCE_ID, "rank": "0"},
        )
        assert r0.status_code == HTTPStatus.OK
        d0 = r0.get_json()
        assert len(d0) == 1
        assert d0[0]["device_id"] == 0
        assert d0[0]["rank"] == 0

        r1 = client.get(
            "/api/devices",
            query_string={"instanceId": INSTANCE_ID, "rank": "1"},
        )
        assert r1.status_code == HTTPStatus.OK
        d1 = r1.get_json()
        assert len(d1) == 1
        assert d1[0]["device_id"] == 1
        assert d1[0]["rank"] == 1
    finally:
        Path(path).unlink(missing_ok=True)


def test_errors_list_rank_filter(app, client):
    with tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False) as f:
        path = f.name
    try:
        _write_ranked_report_db(path)
        _register_profiler_instance(app, path)

        r0 = client.get(
            "/api/errors",
            query_string={"instanceId": INSTANCE_ID, "rank": "0"},
        )
        assert r0.status_code == HTTPStatus.OK
        e0 = r0.get_json()
        assert len(e0) == 1
        assert e0[0]["operation_id"] == 1
        assert e0[0]["error_message"] == "oops"
        assert e0[0]["rank"] == 0
    finally:
        Path(path).unlink(missing_ok=True)


def test_buffers_list_rank_filter(app, client):
    with tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False) as f:
        path = f.name
    try:
        _write_ranked_report_db(path)
        _register_profiler_instance(app, path)

        r0 = client.get(
            "/api/buffers",
            query_string={"instanceId": INSTANCE_ID, "rank": "0"},
        )
        assert r0.status_code == HTTPStatus.OK
        b0 = r0.get_json()
        assert len(b0) == 1
        assert b0[0]["address"] == 100
        assert b0[0]["rank"] == 0

        r1 = client.get(
            "/api/buffers",
            query_string={"instanceId": INSTANCE_ID, "rank": "1"},
        )
        assert r1.status_code == HTTPStatus.OK
        b1 = r1.get_json()
        assert len(b1) == 1
        assert b1[0]["address"] == 200
        assert b1[0]["rank"] == 1
    finally:
        Path(path).unlink(missing_ok=True)


def test_operation_detail_rank_mismatch_returns_404(app, client):
    with tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False) as f:
        path = f.name
    try:
        _write_ranked_report_db(path)
        _register_profiler_instance(app, path)

        bad = client.get(
            "/api/operations/1",
            query_string={"instanceId": INSTANCE_ID, "rank": "1"},
        )
        assert bad.status_code == HTTPStatus.NOT_FOUND

        good = client.get(
            "/api/operations/1",
            query_string={"instanceId": INSTANCE_ID, "rank": "0"},
        )
        assert good.status_code == HTTPStatus.OK
        body = good.get_json()
        assert body["name"] == "op_r0"
        assert body["rank"] == 0
        assert len(body["outputs"]) == 1
        assert body["outputs"][0]["id"] == 100
    finally:
        Path(path).unlink(missing_ok=True)


def test_invalid_rank_query_returns_400(app, client):
    with tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False) as f:
        path = f.name
    try:
        _write_ranked_report_db(path)
        _register_profiler_instance(app, path)

        response = client.get(
            "/api/tensors",
            query_string={"instanceId": INSTANCE_ID, "rank": "not-an-int"},
        )
        assert response.status_code == HTTPStatus.BAD_REQUEST
    finally:
        Path(path).unlink(missing_ok=True)


def test_nonzero_rank_on_legacy_db_returns_422(app, client):
    """Unranked DB cannot satisfy rank > 0; do not return all rows as rank 0."""
    with tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False) as f:
        path = f.name
    try:
        _write_legacy_report_db(path)
        _register_profiler_instance(app, path, instance_id=LEGACY_INSTANCE_ID)

        response = client.get(
            "/api/operations",
            query_string={"instanceId": LEGACY_INSTANCE_ID, "rank": "1"},
        )
        assert response.status_code == HTTPStatus.UNPROCESSABLE_ENTITY
        err = response.get_json()
        assert err is not None
        assert "error" in err
        assert "per-rank" in err["error"].lower()
    finally:
        Path(path).unlink(missing_ok=True)


def test_rank_zero_explicit_allowed_on_legacy_db(app, client):
    """Explicit rank=0 (or omitting rank) still returns legacy data."""
    with tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False) as f:
        path = f.name
    try:
        _write_legacy_report_db(path)
        _register_profiler_instance(app, path, instance_id=LEGACY_INSTANCE_ID)

        r0 = client.get(
            "/api/operations",
            query_string={"instanceId": LEGACY_INSTANCE_ID, "rank": "0"},
        )
        assert r0.status_code == HTTPStatus.OK
        data0 = r0.get_json()
        assert len(data0) == 1
        assert data0[0]["name"] == "legacy_op"
        assert data0[0]["rank"] == 0

        r_none = client.get(
            "/api/operations",
            query_string={"instanceId": LEGACY_INSTANCE_ID},
        )
        assert r_none.status_code == HTTPStatus.OK
        assert len(r_none.get_json()) == 1
    finally:
        Path(path).unlink(missing_ok=True)
