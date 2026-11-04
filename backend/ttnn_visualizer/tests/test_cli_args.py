# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import logging

import pytest
from ttnn_visualizer.app import parse_args


def test_memory_report_path_is_read():
    args = parse_args(["--memory-report-path", "/reports/memory"])

    assert args.memory_report_path == "/reports/memory"


def test_the_former_profiler_path_still_works_and_warns(caplog):
    with caplog.at_level(logging.WARNING, logger="ttnn_visualizer.app"):
        args = parse_args(["--profiler-path", "/reports/memory"])

    assert args.memory_report_path == "/reports/memory"
    # Folded in, so nothing downstream can read the former name by mistake.
    assert not hasattr(args, "profiler_path")
    assert "--profiler-path is deprecated" in caplog.text


def test_neither_leaves_the_path_unset():
    assert parse_args([]).memory_report_path is None


def test_both_agreeing_are_accepted():
    args = parse_args(
        [
            "--memory-report-path",
            "/reports/memory",
            "--profiler-path",
            "/reports/memory",
        ]
    )

    assert args.memory_report_path == "/reports/memory"


def test_both_disagreeing_are_refused(capsys):
    with pytest.raises(SystemExit) as exit_info:
        parse_args(
            ["--memory-report-path", "/reports/a", "--profiler-path", "/reports/b"]
        )

    assert exit_info.value.code == 2
    assert "name different paths" in capsys.readouterr().err
