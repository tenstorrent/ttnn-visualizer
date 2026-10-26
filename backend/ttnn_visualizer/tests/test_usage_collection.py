# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import json
import logging
import os
import re
import shutil
import stat
import subprocess
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace

import pytest
from ttnn_visualizer import event_logging, usage_collection, usage_metrics
from ttnn_visualizer.event_logging import (
    _CONSTRAINED_STRING_DETAIL_PATTERNS,
    _DETAIL_FIELD_ENUMS,
    CLIENT_EVENT_DETAIL_FIELDS,
    COUNT_FIELD,
    EVENT_DETAIL_FIELDS,
    EVENT_FIELD,
    MAX_LOG_BYTES,
    RECORDING_DISABLED_ENV_VAR,
    RUN_ID_ENV_VAR,
    RUN_ID_FIELD,
    SCHEMA_VERSION_FIELD,
    SERVER_EVENT_DETAIL_FIELDS,
    TIMESTAMP_FIELD,
    EventLogEvent,
    EventLogView,
    _compact,
    get_disabled_marker_path,
    get_event_log_path,
    parse_logfmt_line,
    record_app_start,
    record_event,
)
from ttnn_visualizer.usage_metrics import (
    OTLP_CONTENT_TYPE,
    UsageMetricsExporter,
    build_otlp_payload,
    collect_usage_metrics,
    push_usage_metrics,
)

_ENDPOINT = "https://metrics.example/api/v1/otlp/v1/metrics"


@pytest.fixture(autouse=True)
def reset_usage_metrics_state(monkeypatch, event_log_directory):
    # Depends on ``event_log_directory`` so the recording opt-out the metrics honour is
    # read from a temporary marker and a cleared variable, not the developer's own.
    monkeypatch.setattr(usage_metrics, "_metrics_state", usage_metrics._MetricsState())


# Skipped without curl only off CI, so a runner that loses it fails rather than
# silently dropping every end-to-end push test.
_requires_curl = pytest.mark.skipif(
    shutil.which("curl") is None and not os.environ.get("CI"),
    reason="curl is not installed",
)


def _write_config(path: Path, **values):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(values), encoding="utf-8")


def _data_points(payload):
    """Every ``(metric name, data point)`` in the payload, across all its blocks.

    Shared so that no check reads only the first resource or scope block and misses a
    metric the exporter puts in another.
    """
    for resource_metrics in payload["resourceMetrics"]:
        for scope_metrics in resource_metrics["scopeMetrics"]:
            for metric in scope_metrics["metrics"]:
                data = metric.get("sum") or metric["gauge"]
                for point in data["dataPoints"]:
                    yield metric["name"], point


def _flatten(payload) -> str:
    """The payload as ``name{attributes} value`` lines, the series a receiver stores."""
    lines = []
    for name, point in _data_points(payload):
        labels = ",".join(
            f'{attribute["key"]}="{attribute["value"]["stringValue"]}"'
            for attribute in point["attributes"]
        )
        lines.append(f'{name}{{{labels}}} {point["asInt"]}')
    return "\n".join(lines) + "\n"


def _exported_series(config=None, *, log_path=None) -> str:
    resolved = config or usage_collection.load_usage_collection_config()
    snapshot = collect_usage_metrics(resolved, log_path=log_path)
    if snapshot is None:
        return ""
    assert resolved.machine_id is not None
    return _flatten(build_otlp_payload(snapshot, resolved.machine_id, time_ns=2))


def _health_value(metrics: str, suffix: str) -> int:
    match = re.search(
        rf"^ttnn_visualizer_usage_collector_{suffix}{{[^}}]*}} (\d+)$",
        metrics,
        re.M,
    )
    assert match, f"no {suffix} health metric"
    return int(match.group(1))


def test_missing_config_disables_collection(usage_collection_config_path):
    assert usage_collection.load_usage_collection_config().enabled is False
    assert not usage_collection_config_path.exists()


def test_default_config_path_is_fixed_beside_the_recording_opt_out(
    monkeypatch, tmp_path
):
    monkeypatch.setattr(usage_collection, "COLLECTION_CONFIG_PATH", None)
    monkeypatch.setattr(event_logging, "EVENT_LOG_DIRECTORY", None)
    monkeypatch.setattr(Path, "home", staticmethod(lambda: tmp_path))

    assert usage_collection.get_collection_config_path() == (
        tmp_path / ".ttnn-visualizer" / "usage" / "collection.json"
    )
    assert (
        usage_collection.get_collection_config_path().parent
        == event_logging.get_disabled_marker_path().parent
    )


def test_config_path_follows_the_event_log_root(monkeypatch, tmp_path):
    monkeypatch.setattr(usage_collection, "COLLECTION_CONFIG_PATH", None)
    monkeypatch.setattr(event_logging, "EVENT_LOG_DIRECTORY", tmp_path / "usage")

    assert usage_collection.get_collection_config_path() == (
        tmp_path / "usage" / "collection.json"
    )


def test_home_resolution_failure_disables_collection(monkeypatch):
    def _raise_runtime_error():
        raise RuntimeError("home unavailable")

    monkeypatch.setattr(usage_collection, "COLLECTION_CONFIG_PATH", None)
    monkeypatch.setattr(event_logging, "EVENT_LOG_DIRECTORY", None)
    monkeypatch.setattr(Path, "home", staticmethod(_raise_runtime_error))

    config = usage_collection.load_usage_collection_config()

    assert config.enabled is False
    assert config.error == "home unavailable"


def test_disabled_config_does_not_create_an_identity(usage_collection_config_path):
    _write_config(
        usage_collection_config_path,
        enabled=False,
        remote_write_endpoint="https://metrics.example/write",
    )

    config = usage_collection.load_usage_collection_config()

    assert config.enabled is False
    assert config.machine_id is None
    assert "machine_id" not in json.loads(
        usage_collection_config_path.read_text(encoding="utf-8")
    )


def test_enabling_collection_creates_a_stable_random_identity(
    usage_collection_config_path,
):
    _write_config(
        usage_collection_config_path,
        enabled=True,
        remote_write_endpoint="https://metrics.example/write",
    )

    first = usage_collection.prepare_usage_collection_config()
    second = usage_collection.prepare_usage_collection_config()

    assert first.enabled is True
    assert first.machine_id == second.machine_id
    assert uuid.UUID(first.machine_id or "").hex == first.machine_id
    assert stat.S_IMODE(usage_collection_config_path.stat().st_mode) == 0o600


def test_preparing_keeps_the_auth_token(usage_collection_config_path):
    _write_config(
        usage_collection_config_path,
        enabled=True,
        remote_write_endpoint="https://metrics.example/write",
        remote_write_auth_token="secret-token",
    )

    config = usage_collection.prepare_usage_collection_config()

    persisted = json.loads(usage_collection_config_path.read_text(encoding="utf-8"))
    assert persisted["remote_write_auth_token"] == "secret-token"
    assert persisted["machine_id"] == config.machine_id
    assert stat.S_IMODE(usage_collection_config_path.stat().st_mode) == 0o600


def test_loading_an_unprepared_config_does_not_modify_it(
    usage_collection_config_path,
):
    _write_config(usage_collection_config_path, enabled=True)
    usage_collection_config_path.chmod(0o644)
    original = usage_collection_config_path.read_text(encoding="utf-8")

    config = usage_collection.load_usage_collection_config()

    assert config.enabled is True
    assert config.machine_id is None
    assert usage_collection_config_path.read_text(encoding="utf-8") == original
    assert stat.S_IMODE(usage_collection_config_path.stat().st_mode) == 0o644


def test_unprepared_config_exports_no_metrics(usage_collection_config_path, tmp_path):
    _write_config(usage_collection_config_path, enabled=True)
    log_path = tmp_path / "events.log"
    log_path.write_text(
        "ts=2026-09-28T10:00:00Z event=view_opened schema_version=1 "
        "view=operations\n",
        encoding="utf-8",
    )

    assert _exported_series(log_path=log_path) == ""


def test_preparing_normalises_a_hyphenated_machine_id(usage_collection_config_path):
    machine_id = uuid.uuid4()
    _write_config(
        usage_collection_config_path, enabled=True, machine_id=str(machine_id)
    )

    config = usage_collection.prepare_usage_collection_config()

    assert config.machine_id == machine_id.hex
    assert json.loads(usage_collection_config_path.read_text(encoding="utf-8")) == {
        "enabled": True,
        "machine_id": machine_id.hex,
    }


@pytest.mark.parametrize(
    "values",
    [
        {"enabled": "true", "remote_write_endpoint": "https://metrics.example/write"},
        {"enabled": True, "remote_write_endpoint": "ftp://metrics.example/write"},
        {"enabled": True, "remote_write_endpoint": "http://metrics.example/write"},
        {
            "enabled": True,
            "remote_write_endpoint": "https://metrics.example:invalid/write",
        },
        {
            "enabled": True,
            "remote_write_endpoint": "https://metrics.example:70000/write",
        },
        {
            "enabled": True,
            "remote_write_endpoint": "https://user:secret@metrics.example/write",
        },
        {
            "enabled": True,
            "remote_write_endpoint": "https://metrics.example/write?token=secret",
        },
        {
            "enabled": True,
            "remote_write_endpoint": "https://metrics.example/write",
            "extra": "value",
        },
        {
            "enabled": True,
            "remote_write_endpoint": "https://metrics.example/write#fragment",
        },
        {
            "enabled": True,
            "remote_write_endpoint": "https://metrics.example/write",
            "machine_id": "not-a-uuid",
        },
        {"enabled": True, "remote_write_auth_token": "secret"},
        {
            "enabled": True,
            "remote_write_endpoint": "https://metrics.example/api/v1/write",
        },
        {
            "enabled": True,
            "remote_write_endpoint": "https://metrics.example/api/v1/write/",
        },
        {
            "enabled": True,
            "remote_write_endpoint": "https://metrics.example/prometheus/api/v1/push",
        },
        {
            "enabled": True,
            "remote_write_endpoint": 'https://metrics.example/w\nurl = "http://x"',
        },
        {
            "enabled": True,
            "remote_write_endpoint": "https://metrics.example/w\tx",
        },
        {
            "enabled": True,
            "remote_write_endpoint": "https://metrics.example/write",
            "remote_write_auth_token": "",
        },
        {
            "enabled": True,
            "remote_write_endpoint": "https://metrics.example/write",
            "remote_write_auth_token": 123,
        },
        {
            "enabled": True,
            "remote_write_endpoint": "https://metrics.example/write",
            "remote_write_auth_token": "secret\n",
        },
        {
            "enabled": True,
            "remote_write_endpoint": "https://metrics.example/write",
            "remote_write_auth_token": "two words",
        },
    ],
)
def test_invalid_config_fails_closed(usage_collection_config_path, values):
    _write_config(usage_collection_config_path, **values)

    config = usage_collection.load_usage_collection_config()

    assert config.enabled is False
    assert config.error


def test_a_remote_write_endpoint_is_named_in_the_error(usage_collection_config_path):
    # A v0.105 to v0.107 config without a token: valid then, and still loading as
    # enabled would leave every push failing.
    _write_config(
        usage_collection_config_path,
        enabled=True,
        remote_write_endpoint="https://metrics.example/api/v1/write",
    )

    config = usage_collection.load_usage_collection_config()

    assert config.enabled is False
    assert config.error is not None
    assert "OTLP" in config.error


def test_the_renamed_token_field_is_named_in_the_error(usage_collection_config_path):
    _write_config(
        usage_collection_config_path,
        enabled=True,
        remote_write_endpoint=_ENDPOINT,
        remote_write_bearer_token="secret-token",
    )

    config = usage_collection.load_usage_collection_config()

    assert config.enabled is False
    assert config.error is not None
    assert "remote_write_auth_token" in config.error
    assert "secret-token" not in config.error


def test_invalid_auth_token_is_not_reported(usage_collection_config_path):
    _write_config(
        usage_collection_config_path,
        enabled=True,
        remote_write_endpoint="https://metrics.example/write",
        remote_write_auth_token="top secret",
    )

    config = usage_collection.load_usage_collection_config()

    assert config.error
    assert "secret" not in config.error


def test_auth_token_is_loaded_but_not_shown(usage_collection_config_path):
    _write_config(
        usage_collection_config_path,
        enabled=True,
        remote_write_endpoint="https://metrics.example/write",
        remote_write_auth_token="secret-token",
    )

    config = usage_collection.load_usage_collection_config()

    assert config.remote_write_auth_token == "secret-token"
    assert "secret-token" not in repr(config)


def test_malformed_json_fails_closed(usage_collection_config_path):
    usage_collection_config_path.parent.mkdir(parents=True)
    usage_collection_config_path.write_text("{not json", encoding="utf-8")

    config = usage_collection.load_usage_collection_config()

    assert config.enabled is False
    assert config.error


def test_non_object_json_fails_closed(usage_collection_config_path):
    usage_collection_config_path.parent.mkdir(parents=True)
    usage_collection_config_path.write_text("[]", encoding="utf-8")

    config = usage_collection.load_usage_collection_config()

    assert config.enabled is False
    assert config.error


@pytest.mark.parametrize("contents", ['{"enabled": false}', "{not json"])
def test_preparing_restricts_disabled_and_malformed_files(
    usage_collection_config_path, contents
):
    usage_collection_config_path.parent.mkdir(parents=True)
    usage_collection_config_path.write_text(contents, encoding="utf-8")
    usage_collection_config_path.chmod(0o644)
    usage_collection_config_path.parent.chmod(0o755)

    usage_collection.prepare_usage_collection_config()

    assert stat.S_IMODE(usage_collection_config_path.stat().st_mode) == 0o600
    # The directory is shared with the event log, so its mode is not ours to change.
    assert stat.S_IMODE(usage_collection_config_path.parent.stat().st_mode) == 0o755


def test_loopback_http_endpoint_is_allowed(usage_collection_config_path):
    _write_config(
        usage_collection_config_path,
        enabled=True,
        remote_write_endpoint="http://127.0.0.1:9090/api/v1/otlp/v1/metrics",
    )

    assert usage_collection.load_usage_collection_config().enabled is True


def test_metrics_preserve_compacted_counts_and_drop_private_fields(tmp_path):
    machine_id = uuid.uuid4().hex
    log_path = tmp_path / "events.log"
    log_path.write_text(
        "ts=2026-09-28T10:00:00Z event=view_opened schema_version=1 "
        "view=operations count=4\n"
        "ts=2026-09-28T10:01:00Z event=view_opened schema_version=1 "
        "run_id=deadbeef view=operations\n",
        encoding="utf-8",
    )

    metrics = _exported_series(
        usage_collection.UsageCollectionConfig(
            enabled=True,
            remote_write_endpoint="https://metrics.example/write",
            machine_id=machine_id,
        ),
        log_path=log_path,
    )

    assert (
        f'ttnn_visualizer_view_opened_total{{machine_id="{machine_id}",'
        'view="operations"} 5'
    ) in metrics
    assert "run_id" not in metrics
    assert "ts=" not in metrics


def test_metrics_skip_malformed_unknown_and_free_form_lines(tmp_path):
    machine_id = uuid.uuid4().hex
    log_path = tmp_path / "events.log"
    log_path.write_text(
        "not-logfmt\n"
        "ts=2026-09-28T10:00:00Z event=unknown schema_version=1\n"
        "event=view_opened schema_version=1 view=operations\n"
        "ts=2026-09-28T10:00:00Z event=view_opened schema_version=1 "
        "view=operations leaked=secret\n",
        encoding="utf-8",
    )

    metrics = _exported_series(
        usage_collection.UsageCollectionConfig(
            enabled=True,
            remote_write_endpoint="https://metrics.example/write",
            machine_id=machine_id,
        ),
        log_path=log_path,
    )

    assert "leaked" not in metrics
    assert "secret" not in metrics
    assert _health_value(metrics, "parse_errors_total") == 4


@pytest.mark.parametrize(
    "line, private_value",
    [
        (
            "ts=2026-09-28T10:00:00Z event=view_opened schema_version=1 "
            "view=private_view\n",
            "private_view",
        ),
        (
            "ts=2026-09-28T10:00:00Z event=report_loaded schema_version=1 "
            "kind=private_kind source=upload\n",
            "private_kind",
        ),
        (
            "ts=2026-09-28T10:00:00Z event=app_start schema_version=1 "
            "version=0.104.0 deployment_mode=private_mode launch_mode=source "
            "os=darwin python_version=3.10\n",
            "private_mode",
        ),
        # `version` and `python_version` have no enum, so only their shapes keep an
        # identifier out of the export. Each value below fits `_SAFE_VALUE_PATTERN`
        # except the paths, so these fail if the shapes fall back to it.
        *(
            (
                "ts=2026-09-28T10:00:00Z event=app_start schema_version=1 "
                f"version={version} deployment_mode=container launch_mode=source "
                f"os=darwin python_version={python_version}\n",
                private_value,
            )
            for version, python_version, private_value in (
                ("0.104.0", "/Users/private_user/.venv", "private_user"),
                ("0.104.0", "private_user", "private_user"),
                ("0.104.0", "3.10.private_user", "private_user"),
                ("/Users/private_user/.venv", "3.10", "private_user"),
                ("private-host.corp.example.com", "3.10", "private-host"),
                ("0.104.0+private-host", "3.10", "private-host"),
                ("0.104.0.private_user", "3.10", "private_user"),
                ("0.104.0.123456789", "3.10", "123456789"),
            )
        ),
    ],
)
def test_metrics_refuse_values_outside_the_event_schema(tmp_path, line, private_value):
    log_path = tmp_path / "events.log"
    log_path.write_text(line, encoding="utf-8")

    metrics = _exported_series(
        usage_collection.UsageCollectionConfig(
            enabled=True,
            remote_write_endpoint="https://metrics.example/write",
            machine_id=uuid.uuid4().hex,
        ),
        log_path=log_path,
    )

    assert private_value not in metrics
    assert _health_value(metrics, "parse_errors_total") == 1


@pytest.mark.parametrize(
    "line",
    [
        "ts=2026-09-28T10:00:00Z event=view_opened schema_version=2 view=operations",
        "ts=2026-09-28T10:00:00Z event=report_loaded schema_version=1 kind=profiler",
        "ts= event=view_opened schema_version=1 view=operations",
        "ts=2026-09-28T10:00:00Z event=view_opened schema_version=1 "
        "view=operations count=0",
        "ts=2026-09-28T10:00:00Z event=view_opened schema_version=1 "
        "view=operations count=-1",
        "ts=2026-09-28T10:00:00Z event=view_opened schema_version=1 "
        "view=operations count=many",
    ],
)
def test_metrics_reject_lines_outside_the_stored_schema(tmp_path, line):
    log_path = tmp_path / "events.log"
    log_path.write_text(f"{line}\n", encoding="utf-8")

    metrics = _exported_series(
        usage_collection.UsageCollectionConfig(
            enabled=True,
            machine_id=uuid.uuid4().hex,
        ),
        log_path=log_path,
    )

    assert not re.search(r"^ttnn_visualizer_(?!usage_collector_)", metrics, re.M)
    assert _health_value(metrics, "parse_errors_total") == 1


def _record_every_event() -> None:
    record_app_start(SimpleNamespace(TT_METAL_HOME=None), server_mode=False)
    remaining_event_fields: dict[EventLogEvent, tuple[str, ...]] = {
        **CLIENT_EVENT_DETAIL_FIELDS,
        **{
            event: fields
            for event, fields in SERVER_EVENT_DETAIL_FIELDS.items()
            if event is not EventLogEvent.APP_START
        },
    }
    for event, fields in remaining_event_fields.items():
        details = {
            field: next(iter(_DETAIL_FIELD_ENUMS[field])).value for field in fields
        }
        record_event(event, server_mode=False, **details)


def test_every_recorded_event_is_projected(event_log_directory):
    _record_every_event()

    metrics = _exported_series(
        usage_collection.UsageCollectionConfig(
            enabled=True,
            machine_id=uuid.uuid4().hex,
        ),
        log_path=get_event_log_path(),
    )

    for event in EventLogEvent:
        assert f"ttnn_visualizer_{event.value}_total{{" in metrics
    assert _health_value(metrics, "parse_errors_total") == 0


def test_compaction_preserves_projected_totals(event_log_directory):
    config = usage_collection.UsageCollectionConfig(
        enabled=True,
        machine_id=uuid.uuid4().hex,
    )
    for _ in range(6):
        record_event(
            EventLogEvent.VIEW_OPENED,
            server_mode=False,
            view=EventLogView.OPERATIONS.value,
        )
    log_path = get_event_log_path()
    before = _exported_series(config, log_path=log_path)
    lines_before = len(log_path.read_text(encoding="utf-8").splitlines())

    _compact(log_path)
    after = _exported_series(config, log_path=log_path)

    assert len(log_path.read_text(encoding="utf-8").splitlines()) < lines_before
    assert after == before
    assert 'view="operations"} 6' in after
    assert _health_value(after, "parse_errors_total") == 0


def _enable_recording_opt_out(opt_out, monkeypatch):
    if opt_out == "environment":
        monkeypatch.setenv(RECORDING_DISABLED_ENV_VAR, "true")
    else:
        marker = get_disabled_marker_path()
        marker.parent.mkdir(parents=True, exist_ok=True)
        marker.touch()


def test_missing_log_is_distinct_from_a_read_failure(tmp_path):
    metrics = _exported_series(
        usage_collection.UsageCollectionConfig(
            enabled=True,
            remote_write_endpoint="https://metrics.example/write",
            machine_id=uuid.uuid4().hex,
        ),
        log_path=tmp_path / "absent.log",
    )

    assert _health_value(metrics, "files_found") == 0
    assert _health_value(metrics, "scan_errors") == 0


def test_read_failure_sets_the_scan_error(tmp_path, monkeypatch):
    log_path = tmp_path / "events.log"
    log_path.write_text("", encoding="utf-8")

    def _raise_permission_error(*_args, **_kwargs):
        raise PermissionError("refused")

    monkeypatch.setattr(Path, "open", _raise_permission_error)
    metrics = _exported_series(
        usage_collection.UsageCollectionConfig(
            enabled=True,
            remote_write_endpoint="https://metrics.example/write",
            machine_id=uuid.uuid4().hex,
        ),
        log_path=log_path,
    )

    assert _health_value(metrics, "files_found") == 1
    assert _health_value(metrics, "scan_errors") == 1


def test_read_failure_preserves_cached_counters(tmp_path, monkeypatch):
    config = usage_collection.UsageCollectionConfig(
        enabled=True,
        remote_write_endpoint="https://metrics.example/write",
        machine_id=uuid.uuid4().hex,
    )
    log_path = tmp_path / "events.log"
    log_path.write_text(
        "ts=2026-09-28T10:00:00Z event=view_opened schema_version=1 "
        "view=operations\n",
        encoding="utf-8",
    )
    first_metrics = _exported_series(config, log_path=log_path)

    def _raise_permission_error(*_args, **_kwargs):
        raise PermissionError("refused")

    monkeypatch.setattr(Path, "open", _raise_permission_error)
    failed_metrics = _exported_series(config, log_path=log_path)

    assert 'view="operations"} 1' in first_metrics
    assert 'view="operations"} 1' in failed_metrics
    assert _health_value(failed_metrics, "scan_errors") == 1


def test_metrics_increment_from_appended_bytes_without_double_counting(tmp_path):
    machine_id = uuid.uuid4().hex
    config = usage_collection.UsageCollectionConfig(
        enabled=True,
        remote_write_endpoint="https://metrics.example/write",
        machine_id=machine_id,
    )
    log_path = tmp_path / "events.log"
    first_line = (
        "ts=2026-09-28T10:00:00Z event=view_opened schema_version=1 "
        "view=operations\n"
    )
    log_path.write_text(first_line, encoding="utf-8")

    first_metrics = _exported_series(config, log_path=log_path)
    unchanged_metrics = _exported_series(config, log_path=log_path)
    with log_path.open("a", encoding="utf-8") as log_file:
        log_file.write(first_line)
    appended_metrics = _exported_series(config, log_path=log_path)

    assert first_metrics == unchanged_metrics
    assert 'view="operations"} 1' in first_metrics
    assert 'view="operations"} 2' in appended_metrics


def test_metrics_hold_a_partial_line_until_it_is_complete(tmp_path):
    machine_id = uuid.uuid4().hex
    config = usage_collection.UsageCollectionConfig(
        enabled=True,
        remote_write_endpoint="https://metrics.example/write",
        machine_id=machine_id,
    )
    log_path = tmp_path / "events.log"
    log_path.write_text(
        "ts=2026-09-28T10:00:00Z event=view_opened schema_version=1 " "view=operations",
        encoding="utf-8",
    )

    partial_metrics = _exported_series(config, log_path=log_path)
    with log_path.open("a", encoding="utf-8") as log_file:
        log_file.write("\n")
    complete_metrics = _exported_series(config, log_path=log_path)

    assert "ttnn_visualizer_view_opened_total" not in partial_metrics
    assert 'view="operations"} 1' in complete_metrics


def test_metrics_bound_an_overlong_unterminated_line(tmp_path):
    config = usage_collection.UsageCollectionConfig(
        enabled=True,
        machine_id=uuid.uuid4().hex,
    )
    log_path = tmp_path / "events.log"
    log_path.write_bytes(b"x" * MAX_LOG_BYTES)

    malformed_metrics = _exported_series(config, log_path=log_path)
    unchanged_metrics = _exported_series(config, log_path=log_path)

    assert _health_value(malformed_metrics, "parse_errors_total") == 1
    assert unchanged_metrics == malformed_metrics
    assert len(usage_metrics._metrics_state.pending) <= (
        usage_metrics.MAX_EVENT_LOG_LINE_BYTES
    )

    with log_path.open("ab") as log_file:
        log_file.write(
            b"\nts=2026-09-28T10:00:00Z event=view_opened schema_version=1 "
            b"view=operations\n"
        )
    recovered_metrics = _exported_series(config, log_path=log_path)

    assert 'view="operations"} 1' in recovered_metrics
    assert _health_value(recovered_metrics, "parse_errors_total") == 1


def test_metrics_reset_when_the_log_path_changes(tmp_path):
    config = usage_collection.UsageCollectionConfig(
        enabled=True,
        machine_id=uuid.uuid4().hex,
    )
    operations_path = tmp_path / "operations.log"
    operations_path.write_text(
        "ts=2026-09-28T10:00:00Z event=view_opened schema_version=1 "
        "view=operations\n",
        encoding="utf-8",
    )
    tensors_path = tmp_path / "tensors.log"
    tensors_path.write_text(
        "ts=2026-09-28T10:00:00Z event=view_opened schema_version=1 " "view=tensors\n",
        encoding="utf-8",
    )

    _exported_series(config, log_path=operations_path)
    tensors_metrics = _exported_series(config, log_path=tensors_path)

    assert 'view="operations"' not in tensors_metrics
    assert 'view="tensors"} 1' in tensors_metrics


def test_metrics_reset_when_the_machine_identity_changes(tmp_path):
    log_path = tmp_path / "events.log"
    log_path.write_text(
        "ts=2026-09-28T10:00:00Z event=view_opened schema_version=1 "
        "view=operations\n",
        encoding="utf-8",
    )
    first_machine_id = uuid.uuid4().hex
    second_machine_id = uuid.uuid4().hex

    _exported_series(
        usage_collection.UsageCollectionConfig(
            enabled=True,
            machine_id=first_machine_id,
        ),
        log_path=log_path,
    )
    second_metrics = _exported_series(
        usage_collection.UsageCollectionConfig(
            enabled=True,
            machine_id=second_machine_id,
        ),
        log_path=log_path,
    )

    assert first_machine_id not in second_metrics
    assert f'machine_id="{second_machine_id}"' in second_metrics
    assert 'view="operations"} 1' in second_metrics


def test_metrics_restart_from_a_replaced_log(tmp_path):
    machine_id = uuid.uuid4().hex
    config = usage_collection.UsageCollectionConfig(
        enabled=True,
        remote_write_endpoint="https://metrics.example/write",
        machine_id=machine_id,
    )
    log_path = tmp_path / "events.log"
    log_path.write_text(
        "ts=2026-09-28T10:00:00Z event=view_opened schema_version=1 "
        "view=operations\n",
        encoding="utf-8",
    )
    _exported_series(config, log_path=log_path)

    replacement_path = tmp_path / "replacement.log"
    replacement_path.write_text(
        "ts=2026-09-28T10:01:00Z event=view_opened schema_version=1 " "view=tensors\n",
        encoding="utf-8",
    )
    replacement_path.replace(log_path)
    metrics = _exported_series(config, log_path=log_path)

    assert 'view="operations"' not in metrics
    assert 'view="tensors"} 1' in metrics


def test_metrics_restart_after_an_in_place_truncation(tmp_path):
    machine_id = uuid.uuid4().hex
    config = usage_collection.UsageCollectionConfig(
        enabled=True,
        remote_write_endpoint="https://metrics.example/write",
        machine_id=machine_id,
    )
    log_path = tmp_path / "events.log"
    line = (
        "ts=2026-09-28T10:00:00Z event=view_opened schema_version=1 "
        "view=operations\n"
    )
    log_path.write_text(line * 2, encoding="utf-8")
    first_metrics = _exported_series(config, log_path=log_path)

    log_path.write_text(line, encoding="utf-8")
    truncated_metrics = _exported_series(config, log_path=log_path)

    assert 'view="operations"} 2' in first_metrics
    assert 'view="operations"} 1' in truncated_metrics


def test_metrics_process_more_than_one_read_chunk_exactly_once(tmp_path):
    machine_id = uuid.uuid4().hex
    config = usage_collection.UsageCollectionConfig(
        enabled=True,
        remote_write_endpoint="https://metrics.example/write",
        machine_id=machine_id,
    )
    log_path = tmp_path / "events.log"
    line = (
        "ts=2026-09-28T10:00:00Z event=view_opened schema_version=1 "
        "view=operations\n"
    )
    line_count = 2_000
    log_path.write_text(line * line_count, encoding="utf-8")

    metrics = _exported_series(config, log_path=log_path)
    unchanged_metrics = _exported_series(config, log_path=log_path)

    assert f'view="operations"}} {line_count}' in metrics
    assert unchanged_metrics == metrics


def test_payload_matches_the_privacy_reviewed_golden_output(tmp_path):
    log_path = tmp_path / "events.log"
    log_path.write_text(
        "ts=2026-09-28T10:00:00Z event=report_loaded schema_version=1 "
        "run_id=aaaaaaaa kind=profiler source=upload count=2\n"
        "ts=2026-09-28T10:01:00Z event=view_opened schema_version=1 "
        "run_id=bbbbbbbb view=operations\n",
        encoding="utf-8",
    )
    machine_id = "00000000000000000000000000000001"
    snapshot = collect_usage_metrics(
        usage_collection.UsageCollectionConfig(enabled=True, machine_id=machine_id),
        log_path=log_path,
    )
    assert snapshot is not None

    def point(value, **labels):
        return {
            "attributes": [
                {"key": key, "value": {"stringValue": label}}
                for key, label in labels.items()
            ],
            "timeUnixNano": "2000",
            "asInt": str(value),
        }

    def counter(name, description, *points):
        return {
            "name": name,
            "description": description,
            "sum": {
                "aggregationTemporality": 2,
                "isMonotonic": True,
                "dataPoints": list(points),
            },
        }

    def gauge(name, description, value):
        return {
            "name": name,
            "description": description,
            "gauge": {"dataPoints": [point(value, machine_id=machine_id)]},
        }

    assert build_otlp_payload(snapshot, machine_id, time_ns=2000) == {
        "resourceMetrics": [
            {
                "resource": {
                    "attributes": [
                        {
                            "key": "service.name",
                            "value": {"stringValue": "ttnn-visualizer"},
                        }
                    ]
                },
                "scopeMetrics": [
                    {
                        "scope": {"name": "ttnn_visualizer.usage_metrics"},
                        "metrics": [
                            counter(
                                "ttnn_visualizer_report_loaded_total",
                                "Cumulative report_loaded events in the local usage log.",
                                point(
                                    2,
                                    kind="profiler",
                                    machine_id=machine_id,
                                    source="upload",
                                ),
                            ),
                            counter(
                                "ttnn_visualizer_view_opened_total",
                                "Cumulative view_opened events in the local usage log.",
                                point(1, machine_id=machine_id, view="operations"),
                            ),
                            gauge(
                                "ttnn_visualizer_usage_collector_files_found",
                                "Whether the local usage event log exists.",
                                1,
                            ),
                            counter(
                                "ttnn_visualizer_usage_collector_parse_errors_total",
                                "Cumulative malformed or unsupported lines in the "
                                "local usage event log.",
                                point(0, machine_id=machine_id),
                            ),
                            gauge(
                                "ttnn_visualizer_usage_collector_scan_errors",
                                "Whether reading the local usage event log failed.",
                                0,
                            ),
                        ],
                    }
                ],
            }
        ]
    }


def _attribute_values(point) -> dict[str, str]:
    return {
        attribute["key"]: attribute["value"]["stringValue"]
        for attribute in point["attributes"]
    }


# The privacy-reviewed export shape, written out rather than read from
# ``event_logging`` so that changing what is exported has to edit this test, and so
# gets the privacy re-review that docs/src/event-logging.md asks for. A string, rather
# than a set, is the full-match pattern for a server-derived constrained string.
_REVIEWED_REPORT_KINDS = frozenset(
    {"profiler", "performance", "npe", "mlir", "cluster_descriptor"}
)
_REVIEWED_VIEWS = frozenset(
    {
        "reports",
        "operations",
        "operation_details",
        "tensors",
        "buffers",
        "graph",
        "performance",
        "npe",
        "mlir",
        "topology",
        "mcp",
    }
)
_PRIVACY_REVIEWED_ATTRIBUTES: dict[str, dict[str, frozenset[str] | str]] = {
    "ttnn_visualizer_app_start_total": {
        "version": (
            r"unknown|\d{1,4}(?:\.\d{1,4}){1,3}"
            r"(?:(?:a|b|rc)\d{1,4})?(?:\.post\d{1,4})?(?:\.dev\d{1,4})?"
        ),
        "deployment_mode": frozenset({"tt_metal_home", "container", "local_upload"}),
        "launch_mode": frozenset({"source", "wheel", "hosted"}),
        "os": frozenset({"darwin", "linux", "windows", "other"}),
        "python_version": r"\d{1,2}\.\d{1,3}",
    },
    "ttnn_visualizer_mcp_tool_called_total": {
        "tool": frozenset(
            {
                "load_report",
                "top_ops",
                "op_breakdown",
                "program_cache",
                "zone_timings",
                "diff_reports",
                "find_operations",
                "operation_detail",
                "memory_profile",
                "tensor_flow",
                "operation_provenance",
                "errors",
                "dram_fallbacks",
                "l1_peak",
            }
        ),
        "outcome": frozenset({"ok", "refused", "error"}),
    },
    "ttnn_visualizer_report_loaded_total": {
        "kind": _REVIEWED_REPORT_KINDS,
        "source": frozenset({"upload", "remote_sync", "local_tt_metal", "demo"}),
    },
    "ttnn_visualizer_report_load_failed_total": {
        "kind": _REVIEWED_REPORT_KINDS,
        "reason_class": frozenset(
            {
                "unsupported_version",
                "missing_file",
                "parse_error",
                "too_large",
                "permission",
                "other",
            }
        ),
    },
    "ttnn_visualizer_view_opened_total": {"view": _REVIEWED_VIEWS},
    "ttnn_visualizer_view_engaged_total": {"view": _REVIEWED_VIEWS},
}


def test_the_event_schema_matches_the_privacy_reviewed_shape():
    # Covers vocabulary members no recorded event happens to use, which the payload
    # check below cannot see.
    exported = {
        f"ttnn_visualizer_{event.value}_total": {
            field_name: (
                frozenset(member.value for member in _DETAIL_FIELD_ENUMS[field_name])
                if field_name in _DETAIL_FIELD_ENUMS
                else _CONSTRAINED_STRING_DETAIL_PATTERNS[field_name].pattern
            )
            for field_name in fields
        }
        for event, fields in EVENT_DETAIL_FIELDS.items()
    }
    assert exported == _PRIVACY_REVIEWED_ATTRIBUTES


def test_exported_attributes_are_only_schema_fields_and_machine_id(
    event_log_directory,
):
    _record_every_event()
    log_path = get_event_log_path()
    recorded_app_start = next(
        fields
        for fields in map(
            parse_logfmt_line, log_path.read_text(encoding="utf-8").splitlines()
        )
        if fields and fields[EVENT_FIELD] == EventLogEvent.APP_START.value
    )
    machine_id = uuid.uuid4().hex
    snapshot = collect_usage_metrics(
        usage_collection.UsageCollectionConfig(enabled=True, machine_id=machine_id),
        log_path=log_path,
    )
    assert snapshot is not None
    payload = build_otlp_payload(snapshot, machine_id, time_ns=2)

    seen_metrics = set()
    for name, point in _data_points(payload):
        reviewed_fields = _PRIVACY_REVIEWED_ATTRIBUTES.get(name)
        values = _attribute_values(point)
        assert values.pop(usage_collection.MACHINE_ID_LABEL) == machine_id
        for private_field in (
            TIMESTAMP_FIELD,
            RUN_ID_FIELD,
            SCHEMA_VERSION_FIELD,
            COUNT_FIELD,
        ):
            assert private_field not in values
        if reviewed_fields is None:
            # Collector health carries the identity and nothing else.
            assert name.startswith("ttnn_visualizer_usage_collector_")
            assert values == {}
            continue

        seen_metrics.add(name)
        assert set(values) == set(reviewed_fields)
        for field_name, value in values.items():
            vocabulary = reviewed_fields[field_name]
            if isinstance(vocabulary, str):
                # Checked against the reviewed pattern and the line as written rather
                # than through the reader's own validator, so the test cannot agree
                # by construction.
                assert re.fullmatch(vocabulary, value)
                assert value == recorded_app_start[field_name]
            else:
                assert value in vocabulary

    assert seen_metrics == set(_PRIVACY_REVIEWED_ATTRIBUTES)


def test_field_order_does_not_split_a_series(tmp_path):
    log_path = tmp_path / "events.log"
    log_path.write_text(
        "ts=2026-09-28T10:00:00Z event=report_loaded schema_version=1 "
        "kind=profiler source=upload\n"
        "source=upload kind=profiler schema_version=1 event=report_loaded "
        "ts=2026-09-28T10:01:00Z\n"
        "kind=profiler ts=2026-09-28T10:02:00Z source=upload event=report_loaded "
        "schema_version=1\n",
        encoding="utf-8",
    )
    machine_id = uuid.uuid4().hex
    snapshot = collect_usage_metrics(
        usage_collection.UsageCollectionConfig(enabled=True, machine_id=machine_id),
        log_path=log_path,
    )
    assert snapshot is not None
    payload = build_otlp_payload(snapshot, machine_id, time_ns=2)

    # Compared as a dict, so this pins only that the line's field order is irrelevant;
    # the order attributes are exported in is pinned by the golden-output test.
    (point,) = [
        point
        for name, point in _data_points(payload)
        if name == "ttnn_visualizer_report_loaded_total"
    ]
    assert _attribute_values(point) == {
        "kind": "profiler",
        "source": "upload",
        usage_collection.MACHINE_ID_LABEL: machine_id,
    }
    assert point["asInt"] == "3"
    assert _health_value(_flatten(payload), "parse_errors_total") == 0


@_requires_curl
def test_exporter_does_not_modify_the_event_log(
    event_log_directory, usage_collection_config_path, otlp_server, monkeypatch
):
    # The real log path, so `compact_if_needed` would reach this file too.
    log_path = get_event_log_path()
    log_directory = log_path.parent
    log_directory.mkdir(parents=True, exist_ok=True)
    # Repeated lines, and a cap the file is over, give both `_compact` and the public
    # `compact_if_needed` something to shrink, so a trim from either would rewrite the
    # file rather than return early; the mode matches what the writer creates.
    monkeypatch.setattr(event_logging, "MAX_LOG_BYTES", 1)
    log_path.write_text(
        "ts=2026-09-28T10:00:00Z event=view_opened schema_version=1 "
        "view=operations\n" * 4 + "not-logfmt\n",
        encoding="utf-8",
    )
    os.chmod(log_path, 0o600)
    contents = log_path.read_bytes()
    status = log_path.stat()
    listing = sorted(log_directory.iterdir())
    config = _opt_in(
        usage_collection_config_path, remote_write_endpoint=otlp_server.endpoint
    )

    for _ in range(2):
        snapshot = collect_usage_metrics(config, log_path=log_path)
        assert snapshot is not None
        build_otlp_payload(snapshot, config.machine_id, time_ns=2)
        assert push_usage_metrics(log_path=log_path) is True

    after = log_path.stat()
    assert log_path.read_bytes() == contents
    assert (
        after.st_size,
        after.st_mode,
        after.st_mtime_ns,
        after.st_ctime_ns,
        after.st_ino,
    ) == (
        status.st_size,
        status.st_mode,
        status.st_mtime_ns,
        status.st_ctime_ns,
        status.st_ino,
    )
    assert sorted(log_directory.iterdir()) == listing


def test_disabled_collection_has_no_snapshot():
    assert (
        collect_usage_metrics(usage_collection.UsageCollectionConfig(enabled=False))
        is None
    )


class _OtlpServer:
    """A loopback receiver that records each request and answers with ``status``."""

    def __init__(self, status=200, headers=None):
        self.requests = []
        received = self.requests

        class _Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                length = int(self.headers.get("Content-Length", "0"))
                received.append(
                    (self.path, dict(self.headers), self.rfile.read(length))
                )
                self.send_response(status)
                for name, value in (headers or {}).items():
                    self.send_header(name, value)
                self.send_header("Content-Length", "0")
                self.end_headers()

            def log_message(self, *_args):
                pass

        self._server = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
        self.endpoint = f"http://127.0.0.1:{self._server.server_port}/v1/metrics"
        threading.Thread(target=self._server.serve_forever, daemon=True).start()

    def close(self):
        self._server.shutdown()
        self._server.server_close()


@pytest.fixture
def otlp_server():
    server = _OtlpServer()
    yield server
    server.close()


@pytest.fixture
def curl_calls(monkeypatch):
    """Records curl invocations without running them, for pushes that must not send."""
    calls = []

    def _run(command, **kwargs):
        calls.append((command, kwargs))
        return subprocess.CompletedProcess(command, 0, stdout="200", stderr="")

    monkeypatch.setattr(usage_metrics.subprocess, "run", _run)
    return calls


def _opt_in(config_path, **values):
    _write_config(config_path, enabled=True, **values)
    return usage_collection.prepare_usage_collection_config()


def _curl_options(config_text: str) -> list[tuple[str, str]]:
    """Parse the ``name = "value"`` lines curl reads, undoing their escaping."""
    options = []
    for line in config_text.splitlines():
        name, separator, quoted = line.partition(" = ")
        if not separator:
            options.append((name, ""))
            continue
        assert quoted.startswith('"') and quoted.endswith('"')
        options.append((name, re.sub(r"\\(.)", r"\1", quoted[1:-1])))
    return options


@_requires_curl
def test_push_sends_the_counters_with_the_auth_token(
    event_log_directory, usage_collection_config_path, otlp_server
):
    config = _opt_in(
        usage_collection_config_path,
        remote_write_endpoint=otlp_server.endpoint,
        remote_write_auth_token="secret-token",
    )
    record_event(EventLogEvent.VIEW_OPENED, view=EventLogView.OPERATIONS)

    assert push_usage_metrics() is True

    ((path, headers, body),) = otlp_server.requests
    assert path == "/v1/metrics"
    assert headers["Content-Type"] == OTLP_CONTENT_TYPE
    assert headers["Authorization"] == "Bearer secret-token"
    sent = _flatten(json.loads(body))
    assert (
        f'ttnn_visualizer_view_opened_total{{machine_id="{config.machine_id}",'
        'view="operations"} 1'
    ) in sent
    assert b"secret-token" not in body


@_requires_curl
def test_push_without_a_token_is_unauthenticated(
    event_log_directory, usage_collection_config_path, otlp_server
):
    _opt_in(usage_collection_config_path, remote_write_endpoint=otlp_server.endpoint)

    assert push_usage_metrics() is True

    ((_path, headers, _body),) = otlp_server.requests
    assert "Authorization" not in headers


def test_push_keeps_the_token_and_body_off_the_command_line(
    event_log_directory, usage_collection_config_path, curl_calls
):
    _opt_in(
        usage_collection_config_path,
        remote_write_endpoint=_ENDPOINT,
        remote_write_auth_token="secret-token",
    )

    assert push_usage_metrics() is True

    ((command, kwargs),) = curl_calls
    # ``-q`` first, or curl reads ``~/.curlrc`` before anything else.
    assert command == ["curl", "-q", "--config", "-"]
    assert "secret-token" not in " ".join(command)
    options = _curl_options(kwargs["input"])
    assert ("url", _ENDPOINT) in options
    assert ("header", "Authorization: Bearer secret-token") in options
    assert ("proto", "=http,https") in options
    assert ("max-redirs", "0") in options
    assert not any(name.startswith("location") for name, _value in options)
    (body,) = [value for name, value in options if name == "data-binary"]
    assert "resourceMetrics" in json.loads(body)


@pytest.mark.parametrize(
    "values",
    [
        {},
        {"remote_write_endpoint": "ftp://metrics.example/write"},
    ],
)
def test_push_needs_a_valid_endpoint(
    event_log_directory, usage_collection_config_path, curl_calls, values
):
    _opt_in(usage_collection_config_path, **values)

    assert push_usage_metrics() is False
    assert curl_calls == []


def test_push_waits_for_a_prepared_identity(
    event_log_directory, usage_collection_config_path, curl_calls
):
    _write_config(
        usage_collection_config_path, enabled=True, remote_write_endpoint=_ENDPOINT
    )

    assert push_usage_metrics() is False
    assert curl_calls == []


def test_push_stops_once_the_config_is_disabled(
    event_log_directory, usage_collection_config_path, curl_calls
):
    _opt_in(usage_collection_config_path, remote_write_endpoint=_ENDPOINT)
    _write_config(
        usage_collection_config_path, enabled=False, remote_write_endpoint=_ENDPOINT
    )

    assert push_usage_metrics() is False
    assert curl_calls == []


@pytest.mark.parametrize("opt_out", ["environment", "marker"])
def test_push_stops_at_the_recording_opt_out(
    event_log_directory, usage_collection_config_path, curl_calls, monkeypatch, opt_out
):
    _opt_in(usage_collection_config_path, remote_write_endpoint=_ENDPOINT)
    record_event(EventLogEvent.VIEW_OPENED, view=EventLogView.OPERATIONS)
    _enable_recording_opt_out(opt_out, monkeypatch)

    assert push_usage_metrics() is False
    assert curl_calls == []


@_requires_curl
@pytest.mark.parametrize(
    "status, headers",
    [
        (400, {}),
        # Not followed, so the token is never resent to the host it names.
        (307, {"Location": "/elsewhere"}),
    ],
)
def test_push_raises_on_a_response_other_than_success(
    event_log_directory, usage_collection_config_path, status, headers
):
    server = _OtlpServer(status, headers)
    try:
        _opt_in(
            usage_collection_config_path,
            remote_write_endpoint=server.endpoint,
            remote_write_auth_token="secret-token",
        )

        with pytest.raises(OSError, match=f"HTTP {status}") as error_info:
            push_usage_metrics()
    finally:
        server.close()

    assert [path for path, _headers, _body in server.requests] == ["/v1/metrics"]
    # A client error is most often a receiver that does not speak OTLP.
    assert ("OTLP" in str(error_info.value)) is (400 <= status < 500)


@_requires_curl
def test_push_sends_braces_and_brackets_in_the_endpoint_literally(
    event_log_directory, usage_collection_config_path, otlp_server
):
    # Without ``globoff`` curl would expand these into two requests, each carrying
    # the token.
    _opt_in(
        usage_collection_config_path,
        remote_write_endpoint=otlp_server.endpoint + "/{a,b}[1-2]",
        remote_write_auth_token="secret-token",
    )

    assert push_usage_metrics() is True

    assert [path for path, _headers, _body in otlp_server.requests] == [
        "/v1/metrics/{a,b}[1-2]"
    ]


@pytest.mark.parametrize("status", ["200400", "2000", "20", ""])
def test_push_needs_exactly_one_success_status(
    event_log_directory, usage_collection_config_path, monkeypatch, status
):
    _opt_in(usage_collection_config_path, remote_write_endpoint=_ENDPOINT)
    monkeypatch.setattr(
        usage_metrics.subprocess,
        "run",
        lambda command, **_kwargs: subprocess.CompletedProcess(
            command, 0, stdout=status, stderr=""
        ),
    )

    with pytest.raises(OSError, match="endpoint answered HTTP"):
        push_usage_metrics()


@_requires_curl
def test_relaunching_continues_the_totals_without_a_start_time(
    event_log_directory, usage_collection_config_path, otlp_server
):
    """A second launch's total must read as following the first, not as a reset."""
    _opt_in(usage_collection_config_path, remote_write_endpoint=otlp_server.endpoint)
    record_event(EventLogEvent.VIEW_OPENED, view=EventLogView.OPERATIONS)

    first = UsageMetricsExporter(interval_seconds=3600)
    first._push()
    # A fresh launcher process starts with no cached aggregate.
    usage_metrics._metrics_state = usage_metrics._MetricsState()
    record_event(EventLogEvent.VIEW_OPENED, view=EventLogView.OPERATIONS)
    second = UsageMetricsExporter(interval_seconds=3600)
    second._push()

    def _view_points(body):
        metrics = json.loads(body)["resourceMetrics"][0]["scopeMetrics"][0]["metrics"]
        (metric,) = [
            metric
            for metric in metrics
            if metric["name"] == "ttnn_visualizer_view_opened_total"
        ]
        return metric["sum"]["dataPoints"]

    (first_point,), (second_point,) = [
        _view_points(body) for _path, _headers, body in otlp_server.requests
    ]
    assert (first_point["asInt"], second_point["asInt"]) == ("1", "2")
    assert "startTimeUnixNano" not in first_point
    assert "startTimeUnixNano" not in second_point


@_requires_curl
def test_push_sends_a_token_with_quotes_and_backslashes_verbatim(
    event_log_directory, usage_collection_config_path, otlp_server
):
    _opt_in(
        usage_collection_config_path,
        remote_write_endpoint=otlp_server.endpoint,
        remote_write_auth_token='a"b\\c',
    )

    assert push_usage_metrics() is True

    ((_path, headers, _body),) = otlp_server.requests
    assert headers["Authorization"] == 'Bearer a"b\\c'


@_requires_curl
def test_a_loopback_push_bypasses_the_proxy(
    event_log_directory, usage_collection_config_path, otlp_server, monkeypatch
):
    proxy = _OtlpServer()
    try:
        proxy_url = proxy.endpoint.removesuffix("/v1/metrics")
        for variable in ("http_proxy", "HTTPS_PROXY", "ALL_PROXY", "all_proxy"):
            monkeypatch.setenv(variable, proxy_url)
        for variable in ("no_proxy", "NO_PROXY"):
            monkeypatch.delenv(variable, raising=False)
        _opt_in(
            usage_collection_config_path,
            remote_write_endpoint=otlp_server.endpoint,
            remote_write_auth_token="secret-token",
        )

        assert push_usage_metrics() is True
    finally:
        proxy.close()

    assert proxy.requests == []
    ((_path, headers, _body),) = otlp_server.requests
    assert headers["Authorization"] == "Bearer secret-token"


def test_a_remote_push_may_use_the_proxy(
    event_log_directory, usage_collection_config_path, curl_calls
):
    _opt_in(usage_collection_config_path, remote_write_endpoint=_ENDPOINT)

    assert push_usage_metrics() is True

    ((_command, kwargs),) = curl_calls
    assert not any(name == "noproxy" for name, _value in _curl_options(kwargs["input"]))


@_requires_curl
def test_push_ignores_the_users_curlrc(
    event_log_directory,
    usage_collection_config_path,
    otlp_server,
    monkeypatch,
    tmp_path,
):
    curl_home = tmp_path / "curl-home"
    curl_home.mkdir()
    (curl_home / ".curlrc").write_text('header = "X-From-Curlrc: yes"\n')
    monkeypatch.setenv("CURL_HOME", str(curl_home))
    _opt_in(usage_collection_config_path, remote_write_endpoint=otlp_server.endpoint)

    assert push_usage_metrics() is True

    ((_path, headers, _body),) = otlp_server.requests
    assert "X-From-Curlrc" not in headers


def test_push_uses_the_requested_timeout(
    event_log_directory, usage_collection_config_path, curl_calls
):
    _opt_in(usage_collection_config_path, remote_write_endpoint=_ENDPOINT)

    assert push_usage_metrics(timeout_seconds=2.5) is True

    ((_command, kwargs),) = curl_calls
    options = _curl_options(kwargs["input"])
    assert ("max-time", "2.5") in options
    assert ("connect-timeout", "2.5") in options


def test_push_raises_when_curl_times_out(
    event_log_directory, usage_collection_config_path, monkeypatch
):
    _opt_in(usage_collection_config_path, remote_write_endpoint=_ENDPOINT)

    def _time_out(command, **kwargs):
        raise subprocess.TimeoutExpired(command, kwargs["timeout"])

    monkeypatch.setattr(usage_metrics.subprocess, "run", _time_out)

    with pytest.raises(TimeoutError):
        push_usage_metrics()


def test_push_reports_only_curls_first_error_line(
    event_log_directory, usage_collection_config_path, monkeypatch
):
    _opt_in(
        usage_collection_config_path,
        remote_write_endpoint=_ENDPOINT,
        remote_write_auth_token="secret-token",
    )
    monkeypatch.setattr(
        usage_metrics.subprocess,
        "run",
        lambda command, **_kwargs: subprocess.CompletedProcess(
            command,
            7,
            stdout="",
            stderr="curl: (7) Failed to connect\n> Authorization: Bearer secret-token\n",
        ),
    )

    with pytest.raises(OSError, match=r"curl exited with 7: curl: \(7\)") as error_info:
        push_usage_metrics()

    assert "secret-token" not in str(error_info.value)


@pytest.mark.parametrize("value", ["a\nb", "a\rb"])
def test_curl_config_values_refuse_line_breaks(value):
    with pytest.raises(ValueError):
        usage_metrics._quote_curl_config(value)


def test_push_raises_when_curl_is_missing(
    event_log_directory, usage_collection_config_path, monkeypatch
):
    _opt_in(usage_collection_config_path, remote_write_endpoint=_ENDPOINT)
    monkeypatch.setattr(usage_metrics, "CURL_COMMAND", "ttnn-visualizer-no-such-curl")

    with pytest.raises(OSError):
        push_usage_metrics()


def test_exporter_pushes_at_start_and_stop(monkeypatch):
    pushes = []
    monkeypatch.setattr(
        usage_metrics,
        "push_usage_metrics",
        lambda *, timeout_seconds: pushes.append(timeout_seconds) or True,
    )

    exporter = UsageMetricsExporter(interval_seconds=3600).start()
    exporter.stop()

    assert pushes == [
        usage_metrics.EXPORT_TIMEOUT_SECONDS,
        usage_metrics.FINAL_PUSH_TIMEOUT_SECONDS,
    ]


def test_exporter_pushes_every_interval(monkeypatch):
    pushes = []
    third_push = threading.Event()

    def _push(*, timeout_seconds):
        pushes.append(timeout_seconds)
        if len(pushes) == 3:
            third_push.set()
        return True

    monkeypatch.setattr(usage_metrics, "push_usage_metrics", _push)

    exporter = UsageMetricsExporter(interval_seconds=0.01).start()
    assert third_push.wait(timeout=5)
    exporter.stop()

    assert len(pushes) >= 4


def test_exporter_stop_skips_the_final_push_while_one_is_in_flight(monkeypatch):
    release = threading.Event()
    in_flight = threading.Event()
    pushes = []

    def _push(*, timeout_seconds):
        pushes.append(timeout_seconds)
        in_flight.set()
        release.wait(timeout=10)
        return True

    monkeypatch.setattr(usage_metrics, "push_usage_metrics", _push)
    monkeypatch.setattr(usage_metrics, "STOP_JOIN_TIMEOUT_SECONDS", 0.05)

    exporter = UsageMetricsExporter(interval_seconds=3600).start()
    assert in_flight.wait(timeout=5)
    exporter.stop()
    release.set()

    assert pushes == [usage_metrics.EXPORT_TIMEOUT_SECONDS]


def test_exporter_logs_a_run_of_failures_once(monkeypatch, caplog):
    outcomes = [OSError("down"), OSError("still down"), True, OSError("down again")]

    def _push(*, timeout_seconds):
        outcome = outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    monkeypatch.setattr(usage_metrics, "push_usage_metrics", _push)
    exporter = UsageMetricsExporter()

    with caplog.at_level(logging.WARNING, logger=usage_metrics.__name__):
        for _ in range(4):
            exporter._push()

    assert [record.getMessage() for record in caplog.records] == [
        "Unable to export usage metrics: down",
        "Unable to export usage metrics: down again",
    ]


class _FakeExporter:
    def __init__(self):
        self.events = []

    def start(self):
        self.events.append("start")
        return self

    def stop(self):
        self.events.append("stop")


@pytest.mark.parametrize(
    "server_mode, values, starts",
    [
        (False, {"enabled": True, "remote_write_endpoint": _ENDPOINT}, True),
        (True, {"enabled": True, "remote_write_endpoint": _ENDPOINT}, False),
        (False, {"enabled": True}, False),
        (False, {"enabled": False, "remote_write_endpoint": _ENDPOINT}, False),
        (False, None, False),
    ],
)
@pytest.mark.parametrize("opt_out", [None, "environment", "marker"])
def test_launch_starts_the_exporter_only_for_an_opted_in_endpoint(
    event_log_directory,
    usage_collection_config_path,
    monkeypatch,
    server_mode,
    values,
    starts,
    opt_out,
):
    from ttnn_visualizer import app as app_module

    monkeypatch.setattr(app_module, "UsageMetricsExporter", _FakeExporter)
    monkeypatch.setenv(RUN_ID_ENV_VAR, "")
    if values is not None:
        _write_config(usage_collection_config_path, **values)
    if opt_out is not None:
        # The banner reports collection as disabled under either opt-out, so no
        # exporter may start, even one that would idle until the opt-out lifts.
        _enable_recording_opt_out(opt_out, monkeypatch)
        starts = False

    # The same pairing ``main()`` uses: the launch prepares the identity the
    # exporter's pushes need, then hands that config over.
    collection_config = app_module._record_launch(
        SimpleNamespace(SERVER_MODE=server_mode, TT_METAL_HOME=None)
    )
    exporter = app_module._start_usage_export(collection_config)

    assert (exporter is not None) is starts
    if starts:
        assert collection_config is not None
        assert collection_config.machine_id is not None


@pytest.mark.parametrize(
    "outcome, expected_exit",
    [
        (subprocess.CompletedProcess([], 0), None),
        (subprocess.CompletedProcess([], 1), 1),
        (KeyboardInterrupt(), None),
    ],
)
def test_serving_stops_the_exporter_however_gunicorn_ends(
    monkeypatch, outcome, expected_exit
):
    from ttnn_visualizer import app as app_module

    def _run(_args):
        if isinstance(outcome, BaseException):
            raise outcome
        return outcome

    monkeypatch.setattr(app_module.subprocess, "run", _run)
    exporter = _FakeExporter()

    if expected_exit is None:
        app_module._serve(["gunicorn"], exporter)
    else:
        with pytest.raises(SystemExit) as exit_info:
            app_module._serve(["gunicorn"], exporter)
        assert exit_info.value.code == expected_exit

    assert exporter.events == ["stop"]


def _record_launch_output(monkeypatch, capsys, server_mode=False) -> str:
    from ttnn_visualizer.app import _record_launch

    # ``_record_launch`` writes the run ID straight into ``os.environ``. Setting it
    # first makes monkeypatch record the variable, so it is removed afterwards rather
    # than leaking into later tests.
    monkeypatch.setenv(RUN_ID_ENV_VAR, "")
    _record_launch(SimpleNamespace(SERVER_MODE=server_mode, TT_METAL_HOME=None))
    return capsys.readouterr().out


def test_launch_reports_collection_without_printing_the_endpoint(
    usage_collection_config_path, monkeypatch, capsys
):
    endpoint = "https://private-metrics.example/write"
    _write_config(
        usage_collection_config_path,
        enabled=True,
        remote_write_endpoint=endpoint,
    )

    output = _record_launch_output(monkeypatch, capsys)

    assert "Aggregate usage collection is ENABLED" in output
    assert str(usage_collection_config_path) in output
    assert endpoint not in output
    assert "machine_id" in json.loads(
        usage_collection_config_path.read_text(encoding="utf-8")
    )


@pytest.mark.parametrize(
    "contents, expected",
    [
        (None, "Aggregate usage collection is DISABLED.\n   Opt in through"),
        (
            '{"enabled": true}',
            "Aggregate usage collection is DISABLED: no remote_write_endpoint is set",
        ),
        ('{"enabled": false}', "Aggregate usage collection is DISABLED.\n   Opt in"),
        (
            '{"enabled": true, "remote_write_endpoint": "ftp://private.example/write"}',
            "Aggregate usage collection is DISABLED: the collection config is invalid.",
        ),
    ],
)
def test_launch_reports_each_disabled_collection_state(
    usage_collection_config_path, monkeypatch, capsys, contents, expected
):
    if contents is not None:
        usage_collection_config_path.parent.mkdir(parents=True)
        usage_collection_config_path.write_text(contents, encoding="utf-8")

    output = _record_launch_output(monkeypatch, capsys)

    assert expected in output
    assert "private.example" not in output
    assert "remote_write_endpoint must" not in output


def test_launch_reports_collection_disabled_by_the_recording_opt_out(
    usage_collection_config_path, monkeypatch, capsys
):
    _write_config(usage_collection_config_path, enabled=True)
    monkeypatch.setenv(RECORDING_DISABLED_ENV_VAR, "true")

    output = _record_launch_output(monkeypatch, capsys)

    assert (
        "Aggregate usage collection is DISABLED: event logging is disabled." in output
    )
    assert "Aggregate usage collection is ENABLED" not in output


def test_hosted_launch_reports_no_collection_status(
    usage_collection_config_path, monkeypatch, capsys
):
    _write_config(usage_collection_config_path, enabled=True)

    output = _record_launch_output(monkeypatch, capsys, server_mode=True)

    assert "Aggregate usage collection" not in output
