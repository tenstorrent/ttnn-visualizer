# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Proof-of-concept on-demand index for large NPE reports (#861).

A single NPE report can decompress to ~900 MB of JSON, which the browser cannot
parse in one shot (V8 string limit) and which no one ever views in full — a seek
renders only the transfers active at one timestep (~tens of them). This builds a
timestep-keyed SQLite index once, so the frontend can fetch just the visible
window (~135 KB) instead of the whole payload.

The build parses the whole object in memory (matches the current read path); a
streaming parse to bound peak RSS is a follow-up for the multi-user hosted path.
"""

import contextlib
import logging
import os
import sqlite3
import tempfile
import threading
from pathlib import Path
from typing import Iterable, Iterator, NamedTuple, Optional, Tuple

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
            entry[_LINK_DEMAND_INDEX] = (
                int(entry[_LINK_DEMAND_INDEX] * _TRUNCATE_SCALE) / _TRUNCATE_SCALE
            )
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
                noc_data[key] = int(value * _TRUNCATE_SCALE) / _TRUNCATE_SCALE
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
    if npe_path.suffix == ".zst":
        return orjson.loads(zstd.uncompress(npe_path.read_bytes()))
    return orjson.loads(npe_path.read_bytes())


_ZSTD_MAGIC = b"\x28\xb5\x2f\xfd"
# Frame_Header_Descriptor's field sizes, by flag (RFC 8878, 3.1.1.1.1).
_ZSTD_DICTIONARY_ID_SIZES = (0, 1, 2, 4)
_ZSTD_CONTENT_SIZE_SIZES = (0, 2, 4, 8)


def _head(npe_path: Path, size: int) -> bytes:
    with npe_path.open("rb") as source:
        return source.read(size)


def looks_like_trace(npe_path: Path) -> bool:
    """Whether the file starts as `load_npe_object` will read it: a zstd frame for
    `.zst`, else a JSON object."""
    try:
        head = _head(npe_path, 64)
    except OSError:
        return False
    if npe_path.suffix == ".zst":
        return head.startswith(_ZSTD_MAGIC)
    return head.lstrip()[:1] == b"{"


def trace_size(npe_path: Path) -> Optional[int]:
    """The JSON bytes `load_npe_object` will parse, before reading them: the file's
    size, or a `.zst` frame's declared content size, None where it declares none."""
    if npe_path.suffix != ".zst":
        return npe_path.stat().st_size
    head = _head(npe_path, 18)
    if len(head) < 6 or not head.startswith(_ZSTD_MAGIC):
        return None
    descriptor = head[4]
    single_segment = bool(descriptor & 0x20)
    position = 5 + (0 if single_segment else 1)
    position += _ZSTD_DICTIONARY_ID_SIZES[descriptor & 0x03]
    width = _ZSTD_CONTENT_SIZE_SIZES[descriptor >> 6] or (1 if single_segment else 0)
    if not width or len(head) < position + width:
        return None
    size = int.from_bytes(head[position : position + width], "little")
    return size + 256 if width == 2 else size


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
            tid = transfer.get("id")
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
            active_ids = step.get("active_transfers", [])
            link_demand = _truncate_link_demand(step.get("link_demand", []))
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
                    _as_int(step.get("start_cycle")),
                    _as_int(step.get("end_cycle")),
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


def transfer_count(transfers: object) -> int:
    """Transfers as `_write_index` stores them: one row per id, none without one."""
    if not isinstance(transfers, list):
        return 0
    ids = set()
    for transfer in transfers:
        if isinstance(transfer, dict):
            tid = transfer.get("id")
            if isinstance(tid, str):
                # SQLite keys a numeric string as the integer it spells.
                try:
                    tid = int(tid)
                except ValueError:
                    pass
            if isinstance(tid, (int, float, str)):
                ids.add(tid)
    return len(ids)


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
            common_info if isinstance(common_info, dict) else {},
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


def trace_link_demand(trace: object) -> LinkDemand:
    """A parsed trace's link demand, read as `_write_index` would store it."""
    if not isinstance(trace, dict) or not isinstance(trace.get("timestep_data"), list):
        raise ValueError("it holds no timestep_data list, so it is not a tt-npe trace")
    steps = trace["timestep_data"]
    common_info = trace.get("common_info")
    return LinkDemand(
        common_info if isinstance(common_info, dict) else {},
        transfer_count(trace.get("noc_transfers")),
        (
            (
                (
                    step.get("start_cycle"),
                    step.get("end_cycle"),
                    step.get("link_demand", []),
                )
                if isinstance(step, dict)
                else (None, None, [])
            )
            for step in steps
        ),
        truncated=False,
        unreadable_timesteps=sum(1 for step in steps if not isinstance(step, dict)),
    )


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
