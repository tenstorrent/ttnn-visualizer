# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""
A missing stack trace reads ``null`` from the operations and errors endpoints,
however the report leaves it out: no ``stack_traces`` row, a NULL value, or no
column at all. A trace stored as ``''`` is the report's own value and is sent as
it is. #2429
"""

from http import HTTPStatus

import pytest
from ttnn_visualizer.tests.report_schemas import SCHEMA_V2

_OPERATION = "INSERT INTO operations VALUES (1, 'ttnn.add', 1.0);\n"

_STACK_TRACES_WITHOUT_THE_TRACE = """
DROP TABLE stack_traces;
CREATE TABLE stack_traces (operation_id int);
"""

_ERRORS_WITHOUT = """
DROP TABLE errors;
CREATE TABLE errors (
    operation_id int,
    operation_name text,
    error_type text,
    error_message text,
    {kept}
);
"""


def _get(client, url, instance_id):
    response = client.get(url, query_string={"instanceId": instance_id})
    assert response.status_code == HTTPStatus.OK
    return response.get_json()


def _list_and_detail(client, instance_id):
    (listed,) = _get(client, "/api/operations", instance_id)
    return listed, _get(client, "/api/operations/1", instance_id)


@pytest.mark.parametrize(
    "schema_sql, trace_sql",
    [
        pytest.param(SCHEMA_V2, "", id="no-row"),
        pytest.param(
            SCHEMA_V2, "INSERT INTO stack_traces VALUES (1, NULL);", id="null-value"
        ),
        pytest.param(
            SCHEMA_V2 + _STACK_TRACES_WITHOUT_THE_TRACE,
            "INSERT INTO stack_traces VALUES (1);",
            id="no-column",
        ),
    ],
)
def test_an_operation_without_a_trace_reads_null_from_both_endpoints(
    client, make_report, schema_sql, trace_sql
):
    instance_id = make_report(_OPERATION + trace_sql, schema_sql=schema_sql)

    listed, detail = _list_and_detail(client, instance_id)

    assert listed["stack_trace"] is None
    assert detail["stack_trace"] is None


def test_an_operation_trace_stored_empty_is_sent_as_it_is(client, make_report):
    instance_id = make_report(_OPERATION + "INSERT INTO stack_traces VALUES (1, '');")

    listed, detail = _list_and_detail(client, instance_id)

    assert listed["stack_trace"] == ""
    assert detail["stack_trace"] == ""


@pytest.mark.parametrize(
    "schema_sql, error_sql",
    [
        pytest.param(
            SCHEMA_V2,
            "INSERT INTO errors VALUES (1, 'ttnn.add', 'RuntimeError', 'boom', NULL, 't');",
            id="null-value",
        ),
        pytest.param(
            SCHEMA_V2 + _ERRORS_WITHOUT.format(kept="timestamp text"),
            "INSERT INTO errors VALUES (1, 'ttnn.add', 'RuntimeError', 'boom', 't');",
            id="no-column",
        ),
    ],
)
def test_an_error_without_a_trace_reads_null_wherever_it_is_served(
    client, make_report, schema_sql, error_sql
):
    instance_id = make_report(_OPERATION + error_sql, schema_sql=schema_sql)

    listed, detail = _list_and_detail(client, instance_id)
    (error,) = _get(client, "/api/errors", instance_id)

    assert listed["error"]["stack_trace"] is None
    assert detail["error"]["stack_trace"] is None
    assert error["stack_trace"] is None
    assert error["timestamp"] == "t"


def test_an_error_trace_stored_empty_is_sent_as_it_is(client, make_report):
    """tt-metal writes ``''`` for every error it has no trace for."""
    instance_id = make_report(
        _OPERATION
        + "INSERT INTO errors VALUES (1, 'ttnn.add', 'RuntimeError', 'boom', '', 't');"
    )

    listed, detail = _list_and_detail(client, instance_id)
    (error,) = _get(client, "/api/errors", instance_id)

    assert listed["error"]["stack_trace"] == ""
    assert detail["error"]["stack_trace"] == ""
    assert error["stack_trace"] == ""


def test_an_errors_table_without_a_timestamp_still_reads_an_empty_one(
    client, make_report
):
    instance_id = make_report(
        _OPERATION
        + "INSERT INTO errors VALUES (1, 'ttnn.add', 'RuntimeError', 'boom', 'trace');",
        schema_sql=SCHEMA_V2 + _ERRORS_WITHOUT.format(kept="stack_trace text"),
    )

    (error,) = _get(client, "/api/errors", instance_id)

    assert (error["stack_trace"], error["timestamp"]) == ("trace", "")
