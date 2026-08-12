# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Regression tests for the fixture generator's three deliberate guards.

`_resolve_output_dir` is what stands between an `--output` typo and the
`shutil.rmtree` that rewrites the fixture; the zip extraction carries a
path-traversal guard; and npeviz filenames read out of a source `manifest.json`
are collapsed to basenames. All three were added as hardening, and the
`.cycodeignore` entry for this script rests on them holding — so they are
pinned here rather than asserted in a comment.
"""

import json
import zipfile
from pathlib import Path

import pytest
from generate_smoke_perf_fixture import _read_source_manifest, _resolve_output_dir
from report_fixtures import (
    FIXTURE_ROOT,
    PERFORMANCE_MARKER_FILE,
    extract_report_dir,
)


def test_resolve_output_dir_accepts_a_child_of_the_fixture_root():
    resolved = _resolve_output_dir(FIXTURE_ROOT / "some-fixture")

    assert resolved == (FIXTURE_ROOT / "some-fixture").resolve()


def test_resolve_output_dir_rejects_the_fixture_root_itself():
    """A bare `--output scripts/fixtures` would wipe every fixture at once."""
    with pytest.raises(ValueError, match="must name a directory inside"):
        _resolve_output_dir(FIXTURE_ROOT)


def test_resolve_output_dir_rejects_a_traversal_escape():
    with pytest.raises(ValueError, match="must name a directory inside"):
        _resolve_output_dir(FIXTURE_ROOT / ".." / ".." / "tmp" / "evil")


def test_resolve_output_dir_rejects_a_path_outside_the_repo(tmp_path):
    with pytest.raises(ValueError, match="must name a directory inside"):
        _resolve_output_dir(tmp_path / "elsewhere")


def _write_zip(zip_path: Path, entries: dict[str, bytes]) -> None:
    with zipfile.ZipFile(zip_path, "w") as archive:
        for name, payload in entries.items():
            archive.writestr(name, payload)


def test_extract_report_dir_rejects_a_zip_entry_escaping_the_work_dir(tmp_path):
    """Zip slip: an entry may not write outside the extraction directory."""
    zip_path = tmp_path / "crafted.zip"
    _write_zip(
        zip_path,
        {
            f"report/{PERFORMANCE_MARKER_FILE}": b"csv\n",
            "report/../../escaped.txt": b"pwned",
        },
    )

    work_dir = tmp_path / "work"
    work_dir.mkdir()

    with pytest.raises(ValueError, match="escapes extraction directory"):
        extract_report_dir(zip_path, work_dir, PERFORMANCE_MARKER_FILE)

    assert not (tmp_path.parent / "escaped.txt").exists()


def test_extract_report_dir_requires_exactly_one_marker(tmp_path):
    zip_path = tmp_path / "two.zip"
    _write_zip(
        zip_path,
        {
            f"a/{PERFORMANCE_MARKER_FILE}": b"csv\n",
            f"b/{PERFORMANCE_MARKER_FILE}": b"csv\n",
        },
    )

    work_dir = tmp_path / "work"
    work_dir.mkdir()

    with pytest.raises(ValueError, match="Expected exactly one"):
        extract_report_dir(zip_path, work_dir, PERFORMANCE_MARKER_FILE)


def test_extract_report_dir_pulls_out_the_marked_subtree(tmp_path):
    zip_path = tmp_path / "demo.zip"
    _write_zip(
        zip_path,
        {
            f"local/performance-reports/RUN/{PERFORMANCE_MARKER_FILE}": b"csv\n",
            "local/performance-reports/RUN/npe_viz/manifest.json": b"[]",
            "local/profiler-reports/RUN/db.sqlite": b"not this one",
        },
    )

    work_dir = tmp_path / "work"
    work_dir.mkdir()

    report_dir = extract_report_dir(zip_path, work_dir, PERFORMANCE_MARKER_FILE)

    assert report_dir.name == "RUN"
    assert (report_dir / PERFORMANCE_MARKER_FILE).is_file()
    assert (report_dir / "npe_viz" / "manifest.json").is_file()
    assert not (report_dir / "db.sqlite").exists()


@pytest.mark.parametrize(
    "crafted_name",
    ["../../etc/passwd", "npe_viz/../../escape.zst", "/abs/path.zst"],
)
def test_read_source_manifest_skips_non_basename_files(tmp_path, crafted_name):
    """`file` is report data, so it must not steer the copy out of the report."""
    npe_dir = tmp_path / "npe_viz"
    npe_dir.mkdir()
    (npe_dir / "manifest.json").write_text(
        json.dumps([{"global_call_count": 1, "file": crafted_name}]),
        encoding="utf-8",
    )

    assert _read_source_manifest(tmp_path) == {}


def test_read_source_manifest_keeps_well_formed_entries(tmp_path):
    npe_dir = tmp_path / "npe_viz"
    npe_dir.mkdir()
    (npe_dir / "manifest.json").write_text(
        json.dumps(
            [
                {"global_call_count": 2049, "file": "_ID2049.npeviz.zst"},
                {"_global_call_count": 18433, "file": "_ID18433.npeviz.zst"},
            ]
        ),
        encoding="utf-8",
    )

    # The typo'd key is dropped rather than failing the build; the real demo
    # report carries exactly that entry.
    assert _read_source_manifest(tmp_path) == {2049: "_ID2049.npeviz.zst"}


def test_read_source_manifest_is_empty_without_a_manifest(tmp_path):
    assert _read_source_manifest(tmp_path) == {}
