# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""What the run allocated and what flowed between its operations.

Round one answered where the time went, from the performance CSVs. These read
the profiler report's SQLite database instead, which is the half of bring-up the
first slice could not reach: an out-of-memory failure or an unintended DRAM
spill is as common as a slow op, and no tool exposed a byte. #2012

Both round-one properties hold. Nothing here returns a table -- `buffer_pages`
alone is millions of rows on an ordinary capture -- and a number whose unit
invites the wrong reading carries the unit where it is returned.
"""

import re
import sqlite3
from collections import defaultdict
from contextlib import contextmanager
from pathlib import Path
from typing import Dict, Iterator, List, NamedTuple, Optional, Set, Tuple

from ttnn_visualizer.agent.bounds import MAX_LIMIT, bounded
from ttnn_visualizer.agent.handles import PROFILER_DB_FILE, ReportRegistry
from ttnn_visualizer.models import Buffer, BufferType, Instance
from ttnn_visualizer.queries import DatabaseQueries

# Every allocation figure derived from `buffers` is in these units, and the
# response says so wherever one appears. `max_size_per_bank` is what the column
# holds, and the HTTP serializers already re-expose it as plain `size`
# (`serializers.py:309`) -- so reading it as a device-wide byte count is one
# rename away rather than a hypothetical. It is per bank: on a local resnet50
# capture the peak L1 footprint sums to 487,424 against an `l1_bank_size` of
# 1,370,848 across 64 banks, and an agent comparing those two numbers directly
# would understate usage by the bank count.
BUFFER_SIZE_UNIT = "bytes_per_bank"

# `tensors.size` is a whole-tensor byte count -- but only where the column
# exists. Where it does not, `query_tensors` substitutes
# `b.max_size_per_bank AS size` (`queries.py:590`), which is per bank: the same
# figure as an allocation total rather than a quantity to compare against one.
# Of 86 local captures only 5 carry the column, so the fallback is the common
# case, and labelling it `bytes` told an agent the two numbers were
# incommensurable when they were the same number -- a caveat pointing the wrong
# way, which is worse than none. `report_has_tensor_size_column` decides which.
TENSOR_SIZE_UNIT = "bytes"

# The buffer types a report can hold, from the enum rather than from whatever
# strings a given capture happens to contain.
BUFFER_TYPE_NAMES = tuple(sorted(member.name for member in BufferType))


class ProfilerDatabaseMissingError(ValueError):
    """Raised when a handle has no profiler database to read."""


@contextmanager
def _profiler_db(instance: Instance) -> Iterator[DatabaseQueries]:
    """Open the report's database read-only, by path rather than by field.

    `LocalQueryRunner` treats `Instance.profiler_path` as the SQLite *file*
    (`queries.py:104`), while a handle holds the *directory* the caller named --
    the two layers mean different things by the same field. `DatabaseQueries`
    accepts a connection, so this opens one and each layer keeps its own meaning.

    Read-only because a tool surface has no business writing to a capture, and
    `mode=ro` fails closed on a path that is not a database rather than creating
    one.
    """
    if not instance.profiler_path:
        raise ProfilerDatabaseMissingError(
            "this handle was loaded without a profiler_path; memory and operation "
            "questions need the profiler report directory"
        )
    db_file = Path(instance.profiler_path, PROFILER_DB_FILE)
    if not db_file.is_file():
        raise ProfilerDatabaseMissingError(
            f"no {PROFILER_DB_FILE} in {instance.profiler_path}"
        )
    connection = sqlite3.connect(f"file:{db_file}?mode=ro", uri=True)
    try:
        with DatabaseQueries(connection=connection) as queries:
            yield queries
    finally:
        connection.close()


class RankScope(NamedTuple):
    """The rank a response was read at, carried rather than assumed.

    Ids restart at 1 per rank, so an unfiltered read of a multi-host report
    unions the ranks and collides ops that merely share an id (#1842, and #1841
    for what that looks like on screen). Defaulting to rank 0 matches what the
    app's own routes read, but it *is* a filter -- so it is named in every
    response, the way `merge_devices` is on the performance side.
    """

    multi_host: bool
    rank: Optional[int]
    # Every rank the report holds, so the guards below can tell a report that
    # merely carries the column from one with figures on more than one rank.
    ranks: Tuple[int, ...] = ()

    def as_response(self) -> Dict[str, object]:
        """The projection fields a response repeats. `ranks` is machinery."""
        return {"multi_host": self.multi_host, "rank": self.rank}


def _scoped(
    queries: DatabaseQueries, table: str, scope: RankScope, **filters: object
) -> Dict[str, object]:
    """Rank-filter one table, asking the query layer whether it can be.

    `report_has_rank_column` inspects `operations` alone (`queries.py:280`), and
    a report can carry `rank` there while an older `buffers` has none -- which is
    why `views.py` calls `merge_rank_filter` once per table rather than building
    one filter dict for all of them, and why `query_tensors` re-derives the flag
    per joined table. Applying the rank everywhere raised `no such column: rank`
    on exactly that mix.
    """
    return queries.merge_rank_filter(table, filters, scope.rank)


def _rank_scope(queries: DatabaseQueries, rank: Optional[int]) -> RankScope:
    # Coerced before the `multi_host` branch, not inside it: a non-numeric rank
    # used to pass silently on a single-host report and raise on a multi-host
    # one, so the same call was valid or not depending on the capture.
    requested: Optional[int] = None
    if rank is not None:
        try:
            requested = int(rank)
        except (TypeError, ValueError):
            raise ValueError(f"rank must be a whole number, not {rank!r}") from None
    multi_host = queries.report_has_rank_column()
    # A report with no rank column represents rank 0 only, so asking for another
    # one cannot be answered -- and returning rank-0 rows labelled `rank: null`
    # serves different data than was asked for. `views._rank_query_param`
    # answers 400 for the same request.
    if requested not in (None, 0) and not multi_host:
        raise ValueError(
            f"this report has no rank column, so it holds rank 0 only; "
            f"rank {requested} cannot be read"
        )
    ranks = tuple(queries.query_operation_ranks())
    scope = RankScope(
        multi_host=multi_host,
        rank=(0 if requested is None else requested) if multi_host else None,
        ranks=ranks,
    )
    # An empty answer at rank 9 reads as a fact about the run instead of "there is
    # no rank 9" -- the same misreading the buffer-type guard prevents.
    # `views._rank_query_param` answers 400 for this on the HTTP side.
    if requested is not None and scope.rank is not None and scope.rank not in ranks:
        raise ValueError(
            f"this report has no rank {scope.rank}; it holds "
            f"{', '.join(str(entry) for entry in ranks)}"
        )
    return scope


def _refuse_unattributable(
    queries: DatabaseQueries, scope: RankScope, *tables: str
) -> None:
    """Refuse figures that cannot be attributed to the rank the response names.

    `merge_rank_filter` no-ops for a table without a `rank` column, which is what
    keeps an older schema from raising. But when `operations` carries the column
    and the table holding the numbers does not, the rows union every rank and
    collide on `operation_id` -- while the response still says `rank: N` and
    carries a caveat claiming the figures describe that rank. That is #1842
    inside the allocation numbers, and a caveat pointing the wrong way is worse
    than none (the rule this module states at `BUFFER_SIZE_UNIT`).

    Only refused when the report genuinely holds more than one rank: a single-rank
    report cannot misattribute anything, and no local capture carries the mix at
    all -- 84 of 86 have no rank column and the other two have it on every table.
    So this is insurance against schema drift, not a live failure. #2014
    """
    if scope.rank is None or len(scope.ranks) <= 1:
        return
    unfiltered = [table for table in tables if not queries.table_has_rank_column(table)]
    if unfiltered:
        raise ValueError(
            f"this report carries `rank` on `operations` but not on "
            f"{', '.join(f'`{table}`' for table in unfiltered)}, so its rows span "
            f"ranks {', '.join(str(entry) for entry in scope.ranks)} and cannot be "
            f"attributed to rank {scope.rank}"
        )


def _buffer_type_name(value: object) -> str:
    """`buffers.buffer_type` arrives as the column's own value, not a `BufferType`.

    `_dataclass_select_clause` reads the column straight, so despite the
    annotation the value is whatever the capture stored. Both forms are common
    locally -- integers (`0`, `1`, `3`) in most reports, including every
    `SCHEMA_V*` fixture, and text (`'DRAM'`, `'L1'`) in newer ones -- so neither
    is the fallback case.
    """
    if isinstance(value, int) and not isinstance(value, bool):
        try:
            return BufferType(value).name
        except ValueError:
            return str(value)
    name = getattr(value, "name", None)
    return str(name if name is not None else value)


def _device_capacity(queries: DatabaseQueries, scope: RankScope) -> Dict[str, object]:
    """L1 geometry, so a per-bank figure can be read against something.

    The report carries no DRAM capacity at all, which is said explicitly: an
    agent handed L1 limits and silence on DRAM will otherwise assume the DRAM
    figure was checked against something.

    The geometry is one device's, and which one is named in the response rather
    than left as an assumption about them being identical.
    """
    # Rank-scoped like the figures beside it: on a multi-host report an
    # unfiltered read counts every rank's devices, which answers a different
    # question than the rest of the response.
    devices = list(queries.query_devices(filters=_scoped(queries, "devices", scope)))
    if not devices:
        return {"devices": 0, "dram_capacity": None}
    device = devices[0]
    return {
        "devices": len(devices),
        "geometry_from_device": device.device_id,
        "l1_bank_size": device.l1_bank_size,
        "l1_num_banks": device.l1_num_banks,
        "worker_l1_size": device.worker_l1_size,
        "num_compute_cores": device.num_compute_cores,
        # Zero on captures that predate the field, so it is passed through as-is
        # rather than used as a denominator here.
        "total_l1_for_tensors": device.total_l1_for_tensors,
        "dram_capacity": None,
    }


# How much of one argument value is returned. Values are mostly short -- the median
# is 6 characters -- with a tail that carries the interesting part: a `Conv2dConfig`
# or a tensor repr lands in one, and the longest locally is 844. Capped with a flag
# rather than passed through, because "the longest we have seen" is not a bound.
MAX_ARGUMENT_VALUE_CHARS = 500

# One frame of a Python traceback. Deliberately the same shape
# `src/functions/stackTraceSource.ts` reads: it takes the *first* `File "..."` and
# the first `line N`, so the call site here is the frame the operation details panel
# already shows for the same operation. Two answers to "where is this op from" that
# disagreed would be worse than one.
_TRACE_FRAME = re.compile(
    r'^[ \t]*File "(?P<file>[^"]*)", line (?P<line>\d+), in (?P<function>.*)$'
)


def _parse_frames(trace: str) -> List[Dict[str, object]]:
    """The traceback's frames, innermost first, each with the source line under it.

    Innermost first is the order the capture writes: frame 0 is the `ttnn.<op>` call
    in the model code, and the chain runs outward to the entry point. So the call
    site needs no heuristic about which frame belongs to the user -- which is the
    same reason the frontend can take the first match and stop.
    """
    lines = trace.splitlines()
    frames: List[Dict[str, object]] = []
    for index, line in enumerate(lines):
        match = _TRACE_FRAME.match(line)
        if match is None:
            continue
        # The source line the capture indents under the frame, when it wrote one.
        code = next(
            (
                candidate.strip()
                for candidate in lines[index + 1 : index + 3]
                if candidate.strip() and _TRACE_FRAME.match(candidate) is None
            ),
            None,
        )
        frames.append(
            {
                "file": match.group("file"),
                "line": int(match.group("line")),
                "function": match.group("function").strip(),
                "code": code,
            }
        )
    return frames


def _truncated(value: str) -> Dict[str, object]:
    """One argument value, capped, saying so when it was cut."""
    text = value if value is not None else ""
    if len(text) <= MAX_ARGUMENT_VALUE_CHARS:
        return {"value": text}
    return {
        "value": text[:MAX_ARGUMENT_VALUE_CHARS],
        "truncated": True,
        "full_length": len(text),
    }


def operation_provenance(
    registry: ReportRegistry,
    handle: str,
    operation_id: int,
    rank: Optional[int] = None,
) -> Dict[str, object]:
    """What an operation was called with, and where in the model code it came from.

    The other tools answer with an operation id -- `top_ops` names the costliest,
    `memory_profile` names the one holding the peak -- and nothing turned that id
    into something actionable in the code being edited. This is that step. #2021
    """
    instance = registry.get(handle)
    with _profiler_db(instance) as queries:
        scope = _rank_scope(queries, rank)
        _refuse_unattributable(queries, scope, "operations")
        wanted = int(operation_id)
        filters = _scoped(queries, "operations", scope, operation_id=wanted)

        operations = list(queries.query_operations(filters=filters))
        if not operations:
            raise ValueError(
                f"no operation {wanted} in this report"
                + (f" at rank {scope.rank}" if scope.rank is not None else "")
            )
        operation = operations[0]

        arguments = list(
            queries.query_operation_arguments(
                filters=_scoped(
                    queries, "operation_arguments", scope, operation_id=wanted
                )
            )
        )
        traces = list(
            queries.query_stack_traces(
                filters=_scoped(queries, "stack_traces", scope, operation_id=wanted)
            )
        )

    frames = _parse_frames(traces[0].stack_trace) if traces else []
    result: Dict[str, object] = {
        "handle": handle,
        "operation_id": operation.operation_id,
        "name": operation.name,
        "arguments": [
            {"name": argument.name, **_truncated(argument.value)}
            for argument in arguments[:MAX_LIMIT]
        ],
        "argument_count": len(arguments),
        "value_cap": MAX_ARGUMENT_VALUE_CHARS,
        # The innermost frame, which is the `ttnn.<op>` call in the model code. Named
        # separately from the chain because it is the answer to the question; the
        # chain is how you got there.
        "call_site": frames[0] if frames else None,
        "frames": frames[1 : MAX_LIMIT + 1],
        "frame_count": len(frames),
        **scope.as_response(),
        **_caveats(scope),
    }
    if not traces:
        # Said rather than left as a null: 8 of 86 local captures write no trace, and
        # "this operation has no recorded call site" is a fact about the capture, not
        # about the operation.
        result["call_site_note"] = (
            "This capture recorded no stack trace for this operation, so it has no "
            "call site. Older reports omit them."
        )
    return result


def find_operations(
    registry: ReportRegistry,
    handle: str,
    name_contains: Optional[str] = None,
    called_from: Optional[str] = None,
    limit: Optional[int] = None,
    rank: Optional[int] = None,
) -> Dict[str, object]:
    """Locate operations by name or by where they were called from.

    `called_from` is the inverse of `operation_provenance`, and it is how a session
    proceeds once one operation is slow: the next question is never about that
    operation alone but about every operation from the same helper. #2021
    """
    instance = registry.get(handle)
    with _profiler_db(instance) as queries:
        scope = _rank_scope(queries, rank)
        needle = (name_contains or "").strip().lower()
        origin = (called_from or "").strip().lower()

        # Matched against the whole trace rather than the call site alone: asking for
        # a helper's name should find the operations it called *through* other
        # frames too, which is the shape of a model built out of layer modules.
        from_origin: Optional[set] = None
        if origin:
            from_origin = {
                trace.operation_id
                for trace in queries.query_stack_traces(
                    filters=_scoped(queries, "stack_traces", scope)
                )
                if origin in (trace.stack_trace or "").lower()
            }

        # Only `operations`, which carries the column by definition here.
        matches = [
            operation
            for operation in queries.query_operations(
                filters=_scoped(queries, "operations", scope)
            )
            if (not needle or needle in (operation.name or "").lower())
            and (from_origin is None or operation.operation_id in from_origin)
        ]

    cap = bounded(limit)
    return {
        "handle": handle,
        "name_contains": name_contains or None,
        "called_from": called_from or None,
        "match_count": len(matches),
        "returned": min(len(matches), cap),
        "operations": [
            {
                "operation_id": operation.operation_id,
                "name": operation.name,
                "duration": operation.duration,
            }
            for operation in matches[:cap]
        ],
        # Host-side wall time for the op, not device time. The two differ, and
        # `top_ops` is the tool that answers the device question.
        "duration_unit": "host_seconds",
        **scope.as_response(),
        **_caveats(scope),
    }


def operation_detail(
    registry: ReportRegistry,
    handle: str,
    operation_id: int,
    rank: Optional[int] = None,
) -> Dict[str, object]:
    """One operation: its tensors, and what it had allocated at that point."""
    instance = registry.get(handle)
    with _profiler_db(instance) as queries:
        scope = _rank_scope(queries, rank)
        _refuse_unattributable(
            queries, scope, "buffers", "tensors", "input_tensors", "output_tensors"
        )
        wanted_operation = int(operation_id)

        operations = list(
            queries.query_operations(
                filters=_scoped(
                    queries, "operations", scope, operation_id=wanted_operation
                )
            )
        )
        if not operations:
            raise ValueError(
                f"no operation {operation_id} in this report"
                + (f" at rank {scope.rank}" if scope.rank is not None else "")
            )
        operation = operations[0]

        tensor_size_unit = (
            TENSOR_SIZE_UNIT
            if queries.report_has_tensor_size_column()
            else BUFFER_SIZE_UNIT
        )
        inputs = list(
            queries.query_input_tensors(
                filters=_scoped(
                    queries, "input_tensors", scope, operation_id=wanted_operation
                )
            )
        )
        outputs = list(
            queries.query_output_tensors(
                filters=_scoped(
                    queries, "output_tensors", scope, operation_id=wanted_operation
                )
            )
        )
        buffers = list(
            queries.query_buffers(
                filters=_scoped(
                    queries, "buffers", scope, operation_id=wanted_operation
                )
            )
        )

        # Only the tensors this operation refers to. Reading the report's whole
        # tensor table to describe a handful parses every other tensor's memory
        # config on the way past (`Tensor.__post_init__`).
        wanted_ids = sorted(
            {item.tensor_id for item in inputs} | {item.tensor_id for item in outputs}
        )
        # Short-circuited: `_query_table` and `query_tensors` both skip a
        # zero-length list, so `tensor_id=[]` drops the filter and reads the whole
        # table -- parsing every other tensor's memory config on the way past,
        # which is the cost this scoping exists to avoid. An operation with no
        # input or output rows takes that path.
        tensors = (
            {
                tensor.tensor_id: tensor
                for tensor in queries.query_tensors(
                    filters=_scoped(queries, "tensors", scope, tensor_id=wanted_ids)
                )
            }
            if wanted_ids
            else {}
        )

    def described(tensor_id: int, index: int) -> Dict[str, object]:
        tensor = tensors.get(tensor_id)
        if tensor is None:
            return {"index": index, "tensor_id": tensor_id}
        return {
            "index": index,
            "tensor_id": tensor_id,
            "shape": tensor.shape,
            "dtype": tensor.dtype,
            "layout": tensor.layout,
            # Carries `memory_layout`, so an agent can tell a sharded tensor
            # from an interleaved one -- which is exactly what decides whether
            # the per-bank figures below span every bank or a shard grid.
            "memory_config": tensor.memory_config,
            "size": tensor.size,
            "buffer_type": (
                _buffer_type_name(tensor.buffer_type)
                if tensor.buffer_type is not None
                else None
            ),
        }

    allocations: Dict[str, Dict[str, int]] = defaultdict(
        lambda: {"buffers": 0, "size": 0}
    )
    for buffer in buffers:
        entry = allocations[_buffer_type_name(buffer.buffer_type)]
        entry["buffers"] += 1
        entry["size"] += buffer.max_size_per_bank

    # An operation's arity is small, so this cap is a guard against a malformed
    # report rather than a slice an agent should expect to hit -- which is why
    # the untruncated counts are returned beside the lists.
    return {
        "handle": handle,
        "operation_id": operation.operation_id,
        "name": operation.name,
        "duration": operation.duration,
        "duration_unit": "host_seconds",
        "inputs": [
            described(item.tensor_id, item.input_index) for item in inputs[:MAX_LIMIT]
        ],
        "outputs": [
            described(item.tensor_id, item.output_index) for item in outputs[:MAX_LIMIT]
        ],
        "input_count": len(inputs),
        "output_count": len(outputs),
        "allocations": dict(sorted(allocations.items())),
        # Reported rather than asserted: these two are in different units on a
        # report that carries `tensors.size`, and in the *same* unit on one that
        # does not, where the tensor figure is the per-bank allocation itself.
        "allocation_size_unit": BUFFER_SIZE_UNIT,
        "tensor_size_unit": tensor_size_unit,
        **scope.as_response(),
        **_caveats(scope, {buffer.device_id for buffer in buffers}),
    }


def memory_profile(
    registry: ReportRegistry,
    handle: str,
    buffer_type: Optional[str] = None,
    limit: Optional[int] = None,
    rank: Optional[int] = None,
) -> Dict[str, object]:
    """Where the run's memory went, one memory type at a time.

    `buffers` holds what was live *at* each operation rather than what that
    operation allocated, so a per-operation sum is the footprint at that point
    and the largest of them is the run's peak -- which is the question an
    out-of-memory failure actually asks.

    Nothing here adds one memory type to another. `max_size_per_bank` is divided
    by the bank count of its own memory type, and those counts differ, so a
    DRAM figure plus an L1 figure is not a quantity -- it is two different
    denominators in one integer. Round one refused the same arithmetic for
    rates and core counts (`tools.ADDITIVE_METRICS`); this is that rule applied
    to allocations. The report carries no DRAM bank count at all, so one of the
    two denominators is not even knowable here.
    """
    wanted = (buffer_type or "").strip().upper() or None
    # Refused up front, the way `top_ops` refuses an unknown metric. Matching
    # free text against whatever strings the report happens to hold makes a
    # typo indistinguishable from a report that allocates none of that type.
    if wanted is not None and wanted not in BUFFER_TYPE_NAMES:
        raise ValueError(
            f"unknown buffer_type {wanted!r}; expected one of "
            f"{', '.join(BUFFER_TYPE_NAMES)}"
        )

    instance = registry.get(handle)
    with _profiler_db(instance) as queries:
        scope = _rank_scope(queries, rank)
        _refuse_unattributable(queries, scope, "buffers")
        grouped = queries.query_buffer_totals_by_operation(rank=scope.rank)
        names = {
            operation.operation_id: operation.name
            for operation in queries.query_operations(
                filters=_scoped(queries, "operations", scope)
            )
        }
        capacity = _device_capacity(queries, scope)

    # `(operation_id, buffer_type, device_id, total, count)`, already summed in
    # SQL. Devices are re-summed here rather than in the query so that adding
    # them is a visible step the caveat can describe.
    present = sorted({_buffer_type_name(row[1]) for row in grouped})
    if wanted is not None and wanted not in present and present:
        raise ValueError(
            f"no {wanted} buffers in this report; it holds {', '.join(present)}"
        )

    # Derived from the rows that survived the filter, not from every row: a
    # multi-device caveat inherited from an excluded buffer type would describe a
    # total that added nothing together.
    devices: Set[int] = set()
    by_type: Dict[str, Dict[int, int]] = defaultdict(lambda: defaultdict(int))
    for operation_id, raw_type, device_id, total, _count in grouped:
        type_name = _buffer_type_name(raw_type)
        if wanted is not None and type_name != wanted:
            continue
        devices.add(device_id)
        by_type[type_name][operation_id] += total

    cap = bounded(limit)
    memory: Dict[str, object] = {}
    for type_name in sorted(by_type):
        footprints = by_type[type_name]
        # Ties broken by operation id so the same report answers the same way
        # twice: resident allocations barely move, so the peak is routinely
        # shared by hundreds of operations. SQLite's GROUP BY happens to return
        # rows ordered by its leading key, which makes this belt-and-braces
        # today rather than load-bearing -- but that ordering is not guaranteed,
        # and an arbitrary pick among hundreds is what `operations_at_peak`
        # exists to keep an agent from chasing.
        ranked = sorted(footprints.items(), key=lambda item: (-item[1], item[0]))
        # The peak is a maximum, never a sum across the run: a buffer that stays
        # live is listed under every operation it survived, so adding those
        # reports one allocation once per operation it lived through.
        peak = ranked[0][1] if ranked else 0
        memory[type_name] = {
            "peak": peak,
            # How many operations hold that peak. A plateau of hundreds is the
            # normal shape for resident memory, and naming one of them as "the"
            # peak without this sends an agent to investigate an arbitrary pick.
            "operations_at_peak": sum(
                1 for _, size in ranked if size == peak and peak > 0
            ),
            "operation_count": len(footprints),
            "returned": min(len(ranked), cap),
            "operations": [
                {
                    "operation_id": operation_id,
                    "name": names.get(operation_id),
                    "size": size,
                }
                for operation_id, size in ranked[:cap]
            ],
        }

    return {
        "handle": handle,
        "buffer_type": wanted,
        # Keyed by memory type even when one was selected, so a caller reads one
        # response shape rather than two.
        "memory_by_buffer_type": memory,
        "buffer_types_present": present,
        "size_unit": BUFFER_SIZE_UNIT,
        "device": capacity,
        # Deliberately does not say "multiply by the bank count". That holds only
        # for a buffer interleaved across every bank, and most are not: on a
        # local resnet50 capture the operation named here as the L1 peak holds
        # two 56-bank buffers, so multiplying by the device's 64 overstates it by
        # 14%, and 16-bank operations in the same report by 4x. How many banks a
        # buffer actually occupies lives in `buffer_pages`, which no tool
        # exposes -- so the honest statement is that this response cannot give a
        # device-wide total, not a formula that is usually wrong.
        "note": (
            "Sizes are per bank, as `buffers.max_size_per_bank` holds them, and "
            "are never added across memory types -- the bank count differs by "
            "type. A per-bank figure is comparable to `device.l1_bank_size` for "
            "L1, which is a conservative bound. A device-wide total cannot be "
            "derived from this response: it depends on how many banks each "
            "buffer occupies, which only page-level data records. The report "
            "carries no DRAM capacity at all."
        ),
        **scope.as_response(),
        **_caveats(scope, devices=devices),
    }


def tensor_flow(
    registry: ReportRegistry,
    handle: str,
    tensor_id: int,
    rank: Optional[int] = None,
) -> Dict[str, object]:
    """Which operation produced a tensor and which ones consumed it."""
    instance = registry.get(handle)
    with _profiler_db(instance) as queries:
        scope = _rank_scope(queries, rank)
        _refuse_unattributable(
            queries, scope, "tensors", "input_tensors", "output_tensors"
        )
        wanted = int(tensor_id)
        edges = [
            entry
            for entry in queries.query_producers_consumers(rank=scope.rank)
            if entry.tensor_id == wanted
        ]
        tensors = {
            tensor.tensor_id: tensor
            for tensor in queries.query_tensors(
                filters=_scoped(queries, "tensors", scope, tensor_id=[wanted])
            )
        }
        tensor_size_unit = (
            TENSOR_SIZE_UNIT
            if queries.report_has_tensor_size_column()
            else BUFFER_SIZE_UNIT
        )
        touching = sorted(
            {
                operation_id
                for entry in edges
                for operation_id in (*entry.producers, *entry.consumers)
            }
        )
        # Same short-circuit: a tensor with no producers and no consumers would
        # otherwise read every operation in the report to label nothing.
        names = (
            {
                operation.operation_id: operation.name
                for operation in queries.query_operations(
                    filters=_scoped(queries, "operations", scope, operation_id=touching)
                )
            }
            if touching
            else {}
        )

    if not edges:
        raise ValueError(f"no tensor {wanted} in this report")
    edge = edges[0]
    tensor = tensors.get(wanted)

    def labelled(operation_ids: List[int]) -> List[Dict[str, object]]:
        return [
            {"operation_id": operation_id, "name": names.get(operation_id)}
            for operation_id in operation_ids[:MAX_LIMIT]
        ]

    result: Dict[str, object] = {
        "handle": handle,
        "tensor_id": wanted,
        "producers": labelled(edge.producers),
        "consumers": labelled(edge.consumers),
        "producer_count": len(edge.producers),
        "consumer_count": len(edge.consumers),
        **scope.as_response(),
        **_caveats(scope),
    }
    if tensor is not None:
        result["tensor"] = {
            "shape": tensor.shape,
            "dtype": tensor.dtype,
            "layout": tensor.layout,
            "memory_config": tensor.memory_config,
            "size": tensor.size,
            "size_unit": tensor_size_unit,
            "buffer_type": (
                _buffer_type_name(tensor.buffer_type)
                if tensor.buffer_type is not None
                else None
            ),
        }
    return result


def _caveats(scope: RankScope, devices: Optional[Set[int]] = None) -> Dict[str, str]:
    """The caveats a response needs, composed from what it actually returned.

    The rank one applies to every tool here, because all of them key on an
    operation id that restarts per rank. The device one applies only where
    allocations were summed, so it is derived from the devices those allocations
    came from rather than stated unconditionally -- a caveat that is always
    present is one an agent learns to skip.
    """
    caveats: List[str] = []
    if scope.multi_host and scope.rank is not None:
        caveats.append(
            f"This is a multi-host report read at rank {scope.rank} only. "
            "Operation ids restart per rank, so figures here describe that rank "
            "rather than the job."
        )
    devices = devices or set()
    if len(devices) > 1:
        caveats.append(
            f"These buffers span {len(devices)} devices "
            f"({', '.join(str(device) for device in sorted(devices))}), and the "
            "totals add them together. A per-device figure needs the devices "
            "separated first."
        )
    return {"caveat": " ".join(caveats)} if caveats else {}


__all__ = [
    "BUFFER_SIZE_UNIT",
    "MAX_ARGUMENT_VALUE_CHARS",
    "BUFFER_TYPE_NAMES",
    "RankScope",
    "TENSOR_SIZE_UNIT",
    "ProfilerDatabaseMissingError",
    "find_operations",
    "memory_profile",
    "operation_detail",
    "operation_provenance",
    "tensor_flow",
]
