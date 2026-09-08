# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Tests for scp fallback when the remote SFTP subsystem is unavailable."""

import shlex
import subprocess
from unittest.mock import patch

import pytest
from ttnn_visualizer.enums import SyncMethod
from ttnn_visualizer.models import RemoteConnection
from ttnn_visualizer.sftp_operations import (
    _sftp_subsystem_unavailable,
    download_single_file_scp,
    download_single_file_sftp,
    get_active_sync_method,
)


@pytest.fixture(autouse=True)
def clear_sftp_subsystem_cache():
    _sftp_subsystem_unavailable.clear()
    yield
    _sftp_subsystem_unavailable.clear()


@pytest.fixture
def connection() -> RemoteConnection:
    return RemoteConnection(
        name="test",
        username="user",
        host="example.test",
        port=45985,
        profilerPath="/remote/profiler",
    )


def _scp_success() -> subprocess.CompletedProcess:
    return subprocess.CompletedProcess(args=["scp"], returncode=0, stdout="", stderr="")


def test_sftp_subsystem_failure_falls_back_to_scp(connection, tmp_path):
    local_file = tmp_path / "config.json"
    sftp_error = subprocess.CalledProcessError(
        returncode=255,
        cmd=["sftp"],
        output="",
        stderr="subsystem request failed on channel 0\nConnection closed\n",
    )

    with (
        patch(
            "subprocess.run",
            side_effect=[sftp_error, _scp_success()],
        ),
        patch(
            "ttnn_visualizer.sftp_operations.download_single_file_scp"
        ) as scp_download,
    ):
        download_single_file_sftp(
            connection,
            "/remote/config.json",
            local_file,
        )

    scp_download.assert_called_once_with(connection, "/remote/config.json", local_file)


def test_subsequent_downloads_skip_sftp_after_subsystem_failure(connection, tmp_path):
    sftp_error = subprocess.CalledProcessError(
        returncode=255,
        cmd=["sftp"],
        output="",
        stderr="subsystem request failed on channel 0\n",
    )

    with patch(
        "subprocess.run",
        side_effect=[sftp_error, _scp_success(), _scp_success()],
    ) as run:
        download_single_file_sftp(connection, "/remote/a.txt", tmp_path / "a.txt")
        download_single_file_sftp(connection, "/remote/b.txt", tmp_path / "b.txt")

    assert run.call_args_list[0][0][0][0] == "sftp"
    assert run.call_args_list[1][0][0][0] == "scp"
    assert run.call_args_list[2][0][0][0] == "scp"
    # `-O` forces legacy SCP protocol so scp does not reuse the disabled SFTP subsystem.
    assert run.call_args_list[1][0][0][1] == "-O"
    assert run.call_args_list[2][0][0][1] == "-O"


# The quoting contract itself lives in test_remote_command.py; this checks the download
# path actually routes its target through it, since `-O` has the remote side expand the
# path through a shell.
def test_scp_download_quotes_the_remote_path_in_its_target(connection, tmp_path):
    remote_file = "/remote/o'brien/reports/config.json"

    with patch("subprocess.run", return_value=_scp_success()) as run:
        download_single_file_scp(connection, remote_file, tmp_path / "config.json")

    target = run.call_args[0][0][-2]
    assert target.startswith(f"{connection.username}@{connection.host}:")
    assert shlex.split(target.split(":", 1)[1]) == [remote_file]


def test_active_sync_method_reflects_fallback_state(connection, tmp_path):
    assert get_active_sync_method(connection) == SyncMethod.SFTP
    sftp_error = subprocess.CalledProcessError(
        returncode=255,
        cmd=["sftp"],
        output="",
        stderr="subsystem request failed on channel 0\n",
    )
    with patch(
        "subprocess.run",
        side_effect=[sftp_error, _scp_success()],
    ):
        download_single_file_sftp(connection, "/remote/a.txt", tmp_path / "a.txt")
    assert get_active_sync_method(connection) == SyncMethod.SCP
