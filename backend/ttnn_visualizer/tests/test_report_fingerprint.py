# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Run fingerprints: a new run in a reused folder reads as different, a copy as the same."""

import shutil
import sqlite3
import time
from pathlib import Path
from typing import Optional

from ttnn_visualizer.report_fingerprint import (
    performance_run_fingerprint,
    profiler_run_fingerprint,
)
from ttnn_visualizer.tests.report_schemas import SCHEMA_V2
from ttnn_visualizer.utils import newest_ops_perf_file

_LEGACY_SCHEMA = (
    "CREATE TABLE operations (operation_id int, name text, duration float);"
)
_METADATA_SCHEMA = "CREATE TABLE report_metadata (key text UNIQUE, value text);"


def _make_profiler_report(
    report_dir: Path,
    *,
    operation_count: int = 1,
    capture_timestamp: Optional[str] = None,
    schema_sql: str = _LEGACY_SCHEMA,
) -> Path:
    report_dir.mkdir(parents=True, exist_ok=True)
    database_path = report_dir / "db.sqlite"
    connection = sqlite3.connect(database_path)
    connection.executescript(schema_sql)
    connection.executemany(
        "INSERT INTO operations (operation_id, name, duration) VALUES (?, ?, ?)",
        [(index, "ttnn::add", 1.0) for index in range(operation_count)],
    )
    if capture_timestamp is not None:
        connection.executescript(_METADATA_SCHEMA)
        connection.execute(
            "INSERT INTO report_metadata VALUES ('capture_timestamp_ns', ?)",
            (capture_timestamp,),
        )
    connection.commit()
    connection.close()
    return database_path


def _make_performance_report(
    report_dir: Path, perf_name: str = "ops_perf_results_2026_01_01_00_00_00.csv"
) -> None:
    report_dir.mkdir(parents=True, exist_ok=True)
    (report_dir / "profile_log_device.csv").write_text("ARCH: wormhole_b0\n")
    (report_dir / perf_name).write_text("OP CODE\nttnn::add\n")


def test_profiler_fingerprint_reads_a_legacy_database(tmp_path):
    _make_profiler_report(tmp_path / "report")

    assert profiler_run_fingerprint(tmp_path / "report") is not None


def test_profiler_fingerprint_reads_the_current_schema(tmp_path):
    report_dir = tmp_path / "report"
    report_dir.mkdir()
    connection = sqlite3.connect(report_dir / "db.sqlite")
    connection.executescript(SCHEMA_V2)
    connection.close()

    assert profiler_run_fingerprint(report_dir) is not None


def test_profiler_fingerprint_tells_runs_apart_by_capture_timestamp(tmp_path):
    _make_profiler_report(tmp_path / "first", capture_timestamp="1000")
    _make_profiler_report(tmp_path / "second", capture_timestamp="2000")

    first = profiler_run_fingerprint(tmp_path / "first")
    second = profiler_run_fingerprint(tmp_path / "second")

    assert (tmp_path / "first" / "db.sqlite").stat().st_size == (
        tmp_path / "second" / "db.sqlite"
    ).stat().st_size
    assert first != second


def test_profiler_fingerprint_tells_legacy_runs_apart_by_operation_count(tmp_path):
    _make_profiler_report(tmp_path / "first", operation_count=1)
    _make_profiler_report(tmp_path / "second", operation_count=2)

    # A page holds both, so size alone would call these the same run.
    assert (tmp_path / "first" / "db.sqlite").stat().st_size == (
        tmp_path / "second" / "db.sqlite"
    ).stat().st_size
    assert profiler_run_fingerprint(tmp_path / "first") != profiler_run_fingerprint(
        tmp_path / "second"
    )


def test_profiler_fingerprint_survives_a_copy(tmp_path):
    _make_profiler_report(tmp_path / "local", capture_timestamp="1000")
    # copytree's default copy2 keeps mtimes; a sync does not, so drop them.
    shutil.copytree(tmp_path / "local", tmp_path / "synced", copy_function=shutil.copy)

    assert profiler_run_fingerprint(tmp_path / "local") == profiler_run_fingerprint(
        tmp_path / "synced"
    )


def test_profiler_fingerprint_follows_a_rewrite_in_place(tmp_path):
    database_path = _make_profiler_report(tmp_path / "report", capture_timestamp="1000")
    before = profiler_run_fingerprint(tmp_path / "report")

    database_path.unlink()
    _make_profiler_report(tmp_path / "report", capture_timestamp="2000")

    assert profiler_run_fingerprint(tmp_path / "report") != before


def test_profiler_fingerprint_leaves_the_database_untouched(tmp_path):
    database_path = _make_profiler_report(tmp_path / "report")
    size = database_path.stat().st_size

    profiler_run_fingerprint(tmp_path / "report")

    assert database_path.stat().st_size == size
    assert sorted(path.name for path in (tmp_path / "report").iterdir()) == [
        "db.sqlite"
    ]


def test_profiler_fingerprint_is_none_without_a_database(tmp_path):
    (tmp_path / "report").mkdir()

    assert profiler_run_fingerprint(tmp_path / "report") is None


def test_profiler_fingerprint_is_none_for_an_unreadable_database(tmp_path):
    (tmp_path / "report").mkdir()
    (tmp_path / "report" / "db.sqlite").write_bytes(b"")

    assert profiler_run_fingerprint(tmp_path / "report") is None


def test_performance_fingerprint_survives_a_copy(tmp_path):
    _make_performance_report(tmp_path / "local")
    shutil.copytree(tmp_path / "local", tmp_path / "synced", copy_function=shutil.copy)

    assert performance_run_fingerprint(
        tmp_path / "local"
    ) == performance_run_fingerprint(tmp_path / "synced")


def test_performance_fingerprint_tells_captures_apart(tmp_path):
    _make_performance_report(
        tmp_path / "first", "ops_perf_results_2026_01_01_00_00_00.csv"
    )
    _make_performance_report(
        tmp_path / "second", "ops_perf_results_2026_01_02_00_00_00.csv"
    )

    assert performance_run_fingerprint(
        tmp_path / "first"
    ) != performance_run_fingerprint(tmp_path / "second")


def test_performance_fingerprint_describes_the_file_a_load_reads(tmp_path):
    report_dir = tmp_path / "report"
    _make_performance_report(report_dir, "ops_perf_results_2026_01_01_00_00_00.csv")
    # An overwrite leaves the earlier capture's CSV behind beside the new one. The
    # pause keeps the two ctimes apart on filesystems with coarse timestamps.
    time.sleep(0.01)
    newer = report_dir / "ops_perf_results_2026_01_02_00_00_00.csv"
    newer.write_text("OP CODE\nttnn::matmul\n")

    assert newest_ops_perf_file(report_dir) == newer
    fingerprint = performance_run_fingerprint(report_dir)
    assert fingerprint is not None and newer.name in fingerprint


def test_performance_fingerprint_is_none_without_a_device_log(tmp_path):
    _make_performance_report(tmp_path / "report")
    (tmp_path / "report" / "profile_log_device.csv").unlink()

    assert performance_run_fingerprint(tmp_path / "report") is None


def test_performance_fingerprint_is_none_without_a_perf_csv(tmp_path):
    (tmp_path / "report").mkdir()
    (tmp_path / "report" / "profile_log_device.csv").write_text("")

    assert performance_run_fingerprint(tmp_path / "report") is None
