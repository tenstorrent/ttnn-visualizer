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
# /api/tensors — buffer_type filter
# ---------------------------------------------------------------------------

# Tensors covering multiple buffer_type values across two devices so the filter
# semantics and its composition with device_id can both be exercised.
# buffer_type values: 0=DRAM, 1=L1, 3=L1_Small (matches BufferType enum).
_MIXED_BUFFER_TYPE_INSERTS = """
INSERT INTO operations VALUES (1, 'op_a', 1.0);
INSERT INTO tensors VALUES (10, '(2, 4)', 'bfloat16',  'TILE',      '{}', 0, 200, 0);
INSERT INTO tensors VALUES (20, '(1,)',   'float32',   'ROW_MAJOR', '{}', 0, 300, 1);
INSERT INTO tensors VALUES (30, '(1,)',   'uint16',    'ROW_MAJOR', '{}', 0, 400, 3);
INSERT INTO tensors VALUES (40, '(1,)',   'uint16',    'ROW_MAJOR', '{}', 1, 500, 3);
"""


def test_tensors_list_buffer_type_filter(client, make_report):
    """?buffer_type=N restricts results to tensors with that buffer_type."""
    instance_id = make_report(_MIXED_BUFFER_TYPE_INSERTS, SCHEMA_V2)

    response = client.get(
        "/api/tensors",
        query_string={"instanceId": instance_id, "buffer_type": 3},
    )
    assert response.status_code == HTTPStatus.OK

    data = response.get_json()
    ids = sorted(t["id"] for t in data)
    assert ids == [30, 40]


def test_tensors_list_buffer_type_filter_composes_with_device_id(client, make_report):
    """buffer_type and device_id filters compose with AND semantics."""
    instance_id = make_report(_MIXED_BUFFER_TYPE_INSERTS, SCHEMA_V2)

    response = client.get(
        "/api/tensors",
        query_string={
            "instanceId": instance_id,
            "buffer_type": 3,
            "device_id": 0,
        },
    )
    assert response.status_code == HTTPStatus.OK

    data = response.get_json()
    ids = sorted(t["id"] for t in data)
    assert ids == [30]


def test_tensors_list_omitted_buffer_type_returns_all_types(client, make_report):
    """Omitting buffer_type leaves the list unfiltered by type."""
    instance_id = make_report(_MIXED_BUFFER_TYPE_INSERTS, SCHEMA_V2)

    response = client.get("/api/tensors", query_string={"instanceId": instance_id})
    assert response.status_code == HTTPStatus.OK

    data = response.get_json()
    ids = sorted(t["id"] for t in data)
    assert ids == [10, 20, 30, 40]


def test_tensors_list_non_numeric_buffer_type_is_ignored(client, make_report):
    """A non-numeric buffer_type query value is silently ignored (no filter applied)."""
    instance_id = make_report(_MIXED_BUFFER_TYPE_INSERTS, SCHEMA_V2)

    response = client.get(
        "/api/tensors",
        query_string={"instanceId": instance_id, "buffer_type": "abc"},
    )
    assert response.status_code == HTTPStatus.OK

    data = response.get_json()
    ids = sorted(t["id"] for t in data)
    assert ids == [10, 20, 30, 40]


# tt-metal stores `buffer_type` as 0 (DRAM) for every tensor without an address.
# 50 is addressed, and its column wins over a memory config that disagrees; 60
# is unaddressed and declares L1; 70 is a host tensor that declares nothing.
_UNADDRESSED_BUFFER_TYPE_INSERTS = """
INSERT INTO operations VALUES (1, 'op_a', 1.0);
INSERT INTO tensors VALUES (50, '(1,)', 'bfloat16', 'TILE',
    'MemoryConfig(memory_layout=TensorMemoryLayout::INTERLEAVED,buffer_type=BufferType::L1,shard_spec=std::nullopt)',
    0, 100, 0);
INSERT INTO tensors VALUES (60, '(1,)', 'uint16', 'ROW_MAJOR',
    'MemoryConfig(memory_layout=TensorMemoryLayout::INTERLEAVED,buffer_type=BufferType::L1,shard_spec=std::nullopt)',
    0, NULL, 0);
INSERT INTO tensors VALUES (70, '(1,)', 'uint32', 'ROW_MAJOR', NULL, 0, NULL, 0);
"""


def test_tensors_list_unaddressed_buffer_type_comes_from_memory_config(
    client, make_report
):
    """The stored 0 would otherwise report an L1 tensor, and a host tensor, as DRAM."""
    instance_id = make_report(_UNADDRESSED_BUFFER_TYPE_INSERTS, SCHEMA_V2)

    response = client.get("/api/tensors", query_string={"instanceId": instance_id})
    assert response.status_code == HTTPStatus.OK

    buffer_types = {t["id"]: t["buffer_type"] for t in response.get_json()}
    assert buffer_types == {50: 0, 60: 1, 70: None}


def test_tensors_list_buffer_type_filter_uses_the_corrected_buffer_type(
    client, make_report
):
    """The filter agrees with the buffer type each tensor is reported with."""
    instance_id = make_report(_UNADDRESSED_BUFFER_TYPE_INSERTS, SCHEMA_V2)

    ids_by_filter = {}
    for buffer_type in (0, 1):
        response = client.get(
            "/api/tensors",
            query_string={"instanceId": instance_id, "buffer_type": buffer_type},
        )
        assert response.status_code == HTTPStatus.OK
        ids_by_filter[buffer_type] = sorted(t["id"] for t in response.get_json())

    assert ids_by_filter == {0: [50], 1: [60]}


def test_tensors_list_text_buffer_type_is_serialised_as_its_value(client, make_report):
    """Newer reports store the name; addressed and unaddressed tensors alike
    are serialised as the enum's value, never a mix of names and numbers."""
    instance_id = make_report(
        """
        INSERT INTO operations VALUES (1, 'op_a', 1.0);
        INSERT INTO tensors VALUES (80, '(1,)', 'bfloat16', 'TILE', NULL, 0, 100, 'L1_SMALL');
        INSERT INTO tensors VALUES (90, '(1,)', 'uint16', 'ROW_MAJOR',
            'MemoryConfig(memory_layout=TensorMemoryLayout::INTERLEAVED,buffer_type=BufferType::L1,shard_spec=std::nullopt)',
            0, NULL, 'DRAM');
        """,
        SCHEMA_V2,
    )

    response = client.get(
        "/api/tensors", query_string={"instanceId": instance_id, "buffer_type": 3}
    )
    assert response.status_code == HTTPStatus.OK
    assert [(t["id"], t["buffer_type"]) for t in response.get_json()] == [(80, 3)]

    response = client.get("/api/tensors", query_string={"instanceId": instance_id})
    buffer_types = {t["id"]: t["buffer_type"] for t in response.get_json()}
    assert buffer_types == {80: 3, 90: 1}


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
