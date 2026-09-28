# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import json
import stat
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest
import yaml
from ttnn_visualizer import usage_collection, usage_metrics
from ttnn_visualizer.event_logging import (
    MAX_LOG_BYTES,
    EventLogEvent,
    EventLogView,
    record_event,
)
from ttnn_visualizer.usage_metrics import (
    PROMETHEUS_CONTENT_TYPE,
    render_usage_metrics,
)

_GOLDEN_METRICS_PATH = Path(__file__).parent / "data" / "usage_metrics.prom"


@pytest.fixture(autouse=True)
def reset_usage_metrics_state(monkeypatch):
    monkeypatch.setattr(usage_metrics, "_metrics_state", usage_metrics._MetricsState())


def _write_config(path: Path, **values):
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps(values), encoding="utf-8")


def test_missing_config_disables_collection(usage_collection_config_path):
    assert usage_collection.load_usage_collection_config().enabled is False
    assert not usage_collection_config_path.exists()


def test_initialising_a_missing_config_enables_local_collection(
    usage_collection_config_path,
):
    config = usage_collection.initialise_usage_collection_config()

    assert config.enabled is True
    assert config.remote_write_endpoint is None
    assert config.machine_id is not None
    assert json.loads(usage_collection_config_path.read_text(encoding="utf-8")) == {
        "enabled": True,
        "machine_id": config.machine_id,
    }


def test_initialising_preserves_an_existing_disabled_config(
    usage_collection_config_path,
):
    _write_config(usage_collection_config_path, enabled=False)

    config = usage_collection.initialise_usage_collection_config()

    assert config.enabled is False
    assert json.loads(usage_collection_config_path.read_text(encoding="utf-8")) == {
        "enabled": False
    }


def test_default_config_path_is_fixed_under_the_user_app_directory(
    monkeypatch, tmp_path
):
    monkeypatch.setattr(usage_collection, "COLLECTION_CONFIG_PATH", None)
    monkeypatch.setattr(Path, "home", staticmethod(lambda: tmp_path))

    assert usage_collection.get_collection_config_path() == (
        tmp_path / ".ttnn-visualizer" / "app" / "collection.json"
    )


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

    first = usage_collection.load_usage_collection_config()
    second = usage_collection.load_usage_collection_config()

    assert first.enabled is True
    assert first.machine_id == second.machine_id
    assert uuid.UUID(first.machine_id or "").hex == first.machine_id
    assert stat.S_IMODE(usage_collection_config_path.stat().st_mode) == 0o600


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
    ],
)
def test_invalid_config_fails_closed(usage_collection_config_path, values):
    _write_config(usage_collection_config_path, **values)

    config = usage_collection.load_usage_collection_config()

    assert config.enabled is False
    assert config.error


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


def test_disabled_and_malformed_files_are_restricted(usage_collection_config_path):
    _write_config(usage_collection_config_path, enabled=False)
    usage_collection_config_path.chmod(0o644)

    usage_collection.load_usage_collection_config()

    assert stat.S_IMODE(usage_collection_config_path.stat().st_mode) == 0o600
    assert stat.S_IMODE(usage_collection_config_path.parent.stat().st_mode) == 0o700


def test_loopback_http_endpoint_is_allowed(usage_collection_config_path):
    _write_config(
        usage_collection_config_path,
        enabled=True,
        remote_write_endpoint="http://127.0.0.1:9090/api/v1/write",
    )

    assert usage_collection.load_usage_collection_config().enabled is True


def test_enabled_config_without_an_endpoint_collects_locally(
    usage_collection_config_path,
):
    _write_config(usage_collection_config_path, enabled=True)

    config = usage_collection.load_usage_collection_config()
    rendered = usage_collection.build_prometheus_config(config)

    assert config.enabled is True
    assert config.remote_write_endpoint is None
    assert config.machine_id is not None
    assert "remote_write" not in rendered
    assert rendered["global"]["external_labels"] == {"machine_id": config.machine_id}


def test_prometheus_config_wires_target_identity_and_remote_write(
    usage_collection_config_path,
):
    machine_id = uuid.uuid4().hex
    config = usage_collection.UsageCollectionConfig(
        enabled=True,
        remote_write_endpoint="https://metrics.example/write",
        machine_id=machine_id,
    )

    rendered = usage_collection.build_prometheus_config(
        config, app_target="host.docker.internal:8123"
    )

    assert rendered["global"]["external_labels"] == {"machine_id": machine_id}
    assert rendered["scrape_configs"][0]["static_configs"] == [
        {"targets": ["host.docker.internal:8123"]}
    ]
    assert rendered["remote_write"] == [{"url": "https://metrics.example/write"}]


def test_disabled_prometheus_config_omits_remote_write_and_identity():
    rendered = usage_collection.build_prometheus_config(
        usage_collection.UsageCollectionConfig(enabled=False)
    )

    assert "external_labels" not in rendered["global"]
    assert "remote_write" not in rendered


@pytest.mark.parametrize(
    "app_target",
    [
        "host:bad",
        "http://host:8000",
        ":8000",
        "host",
        "host:70000",
    ],
)
def test_prometheus_config_rejects_invalid_app_targets(app_target):
    with pytest.raises(ValueError):
        usage_collection.build_prometheus_config(
            usage_collection.UsageCollectionConfig(enabled=False),
            app_target=app_target,
        )


def test_prometheus_config_uses_the_application_base_path():
    rendered = usage_collection.build_prometheus_config(
        usage_collection.UsageCollectionConfig(enabled=False),
        base_path="/visualizer/",
    )

    assert rendered["scrape_configs"][0]["metrics_path"] == "/visualizer/api/metrics"


def test_prometheus_config_matches_a_base_path_without_a_trailing_slash():
    rendered = usage_collection.build_prometheus_config(
        usage_collection.UsageCollectionConfig(enabled=False),
        base_path="/visualizer",
    )

    assert rendered["scrape_configs"][0]["metrics_path"] == "/visualizerapi/metrics"


@pytest.mark.parametrize("base_path", ["", "visualizer/", "/bad path/", "/path?x=1"])
def test_prometheus_config_rejects_invalid_base_paths(base_path):
    with pytest.raises(ValueError):
        usage_collection.build_prometheus_config(
            usage_collection.UsageCollectionConfig(enabled=False),
            base_path=base_path,
        )


def test_renderer_writes_valid_yaml(usage_collection_config_path, tmp_path):
    _write_config(
        usage_collection_config_path,
        enabled=True,
        remote_write_endpoint="https://metrics.example/write",
    )
    output = tmp_path / "prometheus.yml"

    usage_collection.render_prometheus_config(output)

    parsed = yaml.safe_load(output.read_text(encoding="utf-8"))
    assert parsed["scrape_configs"][0]["metrics_path"] == "/api/metrics"
    assert parsed["remote_write"][0]["url"] == "https://metrics.example/write"
    assert stat.S_IMODE(output.stat().st_mode) == 0o600


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

    metrics = render_usage_metrics(
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

    metrics = render_usage_metrics(
        usage_collection.UsageCollectionConfig(
            enabled=True,
            remote_write_endpoint="https://metrics.example/write",
            machine_id=machine_id,
        ),
        log_path=log_path,
    )

    assert "leaked" not in metrics
    assert "secret" not in metrics
    assert "ttnn_visualizer_usage_collector_parse_errors 4" in metrics


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

    metrics = render_usage_metrics(
        usage_collection.UsageCollectionConfig(
            enabled=True,
            remote_write_endpoint="https://metrics.example/write",
            machine_id=uuid.uuid4().hex,
        ),
        log_path=log_path,
    )

    assert private_value not in metrics
    assert "ttnn_visualizer_usage_collector_parse_errors 1" in metrics


def test_metrics_match_the_privacy_reviewed_golden_output(tmp_path):
    log_path = tmp_path / "events.log"
    log_path.write_text(
        "ts=2026-09-28T10:00:00Z event=report_loaded schema_version=1 "
        "run_id=aaaaaaaa kind=profiler source=upload count=2\n"
        "ts=2026-09-28T10:01:00Z event=view_opened schema_version=1 "
        "run_id=bbbbbbbb view=operations\n",
        encoding="utf-8",
    )

    metrics = render_usage_metrics(
        usage_collection.UsageCollectionConfig(
            enabled=True,
            remote_write_endpoint="https://metrics.example/write",
            machine_id="00000000000000000000000000000001",
        ),
        log_path=log_path,
    )
    golden_lines = _GOLDEN_METRICS_PATH.read_text(encoding="utf-8").splitlines()

    assert metrics == "\n".join(golden_lines[2:]) + "\n"


def test_disabled_metrics_are_an_empty_exposition():
    assert (
        render_usage_metrics(usage_collection.UsageCollectionConfig(enabled=False))
        == ""
    )


def test_missing_log_is_distinct_from_a_read_failure(tmp_path):
    metrics = render_usage_metrics(
        usage_collection.UsageCollectionConfig(
            enabled=True,
            remote_write_endpoint="https://metrics.example/write",
            machine_id=uuid.uuid4().hex,
        ),
        log_path=tmp_path / "absent.log",
    )

    assert "ttnn_visualizer_usage_collector_files_found 0" in metrics
    assert "ttnn_visualizer_usage_collector_scan_errors 0" in metrics


def test_read_failure_sets_the_scan_error(tmp_path, monkeypatch):
    log_path = tmp_path / "events.log"
    log_path.write_text("", encoding="utf-8")

    def _raise_permission_error(*_args, **_kwargs):
        raise PermissionError("refused")

    monkeypatch.setattr(Path, "open", _raise_permission_error)
    metrics = render_usage_metrics(
        usage_collection.UsageCollectionConfig(
            enabled=True,
            remote_write_endpoint="https://metrics.example/write",
            machine_id=uuid.uuid4().hex,
        ),
        log_path=log_path,
    )

    assert "ttnn_visualizer_usage_collector_files_found 1" in metrics
    assert "ttnn_visualizer_usage_collector_scan_errors 1" in metrics


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
    first_metrics = render_usage_metrics(config, log_path=log_path)

    def _raise_permission_error(*_args, **_kwargs):
        raise PermissionError("refused")

    monkeypatch.setattr(Path, "open", _raise_permission_error)
    failed_metrics = render_usage_metrics(config, log_path=log_path)

    assert 'view="operations"} 1' in first_metrics
    assert 'view="operations"} 1' in failed_metrics
    assert "ttnn_visualizer_usage_collector_scan_errors 1" in failed_metrics


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

    first_metrics = render_usage_metrics(config, log_path=log_path)
    unchanged_metrics = render_usage_metrics(config, log_path=log_path)
    with log_path.open("a", encoding="utf-8") as log_file:
        log_file.write(first_line)
    appended_metrics = render_usage_metrics(config, log_path=log_path)

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

    partial_metrics = render_usage_metrics(config, log_path=log_path)
    with log_path.open("a", encoding="utf-8") as log_file:
        log_file.write("\n")
    complete_metrics = render_usage_metrics(config, log_path=log_path)

    assert "ttnn_visualizer_view_opened_total" not in partial_metrics
    assert 'view="operations"} 1' in complete_metrics


def test_metrics_bound_an_overlong_unterminated_line(tmp_path):
    config = usage_collection.UsageCollectionConfig(
        enabled=True,
        machine_id=uuid.uuid4().hex,
    )
    log_path = tmp_path / "events.log"
    log_path.write_bytes(b"x" * MAX_LOG_BYTES)

    malformed_metrics = render_usage_metrics(config, log_path=log_path)
    unchanged_metrics = render_usage_metrics(config, log_path=log_path)

    assert "ttnn_visualizer_usage_collector_parse_errors 1" in malformed_metrics
    assert unchanged_metrics == malformed_metrics
    assert len(usage_metrics._metrics_state.pending) <= (
        usage_metrics.MAX_EVENT_LOG_LINE_BYTES
    )

    with log_path.open("ab") as log_file:
        log_file.write(
            b"\nts=2026-09-28T10:00:00Z event=view_opened schema_version=1 "
            b"view=operations\n"
        )
    recovered_metrics = render_usage_metrics(config, log_path=log_path)

    assert 'view="operations"} 1' in recovered_metrics
    assert "ttnn_visualizer_usage_collector_parse_errors 1" in recovered_metrics


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

    render_usage_metrics(config, log_path=operations_path)
    tensors_metrics = render_usage_metrics(config, log_path=tensors_path)

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

    render_usage_metrics(
        usage_collection.UsageCollectionConfig(
            enabled=True,
            machine_id=first_machine_id,
        ),
        log_path=log_path,
    )
    second_metrics = render_usage_metrics(
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
    render_usage_metrics(config, log_path=log_path)

    replacement_path = tmp_path / "replacement.log"
    replacement_path.write_text(
        "ts=2026-09-28T10:01:00Z event=view_opened schema_version=1 " "view=tensors\n",
        encoding="utf-8",
    )
    replacement_path.replace(log_path)
    metrics = render_usage_metrics(config, log_path=log_path)

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
    first_metrics = render_usage_metrics(config, log_path=log_path)

    log_path.write_text(line, encoding="utf-8")
    truncated_metrics = render_usage_metrics(config, log_path=log_path)

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

    metrics = render_usage_metrics(config, log_path=log_path)
    unchanged_metrics = render_usage_metrics(config, log_path=log_path)

    assert f'view="operations"}} {line_count}' in metrics
    assert unchanged_metrics == metrics


def test_local_metrics_endpoint_exports_recorded_events(
    client, app, event_log_directory, usage_collection_config_path
):
    app.config["SERVER_MODE"] = False
    _write_config(
        usage_collection_config_path,
        enabled=True,
        remote_write_endpoint="https://metrics.example/write",
    )
    record_event(EventLogEvent.VIEW_OPENED, view=EventLogView.OPERATIONS)

    response = client.get("/api/metrics")

    assert response.status_code == 200
    assert response.content_type == PROMETHEUS_CONTENT_TYPE
    assert b"ttnn_visualizer_view_opened_total" in response.data


def test_metrics_endpoint_is_empty_when_collection_is_disabled(
    client, app, usage_collection_config_path
):
    app.config["SERVER_MODE"] = False

    response = client.get("/api/metrics")

    assert response.status_code == 200
    assert response.data == b""


def test_metrics_endpoint_is_forbidden_in_server_mode(client):
    response = client.get("/api/metrics")

    assert response.status_code == 403


def test_launch_reports_collection_without_printing_the_endpoint(
    usage_collection_config_path, event_log_directory, capsys
):
    from ttnn_visualizer.app import _record_launch

    endpoint = "https://private-metrics.example/write"
    _write_config(
        usage_collection_config_path,
        enabled=True,
        remote_write_endpoint=endpoint,
    )

    _record_launch(SimpleNamespace(SERVER_MODE=False, TT_METAL_HOME=None))

    output = capsys.readouterr().out
    assert "Aggregate usage collection is ENABLED" in output
    assert str(usage_collection_config_path) in output
    assert endpoint not in output
