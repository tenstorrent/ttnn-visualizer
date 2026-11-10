# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Opt-in configuration for exporting aggregate usage metrics."""

import errno
import ipaddress
import json
import logging
import os
import tempfile
import time
import uuid
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import IO, Any, Dict, Iterator, Optional
from urllib.parse import urlsplit

from ttnn_visualizer.event_logging import get_event_log_root

logger = logging.getLogger(__name__)

COLLECTION_CONFIG_FILENAME = "collection.json"
MACHINE_ID_LABEL = "machine_id"
PRIVATE_FILE_MODE = 0o600
PRIVATE_DIRECTORY_MODE = 0o700
METRIC_PREFIX = "ttnn_visualizer_"
# Serialises generating the machine ID, so processes preparing at once settle on one.
COLLECTION_LOCK_NAME = ".collection.lock"
# Holders only read and write a small file, so a longer wait means one is stopped, and
# startup must not hang behind it.
_COLLECTION_LOCK_TIMEOUT_SECONDS = 3.0
_LOCK_POLL_SECONDS = 0.05
_RENAMED_TOKEN_FIELD = "remote_write_bearer_token"
# Prometheus and Mimir remote-write receivers.
_REMOTE_WRITE_PATHS = ("/api/v1/write", "/api/v1/push")

# Tests replace this so they never inspect or modify the developer's real config.
COLLECTION_CONFIG_PATH: Optional[Path] = None


@dataclass(frozen=True)
class UsageCollectionConfig:
    enabled: bool = False
    remote_write_endpoint: Optional[str] = None
    # Excluded from ``repr`` so logging or printing a config never reveals the secret.
    remote_write_auth_token: Optional[str] = field(default=None, repr=False)
    machine_id: Optional[str] = None
    error: Optional[str] = None

    @property
    def can_export(self) -> bool:
        """Whether there is an endpoint to push to and an identity to push under.

        The one definition the launch banner, the exporter's start and every push use,
        so they cannot disagree about whether collection is on.
        """
        return (
            self.enabled
            and self.remote_write_endpoint is not None
            and self.machine_id is not None
        )


def get_collection_config_path() -> Path:
    if COLLECTION_CONFIG_PATH is not None:
        return COLLECTION_CONFIG_PATH

    # Beside the recording opt-out marker rather than in the app data directory: this is
    # a usage-recording control, and that directory belongs to the report database.
    return get_event_log_root() / COLLECTION_CONFIG_FILENAME


def is_loopback_host(hostname: Optional[str]) -> bool:
    if hostname is None:
        return False
    if hostname.lower() == "localhost":
        return True
    try:
        return ipaddress.ip_address(hostname).is_loopback
    except ValueError:
        return False


def _validate_remote_write_endpoint(value: Any) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("remote_write_endpoint must be a non-empty URL")

    endpoint = value.strip()
    # Checked before parsing, because ``urlsplit`` silently drops tabs and line breaks
    # and would pass a URL that still carries them. A line break would end the option
    # in curl's line-based config and let the rest of the value set others.
    if not endpoint.isprintable() or any(character.isspace() for character in endpoint):
        raise ValueError(
            "remote_write_endpoint must not contain whitespace or control characters"
        )
    parsed = urlsplit(endpoint)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("remote_write_endpoint must be an HTTP(S) URL")
    # Accessing ``port`` performs urllib's numeric and range validation.
    try:
        parsed.port
    except ValueError as error:
        raise ValueError("remote_write_endpoint has an invalid port") from error
    # Credentials are refused because the URL can appear in error messages and logs.
    # Authenticate with ``remote_write_auth_token`` instead.
    if parsed.username is not None or parsed.password is not None:
        raise ValueError("remote_write_endpoint must not contain credentials")
    if parsed.query:
        raise ValueError("remote_write_endpoint must not contain query parameters")
    if parsed.fragment:
        raise ValueError("remote_write_endpoint must not contain a fragment")
    if parsed.scheme != "https" and not is_loopback_host(parsed.hostname):
        raise ValueError("remote_write_endpoint must use HTTPS outside loopback")
    # Refused here rather than left to fail every push: v0.105 to v0.107 forwarded
    # through a local Prometheus, so a config from then names a remote-write path,
    # which cannot take the OTLP the launcher now sends.
    if parsed.path.rstrip("/").endswith(_REMOTE_WRITE_PATHS):
        raise ValueError(
            "remote_write_endpoint must accept OTLP/HTTP JSON metrics, such as "
            "/api/v1/otlp/v1/metrics, not a Prometheus remote-write path"
        )

    return endpoint


def _validate_remote_write_auth_token(value: Any) -> str:
    # Messages never include the value, because they are logged and printed.
    if not isinstance(value, str) or not value:
        raise ValueError("remote_write_auth_token must be a non-empty string")
    # Rejects whitespace and control characters, which are not valid in a bearer token
    # and would let the value break out of the ``Authorization`` header.
    if not value.isprintable() or any(character.isspace() for character in value):
        raise ValueError(
            "remote_write_auth_token must not contain whitespace or control characters"
        )
    return value


def _validate_machine_id(value: Any) -> str:
    if not isinstance(value, str):
        raise ValueError("machine_id must be a UUID")
    try:
        parsed = uuid.UUID(value)
    except ValueError as error:
        raise ValueError("machine_id must be a UUID") from error
    return parsed.hex


def _read_object(path: Path) -> Dict[str, Any]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError("collection config must be a JSON object")
    unknown = set(raw) - {
        "enabled",
        "remote_write_endpoint",
        "remote_write_auth_token",
        "machine_id",
    }
    # Named because the old field once shipped, and a bare "unknown fields" would leave
    # an opted-in user guessing why collection stopped.
    if _RENAMED_TOKEN_FIELD in unknown:
        raise ValueError(
            f"collection config field {_RENAMED_TOKEN_FIELD} is now "
            "remote_write_auth_token"
        )
    if unknown:
        raise ValueError("collection config contains unknown fields")
    return raw


def _write_text_atomically(path: Path, content: str) -> None:
    descriptor, temporary_name = tempfile.mkstemp(
        dir=path.parent, prefix=f".{path.name}.", text=True
    )
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as temporary_file:
            temporary_file.write(content)
        os.chmod(temporary_path, PRIVATE_FILE_MODE)
        os.replace(temporary_path, path)
    finally:
        temporary_path.unlink(missing_ok=True)


def _write_config(path: Path, data: Dict[str, Any]) -> None:
    path.parent.mkdir(mode=PRIVATE_DIRECTORY_MODE, parents=True, exist_ok=True)
    content = json.dumps(data, indent=2, sort_keys=True) + "\n"
    _write_text_atomically(path, content)


def _secure_config_permissions(path: Path) -> None:
    # Only the file: its directory is shared with the event log and its opt-out marker.
    os.chmod(path, PRIVATE_FILE_MODE)


def _read_config(path: Path, persist: bool) -> UsageCollectionConfig:
    data = _read_object(path)
    enabled = data.get("enabled", False)
    if not isinstance(enabled, bool):
        raise ValueError("enabled must be a JSON boolean")
    if not enabled:
        return UsageCollectionConfig()

    endpoint_value = data.get("remote_write_endpoint")
    endpoint = (
        _validate_remote_write_endpoint(endpoint_value)
        if endpoint_value is not None
        else None
    )
    token_value = data.get("remote_write_auth_token")
    token = (
        _validate_remote_write_auth_token(token_value)
        if token_value is not None
        else None
    )
    if token is not None and endpoint is None:
        raise ValueError("remote_write_auth_token needs a remote_write_endpoint")
    machine_id_value = data.get("machine_id")
    machine_id = (
        _validate_machine_id(machine_id_value) if machine_id_value is not None else None
    )
    if persist:
        if machine_id is None:
            machine_id = uuid.uuid4().hex
        if machine_id != machine_id_value:
            data["machine_id"] = machine_id
            _write_config(path, data)

    return UsageCollectionConfig(
        enabled=True,
        remote_write_endpoint=endpoint,
        remote_write_auth_token=token,
        machine_id=machine_id,
    )


def _load_config(persist: bool, secure: bool = False) -> UsageCollectionConfig:
    try:
        path = get_collection_config_path()
        if not path.exists():
            return UsageCollectionConfig()
        # Outside the lock: it is idempotent, and a start that times out on the lock,
        # or that may not prepare at all, must still not leave a token readable by
        # other users.
        if persist or secure:
            _secure_config_permissions(path)
        if not persist:
            return _read_config(path, persist=False)

        # The read is inside the lock with the write: an MCP server per agent session
        # plus the app can prepare together, and two that both read no ID would each
        # generate one, leaving the loser's whole session under an orphan identity.
        with usage_file_lock(
            COLLECTION_LOCK_NAME, timeout_seconds=_COLLECTION_LOCK_TIMEOUT_SECONDS
        ) as locked:
            if locked:
                return _read_config(path, persist=True)
        # Read without writing rather than block startup: an already prepared ID
        # still exports, and an unprepared one waits for the next start.
        logger.warning(
            "Usage collection config is locked by another process; "
            "starting without preparing it"
        )
        return _read_config(path, persist=False)
    except (OSError, RuntimeError, ValueError, json.JSONDecodeError) as error:
        logger.warning("Usage collection is disabled: %s", error)
        return UsageCollectionConfig(error=str(error))


def load_usage_collection_config() -> UsageCollectionConfig:
    """Read the opt-in file without modifying it, failing closed.

    Read-only because the exporter rereads it before every push, so deleting or
    disabling the file stops collection without a restart. An enabled config that has
    not yet been prepared has no ``machine_id``, and nothing is exported until it does.
    """
    return _load_config(persist=False)


def secure_usage_collection_config() -> UsageCollectionConfig:
    """Read the opt-in file after restricting its permissions, without preparing it.

    For a launch under a recording opt-out: it may not write an identity or take the
    preparation lock, but a start is still where ``collection.json`` is kept at
    ``0600``, so a token in a loosely-moded config does not stay readable.
    """
    return _load_config(persist=False, secure=True)


def prepare_usage_collection_config() -> UsageCollectionConfig:
    """Load the opt-in file, restricting its permissions and persisting a machine ID.

    Called once at each app launch and MCP server start, the places a user acts on
    collection.
    """
    return _load_config(persist=True)


def describe_usage_collection(
    collection_config: UsageCollectionConfig, recording_disabled: bool
) -> str:
    """The collection status line a launch reports, shared by the app and MCP server."""
    if collection_config.enabled and recording_disabled:
        return "📈 Aggregate usage collection is DISABLED: event logging is disabled."
    if collection_config.enabled and collection_config.remote_write_endpoint is None:
        return (
            "📈 Aggregate usage collection is DISABLED: no remote_write_endpoint "
            f"is set in {get_collection_config_path()}."
        )
    if collection_config.enabled and not collection_config.can_export:
        # Endpoint set but no ID: another process held the config lock, so this start
        # read it without preparing it.
        return (
            "📈 Aggregate usage collection is DISABLED for this session: "
            "the machine ID has not been created yet. It will be at the next start."
        )
    if collection_config.enabled:
        return (
            "📈 Aggregate usage collection is ENABLED.\n"
            f"   Configuration: {get_collection_config_path()}"
        )
    if collection_config.error:
        return (
            "📈 Aggregate usage collection is DISABLED: "
            "the collection config is invalid."
        )
    return (
        "📈 Aggregate usage collection is DISABLED.\n"
        f"   Opt in through {get_collection_config_path()}."
    )


@contextmanager
def usage_file_lock(name: str, *, timeout_seconds: float) -> Iterator[bool]:
    """Hold an exclusive lock on ``name`` beside the collection config across processes.

    Yields whether the lock is held: ``False`` once ``timeout_seconds`` passes without
    it, so a caller can skip its work rather than wait on a holder that is stopped but
    not dead. ``0`` makes a single attempt. Required, with no wait-forever option, so a
    caller on a startup path cannot hang behind such a holder. Beside the config rather
    than under ``get_event_log_root()`` because tests redirect only the config path.
    """
    try:
        import fcntl
    except ImportError:
        # Windows: no flock, so callers run unserialised. Unlike compaction, which
        # skips there, a push or an ID write is still worth making without the lock.
        logger.debug("Usage lock %s unavailable: file locking is unsupported", name)
        yield True
        return

    try:
        lock_file: Optional[IO[str]] = _open_lock_file(name)
    except OSError as error:
        # A lock file this account cannot open, such as one a ``sudo`` run that kept
        # ``HOME`` left behind. Run unserialised rather than fail as an invalid config.
        logger.debug("Usage lock %s unavailable: %s", name, error)
        lock_file = None
    if lock_file is None:
        yield True
        return

    with lock_file:
        unavailable: Optional[OSError] = None
        try:
            acquired = _acquire_lock(fcntl, lock_file, timeout_seconds)
        except OSError as error:
            # Not contention but a home where flock cannot work, such as ``ENOLCK`` on
            # an NFS mount without a lock manager. Run unserialised, as on Windows,
            # rather than let optional telemetry fail as an invalid config.
            unavailable = error
        if unavailable is not None:
            # Yielded outside the handler, so the flock error does not become the
            # ``__context__`` of anything the caller's ``with`` body raises.
            logger.debug("Usage lock %s unavailable: %s", name, unavailable)
            yield True
            return
        if not acquired:
            yield False
            return
        try:
            yield True
        finally:
            fcntl.flock(lock_file, fcntl.LOCK_UN)


def _open_lock_file(name: str) -> IO[str]:
    directory = get_collection_config_path().parent
    directory.mkdir(mode=PRIVATE_DIRECTORY_MODE, parents=True, exist_ok=True)
    # Created 0600, as the config is: another local user who can open a lock can also
    # hold it, stalling every push and start behind it. Append mode, so opening never
    # truncates a file another process holds.
    descriptor = os.open(
        directory / name, os.O_WRONLY | os.O_APPEND | os.O_CREAT, PRIVATE_FILE_MODE
    )
    return os.fdopen(descriptor, "a", encoding="utf-8")


# What ``flock`` raises under ``LOCK_NB`` when another holder has the lock. Anything
# else means locking itself is unavailable.
_LOCK_HELD_ERRNOS = frozenset({errno.EWOULDBLOCK, errno.EAGAIN})


def _acquire_lock(fcntl: Any, lock_file: IO[str], timeout_seconds: float) -> bool:
    # Polled because flock has no timeout of its own.
    deadline = time.monotonic() + timeout_seconds
    while True:
        try:
            fcntl.flock(lock_file, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return True
        except OSError as error:
            if error.errno not in _LOCK_HELD_ERRNOS:
                raise
            if time.monotonic() >= deadline:
                return False
            time.sleep(_LOCK_POLL_SECONDS)
