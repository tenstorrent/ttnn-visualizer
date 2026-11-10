# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Every name bound counts a name's UTF-8 bytes, as an answer's budget does, so a
name of multi-byte characters cannot take more than its share of an answer. #2255
"""

import json

import pytest
from ttnn_visualizer.agent import noc_congestion, tools
from ttnn_visualizer.agent.bounds import answer_size
from ttnn_visualizer.agent.handles import ReportRegistry, load_report
from ttnn_visualizer.tests.test_agent_perf_detail import ANSWER_BUDGET_BYTES
from ttnn_visualizer.tests.test_agent_tools import _zone_timings
from ttnn_visualizer.tests.test_agent_zone_intervals import _intervals, _run
from ttnn_visualizer.tests.test_device_log_columns import (
    MODERN_HEADER,
    modern_row,
    write_device_log,
)

# Three bytes each in UTF-8.
WIDE = "€"


def _wide(size: int) -> str:
    """A name of `size` bytes in UTF-8, wide characters but for an ASCII remainder."""
    return WIDE * (size // 3) + "x" * (size % 3)


def test_a_name_is_measured_in_utf8_bytes():
    assert answer_size("abc") == 3
    assert answer_size(WIDE) == 3
    assert answer_size("😀") == 4


@pytest.mark.parametrize("extra, listed", [(0, True), (1, False)])
def test_a_zone_name_is_listed_up_to_the_bound_in_bytes(tmp_path, extra, listed):
    name = _wide(tools.MAX_ZONE_NAME_LENGTH + extra)

    result = _zone_timings(tmp_path, [(name, "BRISC", 900)])

    assert ([zone["zone"] for zone in result["zones"]] == [name]) is listed
    assert result.get("zones_unlisted_too_long", 0) == (0 if listed else 1)


@pytest.mark.parametrize("extra, listed", [(0, True), (1, False)])
def test_a_risc_name_is_listed_up_to_the_bound_in_bytes(tmp_path, extra, listed):
    risc = _wide(tools.MAX_RISC_NAME_LENGTH + extra)

    result = _zone_timings(tmp_path, [("MATMUL", risc, 900)])

    assert ([zone["risc"] for zone in result["zones"]] == [risc]) is listed


def test_a_hundred_wide_zone_names_keep_zone_timings_within_its_budget(tmp_path):
    """The issue's case: 100 distinct 256-character names of 3-byte characters made
    an answer of 87,401 B."""
    zones = [(f"{index:03}" + WIDE * 253, "BRISC", 900 + index) for index in range(100)]

    result = _zone_timings(tmp_path, zones, limit=100)

    assert result["zones_unlisted_too_long"] == 100
    assert len(json.dumps(result).encode()) < ANSWER_BUDGET_BYTES


def test_a_zone_argument_past_the_bound_in_bytes_is_refused(tmp_path):
    with pytest.raises(ValueError, match="zone is 258 bytes as an answer writes it"):
        _intervals(tmp_path, _run(0, 1, 1, "BRISC", 0, [100]), zone=WIDE * 86)


def test_a_signpost_argument_past_the_bound_in_bytes_is_refused(tmp_path):
    write_device_log(tmp_path, MODERN_HEADER, [])
    registry = ReportRegistry()
    load_report(registry, performance_path=str(tmp_path))

    with pytest.raises(
        ValueError, match="start_signpost is 258 bytes as an answer writes it"
    ):
        tools.top_ops(registry, "report-1", start_signpost=WIDE * 86)


@pytest.mark.parametrize("extra, kept", [(0, True), (1, False)])
def test_a_trace_label_is_kept_up_to_the_bound_in_bytes(extra, kept):
    label = _wide(noc_congestion.MAX_LABEL_LENGTH + extra)

    assert (noc_congestion._label(label) == label) is kept


def test_a_zone_argument_within_the_bound_answers(tmp_path):
    zone = _wide(tools.MAX_ZONE_NAME_LENGTH)
    rows = [
        modern_row(0, 1, 1, "BRISC", 0, "BRISC-KERNEL", "ZONE_START"),
        modern_row(0, 1, 1, "BRISC", 10, zone, "ZONE_START"),
        modern_row(0, 1, 1, "BRISC", 20, zone, "ZONE_END"),
        modern_row(0, 1, 1, "BRISC", 1010, zone, "ZONE_START"),
        modern_row(0, 1, 1, "BRISC", 1020, zone, "ZONE_END"),
    ]

    answer = _intervals(tmp_path, rows, zone=zone)

    assert answer["zone"] == zone
