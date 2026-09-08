# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""
Tests for the request-scoped decorators in `ttnn_visualizer.decorators` and
the cross-cutting "report not loaded" 404 contract enforced by the global
error handler in `ttnn_visualizer.app`.

Most decorator behaviour is exercised transitively through view tests, but the
missing-parameter branch of `with_instance` has no natural caller (the React
frontend always sends `instanceId`), so we pin it here. The empty-instance
404 cases are pinned alongside it so future refactors of either side keep the
contract intact.
"""

from http import HTTPStatus
from unittest.mock import Mock

import pytest
from ttnn_visualizer.csv_queries import NPEQueries
from ttnn_visualizer.exceptions import (
    PerformanceReportNotLoadedException,
    ProfilerReportNotLoadedException,
)
from ttnn_visualizer.extensions import db
from ttnn_visualizer.models import InstanceTable

# A throwaway client-chosen tab id. The `app` fixture spins up a fresh DB tmpdir
# per test, so each parametrized case starts with no row in `instances`; the
# request handler creates one through `get_or_create_instance` with no
# `profiler_path`/`performance_path`.
INSTANCE_ID = "pytest-empty-instance"
MISSING_DB_INSTANCE_ID = "pytest-missing-db"


def test_report_not_loaded_exception_accepts_custom_message():
    err = PerformanceReportNotLoadedException("custom")
    assert str(err) == "custom"


def test_profiler_report_not_loaded_exception_default_message():
    err = ProfilerReportNotLoadedException()
    assert str(err) == ProfilerReportNotLoadedException.DEFAULT_MESSAGE


def test_npe_get_npe_timeline_rejects_empty_filename():
    instance = Mock()
    instance.performance_path = "/some/path"

    with pytest.raises(ValueError, match="filename is required"):
        NPEQueries.get_npe_timeline(instance, "")


def test_with_instance_returns_400_when_instance_id_missing(client):
    """A request without `instanceId` must surface as 400 (Bad Request).

    Pre-fix the decorator returned 404, which incorrectly implied the named
    instance was unknown rather than that the client failed to identify which
    instance it meant. Any report-bound endpoint will do; `/api/tensors` is a
    convenient stand-in because it has no other required arguments.
    """
    response = client.get("/api/tensors")
    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert response.get_json() == {
        "error": "Missing required query parameter: instanceId"
    }


# Routes that read from the memory profiler database. With no profiler report
# loaded, every one of these must respond 404 via
# `ProfilerReportNotLoadedException` (raised inside `LocalQueryRunner`), not
# 500 from a leaked `ValueError`.
PROFILER_ROUTES = [
    "/api/operations",
    "/api/operations/1",
    "/api/tensors",
    "/api/tensors/1",
    "/api/buffers",
    "/api/buffer-pages",
]


@pytest.mark.parametrize("path", PROFILER_ROUTES)
def test_profiler_route_returns_404_when_profiler_not_loaded(client, path):
    """`get_or_create_instance` accepts arbitrary client-chosen IDs; report-
    backed routes must respond 404 when that tab has no profiler DB yet."""
    response = client.get(
        path,
        query_string={"instanceId": INSTANCE_ID},
    )
    assert response.status_code == HTTPStatus.NOT_FOUND
    assert response.get_json() == {
        "error": ProfilerReportNotLoadedException.DEFAULT_MESSAGE
    }


def test_profiler_route_returns_404_when_db_file_missing(client, app):
    """When profiler_path points at a missing db.sqlite, surface 404 not 500."""
    with app.app_context():
        existing = InstanceTable.query.filter_by(
            instance_id=MISSING_DB_INSTANCE_ID
        ).first()
        if existing:
            db.session.delete(existing)
            db.session.commit()
        db.session.add(
            InstanceTable(
                instance_id=MISSING_DB_INSTANCE_ID,
                active_report={},
                profiler_path="/tmp/pytest-does-not-exist/db.sqlite",
            )
        )
        db.session.commit()

    response = client.get(
        "/api/operations",
        query_string={"instanceId": MISSING_DB_INSTANCE_ID},
    )
    assert response.status_code == HTTPStatus.NOT_FOUND
    error_json = response.get_json()
    assert error_json is not None
    assert error_json["error"].startswith("Database not found at path:")


# Routes that read from a performance report directory, paired with the
# minimum query string each route needs to advance past its own input
# validation into the helper that touches `instance.performance_path`. With
# no performance report loaded the previous behaviour was a mix of generic
# 404 (`response_not_found()`) and 400 (`/perf-results/report`); they now
# all return 404 with the shared "No performance report loaded ..." body.
PERFORMANCE_ROUTES = [
    ("/api/performance/device-log", {}),
    ("/api/performance/device-log/raw", {}),
    ("/api/performance/device-log/meta", {}),
    ("/api/performance/device-log/zone/foo", {}),
    ("/api/performance/perf-results", {}),
    ("/api/performance/perf-results/raw", {}),
    ("/api/performance/perf-results/report", {}),
    ("/api/performance/npe/manifest", {}),
    ("/api/performance/npe/timeline", {"filename": "x.json"}),
]


@pytest.mark.parametrize("path,extra_query", PERFORMANCE_ROUTES)
def test_performance_route_returns_404_when_performance_not_loaded(
    client, path, extra_query
):
    """Same contract as profiler routes, raised by the helpers in
    `csv_queries.py` and surfaced via `PerformanceReportNotLoadedException`."""
    response = client.get(
        path,
        query_string={"instanceId": INSTANCE_ID, **extra_query},
    )
    assert response.status_code == HTTPStatus.NOT_FOUND
    assert response.get_json() == {
        "error": PerformanceReportNotLoadedException.DEFAULT_MESSAGE
    }
