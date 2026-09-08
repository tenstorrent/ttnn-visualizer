# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Readers for the event log, shared by the writer's tests and the endpoint's.

A module rather than helpers in ``conftest.py``: pytest owns conftest's loading, so
importing it across test modules can end up importing it under two names depending on
rootdir and collection order. ``report_schemas.py`` and ``event_log_writer.py`` are the
existing precedent for shared, non-fixture test code.

These parse rather than reuse ``event_logging._parse_line``: a reader that derives its parsing
from the code under test stops testing the format.
"""

from pathlib import Path
from typing import Dict, List

from ttnn_visualizer import event_logging
from ttnn_visualizer.event_logging import COUNT_FIELD


def read_event_log_lines(directory: Path) -> List[str]:
    log_path = directory / event_logging.EVENT_LOG_FILENAME
    if not log_path.exists():
        return []

    return log_path.read_text(encoding="utf-8").splitlines()


def parse_event_log_line(line: str) -> Dict[str, str]:
    return dict(token.split("=", 1) for token in line.split(" "))


def total_event_log_events(lines: List[str]) -> int:
    """Cumulative count the way the collector derives it: ``count``, default 1."""
    return sum(int(parse_event_log_line(line).get(COUNT_FIELD, "1")) for line in lines)
