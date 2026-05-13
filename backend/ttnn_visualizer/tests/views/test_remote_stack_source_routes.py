# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

from http import HTTPStatus
from unittest.mock import patch


def test_stack_source_availability_requires_instance(client):
    response = client.get(
        "/api/remote/stack-trace/test", query_string={"filePath": "/some/path"}
    )
    assert response.status_code == HTTPStatus.NOT_FOUND


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
    assert response.get_json() == {"available": False}
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
    assert response.headers.get("X-TTNN-Resolved-Source-Path") == "/abs/resolved.py"


def test_stack_source_content_requires_instance(client):
    response = client.get(
        "/api/remote/stack-trace/read", query_string={"filePath": "/some/path"}
    )
    assert response.status_code == HTTPStatus.NOT_FOUND


def test_stack_source_content_rejects_missing_file_path(client, make_report):
    instance_id = make_report()
    response = client.get(
        "/api/remote/stack-trace/read",
        query_string={"instanceId": instance_id},
    )
    assert response.status_code == HTTPStatus.BAD_REQUEST
