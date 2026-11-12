# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""`POST /api/instance/local-paths`: how a link from the agent tools opens its report (#2047)."""

import json
import os
from unittest.mock import patch

import pytest
from ttnn_visualizer.app import _create_preloaded_instance, parse_args
from ttnn_visualizer.exceptions import InvalidProfilerPath, InvalidReportPath
from ttnn_visualizer.instances import (
    KEY_MLIR_NAME,
    KEY_NPE_NAME,
    KEY_PERFORMANCE_NAME,
    KEY_PROFILER_NAME,
    create_instance_from_local_paths,
)
from ttnn_visualizer.models import InstanceTable

ENDPOINT = "/api/instance/local-paths"


@pytest.fixture
def local_mode(app):
    """The test settings run hosted, and this endpoint is local-only."""
    previous = app.config["SERVER_MODE"]
    app.config["SERVER_MODE"] = False
    yield
    app.config["SERVER_MODE"] = previous


@pytest.fixture
def report_dirs(tmp_path):
    profiler = tmp_path / "bge_m3"
    profiler.mkdir()
    (profiler / "db.sqlite").touch()
    performance = tmp_path / "2026_08_19_16_47_08"
    performance.mkdir()
    (performance / "profile_log_device.csv").touch()
    (performance / "ops_perf_results_2026_08_19_16_47_08.csv").touch()
    return profiler, performance


def _a_file(tmp_path):
    path = tmp_path / "not_a_directory"
    path.touch()
    return path


def _instance_count(app):
    with app.app_context():
        return InstanceTable.query.count()


def _instance(client, instance_id):
    return client.get(
        "/api/instance", query_string={"instanceId": instance_id}
    ).get_json()


@pytest.mark.usefixtures("local_mode")
class TestLocalPaths:
    def test_it_makes_an_instance_on_the_directories(self, client, report_dirs):
        """As `ttnn-visualizer --memory-report-path` does, so the app reads them in place."""
        profiler, performance = report_dirs

        response = client.post(
            ENDPOINT,
            json={"profiler_path": str(profiler), "performance_path": str(performance)},
        )

        assert response.status_code == 200
        instance = _instance(client, response.get_json()["instance_id"])
        assert instance["profiler_path"] == f"{profiler}/db.sqlite"
        assert instance["performance_path"] == str(performance)
        assert instance["active_report"]["profiler_name"] == "bge_m3"
        assert instance["active_report"]["performance_name"] == "2026_08_19_16_47_08"

    def test_each_link_gets_its_own_instance(self, client, report_dirs):
        profiler, _ = report_dirs

        first = client.post(ENDPOINT, json={"profiler_path": str(profiler)})
        second = client.post(ENDPOINT, json={"profiler_path": str(profiler)})

        assert first.get_json()["instance_id"] != second.get_json()["instance_id"]

    def test_a_performance_report_opens_alone(self, client, report_dirs):
        _, performance = report_dirs

        response = client.post(ENDPOINT, json={"performance_path": str(performance)})

        assert response.status_code == 200
        instance = _instance(client, response.get_json()["instance_id"])
        assert instance["profiler_path"] is None
        assert instance["performance_path"] == str(performance)

    @pytest.mark.parametrize(
        ("payload", "reason"),
        [
            ({}, "One of profiler_path or performance_path is required."),
            (["/reports/bge_m3"], "Expected a JSON object."),
            ("/reports/bge_m3", "Expected a JSON object."),
            ({"profiler_path": "relative/report"}, "must be an absolute path"),
            ({"profiler_path": 7}, "must be an absolute path"),
            ({"performance_path": "/no/such/report"}, "No performance report"),
            ({"profiler_path": "", "performance_path": ""}, "One of profiler_path"),
        ],
    )
    def test_it_refuses_a_payload_it_cannot_open(self, client, payload, reason):
        response = client.post(ENDPOINT, json=payload)

        assert response.status_code == 400
        assert reason in response.get_json()["error"]

    def test_a_cross_site_text_plain_post_is_not_read(self, app, client, report_dirs):
        """Such a POST skips the CORS preflight; only the JSON content type keeps it out."""
        profiler, _ = report_dirs
        before = _instance_count(app)

        response = client.post(
            ENDPOINT,
            data=json.dumps({"profiler_path": str(profiler)}),
            content_type="text/plain",
        )

        assert response.status_code == 400
        assert _instance_count(app) == before

    @pytest.mark.parametrize("bad", ["profiler_path", "performance_path"])
    def test_one_bad_half_refuses_the_whole_link(
        self, app, client, report_dirs, tmp_path, bad
    ):
        profiler, performance = report_dirs
        payload = {"profiler_path": str(profiler), "performance_path": str(performance)}
        payload[bad] = str(tmp_path / "missing")
        before = _instance_count(app)

        response = client.post(ENDPOINT, json=payload)

        assert response.status_code == 400
        assert _instance_count(app) == before

    @pytest.mark.parametrize("key", ["profiler_path", "performance_path"])
    def test_it_opens_only_a_directory_holding_a_report(self, client, tmp_path, key):
        """Any page can send the reader here with a path of its choosing."""
        response = client.post(ENDPOINT, json={key: str(tmp_path)})

        assert response.status_code == 400
        assert response.get_json()["error"].endswith(f"at {tmp_path}.")

    def test_it_opens_the_resolved_directory(self, client, report_dirs):
        profiler, _ = report_dirs
        roundabout = profiler / ".." / profiler.name

        response = client.post(ENDPOINT, json={"profiler_path": str(roundabout)})

        instance = _instance(client, response.get_json()["instance_id"])
        assert instance["profiler_path"] == f"{profiler.resolve()}/db.sqlite"

    @pytest.mark.skipif(
        hasattr(os, "geteuid") and os.geteuid() == 0,
        reason="root reads a directory whatever its mode",
    )
    def test_an_unreadable_path_is_refused_rather_than_raised(self, client, tmp_path):
        locked = tmp_path / "locked"
        locked.mkdir()
        locked.chmod(0)
        try:
            response = client.post(
                ENDPOINT, json={"profiler_path": str(locked / "report")}
            )
        finally:
            locked.chmod(0o755)

        assert response.status_code == 400
        assert response.get_json()["error"].startswith("Cannot read")


def test_a_hosted_app_opens_no_report_by_path(client, report_dirs):
    """Any path on the server would otherwise be one request away."""
    profiler, _ = report_dirs

    response = client.post(ENDPOINT, json={"profiler_path": str(profiler)})

    assert response.status_code == 403


class TestCreateInstanceFromLocalPaths:
    """The instance `ttnn-visualizer --memory-report-path` and this endpoint both store.

    `tests/bootRestoredReportLoad.spec.tsx` restores exactly this shape to pin that a
    preloaded report records no load event. Its report selectors branch on the location
    keys, so a location added here would leave that case testing a shape the app no
    longer stores.
    """

    def test_it_names_the_folders_and_stores_no_location(self, app, report_dirs):
        profiler, performance = report_dirs

        with app.app_context():
            instance = create_instance_from_local_paths(
                profiler_path=str(profiler), performance_path=str(performance)
            )

            assert instance.active_report == {
                KEY_PROFILER_NAME: "bge_m3",
                KEY_PERFORMANCE_NAME: "2026_08_19_16_47_08",
                KEY_NPE_NAME: None,
                KEY_MLIR_NAME: None,
            }
            assert instance.profiler_path == f"{profiler}/db.sqlite"
            assert instance.performance_path == str(performance)
            assert instance.remote_connection is None
            assert instance.remote_profiler_folder is None
            assert instance.remote_performance_folder is None

    def test_a_missing_half_is_named_empty(self, app, report_dirs):
        _, performance = report_dirs

        with app.app_context():
            instance = create_instance_from_local_paths(
                profiler_path=None, performance_path=str(performance)
            )

            assert instance.active_report[KEY_PROFILER_NAME] == ""
            assert instance.profiler_path is None

    @pytest.mark.parametrize(
        "make_bad", [lambda tmp: tmp / "missing", _a_file], ids=["missing", "a_file"]
    )
    @pytest.mark.parametrize(
        ("key", "error"),
        [
            ("profiler_path", InvalidReportPath),
            ("performance_path", InvalidProfilerPath),
        ],
    )
    def test_it_refuses_a_path_that_is_not_a_directory(
        self, app, tmp_path, make_bad, key, error
    ):
        """`TestCliPreload` pins the exit message the CLI turns each of these into."""
        paths = {"profiler_path": None, "performance_path": None}
        paths[key] = str(make_bad(tmp_path))
        before = _instance_count(app)

        with app.app_context(), pytest.raises(error):
            create_instance_from_local_paths(**paths)

        assert _instance_count(app) == before


class TestCliPreload:
    """`ttnn-visualizer --memory-report-path` / `--performance-path` before serving."""

    @pytest.fixture(autouse=True)
    def _use_the_test_app(self, app):
        with patch("ttnn_visualizer.app.create_app", return_value=app):
            yield

    def test_without_either_flag_it_makes_no_instance(self, app):
        before = _instance_count(app)

        assert _create_preloaded_instance(parse_args([])) is None
        assert _instance_count(app) == before

    def test_it_returns_the_instance_the_browser_opens_on(self, client, report_dirs):
        profiler, performance = report_dirs
        args = parse_args(
            [
                "--memory-report-path",
                str(profiler),
                "--performance-path",
                str(performance),
            ]
        )

        instance_id = _create_preloaded_instance(args)

        assert (
            _instance(client, instance_id)["active_report"]["profiler_name"] == "bge_m3"
        )

    @pytest.mark.parametrize(
        ("flag", "message"),
        [
            ("--memory-report-path", "Invalid memory report path"),
            ("--performance-path", "Invalid performance path"),
        ],
    )
    def test_a_bad_path_exits_naming_its_own_flag(self, app, tmp_path, flag, message):
        """The two exception names read swapped, so swapping the handlers is easy."""
        missing = tmp_path / "missing"
        before = _instance_count(app)

        with pytest.raises(SystemExit) as exit_info:
            _create_preloaded_instance(parse_args([flag, str(missing)]))

        assert str(exit_info.value.code) == f"❌ {message}: {missing}"
        assert _instance_count(app) == before
