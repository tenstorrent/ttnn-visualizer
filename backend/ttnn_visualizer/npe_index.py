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

import logging
import sqlite3
from pathlib import Path
from typing import Optional

import orjson
import zstd

logger = logging.getLogger(__name__)

INDEX_SUFFIX = ".npeidx.sqlite"

# Bump when the schema or build logic changes so stale caches are rebuilt.
INDEX_VERSION = 2

_TRANSFER_INSERT_BATCH = 5000

# link_demand rows are [chip_id, y, x, noc_id, demand] — mirrors NPE_LINK.DEMAND
# in the frontend model. Used to precompute each step's worst-link demand for the
# timeline heat bar, since the source JSON doesn't carry a per-step scalar.
_LINK_DEMAND_INDEX = 4


def get_index_path(npe_path: str) -> Path:
    return Path(f"{npe_path}{INDEX_SUFFIX}")


def _load_npe_object(npe_path: Path) -> dict:
    if npe_path.suffix == ".zst":
        return orjson.loads(zstd.uncompress(npe_path.read_bytes()))
    return orjson.loads(npe_path.read_bytes())


def _is_index_fresh(db_path: Path, source_mtime_ns: int) -> bool:
    if not db_path.exists():
        return False
    try:
        conn = sqlite3.connect(db_path)
        try:
            version = conn.execute(
                "SELECT value FROM meta WHERE key = 'index_version'"
            ).fetchone()
            mtime = conn.execute(
                "SELECT value FROM meta WHERE key = 'source_mtime_ns'"
            ).fetchone()
        finally:
            conn.close()
    except sqlite3.Error:
        return False

    if not version or not mtime:
        return False
    return int(version[0]) == INDEX_VERSION and int(mtime[0]) == source_mtime_ns


def _build_index(npe_path: Path, db_path: Path, source_mtime_ns: int) -> None:
    logger.info(f"Building NPE index for {npe_path} -> {db_path}")
    obj = _load_npe_object(npe_path)

    transfers = obj.get("noc_transfers", [])
    timesteps = obj.get("timestep_data", [])

    tmp_path = db_path.with_suffix(db_path.suffix + ".tmp")
    if tmp_path.exists():
        tmp_path.unlink()

    conn = sqlite3.connect(tmp_path)
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
                ("chips", orjson.dumps(obj.get("chips", {}))),
                ("zones", orjson.dumps(obj.get("zones", []))),
            ],
        )

        batch = []
        for transfer in transfers:
            batch.append((transfer["id"], orjson.dumps(transfer)))
            if len(batch) >= _TRANSFER_INSERT_BATCH:
                conn.executemany(
                    "INSERT OR REPLACE INTO transfer (id, blob) VALUES (?, ?)", batch
                )
                batch.clear()
        if batch:
            conn.executemany(
                "INSERT OR REPLACE INTO transfer (id, blob) VALUES (?, ?)", batch
            )

        timestep_rows = []
        for t, step in enumerate(timesteps):
            active_ids = step.get("active_transfers", [])
            link_demand = step.get("link_demand", [])
            max_link_demand = step.get("max_link_demand")
            if max_link_demand is None and link_demand:
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
                    step.get("start_cycle"),
                    step.get("end_cycle"),
                    step.get("avg_link_demand"),
                    step.get("avg_link_util"),
                    max_link_demand,
                    step.get("mcast_write_link_util"),
                    len(active_ids),
                    orjson.dumps(step.get("noc", {})),
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

    # Atomic swap so a crashed build never leaves a half-written cache in place.
    tmp_path.replace(db_path)
    logger.info(
        f"NPE index built: {len(transfers)} transfers, {len(timesteps)} timesteps"
    )


def ensure_index(npe_path: str) -> Path:
    source = Path(npe_path)
    if not source.exists():
        raise FileNotFoundError(npe_path)

    db_path = get_index_path(npe_path)
    source_mtime_ns = source.stat().st_mtime_ns
    if not _is_index_fresh(db_path, source_mtime_ns):
        _build_index(source, db_path, source_mtime_ns)
    return db_path


def read_summary(db_path: Path) -> dict:
    conn = sqlite3.connect(db_path)
    try:
        meta = dict(conn.execute("SELECT key, value FROM meta").fetchall())
        timesteps = [
            {
                "t": row[0],
                "start_cycle": row[1],
                "end_cycle": row[2],
                "avg_link_demand": row[3],
                "avg_link_util": row[4],
                "max_link_demand": row[5],
                "mcast_write_link_util": row[6],
                "active_count": row[7],
            }
            for row in conn.execute(
                "SELECT t, start_cycle, end_cycle, avg_link_demand, avg_link_util, "
                "max_link_demand, mcast_write_link_util, active_count "
                "FROM timestep ORDER BY t"
            )
        ]
    finally:
        conn.close()

    return {
        "common_info": orjson.loads(meta["common_info"]),
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
        transfers = []
        if active_ids:
            placeholders = ",".join("?" * len(active_ids))
            transfers = [
                orjson.loads(blob)
                for (blob,) in conn.execute(
                    f"SELECT blob FROM transfer WHERE id IN ({placeholders})",
                    active_ids,
                )
            ]
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
