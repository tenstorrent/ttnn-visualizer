# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""`op_configurations` (#2156): the distinct argument combinations each operation ran with,
grouped as tt-metal's model tracer groups the calls behind its sweeps.

The tracer (`model_tracer/generic_ops_tracer.py`) compares cleaned JSON arguments. A memory
report keeps each argument as the text of its repr, so the tracer's rules are applied to that
text, with the ones only text needs: a tensor's repr carries its id, its device and, in older
captures, a preview of its data, none of which the tracer's JSON holds. The rules restate the
tracer at tt-metal `4bf156f6ea` (2026-10-30).
"""

import hashlib
import json
import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from typing import Dict, List, Mapping, NamedTuple, Optional, Tuple

from ttnn_visualizer.agent.bounds import (
    CUT_DIGEST_CHARS,
    MAX_LIMIT,
    bounded,
    cut_text,
    shown_in_text,
)
from ttnn_visualizer.agent.operations import RankScope, caveat_field, scoped
from ttnn_visualizer.agent.tools import share_percent
from ttnn_visualizer.queries import DatabaseQueries

# tt-metal's `get_excluded_operations`: data movement, memory management and examples the
# tracer never records, so no sweep covers them.
TRACER_EXCLUDED_OPERATIONS = frozenset(
    {
        "ttnn.allocate_tensor_on_device",
        "ttnn.deallocate",
        "ttnn.move",
        "ttnn.reallocate",
        "ttnn.copy_host_to_device_tensor",
        "ttnn.copy_device_to_host_tensor",
        "ttnn.to_device",
        "ttnn.to_dtype",
        "ttnn.to_layout",
        "ttnn.to_memory_config",
        "ttnn.to_torch",
        "ttnn.from_device",
        "ttnn.from_torch",
        "ttnn.view",
        "ttnn.dump_tensor",
        "ttnn.load_tensor",
        "ttnn.as_tensor",
        "ttnn.unary_chain",
        "ttnn.pearson_correlation_coefficient",
        "ttnn.dram_prefetcher",
        "ttnn.complex_tensor",
        "ttnn.prim.binary",
        "ttnn.prim.example",
        "ttnn.prim.example_multiple_return",
        "ttnn.composite_example",
        "ttnn.composite_example_multiple_return",
    }
)
# tt-metal's `get_excluded_arg_keys`: runtime handles that differ from run to run.
TRACER_EXCLUDED_ARGUMENTS = frozenset(
    {"multi_device_global_semaphore", "barrier_semaphore"}
)
# The tracer records `ttnn` operations only, and of those only the ones its sweep list
# (`Allops.txt`) names; that list moves with tt-metal's ops, so it is not restated here.
TRACED_PREFIX = "ttnn."

# The tracer's `_strip_object_addresses`.
_OBJECT_ADDRESS = re.compile(r" at 0x[0-9a-fA-F]+")
# `_normalize_for_hash` drops an unset `allowed_worker_cores`, which older ttnn lacks.
_UNSET_WORKER_CORES = re.compile(r",\s*allowed_worker_cores=std::nullopt")
_TENSOR_OPENING = "ttnn.Tensor("
_SHAPE = "shape"
_TENSOR_RUNTIME_FIELDS = re.compile(
    r", (?:tensor_id|device_id)=\d+|, is_allocated=(?:True|False)"
)
# A tensor spread over devices is printed once per device, each led by its id: as
# `device_id: N, ` now, and as `device_id:N` on a line of its own in older captures.
_DEVICE_PREFIX = re.compile(r"device_id: ?\d+(?:, |\n)")

# A listing shows each configuration's first arguments, cut past a tensor's buffer type (199 at
# most locally, 218 for 6-D); a worst case JSON need not escape stays inside the answer budget.
MAX_LISTED_CONFIGURATIONS = 20
MAX_LISTED_ARGUMENTS = 8
LISTED_VALUE_CHARS = 224
# One configuration asked for by its digest: real captures record at most 21 arguments,
# and a sharded memory config runs to about 800 characters.
MAX_DETAIL_ARGUMENTS = 32
DETAIL_VALUE_CHARS = 1500
MAX_ARGUMENT_NAME_CHARS = 48
MAX_OP_NAME_CHARS = 100
MAX_LISTED_OPERATION_IDS = 5
MAX_LISTED_OPS = 20
MAX_LISTED_LEFT_OUT = 10

_DIGEST = re.compile(rf"[0-9a-f]{{{CUT_DIGEST_CHARS}}}")

GROUPING = (
    "calls grouped as tt-metal's model tracer groups them for its sweeps: by operation "
    "name, with :: read as ., and by every argument's text, compared by name; the "
    "tracer's semaphore arguments dropped, and object addresses, an unset "
    "allowed_worker_cores, and a tensor's id, device id, is_allocated and data preview "
    "removed from the text"
)
NOTE = (
    "config_digest names a configuration's grouped text, so the same configuration "
    "written the same way in another capture has the same digest; it is not the model "
    "tracer's config_hash, which hashes its JSON. operation_ids are memory report "
    "database ids, for operation_provenance and operation_detail. left_out counts the "
    "calls of the operations the tracer excludes and of names outside ttnn. The tracer's "
    "sweep list is not applied, so a listed operation may have no sweep at all."
)
MEMORY_CONFIG_CAVEAT = (
    "This capture writes tensors without their memory config, so calls that differ "
    "only in a tensor's memory config share a configuration."
)

Argument = Tuple[str, Optional[str]]


@dataclass(frozen=True)
class Configuration:
    op: str
    arguments: Tuple[Argument, ...]
    # Ascending.
    operation_ids: Tuple[int, ...]
    digest: str

    @property
    def calls(self) -> int:
        return len(self.operation_ids)


@dataclass(frozen=True)
class Configurations:
    """One rank's configurations in first-call order, and the calls the tracer leaves out."""

    configurations: Tuple[Configuration, ...]
    left_out: Mapping[str, int]
    tensors_without_memory_config: bool


class DeviceTime(NamedTuple):
    """Device time per operation from a linked performance report."""

    by_operation_id: Mapping[int, float]
    report_total: float
    unit: str
    projection: Mapping[str, object]
    caveat: Optional[str] = None


def normalised_op_name(name: Optional[str]) -> str:
    """The tracer's `normalize_op_name`."""
    return (name or "").replace("::", ".")


def is_traced(op: str) -> bool:
    return op.startswith(TRACED_PREFIX) and op not in TRACER_EXCLUDED_OPERATIONS


def _without_previews(text: str) -> str:
    """Older captures print a tensor's data ahead of its shape; no '=' occurs in the data,
    so a tensor's preview runs to the `shape=` that its first '=' belongs to."""
    # One pass, with the next '=' carried forward: the regex `ttnn\.Tensor\([^=]*?shape=`
    # rescanned to the end of the text for each opening with no '=' after it.
    pieces: List[str] = []
    position, equals = 0, -1
    while (opening := text.find(_TENSOR_OPENING, position)) >= 0:
        body = opening + len(_TENSOR_OPENING)
        if equals < body:
            equals = text.find("=", body)
            if equals < 0:
                break
        shape = equals - len(_SHAPE)
        if shape >= body and text.startswith(_SHAPE, shape):
            pieces.append(text[position:opening])
            pieces.append(f"{_TENSOR_OPENING}{_SHAPE}=")
            position = equals + 1
        else:
            pieces.append(text[position:body])
            position = body
    pieces.append(text[position:])
    return "".join(pieces)


def normalised_value(value: Optional[object]) -> Optional[str]:
    if value is None:
        return None
    text = _OBJECT_ADDRESS.sub("", str(value))
    text = _UNSET_WORKER_CORES.sub("", text)
    text = _without_previews(text)
    text = _TENSOR_RUNTIME_FIELDS.sub("", text)
    return _DEVICE_PREFIX.sub("", text)


def _argument_order(argument: Argument) -> Tuple[object, ...]:
    """Positional arguments first, in position order, then keywords by name."""
    name, value = argument
    # By length then text rather than `int`, which refuses past 4,300 digits.
    position = (0, len(name), name) if name.isdigit() else (1, 0, name)
    return (*position, value is None, value or "")


def configuration_digest(op: str, arguments: Tuple[Argument, ...]) -> str:
    text = json.dumps([op, arguments], ensure_ascii=False, separators=(",", ":"))
    whole = hashlib.sha256(text.encode("utf-8", "surrogatepass")).hexdigest()
    return whole[:CUT_DIGEST_CHARS]


def _lacks_memory_config(value: Optional[str]) -> bool:
    return (
        value is not None
        and "ttnn.Tensor(shape=" in value
        and "memory_config=" not in value
    )


def read_configurations(queries: DatabaseQueries, scope: RankScope) -> Configurations:
    """Every call at `scope`'s rank, grouped."""
    arguments: Dict[int, List[Argument]] = defaultdict(list)
    for argument in queries.query_operation_arguments(
        filters=scoped(queries, "operation_arguments", scope)
    ):
        if argument.name not in TRACER_EXCLUDED_ARGUMENTS:
            arguments[argument.operation_id].append(
                (argument.name or "", normalised_value(argument.value))
            )

    grouped: Dict[Tuple[str, Tuple[Argument, ...]], List[int]] = {}
    left_out: Counter = Counter()
    for operation in queries.query_operations(
        filters=scoped(queries, "operations", scope)
    ):
        op = normalised_op_name(operation.name)
        if not is_traced(op):
            left_out[op] += 1
            continue
        called_with = tuple(
            sorted(arguments.get(operation.operation_id, ()), key=_argument_order)
        )
        grouped.setdefault((op, called_with), []).append(operation.operation_id)

    configurations = tuple(
        Configuration(
            op=op,
            arguments=called_with,
            operation_ids=tuple(sorted(operation_ids)),
            digest=configuration_digest(op, called_with),
        )
        for (op, called_with), operation_ids in grouped.items()
    )
    return Configurations(
        configurations=configurations,
        left_out=dict(left_out),
        tensors_without_memory_config=any(
            _lacks_memory_config(value)
            for configuration in configurations
            for _, value in configuration.arguments
        ),
    )


class _Timed(NamedTuple):
    configuration: Configuration
    device_time: Optional[float]
    untimed_calls: int


def _timed(configuration: Configuration, device_time: Optional[DeviceTime]) -> _Timed:
    if device_time is None:
        return _Timed(configuration, None, 0)
    times = [
        device_time.by_operation_id[operation_id]
        for operation_id in configuration.operation_ids
        if operation_id in device_time.by_operation_id
    ]
    return _Timed(
        configuration,
        sum(times) if times else None,
        configuration.calls - len(times),
    )


def _ranking(timed: _Timed) -> Tuple[object, ...]:
    configuration = timed.configuration
    return (
        timed.device_time is None,
        -(timed.device_time or 0.0),
        -configuration.calls,
        configuration.op,
        configuration.operation_ids[0],
    )


def _device_time_fields(
    total: Optional[float], untimed_calls: int, device_time: Optional[DeviceTime]
) -> Dict[str, object]:
    if device_time is None:
        return {}
    return {
        "device_time": round(total, 3) if total is not None else None,
        "device_time_share_percent": share_percent(total, device_time.report_total),
        "untimed_calls": untimed_calls,
    }


def _argument(name: str, value: Optional[str], value_chars: int) -> Dict[str, object]:
    entry = cut_text("name", name, MAX_ARGUMENT_NAME_CHARS)
    if value is None:
        return {**entry, "value": None, "recorded": False}
    return {**entry, **cut_text("value", value, value_chars)}


def _arguments(
    configuration: Configuration, count: int, value_chars: int
) -> List[Dict[str, object]]:
    return [
        _argument(name, value, value_chars)
        for name, value in configuration.arguments[:count]
    ]


def _op_rows(timed: List[_Timed]) -> List[Dict[str, object]]:
    """Calls and configurations per operation, ranked as the configurations are."""
    calls: Counter = Counter()
    configuration_counts: Counter = Counter()
    device_times: Dict[str, float] = {}
    first_ids: Dict[str, int] = {}
    for entry in timed:
        op = entry.configuration.op
        calls[op] += entry.configuration.calls
        configuration_counts[op] += 1
        first_ids[op] = min(
            first_ids.get(op, entry.configuration.operation_ids[0]),
            entry.configuration.operation_ids[0],
        )
        if entry.device_time is not None:
            device_times[op] = device_times.get(op, 0.0) + entry.device_time
    ranked = sorted(
        calls,
        key=lambda op: (
            op not in device_times,
            -device_times.get(op, 0.0),
            -calls[op],
            op,
            first_ids[op],
        ),
    )
    timed_any = any(entry.device_time is not None for entry in timed)
    rows = []
    for op in ranked[:MAX_LISTED_OPS]:
        row: Dict[str, object] = {
            **cut_text("op", op, MAX_OP_NAME_CHARS, digest=True),
            "calls": calls[op],
            "configurations": configuration_counts[op],
        }
        if timed_any:
            row["device_time"] = (
                round(device_times[op], 3) if op in device_times else None
            )
        rows.append(row)
    return rows


def _parsed_digest(config_digest_text: str) -> str:
    wanted = config_digest_text.strip().lower()
    if _DIGEST.fullmatch(wanted) is None:
        raise ValueError(
            f"config_digest must be the {CUT_DIGEST_CHARS} hexadecimal digits a "
            f"configuration listing gives, not {shown_in_text(repr(config_digest_text), 64)}"
        )
    return wanted


def _untimed_caveat(untimed_calls: int, calls: int, whose: str) -> str:
    return (
        f"{untimed_calls} of {whose} {calls} calls launched no performance row with a "
        "device time, so device_time leaves them out; untimed_calls counts them."
    )


def answer(
    handle: str,
    read: Configurations,
    scope: RankScope,
    device_time: Optional[DeviceTime],
    operation_link: Dict[str, object],
    name_contains: Optional[str] = None,
    config_digest: Optional[str] = None,
    limit: Optional[int] = None,
) -> Dict[str, object]:
    """A ranked listing of the configurations, or one configuration by its digest."""
    # A name_contains that is not a string fails here instead of being refused (#2347).
    needle = normalised_op_name(name_contains).strip().lower()
    timed = sorted(
        (
            _timed(configuration, device_time)
            for configuration in read.configurations
            if needle in configuration.op.lower()
        ),
        key=_ranking,
    )
    caveats: List[str] = []
    if read.tensors_without_memory_config:
        caveats.append(MEMORY_CONFIG_CAVEAT)
    if device_time is not None and device_time.caveat:
        caveats.append(device_time.caveat)
    common: Dict[str, object] = {"grouping": GROUPING}
    if device_time is not None:
        common["projection"] = dict(device_time.projection)
        common["device_time_unit"] = device_time.unit
        common["report_device_time_total"] = round(device_time.report_total, 3)
    if config_digest is not None:
        return _one(
            handle,
            timed,
            _parsed_digest(config_digest),
            bool(needle),
            device_time,
            caveats,
            common,
            scope,
            operation_link,
        )

    calls = sum(entry.configuration.calls for entry in timed)
    untimed_calls = sum(entry.untimed_calls for entry in timed)
    if untimed_calls:
        caveats.append(_untimed_caveat(untimed_calls, calls, "these"))
    left_out = sorted(
        ((op, count) for op, count in read.left_out.items() if needle in op.lower()),
        key=lambda pair: (-pair[1], pair[0]),
    )
    configurations = [
        {
            **cut_text("op", entry.configuration.op, MAX_OP_NAME_CHARS, digest=True),
            "calls": entry.configuration.calls,
            "config_digest": entry.configuration.digest,
            "operation_ids": list(
                entry.configuration.operation_ids[:MAX_LISTED_OPERATION_IDS]
            ),
            "argument_count": len(entry.configuration.arguments),
            "arguments": _arguments(
                entry.configuration, MAX_LISTED_ARGUMENTS, LISTED_VALUE_CHARS
            ),
            **_device_time_fields(entry.device_time, entry.untimed_calls, device_time),
        }
        for entry in timed[: bounded(limit, MAX_LISTED_CONFIGURATIONS)]
    ]
    return {
        "handle": handle,
        **cut_text("name_contains", name_contains or None, MAX_OP_NAME_CHARS),
        "calls": calls,
        "configuration_count": len(timed),
        "op_count": len({entry.configuration.op for entry in timed}),
        "returned": len(configurations),
        "configurations": configurations,
        "ops": _op_rows(timed),
        "left_out_calls": sum(count for _, count in left_out),
        "left_out_op_count": len(left_out),
        "left_out": [
            {**cut_text("op", op, MAX_OP_NAME_CHARS, digest=True), "calls": count}
            for op, count in left_out[:MAX_LISTED_LEFT_OUT]
        ],
        **common,
        "note": NOTE,
        **scope.as_response(),
        **caveat_field(scope, *caveats),
        "operation_link": operation_link,
    }


def _one(
    handle: str,
    timed: List[_Timed],
    wanted: str,
    filtered: bool,
    device_time: Optional[DeviceTime],
    caveats: List[str],
    common: Dict[str, object],
    scope: RankScope,
    operation_link: Dict[str, object],
) -> Dict[str, object]:
    """One configuration, every argument at length, with up to MAX_LIMIT of its calls."""
    found = [entry for entry in timed if entry.configuration.digest == wanted]
    if not found:
        raise ValueError(
            f"no configuration with config_digest {wanted}"
            + (" among operations matching name_contains" if filtered else "")
            + "; a listing gives each configuration's digest"
        )
    entry = found[0]
    configuration = entry.configuration
    if entry.untimed_calls:
        caveats.append(_untimed_caveat(entry.untimed_calls, configuration.calls, "its"))
    if len(found) > 1:
        caveats.append(
            f"{len(found)} configurations share this digest; this is the first."
        )
    return {
        "handle": handle,
        "config_digest": configuration.digest,
        **cut_text("op", configuration.op, MAX_OP_NAME_CHARS, digest=True),
        "calls": configuration.calls,
        "operation_ids": list(configuration.operation_ids[:MAX_LIMIT]),
        "argument_count": len(configuration.arguments),
        "arguments": _arguments(
            configuration, MAX_DETAIL_ARGUMENTS, DETAIL_VALUE_CHARS
        ),
        **_device_time_fields(entry.device_time, entry.untimed_calls, device_time),
        **common,
        **scope.as_response(),
        **caveat_field(scope, *caveats),
        "operation_link": operation_link,
    }


__all__ = [
    "Configuration",
    "Configurations",
    "DeviceTime",
    "GROUPING",
    "MAX_DETAIL_ARGUMENTS",
    "MAX_LISTED_ARGUMENTS",
    "MAX_LISTED_CONFIGURATIONS",
    "TRACER_EXCLUDED_ARGUMENTS",
    "TRACER_EXCLUDED_OPERATIONS",
    "answer",
    "configuration_digest",
    "is_traced",
    "normalised_op_name",
    "normalised_value",
    "read_configurations",
]
