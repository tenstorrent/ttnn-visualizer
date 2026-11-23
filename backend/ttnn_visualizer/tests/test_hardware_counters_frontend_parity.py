# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Pins the frontend's copies of the hardware counter vocabulary, and of the stall
breakdown's, to this package's. #2371 #2372"""

import re
from enum import Enum
from pathlib import Path
from typing import Type

import pytest
from ttnn_visualizer import hardware_counters
from ttnn_visualizer.hardware_counters import (
    CounterAbsence,
    CounterFamily,
    CounterMeasure,
    CounterUnit,
)
from ttnn_visualizer.pipeline_stalls import (
    THREADS,
    CbWaitZone,
    PipelineThread,
    StallSource,
    StallState,
    ThreadRole,
)
from ttnn_visualizer.tests.frontend_parity import (
    typescript_enum_members,
    typescript_enum_values,
    typescript_string_constant,
)

_DEFINITIONS = Path(__file__).resolve().parents[3] / "src" / "definitions"


@pytest.mark.parametrize(
    ("name", "enum"),
    [
        ("HardwareCounterUnit", CounterUnit),
        ("HardwareCounterFamily", CounterFamily),
        ("HardwareCounterAbsence", CounterAbsence),
        ("HardwareCounterMeasure", CounterMeasure),
    ],
)
def test_each_enum_matches_its_frontend_copy(name: str, enum: Type[Enum]):
    assert typescript_enum_values(_DEFINITIONS / "HardwareCounters.ts", name) == {
        member.value for member in enum
    }


def test_the_tables_counter_columns_are_the_keys_the_app_rows_carry():
    app_keys = {unit.row_key for unit in hardware_counters.HEADLINE_UNITS} | {
        grid.row_key for grid in hardware_counters.FULL_GRID_UNITS
    }
    column_keys = typescript_enum_values(_DEFINITIONS / "PerfTable.ts", "ColumnKeys")

    assert {key for key in column_keys if key.startswith("hw_")} == app_keys


@pytest.mark.parametrize(
    ("name", "value"),
    [
        ("HARDWARE_COUNTER_CAPTURE_FLAG", hardware_counters.CAPTURE_FLAG),
        ("HARDWARE_COUNTER_EXAMPLE_GROUPS", hardware_counters.EXAMPLE_GROUPS),
    ],
)
def test_the_capture_advice_quotes_this_packages_flag_and_groups(name: str, value: str):
    """The panel, the table's switch and the agent all tell a user how to capture."""
    assert (
        typescript_string_constant(_DEFINITIONS / "HardwareCounters.ts", name) == value
    )


@pytest.mark.parametrize(
    ("name", "enum"),
    [
        ("PipelineThread", PipelineThread),
        ("PipelineThreadRole", ThreadRole),
        ("CbWaitZone", CbWaitZone),
        ("StallSource", StallSource),
        ("StallState", StallState),
    ],
)
def test_each_stall_enum_matches_its_frontend_copy(name: str, enum: Type[Enum]):
    assert typescript_enum_values(_DEFINITIONS / "PipelineStalls.ts", name) == {
        member.value for member in enum
    }


def test_each_cb_zone_is_the_thread_the_backend_gives_it():
    """The Stalls tab names each zone's row, and finds its poll, by this thread."""
    source = (_DEFINITIONS / "PipelineStalls.ts").read_text(encoding="utf-8")
    zones = typescript_enum_members(_DEFINITIONS / "PipelineStalls.ts", "CbWaitZone")
    threads = typescript_enum_members(
        _DEFINITIONS / "PipelineStalls.ts", "PipelineThread"
    )
    frontend = {
        zones[zone]: threads[thread]
        for zone, thread in re.findall(
            r"\[CbWaitZone\.(\w+)\]:\s*\{\s*thread:\s*PipelineThread\.(\w+)", source
        )
    }

    assert frontend == {
        thread.cb_zone.value: thread.thread.value
        for thread in THREADS
        if thread.cb_zone is not None
    }
