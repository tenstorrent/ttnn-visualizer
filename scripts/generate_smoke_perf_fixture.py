#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Build the tiny performance report the Playwright smoke tests upload.

The committed demo reports under `demo-reports/` are user-facing artifacts whose
device logs run to tens of megabytes — far too heavy to push through a browser
upload on five Python versions per CI run. This script distils one of them into
a fixture small enough to commit, while keeping the parts the app actually
parses byte-for-byte:

* `profile_log_device.csv` keeps its first line verbatim, because
  `/api/performance/device-log/meta` regex-parses `ARCH:` / `CHIP_FREQ[MHz]:`
  straight off it, and its header line verbatim, because
  `DeviceLogProfilerQueries` reads the header by name and checks it against
  `REQUIRED_DEVICE_LOG_COLUMNS` (#1941).
* `ops_perf_results.csv` keeps every column. The report endpoint hands the file
  to the pinned external `tt-perf-report`, which reaches into far more columns
  than this repo names, so rows are trimmed and columns never are.
* The retained `npe_viz/manifest.json` entries are rebuilt from the retained
  rows' `GLOBAL CALL COUNT` values. `PerfTable` only renders the NPE launch
  button when a manifest entry matches a report row, so generating the manifest
  from the rows keeps that join from silently rotting.

Usage::

    python scripts/generate_smoke_perf_fixture.py \\
        --source demo-reports/n300-llama.zip \\
        --output scripts/fixtures/smoke-performance-report
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path
from typing import Optional

_SCRIPTS_DIR = Path(__file__).resolve().parent
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))

from report_fixtures import (  # noqa: E402 - needs the sys.path entry above
    FIXTURE_ROOT,
    PERFORMANCE_MARKER_FILE,
    extract_report_dir,
)

logger = logging.getLogger(__name__)

DEVICE_LOG_NAME = PERFORMANCE_MARKER_FILE
OPS_PERF_PREFIX = "ops_perf_results"
OPS_PERF_OUTPUT_NAME = "ops_perf_results.csv"
NPE_FOLDER = "npe_viz"
NPE_MANIFEST_NAME = "manifest.json"
FIXTURE_README_NAME = "README.md"

OP_TYPE_COLUMN = "OP TYPE"
OP_CODE_COLUMN = "OP CODE"
GLOBAL_CALL_COUNT_COLUMN = "GLOBAL CALL COUNT"
SIGNPOST_OP_TYPE = "signpost"

DEFAULT_DEVICE_LOG_ROWS = 200
DEFAULT_OPS_ROWS = 24
DEFAULT_NPE_ENTRIES = 1
# Timelines below this are structurally valid but carry no `noc_transfers`, so
# the NPE view renders an empty chip. Above it, keep the smallest available.
MIN_USEFUL_NPE_BYTES = 512
MAX_NPE_BYTES = 8_192


def _resolve_output_dir(output: Path) -> Path:
    """Resolve `--output` and require it to name a directory under the fixtures tree.

    `build_fixture` deletes and recreates whatever it is handed, so an
    unconstrained path turns a typo into data loss. Resolving first collapses
    `..` segments and symlinks, and the containment check keeps the destination
    inside `scripts/fixtures/`. The fixtures root itself is rejected so a bare
    `--output scripts/fixtures` cannot wipe every fixture at once.
    """
    resolved = output.expanduser().resolve()

    if resolved == FIXTURE_ROOT or not resolved.is_relative_to(FIXTURE_ROOT):
        raise ValueError(
            f"--output must name a directory inside {FIXTURE_ROOT}, got {resolved}"
        )

    return resolved


def _find_source_report(source: Path, work_dir: Path) -> Path:
    """Return a directory holding a performance report, extracting a zip if needed."""
    if source.is_dir():
        if not (source / DEVICE_LOG_NAME).is_file():
            raise ValueError(f"No {DEVICE_LOG_NAME} in {source}")
        return source

    if not zipfile.is_zipfile(source):
        raise ValueError(f"{source} is neither a directory nor a zip archive")

    return extract_report_dir(source, work_dir, PERFORMANCE_MARKER_FILE)


def _trim_device_log(source_report: Path, output: Path, row_limit: int) -> None:
    """Copy the two preamble lines verbatim plus a slice of data rows."""
    source_path = source_report / DEVICE_LOG_NAME
    kept: list[str] = []

    with source_path.open("r", encoding="utf-8", errors="replace") as handle:
        for index, line in enumerate(handle):
            if index >= row_limit + 2:
                break
            kept.append(line)

    if len(kept) < 3:
        raise ValueError(f"{source_path} has no data rows to keep")

    destination = output / DEVICE_LOG_NAME
    with destination.open("w", encoding="utf-8", newline="") as handle:
        handle.writelines(kept)

    logger.info("Wrote %s (%d data rows)", destination, len(kept) - 2)


def _read_ops_perf(source_report: Path) -> tuple[list[str], list[dict[str, str]]]:
    candidates = sorted(source_report.glob(f"{OPS_PERF_PREFIX}*.csv"))
    if not candidates:
        raise ValueError(f"No {OPS_PERF_PREFIX}*.csv in {source_report}")

    with candidates[0].open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames is None:
            raise ValueError(f"{candidates[0]} has no header row")
        return list(reader.fieldnames), list(reader)


def _read_source_manifest(source_report: Path) -> dict[int, str]:
    """Map `global_call_count` to npeviz filename from the source manifest.

    The real manifests are hand-adjacent artifacts and have carried typo'd keys
    (`_global_call_count`), so entries that don't parse are skipped rather than
    failing the build — the rebuilt manifest is schema-clean regardless.

    `file` is data read out of the source report rather than a value this script
    chose, so it is collapsed to a bare basename before it ever reaches a path
    join. Without that, a report carrying `"file": "../../../etc/passwd"` would
    steer the copy below out of the report directory. Same reasoning as
    `extract_uploaded_name` in `backend/ttnn_visualizer/file_uploads.py`.
    """
    manifest_path = source_report / NPE_FOLDER / NPE_MANIFEST_NAME
    if not manifest_path.is_file():
        return {}

    entries = json.loads(manifest_path.read_text(encoding="utf-8"))
    call_counts_by_file: dict[int, str] = {}

    for entry in entries:
        call_count = entry.get("global_call_count")
        file_name = entry.get("file")
        if not isinstance(call_count, int) or not isinstance(file_name, str):
            continue

        safe_name = Path(file_name).name
        if not safe_name or safe_name != file_name:
            logger.warning(
                "Skipping manifest entry with a non-basename file: %r", file_name
            )
            continue

        call_counts_by_file[call_count] = safe_name

    return call_counts_by_file


def _select_npe_entries(
    source_report: Path,
    manifest: dict[int, str],
    row_call_counts: set[int],
    requested: list[int],
    limit: int,
) -> dict[int, str]:
    """Pick manifest entries that exist on disk and join to a real report row."""
    npe_dir = source_report / NPE_FOLDER
    available = {
        call_count: file_name
        for call_count, file_name in manifest.items()
        if (npe_dir / file_name).is_file() and call_count in row_call_counts
    }

    if requested:
        missing = [count for count in requested if count not in available]
        if missing:
            raise ValueError(
                f"Requested NPE call counts not available in the source report: {missing}"
            )
        return {count: available[count] for count in requested}

    usable = {
        call_count: file_name
        for call_count, file_name in available.items()
        if MIN_USEFUL_NPE_BYTES <= (npe_dir / file_name).stat().st_size <= MAX_NPE_BYTES
    }

    # Largest-then-lowest-call-count keeps the choice deterministic and favours a
    # timeline with actual transfers over a near-empty one.
    ordered = sorted(
        usable.items(),
        key=lambda item: (-(npe_dir / item[1]).stat().st_size, item[0]),
    )
    return dict(ordered[:limit])


def _write_ops_perf(
    output: Path,
    fieldnames: list[str],
    rows: list[dict[str, str]],
) -> None:
    destination = output / OPS_PERF_OUTPUT_NAME
    with destination.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    logger.info(
        "Wrote %s (%d rows, %d columns)", destination, len(rows), len(fieldnames)
    )


def _row_call_count(row: dict[str, str]) -> Optional[int]:
    try:
        return int(str(row.get(GLOBAL_CALL_COUNT_COLUMN, "")).strip())
    except ValueError:
        return None


def build_fixture(
    source: Path,
    output: Path,
    device_log_rows: int,
    ops_rows: int,
    npe_call_counts: list[int],
    npe_entries: int,
) -> None:
    output = _resolve_output_dir(output)

    with tempfile.TemporaryDirectory(prefix="smoke-perf-fixture-") as temp_dir:
        source_report = _find_source_report(source, Path(temp_dir))

        fieldnames, all_rows = _read_ops_perf(source_report)
        for required in (OP_TYPE_COLUMN, OP_CODE_COLUMN, GLOBAL_CALL_COUNT_COLUMN):
            if required not in fieldnames:
                raise ValueError(f"Source ops perf CSV is missing {required!r}")

        manifest = _read_source_manifest(source_report)
        row_call_counts = {
            count for count in (_row_call_count(row) for row in all_rows) if count
        }
        selected_npe = _select_npe_entries(
            source_report, manifest, row_call_counts, npe_call_counts, npe_entries
        )

        # Signposts delimit the run for `extract_signposts`, and the NPE-joined
        # rows are what make the launch button appear; everything else is filler
        # so the report has a handful of ordinary device ops to render.
        kept_indices: set[int] = set()
        for index, row in enumerate(all_rows):
            call_count = _row_call_count(row)
            is_signpost = row.get(OP_TYPE_COLUMN) == SIGNPOST_OP_TYPE
            is_npe_joined = call_count is not None and call_count in selected_npe
            if is_signpost or is_npe_joined:
                kept_indices.add(index)

        for index in range(len(all_rows)):
            if len(kept_indices) >= ops_rows:
                break
            kept_indices.add(index)

        # Source order is preserved: `tt-perf-report` sorts on `HOST START TS`
        # but warns and falls back to file order when that column is absent.
        keep = [all_rows[index] for index in sorted(kept_indices)]

        # The README records provenance and the invariants that matter on
        # regeneration, and the generator cannot reproduce it — so carry it
        # across the rewrite. Without this, the documented regenerate command
        # deletes the very notes that explain the fixture.
        readme = output / FIXTURE_README_NAME
        preserved_readme = readme.read_bytes() if readme.is_file() else None

        if output.exists():
            shutil.rmtree(output)
        output.mkdir(parents=True)

        if preserved_readme is not None:
            (output / FIXTURE_README_NAME).write_bytes(preserved_readme)
            logger.info("Preserved %s", readme.name)

        _trim_device_log(source_report, output, device_log_rows)
        _write_ops_perf(output, fieldnames, keep)

        if selected_npe:
            npe_output = output / NPE_FOLDER
            npe_output.mkdir()
            for call_count, file_name in selected_npe.items():
                shutil.copy2(
                    source_report / NPE_FOLDER / file_name, npe_output / file_name
                )
                logger.info(
                    "Copied NPE timeline %s (call count %d)", file_name, call_count
                )

            manifest_entries = [
                {"global_call_count": call_count, "file": file_name}
                for call_count, file_name in sorted(selected_npe.items())
            ]
            (npe_output / NPE_MANIFEST_NAME).write_text(
                json.dumps(manifest_entries, indent=2) + "\n", encoding="utf-8"
            )
        else:
            logger.warning("No NPE timeline selected; fixture will have no npe_viz/")

    total = sum(path.stat().st_size for path in output.rglob("*") if path.is_file())
    logger.info("Fixture written to %s (%.1f KB)", output, total / 1024)


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source",
        type=Path,
        required=True,
        help="Performance report directory, or a demo zip containing one",
    )
    parser.add_argument(
        "--output",
        type=Path,
        required=True,
        help=(
            "Fixture directory to (re)create. Must be inside scripts/fixtures/ — "
            "it is deleted and rewritten"
        ),
    )
    parser.add_argument("--device-log-rows", type=int, default=DEFAULT_DEVICE_LOG_ROWS)
    parser.add_argument("--ops-rows", type=int, default=DEFAULT_OPS_ROWS)
    parser.add_argument(
        "--npe-call-count",
        type=int,
        action="append",
        default=[],
        help="Pin a specific NPE timeline by global call count (repeatable)",
    )
    parser.add_argument("--npe-entries", type=int, default=DEFAULT_NPE_ENTRIES)
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(message)s")

    try:
        build_fixture(
            args.source,
            args.output,
            args.device_log_rows,
            args.ops_rows,
            args.npe_call_count,
            args.npe_entries,
        )
    except (ValueError, OSError) as error:
        logger.error("Failed to build fixture: %s", error)
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
