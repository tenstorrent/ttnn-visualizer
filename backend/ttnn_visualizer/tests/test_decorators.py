# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""
Tests for the request-scoped decorators in `ttnn_visualizer.decorators`.

Most decorator behaviour is exercised transitively through view tests, but the
missing-parameter branch of `with_instance` has no natural caller (the React
frontend always sends `instanceId`), so we pin it here.
"""

from http import HTTPStatus


def test_with_instance_returns_400_when_instance_id_missing(client):
    """A request without `instanceId` must surface as 400 (Bad Request).

    Pre-fix the decorator returned 404, which incorrectly implied the named
    instance was unknown rather than that the client failed to identify which
    instance it meant. Any report-bound endpoint will do; `/api/tensors` is a
    convenient stand-in because it has no other required arguments.
    """
    response = client.get("/api/tensors")
    assert response.status_code == HTTPStatus.BAD_REQUEST


def test_report_bound_route_returns_404_when_profiler_not_loaded(client):
    """An instance with no memory profiler report must not surface as 500.

    `get_or_create_instance` accepts arbitrary client-chosen IDs; report-backed
    routes should respond 404 when that tab has no profiler DB yet.
    """
    response = client.get(
        "/api/operations",
        query_string={"instanceId": "pytest-empty-instance"},
    )
    assert response.status_code == HTTPStatus.NOT_FOUND
    assert response.get_json() == {
        "error": "No profiler report loaded for this instance"
    }
