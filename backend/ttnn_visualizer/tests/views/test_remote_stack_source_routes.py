# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

from http import HTTPStatus


def test_path_availability_requires_instance(client):
    response = client.post(
        "/api/remote/test-source-path",
        json={"filePath": "/some/path"},
    )
    assert response.status_code == HTTPStatus.NOT_FOUND


def test_path_availability_rejects_missing_file_path(client, make_report):
    instance_id = make_report()
    response = client.post(
        "/api/remote/test-source-path",
        query_string={"instanceId": instance_id},
        json={},
    )
    assert response.status_code == HTTPStatus.BAD_REQUEST


def test_path_availability_server_mode_without_remote_reports_unavailable(
    client, make_report
):
    instance_id = make_report()
    response = client.post(
        "/api/remote/test-source-path",
        query_string={"instanceId": instance_id},
        json={"filePath": "/any/path"},
    )
    assert response.status_code == HTTPStatus.OK
    assert response.get_json() == {"available": False}


def test_legacy_remote_read_check_path_only_matches_path_availability(
    client, make_report
):
    instance_id = make_report()
    canonical = client.post(
        "/api/remote/test-source-path",
        query_string={"instanceId": instance_id},
        json={"filePath": "/any/path"},
    )
    legacy = client.post(
        "/api/remote/read",
        query_string={"instanceId": instance_id},
        json={"filePath": "/any/path", "check_path_only": True},
    )
    assert canonical.get_json() == legacy.get_json()


def test_stack_source_forbidden_in_server_mode_without_remote(client, make_report):
    instance_id = make_report()
    response = client.post(
        "/api/remote/read-source",
        query_string={"instanceId": instance_id},
        json={"filePath": "/any/path"},
    )
    assert response.status_code == HTTPStatus.FORBIDDEN
