# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

from http import HTTPStatus

import pytest
from ttnn_visualizer.tests.report_schemas import SCHEMA_V2_1


@pytest.fixture
def operations_inserts_sql():
    return """
    INSERT INTO operations VALUES (1, 'op1', 0.5);
    INSERT INTO stack_traces VALUES (1, 'File "/proj/model.py", line 10, in forward', 1);
    INSERT INTO source_files VALUES (1, '/proj/model.py', 'def forward(): pass');
    INSERT INTO input_tensors VALUES (1, 0, 1);
    INSERT INTO output_tensors VALUES (1, 0, 1);
    INSERT INTO tensors VALUES (1, '[]', 'float32', 'ROW_MAJOR', '', 0, 0, 0);
    """


def test_operations_list_stack_trace_and_source_file_id(
    client, make_report, operations_inserts_sql
):
    instance_id = make_report(
        schema_sql=SCHEMA_V2_1,
        inserts_sql=operations_inserts_sql,
    )
    response = client.get(
        "/api/operations",
        query_string={"instanceId": instance_id},
    )
    assert response.status_code == HTTPStatus.OK
    operations = response.get_json()
    assert len(operations) == 1
    assert operations[0]["stack_trace"] == 'File "/proj/model.py", line 10, in forward'
    assert operations[0]["stack_trace_source_file_id"] == 1
