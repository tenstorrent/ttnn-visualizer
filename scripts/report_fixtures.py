# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Locating and extracting report folders out of the demo archives.

Deliberately free of Playwright and Flask imports so both the smoke tests and
the fixture generator can share it. The zip extraction here carries a
path-traversal guard; keeping one copy means the next fix to it can't land in
only half the callers.

The shared path constants live here for the same reason — moving `demo-reports/`
or `scripts/fixtures/` should not leave one module pointing at the old tree.
"""

from __future__ import annotations

import zipfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEMO_REPORTS_DIR = REPO_ROOT / "demo-reports"
FIXTURE_ROOT = REPO_ROOT / "scripts" / "fixtures"
PERFORMANCE_FIXTURE_DIR = FIXTURE_ROOT / "smoke-performance-report"

# The file whose presence identifies each kind of report folder inside an archive.
PROFILER_MARKER_FILE = "db.sqlite"
PERFORMANCE_MARKER_FILE = "profile_log_device.csv"


def extract_report_dir(zip_path: Path, work_dir: Path, marker_file: str) -> Path:
    """Extract the report folder holding `marker_file` out of a demo archive.

    The archives bundle a memory report and a performance report side by side,
    so the marker selects which subtree to pull out: `db.sqlite` for the
    profiler half, `profile_log_device.csv` for the performance half.
    """
    work_dir_resolved = work_dir.resolve()

    with zipfile.ZipFile(zip_path) as archive:
        marker_paths = [
            name for name in archive.namelist() if name.endswith(f"/{marker_file}")
        ]
        if not marker_paths:
            raise ValueError(f"No {marker_file} found in {zip_path}")
        if len(marker_paths) > 1:
            raise ValueError(
                f"Expected exactly one {marker_file} in {zip_path}, "
                f"found {len(marker_paths)}: {marker_paths}"
            )

        report_prefix = f"{marker_paths[0].rsplit('/', 1)[0]}/"
        report_name = report_prefix.rstrip("/").split("/")[-1]
        if not report_name or report_name in (".", ".."):
            raise ValueError(
                f"Invalid report directory name derived from zip entry: "
                f"{marker_paths[0]!r}"
            )

        report_dir = work_dir / report_name
        report_dir_resolved = report_dir.resolve()
        if not report_dir_resolved.is_relative_to(work_dir_resolved):
            raise ValueError(
                f"Report directory escapes work directory: {report_dir} in {zip_path}"
            )

        report_dir.mkdir(parents=True, exist_ok=True)

        for name in archive.namelist():
            if not name.startswith(report_prefix) or name.endswith("/"):
                continue
            relative_path = name[len(report_prefix) :]
            target = (report_dir / relative_path).resolve()
            if not target.is_relative_to(report_dir_resolved):
                raise ValueError(
                    f"Zip entry escapes extraction directory: {name} in {zip_path}"
                )
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(archive.read(name))

        return report_dir
