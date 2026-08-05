# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""
API tests for ``?rank=`` filtering on multi-host report databases.
"""

import sqlite3
import tempfile
from http import HTTPStatus
from pathlib import Path
from typing import Any, List

import pytest
from ttnn_visualizer.extensions import db
from ttnn_visualizer.models import InstanceTable
from ttnn_visualizer.queries import DatabaseQueries

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


# Shaped like a real multi-host capture: the writer restarts `operation_id` and
# `tensor_id` at 1 for every rank, so both ranks reuse the SAME ids and only
# `(rank, id)` is unique. `_RANKED_REPORT_SQL` above keeps ids distinct per rank
# because its mismatch tests need an id that exists on one rank only; this
# fixture is the one that reproduces the collision from #1842.
_COLLIDING_RANK_REPORT_SQL = """
CREATE TABLE operations (
    operation_id int,
    name text,
    duration float,
    rank int NOT NULL DEFAULT 0,
    UNIQUE(operation_id, rank)
);
INSERT INTO operations VALUES (1, 'ttnn.to_device', 1.0, 0), (1, 'ttnn.to_device', 2.0, 1);

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
INSERT INTO output_tensors VALUES (1, 0, 1, 0), (1, 0, 1, 1);

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
-- Tensor 1 collides across both ranks; tensor 2 exists on rank 1 only, so it is
-- the probe for whether a rank-0 read reaches another rank's tensors.
INSERT INTO tensors VALUES
(1, '(1,)', 'float32', 'TILE', '{}', 0, 100, 0, 0, 4096),
(1, '(1,)', 'float32', 'TILE', '{}', 0, 100, 0, 1, 4096),
(2, '(2,)', 'float32', 'TILE', '{}', 0, 200, 0, 1, 8192);

CREATE TABLE buffers (
    operation_id int,
    device_id int,
    address int,
    max_size_per_bank int,
    buffer_type int,
    buffer_layout int,
    rank int NOT NULL DEFAULT 0
);
INSERT INTO buffers VALUES (1, 0, 100, 512, 0, 0, 0), (1, 0, 100, 512, 0, 0, 1);

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
(1, 0, 100, 0, 0, 0, 0, 100, 4096, 0, 1);

-- `device_id` is re-normalised to 0-based per rank by the writer, so both ranks
-- report `device 0`. That is exactly why device_id cannot disambiguate a rank.
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
(0, 4, 4, 2, 2, 1024, 4, 256, 0, 0, 1, 2, 4096, 2048, 2048, 2048, 256, 1);

CREATE TABLE errors (
    operation_id int,
    operation_name text,
    error_type text,
    error_message text,
    stack_trace text,
    timestamp text,
    rank int NOT NULL DEFAULT 0
);

-- No `rank` column here, mirroring the real schema: a comparison can only be
-- narrowed through the tensor ids belonging to a rank. Rows exist for tensor 1
-- (both ranks) and tensor 2 (rank 1 only), so a rank-0 read must return the
-- former and never the latter.
CREATE TABLE local_tensor_comparison_records (
    tensor_id int,
    golden_tensor_id int,
    matches int,
    desired_pcc float,
    actual_pcc float
);
INSERT INTO local_tensor_comparison_records VALUES (1, 900, 1, 0.99, 0.995), (2, 901, 0, 0.99, 0.5);
CREATE TABLE global_tensor_comparison_records (
    tensor_id int,
    golden_tensor_id int,
    matches int,
    desired_pcc float,
    actual_pcc float
);
INSERT INTO global_tensor_comparison_records VALUES (1, 800, 1, 0.98, 0.985), (2, 801, 0, 0.98, 0.4);
"""


def _write_ranked_report_db(path: str) -> None:
    conn = sqlite3.connect(path)
    conn.executescript(_RANKED_REPORT_SQL)
    conn.commit()
    conn.close()


def _write_colliding_rank_report_db(path: str) -> None:
    conn = sqlite3.connect(path)
    conn.executescript(_COLLIDING_RANK_REPORT_SQL)
    conn.commit()
    conn.close()


def _write_wide_ranked_report_db(path: str, *, tensor_count: int) -> None:
    """Ranked report carrying ``tensor_count`` rank-0 tensors.

    Sized past SQLite's 32766-variable cap, so a rank scoping that binds one
    parameter per tensor id fails outright rather than merely being slow.
    """
    conn = sqlite3.connect(path)
    conn.executescript(_COLLIDING_RANK_REPORT_SQL)
    conn.executemany(
        "INSERT INTO tensors VALUES (?, '(1,)', 'float32', 'TILE', '{}', 0, ?, 0, 0, 4096)",
        # Tensor 1 already sits at rank 0 in the fixture.
        [(tensor_id, 1000 + tensor_id) for tensor_id in range(2, tensor_count + 1)],
    )
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


def test_operations_list_without_rank_defaults_to_rank_zero(app, client):
    """
    Omitting ``?rank`` must scope to rank 0, not union every rank. The writer
    restarts operation_id/tensor_id at 1 per rank, so a union collides on ids
    and the client renders one row per rank with no way to tell them apart. #1842
    """
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
        assert len(data) == 1
        assert data[0]["name"] == "op_r0"
        assert data[0]["rank"] == 0
    finally:
        Path(path).unlink(missing_ok=True)


def _collect_ranks(payload: Any) -> List[int]:
    """Every ``rank`` value anywhere in a response, however deeply nested."""
    found: List[int] = []
    if isinstance(payload, dict):
        for key, value in payload.items():
            if key == "rank" and isinstance(value, int):
                found.append(value)
            else:
                found.extend(_collect_ranks(value))
    elif isinstance(payload, list):
        for item in payload:
            found.extend(_collect_ranks(item))
    return found


def _assert_scoped_to_rank_zero(payload: Any, path: str) -> None:
    """
    Assert a response carries rank-0 rows only.

    A union would surface rank 1 somewhere in the payload, so this is the
    assertion that can actually fail if a route stops filtering. The
    non-empty check keeps it from passing vacuously on a route whose
    serializer drops the ``rank`` field.
    """
    ranks = _collect_ranks(payload)
    assert ranks, f"{path} serialized no rank field, so scoping is unverifiable"
    assert set(ranks) == {0}, f"{path} leaked non-zero ranks: {sorted(set(ranks))}"


@pytest.mark.parametrize(
    "path,extra_query",
    [
        ("/api/operations", {}),
        ("/api/tensors", {}),
        ("/api/devices", {}),
        ("/api/buffers", {}),
        ("/api/operation-buffers", {}),
        ("/api/errors", {}),
        ("/api/operations/1", {}),
        ("/api/operation-buffers/1", {}),
        ("/api/tensors/100", {}),
        ("/api/buffer-pages", {"operation_id": "1", "address": "100"}),
        # `/api/buffer` is deliberately absent: `query_next_buffer` looks for the
        # address in a *later* operation, so it 404s on a one-operation-per-rank
        # fixture for reasons unrelated to rank. Its rank handling is covered by
        # `test_legacy_nonzero_rank_returns_422_not_rank_zero_payload`.
    ],
)
def test_omitted_rank_is_equivalent_to_explicit_rank_zero(
    app, client, path, extra_query
):
    """
    The two route families used to disagree on what an absent rank meant:
    file-backed routes defaulted to 0, DB-backed routes returned every rank.
    Pin the unified contract so the asymmetry can't come back. #1842

    Payload equality alone is not enough: two identical unions would satisfy it.
    The rank-0 assertion below is what makes this test able to fail.
    """
    with tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False) as f:
        db_path = f.name
    try:
        _write_ranked_report_db(db_path)
        _register_profiler_instance(app, db_path)

        omitted = client.get(
            path,
            query_string={"instanceId": INSTANCE_ID, **extra_query},
        )
        explicit = client.get(
            path,
            query_string={"instanceId": INSTANCE_ID, "rank": "0", **extra_query},
        )

        assert omitted.status_code == HTTPStatus.OK, f"{path} failed without rank"
        assert explicit.status_code == HTTPStatus.OK, f"{path} failed with rank=0"
        assert (
            omitted.get_json() == explicit.get_json()
        ), f"{path} returns a different payload when rank is omitted"
        _assert_scoped_to_rank_zero(omitted.get_json(), path)
    finally:
        Path(db_path).unlink(missing_ok=True)


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


@pytest.mark.parametrize(
    "rank,reason",
    [
        ("not-an-int", "not an integer"),
        # `int()` is arbitrary-precision: unbounded, this reaches SQLite's int64
        # binding and raises OverflowError as an unhandled 500.
        ("99999999999999999999", "beyond SQLite's integer range"),
        ("-1", "negative, which no world size contains"),
    ],
)
def test_invalid_rank_query_returns_400(app, client, rank, reason):
    with tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False) as f:
        path = f.name
    try:
        _write_ranked_report_db(path)
        _register_profiler_instance(app, path)

        response = client.get(
            "/api/tensors",
            query_string={"instanceId": INSTANCE_ID, "rank": rank},
        )
        assert (
            response.status_code == HTTPStatus.BAD_REQUEST
        ), f"rank={rank!r} is {reason}, got {response.status_code}"
    finally:
        Path(path).unlink(missing_ok=True)


@pytest.mark.parametrize(
    "path,extra_query",
    [
        ("/api/operations", {}),
        ("/api/tensors", {}),
        ("/api/devices", {}),
        ("/api/buffers", {}),
        ("/api/operation-buffers", {}),
        ("/api/errors", {}),
        ("/api/operations/1", {}),
        ("/api/operation-buffers/1", {}),
        ("/api/tensors/1", {}),
        (
            "/api/buffer",
            {"address": "100", "operation_id": "1"},
        ),
        (
            "/api/buffer-pages",
            {"operation_id": "1", "address": "100"},
        ),
    ],
)
def test_legacy_nonzero_rank_returns_422_not_rank_zero_payload(
    app, client, path, extra_query
):
    """
    Regression: unranked DBs only represent rank 0. ``?rank`` with a non-zero value
    must not succeed with HTTP 200 and legacy rows (which would appear as rank 0 in JSON).
    """
    with tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False) as f:
        path_db = f.name
    try:
        _write_legacy_report_db(path_db)
        _register_profiler_instance(app, path_db, instance_id=LEGACY_INSTANCE_ID)

        query_string = {
            "instanceId": LEGACY_INSTANCE_ID,
            "rank": "2",
            **extra_query,
        }
        response = client.get(path, query_string=query_string)

        assert response.status_code == HTTPStatus.UNPROCESSABLE_ENTITY, (
            f"expected 422 for {path} with rank=2 on unranked DB, got "
            f"{response.status_code}"
        )
        err = response.get_json()
        assert err is not None
        assert "error" in err
        assert "per-rank" in err["error"].lower()
        # A mistaken 200 would typically be a JSON list or object with legacy data — we
        # never return that shape for this error path.
        assert not isinstance(err, list)
    finally:
        Path(path_db).unlink(missing_ok=True)


def test_colliding_ids_do_not_union_without_rank(app, client):
    """
    The #1842 symptom: with both ranks reusing ``operation_id = 1`` and
    ``tensor_id = 1``, an unfiltered read returned two indistinguishable rows
    per entity. Scoped to rank 0 there must be exactly one of each.
    """
    with tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False) as f:
        path = f.name
    try:
        _write_colliding_rank_report_db(path)
        _register_profiler_instance(app, path)

        operations = client.get(
            "/api/operations",
            query_string={"instanceId": INSTANCE_ID},
        )
        assert operations.status_code == HTTPStatus.OK
        ops = operations.get_json()
        assert len(ops) == 1, f"unioned ranks: {ops}"
        assert ops[0]["id"] == 1
        assert ops[0]["rank"] == 0
        assert len(ops[0]["outputs"]) == 1

        tensors = client.get(
            "/api/tensors",
            query_string={"instanceId": INSTANCE_ID},
        )
        assert tensors.status_code == HTTPStatus.OK
        tensor_rows = tensors.get_json()
        assert len(tensor_rows) == 1, f"unioned ranks: {tensor_rows}"
        assert tensor_rows[0]["id"] == 1
        assert tensor_rows[0]["rank"] == 0

        buffers = client.get(
            "/api/buffers",
            query_string={"instanceId": INSTANCE_ID},
        )
        assert buffers.status_code == HTTPStatus.OK
        buffer_rows = buffers.get_json()
        assert len(buffer_rows) == 1, f"unioned ranks: {buffer_rows}"
        assert buffer_rows[0]["rank"] == 0
    finally:
        Path(path).unlink(missing_ok=True)


def test_colliding_ids_resolve_per_rank_on_detail_routes(app, client):
    """
    A shared id must still address both rows: ``/operations/1`` is rank 0's
    operation by default and rank 1's when asked, never an arbitrary winner.
    """
    with tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False) as f:
        path = f.name
    try:
        _write_colliding_rank_report_db(path)
        _register_profiler_instance(app, path)

        default = client.get(
            "/api/operations/1",
            query_string={"instanceId": INSTANCE_ID},
        )
        assert default.status_code == HTTPStatus.OK
        assert default.get_json()["rank"] == 0
        assert default.get_json()["duration"] == 1.0

        rank_one = client.get(
            "/api/operations/1",
            query_string={"instanceId": INSTANCE_ID, "rank": "1"},
        )
        assert rank_one.status_code == HTTPStatus.OK
        assert rank_one.get_json()["rank"] == 1
        assert rank_one.get_json()["duration"] == 2.0

        # Same colliding tensor_id, disambiguated only by rank.
        tensor_zero = client.get(
            "/api/tensors/1",
            query_string={"instanceId": INSTANCE_ID},
        )
        assert tensor_zero.status_code == HTTPStatus.OK
        assert tensor_zero.get_json()["rank"] == 0

        tensor_one = client.get(
            "/api/tensors/1",
            query_string={"instanceId": INSTANCE_ID, "rank": "1"},
        )
        assert tensor_one.status_code == HTTPStatus.OK
        assert tensor_one.get_json()["rank"] == 1
    finally:
        Path(path).unlink(missing_ok=True)


def test_scoped_comparisons_still_attach_to_their_tensor(app, client):
    """
    Scoping comparisons by rank must not cost the rank its own comparison.

    Only the attachment is observable here: ``serialize_tensors`` keys
    comparisons by the tensors in the response, so surplus rows for another
    rank's tensors are silently dropped and cannot be asserted on. The
    narrowing itself is verified in ``test_query_tensor_comparisons_rank``.
    """
    with tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False) as f:
        path = f.name
    try:
        _write_colliding_rank_report_db(path)
        _register_profiler_instance(app, path)

        response = client.get(
            "/api/tensors",
            query_string={"instanceId": INSTANCE_ID},
        )
        assert response.status_code == HTTPStatus.OK
        rows = response.get_json()
        assert len(rows) == 1

        comparison = rows[0]["comparison"]
        assert comparison is not None, "rank 0's own comparison was dropped"
        assert comparison["local"]["golden_tensor_id"] == 900
        assert comparison["global"]["golden_tensor_id"] == 800
    finally:
        Path(path).unlink(missing_ok=True)


def test_query_tensor_comparisons_rank(app):
    """
    The rank argument must narrow to that rank's tensor ids and nothing else.

    Tensor 2 exists on rank 1 only, so its comparison rows (golden 901/801) are
    the evidence: reading them under ``rank=0`` means the scoping was dropped.
    Asserted at this layer because the route serializes comparisons against the
    tensors it already holds, which hides any surplus.
    """
    with tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False) as f:
        path = f.name
    try:
        _write_colliding_rank_report_db(path)
        connection = sqlite3.connect(path)
        try:
            db = DatabaseQueries(connection=connection)

            scoped = [c.golden_tensor_id for c in db.query_tensor_comparisons(rank=0)]
            assert scoped == [900], f"reached another rank's comparisons: {scoped}"

            scoped_global = [
                c.golden_tensor_id
                for c in db.query_tensor_comparisons(local=False, rank=0)
            ]
            assert scoped_global == [800], scoped_global

            # `rank=None` is the unscoped read the report routes no longer make.
            unscoped = [c.golden_tensor_id for c in db.query_tensor_comparisons()]
            assert sorted(unscoped) == [900, 901]
        finally:
            connection.close()
    finally:
        Path(path).unlink(missing_ok=True)


def test_comparison_scoping_survives_a_report_larger_than_the_sqlite_var_cap(
    app, client
):
    """
    Scoping must not bind one parameter per tensor id.

    SQLite refuses more than 32766 variables in a statement, so reading the ids
    out and binding them made any report above that cap a hard 500 — and every
    smaller one pay a parameter list growing with its tensor count.
    """
    with tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False) as f:
        path = f.name
    try:
        _write_wide_ranked_report_db(path, tensor_count=40_000)
        _register_profiler_instance(app, path)

        response = client.get(
            "/api/tensors",
            query_string={"instanceId": INSTANCE_ID},
        )

        assert response.status_code == HTTPStatus.OK, response.get_data(as_text=True)
        assert len(response.get_json()) == 40_000
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
