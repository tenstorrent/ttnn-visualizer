# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""`op_configurations` (#2156): the distinct argument combinations each operation ran with,
grouped as tt-metal's model tracer groups the calls behind its sweeps.

The tracer (`model_tracer/generic_ops_tracer.py`) compares cleaned JSON arguments. A memory
report keeps each argument as the text of its repr, so the tracer's rules are applied to that
text, with the ones only text needs: a tensor's repr carries its id, its device and, in older
captures, a preview of its data, none of which the tracer's JSON holds. The rules restate the
tracer at tt-metal `TRACER_REVISION`.
"""

import json
import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from functools import cached_property
from typing import Dict, List, Mapping, NamedTuple, Optional, Tuple

from ttnn_visualizer.agent.bounds import (
    CUT_DIGEST_CHARS,
    MAX_LIMIT,
    MAX_OPERATION_NAME_CHARS,
    bounded,
    cut_operation_name,
    cut_text,
    echoed,
    parsed_offset,
    short_digest,
)
from ttnn_visualizer.agent.operations import RankScope, caveat_field, scoped
from ttnn_visualizer.agent.tools import device_time_header, share_percent
from ttnn_visualizer.queries import DatabaseQueries

# The tt-metal commit (2026-10-30) the tracer's rules below restate; a parity test holds
# the docs to it.
TRACER_REVISION = "4bf156f6ea"
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
# Any other semaphore prints as an object at an address, which the tracer strips too.
TRACER_EXCLUDED_ARGUMENTS = frozenset(
    {"multi_device_global_semaphore", "barrier_semaphore"}
)
# The tracer records `ttnn` operations only, and of those only the ones its sweep list
# (`Allops.txt`) names; that list moves with tt-metal's ops, so it is not restated here.
_TRACED_PREFIX = "ttnn."

# The tracer's `_strip_object_addresses`.
_OBJECT_ADDRESS = re.compile(r" at 0x[0-9a-fA-F]+")
# `_normalize_for_hash` drops an unset `allowed_worker_cores`, which older ttnn lacks.
_UNSET_WORKER_CORES = re.compile(r",\s*allowed_worker_cores=std::nullopt")
_TENSOR_OPENING = "ttnn.Tensor("
_SHAPE = "shape"
_PARENTHESIS = re.compile(r"[()]")
# Removed inside a tensor's own repr only, so another argument's `device_id=` is kept.
_TENSOR_RUNTIME_FIELDS = re.compile(
    r", (?:tensor_id|device_id)=\d+|, is_allocated=(?:True|False)"
)
# A tensor spread over devices is printed once per device, each copy led by its id:
# `device_id: N, MeshCoordinate(...)` now, `device_id:N` on its own line in older ttnn.
# A coordinate holds no '(', so each lookahead stops by the next prefix's: a crafted
# line of prefixes reads in linear time.
_DEVICE_PREFIX = re.compile(
    r"device_id: ?\d+(?:, |\n)(?=(?:MeshCoordinate\([^()\n]*\)\n)?ttnn\.Tensor\()"
)

# A listing shows each configuration's first arguments, cut past a tensor's buffer type (199 at
# most locally, 218 for 6-D); escaped text can pass the answer budget, as for every tool (#2298).
MAX_LISTED_CONFIGURATIONS = 20
MAX_LISTED_ARGUMENTS = 8
LISTED_VALUE_CHARS = 224
# One configuration asked for by its digest: real captures record at most 21 arguments,
# and a sharded memory config runs to about 800 characters.
MAX_DETAIL_ARGUMENTS = 32
DETAIL_VALUE_CHARS = 1500
MAX_ARGUMENT_NAME_CHARS = 48
MAX_LISTED_OPERATION_IDS = 5
MAX_LISTED_OPS = 20
MAX_LISTED_LEFT_OUT = 10
# A sanity bound on the argument names and values a read streams, not a memory guard: rows
# cost more than their text. The largest local total is 53.9 million characters.
MAX_ARGUMENT_CHARS = 1 << 30

_DIGEST = re.compile(rf"[0-9a-f]{{{CUT_DIGEST_CHARS}}}")

# The tracer's rules as the tool description and every answer state them, written once so
# a rule moved with `TRACER_REVISION` cannot reach one and miss the other.
REMOVED_FROM_TEXT = (
    "object addresses, an unset allowed_worker_cores, and a tensor's id, device id, "
    "is_allocated and data preview"
)
GROUPING = (
    "calls grouped as tt-metal's model tracer groups them for its sweeps: by operation "
    "name, with :: read as ., and by every argument's text, compared by name; the "
    f"tracer's semaphore arguments dropped, and {REMOVED_FROM_TEXT} removed from "
    "the text"
)
LEFT_OUT_RULE = (
    "left_out counts the calls of the operations the tracer excludes, such as data "
    "movement, deallocate and from_torch, and of names outside ttnn."
)
DIGEST_RULE = (
    "config_digest names a configuration's grouped text, so the same configuration "
    "written the same way in another capture has the same digest; it is not the model "
    "tracer's config_hash, which hashes its JSON."
)
SWEEP_LIST_RULE = (
    "The tracer's sweep list is not applied, so a listed operation may have no sweep "
    "at all."
)
MACHINE_RULE = (
    "The tracer also tells configurations apart by the machine and mesh they ran on; "
    "load_report gives this capture's architecture and device count."
)
TRACER_RULES = (LEFT_OUT_RULE, DIGEST_RULE, SWEEP_LIST_RULE, MACHINE_RULE)
PAGING = (
    "A listing is a page: pass its next_offset as offset for the next, so every "
    "configuration and its digest can be reached."
)
NOTE = (
    f"{DIGEST_RULE} operation_ids are memory report database ids, for "
    f"operation_provenance and operation_detail. {LEFT_OUT_RULE} {SWEEP_LIST_RULE} "
    f"{MACHINE_RULE} {PAGING}"
)
MEMORY_CONFIG_CAVEAT = (
    "This capture writes tensors without their memory config, so calls that differ "
    "only in a tensor's memory config share a configuration."
)

Argument = Tuple[str, Optional[str]]
# An op and every argument it was called with: what one configuration's calls share.
_CalledWith = Tuple[str, Tuple[Argument, ...]]


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

    @cached_property
    def by_digest(self) -> Mapping[str, Tuple[Configuration, ...]]:
        """Each digest's configurations in first-call order, so a digest is looked up."""
        by_digest: Dict[str, List[Configuration]] = defaultdict(list)
        for configuration in self.configurations:
            by_digest[configuration.digest].append(configuration)
        return {digest: tuple(found) for digest, found in by_digest.items()}


class DeviceTime(NamedTuple):
    """Device time per operation from a linked performance report."""

    by_operation_id: Mapping[int, float]
    report_total: float
    caveat: Optional[str] = None


def normalised_op_name(name: Optional[str]) -> str:
    """The tracer's `normalize_op_name`."""
    return (name or "").replace("::", ".")


def is_traced(op: str) -> bool:
    return op.startswith(_TRACED_PREFIX) and op not in TRACER_EXCLUDED_OPERATIONS


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


def _tensor_end(text: str, body: int) -> int:
    """Past the `)` closing the tensor whose fields start at `body`, else the end."""
    depth = 1
    for parenthesis in _PARENTHESIS.finditer(text, body):
        depth += 1 if parenthesis.group() == "(" else -1
        if depth == 0:
            return parenthesis.end()
    return len(text)


def _without_runtime_fields(text: str) -> str:
    pieces: List[str] = []
    position = 0
    while (opening := text.find(_TENSOR_OPENING, position)) >= 0:
        end = _tensor_end(text, opening + len(_TENSOR_OPENING))
        pieces.append(text[position:opening])
        pieces.append(_TENSOR_RUNTIME_FIELDS.sub("", text[opening:end]))
        position = end
    pieces.append(text[position:])
    return "".join(pieces)


def normalised_value(value: Optional[object]) -> Optional[str]:
    if value is None:
        return None
    text = _OBJECT_ADDRESS.sub("", str(value))
    text = _UNSET_WORKER_CORES.sub("", text)
    text = _without_previews(text)
    text = _without_runtime_fields(text)
    return _DEVICE_PREFIX.sub("", text)


def _argument_order(argument: Argument) -> Tuple[object, ...]:
    """Positional arguments first, in position order, then keywords by name."""
    name, value = argument
    # By length then text rather than `int`, which refuses past 4,300 digits.
    position = (0, len(name), name) if name.isdigit() else (1, 0, name)
    return (*position, value is None, value or "")


def configuration_digest(op: str, arguments: Tuple[Argument, ...]) -> str:
    return short_digest(
        json.dumps([op, arguments], ensure_ascii=False, separators=(",", ":"))
    )


def _lacks_memory_config(value: Optional[str]) -> bool:
    return (
        value is not None
        and "ttnn.Tensor(shape=" in value
        and "memory_config=" not in value
    )


def _as_text(name: object) -> str:
    """A name as text: a malformed report can hold a BLOB or a number in its place."""
    return "" if name is None else str(name)


def _arguments_by_operation_id(
    queries: DatabaseQueries, filters: Dict[str, object]
) -> Dict[int, List[Argument]]:
    """Each call's arguments the tracer keeps, normalised, streamed a row at a time and
    refused once they pass `MAX_ARGUMENT_CHARS`."""
    # Each text is kept once: tensors printed apart by their ids normalise alike. Caching by
    # raw text would cut the largest local first read by a sixth and double its peak.
    canonical: Dict[str, str] = {}
    arguments_by_operation_id: Dict[int, List[Argument]] = defaultdict(list)
    characters = 0
    for argument in queries.iter_operation_arguments(filters=filters):
        name = _as_text(argument.name)
        text = None if argument.value is None else str(argument.value)
        characters += len(name) + len(text or "")
        if characters > MAX_ARGUMENT_CHARS:
            raise ValueError(
                "this capture's operation arguments pass the "
                f"{MAX_ARGUMENT_CHARS:,} characters op_configurations will read"
            )
        if name in TRACER_EXCLUDED_ARGUMENTS:
            continue
        value = normalised_value(text)
        arguments_by_operation_id[argument.operation_id].append(
            (
                canonical.setdefault(name, name),
                None if value is None else canonical.setdefault(value, value),
            )
        )
    return arguments_by_operation_id


def read_configurations(queries: DatabaseQueries, scope: RankScope) -> Configurations:
    """Every call at `scope`'s rank, grouped."""
    arguments_by_operation_id = _arguments_by_operation_id(
        queries, scoped(queries, "operation_arguments", scope)
    )
    operation_ids_by_configuration: Dict[_CalledWith, List[int]] = {}
    left_out: Counter[str] = Counter()
    for operation in queries.query_operations(
        filters=scoped(queries, "operations", scope)
    ):
        op = normalised_op_name(_as_text(operation.name))
        if not is_traced(op):
            left_out[op] += 1
            continue
        called_with = tuple(
            sorted(
                arguments_by_operation_id.get(operation.operation_id, ()),
                key=_argument_order,
            )
        )
        operation_ids_by_configuration.setdefault((op, called_with), []).append(
            operation.operation_id
        )

    configurations = tuple(
        Configuration(
            op=op,
            arguments=called_with,
            operation_ids=tuple(sorted(operation_ids)),
            digest=configuration_digest(op, called_with),
        )
        for (op, called_with), operation_ids in operation_ids_by_configuration.items()
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


def _rank(
    device_time: Optional[float], calls: int, op: str, first_operation_id: int
) -> Tuple[object, ...]:
    """Most device time first and untimed last, then most calls, name and first call;
    `ops` and `configurations` both rank by it."""
    return (device_time is None, -(device_time or 0.0), -calls, op, first_operation_id)


def _ranking(timed: _Timed) -> Tuple[object, ...]:
    configuration = timed.configuration
    return _rank(
        timed.device_time,
        configuration.calls,
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


def _configuration_fields(
    entry: _Timed,
    device_time: Optional[DeviceTime],
    *,
    ids: int,
    arguments: int,
    value_chars: int,
) -> Dict[str, object]:
    """A configuration as a listing and a digest give it; only the caps differ."""
    configuration = entry.configuration
    return {
        **cut_operation_name("op", configuration.op),
        "calls": configuration.calls,
        "config_digest": configuration.digest,
        "operation_ids": list(configuration.operation_ids[:ids]),
        "argument_count": len(configuration.arguments),
        "arguments": _arguments(configuration, arguments, value_chars),
        **_device_time_fields(entry.device_time, entry.untimed_calls, device_time),
    }


def _op_rows(
    timed: List[_Timed], device_time: Optional[DeviceTime]
) -> List[Dict[str, object]]:
    """Calls and configurations per operation, ranked as the configurations are, with
    the device time fields a configuration carries, summed."""
    calls_by_op: Counter[str] = Counter()
    configuration_count_by_op: Counter[str] = Counter()
    untimed_calls_by_op: Counter[str] = Counter()
    device_time_by_op: Dict[str, float] = {}
    first_operation_id_by_op: Dict[str, int] = {}
    for entry in timed:
        op = entry.configuration.op
        first_operation_id = entry.configuration.operation_ids[0]
        calls_by_op[op] += entry.configuration.calls
        configuration_count_by_op[op] += 1
        untimed_calls_by_op[op] += entry.untimed_calls
        first_operation_id_by_op[op] = min(
            first_operation_id_by_op.get(op, first_operation_id), first_operation_id
        )
        if entry.device_time is not None:
            device_time_by_op[op] = device_time_by_op.get(op, 0.0) + entry.device_time
    ranked = sorted(
        calls_by_op,
        key=lambda op: _rank(
            device_time_by_op.get(op),
            calls_by_op[op],
            op,
            first_operation_id_by_op[op],
        ),
    )
    return [
        {
            **cut_operation_name("op", op),
            "calls": calls_by_op[op],
            "configurations": configuration_count_by_op[op],
            **_device_time_fields(
                device_time_by_op.get(op), untimed_calls_by_op[op], device_time
            ),
        }
        for op in ranked[:MAX_LISTED_OPS]
    ]


def _parsed_digest(config_digest_text: str) -> str:
    wanted = config_digest_text.strip().lower()
    if _DIGEST.fullmatch(wanted) is None:
        raise ValueError(
            f"config_digest must be the {CUT_DIGEST_CHARS} hexadecimal digits a "
            f"configuration listing gives, not {echoed(config_digest_text)}"
        )
    return wanted


def _untimed_caveat(untimed_calls: int, calls: int, whose: str) -> str:
    return (
        f"{untimed_calls} of {whose} {calls} calls launched no performance row with a "
        "device time, so device_time leaves them out; untimed_calls counts them."
    )


def answer_configurations(
    handle: str,
    read: Configurations,
    scope: RankScope,
    device_time: Optional[DeviceTime],
    operation_link: Dict[str, object],
    name_contains: Optional[str] = None,
    config_digest: Optional[str] = None,
    limit: Optional[int] = None,
    offset: Optional[int] = None,
) -> Dict[str, object]:
    """A ranked listing of the configurations from `offset` on, or one configuration by
    its digest."""
    # A name_contains or config_digest that is not a string fails instead of being
    # refused (#2347).
    needle = normalised_op_name(name_contains).strip().lower()
    caveats: List[str] = []
    if read.tensors_without_memory_config:
        caveats.append(MEMORY_CONFIG_CAVEAT)
    if device_time is not None and device_time.caveat:
        caveats.append(device_time.caveat)
    if config_digest is None:
        matching = [
            configuration
            for configuration in read.configurations
            if needle in configuration.op.lower()
        ]
        body = _listing(
            read, matching, needle, device_time, caveats, name_contains, limit, offset
        )
    else:
        body = _one(read, _parsed_digest(config_digest), needle, device_time, caveats)
    return {
        "handle": handle,
        **body,
        "grouping": GROUPING,
        **(
            device_time_header(device_time.report_total)
            if device_time is not None
            else {}
        ),
        **scope.as_response(),
        **caveat_field(scope, *caveats),
        "operation_link": operation_link,
    }


def _listing(
    read: Configurations,
    matching: List[Configuration],
    needle: str,
    device_time: Optional[DeviceTime],
    caveats: List[str],
    name_contains: Optional[str],
    limit: Optional[int],
    offset: Optional[int],
) -> Dict[str, object]:
    """The configurations ranked, a page from `offset` listed, adding the listing's
    caveats to `caveats`."""
    timed = sorted(
        (_timed(configuration, device_time) for configuration in matching),
        key=_ranking,
    )
    calls = sum(entry.configuration.calls for entry in timed)
    untimed_calls = sum(entry.untimed_calls for entry in timed)
    if untimed_calls:
        caveats.append(_untimed_caveat(untimed_calls, calls, "these"))
    left_out = sorted(
        ((op, count) for op, count in read.left_out.items() if needle in op.lower()),
        key=lambda pair: (-pair[1], pair[0]),
    )
    # An offset past the end starts at the end, so the page is empty and says where.
    start = min(parsed_offset(offset), len(timed))
    listed = timed[start : start + bounded(limit, MAX_LISTED_CONFIGURATIONS)]
    end = start + len(listed)
    return {
        **cut_text("name_contains", name_contains or None, MAX_OPERATION_NAME_CHARS),
        "calls": calls,
        "configuration_count": len(timed),
        "op_count": len({entry.configuration.op for entry in timed}),
        "offset": start,
        "returned": len(listed),
        "next_offset": end if end < len(timed) else None,
        "configurations": [
            _configuration_fields(
                entry,
                device_time,
                ids=MAX_LISTED_OPERATION_IDS,
                arguments=MAX_LISTED_ARGUMENTS,
                value_chars=LISTED_VALUE_CHARS,
            )
            for entry in listed
        ],
        "ops": _op_rows(timed, device_time),
        "left_out_calls": sum(count for _, count in left_out),
        "left_out_op_count": len(left_out),
        "left_out": [
            {
                **cut_operation_name("op", op),
                "calls": count,
            }
            for op, count in left_out[:MAX_LISTED_LEFT_OUT]
        ],
        "note": NOTE,
    }


def _one(
    read: Configurations,
    wanted: str,
    needle: str,
    device_time: Optional[DeviceTime],
    caveats: List[str],
) -> Dict[str, object]:
    """One configuration, cut by MAX_DETAIL_ARGUMENTS and DETAIL_VALUE_CHARS, with up to
    MAX_LIMIT of its calls, adding its caveats to `caveats`."""
    found = sorted(
        (
            _timed(configuration, device_time)
            for configuration in read.by_digest.get(wanted, ())
            if needle in configuration.op.lower()
        ),
        key=_ranking,
    )
    if not found:
        raise ValueError(
            f"no configuration with config_digest {wanted}"
            + (" among operations matching name_contains" if needle else "")
            + "; a listing gives each configuration's digest"
        )
    entry = found[0]
    if entry.untimed_calls:
        caveats.append(
            _untimed_caveat(entry.untimed_calls, entry.configuration.calls, "its")
        )
    if len(found) > 1:
        caveats.append(
            f"{len(found)} configurations share this digest; this is the first."
        )
    return _configuration_fields(
        entry,
        device_time,
        ids=MAX_LIMIT,
        arguments=MAX_DETAIL_ARGUMENTS,
        value_chars=DETAIL_VALUE_CHARS,
    )


__all__ = [
    "Argument",
    "Configuration",
    "Configurations",
    "DETAIL_VALUE_CHARS",
    "DIGEST_RULE",
    "DeviceTime",
    "GROUPING",
    "LEFT_OUT_RULE",
    "LISTED_VALUE_CHARS",
    "MACHINE_RULE",
    "MAX_ARGUMENT_CHARS",
    "MAX_ARGUMENT_NAME_CHARS",
    "MAX_DETAIL_ARGUMENTS",
    "MAX_LISTED_ARGUMENTS",
    "MAX_LISTED_CONFIGURATIONS",
    "MAX_LISTED_LEFT_OUT",
    "MAX_LISTED_OPERATION_IDS",
    "MAX_LISTED_OPS",
    "MEMORY_CONFIG_CAVEAT",
    "NOTE",
    "PAGING",
    "REMOVED_FROM_TEXT",
    "SWEEP_LIST_RULE",
    "TRACER_EXCLUDED_ARGUMENTS",
    "TRACER_EXCLUDED_OPERATIONS",
    "TRACER_REVISION",
    "TRACER_RULES",
    "answer_configurations",
    "configuration_digest",
    "is_traced",
    "normalised_op_name",
    "normalised_value",
    "read_configurations",
]
