# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""
Tests for the SFTP file-listing parser used by remote sync.

These focus on the NUL-terminated ``find -printf`` parser introduced for
size-aware listings, plus its fallback path when the remote ``find`` lacks
``-printf`` support. Subprocess is mocked end-to-end so the tests do not
need network access or a real SSH server.
"""

import shlex
import subprocess
from http import HTTPStatus
from unittest.mock import patch

import pytest
from ttnn_visualizer.enums import SyncMethod
from ttnn_visualizer.exceptions import (
    AuthenticationException,
    HostKeyVerificationException,
    NoValidConnectionsError,
    RemoteConnectionException,
)
from ttnn_visualizer.models import RemoteConnection
from ttnn_visualizer.sftp_operations import (
    _get_remote_file_list_without_sizes,
    _remote_transfer_key,
    _sftp_subsystem_unavailable,
    get_remote_directory_list,
    get_remote_file_list,
    sync_files_and_directories,
)
from ttnn_visualizer.sockets import FileStatus


@pytest.fixture
def connection() -> RemoteConnection:
    return RemoteConnection(
        name="test",
        username="user",
        host="example.test",
        port=22,
        profilerPath="/remote/profiler",
    )


def _completed(stdout: str) -> subprocess.CompletedProcess:
    return subprocess.CompletedProcess(
        args=["ssh"], returncode=0, stdout=stdout, stderr=""
    )


def _called_process_error(
    returncode: int = 1, stderr: str = "find: -printf: unknown"
) -> subprocess.CalledProcessError:
    return subprocess.CalledProcessError(
        returncode=returncode, cmd=["ssh"], output="", stderr=stderr
    )


def _remote_shell_command_from_run(mock_run) -> str:
    """Last argv element is the remote shell command passed to ssh."""
    return mock_run.call_args[0][0][-1]


class TestRemoteFindShellQuoting:
    """Regression: paths with single quotes must use shlex.quote, not naive '...'."""

    _APOSTROPHE_FOLDER = "/remote/o'brien/reports"

    def test_get_remote_file_list_quotes_path_with_single_quote(self, connection):
        with patch("subprocess.run", return_value=_completed("")) as run:
            get_remote_file_list(
                connection, self._APOSTROPHE_FOLDER, exclude_patterns=[]
            )

        remote_cmd = _remote_shell_command_from_run(run)
        assert shlex.quote(self._APOSTROPHE_FOLDER) in remote_cmd
        assert f"find '{self._APOSTROPHE_FOLDER}'" not in remote_cmd

    def test_get_remote_file_list_without_sizes_quotes_path_with_single_quote(
        self, connection
    ):
        with patch("subprocess.run", return_value=_completed("")) as run:
            _get_remote_file_list_without_sizes(
                connection, self._APOSTROPHE_FOLDER, exclude_patterns=[]
            )

        remote_cmd = _remote_shell_command_from_run(run)
        assert shlex.quote(self._APOSTROPHE_FOLDER) in remote_cmd
        assert f"find '{self._APOSTROPHE_FOLDER}'" not in remote_cmd

    def test_get_remote_directory_list_quotes_path_with_single_quote(self, connection):
        with patch("subprocess.run", return_value=_completed("")) as run:
            get_remote_directory_list(
                connection, self._APOSTROPHE_FOLDER, exclude_patterns=[]
            )

        remote_cmd = _remote_shell_command_from_run(run)
        assert shlex.quote(self._APOSTROPHE_FOLDER) in remote_cmd
        assert f"find '{self._APOSTROPHE_FOLDER}'" not in remote_cmd


class TestGetRemoteFileList:
    def test_parses_size_and_path_pairs(self, connection):
        stdout = "100\t/remote/a.txt\x00200\t/remote/b.txt\x00"
        with patch("subprocess.run", return_value=_completed(stdout)):
            result = get_remote_file_list(connection, "/remote", exclude_patterns=[])
        assert result == [("/remote/a.txt", 100), ("/remote/b.txt", 200)]

    def test_path_containing_tabs_roundtrips(self, connection):
        # First tab is the size/path separator; subsequent tabs are part of
        # the filename and must be preserved. Regression for the original
        # `splitlines() + partition("\t")` bug that truncated such paths.
        stdout = "42\t/remote/has\ttabs\there.txt\x00"
        with patch("subprocess.run", return_value=_completed(stdout)):
            result = get_remote_file_list(connection, "/remote", exclude_patterns=[])
        assert result == [("/remote/has\ttabs\there.txt", 42)]

    def test_path_containing_newlines_roundtrips(self, connection):
        # NUL separator means newlines in filenames must also round-trip.
        stdout = "7\t/remote/line\nbreak.txt\x00"
        with patch("subprocess.run", return_value=_completed(stdout)):
            result = get_remote_file_list(connection, "/remote", exclude_patterns=[])
        assert result == [("/remote/line\nbreak.txt", 7)]

    def test_exclude_patterns_filter_results(self, connection):
        stdout = "100\t/remote/keep.txt\x00200\t/remote/tensors/skip.bin\x00"
        with patch("subprocess.run", return_value=_completed(stdout)):
            result = get_remote_file_list(
                connection, "/remote", exclude_patterns=["/tensors"]
            )
        assert result == [("/remote/keep.txt", 100)]

    def test_invalid_size_defaults_to_zero(self, connection):
        # A malformed size should not crash parsing — we degrade to size=0.
        stdout = "notanumber\t/remote/a.txt\x00500\t/remote/b.txt\x00"
        with patch("subprocess.run", return_value=_completed(stdout)):
            result = get_remote_file_list(connection, "/remote", exclude_patterns=[])
        assert result == [("/remote/a.txt", 0), ("/remote/b.txt", 500)]

    def test_record_without_tab_separator_is_skipped(self, connection):
        # Defensive: a malformed record (no `\t`) shouldn't blow up parsing.
        stdout = "no-tab-here\x00100\t/remote/a.txt\x00"
        with patch("subprocess.run", return_value=_completed(stdout)):
            result = get_remote_file_list(connection, "/remote", exclude_patterns=[])
        assert result == [("/remote/a.txt", 100)]

    def test_empty_output_returns_empty_list(self, connection):
        with patch("subprocess.run", return_value=_completed("")):
            result = get_remote_file_list(connection, "/remote", exclude_patterns=[])
        assert result == []

    def test_falls_back_when_printf_unsupported(self, connection):
        # BSD find rejects -printf; we should retry via the size-less path.
        primary_error = _called_process_error(
            returncode=1, stderr="find: -printf: unknown predicate"
        )
        fallback_output = _completed("/remote/a.txt\n/remote/b.txt\n")
        with patch("subprocess.run", side_effect=[primary_error, fallback_output]):
            result = get_remote_file_list(connection, "/remote", exclude_patterns=[])
        assert result == [("/remote/a.txt", 0), ("/remote/b.txt", 0)]

    def test_falls_back_for_busybox_find(self, connection):
        # BusyBox find emits a slightly different message; still -printf.
        primary_error = _called_process_error(
            returncode=1, stderr="find: unrecognized: -printf"
        )
        fallback_output = _completed("/remote/a.txt\n")
        with patch("subprocess.run", side_effect=[primary_error, fallback_output]):
            result = get_remote_file_list(connection, "/remote", exclude_patterns=[])
        assert result == [("/remote/a.txt", 0)]

    def test_permission_denied_does_not_fall_back(self, connection):
        # Regression: only `-printf` unsupported should trigger the second
        # SSH call. Permission/path errors must surface as an empty list so
        # the real cause stays visible in the logs.
        permission_error = _called_process_error(
            returncode=1,
            stderr="find: '/remote/private': Permission denied",
        )
        with patch("subprocess.run", side_effect=[permission_error]) as run:
            result = get_remote_file_list(connection, "/remote", exclude_patterns=[])
        assert result == []
        assert run.call_count == 1

    def test_missing_path_does_not_fall_back(self, connection):
        missing_error = _called_process_error(
            returncode=1,
            stderr="find: '/remote/missing': No such file or directory",
        )
        with patch("subprocess.run", side_effect=[missing_error]) as run:
            result = get_remote_file_list(connection, "/remote", exclude_patterns=[])
        assert result == []
        assert run.call_count == 1

    def test_ssh_protocol_auth_error_raises_authentication_exception(self, connection):
        # Exit 255 + auth-flavoured stderr → AuthenticationException, never a
        # silent empty-list fallback. Pinning the concrete type matters so a
        # regression that swallows or rewraps the error fails this test.
        auth_error = _called_process_error(
            returncode=255, stderr="Permission denied (publickey)."
        )
        with patch("subprocess.run", side_effect=auth_error):
            with pytest.raises(AuthenticationException):
                get_remote_file_list(connection, "/remote", exclude_patterns=[])

    def test_ssh_unknown_host_key_raises_host_key_exception(self, connection):
        host_key_error = _called_process_error(
            returncode=255,
            stderr=(
                "No ED25519 host key is known for [example.test]:45985 and you have "
                "requested strict checking.\nHost key verification failed.\n"
            ),
        )
        with patch("subprocess.run", side_effect=host_key_error):
            with pytest.raises(HostKeyVerificationException) as excinfo:
                get_remote_file_list(connection, "/remote", exclude_patterns=[])
        assert "known_hosts" in str(excinfo.value).lower()
        assert "example.test" in str(excinfo.value)

    def test_ssh_protocol_connection_error_raises_no_valid_connections(
        self, connection
    ):
        # Exit 255 + connection-flavoured stderr → NoValidConnectionsError.
        # Covers the second branch of handle_ssh_subprocess_error.
        conn_error = _called_process_error(
            returncode=255,
            stderr="ssh: connect to host example.test port 22: Connection refused",
        )
        with patch("subprocess.run", side_effect=conn_error):
            with pytest.raises(NoValidConnectionsError):
                get_remote_file_list(connection, "/remote", exclude_patterns=[])

    def test_timeout_returns_empty_list(self, connection):
        with patch(
            "subprocess.run",
            side_effect=subprocess.TimeoutExpired(cmd=["ssh"], timeout=5),
        ):
            result = get_remote_file_list(connection, "/remote", exclude_patterns=[])
        assert result == []


class TestSyncFilesAndDirectoriesEmptyListing:
    """Regression tests for the failed-listing guard.

    `get_remote_directory_list` always returns at least the folder itself when
    listing succeeds, so an empty dir list is an unambiguous failure signal
    (permission denied, missing path, etc.). The sync must raise rather than
    silently FINISH with zero files — that previously masked real errors.
    """

    def test_raises_when_directory_listing_is_empty(self, app, tmp_path, connection):
        with (
            app.app_context(),
            patch(
                "ttnn_visualizer.sftp_operations.get_remote_file_list", return_value=[]
            ),
            patch(
                "ttnn_visualizer.sftp_operations.get_remote_directory_list",
                return_value=[],
            ),
        ):
            with pytest.raises(RemoteConnectionException) as excinfo:
                sync_files_and_directories(
                    connection,
                    "/remote/missing",
                    tmp_path,
                    exclude_patterns=[],
                )

        assert "/remote/missing" in excinfo.value.message
        # The path is user-supplied input that we *could* reach but cannot
        # read at the requested location — surface as 422, not 500, so
        # alerting and toast presentation key off the right bucket.
        assert excinfo.value.http_status == HTTPStatus.UNPROCESSABLE_ENTITY

    def test_empty_directory_listing_does_not_attempt_download(
        self, app, tmp_path, connection
    ):
        with (
            app.app_context(),
            patch(
                "ttnn_visualizer.sftp_operations.get_remote_file_list", return_value=[]
            ),
            patch(
                "ttnn_visualizer.sftp_operations.get_remote_directory_list",
                return_value=[],
            ),
            patch(
                "ttnn_visualizer.sftp_operations.download_single_file_sftp"
            ) as download,
        ):
            with pytest.raises(RemoteConnectionException):
                sync_files_and_directories(
                    connection,
                    "/remote/missing",
                    tmp_path,
                    exclude_patterns=[],
                )

        assert download.call_count == 0

    def test_successful_listing_with_zero_files_is_not_an_error(
        self, app, tmp_path, connection
    ):
        # Real empty folder: find returned the folder itself but no files.
        # That's legitimate and should complete without raising. The sync
        # must also skip transfer-progress emits entirely — STARTED is an
        # *active* status on the client, so emitting it for an empty folder
        # would briefly open the overlay only to close it again.
        with (
            app.app_context(),
            patch(
                "ttnn_visualizer.sftp_operations.get_remote_file_list", return_value=[]
            ),
            patch(
                "ttnn_visualizer.sftp_operations.get_remote_directory_list",
                return_value=["/remote/empty"],
            ),
            patch("ttnn_visualizer.sftp_operations.download_single_file_sftp"),
            patch("ttnn_visualizer.sftp_operations.update_last_synced") as last_synced,
            patch("ttnn_visualizer.sftp_operations.emit_file_status") as emit_status,
        ):
            sync_files_and_directories(
                connection,
                "/remote/empty",
                tmp_path,
                exclude_patterns=[],
            )

        # An empty folder is still a *successful* sync, so we stamp .last-synced
        # — that's the marker downstream consumers key off.
        last_synced.assert_called_once_with(tmp_path)
        emitted_statuses = [call.args[0].status for call in emit_status.call_args_list]
        assert FileStatus.STARTED not in emitted_statuses
        assert FileStatus.FINISHED not in emitted_statuses


class TestSyncFilesAndDirectoriesPartialFailure:
    """Regression: partial download must not emit FINISHED or stamp .last-synced."""

    def test_raises_and_emits_failed_when_any_download_fails(
        self, app, tmp_path, connection
    ):
        files = [("/remote/reports/a.txt", 10), ("/remote/reports/b.txt", 20)]

        def download_side_effect(_conn, remote_file, _local_file):
            if remote_file.endswith("b.txt"):
                raise RuntimeError("SFTP transient failure")

        with (
            app.app_context(),
            patch(
                "ttnn_visualizer.sftp_operations.get_remote_file_list",
                return_value=files,
            ),
            patch(
                "ttnn_visualizer.sftp_operations.get_remote_directory_list",
                return_value=["/remote/reports"],
            ),
            patch(
                "ttnn_visualizer.sftp_operations.download_single_file_sftp",
                side_effect=download_side_effect,
            ),
            patch("ttnn_visualizer.sftp_operations.update_last_synced") as last_synced,
            patch("ttnn_visualizer.sftp_operations.emit_file_status") as emit_status,
        ):
            with pytest.raises(RemoteConnectionException) as excinfo:
                sync_files_and_directories(
                    connection,
                    "/remote/reports",
                    tmp_path,
                    exclude_patterns=[],
                )

        assert "1 of 2" in excinfo.value.message
        assert excinfo.value.http_status == HTTPStatus.UNPROCESSABLE_ENTITY
        last_synced.assert_not_called()
        terminal = emit_status.call_args_list[-1][0][0]
        assert terminal.status == FileStatus.FAILED
        assert terminal.finished_files == 1
        assert terminal.number_of_files == 2

    def test_all_files_succeed_stamps_last_synced(self, app, tmp_path, connection):
        files = [("/remote/reports/a.txt", 10)]

        with (
            app.app_context(),
            patch(
                "ttnn_visualizer.sftp_operations.get_remote_file_list",
                return_value=files,
            ),
            patch(
                "ttnn_visualizer.sftp_operations.get_remote_directory_list",
                return_value=["/remote/reports"],
            ),
            patch("ttnn_visualizer.sftp_operations.download_single_file_sftp"),
            patch("ttnn_visualizer.sftp_operations.update_last_synced") as last_synced,
            patch("ttnn_visualizer.sftp_operations.emit_file_status") as emit_status,
        ):
            sync_files_and_directories(
                connection,
                "/remote/reports",
                tmp_path,
                exclude_patterns=[],
            )

        last_synced.assert_called_once_with(tmp_path)
        terminal = emit_status.call_args_list[-1][0][0]
        assert terminal.status == FileStatus.FINISHED


class TestSyncFilesAndDirectoriesSyncMethod:
    """The reported sync method must reflect *this* run's transport, not the
    process-global fallback cache (which is keyed by user@host:port and can hold
    a stale entry from a prior run against the same endpoint).
    """

    @pytest.fixture(autouse=True)
    def clear_sftp_subsystem_cache(self):
        _sftp_subsystem_unavailable.clear()
        yield
        _sftp_subsystem_unavailable.clear()

    @staticmethod
    def _patches(connection, files, download_side_effect=None, download_return=None):
        download_kwargs = {}
        if download_side_effect is not None:
            download_kwargs["side_effect"] = download_side_effect
        else:
            download_kwargs["return_value"] = download_return
        return (
            patch(
                "ttnn_visualizer.sftp_operations.get_remote_file_list",
                return_value=files,
            ),
            patch(
                "ttnn_visualizer.sftp_operations.get_remote_directory_list",
                return_value=["/remote/reports"],
            ),
            patch(
                "ttnn_visualizer.sftp_operations.download_single_file_sftp",
                **download_kwargs,
            ),
            patch("ttnn_visualizer.sftp_operations.update_last_synced"),
            patch("ttnn_visualizer.sftp_operations.emit_file_status"),
        )

    def test_returns_sftp_despite_stale_global_scp_entry_for_other_host(
        self, app, tmp_path, connection
    ):
        # A different host fell back to scp earlier in the process lifetime.
        _sftp_subsystem_unavailable.add(("user", "other.test", 45985))
        files = [("/remote/reports/a.txt", 10)]
        list_patch, dir_patch, dl_patch, _, _ = self._patches(
            connection, files, download_return=SyncMethod.SFTP
        )
        with app.app_context(), list_patch, dir_patch, dl_patch:
            result = sync_files_and_directories(
                connection, "/remote/reports", tmp_path, exclude_patterns=[]
            )
        assert result == SyncMethod.SFTP

    def test_returns_scp_when_any_file_used_fallback(self, app, tmp_path, connection):
        files = [("/remote/reports/a.txt", 10), ("/remote/reports/b.txt", 20)]

        def download_side_effect(_conn, remote_file, _local_file):
            # First file goes over sftp, second triggers the scp fallback.
            return SyncMethod.SCP if remote_file.endswith("b.txt") else SyncMethod.SFTP

        list_patch, dir_patch, dl_patch, _, _ = self._patches(
            connection, files, download_side_effect=download_side_effect
        )
        with app.app_context(), list_patch, dir_patch, dl_patch:
            result = sync_files_and_directories(
                connection, "/remote/reports", tmp_path, exclude_patterns=[]
            )
        assert result == SyncMethod.SCP

    def test_incomplete_sync_message_uses_run_method_not_global_cache(
        self, app, tmp_path, connection
    ):
        # Poison the global cache for *this* host so the regression (reading the
        # global instead of the per-run method) would report "via scp".
        _sftp_subsystem_unavailable.add(_remote_transfer_key(connection))
        files = [("/remote/reports/a.txt", 10), ("/remote/reports/b.txt", 20)]

        def download_side_effect(_conn, remote_file, _local_file):
            if remote_file.endswith("b.txt"):
                raise RuntimeError("SFTP transient failure")
            return SyncMethod.SFTP

        list_patch, dir_patch, dl_patch, _, _ = self._patches(
            connection, files, download_side_effect=download_side_effect
        )
        with app.app_context(), list_patch, dir_patch, dl_patch:
            with pytest.raises(RemoteConnectionException) as excinfo:
                sync_files_and_directories(
                    connection, "/remote/reports", tmp_path, exclude_patterns=[]
                )
        assert "via sftp" in excinfo.value.message
        assert "via scp" not in excinfo.value.message
        # The exception carries the per-run method so callers don't have to
        # re-read the (poisoned) global cache.
        assert excinfo.value.sync_method == SyncMethod.SFTP.value


class TestGetRemoteFileListWithoutSizes:
    def test_returns_paths_with_zero_size(self, connection):
        stdout = "/remote/a.txt\n/remote/b.txt\n"
        with patch("subprocess.run", return_value=_completed(stdout)):
            result = _get_remote_file_list_without_sizes(
                connection, "/remote", exclude_patterns=[]
            )
        assert result == [("/remote/a.txt", 0), ("/remote/b.txt", 0)]

    def test_applies_exclude_patterns(self, connection):
        stdout = "/remote/keep.txt\n/remote/tensors/skip.bin\n"
        with patch("subprocess.run", return_value=_completed(stdout)):
            result = _get_remote_file_list_without_sizes(
                connection, "/remote", exclude_patterns=["/tensors"]
            )
        assert result == [("/remote/keep.txt", 0)]

    def test_skips_blank_lines(self, connection):
        stdout = "/remote/a.txt\n\n   \n/remote/b.txt\n"
        with patch("subprocess.run", return_value=_completed(stdout)):
            result = _get_remote_file_list_without_sizes(
                connection, "/remote", exclude_patterns=[]
            )
        assert result == [("/remote/a.txt", 0), ("/remote/b.txt", 0)]
