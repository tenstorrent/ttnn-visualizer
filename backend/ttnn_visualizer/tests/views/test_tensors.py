# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""
API tests for tensor endpoints.
"""

from http import HTTPStatus

from ttnn_visualizer.tests.report_schemas import SCHEMA_V2, SCHEMA_V2_WITH_LIFETIME

# ---------------------------------------------------------------------------
# Shared inserts
# ---------------------------------------------------------------------------

_BASE_INSERTS = """
INSERT INTO operations VALUES (1, 'op_a', 1.0);
INSERT INTO tensors VALUES (10, '(2, 4)', 'bfloat16', 'TILE', '{}', 0, 200, 0);
INSERT INTO tensors VALUES (20, '(1,)', 'float32', 'ROW_MAJOR', '{}', 0, 300, 0);
INSERT INTO output_tensors VALUES (1, 0, 10);
INSERT INTO input_tensors VALUES (1, 0, 20);
INSERT INTO buffers VALUES (1, 0, 200, 512, 0, NULL);
INSERT INTO buffers VALUES (1, 0, 300, 256, 0, NULL);
"""

# All lifetime fields populated for tensor 10.
_FULL_LIFETIME_INSERT = """
INSERT INTO tensor_lifetime VALUES (10, 1, 3, 5, 'model.py', 42, 'train.py', 99);
"""

# Only producer_operation_id set for tensor 20; every other field is NULL.
_PARTIAL_LIFETIME_INSERT = """
INSERT INTO tensor_lifetime VALUES (20, 1, NULL, NULL, NULL, NULL, NULL, NULL);
"""

# ---------------------------------------------------------------------------
# /api/tensors — list endpoint
# ---------------------------------------------------------------------------


def test_tensors_list_no_lifetime_table_returns_null_lifetime(client, make_report):
    """Older databases without tensor_lifetime should return lifetime: null."""
    instance_id = make_report(_BASE_INSERTS, SCHEMA_V2)

    response = client.get("/api/tensors", query_string={"instanceId": instance_id})
    assert response.status_code == HTTPStatus.OK

    data = response.get_json()
    assert isinstance(data, list)
    assert len(data) == 2

    for tensor in data:
        assert "lifetime" in tensor
        assert tensor["lifetime"] is None


def test_tensors_list_with_full_lifetime(client, make_report):
    """Tensors with a tensor_lifetime row should include a populated lifetime object."""
    instance_id = make_report(
        _BASE_INSERTS + _FULL_LIFETIME_INSERT, SCHEMA_V2_WITH_LIFETIME
    )

    response = client.get("/api/tensors", query_string={"instanceId": instance_id})
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

    # Tensor 20 has no lifetime row — lifetime must be null even though the
    # table exists, to avoid sending empty objects in large responses.
    t20 = tensor_map[20]
    assert t20["lifetime"] is None


def test_tensors_list_partial_lifetime_fields_are_nullable(client, make_report):
    """A tensor_lifetime row with some NULL fields is serialised with None values."""
    instance_id = make_report(
        _BASE_INSERTS + _PARTIAL_LIFETIME_INSERT, SCHEMA_V2_WITH_LIFETIME
    )

    response = client.get("/api/tensors", query_string={"instanceId": instance_id})
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

    # Tensor 10 has no lifetime row at all — lifetime must be null.
    t10 = tensor_map[10]
    assert t10["lifetime"] is None


# ---------------------------------------------------------------------------
# /api/tensors/<tensor_id> — detail endpoint
# ---------------------------------------------------------------------------


def test_tensor_detail_no_lifetime_table(client, make_report):
    """Detail endpoint returns lifetime: null when table is absent."""
    instance_id = make_report(_BASE_INSERTS, SCHEMA_V2)

    response = client.get("/api/tensors/10", query_string={"instanceId": instance_id})
    assert response.status_code == HTTPStatus.OK

    data = response.get_json()
    assert data["tensor_id"] == 10
    assert "lifetime" in data
    assert data["lifetime"] is None


def test_tensor_detail_with_lifetime(client, make_report):
    """Detail endpoint includes a populated lifetime object when the table exists."""
    instance_id = make_report(
        _BASE_INSERTS + _FULL_LIFETIME_INSERT, SCHEMA_V2_WITH_LIFETIME
    )

    response = client.get("/api/tensors/10", query_string={"instanceId": instance_id})
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


def test_tensor_detail_not_found(client, make_report):
    """Requesting a non-existent tensor returns 404."""
    instance_id = make_report(_BASE_INSERTS)

    response = client.get("/api/tensors/9999", query_string={"instanceId": instance_id})
    assert response.status_code == HTTPStatus.NOT_FOUND
