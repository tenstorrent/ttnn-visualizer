# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Smoke tests for the historical report-schema constants.

These constants are intentionally derived from real TTNN reports (see the
module docstring in ``report_schemas.py``); the tests below ensure each one
is valid SQLite DDL and contains the columns/tables that downstream
production code in ``queries.py`` probes for via runtime feature detection.
"""

import sqlite3
from typing import Set

import pytest
from ttnn_visualizer.tests.report_schemas import (
    SCHEMA_V2,
    SCHEMA_V2_1,
    SCHEMA_V2_WITH_LIFETIME,
)


def _table_columns(conn: sqlite3.Connection, table: str) -> Set[str]:
    return {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}


def _table_names(conn: sqlite3.Connection) -> Set[str]:
    return {
        row[0]
        for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    }


@pytest.mark.parametrize(
    "schema",
    [SCHEMA_V2, SCHEMA_V2_1, SCHEMA_V2_WITH_LIFETIME],
    ids=["v2", "v2_1", "v2_with_lifetime"],
)
def test_schema_loads_into_sqlite(schema):
    conn = sqlite3.connect(":memory:")
    try:
        conn.executescript(schema)
    finally:
        conn.close()


def test_schema_v2_1_has_source_files_and_source_file_id():
    conn = sqlite3.connect(":memory:")
    try:
        conn.executescript(SCHEMA_V2_1)
        assert "source_files" in _table_names(conn)
        assert "source_file_id" in _table_columns(conn, "stack_traces")
    finally:
        conn.close()


def test_schema_v2_lacks_source_files_and_source_file_id():
    conn = sqlite3.connect(":memory:")
    try:
        conn.executescript(SCHEMA_V2)
        assert "source_files" not in _table_names(conn)
        assert "source_file_id" not in _table_columns(conn, "stack_traces")
    finally:
        conn.close()


def test_schema_v2_with_lifetime_adds_tensor_lifetime():
    conn = sqlite3.connect(":memory:")
    try:
        conn.executescript(SCHEMA_V2_WITH_LIFETIME)
        assert "tensor_lifetime" in _table_names(conn)
    finally:
        conn.close()
