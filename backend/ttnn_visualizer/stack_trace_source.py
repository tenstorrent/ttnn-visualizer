# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Resolve stack trace file paths against a tt-metal checkout and read source (local or SSH)."""

from __future__ import annotations

import logging
import os
import re
import shlex
from http import HTTPStatus
from pathlib import Path, PurePosixPath
from typing import TYPE_CHECKING, Optional, Tuple

from flask import Response
from ttnn_visualizer.exceptions import RemoteFileReadException
from ttnn_visualizer.ssh_client import SSHException

if TYPE_CHECKING:
    from ttnn_visualizer.ssh_client import SSHClient

logger = logging.getLogger(__name__)

# First occurrence of this substring in a trace path marks the tt-metal repo segment.
TT_METAL_SEGMENT = "/tt-metal/"

# Echo every existing tt-metal root, one per line, matching local discovery priority.
# Includes /home/$SUDO_USER/tt-metal so sudo (HOME=/root) still finds the invoking user's checkout.
_REMOTE_LIST_ROOTS_SCRIPT = r"""for p in "${TT_METAL_HOME:-}" "$HOME/tt-metal"; do [ -n "$p" ] && [ -d "$p" ] && printf '%s\n' "$p"; done
if [ -n "${SUDO_USER:-}" ]; then p="/home/${SUDO_USER}/tt-metal"; [ -d "$p" ] && printf '%s\n' "$p"; fi
for p in "/localdev/$(id -un)/tt-metal" "/proj_sw/$(id -un)/tt-metal"; do [ -n "$p" ] && [ -d "$p" ] && printf '%s\n' "$p"; done"""
_USER_ROOT_PREFIX_RE = re.compile(r"^/(localdev|proj_sw)/[^/]+/tt-metal(?:/|$)")

# Stack trace paths come from DB / API clients; cap length to contain resource usage.
_MAX_STACK_TRACE_PATH_LEN = 8192


def _path_parts_contain_dotdot(path: str) -> bool:
    """True if any path component is '..', before filesystem resolution."""
    return any(part == ".." for part in path.split("/"))


def _validate_stack_trace_raw_path(
    raw_path: str, *, require_absolute_posix: bool = False
) -> str:
    """
    Normalize and reject unsafe stack-trace path strings (shared local/remote).

    Raises ValueError when the input must not be used with filesystem or SSH paths.
    """
    if not isinstance(raw_path, str):
        raise ValueError("Path must be a string")
    s = raw_path.strip()
    if not s:
        raise ValueError("Empty path")
    if len(s) > _MAX_STACK_TRACE_PATH_LEN:
        raise ValueError("Path exceeds maximum length")
    if "\x00" in s:
        raise ValueError("Path contains null byte")
    if _path_parts_contain_dotdot(s):
        raise ValueError("Path must not contain '..' components")
    if require_absolute_posix and not s.startswith("/"):
        raise ValueError("Remote stack trace path must be absolute")
    return s


def _normalize_remote_posix_path(validated: str) -> str:
    """Stable POSIX path string for remote SSH operations (no local Path.resolve)."""
    return PurePosixPath(validated).as_posix()


def _remote_path_under_tt_metal_root(file_posix: str, root: str) -> bool:
    """True if file_posix is the root or a file/dir inside root (POSIX prefix rules)."""
    root_norm = root.rstrip("/") or "/"
    if file_posix == root_norm:
        return True
    return file_posix.startswith(root_norm + "/")


def _remote_literal_read_allowed(path_posix: str, roots: list[str]) -> bool:
    """Only pass literal paths to SSH when they fall under a discovered tt-metal root."""
    if not path_posix.startswith("/"):
        return False
    return any(_remote_path_under_tt_metal_root(path_posix, r) for r in roots)


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


def _discover_tt_metal_roots_local() -> list[Path]:
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


def _extract_suffix_after_tt_metal(raw_path: str) -> Optional[str]:
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


def _safe_join_under_tt_metal_root(root: Path, suffix: str) -> Path:
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


def _join_remote_tt_metal_path(remote_root: str, suffix: str) -> str:
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


def _read_text_file(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def _is_readable_regular_file(path: Path) -> bool:
    """True if path is a regular file and readable by this process."""
    try:
        return path.is_file() and os.access(path, os.R_OK)
    except OSError:
        return False


def _resolve_local_stack_path(raw_path: str) -> Tuple[Path, bool]:
    """
    Resolve a filesystem path for reading local stack trace source.

    Returns (path, remapped) where remapped is True if a /tt-metal/ remap was applied.
    """
    raw_path = _validate_stack_trace_raw_path(raw_path)
    roots = _discover_tt_metal_roots_local()
    suffix = _extract_suffix_after_tt_metal(raw_path)
    if suffix is not None:
        if not roots:
            raise FileNotFoundError(
                "No local tt-metal directory found for path remapping"
            )
        expanded = Path(raw_path).expanduser()
        resolved_direct: Optional[Path] = None
        try:
            resolved_direct = expanded.resolve()
        except OSError:
            pass
        if resolved_direct is not None:
            for root in roots:
                try:
                    root_r = root.resolve()
                    if resolved_direct == root_r or resolved_direct.is_relative_to(
                        root_r
                    ):
                        if _is_readable_regular_file(resolved_direct):
                            return resolved_direct, False
                        break
                except (ValueError, OSError):
                    continue

        last_err: Optional[Exception] = None
        for root in roots:
            try:
                candidate = _safe_join_under_tt_metal_root(root, suffix)
                if _is_readable_regular_file(candidate):
                    cand_res = candidate.resolve()
                    if resolved_direct is not None and cand_res == resolved_direct:
                        return candidate, False
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
                if _is_readable_regular_file(resolved):
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
    path, remapped = _resolve_local_stack_path(raw_path)
    text = _read_text_file(path)
    return text, str(path), remapped


def _discover_tt_metal_roots_remote(ssh_client: "SSHClient") -> list[str]:
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


def _preferred_remote_user_root_for_raw_path(
    ssh_client: "SSHClient", raw_path: str
) -> Optional[str]:
    """
    If raw_path points into /localdev/<user>/tt-metal or /proj_sw/<user>/tt-metal,
    prefer trying the same prefix with the current SSH username.
    """
    match = _USER_ROOT_PREFIX_RE.match(raw_path)
    username = (getattr(ssh_client.connection, "username", None) or "").strip()
    if not match or not username:
        return None
    return f"/{match.group(1)}/{username}/tt-metal"


def _remote_roots_for_raw_path(ssh_client: "SSHClient", raw_path: str) -> list[str]:
    roots = _discover_tt_metal_roots_remote(ssh_client)
    preferred_root = _preferred_remote_user_root_for_raw_path(ssh_client, raw_path)
    if not preferred_root:
        return roots
    if preferred_root in roots:
        return [preferred_root, *[r for r in roots if r != preferred_root]]
    return [preferred_root, *roots]


def read_stack_source_remote(
    ssh_client: "SSHClient", raw_path: str
) -> Tuple[str, str, bool]:
    """
    Read stack trace source from remote via SSH, trying remap after /tt-metal/ on failure.

    Literal paths are only read when they lie under a discovered remote tt-metal root;
    otherwise only remapped paths (suffix after ``/tt-metal/``) are attempted.

    :return: (content, resolved_path_str, remapped)
    """
    try:
        validated = _validate_stack_trace_raw_path(
            raw_path, require_absolute_posix=True
        )
    except ValueError as e:
        raise RemoteFileReadException(
            str(e), http_status_code=HTTPStatus.BAD_REQUEST
        ) from e

    path_str = _normalize_remote_posix_path(validated)
    roots = _remote_roots_for_raw_path(ssh_client, validated)
    not_found: Optional[RemoteFileReadException] = None

    if roots and _remote_literal_read_allowed(path_str, roots):
        try:
            content = ssh_client.read_file(path_str)
            text = (content or b"").decode("utf-8", errors="replace")
            return text, path_str, False
        except RemoteFileReadException as e:
            if e.http_status != HTTPStatus.NOT_FOUND:
                raise
            not_found = e

    suffix = _extract_suffix_after_tt_metal(validated)
    if suffix is None:
        if not_found is not None:
            raise not_found
        raise RemoteFileReadException(
            "File not found.",
            http_status_code=HTTPStatus.NOT_FOUND,
            detail=(
                "Path is not under discovered tt-metal roots on the remote host "
                "and has no /tt-metal/ segment for remapping."
            ),
        )

    if not roots:
        if not_found is not None:
            raise not_found
        raise RemoteFileReadException(
            "File not found.",
            http_status_code=HTTPStatus.NOT_FOUND,
            detail="No tt-metal roots discovered on the remote host for remapping.",
        )

    last_missing = not_found
    for root_str in roots:
        try:
            remapped_str = _join_remote_tt_metal_path(root_str, suffix)
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

    if last_missing is not None:
        raise last_missing
    raise RemoteFileReadException(
        "File not found.",
        http_status_code=HTTPStatus.NOT_FOUND,
    )


def _remote_regular_file_exists(ssh_client: "SSHClient", posix_path: str) -> bool:
    """True if remote path exists, is a regular file, and is readable (SSH test -f/-r)."""

    quoted_path = shlex.quote(posix_path)
    try:
        ssh_client.execute_command(
            f"test -f {quoted_path} && test -r {quoted_path}", timeout=15
        )
        return True
    except SSHException:
        return False


def check_stack_source_local(raw_path: str) -> bool:
    """Whether _resolve_local_stack_path would succeed (including /tt-metal/ remaps)."""
    try:
        _resolve_local_stack_path(raw_path)
        return True
    except (FileNotFoundError, OSError, ValueError):
        return False


def check_stack_source_remote(ssh_client: "SSHClient", raw_path: str) -> bool:
    """
    Whether read_stack_source_remote would succeed: literal path or remapped under any
    discovered tt-metal root (same roots as local).
    """
    try:
        validated = _validate_stack_trace_raw_path(
            raw_path, require_absolute_posix=True
        )
    except ValueError:
        return False

    path_str = _normalize_remote_posix_path(validated)
    roots = _remote_roots_for_raw_path(ssh_client, validated)
    if roots and _remote_literal_read_allowed(path_str, roots):
        if _remote_regular_file_exists(ssh_client, path_str):
            return True
    suffix = _extract_suffix_after_tt_metal(validated)
    if suffix is None:
        return False
    for root_str in roots:
        try:
            remapped_str = _join_remote_tt_metal_path(root_str, suffix)
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
