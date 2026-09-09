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
from collections import defaultdict
from typing import Dict, List, Optional

from ttnn_visualizer.agent.handles import ReportRegistry
from ttnn_visualizer.csv_queries import (
    DeviceLogProfilerQueries,
    OpsPerformanceReportQueries,
)
from ttnn_visualizer.models import Instance

logger = logging.getLogger(__name__)

# The projection every tool reads through, stated rather than defaulted.
#
# `get_performance_results_report` defaults `hide_host_ops` and `merge_devices`
# to true and can narrow to a signpost range. Those are view choices: handed to
# an agent unannounced they produce confident reasoning over a partial set,
# which is how #1883 lost six features to a filtered link status. Host ops stay
# in because dropping rows silently is the failure worth avoiding; devices stay
# merged because that is the unit an op is reported in.
CANONICAL_PROJECTION: Dict[str, object] = {
    "hide_host_ops": False,
    "merge_devices": True,
    "print_signposts": False,
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

DEFAULT_LIMIT = 10
MAX_LIMIT = 100


def _bounded(limit: Optional[int]) -> int:
    if limit is None:
        return DEFAULT_LIMIT
    return max(1, min(int(limit), MAX_LIMIT))


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


def _rounded(value: Optional[float]) -> Optional[float]:
    """Nanosecond precision is plenty, and a 17-digit float is context spent."""
    return None if value is None else round(value, 3)


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


def _partitioned_caveat(rows: List[Dict]) -> Optional[str]:
    """Totals assume ops ran sequentially, which a partitioned run breaks.

    tt-perf-report prints this warning itself when a report carries more than one
    sub-device; the visualizer does not surface it (raised on #1994). An agent
    summing device time across subdevices that ran concurrently would overstate
    the total and understate every op's share, so any tool reporting a total says
    so here.
    """
    sub_devices = {
        str(row.get("sub_device_id", "")).strip()
        for row in rows
        if str(row.get("sub_device_id", "")).strip()
    }
    if len(sub_devices) <= 1:
        return None
    return (
        f"This report spans {len(sub_devices)} sub-devices "
        f"({', '.join(sorted(sub_devices))}). Ops on different sub-devices can run "
        "concurrently, so summed device time, total percentages and op-to-op gaps "
        "overstate elapsed time. Compare ops within one sub-device instead."
    )


def top_ops(
    registry: ReportRegistry,
    handle: str,
    by: str = "device_time",
    limit: Optional[int] = None,
) -> Dict[str, object]:
    """The costliest ops by one metric, with the projection that produced them."""
    if by not in SORTABLE_METRICS:
        raise ValueError(
            f"unknown metric {by!r}; expected one of {', '.join(sorted(SORTABLE_METRICS))}"
        )

    instance = registry.get(handle)
    report = _generate_canonical_report(instance)
    rows = report.get("report", [])
    field = SORTABLE_METRICS[by]

    ranked = sorted(
        (row for row in rows if _as_number(row.get(field)) is not None),
        key=lambda row: _as_number(row.get(field)) or 0.0,
        reverse=True,
    )[: _bounded(limit)]

    total: float = sum(_as_number(row.get(field)) or 0.0 for row in rows)
    ops = [
        {
            "id": row.get("id"),
            "op_code": row.get("op_code") or row.get("raw_op_code"),
            by: _rounded(_as_number(row.get(field))),
            "cores": _as_number(row.get("cores")),
            "device": row.get("device"),
            "sub_device_id": row.get("sub_device_id") or None,
            "bound": row.get("bound") or None,
        }
        for row in ranked
    ]

    result: Dict[str, object] = {
        "handle": handle,
        "metric": by,
        "op_count": len(rows),
        "returned": len(ops),
        f"{by}_total": round(total, 3),
        "ops": ops,
        "projection": dict(CANONICAL_PROJECTION),
    }
    caveat = _partitioned_caveat(rows)
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
        summary = queries.query_zone_summary(limit=_bounded(limit))

    zones = []
    for entry in summary:
        total_cycles = entry["total_cycles"]
        zones.append(
            {
                **entry,
                # A megahertz clock ticks once per microsecond, so cycles over
                # MHz is already microseconds.
                "total_us": (
                    round(total_cycles / clock_mhz, 3)
                    if total_cycles and clock_mhz
                    else None
                ),
            }
        )

    return {
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


def diff_reports(
    registry: ReportRegistry,
    handle_a: str,
    handle_b: str,
    by: str = "device_time",
    limit: Optional[int] = None,
) -> Dict[str, object]:
    """Per-op-code deltas between two reports.

    Aggregated by op code rather than joined on op id: the question is "did my
    change help", and a change that adds or reorders ops shifts every id after
    it, so an id join would report a diff for ops that did not change.
    """
    if by not in SORTABLE_METRICS:
        raise ValueError(
            f"unknown metric {by!r}; expected one of {', '.join(sorted(SORTABLE_METRICS))}"
        )
    field = SORTABLE_METRICS[by]

    def totals_by_op_code(handle: str) -> Dict[str, Dict[str, float]]:
        rows = _generate_canonical_report(registry.get(handle)).get("report", [])
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

    before = totals_by_op_code(handle_a)
    after = totals_by_op_code(handle_b)

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

    return {
        "metric": by,
        "before": handle_a,
        "after": handle_b,
        "delta_total": round(
            sum(entry["total"] for entry in after.values())
            - sum(entry["total"] for entry in before.values()),
            3,
        ),
        "returned": min(len(changes), _bounded(limit)),
        "changes": changes[: _bounded(limit)],
        "projection": dict(CANONICAL_PROJECTION),
        "grouped_by": "op_code",
    }


def _stderr_log() -> None:
    """Keep stdout clear for whatever transport imports this."""
    logging.basicConfig(stream=sys.stderr, level=logging.INFO)


__all__ = [
    "CANONICAL_PROJECTION",
    "SORTABLE_METRICS",
    "diff_reports",
    "top_ops",
    "zone_timings",
]
