# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""The frontend's mirror of `merge_device_rows`, checked against the real thing (#2084).

`src/functions/deviceRowGroups.ts` reproduces how tt-perf-report groups per-device
rows, so it can carry a merged row's operation link onto the rows it stands for.
`tests/deviceRowGroups.spec.ts` asserts the groups that mirror forms for each case in
`tests/data/mergeDeviceRowCases.json`; this runs the same rows through the pinned
library and asserts it keeps exactly the row each of those groups should keep. A
version that grouped differently would keep different rows and fail here, rather
than leave the mirror passing against its own expectations.
"""

import json
from pathlib import Path

import pandas as pd
import pytest
from tt_perf_report.perf_report import merge_device_rows

REPO_ROOT = Path(__file__).resolve().parents[3]
CASES = json.loads(
    (REPO_ROOT / "tests" / "data" / "mergeDeviceRowCases.json").read_text(
        encoding="utf-8"
    )
)
COLLECTIVE_OPS = ("AllGather", "ReduceScatter", "AllReduce")


def _expected_kept_id(group, rows_by_id):
    # The merge keeps the lowest device's row of a collective (the group's first
    # member, as the mirror orders devices) and otherwise the slowest row.
    if any(name in rows_by_id[group[0]]["op"] for name in COLLECTIVE_OPS):
        return group[0]
    return max(group, key=lambda row_id: rows_by_id[row_id]["durationNs"])


@pytest.mark.parametrize("case", CASES, ids=[case["name"] for case in CASES])
def test_merge_keeps_one_row_of_each_mirrored_group(case):
    frame = pd.DataFrame(
        [
            {
                "OP CODE": row["op"],
                "OP TYPE": "tt_dnn_device",
                "DEVICE ID": row["device"],
                "ORIGINAL_ROW": row["id"],
                "DEVICE KERNEL DURATION [ns]": row["durationNs"],
            }
            for row in case["rows"]
        ]
    )
    rows_by_id = {row["id"]: row for row in case["rows"]}

    kept = sorted(int(row_id) for row_id in merge_device_rows(frame)["ORIGINAL_ROW"])

    assert kept == sorted(
        _expected_kept_id(group, rows_by_id) for group in case["groups"]
    )
