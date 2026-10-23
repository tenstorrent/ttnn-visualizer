# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""The performance view's heuristic flags, each with the evidence behind it. #2193

A port of `annotatePerfHeuristicFlags` (`src/functions/computePerfHeuristicFlags.ts`),
with `getCoreUtilization`, `isSlowDramDominant`, `resolveMaxCores`, `getCoreCount`, the
thresholds in `src/definitions/PerfHeuristics.ts`, and the fields and first-call rule
`enrichRowData` parses for them; mirror a change there. The view's allocation-failure
and DRAM-fallback flags are not ported, because `errors` and `dram_fallbacks` answer
them.

Values are read as JavaScript reads them: a NaN stays one where `parseFloat` gives it,
and None is null, since which of the two a cell becomes decides some flags.
"""

import math
import re
from dataclasses import dataclass, replace
from enum import Enum
from typing import (
    Dict,
    FrozenSet,
    Iterable,
    Iterator,
    List,
    NamedTuple,
    Optional,
    Sequence,
    Set,
    Tuple,
    TypeGuard,
)

from ttnn_visualizer.agent.perf_detail import is_unmodelled
from ttnn_visualizer.csv_queries import SIGNPOST_OP_TYPE, DeviceLogMeta


class PerfHeuristicFlag(str, Enum):
    DRAM_BOUND = "dram_bound"
    LOW_UTILISATION = "low_utilisation"
    UNDERUTILISED_CORES = "underutilised_cores"
    RECOMPUTE_CANDIDATE = "recompute_candidate"


class DramBoundReason(str, Enum):
    BOUND_DRAM = "bound_dram"
    SLOW_DRAM_ABOVE_FLOPS = "slow_dram_above_flops"


class CoreCapacitySource(str, Enum):
    AVAILABLE_CORES = "available_cores"
    MAX_CORES = "max_cores"


class MaxCoresSource(str, Enum):
    DEVICE_LOG = "device_log"
    ARCHITECTURE_DEFAULT = "architecture_default"
    REPORT_ROWS = "report_rows"
    FALLBACK_DEFAULT = "fallback_default"


class DeviceArchitecture(str, Enum):
    UNKNOWN = ""
    GRAYSKULL = "grayskull"
    WORMHOLE = "wormhole_b0"
    BLACKHOLE = "blackhole"
    QUASAR = "quasar"
    GRENDEL = "grendel"


class BoundType(str, Enum):
    """tt-perf-report's `bound`, as `BoundType` in `src/definitions/PerfTable.ts`."""

    BOTH = "BOTH"
    DRAM = "DRAM"
    FLOP = "FLOP"
    SLOW = "SLOW"
    HOST = "HOST"


class BoundAnalysis(str, Enum):
    """Which roofline model tt-perf-report ran, as `BoundAnalysis` in `PerfTable.ts`."""

    FULL = "full"
    FLOPS_ONLY = "flops_only"
    NONE = "none"


# tt-perf-report's own mute threshold, as the view's is.
MIN_TOTAL_PERCENT = 0.5
LOW_CORE_UTILISATION_RATIO = 0.3
UNDERUTILISED_CORES_RATIO = 0.25

# Fewer than the documentation counts: one or two rows of cores are harvested.
_CORE_COUNT = {
    DeviceArchitecture.GRAYSKULL: 108,
    DeviceArchitecture.WORMHOLE: 64,
    DeviceArchitecture.BLACKHOLE: 130,
    DeviceArchitecture.QUASAR: 32,
    DeviceArchitecture.GRENDEL: 32,
}
DEFAULT_MAX_CORES = _CORE_COUNT[DeviceArchitecture.WORMHOLE]

# `stringToArchitecture`'s prefixes, in the order it tries them.
_ARCHITECTURE_PREFIXES = (
    ("wormhole", DeviceArchitecture.WORMHOLE),
    ("blackhole", DeviceArchitecture.BLACKHOLE),
    ("quasar", DeviceArchitecture.QUASAR),
    ("grendel", DeviceArchitecture.GRENDEL),
    ("grayskull", DeviceArchitecture.GRAYSKULL),
)

_BOUND_ANALYSES = frozenset(analysis.value for analysis in BoundAnalysis)

# What `parseFloat` and `parseInt(…, 10)` read: the longest such prefix, after spaces.
_JS_FLOAT = re.compile(
    r"[+-]?(?:Infinity|(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?)"
)
_JS_INT = re.compile(r"[+-]?[0-9]+")
_JS_WHITESPACE = (
    "\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006"
    "\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
)


def _js_text(value: object) -> str:
    """`String(value)` for what a report cell holds: text, a flag, or null."""
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def _parse_float(value: object) -> float:
    match = _JS_FLOAT.match(_js_text(value).lstrip(_JS_WHITESPACE))
    return float(match.group(0)) if match else math.nan


def _parse_int(value: object) -> float:
    match = _JS_INT.match(_js_text(value).lstrip(_JS_WHITESPACE))
    return float(match.group(0)) if match else math.nan


def _is_truthy(value: object) -> bool:
    """JavaScript's truthiness, which `enrichRowData` tests some cells by first."""
    if value is None:
        return False
    if isinstance(value, float):
        return value != 0 and not math.isnan(value)
    if isinstance(value, (bool, int, str)):
        return bool(value)
    return True


def _parse_nullable_integer(value: object) -> Optional[float]:
    if value is None or value == "":
        return None
    parsed = _parse_int(value)
    return None if math.isnan(parsed) else parsed


def _parse_filled_float(value: object) -> Optional[float]:
    return _parse_float(value) if _is_truthy(value) else None


def _is_valid_number(value: object) -> TypeGuard[float]:
    """`isValidNumber`, which is `Number.isFinite`."""
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
    )


def _divide(numerator: float, denominator: float) -> float:
    """IEEE division, as JavaScript divides; Python raises on a zero denominator."""
    if denominator != 0:
        return numerator / denominator
    if numerator == 0 or math.isnan(numerator):
        return math.nan
    return math.copysign(math.inf, numerator) * math.copysign(1.0, denominator)


def program_calls(rows: Iterable[Dict]) -> Iterator[Tuple[Dict, bool]]:
    """Each row with a program hash, and whether it is its program's first call.

    `enrichRowData`'s rule: a hash's first row in report order is its first call, and
    every later one a repeat. `program_cache` counts its calls by it too.
    """
    seen: Set[object] = set()
    for row in rows:
        program = row.get("hash") or None
        if program is None:
            continue
        yield row, program not in seen
        seen.add(program)


def is_repeat_miss(program: object, is_first_call: bool, cache_hit: object) -> bool:
    """The view's recompute candidate: a repeat call that missed the program cache."""
    return program is not None and not is_first_call and cache_hit is False


def cache_looks_disabled(repeat_hits: int, repeat_misses: int) -> bool:
    """Whether every repeat call that recorded a result missed, as with no cache."""
    return repeat_misses > 0 and repeat_hits == 0


CACHE_DISABLED_CAVEAT = (
    "Every repeat call that recorded a result missed the program cache, which is what "
    "a run with the program cache disabled records. Check whether it was before "
    "reading each repeat miss as a program built again."
)


@dataclass(frozen=True)
class FlagRow:
    """A row in the fields the flags read, typed as `enrichRowData` types them."""

    total_percent: Optional[float] = None
    device_time: Optional[float] = None
    cores: Optional[float] = None
    available_cores: Optional[float] = None
    dram_percent: Optional[float] = None
    flops_percent: Optional[float] = None
    pm_ideal_ns: Optional[float] = None
    bound: object = None
    bound_analysis: Optional[BoundAnalysis] = None
    op_type: object = None
    hash: object = None
    cache_hit: object = None
    missing: object = None
    is_first_hash_occurrence: bool = True


def row_cores(row: Dict) -> float:
    """A row's core count as `enrichRowData` parses it, which `core_count` reads."""
    return _parse_int(row.get("cores"))


def typed_row(row: Dict, is_first_hash_occurrence: bool = True) -> FlagRow:
    """A generated report row as `enrichRowData` types it, in the fields the flags read.

    Whether the row is its program's first call is the caller's to say, from the whole
    report, by `program_calls`.
    """
    bound_analysis = row.get("bound_analysis")
    return FlagRow(
        total_percent=_parse_float(row.get("total_percent")),
        device_time=_parse_float(row.get("device_time")),
        cores=row_cores(row),
        available_cores=_parse_nullable_integer(row.get("available_cores")),
        dram_percent=_parse_filled_float(row.get("dram_percent")),
        flops_percent=_parse_filled_float(row.get("flops_percent")),
        pm_ideal_ns=_parse_filled_float(row.get("pm_ideal_ns")),
        bound=row.get("bound"),
        bound_analysis=(
            BoundAnalysis(bound_analysis) if bound_analysis in _BOUND_ANALYSES else None
        ),
        op_type=row.get("op_type"),
        hash=row.get("hash"),
        cache_hit=row.get("cache_hit"),
        missing=row.get("missing"),
        is_first_hash_occurrence=is_first_hash_occurrence,
    )


def _core_capacity(row: FlagRow, max_cores: float) -> float:
    return row.available_cores if row.available_cores is not None else max_cores


def core_utilisation(row: FlagRow, max_cores: float) -> float:
    """`getCoreUtilization`, as a ratio: the ideal time over the device time, scaled by
    the cores the op could have used over the cores it did; 0 where it cannot be read.
    """
    ideal, duration, cores = row.pm_ideal_ns, row.device_time, row.cores
    if (
        _is_valid_number(ideal)
        and _is_valid_number(duration)
        and _is_valid_number(cores)
    ):
        utilisation = _divide(ideal, duration * 1000) * _divide(
            _core_capacity(row, max_cores), cores
        )
        if _is_valid_number(utilisation):
            return utilisation
    return 0.0


def _is_eligible(row: FlagRow) -> bool:
    return (
        not _is_truthy(row.missing)
        and row.op_type != SIGNPOST_OP_TYPE
        and row.bound != BoundType.HOST
    )


def _meets_min_impact(row: FlagRow) -> bool:
    return row.total_percent is not None and row.total_percent >= MIN_TOTAL_PERCENT


def _is_slow_dram_dominant(row: FlagRow) -> bool:
    return (
        row.bound == BoundType.SLOW
        and row.dram_percent is not None
        and row.flops_percent is not None
        and row.dram_percent > row.flops_percent
    )


def _is_underutilised_cores(row: FlagRow, max_cores: float) -> bool:
    cores = row.cores
    # Not `max_cores > 0`: the view refuses only `<= 0`, which a NaN passes.
    if _is_valid_number(cores) and not max_cores <= 0:
        capacity = _core_capacity(row, max_cores)
        return capacity > 0 and cores / capacity < UNDERUTILISED_CORES_RATIO
    return False


def _figure(value: Optional[float]) -> Optional[float]:
    return round(value, 3) if _is_valid_number(value) else None


def _whole(value: object) -> object:
    """A count as JSON writes an integer, which a parsed one always is."""
    return int(value) if isinstance(value, float) and value.is_integer() else value


def _dram_bound(row: FlagRow) -> Dict[str, object]:
    reason = (
        DramBoundReason.SLOW_DRAM_ABOVE_FLOPS
        if _is_slow_dram_dominant(row)
        else DramBoundReason.BOUND_DRAM
    )
    return {
        "flag": PerfHeuristicFlag.DRAM_BOUND.value,
        "reason": reason.value,
        "dram_percent": _figure(row.dram_percent),
        "flops_percent": _figure(row.flops_percent),
    }


def _low_utilisation(row: FlagRow, utilisation: float) -> Dict[str, object]:
    return {
        "flag": PerfHeuristicFlag.LOW_UTILISATION.value,
        # Cut, not rounded, so a figure under the threshold never reads as at it.
        "core_utilisation_percent": math.floor(utilisation * 100_000) / 1000,
        "roofline_modelled": (
            None
            if row.bound_analysis is None
            else row.bound_analysis is not BoundAnalysis.NONE
        ),
    }


def _underutilised_cores(row: FlagRow, max_cores: float) -> Dict[str, object]:
    source = (
        CoreCapacitySource.MAX_CORES
        if row.available_cores is None
        else CoreCapacitySource.AVAILABLE_CORES
    )
    return {
        "flag": PerfHeuristicFlag.UNDERUTILISED_CORES.value,
        "core_capacity": _whole(_core_capacity(row, max_cores)),
        "core_capacity_from": source.value,
    }


def heuristic_flags(row: FlagRow, max_cores: float) -> List[Dict[str, object]]:
    """`annotatePerfHeuristicFlags`' flags for a row, in its order, with their evidence.

    `max_cores` is the device's, as `resolve_max_cores` finds it. No entry repeats a
    field the row carries: the cores used are its `cores`, and a recompute candidate's
    program is the `cache` group's `program_hash`.
    """
    if not _is_eligible(row):
        return []
    flags: List[Dict[str, object]] = []
    has_min_impact = _meets_min_impact(row)
    if has_min_impact and (row.bound == BoundType.DRAM or _is_slow_dram_dominant(row)):
        flags.append(_dram_bound(row))
    if (
        has_min_impact
        and _is_valid_number(row.pm_ideal_ns)
        and _is_valid_number(row.device_time)
        and _is_valid_number(row.cores)
    ):
        utilisation = core_utilisation(row, max_cores)
        if 0 < utilisation < LOW_CORE_UTILISATION_RATIO:
            flags.append(_low_utilisation(row, utilisation))
    if has_min_impact and _is_underutilised_cores(row, max_cores):
        flags.append(_underutilised_cores(row, max_cores))
    if is_repeat_miss(row.hash, row.is_first_hash_occurrence, row.cache_hit):
        flags.append({"flag": PerfHeuristicFlag.RECOMPUTE_CANDIDATE.value})
    return flags


def architecture_of(name: object) -> DeviceArchitecture:
    """`stringToArchitecture`: an architecture by its name's prefix, else unknown."""
    if not isinstance(name, str):
        return DeviceArchitecture.UNKNOWN
    lowered = name.lower()
    return next(
        (arch for prefix, arch in _ARCHITECTURE_PREFIXES if lowered.startswith(prefix)),
        DeviceArchitecture.UNKNOWN,
    )


def _architecture_default(architecture: DeviceArchitecture) -> int:
    return _CORE_COUNT.get(architecture, DEFAULT_MAX_CORES)


def core_count(architecture: DeviceArchitecture, cores: Iterable[float]) -> float:
    """`getCoreCount`, over the rows' `row_cores`: the architecture's cores, or the most
    a row used if more."""
    default = _architecture_default(architecture)
    highest: float = 0
    for count in cores:
        if not math.isnan(count) and count > highest:
            highest = count
    return highest if highest > default else default


class MaxCores(NamedTuple):
    cores: float
    source: MaxCoresSource


def resolve_max_cores(
    meta: Optional[DeviceLogMeta], cores: Iterable[float]
) -> MaxCores:
    """`resolveMaxCores`, and where its count came from, which the view does not say."""
    named = meta.architecture if meta is not None else None
    architecture = architecture_of(
        DeviceArchitecture.WORMHOLE.value if named is None else named
    )
    if meta is not None and meta.max_cores is not None:
        resolved = MaxCores(meta.max_cores, MaxCoresSource.DEVICE_LOG)
    else:
        count = core_count(architecture, cores)
        resolved = MaxCores(
            count,
            (
                MaxCoresSource.REPORT_ROWS
                if count > _architecture_default(architecture)
                else MaxCoresSource.ARCHITECTURE_DEFAULT
            ),
        )
    if resolved.cores > 0:
        return resolved
    return MaxCores(DEFAULT_MAX_CORES, MaxCoresSource.FALLBACK_DEFAULT)


@dataclass(frozen=True)
class FlagInputs:
    """What the flags read besides the row: the device log, and the whole report."""

    meta: Optional[DeviceLogMeta]
    max_cores: MaxCores
    # First calls, which a report holds far fewer of than repeats.
    first_call_ids: FrozenSet[str]
    repeat_hits: int
    repeat_misses: int

    def is_first_call(self, row: Dict) -> bool:
        # A row without a program is never a repeat, as the view reads it.
        return not row.get("hash") or str(row.get("id")) in self.first_call_ids


def flag_inputs(rows: Sequence[Dict], meta: Optional[DeviceLogMeta]) -> FlagInputs:
    """The inputs for a whole report's rows and its device log's meta."""
    first_call_ids: Set[str] = set()
    repeat_hits = repeat_misses = 0
    for row, first in program_calls(rows):
        if first:
            first_call_ids.add(str(row.get("id")))
        elif row.get("cache_hit") is True:
            repeat_hits += 1
        elif is_repeat_miss(row.get("hash"), first, row.get("cache_hit")):
            repeat_misses += 1
    return FlagInputs(
        meta=meta,
        max_cores=resolve_max_cores(meta, (row_cores(row) for row in rows)),
        first_call_ids=frozenset(first_call_ids),
        repeat_hits=repeat_hits,
        repeat_misses=repeat_misses,
    )


def _agent_flags(row: Dict, inputs: FlagInputs) -> Tuple[FlagRow, List[Dict]]:
    typed = typed_row(row, inputs.is_first_call(row))
    # The view reads tt-metal's 1 ns placeholder as a modelled ideal time (#2162).
    if is_unmodelled(row.get("pm_ideal_ns")):
        typed = replace(typed, pm_ideal_ns=None)
    return typed, heuristic_flags(typed, inputs.max_cores.cores)


def flag_fields(row: Dict, inputs: Optional[FlagInputs]) -> Dict[str, object]:
    """A row's `flags`, when asked for, and the `total_percent` that gates them."""
    if inputs is None:
        return {}
    typed, flags = _agent_flags(row, inputs)
    return {"total_percent": _figure(typed.total_percent), "flags": flags}


def flagged_rows(rows: Iterable[Dict], inputs: FlagInputs) -> Dict[str, int]:
    """How many of `rows` carry each flag, so an answer says what lies past its cap."""
    counts = {flag.value: 0 for flag in PerfHeuristicFlag}
    for row in rows:
        for entry in _agent_flags(row, inputs)[1]:
            counts[str(entry["flag"])] += 1
    return counts


FLAGS_NOTE = (
    "Flags are the performance view's, except that tt-metal's 1 ns perf-model "
    "placeholder never flags low_utilisation (#2162). flagged_rows counts every row "
    "read, not only those returned."
)


def summary(
    inputs: Optional[FlagInputs], flagged: Optional[Dict[str, int]] = None
) -> Dict[str, object]:
    """What an answer with flags says about what they were read against."""
    if inputs is None:
        return {}
    basis: Dict[str, object] = {
        "max_cores": _whole(inputs.max_cores.cores),
        "max_cores_source": inputs.max_cores.source.value,
        "architecture": inputs.meta.architecture if inputs.meta else None,
        "flagged_rows": flagged,
        "note": FLAGS_NOTE,
    }
    if cache_looks_disabled(inputs.repeat_hits, inputs.repeat_misses):
        basis["caveat"] = CACHE_DISABLED_CAVEAT
    return {"flag_basis": basis}


__all__ = [
    "CACHE_DISABLED_CAVEAT",
    "DEFAULT_MAX_CORES",
    "FLAGS_NOTE",
    "LOW_CORE_UTILISATION_RATIO",
    "MIN_TOTAL_PERCENT",
    "UNDERUTILISED_CORES_RATIO",
    "BoundAnalysis",
    "BoundType",
    "CoreCapacitySource",
    "DeviceArchitecture",
    "DramBoundReason",
    "FlagInputs",
    "FlagRow",
    "MaxCores",
    "MaxCoresSource",
    "PerfHeuristicFlag",
    "architecture_of",
    "cache_looks_disabled",
    "core_count",
    "core_utilisation",
    "flag_fields",
    "flag_inputs",
    "flagged_rows",
    "heuristic_flags",
    "is_repeat_miss",
    "program_calls",
    "resolve_max_cores",
    "row_cores",
    "summary",
    "typed_row",
]
