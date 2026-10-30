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

import heapq
import re
from collections import defaultdict
from contextlib import contextmanager
from itertools import groupby
from operator import itemgetter
from pathlib import Path
from typing import (
    Callable,
    Dict,
    Iterator,
    List,
    Mapping,
    NamedTuple,
    Optional,
    Sequence,
    Set,
    Tuple,
    TypedDict,
)

from ttnn_visualizer.agent import op_graph
from ttnn_visualizer.agent.bounds import MAX_LIMIT, bounded, require_choice
from ttnn_visualizer.agent.handles import (
    PROFILER_DB_FILE,
    ReportRegistry,
    read_only_connection,
)
from ttnn_visualizer.models import Buffer, BufferType, Device, Instance, Operation
from ttnn_visualizer.queries import DatabaseQueries

# Every allocation figure derived from `buffers` is in these units, and the
# response says so wherever one appears. `max_size_per_bank` is what the column
# holds, and the HTTP serializers already re-expose it as plain `size`
# (`serializers.py:309`) -- so reading it as a device-wide byte count is one
# rename away rather than a hypothetical. It is per bank: on a local resnet50
# capture the largest L1 footprint sums to 487,424 against an `l1_bank_size` of
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
def profiler_db(instance: Instance) -> Iterator[DatabaseQueries]:
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
    connection = read_only_connection(db_file)
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


def scoped(
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


def rank_scope(queries: DatabaseQueries, rank: Optional[int]) -> RankScope:
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


class UnattributableRankError(ValueError):
    """Rows that cannot be attributed to the rank a response would name."""


def refuse_unattributable(
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
    reason = unattributable_reason(queries, scope, *tables)
    if reason is not None:
        raise UnattributableRankError(reason)


def unattributable_reason(
    queries: DatabaseQueries, scope: RankScope, *tables: str
) -> Optional[str]:
    """Why `refuse_unattributable` refuses `tables`, for a field withheld instead."""
    if scope.rank is None or len(scope.ranks) <= 1:
        return None
    # A table that is absent holds no rows, so there is nothing to attribute to the
    # wrong rank. Treating it as "a table without `rank`" refused every call to a
    # tool that was advertised as answerable and would have answered — the
    # arguments, plus the caveat saying no call site was recorded.
    unfiltered = [
        table
        for table in tables
        if queries._check_table_exists(table)
        and not queries.table_has_rank_column(table)
    ]
    if not unfiltered:
        return None
    return (
        f"this report carries `rank` on `operations` but not on "
        f"{', '.join(f'`{table}`' for table in unfiltered)}, so its rows span "
        f"ranks {', '.join(str(entry) for entry in scope.ranks)} and cannot be "
        f"attributed to rank {scope.rank}"
    )


def withheld_caveat(fields: Sequence[str], reason: str) -> str:
    """The sentence a caveat carries for `fields` withheld because of `reason`."""
    verb = "is" if len(fields) == 1 else "are"
    return f"{' and '.join(fields)} {verb} withheld: {reason}."


def _buffer_type_name(value: object) -> str:
    """A stored `buffer_type` by name, whether or not it became a `BufferType`.

    `Buffer` and `Tensor` coerce the column, which stores integers (`0`, `1`,
    `3`) in most reports and text (`'DRAM'`, `'L1'`) in newer ones, but pass an
    unrecognised value through unchanged.
    """
    if isinstance(value, int) and not isinstance(value, bool):
        try:
            return BufferType(value).name
        except ValueError:
            return str(value)
    name = getattr(value, "name", None)
    return str(name if name is not None else value)


L1_PRESSURE_NOTE = (
    "Sizes are bytes per bank on `device_id` only, the most constrained device: "
    "the one with the smallest largest free block. Free-space figures are an "
    "upper bound: `buffers` records tensor allocations only, excluding "
    "circular buffers and tensors allocated and freed inside one operation."
)

NO_L1_GEOMETRY_CAVEAT = (
    "l1_pressure is null because no device records a usable L1 window "
    "(`l1_bank_size` and `worker_l1_size` are zero or missing)."
)

# `[l1_start, l1_end)` in per-bank bytes.
L1Window = Tuple[int, int]


class _L1PressureFigures(TypedDict):
    device_id: int
    fullness_pct: float
    free_segments: int
    largest_free_block: int
    largest_free_pct: float
    allocated_bytes: int
    usable_bytes: int
    high_water_bytes: int


class L1Pressure(_L1PressureFigures):
    size_unit: str
    note: str


class RankedL1PressureRow(_L1PressureFigures):
    operation_id: int
    name: Optional[str]


def _as_int(value: object) -> int:
    if value is None or isinstance(value, bool):
        return 0
    try:
        return int(value)  # type: ignore[call-overload]
    except (TypeError, ValueError, OverflowError):
        return 0


def _int_attr(obj: object, attr: str) -> int:
    return _as_int(getattr(obj, attr, None))


def _device_l1_window(device: Device) -> Optional[L1Window]:
    """Usable per-bank L1 window `[l1_start, l1_end)` for one device.

    Bounds each device by `[address_at_first_l1_cb_buffer,
    address_at_first_l1_cb_buffer + l1_bank_size)` (clamped to `worker_l1_size`
    when smaller) so reserved L1 Small space at the top of `worker_l1_size` is
    not counted as free L1. #2172
    """
    worker_l1_size = _int_attr(device, "worker_l1_size")
    l1_bank_size = _int_attr(device, "l1_bank_size")
    if worker_l1_size <= 0 or l1_bank_size <= 0:
        return None
    l1_start = max(0, _int_attr(device, "address_at_first_l1_cb_buffer"))
    l1_end = min(worker_l1_size, l1_start + l1_bank_size)
    if l1_start >= l1_end:
        return None
    return (l1_start, l1_end)


def _device_l1_windows(devices: Sequence[Device]) -> Dict[int, L1Window]:
    """Each device's window, in `devices` order; a device without geometry is left out."""
    windows: Dict[int, L1Window] = {}
    for device in devices:
        window = _device_l1_window(device)
        if window is not None:
            windows[_int_attr(device, "device_id")] = window
    return windows


def _pressure_rank(
    pressure: _L1PressureFigures, tie: int
) -> Tuple[int, float, int, int]:
    """Most constrained first: smallest largest free block, then fullest, then most
    allocated, then `tie`. Fullness is compared unrounded, as the app compares it."""
    return (
        pressure["largest_free_block"],
        -pressure["allocated_bytes"] / pressure["usable_bytes"],
        -pressure["allocated_bytes"],
        tie,
    )


def _device_l1_pressure(
    extents: Dict[int, int], device_id: int, window: L1Window
) -> L1Pressure:
    """One device's figures from its `{address: size}` extents, already deduplicated."""
    l1_start, l1_end = window
    usable_size = l1_end - l1_start
    clipped: List[Tuple[int, int]] = []
    for address, size in extents.items():
        start = max(address, l1_start)
        end = min(address + size, l1_end)
        if end > start:
            clipped.append((start, end))

    merged: List[List[int]] = []
    for start, end in sorted(clipped):
        if merged and start <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])

    allocated_bytes = sum(end - start for start, end in merged)
    gaps: List[int] = []
    cursor = l1_start
    for start, end in merged:
        if start > cursor:
            gaps.append(start - cursor)
        cursor = max(cursor, end)
    if cursor < l1_end:
        gaps.append(l1_end - cursor)

    largest_free_block = max(gaps, default=0)
    high_water_bytes = max((end - l1_start for _, end in merged), default=0)

    return {
        "device_id": device_id,
        "fullness_pct": round((allocated_bytes / usable_size) * 100.0, 1),
        "free_segments": len(gaps),
        "largest_free_block": largest_free_block,
        "largest_free_pct": round((largest_free_block / usable_size) * 100.0, 1),
        "allocated_bytes": allocated_bytes,
        "usable_bytes": usable_size,
        "high_water_bytes": high_water_bytes,
        # Per bank, beside a `tensor_size_unit` that can be whole-tensor bytes.
        "size_unit": BUFFER_SIZE_UNIT,
        "note": L1_PRESSURE_NOTE,
    }


def _most_constrained_device(
    extents_by_device: Dict[int, Dict[int, int]], windows: Dict[int, L1Window]
) -> L1Pressure:
    """The device a tensor is least likely to fit on, by `_pressure_rank`.

    A device with no window of its own borrows the first device's. A device
    holding nothing scores the same as any other empty device with its window,
    so each distinct window is measured once, for its lowest `device_id`.
    """
    fallback = next(iter(windows.values()))
    candidates = [
        _device_l1_pressure(extents, device_id, windows.get(device_id, fallback))
        for device_id, extents in extents_by_device.items()
    ]
    empty: Dict[L1Window, int] = {}
    for device_id in sorted(windows):
        if device_id not in extents_by_device:
            empty.setdefault(windows[device_id], device_id)
    candidates.extend(
        _device_l1_pressure({}, device_id, window)
        for window, device_id in empty.items()
    )
    return min(candidates, key=lambda item: _pressure_rank(item, item["device_id"]))


def _l1_extents_by_device(buffers: Sequence[Buffer]) -> Dict[int, Dict[int, int]]:
    """L1 `{address: largest size}` per device, as `dedupeAndClipBuffers` keeps them.

    A zero-size row occupies nothing, and the app skips it too rather than
    splitting a free gap on a zero-width chunk.
    """
    extents: Dict[int, Dict[int, int]] = defaultdict(dict)
    for buf in buffers:
        if _buffer_type_name(buf.buffer_type) != BufferType.L1.name:
            continue
        size = _int_attr(buf, "max_size_per_bank")
        if size <= 0 or getattr(buf, "address", None) is None:
            continue
        by_address = extents[_int_attr(buf, "device_id")]
        address = _int_attr(buf, "address")
        if size > by_address.get(address, 0):
            by_address[address] = size
    return extents


def _compute_l1_pressure(
    buffers: Sequence[Buffer], windows: Dict[int, L1Window]
) -> Optional[L1Pressure]:
    """Per-operation L1 fullness and free-segment fragmentation. #2172

    Mirrors `computeL1PressureForOperation` in `src/functions/l1Pressure.ts`,
    and `tests/l1PressureParity.spec.ts` holds the app to this port's answers:
    per-device windows (`_device_l1_window`), L1 extents deduplicated by address
    and clipped per `device_id` before overlapping or adjacent ones merge, and
    the most constrained device by `_pressure_rank`. Unlike the app, returns
    `None` when the operation recorded no `buffers` rows or no device has a
    window, where the app reports a fully free window bounded by its markers.
    """
    if not buffers or not windows:
        return None
    return _most_constrained_device(_l1_extents_by_device(buffers), windows)


def _ranked_l1_pressure(
    queries: DatabaseQueries,
    scope: RankScope,
    operation_ids: Set[int],
    windows: Dict[int, L1Window],
    names: Mapping[int, Optional[str]],
    cap: int,
) -> Optional[Dict[str, object]]:
    """`memory_profile`'s L1 pressure block, most constrained operations first.

    Read one operation at a time from rows already deduplicated in SQL
    (`iter_l1_extents_by_operation`), keeping only the `cap` most constrained:
    the `buffers` table is too large to hold, as `query_buffer_totals_by_operation`
    explains. An operation with L1 rows but no extent that occupies anything is
    measured as empty.
    """
    if not operation_ids or not windows:
        return None

    def measured() -> Iterator[Tuple[int, L1Pressure]]:
        seen: Set[int] = set()
        rows = queries.iter_l1_extents_by_operation(rank=scope.rank)
        for operation_id, group in groupby(rows, key=itemgetter(0)):
            extents: Dict[int, Dict[int, int]] = defaultdict(dict)
            for _, device_id, address, size in group:
                extents[_as_int(device_id)][_as_int(address)] = _as_int(size)
            seen.add(operation_id)
            yield operation_id, _most_constrained_device(extents, windows)
        empty = _most_constrained_device({}, windows)
        for operation_id in sorted(operation_ids - seen):
            yield operation_id, empty

    count = 0

    def counted() -> Iterator[Tuple[int, L1Pressure]]:
        nonlocal count
        for item in measured():
            count += 1
            yield item

    top = heapq.nsmallest(
        cap, counted(), key=lambda item: _pressure_rank(item[1], item[0])
    )
    return {
        "ranked_by": "largest_free_block",
        "size_unit": BUFFER_SIZE_UNIT,
        "operation_count": count,
        "returned": len(top),
        "operations": [
            _ranked_row(operation_id, names.get(operation_id), pressure)
            for operation_id, pressure in top
        ],
        "note": L1_PRESSURE_NOTE,
    }


def _ranked_row(
    operation_id: int, name: Optional[str], pressure: L1Pressure
) -> RankedL1PressureRow:
    return {
        "operation_id": operation_id,
        "name": name,
        "device_id": pressure["device_id"],
        "fullness_pct": pressure["fullness_pct"],
        "free_segments": pressure["free_segments"],
        "largest_free_block": pressure["largest_free_block"],
        "largest_free_pct": pressure["largest_free_pct"],
        "allocated_bytes": pressure["allocated_bytes"],
        "usable_bytes": pressure["usable_bytes"],
        "high_water_bytes": pressure["high_water_bytes"],
    }


def scoped_devices(queries: DatabaseQueries, scope: RankScope) -> List[Device]:
    """Rank-scoped `devices` rows, one per `device_id`, read once per tool call.

    As `fetchDevices`: the first id keeps its place, and a later row of it wins.
    """
    rows = queries.query_devices(filters=scoped(queries, "devices", scope))
    return list({device.device_id: device for device in rows}.values())


def _attributable_devices(
    queries: DatabaseQueries, scope: RankScope
) -> Tuple[List[Device], Optional[str]]:
    """`scoped_devices`, or none and why when they can't be attributed to the rank.

    An empty table holds nothing to misattribute, so it reads as empty.
    """
    devices = scoped_devices(queries, scope)
    reason = unattributable_reason(queries, scope, "devices") if devices else None
    return ([] if reason else devices), reason


def _device_caveat(
    fields: Sequence[str],
    unattributable: Optional[str],
    windows: Dict[int, L1Window],
) -> Optional[str]:
    """Why the device-derived `fields` are null: withheld, else no L1 geometry."""
    if unattributable:
        return withheld_caveat(fields, unattributable)
    if "l1_pressure" in fields and not windows:
        return NO_L1_GEOMETRY_CAVEAT
    return None


def _device_capacity(devices: Sequence[Device]) -> Dict[str, object]:
    """L1 geometry, so a per-bank figure can be read against something.

    The report carries no DRAM capacity at all, which is said explicitly: an
    agent handed L1 limits and silence on DRAM will otherwise assume the DRAM
    figure was checked against something.

    The geometry is one device's, and which one is named in the response rather
    than left as an assumption about them being identical.
    """
    # `devices` is rank-scoped like the figures beside it (`scoped_devices`):
    # on a multi-host report an unfiltered read counts every rank's devices,
    # which answers a different question than the rest of the response.
    if not devices:
        return {"devices": 0, "dram_capacity": None}
    device = devices[0]
    return {
        "devices": len(devices),
        "geometry_from_device": device.device_id,
        "l1_bank_size": device.l1_bank_size,
        "l1_num_banks": device.l1_num_banks,
        "worker_l1_size": device.worker_l1_size,
        "address_at_first_l1_cb_buffer": device.address_at_first_l1_cb_buffer,
        "num_compute_cores": device.num_compute_cores,
        # Zero on captures that predate the field, so it is passed through as-is
        # rather than used as a denominator here.
        "total_l1_for_tensors": device.total_l1_for_tensors,
        "dram_capacity": None,
    }


# How much of one argument value is returned. The tail is much heavier than one
# capture suggests: across the 204,636 argument values in 86 local reports, 28% run
# past this cap and the longest is 177,717 characters -- a tensor repr or a
# `Conv2dConfig`. One report has 60% of its values over the cap. So truncation is
# the normal case rather than the exception, which is why the count of truncated
# values is reported alongside them: an agent reading one value cannot see that
# most of the response was cut, and raising the cap enough to matter would put tens
# of kilobytes in a response that is supposed to be bounded.
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
        # The first non-blank line under the frame, and only if it is not itself a
        # frame. The window used to look two lines ahead past an intervening `File`
        # line, so a frame with no source line borrowed its neighbour's -- and since
        # the call site is frame 0, that pointed at another file's code.
        code = None
        for candidate in lines[index + 1 :]:
            if not candidate.strip():
                continue
            if _TRACE_FRAME.match(candidate) is None:
                code = candidate.strip()
            break
        frames.append(
            {
                "file": match.group("file"),
                "line": int(match.group("line")),
                "function": match.group("function").strip(),
                "code": code,
            }
        )
    return frames


def joined_caveat(existing: object, addition: str) -> str:
    """Append to the response's one caveat field rather than inventing another."""
    return f"{existing} {addition}" if existing else addition


def _truncated(value: Optional[str]) -> Dict[str, object]:
    """One argument value, capped, saying so when it was cut.

    A NULL value is reported as absent rather than as an empty string: "not
    recorded" and "recorded as empty" are different facts, and this module keeps
    that distinction for the call site too.
    """
    if value is None:
        return {"value": None, "recorded": False}
    text = str(value)
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
    limit: Optional[int] = None,
    rank: Optional[int] = None,
) -> Dict[str, object]:
    """What an operation was called with, and where in the model code it came from.

    Takes the profiler database's `operation_id`, the same one `memory_profile`,
    `operation_detail` and `find_operations` use -- *not* the `id` from `top_ops`,
    which numbers rows of the performance CSV. The two are small
    integers in overlapping ranges, so passing a CSV row number here does not
    refuse; it answers about a different operation. A `top_ops` row's
    `operation_id` (`linking.top_ops`) is how to cross from a performance row, and
    `find_operations` from a name.

    This is the step that was missing: `memory_profile` names the operations
    holding its largest footprint, and nothing turned those ids into something
    actionable in the code being edited. #2021
    """
    instance = registry.get(handle)
    with profiler_db(instance) as queries:
        scope = rank_scope(queries, rank)
        # The tables the answer is read *from*, not just the one the rank scope was
        # decided on: `operations` is the table `report_has_rank_column` inspects, so
        # naming only it can never fire. These two are where `merge_rank_filter`
        # silently no-ops on a schema that carries `rank` unevenly, and a call site
        # from another host under a `rank: 0` caveat is the caveat pointing the wrong
        # way that this module refuses elsewhere.
        refuse_unattributable(queries, scope, "operation_arguments", "stack_traces")
        wanted = int(operation_id)
        filters = scoped(queries, "operations", scope, operation_id=wanted)

        operations = list(queries.query_operations(filters=filters))
        if not operations:
            raise ValueError(
                f"no operation {wanted} in this report"
                + (f" at rank {scope.rank}" if scope.rank is not None else "")
            )
        operation = operations[0]

        arguments = list(
            queries.query_operation_arguments(
                filters=scoped(
                    queries, "operation_arguments", scope, operation_id=wanted
                )
            )
        )
        traces = list(
            queries.query_stack_traces(
                filters=scoped(queries, "stack_traces", scope, operation_id=wanted)
            )
        )

    # `or ""` on the value, not just a check on the row: a NULL column reached
    # `splitlines` and gave the agent an AttributeError. The `called_from` path
    # guarded this and this one did not.
    raw_trace = (traces[0].stack_trace or "") if traces else ""
    frames = _parse_frames(raw_trace)
    cap = bounded(limit)
    chain = frames[1 : cap + 1]
    result: Dict[str, object] = {
        "handle": handle,
        "operation_id": operation.operation_id,
        "name": operation.name,
        "arguments": [
            {"name": argument.name, **_truncated(argument.value)}
            for argument in arguments[:MAX_LIMIT]
        ],
        "argument_count": len(arguments),
        "value_cap_chars": MAX_ARGUMENT_VALUE_CHARS,
        # Reported because truncation is common rather than rare: an agent looking
        # at one value cannot tell that most of the rest was cut too.
        "truncated_count": sum(
            1
            for argument in arguments[:MAX_LIMIT]
            if argument.value is not None
            and len(str(argument.value)) > MAX_ARGUMENT_VALUE_CHARS
        ),
        # The innermost frame, which is the `ttnn.<op>` call in the model code. Named
        # separately from the chain because it is the answer to the question; the
        # chain is how you got there.
        "call_site": frames[0] if frames else None,
        # The chain outward, without repeating the call site, and capped: a real
        # trace runs to 43 frames of which 31 were the pytest harness that invoked
        # the model, which is context spent on the opposite of what was asked.
        "frames": chain,
        # `returned_frames` counts what this response holds and `chain_length` what
        # the trace holds, so the two differ exactly when the cap bound. They were
        # the same expression, which made the cap invisible and the comment here
        # claim the opposite of what the field did. `call_site` is reported
        # separately and is in neither number.
        "returned_frames": len(chain),
        "chain_length": max(len(frames) - 1, 0),
        **scope.as_response(),
        **_caveats(scope),
    }
    # Two different absences, said apart. A missing row is a capture that records
    # no call sites; a row that yields no frame is a trace this parser does not
    # read, and calling that "no stack trace recorded" would be false.
    if not raw_trace.strip():
        result["caveat"] = joined_caveat(
            result.get("caveat"),
            "This capture recorded no stack trace for this operation, so it has no "
            "call site. Older reports omit them.",
        )
    elif not frames:
        result["caveat"] = joined_caveat(
            result.get("caveat"),
            "A stack trace is recorded for this operation but holds no frame this "
            "tool could read, so the call site is unknown rather than absent. The "
            "parser expects CPython traceback text.",
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
    with profiler_db(instance) as queries:
        scope = rank_scope(queries, rank)
        needle = (name_contains or "").strip().lower()
        origin = (called_from or "").strip()
        if called_from is not None and not origin:
            # Refused rather than dropped: returning every operation under a
            # response that echoes the filter claims a narrowing that did not
            # happen, which is the reading `buffer_type` is refused to avoid.
            raise ValueError("called_from is empty; omit it to search every operation")

        # Matched against the whole trace rather than the call site alone: asking for
        # a helper's name should find the operations it called *through* other
        # frames too, which is the shape of a model built out of layer modules.
        # Matched in SQL, because the traces are the largest text in the report.
        from_origin: Optional[Set[int]] = None
        no_traces_recorded = False
        if origin:
            refuse_unattributable(queries, scope, "stack_traces")
            # Asked before the search, so a capture that records no call sites can
            # be told apart from one where nothing matched. `operation_provenance`
            # already says this for a single operation; a bare `match_count: 0`
            # here, with the filter echoed back, reads as evidence that no
            # operation came from that helper.
            no_traces_recorded = not queries.report_records_stack_traces()
            from_origin = set(
                queries.query_operation_ids_by_stack_trace(origin, rank=scope.rank)
            )

        # Only `operations`, which carries the column by definition here.
        matches = [
            operation
            for operation in queries.query_operations(
                filters=scoped(queries, "operations", scope)
            )
            if (not needle or needle in (operation.name or "").lower())
            and (from_origin is None or operation.operation_id in from_origin)
        ]

    cap = bounded(limit)
    result: Dict[str, object] = {
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
    if no_traces_recorded:
        result["caveat"] = joined_caveat(
            result.get("caveat"),
            "This capture records no stack traces, so `called_from` can match "
            "nothing. An empty result here is not evidence that no operation came "
            "from there.",
        )
    return result


# Fields a caller adds to an operation's detail, read on the detail's connection, and
# the caveat for any it withheld.
DetailFields = Callable[
    [DatabaseQueries, RankScope, Operation], Tuple[Dict[str, object], Optional[str]]
]


def operation_detail(
    registry: ReportRegistry,
    handle: str,
    operation_id: int,
    rank: Optional[int] = None,
    detail_fields: Optional[DetailFields] = None,
) -> Dict[str, object]:
    """One operation: its tensors, and what it had allocated at that point."""
    instance = registry.get(handle)
    with profiler_db(instance) as queries:
        scope = rank_scope(queries, rank)
        refuse_unattributable(
            queries, scope, "buffers", "tensors", "input_tensors", "output_tensors"
        )
        wanted_operation = int(operation_id)

        operations = list(
            queries.query_operations(
                filters=scoped(
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
                filters=scoped(
                    queries, "input_tensors", scope, operation_id=wanted_operation
                )
            )
        )
        outputs = list(
            queries.query_output_tensors(
                filters=scoped(
                    queries, "output_tensors", scope, operation_id=wanted_operation
                )
            )
        )
        buffers = list(
            queries.query_buffers(
                filters=scoped(queries, "buffers", scope, operation_id=wanted_operation)
            )
        )
        device_rows, devices_unattributable = _attributable_devices(queries, scope)
        windows = _device_l1_windows(device_rows)

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
                    filters=scoped(queries, "tensors", scope, tensor_id=wanted_ids)
                )
            }
            if wanted_ids
            else {}
        )
        added, withheld = (
            detail_fields(queries, scope, operation) if detail_fields else ({}, None)
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
    result: Dict[str, object] = {
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
        "l1_pressure": _compute_l1_pressure(buffers, windows),
        # Reported rather than asserted: these two are in different units on a
        # report that carries `tensors.size`, and in the *same* unit on one that
        # does not, where the tensor figure is the per-bank allocation itself.
        "allocation_size_unit": BUFFER_SIZE_UNIT,
        "tensor_size_unit": tensor_size_unit,
        **scope.as_response(),
        **_caveats(scope, {buffer.device_id for buffer in buffers}),
    }
    result.update(added)
    device_caveat = (
        _device_caveat(["l1_pressure"], devices_unattributable, windows)
        if buffers
        else "l1_pressure is null because no buffer rows were recorded for this operation."
    )
    if device_caveat:
        result["caveat"] = joined_caveat(result.get("caveat"), device_caveat)
    if withheld:
        result["caveat"] = joined_caveat(result.get("caveat"), withheld)
    return result


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
    and the largest of them is the largest of those footprints.

    It is a floor, not the peak, and the gap is not small. `buffers` records
    tensor allocations only: a circular buffer never enters it, and neither does
    a tensor allocated and freed inside one operation. On `resnet50_may08_1841`
    this reports 487,424, a figure eighteen operations share, where replaying
    the captured graph gives 1,159,840 at operation 29 -- 2.4x out, and not the
    same operations.
    Across the local corpus circular buffers are 52-100% of the real L1 peak
    wherever a peak has any, and intra-op tensors a further 24-38%. Two reports
    hold almost no L1 tensors at all, so this reports a figure near zero for a
    model saturating L1. Neither the true peak nor the operation holding it can
    be derived from this response. #2034

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
    if wanted is not None:
        require_choice("buffer_type", wanted, BUFFER_TYPE_NAMES)

    instance = registry.get(handle)
    with profiler_db(instance) as queries:
        scope = rank_scope(queries, rank)
        refuse_unattributable(queries, scope, "buffers")
        grouped = queries.query_buffer_totals_by_operation(rank=scope.rank)
        names = {
            operation.operation_id: operation.name
            for operation in queries.query_operations(
                filters=scoped(queries, "operations", scope)
            )
        }
        device_rows, devices_unattributable = _attributable_devices(queries, scope)
        # `_device_capacity([])` answers `devices: 0`, so withheld goes by the reason.
        capacity = None if devices_unattributable else _device_capacity(device_rows)
        cap = bounded(limit)
        l1_windows = _device_l1_windows(device_rows)
        l1_pressure_block = (
            _ranked_l1_pressure(
                queries,
                scope,
                {
                    row[0]
                    for row in grouped
                    if _buffer_type_name(row[1]) == BufferType.L1.name
                },
                l1_windows,
                names,
                cap,
            )
            if wanted in (None, BufferType.L1.name)
            else None
        )

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

    memory: Dict[str, object] = {}
    for type_name in sorted(by_type):
        footprints = by_type[type_name]
        # Ties broken by operation id so the same report answers the same way
        # twice: resident allocations barely move, so the largest footprint is
        # routinely shared by hundreds of operations. SQLite's GROUP BY happens to return
        # rows ordered by its leading key, which makes this belt-and-braces
        # today rather than load-bearing -- but that ordering is not guaranteed,
        # and an arbitrary pick among hundreds is what `operations_at_peak`
        # exists to keep an agent from chasing.
        ranked = sorted(footprints.items(), key=lambda item: (-item[1], item[0]))
        # It is a maximum, never a sum across the run: a buffer that stays
        # live is listed under every operation it survived, so adding those
        # reports one allocation once per operation it lived through.
        peak = ranked[0][1] if ranked else 0
        memory[type_name] = {
            "peak": peak,
            # How many operations share that figure. A plateau of hundreds is the
            # normal shape for resident memory, and naming one of them as "the"
            # answer without this sends an agent to investigate an arbitrary pick.
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

    result: Dict[str, object] = {
        "handle": handle,
        "buffer_type": wanted,
        # Keyed by memory type even when one was selected, so a caller reads one
        # response shape rather than two.
        "memory_by_buffer_type": memory,
        "l1_pressure": l1_pressure_block,
        "buffer_types_present": present,
        "size_unit": BUFFER_SIZE_UNIT,
        "device": capacity,
        # Deliberately does not say "multiply by the bank count". That holds only
        # for a buffer interleaved across every bank, and most are not: on a
        # local resnet50 capture the operation named here as holding the largest
        # L1 footprint holds two 56-bank buffers, so multiplying by the device's
        # 64 overstates it by 14%, and 16-bank operations in the same report by
        # 4x. How many banks a buffer actually occupies lives in `buffer_pages`,
        # which no tool exposes -- so the honest statement is that this response
        # cannot give a device-wide total, not a formula that is usually wrong.
        # In `note` rather than `caveat` on purpose: `_caveats` is for what varies
        # with the request, and its own docstring says a caveat that is always
        # present is one an agent learns to skip. This exclusion is a property of
        # the table, true of every response. #2034
        "note": (
            "This is a floor, not the peak. `buffers` records tensor "
            "allocations only, so circular buffers and tensors allocated and "
            "freed inside one operation are absent, and both are large. A model "
            "whose L1 is mostly circular buffers reports a figure near zero. "
            "Neither the true peak nor the operation holding it can be derived "
            "from this response. "
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
    device_fields = (
        ["device", "l1_pressure"] if BufferType.L1.name in by_type else ["device"]
    )
    device_caveat = _device_caveat(device_fields, devices_unattributable, l1_windows)
    if device_caveat:
        result["caveat"] = joined_caveat(result.get("caveat"), device_caveat)
    return result


def tensor_flow(
    registry: ReportRegistry,
    handle: str,
    tensor_id: int,
    rank: Optional[int] = None,
) -> Dict[str, object]:
    """Which operation produced a tensor and which ones consumed it."""
    instance = registry.get(handle)
    with profiler_db(instance) as queries:
        scope = rank_scope(queries, rank)
        refuse_unattributable(
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
                filters=scoped(queries, "tensors", scope, tensor_id=[wanted])
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
                    filters=scoped(queries, "operations", scope, operation_id=touching)
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


GRAPH_TABLES = ("tensors", "input_tensors", "output_tensors")


def read_scoped_graph(queries: DatabaseQueries, scope: RankScope) -> op_graph.OpGraph:
    """The whole operation graph at `scope`'s rank, refused where it cannot be attributed."""
    refuse_unattributable(queries, scope, *GRAPH_TABLES)
    return op_graph.read_graph(
        queries, scoped(queries, "operations", scope), scope.rank
    )


def subgraph_between(
    registry: ReportRegistry,
    handle: str,
    from_operation_id: int,
    to_operation_id: int,
    limit: Optional[int] = None,
    rank: Optional[int] = None,
) -> Dict[str, object]:
    """The operations and tensors on every path from one operation to another."""
    instance = registry.get(handle)
    source, target = int(from_operation_id), int(to_operation_id)
    with profiler_db(instance) as queries:
        scope = rank_scope(queries, rank)
        graph = read_scoped_graph(queries, scope)

    for operation_id in (source, target):
        if operation_id not in graph.names:
            raise ValueError(f"no operation {operation_id} in this report")
    members = op_graph.operations_between(graph, source, target)
    if not members:
        reverse = (
            " (there is one from "
            f"{target} to {source}: swap from_operation_id and to_operation_id)"
            if op_graph.operations_between(graph, target, source)
            else ""
        )
        raise ValueError(f"no path from operation {source} to {target}{reverse}")

    cap = bounded(limit, MAX_LIMIT)
    ordered = sorted(members)
    edges = sorted(
        (
            edge
            for edge in graph.edges
            if edge.source in members and edge.target in members
        ),
        key=lambda edge: (edge.source, edge.target, edge.tensor_id),
    )
    return {
        "handle": handle,
        "from_operation_id": source,
        "to_operation_id": target,
        "operation_count": len(ordered),
        "edge_count": len(edges),
        "operations": [
            {"operation_id": operation_id, "name": graph.names.get(operation_id)}
            for operation_id in ordered[:cap]
        ],
        "operations_truncated": len(ordered) > cap,
        "edges": [
            {
                "source": edge.source,
                "target": edge.target,
                "tensor_id": edge.tensor_id,
            }
            for edge in edges[:cap]
        ],
        "edges_truncated": len(edges) > cap,
        **scope.as_response(),
        **_caveats(scope),
    }


def rank_caveat(scope: RankScope) -> Optional[str]:
    """The caveat every database tool's answer carries on a multi-host report."""
    if scope.multi_host and scope.rank is not None:
        return (
            f"This is a multi-host report read at rank {scope.rank} only. "
            "Operation ids restart per rank, so figures here describe that rank "
            "rather than the job."
        )
    return None


def _caveats(scope: RankScope, devices: Optional[Set[int]] = None) -> Dict[str, str]:
    """The caveats a response needs, composed from what it actually returned.

    The rank one applies to every tool here, because all of them key on an
    operation id that restarts per rank. The device one applies only where
    allocations were summed, so it is derived from the devices those allocations
    came from rather than stated unconditionally -- a caveat that is always
    present is one an agent learns to skip.
    """
    devices = devices or set()
    if len(devices) <= 1:
        return caveat_field(scope)
    return caveat_field(
        scope,
        f"These buffers span {len(devices)} devices "
        f"({', '.join(str(device) for device in sorted(devices))}), and the "
        "totals add them together. A per-device figure needs the devices "
        "separated first.",
    )


def caveat_field(scope: RankScope, *extra: str) -> Dict[str, str]:
    """The response's one `caveat`: the rank's, then `extra`; nothing when neither."""
    caveats = [caveat for caveat in (rank_caveat(scope), *extra) if caveat]
    return {"caveat": " ".join(caveats)} if caveats else {}


__all__ = [
    "BUFFER_SIZE_UNIT",
    "BUFFER_TYPE_NAMES",
    "DetailFields",
    "MAX_ARGUMENT_VALUE_CHARS",
    "RankScope",
    "TENSOR_SIZE_UNIT",
    "ProfilerDatabaseMissingError",
    "caveat_field",
    "GRAPH_TABLES",
    "find_operations",
    "joined_caveat",
    "memory_profile",
    "operation_detail",
    "operation_provenance",
    "profiler_db",
    "rank_caveat",
    "rank_scope",
    "read_scoped_graph",
    "refuse_unattributable",
    "scoped",
    "scoped_devices",
    "subgraph_between",
    "tensor_flow",
    "unattributable_reason",
    "withheld_caveat",
]
