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

import sqlite3
from collections import defaultdict
from contextlib import contextmanager
from pathlib import Path
from typing import Dict, Iterator, List, NamedTuple, Optional

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

# `tensors.size` is a true byte count for the whole tensor, so the two cannot be
# added together or compared. Named differently for that reason alone.
TENSOR_SIZE_UNIT = "bytes"


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

    @property
    def filters(self) -> Dict[str, int]:
        return {} if self.rank is None else {"rank": self.rank}


def _rank_scope(queries: DatabaseQueries, rank: Optional[int]) -> RankScope:
    multi_host = queries.report_has_rank_column()
    return RankScope(
        multi_host=multi_host,
        rank=(0 if rank is None else int(rank)) if multi_host else None,
    )


def _buffer_type_name(value: object) -> str:
    """`buffers.buffer_type` is the text column, whatever the annotation says.

    `_dataclass_select_clause` reads the column straight, so `Buffer.buffer_type`
    arrives as `'DRAM'` rather than as the `BufferType` it is annotated to be.
    Older captures may hold the integer instead, hence the name lookup.
    """
    if isinstance(value, int) and not isinstance(value, bool):
        try:
            return BufferType(value).name
        except ValueError:
            return str(value)
    name = getattr(value, "name", None)
    return str(name if name is not None else value)


def _device_capacity(queries: DatabaseQueries) -> Dict[str, object]:
    """L1 geometry, so a per-bank figure can be read against something.

    The report carries no DRAM capacity at all, which is said explicitly: an
    agent handed L1 limits and silence on DRAM will otherwise assume the DRAM
    figure was checked against something.

    The geometry is one device's, and which one is named in the response rather
    than left as an assumption about them being identical.
    """
    devices = list(queries.query_devices())
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


def find_operations(
    registry: ReportRegistry,
    handle: str,
    name_contains: Optional[str] = None,
    limit: Optional[int] = None,
    rank: Optional[int] = None,
) -> Dict[str, object]:
    """Locate operations by name, so a following call has an id to ask about."""
    instance = registry.get(handle)
    with _profiler_db(instance) as queries:
        scope = _rank_scope(queries, rank)
        needle = (name_contains or "").strip().lower()
        matches = [
            operation
            for operation in queries.query_operations(filters=scope.filters)
            if not needle or needle in (operation.name or "").lower()
        ]

    cap = bounded(limit)
    return {
        "handle": handle,
        "name_contains": name_contains or None,
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
        **scope._asdict(),
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
        filters = {**scope.filters, "operation_id": int(operation_id)}

        operations = list(queries.query_operations(filters=filters))
        if not operations:
            raise ValueError(
                f"no operation {operation_id} in this report"
                + (f" at rank {scope.rank}" if scope.rank is not None else "")
            )
        operation = operations[0]

        inputs = list(queries.query_input_tensors(filters=filters))
        outputs = list(queries.query_output_tensors(filters=filters))
        buffers = list(queries.query_buffers(filters=filters))

        # Only the tensors this operation refers to. Reading the report's whole
        # tensor table to describe a handful parses every other tensor's memory
        # config on the way past (`Tensor.__post_init__`).
        wanted_ids = sorted(
            {item.tensor_id for item in inputs} | {item.tensor_id for item in outputs}
        )
        tensors = {
            tensor.tensor_id: tensor
            for tensor in queries.query_tensors(
                filters={**scope.filters, "tensor_id": wanted_ids}
            )
        }

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
        # The two size fields in this response are not in the same unit, and
        # nothing about the field names says so.
        "allocation_size_unit": BUFFER_SIZE_UNIT,
        "tensor_size_unit": TENSOR_SIZE_UNIT,
        **scope._asdict(),
        **_caveats(scope, buffers),
    }


def memory_profile(
    registry: ReportRegistry,
    handle: str,
    buffer_type: Optional[str] = None,
    limit: Optional[int] = None,
    rank: Optional[int] = None,
) -> Dict[str, object]:
    """Where the run's memory went, and which operation held the most.

    `buffers` holds what was live *at* each operation rather than what that
    operation allocated, so a per-operation sum is the footprint at that point
    and the largest of them is the run's peak -- which is the question an
    out-of-memory failure actually asks.
    """
    instance = registry.get(handle)
    with _profiler_db(instance) as queries:
        scope = _rank_scope(queries, rank)
        buffers = list(queries.query_buffers(filters=scope.filters))
        names = {
            operation.operation_id: operation.name
            for operation in queries.query_operations(filters=scope.filters)
        }
        capacity = _device_capacity(queries)

    wanted = (buffer_type or "").strip().upper() or None
    selected = [
        buffer
        for buffer in buffers
        if wanted is None or _buffer_type_name(buffer.buffer_type) == wanted
    ]
    if wanted is not None and not selected and buffers:
        present = sorted({_buffer_type_name(b.buffer_type) for b in buffers})
        raise ValueError(
            f"no {wanted} buffers in this report; it holds {', '.join(present)}"
        )

    per_operation: Dict[int, Dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for buffer in selected:
        type_name = _buffer_type_name(buffer.buffer_type)
        per_operation[buffer.operation_id][type_name] += buffer.max_size_per_bank
        per_operation[buffer.operation_id]["total"] += buffer.max_size_per_bank

    # Per-type peak is the largest footprint of that type at any one operation,
    # not the sum across the run: buffers persist across operations, so adding
    # them would count one allocation once per operation it stayed live through.
    type_peaks: Dict[str, int] = defaultdict(int)
    for operation_id, totals in per_operation.items():
        for type_name, size in totals.items():
            if type_name != "total":
                type_peaks[type_name] = max(type_peaks[type_name], size)

    ranked = sorted(
        per_operation.items(), key=lambda item: item[1]["total"], reverse=True
    )
    cap = bounded(limit)

    return {
        "handle": handle,
        "buffer_type": wanted,
        "operation_count": len(per_operation),
        "returned": min(len(ranked), cap),
        "peak_by_buffer_type": dict(sorted(type_peaks.items())),
        "operations": [
            {
                "operation_id": operation_id,
                "name": names.get(operation_id),
                "total": totals["total"],
                "by_buffer_type": {
                    type_name: size
                    for type_name, size in sorted(totals.items())
                    if type_name != "total"
                },
            }
            for operation_id, totals in ranked[:cap]
        ],
        "size_unit": BUFFER_SIZE_UNIT,
        "device": capacity,
        # Stated rather than left to the unit name, because this is the number an
        # agent will divide by a capacity.
        "note": (
            "Sizes are per bank, as `buffers.max_size_per_bank` holds them. An L1 "
            "figure is comparable to `device.l1_bank_size`; multiply by "
            "`device.l1_num_banks` for the device-wide total. The report carries "
            "no DRAM capacity, so a DRAM figure has nothing here to divide by."
        ),
        **scope._asdict(),
        **_caveats(scope, selected),
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
        wanted = int(tensor_id)
        edges = [
            entry
            for entry in queries.query_producers_consumers(rank=scope.rank)
            if entry.tensor_id == wanted
        ]
        tensors = {
            tensor.tensor_id: tensor
            for tensor in queries.query_tensors(
                filters={**scope.filters, "tensor_id": [wanted]}
            )
        }
        touching = sorted(
            {
                operation_id
                for entry in edges
                for operation_id in (*entry.producers, *entry.consumers)
            }
        )
        names = {
            operation.operation_id: operation.name
            for operation in queries.query_operations(
                filters={**scope.filters, "operation_id": touching}
            )
        }

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
        **scope._asdict(),
        **_caveats(scope),
    }
    if tensor is not None:
        result["tensor"] = {
            "shape": tensor.shape,
            "dtype": tensor.dtype,
            "layout": tensor.layout,
            "size": tensor.size,
            "size_unit": TENSOR_SIZE_UNIT,
            "buffer_type": (
                _buffer_type_name(tensor.buffer_type)
                if tensor.buffer_type is not None
                else None
            ),
        }
    return result


def _caveats(
    scope: RankScope, buffers: Optional[List[Buffer]] = None
) -> Dict[str, str]:
    """The caveats a response needs, composed from what it actually returned.

    The rank one applies to every tool here, because all of them key on an
    operation id that restarts per rank. The device one applies only where
    allocations were summed, so it is derived from the buffers rather than
    stated unconditionally -- a caveat that is always present is one an agent
    learns to skip.
    """
    caveats: List[str] = []
    if scope.multi_host and scope.rank is not None:
        caveats.append(
            f"This is a multi-host report read at rank {scope.rank} only. "
            "Operation ids restart per rank, so figures here describe that rank "
            "rather than the job."
        )
    devices = {buffer.device_id for buffer in buffers or []}
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
    "RankScope",
    "TENSOR_SIZE_UNIT",
    "ProfilerDatabaseMissingError",
    "find_operations",
    "memory_profile",
    "operation_detail",
    "tensor_flow",
]
