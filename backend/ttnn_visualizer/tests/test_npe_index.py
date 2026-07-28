# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Tests for the #861 NPE windowed-loading index.

Covers the SQLite index build/read helpers in ``npe_index``: columnar summary
shape, freshness/version invalidation, windowed reads, the chunked IN-list for
busy timesteps, and the single-flight build lock under concurrency.
"""

import os
import threading
import time
from pathlib import Path

import orjson
import pytest
import zstd
from ttnn_visualizer import npe_index
from ttnn_visualizer.npe_index import (
    INDEX_VERSION,
    _as_int,
    _truncate,
    ensure_index,
    read_summary,
    read_window,
)


def _make_npe_object(n_transfers: int = 3, n_timesteps: int = 4) -> dict:
    transfers = [
        {
            "id": i,
            "src": [0, 0, 0],
            "dst": [[0, 1, 1]],
            "total_bytes": 128,
            "route": [],
        }
        for i in range(n_transfers)
    ]
    timesteps = []
    for t in range(n_timesteps):
        # First step idle so the "first active step" auto-jump has something to find.
        active = [] if t == 0 else list(range(n_transfers))
        timesteps.append(
            {
                "start_cycle": float(t * 10),
                "end_cycle": float(t * 10 + 9),
                "active_transfers": active,
                # Real reports emit 5-tuples [chip, y, x, noc_id, demand]; the
                # fabric-event scope (slot 5) is computed client-side, not stored.
                "link_demand": (
                    [[0, 0, 0, "NOC0_EAST", 224.80001831054688]] if active else []
                ),
                "noc": {
                    "NOC0": {"avg_link_demand": 12.3456, "avg_link_util": 7.891},
                    "NOC1": {"avg_link_demand": 0.0, "avg_link_util": 0.0},
                },
                "avg_link_demand": 12.3456,
                "avg_link_util": 7.891,
                "mcast_write_link_util": 1.2345,
            }
        )
    return {
        "common_info": {"version": "1.0.0", "arch": "wormhole_b0"},
        "chips": {"0": {}},
        "zones": [],
        "noc_transfers": transfers,
        "timestep_data": timesteps,
    }


def _write_npe(tmp_path: Path, obj: dict, name: str = "trace.json") -> str:
    path = tmp_path / name
    path.write_bytes(orjson.dumps(obj))
    return str(path)


def _write_npe_zst(tmp_path: Path, obj: dict, name: str = "trace.npeviz.zst") -> str:
    path = tmp_path / name
    path.write_bytes(zstd.compress(orjson.dumps(obj)))
    return str(path)


def test_truncate_and_as_int_helpers():
    assert _truncate(224.80001831054688) == pytest.approx(224.8)
    assert _truncate(None) is None
    assert _as_int(5.0) == 5
    assert _as_int(None) is None


def test_read_summary_is_columnar(tmp_path):
    npe_path = _write_npe(tmp_path, _make_npe_object(n_timesteps=4))
    summary = read_summary(ensure_index(npe_path))

    assert summary["n_timesteps"] == 4
    assert summary["common_info"]["version"] == "1.0.0"
    # Columnar: parallel arrays, not one dict per step, and `t` is not sent.
    timesteps = summary["timesteps"]
    assert isinstance(timesteps, dict)
    assert "t" not in timesteps
    for key in ("start_cycle", "avg_link_demand", "max_link_demand", "active_count"):
        assert len(timesteps[key]) == 4
    # Idle step 0 vs active steps.
    assert timesteps["active_count"][0] == 0
    assert timesteps["active_count"][1] == 3
    # Floats are truncated to 3 dp at build time.
    assert timesteps["avg_link_demand"][1] == pytest.approx(12.345)


def test_summary_max_link_demand_values(tmp_path):
    # Values, not just array lengths: idle step 0 has no link_demand and no source
    # scalar → derived None; active steps derive the worst-link scalar from
    # link_demand (source omits it) and truncate to 3 dp, so the timeline heat-bar
    # fallback stays consistent with the per-link values the window serves. A broken
    # derivation would silently paint the fallback rows wrong.
    npe_path = _write_npe(tmp_path, _make_npe_object(n_timesteps=4))
    summary = read_summary(ensure_index(npe_path))
    max_demand = summary["timesteps"]["max_link_demand"]

    assert max_demand[0] is None
    assert max_demand[1] == pytest.approx(224.8)


def test_read_window_resolves_active_transfers(tmp_path):
    npe_path = _write_npe(tmp_path, _make_npe_object(n_transfers=3, n_timesteps=4))
    db_path = ensure_index(npe_path)

    window = read_window(db_path, 1)
    assert window is not None
    assert window["t"] == 1
    assert window["timestep"]["active_transfers"] == [0, 1, 2]
    assert len(window["transfers"]) == 3
    assert {tr["id"] for tr in window["transfers"]} == {0, 1, 2}
    # Idle step has no transfers.
    idle = read_window(db_path, 0)
    assert idle is not None
    assert idle["transfers"] == []


def test_read_summary_empty_trace(tmp_path):
    # A valid but empty trace: the columnar summary must round-trip to 7 empty
    # arrays + n_timesteps 0 (not raise), so the client can render an empty state.
    npe_path = _write_npe(tmp_path, _make_npe_object(n_timesteps=0))
    summary = read_summary(ensure_index(npe_path))

    assert summary["n_timesteps"] == 0
    timesteps = summary["timesteps"]
    for key in (
        "start_cycle",
        "end_cycle",
        "avg_link_demand",
        "avg_link_util",
        "max_link_demand",
        "mcast_write_link_util",
        "active_count",
    ):
        assert len(timesteps[key]) == 0


def test_read_window_strips_trailing_null_scope(tmp_path):
    # A report that carries an explicit null fabric-scope must reach the wire as a
    # 5-tuple, not [..., null] — the frontend reads slot 5 as unset only when it's
    # absent (undefined), and a null would mis-annotate the scope.
    obj = _make_npe_object(n_transfers=1, n_timesteps=2)
    obj["timestep_data"][1]["link_demand"] = [[0, 0, 0, "NOC0_EAST", 10.0, None]]
    db_path = ensure_index(_write_npe(tmp_path, obj))

    window = read_window(db_path, 1)
    assert window is not None
    row = window["timestep"]["link_demand"][0]
    assert len(row) == 5
    assert row == [0, 0, 0, "NOC0_EAST", 10.0]


def test_read_window_out_of_range_returns_none(tmp_path):
    npe_path = _write_npe(tmp_path, _make_npe_object(n_timesteps=2))
    db_path = ensure_index(npe_path)
    assert read_window(db_path, 99) is None
    assert read_window(db_path, -1) is None


def test_read_window_chunks_large_active_id_list(tmp_path):
    # More active transfers than SQLITE_MAX_VARIABLE_NUMBER would allow in a single
    # IN(...) — must be chunked, not raise OperationalError.
    n = 2500
    obj = _make_npe_object(n_transfers=n, n_timesteps=1)
    obj["timestep_data"][0]["active_transfers"] = list(range(n))
    obj["timestep_data"][0]["link_demand"] = [[0, 0, 0, "NOC0_EAST", 10.0]]
    db_path = ensure_index(_write_npe(tmp_path, obj))

    window = read_window(db_path, 0)
    assert window is not None
    assert len(window["transfers"]) == n


def test_zst_source_round_trips(tmp_path):
    # Production reports are zstd-compressed (.npeviz.zst); the .json fixtures skip
    # the zstd.uncompress branch of _load_npe_object entirely, so cover it here.
    npe_path = _write_npe_zst(tmp_path, _make_npe_object(n_transfers=3, n_timesteps=4))
    db_path = ensure_index(npe_path)

    summary = read_summary(db_path)
    assert summary["n_timesteps"] == 4
    window = read_window(db_path, 1)
    assert window is not None
    assert len(window["transfers"]) == 3


def test_index_rebuilds_on_source_mtime_change(tmp_path):
    # The re-upload path: same filename, new contents. Freshness keys on
    # source_mtime_ns, so a rewritten file must invalidate the cache even though
    # INDEX_VERSION is unchanged.
    npe_path = _write_npe(tmp_path, _make_npe_object(n_timesteps=3))
    assert read_summary(ensure_index(npe_path))["n_timesteps"] == 3

    # Rewrite the same path with a different shape; force a strictly newer mtime so
    # the test doesn't flake when both writes land in the same filesystem tick.
    Path(npe_path).write_bytes(orjson.dumps(_make_npe_object(n_timesteps=7)))
    future = time.time() + 10
    os.utime(npe_path, (future, future))

    assert read_summary(ensure_index(npe_path))["n_timesteps"] == 7


def test_build_skips_transfer_without_id(tmp_path):
    # A transfer missing 'id' must not KeyError the whole build — that failure is
    # cached and would 500 the report permanently on both routes, while the
    # whole-file path renders it. Skip the malformed transfer, keep the rest.
    obj = _make_npe_object(n_transfers=2, n_timesteps=2)
    obj["noc_transfers"].append(
        {"src": [0, 0, 0], "dst": [[0, 1, 1]], "total_bytes": 64, "route": []}
    )
    db_path = ensure_index(_write_npe(tmp_path, obj))  # must not raise

    assert read_summary(db_path)["n_timesteps"] == 2
    window = read_window(db_path, 1)
    assert window is not None
    assert {tr["id"] for tr in window["transfers"]} == {0, 1}


def test_index_rebuilds_on_version_bump(tmp_path, monkeypatch):
    npe_path = _write_npe(tmp_path, _make_npe_object())
    ensure_index(npe_path)

    calls = []
    real_build = npe_index._build_index

    def counting_build(*args, **kwargs):
        calls.append(1)
        return real_build(*args, **kwargs)

    monkeypatch.setattr(npe_index, "_build_index", counting_build)

    # Same version → cache hit, no rebuild.
    ensure_index(npe_path)
    assert calls == []

    # Bumped version → stale cache, rebuild.
    monkeypatch.setattr(npe_index, "INDEX_VERSION", INDEX_VERSION + 1)
    ensure_index(npe_path)
    assert len(calls) == 1


def test_concurrent_ensure_index_builds_once(tmp_path, monkeypatch):
    npe_path = _write_npe(tmp_path, _make_npe_object(n_timesteps=6))

    calls = []
    real_build = npe_index._build_index

    def counting_build(*args, **kwargs):
        calls.append(1)
        return real_build(*args, **kwargs)

    monkeypatch.setattr(npe_index, "_build_index", counting_build)

    n_threads = 8
    barrier = threading.Barrier(n_threads)
    results: list = []

    def worker():
        barrier.wait()  # release all threads onto the cold cache at once
        results.append(ensure_index(npe_path))

    threads = [threading.Thread(target=worker) for _ in range(n_threads)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    # Single-flight: exactly one build despite the concurrent cold-cache stampede.
    assert len(calls) == 1
    # Every worker got a usable, non-corrupt index.
    summary = read_summary(results[0])
    assert summary["n_timesteps"] == 6
