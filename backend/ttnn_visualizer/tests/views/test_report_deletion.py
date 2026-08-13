# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Tests for the profiler and performance report ``DELETE`` routes.

In upload/sync mode the listings these routes are paired with read the local data
directory, so those cases pin the blast radius of a delete to the single directory
the client asked for. In direct-report mode the listings read the TT-Metal tree
instead, which these routes do not manage, so the delete is refused outright.
"""

import shutil
import tempfile
from pathlib import Path

import pytest
from ttnn_visualizer.app import create_app
from ttnn_visualizer.decorators import DIRECT_REPORT_MODE_DELETE_REFUSAL
from ttnn_visualizer.extensions import db
from ttnn_visualizer.instances import (
    KEY_PERFORMANCE_LOCATION,
    KEY_PERFORMANCE_NAME,
    KEY_PROFILER_LOCATION,
    KEY_PROFILER_NAME,
)
from ttnn_visualizer.models import InstanceTable, RemoteConnection, ReportLocation
from ttnn_visualizer.utils import create_path_resolver

API = "/api"
HOST = "yyzc-wh-05"


@pytest.fixture
def app():
    """A local-mode app: ``@local_only`` refuses these routes under SERVER_MODE.

    ``TT_METAL_HOME`` is pinned off because it is otherwise read from the developer's own
    environment (via ``DefaultConfig`` and ``create_app``'s ``load_dotenv``), and it is
    exported on any machine that profiles TT-Metal. Left unpinned, every upload/sync-mode
    case here meets the direct-report-mode refusal and fails in a way indistinguishable
    from a real regression.
    """
    tmpdir = tempfile.mkdtemp()
    try:
        settings = {
            "TESTING": True,
            "SQLALCHEMY_DATABASE_URI": f"sqlite:///{Path(tmpdir) / 'app.db'}",
            "SERVER_MODE": False,
            "TT_METAL_HOME": None,
            "APP_DATA_DIRECTORY": tmpdir,
            "REPORT_DATA_DIRECTORY": tmpdir,
            "LOCAL_DATA_DIRECTORY": str(Path(tmpdir) / "local"),
            "REMOTE_DATA_DIRECTORY": str(Path(tmpdir) / "remote"),
        }
        yield create_app(settings_override=settings)
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


@pytest.fixture
def client(app):
    return app.test_client()


def _local_reports(app, directory_key, *names):
    """Create local report directories and return their parent."""
    parent = Path(app.config["LOCAL_DATA_DIRECTORY"]) / app.config[directory_key]
    for name in names:
        (parent / name).mkdir(parents=True)
    return parent


def _synced_remote_reports(app, directory_key, *names):
    """Create synced remote report directories and return their parent."""
    parent = (
        Path(app.config["REMOTE_DATA_DIRECTORY"]) / HOST / app.config[directory_key]
    )
    for name in names:
        (parent / name).mkdir(parents=True)
    return parent


@pytest.fixture
def direct_mode_app():
    """A direct-report-mode app: the listings read ``$TT_METAL_HOME/generated``."""
    tmpdir = tempfile.mkdtemp()
    try:
        settings = {
            "TESTING": True,
            "SQLALCHEMY_DATABASE_URI": f"sqlite:///{Path(tmpdir) / 'app.db'}",
            "SERVER_MODE": False,
            "TT_METAL_HOME": str(Path(tmpdir) / "tt-metal"),
            "APP_DATA_DIRECTORY": tmpdir,
            "REPORT_DATA_DIRECTORY": tmpdir,
            "LOCAL_DATA_DIRECTORY": str(Path(tmpdir) / "local"),
            "REMOTE_DATA_DIRECTORY": str(Path(tmpdir) / "remote"),
        }
        yield create_app(settings_override=settings)
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


@pytest.fixture
def direct_mode_client(direct_mode_app):
    return direct_mode_app.test_client()


def _tt_metal_reports(app, report_type, *names):
    """Create reports where direct-report mode lists them, and return their parent."""
    parent = create_path_resolver(app).get_base_report_path(report_type)
    for name in names:
        (parent / name).mkdir(parents=True)
    return parent


def _register_instance(app, instance_id, active_report, *, remote=False):
    with app.app_context():
        db.session.add(
            InstanceTable(
                instance_id=instance_id,
                active_report=active_report,
                remote_connection=(
                    RemoteConnection(
                        name="conn",
                        username="u",
                        host=HOST,
                        port=22,
                        profilerPath="/data/ttnn",
                        performancePath="/data/profiler/ttrun",
                    ).model_dump()
                    if remote
                    else None
                ),
            )
        )
        db.session.commit()


class TestPerformanceReportDeletion:
    def test_deletes_only_the_named_report(self, app, client):
        parent = _local_reports(
            app, "PERFORMANCE_DIRECTORY_NAME", "keep_me", "delete_me"
        )
        _register_instance(app, "perf-local", {})

        response = client.delete(
            f"{API}/performance/delete_me", query_string={"instanceId": "perf-local"}
        )

        assert response.status_code == 204
        assert not (parent / "delete_me").exists()
        assert (parent / "keep_me").is_dir()

    def test_active_remote_report_does_not_redirect_the_delete(self, app, client):
        """The tree is chosen by the listing, not by what happens to be active.

        Keying it on the active report's location sent the delete into the synced
        remote directory, where the missing name segment took every report for the
        host with it — including the other ranks of a multihost launch.
        """
        local_parent = _local_reports(app, "PERFORMANCE_DIRECTORY_NAME", "delete_me")
        remote_parent = _synced_remote_reports(
            app,
            "PERFORMANCE_DIRECTORY_NAME",
            "2025_02_24_23_17_27_rank0",
            "2025_02_24_23_17_27_rank1",
        )
        _register_instance(
            app,
            "perf-remote",
            {
                KEY_PERFORMANCE_NAME: "2025_02_24_23_17_27_rank0",
                KEY_PERFORMANCE_LOCATION: ReportLocation.REMOTE.value,
            },
            remote=True,
        )

        response = client.delete(
            f"{API}/performance/delete_me", query_string={"instanceId": "perf-remote"}
        )

        assert response.status_code == 204
        assert not (local_parent / "delete_me").exists()
        assert remote_parent.is_dir()
        assert (remote_parent / "2025_02_24_23_17_27_rank0").is_dir()
        assert (remote_parent / "2025_02_24_23_17_27_rank1").is_dir()

    @pytest.mark.parametrize("name", ["..", "%2e%2e", ".", "%20"])
    def test_rejects_names_that_are_not_a_report(self, app, client, name):
        parent = _local_reports(app, "PERFORMANCE_DIRECTORY_NAME", "keep_me")
        _register_instance(app, "perf-traversal", {})

        response = client.delete(
            f"{API}/performance/{name}", query_string={"instanceId": "perf-traversal"}
        )

        assert response.status_code in {400, 404}
        assert parent.is_dir()
        assert (parent / "keep_me").is_dir()

    def test_traversal_name_cannot_reach_outside_the_reports_directory(
        self, app, client
    ):
        parent = _local_reports(app, "PERFORMANCE_DIRECTORY_NAME", "keep_me")
        sibling = Path(app.config["LOCAL_DATA_DIRECTORY"]) / "keep-this-too"
        sibling.mkdir(parents=True)
        _register_instance(app, "perf-escape", {})

        # A backslash is not a POSIX separator, so `sanitise_path_segment` has to
        # collapse it rather than leave it as a literal filename character.
        response = client.delete(
            f"{API}/performance/..%5Ckeep-this-too",
            query_string={"instanceId": "perf-escape"},
        )

        assert response.status_code in {400, 404}
        assert sibling.is_dir()
        assert (parent / "keep_me").is_dir()

    def test_clears_the_active_report_when_it_is_the_one_deleted(self, app, client):
        _local_reports(app, "PERFORMANCE_DIRECTORY_NAME", "2025_02_24_23_17_27_rank0")
        _register_instance(
            app,
            "perf-active",
            {
                KEY_PERFORMANCE_NAME: "2025_02_24_23_17_27_rank0",
                KEY_PERFORMANCE_LOCATION: ReportLocation.LOCAL.value,
            },
        )

        response = client.delete(
            f"{API}/performance/2025_02_24_23_17_27_rank0",
            query_string={"instanceId": "perf-active"},
        )

        assert response.status_code == 204
        with app.app_context():
            instance = InstanceTable.query.filter_by(
                instance_id="perf-active"
            ).one_or_none()
            assert instance is not None
            assert not instance.active_report.get(KEY_PERFORMANCE_NAME)


class TestProfilerReportDeletion:
    def test_deletes_only_the_named_report(self, app, client):
        parent = _local_reports(app, "PROFILER_DIRECTORY_NAME", "keep_me", "delete_me")
        _register_instance(app, "profiler-local", {})

        response = client.delete(
            f"{API}/profiler/delete_me", query_string={"instanceId": "profiler-local"}
        )

        assert response.status_code == 204
        assert not (parent / "delete_me").exists()
        assert (parent / "keep_me").is_dir()

    def test_active_remote_report_does_not_redirect_the_delete(self, app, client):
        local_parent = _local_reports(app, "PROFILER_DIRECTORY_NAME", "delete_me")
        remote_parent = _synced_remote_reports(
            app, "PROFILER_DIRECTORY_NAME", "keep_me_remote"
        )
        _register_instance(
            app,
            "profiler-remote",
            {
                KEY_PROFILER_NAME: "keep_me_remote",
                KEY_PROFILER_LOCATION: ReportLocation.REMOTE.value,
            },
            remote=True,
        )

        response = client.delete(
            f"{API}/profiler/delete_me", query_string={"instanceId": "profiler-remote"}
        )

        assert response.status_code == 204
        assert not (local_parent / "delete_me").exists()
        assert (remote_parent / "keep_me_remote").is_dir()

    def test_rejects_a_traversal_name(self, app, client):
        parent = _local_reports(app, "PROFILER_DIRECTORY_NAME", "keep_me")
        _register_instance(app, "profiler-traversal", {})

        response = client.delete(
            f"{API}/profiler/..", query_string={"instanceId": "profiler-traversal"}
        )

        assert response.status_code in {400, 404}
        assert parent.is_dir()
        assert (parent / "keep_me").is_dir()


class TestDirectReportModeDeletion:
    """With ``TT_METAL_HOME`` set, the listings read a tree these routes cannot delete from.

    Deleting resolved against the app's own data directory regardless, so every delete of
    a listed report 404'd and the UI showed nothing at all. Refuse instead of 404ing
    against a tree the client never saw listed.
    """

    def test_refuses_to_delete_a_listed_profiler_report(
        self, direct_mode_app, direct_mode_client
    ):
        parent = _tt_metal_reports(direct_mode_app, "profiler", "listed_report")
        _register_instance(direct_mode_app, "profiler-direct", {})

        response = direct_mode_client.delete(
            f"{API}/profiler/listed_report",
            query_string={"instanceId": "profiler-direct"},
        )

        assert response.status_code == 403
        # The UI renders this through getResponseError, so a bare "Forbidden" would leave
        # the user with a refusal that says nothing about why.
        assert response.get_json()["error"] == DIRECT_REPORT_MODE_DELETE_REFUSAL
        assert (parent / "listed_report").is_dir()

    def test_refuses_to_delete_a_listed_performance_report(
        self, direct_mode_app, direct_mode_client
    ):
        parent = _tt_metal_reports(direct_mode_app, "performance", "listed_report")
        _register_instance(direct_mode_app, "perf-direct", {})

        response = direct_mode_client.delete(
            f"{API}/performance/listed_report",
            query_string={"instanceId": "perf-direct"},
        )

        assert response.status_code == 403
        assert response.get_json()["error"] == DIRECT_REPORT_MODE_DELETE_REFUSAL
        assert (parent / "listed_report").is_dir()

    def test_refusal_does_not_reach_the_local_data_directory(
        self, direct_mode_app, direct_mode_client
    ):
        """A same-named report in the app's own tree must survive the refusal too."""
        local_parent = _local_reports(
            direct_mode_app, "PROFILER_DIRECTORY_NAME", "listed_report"
        )
        _register_instance(direct_mode_app, "profiler-direct-local", {})

        response = direct_mode_client.delete(
            f"{API}/profiler/listed_report",
            query_string={"instanceId": "profiler-direct-local"},
        )

        assert response.status_code == 403
        assert (local_parent / "listed_report").is_dir()
