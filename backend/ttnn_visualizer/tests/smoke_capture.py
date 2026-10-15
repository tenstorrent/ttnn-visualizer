# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""The smoke performance capture, and the signposted copy of it the range tests share.

Anchored on this file rather than the working directory, so a test run from
anywhere but the repo root fails or skips for a reason rather than skipping
silently. The HTTP route's signpost tests and the agent tools' read the same
window, so its positions are stated once here.
"""

import csv
from pathlib import Path
from typing import Dict, List, Optional

import pytest

SMOKE_CAPTURE_DIR = (
    Path(__file__).resolve().parents[3]
    / "scripts"
    / "fixtures"
    / "smoke-performance-report"
)
SMOKE_CAPTURE = SMOKE_CAPTURE_DIR / "ops_perf_results.csv"

# Where `signposted_rows` inserts its two signposts, as data positions after
# insertion, and the report ids of the rows strictly between them: positions
# 5-12, ids 7-14, ids counting the header and from 1.
SIGNPOST_START_POSITION = 4
SIGNPOST_END_POSITION = 13
SIGNPOSTED_WINDOW_IDS = range(7, 15)


def smoke_rows() -> List[Dict[str, str]]:
    if not SMOKE_CAPTURE.is_file():
        pytest.skip(f"{SMOKE_CAPTURE} is not present")
    with SMOKE_CAPTURE.open(newline="") as source:
        return list(csv.DictReader(source))


def signpost(
    name: str, like: Dict[str, str], host_start: Optional[int] = None
) -> Dict[str, str]:
    """A signpost row shaped like `like`, at its host time unless told otherwise."""
    row = {**like, "OP CODE": name, "OP TYPE": "signpost"}
    if host_start is not None:
        row["HOST START TS"] = str(host_start)
    return row


def signposted_rows() -> List[Dict[str, str]]:
    """The smoke rows with `PERF_START` and `PERF_END` bounding `SIGNPOSTED_WINDOW_IDS`."""
    rows = smoke_rows()
    rows.insert(
        SIGNPOST_START_POSITION,
        signpost("PERF_START", rows[SIGNPOST_START_POSITION]),
    )
    rows.insert(
        SIGNPOST_END_POSITION, signpost("PERF_END", rows[SIGNPOST_END_POSITION])
    )
    return rows


def write_ops_perf(directory: Path, rows: List[Dict[str, str]]) -> Path:
    """Write `rows` as the directory's `ops_perf_results.csv`, creating it."""
    directory.mkdir(parents=True, exist_ok=True)
    destination = directory / "ops_perf_results.csv"
    with destination.open("w", newline="") as out:
        writer = csv.DictWriter(out, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    return destination
