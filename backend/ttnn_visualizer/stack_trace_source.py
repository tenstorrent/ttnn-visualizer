# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

"""Resolve stack trace file paths against a tt-metal checkout and read source (local or SSH)."""

from __future__ import annotations

import logging
import os
import shlex
from http import HTTPStatus
from pathlib import Path
from typing import TYPE_CHECKING, Optional, Tuple

from flask import Response
from ttnn_visualizer.exceptions import RemoteFileReadException

if TYPE_CHECKING:
    from ttnn_visualizer.ssh_client import SSHClient

logger = logging.getLogger(__name__)

# First occurrence of this substring in a trace path marks the tt-metal repo segment.
TT_METAL_SEGMENT = "/tt-metal/"

# Echo every existing tt-metal root, one per line (same priority as local discovery).
# Includes /home/$SUDO_USER/tt-metal so sudo (HOME=/root) still finds the invoking user's checkout.
_REMOTE_LIST_ROOTS_SCRIPT = r"""for p in "${TT_METAL_HOME:-}" "$HOME/tt-metal" "/localdev/$(id -un)/tt-metal" "/proj_sw/$(id -un)/tt-metal"; do [ -n "$p" ] && [ -d "$p" ] && printf '%s\n' "$p"; done
if [ -n "${SUDO_USER:-}" ]; then p="/home/${SUDO_USER}/tt-metal"; [ -d "$p" ] && printf '%s\n' "$p"; fi"""


def _tt_metal_home_from_flask_config() -> Optional[str]:
    """TT_METAL_HOME from Flask app config when handling a request (may differ from os.environ)."""
    try:
        from flask import current_app, has_app_context

        if has_app_context():
            raw = current_app.config.get("TT_METAL_HOME")
            if raw and str(raw).strip():
                return str(raw).strip()
    except Exception:
        pass
    return None


def _candidate_tt_metal_dirs() -> list[Path]:
    """Ordered search locations (may or may not exist)."""
    out: list[Path] = []
    cfg = _tt_metal_home_from_flask_config()
    if cfg:
        out.append(Path(cfg).expanduser())
    env = (os.environ.get("TT_METAL_HOME") or "").strip()
    if env:
        out.append(Path(env).expanduser())
    out.append(Path.home() / "tt-metal")
    sudo_user = (os.environ.get("SUDO_USER") or "").strip()
    if sudo_user:
        out.append(Path("/home") / sudo_user / "tt-metal")
    user = os.environ.get("USER") or ""
    if user:
        out.append(Path(f"/localdev/{user}/tt-metal"))
        out.append(Path(f"/proj_sw/{user}/tt-metal"))
    return out


def discover_tt_metal_roots_local() -> list[Path]:
    """All existing candidate roots (deduped), in priority order."""
    seen: set[str] = set()
    out: list[Path] = []
    for p in _candidate_tt_metal_dirs():
        try:
            r = p.resolve()
            key = str(r)
            if r.is_dir() and key not in seen:
                seen.add(key)
                out.append(r)
        except OSError:
            continue
    return out


def extract_suffix_after_tt_metal(raw_path: str) -> Optional[str]:
    """
    If raw_path contains '/tt-metal/', return the relative suffix (may be empty).
    Trailing '/tt-metal' without a following slash yields empty suffix (repo root).
    """
    idx = raw_path.find(TT_METAL_SEGMENT)
    if idx != -1:
        return raw_path[idx + len(TT_METAL_SEGMENT) :]
    if raw_path.endswith("/tt-metal"):
        return ""
    return None


def _is_safe_suffix(suffix: str) -> bool:
    if ".." in Path(suffix).parts:
        return False
    if "\x00" in suffix:
        return False
    return True


def safe_join_under_tt_metal_root(root: Path, suffix: str) -> Path:
    """
    Join root with suffix and ensure the result stays under root (after resolve).
    """
    if not _is_safe_suffix(suffix):
        raise ValueError("Unsafe path suffix")
    root_r = root.resolve()
    # Empty suffix -> root itself (not usually a file)
    rel = suffix.strip("/")
    if not rel:
        candidate = root_r
    else:
        candidate = (root_r / rel).resolve()
    if candidate == root_r or candidate.is_relative_to(root_r):
        return candidate
    raise ValueError("Path escapes tt-metal root")


def join_remote_tt_metal_path(remote_root: str, suffix: str) -> str:
    """
    POSIX join for paths passed to SSH. Do not use local Path.resolve() — the
    remote filesystem layout is not the same as the machine running Flask.
    """
    if not _is_safe_suffix(suffix):
        raise ValueError("Unsafe path suffix")
    root_s = remote_root.strip().rstrip("/")
    if not root_s.startswith("/"):
        raise ValueError("Remote tt-metal root must be absolute")
    rel = suffix.strip("/")
    if not rel:
        return root_s
    joined = f"{root_s}/{rel}"
    if "/../" in joined or joined.endswith("/..") or "/./" in joined:
        raise ValueError("Invalid remote path")
    return joined


def read_text_file(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def resolve_local_stack_path(raw_path: str) -> Tuple[Path, bool]:
    """
    Resolve a filesystem path for reading local stack trace source.

    Returns (path, remapped) where remapped is True if a /tt-metal/ remap was applied.
    """
    roots = discover_tt_metal_roots_local()
    suffix = extract_suffix_after_tt_metal(raw_path)
    if suffix is not None:
        if not roots:
            raise FileNotFoundError(
                "No local tt-metal directory found for path remapping"
            )
        last_err: Optional[Exception] = None
        for root in roots:
            try:
                candidate = safe_join_under_tt_metal_root(root, suffix)
                if candidate.is_file():
                    return candidate, True
            except (ValueError, OSError) as e:
                last_err = e
                continue
        err = FileNotFoundError(
            f"No file found under tt-metal roots for path suffix {suffix!r}"
        )
        if last_err:
            raise err from last_err
        raise err

    expanded = Path(raw_path).expanduser()
    try:
        resolved = expanded.resolve()
    except OSError as e:
        raise FileNotFoundError(str(e)) from e

    if not roots:
        raise FileNotFoundError(
            "No local tt-metal directory configured; cannot verify source path"
        )

    for root in roots:
        try:
            if resolved == root.resolve() or resolved.is_relative_to(root.resolve()):
                if resolved.is_file():
                    return resolved, False
                raise FileNotFoundError(f"Not a file: {resolved}")
        except (ValueError, OSError):
            continue

    raise FileNotFoundError("Source path is outside discovered tt-metal directories")


def read_stack_source_local(raw_path: str) -> Tuple[str, str, bool]:
    """
    Read local file contents for stack trace viewing.

    :return: (content, resolved_path_str, remapped)
    """
    path, remapped = resolve_local_stack_path(raw_path)
    text = read_text_file(path)
    return text, str(path), remapped


def discover_tt_metal_roots_remote(ssh_client: "SSHClient") -> list[str]:
    """All existing remote tt-metal roots, same priority as local (deduped)."""
    cmd = f"bash -lc {shlex.quote(_REMOTE_LIST_ROOTS_SCRIPT)}"
    try:
        out = ssh_client.execute_command(cmd, timeout=30)
    except Exception as e:
        logger.warning("Remote tt-metal roots discovery failed: %s", e)
        return []
    roots: list[str] = []
    seen: set[str] = set()
    for line in out.splitlines():
        line = line.strip()
        if line and line not in seen:
            seen.add(line)
            roots.append(line)
    return roots


def discover_tt_metal_root_remote(ssh_client: "SSHClient") -> Optional[str]:
    """First remote tt-metal root, or None if none exist."""
    roots = discover_tt_metal_roots_remote(ssh_client)
    return roots[0] if roots else None


def read_stack_source_remote(
    ssh_client: "SSHClient", raw_path: str
) -> Tuple[str, str, bool]:
    """
    Read stack trace source from remote via SSH, trying remap after /tt-metal/ on failure.

    :return: (content, resolved_path_str, remapped)
    """
    path_str = str(Path(raw_path))
    not_found: Optional[RemoteFileReadException] = None

    try:
        content = ssh_client.read_file(path_str)
        text = (content or b"").decode("utf-8", errors="replace")
        return text, path_str, False
    except RemoteFileReadException as e:
        if e.http_status != HTTPStatus.NOT_FOUND:
            raise
        not_found = e

    assert not_found is not None

    suffix = extract_suffix_after_tt_metal(raw_path)
    if suffix is None:
        raise not_found

    roots = discover_tt_metal_roots_remote(ssh_client)
    if not roots:
        raise not_found

    last_missing = not_found
    for root_str in roots:
        try:
            remapped_str = join_remote_tt_metal_path(root_str, suffix)
        except ValueError:
            continue
        try:
            content = ssh_client.read_file(remapped_str)
            text = (content or b"").decode("utf-8", errors="replace")
            return text, remapped_str, True
        except RemoteFileReadException as e:
            if e.http_status != HTTPStatus.NOT_FOUND:
                raise
            last_missing = e
            continue

    raise last_missing


def _remote_regular_file_exists(ssh_client: "SSHClient", posix_path: str) -> bool:
    """True if remote path exists and is a regular file (SSH test -f)."""
    from ttnn_visualizer.ssh_client import SSHException

    try:
        ssh_client.execute_command(f"test -f {shlex.quote(posix_path)}", timeout=15)
        return True
    except SSHException:
        return False


def check_stack_source_local(raw_path: str) -> bool:
    """Whether resolve_local_stack_path would succeed (including /tt-metal/ remaps)."""
    try:
        resolve_local_stack_path(raw_path)
        return True
    except (FileNotFoundError, OSError, ValueError):
        return False


def check_stack_source_remote(ssh_client: "SSHClient", raw_path: str) -> bool:
    """
    Whether read_stack_source_remote would succeed: literal path or remapped under any
    discovered tt-metal root (same roots as local).
    """
    path_str = str(Path(raw_path))
    if _remote_regular_file_exists(ssh_client, path_str):
        return True
    suffix = extract_suffix_after_tt_metal(raw_path)
    if suffix is None:
        return False
    for root_str in discover_tt_metal_roots_remote(ssh_client):
        try:
            remapped_str = join_remote_tt_metal_path(root_str, suffix)
        except ValueError:
            continue
        if _remote_regular_file_exists(ssh_client, remapped_str):
            return True
    return False


def stack_source_response(text: str, resolved: str, remapped: bool) -> Response:
    resp = Response(
        response=text,
        status=HTTPStatus.OK,
        mimetype="text/plain; charset=utf-8",
    )
    resp.headers["X-TTNN-Resolved-Source-Path"] = resolved
    if remapped:
        resp.headers["X-TTNN-Source-Remapped"] = "true"
    return resp
