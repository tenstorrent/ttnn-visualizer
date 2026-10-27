# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""The tools themselves. Every one returns an aggregate or a bounded slice.

A perf report is 10^4-10^5 rows of ~35 fields, so no tool returns the table: an
agent's context is a tighter budget than the browser heap that already forced
server-side windowing on the NPE view. #1995
"""

import contextlib
import io
import logging
import sys
from dataclasses import asdict, dataclass
from enum import Enum
from typing import (
    Callable,
    Dict,
    Hashable,
    List,
    Optional,
    Sequence,
    Tuple,
    TypeVar,
    Union,
    cast,
)

from ttnn_visualizer.agent import op_signatures, perf_detail, perf_flags, report_diff
from ttnn_visualizer.agent.bounds import (
    MAX_DETAILED_LIMIT,
    MAX_LIMIT,
    bounded,
    require_choice,
)
from ttnn_visualizer.agent.cells import finite_number
from ttnn_visualizer.agent.handles import (
    CacheVariant,
    ReportRegistry,
    UnkeptSnapshot,
    UnsharedSnapshot,
    perf_csv_columns,
)
from ttnn_visualizer.csv_queries import (
    MAX_LISTED_SIGNPOSTS,
    REPORT_ROW_ID_OFFSET,
    SIGNPOST_OP_TYPE,
    DegradedPerformanceReport,
    DeviceLogMeta,
    DeviceLogProfilerQueries,
    OpsPerformanceQueries,
    OpsPerformanceReportQueries,
    ResolvedSignposts,
    check_signpost_range,
    read_signposts,
    signpost_range_ignored,
)
from ttnn_visualizer.exceptions import (
    DataFormatError,
    InvalidSignpostRange,
    PerformanceReportNotLoadedException,
)
from ttnn_visualizer.models import Instance

logger = logging.getLogger(__name__)

_Read = TypeVar("_Read")

# The projection every tool reads through, stated rather than defaulted.
#
# `get_performance_results_report` defaults `hide_host_ops` and `merge_devices`
# to true and can narrow to a signpost range. Those are view choices: handed to
# an agent unannounced they produce confident reasoning over a partial set,
# which is how #1883 lost six features to a filtered link status.
#
# So nothing here drops a row unless asked. Host ops stay in, and
# `print_signposts` is true because the name understates it: `filter_by_signpost`
# drops the signpost rows themselves when it is false, rather than only omitting
# them from a printout. With no range it is inert -- no range means
# `ignore_signposts`, which returns the frame before the strip can run. With a
# range (#2122) it keeps the signposts inside the window; the two that bound it
# are excluded by tt-perf-report itself, which keeps rows strictly after the
# start and strictly before the end. Rows carry `op_type`, so an agent can tell
# a marker from an operation.
#
# A range is not part of this projection: the operation link is matched against
# the whole report, so a range is passed per call and echoed by `projection`.
#
# `merge_devices` is the one filter kept, and deliberately: unmerged rows report
# the same op once per device, so a merged row is the unit an op is reported in
# rather than a subset of the report. Every response repeats this projection.
CANONICAL_PROJECTION: Dict[str, object] = {
    "hide_host_ops": False,
    "merge_devices": True,
    "print_signposts": True,
}

# Sort keys an agent may ask for, mapped to the report's own field names.
SORTABLE_METRICS: Dict[str, str] = {
    "device_time": "device_time",
    "op_to_op_gap": "op_to_op_gap",
    "total_percent": "total_percent",
    "flops": "flops",
    "dram": "dram",
    "cores": "cores",
}
DEFAULT_METRIC = "device_time"

# Metrics a report-level sum is meaningful for. `dram` is GB/s, `flops` is
# TFLOPS and `cores` is a per-op allocation: adding them across operations
# produces an authoritative-looking number that is dimensionally nonsense.
ADDITIVE_METRICS = frozenset({"device_time", "op_to_op_gap", "total_percent"})


def countable_device_time(row: Dict) -> Optional[float]:
    """A row's device time, or None where it is blank, non-finite or not positive.

    `isCountableDeviceTime` in `src/functions/durationBuckets.ts`, which the app
    counts a share's device time with; mirror a change there.
    """
    value = finite_number(row.get("device_time"))
    return value if value is not None and value > 0 else None


def _rounded(value: Optional[float]) -> Optional[float]:
    """Nanosecond precision is plenty, and a 17-digit float is context spent."""
    return None if value is None else round(value, 3)


def is_signpost_row(row: Dict) -> bool:
    return row.get("op_type") == SIGNPOST_OP_TYPE


def share_percent(part: Optional[float], whole: float) -> Optional[float]:
    """Percent of `whole`, to three significant figures so a sliver stays non-zero."""
    if part is None or whole <= 0:
        return None
    return float(f"{part / whole * 100:.3g}")


# Longer than any signpost a model emits, and short enough that a refusal or a
# projection echoing the name stays small.
MAX_SIGNPOST_NAME_LENGTH = 256


@dataclass(frozen=True)
class SignpostRange:
    """A window of the report, bounded as `tt-perf-report --start-signpost` bounds it.

    The bounds are passed to tt-perf-report rather than cut from the whole
    snapshot: it recomputes `Total %` over the window and leaves the first
    operation's op-to-op gap blank, since no operation precedes it inside the
    window, and a cut snapshot would disagree on both with the signposted run an
    agent is checking against. Row ids are CSV positions either way, so a windowed row
    keeps the id the whole report gives it. #2122
    """

    start: Optional[str]
    end: Optional[str]

    @classmethod
    def of(
        cls, start: Optional[str] = None, end: Optional[str] = None
    ) -> Optional["SignpostRange"]:
        """The range asked for, or None for none.

        An empty name is no bound, as `check_signpost_range` reads it, so it must
        not key a second snapshot of the same whole report.
        """
        for label, name in (("start_signpost", start), ("end_signpost", end)):
            if name and len(name) > MAX_SIGNPOST_NAME_LENGTH:
                raise ValueError(
                    f"{label} is {len(name)} characters; a signpost name is at most "
                    f"{MAX_SIGNPOST_NAME_LENGTH}"
                )
        start, end = start or None, end or None
        if start is None and end is None:
            return None
        return cls(start, end)

    def as_overrides(self) -> Dict[str, object]:
        return {"start_signpost": self.start, "end_signpost": self.end}


# Set on a report generated with swallowed errors, which may be missing rows by chance.
_DEGRADED_KEY = "degraded"


def canonical_report(
    registry: ReportRegistry,
    handle: str,
    signposts: Optional[SignpostRange] = None,
    keep: bool = True,
) -> Dict:
    """One generated report per handle and range; see `ReportRegistry.cached_report`.

    A range on a report with no signposts is answered from the whole snapshot:
    tt-perf-report would read the whole file for it anyway, and generating it
    once per name asked would cache an identical copy for each. A refused range
    raises `InvalidSignpostRange`, a `ValueError`, and is not cached. It is
    refused against the signposts already read for the handle, before the CSV is
    read again: an agent guessing names would otherwise pay a full read per guess.

    Every read that misses the cache first checks the capture is the one the
    handle's first read came from; see `_require_same_source`. Snapshots are kept
    per capture rather than per handle, so handles loaded on the same unchanged
    CSV share one. The rows are shared with them: copy a row before changing it.
    A report generated with swallowed errors is the exception: it is marked `degraded`
    and kept by the handle that read it alone, so loading the report again regenerates
    it. `keep=False` reads a report no tool has kept without keeping it.
    """
    _require_performance_report(registry, handle)
    ignored = range_ignored(registry, handle, signposts)
    if signposts is not None and not ignored:
        check_range(registry, handle, signposts)
    scope = None if ignored else signposts
    overrides = scope.as_overrides() if scope is not None else {}

    def build(instance: Instance) -> Dict:
        _require_same_source(registry, handle, instance)
        try:
            return _generate_canonical_report(instance, **overrides)
        except DegradedPerformanceReport as degraded:
            raise UnsharedSnapshot({**degraded.report, _DEGRADED_KEY: True}) from None

    source = _pin_source(registry, handle)
    report = registry.cached_report(
        handle, build, scope=scope, share_key=source, keep=keep
    )
    return {**report, "signpost_range_ignored": True} if ignored else report


def _require_performance_report(registry: ReportRegistry, handle: str) -> None:
    """Refuse, as the agent's to fix, a performance read of a handle loaded without one."""
    if not registry.get(handle).performance_path:
        raise ValueError(
            f"{handle!r} was loaded without a performance_path, so it holds no "
            "performance report; call load_report with one"
        )


def check_range(
    registry: ReportRegistry, handle: str, signposts: SignpostRange
) -> None:
    """Refuse a range this handle's signposts cannot honour, naming the handle.

    `diff_reports` asks it of every capture before generating any, so the
    refusal has to say which one it is about.
    """
    try:
        check_signpost_range(
            _signposts(registry, handle), signposts.start, signposts.end
        )
    except InvalidSignpostRange as error:
        raise InvalidSignpostRange(f"{handle!r}: {error}") from error


def _source_now(instance: Instance) -> Optional[object]:
    """The CSV a report would be read from now, or None when there is none.

    None leaves nothing to compare, and the read that follows fails on its own.
    """
    try:
        return OpsPerformanceReportQueries.report_source(instance)
    except (FileNotFoundError, PerformanceReportNotLoadedException):
        return None


def _pin_source(registry: ReportRegistry, handle: str) -> Optional[object]:
    return registry.cached_report(handle, _source_now, variant=CacheVariant.SOURCE)


def _require_same_source(
    registry: ReportRegistry, handle: str, instance: Instance
) -> None:
    """Refuse to read a capture other than the one the handle first read.

    The whole snapshot and the operation link are pinned to the capture the
    handle first read, and rows are matched to operations by CSV position. A
    read of a rewritten or newer CSV would put its rows under the old link's
    operation ids, so it is refused and a fresh handle asked for.
    """
    pinned = _pin_source(registry, handle)
    if pinned is not None and _source_now(instance) != pinned:
        raise ValueError(
            f"the performance capture behind {handle!r} has changed since it was "
            "first read, so a new read would not line up with what the handle "
            "already read or linked from it. Call load_report again for a fresh "
            "handle."
        )


def range_ignored(
    registry: ReportRegistry, handle: str, signposts: Optional[SignpostRange]
) -> bool:
    """Whether tt-perf-report would read the whole file for this range.

    `signpost_range_ignored` itself, asked before generating rather than after:
    the handle's signposts are read once, three columns, without a report.
    """
    if signposts is None:
        return False
    return signpost_range_ignored(
        _signposts(registry, handle), signposts.start, signposts.end
    )


def _per_capture(
    registry: ReportRegistry,
    handle: str,
    variant: CacheVariant,
    read: Callable[[Instance], _Read],
) -> _Read:
    """`read` of the handle's capture, once per capture -- or why it cannot be read."""
    _require_performance_report(registry, handle)

    def build(instance: Instance) -> Union[_Read, DataFormatError]:
        _require_same_source(registry, handle, instance)
        try:
            return read(instance)
        except DataFormatError as error:
            # The same bytes fail the same way, and a rewritten CSV is another source.
            return error

    source = _pin_source(registry, handle)
    resolved = registry.cached_report(handle, build, variant=variant, share_key=source)
    if isinstance(resolved, DataFormatError):
        raise resolved.with_traceback(None)
    return resolved


def _signposts(registry: ReportRegistry, handle: str) -> ResolvedSignposts:
    """The handle's signposts, read once per capture -- or why they cannot be."""
    return _per_capture(registry, handle, CacheVariant.SIGNPOSTS, _resolve_signposts)


def _resolve_signposts(instance: Instance) -> ResolvedSignposts:
    path = OpsPerformanceQueries.get_local_ops_perf_file_path(instance)
    with open(path, newline="") as csv_file:
        # In chunks: `load_report` reads this for every handle, and a whole-file
        # parse peaked at five times the CSV's size.
        return read_signposts(csv_file, low_memory=True)


def with_signposts(
    registry: ReportRegistry, loaded: Dict[str, object]
) -> Dict[str, object]:
    """`load_report`'s answer with the signposts a range can name.

    Read once per capture, through the cache a range is later checked against, and
    only for a CSV `top_ops` can read. Listed as a refusal lists them, in the order
    a bound resolves them, with how often each occurs: one name bounds both ends
    only if it occurs twice.
    """
    if loaded.get("performance_csv") is None or loaded.get("performance_csv_problem"):
        return loaded
    try:
        resolved = _signposts(registry, str(loaded["handle"]))
    except (DataFormatError, OSError, TypeError, ValueError) as error:
        return {**loaded, "signposts_problem": str(error)}
    named = resolved.occurrences()
    # A longer name cannot be passed back as a bound, and is the capture's text, not ours.
    usable = [entry for entry in named if len(entry[0]) <= MAX_SIGNPOST_NAME_LENGTH]
    result: Dict[str, object] = {
        **loaded,
        "signpost_count": len(named),
        "signposts": [
            {"name": name, "occurrences": occurrences}
            for name, occurrences in usable[:MAX_LISTED_SIGNPOSTS]
        ],
    }
    if len(usable) < len(named):
        result["signposts_unlisted_too_long"] = len(named) - len(usable)
    if resolved.device_count is not None:
        device_count = cast(Dict[str, int], loaded.get("device_count") or {})
        result["device_count"] = {
            "performance_csv": resolved.device_count,
            **device_count,
        }
    return result


# The projection key a range adds, and the one `is_ranged` reads it back by.
_START_SIGNPOST_KEY = "start_signpost"


def projection(
    signposts: Optional[SignpostRange], ignored: bool = False
) -> Dict[str, object]:
    """The projection a response read through, including any range it was asked.

    `signpost_range_ignored` is true when the report holds no signposts, which
    tt-perf-report answers with the whole file: the rows are then not the window
    the range names.
    """
    result: Dict[str, object] = dict(CANONICAL_PROJECTION)
    if signposts is not None:
        result.update(
            {
                _START_SIGNPOST_KEY: signposts.start,
                "end_signpost": signposts.end,
                "boundary_signposts_included": False,
                "signpost_range_ignored": ignored,
            }
        )
    return result


def is_ranged(response_projection: object) -> bool:
    """Whether a response's projection says it was read over a signpost range."""
    return (
        isinstance(response_projection, dict)
        and _START_SIGNPOST_KEY in response_projection
    )


# How a report is generated rather than what it reads, so not part of the
# projection: no tool reads the stacked report, and `include` reads the detail columns.
_GENERATION_OPTIONS: Dict[str, object] = {
    "no_stacked_report": True,
    "detail_columns": True,
}


def _generate_canonical_report(instance: Instance, **overrides: object) -> Dict:
    """Run the report with stdout captured, raising `DegradedPerformanceReport`
    for one generated with swallowed errors.

    `tt_perf_report` prints its progress and the temp paths it writes to. On a
    stdio transport that lands in the middle of a JSON-RPC frame and corrupts
    the stream, so it is captured here rather than at the transport -- a tool
    called in-process should not write to stdout either.
    """
    captured = io.StringIO()
    try:
        with contextlib.redirect_stdout(captured):
            return OpsPerformanceReportQueries.generate_report_strict(
                instance, **{**CANONICAL_PROJECTION, **_GENERATION_OPTIONS, **overrides}
            )
    finally:
        # Logged on a raise too: a degraded run's output is the one worth reading.
        if captured.getvalue().strip():
            logger.debug("tt-perf-report output: %s", captured.getvalue().strip())


def partitioned_caveat(rows: List[Dict]) -> Optional[str]:
    """Totals assume ops ran sequentially, which a partitioned run breaks.

    tt-perf-report prints this warning itself when a report carries more than one
    sub-device, but it prints it to the terminal -- no tool response carries it.
    An agent summing device time across subdevices that ran concurrently would
    overstate the total and understate every op's share, so any tool reporting a
    total says so here.
    """
    sub_devices = _sub_devices(rows)
    if len(sub_devices) <= 1:
        return None
    return (
        f"This report spans {len(sub_devices)} sub-devices "
        f"({', '.join(sorted(sub_devices))}). Ops on different sub-devices can run "
        "concurrently, so summed device time, total percentages and op-to-op gaps "
        "overstate elapsed time. Compare ops within one sub-device instead."
    )


def _sub_devices(rows: List[Dict]) -> set:
    return {
        str(row.get("sub_device_id", "")).strip()
        for row in rows
        if str(row.get("sub_device_id", "")).strip()
    }


def project_row(row: Dict, metric: str = DEFAULT_METRIC) -> Dict[str, object]:
    """One performance row as every tool reports it.

    Shared so a row reads the same wherever it appears: `top_ops` ranks it and
    `operation_detail` lists it under the operation that launched it, and two
    projections of one CSV row that disagreed would be the drift the link exists
    to prevent.
    """
    return {
        "id": row.get("id"),
        "op_code": row.get("op_code") or row.get("raw_op_code"),
        metric: _rounded(finite_number(row.get(SORTABLE_METRICS[metric]))),
        "cores": finite_number(row.get("cores")),
        "bound": row.get("bound") or None,
        # Without it a null bound reads as "fine" when the op was never modelled (#2064).
        "bound_analysis": row.get("bound_analysis") or None,
        "op_category": row.get("op_category") or None,
    }


def _raw_op_code(row: Dict) -> str:
    """A row's op code before tt-perf-report adds a matmul's shapes or conv config."""
    return str(row.get("raw_op_code") or row.get("op_code") or "").strip()


def empty_detail_fields(
    registry: ReportRegistry, handle: str, groups: Sequence[perf_detail.DetailGroup]
) -> perf_detail.EmptyFields:
    """The detail fields no row of the whole report carries, read once per handle."""
    if not perf_detail.has_fields(groups):
        return {}

    def build(instance: Instance) -> perf_detail.EmptyFields:
        return perf_detail.empty_fields(
            canonical_report(registry, handle)["report"], perf_csv_columns(instance)
        )

    return registry.cached_report(
        handle, build, variant=CacheVariant.EMPTY_DETAIL_FIELDS
    )


def row_limit(limit: Optional[int], groups: Sequence[perf_detail.DetailGroup]) -> int:
    return bounded(limit, MAX_DETAILED_LIMIT if groups else MAX_LIMIT)


def _device_meta(instance: Instance) -> Optional[DeviceLogMeta]:
    """The device log's meta, or None where the view's request for it fails."""
    try:
        return DeviceLogProfilerQueries.read_device_meta(instance)
    except OSError:
        return None


def read_flag_inputs(
    registry: ReportRegistry, handle: str, groups: Sequence[perf_detail.DetailGroup]
) -> Optional[perf_flags.FlagInputs]:
    """What the flags read besides a row, when `include` asks for them; once per handle.

    The whole report even for a ranged call: a program first called before a window
    makes its calls inside it repeats, and a window does not change the device's cores.
    """
    if perf_detail.DetailGroup.FLAGS not in groups:
        return None

    def build(instance: Instance) -> perf_flags.FlagInputs:
        return perf_flags.flag_inputs(
            canonical_report(registry, handle)["report"], _device_meta(instance)
        )

    return registry.cached_report(handle, build, variant=CacheVariant.PERF_FLAG_INPUTS)


def top_ops(
    registry: ReportRegistry,
    handle: str,
    by: str = DEFAULT_METRIC,
    limit: Optional[int] = None,
    start_signpost: Optional[str] = None,
    end_signpost: Optional[str] = None,
    include: Optional[List[str]] = None,
) -> Dict[str, object]:
    """The costliest ops by one metric, with the projection that produced them."""
    require_choice("metric", by, SORTABLE_METRICS)
    groups = perf_detail.parse_include(include)
    count = row_limit(limit, groups)

    signposts = SignpostRange.of(start_signpost, end_signpost)
    report = canonical_report(registry, handle, signposts)
    rows = report.get("report", [])
    field = SORTABLE_METRICS[by]

    ranked = sorted(
        (row for row in rows if finite_number(row.get(field)) is not None),
        key=lambda row: finite_number(row.get(field)) or 0.0,
        reverse=True,
    )[:count]

    total: float = sum(finite_number(row.get(field)) or 0.0 for row in rows)
    empty = empty_detail_fields(registry, handle, groups)
    flag_inputs = read_flag_inputs(registry, handle, groups)
    ignored = bool(report.get("signpost_range_ignored"))
    ops = [
        {
            **project_row(row, by),
            "device": row.get("device"),
            "sub_device_id": row.get("sub_device_id") or None,
            # The projection keeps signpost rows deliberately, so the field that
            # tells a marker from an operation has to survive into the response.
            "op_type": row.get("op_type") or None,
            **perf_detail.detail_fields(row, groups, empty),
            **perf_flags.flag_fields(row, flag_inputs),
        }
        for row in ranked
    ]
    # Keyed by the range read, which a report with no signposts reads whole.
    flagged = perf_flags.flagged_rows(
        rows, flag_inputs, key=("range", None if ignored else signposts)
    )

    result: Dict[str, object] = {
        "handle": handle,
        "metric": by,
        "op_count": len(rows),
        "returned": len(ops),
        "ops": ops,
        "projection": projection(signposts, ignored),
        **perf_detail.summary(groups, empty),
        **perf_flags.summary(flag_inputs, flagged),
    }
    if by in ADDITIVE_METRICS:
        result[f"{by}_total"] = round(total, 3)
    caveat = partitioned_caveat(rows)
    if caveat:
        result["caveat"] = caveat
    return result


PROGRAM_CACHE_NOTE = (
    "A row is its program's first call when no earlier row in the report has its "
    "program hash, and a repeat call otherwise, as the performance view counts them. "
    "A first call builds its program, so it misses the cache by design. A repeat call "
    "should hit it: a repeat miss built a program the run had already built, which the "
    "performance view flags as a recompute candidate. Calls are grouped by the raw op "
    "code, so one entry holds every shape of an op. first_repeat_miss_perf_id numbers "
    "a row of the performance CSV, not an operation. Rows are merged across devices, so "
    "each carries the cache result of the device its row was taken from."
)


@dataclass
class _ProgramCalls:
    op_code: str
    calls: int = 0
    programs: int = 0
    repeat_calls: int = 0
    repeat_hits: int = 0
    repeat_misses: int = 0
    repeat_unrecorded: int = 0
    first_repeat_miss_perf_id: Optional[str] = None


def program_cache(
    registry: ReportRegistry, handle: str, limit: Optional[int] = None
) -> Dict[str, object]:
    """How often each op code built a program again rather than reusing it.

    A hash's first row in report order is a first call (`perf_flags.program_calls`),
    and a later row is a repeat that hit, missed or recorded nothing
    (`perf_flags.repeat_cache_outcome`, the port of `getRepeatCacheOutcome`). A miss is
    the performance view's recompute candidate, and its table footer leaves unrecorded
    repeats out of its hit percentage. The whole report, since a program first called
    before a window would read as a first call inside it.
    """
    count = bounded(limit)
    rows = canonical_report(registry, handle).get("report", [])
    calls_by_op_code: Dict[str, _ProgramCalls] = {}
    for row, first in perf_flags.program_calls(rows):
        op_code = _raw_op_code(row)
        entry = calls_by_op_code.setdefault(op_code, _ProgramCalls(op_code))
        entry.calls += 1
        if first:
            entry.programs += 1
            continue
        entry.repeat_calls += 1
        outcome = perf_flags.repeat_cache_outcome(
            row.get("hash"), first, row.get("cache_hit")
        )
        if outcome is perf_flags.RepeatCacheOutcome.HIT:
            entry.repeat_hits += 1
        elif outcome is perf_flags.RepeatCacheOutcome.MISS:
            entry.repeat_misses += 1
            if entry.first_repeat_miss_perf_id is None:
                entry.first_repeat_miss_perf_id = row.get("id")
        else:
            entry.repeat_unrecorded += 1

    entries = list(calls_by_op_code.values())
    repeat_calls = sum(entry.repeat_calls for entry in entries)
    repeat_hits = sum(entry.repeat_hits for entry in entries)
    repeat_misses = sum(entry.repeat_misses for entry in entries)
    repeat_unrecorded = sum(entry.repeat_unrecorded for entry in entries)
    # Out of the repeats that recorded a result: an unrecorded one is neither.
    recorded = repeat_hits + repeat_misses
    ranked = sorted(
        entries,
        key=lambda entry: (-entry.repeat_misses, -entry.repeat_calls, entry.op_code),
    )[:count]
    result: Dict[str, object] = {
        "handle": handle,
        "calls": sum(entry.calls for entry in entries),
        "programs": sum(entry.programs for entry in entries),
        "repeat_calls": repeat_calls,
        "repeat_hits": repeat_hits,
        "repeat_misses": repeat_misses,
        "repeat_unrecorded": repeat_unrecorded,
        "repeat_hit_percent": (
            round(repeat_hits / recorded * 100, 3) if recorded else None
        ),
        "op_code_count": len(entries),
        "returned": len(ranked),
        "grouped_by": "raw_op_code",
        "op_codes": [asdict(entry) for entry in ranked],
        "projection": projection(None),
        "note": PROGRAM_CACHE_NOTE,
    }
    caveats = []
    if not entries:
        caveats.append(
            "No row carries a program hash, so there is nothing to count: the capture "
            "has no PROGRAM HASH column, leaves it empty, or holds no device "
            "operations."
        )
    if repeat_unrecorded:
        caveats.append(
            f"{repeat_unrecorded} of {repeat_calls} repeat calls recorded no cache "
            "result. They count as neither hits nor misses, and "
            + (
                "the hit percentage is out of the rest."
                if recorded
                else "there is no hit percentage."
            )
        )
    if perf_flags.cache_looks_disabled(repeat_hits, repeat_misses):
        caveats.append(perf_flags.CACHE_DISABLED_CAVEAT)
    if caveats:
        result["caveat"] = " ".join(caveats)
    return result


def zone_timings(
    registry: ReportRegistry, handle: str, limit: Optional[int] = None
) -> Dict[str, object]:
    """Per-zone, per-RISC totals from the device profiler log."""
    instance = registry.get(handle)
    metadata = DeviceLogProfilerQueries.read_capture_metadata(instance)
    clock_mhz = finite_number(metadata.get("CHIP_FREQ[MHz]"))

    with DeviceLogProfilerQueries(instance, stream=True) as queries:
        summary, pairing = queries.query_zone_summary(limit=bounded(limit))

    zones = []
    for entry in summary:
        total_cycles = entry["total_cycles"]
        zones.append(
            {
                **entry,
                # A megahertz clock ticks once per microsecond, so cycles over
                # MHz is already microseconds.
                # `is not None`, not truthiness: a zone that opened and closed
                # on the same cycle is a measured zero, not a missing duration.
                "total_us": (
                    round(total_cycles / clock_mhz, 3)
                    if total_cycles is not None and clock_mhz
                    else None
                ),
            }
        )

    result: Dict[str, object] = {
        "handle": handle,
        "arch": metadata.get("ARCH"),
        "clock_mhz": clock_mhz,
        "returned": len(zones),
        "zones": zones,
        # Said plainly because the number invites the other reading: a zone on 130
        # cores reports the sum of all 130, not how long the phase took.
        "note": (
            "Cycles are summed across every core that ran the zone, so these are "
            "occupancy totals rather than elapsed time. Durations need the `type` "
            "column to pair starts with ends; a capture without it reports "
            "occurrences only."
        ),
    }
    # A truncated capture leaves starts open and a capture that begins mid-zone
    # leaves ends unmatched. Either way the totals describe only what paired,
    # which is invisible from the totals themselves.
    if any(pairing.values()):
        caveat = (
            f"{pairing['unmatched_starts']} zone starts and "
            f"{pairing['unmatched_ends']} ends did not pair, so these totals "
            "cover only the zones that did. A capture stopped mid-run is the "
            "usual cause."
        )
        if pairing["dropped_starts"]:
            caveat += (
                f" A further {pairing['dropped_starts']} starts were dropped at "
                "the open-zone ceiling, which a well-formed capture does not "
                "reach — treat this log as malformed."
            )
        result["caveat"] = caveat
    return result


def _require_distinct_captures(registry: ReportRegistry, handles: List[str]) -> None:
    """Refuse a capture given twice: it would be compared with itself, or counted twice
    in a median."""
    handle_by_source: Dict[object, str] = {}
    for handle in handles:
        source = _pin_source(registry, handle)
        if source is None:
            continue
        earlier = handle_by_source.get(source)
        if earlier is not None:
            given = (
                f"{handle!r} is given twice"
                if earlier == handle
                else f"{earlier!r} and {handle!r} are the same capture"
            )
            raise ValueError(f"{given}; pass each capture once")
        handle_by_source[source] = handle


def _read_op_signatures(instance: Instance) -> Optional[op_signatures.Signatures]:
    path = OpsPerformanceQueries.get_local_ops_perf_file_path(instance)
    with open(path, newline="") as csv_file:
        return op_signatures.read_signatures(csv_file)


def _op_signatures(registry: ReportRegistry, handle: str) -> op_signatures.Signatures:
    """The handle's tensor signatures by CSV position, read once per capture."""
    try:
        signatures = _per_capture(
            registry, handle, CacheVariant.OP_SIGNATURES, _read_op_signatures
        )
    except DataFormatError as error:
        # A refusal, as the same unreadable CSV is when the report is generated.
        raise ValueError(f"{handle!r}: {error}") from error
    if signatures is None:
        raise ValueError(
            f"the performance CSV behind {handle!r} has no INPUT_n or OUTPUT_n "
            "columns, so its operations have no signature to match on; use match "
            "op_code"
        )
    return signatures


def _op_code_key(row: Dict) -> Optional[str]:
    return str(row.get("op_code") or row.get("raw_op_code") or "").strip() or None


def _signature_key(
    row: Dict, signatures: List[Optional[str]]
) -> Optional[Tuple[str, str]]:
    op_code = _raw_op_code(row)
    if not op_code:
        return None
    try:
        position = int(row["id"]) - REPORT_ROW_ID_OFFSET
    except (KeyError, TypeError, ValueError):
        position = -1
    signature = signatures[position] if 0 <= position < len(signatures) else None
    return op_code, signature or ""


def _readable_signatures(
    registry: ReportRegistry, handle: str
) -> Optional[List[Optional[str]]]:
    """The handle's signatures, or None where they cannot be read: a diff by op code
    must not fail on them."""
    try:
        return _op_signatures(registry, handle).by_position
    except (OSError, ValueError):
        return None


# The report field behind each summable metric, all summed in one pass.
_DIFF_FIELDS = {metric: SORTABLE_METRICS[metric] for metric in sorted(ADDITIVE_METRICS)}

_DiffTotals = Dict[report_diff.DiffMatch, report_diff.CaptureTotals]


def _diff_totals(
    registry: ReportRegistry,
    handle: str,
    signposts: Optional[SignpostRange],
    ignored: bool,
    keep_report: bool,
) -> _DiffTotals:
    """A capture's group totals for every summable metric, by op code and, where its
    CSV has tensor columns, by signature, kept per handle and range: asked again with
    other thresholds, another metric or the other match, a diff reads no report.

    Kept by the handle alone, as a degraded report is, so loading the capture again
    reads it again. Unless `keep_report`, a report no tool has kept is read for its
    totals and dropped. A degraded report's totals are not kept at all: the handle may
    drop or evict that report, and its next read would then disagree with them.
    """

    def build(instance: Instance) -> _DiffTotals:
        report = canonical_report(registry, handle, signposts, keep=keep_report)
        rows = report.get("report", [])
        sub_devices = frozenset(_sub_devices(rows))
        totals = {
            report_diff.DiffMatch.OP_CODE: report_diff.capture_totals(
                rows, _DIFF_FIELDS, _op_code_key, sub_devices
            )
        }
        signatures = _readable_signatures(registry, handle)
        if signatures is not None:
            totals[report_diff.DiffMatch.SIGNATURE] = report_diff.capture_totals(
                rows,
                _DIFF_FIELDS,
                lambda row: _signature_key(row, signatures),
                sub_devices,
            )
        if report.get(_DEGRADED_KEY):
            raise UnkeptSnapshot(totals)
        return totals

    return registry.cached_report(
        handle,
        build,
        variant=CacheVariant.DIFF_TOTALS,
        scope=None if ignored else signposts,
    )


def _percent_of(move: float, before: float) -> Optional[float]:
    """A `report_diff.delta` as a percentage of the figure it moved from; None from zero."""
    return share_percent(move, abs(round(before, 3)))


def _read_device_facts(instance: Instance) -> Dict[str, object]:
    # Read as the flags read the device's cores, so the two cannot disagree about it.
    meta = _device_meta(instance) or DeviceLogMeta()
    return {
        "arch": meta.architecture,
        "clock_mhz": meta.frequency,
        "max_compute_cores": meta.max_cores,
    }


def _capture_facts(
    registry: ReportRegistry, handle: str, match: report_diff.DiffMatch
) -> Dict[str, object]:
    """What a capture ran on: its device log's header, read once per capture as its
    rows are, and its CSV's devices; with signatures, how it records tensor sizes."""
    facts = dict(
        _per_capture(registry, handle, CacheVariant.CAPTURE_FACTS, _read_device_facts)
    )
    try:
        facts["device_count"] = _signposts(registry, handle).device_count
    except (DataFormatError, OSError, ValueError):
        facts["device_count"] = None
    if match is report_diff.DiffMatch.SIGNATURE:
        logical = _op_signatures(registry, handle).logical_sizes
        facts[report_diff.TENSOR_SIZES] = "padded[logical]" if logical else "padded"
    return facts


def _compared_facts(
    registry: ReportRegistry, handles: List[str], match: report_diff.DiffMatch
) -> Tuple[Dict[str, Dict[str, object]], Dict[str, List[str]]]:
    """Each fact the captures disagree on, by handle; and each fact only some of them
    record, with the handles that record none."""
    facts_by_handle = {
        handle: _capture_facts(registry, handle, match) for handle in handles
    }
    mismatched: Dict[str, Dict[str, object]] = {}
    unverified: Dict[str, List[str]] = {}
    for fact in report_diff.COMPARED_FACTS:
        known = {
            handle: facts[fact]
            for handle, facts in facts_by_handle.items()
            if facts.get(fact) is not None
        }
        if len(set(known.values())) > 1:
            mismatched[fact] = known
        if known and len(known) < len(facts_by_handle):
            unverified[fact] = [
                handle for handle in facts_by_handle if handle not in known
            ]
    return mismatched, unverified


def diff_reports(
    registry: ReportRegistry,
    handle_a: str,
    handle_b: str,
    by: str = DEFAULT_METRIC,
    limit: Optional[int] = None,
    start_signpost: Optional[str] = None,
    end_signpost: Optional[str] = None,
    match: str = report_diff.DiffMatch.OP_CODE.value,
    min_percent: Optional[float] = None,
    min_delta: Optional[float] = None,
    repeats_a: Optional[List[str]] = None,
    repeats_b: Optional[List[str]] = None,
) -> Dict[str, object]:
    """Per-group deltas between two reports, with noise and one-sided groups kept apart.

    Grouped by op code, or raw op code and tensors, rather than joined on op id: the
    question is "did my change help", and a change that adds or reorders ops shifts
    every id after it, so an id join would report a diff for ops that did not change.
    What counts as a change is `report_diff`'s.

    One range applies to every capture, which is the before-and-after case: the same
    signposts in each run.
    """
    require_choice("metric", by, SORTABLE_METRICS)
    # Refused rather than aggregated some other way. A diff groups by op code and
    # compares the two sides, so for a rate or an allocation every number in the
    # response is a sum of them: one 10-TFLOPS matmul against two at 8 reads as
    # 10 -> 16, an apparent gain where every invocation regressed. Whether the
    # right comparison is a mean, a max, or per-invocation is a product question,
    # and answering it wrongly is worse than not answering it.
    if by not in ADDITIVE_METRICS:
        raise ValueError(
            f"{by!r} is a per-operation rate or allocation, so summing it across a "
            f"report is not meaningful; diff_reports accepts "
            f"{', '.join(sorted(ADDITIVE_METRICS))}. Use top_ops to rank by {by!r}."
        )
    require_choice("match", match, report_diff.DIFF_MATCHES)
    grouping = report_diff.DiffMatch(match)
    metric = report_diff.DIFF_METRICS[by]
    thresholds = report_diff.Thresholds(
        report_diff.threshold(
            "min_percent", min_percent, report_diff.DEFAULT_MIN_PERCENT
        ),
        report_diff.threshold("min_delta", min_delta, metric.min_delta),
    )
    # A signature row runs to a few hundred characters, as an `include` row does.
    count = bounded(
        limit,
        (
            MAX_DETAILED_LIMIT
            if grouping is report_diff.DiffMatch.SIGNATURE
            else MAX_LIMIT
        ),
    )
    # Four lists beside the changes, at a hundred rows each, would pass the answer
    # budget; their counts say how many more there are.
    side_count = min(count, MAX_DETAILED_LIMIT)
    before = report_diff.side_handles("repeats_a", handle_a, repeats_a)
    after = report_diff.side_handles("repeats_b", handle_b, repeats_b)
    handles = before + after
    for handle in handles:
        _require_performance_report(registry, handle)
    _require_distinct_captures(registry, handles)

    signposts = SignpostRange.of(start_signpost, end_signpost)
    ignored = [range_ignored(registry, handle, signposts) for handle in handles]
    # Refused: a window against a whole report shows every row outside it as a change.
    # Checked with every other refusal, before any report is generated.
    if any(ignored) and not all(ignored):
        unsignposted = handles[ignored.index(True)]
        raise ValueError(
            f"{unsignposted!r} holds no signposts, so the range would read it whole "
            "while another report is read as a window, and every row outside the "
            "window would show as a change. Diff without a range, or against a "
            "capture with the same signposts."
        )
    if signposts is not None and not ignored[0]:
        for handle in handles:
            check_range(registry, handle, signposts)
    if grouping is report_diff.DiffMatch.SIGNATURE:
        for handle in handles:
            _op_signatures(registry, handle)

    def totals_of(handle: str) -> report_diff.CaptureTotals:
        # A repeat is there for its totals, so only the compared captures keep a report.
        by_match = _diff_totals(
            registry,
            handle,
            signposts,
            ignored[0],
            keep_report=handle in (handle_a, handle_b),
        )
        if grouping not in by_match:
            raise ValueError(
                f"the signatures behind {handle!r} could not be read when its totals "
                "were; call load_report again for a fresh handle"
            )
        return by_match[grouping]

    totals_by_handle = {handle: totals_of(handle) for handle in handles}
    side_before = report_diff.Side.of(
        [totals_by_handle[handle].by_metric[by] for handle in before]
    )
    side_after = report_diff.Side.of(
        [totals_by_handle[handle].by_metric[by] for handle in after]
    )
    comparison = report_diff.classify(side_before, side_after, thresholds)

    def named(group: Hashable) -> Dict[str, object]:
        return report_diff.group_fields(group, grouping)

    def change_entry(change: report_diff.Change) -> Dict[str, object]:
        was, now = change.before, change.after
        entry: Dict[str, object] = {
            **named(change.group),
            f"{by}_before": _rounded(was.total),
            f"{by}_after": _rounded(now.total),
            "delta": change.delta,
            "delta_percent": _percent_of(change.delta, was.total),
            "count_before": was.count,
            "count_after": now.count,
        }
        # Without these a total over fewer measured calls reads as a speed-up.
        if was.measured != was.count or now.measured != now.count:
            entry["measured_before"] = was.measured
            entry["measured_after"] = now.measured
        return entry

    def one_sided_entry(
        group: Hashable, side: report_diff.Side, label: str
    ) -> Dict[str, object]:
        figure = side.figures_by_group.get(group)
        entry: Dict[str, object] = {
            **named(group),
            f"{by}_{label}": _rounded(figure.total) if figure is not None else None,
            f"count_{label}": side.calls_by_group[group][0],
        }
        # As on a change, since a total over fewer measured calls is a partial one.
        if figure is not None and figure.measured != figure.count:
            entry[f"measured_{label}"] = figure.measured
        return entry

    def unmeasured_entry(group: Hashable) -> Dict[str, object]:
        return {
            **named(group),
            "count_before": side_before.calls_by_group[group][0],
            "count_after": side_after.calls_by_group[group][0],
            "measured_before": side_before.least_measured_by_group[group],
            "measured_after": side_after.least_measured_by_group[group],
        }

    changes = [change_entry(change) for change in comparison.changes[:count]]
    result: Dict[str, object] = {
        "metric": by,
        "before": handle_a,
        "after": handle_b,
        "grouped_by": grouping.value,
        "thresholds": {
            "min_percent": thresholds.percent,
            "min_delta": thresholds.floor,
            "min_delta_unit": metric.unit,
        },
        "change_count": len(comparison.changes),
        "within_threshold_count": comparison.within_threshold_count,
        "returned": len(changes),
        "changes": changes,
        "new_count": len(comparison.new),
        "new": [
            one_sided_entry(group, side_after, "after")
            for group in comparison.new[:side_count]
        ],
        "missing_count": len(comparison.missing),
        "missing": [
            one_sided_entry(group, side_before, "before")
            for group in comparison.missing[:side_count]
        ],
        "unmeasured_count": len(comparison.unmeasured),
        "unmeasured": [
            unmeasured_entry(group) for group in comparison.unmeasured[:side_count]
        ],
    }
    if len(handles) > 2:
        result.update(
            {
                "repeats_before": before[1:],
                "repeats_after": after[1:],
                "inconsistent_count": len(comparison.inconsistent),
                "inconsistent": [
                    {
                        **named(group),
                        "calls_before": list(
                            side_before.calls_by_group.get(group, (0,) * len(before))
                        ),
                        "calls_after": list(
                            side_after.calls_by_group.get(group, (0,) * len(after))
                        ),
                    }
                    for group in comparison.inconsistent[:side_count]
                ],
            }
        )
    delta_total = report_diff.delta(side_before.total, side_after.total)
    result.update(
        {
            f"{by}_total_before": _rounded(side_before.total),
            f"{by}_total_after": _rounded(side_after.total),
            "delta_total": delta_total,
            "delta_total_percent": _percent_of(delta_total, side_before.total),
            "projection": projection(signposts, ignored[0]),
            "note": report_diff.DIFF_NOTE,
        }
    )

    caveats = []
    mismatched, unverified = _compared_facts(registry, handles, grouping)
    if mismatched:
        result["mismatched"] = mismatched
        caveats.append(report_diff.mismatch_caveat(mismatched))
    if unverified:
        result["unverified"] = unverified
        caveats.append(report_diff.unverified_caveat(unverified))
    if grouping is report_diff.DiffMatch.SIGNATURE:
        caveats.append(report_diff.SIGNATURE_NOISE_CAVEAT)
    if metric.caveat:
        caveats.append(metric.caveat)
    if comparison.unmeasured:
        caveats.append(
            f"{len(comparison.unmeasured)} groups ran in both reports with no {by} on "
            "one side, where tt-perf-report left it blank; they are listed under "
            "unmeasured, and each side's total covers only the calls with a figure."
        )
    sub_devices = sorted(
        set().union(*(totals_by_handle[handle].sub_devices for handle in handles))
    )
    # A delta of two unsound totals is unsound the same way, and this is the
    # response most likely to be acted on -- it answers "did my change help".
    if len(sub_devices) > 1:
        caveats.append(
            f"The reports span {len(sub_devices)} sub-devices "
            f"({', '.join(sub_devices)}). Ops on different sub-devices "
            "can run concurrently, so these summed totals -- and the delta "
            "between them -- overstate elapsed time."
        )
    if caveats:
        result["caveat"] = " ".join(caveats)
    return result


class BreakdownGrouping(str, Enum):
    """Two of the stacked table's groupings, named as `tt-perf-report --group-by` names
    the first; the third, by input-0 memory, is not offered."""

    OP = "op"
    OP_CATEGORY = "op_category"


BREAKDOWN_GROUPINGS = frozenset(grouping.value for grouping in BreakdownGrouping)


OP_BREAKDOWN_NOTE = (
    "Grouped as the performance view's stacked table and tt-perf-report's stacked "
    "report group rows: by op, the op code's first word, which keeps every shape of "
    "an op in one entry and files every host op under (torch); or by op_category. "
    "Signposts are left out. Each share is of the rows read: "
    "device_time_share_percent of device_time_total, op_to_op_gap_share_percent of "
    "op_to_op_gap_total. total_percent sums tt-perf-report's Total %, the share of "
    "device time and op-to-op gap together. A row's op-to-op gap is the time before "
    "it, and a host op has no device time."
)


@dataclass
class _Share:
    key: Optional[str]
    count: int = 0
    device_time: float = 0.0
    op_to_op_gap: float = 0.0
    total_percent: float = 0.0

    def add_row(self, row: Dict) -> None:
        self.count += 1
        self.device_time += countable_device_time(row) or 0.0
        self.op_to_op_gap += finite_number(row.get("op_to_op_gap")) or 0.0
        self.total_percent += finite_number(row.get("total_percent")) or 0.0

    def add(self, other: "_Share") -> None:
        self.count += other.count
        self.device_time += other.device_time
        self.op_to_op_gap += other.op_to_op_gap
        self.total_percent += other.total_percent


def _breakdown_key(row: Dict, grouping: BreakdownGrouping) -> Optional[str]:
    """The stacked table's key: the op code's first word, or the category.

    `generate_stacked_report` in tt-perf-report takes `OP Code`'s first word.
    """
    if grouping is BreakdownGrouping.OP_CATEGORY:
        return row.get("op_category") or None
    words = str(row.get("op_code") or "").split()
    return words[0] if words else None


def op_breakdown(
    registry: ReportRegistry,
    handle: str,
    group_by: str = BreakdownGrouping.OP.value,
    by: str = DEFAULT_METRIC,
    limit: Optional[int] = None,
    start_signpost: Optional[str] = None,
    end_signpost: Optional[str] = None,
) -> Dict[str, object]:
    """Where a report's time went, per op or category, as shares of its totals.

    The performance view's stacked table, built from the rows: tt-perf-report's
    stacked report is not generated (`_GENERATION_OPTIONS`), and it carries no
    op-to-op gap. As there, signposts are left out and a host op is counted with
    no device time.
    """
    require_choice("grouping", group_by, BREAKDOWN_GROUPINGS)
    require_choice("metric", by, ADDITIVE_METRICS)
    grouping = BreakdownGrouping(group_by)
    count = bounded(limit)

    signposts = SignpostRange.of(start_signpost, end_signpost)
    report = canonical_report(registry, handle, signposts)
    rows = [row for row in report.get("report", []) if not is_signpost_row(row)]

    share_by_key: Dict[Optional[str], _Share] = {}
    for row in rows:
        key = _breakdown_key(row, grouping)
        share = share_by_key.get(key)
        if share is None:
            share = share_by_key[key] = _Share(key)
        share.add_row(row)

    device_time_total = sum(share.device_time for share in share_by_key.values())
    gap_total = sum(share.op_to_op_gap for share in share_by_key.values())

    def entry(share: _Share) -> Dict[str, object]:
        return {
            "count": share.count,
            "device_time": _rounded(share.device_time),
            "device_time_share_percent": share_percent(
                share.device_time, device_time_total
            ),
            "op_to_op_gap": _rounded(share.op_to_op_gap),
            "op_to_op_gap_share_percent": share_percent(share.op_to_op_gap, gap_total),
            "total_percent": _rounded(share.total_percent),
        }

    ranked = sorted(
        share_by_key.values(),
        key=lambda share: (-getattr(share, by), share.key is None, share.key or ""),
    )
    shown, rest = ranked[:count], ranked[count:]
    result: Dict[str, object] = {
        "handle": handle,
        "grouped_by": grouping.value,
        "metric": by,
        "row_count": len(rows),
        "group_count": len(share_by_key),
        "returned": len(shown),
        "device_time_total": _rounded(device_time_total),
        "op_to_op_gap_total": _rounded(gap_total),
        "groups": [{grouping.value: share.key, **entry(share)} for share in shown],
        "projection": projection(signposts, bool(report.get("signpost_range_ignored"))),
        "note": OP_BREAKDOWN_NOTE,
    }
    if rest:
        merged = _Share(None)
        for share in rest:
            merged.add(share)
        result["rest"] = {"group_count": len(rest), **entry(merged)}
    caveat = partitioned_caveat(rows)
    if caveat:
        result["caveat"] = caveat
    return result


def _stderr_log() -> None:
    """Keep stdout clear for whatever transport imports this."""
    logging.basicConfig(stream=sys.stderr, level=logging.INFO)


__all__ = [
    "BREAKDOWN_GROUPINGS",
    "BreakdownGrouping",
    "CANONICAL_PROJECTION",
    "DEFAULT_METRIC",
    "MAX_SIGNPOST_NAME_LENGTH",
    "OP_BREAKDOWN_NOTE",
    "PROGRAM_CACHE_NOTE",
    "SORTABLE_METRICS",
    "SignpostRange",
    "canonical_report",
    "check_range",
    "is_ranged",
    "countable_device_time",
    "diff_reports",
    "empty_detail_fields",
    "is_signpost_row",
    "op_breakdown",
    "partitioned_caveat",
    "program_cache",
    "project_row",
    "projection",
    "range_ignored",
    "read_flag_inputs",
    "row_limit",
    "share_percent",
    "top_ops",
    "with_signposts",
    "zone_timings",
]
