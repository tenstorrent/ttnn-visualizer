# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""
API tests for attaching error records to operations.

The report importer writes errors it cannot place on an operation at a per-file
base id (0 for the first file, 10000 for the next), so an error's id alone can
name an unrelated operation. These tests pin that only an error whose operation
name also matches is shown on the operation, and that ``/api/errors`` flags the
rest as unattached (#2082).
"""

from http import HTTPStatus

_OPERATIONS = """
INSERT INTO operations VALUES (1, 'ttnn.add', 1.0);
INSERT INTO operations VALUES (2, 'ttnn.conv2d', 1.0);
INSERT INTO operations VALUES (10000, 'ttnn.matmul', 1.0);
"""


def _error(operation_id, operation_name, error_type="RuntimeError", message="boom"):
    return (
        f"INSERT INTO errors VALUES ({operation_id}, '{operation_name}', "
        f"'{error_type}', '{message}', 'trace', 't');\n"
    )


def _operations(client, instance_id):
    response = client.get("/api/operations", query_string={"instanceId": instance_id})
    assert response.status_code == HTTPStatus.OK
    return {operation["id"]: operation for operation in response.get_json()}


def _operation(client, instance_id, operation_id):
    response = client.get(
        f"/api/operations/{operation_id}", query_string={"instanceId": instance_id}
    )
    assert response.status_code == HTTPStatus.OK
    return response.get_json()


def _errors(client, instance_id):
    response = client.get("/api/errors", query_string={"instanceId": instance_id})
    assert response.status_code == HTTPStatus.OK
    return response.get_json()


def test_error_matching_id_and_name_is_attached(client, make_report):
    instance_id = make_report(_OPERATIONS + _error(2, "ttnn.conv2d"))

    assert _operations(client, instance_id)[2]["error"]["error_message"] == "boom"
    assert _operation(client, instance_id, 2)["error"]["error_message"] == "boom"
    assert [e["attached"] for e in _errors(client, instance_id)] == [True]


def test_orphan_at_base_id_zero_is_unattached(client, make_report):
    instance_id = make_report(
        _OPERATIONS
        + _error(
            0,
            "ttnn.conv2d",
            "incomplete_operation",
            "Operation started but never completed (likely crashed)",
        )
    )

    assert all(op["error"] is None for op in _operations(client, instance_id).values())
    errors = _errors(client, instance_id)
    assert [(e["operation_id"], e["attached"]) for e in errors] == [(0, False)]


def test_orphan_colliding_with_a_real_operation_id_is_unattached_2082(
    client, make_report
):
    """An orphan at the second file's base id must not mark operation 10000."""
    instance_id = make_report(
        _OPERATIONS + _error(10000, "ttnn.conv2d", "incomplete_operation")
    )

    assert _operations(client, instance_id)[10000]["error"] is None
    assert _operation(client, instance_id, 10000)["error"] is None
    assert [e["attached"] for e in _errors(client, instance_id)] == [False]


def test_orphan_without_operation_name_is_unattached(client, make_report):
    """Errors with no in-flight owner can carry an empty operation name."""
    instance_id = make_report(_OPERATIONS + _error(1, ""))

    assert _operations(client, instance_id)[1]["error"] is None
    assert _operation(client, instance_id, 1)["error"] is None
    assert [e["attached"] for e in _errors(client, instance_id)] == [False]


def test_list_and_detail_show_the_same_error_when_rows_share_a_key(client, make_report):
    instance_id = make_report(
        _OPERATIONS
        + _error(2, "ttnn.conv2d", message="first")
        + _error(2, "ttnn.conv2d", message="second")
    )

    assert _operations(client, instance_id)[2]["error"]["error_message"] == "first"
    assert _operation(client, instance_id, 2)["error"]["error_message"] == "first"
    errors = _errors(client, instance_id)
    assert [(e["error_message"], e["attached"]) for e in errors] == [
        ("first", True),
        ("second", False),
    ]
