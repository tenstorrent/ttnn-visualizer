# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Contract test pinning the performance table's colouring to tt-perf-report.

The frontend (``src/functions/perfFunctions.tsx``) re-implements tt-perf-report's
``color_row`` / ``evaluate_fidelity`` rules in TypeScript. Plain frontend tests can only
assert against hand-transcribed expectations, so they would keep passing if tt-perf-report
itself changed its rules in a new release.

This test closes that gap: it drives the *real* installed tt-perf-report functions over a
matrix of scenarios and writes a golden file (``tests/data/perfReportColourContract.json``).
The frontend test ``tests/perfReportColourContract.spec.ts`` then asserts that
``getCellColour`` / ``evaluateFidelity`` reproduce that same golden.

Chain of trust: tt-perf-report  ->  this golden  ->  the frontend.

  * If a tt-perf-report upgrade changes the rules, the generated golden no longer matches the
    committed one and THIS test fails — telling you to re-check the visualizer.
  * If the frontend drifts from the rules, the TypeScript test fails.

To refresh the golden after an intentional tt-perf-report change:

    EXPECTED_TT_PERF_REPORT_VERSION  <- bump the constant below to the new version
    pnpm run perf:golden             <- regenerates tests/data/perfReportColourContract.json

then run the frontend suite and reconcile any TypeScript differences.
"""

import json
import os
from importlib.metadata import version
from pathlib import Path

from tt_perf_report.perf_report import (
    Cell,
    color_row,
    default_cell_color,
    evaluate_fidelity,
)

# Keep in lockstep with the tt-perf-report pin in pyproject.toml. Bumping the pin without
# bumping this constant fails the version assertion below, forcing a deliberate parity review.
EXPECTED_TT_PERF_REPORT_VERSION = "1.2.4"

# tt-perf-report defaults (perf_report.py): --min-percentage and the Op-to-Op Gap threshold.
MIN_PERCENTAGE = 0.5
HIGH_DISPATCH_THRESHOLD_US = 6.5

GOLDEN_PATH = (
    Path(__file__).resolve().parents[3]
    / "tests"
    / "data"
    / "perfReportColourContract.json"
)

# Maps a frontend ColumnKeys value -> the op_data display key tt-perf-report's color_row() uses.
COLUMN_TO_TT_KEY = {
    "bound": "Bound",
    "dram": "DRAM",
    "dram_percent": "DRAM %",
    "flops": "FLOPs",
    "flops_percent": "FLOPs %",
    "cores": "Cores",
    "op_code": "OP Code",
    "math_fidelity": "Math Fidelity",
    "op_to_op_gap": "Op-to-Op Gap",
}

# Each colour scenario is described in *frontend* field names (the `row` that gets serialised for
# the TypeScript side). Defaults below are chosen so an unrelated column never perturbs the result.
ROW_DEFAULTS = {
    "total_percent": 50.0,
    "raw_op_code": "SomeDeviceOp",
    "bound": None,
    "cores": 32,
    "dram_percent": None,
    "flops_percent": None,
    "op_to_op_gap": None,
    "math_fidelity": "",
    "input_0_datatype": "",
    "input_1_datatype": "",
    "output_datatype": "",
}

COLOUR_SCENARIOS = [
    # Bound column
    {"id": "bound-dram", "column": "bound", "row": {"bound": "DRAM"}},
    {"id": "bound-flop", "column": "bound", "row": {"bound": "FLOP"}},
    {"id": "bound-slow", "column": "bound", "row": {"bound": "SLOW"}},
    {"id": "bound-host", "column": "bound", "row": {"bound": "HOST"}},
    {"id": "bound-both", "column": "bound", "row": {"bound": "BOTH"}},
    {"id": "bound-missing", "column": "bound", "row": {"bound": None}},
    # DRAM / FLOPS columns
    {"id": "dram-on-dram-bound", "column": "dram", "row": {"bound": "DRAM"}},
    {
        "id": "dram-pct-on-dram-bound",
        "column": "dram_percent",
        "row": {"bound": "DRAM"},
    },
    {"id": "flops-on-flop-bound", "column": "flops", "row": {"bound": "FLOP"}},
    {
        "id": "flops-pct-on-flop-bound",
        "column": "flops_percent",
        "row": {"bound": "FLOP"},
    },
    {
        "id": "dram-on-slow-dram-heavy",
        "column": "dram",
        "row": {"bound": "SLOW", "dram_percent": 80.0, "flops_percent": 10.0},
    },
    {
        "id": "flops-on-slow-dram-heavy",
        "column": "flops",
        "row": {"bound": "SLOW", "dram_percent": 80.0, "flops_percent": 10.0},
    },
    {
        "id": "flops-on-slow-flop-heavy",
        "column": "flops",
        "row": {"bound": "SLOW", "dram_percent": 10.0, "flops_percent": 80.0},
    },
    {"id": "dram-on-host-bound", "column": "dram", "row": {"bound": "HOST"}},
    {"id": "flops-on-host-bound", "column": "flops", "row": {"bound": "HOST"}},
    # Cores column
    {"id": "cores-low", "column": "cores", "row": {"cores": 4}},
    {"id": "cores-full", "column": "cores", "row": {"cores": 64}},
    {"id": "cores-mid", "column": "cores", "row": {"cores": 32}},
    {"id": "cores-missing", "column": "cores", "row": {"cores": None}},
    # OP Code column
    {
        "id": "op-torch",
        "column": "op_code",
        "row": {"raw_op_code": "(torch) aten::add"},
    },
    {"id": "op-matmul", "column": "op_code", "row": {"raw_op_code": "Matmul"}},
    {"id": "op-conv2d", "column": "op_code", "row": {"raw_op_code": "Conv2d"}},
    {
        "id": "op-optimizedconv",
        "column": "op_code",
        "row": {"raw_op_code": "OptimizedConvNew"},
    },
    {"id": "op-layernorm", "column": "op_code", "row": {"raw_op_code": "LayerNorm"}},
    {"id": "op-allgather", "column": "op_code", "row": {"raw_op_code": "AllGather"}},
    {
        "id": "op-sdpa",
        "column": "op_code",
        "row": {"raw_op_code": "ScaledDotProductAttentionDecode"},
    },
    {
        "id": "op-updatecache",
        "column": "op_code",
        "row": {"raw_op_code": "UpdateCache"},
    },
    {"id": "op-unmapped", "column": "op_code", "row": {"raw_op_code": "Softmax"}},
    # Op-to-Op Gap column
    {"id": "gap-high", "column": "op_to_op_gap", "row": {"op_to_op_gap": 7.0}},
    {"id": "gap-low", "column": "op_to_op_gap", "row": {"op_to_op_gap": 3.0}},
    {"id": "gap-missing", "column": "op_to_op_gap", "row": {"op_to_op_gap": None}},
    # Math Fidelity column
    {
        "id": "fidelity-sufficient",
        "column": "math_fidelity",
        "row": {
            "raw_op_code": "Matmul",
            "math_fidelity": "HiFi4",
            "input_0_datatype": "BFLOAT16",
            "input_1_datatype": "BFLOAT16",
            "output_datatype": "BFLOAT16",
        },
    },
    {
        "id": "fidelity-too-high",
        "column": "math_fidelity",
        "row": {
            "raw_op_code": "Matmul",
            "math_fidelity": "HiFi4",
            "input_0_datatype": "BFLOAT16",
            "input_1_datatype": "BFLOAT16",
            "output_datatype": "BFLOAT4_B",
        },
    },
    {
        "id": "fidelity-too-low",
        "column": "math_fidelity",
        "row": {
            "raw_op_code": "Matmul",
            "math_fidelity": "HiFi2",
            "input_0_datatype": "BFLOAT16",
            "input_1_datatype": "BFLOAT16",
            "output_datatype": "BFLOAT16",
        },
    },
    {
        "id": "fidelity-non-matmul-not-coloured",
        "column": "math_fidelity",
        "row": {
            "raw_op_code": "Softmax",
            "math_fidelity": "HiFi4",
            "input_0_datatype": "BFLOAT16",
            "input_1_datatype": "BFLOAT16",
            "output_datatype": "BFLOAT16",
        },
    },
    # Sub-threshold (< 0.5%) muting — keyed off the op code, not the op type.
    {
        "id": "muted-device-op",
        "column": "bound",
        "row": {"total_percent": 0.3, "bound": "DRAM", "raw_op_code": "SomeDeviceOp"},
    },
    {
        "id": "muted-non-torch-op",
        "column": "bound",
        "row": {"total_percent": 0.3, "bound": "DRAM", "raw_op_code": "SomeCpuOp"},
    },
    {
        "id": "unmuted-torch-op",
        "column": "op_code",
        "row": {"total_percent": 0.3, "raw_op_code": "(torch) aten::add"},
    },
]

FIDELITY_SCENARIOS = [
    {
        "id": "f-bf16-hifi4",
        "input_0": "BFLOAT16",
        "input_1": "BFLOAT16",
        "output": "BFLOAT16",
        "math_fidelity": "HiFi4",
    },
    {
        "id": "f-bf16-hifi2",
        "input_0": "BFLOAT16",
        "input_1": "BFLOAT16",
        "output": "BFLOAT16",
        "math_fidelity": "HiFi2",
    },
    {
        "id": "f-bf16-lofi",
        "input_0": "BFLOAT16",
        "input_1": "BFLOAT16",
        "output": "BFLOAT16",
        "math_fidelity": "LoFi",
    },
    {
        "id": "f-bfp4out-hifi4",
        "input_0": "BFLOAT16",
        "input_1": "BFLOAT16",
        "output": "BFLOAT4_B",
        "math_fidelity": "HiFi4",
    },
    {
        "id": "f-bfp4out-hifi2",
        "input_0": "BFLOAT16",
        "input_1": "BFLOAT16",
        "output": "BFLOAT4_B",
        "math_fidelity": "HiFi2",
    },
    {
        "id": "f-bfp4out-lofi",
        "input_0": "BFLOAT16",
        "input_1": "BFLOAT16",
        "output": "BFLOAT4_B",
        "math_fidelity": "LoFi",
    },
    {
        "id": "f-bfp8-hifi4",
        "input_0": "BFLOAT8_B",
        "input_1": "BFLOAT8_B",
        "output": "BFLOAT16",
        "math_fidelity": "HiFi4",
    },
    {
        "id": "f-bfp8-hifi2",
        "input_0": "BFLOAT8_B",
        "input_1": "BFLOAT8_B",
        "output": "BFLOAT16",
        "math_fidelity": "HiFi2",
    },
    {
        "id": "f-bfp8-lofi",
        "input_0": "BFLOAT8_B",
        "input_1": "BFLOAT8_B",
        "output": "BFLOAT16",
        "math_fidelity": "LoFi",
    },
    {
        "id": "f-bfp4w-lofi",
        "input_0": "BFLOAT8_B",
        "input_1": "BFLOAT4_B",
        "output": "BFLOAT16",
        "math_fidelity": "LoFi",
    },
    {
        "id": "f-bfp4w-hifi4",
        "input_0": "BFLOAT8_B",
        "input_1": "BFLOAT4_B",
        "output": "BFLOAT16",
        "math_fidelity": "HiFi4",
    },
    {
        "id": "f-integer",
        "input_0": "UINT8",
        "input_1": "BFLOAT16",
        "output": "BFLOAT16",
        "math_fidelity": "HiFi4",
    },
    {
        "id": "f-unsupported",
        "input_0": "MADE_UP",
        "input_1": "BFLOAT16",
        "output": "BFLOAT16",
        "math_fidelity": "HiFi4",
    },
]


def _build_op_data(row):
    """Construct the op_data dict (display key -> Cell) that color_row() mutates."""
    values = {**ROW_DEFAULTS, **row}

    return {
        "OP Code": Cell(values["raw_op_code"]),
        "Cores": Cell(values["cores"]),
        "Bound": Cell(values["bound"]),
        "DRAM": Cell(0.0),
        "DRAM %": Cell(values["dram_percent"]),
        "FLOPs": Cell(0.0),
        "FLOPs %": Cell(values["flops_percent"]),
        "Op-to-Op Gap": Cell(values["op_to_op_gap"]),
        "Math Fidelity": Cell(values["math_fidelity"]),
        "Input 0 Datatype": Cell(values["input_0_datatype"]),
        "Input 1 Datatype": Cell(values["input_1_datatype"]),
        "Output Datatype": Cell(values["output_datatype"]),
    }


def _colour_of(scenario):
    """Run the real color_row() and read the colour tt-perf-report assigned to the target cell."""
    values = {**ROW_DEFAULTS, **scenario["row"]}
    op_data = _build_op_data(scenario["row"])

    color_row(op_data, values["total_percent"], MIN_PERCENTAGE)

    colour = op_data[COLUMN_TO_TT_KEY[scenario["column"]]].color
    # An un-coloured cell (color is None) renders as the neutral default.
    return colour if colour is not None else default_cell_color


def _generate_golden():
    return {
        "_comment": (
            "GENERATED from tt-perf-report by "
            "backend/ttnn_visualizer/tests/test_perf_report_contract.py. "
            "Do not edit by hand; run UPDATE_PERF_GOLDEN=1 pytest to refresh."
        ),
        "ttPerfReportVersion": EXPECTED_TT_PERF_REPORT_VERSION,
        "minPercentage": MIN_PERCENTAGE,
        "highDispatchThresholdUs": HIGH_DISPATCH_THRESHOLD_US,
        "colours": [
            {
                "id": scenario["id"],
                "column": scenario["column"],
                "row": {**ROW_DEFAULTS, **scenario["row"]},
                "expected": _colour_of(scenario),
            }
            for scenario in COLOUR_SCENARIOS
        ],
        "fidelity": [
            {
                "id": scenario["id"],
                "input_0": scenario["input_0"],
                "input_1": scenario["input_1"],
                "output": scenario["output"],
                "math_fidelity": scenario["math_fidelity"],
                "expected": evaluate_fidelity(
                    scenario["input_0"],
                    scenario["input_1"],
                    scenario["output"],
                    scenario["math_fidelity"],
                )[0],
            }
            for scenario in FIDELITY_SCENARIOS
        ],
    }


def test_installed_version_matches_pin():
    assert version("tt-perf-report") == EXPECTED_TT_PERF_REPORT_VERSION, (
        "Installed tt-perf-report differs from the version this contract was generated against. "
        "Bump EXPECTED_TT_PERF_REPORT_VERSION (and the pyproject.toml pin), then regenerate the "
        "golden with UPDATE_PERF_GOLDEN=1 and reconcile the frontend parity tests."
    )


def test_colour_contract_matches_golden():
    generated = _generate_golden()

    if os.environ.get("UPDATE_PERF_GOLDEN"):
        GOLDEN_PATH.write_text(json.dumps(generated, indent=4) + "\n")

    assert GOLDEN_PATH.exists(), (
        f"Golden file missing: {GOLDEN_PATH}. Generate it with "
        "UPDATE_PERF_GOLDEN=1 .venv/bin/python -m pytest "
        "backend/ttnn_visualizer/tests/test_perf_report_contract.py"
    )

    committed = json.loads(GOLDEN_PATH.read_text())

    assert generated == committed, (
        "tt-perf-report's colouring no longer matches the committed golden. If this is an "
        "intentional tt-perf-report change, regenerate with UPDATE_PERF_GOLDEN=1 and update the "
        "frontend (src/functions/perfFunctions.tsx) to match."
    )
