# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import json
import logging
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
    _DETAIL_FIELD_ENUMS,
    CLIENT_EVENT_DETAIL_FIELDS,
    MAX_LOG_BYTES,
    RECORDING_DISABLED_ENV_VAR,
    RUN_ID_ENV_VAR,
    SERVER_EVENT_DETAIL_FIELDS,
    EventLogEvent,
    EventLogView,
    _compact,
    get_disabled_marker_path,
    get_event_log_path,
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


def _write_config(path: Path, **values):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(values), encoding="utf-8")


def _flatten(payload) -> str:
    """The payload as ``name{attributes} value`` lines, the series a receiver stores."""
    lines = []
    for resource_metrics in payload["resourceMetrics"]:
        for scope_metrics in resource_metrics["scopeMetrics"]:
            for metric in scope_metrics["metrics"]:
                data = metric.get("sum") or metric["gauge"]
                for point in data["dataPoints"]:
                    labels = ",".join(
                        f'{attribute["key"]}="{attribute["value"]["stringValue"]}"'
                        for attribute in point["attributes"]
                    )
                    lines.append(f'{metric["name"]}{{{labels}}} {point["asInt"]}')
    return "\n".join(lines) + "\n"


def _render(config=None, *, log_path=None) -> str:
    resolved = config or usage_collection.load_usage_collection_config()
    snapshot = collect_usage_metrics(resolved, log_path=log_path)
    if snapshot is None:
        return ""
    assert resolved.machine_id is not None
    return _flatten(
        build_otlp_payload(snapshot, resolved.machine_id, start_time_ns=1, time_ns=2)
    )


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


def test_preparing_keeps_the_bearer_token(usage_collection_config_path):
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


def test_unprepared_config_renders_no_metrics(usage_collection_config_path, tmp_path):
    _write_config(usage_collection_config_path, enabled=True)
    log_path = tmp_path / "events.log"
    log_path.write_text(
        "ts=2026-09-28T10:00:00Z event=view_opened schema_version=1 "
        "view=operations\n",
        encoding="utf-8",
    )

    assert _render(log_path=log_path) == ""


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


def test_invalid_bearer_token_is_not_reported(usage_collection_config_path):
    _write_config(
        usage_collection_config_path,
        enabled=True,
        remote_write_endpoint="https://metrics.example/write",
        remote_write_auth_token="top secret",
    )

    config = usage_collection.load_usage_collection_config()

    assert config.error
    assert "secret" not in config.error


def test_bearer_token_is_loaded_but_not_shown(usage_collection_config_path):
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
        remote_write_endpoint="http://127.0.0.1:9090/api/v1/write",
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

    metrics = _render(
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

    metrics = _render(
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
    ],
)
def test_metrics_refuse_values_outside_the_event_schema(tmp_path, line, private_value):
    log_path = tmp_path / "events.log"
    log_path.write_text(line, encoding="utf-8")

    metrics = _render(
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

    metrics = _render(
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

    metrics = _render(
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
    before = _render(config, log_path=log_path)
    lines_before = len(log_path.read_text(encoding="utf-8").splitlines())

    _compact(log_path)
    after = _render(config, log_path=log_path)

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
    metrics = _render(
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
    metrics = _render(
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
    first_metrics = _render(config, log_path=log_path)

    def _raise_permission_error(*_args, **_kwargs):
        raise PermissionError("refused")

    monkeypatch.setattr(Path, "open", _raise_permission_error)
    failed_metrics = _render(config, log_path=log_path)

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

    first_metrics = _render(config, log_path=log_path)
    unchanged_metrics = _render(config, log_path=log_path)
    with log_path.open("a", encoding="utf-8") as log_file:
        log_file.write(first_line)
    appended_metrics = _render(config, log_path=log_path)

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

    partial_metrics = _render(config, log_path=log_path)
    with log_path.open("a", encoding="utf-8") as log_file:
        log_file.write("\n")
    complete_metrics = _render(config, log_path=log_path)

    assert "ttnn_visualizer_view_opened_total" not in partial_metrics
    assert 'view="operations"} 1' in complete_metrics


def test_metrics_bound_an_overlong_unterminated_line(tmp_path):
    config = usage_collection.UsageCollectionConfig(
        enabled=True,
        machine_id=uuid.uuid4().hex,
    )
    log_path = tmp_path / "events.log"
    log_path.write_bytes(b"x" * MAX_LOG_BYTES)

    malformed_metrics = _render(config, log_path=log_path)
    unchanged_metrics = _render(config, log_path=log_path)

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
    recovered_metrics = _render(config, log_path=log_path)

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

    _render(config, log_path=operations_path)
    tensors_metrics = _render(config, log_path=tensors_path)

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

    _render(
        usage_collection.UsageCollectionConfig(
            enabled=True,
            machine_id=first_machine_id,
        ),
        log_path=log_path,
    )
    second_metrics = _render(
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
    _render(config, log_path=log_path)

    replacement_path = tmp_path / "replacement.log"
    replacement_path.write_text(
        "ts=2026-09-28T10:01:00Z event=view_opened schema_version=1 " "view=tensors\n",
        encoding="utf-8",
    )
    replacement_path.replace(log_path)
    metrics = _render(config, log_path=log_path)

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
    first_metrics = _render(config, log_path=log_path)

    log_path.write_text(line, encoding="utf-8")
    truncated_metrics = _render(config, log_path=log_path)

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

    metrics = _render(config, log_path=log_path)
    unchanged_metrics = _render(config, log_path=log_path)

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
            "startTimeUnixNano": "1000",
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

    assert build_otlp_payload(
        snapshot, machine_id, start_time_ns=1000, time_ns=2000
    ) == {
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


def test_disabled_collection_has_no_snapshot():
    assert (
        collect_usage_metrics(usage_collection.UsageCollectionConfig(enabled=False))
        is None
    )


_requires_curl = pytest.mark.skipif(
    shutil.which("curl") is None, reason="curl is not installed"
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


@_requires_curl
def test_push_sends_the_counters_with_the_bearer_token(
    event_log_directory, usage_collection_config_path, otlp_server
):
    config = _opt_in(
        usage_collection_config_path,
        remote_write_endpoint=otlp_server.endpoint,
        remote_write_auth_token="secret-token",
    )
    record_event(EventLogEvent.VIEW_OPENED, view=EventLogView.OPERATIONS)

    assert push_usage_metrics(start_time_ns=1) is True

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

    assert push_usage_metrics(start_time_ns=1) is True

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

    assert push_usage_metrics(start_time_ns=1) is True

    ((command, kwargs),) = curl_calls
    assert command == ["curl", "--config", "-"]
    assert 'header = "Authorization: Bearer secret-token"' in kwargs["input"]
    assert f'url = "{_ENDPOINT}"' in kwargs["input"]


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

    assert push_usage_metrics(start_time_ns=1) is False
    assert curl_calls == []


def test_push_waits_for_a_prepared_identity(
    event_log_directory, usage_collection_config_path, curl_calls
):
    _write_config(
        usage_collection_config_path, enabled=True, remote_write_endpoint=_ENDPOINT
    )

    assert push_usage_metrics(start_time_ns=1) is False
    assert curl_calls == []


def test_push_stops_once_the_config_is_disabled(
    event_log_directory, usage_collection_config_path, curl_calls
):
    _opt_in(usage_collection_config_path, remote_write_endpoint=_ENDPOINT)
    _write_config(
        usage_collection_config_path, enabled=False, remote_write_endpoint=_ENDPOINT
    )

    assert push_usage_metrics(start_time_ns=1) is False
    assert curl_calls == []


@pytest.mark.parametrize("opt_out", ["environment", "marker"])
def test_push_stops_at_the_recording_opt_out(
    event_log_directory, usage_collection_config_path, curl_calls, monkeypatch, opt_out
):
    _opt_in(usage_collection_config_path, remote_write_endpoint=_ENDPOINT)
    record_event(EventLogEvent.VIEW_OPENED, view=EventLogView.OPERATIONS)
    _enable_recording_opt_out(opt_out, monkeypatch)

    assert push_usage_metrics(start_time_ns=1) is False
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

        with pytest.raises(OSError, match=f"HTTP {status}"):
            push_usage_metrics(start_time_ns=1)
    finally:
        server.close()

    assert [path for path, _headers, _body in server.requests] == ["/v1/metrics"]


def test_push_raises_when_curl_is_missing(
    event_log_directory, usage_collection_config_path, monkeypatch
):
    _opt_in(usage_collection_config_path, remote_write_endpoint=_ENDPOINT)
    monkeypatch.setattr(usage_metrics, "CURL_COMMAND", "ttnn-visualizer-no-such-curl")

    with pytest.raises(OSError):
        push_usage_metrics(start_time_ns=1)


def test_exporter_pushes_at_start_and_stop(monkeypatch):
    pushes = []
    monkeypatch.setattr(
        usage_metrics,
        "push_usage_metrics",
        lambda *, start_time_ns: pushes.append(start_time_ns) or True,
    )

    exporter = UsageMetricsExporter(interval_seconds=3600).start()
    exporter.stop()

    assert len(pushes) == 2
    assert pushes[0] == pushes[1]


def test_exporter_logs_a_run_of_failures_once(monkeypatch, caplog):
    outcomes = [OSError("down"), OSError("still down"), True, OSError("down again")]

    def _push(*, start_time_ns):
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
def test_launch_starts_the_exporter_only_for_an_opted_in_endpoint(
    usage_collection_config_path, monkeypatch, server_mode, values, starts
):
    from ttnn_visualizer import app as app_module

    started = []

    class _FakeExporter:
        def start(self):
            started.append(self)
            return self

    monkeypatch.setattr(app_module, "UsageMetricsExporter", _FakeExporter)
    if values is not None:
        _write_config(usage_collection_config_path, **values)

    exporter = app_module._start_usage_export(SimpleNamespace(SERVER_MODE=server_mode))

    assert (exporter is not None) is starts
    assert len(started) == int(starts)


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
