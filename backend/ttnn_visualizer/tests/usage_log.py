# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Readers for the usage log, shared by the writer's tests and the endpoint's.

A module rather than helpers in ``conftest.py``: pytest owns conftest's loading, so
importing it across test modules can end up importing it under two names depending on
rootdir and collection order. ``report_schemas.py`` and ``usage_writer.py`` are the
existing precedent for shared, non-fixture test code.

These parse rather than reuse ``usage._parse_line``: a reader that derives its parsing
from the code under test stops testing the format.
"""

from pathlib import Path
from typing import Dict, List

from ttnn_visualizer import usage
from ttnn_visualizer.usage import COUNT_FIELD


def read_usage_lines(directory: Path) -> List[str]:
    log_path = directory / usage.USAGE_LOG_NAME
    if not log_path.exists():
        return []

    return log_path.read_text(encoding="utf-8").splitlines()


def parse_usage_line(line: str) -> Dict[str, str]:
    return dict(token.split("=", 1) for token in line.split(" "))


def total_usage_events(lines: List[str]) -> int:
    """Cumulative count the way the collector derives it: ``count``, default 1."""
    return sum(int(parse_usage_line(line).get(COUNT_FIELD, "1")) for line in lines)
