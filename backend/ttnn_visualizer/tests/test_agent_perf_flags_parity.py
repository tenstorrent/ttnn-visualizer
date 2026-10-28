# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Parity between the agent's heuristic flags and the performance view's. #2193

`perf_flags` restates `annotatePerfHeuristicFlags`, `getCoreUtilization`, `resolveMaxCores`
and the fields `enrichRowData` parses for them. This test feeds the port seeded and curated
report rows and writes its answers to a golden file, and `tests/agentPerfFlagsParity.spec.ts`
asserts the app's functions give the same answers from the same rows. The rows are the
generated report's, so the golden holds the parse and the first-call rule as well.

    pnpm run agent:parity-golden    <- regenerates tests/data/agentPerfFlagsParity.json
"""

import math
import random
from typing import Any, Dict, List, Mapping, Optional, Sequence

from ttnn_visualizer.agent import perf_flags
from ttnn_visualizer.csv_queries import DeviceLogMeta
from ttnn_visualizer.tests.parity_golden import Golden

GOLDEN = Golden("agentPerfFlagsParity")
_SEED = 2193

# A generated report row's cells, which `test_agent_perf_flags.py` builds rows from too.
REPORT_ROW_DEFAULTS: Dict[str, object] = {
    "op_code": "Matmul",
    "op_type": "tt_dnn_device",
    "bound": "",
    "total_percent": "5.0",
    "device_time": "10.0",
    "cores": "64",
    "available_cores": "64",
    "bound_analysis": "full",
    "dram_percent": "",
    "flops_percent": "",
    "pm_ideal_ns": "",
    "hash": None,
    "cache_hit": None,
}


def _rows(*overrides: Mapping[str, object]) -> List[Dict[str, object]]:
    """Report rows as the generator writes them: cells are text, ids CSV positions."""
    return [
        {"id": str(index + 2), **REPORT_ROW_DEFAULTS, **fields}
        for index, fields in enumerate(overrides)
    ]


def _json_number(value: float) -> object:
    # JSON holds no NaN, so one travels as the string `Number()` reads.
    return "NaN" if math.isnan(value) else value


def _typed_rows(rows: List[Dict[str, object]]) -> List[perf_flags.FlagRow]:
    repeats = {id(row) for row, first in perf_flags.program_calls(rows) if not first}
    return [perf_flags.typed_row(row, id(row) not in repeats) for row in rows]


def _flag_case(rows: List[Dict[str, object]], max_cores: float = 64) -> Dict:
    typed = _typed_rows(rows)
    return {
        "rows": rows,
        "maxCores": _json_number(max_cores),
        "flags": [perf_flags.heuristic_flags(row, max_cores) for row in typed],
        "utilisation": [perf_flags.core_utilisation(row, max_cores) for row in typed],
    }


# The utilisation (300 / 1000) * (64 / 64) is exactly 0.3, and 16 of 64 cores exactly 0.25.
_AT_UTILISATION = {"pm_ideal_ns": "300", "device_time": "1", "cores": "64"}
_BELOW_UTILISATION = {**_AT_UTILISATION, "pm_ideal_ns": "299"}


_EVERY_FLAG = {
    "bound": "DRAM",
    "dram_percent": "80",
    "flops_percent": "5",
    "pm_ideal_ns": "30",
    "device_time": "1",
    "cores": "8",
    "available_cores": None,
    "hash": "h",
    "cache_hit": False,
}


def _curated_flag_cases() -> List[Dict]:
    """Each boundary and eligibility rule once, since a random row rarely lands on one."""
    dram = {"bound": "DRAM", "dram_percent": "80", "flops_percent": "5"}
    return [
        # The impact gate, at and just below it, and as JavaScript parses the cell.
        _flag_case(
            _rows(
                {**dram, "total_percent": "0.5"},
                {**dram, "total_percent": "0.49999999"},
                {**dram, "total_percent": "0.5abc"},
                {**dram, "total_percent": " 0.6"},
                {**dram, "total_percent": ""},
                {**dram, "total_percent": "nan"},
                {**dram, "total_percent": "-Infinity"},
                {**dram, "total_percent": "Infinity"},
            )
        ),
        # Low utilisation at 0.3, below it, at zero, and where it cannot be read.
        _flag_case(
            _rows(
                _AT_UTILISATION,
                _BELOW_UTILISATION,
                {**_BELOW_UTILISATION, "bound_analysis": "none"},
                {**_BELOW_UTILISATION, "bound_analysis": None},
                {**_BELOW_UTILISATION, "bound_analysis": "NONE"},
                {**_BELOW_UTILISATION, "bound_analysis": "flops_only"},
                {**_BELOW_UTILISATION, "total_percent": "0.4"},
                {**_AT_UTILISATION, "pm_ideal_ns": "0"},
                {**_AT_UTILISATION, "pm_ideal_ns": 0},
                {**_AT_UTILISATION, "pm_ideal_ns": 299},
                {**_AT_UTILISATION, "pm_ideal_ns": "nan"},
                {**_AT_UTILISATION, "device_time": "0"},
                {**_AT_UTILISATION, "device_time": "-1"},
                {**_AT_UTILISATION, "device_time": ""},
                {**_AT_UTILISATION, "cores": "0", "pm_ideal_ns": "0"},
                {**_AT_UTILISATION, "cores": "0"},
                {**_AT_UTILISATION, "cores": "0", "pm_ideal_ns": "-300"},
                {**_AT_UTILISATION, "pm_ideal_ns": 0, "device_time": "-1"},
                {**_AT_UTILISATION, "pm_ideal_ns": "0", "device_time": "-1"},
            )
        ),
        # JavaScript's number parsing in every field the flags read: the longest numeric
        # prefix, after JavaScript's whitespace and no other.
        _flag_case(
            _rows(
                {**_BELOW_UTILISATION, "device_time": "1abc"},
                {**_BELOW_UTILISATION, "device_time": "1e0x"},
                {**_BELOW_UTILISATION, "device_time": "\u00a01"},
                {**_AT_UTILISATION, "pm_ideal_ns": "299abc"},
                {**_AT_UTILISATION, "pm_ideal_ns": "2.99e2x"},
                {**_AT_UTILISATION, "pm_ideal_ns": "\ufeff299"},
                {"bound": "SLOW", "dram_percent": "41abc", "flops_percent": "40"},
                {"bound": "SLOW", "dram_percent": "40", "flops_percent": "39abc"},
                {"bound": "SLOW", "dram_percent": "\t41", "flops_percent": "\n40"},
                {"bound": "DRAM", "dram_percent": "12abc", "flops_percent": "1e3x"},
                {"bound": "SLOW", "dram_percent": 0, "flops_percent": "-1"},
                {**dram, "total_percent": "\u00a00.6"},
                {**dram, "total_percent": "\ufeff0.6"},
                {**dram, "total_percent": "\t0.6"},
                {**dram, "total_percent": "\n0.6"},
                {**dram, "total_percent": "\u20030.6"},
                {**dram, "total_percent": "\x1c0.6"},
                {**dram, "total_percent": "\u200b0.6"},
                {**dram, "total_percent": "Infinityx"},
                {"cores": "\u00a08", "available_cores": "\ufeff64"},
                # Reads that must not raise: a negative zero, whose sign no output here
                # shows (`test_agent_js_values.py` holds it), and a cell past the float range.
                {"cores": "8", "available_cores": "-0"},
                {"cores": "-0"},
                {"cores": "9" * 309},
            )
        ),
        # Just under the threshold, where a rounded figure would read as at it.
        _flag_case(_rows({**_AT_UTILISATION, "pm_ideal_ns": "299.9999"})),
        # The perf model's 1 ns placeholder reads as an ideal time to the port, as to the
        # view; only the tool's own reading drops it.
        _flag_case(_rows({"pm_ideal_ns": "1", "cores": "64"})),
        # Underutilised cores at a quarter of the capacity, below it, and the capacity
        # the row's own available cores or the device's maximum give.
        _flag_case(
            _rows(
                {"cores": "16"},
                {"cores": "15"},
                {"cores": "31", "available_cores": "128"},
                {"cores": "16.9"},
                {"cores": "15.9"},
                {"cores": "8e1"},
                {"cores": " 8"},
                {"cores": "8", "available_cores": None},
                {"cores": "8", "available_cores": ""},
                {"cores": "8", "available_cores": "abc"},
                {"cores": "8", "available_cores": "16"},
                {"cores": "8", "available_cores": "0"},
                {"cores": "-4", "available_cores": "0"},
                {"cores": "16", "available_cores": "64.9"},
                {"cores": "abc"},
                {"cores": "-4"},
                {"cores": "8", "total_percent": "0.1"},
            )
        ),
        # No maximum: nothing is underutilised, even against a row's own capacity.
        _flag_case(
            _rows(
                {"cores": "8", "available_cores": None},
                {"cores": "8", "available_cores": "64"},
                {**_BELOW_UTILISATION, "available_cores": None},
            ),
            max_cores=0,
        ),
        # A NaN maximum passes the view's `<= 0` refusal, so a row's own capacity still
        # decides; utilisation scaled by a NaN maximum is unreadable.
        _flag_case(
            _rows(
                {"cores": "8", "available_cores": "64"},
                {"cores": "8", "available_cores": None},
                {**_BELOW_UTILISATION, "available_cores": None},
            ),
            max_cores=math.nan,
        ),
        # A SLOW bound with DRAM at, above and below FLOPs, and with either one missing.
        _flag_case(
            _rows(
                {"bound": "SLOW", "dram_percent": "40", "flops_percent": "40"},
                {"bound": "SLOW", "dram_percent": "40.001", "flops_percent": "40"},
                {"bound": "SLOW", "dram_percent": "10", "flops_percent": "40"},
                {"bound": "SLOW", "dram_percent": "", "flops_percent": "40"},
                {"bound": "SLOW", "dram_percent": "40", "flops_percent": ""},
                {"bound": "SLOW", "dram_percent": "0", "flops_percent": ""},
                {"bound": "SLOW", "dram_percent": "nan", "flops_percent": "1"},
                {"bound": "DRAM"},
                {"bound": "dram", "dram_percent": "80"},
                {"bound": "FLOP", "dram_percent": "80", "flops_percent": "5"},
                {"bound": "BOTH", "dram_percent": "80", "flops_percent": "70"},
            )
        ),
        # Ineligible rows carry no flag at all, a repeat miss included.
        _flag_case(
            _rows(
                {"hash": "a", "cache_hit": False},
                {**dram, "hash": "a", "cache_hit": False, "missing": True},
                {**dram, "hash": "a", "cache_hit": False, "op_type": "signpost"},
                {**dram, "hash": "a", "cache_hit": False, "bound": "HOST"},
                {**dram, "hash": "a", "cache_hit": False, "missing": False},
                {**dram, "hash": "a", "cache_hit": False, "missing": 0},
            )
        ),
        # First calls against repeats, with every cache result, and a first call on a row
        # no other flag may apply to.
        _flag_case(
            _rows(
                {"hash": "h", "cache_hit": False},
                {"hash": "h", "cache_hit": True},
                {"hash": "h", "cache_hit": False},
                {"hash": "h", "cache_hit": None},
                {"hash": "h", "cache_hit": "False"},
                {"hash": "", "cache_hit": False},
                {"hash": "", "cache_hit": False},
                {"hash": "x", "cache_hit": False, "bound": "HOST"},
                {"hash": "x", "cache_hit": False, "total_percent": "0.01"},
                {"hash": None, "cache_hit": False},
            )
        ),
        # Every flag on the repeat, in the view's order: 0.03 x 64 / 8 is 0.24.
        _flag_case(_rows(_EVERY_FLAG, _EVERY_FLAG)),
    ]


_CELLS: Dict[str, List[object]] = {
    "op_type": ["tt_dnn_device"] * 6 + ["signpost", "python_fallback", None],
    "bound": [None, "", "DRAM", "DRAM", "SLOW", "SLOW", "HOST", "FLOP", "BOTH"],
    "total_percent": ["0.5", "0.49", "3.2", "12.5", "40", "", "nan", "0.0001"],
    "device_time": ["10.0", "0.5", "250.75", "", "0", "nan"],
    "cores": ["1", "8", "16", "48", "64", "110", "130", "", "0", "200"],
    "available_cores": [None, "", "64", "64", "110", "130", "16", "0"],
    "bound_analysis": [None, "full", "full", "flops_only", "none", "none"],
    "dram_percent": [None, "", "5", "40", "65", "80.25", "nan"],
    "flops_percent": [None, "", "5", "40", "65", "12.5"],
    "pm_ideal_ns": [None, "", "1", "236", "946", "3000", "150000", "0", "nan"],
    "hash": [None, None, "a", "b", "c", ""],
    "cache_hit": [True, False, False, None],
}


# Typed rows no report row parses to, for the rules `enrichRowData` never exercises: a
# repeat with no program, or with an empty one.
_TYPED_ROWS: List[Dict[str, Any]] = [
    {"hash": None, "isFirstHashOccurrence": False, "cache_hit": False},
    {"hash": "", "isFirstHashOccurrence": False, "cache_hit": False},
    {"hash": "h", "isFirstHashOccurrence": False, "cache_hit": False},
    {"hash": "h", "isFirstHashOccurrence": True, "cache_hit": False},
]


def _typed_cases() -> List[Dict]:
    return [
        {
            "row": {"total_percent": 5.0, "op_type": "tt_dnn_device", **fields},
            "flags": perf_flags.heuristic_flags(
                perf_flags.FlagRow(
                    total_percent=5.0,
                    op_type="tt_dnn_device",
                    hash=fields["hash"],
                    is_first_hash_occurrence=bool(fields["isFirstHashOccurrence"]),
                    cache_hit=fields["cache_hit"],
                ),
                64,
            ),
        }
        for fields in _TYPED_ROWS
    ]


def _random_flag_cases(rng: random.Random) -> List[Dict]:
    cases = []
    for _ in range(40):
        rows = []
        for _ in range(rng.randint(1, 8)):
            row = {column: rng.choice(values) for column, values in _CELLS.items()}
            if rng.random() < 0.05:
                row["missing"] = True
            rows.append(row)
        cases.append(_flag_case(_rows(*rows), rng.choice([64, 64, 130, 120, 32, 1])))
    return cases


def _max_core_case(meta: Optional[Mapping[str, Any]], cores: Sequence[object]) -> Dict:
    rows = _rows(*({"cores": cell} for cell in cores))
    resolved = perf_flags.resolve_max_cores(
        None if meta is None else DeviceLogMeta(**meta),
        [perf_flags.row_cores(row) for row in rows],
    )
    return {"deviceMeta": meta, "rows": rows, "maxCores": resolved.cores}


def _curated_max_core_cases() -> List[Dict]:
    """The device log's count, each architecture's default, and the rows' count above it."""
    cases = [
        _max_core_case(None, ["8"]),
        _max_core_case(None, ["100", "abc", ""]),
        _max_core_case(None, []),
        _max_core_case({"max_cores": 130}, ["8"]),
        _max_core_case({"architecture": "wormhole_b0", "max_cores": 72}, ["200"]),
        _max_core_case({"architecture": "blackhole", "max_cores": None}, ["8"]),
        _max_core_case({"architecture": "blackhole", "max_cores": None}, ["200"]),
        _max_core_case({"architecture": "blackhole", "max_cores": None}, ["130"]),
        _max_core_case({"architecture": "wormhole_b0", "max_cores": None}, ["64"]),
        _max_core_case({"architecture": None, "max_cores": None}, ["70"]),
        _max_core_case({"architecture": "", "max_cores": None}, ["8"]),
        _max_core_case({"architecture": "horizon", "max_cores": None}, ["100"]),
        _max_core_case({"architecture": "horizon", "max_cores": None}, ["8"]),
        _max_core_case({"architecture": 7, "max_cores": None}, ["8"]),
        _max_core_case({"max_cores": 0}, []),
        _max_core_case({"max_cores": 0}, ["200"]),
        # QSR3.A2 reports `quasar` with 96 cores, above the 32 default.
        _max_core_case({"architecture": "quasar", "max_cores": 96}, []),
        _max_core_case({"architecture": "quasar", "max_cores": None}, ["96"]),
    ]
    for name in ("grayskull", "QUASAR", "quasar", "grendel", "Blackhole_p150"):
        cases.append(_max_core_case({"architecture": name, "max_cores": None}, ["8"]))
    return cases


def _random_max_core_cases(rng: random.Random) -> List[Dict]:
    architectures = [None, "wormhole_b0", "blackhole", "quasar", "grayskull", "x"]
    cases = []
    for _ in range(20):
        meta = rng.choice(
            [
                None,
                {
                    "architecture": rng.choice(architectures),
                    "max_cores": rng.choice([None, None, 0, 64, 120]),
                },
            ]
        )
        cores = [
            rng.choice(["1", "64", "72", "110", "130", "140", "", "x"])
            for _ in range(rng.randint(0, 5))
        ]
        cases.append(_max_core_case(meta, cores))
    return cases


def _generate_golden() -> Dict:
    rng = random.Random(_SEED)
    return {
        "_comment": (
            "Generated by backend/ttnn_visualizer/tests/test_agent_perf_flags_parity.py "
            "from the agent's port. Do not edit by hand; run pnpm run agent:parity-golden."
        ),
        "flagCases": _curated_flag_cases() + _random_flag_cases(rng),
        "typedCases": _typed_cases(),
        "maxCoreCases": _curated_max_core_cases() + _random_max_core_cases(rng),
    }


def test_the_port_reproduces_the_golden():
    GOLDEN.check(_generate_golden())


def _entries(golden: Dict) -> List[Dict]:
    return [
        entry
        for case in golden["flagCases"]
        for row_flags in case["flags"]
        for entry in row_flags
    ]


def test_the_golden_exercises_every_branch():
    """A matrix that never reached a branch would leave it unchecked on both sides."""
    golden = _generate_golden()
    entries = _entries(golden)

    assert {entry["flag"] for entry in entries} == {
        flag.value for flag in perf_flags.PerfHeuristicFlag
    }
    assert {entry["reason"] for entry in entries if "reason" in entry} == {
        reason.value for reason in perf_flags.DramBoundReason
    }
    assert {
        entry["core_capacity_from"]
        for entry in entries
        if "core_capacity_from" in entry
    } == {source.value for source in perf_flags.CoreCapacitySource}
    assert {
        entry["roofline_modelled"] for entry in entries if "roofline_modelled" in entry
    } == {True, False, None}
    assert any(
        not row_flags for case in golden["flagCases"] for row_flags in case["flags"]
    )
    assert any(
        len(row_flags) == 4
        for case in golden["flagCases"]
        for row_flags in case["flags"]
    )


def test_the_max_core_cases_reach_every_source():
    sources = {
        perf_flags.resolve_max_cores(
            meta and DeviceLogMeta(**meta),
            [perf_flags.row_cores(row) for row in case["rows"]],
        ).source
        for case in _generate_golden()["maxCoreCases"]
        for meta in [case["deviceMeta"]]
    }

    assert sources == set(perf_flags.MaxCoresSource)


def test_the_ts_spec_reads_this_golden():
    GOLDEN.check_spec_reads_it()
