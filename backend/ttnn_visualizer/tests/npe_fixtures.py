# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Helpers the tt-npe index and `noc_congestion` tests share."""

import sqlite3
from pathlib import Path


def listing(directory: Path) -> dict:
    """Each file's size and modification time, to show a reader wrote nothing."""
    return {
        path.name: (path.stat().st_size, path.stat().st_mtime_ns)
        for path in directory.iterdir()
    }


def execute(db_path: Path, statement: str, *parameters) -> None:
    conn = sqlite3.connect(db_path)
    try:
        conn.execute(statement, parameters)
        conn.commit()
    finally:
        conn.close()
