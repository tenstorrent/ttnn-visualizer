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

import subprocess
from unittest.mock import patch

import pytest
from ttnn_visualizer.models import RemoteConnection
from ttnn_visualizer.sftp_operations import (
    _get_remote_file_list_without_sizes,
    get_remote_file_list,
)


def _connection() -> RemoteConnection:
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


class TestGetRemoteFileList:
    def test_parses_size_and_path_pairs(self):
        stdout = "100\t/remote/a.txt\x00200\t/remote/b.txt\x00"
        with patch("subprocess.run", return_value=_completed(stdout)):
            result = get_remote_file_list(_connection(), "/remote", exclude_patterns=[])
        assert result == [("/remote/a.txt", 100), ("/remote/b.txt", 200)]

    def test_path_containing_tabs_roundtrips(self):
        # First tab is the size/path separator; subsequent tabs are part of
        # the filename and must be preserved. Regression for the original
        # `splitlines() + partition("\t")` bug that truncated such paths.
        stdout = "42\t/remote/has\ttabs\there.txt\x00"
        with patch("subprocess.run", return_value=_completed(stdout)):
            result = get_remote_file_list(_connection(), "/remote", exclude_patterns=[])
        assert result == [("/remote/has\ttabs\there.txt", 42)]

    def test_path_containing_newlines_roundtrips(self):
        # NUL separator means newlines in filenames must also round-trip.
        stdout = "7\t/remote/line\nbreak.txt\x00"
        with patch("subprocess.run", return_value=_completed(stdout)):
            result = get_remote_file_list(_connection(), "/remote", exclude_patterns=[])
        assert result == [("/remote/line\nbreak.txt", 7)]

    def test_exclude_patterns_filter_results(self):
        stdout = "100\t/remote/keep.txt\x00200\t/remote/tensors/skip.bin\x00"
        with patch("subprocess.run", return_value=_completed(stdout)):
            result = get_remote_file_list(
                _connection(), "/remote", exclude_patterns=["/tensors"]
            )
        assert result == [("/remote/keep.txt", 100)]

    def test_invalid_size_defaults_to_zero(self):
        # A malformed size should not crash parsing — we degrade to size=0.
        stdout = "notanumber\t/remote/a.txt\x00500\t/remote/b.txt\x00"
        with patch("subprocess.run", return_value=_completed(stdout)):
            result = get_remote_file_list(_connection(), "/remote", exclude_patterns=[])
        assert result == [("/remote/a.txt", 0), ("/remote/b.txt", 500)]

    def test_record_without_tab_separator_is_skipped(self):
        # Defensive: a malformed record (no `\t`) shouldn't blow up parsing.
        stdout = "no-tab-here\x00100\t/remote/a.txt\x00"
        with patch("subprocess.run", return_value=_completed(stdout)):
            result = get_remote_file_list(_connection(), "/remote", exclude_patterns=[])
        assert result == [("/remote/a.txt", 100)]

    def test_empty_output_returns_empty_list(self):
        with patch("subprocess.run", return_value=_completed("")):
            result = get_remote_file_list(_connection(), "/remote", exclude_patterns=[])
        assert result == []

    def test_falls_back_when_printf_unsupported(self):
        # BSD find rejects -printf; we should retry via the size-less path.
        primary_error = _called_process_error(
            returncode=1, stderr="find: -printf: unknown predicate"
        )
        fallback_output = _completed("/remote/a.txt\n/remote/b.txt\n")
        with patch("subprocess.run", side_effect=[primary_error, fallback_output]):
            result = get_remote_file_list(_connection(), "/remote", exclude_patterns=[])
        assert result == [("/remote/a.txt", 0), ("/remote/b.txt", 0)]

    def test_ssh_protocol_error_raises(self):
        # Exit 255 means SSH itself failed (auth, connection, etc.); we should
        # surface that rather than silently falling back.
        ssh_error = _called_process_error(
            returncode=255, stderr="Permission denied (publickey)."
        )
        with patch("subprocess.run", side_effect=ssh_error):
            with pytest.raises(Exception):
                get_remote_file_list(_connection(), "/remote", exclude_patterns=[])

    def test_timeout_returns_empty_list(self):
        with patch(
            "subprocess.run",
            side_effect=subprocess.TimeoutExpired(cmd=["ssh"], timeout=5),
        ):
            result = get_remote_file_list(_connection(), "/remote", exclude_patterns=[])
        assert result == []


class TestGetRemoteFileListWithoutSizes:
    def test_returns_paths_with_zero_size(self):
        stdout = "/remote/a.txt\n/remote/b.txt\n"
        with patch("subprocess.run", return_value=_completed(stdout)):
            result = _get_remote_file_list_without_sizes(
                _connection(), "/remote", exclude_patterns=[]
            )
        assert result == [("/remote/a.txt", 0), ("/remote/b.txt", 0)]

    def test_applies_exclude_patterns(self):
        stdout = "/remote/keep.txt\n/remote/tensors/skip.bin\n"
        with patch("subprocess.run", return_value=_completed(stdout)):
            result = _get_remote_file_list_without_sizes(
                _connection(), "/remote", exclude_patterns=["/tensors"]
            )
        assert result == [("/remote/keep.txt", 0)]

    def test_skips_blank_lines(self):
        stdout = "/remote/a.txt\n\n   \n/remote/b.txt\n"
        with patch("subprocess.run", return_value=_completed(stdout)):
            result = _get_remote_file_list_without_sizes(
                _connection(), "/remote", exclude_patterns=[]
            )
        assert result == [("/remote/a.txt", 0), ("/remote/b.txt", 0)]
