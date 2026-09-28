# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Configuration shared by usage metrics and the local Prometheus launcher."""

import argparse
import ipaddress
import json
import logging
import os
import tempfile
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Optional, Sequence
from urllib.parse import urlsplit

import yaml

logger = logging.getLogger(__name__)

COLLECTION_CONFIG_FILENAME = "collection.json"
GENERATED_PROMETHEUS_FILENAME = "prometheus.generated.yml"
DEFAULT_PROMETHEUS_TARGET = "host.docker.internal:8000"
DEFAULT_BASE_PATH = "/"
MACHINE_ID_LABEL = "machine_id"

# Tests replace this so they never inspect or modify the developer's real config.
COLLECTION_CONFIG_PATH: Optional[Path] = None


@dataclass(frozen=True)
class UsageCollectionConfig:
    enabled: bool = False
    remote_write_endpoint: Optional[str] = None
    machine_id: Optional[str] = None
    error: Optional[str] = None


def get_collection_config_path() -> Path:
    if COLLECTION_CONFIG_PATH is not None:
        return COLLECTION_CONFIG_PATH

    return Path.home() / ".ttnn-visualizer" / "app" / COLLECTION_CONFIG_FILENAME


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
    if parsed.username is not None or parsed.password is not None:
        raise ValueError("remote_write_endpoint must not contain credentials")
    if parsed.query:
        raise ValueError("remote_write_endpoint must not contain query parameters")
    if parsed.fragment:
        raise ValueError("remote_write_endpoint must not contain a fragment")
    if parsed.scheme != "https" and not _is_loopback_host(parsed.hostname):
        raise ValueError("remote_write_endpoint must use HTTPS outside loopback")

    return endpoint


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
    unknown = set(raw) - {"enabled", "remote_write_endpoint", "machine_id"}
    if unknown:
        raise ValueError("collection config contains unknown fields")
    return raw


def _write_text_atomically(path: Path, content: str) -> None:
    descriptor, temporary_name = tempfile.mkstemp(
        dir=path.parent,
        prefix=f".{path.name}.",
        text=True,
    )
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as temporary_file:
            temporary_file.write(content)
        os.chmod(temporary_path, 0o600)
        os.replace(temporary_path, path)
    finally:
        temporary_path.unlink(missing_ok=True)


def _write_config(path: Path, data: Dict[str, Any]) -> None:
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(path.parent, 0o700)
    content = json.dumps(data, indent=2, sort_keys=True) + "\n"
    _write_text_atomically(path, content)


def load_usage_collection_config() -> UsageCollectionConfig:
    """Read the opt-in file, failing closed without breaking application startup."""
    try:
        path = get_collection_config_path()
        if not path.exists():
            return UsageCollectionConfig()

        os.chmod(path.parent, 0o700)
        os.chmod(path, 0o600)
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
        machine_id_value = data.get("machine_id")
        if machine_id_value is None:
            machine_id = uuid.uuid4().hex
            data["machine_id"] = machine_id
            _write_config(path, data)
        else:
            machine_id = _validate_machine_id(machine_id_value)
            if machine_id != machine_id_value:
                data["machine_id"] = machine_id
                _write_config(path, data)

        return UsageCollectionConfig(
            enabled=True,
            remote_write_endpoint=endpoint,
            machine_id=machine_id,
        )
    except (OSError, RuntimeError, ValueError, json.JSONDecodeError) as error:
        logger.warning("Usage collection is disabled: %s", error)
        return UsageCollectionConfig(error=str(error))


def initialise_usage_collection_config() -> UsageCollectionConfig:
    """Create the local-only opt-in on first explicit renderer invocation."""
    path = get_collection_config_path()
    if not path.exists():
        _write_config(path, {"enabled": True})
    return load_usage_collection_config()


def build_prometheus_config(
    config: UsageCollectionConfig,
    *,
    app_target: str = DEFAULT_PROMETHEUS_TARGET,
    base_path: str = DEFAULT_BASE_PATH,
) -> Dict[str, Any]:
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
    metrics_path = f"{base_path}api/metrics"

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
        rendered["remote_write"] = [{"url": config.remote_write_endpoint}]
    return rendered


def render_prometheus_config(
    output_path: Path,
    *,
    app_target: str = DEFAULT_PROMETHEUS_TARGET,
    base_path: str = DEFAULT_BASE_PATH,
    initialise_missing: bool = False,
) -> Path:
    config = (
        initialise_usage_collection_config()
        if initialise_missing
        else load_usage_collection_config()
    )
    rendered = build_prometheus_config(
        config,
        app_target=app_target,
        base_path=base_path,
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    _write_text_atomically(output_path, yaml.safe_dump(rendered, sort_keys=False))
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
    parser.add_argument(
        "--base-path", default=os.getenv("BASE_PATH", DEFAULT_BASE_PATH)
    )
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

    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
