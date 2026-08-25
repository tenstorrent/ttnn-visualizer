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
import shlex
import subprocess
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple, Union

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
_RESOLVED_USER_KNOWN_HOSTS_KEY = "userknownhostsfile"
_RESOLVED_GLOBAL_KNOWN_HOSTS_KEY = "globalknownhostsfile"

# `ssh -G` spells an unset ProxyCommand, and an intentionally empty known-hosts
# file list, as the literal string "none".
_UNSET_PROXY_VALUES = frozenset({"", "none"})

# A `known_hosts` marker keyword prefixes the line and shifts every other field along by
# one, and `ssh-keygen -F` reports a marker line as a hit like any other — a
# `@cert-authority *` stanza matches every hostname there is. No marker pins the host's
# own key, but they do not all mean the same thing: a CA signs host certificates and says
# nothing about a raw key, while this one forbids a specific key outright.
_REVOKED_MARKER = "@revoked"


@dataclasses.dataclass(frozen=True)
class ResolvedSshTarget:
    """Where a connection's host key actually lives.

    ``entry_name`` is what ``known_hosts`` keys the record on and is not necessarily
    what the user typed: an ``~/.ssh/config`` alias resolves through ``HostName`` and
    ``Port``, a ``HostKeyAlias`` replaces both, and a non-default port is stored as
    ``[host]:port``.
    """

    #: The name the user put in the form, kept so the UI can say which host it means.
    requested_host: str
    #: The username the connection will use, so `ssh -G` applies `Match user` stanzas.
    username: Optional[str]
    #: The name to scan, after ``~/.ssh/config`` has had its say.
    scan_host: str
    #: The port to scan, likewise.
    scan_port: int
    #: The ``known_hosts`` lookup key.
    entry_name: str
    #: Reached through a jump host, so ``ssh-keyscan`` cannot see it at all.
    is_proxied: bool
    #: Every file OpenSSH will consult, user files first, in its own order.
    known_hosts_files: Tuple[Path, ...]
    #: The file to append to — the first ``UserKnownHostsFile``, never a global one.
    write_target: Path

    @property
    def alias(self) -> Optional[str]:
        """The requested host, when config resolved it to something else."""
        return self.requested_host if self.requested_host != self.scan_host else None

    @property
    def terminal_command(self) -> str:
        """The ``ssh`` invocation that would let OpenSSH prompt for the key itself.

        The fallback remedy whenever we cannot offer a key: a proxied host, a scan that
        came back empty, or a dialog with no trust affordance wired in.
        """
        target = (
            f"{self.username}@{self.requested_host}"
            if self.username
            else self.requested_host
        )
        if self.scan_port != DEFAULT_SSH_PORT:
            return f"ssh -p {self.scan_port} {target}"
        return f"ssh {target}"

    @property
    def removal_command(self) -> str:
        """``ssh-keygen -R`` for this target's actual ``known_hosts`` key.

        The sole producer: the backend message and the UI both read this, so they cannot
        show two different commands for one failure — and neither has to re-derive the
        bracket-quoting or the ``HostKeyAlias`` case.
        """
        # Brackets are shell metacharacters, so a bracketed entry is quoted to stay
        # copyable as-is.
        if self.entry_name.startswith("["):
            return f"ssh-keygen -R '{self.entry_name}'"
        return f"ssh-keygen -R {self.entry_name}"

    @property
    def wire_fields(self) -> Dict[str, object]:
        """This target as the fields both wire shapes share.

        Separate from :meth:`describe` because the offer response's ``issue`` is
        optional — "already trusted" is a real answer — while a status line's never is,
        so the two cannot be built by the same constructor call. Keeping the *mapping*
        in one place is the part that matters.
        """
        return {
            "host": self.scan_host,
            "port": self.scan_port,
            "alias": self.alias,
            "isProxied": self.is_proxied,
            "entryName": self.entry_name,
            "removalCommand": self.removal_command,
            "terminalCommand": self.terminal_command,
        }

    def describe(
        self, issue: HostKeyIssue, known_hosts_entry: Optional[str] = None
    ) -> HostKeyStatus:
        """The status-line shape for this target, for a verdict that always has an issue."""
        return HostKeyStatus(
            issue=issue, knownHostsEntry=known_hosts_entry, **self.wire_fields  # type: ignore[arg-type]
        )


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
        # identity function and `ssh -G` would only add a way to fail. The default
        # known-hosts files still apply — `-F` suppresses the config, not the defaults.
        return ResolvedSshTarget(
            requested_host=target.host,
            username=target.username,
            scan_host=target.host,
            scan_port=target.port,
            entry_name=known_hosts_entry_name(target.host, target.port),
            is_proxied=False,
            known_hosts_files=(DEFAULT_KNOWN_HOSTS_PATH,),
            write_target=DEFAULT_KNOWN_HOSTS_PATH,
        )

    resolved = _read_ssh_config_resolution(target)
    scan_host = resolved.get(_RESOLVED_HOSTNAME_KEY) or target.host
    scan_port = _coerce_port(resolved.get(_RESOLVED_PORT_KEY), target.port)
    # HostKeyAlias exists precisely to decouple the stored key from the address, so it
    # wins over the resolved hostname when the user set one.
    key_alias = resolved.get(_RESOLVED_HOST_KEY_ALIAS_KEY)
    user_files = _known_hosts_paths(resolved, _RESOLVED_USER_KNOWN_HOSTS_KEY)
    global_files = _known_hosts_paths(resolved, _RESOLVED_GLOBAL_KNOWN_HOSTS_KEY)

    return ResolvedSshTarget(
        requested_host=target.host,
        username=target.username,
        scan_host=scan_host,
        scan_port=scan_port,
        entry_name=(
            key_alias if key_alias else known_hosts_entry_name(scan_host, scan_port)
        ),
        is_proxied=_is_proxied(resolved),
        # OpenSSH accepts a host whose key matches an entry in *any* of these, so all of
        # them have to be searched before calling a host unknown — a host pinned only in
        # the admin-managed global file would otherwise look new, and appending to the
        # user's file would then quietly override that pin.
        known_hosts_files=tuple(user_files + global_files)
        or (DEFAULT_KNOWN_HOSTS_PATH,),
        # Only ever a user file: the global ones are the administrator's, and OpenSSH
        # itself never writes to them.
        write_target=user_files[0] if user_files else DEFAULT_KNOWN_HOSTS_PATH,
    )


def host_key_status(target: HostKeyTarget, issue: HostKeyIssue) -> HostKeyStatus:
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
        return _unresolved_host_key_status(target, issue)

    # Only looked up for a changed key: it is the one case where the user has to go and
    # find an entry, and the lookup costs a subprocess. Guarded separately from the
    # resolution above so a failed lookup costs only the file:line pointer — folding it
    # into that `except` would throw away a perfectly good resolved target too.
    known_hosts_entry = None
    if issue is HostKeyIssue.CHANGED:
        try:
            known_hosts_entry = search_known_hosts(
                resolved.entry_name, resolved.known_hosts_files
            ).location
        except Exception:  # noqa: BLE001 - a missing pointer beats a lost verdict
            logger.warning(
                "Could not locate the known_hosts entry for %s", resolved.entry_name
            )

    return resolved.describe(issue, known_hosts_entry)


def _unresolved_host_key_status(
    target: HostKeyTarget, issue: HostKeyIssue
) -> HostKeyStatus:
    """A verdict built from the form alone, for when resolution could not run."""
    fallback = ResolvedSshTarget(
        requested_host=target.host,
        username=target.username,
        scan_host=target.host,
        scan_port=target.port,
        entry_name=known_hosts_entry_name(target.host, target.port),
        is_proxied=False,
        known_hosts_files=(DEFAULT_KNOWN_HOSTS_PATH,),
        write_target=DEFAULT_KNOWN_HOSTS_PATH,
    )
    return fallback.describe(issue)


@dataclasses.dataclass(frozen=True)
class KnownHostsMatch:
    """What ``known_hosts`` already records for one entry name.

    Pins and revocations are kept apart because they are opposite answers: a pin is a key
    the host may present, a revocation is one it must never present again. A line that is
    neither — a ``@cert-authority`` stanza whose pattern happens to match this hostname —
    is recorded as neither, because it says nothing about the host's own key.
    """

    #: The recorded key lines, empty when nothing is pinned for the host.
    lines: List[str]
    #: ``"<file>:<line>"`` of the first pinned line, for pointing the user at the entry.
    location: Optional[str] = None
    #: ``@revoked`` lines, each naming one key this host must never present again.
    revoked_lines: List[str] = dataclasses.field(default_factory=list)
    #: ``"<file>:<line>"`` of the first revocation, likewise.
    revoked_location: Optional[str] = None

    def __bool__(self) -> bool:
        return bool(self.lines)

    def matches_any(self, key_lines: List[str]) -> bool:
        """Whether any of ``key_lines`` is already recorded, comparing key material.

        The entry name differs between a scanned line and a stored one whenever
        ``HostKeyAlias`` or hashing is in play, so only the type and blob are compared.
        """
        recorded = {_key_material(line) for line in self.lines}
        return any(_key_material(line) in recorded for line in key_lines)

    def revokes_any(self, key_lines: List[str]) -> bool:
        """Whether any of ``key_lines`` is a key this host is forbidden to present.

        Compared against the keys actually offered rather than answered from the mere
        presence of a revocation: ``@revoked`` blacklists one key, so a host that has
        since rotated to another is trustable again and a stale revocation must not
        block it. Only a match is a refusal.
        """
        revoked = {_key_material(line) for line in self.revoked_lines}
        return any(_key_material(line) in revoked for line in key_lines)


def search_known_hosts(
    entry_name: str, paths: Optional[Union[Path, Sequence[Path]]] = None
) -> KnownHostsMatch:
    """Look up ``entry_name`` across every ``known_hosts`` file OpenSSH would consult.

    Searches all of them because OpenSSH accepts a host whose offered key matches an
    entry in any one — so deciding "unknown" from the default file alone would call a
    globally-pinned host new, and trusting it would override that pin.

    Shelled out rather than parsed so a hashed ``known_hosts`` matches as OpenSSH
    would. Exit 1 means no entry and exit 255 means no file — both are "nothing
    recorded", not errors worth surfacing. The line number is only available from the
    ``# Host … found: line N`` comment, which is why it is read here rather than by
    reopening the file.

    Marker lines come back as hits too, and are classified rather than counted as pins:
    treating a ``@cert-authority *`` stanza as a recorded host key made every host look
    like one whose key had changed, since the marker shifts the fields along and the
    blob then never compares equal.
    """
    pins: List[str] = []
    location: Optional[str] = None
    revoked: List[str] = []
    revoked_location: Optional[str] = None

    if paths is None:
        search_paths: Sequence[Path] = (DEFAULT_KNOWN_HOSTS_PATH,)
    elif isinstance(paths, Path):
        # Normalised rather than rejected: a bare Path is not iterable, so the
        # alternative is a TypeError at the first file instead of a search.
        search_paths = (paths,)
    else:
        search_paths = tuple(paths) or (DEFAULT_KNOWN_HOSTS_PATH,)

    for known_hosts in search_paths:
        try:
            result = subprocess.run(
                ["ssh-keygen", "-f", str(known_hosts), "-F", entry_name],
                capture_output=True,
                text=True,
                timeout=KNOWN_HOSTS_LOOKUP_TIMEOUT,
            )
        except (OSError, subprocess.TimeoutExpired):
            logger.warning("Could not search %s for %s", known_hosts, entry_name)
            continue

        if result.returncode != 0:
            continue

        found = _parse_lookup_output(result.stdout, known_hosts)

        pins.extend(found.lines)
        revoked.extend(found.revoked_lines)
        if location is None:
            location = found.location
        if revoked_location is None:
            revoked_location = found.revoked_location

    return KnownHostsMatch(
        lines=pins,
        location=location,
        revoked_lines=revoked,
        revoked_location=revoked_location,
    )


def _parse_lookup_output(output: str, known_hosts: Path) -> KnownHostsMatch:
    """Split one ``ssh-keygen -F`` run's stdout into pins and revocations.

    ``-F`` writes a ``# Host … found: line N`` comment immediately before each line it
    matched, so a line number belongs to the line that follows its comment and is only
    obtainable by walking the two together.
    """
    pins: List[str] = []
    revoked: List[str] = []
    location: Optional[str] = None
    revoked_location: Optional[str] = None
    found_at: Optional[str] = None

    for raw_line in output.splitlines():
        line = raw_line.strip()
        if not line:
            continue

        if line.startswith("#"):
            line_number = _found_line_number(line)
            if line_number:
                found_at = f"{known_hosts}:{line_number}"
            continue

        marker = line.split(maxsplit=1)[0]
        if marker == _REVOKED_MARKER:
            revoked.append(line)
            revoked_location = revoked_location or found_at or str(known_hosts)
        elif not marker.startswith("@"):
            pins.append(line)
            location = location or found_at or str(known_hosts)
        # Anything else — `@cert-authority`, or a keyword OpenSSH gains later — is left
        # out of both: it is not this host's key, and guessing at an unrecognised marker
        # is how a CA came to be read as a pin in the first place.

        # Cleared per line so a match whose comment could not be parsed reports the file
        # rather than inheriting the previous match's line number.
        found_at = None

    return KnownHostsMatch(
        lines=pins,
        location=location,
        revoked_lines=revoked,
        revoked_location=revoked_location,
    )


def _found_line_number(comment: str) -> Optional[str]:
    """The ``N`` from one ``# Host … found: line N`` comment.

    Only the first field after the number is read because a marker line appends ``CA``
    or ``REVOKED`` to that comment, and taking the remainder of it wholesale produced
    pointers spelled ``known_hosts:1 CA``.
    """
    _, marker, remainder = comment.partition("found: line")
    if not marker:
        return None

    fields = remainder.split()
    return fields[0] if fields else None


def _key_material(known_hosts_line: str) -> str:
    """The type and blob of a ``known_hosts`` line, without its host field."""
    fields = known_hosts_line.split()
    # A marker shifts every field along by one, so a comparison that skipped this read
    # the hostname pattern as the key type and never matched anything.
    if fields and fields[0].startswith("@"):
        fields = fields[1:]
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


def rekey_host_line(known_hosts_line: str, entry_name: str) -> str:
    """Re-address a scanned line to the name OpenSSH will actually look up.

    ``ssh-keyscan`` keys its output on the address it connected to, but the lookup key
    is ``entry_name`` — which differs whenever ``HostKeyAlias`` is set. Appending the
    scanned line unchanged records the key under a name nothing reads: the connection
    keeps failing, and because the lookup still finds nothing every retry appends
    another unused copy.
    """
    fields = known_hosts_line.split(maxsplit=1)
    if len(fields) < 2:
        return known_hosts_line.strip()
    return f"{entry_name} {fields[1].strip()}"


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
    if target.username:
        # `Match user …` stanzas can set HostName, Port, HostKeyAlias and ProxyJump, so
        # resolving without the username answers for a different connection than the
        # one that failed — and getting `proxyjump` wrong means offering to scan a host
        # that is only reachable through a jump.
        argv.extend(["-l", target.username])
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


def _known_hosts_paths(resolved: Dict[str, str], keyword: str) -> List[Path]:
    """The paths one ``ssh -G`` known-hosts keyword names, in OpenSSH's order.

    ``ssh -G`` prints these already ``~``-expanded and space separated. ``shlex`` rather
    than ``str.split`` so a quoted path containing a space survives; ``none`` is
    OpenSSH's way of saying "no file", so it is dropped rather than treated as one.
    """
    value = (resolved.get(keyword) or "").strip()
    if not value:
        return []

    try:
        candidates = shlex.split(value)
    except ValueError:
        candidates = value.split()

    return [
        Path(candidate).expanduser()
        for candidate in candidates
        if candidate.strip().lower() not in _UNSET_PROXY_VALUES
    ]


def _coerce_port(value: Optional[str], fallback: int) -> int:
    try:
        port = int((value or "").strip())
    except ValueError:
        return fallback
    return port if 1 <= port <= 65535 else fallback


def _key_lines(output: str) -> List[str]:
    """Key lines from ``ssh-keyscan`` output.

    It writes its ``#`` banner comments to *stdout* alongside the keys, so a parser that
    kept every non-empty line would treat them as keys. ``ssh-keygen -F`` output goes
    through :func:`_parse_lookup_output` instead, which has marker lines to classify as
    well as comments to drop.
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
