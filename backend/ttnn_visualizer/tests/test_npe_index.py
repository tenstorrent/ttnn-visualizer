# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Tests for the #861 NPE windowed-loading index.

Covers the SQLite index build/read helpers in ``npe_index``: columnar summary
shape, freshness/version invalidation, windowed reads, the chunked IN-list for
busy timesteps, and the single-flight build lock under concurrency. Also the
readers `noc_congestion` uses, which must never write beside the trace (#2156).
"""

import json
import os
import random
import sqlite3
import sys
import threading
import time
import tracemalloc
from pathlib import Path

import orjson
import pytest
import zstd
from ttnn_visualizer import npe_index
from ttnn_visualizer.npe_index import (
    INDEX_READ_ERRORS,
    INDEX_VERSION,
    ZSTD_MAGIC,
    _as_int,
    _transfer_count,
    ensure_index,
    fresh_index,
    get_index_path,
    indexed_link_demand,
    looks_like_trace,
    read_summary,
    read_window,
    streamed_link_demand,
    trace_link_demand,
    trace_size,
    trace_text,
    truncate,
)
from ttnn_visualizer.tests.npe_fixtures import execute, listing


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
    assert truncate(224.80001831054688) == pytest.approx(224.8)
    assert truncate(None) is None
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


# Shape of a Quasar-32 emulation part: the case the override exists for, and the
# one that reaches the frontend through this index rather than the whole-file
# path, because uploads take the windowed route locally. #1776
SOC_DESCRIPTOR = {
    "arch_name": "QUASAR",
    "grid": {"x_size": 10, "y_size": 8},
    "functional_workers": ["2-2", "3-2", "4-2"],
    "dram": [["2-7"], ["4-0"]],
    "router_only": ["0-2"],
    "arc": [],
    "pcie": [],
    "eth": [],
    "worker_l1_size": 4194304,
}


def test_soc_descriptor_round_trips_through_the_index(tmp_path):
    """A report-supplied SoC descriptor must survive `ensure_index` unchanged.

    Frontend parser tests cannot reach this: the descriptor is JSON-encoded into a
    `meta` row and decoded back out, so a regression here would drop the field for
    every uploaded report while every frontend test still passed. #1776
    """
    obj = _make_npe_object()
    obj["soc_descriptor"] = SOC_DESCRIPTOR
    npe_path = _write_npe(tmp_path, obj)

    summary = read_summary(ensure_index(npe_path))

    assert summary["soc_descriptor"] == SOC_DESCRIPTOR


def test_soc_descriptor_round_trips_from_a_compressed_report(tmp_path):
    # The format uploads actually arrive in.
    obj = _make_npe_object()
    obj["soc_descriptor"] = SOC_DESCRIPTOR
    npe_path = _write_npe_zst(tmp_path, obj)

    summary = read_summary(ensure_index(npe_path))

    assert summary["soc_descriptor"]["grid"] == {"x_size": 10, "y_size": 8}
    assert summary["soc_descriptor"]["functional_workers"] == ["2-2", "3-2", "4-2"]


def test_summary_reports_no_soc_descriptor_when_the_report_has_none(tmp_path):
    # `None`, not a missing key: the frontend treats absent as "fall back to the
    # baked lookup", and a KeyError here would be a 500 for every legacy report.
    npe_path = _write_npe(tmp_path, _make_npe_object())

    summary = read_summary(ensure_index(npe_path))

    assert "soc_descriptor" in summary
    assert summary["soc_descriptor"] is None


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
    # the zstd.uncompress branch of load_npe_object entirely, so cover it here.
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


def _row_count(db_path: Path, table: str) -> int:
    conn = sqlite3.connect(db_path)
    try:
        return conn.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
    finally:
        conn.close()


def _set_meta(db_path: Path, key: str, value) -> None:
    execute(db_path, "UPDATE meta SET value = ? WHERE key = ?", value, key)


def _counted_builds(monkeypatch) -> list:
    builds: list = []
    real_build = npe_index._build_index

    def counting_build(*args, **kwargs):
        builds.append(1)
        return real_build(*args, **kwargs)

    monkeypatch.setattr(npe_index, "_build_index", counting_build)
    return builds


_NOT_CURRENT = {
    "stale-version": lambda npe_path, db_path: _set_meta(
        db_path, "index_version", str(INDEX_VERSION - 1)
    ),
    "other-source-mtime": lambda npe_path, db_path: _set_meta(
        db_path, "source_mtime_ns", str(Path(npe_path).stat().st_mtime_ns + 1)
    ),
    "not-sqlite": lambda npe_path, db_path: db_path.write_bytes(b"not an index " * 64),
    "empty-file": lambda npe_path, db_path: db_path.write_bytes(b""),
    "text-version": lambda npe_path, db_path: _set_meta(
        db_path, "index_version", "abc"
    ),
    "null-version": lambda npe_path, db_path: _set_meta(db_path, "index_version", None),
    "text-source-mtime": lambda npe_path, db_path: _set_meta(
        db_path, "source_mtime_ns", "abc"
    ),
    "null-source-mtime": lambda npe_path, db_path: _set_meta(
        db_path, "source_mtime_ns", None
    ),
    "no-source-mtime-row": lambda npe_path, db_path: execute(
        db_path, "DELETE FROM meta WHERE key = 'source_mtime_ns'"
    ),
    "no-meta-table": lambda npe_path, db_path: execute(db_path, "DROP TABLE meta"),
    "trace-gone": lambda npe_path, db_path: Path(npe_path).unlink(),
}


def test_an_index_under_a_path_with_uri_characters_is_found_and_reused(
    tmp_path, monkeypatch
):
    """The read-only check opens the index by URI, so these must not make it stale."""
    directory = tmp_path / "a b#c?d%e"
    directory.mkdir()
    npe_path = _write_npe(directory, _make_npe_object())
    built = ensure_index(npe_path)
    builds = _counted_builds(monkeypatch)

    assert fresh_index(npe_path) == built
    assert ensure_index(npe_path) == built
    assert builds == []


def test_fresh_index_is_none_without_a_sidecar(tmp_path):
    npe_path = _write_npe(tmp_path, _make_npe_object())
    before = listing(tmp_path)

    assert fresh_index(npe_path) is None
    assert listing(tmp_path) == before


def test_fresh_index_is_none_for_a_missing_trace(tmp_path):
    assert fresh_index(str(tmp_path / "absent.json")) is None
    assert listing(tmp_path) == {}


@pytest.mark.parametrize("damage", list(_NOT_CURRENT.values()), ids=list(_NOT_CURRENT))
def test_fresh_index_is_none_for_an_index_that_is_not_current(tmp_path, damage):
    npe_path = _write_npe(tmp_path, _make_npe_object())
    damage(npe_path, ensure_index(npe_path))
    before = listing(tmp_path)

    assert fresh_index(npe_path) is None
    assert listing(tmp_path) == before


def test_fresh_index_names_a_current_index_without_touching_it(tmp_path):
    npe_path = _write_npe(tmp_path, _make_npe_object())
    db_path = ensure_index(npe_path)
    before = listing(tmp_path)

    assert fresh_index(npe_path) == db_path == get_index_path(npe_path)
    assert listing(tmp_path) == before


@pytest.mark.parametrize("value", ["abc", None], ids=["text", "null"])
@pytest.mark.parametrize("key", ["index_version", "source_mtime_ns"])
def test_ensure_index_rebuilds_over_damaged_meta(tmp_path, monkeypatch, key, value):
    # int() of a damaged row used to raise out of every request on the report.
    npe_path = _write_npe(tmp_path, _make_npe_object())
    db_path = ensure_index(npe_path)
    _set_meta(db_path, key, value)
    builds = _counted_builds(monkeypatch)

    assert ensure_index(npe_path) == db_path
    assert len(builds) == 1
    assert fresh_index(npe_path) == db_path


@pytest.mark.parametrize(
    "name, content",
    [
        ("trace.json", b'{"timestep_data": []}'),
        ("trace.npeviz", b' \n\t\r{"timestep_data": []}'),
        ("trace.npeviz.zst", zstd.compress(b'{"timestep_data": []}')),
    ],
    ids=["json", "json-after-whitespace", "zst"],
)
def test_a_trace_starts_as_a_json_object_or_a_zstd_frame(tmp_path, name, content):
    path = tmp_path / name
    path.write_bytes(content)

    assert looks_like_trace(path) is True


@pytest.mark.parametrize(
    "name, content",
    [
        ("trace.json", b'[{"timestep_data": []}]'),
        ("trace.json", b""),
        ("trace.json", b" \n "),
        ("trace.json", zstd.compress(b"{}")),
        ("trace.zst", b'{"timestep_data": []}'),
        ("trace.zst", ZSTD_MAGIC[:3]),
    ],
    ids=[
        "json-list",
        "empty",
        "whitespace",
        "zstd-named-json",
        "json-named-zst",
        "cut-magic",
    ],
)
def test_a_file_that_does_not_start_as_a_trace_is_not_one(tmp_path, name, content):
    path = tmp_path / name
    path.write_bytes(content)

    assert looks_like_trace(path) is False


@pytest.mark.parametrize("name", ["trace.json", "trace.zst"])
def test_a_sqlite_file_is_not_a_trace(tmp_path, name):
    path = tmp_path / name
    execute(path, "CREATE TABLE timestep_data (t INTEGER)")

    assert looks_like_trace(path) is False


def test_a_missing_file_or_a_directory_is_not_a_trace(tmp_path):
    (tmp_path / "trace.json").mkdir()

    assert looks_like_trace(tmp_path / "absent.json") is False
    assert looks_like_trace(tmp_path / "trace.json") is False


def _content(size: int) -> bytes:
    return (b'{"pad": "' + b"0123456789abcdef" * (size // 16 + 1))[:size]


def test_trace_size_of_json_is_the_file_size(tmp_path):
    path = Path(_write_npe(tmp_path, _make_npe_object()))

    assert trace_size(path) == path.stat().st_size


@pytest.mark.parametrize("level", [1, 19])
@pytest.mark.parametrize("size", [0, 200, 255, 256, 300, 65_791, 65_792, 70_000])
def test_trace_size_of_a_zst_is_its_frames_declared_size(tmp_path, size, level):
    path = tmp_path / "trace.npeviz.zst"
    path.write_bytes(zstd.compress(_content(size), level))

    assert trace_size(path) == size


@pytest.mark.parametrize(
    "level, single_segment", [(19, True), (1, False)], ids=["single", "windowed"]
)
def test_trace_size_reads_frames_with_and_without_a_window_descriptor(
    tmp_path, level, single_segment
):
    size = 1 << 20
    frame = zstd.compress(_content(size), level)
    # The library picks the layout; checked so both stay covered.
    assert bool(frame[4] & 0x20) is single_segment
    path = tmp_path / "trace.npeviz.zst"
    path.write_bytes(frame)

    assert trace_size(path) == size


# Frame_Header_Descriptor field sizes by flag value (RFC 8878, 3.1.1.1.1).
_DICTIONARY_ID_BYTES = (0, 1, 2, 4)
_CONTENT_SIZE_BYTES = (0, 2, 4, 8)
_DECLARED_BY_WIDTH = {0: 0, 1: 200, 2: 65_791, 4: 3 << 30, 8: 1 << 40}


def _frame_header(size_flag: int, single_segment: bool, dictionary_flag: int) -> bytes:
    width = _CONTENT_SIZE_BYTES[size_flag] or (1 if single_segment else 0)
    size = _DECLARED_BY_WIDTH[width]
    descriptor = size_flag << 6 | (0x20 if single_segment else 0) | dictionary_flag
    return (
        ZSTD_MAGIC
        + bytes([descriptor])
        + (b"" if single_segment else b"\x58")
        + b"\xab" * _DICTIONARY_ID_BYTES[dictionary_flag]
        + (size - 256 if width == 2 else size).to_bytes(width, "little")
    )


@pytest.mark.parametrize(
    "size_flag, single_segment, dictionary_flag",
    [
        (size_flag, single_segment, dictionary_flag)
        for size_flag in range(4)
        for single_segment in (True, False)
        for dictionary_flag in range(4)
        if size_flag or single_segment
    ],
)
def test_trace_size_reads_every_frame_header_layout(
    tmp_path, size_flag, single_segment, dictionary_flag
):
    path = tmp_path / "trace.zst"
    path.write_bytes(_frame_header(size_flag, single_segment, dictionary_flag))
    width = _CONTENT_SIZE_BYTES[size_flag] or 1

    assert trace_size(path) == _DECLARED_BY_WIDTH[width]


@pytest.mark.parametrize(
    "head",
    [
        *(_frame_header(0, False, dictionary_flag) for dictionary_flag in range(4)),
        _frame_header(3, False, 3)[:-1],
        ZSTD_MAGIC + b"\x20",
        b"\x50\x2a\x4d\x18" + b"\x08" * 14,
        b'{"timestep_data": []}',
    ],
    ids=[
        *(f"no-size-dictionary-{flag}" for flag in range(4)),
        "cut-header",
        "short",
        "skippable-frame",
        "json",
    ],
)
def test_trace_size_is_none_where_a_zst_declares_no_size(tmp_path, head):
    path = tmp_path / "trace.zst"
    path.write_bytes(head)

    assert trace_size(path) is None


_SKIPPABLE = [
    (magic).to_bytes(4, "little") + b"\x03\x00\x00\x00abc"
    for magic in (0x184D2A50, 0x184D2A5F)
]


def _block(content: bytes, last: bool, rle: bool = False) -> bytes:
    header = len(content) << 3 | (0x02 if rle else 0) | (0x01 if last else 0)
    return header.to_bytes(3, "little") + (content[:1] if rle else content)


def _hand_frame(blocks: list, checksum: bool) -> bytes:
    """A single-segment frame declaring its 4-byte size, as the blocks give it."""
    size = sum(len(content) for content, _ in blocks)
    descriptor = 2 << 6 | 0x20 | (0x04 if checksum else 0)
    body = b"".join(
        _block(content, index == len(blocks) - 1, rle)
        for index, (content, rle) in enumerate(blocks)
    )
    return (
        ZSTD_MAGIC
        + bytes([descriptor])
        + size.to_bytes(4, "little")
        + body
        + (b"\xde\xad\xbe\xef" if checksum else b"")
    )


def test_trace_size_sums_every_frame_as_the_library_decompresses_them(tmp_path):
    parts = [_content(200), _content(70_000), b" " * 3]
    path = tmp_path / "trace.npeviz.zst"
    path.write_bytes(b"".join(zstd.compress(part) for part in parts))

    assert trace_size(path) == sum(map(len, parts))
    assert trace_size(path) == len(zstd.uncompress(path.read_bytes()))


def test_trace_size_skips_skippable_frames_as_the_library_does(tmp_path):
    data = _content(70_000)
    path = tmp_path / "trace.npeviz.zst"
    path.write_bytes(_SKIPPABLE[0] + zstd.compress(data) + _SKIPPABLE[1])

    assert trace_size(path) == len(data) == len(zstd.uncompress(path.read_bytes()))


@pytest.mark.parametrize("checksum", [False, True])
def test_trace_size_walks_raw_and_rle_blocks_to_the_next_frame(tmp_path, checksum):
    blocks = [(b"a" * 100, False), (b"b" * 5000, True), (b"c" * 7, False)]
    path = tmp_path / "trace.zst"
    path.write_bytes(_hand_frame(blocks, checksum) + zstd.compress(_content(300)))

    assert trace_size(path) == 5107 + 300


@pytest.mark.parametrize(
    "tail",
    [
        _frame_header(0, False, 0) + _block(b"x" * 10, last=True),
        b"\x00\x01",
        b"junk-after-the-frames",
        _SKIPPABLE[0][:6],
        _frame_header(2, True, 0) + (0x07).to_bytes(3, "little"),
    ],
    ids=[
        "unsized-frame",
        "trailing-bytes",
        "trailing-text",
        "cut-skippable",
        "reserved",
    ],
)
def test_trace_size_is_none_where_any_frame_cannot_be_bounded(tmp_path, tail):
    path = tmp_path / "trace.zst"
    path.write_bytes(zstd.compress(_content(200)) + tail)

    assert trace_size(path) is None


def test_trace_size_gives_up_past_its_budget_of_frames_and_blocks(
    tmp_path, monkeypatch
):
    path = tmp_path / "trace.zst"
    path.write_bytes(_hand_frame([(b"a", False)] * 4, checksum=False))
    monkeypatch.setattr(npe_index, "_ZSTD_MAX_PARTS", 4)
    assert trace_size(path) is None

    monkeypatch.setattr(npe_index, "_ZSTD_MAX_PARTS", 5)
    assert trace_size(path) == 4


@pytest.mark.parametrize("name", ["absent.json", "absent.zst"])
def test_trace_size_of_a_missing_file_raises(tmp_path, name):
    # `noc_congestion` refuses on an OSError; a None would let it read the file.
    with pytest.raises(OSError):
        trace_size(tmp_path / name)


def test_transfer_count_counts_each_id_once():
    transfers = [
        {"id": 1},
        {"id": 1},
        {"id": 2},
        {"id": 2.0},
        {"id": None},
        {"src": [0, 0, 0]},
        "7",
        7,
        None,
        [1],
    ]

    assert _transfer_count(transfers) == 2


@pytest.mark.parametrize("transfers", [None, {}, {"id": 1}, "abc", 7])
def test_transfer_count_of_anything_but_a_list_is_zero(transfers):
    assert _transfer_count(transfers) == 0


def test_transfer_count_is_the_row_count_of_the_index_it_describes(tmp_path):
    obj = _make_npe_object(n_transfers=4)
    obj["noc_transfers"] += [
        {"id": 1, "total_bytes": 64},
        {"id": 3},
        {"id": 2.0},
        {"id": None},
        {"src": [0, 0, 0]},
    ]
    db_path = ensure_index(_write_npe(tmp_path, obj))

    assert _transfer_count(obj["noc_transfers"]) == _row_count(db_path, "transfer") == 4


@pytest.mark.parametrize("spelled", ["3", " 3 ", "+3", "03", "3.0", "3e0", 3.0])
def test_transfer_count_reads_a_numeric_string_id_as_the_index_stores_it(
    tmp_path, spelled
):
    # SQLite keys both, so however the integer is spelled they agree.
    obj = _make_npe_object(n_transfers=0)
    obj["noc_transfers"] = [{"id": 3}, {"id": spelled}]
    db_path = ensure_index(_write_npe(tmp_path, obj))

    assert _transfer_count(obj["noc_transfers"]) == 1
    assert _row_count(db_path, "transfer") == 1


@pytest.mark.parametrize(
    "transfers",
    [[7], [{"id": [1]}], [{"id": "abc"}], [{"id": 1.5}], [{"id": "1_000"}]],
    ids=["not-an-object", "list-id", "text-id", "fractional-id", "underscored-id"],
)
def test_a_transfer_the_index_cannot_store_fails_its_build(tmp_path, transfers):
    # Where `_transfer_count` and `_write_index` part ways, no index exists to disagree.
    obj = _make_npe_object(n_transfers=0)
    obj["noc_transfers"] = transfers

    with pytest.raises((AttributeError, sqlite3.Error)):
        ensure_index(_write_npe(tmp_path, obj))


@pytest.mark.parametrize(
    "trace",
    [{}, {"timestep_data": {}}, {"timestep_data": None}, [], [{"timestep_data": []}]],
    ids=["no-key", "dict", "null", "empty-list", "list"],
)
def test_trace_link_demand_refuses_what_holds_no_timestep_data_list(trace):
    with pytest.raises(ValueError, match="no timestep_data list"):
        trace_link_demand(trace)


def test_trace_link_demand_counts_timesteps_that_are_not_objects():
    steps = [{"start_cycle": 0, "end_cycle": 9, "link_demand": []}, 7, None, "x", []]

    rows = trace_link_demand({"timestep_data": steps})

    assert rows.unreadable_timesteps == 4
    assert list(rows.timesteps) == [(0, 9, []), *[(None, None, [])] * 4]


def test_trace_link_demand_reads_a_step_without_link_demand_as_idle():
    rows = trace_link_demand({"timestep_data": [{"start_cycle": 0, "end_cycle": 9}]})

    assert list(rows.timesteps) == [(0, 9, [])]
    assert rows.unreadable_timesteps == 0


def test_trace_link_demand_leaves_demands_for_truncate():
    trace = {
        "common_info": {"arch": "blackhole"},
        "noc_transfers": [{"id": 0}, {"id": 0}, {"id": 1}],
        "timestep_data": [{"link_demand": [[0, 0, 0, "NOC0_EAST", 50.0009]]}],
    }

    rows = trace_link_demand(trace)

    assert rows.common_info == {"arch": "blackhole"}
    assert rows.transfer_count == 2
    assert rows.truncated is False
    assert list(rows.timesteps) == [(None, None, [[0, 0, 0, "NOC0_EAST", 50.0009]])]


@pytest.mark.parametrize("common_info", [None, [], "wormhole_b0"])
def test_trace_link_demand_reads_a_common_info_that_is_not_an_object_as_empty(
    common_info,
):
    rows = trace_link_demand({"common_info": common_info, "timestep_data": []})

    assert rows.common_info == {}


def test_indexed_link_demand_is_none_without_a_current_index(tmp_path):
    npe_path = _write_npe(tmp_path, _make_npe_object())
    before = listing(tmp_path)

    with indexed_link_demand(Path(npe_path)) as indexed:
        assert indexed is None
    assert listing(tmp_path) == before


def test_indexed_link_demand_gives_the_traces_rows_truncated(tmp_path):
    obj = _make_npe_object(n_transfers=3, n_timesteps=3)
    obj["noc_transfers"].append({"id": 0})
    npe_path = _write_npe(tmp_path, obj)
    ensure_index(npe_path)

    with indexed_link_demand(Path(npe_path)) as indexed:
        assert indexed is not None
        rows = list(indexed.timesteps)

    assert indexed.common_info == obj["common_info"]
    assert indexed.transfer_count == 3
    assert indexed.truncated is True
    assert indexed.unreadable_timesteps == 0
    assert rows == [
        (0, 9, []),
        (10, 19, [[0, 0, 0, "NOC0_EAST", 224.8]]),
        (20, 29, [[0, 0, 0, "NOC0_EAST", 224.8]]),
    ]


@pytest.mark.parametrize(
    "statement",
    [
        "UPDATE meta SET value = 'not json' WHERE key = 'common_info'",
        "DELETE FROM meta WHERE key = 'common_info'",
        "DROP TABLE transfer",
        "DROP TABLE timestep",
        "UPDATE timestep SET link_demand = 'not json' WHERE t = 2",
    ],
    ids=[
        "common-info-not-json",
        "no-common-info",
        "no-transfer-table",
        "no-timestep-table",
        "link-demand-not-json",
    ],
)
def test_a_damaged_index_raises_an_index_read_error_while_read(tmp_path, statement):
    npe_path = _write_npe(tmp_path, _make_npe_object())
    execute(ensure_index(npe_path), statement)

    with pytest.raises(INDEX_READ_ERRORS):
        with indexed_link_demand(Path(npe_path)) as indexed:
            list(indexed.timesteps)


def test_indexed_link_demand_never_recreates_a_sidecar_removed_after_its_check(
    tmp_path, monkeypatch
):
    npe_path = _write_npe(tmp_path, _make_npe_object())
    db_path = ensure_index(npe_path)
    checked = npe_index.fresh_index

    def removed_after_check(path):
        found = checked(path)
        db_path.unlink()
        return found

    monkeypatch.setattr(npe_index, "fresh_index", removed_after_check)

    with pytest.raises(INDEX_READ_ERRORS):
        with indexed_link_demand(Path(npe_path)):
            pass
    assert not db_path.exists()


def _read_through(rows):
    """Every field of a link-demand read, its timesteps read through first."""
    steps = list(rows.timesteps)
    return (
        steps,
        rows.common_info,
        rows.transfer_count,
        rows.unreadable_timesteps,
        rows.truncated,
    )


def _streamed(text: str):
    """The streamed read of a trace's JSON, given as the tool gives it: its bytes."""
    return streamed_link_demand(trace_text(text.encode("utf-8", "surrogatepass")))


_STREAMED_TRACES = {
    "every-field": {
        "common_info": {"arch": "blackhole", "cycles_per_timestep": 128},
        "noc_transfers": [{"id": 0}, {"id": 0}, {"id": "1"}, {"id": 2.0}, 7, {}],
        "timestep_data": [
            {"start_cycle": 0, "end_cycle": 9, "link_demand": [[0, 0, 0, "E", 1.5]]},
            {"start_cycle": 9, "end_cycle": 18},
            7,
            None,
        ],
        "zones": [{"name": "z", "nested": [[1, 2], {"a": []}]}],
    },
    "steps-first": {
        "timestep_data": [{"link_demand": []}],
        "common_info": {"arch": "wormhole_b0"},
        "noc_transfers": [{"id": 3}],
    },
    "empty-lists": {"timestep_data": [], "noc_transfers": [], "zones": []},
    "common-info-not-an-object": {"common_info": [1], "timestep_data": []},
    "common-info-null": {"common_info": None, "timestep_data": []},
    "transfers-not-a-list": {"noc_transfers": {"id": 1}, "timestep_data": []},
    # orjson keeps the last of two members, as the read must.
    "repeated-members": {"common_info": {"arch": "a"}, "timestep_data": []},
    "unicode": {"common_info": {"name": "é€😀"}, "timestep_data": [{"x": " "}]},
}


@pytest.mark.parametrize(
    "text",
    [
        '{"noc_transfers": [{"id": 1}], "noc_transfers": null, "timestep_data": []}',
        '{"common_info": {"a": 1}, "common_info": [], "timestep_data": []}',
        '{"common_info": {"a": 1}, "common_info": 7, "timestep_data": []}',
    ],
)
def test_a_member_named_twice_reads_as_its_last(text):
    assert _read_through(_streamed(text)) == _read_through(
        trace_link_demand(orjson.loads(text))
    )


def _with_repeats(text: str) -> str:
    return text.replace(
        '"timestep_data"',
        '"noc_transfers":[{"id":9}],"common_info":{"arch":"b"},'
        '"noc_transfers":[{"id":1},{"id":2}],"timestep_data"',
        1,
    )


@pytest.mark.parametrize("indent", [None, orjson.OPT_INDENT_2])
@pytest.mark.parametrize("name", sorted(_STREAMED_TRACES))
def test_a_streamed_read_answers_as_the_whole_parse_does(name, indent):
    """#2275"""
    text = orjson.dumps(_STREAMED_TRACES[name], option=indent).decode()
    if name == "repeated-members":
        text = _with_repeats(text)

    assert _read_through(_streamed(text)) == _read_through(
        trace_link_demand(orjson.loads(text))
    )


@pytest.mark.parametrize(
    "text",
    [
        "{}",
        '{"timestep_data": {}}',
        '{"timestep_data": null}',
        '{"common_info": {}}',
        "[]",
        '[{"timestep_data": []}, [1]]',
        '"timestep_data"',
    ],
)
def test_a_streamed_read_refuses_what_holds_no_timestep_data_list(text):
    with pytest.raises(ValueError, match="no timestep_data list"):
        _read_through(_streamed(text))


@pytest.mark.parametrize(
    "text",
    [
        '{"timestep_data": [],}',
        '{"timestep_data": [1,]}',
        '{"timestep_data": [1}',
        '{"timestep_data": []',
        '{"timestep_data": []} x',
        '{"timestep_data": [NaN]}',
        '{"timestep_data": [{"a": 1e400}]}',
        '{"timestep_data": [{"a": "\\ud800"}]}',
        '{"timestep_data": [1 2]}',
        '{"timestep_data" []}',
        "{timestep_data: []}",
        # Not an object, so read through to be refused as the whole parse refuses it.
        "",
        "  ",
        "[1,",
        "[1] x",
        "[[1}]",
        '\ufeff{"timestep_data": []}',
    ],
)
def test_a_streamed_read_refuses_what_orjson_refuses(text):
    with pytest.raises(orjson.JSONDecodeError):
        orjson.loads(text)
    with pytest.raises(json.JSONDecodeError):
        _read_through(_streamed(text))


def test_a_streamed_read_refuses_timestep_data_named_twice():
    """orjson keeps the second, and the first has already been read."""
    with pytest.raises(ValueError, match="names timestep_data twice"):
        _read_through(_streamed('{"timestep_data": [], "timestep_data": []}'))


def test_a_streamed_read_holds_one_timestep_at_a_time():
    """A timestep is handed on before the next is read, so a bad second one is found
    only after the first has been."""
    rows = _streamed('{"timestep_data": [{"start_cycle": 0}, NaN]}')

    assert next(rows.timesteps) == (0, None, [])
    with pytest.raises(RuntimeError, match="read the timesteps through"):
        rows.unreadable_timesteps
    with pytest.raises(json.JSONDecodeError):
        next(rows.timesteps)


def test_a_refusal_is_placed_where_the_whole_parse_places_it():
    text = '{"common_info": {}, "timestep_data": [{"start_cycle": 0}, {"x": NaN}]}'
    with pytest.raises(orjson.JSONDecodeError) as whole:
        orjson.loads(text)

    with pytest.raises(json.JSONDecodeError) as streamed:
        _read_through(_streamed(text))

    assert (streamed.value.msg, streamed.value.pos) == (
        whole.value.msg,
        whole.value.pos,
    )


def test_a_traces_text_takes_a_byte_a_character():
    """Read as UTF-8, one character past Latin-1 would make the whole text two or four
    bytes a character, and every parity test would still pass. #2275"""
    body = orjson.dumps({"common_info": {"name": "é€😀"}, "timestep_data": []})
    body += b" " * 10_000

    assert sys.getsizeof(trace_text(body)) < len(body) + 200


def _many_timesteps(count: int) -> str:
    step = {
        "start_cycle": 0,
        "end_cycle": 9,
        "link_demand": [[0, 0, 0, "NOC0_EAST", 12.5], [0, 0, 1, "NOC1_WEST", 7.25]],
        "noc": {"NOC0": {"avg_link_demand": 1.5, "max_link_demand": 12.5}},
    }
    return trace_text(
        orjson.dumps({"common_info": {}, "timestep_data": [step] * count})
    )


def test_a_streamed_read_holds_a_fraction_of_its_text_at_its_peak():
    """Bounded memory is what #2275 asks for: a read that kept the steps it handed on,
    or built the whole object, would hold several times the text."""
    text = _many_timesteps(32_000)
    assert len(text) > 4_000_000

    tracemalloc.start()
    try:
        before = tracemalloc.get_traced_memory()[0]
        rows = streamed_link_demand(text)
        for _ in rows.timesteps:
            pass
        peak = tracemalloc.get_traced_memory()[1] - before
    finally:
        tracemalloc.stop()

    assert peak < 0.5 * len(text)


def _random_json(chooser, depth):
    """A value of any JSON kind, nested at most `depth` deep."""
    kind = chooser.randrange(7 if depth else 4)
    if kind == 0:
        return chooser.choice([None, True, False])
    if kind == 1:
        return chooser.choice([0, -1, 7, 2**63, -(2**63), 1.5, -0.0, 1e300])
    if kind == 2:
        return chooser.choice(["", "x", "é", "😀", '"', "\\", "\n", "\u2028"])
    if kind == 3:
        return {"start_cycle": chooser.randrange(9), "link_demand": []}
    if kind in (4, 5):
        return [_random_json(chooser, depth - 1) for _ in range(chooser.randrange(4))]
    return {
        chooser.choice(["a", "id", "noc", "start_cycle", "end_cycle", "link_demand"]): (
            _random_json(chooser, depth - 1)
        )
        for _ in range(chooser.randrange(4))
    }


def _random_trace_text(chooser):
    """A trace's text with its top-level members in any order, some repeated."""
    names = ["common_info", "noc_transfers", "zones", "chips", "other", "timestep_data"]
    members = []
    for name in chooser.sample(names, chooser.randrange(1, len(names) + 1)):
        for _ in range(1 if name == "timestep_data" else chooser.randrange(1, 3)):
            value = [_random_json(chooser, 2) for _ in range(chooser.randrange(5))]
            if chooser.randrange(4) == 0 and name != "timestep_data":
                value = _random_json(chooser, 2)
            members.append(f"{json.dumps(name)}:{orjson.dumps(value).decode()}")
    space = chooser.choice(["", " ", "\n  "])
    return "{" + space + ("," + space).join(members) + space + "}"


@pytest.mark.parametrize("seed", range(40))
def test_a_streamed_read_answers_as_the_whole_parse_does_on_random_traces(seed):
    chooser = random.Random(seed)
    for _ in range(10):
        text = _random_trace_text(chooser)
        try:
            expected = _read_through(trace_link_demand(orjson.loads(text)))
        except ValueError as refusal:
            with pytest.raises(type(refusal)):
                _read_through(_streamed(text))
            continue
        assert _read_through(_streamed(text)) == expected, text


def test_a_streamed_read_answers_as_the_whole_parse_does_whatever_its_spacing():
    """Space before a colon, around commas, tabs, carriage returns, and before the
    trace's own object. #2275"""
    text = (
        '\r\n\t {"common_info" :\t{"arch" : "blackhole"} ,\r\n "noc_transfers"\n:\n'
        '[ {"id" : 1} ,\t{"id":2} ] , "timestep_data" : [ {"start_cycle" : 0 ,'
        ' "end_cycle" :9 , "link_demand" : [ [ 0 , 0 , 0 , "E" , 1.5 ] ,\r\n'
        '[0,0,1,"W",2] ] } \t,\r\n 7 , [ ] ] }\n'
    )

    assert _read_through(_streamed(text)) == _read_through(
        trace_link_demand(orjson.loads(text))
    )


# Bytes JSON gives a meaning to, and some it never allows.
_CORRUPTING_BYTES = b'{}[],:" \t\\-+.0123456789eEtfnu\x00\x7f\x80\xc3\xff'


@pytest.mark.parametrize("seed", range(40))
def test_a_trace_cut_or_with_a_byte_changed_is_read_as_the_whole_parse_reads_it(seed):
    """Both reads refuse it, or both answer it alike. #2275"""
    chooser = random.Random(seed)
    for _ in range(10):
        body = _random_trace_text(chooser).encode("utf-8", "surrogatepass")
        at = chooser.randrange(len(body))
        if chooser.randrange(2):
            body = body[:at]
        else:
            byte = bytes([chooser.choice(_CORRUPTING_BYTES)])
            body = body[:at] + byte + body[at + 1 :]
        try:
            expected = _read_through(trace_link_demand(orjson.loads(body)))
        except ValueError:
            with pytest.raises(ValueError):
                _read_through(streamed_link_demand(trace_text(body)))
            continue
        assert _read_through(streamed_link_demand(trace_text(body))) == expected, body


def test_orjson_reads_as_deep_as_the_streamed_read_does():
    """`MAX_JSON_DEPTH`, and the refusal past it, are orjson's own: an orjson that
    changed either would move the two reads apart. #2275"""
    depth = npe_index.MAX_JSON_DEPTH
    orjson.loads("[" * depth + "]" * depth)
    with pytest.raises(orjson.JSONDecodeError) as refused:
        orjson.loads("[" * (depth + 1) + "]" * (depth + 1))

    assert refused.value.msg in npe_index._ORJSON_TOO_DEEP


def _nested_in(where: str, depth: int) -> str:
    """A trace whose arrays and objects nest `depth` deep in all, deepest at `where`."""
    if where == "timestep":
        inner = "[" * (depth - 3) + "]" * (depth - 3)
        return '{"timestep_data": [{"start_cycle": 0, "deep": ' + inner + "}]}"
    inner = "[" * (depth - 2) + "]" * (depth - 2)
    if where == "element":
        return '{"timestep_data": [], "zones": [' + inner + "]}"
    # A member the read drops, so comparing reads does not recurse that deep itself.
    return '{"timestep_data": [], "other": {"deep": ' + inner + "}}"


def _from_frames_deep(frames: int, read):
    return read() if frames == 0 else _from_frames_deep(frames - 1, read)


@pytest.mark.parametrize("frames", [0, 700], ids=["shallow-caller", "deep-caller"])
@pytest.mark.parametrize("past", [0, 1], ids=["at-orjsons-depth", "one-deeper"])
@pytest.mark.parametrize("where", ["element", "member", "timestep"])
def test_a_streamed_read_refuses_the_depth_the_whole_parse_refuses(where, past, frames):
    """Whatever the caller's stack: before Python 3.12 the stdlib scanner that finds a
    value's end recursed against the caller's limit, and refused nesting ~1,000 deep
    that the whole parse reads. #2275"""
    text = _nested_in(where, npe_index.MAX_JSON_DEPTH + past)
    limit = sys.getrecursionlimit()

    def streamed():
        return _read_through(_streamed(text))

    if past:
        with pytest.raises(orjson.JSONDecodeError) as refused:
            orjson.loads(text)
        assert refused.value.msg in npe_index._ORJSON_TOO_DEEP
        with pytest.raises(npe_index.NestsTooDeep):
            _from_frames_deep(frames, streamed)
    else:
        expected = _read_through(trace_link_demand(orjson.loads(text)))
        assert _from_frames_deep(frames, streamed) == expected
    assert sys.getrecursionlimit() == limit


def test_a_streamed_read_refuses_nesting_far_past_any_parse():
    """Past even the stdlib scanner's reach, still refused as too deep. #2275"""
    text = '{"timestep_data": [' + "[" * 100_000 + "]" * 100_000 + "]}"
    limit = sys.getrecursionlimit()

    with pytest.raises(npe_index.NestsTooDeep, match="more than 1,024"):
        _read_through(_streamed(text))
    assert sys.getrecursionlimit() == limit
