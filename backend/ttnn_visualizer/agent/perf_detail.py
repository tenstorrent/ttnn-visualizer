# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Why a performance row took the time it did, in groups a caller asks for. #2153

A row names its op and its metric by default. `include` adds groups of the fields the
generated report already carries, so a caller asking why an op is slow pays for the
fields it asks about and no others.
"""

import math
import re
from enum import Enum
from typing import (
    AbstractSet,
    Callable,
    Dict,
    Iterable,
    List,
    NamedTuple,
    Optional,
    Sequence,
    Tuple,
)

from ttnn_visualizer.csv_queries import PROGRAM_CACHE_HIT_COLUMN, PROGRAM_HASH_COLUMN


class DetailGroup(str, Enum):
    CONFIG = "config"
    UTILISATION = "utilisation"
    NOC = "noc"
    RISCS = "riscs"
    CORES = "cores"
    DISPATCH = "dispatch"
    CACHE = "cache"
    KERNELS = "kernels"
    ADVICE = "advice"


# How tt-perf-report and pandas spell an empty cell.
_EMPTY_CELLS = frozenset({"", "nan", "NaN", "None"})


def _text(value: object) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    return None if text in _EMPTY_CELLS else text


def _number(value: object) -> Optional[float]:
    """A finite number or None: a NaN would reach the client as invalid JSON."""
    if isinstance(value, bool) or value is None:
        return None
    try:
        number = float(str(value))
    except ValueError:
        return None
    return round(number, 3) if math.isfinite(number) else None


def _microseconds(nanoseconds: object) -> Optional[float]:
    """The raw columns are nanoseconds; `device_time` beside them is microseconds."""
    number = _number(nanoseconds)
    return None if number is None else round(number / 1000, 3)


# tt-metal's `OpPerformanceModelGeneral` defaults every ideal time to 1 ns, so an op
# whose model sets none reports 1; read as a time it is a million-fold false gap.
_UNMODELLED_NS = 1.0


def _is_unmodelled(nanoseconds: object) -> bool:
    return _number(nanoseconds) == _UNMODELLED_NS


_FIDELITY = re.compile(r"(LoFi|HiFi[234])$")


def _fidelity(value: object) -> Optional[str]:
    match = _FIDELITY.match(_text(value) or "")
    return match.group(1) if match else None


def _count(value: object) -> Optional[int]:
    number = _number(value)
    return None if number is None else int(number)


def _flag(value: object) -> Optional[bool]:
    """`True`/`False` as tt-perf-report and tt-metal write them, as `cache_hit` is read."""
    if isinstance(value, bool):
        return value
    return {"True": True, "False": False}.get(_text(value) or "")


def _listed(value: object) -> Optional[List[str]]:
    """A kernel list, which tt-metal writes as `['a'; 'b']`; `[]` is a captured none."""
    text = _text(value)
    if text is None:
        return None
    if text.startswith("[") and text.endswith("]"):
        text = text[1:-1]
    items = (item.strip().strip("'\"") for item in text.split(";"))
    return [item for item in items if item]


def _advice(value: object) -> Optional[List[str]]:
    if not isinstance(value, list):
        return None
    return [str(item).strip() for item in value if str(item).strip()]


_NOC_TRACES = "filled when the capture ran with --collect-noc-traces"
_DISPATCH_CORES = "filled when the capture ran with --profile-dispatch-cores"
_TRACED = "filled for operations run inside a captured metal trace"
_MODELLED = "set only by an op whose performance model computes it"
_EMPTY_ON_EVERY_ROW = "empty on every row of the report"


class _Field(NamedTuple):
    name: str
    column: str
    read: Callable[[object], object]
    # The perf-model time this figure comes from; null while it is the placeholder.
    model_column: Optional[str] = None
    # What a capture must ask for to fill it; unset, every capture with the column does.
    filled_by: Optional[str] = None

    def value(self, row: Dict) -> object:
        if self.model_column and _is_unmodelled(row.get(self.model_column)):
            return None
        return self.read(row.get(self.column))

    @property
    def fill_hint(self) -> str:
        if self.model_column:
            return _MODELLED
        return self.filled_by or _EMPTY_ON_EVERY_ROW


_FIELDS: Dict[DetailGroup, Tuple[_Field, ...]] = {
    DetailGroup.CONFIG: (
        # The raw column: tt-perf-report's own names a fidelity for matmuls only.
        _Field("math_fidelity", "raw_math_fidelity", _fidelity),
        _Field("input_0_datatype", "input_0_datatype", _text),
        _Field("input_1_datatype", "input_1_datatype", _text),
        _Field("output_datatype", "output_datatype", _text),
        _Field("input_0_memory", "input_0_memory", _text),
        _Field("dram_sharded", "dram_sharded", _flag),
        _Field("inner_dim_block_size", "inner_dim_block_size", _count),
        _Field("output_subblock_h", "output_subblock_h", _count),
        _Field("output_subblock_w", "output_subblock_w", _count),
    ),
    DetailGroup.UTILISATION: (
        _Field("dram_gb_per_s", "dram", _number),
        _Field("dram_percent", "dram_percent", _number),
        _Field("tflops", "flops", _number),
        _Field("flops_percent", "flops_percent", _number),
        _Field("ideal_us", "pm_ideal_ns", _microseconds, "pm_ideal_ns"),
        _Field("ideal_compute_us", "pm_compute_ns", _microseconds, "pm_compute_ns"),
        _Field(
            "ideal_bandwidth_us", "pm_bandwidth_ns", _microseconds, "pm_bandwidth_ns"
        ),
        # tt-metal derives it from the ideal compute time.
        _Field("fpu_util_percent", "pm_fpu_util", _number, "pm_compute_ns"),
    ),
    DetailGroup.NOC: (
        _Field("noc_util_percent", "noc_util", _number, filled_by=_NOC_TRACES),
        _Field(
            "multicast_noc_util_percent",
            "multicast_noc_util",
            _number,
            filled_by=_NOC_TRACES,
        ),
        _Field("dram_bw_util_percent", "dram_bw_util", _number, filled_by=_NOC_TRACES),
        _Field(
            "dram_bw_util_per_controller",
            "dram_bw_util_per_ctrl",
            _text,
            filled_by=_NOC_TRACES,
        ),
        _Field("eth_bw_util_per_core", "eth_bw_util", _text, filled_by=_NOC_TRACES),
        _Field(
            "npe_congestion_impact_percent",
            "npe_cong_impact",
            _number,
            filled_by=_NOC_TRACES,
        ),
    ),
    DetailGroup.RISCS: (
        _Field("kernel_us", "device_kernel_duration", _microseconds),
        _Field("brisc_us", "brisc_kernel_duration", _microseconds),
        _Field("ncrisc_us", "ncrisc_kernel_duration", _microseconds),
        _Field("trisc0_us", "trisc0_kernel_duration", _microseconds),
        _Field("trisc1_us", "trisc1_kernel_duration", _microseconds),
        _Field("trisc2_us", "trisc2_kernel_duration", _microseconds),
        _Field("erisc_us", "erisc_kernel_duration", _microseconds),
        _Field(
            "compute_cb_wait_front_us", "device_compute_cb_wait_front", _microseconds
        ),
        _Field(
            "compute_cb_reserve_back_us",
            "device_compute_cb_reserve_back",
            _microseconds,
        ),
    ),
    DetailGroup.CORES: (
        _Field("available_cores", "available_cores", _count),
        _Field(
            "first_to_last_start_us", "device_kernel_first_to_last_start", _microseconds
        ),
        _Field("per_core_min_us", "device_kernel_duration_per_core_min", _microseconds),
        _Field("per_core_max_us", "device_kernel_duration_per_core_max", _microseconds),
        _Field("per_core_avg_us", "device_kernel_duration_per_core_avg", _microseconds),
    ),
    DetailGroup.DISPATCH: (
        _Field("op_to_op_gap_us", "op_to_op_gap", _number),
        _Field(
            "dispatch_cq_cmd_op_us",
            "dispatch_total_cq_cmd_op_time",
            _microseconds,
            filled_by=_DISPATCH_CORES,
        ),
        _Field(
            "dispatch_go_send_wait_us",
            "dispatch_go_send_wait_time",
            _microseconds,
            filled_by=_DISPATCH_CORES,
        ),
        _Field("metal_trace_id", "metal_trace_id", _count, filled_by=_TRACED),
        _Field(
            "metal_trace_replay_session_id",
            "metal_trace_replay_session_id",
            _count,
            filled_by=_TRACED,
        ),
    ),
    DetailGroup.CACHE: (
        _Field("program_hash", "hash", _text),
        _Field("program_cache_hit", "cache_hit", _flag),
        _Field("global_call_count", "global_call_count", _count),
    ),
    DetailGroup.KERNELS: (
        _Field("compute_kernels", "compute_kernel_source", _listed),
        _Field("compute_kernel_hashes", "compute_kernel_hash", _listed),
        _Field("data_movement_kernels", "data_movement_kernel_source", _listed),
        _Field("data_movement_kernel_hashes", "data_movement_kernel_hash", _listed),
    ),
    DetailGroup.ADVICE: (_Field("advice", "advice", _advice),),
}

_NOT_A_COLUMN = "not among this report's columns, so no capture option fills it here"

DETAIL_NOTE = (
    "Detail fields come from the same merged row as the rest of it: on a multi-device "
    "report, the slowest device's row, except for an all-gather, reduce-scatter or "
    "all-reduce, where tt-perf-report averages the device time and keeps the first "
    "device's row for everything else, so kernel_us there is one device's. Times are "
    "microseconds. The perf model's figures are null where tt-metal left its 1 ns "
    "placeholder, and math_fidelity is null for an op that has none. A field no row "
    "of the whole report carries, whatever range was read, is left out of the rows "
    "and named in empty_in_report with what would fill it."
)


def parse_include(include: object) -> Tuple[DetailGroup, ...]:
    """The groups asked for, in a stable order, or a refusal naming the ones that exist."""
    if include is None:
        return ()
    known = ", ".join(group.value for group in DetailGroup)
    if not isinstance(include, list):
        raise ValueError(f"include must be a list of group names: {known}")
    values = {group.value for group in DetailGroup}
    unknown = [
        name for name in include if not isinstance(name, str) or name not in values
    ]
    if unknown:
        # Cut short, as a signpost name is: the refusal repeats it.
        named = repr(unknown[0])[:40]
        raise ValueError(f"unknown include group {named}; expected some of {known}")
    return tuple(group for group in DetailGroup if group.value in include)


def _fields_of(groups: Iterable[DetailGroup]) -> Iterable[_Field]:
    for group in groups:
        yield from _FIELDS[group]


# The generator reads a blank cell in these as None, as it does a missing column.
_HEADER_COLUMNS = {
    "program_hash": PROGRAM_HASH_COLUMN,
    "program_cache_hit": PROGRAM_CACHE_HIT_COLUMN,
}

# Field name to whether its column is missing from every row, for the fields no row
# carries a value in: a missing column is the report's, an empty one the capture's.
EmptyFields = Dict[str, bool]


def detail_fields(
    row: Dict, groups: Sequence[DetailGroup], empty: Optional[EmptyFields] = None
) -> Dict[str, object]:
    """The groups' fields for one row, less the ones `empty` says no row carries."""
    return {
        field.name: field.value(row)
        for field in _fields_of(groups)
        if field.name not in (empty or {})
    }


def empty_fields(
    rows: Iterable[Dict], header: AbstractSet[str] = frozenset()
) -> EmptyFields:
    """Every detail field that no row carries a value for, across all groups.

    `header` is the source CSV's, for the fields whose rows can't show a column is there.
    """
    pending = {field.name: field for field in _fields_of(DetailGroup)}
    columned = {name for name, column in _HEADER_COLUMNS.items() if column in header}
    for row in rows:
        for name, field in list(pending.items()):
            if row.get(field.column) is not None:
                columned.add(name)
            if field.value(row) is not None:
                del pending[name]
        if not pending:
            break
    return {name: name not in columned for name in pending}


def empty_in_report(
    empty: EmptyFields, groups: Sequence[DetailGroup]
) -> Dict[str, str]:
    """The included fields `empty_fields` found, each with what would fill it."""
    return {
        field.name: _NOT_A_COLUMN if empty[field.name] else field.fill_hint
        for field in _fields_of(groups)
        if field.name in empty
    }


def summary(groups: Sequence[DetailGroup], empty: EmptyFields) -> Dict[str, object]:
    """What an answer with detail fields says about them."""
    if not groups:
        return {}
    return {
        "included": [group.value for group in groups],
        "empty_in_report": empty_in_report(empty, groups),
        "detail_note": DETAIL_NOTE,
    }


__all__ = [
    "DETAIL_NOTE",
    "DetailGroup",
    "EmptyFields",
    "detail_fields",
    "empty_fields",
    "empty_in_report",
    "parse_include",
    "summary",
]
