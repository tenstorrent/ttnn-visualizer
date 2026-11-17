# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Proof-of-concept on-demand index for large NPE reports (#861).

A single NPE report can decompress to ~900 MB of JSON, which the browser cannot
parse in one shot (V8 string limit) and which no one ever views in full — a seek
renders only the transfers active at one timestep (~tens of them). This builds a
timestep-keyed SQLite index once, so the frontend can fetch just the visible
window (~135 KB) instead of the whole payload.

The build parses the whole object in memory. The agent's `noc_congestion` reads a
trace a timestep at a time (`streamed_link_demand`); a build reading the same way would
bound its peak RSS on the multi-user hosted path, once its walk of the JSON is split
from the link-demand rules it applies. `trace_link_demand`, the same read of a parsed
trace, is the reference the tests hold the streamed read to.
"""

import contextlib
import json
import logging
import os
import re
import sqlite3
import sys
import tempfile
import threading
from pathlib import Path
from typing import (
    Any,
    BinaryIO,
    Iterable,
    Iterator,
    List,
    NamedTuple,
    NoReturn,
    Optional,
    Tuple,
    cast,
)

import orjson
import zstd

try:
    import fcntl
except (
    ImportError
):  # Windows local installs lack fcntl; single-user, in-process lock suffices.
    fcntl = None  # type: ignore[assignment]

logger = logging.getLogger(__name__)

# Serialises index builds within a single process; the file lock below extends
# that across gunicorn worker processes.
_BUILD_LOCK = threading.Lock()

INDEX_SUFFIX = ".npeidx.sqlite"

# Bump when the schema or build logic changes so stale caches are rebuilt.
# 5: carries `soc_descriptor` in meta, so a report-supplied SoC descriptor
#    survives the windowed path as well as the whole-file one. #1776
INDEX_VERSION = 5

_TRANSFER_INSERT_BATCH = 5000

# Kept under SQLITE_MAX_VARIABLE_NUMBER (999 on sqlite < 3.32) so a busy timestep's
# active-transfer IN-list is chunked rather than overflowing the bind-var limit.
_TRANSFER_QUERY_CHUNK = 900

# Columnar summary column order (single source of truth for the SELECT and the
# positional dict in read_summary). MUST stay in lock-step with the frontend
# NPE_SUMMARY_COLUMN_KEYS (src/model/NPEModel.ts) — a reorder on either side
# silently mismaps the timeline heat bar. `t` is the array index, so it's omitted.
_SUMMARY_COLUMNS = (
    "start_cycle",
    "end_cycle",
    "avg_link_demand",
    "avg_link_util",
    "max_link_demand",
    "mcast_write_link_util",
    "active_count",
)

# link_demand rows are [chip_id, y, x, noc_id, demand] — mirrors NPE_LINK.DEMAND
# in the frontend model. Used to precompute each step's worst-link demand for the
# timeline heat bar, since the source JSON doesn't carry a per-step scalar.
_LINK_DEMAND_INDEX = 4

# Optional 6th slot: the client-computed fabric-event scope. Real reports omit it
# (rows are 5-tuples); see _truncate_link_demand for why a trailing null is dropped.
_FABRIC_EVENT_SCOPE_INDEX = 5

# The UI never renders more than 3 fractional digits (formatPercentage(..., 3)),
# so store floats truncated to match — this trims the up-front summary payload by
# ~36% and each window's link_demand by ~34% (#861). Truncation is ~3x cheaper
# than round() at index-build scale and yields an identical short JSON repr.
_TRUNCATE_DECIMALS = 3
_TRUNCATE_SCALE = 10**_TRUNCATE_DECIMALS


def truncate(value: Optional[float]) -> Optional[float]:
    if value is None:
        return None
    return int(value * _TRUNCATE_SCALE) / _TRUNCATE_SCALE


def _as_int(value: Optional[float]) -> Optional[int]:
    # Cycle counts are integers stored as `X.0` floats; drop the redundant ".0".
    return int(value) if value is not None else None


def _truncate_link_demand(link_demand: list) -> list:
    # Mutates in place — the parsed object is discarded after the build. Only the
    # trailing demand (index 4) is a float; coords / noc-id are left untouched.
    for entry in link_demand:
        if len(entry) > _LINK_DEMAND_INDEX and type(entry[_LINK_DEMAND_INDEX]) is float:
            entry[_LINK_DEMAND_INDEX] = truncate(entry[_LINK_DEMAND_INDEX])
        # Drop an absent fabric scope rather than ship a trailing null: the
        # frontend reads slot 5 as "unset" only when it's `undefined` (a 5-tuple),
        # so a serialized `null` would wrongly count as a present scope and
        # mis-annotate FABRIC/LOCAL/BOTH. Real reports are 5-tuples; this guards
        # one that carries an explicit null.
        if (
            len(entry) > _FABRIC_EVENT_SCOPE_INDEX
            and entry[_FABRIC_EVENT_SCOPE_INDEX] is None
        ):
            del entry[_FABRIC_EVENT_SCOPE_INDEX:]
    return link_demand


def _truncate_noc(noc: dict) -> dict:
    for noc_data in noc.values():
        for key, value in noc_data.items():
            if type(value) is float:
                noc_data[key] = truncate(value)
    return noc


def get_index_path(npe_path: str) -> Path:
    return Path(f"{npe_path}{INDEX_SUFFIX}")


@contextlib.contextmanager
def _build_guard(db_path: Path) -> Iterator[None]:
    # gunicorn runs multiple worker processes, so a threading lock alone can't
    # serialise cold-cache builds — two workers would each parse the whole report
    # (~5 GB transient RSS apiece) and race on the output file. Layer an advisory
    # file lock (POSIX flock) on top of the in-process lock. On platforms without
    # fcntl (Windows local installs, single-user) the threading lock is enough.
    with _BUILD_LOCK:
        if fcntl is None:
            yield
            return
        lock_path = Path(f"{db_path}.lock")
        lock_path.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o644)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX)
            yield
        finally:
            fcntl.flock(fd, fcntl.LOCK_UN)
            os.close(fd)


def load_npe_object(npe_path: Path) -> dict:
    return parse_trace(npe_path.read_bytes(), npe_path.suffix == ".zst")


def parse_trace(data: bytes, compressed: bool) -> dict:
    """A trace's bytes as `load_npe_object` reads them: zstd frames, or JSON."""
    if compressed:
        # Rebound, so the compressed bytes are freed before the parse; from Python 3.11
        # only, as 3.10 keeps the caller's reference to them until the call returns.
        data = zstd.uncompress(data)
    return orjson.loads(data)


ZSTD_MAGIC = b"\x28\xb5\x2f\xfd"
# Any magic from 0x184D2A50 to 0x184D2A5F; the frame decompresses to nothing.
_ZSTD_SKIPPABLE_MAGIC = 0x184D2A50
# Frame_Header_Descriptor's field sizes, by flag (RFC 8878, 3.1.1.1.1).
_ZSTD_DICTIONARY_ID_SIZES = (0, 1, 2, 4)
_ZSTD_CONTENT_SIZE_SIZES = (0, 2, 4, 8)
_ZSTD_RLE_BLOCK, _ZSTD_RESERVED_BLOCK = 1, 3
# Frames and blocks walked before giving up: 1 GiB of JSON is 8,192 full blocks.
_ZSTD_MAX_PARTS = 1 << 20


# Enough of a trace's start to tell it from another file, leading whitespace and all.
TRACE_HEAD_BYTES = 64


def starts_as_trace(head: bytes, compressed: bool) -> bool:
    """Whether bytes start as `parse_trace` will read them: a zstd frame when
    compressed, else a JSON object."""
    if compressed:
        return head.startswith(ZSTD_MAGIC)
    return head.lstrip()[:1] == b"{"


def looks_like_trace(npe_path: Path) -> bool:
    """Whether the file starts as `load_npe_object` will read it."""
    try:
        with npe_path.open("rb") as source:
            head = source.read(TRACE_HEAD_BYTES)
    except OSError:
        return False
    return starts_as_trace(head, npe_path.suffix == ".zst")


def _declared_frame_size(source: BinaryIO) -> Tuple[Optional[int], bool]:
    """After a frame's magic, its declared content size, None where it declares
    none, and whether a checksum follows its last block."""
    head = source.read(1)
    if not head:
        return None, False
    descriptor = head[0]
    single_segment = bool(descriptor & 0x20)
    skipped = (0 if single_segment else 1) + _ZSTD_DICTIONARY_ID_SIZES[
        descriptor & 0x03
    ]
    width = _ZSTD_CONTENT_SIZE_SIZES[descriptor >> 6] or (1 if single_segment else 0)
    field = source.read(skipped + width)[skipped:]
    if not width or len(field) < width:
        return None, False
    size = int.from_bytes(field, "little")
    return (size + 256 if width == 2 else size), bool(descriptor & 0x04)


def _skip_blocks(source: BinaryIO, budget: int) -> Optional[int]:
    """Seek past a frame's blocks: how many there were, None where one is reserved
    or there are more than `budget`. A file cut short ends the walk."""
    blocks = 0
    while blocks < budget:
        header = source.read(3)
        if len(header) < 3:
            return blocks
        blocks += 1
        value = int.from_bytes(header, "little")
        kind = (value >> 1) & 0x03
        if kind == _ZSTD_RESERVED_BLOCK:
            return None
        source.seek(1 if kind == _ZSTD_RLE_BLOCK else value >> 3, os.SEEK_CUR)
        if value & 0x01:
            return blocks
    return None


def trace_size(npe_path: Path) -> Optional[int]:
    """The JSON bytes `load_npe_object` will parse, before reading them: the file's
    size, or the sum of a `.zst`'s declared frame sizes, None where any frame
    declares none or the file is not zstd frames."""
    with npe_path.open("rb") as source:
        if npe_path.suffix != ".zst":
            return os.fstat(source.fileno()).st_size
        return declared_content_size(source)


def declared_content_size(source: BinaryIO) -> Optional[int]:
    """The sum of zstd frames' declared content sizes, from the source's position on,
    None where any frame declares none or the source is not zstd frames."""
    total: Optional[int] = None
    parts = 0
    while magic := source.read(4):
        parts += 1
        if len(magic) < 4 or parts > _ZSTD_MAX_PARTS:
            return None
        if int.from_bytes(magic, "little") & ~0x0F == _ZSTD_SKIPPABLE_MAGIC:
            length = source.read(4)
            if len(length) < 4:
                return None
            source.seek(int.from_bytes(length, "little"), os.SEEK_CUR)
            continue
        if magic != ZSTD_MAGIC:
            return None
        size, checksum = _declared_frame_size(source)
        blocks = None if size is None else _skip_blocks(source, _ZSTD_MAX_PARTS - parts)
        if size is None or blocks is None:
            return None
        parts += blocks
        total = (total or 0) + size
        if checksum:
            source.seek(4, os.SEEK_CUR)
    return total


def _read_only(db_path: Path) -> sqlite3.Connection:
    # Never creates the file, so a probe cannot leave an empty index beside a trace.
    return sqlite3.connect(f"{db_path.resolve().as_uri()}?mode=ro", uri=True)


def _is_index_fresh(db_path: Path, source_mtime_ns: int) -> bool:
    if not db_path.exists():
        return False
    try:
        conn = _read_only(db_path)
        try:
            version = conn.execute(
                "SELECT value FROM meta WHERE key = 'index_version'"
            ).fetchone()
            mtime = conn.execute(
                "SELECT value FROM meta WHERE key = 'source_mtime_ns'"
            ).fetchone()
        finally:
            conn.close()
        if not version or not mtime:
            return False
        return int(version[0]) == INDEX_VERSION and int(mtime[0]) == source_mtime_ns
    # A damaged meta row is a stale index, not a failed request.
    except (sqlite3.Error, TypeError, ValueError):
        return False


def _build_index(npe_path: Path, db_path: Path, source_mtime_ns: int) -> None:
    logger.info(f"Building NPE index for {npe_path} -> {db_path}")
    obj = load_npe_object(npe_path)

    transfers = obj.get("noc_transfers", [])
    timesteps = obj.get("timestep_data", [])

    # Unique tmp path per build so a concurrent build can never unlink or clobber
    # ours (the build lock should prevent concurrency, but this stays correct even
    # if the lock is bypassed). Swapped into place atomically once complete.
    tmp_fd, tmp_name = tempfile.mkstemp(
        prefix=f"{db_path.name}.", suffix=".tmp", dir=db_path.parent
    )
    os.close(tmp_fd)
    tmp_path = Path(tmp_name)

    try:
        conn = sqlite3.connect(tmp_path)
        _write_index(conn, obj, transfers, timesteps, source_mtime_ns)
    except BaseException:
        tmp_path.unlink(missing_ok=True)
        raise

    # Atomic swap so a crashed build never leaves a half-written cache in place.
    tmp_path.replace(db_path)
    logger.info(
        f"NPE index built: {len(transfers)} transfers, {len(timesteps)} timesteps"
    )


def _transfer_id(transfer: dict) -> object:
    """The id `_write_index` stores a transfer under, None for one without. SQLite
    turns it into the row's integer key, or refuses it; see `_transfer_count`."""
    return transfer.get("id")


def _step_cells(step: dict) -> Tuple[Any, Any, Any]:
    """A step's start_cycle, end_cycle and link_demand, as `_write_index` reads them."""
    return step.get("start_cycle"), step.get("end_cycle"), step.get("link_demand", [])


def _write_index(
    conn: sqlite3.Connection,
    obj: dict,
    transfers: list,
    timesteps: list,
    source_mtime_ns: int,
) -> None:
    try:
        # PoC build-time pragmas: durability is irrelevant for a derived cache.
        conn.execute("PRAGMA journal_mode = OFF")
        conn.execute("PRAGMA synchronous = OFF")
        conn.executescript("""
            CREATE TABLE meta (key TEXT PRIMARY KEY, value BLOB);
            CREATE TABLE transfer (id INTEGER PRIMARY KEY, blob BLOB NOT NULL);
            CREATE TABLE timestep (
                t INTEGER PRIMARY KEY,
                start_cycle INTEGER,
                end_cycle INTEGER,
                avg_link_demand REAL,
                avg_link_util REAL,
                max_link_demand REAL,
                mcast_write_link_util REAL,
                active_count INTEGER,
                noc BLOB,
                active_ids BLOB,
                link_demand BLOB
            );
            """)

        conn.executemany(
            "INSERT INTO meta (key, value) VALUES (?, ?)",
            [
                ("index_version", str(INDEX_VERSION)),
                ("source_mtime_ns", str(source_mtime_ns)),
                ("n_timesteps", str(len(timesteps))),
                ("common_info", orjson.dumps(obj.get("common_info", {}))),
                # Optional; `null` when the report supplies none. Stored rather than
                # derived because the windowed path never re-reads the source JSON.
                ("soc_descriptor", orjson.dumps(obj.get("soc_descriptor"))),
                ("chips", orjson.dumps(obj.get("chips", {}))),
                ("zones", orjson.dumps(obj.get("zones", []))),
            ],
        )

        batch = []
        skipped_no_id = 0
        for transfer in transfers:
            tid = _transfer_id(transfer)
            if tid is None:
                # A transfer with no id can't be resolved (active_transfers are id
                # lists) and id is the table PK — skip it rather than KeyError the
                # whole build, which would cache a permanent 500 for the report.
                # The whole-file path renders such reports, so we match that.
                skipped_no_id += 1
                continue
            batch.append((tid, orjson.dumps(transfer)))
            if len(batch) >= _TRANSFER_INSERT_BATCH:
                conn.executemany(
                    "INSERT OR REPLACE INTO transfer (id, blob) VALUES (?, ?)", batch
                )
                batch.clear()
        if batch:
            conn.executemany(
                "INSERT OR REPLACE INTO transfer (id, blob) VALUES (?, ?)", batch
            )
        if skipped_no_id:
            logger.warning(f"NPE index: skipped {skipped_no_id} transfer(s) with no id")

        timestep_rows = []
        for t, step in enumerate(timesteps):
            start_cycle, end_cycle, link_demand = _step_cells(step)
            active_ids = step.get("active_transfers", [])
            link_demand = _truncate_link_demand(link_demand)
            noc = _truncate_noc(step.get("noc", {}))
            max_link_demand = step.get("max_link_demand")
            if max_link_demand is None and link_demand:
                # link_demand is already truncated above, so the worst-link scalar
                # stays consistent with the per-link values the window serves.
                max_link_demand = max(
                    (
                        entry[_LINK_DEMAND_INDEX]
                        for entry in link_demand
                        if len(entry) > _LINK_DEMAND_INDEX
                    ),
                    default=None,
                )
            timestep_rows.append(
                (
                    t,
                    _as_int(start_cycle),
                    _as_int(end_cycle),
                    truncate(step.get("avg_link_demand")),
                    truncate(step.get("avg_link_util")),
                    truncate(max_link_demand),
                    truncate(step.get("mcast_write_link_util")),
                    len(active_ids),
                    orjson.dumps(noc),
                    orjson.dumps(active_ids),
                    orjson.dumps(link_demand),
                )
            )
            if len(timestep_rows) >= _TRANSFER_INSERT_BATCH:
                conn.executemany(
                    "INSERT INTO timestep VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    timestep_rows,
                )
                timestep_rows.clear()
        if timestep_rows:
            conn.executemany(
                "INSERT INTO timestep VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                timestep_rows,
            )

        conn.commit()
    finally:
        conn.close()


def fresh_index(npe_path: str) -> Optional[Path]:
    """The trace's index when one is built and current, or None. Never builds one, for
    a reader that must not write beside the trace."""
    db_path = get_index_path(npe_path)
    try:
        source_mtime_ns = Path(npe_path).stat().st_mtime_ns
    except OSError:
        return None
    return db_path if _is_index_fresh(db_path, source_mtime_ns) else None


# What an index replaced or damaged after `fresh_index` checked it raises while read.
INDEX_READ_ERRORS = (
    sqlite3.Error,
    orjson.JSONDecodeError,
    KeyError,
    TypeError,
    ValueError,
)


class LinkDemand(NamedTuple):
    """A trace's per-timestep link demand, from its current index or the trace."""

    common_info: dict
    transfer_count: int
    # (start_cycle, end_cycle, link_demand) per timestep, in order.
    timesteps: Iterable[Tuple[object, object, object]]
    # Whether float demands are already cut by `truncate`, as the index stores them.
    truncated: bool
    # Timesteps that are not an object, which an index build cannot store.
    unreadable_timesteps: int = 0


def _transfer_count(transfers: object) -> int:
    """Transfers as `_write_index` stores them: one row per id, none without one."""
    if not isinstance(transfers, (list, _Elements)):
        return 0
    ids = set()
    spelled: List[object] = []
    for transfer in transfers:
        if isinstance(transfer, dict):
            tid = _transfer_id(transfer)
            if isinstance(tid, int):
                ids.add(tid)
            elif isinstance(tid, (float, str)):
                spelled.append(tid)
    return len(ids.union(_integer_keys(spelled)))


def _integer_keys(values: List[object]) -> List[int]:
    """The integer keys SQLite stores these as in `_write_index`'s transfer table, by
    asking it: "3.0", "3e0" and " 3" are all 3, and "1_000" and 3.5 are refused."""
    if not values:
        return []
    conn = sqlite3.connect(":memory:")
    try:
        conn.execute("CREATE TABLE transfer (id INTEGER PRIMARY KEY)")
        for value in values:
            # A value it refuses fails `_write_index`'s build, so no index disagrees.
            with contextlib.suppress(sqlite3.Error):
                conn.execute("INSERT OR IGNORE INTO transfer (id) VALUES (?)", (value,))
        return [key for (key,) in conn.execute("SELECT id FROM transfer")]
    finally:
        conn.close()


@contextlib.contextmanager
def indexed_link_demand(npe_path: Path) -> Iterator[Optional[LinkDemand]]:
    """The trace's link demand from its index when that is current, else None. Read
    only; a damaged index raises one of `INDEX_READ_ERRORS` while it is read."""
    db_path = fresh_index(str(npe_path))
    if db_path is None:
        yield None
        return
    conn = _read_only(db_path)
    try:
        meta = dict(conn.execute("SELECT key, value FROM meta").fetchall())
        common_info = orjson.loads(meta["common_info"])
        (transfers,) = conn.execute("SELECT count(*) FROM transfer").fetchone()
        yield LinkDemand(
            _common_info_of(common_info),
            transfers,
            (
                (start, end, orjson.loads(link_demand))
                for start, end, link_demand in conn.execute(
                    "SELECT start_cycle, end_cycle, link_demand FROM timestep ORDER BY t"
                )
            ),
            truncated=True,
        )
    finally:
        conn.close()


_NOT_A_TRACE = "it holds no timestep_data list, so it is not a tt-npe trace"


def _common_info_of(value: object) -> dict:
    """A trace's `common_info` as every read keeps it: an object, else empty."""
    return value if isinstance(value, dict) else {}


def _step_row(step: object) -> Tuple[Any, Any, Any]:
    """A timestep as a read of the trace hands it on: empty where it is not an object."""
    return _step_cells(step) if isinstance(step, dict) else (None, None, [])


def trace_link_demand(trace: object) -> LinkDemand:
    """A parsed trace's link demand, read as `_write_index` would store it: the
    reference `StreamedLinkDemand` is tested against."""
    if not isinstance(trace, dict) or not isinstance(trace.get("timestep_data"), list):
        raise ValueError(_NOT_A_TRACE)
    steps = trace["timestep_data"]
    return LinkDemand(
        _common_info_of(trace.get("common_info")),
        _transfer_count(trace.get("noc_transfers")),
        (_step_row(step) for step in steps),
        truncated=False,
        unreadable_timesteps=sum(1 for step in steps if not isinstance(step, dict)),
    )


def trace_text(data: bytes) -> str:
    """A trace's JSON, one character a byte, for `streamed_link_demand` to scan: a
    character past Latin-1 anywhere would make the whole text two or four bytes a
    character, and orjson checks the UTF-8 itself."""
    return data.decode("latin-1")


_JSON_SPACE = re.compile(r"[ \t\n\r]*")
# Finds where a value ends; orjson then reads it, so each value reads as `parse_trace`
# would read it, and a refusal falls where its refusal would.
_VALUE_END = json.JSONDecoder()
# orjson reads arrays and objects nested this deep and refuses deeper; so does the
# streamed read, whatever its caller's stack, so every read of a trace agrees.
MAX_JSON_DEPTH = 1024
# Before Python 3.12 the stdlib scanner's recursion counts against the interpreter's
# limit, part of which the caller's own frames have used.
RECURSION_HEADROOM = MAX_JSON_DEPTH + 64
# orjson 3.13 and later, then the locked 3.11 and earlier.
_ORJSON_TOO_DEEP = ("depth limit exceeded", "array and object recursion depth exceeded")


class NestsTooDeep(ValueError):
    """Arrays and objects nested past `MAX_JSON_DEPTH`, which the whole parse refuses."""

    def __init__(self) -> None:
        super().__init__(
            f"it nests more than {MAX_JSON_DEPTH:,} arrays and objects deep"
        )


class StreamedLinkDemand:
    """`trace_link_demand` of a trace's text, read a timestep at a time rather than
    parsed whole, so the read never holds the parsed trace. #2275"""

    truncated = False

    def __init__(self, text: str) -> None:
        self._common_info: dict = {}
        self._transfer_count = 0
        self._unreadable_timesteps = 0
        self._read_through = False
        self.timesteps: Iterator[Tuple[Any, Any, Any]] = self._walk(text)

    @property
    def common_info(self) -> dict:
        return self._final(self._common_info)

    @property
    def transfer_count(self) -> int:
        return self._final(self._transfer_count)

    @property
    def unreadable_timesteps(self) -> int:
        return self._final(self._unreadable_timesteps)

    def _final(self, field: Any) -> Any:
        # Read before the timesteps, a field would be its default, not the trace's.
        if not self._read_through:
            raise RuntimeError("read the timesteps through before the other fields")
        return field

    def _walk(self, text: str) -> Iterator[Tuple[Any, Any, Any]]:
        at = _space(text, 0)
        if not text.startswith("{", at):
            # Read through first: what the whole parse cannot read is refused as such.
            _at_end(text, _past_value(text, at, 0))
            raise ValueError(_NOT_A_TRACE)
        at = _space(text, at + 1)
        steps_read = False
        while not text.startswith("}", at):
            key, at = _key(text, at)
            if key == "timestep_data" and steps_read:
                # orjson keeps the last of two, and the first has already been read.
                raise ValueError("it names timestep_data twice")
            if text.startswith("[", at):
                values = _Elements(text, at, 1)
                steps_read = steps_read or key == "timestep_data"
                yield from self._array(key, values)
                at = values.end
            else:
                value, at = _value(text, at, 1)
                self._take(key, value)
            at = _after_member(text, at, "}")
        _at_end(text, at + 1)
        if not steps_read:
            raise ValueError(_NOT_A_TRACE)
        self._read_through = True

    def _array(self, key: str, values: "_Elements") -> Iterator[Tuple[Any, Any, Any]]:
        """A member whose value is an array, its elements read one at a time."""
        if key == "noc_transfers":
            self._transfer_count = _transfer_count(values)
            return
        if key == "common_info":
            # The last of two is the one kept, as orjson keeps it.
            self._common_info = {}
        for value in values:
            if key != "timestep_data":
                continue
            if not isinstance(value, dict):
                self._unreadable_timesteps += 1
            yield _step_row(value)

    def _take(self, key: str, value: object) -> None:
        """A member whose value is not an array."""
        if key == "common_info":
            self._common_info = _common_info_of(value)
        elif key == "noc_transfers":
            self._transfer_count = _transfer_count(value)


class _Elements:
    """Each element of the array at `at`, inside `depth` arrays and objects, read by
    orjson; `end` is past it once read."""

    def __init__(self, text: str, at: int, depth: int) -> None:
        self.text, self.at, self.end, self.depth = text, at, at, depth

    def __iter__(self) -> Iterator[object]:
        text = self.text
        at = _space(text, self.at + 1)
        if text.startswith("]", at):
            self.end = at + 1
            return
        while True:
            value, at = _value(text, at, self.depth + 1)
            yield value
            at = _after_member(text, at, "]")
            if text.startswith("]", at):
                self.end = at + 1
                return


def _space(text: str, at: int) -> int:
    return cast(re.Match, _JSON_SPACE.match(text, at)).end()


def _value(text: str, at: int, depth: int) -> Tuple[object, int]:
    """orjson's read of the value at `at`, inside `depth` arrays and objects, and where
    it ends."""
    limit = sys.getrecursionlimit()
    sys.setrecursionlimit(limit + RECURSION_HEADROOM)
    try:
        # Only the end: the scanner's object is let go before orjson builds its own.
        end = _VALUE_END.raw_decode(text, at)[1]
    except RecursionError:
        raise NestsTooDeep() from None
    finally:
        sys.setrecursionlimit(limit)
    # Wrapped as deep as it sits, so orjson's depth limit is the whole parse's.
    wrapped = b"[" * depth + text[at:end].encode("latin-1") + b"]" * depth
    try:
        value = orjson.loads(wrapped)
    except orjson.JSONDecodeError as error:
        if error.msg in _ORJSON_TOO_DEEP:
            raise NestsTooDeep() from None
        # Where in the trace, as the whole parse would say, not where in the value.
        raise json.JSONDecodeError(error.msg, text, at + error.pos - depth) from None
    for _ in range(depth):
        value = cast(list, value)[0]
    return value, end


def _past_value(text: str, at: int, depth: int) -> int:
    """Past the value at `at`, read as `_value` reads it, an array an element at a time."""
    if text.startswith("[", at):
        values = _Elements(text, at, depth)
        for _ in values:
            pass
        return values.end
    return _value(text, at, depth)[1]


def _at_end(text: str, at: int) -> None:
    """Refuse anything but whitespace from `at` on, as the whole parse does."""
    end = _space(text, at)
    if end < len(text):
        _refuse(text, end, "Extra data")


def _key(text: str, at: int) -> Tuple[str, int]:
    """The member name at `at` as orjson reads it, and where its value starts."""
    if not text.startswith('"', at):
        _refuse(text, at, "Expecting property name enclosed in double quotes")
    key, at = _value(text, at, 1)
    at = _space(text, at)
    if not text.startswith(":", at):
        _refuse(text, at, "Expecting ':' delimiter")
    return cast(str, key), _space(text, at + 1)


def _after_member(text: str, at: int, close: str) -> int:
    """Past the comma after a member, or at the bracket that closes its container."""
    at = _space(text, at)
    if text.startswith(",", at):
        at = _space(text, at + 1)
        if text.startswith(close, at):
            _refuse(text, at, "Expecting a value after ','")
        return at
    if not text.startswith(close, at):
        _refuse(text, at, f"Expecting ',' or '{close}'")
    return at


def _refuse(text: str, at: int, reason: str) -> NoReturn:
    """A refusal of the JSON at `at`, where the whole parse would refuse it."""
    raise json.JSONDecodeError(reason, text, at)


def streamed_link_demand(text: str) -> StreamedLinkDemand:
    """The link demand of a trace's text, read a timestep at a time."""
    return StreamedLinkDemand(text)


def ensure_index(npe_path: str) -> Path:
    source = Path(npe_path)
    if not source.exists():
        raise FileNotFoundError(npe_path)

    db_path = get_index_path(npe_path)
    source_mtime_ns = source.stat().st_mtime_ns
    if _is_index_fresh(db_path, source_mtime_ns):
        return db_path

    # Single-flight the expensive build. NpeWindowedView fires summary + window(0)
    # on mount, so two workers hit a cold cache concurrently; without this guard
    # both parse the whole report and race on the output file.
    with _build_guard(db_path):
        # Re-check under the guard — another worker may have built it while we waited.
        if not _is_index_fresh(db_path, source_mtime_ns):
            _build_index(source, db_path, source_mtime_ns)
    return db_path


def read_summary(db_path: Path) -> dict:
    conn = sqlite3.connect(db_path)
    try:
        meta = dict(conn.execute("SELECT key, value FROM meta").fetchall())
        # _SUMMARY_COLUMNS are hardcoded constants, not user input — safe to inline.
        rows = conn.execute(
            f"SELECT {', '.join(_SUMMARY_COLUMNS)} FROM timestep ORDER BY t"
        ).fetchall()
    finally:
        conn.close()

    # Columnar wire format: one array per column instead of a dict-per-step, so the
    # ~54k-step summary drops from ~9 MB to ~2.6 MB (repeated JSON keys were the
    # bulk). `t` is the array index (timesteps are contiguous 0..n-1), so it isn't
    # sent. SELECT + dict share _SUMMARY_COLUMNS so their order can't drift apart.
    columns = list(zip(*rows)) if rows else [()] * len(_SUMMARY_COLUMNS)
    timesteps = {col: columns[i] for i, col in enumerate(_SUMMARY_COLUMNS)}

    return {
        "common_info": orjson.loads(meta["common_info"]),
        # `.get` rather than `[...]`: an index written before this key existed is
        # still readable, and a rebuild is only triggered by INDEX_VERSION.
        "soc_descriptor": orjson.loads(meta.get("soc_descriptor") or b"null"),
        "chips": orjson.loads(meta["chips"]),
        "zones": orjson.loads(meta["zones"]),
        "n_timesteps": int(meta["n_timesteps"]),
        "timesteps": timesteps,
    }


def read_window(db_path: Path, t: int) -> Optional[dict]:
    conn = sqlite3.connect(db_path)
    try:
        row = conn.execute(
            "SELECT avg_link_demand, avg_link_util, max_link_demand, "
            "mcast_write_link_util, noc, active_ids, link_demand "
            "FROM timestep WHERE t = ?",
            (t,),
        ).fetchone()
        if row is None:
            return None

        active_ids = orjson.loads(row[5])
        transfers: list = []
        # Chunk the IN-list: a busy timestep can have more active transfers than
        # SQLITE_MAX_VARIABLE_NUMBER (999 on sqlite < 3.32), which would otherwise
        # raise OperationalError and make that window permanently un-viewable.
        for start in range(0, len(active_ids), _TRANSFER_QUERY_CHUNK):
            chunk = active_ids[start : start + _TRANSFER_QUERY_CHUNK]
            placeholders = ",".join("?" * len(chunk))
            transfers.extend(
                orjson.loads(blob)
                for (blob,) in conn.execute(
                    f"SELECT blob FROM transfer WHERE id IN ({placeholders})",
                    chunk,
                )
            )
    finally:
        conn.close()

    return {
        "t": t,
        "timestep": {
            "active_transfers": active_ids,
            "avg_link_demand": row[0],
            "avg_link_util": row[1],
            "max_link_demand": row[2],
            "mcast_write_link_util": row[3],
            "noc": orjson.loads(row[4]),
            "link_demand": orjson.loads(row[6]),
        },
        "transfers": transfers,
    }
