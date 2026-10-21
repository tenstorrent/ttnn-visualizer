# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Opt-in configuration for exporting aggregate usage metrics."""

import ipaddress
import json
import logging
import os
import tempfile
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Optional
from urllib.parse import urlsplit

from ttnn_visualizer.event_logging import get_event_log_root

logger = logging.getLogger(__name__)

COLLECTION_CONFIG_FILENAME = "collection.json"
MACHINE_ID_LABEL = "machine_id"
PRIVATE_FILE_MODE = 0o600
METRIC_PREFIX = "ttnn_visualizer_"

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


def get_collection_config_path() -> Path:
    if COLLECTION_CONFIG_PATH is not None:
        return COLLECTION_CONFIG_PATH

    # Beside the recording opt-out marker rather than in the app data directory: this is
    # a usage-recording control, and that directory belongs to the report database.
    return get_event_log_root() / COLLECTION_CONFIG_FILENAME


def _is_loopback_host(hostname: Optional[str]) -> bool:
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
    if parsed.scheme != "https" and not _is_loopback_host(parsed.hostname):
        raise ValueError("remote_write_endpoint must use HTTPS outside loopback")

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
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    content = json.dumps(data, indent=2, sort_keys=True) + "\n"
    _write_text_atomically(path, content)


def _secure_config_permissions(path: Path) -> None:
    # Only the file: its directory is shared with the event log and its opt-out marker.
    os.chmod(path, PRIVATE_FILE_MODE)


def _load_config(persist: bool) -> UsageCollectionConfig:
    try:
        path = get_collection_config_path()
        if not path.exists():
            return UsageCollectionConfig()

        if persist:
            _secure_config_permissions(path)
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
            _validate_machine_id(machine_id_value)
            if machine_id_value is not None
            else None
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


def prepare_usage_collection_config() -> UsageCollectionConfig:
    """Load the opt-in file, restricting its permissions and persisting a machine ID.

    Called once at launch, the place a user acts on collection.
    """
    return _load_config(persist=True)
