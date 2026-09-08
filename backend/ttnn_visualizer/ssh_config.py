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
import re
import shlex
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Set, TypeVar

from pydantic import ConfigDict
from ttnn_visualizer.models import SerializeableModel

logger = logging.getLogger(__name__)

T = TypeVar("T")

DEFAULT_SSH_CONFIG_PATH = Path.home() / ".ssh" / "config"
# OpenSSH allows 16 (MAX_READCONF_DEPTH). Matched here so a config it accepts never
# loses hosts from the picker, even though real configs nest one or two levels.
MAX_INCLUDE_DEPTH = 16
_KEYWORD_SEPARATOR_PATTERN = re.compile(r"([^\s=]+)\s*=?\s*(.*)")
# An argument containing none of these splits the same way with or without a lexer.
_QUOTING_CHARACTERS = ('"', "'", "\\")


class SshConfigHost(SerializeableModel):
    """One concrete Host alias from an SSH config file.

    ``IdentityFile`` is deliberately absent: the picker clears the dialog's identity
    field so OpenSSH keeps applying the stanza's own ``IdentityFile`` and ``ProxyJump``,
    which leaves a local key path with no reason to reach the browser.

    ``port`` is unconstrained because :func:`_store_host_block` drops an out-of-range
    value and keeps the alias; a ``Field`` bound would lose the whole stanza instead.
    """

    model_config = ConfigDict(frozen=True)

    host: str
    hostName: Optional[str] = None
    user: Optional[str] = None
    port: Optional[int] = None


class SshConfigHostsResult(SerializeableModel):
    """Payload for the SSH config host picker.

    Serialise with ``model_dump(exclude_none=True)``: the picker's TypeScript model
    declares the optional fields absent rather than null.
    """

    model_config = ConfigDict(frozen=True)

    configExists: bool
    hosts: List[SshConfigHost]


def load_ssh_config_hosts(
    config_path: Optional[Path] = None,
) -> SshConfigHostsResult:
    """Load concrete Host aliases from ``config_path`` (default ``~/.ssh/config``).

    When the config file is missing, ``configExists`` is false and ``hosts`` is
    empty so the UI can hide the picker. An existing but unreadable file reports
    ``configExists`` true with no hosts. A repeated alias keeps the first value
    obtained for each keyword, as OpenSSH does. Each file is parsed at most once, so
    an ``Include`` cycle or self-matching glob terminates.
    """
    path = config_path if config_path is not None else DEFAULT_SSH_CONFIG_PATH
    if not path.is_file():
        return SshConfigHostsResult(configExists=False, hosts=[])

    host_by_alias: Dict[str, SshConfigHost] = {}
    # ssh_config(5) resolves a relative Include against the SSH directory of the file
    # the read started from, not against whichever file holds the directive, so the
    # base is fixed once here rather than recomputed per file.
    _parse_ssh_config_file(
        path, host_by_alias, depth=0, visited=set(), base_dir=path.parent
    )
    return SshConfigHostsResult(configExists=True, hosts=list(host_by_alias.values()))


def _parse_ssh_config_file(
    path: Path,
    host_by_alias: Dict[str, SshConfigHost],
    depth: int,
    visited: Set[Path],
    base_dir: Path,
) -> None:
    # OpenSSH permits re-inclusion, but a picker only needs each file once and the
    # depth cap alone leaves Include fan-out exponential in the number of matches.
    # Checked before the depth cap: a file already parsed is not a runaway chain, and
    # warning about it would bury the case the cap exists for.
    try:
        resolved = path.resolve()
    except OSError:
        resolved = path
    if resolved in visited:
        return

    if depth > MAX_INCLUDE_DEPTH:
        logger.warning("SSH config Include depth exceeded at %s", path)
        return

    visited.add(resolved)

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
            # OpenSSH applies Include where it appears and the surrounding Host
            # context continues afterwards, so the open stanza is left pending —
            # flushing here would silently drop the keywords that follow.
            #
            # We deliberately diverge from OpenSSH on the included file's own state:
            # it threads the active stanza in by pointer, so a fragment both inherits
            # the open Host and can leave a different one active on return. Giving the
            # include fresh state and resuming the parent stanza keeps a mid-stanza
            # Include from silently rewriting the alias being read, and the worst a
            # picker loses is a HostName or Port prefill for a config shaped that way.
            # test_load_ssh_config_hosts_include_inside_host_keeps_later_keywords pins
            # this; don't "fix" it toward parity without replacing that test.
            for included in _expand_include_paths(argument, base_dir):
                _parse_ssh_config_file(
                    included, host_by_alias, depth + 1, visited, base_dir
                )
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
                if not _is_non_literal_host_pattern(alias)
            ]
            current_values = {}
            continue

        if in_match_block or not current_aliases:
            continue

        if keyword_lower == "hostname":
            current_values["hostName"] = _unquote_argument(argument)
        elif keyword_lower == "user":
            current_values["user"] = _unquote_argument(argument)
        elif keyword_lower == "port":
            current_values["port"] = _unquote_argument(argument)

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

    for alias in aliases:
        existing = host_by_alias.get(alias)
        if existing is None:
            host_by_alias[alias] = SshConfigHost(
                host=alias,
                hostName=values.get("hostName"),
                user=values.get("user"),
                port=port,
            )
            continue

        # OpenSSH uses the first value obtained for each parameter, so a repeated alias
        # only contributes the keywords an earlier stanza left unset.
        host_by_alias[alias] = SshConfigHost(
            host=alias,
            hostName=_first_set(existing.hostName, values.get("hostName")),
            user=_first_set(existing.user, values.get("user")),
            port=_first_set(existing.port, port),
        )


def _first_set(existing: Optional[T], candidate: Optional[T]) -> Optional[T]:
    return existing if existing is not None else candidate


def _split_tolerantly(argument: str) -> List[str]:
    """Split an argument into tokens, honouring quotes only when there are any.

    ``shlex.split`` builds a lexer and reads the string a character at a time, and it
    dominated the parse of a large generated config — the sort the module docstring
    anticipates. Arguments carrying no quote or escape character are the overwhelming
    majority and split identically on whitespace, so the lexer is reserved for the rest.
    Unbalanced quotes fall back to the plain split rather than losing the line.
    """
    if not any(char in argument for char in _QUOTING_CHARACTERS):
        return argument.split()

    try:
        return shlex.split(argument)
    except ValueError:
        return argument.split()


def _unquote_argument(argument: str) -> str:
    """Drop the quoting OpenSSH accepts around a keyword's value.

    ``User "alice"`` connects as ``alice``, so keeping the quotes would prefill the
    dialog with a username no remote host recognises. Only the first token is taken:
    these keywords are single-argument, and OpenSSH rejects a file that supplies two.
    """
    if not argument:
        return argument

    tokens = _split_tolerantly(argument)

    return tokens[0] if tokens else ""


def _strip_ssh_config_comment(line: str) -> str:
    """Drop a trailing comment, honouring quotes so a ``#`` inside a value survives.

    The scan below is per character, and the picker re-parses the whole include tree on every
    dialog open, so lines that cannot contain a comment skip it: the loop only ever returns
    early on ``#``, and quote state is discarded afterwards.
    """
    if "#" not in line:
        return line

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
    """Split ``Keyword value``, ``Keyword=value`` or ``Keyword = value``.

    OpenSSH allows whitespace, a single ``=``, or both between a keyword and its
    argument, so the whole separator has to be consumed at once — splitting on the
    first ``=`` alone reads ``Host = alias`` as the two aliases ``=`` and ``alias``.
    """
    match = _KEYWORD_SEPARATOR_PATTERN.match(line)
    if match is None:
        return None, ""

    return match.group(1), match.group(2).strip()


def _tokenise_host_patterns(argument: str) -> List[str]:
    if not argument:
        return []

    return _split_tolerantly(argument)


def _is_non_literal_host_pattern(pattern: str) -> bool:
    # Wildcards and negations describe a set of hosts rather than one you can connect
    # to, so neither belongs in a picker of concrete aliases.
    return pattern.startswith("!") or "*" in pattern or "?" in pattern


def _expand_include_paths(argument: str, base_dir: Path) -> List[Path]:
    patterns = _split_tolerantly(argument)
    resolved: List[Path] = []
    for pattern in patterns:
        expanded = os.path.expanduser(pattern)
        candidate = Path(expanded)
        if not candidate.is_absolute():
            candidate = base_dir / expanded

        # Globs also match directories, sockets and device nodes; reading one of
        # those would raise per match at best and block the worker at worst.
        matches = sorted(
            match
            for match in (Path(entry) for entry in glob.glob(str(candidate)))
            if match.is_file()
        )
        if matches:
            resolved.extend(matches)
        elif candidate.is_file():
            resolved.append(candidate)

    return resolved
