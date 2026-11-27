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

import re
from http import HTTPStatus
from unittest.mock import Mock
from urllib.parse import unquote

import pytest
from ttnn_visualizer.csv_queries import NPEQueries
from ttnn_visualizer.decorators import (
    ACTIVE_MEMORY_REPORT_HEADER,
    LOCAL_ONLY_REFUSAL,
    is_local_only,
    local_only,
    with_instance,
)
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


# The client caches a memory-report read under the report it asked about, so each
# response names the report it was answered for (#2375).
NAMED_REPORT_INSTANCE_ID = "pytest-named-report"


def _add_instance_with_memory_report(app, profiler_name):
    with app.app_context():
        db.session.add(
            InstanceTable(
                instance_id=NAMED_REPORT_INSTANCE_ID,
                active_report={"profiler_name": profiler_name},
                profiler_path="/tmp/pytest-does-not-exist/db.sqlite",
            )
        )
        db.session.commit()


@pytest.mark.parametrize(
    "profiler_name",
    ["memory-run", "mémoire run/äöü 报告"],
    ids=["ascii", "non-ascii-with-separator"],
)
def test_with_instance_names_the_active_memory_report(client, app, profiler_name):
    _add_instance_with_memory_report(app, profiler_name)

    response = client.get(
        "/api/instance", query_string={"instanceId": NAMED_REPORT_INSTANCE_ID}
    )

    assert response.status_code == HTTPStatus.OK
    header = response.headers[ACTIVE_MEMORY_REPORT_HEADER]
    assert header.isascii()
    assert unquote(header) == profiler_name


def test_with_instance_names_the_report_on_an_error_handler_response(client, app):
    """A missing database is answered by the app's error handler, not the view's
    return value, and the client must still be able to tell whose error it is."""
    _add_instance_with_memory_report(app, "memory-run")

    response = client.get(
        "/api/operations", query_string={"instanceId": NAMED_REPORT_INSTANCE_ID}
    )

    assert response.status_code == HTTPStatus.NOT_FOUND
    assert response.headers[ACTIVE_MEMORY_REPORT_HEADER] == "memory-run"


def test_with_instance_sends_an_empty_name_without_an_active_memory_report(client):
    response = client.get("/api/instance", query_string={"instanceId": INSTANCE_ID})

    assert response.headers[ACTIVE_MEMORY_REPORT_HEADER] == ""


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


def test_local_only_marks_the_view_it_returns():
    def view():
        return "ok"

    assert is_local_only(local_only(view))
    assert not is_local_only(view)


def test_local_only_marker_keeps_its_literal_name():
    """Tooling outside this repository reads the marker as `local_only`, so a
    rename would leave it finding no gated routes without anything here failing."""

    def view():
        return "ok"

    assert getattr(local_only(view), "local_only") is True


def test_local_only_marker_survives_a_decorator_stacked_above():
    """Views stack `@with_instance` over `@local_only`; the registered function must
    still carry the marker, or the route audit below would find nothing to check."""

    def view(instance):
        return "ok"

    assert is_local_only(with_instance(local_only(view)))


# Every `@local_only` (rule, method), pinned in full and compared for equality. The
# audit below finds routes by their marker, so on its own it cannot notice a route
# that loses `@local_only` (it is no longer marked, so no longer checked) or loses the
# marker under a decorator that skips `functools.wraps`. Either now fails here.
# Gating or un-gating a route means editing this set, which is the point: it makes
# a change to the SERVER_MODE boundary show up in review.
GATED_ROUTES = {
    ("/api/instance/local-paths", "POST"),
    ("/api/mlir", "GET"),
    ("/api/mlir/active", "POST"),
    ("/api/npe/summary", "GET"),
    ("/api/npe/window", "GET"),
    ("/api/performance/comparison-candidates", "GET"),
    ("/api/performance/<performance_name>", "DELETE"),
    ("/api/profiler/<profiler_name>", "DELETE"),
    ("/api/remote/host-key", "POST"),
    ("/api/remote/host-key/trust", "POST"),
    ("/api/remote/local-performance-reports", "POST"),
    ("/api/remote/local-profiler-reports", "POST"),
    ("/api/remote/mlir/test", "POST"),
    ("/api/remote/mlir/upload", "POST"),
    ("/api/remote/performance-reports", "POST"),
    ("/api/remote/profiler-reports", "POST"),
    ("/api/remote/ssh-config-hosts", "GET"),
    ("/api/remote/sync", "POST"),
    ("/api/remote/test", "POST"),
    ("/api/remote/use", "POST"),
}
PATH_PARAMETER = re.compile(r"<[^>]*>")
IGNORED_METHODS = {"HEAD", "OPTIONS"}


def _local_only_routes(app):
    return [
        (rule.rule, method)
        for rule in app.url_map.iter_rules()
        if is_local_only(app.view_functions[rule.endpoint])
        for method in sorted((rule.methods or set()) - IGNORED_METHODS)
    ]


def test_the_marked_routes_are_exactly_the_gated_set(app):
    """Fails on a route gated, un-gated or dropped from the marker without
    `GATED_ROUTES` being updated to match."""
    assert set(_local_only_routes(app)) == GATED_ROUTES


def _refused_by_local_only(response):
    return response.status_code == HTTPStatus.FORBIDDEN and response.get_json() == {
        "error": LOCAL_ONLY_REFUSAL
    }


def test_every_local_only_route_refuses_under_server_mode(app, client):
    """The `app` fixture runs in the hosted posture, where each gated route must
    answer 403 before reading its body or path parameters. The routes come from
    the URL map; `test_the_marked_routes_are_exactly_the_gated_set` pins that
    list, so this one can't pass on a route that silently dropped out of it.

    The refusal text is checked as well as the status, because `@with_instance`
    sits above `@local_only` on some of these routes and answers its own 403 for
    an instance another session owns: a 403 from anything other than `@local_only`
    must not count."""
    assert app.config["SERVER_MODE"]

    not_refused = []
    for rule, method in _local_only_routes(app):
        path = PATH_PARAMETER.sub("local-only-audit", rule)
        response = client.open(
            path, method=method, query_string={"instanceId": INSTANCE_ID}
        )
        if not _refused_by_local_only(response):
            # Status and error only: a gated route's body can hold local details,
            # such as the runner's SSH host aliases, that don't belong in CI logs.
            body = response.get_json(silent=True)
            error = body.get("error") if isinstance(body, dict) else None
            not_refused.append(f"{method} {rule} -> {response.status_code} {error!r}")

    assert not_refused == []


def test_the_audit_does_not_count_an_ownership_refusal(app):
    """A 403 from `@with_instance` for another session's instance must not pass
    for the `@local_only` refusal, or the audit above could not tell them apart."""
    owner, other = app.test_client(), app.test_client()
    query = {"instanceId": INSTANCE_ID}

    assert _refused_by_local_only(owner.get("/api/npe/summary", query_string=query))

    response = other.get("/api/npe/summary", query_string=query)
    assert response.status_code == HTTPStatus.FORBIDDEN
    assert not _refused_by_local_only(response)
