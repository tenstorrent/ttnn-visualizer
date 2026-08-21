# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Read and append ``~/.ssh/known_hosts`` for the in-app host-trust flow.

Reproduces what OpenSSH's own first-connection prompt does — show the fingerprint,
let the user decide, record the key — and nothing more. In particular this module
never passes ``StrictHostKeyChecking=no`` or ``accept-new`` anywhere, and never
rewrites or removes an existing entry: a key that changed is the user's to resolve.

Everything here shells out to the OpenSSH tools rather than parsing ``known_hosts``
directly, so hashed entries, ``HostKeyAlias`` and the ``[host]:port`` spelling stay
OpenSSH's business rather than becoming ours to re-implement.
"""

from __future__ import annotations

import base64
import binascii
import dataclasses
import hashlib
import logging
import os
import subprocess
from pathlib import Path
from typing import Dict, List, Optional

from ttnn_visualizer.enums import HostKeyIssue
from ttnn_visualizer.models import HostKeyOffer, HostKeyStatus, HostKeyTarget

logger = logging.getLogger(__name__)

DEFAULT_KNOWN_HOSTS_PATH = Path.home() / ".ssh" / "known_hosts"
DEFAULT_SSH_PORT = 22

# `ssh -G` only reads config files and resolves names; a host that does not exist
# still answers immediately, so this bounds a pathological ProxyCommand rather than
# any normal call.
SSH_CONFIG_RESOLVE_TIMEOUT = 10
# `ssh-keyscan`'s own -T, plus a little for process start-up. A host that never
# answers is the case this exists for: the user is waiting on a dialog.
HOST_KEY_SCAN_TIMEOUT = 10
KNOWN_HOSTS_LOOKUP_TIMEOUT = 10

# `~/.ssh` refuses to be used by OpenSSH if it is group- or world-readable, so a
# directory we create has to match what `ssh-keygen` would have made.
_SSH_DIRECTORY_MODE = 0o700
_KNOWN_HOSTS_MODE = 0o600

# `ssh -G` keys we act on. Parsed into a dict rather than scanned line by line so a
# repeated keyword keeps OpenSSH's first-wins behaviour.
_RESOLVED_HOSTNAME_KEY = "hostname"
_RESOLVED_PORT_KEY = "port"
_RESOLVED_HOST_KEY_ALIAS_KEY = "hostkeyalias"
_RESOLVED_PROXY_JUMP_KEY = "proxyjump"
_RESOLVED_PROXY_COMMAND_KEY = "proxycommand"

# `ssh -G` and `ssh-keyscan` both answer "none" for an unset ProxyCommand.
_UNSET_PROXY_VALUES = frozenset({"", "none"})


@dataclasses.dataclass(frozen=True)
class ResolvedSshTarget:
    """Where a connection's host key actually lives.

    ``entry_name`` is what ``known_hosts`` keys the record on and is not necessarily
    what the user typed: an ``~/.ssh/config`` alias resolves through ``HostName`` and
    ``Port``, and a non-default port is stored as ``[host]:port``.
    """

    #: The name the user put in the form, kept so the UI can say which host it means.
    requested_host: str
    #: The name to scan, after ``~/.ssh/config`` has had its say.
    scan_host: str
    #: The port to scan, likewise.
    scan_port: int
    #: The ``known_hosts`` lookup key.
    entry_name: str
    #: Reached through a jump host, so ``ssh-keyscan`` cannot see it at all.
    is_proxied: bool

    @property
    def alias(self) -> Optional[str]:
        """The requested host, when config resolved it to something else."""
        return self.requested_host if self.requested_host != self.scan_host else None


def known_hosts_entry_name(host: str, port: int) -> str:
    """The ``known_hosts`` key for a target, in OpenSSH's own spelling."""
    if port == DEFAULT_SSH_PORT:
        return host
    return f"[{host}]:{port}"


def resolve_ssh_target(target: HostKeyTarget) -> ResolvedSshTarget:
    """Resolve a form's host/port the way the connection itself will see them.

    Mirrors both of ``SSHClient._build_base_ssh_cmd``'s conditionals, because getting
    either wrong records a key under a name the real connection never looks up:
    ``-F os.devnull`` when an identity file is set, so the alias stays literal, and
    ``-p`` only for a non-default port, so config's ``Port`` still applies otherwise.
    """
    if (target.identityFile or "").strip():
        # With `-F os.devnull` the connection reads no config, so resolution is the
        # identity function and `ssh -G` would only add a way to fail.
        return ResolvedSshTarget(
            requested_host=target.host,
            scan_host=target.host,
            scan_port=target.port,
            entry_name=known_hosts_entry_name(target.host, target.port),
            is_proxied=False,
        )

    resolved = _read_ssh_config_resolution(target)
    scan_host = resolved.get(_RESOLVED_HOSTNAME_KEY) or target.host
    scan_port = _coerce_port(resolved.get(_RESOLVED_PORT_KEY), target.port)
    # HostKeyAlias exists precisely to decouple the stored key from the address, so it
    # wins over the resolved hostname when the user set one.
    key_alias = resolved.get(_RESOLVED_HOST_KEY_ALIAS_KEY)

    return ResolvedSshTarget(
        requested_host=target.host,
        scan_host=scan_host,
        scan_port=scan_port,
        entry_name=(
            key_alias if key_alias else known_hosts_entry_name(scan_host, scan_port)
        ),
        is_proxied=_is_proxied(resolved),
    )


def host_key_status(
    target: HostKeyTarget,
    issue: HostKeyIssue,
    known_hosts_entry: Optional[str] = None,
) -> HostKeyStatus:
    """Describe a host-key failure against the target it actually concerns.

    Called while handling an exception, so resolution is never allowed to raise: a
    verdict naming the typed host is worth far more than losing the verdict — and
    losing it is precisely the bug this whole flow exists to fix.
    """
    try:
        resolved = resolve_ssh_target(target)
    except Exception:  # noqa: BLE001 - see above; the verdict outranks the detail
        logger.warning(
            "Could not resolve %s while reporting a host key failure", target.host
        )
        return HostKeyStatus(issue=issue, host=target.host, port=target.port)

    return HostKeyStatus(
        issue=issue,
        host=resolved.scan_host,
        port=resolved.scan_port,
        alias=resolved.alias,
        isProxied=resolved.is_proxied,
        knownHostsEntry=known_hosts_entry,
    )


@dataclasses.dataclass(frozen=True)
class KnownHostsMatch:
    """What ``known_hosts`` already records for one entry name."""

    #: The recorded key lines, empty when nothing is known for the host.
    lines: List[str]
    #: ``"<file>:<line>"`` of the first match, for pointing the user at the entry.
    location: Optional[str] = None

    def __bool__(self) -> bool:
        return bool(self.lines)

    def matches_any(self, key_lines: List[str]) -> bool:
        """Whether any of ``key_lines`` is already recorded, comparing key material.

        The entry name differs between a scanned line and a stored one whenever
        ``HostKeyAlias`` or hashing is in play, so only the type and blob are compared.
        """
        recorded = {_key_material(line) for line in self.lines}
        return any(_key_material(line) in recorded for line in key_lines)


def search_known_hosts(entry_name: str, path: Optional[Path] = None) -> KnownHostsMatch:
    """Look up ``entry_name`` via ``ssh-keygen -F``.

    Shelled out rather than parsed so a hashed ``known_hosts`` matches as OpenSSH
    would. Exit 1 means no entry and exit 255 means no file — both are "nothing
    recorded", not errors worth surfacing. The line number is only available from the
    ``# Host … found: line N`` comment, which is why it is read here rather than by
    reopening the file.
    """
    known_hosts = path or DEFAULT_KNOWN_HOSTS_PATH
    try:
        result = subprocess.run(
            ["ssh-keygen", "-f", str(known_hosts), "-F", entry_name],
            capture_output=True,
            text=True,
            timeout=KNOWN_HOSTS_LOOKUP_TIMEOUT,
        )
    except (OSError, subprocess.TimeoutExpired):
        logger.warning("Could not search %s for %s", known_hosts, entry_name)
        return KnownHostsMatch(lines=[])

    if result.returncode != 0:
        return KnownHostsMatch(lines=[])

    lines = _key_lines(result.stdout)
    if not lines:
        return KnownHostsMatch(lines=[])
    return KnownHostsMatch(
        lines=lines, location=_first_match_location(result.stdout, known_hosts)
    )


def _first_match_location(output: str, known_hosts: Path) -> str:
    for line in output.splitlines():
        stripped = line.strip()
        if stripped.startswith("#") and "found: line" in stripped:
            _, _, line_number = stripped.rpartition("line")
            return f"{known_hosts}:{line_number.strip()}"
    return str(known_hosts)


def _key_material(known_hosts_line: str) -> str:
    """The type and blob of a ``known_hosts`` line, without its host field."""
    fields = known_hosts_line.split()
    if len(fields) < 3:
        return known_hosts_line.strip()
    return f"{fields[1]} {fields[2]}"


def scan_host_keys(host: str, port: int) -> List[HostKeyOffer]:
    """The keys ``host`` currently offers, each with its SHA256 fingerprint.

    ``ssh-keyscan`` exits 0 even when every lookup failed — an unresolvable name
    yields ``getaddrinfo …`` on stderr and a zero status — so success is judged by
    having parsed at least one key line, never by the exit code.
    """
    try:
        result = subprocess.run(
            ["ssh-keyscan", "-T", str(HOST_KEY_SCAN_TIMEOUT), "-p", str(port), host],
            capture_output=True,
            text=True,
            timeout=HOST_KEY_SCAN_TIMEOUT + 5,
        )
    except (OSError, subprocess.TimeoutExpired):
        logger.warning("Could not scan host keys for %s:%s", host, port)
        return []

    key_lines = _key_lines(result.stdout)
    if not key_lines:
        logger.info(
            "No host keys offered by %s:%s (%s)",
            host,
            port,
            (result.stderr or "").strip() or "no output",
        )
        return []

    offers = []
    for line in key_lines:
        fields = line.split()
        if len(fields) < 3:
            continue
        key_type, key_blob = fields[1], fields[2]
        fingerprint = host_key_fingerprint(key_blob)
        if not fingerprint:
            # Without a fingerprint there is nothing for the user to compare, and
            # offering a key they cannot check is the one thing this flow must not do.
            logger.warning("Skipping %s key for %s with no fingerprint", key_type, host)
            continue
        offers.append(
            HostKeyOffer(keyType=key_type, fingerprint=fingerprint, line=line)
        )
    return offers


def append_host_keys(lines: List[str], path: Optional[Path] = None) -> None:
    """Append scanned ``known_hosts`` lines, never touching what is already there.

    Opened in append mode so a concurrent writer cannot lose an entry, and the file
    and its directory are created with the modes OpenSSH insists on.
    """
    known_hosts = path or DEFAULT_KNOWN_HOSTS_PATH
    known_hosts.parent.mkdir(mode=_SSH_DIRECTORY_MODE, parents=True, exist_ok=True)
    if not known_hosts.exists():
        # Created before opening so the key is never briefly world-readable.
        known_hosts.touch(mode=_KNOWN_HOSTS_MODE)

    needs_separator = _needs_leading_newline(known_hosts)
    with known_hosts.open("a", encoding="utf-8") as handle:
        if needs_separator:
            # A file whose last line has no terminator would otherwise have our first
            # entry appended onto it, corrupting both.
            handle.write("\n")
        for line in lines:
            handle.write(f"{line.rstrip()}\n")

    logger.info("Appended %d host key(s) to %s", len(lines), known_hosts)


def _read_ssh_config_resolution(target: HostKeyTarget) -> Dict[str, str]:
    """``ssh -G`` output as a first-wins keyword map.

    ``ssh -G`` exits 0 even for a name that does not resolve, and prints
    "Pseudo-terminal will not be allocated…" to stderr, so neither is read as failure.
    """
    argv = ["ssh", "-G"]
    if target.port != DEFAULT_SSH_PORT:
        argv.extend(["-p", str(target.port)])
    argv.append(target.host)

    try:
        result = subprocess.run(
            argv, capture_output=True, text=True, timeout=SSH_CONFIG_RESOLVE_TIMEOUT
        )
    except (OSError, subprocess.TimeoutExpired):
        logger.warning("Could not resolve SSH config for %s", target.host)
        return {}

    if result.returncode != 0:
        logger.info(
            "ssh -G failed for %s: %s", target.host, (result.stderr or "").strip()
        )
        return {}

    resolved: Dict[str, str] = {}
    for line in result.stdout.splitlines():
        keyword, _, value = line.strip().partition(" ")
        if not keyword:
            continue
        resolved.setdefault(keyword.lower(), value.strip())
    return resolved


def _is_proxied(resolved: Dict[str, str]) -> bool:
    """Whether the connection goes through a jump host or a proxy command.

    ``ssh-keyscan`` takes no config and has no ``-J``, so it connects directly or not
    at all — a proxied host simply cannot be scanned.
    """
    return any(
        (resolved.get(key) or "").strip().lower() not in _UNSET_PROXY_VALUES
        for key in (_RESOLVED_PROXY_JUMP_KEY, _RESOLVED_PROXY_COMMAND_KEY)
    )


def _coerce_port(value: Optional[str], fallback: int) -> int:
    try:
        port = int((value or "").strip())
    except ValueError:
        return fallback
    return port if 1 <= port <= 65535 else fallback


def _key_lines(output: str) -> List[str]:
    """Key lines from ``ssh-keyscan``/``ssh-keygen -F`` output.

    Both write their ``#`` banner and "found: line N" comments to *stdout* alongside
    the keys, so a parser that keeps every non-empty line would treat them as keys.
    """
    return [
        line.strip()
        for line in output.splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    ]


def host_key_fingerprint(key_blob: str) -> Optional[str]:
    """OpenSSH's ``SHA256:…`` fingerprint for a base64 host-key blob.

    Computed rather than shelled out to ``ssh-keygen -lf -``, whose output carries the
    comment field but not the blob: pairing its lines back to the input would have to
    go by position, and a key it silently declined to read would then mislabel every
    fingerprint after it. This is the definition — base64 of the SHA256 of the raw
    key, minus the padding — and is pinned against real keys in the tests.
    """
    try:
        raw_key = base64.b64decode(key_blob, validate=True)
    except (binascii.Error, ValueError):
        return None
    if not raw_key:
        return None
    digest = hashlib.sha256(raw_key).digest()
    return f"SHA256:{base64.b64encode(digest).decode().rstrip('=')}"


def _needs_leading_newline(path: Path) -> bool:
    """Whether the file's last byte leaves a line unterminated."""
    try:
        if path.stat().st_size == 0:
            return False
        with path.open("rb") as handle:
            handle.seek(-1, os.SEEK_END)
            return handle.read(1) != b"\n"
    except OSError:
        return False
