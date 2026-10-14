# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Configuration shared by usage metrics and the local Prometheus launcher."""

import argparse
import ipaddress
import json
import logging
import os
import re
import tempfile
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple
from urllib.parse import urlsplit

import yaml
from ttnn_visualizer.event_logging import get_event_log_root

logger = logging.getLogger(__name__)

COLLECTION_CONFIG_FILENAME = "collection.json"
GENERATED_PROMETHEUS_FILENAME = "prometheus.generated.yml"
# Written beside the generated config and mounted read-only at the container path, so
# the generated config references the token without holding it. Mirror both names in
# ``docker/prometheus/docker-compose.yml``; a test pins the pairing.
REMOTE_WRITE_TOKEN_FILENAME = "prometheus.remote-write.token"
CONTAINER_REMOTE_WRITE_TOKEN_PATH = "/etc/prometheus/remote-write.token"
# Mirror the ``PORT`` and ``BASE_PATH`` defaults in ``settings.Config``. The renderer is
# a standalone CLI that runs without building ``Config``, so a change there must be
# repeated here.
DEFAULT_PROMETHEUS_TARGET = "host.docker.internal:8000"
DEFAULT_BASE_PATH = "/"
MACHINE_ID_LABEL = "machine_id"
PRIVATE_FILE_MODE = 0o600
CONTAINER_READABLE_FILE_MODE = 0o644
# One definition for both sides: the exporter names series with it and the ``keep``
# relabel matches on it, so a drift would silently drop every forwarded series.
METRIC_PREFIX = "ttnn_visualizer_"
EXPORTED_METRIC_PATTERN = f"{re.escape(METRIC_PREFIX)}.*"
TARGET_IDENTITY_LABEL_PATTERN = "job|instance"

# Tests replace this so they never inspect or modify the developer's real config.
COLLECTION_CONFIG_PATH: Optional[Path] = None


@dataclass(frozen=True)
class UsageCollectionConfig:
    enabled: bool = False
    remote_write_endpoint: Optional[str] = None
    # Excluded from ``repr`` so logging or printing a config never reveals the secret.
    remote_write_bearer_token: Optional[str] = field(default=None, repr=False)
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
    # Credentials are refused because the URL is also printed in error messages and
    # Prometheus logs, and rendered into the generated config. Authenticate with
    # ``remote_write_bearer_token`` instead. Its rendered file is readable by other
    # local users too, so neither protects a token on a shared machine.
    if parsed.username is not None or parsed.password is not None:
        raise ValueError("remote_write_endpoint must not contain credentials")
    if parsed.query:
        raise ValueError("remote_write_endpoint must not contain query parameters")
    if parsed.fragment:
        raise ValueError("remote_write_endpoint must not contain a fragment")
    if parsed.scheme != "https" and not _is_loopback_host(parsed.hostname):
        raise ValueError("remote_write_endpoint must use HTTPS outside loopback")

    return endpoint


def _validate_remote_write_bearer_token(value: Any) -> str:
    # Messages never include the value, because they are logged and printed.
    if not isinstance(value, str) or not value:
        raise ValueError("remote_write_bearer_token must be a non-empty string")
    # Rejects whitespace too: Prometheus trims the credentials file, so surrounding
    # whitespace would be silently dropped, and inner whitespace is not a valid token.
    if not value.isprintable() or any(character.isspace() for character in value):
        raise ValueError(
            "remote_write_bearer_token must not contain whitespace or control characters"
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
        "remote_write_bearer_token",
        "machine_id",
    }
    if unknown:
        raise ValueError("collection config contains unknown fields")
    return raw


def _write_texts_atomically(
    contents: Sequence[Tuple[Path, str]], mode: int = PRIVATE_FILE_MODE
) -> None:
    """Replace each file atomically, in order, after every one has been staged.

    Staging all of them first means a failed write leaves every file untouched. Only a
    failed rename can leave the earlier files replaced and the later ones not.
    """
    staged: List[Tuple[Path, Path]] = []
    try:
        for path, content in contents:
            descriptor, temporary_name = tempfile.mkstemp(
                dir=path.parent,
                prefix=f".{path.name}.",
                text=True,
            )
            temporary_path = Path(temporary_name)
            staged.append((temporary_path, path))
            with os.fdopen(descriptor, "w", encoding="utf-8") as temporary_file:
                temporary_file.write(content)
            os.chmod(temporary_path, mode)
        for temporary_path, path in staged:
            os.replace(temporary_path, path)
    finally:
        for temporary_path, _ in staged:
            temporary_path.unlink(missing_ok=True)


def _write_text_atomically(
    path: Path, content: str, mode: int = PRIVATE_FILE_MODE
) -> None:
    _write_texts_atomically([(path, content)], mode)


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
        token_value = data.get("remote_write_bearer_token")
        token = (
            _validate_remote_write_bearer_token(token_value)
            if token_value is not None
            else None
        )
        if token is not None and endpoint is None:
            raise ValueError("remote_write_bearer_token needs a remote_write_endpoint")
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
            remote_write_bearer_token=token,
            machine_id=machine_id,
        )
    except (OSError, RuntimeError, ValueError, json.JSONDecodeError) as error:
        logger.warning("Usage collection is disabled: %s", error)
        return UsageCollectionConfig(error=str(error))


def load_usage_collection_config() -> UsageCollectionConfig:
    """Read the opt-in file without modifying it, failing closed.

    Read-only because it runs on every metrics scrape, a GET that any page can trigger
    without reading the response. An enabled config that has not yet been prepared
    has no ``machine_id``, and the metrics projection stays empty until it does.
    """
    return _load_config(persist=False)


def prepare_usage_collection_config() -> UsageCollectionConfig:
    """Load the opt-in file, restricting its permissions and persisting a machine ID.

    Called at launch and by the renderer, the two places a user acts on collection.
    """
    return _load_config(persist=True)


def initialise_usage_collection_config() -> UsageCollectionConfig:
    """Create the local-only opt-in on first explicit renderer invocation."""
    path = get_collection_config_path()
    if not path.exists():
        _write_config(path, {"enabled": True})
    return prepare_usage_collection_config()


def _get_metrics_path(app_target: str, base_path: str) -> str:
    """Validate the scrape target and return the metrics path it is scraped at."""
    if not app_target or any(character.isspace() for character in app_target):
        raise ValueError("app target must be a non-empty host:port without whitespace")
    parsed_target = urlsplit(f"//{app_target}")
    try:
        target_port = parsed_target.port
    except ValueError as error:
        raise ValueError("app target must contain a valid numeric port") from error
    if (
        parsed_target.hostname is None
        or target_port is None
        or parsed_target.username is not None
        or parsed_target.password is not None
        or parsed_target.path
        or parsed_target.query
        or parsed_target.fragment
    ):
        raise ValueError("app target must be a host:port")
    if (
        not base_path.startswith("/")
        or any(character.isspace() for character in base_path)
        or "?" in base_path
        or "#" in base_path
    ):
        raise ValueError("base path must be an absolute URL path")
    # Match Flask's direct ``BASE_PATH + "api"`` blueprint mount exactly, including
    # legacy configurations that omit the conventional trailing slash.
    return f"{base_path}api/metrics"


def build_prometheus_config(
    config: UsageCollectionConfig,
    *,
    app_target: str = DEFAULT_PROMETHEUS_TARGET,
    base_path: str = DEFAULT_BASE_PATH,
) -> Dict[str, Any]:
    metrics_path = _get_metrics_path(app_target, base_path)
    rendered: Dict[str, Any] = {
        "global": {"scrape_interval": "1m"},
        "scrape_configs": [
            {
                "job_name": "ttnn-visualizer",
                "metrics_path": metrics_path,
                "static_configs": [{"targets": [app_target]}],
            }
        ],
    }
    if not config.enabled:
        return rendered
    if not config.machine_id:
        raise ValueError("enabled collection needs a machine ID")

    rendered["global"]["external_labels"] = {MACHINE_ID_LABEL: config.machine_id}
    if config.remote_write_endpoint:
        remote_write: Dict[str, Any] = {"url": config.remote_write_endpoint}
        if config.remote_write_bearer_token:
            remote_write["authorization"] = {
                "type": "Bearer",
                "credentials_file": CONTAINER_REMOTE_WRITE_TOKEN_PATH,
            }
        remote_write["write_relabel_configs"] = [
            {
                "source_labels": ["__name__"],
                "regex": EXPORTED_METRIC_PATTERN,
                "action": "keep",
            },
            {
                "regex": TARGET_IDENTITY_LABEL_PATTERN,
                "action": "labeldrop",
            },
        ]
        rendered["remote_write"] = [remote_write]
    return rendered


def render_prometheus_config(
    output_path: Path,
    *,
    app_target: str = DEFAULT_PROMETHEUS_TARGET,
    base_path: str = DEFAULT_BASE_PATH,
    initialise_missing: bool = False,
) -> Path:
    # Validated before initialising, so an invocation that fails does not opt the
    # user in on its way to failing.
    _get_metrics_path(app_target, base_path)
    config = (
        initialise_usage_collection_config()
        if initialise_missing
        else prepare_usage_collection_config()
    )
    # A rejected config loads as disabled, which renders as a valid file that scrapes
    # and forwards nothing. Written, it would pass `promtool` and leave the user
    # restarting a healthy-looking Prometheus that collects nothing, so it is refused
    # here instead of being rendered.
    if config.error is not None:
        raise ValueError(f"collection config is invalid: {config.error}")
    rendered = build_prometheus_config(
        config,
        app_target=app_target,
        base_path=base_path,
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    # The token is written even when empty, so the Compose bind mount always has a
    # source and a removed token does not linger. It is container-readable, like the
    # config, because the unprivileged Prometheus user does not own it, which leaves it
    # readable by other local users too. Only a failed rename between the two can pair
    # the new token with the old config.
    _write_texts_atomically(
        [
            (
                output_path.parent / REMOTE_WRITE_TOKEN_FILENAME,
                config.remote_write_bearer_token or "",
            ),
            (output_path, yaml.safe_dump(rendered, sort_keys=False)),
        ],
        mode=CONTAINER_READABLE_FILE_MODE,
    )
    return output_path


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Render Prometheus config for opted-in TT-NN Visualizer usage collection"
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(GENERATED_PROMETHEUS_FILENAME),
    )
    parser.add_argument("--app-target", default=DEFAULT_PROMETHEUS_TARGET)
    parser.add_argument("--base-path", default=DEFAULT_BASE_PATH)
    args = parser.parse_args(argv)

    try:
        output = render_prometheus_config(
            args.output,
            app_target=args.app_target,
            base_path=args.base_path,
            initialise_missing=True,
        )
    except ValueError as error:
        parser.error(str(error))
    except OSError as error:
        # Exit 1 rather than `parser.error`'s 2, which means bad usage; the arguments
        # were fine and the filesystem was not.
        parser.exit(1, f"{parser.prog}: error: {error}\n")

    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
