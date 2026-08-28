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
from unittest.mock import patch

import pytest
from ttnn_visualizer import csv_queries
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

# The shape the committed demo reports have: 13 columns again, but a different
# 13 — `run ID` is present and `meta data` is absent, the mirror image of the
# fixture above. Requiring every column both of the others happen to have is what
# broke these; only the columns a query reads may gate the response.
DEMO_REPORT_HEADER = (
    "PCIe slot, core_x, core_y, RISC processor type, timer_id,"
    " time[cycles since reset], data, run ID, run host ID,  zone name, type,"
    " source line, source file"
)
DEMO_REPORT_ROWS = [
    "1,1,1,BRISC,18952,14595968859092,0,1024,1025,BRISC-FW,ZONE_START,433,brisc.cc",
    "1,1,1,BRISC,18953,14595968859500,0,1024,1025,BRISC-FW,ZONE_END,433,brisc.cc",
]


def write_device_log(directory: Path, header: str, rows: list[str]) -> Path:
    """Write the layout the reader expects: preamble line, header, rows.

    Shared with `test_device_log_routes.py`, which mounts the same file on an
    instance row rather than an `Instance`. The preamble is what `offset=1`
    skips, so it is part of the contract under test.
    """
    path = directory / DeviceLogProfilerQueries.DEVICE_LOG_FILE
    path.write_text("\n".join([PREAMBLE, header, *rows]) + "\n", encoding="utf-8")
    return path


def drop_column(header: str, rows: list[str], column: str) -> tuple[str, list[str]]:
    """Remove one named column from a header and the matching field from rows."""
    names = [name.strip() for name in header.split(",")]
    index = names.index(column)
    del names[index]

    trimmed = []
    for row in rows:
        fields = row.split(",")
        del fields[index]
        trimmed.append(",".join(fields))

    return ", ".join(names), trimmed


def _write_device_log(directory: Path, header: str, rows: list[str]) -> Instance:
    """Write a device log and return an instance mounted on its directory."""
    write_device_log(directory, header, rows)
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

    # `stat value` and `zone phase` were the old list's names for `data` and
    # `type`; `run ID` is a real column, but only in older captures like the
    # segformer demos, never in this one. Any of the three appearing here would
    # mean the header is being overwritten again.
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


def test_demo_report_shape_still_parses(tmp_path):
    """The shipped demo reports must keep working.

    `demo-reports/segformer_{encoder,decoder}*.zip` have no `meta data` column.
    Gating on the union of every column seen in the wild answered 422 for them —
    still dead, just with a different status code than #1941 reported.
    """
    instance = _write_device_log(tmp_path, DEMO_REPORT_HEADER, DEMO_REPORT_ROWS)

    with DeviceLogProfilerQueries(instance) as csv:
        entries = csv.get_all_entries(as_dict=True)

    first = entries[0]
    assert first["zone_name"] == "BRISC-FW"
    assert first["run_host_ID"] == 1025
    # `run ID` is a real column here, not one the old hardcoded list invented.
    assert first["run_ID"] == 1024
    assert "meta_data" not in first


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


def test_stream_mode_validates_columns_without_holding_rows(tmp_path):
    """#1946: `stream=True` loads the header, and the header only."""
    instance = _write_device_log(tmp_path, MODERN_HEADER, MODERN_ROWS)

    with DeviceLogProfilerQueries(instance, stream=True) as csv:
        # The columns are there to validate against, but none of the rows.
        assert "zone name" in csv.runner.df.columns
        assert len(csv.runner.df) == 0

        # The filter still sees every row, because it reads them in chunks.
        assert len(csv.query_zone_statistics("BRISC-FW", as_dict=True)) == 2


def test_stream_mode_refuses_a_query_that_would_answer_from_the_header(tmp_path):
    """A resident-frame query on a streaming runner would silently return [].

    That is the #1941 failure mode again -- a 200 carrying nothing -- so it has
    to raise rather than answer.
    """
    instance = _write_device_log(tmp_path, MODERN_HEADER, MODERN_ROWS)

    with DeviceLogProfilerQueries(instance, stream=True) as csv:
        with pytest.raises(RuntimeError, match="execute_filtered_query"):
            csv.get_all_entries(as_dict=True)


def test_chunked_filter_matches_across_chunk_boundaries(tmp_path):
    """A match must not depend on where the chunk boundary happens to fall."""
    rows = [MODERN_ROWS[0]] * 5 + [MODERN_ROWS[2]] * 5 + [MODERN_ROWS[0]] * 5
    instance = _write_device_log(tmp_path, MODERN_HEADER, rows)

    with DeviceLogProfilerQueries(instance, stream=True) as csv:
        # Two rows per chunk, so both zones straddle several boundaries.
        with patch.object(csv_queries, "CSV_CHUNK_SIZE", 2):
            brisc = csv.query_zone_statistics("BRISC-FW", as_dict=True)
            trisc = csv.query_zone_statistics("TRISC-FW", as_dict=True)
            capped = csv.query_zone_statistics("BRISC-FW", as_dict=True, limit=3)

    assert len(brisc) == 10
    assert len(trisc) == 5
    # The limit is honoured exactly, not rounded up to a chunk.
    assert len(capped) == 3


def test_the_required_column_list_is_pinned():
    """The refusal test parametrises over this list, so it cannot police it.

    Dropping an entry would delete the case that covers it and leave the suite
    green -- `run host ID`, the join key #1941 is about, went unguarded exactly
    that way. Removing a column from the gate should be a deliberate edit here.
    """
    assert DeviceLogProfilerQueries.REQUIRED_DEVICE_LOG_COLUMNS == [
        "timer_id",
        "zone name",
        "run host ID",
    ]


@pytest.mark.parametrize("column", DeviceLogProfilerQueries.REQUIRED_DEVICE_LOG_COLUMNS)
def test_every_required_column_is_refused_by_name(tmp_path, column):
    """A short header must fail loudly rather than serve a shifted row.

    Parametrised over the whole list because a single case leaves the rest of
    the gate unpinned: dropping `run host ID` -- the join key #1941 is about --
    from `REQUIRED_DEVICE_LOG_COLUMNS` used to leave the suite green.
    """
    header, rows = drop_column(MODERN_HEADER, MODERN_ROWS, column)
    instance = _write_device_log(tmp_path, header, rows)

    with pytest.raises(DataFormatError, match=column):
        with DeviceLogProfilerQueries(instance):
            pass


def test_a_capture_that_cannot_be_parsed_is_a_data_error(tmp_path):
    """A header-only or ragged capture is bad data, not a server fault.

    `pd.read_csv` raises `EmptyDataError` / `ParserError` for these; uncaught
    they reach the catch-all as a 500 with a traceback the caller can trigger
    at will. See #1946.
    """
    empty = tmp_path / "empty"
    empty.mkdir()
    (empty / DeviceLogProfilerQueries.DEVICE_LOG_FILE).write_text(
        PREAMBLE + "\n", encoding="utf-8"
    )
    instance = Instance(instance_id="pytest-device-log", performance_path=str(empty))
    with pytest.raises(DataFormatError, match="could not be parsed"):
        with DeviceLogProfilerQueries(instance):
            pass

    ragged = tmp_path / "ragged"
    ragged.mkdir()
    instance = _write_device_log(
        ragged, MODERN_HEADER, [*MODERN_ROWS, MODERN_ROWS[0] + ",extra,fields"]
    )
    with pytest.raises(DataFormatError, match="could not be parsed"):
        with DeviceLogProfilerQueries(instance) as csv:
            csv.get_all_entries(as_dict=True)


def test_timer_id_query_matches_the_column_it_filters(tmp_path):
    """`timer_id` parses as int64, so a `str` argument matched nothing.

    The column is required on this method's behalf, so it has to work.
    """
    instance = _write_device_log(tmp_path, MODERN_HEADER, MODERN_ROWS)

    with DeviceLogProfilerQueries(instance) as csv:
        matched = csv.query_by_timer_id(18952, as_dict=True)

    assert len(matched) == 1
    assert matched[0]["zone_name"] == "BRISC-FW"
