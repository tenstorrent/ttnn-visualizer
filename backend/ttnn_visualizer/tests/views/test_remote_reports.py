# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import shlex
import subprocess
from http import HTTPStatus
from pathlib import Path
from typing import Optional
from unittest.mock import patch

import pytest
from ttnn_visualizer.exceptions import RemoteConnectionException
from ttnn_visualizer.models import (
    Instance,
    RemoteConnection,
    RemoteReportFolder,
    folder_segment_from_remote_path,
    split_rank_suffix,
)
from ttnn_visualizer.sftp_operations import (
    MULTIHOST_REPORT_LAYOUT_HINT,
    MULTIHOST_REPORT_PARENT_GLOB,
    TEST_PROFILER_FILE,
    _find_performance_report_folders,
    _report_search_find_expression,
    check_remote_path_for_reports,
    find_folders_by_files,
    get_remote_performance_folders,
)
from ttnn_visualizer.views import (
    _apply_requested_performance_name,
    _found_reports_message,
    _safe_report_folder_name,
)


def _remote_connection_payload():
    return {
        "name": "test-remote",
        "username": "tester",
        "host": "remote.example.com",
        "port": 22,
        "profilerPath": "/remote/profiler/reports",
        "performancePath": "/remote/performance/reports",
    }


def _write_valid_performance_report(
    report_dir: Path, *, with_tracy: bool = True
) -> None:
    report_dir.mkdir(parents=True)
    (report_dir / "profile_log_device.csv").write_text("x")
    (report_dir / "ops_perf_results_0.csv").write_text("x")
    if with_tracy:
        (report_dir / "tracy_profile_log_host.tracy").write_bytes(b"x")


def test_remote_profiler_returns_204_when_no_reports(app, client):
    app.config["SERVER_MODE"] = False

    with patch("ttnn_visualizer.views.get_remote_profiler_folders", return_value=[]):
        response = client.post(
            "/api/remote/profiler-reports", json=_remote_connection_payload()
        )

    assert response.status_code == HTTPStatus.NO_CONTENT
    assert response.data == b""


def test_remote_profiler_returns_json_when_reports_exist(app, client):
    app.config["SERVER_MODE"] = False
    app.config["REMOTE_DATA_DIRECTORY"] = Path(app.config["REMOTE_DATA_DIRECTORY"])

    folders = [
        RemoteReportFolder(
            reportName="resnet50",
            remotePath="/remote/profiler/reports/resnet50",
            lastModified=100,
            syncedName="resnet50",
        )
    ]
    expected_local_path = str(
        Path(app.config["REMOTE_DATA_DIRECTORY"])
        / "remote.example.com"
        / app.config["PROFILER_DIRECTORY_NAME"]
        / "resnet50"
    )

    with (
        patch(
            "ttnn_visualizer.views.get_remote_profiler_folders", return_value=folders
        ),
        patch(
            "ttnn_visualizer.views.read_last_synced_file", return_value=123
        ) as read_last_synced,
    ):
        response = client.post(
            "/api/remote/profiler-reports", json=_remote_connection_payload()
        )

    assert response.status_code == HTTPStatus.OK
    data = response.get_json()
    assert isinstance(data, list)
    assert len(data) == 1
    assert data[0]["reportName"] == "resnet50"
    assert data[0]["remotePath"] == "/remote/profiler/reports/resnet50"
    assert data[0]["lastModified"] == 100
    assert data[0]["lastSynced"] == 123
    read_last_synced.assert_called_once_with(expected_local_path)


def test_remote_performance_returns_204_when_no_reports(app, client):
    app.config["SERVER_MODE"] = False

    with patch("ttnn_visualizer.views.get_remote_performance_folders", return_value=[]):
        response = client.post(
            "/api/remote/performance-reports", json=_remote_connection_payload()
        )

    assert response.status_code == HTTPStatus.NO_CONTENT
    assert response.data == b""


def test_remote_performance_returns_json_when_reports_exist(app, client):
    app.config["SERVER_MODE"] = False
    app.config["REMOTE_DATA_DIRECTORY"] = Path(app.config["REMOTE_DATA_DIRECTORY"])

    folders = [
        RemoteReportFolder(
            reportName="bert",
            remotePath="/remote/performance/reports/bert",
            lastModified=200,
            syncedName="bert",
        )
    ]
    expected_local_path = str(
        Path(app.config["REMOTE_DATA_DIRECTORY"])
        / "remote.example.com"
        / app.config["PERFORMANCE_DIRECTORY_NAME"]
        / "bert"
    )

    with (
        patch(
            "ttnn_visualizer.views.get_remote_performance_folders", return_value=folders
        ),
        patch(
            "ttnn_visualizer.views.read_last_synced_file", return_value=456
        ) as read_last_synced,
    ):
        response = client.post(
            "/api/remote/performance-reports", json=_remote_connection_payload()
        )

    assert response.status_code == HTTPStatus.OK
    data = response.get_json()
    assert isinstance(data, list)
    assert len(data) == 1
    assert data[0]["reportName"] == "bert"
    assert data[0]["remotePath"] == "/remote/performance/reports/bert"
    assert data[0]["lastModified"] == 200
    assert data[0]["lastSynced"] == 456
    read_last_synced.assert_called_once_with(expected_local_path)


def test_remote_use_returns_404_when_profiler_not_synced_locally(app, client, tmp_path):
    app.config["REMOTE_DATA_DIRECTORY"] = str(tmp_path)
    app.config["SERVER_MODE"] = False

    response = client.post(
        "/api/remote/use",
        json={
            "connection": _remote_connection_payload(),
            "profiler": {
                "reportName": "resnet50",
                "remotePath": "/remote/profiler/reports/resnet50",
                "lastModified": 1,
            },
        },
    )

    assert response.status_code == HTTPStatus.NOT_FOUND
    assert "not synced locally" in response.get_json()["error"]


def test_remote_use_returns_404_when_performance_not_synced_locally(
    app, client, tmp_path
):
    app.config["REMOTE_DATA_DIRECTORY"] = str(tmp_path)
    app.config["SERVER_MODE"] = False

    response = client.post(
        "/api/remote/use",
        json={
            "connection": _remote_connection_payload(),
            "performance": {
                "reportName": "bert",
                "remotePath": "/remote/performance/reports/bert",
                "lastModified": 1,
            },
        },
    )

    assert response.status_code == HTTPStatus.NOT_FOUND
    assert "not synced locally" in response.get_json()["error"]


def test_remote_use_ok_when_profiler_synced_locally(app, client, tmp_path):
    app.config["REMOTE_DATA_DIRECTORY"] = str(tmp_path)
    app.config["SERVER_MODE"] = False
    report_dir = (
        tmp_path
        / "remote.example.com"
        / app.config["PROFILER_DIRECTORY_NAME"]
        / "resnet50"
    )
    report_dir.mkdir(parents=True)
    (report_dir / "db.sqlite").write_text("x")

    response = client.post(
        "/api/remote/use",
        json={
            "connection": _remote_connection_payload(),
            "profiler": {
                "reportName": "resnet50",
                "remotePath": "/remote/profiler/reports/resnet50",
                "lastModified": 1,
            },
        },
    )

    assert response.status_code == HTTPStatus.OK


def test_remote_use_prefers_remote_path_basename_over_display_report_name(
    app, client, tmp_path
):
    """Sync writes under Path(remotePath).name; config report_name is display-only."""
    app.config["REMOTE_DATA_DIRECTORY"] = str(tmp_path)
    app.config["SERVER_MODE"] = False
    folder_basename = "2026_07_23_12_00_00"
    report_dir = (
        tmp_path
        / "remote.example.com"
        / app.config["PROFILER_DIRECTORY_NAME"]
        / folder_basename
    )
    report_dir.mkdir(parents=True)
    (report_dir / "db.sqlite").write_text("x")

    with patch("ttnn_visualizer.views.update_instance") as update_instance:
        response = client.post(
            "/api/remote/use",
            json={
                "connection": _remote_connection_payload(),
                "profiler": {
                    "reportName": "pretty-display-name",
                    "remotePath": f"/remote/profiler/reports/{folder_basename}",
                    "lastModified": 1,
                },
            },
        )

    assert response.status_code == HTTPStatus.OK
    update_instance.assert_called_once()
    assert update_instance.call_args.kwargs["profiler_name"] == folder_basename


def test_remote_use_ok_when_performance_synced_locally(app, client, tmp_path):
    app.config["REMOTE_DATA_DIRECTORY"] = str(tmp_path)
    app.config["SERVER_MODE"] = False
    report_dir = (
        tmp_path
        / "remote.example.com"
        / app.config["PERFORMANCE_DIRECTORY_NAME"]
        / "bert"
    )
    _write_valid_performance_report(report_dir)

    with patch("ttnn_visualizer.views.update_instance") as update_instance:
        response = client.post(
            "/api/remote/use",
            json={
                "connection": _remote_connection_payload(),
                "performance": {
                    "reportName": "bert",
                    "remotePath": "/remote/performance/reports/bert",
                    "lastModified": 1,
                },
            },
        )

    assert response.status_code == HTTPStatus.OK
    update_instance.assert_called_once()
    assert update_instance.call_args.kwargs["performance_name"] == "bert"


def test_remote_use_ok_when_performance_synced_without_tracy(app, client, tmp_path):
    """TT-Metal may omit tracy_profile_log_host.tracy; mount must still succeed."""
    app.config["REMOTE_DATA_DIRECTORY"] = str(tmp_path)
    app.config["SERVER_MODE"] = False
    report_dir = (
        tmp_path
        / "remote.example.com"
        / app.config["PERFORMANCE_DIRECTORY_NAME"]
        / "2026_07_23_19_22_39"
    )
    _write_valid_performance_report(report_dir, with_tracy=False)

    with patch("ttnn_visualizer.views.update_instance") as update_instance:
        response = client.post(
            "/api/remote/use",
            json={
                "connection": _remote_connection_payload(),
                "performance": {
                    "reportName": "2026_07_23_19_22_39",
                    "remotePath": "/remote/performance/reports/2026_07_23_19_22_39",
                    "lastModified": 1,
                },
            },
        )

    assert response.status_code == HTTPStatus.OK
    update_instance.assert_called_once()


def test_remote_use_sanitises_traversal_in_remote_path(app, client, tmp_path):
    """Traversal in remotePath must not escape the connection's report base."""
    app.config["REMOTE_DATA_DIRECTORY"] = str(tmp_path)
    app.config["SERVER_MODE"] = False

    victim = (
        tmp_path / "other-host" / app.config["PERFORMANCE_DIRECTORY_NAME"] / "victim"
    )
    _write_valid_performance_report(victim)

    with patch("ttnn_visualizer.views.update_instance") as update_instance:
        response = client.post(
            "/api/remote/use",
            json={
                "connection": _remote_connection_payload(),
                "performance": {
                    "reportName": "bert",
                    "remotePath": "/remote/performance/reports/../../other-host/performance-reports/victim",
                    "lastModified": 1,
                },
            },
        )

    # Collapses to segment "victim" under remote.example.com — not the other host.
    assert response.status_code == HTTPStatus.NOT_FOUND
    assert "not synced locally" in response.get_json()["error"]
    update_instance.assert_not_called()


def test_remote_use_rejects_dotdot_remote_path_segment(app, client, tmp_path):
    app.config["REMOTE_DATA_DIRECTORY"] = str(tmp_path)
    app.config["SERVER_MODE"] = False

    response = client.post(
        "/api/remote/use",
        json={
            "connection": _remote_connection_payload(),
            "performance": {
                "reportName": "bert",
                "remotePath": "/remote/performance/reports/..",
                "lastModified": 1,
            },
        },
    )

    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert "Invalid report path" in response.get_json()["error"]


def test_remote_use_rejects_empty_remote_path_without_report_name_fallback(
    app, client, tmp_path
):
    """Explicit empty/root remotePath must not mount via display reportName."""
    app.config["REMOTE_DATA_DIRECTORY"] = str(tmp_path)
    app.config["SERVER_MODE"] = False

    response = client.post(
        "/api/remote/use",
        json={
            "connection": _remote_connection_payload(),
            "performance": {
                "reportName": "bert",
                "remotePath": "/",
                "lastModified": 1,
            },
        },
    )

    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert "Invalid report path" in response.get_json()["error"]


def test_folder_segment_parity_between_sync_and_mount():
    """Sync write segment and mount lookup must agree after sanitiser rewrites."""
    cases = [
        r"/remote/reports/foo\bar",
        "/remote/reports/ spaced ",
        "/remote/reports/café",
        "/remote/reports/normal_name",
        "/remote/ttrun/rank0/reports/2025_02_24_23_17_27",
        "/remote/ttrun/rank11/reports/ spaced ",
    ]
    # Qualification is opt-in, so the two sides have to agree under both settings.
    for qualify_rank in (False, True):
        for remote_path in cases:
            sync_segment = folder_segment_from_remote_path(
                remote_path, qualify_rank=qualify_rank
            )
            mount_segment = _safe_report_folder_name(
                report_name="display-only",
                remote_path=remote_path,
                qualify_rank=qualify_rank,
            )
            assert sync_segment is not None
            assert sync_segment == mount_segment


def test_remote_sync_rejects_dotdot_remote_path_segment(app, client, tmp_path):
    """Sync must refuse ``..`` before mkdir — same segment boundary as /remote/use."""
    app.config["SERVER_MODE"] = False
    app.config["REPORT_DATA_DIRECTORY"] = str(tmp_path)
    app.config["REMOTE_DATA_DIRECTORY"] = str(tmp_path / "remote")

    with patch(
        "ttnn_visualizer.sftp_operations.sync_files_and_directories"
    ) as sync_files:
        response = client.post(
            "/api/remote/sync",
            json={
                "connection": _remote_connection_payload(),
                "performance": {
                    "reportName": "bert",
                    "remotePath": "/remote/performance/reports/..",
                    "lastModified": 1,
                },
            },
        )

    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert "Invalid report path" in response.get_json()["error"]
    sync_files.assert_not_called()

    host_root = tmp_path / "remote" / "remote.example.com"
    assert not host_root.exists()


def test_remote_use_forbidden_when_server_mode(app, client):
    """Mounting a locally synced remote report is @local_only under SERVER_MODE."""
    assert app.config["SERVER_MODE"] is True

    response = client.post(
        "/api/remote/use",
        json={
            "connection": _remote_connection_payload(),
            "performance": {
                "reportName": "bert",
                "remotePath": "/remote/performance/reports/bert",
                "lastModified": 1,
            },
        },
    )

    assert response.status_code == HTTPStatus.FORBIDDEN


def test_remote_profiler_reports_forbidden_when_server_mode(app, client):
    assert app.config["SERVER_MODE"] is True

    response = client.post(
        "/api/remote/profiler-reports", json=_remote_connection_payload()
    )

    assert response.status_code == HTTPStatus.FORBIDDEN


def test_remote_performance_reports_forbidden_when_server_mode(app, client):
    assert app.config["SERVER_MODE"] is True

    response = client.post(
        "/api/remote/performance-reports", json=_remote_connection_payload()
    )

    assert response.status_code == HTTPStatus.FORBIDDEN


def test_remote_test_forbidden_when_server_mode(app, client):
    assert app.config["SERVER_MODE"] is True

    response = client.post("/api/remote/test", json=_remote_connection_payload())

    assert response.status_code == HTTPStatus.FORBIDDEN


def test_remote_sync_forbidden_when_server_mode(app, client):
    assert app.config["SERVER_MODE"] is True

    response = client.post(
        "/api/remote/sync",
        json={
            "connection": _remote_connection_payload(),
            "profiler": {
                "reportName": "resnet50",
                "remotePath": "/remote/profiler/reports/resnet50",
                "lastModified": 1,
            },
        },
    )

    assert response.status_code == HTTPStatus.FORBIDDEN


class TestMultihostPerformanceDiscovery:
    """`tt-run --tracy` nests each rank's reports one level below performancePath."""

    MULTIHOST_ROOT = "/remote/generated/profiler/ttrun"

    @staticmethod
    def _connection(multihost: bool) -> RemoteConnection:
        return RemoteConnection(
            name="test-remote",
            username="tester",
            host="remote.example.com",
            port=22,
            profilerPath="/remote/profiler/reports",
            performancePath="/remote/performance/reports",
            multihostPerformance=multihost,
        )

    @staticmethod
    def _find_command(mock_run) -> str:
        """Remote shell command of the first ssh call — the directory listing."""
        return mock_run.call_args_list[0][0][0][-1]

    @staticmethod
    def _expression(root: str) -> str:
        return _report_search_find_expression(
            root, MULTIHOST_REPORT_PARENT_GLOB, [TEST_PROFILER_FILE]
        )

    @staticmethod
    def _completed(stdout: str) -> subprocess.CompletedProcess:
        return subprocess.CompletedProcess(
            args=["ssh"], returncode=0, stdout=stdout, stderr=""
        )

    def test_defaults_to_reports_directly_under_root(self):
        listing = f"{self.MULTIHOST_ROOT}/report_a\n{self.MULTIHOST_ROOT}/report_b\n"

        with patch("subprocess.run", return_value=self._completed(listing)) as run:
            matched = find_folders_by_files(
                self._connection(multihost=False),
                self.MULTIHOST_ROOT,
                [TEST_PROFILER_FILE],
            )

        find_command = self._find_command(run)
        assert "-mindepth 1 -maxdepth 1" in find_command
        assert "-path" not in find_command
        assert matched == [
            f"{self.MULTIHOST_ROOT}/report_a",
            f"{self.MULTIHOST_ROOT}/report_b",
        ]

    def test_rank_glob_searches_each_ranks_reports_directory(self):
        listing = (
            f"{self.MULTIHOST_ROOT}/rank0/reports/report_a\n"
            f"{self.MULTIHOST_ROOT}/rank1/reports/report_b\n"
        )

        with patch("subprocess.run", return_value=self._completed(listing)) as run:
            matched = find_folders_by_files(
                self._connection(multihost=True),
                self.MULTIHOST_ROOT,
                [TEST_PROFILER_FILE],
                subdirectory_glob=MULTIHOST_REPORT_PARENT_GLOB,
            )

        find_command = self._find_command(run)
        # One level per glob segment plus the report directory itself.
        assert "-mindepth 3 -maxdepth 3" in find_command
        assert (
            f"-path '{self.MULTIHOST_ROOT}/{MULTIHOST_REPORT_PARENT_GLOB}/*'"
            in find_command
        )
        # mindepth already excludes the root, so the old -not -path guard is gone.
        assert "-not -path" not in find_command
        assert matched == [
            f"{self.MULTIHOST_ROOT}/rank0/reports/report_a",
            f"{self.MULTIHOST_ROOT}/rank1/reports/report_b",
        ]

    def test_a_trailing_slash_in_the_root_is_normalised_away(self):
        """Only GNU `find` collapses it, and the search runs on the remote Linux host."""
        expression = self._expression(f"{self.MULTIHOST_ROOT}/")

        assert (
            f"-path '{self.MULTIHOST_ROOT}/{MULTIHOST_REPORT_PARENT_GLOB}/*'"
            in expression
        )
        assert f"find {self.MULTIHOST_ROOT} " in expression
        assert "//" not in expression

    def test_a_root_of_only_slashes_still_searches_the_filesystem_root(self):
        expression = self._expression("//")

        assert "find / -mindepth 3 -maxdepth 3" in expression
        assert f"-path '/{MULTIHOST_REPORT_PARENT_GLOB}/*'" in expression

    def test_the_report_file_test_runs_inside_find(self):
        """One round trip per search: no per-candidate `test -f` over its own SSH."""
        expression = self._expression(self.MULTIHOST_ROOT)

        assert (
            f"-exec test -f '{{}}/{TEST_PROFILER_FILE}' ';'" in expression
            or f"-exec test -f {{}}/{TEST_PROFILER_FILE} ';'" in expression
        )
        assert expression.rstrip().endswith("-print")

    def test_a_root_containing_a_quote_cannot_break_out_of_the_command(self):
        expression = self._expression("/remote/it's/ttrun")

        # `shlex.quote` escapes by closing, escaping and reopening the quoting.
        assert "/remote/it's/ttrun" not in expression
        assert shlex.quote("/remote/it's/ttrun") in expression

    def test_single_round_trip_regardless_of_candidate_count(self):
        listing = "".join(
            f"{self.MULTIHOST_ROOT}/rank{rank}/reports/report_a\n" for rank in range(40)
        )

        with patch("subprocess.run", return_value=self._completed(listing)) as run:
            matched = find_folders_by_files(
                self._connection(multihost=True),
                self.MULTIHOST_ROOT,
                [TEST_PROFILER_FILE],
                subdirectory_glob=MULTIHOST_REPORT_PARENT_GLOB,
            )

        assert len(matched) == 40
        assert run.call_count == 1

    def test_reports_survive_an_unreadable_sibling_directory(self):
        """`find` exits nonzero for a subtree it cannot read, having printed the rest."""
        found = f"{self.MULTIHOST_ROOT}/rank0/reports/report_a"
        denied = subprocess.CompletedProcess(
            args=["ssh"],
            returncode=1,
            stdout=f"{found}\n",
            stderr=f"find: '{self.MULTIHOST_ROOT}/locked': Permission denied\n",
        )

        with patch("subprocess.run", return_value=denied):
            matched = find_folders_by_files(
                self._connection(multihost=True),
                self.MULTIHOST_ROOT,
                [TEST_PROFILER_FILE],
                subdirectory_glob=MULTIHOST_REPORT_PARENT_GLOB,
            )

        assert matched == [found]

    def test_permission_errors_name_the_directory_that_was_unreadable(self):
        """Only raised when nothing matched, and never blamed on a readable root."""
        locked = f"{self.MULTIHOST_ROOT}/rank0"
        denied = subprocess.CompletedProcess(
            args=["ssh"],
            returncode=1,
            stdout="",
            stderr=f"find: '{locked}': Permission denied\n",
        )

        with (
            patch("subprocess.run", return_value=denied),
            pytest.raises(RemoteConnectionException) as excinfo,
        ):
            find_folders_by_files(
                self._connection(multihost=True),
                self.MULTIHOST_ROOT,
                [TEST_PROFILER_FILE],
                subdirectory_glob=MULTIHOST_REPORT_PARENT_GLOB,
            )

        assert locked in excinfo.value.message

    def test_candidates_the_glob_admits_but_cannot_be_ranked_are_dropped(self, app):
        """Glob syntax cannot say "digits only", so the regex has the final word.

        A listed folder whose rank cannot be read back would sync to an
        unqualified segment and collide with the other ranks of the same launch,
        so it must never reach the picker.
        """
        listing = (
            f"{self.MULTIHOST_ROOT}/rank0/reports/report_a\n"
            f"{self.MULTIHOST_ROOT}/rank0beta/reports/report_a\n"
        )

        with (
            app.app_context(),
            patch("subprocess.run", return_value=self._completed(listing)) as run,
        ):
            matched = _find_performance_report_folders(self._connection(multihost=True))

        assert matched == [f"{self.MULTIHOST_ROOT}/rank0/reports/report_a"]
        # The near miss cost nothing: discovery is a single remote command.
        assert run.call_count == 1

    def test_performance_listing_uses_rank_glob_when_flag_set(self, app):
        connection = self._connection(multihost=True)

        with (
            app.app_context(),
            patch(
                "ttnn_visualizer.sftp_operations.find_folders_by_files",
                return_value=[],
            ) as find_folders,
        ):
            get_remote_performance_folders(connection)

        assert (
            find_folders.call_args.kwargs["subdirectory_glob"]
            == MULTIHOST_REPORT_PARENT_GLOB
        )

    def test_performance_listing_unchanged_when_flag_unset(self, app):
        connection = self._connection(multihost=False)

        with (
            app.app_context(),
            patch(
                "ttnn_visualizer.sftp_operations.find_folders_by_files",
                return_value=[],
            ) as find_folders,
        ):
            get_remote_performance_folders(connection)

        assert "subdirectory_glob" not in find_folders.call_args.kwargs

    def test_connection_test_searches_deeper_for_performance_only(self, app):
        connection = self._connection(multihost=True)

        with (
            app.app_context(),
            patch(
                "ttnn_visualizer.sftp_operations.find_folders_by_files",
                return_value=["/remote/match"],
            ) as find_folders,
        ):
            assert check_remote_path_for_reports(connection) == (1, 1)

        profiler_call, performance_call = find_folders.call_args_list
        assert profiler_call.args[1] == connection.profilerPath
        assert "subdirectory_glob" not in profiler_call.kwargs
        assert performance_call.args[1] == connection.performancePath
        assert (
            performance_call.kwargs["subdirectory_glob"] == MULTIHOST_REPORT_PARENT_GLOB
        )

    def test_connection_test_warning_names_the_expected_multihost_layout(self, app):
        """Pointing at the parent of the per-rank folders must say so, not just fail."""
        connection = self._connection(multihost=True)

        with (
            app.app_context(),
            patch(
                "ttnn_visualizer.sftp_operations.find_folders_by_files",
                return_value=[],
            ),
            pytest.raises(RemoteConnectionException) as excinfo,
        ):
            check_remote_path_for_reports(connection)

        message = excinfo.value.message
        assert connection.performancePath in message
        assert f"{MULTIHOST_REPORT_LAYOUT_HINT}/<report>" in message
        # The glob is `find` syntax; users get the readable spelling.
        assert MULTIHOST_REPORT_PARENT_GLOB not in message

    def test_connection_test_warning_omits_the_hint_for_single_host(self, app):
        connection = self._connection(multihost=False)

        with (
            app.app_context(),
            patch(
                "ttnn_visualizer.sftp_operations.find_folders_by_files",
                return_value=[],
            ),
            pytest.raises(RemoteConnectionException) as excinfo,
        ):
            check_remote_path_for_reports(connection)

        assert MULTIHOST_REPORT_LAYOUT_HINT not in excinfo.value.message

    def test_flag_reaches_discovery_and_rank_report_round_trips(self, app, client):
        """End to end: the flag deserializes and the rank qualifies the local folder."""
        app.config["SERVER_MODE"] = False

        folders = [
            RemoteReportFolder(
                reportName="bert",
                remotePath=f"{self.MULTIHOST_ROOT}/rank1/reports/bert_2026_01_01",
                lastModified=200,
                syncedName="bert_2026_01_01_rank1",
            )
        ]
        expected_local_path = str(
            Path(app.config["REMOTE_DATA_DIRECTORY"])
            / "remote.example.com"
            / app.config["PERFORMANCE_DIRECTORY_NAME"]
            / "bert_2026_01_01_rank1"
        )

        with (
            patch(
                "ttnn_visualizer.views.get_remote_performance_folders",
                return_value=folders,
            ) as list_folders,
            patch(
                "ttnn_visualizer.views.read_last_synced_file", return_value=456
            ) as read_last_synced,
        ):
            response = client.post(
                "/api/remote/performance-reports",
                json={
                    **_remote_connection_payload(),
                    "performancePath": self.MULTIHOST_ROOT,
                    "multihostPerformance": True,
                },
            )

        assert response.status_code == HTTPStatus.OK
        assert list_folders.call_args.args[0].multihostPerformance is True
        data = response.get_json()
        assert (
            data[0]["remotePath"]
            == f"{self.MULTIHOST_ROOT}/rank1/reports/bert_2026_01_01"
        )
        read_last_synced.assert_called_once_with(expected_local_path)

    def test_saved_connections_without_the_flag_stay_valid(self):
        """`remote_connection` is a JSON column, so the default keeps old payloads loading."""
        connection = RemoteConnection.model_validate(
            _remote_connection_payload(), strict=False
        )

        assert connection.multihostPerformance is False


class TestRankQualifiedLocalFolders:
    """Every rank of one `tt-run` launch can name its report the same thing."""

    SAME_TIMESTAMP = "2025_02_24_23_17_27"

    def _segment(self, rank: str) -> str:
        segment = folder_segment_from_remote_path(
            f"/remote/generated/profiler/ttrun/{rank}/reports/{self.SAME_TIMESTAMP}",
            qualify_rank=True,
        )
        assert segment is not None
        return segment

    def test_identical_timestamps_across_ranks_stay_distinct(self):
        """Regression: both ranks synced into one folder and overwrote each other."""
        assert self._segment("rank0") == f"{self.SAME_TIMESTAMP}_rank0"
        assert self._segment("rank1") == f"{self.SAME_TIMESTAMP}_rank1"
        assert self._segment("rank0") != self._segment("rank1")

    def test_segment_stays_a_single_path_component(self):
        """Callers join this straight onto the report directory and expect siblings."""
        segment = self._segment("rank0")

        assert "/" not in segment
        assert Path(segment).name == segment

    def test_single_host_paths_are_unchanged(self):
        """No churn for existing synced folders or stored instance paths."""
        assert (
            folder_segment_from_remote_path(
                f"/remote/generated/profiler/reports/{self.SAME_TIMESTAMP}",
                qualify_rank=True,
            )
            == self.SAME_TIMESTAMP
        )

    def test_rank_is_normalised_from_the_number_not_the_directory(self):
        """One rank gets one local folder, however the remote spells it."""
        assert self._segment("rank10") == f"{self.SAME_TIMESTAMP}_rank10"
        assert self._segment("RANK7") == f"{self.SAME_TIMESTAMP}_rank7"
        assert (
            self._segment("Rank0") == self._segment("rank0") == self._segment("rank00")
        )

    def test_a_normalised_name_reads_back_as_the_same_rank(self):
        """Sync writes the segment, the offline listing splits it: the two must agree."""
        segment = self._segment("RANK7")

        assert split_rank_suffix(segment) == (self.SAME_TIMESTAMP, 7)

    def test_folders_synced_before_normalisation_still_read_back(self):
        """`_RANK7` is on disk from earlier builds and must not become rank-less."""
        assert split_rank_suffix(f"{self.SAME_TIMESTAMP}_RANK7") == (
            self.SAME_TIMESTAMP,
            7,
        )

    def test_a_rank_directory_itself_is_not_doubled(self):
        """Guard the degenerate case where the report dir *is* the rank dir."""
        assert folder_segment_from_remote_path("/remote/ttrun/rank0") == "rank0"

    def test_a_doubled_separator_is_tolerated(self):
        """A hand-edited path can carry one, and `find` echoes what it is given."""
        assert (
            folder_segment_from_remote_path(
                f"/remote/ttrun//rank0/reports/{self.SAME_TIMESTAMP}",
                qualify_rank=True,
            )
            == f"{self.SAME_TIMESTAMP}_rank0"
        )

    def test_non_rank_directories_do_not_qualify(self):
        assert (
            folder_segment_from_remote_path(
                "/remote/ranked_reports/report_a", qualify_rank=True
            )
            == "report_a"
        )


class TestSyncedNameOnTheWire:
    """The server owns the synced folder name; the client reads it back."""

    MULTIHOST_ROOT = "/remote/generated/profiler/ttrun"
    TIMESTAMP = "2026_07_28_18_04_24"

    def _listing(self, app, *, multihost: bool) -> list:
        paths = [
            f"{self.MULTIHOST_ROOT}/rank0/reports/{self.TIMESTAMP}",
            f"{self.MULTIHOST_ROOT}/rank1/reports/{self.TIMESTAMP}",
        ]
        connection = RemoteConnection(
            name="test-remote",
            username="tester",
            host="remote.example.com",
            port=22,
            profilerPath="/remote/profiler/reports",
            performancePath=self.MULTIHOST_ROOT,
            multihostPerformance=multihost,
        )

        with (
            app.app_context(),
            patch(
                "ttnn_visualizer.sftp_operations._find_performance_report_folders",
                return_value=paths,
            ),
            patch(
                "ttnn_visualizer.sftp_operations._remote_directory_mtimes",
                return_value=[10, 20],
            ),
        ):
            return get_remote_performance_folders(connection)

    def test_each_rank_carries_its_own_synced_name_and_rank(self, app):
        folders = {
            folder.remotePath: folder for folder in self._listing(app, multihost=True)
        }

        rank0 = folders[f"{self.MULTIHOST_ROOT}/rank0/reports/{self.TIMESTAMP}"]
        rank1 = folders[f"{self.MULTIHOST_ROOT}/rank1/reports/{self.TIMESTAMP}"]

        assert rank0.syncedName == f"{self.TIMESTAMP}_rank0"
        assert rank1.syncedName == f"{self.TIMESTAMP}_rank1"
        assert (rank0.rank, rank1.rank) == (0, 1)
        # The display name stays the report's own; only the local name is qualified.
        assert rank0.reportName == rank1.reportName == self.TIMESTAMP

    def test_single_host_listings_are_left_alone(self, app):
        for folder in self._listing(app, multihost=False):
            assert folder.syncedName == self.TIMESTAMP
            assert folder.rank is None

    def test_mtimes_are_read_in_one_batch(self, app):
        """A rank-heavy tree cannot be worth one SSH handshake per report."""
        folders = self._listing(app, multihost=True)

        assert sorted(folder.lastModified for folder in folders) == [10, 20]

    def test_the_wire_name_survives_a_json_round_trip(self, app):
        """`/remote/use` and the picker both read these off the response."""
        folder = self._listing(app, multihost=True)[0]

        payload = folder.model_dump()

        assert (
            payload["syncedName"]
            == RemoteReportFolder.model_validate(payload).syncedName
        )


class TestPerformanceNameSwap:
    """`?name=` carries the synced folder name the listing handed the client."""

    TIMESTAMP = "2026_07_28_18_04_24"

    def _reports_directory(self, tmp_path: Path, *names: str) -> Path:
        reports = tmp_path / "performance-reports"
        for name in names:
            (reports / name).mkdir(parents=True)
        return reports

    def _swap(self, app, active_path: Path, name: Optional[str]) -> Optional[str]:
        instance = Instance(
            instance_id="test-instance", performance_path=str(active_path)
        )
        query = f"?name={name}" if name is not None else ""

        with app.test_request_context(f"/api/performance/device-log/meta{query}"):
            app.config["SERVER_MODE"] = False
            _apply_requested_performance_name(instance)

        return instance.performance_path

    def test_a_rank_qualified_name_resolves_to_that_rank(self, app):
        """The client sends the synced name, so no rank has to be guessed at."""
        reports = self._reports_directory(
            Path(app.config["REMOTE_DATA_DIRECTORY"]),
            f"{self.TIMESTAMP}_rank0",
            f"{self.TIMESTAMP}_rank1",
        )

        resolved = self._swap(
            app, reports / f"{self.TIMESTAMP}_rank0", f"{self.TIMESTAMP}_rank1"
        )

        assert resolved == str(reports / f"{self.TIMESTAMP}_rank1")

    def test_a_bare_name_is_never_answered_with_a_rank(self, app):
        """Regression: falling back to the active rank could serve other numbers.

        A stale caller sending the unqualified name gets the usual not-found
        rather than whichever rank happens to be loaded.
        """
        reports = self._reports_directory(
            Path(app.config["REMOTE_DATA_DIRECTORY"]), f"{self.TIMESTAMP}_rank1"
        )

        resolved = self._swap(app, reports / f"{self.TIMESTAMP}_rank1", self.TIMESTAMP)

        assert resolved == str(reports / self.TIMESTAMP)

    def test_single_host_swaps_are_unchanged(self, app):
        other = "2026_07_28_19_00_00"
        reports = self._reports_directory(
            Path(app.config["REMOTE_DATA_DIRECTORY"]), self.TIMESTAMP, other
        )

        resolved = self._swap(app, reports / self.TIMESTAMP, other)

        assert resolved == str(reports / other)

    def test_a_traversing_name_stays_inside_the_reports_directory(self, app):
        """The only choke point for `?name=`, so it collapses the value itself."""
        reports = self._reports_directory(
            Path(app.config["REMOTE_DATA_DIRECTORY"]), self.TIMESTAMP
        )

        resolved = self._swap(app, reports / self.TIMESTAMP, f"../../{self.TIMESTAMP}")

        assert resolved == str(reports / self.TIMESTAMP)

    def test_a_degenerate_name_leaves_the_active_report_alone(self, app):
        reports = self._reports_directory(
            Path(app.config["REMOTE_DATA_DIRECTORY"]), self.TIMESTAMP
        )
        active = reports / self.TIMESTAMP

        assert self._swap(app, active, "..") == str(active)

    def test_no_name_leaves_the_active_report_alone(self, app):
        reports = self._reports_directory(
            Path(app.config["REMOTE_DATA_DIRECTORY"]), self.TIMESTAMP
        )
        active = reports / self.TIMESTAMP

        assert self._swap(app, active, None) == str(active)

    def test_server_mode_ignores_the_swap_entirely(self, app):
        """Hosted instances serve only what was uploaded for the instance."""
        reports = self._reports_directory(
            Path(app.config["REMOTE_DATA_DIRECTORY"]), self.TIMESTAMP, "other"
        )
        active = reports / self.TIMESTAMP
        instance = Instance(instance_id="test-instance", performance_path=str(active))

        with app.test_request_context("/api/performance/device-log/meta?name=other"):
            app.config["SERVER_MODE"] = True
            _apply_requested_performance_name(instance)

        assert instance.performance_path == str(active)


class TestConnectionTestReportStatuses:
    """A path that exists says nothing about reports being found there."""

    @staticmethod
    def _messages(response) -> list[str]:
        return [status["message"] for status in response.get_json()]

    def _run_connection_test(self, client, payload, *, folders_per_path):
        with (
            patch("ttnn_visualizer.views.test_ssh_connection", return_value=True),
            patch("ttnn_visualizer.views.check_remote_path_exists", return_value=True),
            patch(
                "ttnn_visualizer.sftp_operations.find_folders_by_files",
                side_effect=folders_per_path,
            ),
        ):
            return client.post("/api/remote/test", json=payload)

    def test_reports_found_counts_are_confirmed(self, app, client):
        app.config["SERVER_MODE"] = False

        response = self._run_connection_test(
            client,
            _remote_connection_payload(),
            folders_per_path=[["/a", "/b", "/c"], ["/x", "/y"]],
        )

        assert response.status_code == HTTPStatus.OK
        messages = self._messages(response)
        assert "Found 3 memory reports" in messages
        assert "Found 2 performance reports" in messages

    def test_multihost_confirms_the_per_rank_search(self, app, client):
        app.config["SERVER_MODE"] = False

        response = self._run_connection_test(
            client,
            {
                **_remote_connection_payload(),
                "performancePath": "/remote/generated/profiler/ttrun",
                "multihostPerformance": True,
            },
            folders_per_path=[["/a"], ["/ttrun/rank0/report", "/ttrun/rank1/report"]],
        )

        messages = self._messages(response)
        assert "Found 2 performance reports in per-rank subdirectories" in messages

    def test_unconfigured_performance_path_is_not_reported(self, app, client):
        app.config["SERVER_MODE"] = False
        payload = _remote_connection_payload()
        del payload["performancePath"]

        response = self._run_connection_test(client, payload, folders_per_path=[["/a"]])

        messages = self._messages(response)
        assert "Found 1 memory report" in messages
        assert not any("performance report" in message for message in messages)

    def test_single_report_is_not_pluralised(self):
        assert _found_reports_message("performance", 1) == "Found 1 performance report"
        assert (
            _found_reports_message("performance", 1, in_rank_subdirectories=True)
            == "Found 1 performance report in per-rank subdirectories"
        )


class TestReportSearchAgainstRealFind:
    """Run the emitted expression through a local ``find``.

    Discovery filtering happens remotely, so mocked-subprocess tests can only
    pin the command text. These exercise the real ``find`` semantics — the
    ``-mindepth``/``-maxdepth``/``-path`` combination is where the interesting
    behaviour lives, and both GNU and BSD ``find`` support all three.
    """

    @staticmethod
    def _profiler_tree(tmp_path: Path) -> Path:
        """A tt-metal profiler directory holding both single-host and multihost output.

        ``tt-run --tracy`` gives each rank a copy of the profiler root, so every
        rank has its own ``.logs`` holding the raw profile_log_device.csv beside
        the processed ``reports/<report>``. Both contain that CSV, which is why
        discovery cannot match on the CSV alone.
        """
        profiler = tmp_path / "generated" / "profiler"
        for report_dir in (
            profiler / "reports" / "single_host_report",
            profiler / ".logs",
            profiler / "ttrun" / "rank0" / "reports" / "report_a",
            profiler / "ttrun" / "rank0" / ".logs",
            profiler / "ttrun" / "rank1" / "reports" / "report_b",
            profiler / "ttrun" / "rank1" / ".logs",
        ):
            report_dir.mkdir(parents=True)
            (report_dir / TEST_PROFILER_FILE).write_text("x")
        return profiler

    @staticmethod
    def _expression(root: str, subdirectory_glob: Optional[str]) -> str:
        return _report_search_find_expression(
            root, subdirectory_glob, [TEST_PROFILER_FILE]
        )

    @staticmethod
    def _run_find(expression: str) -> list[str]:
        result = subprocess.run(
            expression, shell=True, capture_output=True, text=True, check=True
        )
        return sorted(line for line in result.stdout.splitlines() if line)

    def test_multihost_search_finds_every_rank_report(self, tmp_path):
        profiler = self._profiler_tree(tmp_path)
        ttrun = profiler / "ttrun"

        found = self._run_find(
            self._expression(str(ttrun), MULTIHOST_REPORT_PARENT_GLOB)
        )

        assert found == [
            str(ttrun / "rank0" / "reports" / "report_a"),
            str(ttrun / "rank1" / "reports" / "report_b"),
        ]

    def test_multihost_search_ignores_each_ranks_raw_logs(self, tmp_path):
        """Regression: `.logs` holds the raw CSV and was listed as a report."""
        profiler = self._profiler_tree(tmp_path)
        ttrun = profiler / "ttrun"

        found = self._run_find(
            self._expression(str(ttrun), MULTIHOST_REPORT_PARENT_GLOB)
        )

        assert not any(".logs" in path for path in found)

    def test_multihost_search_ignores_reports_under_a_non_rank_sibling(self, tmp_path):
        """Regression: pointing above ttrun used to list single-host reports instead.

        ``generated/profiler/reports/<report>`` sits at the same depth as
        ``generated/profiler/ttrun/rank0``, so depth alone matched it and the
        picker silently showed single-host reports.
        """
        profiler = self._profiler_tree(tmp_path)

        found = self._run_find(
            self._expression(str(profiler), MULTIHOST_REPORT_PARENT_GLOB)
        )

        assert found == []

    def test_trailing_slash_root_still_matches_rank_reports(self, tmp_path):
        """A configured trailing slash must not silently stop matching.

        GNU and BSD ``find`` disagree on whether the echoed root keeps the
        slash, so the root and the pattern are normalised together rather than
        the pattern being written for one implementation's output.
        """
        profiler = self._profiler_tree(tmp_path)
        ttrun = profiler / "ttrun"

        found = self._run_find(
            self._expression(f"{ttrun}/", MULTIHOST_REPORT_PARENT_GLOB)
        )

        assert f"{ttrun}/rank0/reports/report_a" in found
        assert not any("//" in directory for directory in found)

    def test_single_host_search_lists_immediate_children_only(self, tmp_path):
        profiler = self._profiler_tree(tmp_path)
        reports = profiler / "reports"

        found = self._run_find(self._expression(str(reports), None))

        assert found == [str(reports / "single_host_report")]

    def test_single_host_search_does_not_reach_rank_reports(self, tmp_path):
        """With the flag off, ttrun's rank directories hold no report CSV of their own."""
        profiler = self._profiler_tree(tmp_path)
        ttrun = profiler / "ttrun"

        found = self._run_find(self._expression(str(ttrun), None))

        assert found == []

    def test_multihost_search_ignores_the_single_host_reports_directory(self, tmp_path):
        """`<root>/reports/<report>` must not match when root is not the rank parent."""
        profiler = self._profiler_tree(tmp_path)

        found = self._run_find(
            self._expression(str(profiler), MULTIHOST_REPORT_PARENT_GLOB)
        )

        assert found == []
