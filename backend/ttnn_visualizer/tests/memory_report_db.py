# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""A memory report database written from rows, for the agent tools' tests."""

import sqlite3
from pathlib import Path
from typing import Iterable, Sequence, Tuple

from ttnn_visualizer.agent.handles import ReportRegistry, load_report


def load_memory_report(
    tmp_path: Path, schema: str, rows: Iterable[Tuple[str, Sequence[object]]]
) -> Tuple[ReportRegistry, str]:
    """A report of `schema` holding each (table, values) row, loaded under a handle."""
    directory = tmp_path / "profiler"
    directory.mkdir()
    connection = sqlite3.connect(directory / "db.sqlite")
    try:
        connection.executescript(schema)
        for table, values in rows:
            placeholders = ", ".join("?" * len(values))
            connection.execute(
                f"INSERT INTO {table} VALUES ({placeholders})", tuple(values)
            )
        connection.commit()
    finally:
        connection.close()
    registry = ReportRegistry()
    return registry, str(load_report(registry, profiler_path=str(directory))["handle"])
