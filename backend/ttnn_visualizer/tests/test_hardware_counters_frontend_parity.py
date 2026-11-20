# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Pins the frontend's copies of the hardware counter vocabulary to this package's. #2371"""

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
from ttnn_visualizer.tests.frontend_parity import typescript_enum_values

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
