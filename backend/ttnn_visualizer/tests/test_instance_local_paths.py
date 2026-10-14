# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""`POST /api/instance/local-paths`: how a link from the agent tools opens its report (#2047)."""

import os

import pytest

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


def _instance(client, instance_id):
    return client.get(
        "/api/instance", query_string={"instanceId": instance_id}
    ).get_json()


@pytest.mark.usefixtures("local_mode")
class TestLocalPaths:
    def test_it_makes_an_instance_on_the_directories(self, client, report_dirs):
        """As `ttnn-visualizer --profiler-path` does, so the app reads them in place."""
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
