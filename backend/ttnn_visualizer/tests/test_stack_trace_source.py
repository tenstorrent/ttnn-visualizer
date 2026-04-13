# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

from pathlib import Path
from unittest.mock import MagicMock

import pytest
from ttnn_visualizer.stack_trace_source import (
    discover_tt_metal_roots_local,
    extract_suffix_after_tt_metal,
    resolve_local_stack_path,
    safe_join_under_tt_metal_root,
)


def test_extract_suffix_after_tt_metal():
    assert extract_suffix_after_tt_metal("/foo/tt-metal/ttnn/x.py") == "ttnn/x.py"
    assert extract_suffix_after_tt_metal("/tt-metal/tt_metal/y.cc") == "tt_metal/y.cc"
    assert extract_suffix_after_tt_metal("/prefix/tt-metal") == ""
    assert extract_suffix_after_tt_metal("/opt/foo/bar") is None


def test_safe_join_under_tt_metal_root_rejects_dotdot(tmp_path):
    root = tmp_path / "tt-metal"
    root.mkdir()
    with pytest.raises(ValueError, match="Unsafe"):
        safe_join_under_tt_metal_root(root, "a/../../etc/passwd")


def test_safe_join_under_tt_metal_root_ok(tmp_path):
    root = tmp_path / "tt-metal"
    (root / "ttnn").mkdir(parents=True)
    f = root / "ttnn" / "a.py"
    f.write_text("x", encoding="utf-8")
    p = safe_join_under_tt_metal_root(root, "ttnn/a.py")
    assert p == f.resolve()


def test_resolve_remaps_under_tt_metal_marker(monkeypatch, tmp_path):
    metal = tmp_path / "tt-metal"
    (metal / "ttnn").mkdir(parents=True)
    target = metal / "ttnn" / "hello.py"
    target.write_text("# hi", encoding="utf-8")

    monkeypatch.delenv("TT_METAL_HOME", raising=False)
    monkeypatch.setenv("HOME", str(tmp_path))
    # Priority: ~/tt-metal
    alt = tmp_path / "tt-metal"
    if alt != metal:
        alt.mkdir(parents=True)
    # Use explicit TT_METAL_HOME to avoid home layout ambiguity
    monkeypatch.setenv("TT_METAL_HOME", str(metal))

    raw = "/anything/tt-metal/ttnn/hello.py"
    path, remapped = resolve_local_stack_path(raw)
    assert remapped is True
    assert path.resolve() == target.resolve()


def test_resolve_rejects_path_outside_roots(monkeypatch, tmp_path):
    monkeypatch.delenv("TT_METAL_HOME", raising=False)
    metal = tmp_path / "tt-metal"
    metal.mkdir()
    monkeypatch.setenv("HOME", str(tmp_path))
    other = tmp_path / "other.py"
    other.write_text("z", encoding="utf-8")

    with pytest.raises(FileNotFoundError, match="outside"):
        resolve_local_stack_path(str(other))


def test_discover_tt_metal_priority_tt_metal_home(monkeypatch, tmp_path):
    a = tmp_path / "a"
    b = tmp_path / "b"
    a.mkdir()
    b.mkdir()
    monkeypatch.setenv("TT_METAL_HOME", str(a))
    monkeypatch.setenv("HOME", str(tmp_path))
    roots = discover_tt_metal_roots_local()
    assert roots[0] == a.resolve()


def test_discover_tt_metal_roots_dedupes(monkeypatch, tmp_path):
    metal = tmp_path / "tt-metal"
    metal.mkdir()
    monkeypatch.setenv("TT_METAL_HOME", str(metal))
    monkeypatch.setenv("HOME", str(tmp_path))
    # home/tt-metal same as metal if HOME is parent
    (tmp_path / "tt-metal").mkdir(exist_ok=True)
    roots = discover_tt_metal_roots_local()
    assert len(roots) == 1


def test_read_stack_source_remote_remaps_after_not_found(monkeypatch):
    from http import HTTPStatus

    import ttnn_visualizer.stack_trace_source as sts
    from ttnn_visualizer.exceptions import RemoteFileReadException
    from ttnn_visualizer.stack_trace_source import read_stack_source_remote

    raw = "/container/tt-metal/foo/bar.c"
    remote_root = "/home/dev/tt-metal"

    ssh = MagicMock()

    def read_file(p):
        s = str(p)
        if s == raw:
            raise RemoteFileReadException(
                message="File not found.",
                http_status_code=HTTPStatus.NOT_FOUND,
            )
        if s == f"{remote_root}/foo/bar.c":
            return b"content"
        raise AssertionError(s)

    ssh.read_file.side_effect = read_file
    monkeypatch.setattr(sts, "discover_tt_metal_root_remote", lambda _ssh: remote_root)

    text, resolved, remapped = read_stack_source_remote(ssh, raw)
    assert text == "content"
    assert remapped is True
    assert resolved == f"{remote_root}/foo/bar.c"
