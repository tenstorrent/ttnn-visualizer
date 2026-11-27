# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""`isDemo`, `runFingerprint` and order on the profiler and performance report listings.

The frontend records a hosted pick of a listed folder as `demo` or `upload` from this
flag alone, so the listing is the single owner of the demo rule.
"""

import os
import sqlite3
from http import HTTPStatus
from io import BytesIO
from pathlib import Path

import pytest
from ttnn_visualizer.extensions import db
from ttnn_visualizer.models import Instance, InstanceTable
from ttnn_visualizer.report_fingerprint import (
    performance_run_fingerprint,
    profiler_run_fingerprint,
)
from ttnn_visualizer.views import (
    DEMO_PERFORMANCE_DIRECTORY_NAMES,
    DEMO_PROFILER_DIRECTORY_NAMES,
    _apply_requested_performance_name,
)


def _make_profiler_report(root: Path, name: str) -> None:
    (root / name).mkdir(parents=True)
    (root / name / "db.sqlite").write_bytes(b"")


def _make_readable_profiler_report(root: Path, name: str) -> None:
    (root / name).mkdir(parents=True)
    connection = sqlite3.connect(root / name / "db.sqlite")
    connection.execute("CREATE TABLE operations (operation_id int)")
    connection.close()


def _make_performance_report(root: Path, name: str) -> None:
    (root / name).mkdir(parents=True)
    (root / name / "profile_log_device.csv").write_text("")
    (root / name / "ops_perf_results.csv").write_text("")


_LISTINGS = {
    "profiler": (
        "/api/profiler",
        "PROFILER_DIRECTORY_NAME",
        _make_profiler_report,
        DEMO_PROFILER_DIRECTORY_NAMES,
    ),
    "performance": (
        "/api/performance",
        "PERFORMANCE_DIRECTORY_NAME",
        _make_performance_report,
        DEMO_PERFORMANCE_DIRECTORY_NAMES,
    ),
}

_DEMO_CASES = [
    pytest.param(kind, name, id=name)
    for kind, (*_, demo_names) in _LISTINGS.items()
    for name in sorted(demo_names)
]

# Names an upload might use to pass as a demo. None is on the list, so none qualifies.
_LOOKALIKE_NAMES = [
    "my_demo_report",
    "demo_n300-llama",
    "DEMO_N300-LLAMA",
    "BH_DEMO_x",
    "WH_DEMO_x",
    "wh_demo_n300-llama",
]


def _listing(app, kind):
    endpoint, directory_key, make_report_dir, _ = _LISTINGS[kind]
    root = Path(app.config["LOCAL_DATA_DIRECTORY"]) / app.config[directory_key]
    return endpoint, root, make_report_dir


@pytest.mark.parametrize(("kind", "demo_name"), _DEMO_CASES)
@pytest.mark.parametrize("server_mode", [True, False])
def test_listing_marks_demo_folders_only_under_server_mode(
    app, client, make_report, kind, demo_name, server_mode
):
    app.config["SERVER_MODE"] = server_mode
    endpoint, root, make_report_dir = _listing(app, kind)
    make_report_dir(root, demo_name)
    make_report_dir(root, "my-report")

    response = client.get(endpoint, query_string={"instanceId": make_report()})

    assert response.status_code == HTTPStatus.OK, response.get_data(as_text=True)
    is_demo_by_path = {
        folder["path"]: folder["isDemo"] for folder in response.get_json()
    }
    if server_mode:
        # Hosted listings never show another session's uploads, so only the demo appears.
        assert is_demo_by_path == {demo_name: True}
    else:
        assert is_demo_by_path == {demo_name: False, "my-report": False}


@pytest.mark.parametrize("kind", sorted(_LISTINGS))
@pytest.mark.parametrize("server_mode", [True, False])
def test_listing_breaks_equal_times_by_name(
    app, client, make_report, kind, server_mode
):
    """Hosted listings start from a set, so without a tie-breaker the order of
    equal times would follow string hashing and could change between restarts."""
    app.config["SERVER_MODE"] = server_mode
    endpoint, root, make_report_dir = _listing(app, kind)
    # Hosted listings only show demos to a fresh session, so the names must be demos.
    names = sorted(_LISTINGS[kind][3])
    newest = names[-1]
    for name in reversed(names):
        make_report_dir(root, name)
        os.utime(root / name, (1_000, 1_000))
    os.utime(root / newest, (2_000, 2_000))

    response = client.get(endpoint, query_string={"instanceId": make_report()})

    assert response.status_code == HTTPStatus.OK, response.get_data(as_text=True)
    assert [folder["path"] for folder in response.get_json()] == [
        newest,
        *names[:-1],
    ]


@pytest.mark.parametrize(
    ("endpoint", "directory_key", "make_report_dir", "run_fingerprint"),
    [
        (
            "/api/profiler",
            "PROFILER_DIRECTORY_NAME",
            _make_readable_profiler_report,
            profiler_run_fingerprint,
        ),
        (
            "/api/performance",
            "PERFORMANCE_DIRECTORY_NAME",
            _make_performance_report,
            performance_run_fingerprint,
        ),
    ],
)
def test_listing_carries_each_folders_run_fingerprint(
    app, client, make_report, endpoint, directory_key, make_report_dir, run_fingerprint
):
    app.config["SERVER_MODE"] = False
    root = Path(app.config["LOCAL_DATA_DIRECTORY"]) / app.config[directory_key]
    make_report_dir(root, "my-report")

    response = client.get(endpoint, query_string={"instanceId": make_report()})

    assert response.status_code == HTTPStatus.OK, response.get_data(as_text=True)
    [folder] = response.get_json()
    # Present even when null, so the client can tell "unknown" from "not sent".
    assert folder["runFingerprint"] is not None
    assert folder["runFingerprint"] == run_fingerprint(root / "my-report")


def test_report_fingerprints_describe_the_active_reports(app, client, tmp_path):
    profiler_dir = tmp_path / "memory"
    _make_readable_profiler_report(tmp_path, "memory")
    performance_dir = tmp_path / "performance"
    _make_performance_report(tmp_path, "performance")

    with app.app_context():
        db.session.add(
            InstanceTable(
                instance_id="fingerprints",
                active_report={
                    "profiler_name": "memory",
                    "profiler_location": "local",
                    "performance_name": "performance",
                    "performance_location": "local",
                },
                profiler_path=str(profiler_dir / "db.sqlite"),
                performance_path=str(performance_dir),
            )
        )
        db.session.commit()

    response = client.get(
        "/api/report-fingerprints", query_string={"instanceId": "fingerprints"}
    )

    assert response.status_code == HTTPStatus.OK
    # Each run names the active folder it was read from, so the client can tell an
    # answer about a later pick from one about the report it asked after.
    assert response.get_json() == {
        "profiler": {
            "folder": "memory",
            "run": profiler_run_fingerprint(profiler_dir),
        },
        "performance": {
            "folder": "performance",
            "run": performance_run_fingerprint(performance_dir),
        },
    }
    assert all(side["run"] is not None for side in response.get_json().values())


def test_report_fingerprints_are_null_without_active_reports(app, client):
    with app.app_context():
        db.session.add(InstanceTable(instance_id="no-reports", active_report={}))
        db.session.commit()

    response = client.get(
        "/api/report-fingerprints", query_string={"instanceId": "no-reports"}
    )

    assert response.status_code == HTTPStatus.OK
    assert response.get_json() == {
        "profiler": {"folder": None, "run": None},
        "performance": {"folder": None, "run": None},
    }


@pytest.mark.parametrize("kind", list(_LISTINGS))
@pytest.mark.parametrize("folder_name", _LOOKALIKE_NAMES)
def test_hosted_listing_hides_folders_that_only_look_like_demos(
    app, client, make_report, kind, folder_name
):
    # A demo is listed to every hosted session, so only the bundled folders qualify;
    # anything else in the shared directory stays private to the session that made it.
    app.config["SERVER_MODE"] = True
    endpoint, root, make_report_dir = _listing(app, kind)
    make_report_dir(root, folder_name)

    response = client.get(endpoint, query_string={"instanceId": make_report()})

    assert response.status_code == HTTPStatus.OK, response.get_data(as_text=True)
    assert response.get_json() == []


@pytest.mark.parametrize("kind", list(_LISTINGS))
def test_hosted_listing_without_a_report_directory_is_empty(
    app, client, make_report, kind
):
    # A fresh hosted install has no report directory until the first upload, and the
    # performance listing does not create one.
    app.config["SERVER_MODE"] = True
    endpoint, root, _ = _listing(app, kind)
    assert not root.exists()

    response = client.get(endpoint, query_string={"instanceId": make_report()})

    assert response.status_code == HTTPStatus.OK, response.get_data(as_text=True)
    assert response.get_json() == []


def test_hosted_upload_named_after_a_demo_cannot_replace_it(app, client, make_report):
    # Hosted uploads land under a `<timestamp>_` prefix, so reusing a demo's folder
    # name writes beside the demo rather than into it.
    app.config["SERVER_MODE"] = True
    app.config["LOCAL_DATA_DIRECTORY"] = Path(app.config["LOCAL_DATA_DIRECTORY"])
    _, root, make_report_dir = _listing(app, "profiler")
    make_report_dir(root, "WH_DEMO_n300-llama")
    demo_db = root / "WH_DEMO_n300-llama" / "db.sqlite"

    response = client.post(
        "/api/local/upload/profiler",
        query_string={"instanceId": make_report()},
        data={"files": [(BytesIO(b"not-the-demo"), "WH_DEMO_n300-llama/db.sqlite")]},
        content_type="multipart/form-data",
    )

    assert response.status_code == HTTPStatus.OK, response.get_data(as_text=True)
    assert demo_db.read_bytes() == b""
    uploaded = [
        path.parent.name
        for path in root.glob("*_WH_DEMO_n300-llama/db.sqlite")
        if path.read_bytes() == b"not-the-demo"
    ]
    assert len(uploaded) == 1


COMPARISON_CANDIDATES = "/api/performance/comparison-candidates"


def _instance_on_performance_report(app, instance_id: str, performance_dir: Path):
    with app.app_context():
        db.session.add(
            InstanceTable(
                instance_id=instance_id,
                active_report={"performance_name": performance_dir.name},
                performance_path=str(performance_dir),
            )
        )
        db.session.commit()
    return instance_id


def _candidates(client, instance_id: str) -> dict:
    response = client.get(
        COMPARISON_CANDIDATES, query_string={"instanceId": instance_id}
    )
    assert response.status_code == HTTPStatus.OK, response.get_data(as_text=True)
    return response.get_json()


def _candidate_paths(client, instance_id: str):
    return [folder["path"] for folder in _candidates(client, instance_id)["reports"]]


_RUNNING_AS_ROOT = hasattr(os, "geteuid") and os.geteuid() == 0


def _synced_reports_root(app, host: str = "remote-host") -> Path:
    return (
        Path(app.config["REMOTE_DATA_DIRECTORY"])
        / host
        / app.config["PERFORMANCE_DIRECTORY_NAME"]
    )


def _local_reports_root(app) -> Path:
    return (
        Path(app.config["LOCAL_DATA_DIRECTORY"])
        / app.config["PERFORMANCE_DIRECTORY_NAME"]
    )


class TestComparisonCandidates:
    """The comparison selector's options come from where `?name=` reads them (#2433)."""

    @pytest.fixture(autouse=True)
    def _local_install(self, app):
        app.config["SERVER_MODE"] = False

    def test_a_synced_report_lists_its_synced_siblings_and_no_local_report(
        self, app, client
    ):
        synced = _synced_reports_root(app)
        _make_performance_report(synced, "active")
        _make_performance_report(synced, "synced-sibling")
        _make_performance_report(_local_reports_root(app), "local-only")
        instance_id = _instance_on_performance_report(app, "remote", synced / "active")

        assert sorted(_candidate_paths(client, instance_id)) == [
            "active",
            "synced-sibling",
        ]

    def test_a_report_opened_by_path_lists_what_sits_beside_it(
        self, app, client, tmp_path
    ):
        """`--performance-path` and `/api/instance/local-paths` keep the real path."""
        runs = tmp_path / "runs"
        _make_performance_report(runs, "active")
        _make_performance_report(runs, "other-run")
        _make_performance_report(_local_reports_root(app), "local-only")
        instance_id = _instance_on_performance_report(app, "by-path", runs / "active")

        assert sorted(_candidate_paths(client, instance_id)) == ["active", "other-run"]

    def test_only_valid_visible_report_folders_are_listed(self, app, client):
        synced = _synced_reports_root(app)
        _make_performance_report(synced, "active")
        _make_performance_report(synced, ".hidden")
        (synced / "not-a-report").mkdir()
        (synced / "a-file").write_text("")
        instance_id = _instance_on_performance_report(app, "valid", synced / "active")

        assert _candidate_paths(client, instance_id) == ["active"]

    def test_a_rank_qualified_folder_is_listed_by_its_synced_name(self, app, client):
        """The listed `path` is what `?name=` receives, rank qualifier included."""
        synced = _synced_reports_root(app)
        _make_performance_report(synced, "2026_07_28_18_04_24_rank0")
        _make_performance_report(synced, "2026_07_28_18_04_24_rank1")
        instance_id = _instance_on_performance_report(
            app, "ranks", synced / "2026_07_28_18_04_24_rank0"
        )

        assert sorted(_candidate_paths(client, instance_id)) == [
            "2026_07_28_18_04_24_rank0",
            "2026_07_28_18_04_24_rank1",
        ]

    def test_a_parent_that_went_away_lists_no_reports_but_names_itself(
        self, app, client, tmp_path
    ):
        """An empty list would read as "no siblings" and clear every comparison."""
        parent = tmp_path / "missing"
        instance_id = _instance_on_performance_report(app, "gone", parent / "active")

        assert _candidates(client, instance_id) == {
            "directory": str(parent),
            "reports": None,
        }

    @pytest.mark.skipif(_RUNNING_AS_ROOT, reason="root reads a mode-0311 folder")
    def test_an_unreadable_parent_lists_no_reports_but_names_itself(
        self, app, client, tmp_path
    ):
        """Searchable but unreadable: `?name=` still reads from it."""
        runs = tmp_path / "runs"
        _make_performance_report(runs, "active")
        instance_id = _instance_on_performance_report(app, "0311", runs / "active")
        runs.chmod(0o311)

        try:
            assert _candidates(client, instance_id) == {
                "directory": str(runs),
                "reports": None,
            }
        finally:
            runs.chmod(0o755)

    def test_the_listing_names_the_directory_it_was_read_from(
        self, app, client, tmp_path
    ):
        runs = tmp_path / "runs"
        _make_performance_report(runs, "active")
        instance_id = _instance_on_performance_report(app, "dir", runs / "active")

        assert _candidates(client, instance_id)["directory"] == str(runs)

    @pytest.mark.parametrize("name", [" padded ", "back\\slash"])
    def test_a_folder_name_that_does_not_resolve_to_itself_is_not_listed(
        self, app, client, tmp_path, name
    ):
        """`?name=` trims and splits on backslashes, so it would read another folder."""
        runs = tmp_path / "runs"
        _make_performance_report(runs, "active")
        _make_performance_report(runs, name)
        instance_id = _instance_on_performance_report(app, "names", runs / "active")

        assert _candidate_paths(client, instance_id) == ["active"]

    @pytest.mark.skipif(_RUNNING_AS_ROOT, reason="root reads a mode-000 folder")
    def test_an_unreadable_sibling_is_skipped(self, app, client, tmp_path):
        runs = tmp_path / "runs"
        _make_performance_report(runs, "active")
        _make_performance_report(runs, "locked")
        (runs / "locked").chmod(0)
        instance_id = _instance_on_performance_report(app, "locked", runs / "active")

        try:
            assert _candidate_paths(client, instance_id) == ["active"]
        finally:
            (runs / "locked").chmod(0o755)

    @pytest.mark.skipif(_RUNNING_AS_ROOT, reason="root reads a mode-000 folder")
    def test_a_sibling_symlink_into_an_unreadable_folder_is_skipped(
        self, app, client, tmp_path
    ):
        runs = tmp_path / "runs"
        _make_performance_report(runs, "active")
        _make_performance_report(tmp_path / "locked", "target")
        (runs / "linked").symlink_to(tmp_path / "locked" / "target")
        (tmp_path / "locked").chmod(0)
        instance_id = _instance_on_performance_report(app, "symlink", runs / "active")

        try:
            assert _candidate_paths(client, instance_id) == ["active"]
        finally:
            (tmp_path / "locked").chmod(0o755)

    def test_no_active_performance_report_is_not_found(self, app, client, make_report):
        response = client.get(
            COMPARISON_CANDIDATES, query_string={"instanceId": make_report()}
        )

        assert response.status_code == HTTPStatus.NOT_FOUND

    def test_every_candidate_resolves_to_itself_through_name(self, app, client):
        """A local report sharing a synced report's name must not be the one read."""
        synced = _synced_reports_root(app)
        _make_performance_report(synced, "active")
        _make_performance_report(synced, "shared-name")
        _make_performance_report(_local_reports_root(app), "shared-name")
        active = synced / "active"
        instance_id = _instance_on_performance_report(app, "resolve", active)

        for name in _candidate_paths(client, instance_id):
            instance = Instance(instance_id=instance_id, performance_path=str(active))
            with app.test_request_context(
                "/api/performance/device-log/meta", query_string={"name": name}
            ):
                _apply_requested_performance_name(instance)

            assert instance.performance_path == str(synced / name)
