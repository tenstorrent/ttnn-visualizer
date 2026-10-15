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
import math
import sys
from collections import defaultdict
from dataclasses import dataclass
from typing import Dict, List, Optional

from ttnn_visualizer.agent.bounds import bounded
from ttnn_visualizer.agent.handles import CacheVariant, ReportRegistry
from ttnn_visualizer.csv_queries import (
    DeviceLogProfilerQueries,
    OpsPerformanceQueries,
    OpsPerformanceReportQueries,
    ResolvedSignposts,
    resolve_signposts,
)
from ttnn_visualizer.exceptions import DataFormatError
from ttnn_visualizer.models import Instance

logger = logging.getLogger(__name__)

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

# Metrics a report-level sum is meaningful for. `dram` is GB/s, `flops` is
# TFLOPS and `cores` is a per-op allocation: adding them across operations
# produces an authoritative-looking number that is dimensionally nonsense.
ADDITIVE_METRICS = frozenset({"device_time", "op_to_op_gap", "total_percent"})


def _as_number(value: object) -> Optional[float]:
    """Report cells arrive as strings, including the numeric ones."""
    if isinstance(value, bool) or value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return None
    return None


def countable_device_time(row: Dict) -> Optional[float]:
    """A row's device time, or None where it is blank, non-finite or not positive.

    `isCountableDeviceTime` in `src/functions/durationBuckets.ts`, which the app
    counts a share's device time with; mirror a change there.
    """
    value = _as_number(row.get("device_time"))
    return value if value is not None and math.isfinite(value) and value > 0 else None


def _rounded(value: Optional[float]) -> Optional[float]:
    """Nanosecond precision is plenty, and a 17-digit float is context spent."""
    return None if value is None else round(value, 3)


# Longer than any signpost a model emits, and short enough that a refusal or a
# projection echoing the name stays small.
MAX_SIGNPOST_NAME_LENGTH = 256


@dataclass(frozen=True)
class SignpostRange:
    """A window of the report, bounded as `tt-perf-report --start-signpost` bounds it.

    The bounds are passed to tt-perf-report rather than cut from the whole
    snapshot: it recomputes `Total %` and the first op-to-op gap over the window,
    and a cut snapshot would disagree with the signposted run an agent is
    checking against. Row ids are CSV positions either way, so a windowed row
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


def canonical_report(
    registry: ReportRegistry, handle: str, signposts: Optional[SignpostRange] = None
) -> Dict:
    """One generated report per handle and range; see `ReportRegistry.cached_report`.

    A range on a report with no signposts is answered from the whole snapshot:
    tt-perf-report would read the whole file for it anyway, and generating it
    once per name asked would cache an identical copy for each. A refused range
    raises `InvalidSignpostRange`, a `ValueError`, and is not cached.
    """
    ignored = signposts is not None and not has_signposts(registry, handle)
    scope = None if ignored else signposts
    overrides = scope.as_overrides() if scope is not None else {}
    report = registry.cached_report(
        handle,
        lambda instance: _generate_canonical_report(instance, **overrides),
        scope=scope,
    )
    return {**report, "signpost_range_ignored": True} if ignored else report


def has_signposts(registry: ReportRegistry, handle: str) -> bool:
    """Whether the handle's performance CSV holds a named signpost a range can use.

    Read once per handle, three columns, without generating a report -- the same
    test `signpost_range_ignored` applies after generating one.
    """
    resolved = registry.cached_report(
        handle, _resolve_signposts, variant=CacheVariant.SIGNPOSTS
    )
    return bool(resolved.positions_by_name)


def _resolve_signposts(instance: Instance) -> ResolvedSignposts:
    path = OpsPerformanceQueries.get_local_ops_perf_file_path(instance)
    try:
        with open(path, newline="") as csv_file:
            return resolve_signposts(csv_file)
    # As `generate_report` answers it: a ragged capture is the caller's data.
    except ValueError as error:
        raise DataFormatError(
            f"could not read the report's signposts: {error}"
        ) from error


def projection(
    signposts: Optional[SignpostRange], range_ignored: bool = False
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
                "start_signpost": signposts.start,
                "end_signpost": signposts.end,
                "boundary_signposts_included": False,
                "signpost_range_ignored": range_ignored,
            }
        )
    return result


def _generate_canonical_report(instance: Instance, **overrides: object) -> Dict:
    """Run the report with stdout captured.

    `tt_perf_report` prints its progress and the temp paths it writes to. On a
    stdio transport that lands in the middle of a JSON-RPC frame and corrupts
    the stream, so it is captured here rather than at the transport -- a tool
    called in-process should not write to stdout either.
    """
    captured = io.StringIO()
    with contextlib.redirect_stdout(captured):
        report = OpsPerformanceReportQueries.generate_report(
            instance, **{**CANONICAL_PROJECTION, **overrides}
        )
    if captured.getvalue().strip():
        logger.debug("tt-perf-report output: %s", captured.getvalue().strip())
    return report


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


def project_row(row: Dict, metric: str = "device_time") -> Dict[str, object]:
    """One performance row as every tool reports it.

    Shared so a row reads the same wherever it appears: `top_ops` ranks it and
    `operation_detail` lists it under the operation that launched it, and two
    projections of one CSV row that disagreed would be the drift the link exists
    to prevent.
    """
    return {
        "id": row.get("id"),
        "op_code": row.get("op_code") or row.get("raw_op_code"),
        metric: _rounded(_as_number(row.get(SORTABLE_METRICS[metric]))),
        "cores": _as_number(row.get("cores")),
        "bound": row.get("bound") or None,
        # Without it a null bound reads as "fine" when the op was never modelled (#2064).
        "bound_analysis": row.get("bound_analysis") or None,
        "op_category": row.get("op_category") or None,
    }


def top_ops(
    registry: ReportRegistry,
    handle: str,
    by: str = "device_time",
    limit: Optional[int] = None,
    start_signpost: Optional[str] = None,
    end_signpost: Optional[str] = None,
) -> Dict[str, object]:
    """The costliest ops by one metric, with the projection that produced them."""
    if by not in SORTABLE_METRICS:
        raise ValueError(
            f"unknown metric {by!r}; expected one of {', '.join(sorted(SORTABLE_METRICS))}"
        )

    signposts = SignpostRange.of(start_signpost, end_signpost)
    report = canonical_report(registry, handle, signposts)
    rows = report.get("report", [])
    field = SORTABLE_METRICS[by]

    ranked = sorted(
        (row for row in rows if _as_number(row.get(field)) is not None),
        key=lambda row: _as_number(row.get(field)) or 0.0,
        reverse=True,
    )[: bounded(limit)]

    total: float = sum(_as_number(row.get(field)) or 0.0 for row in rows)
    ops = [
        {
            **project_row(row, by),
            "device": row.get("device"),
            "sub_device_id": row.get("sub_device_id") or None,
            # The projection keeps signpost rows deliberately, so the field that
            # tells a marker from an operation has to survive into the response.
            "op_type": row.get("op_type") or None,
        }
        for row in ranked
    ]

    result: Dict[str, object] = {
        "handle": handle,
        "metric": by,
        "op_count": len(rows),
        "returned": len(ops),
        "ops": ops,
        "projection": projection(signposts, bool(report.get("signpost_range_ignored"))),
    }
    if by in ADDITIVE_METRICS:
        result[f"{by}_total"] = round(total, 3)
    caveat = partitioned_caveat(rows)
    if caveat:
        result["caveat"] = caveat
    return result


def zone_timings(
    registry: ReportRegistry, handle: str, limit: Optional[int] = None
) -> Dict[str, object]:
    """Per-zone, per-RISC totals from the device profiler log."""
    instance = registry.get(handle)
    metadata = DeviceLogProfilerQueries.read_capture_metadata(instance)
    clock_mhz = _as_number(metadata.get("CHIP_FREQ[MHz]"))

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


def diff_reports(
    registry: ReportRegistry,
    handle_a: str,
    handle_b: str,
    by: str = "device_time",
    limit: Optional[int] = None,
    start_signpost: Optional[str] = None,
    end_signpost: Optional[str] = None,
) -> Dict[str, object]:
    """Per-op-code deltas between two reports.

    Aggregated by op code rather than joined on op id: the question is "did my
    change help", and a change that adds or reorders ops shifts every id after
    it, so an id join would report a diff for ops that did not change.

    One range applies to both reports, which is the before-and-after case: the
    same signposts in two runs.
    """
    if by not in SORTABLE_METRICS:
        raise ValueError(
            f"unknown metric {by!r}; expected one of {', '.join(sorted(SORTABLE_METRICS))}"
        )
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
    field = SORTABLE_METRICS[by]

    signposts = SignpostRange.of(start_signpost, end_signpost)
    ignored_a = signposts is not None and not has_signposts(registry, handle_a)
    ignored_b = signposts is not None and not has_signposts(registry, handle_b)
    # Refused rather than caveated: a window compared against a whole report
    # reports every row outside the window as a change, and this is the response
    # most likely to be acted on. Both sides ignoring it compares like with like.
    # Checked before either report is generated, so a refusal costs two reads.
    if ignored_a != ignored_b:
        unsignposted = handle_a if ignored_a else handle_b
        raise ValueError(
            f"{unsignposted!r} holds no signposts, so the range would read it whole "
            "while the other report is read as a window, and every row outside the "
            "window would show as a change. Diff without a range, or against a "
            "capture with the same signposts."
        )
    report_a = canonical_report(registry, handle_a, signposts)
    report_b = canonical_report(registry, handle_b, signposts)

    sub_devices: set = set()

    def totals_by_op_code(report: Dict) -> Dict[str, Dict[str, float]]:
        rows = report.get("report", [])
        sub_devices.update(_sub_devices(rows))
        totals: Dict[str, Dict[str, float]] = defaultdict(
            lambda: {"total": 0.0, "count": 0.0}
        )
        for row in rows:
            value = _as_number(row.get(field))
            if value is None:
                continue
            op_code = str(row.get("op_code") or row.get("raw_op_code") or "").strip()
            if not op_code:
                continue
            totals[op_code]["total"] += value
            totals[op_code]["count"] += 1
        return totals

    before = totals_by_op_code(report_a)
    after = totals_by_op_code(report_b)

    changes = []
    for op_code in set(before) | set(after):
        before_total = before.get(op_code, {}).get("total", 0.0)
        after_total = after.get(op_code, {}).get("total", 0.0)
        changes.append(
            {
                "op_code": op_code,
                f"{by}_before": round(before_total, 3),
                f"{by}_after": round(after_total, 3),
                "delta": round(after_total - before_total, 3),
                "count_before": int(before.get(op_code, {}).get("count", 0)),
                "count_after": int(after.get(op_code, {}).get("count", 0)),
            }
        )

    # Largest movement in either direction: a regression matters as much as a win.
    changes.sort(
        key=lambda change: abs(_as_number(change["delta"]) or 0.0), reverse=True
    )

    result: Dict[str, object] = {
        "metric": by,
        "before": handle_a,
        "after": handle_b,
        "returned": min(len(changes), bounded(limit)),
        "changes": changes[: bounded(limit)],
        "projection": projection(signposts, ignored_a and ignored_b),
        "grouped_by": "op_code",
    }
    result["delta_total"] = round(
        sum(entry["total"] for entry in after.values())
        - sum(entry["total"] for entry in before.values()),
        3,
    )
    # A delta of two unsound totals is unsound the same way, and this is the
    # response most likely to be acted on -- it answers "did my change help".
    if len(sub_devices) > 1:
        result["caveat"] = (
            f"Either report spans {len(sub_devices)} sub-devices "
            f"({', '.join(sorted(sub_devices))}). Ops on different sub-devices "
            "can run concurrently, so these summed totals -- and the delta "
            "between them -- overstate elapsed time."
        )
    return result


def _stderr_log() -> None:
    """Keep stdout clear for whatever transport imports this."""
    logging.basicConfig(stream=sys.stderr, level=logging.INFO)


__all__ = [
    "CANONICAL_PROJECTION",
    "MAX_SIGNPOST_NAME_LENGTH",
    "SORTABLE_METRICS",
    "SignpostRange",
    "canonical_report",
    "countable_device_time",
    "diff_reports",
    "has_signposts",
    "partitioned_caveat",
    "project_row",
    "projection",
    "top_ops",
    "zone_timings",
]
