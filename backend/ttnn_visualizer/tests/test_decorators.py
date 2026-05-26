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
    error_json = response.get_json()
    assert error_json is not None
    assert "instanceId" in str(error_json)
