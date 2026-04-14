# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

from pathlib import Path
from unittest.mock import MagicMock

import pytest
from ttnn_visualizer.stack_trace_source import (
    _REMOTE_LIST_ROOTS_SCRIPT,
    _candidate_tt_metal_dirs,
    _discover_tt_metal_roots_local,
    _extract_suffix_after_tt_metal,
    _resolve_local_stack_path,
    _safe_join_under_tt_metal_root,
    check_stack_source_local,
)


def test_extract_suffix_after_tt_metal():
    assert _extract_suffix_after_tt_metal("/foo/tt-metal/ttnn/x.py") == "ttnn/x.py"
    assert _extract_suffix_after_tt_metal("/tt-metal/tt_metal/y.cc") == "tt_metal/y.cc"
    assert _extract_suffix_after_tt_metal("/prefix/tt-metal") == ""
    assert _extract_suffix_after_tt_metal("/opt/foo/bar") is None


def test__safe_join_under_tt_metal_root_rejects_dotdot(tmp_path):
    root = tmp_path / "tt-metal"
    root.mkdir()
    with pytest.raises(ValueError, match="Unsafe"):
        _safe_join_under_tt_metal_root(root, "a/../../etc/passwd")


def test__safe_join_under_tt_metal_root_ok(tmp_path):
    root = tmp_path / "tt-metal"
    (root / "ttnn").mkdir(parents=True)
    f = root / "ttnn" / "a.py"
    f.write_text("x", encoding="utf-8")
    p = _safe_join_under_tt_metal_root(root, "ttnn/a.py")
    assert p == f.resolve()


def test_resolve_tt_metal_path_direct_same_file_not_remapped(monkeypatch, tmp_path):
    """Canonical path under a discovered root should not set remapped=True."""
    metal = tmp_path / "tt-metal"
    (metal / "ttnn").mkdir(parents=True)
    target = metal / "ttnn" / "hello.py"
    target.write_text("# hi", encoding="utf-8")
    monkeypatch.setenv("TT_METAL_HOME", str(metal))

    raw = str(target)
    assert "/tt-metal/" in raw
    path, remapped = _resolve_local_stack_path(raw)
    assert remapped is False
    assert path.resolve() == target.resolve()


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
    path, remapped = _resolve_local_stack_path(raw)
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
        _resolve_local_stack_path(str(other))


def test_discover_tt_metal_priority_tt_metal_home(monkeypatch, tmp_path):
    a = tmp_path / "a"
    b = tmp_path / "b"
    a.mkdir()
    b.mkdir()
    monkeypatch.setenv("TT_METAL_HOME", str(a))
    monkeypatch.setenv("HOME", str(tmp_path))
    roots = _discover_tt_metal_roots_local()
    assert roots[0] == a.resolve()


def test_discover_tt_metal_roots_dedupes(monkeypatch, tmp_path):
    metal = tmp_path / "tt-metal"
    metal.mkdir()
    monkeypatch.setenv("TT_METAL_HOME", str(metal))
    monkeypatch.setenv("HOME", str(tmp_path))
    # home/tt-metal same as metal if HOME is parent
    (tmp_path / "tt-metal").mkdir(exist_ok=True)
    roots = _discover_tt_metal_roots_local()
    assert len(roots) == 1


def test_candidate_dirs_include_sudo_user_home_tt_metal(monkeypatch):
    """When sudo leaves HOME as root, /home/$SUDO_USER/tt-metal must still be tried."""
    monkeypatch.setenv("SUDO_USER", "someuser")
    assert Path("/home/someuser/tt-metal") in _candidate_tt_metal_dirs()


def test_remote_root_script_matches_local_priority_order():
    home_idx = _REMOTE_LIST_ROOTS_SCRIPT.index('"$HOME/tt-metal"')
    sudo_idx = _REMOTE_LIST_ROOTS_SCRIPT.index("/home/${SUDO_USER}/tt-metal")
    localdev_idx = _REMOTE_LIST_ROOTS_SCRIPT.index('"/localdev/$(id -un)/tt-metal"')
    proj_sw_idx = _REMOTE_LIST_ROOTS_SCRIPT.index('"/proj_sw/$(id -un)/tt-metal"')

    assert home_idx < sudo_idx < localdev_idx < proj_sw_idx


def test_candidate_dirs_include_flask_tt_metal_home(app, tmp_path):
    custom = tmp_path / "cfg-tt-metal"
    custom.mkdir()
    app.config["TT_METAL_HOME"] = str(custom)
    with app.app_context():
        candidates = [p.resolve() for p in _candidate_tt_metal_dirs()]
    assert custom.resolve() in candidates


def test_check_stack_source_local_matches_resolve(monkeypatch, tmp_path):
    metal = tmp_path / "tt-metal"
    (metal / "ttnn").mkdir(parents=True)
    target = metal / "ttnn" / "probe.py"
    target.write_text("# x", encoding="utf-8")
    monkeypatch.setenv("TT_METAL_HOME", str(metal))

    assert check_stack_source_local("/x/tt-metal/ttnn/probe.py") is True
    assert check_stack_source_local("/x/tt-metal/ttnn/missing.py") is False


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
    monkeypatch.setattr(
        sts, "_discover_tt_metal_roots_remote", lambda _ssh: [remote_root]
    )

    text, resolved, remapped = read_stack_source_remote(ssh, raw)
    assert text == "content"
    assert remapped is True
    assert resolved == f"{remote_root}/foo/bar.c"


def test_check_stack_source_remote_tries_each_remapped_root(monkeypatch):
    import ttnn_visualizer.stack_trace_source as sts
    from ttnn_visualizer.stack_trace_source import check_stack_source_remote

    monkeypatch.setattr(
        sts,
        "_discover_tt_metal_roots_remote",
        lambda _ssh: ["/wrong/tt-metal", "/good/tt-metal"],
    )

    checked: list[str] = []

    def fake_exists(_ssh, path: str) -> bool:
        checked.append(path)
        return path == "/good/tt-metal/u/v.py"

    monkeypatch.setattr(sts, "_remote_regular_file_exists", fake_exists)

    ssh = MagicMock()
    assert check_stack_source_remote(ssh, "/container/tt-metal/u/v.py") is True
    assert "/good/tt-metal/u/v.py" in checked
