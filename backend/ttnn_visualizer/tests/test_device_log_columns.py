# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""`profile_log_device.csv` gains columns, and the reader has to survive it.

The header used to be overwritten positionally from a hardcoded list of 13. A
current tt-metal emits 15, so the assignment raised before any query ran; a
capture that happened to total 13 was worse, because it was silently relabelled
— `type` served as `zone name`, so a zone query matched `ZONE_START` and
returned nothing for a real zone name, with HTTP 200 either way.

Both shapes are built here from literals rather than from the committed fixture,
so the 15-column case stays covered even though no 15-column capture is checked
in. See #1941.
"""

from pathlib import Path

import pytest
from ttnn_visualizer.csv_queries import DeviceLogProfilerQueries
from ttnn_visualizer.exceptions import DataFormatError
from ttnn_visualizer.models import Instance

PREAMBLE = "ARCH: wormhole_b0, CHIP_FREQ[MHz]: 1000, Max Compute Cores: 64"

# What a current tt-metal writes: `data`, `trace id`, `trace id counter`, `type`
# and `meta data`, with a leading space on every field after the first.
MODERN_HEADER = (
    "PCIe slot, core_x, core_y, RISC processor type, timer_id,"
    " time[cycles since reset], data, run host ID, trace id, trace id counter,"
    " zone name, type, source line, source file, meta data"
)
MODERN_ROWS = [
    "1,1,1,BRISC,18952,14595968859092,0,1025,,,BRISC-FW,ZONE_START,433,brisc.cc,",
    "1,1,1,BRISC,18953,14595968859500,0,1025,,,BRISC-FW,ZONE_END,433,brisc.cc,",
    "1,1,2,TRISC,18954,14595968860000,0,1025,,,TRISC-FW,ZONE_START,21,trisc.cc,",
]

# The shape the committed smoke fixture has: same naming, but without the two
# trace columns. Thirteen fields is exactly what made the old code relabel
# rather than raise.
LEGACY_HEADER = (
    "PCIe slot, core_x, core_y, RISC processor type, timer_id,"
    " time[cycles since reset], data, run host ID,  zone name, type,"
    " source line, source file, meta data"
)
LEGACY_ROWS = [
    "1,1,1,BRISC,18952,14595968859092,0,1025,BRISC-FW,ZONE_START,433,brisc.cc,",
    "1,1,1,BRISC,18953,14595968859500,0,1025,BRISC-FW,ZONE_END,433,brisc.cc,",
    "1,1,2,TRISC,18954,14595968860000,0,1025,TRISC-FW,ZONE_START,21,trisc.cc,",
]


def _write_device_log(directory: Path, header: str, rows: list[str]) -> Instance:
    """Write a device log and return an instance mounted on its directory."""
    path = directory / DeviceLogProfilerQueries.DEVICE_LOG_FILE
    path.write_text("\n".join([PREAMBLE, header, *rows]) + "\n", encoding="utf-8")
    return Instance(instance_id="pytest-device-log", performance_path=str(directory))


def test_modern_fifteen_column_capture_parses(tmp_path):
    """The reported regression: 15 columns used to raise a `ValueError`."""
    instance = _write_device_log(tmp_path, MODERN_HEADER, MODERN_ROWS)

    with DeviceLogProfilerQueries(instance) as csv:
        entries = csv.get_all_entries(as_dict=True)

    assert len(entries) == len(MODERN_ROWS)

    first = entries[0]
    # `execute_query` maps spaces to underscores for the dict form.
    assert first["data"] == 0
    assert first["run_host_ID"] == 1025
    assert first["zone_name"] == "BRISC-FW"
    assert first["type"] == "ZONE_START"
    assert first["source_file"] == "brisc.cc"
    assert "trace_id" in first and "trace_id_counter" in first
    assert "meta_data" in first

    # The names the hardcoded list invented. Their presence would mean the
    # header is being overwritten again.
    assert "stat_value" not in first
    assert "run_ID" not in first
    assert "zone_phase" not in first


def test_thirteen_column_capture_is_not_relabelled(tmp_path):
    """The silent half of #1941: 13 columns parsed, but every name shifted.

    `run host ID` is the join key back to `ops_perf_results`, and it used to be
    served as `run ID` while `zone name` carried the real `run host ID`.
    """
    instance = _write_device_log(tmp_path, LEGACY_HEADER, LEGACY_ROWS)

    with DeviceLogProfilerQueries(instance) as csv:
        entries = csv.get_all_entries(as_dict=True)

    first = entries[0]
    assert first["zone_name"] == "BRISC-FW", "zone name is serving `type`"
    assert first["run_host_ID"] == 1025
    assert first["source_line"] == 433
    assert first["source_file"] == "brisc.cc"


def test_zone_query_matches_real_zone_names(tmp_path):
    """What the mislabelling broke in practice: the zone filter matched `type`."""
    instance = _write_device_log(tmp_path, MODERN_HEADER, MODERN_ROWS)

    with DeviceLogProfilerQueries(instance) as csv:
        matched = csv.query_zone_statistics("BRISC-FW", as_dict=True)
        # What the endpoint used to return rows for.
        mismatched = csv.query_zone_statistics("ZONE_START", as_dict=True)

    assert len(matched) == 2
    assert not mismatched


def test_zone_query_honours_its_limit(tmp_path):
    """The route caps its response; an uncapped zone is 200k+ rows on a capture."""
    instance = _write_device_log(tmp_path, MODERN_HEADER, MODERN_ROWS)

    with DeviceLogProfilerQueries(instance) as csv:
        limited = csv.query_zone_statistics("BRISC-FW", as_dict=True, limit=1)

    assert len(limited) == 1


def test_missing_column_is_refused_by_name(tmp_path):
    """A short header must fail loudly rather than serve a shifted row."""
    header = LEGACY_HEADER.replace(" zone name,", "")
    rows = [
        row.replace("BRISC-FW,", "").replace("TRISC-FW,", "") for row in LEGACY_ROWS
    ]
    instance = _write_device_log(tmp_path, header, rows)

    with pytest.raises(DataFormatError, match="zone name"):
        with DeviceLogProfilerQueries(instance):
            pass
