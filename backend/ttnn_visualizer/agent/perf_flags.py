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

Values are read as JavaScript reads them, through `js_values`: a NaN stays one where
`parseFloat` gives it, and None is null, since which of the two a cell becomes decides
some flags.
"""

import math
from dataclasses import dataclass, field, replace
from enum import Enum
from typing import (
    Callable,
    Dict,
    FrozenSet,
    Hashable,
    Iterable,
    Iterator,
    List,
    NamedTuple,
    Optional,
    Sequence,
    Set,
    Tuple,
)

from ttnn_visualizer.agent.js_values import (
    js_divide,
    js_is_finite,
    js_parse_float,
    js_parse_int,
    js_truthy,
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
    """`DeviceArchitecture` in `src/definitions/DeviceArchitecture.ts`."""

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


class RepeatCacheOutcome(str, Enum):
    """How a repeat call's cache result reads, as `RepeatCacheOutcome` in `PerfTable.ts`."""

    HIT = "hit"
    MISS = "miss"
    UNRECORDED = "unrecorded"


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


def _parse_nullable_integer(value: object) -> Optional[float]:
    if value is None or value == "":
        return None
    parsed = js_parse_int(value)
    return None if math.isnan(parsed) else float(parsed)


def _parse_filled_float(value: object) -> Optional[float]:
    return js_parse_float(value) if js_truthy(value) else None


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


def repeat_cache_outcome(
    program: object, is_first_call: bool, cache_hit: object
) -> Optional[RepeatCacheOutcome]:
    """`getRepeatCacheOutcome`: how a repeat call's cache result reads, None for a row that
    is no repeat. A miss is the view's recompute candidate; `program_cache` counts by it.
    """
    if not js_truthy(program) or is_first_call:
        return None
    if cache_hit is None:
        return RepeatCacheOutcome.UNRECORDED
    return RepeatCacheOutcome.HIT if js_truthy(cache_hit) else RepeatCacheOutcome.MISS


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
    return float(js_parse_int(row.get("cores")))


def typed_row(row: Dict, is_first_hash_occurrence: bool = True) -> FlagRow:
    """A generated report row as `enrichRowData` types it, in the fields the flags read.

    Whether the row is its program's first call is the caller's to say, from the whole
    report, by `program_calls`.
    """
    bound_analysis = row.get("bound_analysis")
    return FlagRow(
        total_percent=js_parse_float(row.get("total_percent")),
        device_time=js_parse_float(row.get("device_time")),
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
    if js_is_finite(ideal) and js_is_finite(duration) and js_is_finite(cores):
        utilisation = js_divide(ideal, duration * 1000) * js_divide(
            _core_capacity(row, max_cores), cores
        )
        if js_is_finite(utilisation):
            return utilisation
    return 0.0


def _is_eligible(row: FlagRow) -> bool:
    return (
        not js_truthy(row.missing)
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
    if js_is_finite(cores) and not max_cores <= 0:
        capacity = _core_capacity(row, max_cores)
        return capacity > 0 and cores / capacity < UNDERUTILISED_CORES_RATIO
    return False


def _figure(value: Optional[float]) -> Optional[float]:
    return round(value, 3) if js_is_finite(value) else None


def _whole(value: object) -> object:
    """A count as JSON writes an integer, which a parsed one always is."""
    return int(value) if isinstance(value, float) and value.is_integer() else value


def flag_names(row: FlagRow, max_cores: float) -> List[PerfHeuristicFlag]:
    """Which of `annotatePerfHeuristicFlags`' flags apply to a row, in its order.

    `max_cores` is the device's, as `resolve_max_cores` finds it.
    """
    if not _is_eligible(row):
        return []
    names: List[PerfHeuristicFlag] = []
    has_min_impact = _meets_min_impact(row)
    if has_min_impact and (row.bound == BoundType.DRAM or _is_slow_dram_dominant(row)):
        names.append(PerfHeuristicFlag.DRAM_BOUND)
    # `core_utilisation` is 0 wherever the view's own guard on its three inputs refuses.
    utilisation = core_utilisation(row, max_cores) if has_min_impact else 0
    if 0 < utilisation < LOW_CORE_UTILISATION_RATIO:
        names.append(PerfHeuristicFlag.LOW_UTILISATION)
    if has_min_impact and _is_underutilised_cores(row, max_cores):
        names.append(PerfHeuristicFlag.UNDERUTILISED_CORES)
    outcome = repeat_cache_outcome(
        row.hash, row.is_first_hash_occurrence, row.cache_hit
    )
    if outcome is RepeatCacheOutcome.MISS:
        names.append(PerfHeuristicFlag.RECOMPUTE_CANDIDATE)
    return names


def _dram_bound(row: FlagRow, max_cores: float) -> Dict[str, object]:
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


def _low_utilisation(row: FlagRow, max_cores: float) -> Dict[str, object]:
    utilisation = core_utilisation(row, max_cores)
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


def _recompute_candidate(row: FlagRow, max_cores: float) -> Dict[str, object]:
    return {"flag": PerfHeuristicFlag.RECOMPUTE_CANDIDATE.value}


_EVIDENCE: Dict[PerfHeuristicFlag, Callable[[FlagRow, float], Dict[str, object]]] = {
    PerfHeuristicFlag.DRAM_BOUND: _dram_bound,
    PerfHeuristicFlag.LOW_UTILISATION: _low_utilisation,
    PerfHeuristicFlag.UNDERUTILISED_CORES: _underutilised_cores,
    PerfHeuristicFlag.RECOMPUTE_CANDIDATE: _recompute_candidate,
}


def heuristic_flags(row: FlagRow, max_cores: float) -> List[Dict[str, object]]:
    """`flag_names`, each with the figures it fired on.

    No entry repeats a field the row carries: the cores used are its `cores`, and a
    recompute candidate's program is the `cache` group's `program_hash`.
    """
    return [_EVIDENCE[name](row, max_cores) for name in flag_names(row, max_cores)]


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


class MaxCores(NamedTuple):
    cores: float
    source: MaxCoresSource


def core_count(architecture: DeviceArchitecture, cores: Iterable[float]) -> MaxCores:
    """`getCoreCount`, over the rows' `row_cores`: the architecture's cores, or the most
    a row used if more, and which of the two it is."""
    default = _architecture_default(architecture)
    highest: float = 0
    for count in cores:
        if not math.isnan(count) and count > highest:
            highest = count
    if highest > default:
        return MaxCores(highest, MaxCoresSource.REPORT_ROWS)
    return MaxCores(default, MaxCoresSource.ARCHITECTURE_DEFAULT)


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
        resolved = core_count(architecture, cores)
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
    # `flagged_rows`' counts by the caller's key, kept as long as the inputs are.
    _counts: Dict[Hashable, Dict[str, int]] = field(
        default_factory=dict, compare=False, repr=False
    )

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
            continue
        outcome = repeat_cache_outcome(row.get("hash"), first, row.get("cache_hit"))
        repeat_hits += outcome is RepeatCacheOutcome.HIT
        repeat_misses += outcome is RepeatCacheOutcome.MISS
    return FlagInputs(
        meta=meta,
        max_cores=resolve_max_cores(meta, (row_cores(row) for row in rows)),
        first_call_ids=frozenset(first_call_ids),
        repeat_hits=repeat_hits,
        repeat_misses=repeat_misses,
    )


def _agent_row(row: Dict, inputs: FlagInputs) -> FlagRow:
    typed = typed_row(row, inputs.is_first_call(row))
    # The view reads tt-metal's 1 ns placeholder as a modelled ideal time (#2162).
    if is_unmodelled(row.get("pm_ideal_ns")):
        typed = replace(typed, pm_ideal_ns=None)
    return typed


def flag_fields(row: Dict, inputs: Optional[FlagInputs]) -> Dict[str, object]:
    """A row's `flags`, when asked for, and the `total_percent` that gates them."""
    if inputs is None:
        return {}
    typed = _agent_row(row, inputs)
    return {
        "total_percent": _figure(typed.total_percent),
        "flags": heuristic_flags(typed, inputs.max_cores.cores),
    }


def count_flags(rows: Iterable[Dict], inputs: FlagInputs) -> Dict[str, int]:
    """How many of `rows` carry each flag."""
    counts = {flag.value: 0 for flag in PerfHeuristicFlag}
    for row in rows:
        for name in flag_names(_agent_row(row, inputs), inputs.max_cores.cores):
            counts[name.value] += 1
    return counts


def flagged_rows(
    rows: Iterable[Dict], inputs: Optional[FlagInputs], key: Hashable = None
) -> Optional[Dict[str, int]]:
    """`count_flags`, so an answer says what lies past its cap; None without flags.

    Kept by `key` when given one, since every row is read: about a second on 200,000.
    """
    if inputs is None:
        return None
    if key is None:
        return count_flags(rows, inputs)
    if key not in inputs._counts:
        inputs._counts[key] = count_flags(rows, inputs)
    return inputs._counts[key]


FLAGS_NOTE = (
    "Flags are the performance view's, except that tt-metal's 1 ns perf-model "
    "placeholder never flags low_utilisation (#2162), and that over a signpost range "
    "first calls and the report_rows max-core fallback still read the whole report. "
    "flagged_rows counts every row read, not only those returned."
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
    "RepeatCacheOutcome",
    "architecture_of",
    "cache_looks_disabled",
    "core_count",
    "core_utilisation",
    "count_flags",
    "flag_fields",
    "flag_names",
    "flag_inputs",
    "flagged_rows",
    "heuristic_flags",
    "repeat_cache_outcome",
    "program_calls",
    "resolve_max_cores",
    "row_cores",
    "summary",
    "typed_row",
]
