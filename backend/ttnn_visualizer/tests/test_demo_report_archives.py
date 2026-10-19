# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""The demo allowlist in `views.py` must name exactly the folders `demo-reports/` ships.

Hosted installs unpack these archives beside session uploads and list only the
allowlisted folders as demos. A re-packed archive with a renamed folder would vanish
from the hosted listing with nothing else failing, because the smoke tests upload the
reports rather than list pre-installed ones.
"""

import zipfile
from pathlib import Path, PurePosixPath

import pytest
from ttnn_visualizer.views import (
    DEMO_PERFORMANCE_DIRECTORY_NAMES,
    DEMO_PROFILER_DIRECTORY_NAMES,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
DEMO_REPORT_ARCHIVES = sorted((REPO_ROOT / "demo-reports").glob("*.zip"))

pytestmark = pytest.mark.skipif(
    not DEMO_REPORT_ARCHIVES, reason="demo-reports/ archives not available"
)


def _report_folders(kind: str) -> set[str]:
    """Folder names directly under `local/<kind>/` across every demo archive."""
    folders = set()
    for archive_path in DEMO_REPORT_ARCHIVES:
        with zipfile.ZipFile(archive_path) as archive:
            for name in archive.namelist():
                parts = PurePosixPath(name).parts
                if len(parts) >= 3 and parts[:2] == ("local", kind):
                    folders.add(parts[2])
    return folders


def test_profiler_allowlist_matches_the_shipped_archives():
    assert _report_folders("profiler-reports") == DEMO_PROFILER_DIRECTORY_NAMES


def test_performance_allowlist_matches_the_shipped_archives():
    assert _report_folders("performance-reports") == DEMO_PERFORMANCE_DIRECTORY_NAMES


@pytest.mark.parametrize("archive_path", DEMO_REPORT_ARCHIVES, ids=lambda p: p.name)
def test_archive_unpacks_straight_into_local(archive_path):
    # A wrapper folder would put the reports one level too deep for the hosted
    # listing to find them.
    with zipfile.ZipFile(archive_path) as archive:
        roots = {PurePosixPath(name).parts[0] for name in archive.namelist()}
    assert roots == {"local"}
