# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Tests for the #861 NPE windowed-loading index.

Covers the SQLite index build/read helpers in ``npe_index``: columnar summary
shape, freshness/version invalidation, windowed reads, the chunked IN-list for
busy timesteps, and the single-flight build lock under concurrency.
"""

import threading
from pathlib import Path

import orjson
import pytest
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
                "link_demand": (
                    [[0, 0, 0, "NOC0_EAST", 224.80001831054688, None]] if active else []
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
    obj["timestep_data"][0]["link_demand"] = [[0, 0, 0, "NOC0_EAST", 10.0, None]]
    db_path = ensure_index(_write_npe(tmp_path, obj))

    window = read_window(db_path, 0)
    assert window is not None
    assert len(window["transfers"]) == n


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
