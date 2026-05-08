# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

from http import HTTPStatus


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


def test_legacy_post_test_source_path_matches_get_availability(client, make_report):
    instance_id = make_report()
    get_r = client.get(
        "/api/remote/stack-trace/test",
        query_string={"instanceId": instance_id, "filePath": "/any/path"},
    )
    post_r = client.post(
        "/api/remote/stack-trace/read",
        query_string={"instanceId": instance_id},
        json={"filePath": "/any/path"},
    )
    assert get_r.get_json() == post_r.get_json()


def test_legacy_remote_read_check_path_only_matches_availability(client, make_report):
    instance_id = make_report()
    canonical = client.get(
        "/api/remote/stack-trace/test",
        query_string={"instanceId": instance_id, "filePath": "/any/path"},
    )
    legacy = client.post(
        "/api/remote/read",
        query_string={"instanceId": instance_id},
        json={"filePath": "/any/path", "check_path_only": True},
    )
    assert canonical.get_json() == legacy.get_json()


def test_stack_source_content_forbidden_in_server_mode_without_remote(
    client, make_report
):
    instance_id = make_report()
    response = client.get(
        "/api/remote/stack-trace/read",
        query_string={"instanceId": instance_id, "filePath": "/any/path"},
    )
    assert response.status_code == HTTPStatus.FORBIDDEN


def test_legacy_post_read_source_matches_get_content(client, make_report):
    instance_id = make_report()
    get_r = client.get(
        "/api/remote/stack-trace/read",
        query_string={"instanceId": instance_id, "filePath": "/any/path"},
    )
    post_r = client.post(
        "/api/remote/read-source",
        query_string={"instanceId": instance_id},
        json={"filePath": "/any/path"},
    )
    assert get_r.status_code == post_r.status_code
