# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

from http import HTTPStatus
from unittest.mock import patch

import pytest
from ttnn_visualizer.tests.report_schemas import SCHEMA_V2_1


def test_stack_source_availability_requires_instance(client):
    response = client.get(
        "/api/remote/stack-trace/test", query_string={"filePath": "/some/path"}
    )
    assert response.status_code == HTTPStatus.BAD_REQUEST


def test_stack_source_availability_rejects_missing_file_path(client, make_report):
    instance_id = make_report()
    response = client.get(
        "/api/remote/stack-trace/test",
        query_string={"instanceId": instance_id},
    )
    assert response.status_code == HTTPStatus.BAD_REQUEST


def test_stack_source_availability_server_mode_without_remote_reports_unavailable(
    client, make_report
):
    instance_id = make_report()
    response = client.get(
        "/api/remote/stack-trace/test",
        query_string={"instanceId": instance_id, "filePath": "/any/path"},
    )
    assert response.status_code == HTTPStatus.OK
    assert response.get_json() == {"available": False, "source": None}
    assert response.headers.get("Cache-Control") == "no-store"


def test_stack_source_content_forbidden_in_server_mode_without_remote(
    client, make_report
):
    instance_id = make_report()
    response = client.get(
        "/api/remote/stack-trace/read",
        query_string={"instanceId": instance_id, "filePath": "/any/path"},
    )
    assert response.status_code == HTTPStatus.FORBIDDEN


def test_stack_source_content_local_read_sets_no_store(app, client, make_report):
    instance_id = make_report()
    app.config["SERVER_MODE"] = False
    # read_stack_source_local still returns (content, resolved, remapped); remap is
    # reported on /stack-trace/test's JSON `source` field, not on /read's JSON body.
    with patch(
        "ttnn_visualizer.views.read_stack_source_local",
        return_value=("print('hi')\n", "/abs/resolved.py", False),
    ):
        response = client.get(
            "/api/remote/stack-trace/read",
            query_string={"instanceId": instance_id, "filePath": "/any/path"},
        )
    assert response.status_code == HTTPStatus.OK
    assert response.headers.get("Cache-Control") == "no-store"
    assert response.get_json() == {
        "content": "print('hi')\n",
        "resolved_path": "/abs/resolved.py",
    }


def test_stack_source_content_requires_instance(client):
    response = client.get(
        "/api/remote/stack-trace/read", query_string={"filePath": "/some/path"}
    )
    assert response.status_code == HTTPStatus.BAD_REQUEST


def test_stack_source_content_rejects_missing_file_path(client, make_report):
    instance_id = make_report()
    response = client.get(
        "/api/remote/stack-trace/read",
        query_string={"instanceId": instance_id},
    )
    assert response.status_code == HTTPStatus.BAD_REQUEST


@pytest.mark.parametrize(
    "extra_query",
    [
        pytest.param({"filePath": "/proj/model.py"}, id="path-only"),
        pytest.param({"sourceFileId": 1}, id="source-file-id-only"),
        pytest.param({"sourceFileId": 1, "filePath": "/proj/model.py"}, id="both"),
    ],
)
def test_stack_source_availability_from_report_db_in_server_mode(
    client, make_report, extra_query
):
    instance_id = make_report(
        schema_sql=SCHEMA_V2_1,
        inserts_sql="""
        INSERT INTO source_files VALUES (1, '/proj/model.py', 'print(1)');
        """,
    )
    response = client.get(
        "/api/remote/stack-trace/test",
        query_string={"instanceId": instance_id, **extra_query},
    )
    assert response.status_code == HTTPStatus.OK
    assert response.get_json() == {"available": True, "source": "database"}


def test_stack_source_read_from_report_db_by_path_only_in_server_mode(
    client, make_report
):
    instance_id = make_report(
        schema_sql=SCHEMA_V2_1,
        inserts_sql="""
        INSERT INTO source_files VALUES (3, '/proj/other.py', 'print(2)\n');
        """,
    )
    response = client.get(
        "/api/remote/stack-trace/read",
        query_string={"instanceId": instance_id, "filePath": "/proj/other.py"},
    )
    assert response.status_code == HTTPStatus.OK
    assert response.get_json() == {
        "content": "print(2)\n",
        "resolved_path": "/proj/other.py",
    }


def test_stack_source_read_from_report_db_in_server_mode(client, make_report):
    instance_id = make_report(
        schema_sql=SCHEMA_V2_1,
        inserts_sql="""
        INSERT INTO source_files VALUES (1, '/proj/model.py', 'print(1)\n');
        """,
    )
    response = client.get(
        "/api/remote/stack-trace/read",
        query_string={"instanceId": instance_id, "sourceFileId": 1},
    )
    assert response.status_code == HTTPStatus.OK
    assert response.get_json() == {
        "content": "print(1)\n",
        "resolved_path": "/proj/model.py",
    }


def test_stack_source_availability_reports_path_origin_on_literal_match(
    app, client, make_report
):
    instance_id = make_report()
    app.config["SERVER_MODE"] = False
    # Returning False from *_with_origin means the file resolved at the literal path
    # (no /tt-metal/ remap), which the API surfaces as source="path".
    with patch(
        "ttnn_visualizer.views.check_stack_source_local_with_origin",
        return_value=False,
    ):
        response = client.get(
            "/api/remote/stack-trace/test",
            query_string={"instanceId": instance_id, "filePath": "/any/path"},
        )
    assert response.status_code == HTTPStatus.OK
    assert response.get_json() == {"available": True, "source": "path"}


def test_stack_source_availability_reports_remapped_origin(app, client, make_report):
    instance_id = make_report()
    app.config["SERVER_MODE"] = False
    with patch(
        "ttnn_visualizer.views.check_stack_source_local_with_origin",
        return_value=True,
    ):
        response = client.get(
            "/api/remote/stack-trace/test",
            query_string={"instanceId": instance_id, "filePath": "/any/path"},
        )
    assert response.status_code == HTTPStatus.OK
    assert response.get_json() == {"available": True, "source": "remapped"}


def test_stack_source_availability_reports_unavailable_when_origin_none(
    app, client, make_report
):
    instance_id = make_report()
    app.config["SERVER_MODE"] = False
    with patch(
        "ttnn_visualizer.views.check_stack_source_local_with_origin",
        return_value=None,
    ):
        response = client.get(
            "/api/remote/stack-trace/test",
            query_string={"instanceId": instance_id, "filePath": "/any/path"},
        )
    assert response.status_code == HTTPStatus.OK
    assert response.get_json() == {"available": False, "source": None}
