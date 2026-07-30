# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Parse ~/.ssh/config Host stanzas for the remote-connection picker.

This is intentionally a partial OpenSSH config reader: concrete ``Host``
aliases plus ``Include``, not full ``Match`` / weighted pattern merging.
"""

from __future__ import annotations

import glob
import logging
import os
import shlex
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional

logger = logging.getLogger(__name__)

DEFAULT_SSH_CONFIG_PATH = Path.home() / ".ssh" / "config"
MAX_INCLUDE_DEPTH = 5


@dataclass(frozen=True)
class SshConfigHost:
    """One concrete Host alias from an SSH config file."""

    host: str
    hostName: Optional[str] = None
    user: Optional[str] = None
    port: Optional[int] = None
    identityFile: Optional[str] = None

    def to_dict(self) -> Dict[str, object]:
        # Never serialise IdentityFile paths into the HTTP/browser surface.
        return {
            key: value
            for key, value in asdict(self).items()
            if value is not None and key != "identityFile"
        }


@dataclass(frozen=True)
class SshConfigHostsResult:
    """Payload for the SSH config host picker."""

    configExists: bool
    hosts: List[SshConfigHost]

    def to_dict(self) -> Dict[str, object]:
        return {
            "configExists": self.configExists,
            "hosts": [host.to_dict() for host in self.hosts],
        }


def load_ssh_config_hosts(
    config_path: Optional[Path] = None,
) -> SshConfigHostsResult:
    """Load concrete Host aliases from ``config_path`` (default ``~/.ssh/config``).

    When the config file is missing, ``configExists`` is false and ``hosts`` is
    empty so the UI can hide the picker. Unreadable files are treated the same.
    Duplicate aliases keep the last occurrence (OpenSSH last-wins).
    """
    path = config_path if config_path is not None else DEFAULT_SSH_CONFIG_PATH
    if not path.is_file():
        return SshConfigHostsResult(configExists=False, hosts=[])

    host_by_alias: Dict[str, SshConfigHost] = {}
    _parse_ssh_config_file(path, host_by_alias, depth=0)
    return SshConfigHostsResult(configExists=True, hosts=list(host_by_alias.values()))


def list_ssh_config_hosts(
    config_path: Optional[Path] = None,
) -> List[SshConfigHost]:
    """Return concrete Host aliases; empty when the config file is missing."""
    return load_ssh_config_hosts(config_path).hosts


def _parse_ssh_config_file(
    path: Path,
    host_by_alias: Dict[str, SshConfigHost],
    depth: int,
) -> None:
    if depth > MAX_INCLUDE_DEPTH:
        logger.warning("SSH config Include depth exceeded at %s", path)
        return

    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return
    except OSError as exc:
        logger.warning("Unable to read SSH config %s: %s", path, exc)
        return

    current_aliases: List[str] = []
    current_values: Dict[str, str] = {}
    in_match_block = False

    def flush_host_block() -> None:
        nonlocal current_aliases, current_values
        if current_aliases:
            _store_host_block(current_aliases, current_values, host_by_alias)
        current_aliases = []
        current_values = {}

    for raw_line in text.splitlines():
        line = _strip_ssh_config_comment(raw_line).strip()
        if not line:
            continue

        keyword, argument = _split_ssh_config_line(line)
        if keyword is None:
            continue

        keyword_lower = keyword.lower()

        if keyword_lower == "include":
            # Include applies regardless of current Host/Match context in OpenSSH;
            # flush any open Host first so included hosts don't inherit its values.
            flush_host_block()
            in_match_block = False
            for included in _expand_include_paths(argument, path.parent):
                _parse_ssh_config_file(included, host_by_alias, depth + 1)
            continue

        if keyword_lower == "match":
            flush_host_block()
            in_match_block = True
            continue

        if keyword_lower == "host":
            flush_host_block()
            in_match_block = False
            current_aliases = [
                alias
                for alias in _tokenise_host_patterns(argument)
                if not _is_wildcard_host_pattern(alias)
            ]
            current_values = {}
            continue

        if in_match_block or not current_aliases:
            continue

        if keyword_lower == "hostname":
            current_values["hostName"] = argument
        elif keyword_lower == "user":
            current_values["user"] = argument
        elif keyword_lower == "port":
            current_values["port"] = argument
        elif keyword_lower == "identityfile":
            # Keep the first IdentityFile in the stanza; later ones are fallbacks.
            current_values.setdefault("identityFile", argument)

    flush_host_block()


def _store_host_block(
    aliases: Iterable[str],
    values: Dict[str, str],
    host_by_alias: Dict[str, SshConfigHost],
) -> None:
    port: Optional[int] = None
    raw_port = values.get("port")
    if raw_port is not None:
        try:
            parsed = int(raw_port)
        except ValueError:
            parsed = None
        if parsed is not None and 1 <= parsed <= 65535:
            port = parsed

    identity = values.get("identityFile")
    if identity:
        identity = os.path.expanduser(identity)

    for alias in aliases:
        host_by_alias[alias] = SshConfigHost(
            host=alias,
            hostName=values.get("hostName"),
            user=values.get("user"),
            port=port,
            identityFile=identity,
        )


def _strip_ssh_config_comment(line: str) -> str:
    in_single = False
    in_double = False
    for index, char in enumerate(line):
        if char == "'" and not in_double:
            in_single = not in_single
        elif char == '"' and not in_single:
            in_double = not in_double
        elif char == "#" and not in_single and not in_double:
            return line[:index]
    return line


def _split_ssh_config_line(line: str) -> tuple[Optional[str], str]:
    """Split ``Keyword value`` or ``Keyword=value`` into keyword + remainder."""
    if "=" in line.split(None, 1)[0]:
        keyword, _, remainder = line.partition("=")
        return keyword.strip() or None, remainder.strip()

    parts = line.split(None, 1)
    if not parts:
        return None, ""
    if len(parts) == 1:
        return parts[0], ""
    return parts[0], parts[1].strip()


def _tokenise_host_patterns(argument: str) -> List[str]:
    if not argument:
        return []
    try:
        return shlex.split(argument)
    except ValueError:
        return argument.split()


def _is_wildcard_host_pattern(pattern: str) -> bool:
    return "*" in pattern or "?" in pattern


def _expand_include_paths(argument: str, base_dir: Path) -> List[Path]:
    try:
        patterns = shlex.split(argument)
    except ValueError:
        patterns = argument.split()

    resolved: List[Path] = []
    for pattern in patterns:
        expanded = os.path.expanduser(pattern)
        candidate = Path(expanded)
        if not candidate.is_absolute():
            candidate = base_dir / expanded

        matches = sorted(Path(match) for match in glob.glob(str(candidate)))
        if matches:
            resolved.extend(matches)
        elif candidate.is_file():
            resolved.append(candidate)

    return resolved
