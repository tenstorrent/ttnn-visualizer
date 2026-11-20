# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""How busy each Tensix unit was, from tt-metal's hardware counters, weighted by device
time; and the ops ranked by any counter label. #2371"""

from dataclasses import dataclass
from enum import Enum
from typing import Callable, Dict, Iterable, List, Optional, Tuple

from ttnn_visualizer import hardware_counters
from ttnn_visualizer.agent import tools
from ttnn_visualizer.agent.bounds import (
    MAX_LIMIT,
    bounded,
    echoed,
    name_fits,
    require_choice,
    require_name_fits,
)
from ttnn_visualizer.agent.handles import ReportRegistry
from ttnn_visualizer.csv_queries import REPORT_ROW_ID_OFFSET
from ttnn_visualizer.device_architecture import DeviceArchitecture
from ttnn_visualizer.hardware_counters import (
    CounterAbsence,
    CounterFamily,
    CounterHeader,
    CounterMeasure,
    CounterStat,
    CounterTable,
    HeadlineUnit,
)

TOP_OPS_PER_UNIT = 3
# The longest label tt-llk names is 33 characters.
MAX_COUNTER_LABEL_LENGTH = 128
MAX_LISTED_OTHER_LABELS = 20


class RankOrder(str, Enum):
    HIGHEST = "highest"
    LOWEST = "lowest"


RANK_ORDERS = frozenset(order.value for order in RankOrder)

HW_UTILISATION_NOTE = (
    "Hardware counters, read once per op on every core that ran its compute kernel: "
    "avg, min and max are across those cores. A unit's weighted_avg_percent weighs "
    "each op's avg by its device time over the ops that carry the counter, and "
    "device_time_share_percent is how much of the report's device time those ops "
    "took. busy_us is an op's device time times its avg, the time an average core "
    "kept the unit busy, and idle_us the rest of it. full_grid divides by every "
    "compute core of the grid, idle ones included. Rows are merged across devices, "
    "so a multi-device op's counters are the row tt-perf-report keeps: the slowest "
    "device's row, or the first device's for an all-gather, reduce-scatter or "
    "all-reduce. An op without a compute kernel records no counters and is left out "
    "of every figure rather than read as 0."
)


@dataclass(frozen=True)
class _Op:
    row: Dict
    position: int
    device_time: Optional[float]


def _ops(rows: Iterable[Dict]) -> List[_Op]:
    ops = []
    for row in rows:
        if tools.is_signpost_row(row):
            continue
        try:
            position = int(row["id"]) - REPORT_ROW_ID_OFFSET
        except (KeyError, TypeError, ValueError):
            continue
        ops.append(_Op(row, position, tools.countable_device_time(row)))
    return ops


def _rounded(value: Optional[float]) -> Optional[float]:
    return None if value is None else round(value, 3)


def _stats(table: CounterTable, label: str, position: int) -> Dict[str, object]:
    return {
        stat.value: table.value(table.header.column(label, stat), position)
        for stat, _ in hardware_counters.ROW_KEY_STATS
    }


def _weighted(
    table: CounterTable, column: str, ops: List[_Op], report_total: float
) -> Dict[str, object]:
    """The device-time-weighted mean of a column over the ops that carry it."""
    carried = [
        (value, op.device_time)
        for op in ops
        if (value := table.value(column, op.position)) is not None
    ]
    timed = [(value, time) for value, time in carried if time is not None]
    covered = sum(time for _, time in timed)
    return {
        "weighted_avg_percent": (
            _rounded(sum(value * time for value, time in timed) / covered)
            if covered > 0
            else None
        ),
        "ops_with_value": len(carried),
        "device_time_with_value": round(covered, 3),
        "device_time_share_percent": tools.share_percent(covered, report_total),
    }


def _busy_us(value: float, device_time: float) -> float:
    return value / 100 * device_time


def _idle_us(value: float, device_time: float) -> float:
    return max(0.0, 1 - value / 100) * device_time


def _weighed_ops(
    table: CounterTable,
    column: Optional[str],
    ops: List[_Op],
    weigh: Callable[[float, float], float],
) -> List[Tuple[float, _Op]]:
    """The ops carrying the column and a device time, heaviest first by `weigh`."""
    weighed = [
        (weigh(value, op.device_time), op)
        for op in ops
        if op.device_time is not None
        and (value := table.value(column, op.position)) is not None
    ]
    weighed.sort(key=lambda entry: entry[0], reverse=True)
    return weighed


def _absent(
    header: CounterHeader, label: str, architecture: DeviceArchitecture
) -> Optional[Dict[str, object]]:
    missing = hardware_counters.absence_hint(header, label, architecture)
    if missing is None:
        return None
    absent: Dict[str, object] = {"state": missing.absence.value}
    if missing.fill_hint is not None:
        absent["fill_hint"] = missing.fill_hint
    return absent


def _unit(
    table: CounterTable,
    unit: HeadlineUnit,
    ops: List[_Op],
    report_total: float,
    architecture: DeviceArchitecture,
) -> Dict[str, object]:
    summary: Dict[str, object] = {
        "unit": unit.unit.value,
        "label": unit.label,
        "family": unit.family.value,
    }
    absent = _absent(table.header, unit.label, architecture)
    column = table.header.column(unit.label, CounterStat.AVG)
    if absent is not None or column is None:
        return {**summary, **(absent or {"state": CounterAbsence.NOT_CAPTURED.value})}

    busiest = _weighed_ops(table, column, ops, _busy_us)
    return {
        **summary,
        **_weighted(table, column, ops, report_total),
        "top_ops": [
            {
                **tools.project_row(op.row),
                **_stats(table, unit.label, op.position),
                "busy_us": _rounded(busy),
            }
            for busy, op in busiest[:TOP_OPS_PER_UNIT]
        ],
    }


def _full_grid(
    table: CounterTable, ops: List[_Op], report_total: float
) -> List[Dict[str, object]]:
    return [
        {
            "unit": grid.unit.value,
            "column": column,
            **_weighted(table, column, ops, report_total),
        }
        for grid in hardware_counters.FULL_GRID_UNITS
        if (column := table.header.full_grid.get(grid.unit.value)) is not None
    ]


def _family(
    header: CounterHeader, family: CounterFamily, architecture: DeviceArchitecture
) -> Dict[str, object]:
    present = [
        label
        for label in header.columns
        if hardware_counters.family_of(label) is family
    ]
    entry: Dict[str, object] = {"family": family.value, "captured": bool(present)}
    if family is CounterFamily.OTHER:
        listed = [
            label for label in present if name_fits(label, MAX_COUNTER_LABEL_LENGTH)
        ][:MAX_LISTED_OTHER_LABELS]
        entry["labels"] = listed
        entry["labels_unlisted"] = len(present) - len(listed)
        return entry
    entry["labels"] = present
    entry["not_on_architecture"] = [
        label
        for label in hardware_counters.labels_of(family)
        if hardware_counters.is_listed(label, architecture)
        and not hardware_counters.is_available(label, architecture)
    ]
    entry["fill_hint"] = hardware_counters.fill_hint(
        hardware_counters.FAMILY_GROUPS[family]
    )
    return entry


def _resolve_label(
    header: CounterHeader, label: str, architecture: DeviceArchitecture
) -> str:
    """The capture's own spelling of `label`, or a refusal saying why it has none."""
    if label in header.columns:
        return label
    folded = {known.casefold(): known for known in header.columns}
    if label.casefold() in folded:
        return folded[label.casefold()]
    missing = hardware_counters.absence_hint(header, label, architecture)
    if missing is not None and label in hardware_counters.FAMILY_BY_LABEL:
        if missing.absence is CounterAbsence.NOT_ON_ARCHITECTURE:
            raise ValueError(f"{label!r} is not available on this architecture")
        raise ValueError(f"{label!r} was not captured: it is {missing.fill_hint}")
    raise ValueError(
        f"no counter labelled {echoed(label)} in this capture; call hw_utilisation "
        "without label for the labels it holds, listed under families"
    )


def _ranked(
    table: CounterTable,
    ops: List[_Op],
    label: str,
    order: RankOrder,
    weighted: Optional[bool],
    count: int,
    architecture: DeviceArchitecture,
) -> Dict[str, object]:
    resolved = _resolve_label(table.header, label, architecture)
    measure = table.header.measures[resolved]
    if weighted is None:
        weighted = measure is CounterMeasure.PERCENT
    if weighted and measure is CounterMeasure.RATIO:
        raise ValueError(
            f"{resolved!r} is a ratio, which has no busy or idle time to weigh by "
            "device time; pass weighted false to rank by its value"
        )
    column = table.header.column(resolved, CounterStat.AVG)
    if weighted:
        weigh = _busy_us if order is RankOrder.HIGHEST else _idle_us
        entries = _weighed_ops(table, column, ops, weigh)
    else:
        entries = [
            (value, op)
            for op in ops
            if (value := table.value(column, op.position)) is not None
        ]
        entries.sort(key=lambda entry: entry[0], reverse=order is RankOrder.HIGHEST)
    weight_field = "busy_us" if order is RankOrder.HIGHEST else "idle_us"
    return {
        "label": resolved,
        "family": hardware_counters.family_of(resolved).value,
        "measure": measure.value,
        "order": order.value,
        "weighted": weighted,
        "op_count": len(entries),
        "ops": [
            {
                **tools.project_row(op.row),
                **_stats(table, resolved, op.position),
                **({weight_field: _rounded(key)} if weighted else {}),
            }
            for key, op in entries[:count]
        ],
    }


def hw_utilisation(
    registry: ReportRegistry,
    handle: str,
    label: Optional[str] = None,
    order: str = RankOrder.HIGHEST.value,
    weighted: Optional[bool] = None,
    limit: Optional[int] = None,
) -> Dict[str, object]:
    """Per-unit utilisation for the whole report and, given a label, ops ranked by it."""
    require_choice("order", order, RANK_ORDERS)
    if label is not None:
        require_name_fits("label", "counter label", label, MAX_COUNTER_LABEL_LENGTH)
    if weighted is not None and not isinstance(weighted, bool):
        raise ValueError(f"weighted must be true or false, not {echoed(weighted)}")
    count = bounded(limit, MAX_LIMIT)

    table = tools.hardware_counter_table(registry, handle)
    rows = tools.canonical_report(registry, handle).get("report", [])
    ops = _ops(rows)
    report_total = sum(op.device_time or 0.0 for op in ops)
    architecture = tools.device_architecture(registry, handle)
    header = table.header

    result: Dict[str, object] = {
        "handle": handle,
        **tools.device_time_header(report_total),
        "architecture": architecture.value or None,
        "capture_groups": {
            group.value: state.value
            for group, state in hardware_counters.group_states(
                header, architecture
            ).items()
        },
        "units": [
            _unit(table, unit, ops, report_total, architecture)
            for unit in hardware_counters.HEADLINE_UNITS
        ],
        "full_grid": _full_grid(table, ops, report_total),
        "families": [_family(header, family, architecture) for family in CounterFamily],
        "note": HW_UTILISATION_NOTE,
    }
    if label is not None:
        result["ranked"] = _ranked(
            table, ops, label, RankOrder(order), weighted, count, architecture
        )
    caveat = tools.partitioned_caveat(rows)
    if caveat:
        result["caveat"] = caveat
    return result


__all__ = [
    "HW_UTILISATION_NOTE",
    "MAX_COUNTER_LABEL_LENGTH",
    "MAX_LISTED_OTHER_LABELS",
    "RANK_ORDERS",
    "TOP_OPS_PER_UNIT",
    "RankOrder",
    "hw_utilisation",
]
