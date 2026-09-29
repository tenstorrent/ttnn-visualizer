# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import json
import re
import stat
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest
import yaml
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
    PROMETHEUS_CONTENT_TYPE,
    render_usage_metrics,
)

_GOLDEN_METRICS_PATH = Path(__file__).parent / "data" / "usage_metrics.prom"


@pytest.fixture(autouse=True)
def reset_usage_metrics_state(monkeypatch, event_log_directory):
    # Depends on ``event_log_directory`` so the recording opt-out the metrics honour is
    # read from a temporary marker and a cleared variable, not the developer's own.
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


def test_exported_metric_pattern_matches_every_rendered_metric_name():
    for suffix in ("view_opened_total", "usage_collector_files_found"):
        assert re.fullmatch(
            usage_collection.EXPORTED_METRIC_PATTERN, usage_metrics._metric_name(suffix)
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

    assert render_usage_metrics(log_path=log_path) == ""


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


def test_enabled_config_without_an_endpoint_collects_locally(
    usage_collection_config_path,
):
    _write_config(usage_collection_config_path, enabled=True)

    config = usage_collection.prepare_usage_collection_config()
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
    assert rendered["remote_write"] == [
        {
            "url": "https://metrics.example/write",
            "write_relabel_configs": [
                {
                    "source_labels": ["__name__"],
                    "regex": "ttnn_visualizer_.*",
                    "action": "keep",
                },
                {"regex": "job|instance", "action": "labeldrop"},
            ],
        }
    ]


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


@pytest.mark.parametrize("base_path", ["/", "/visualizer/", "/visualizer"])
def test_the_renderer_scrapes_the_path_the_metrics_route_is_mounted_at(
    tmp_path, base_path
):
    """The scrape path is composed by hand, so only the route itself can pin it.

    The unit tests above compare the renderer with string literals, which a renamed or
    remounted route would leave green while the generated config scraped a 404.
    """
    from ttnn_visualizer.app import create_app
    from ttnn_visualizer.tests.fixture_settings import base_test_settings

    app = create_app(
        settings_override=base_test_settings(str(tmp_path), BASE_PATH=base_path)
    )
    mounted = {
        rule.rule
        for rule in app.url_map.iter_rules()
        if rule.endpoint == "api.usage_metrics"
    }
    rendered = usage_collection.build_prometheus_config(
        usage_collection.UsageCollectionConfig(enabled=False),
        base_path=base_path,
    )

    assert mounted == {rendered["scrape_configs"][0]["metrics_path"]}


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
    assert parsed["remote_write"][0]["write_relabel_configs"] == [
        {
            "source_labels": ["__name__"],
            "regex": "ttnn_visualizer_.*",
            "action": "keep",
        },
        {"regex": "job|instance", "action": "labeldrop"},
    ]
    assert stat.S_IMODE(output.stat().st_mode) == 0o644


def test_renderer_preserves_existing_config_when_atomic_replace_fails(
    usage_collection_config_path, tmp_path, monkeypatch
):
    _write_config(usage_collection_config_path, enabled=False)
    output = tmp_path / "prometheus.yml"
    output.write_text("existing configuration\n", encoding="utf-8")

    def _raise_os_error(*_args):
        raise OSError("replace failed")

    monkeypatch.setattr(usage_collection.os, "replace", _raise_os_error)

    with pytest.raises(OSError, match="replace failed"):
        usage_collection.render_prometheus_config(output)

    assert output.read_text(encoding="utf-8") == "existing configuration\n"
    assert list(tmp_path.glob(".prometheus.yml.*")) == []


def test_renderer_with_invalid_arguments_does_not_opt_in(
    usage_collection_config_path, tmp_path
):
    output = tmp_path / "prometheus.yml"

    with pytest.raises(SystemExit) as exit_info:
        usage_collection.main(["--app-target", "host", "--output", str(output)])

    assert exit_info.value.code == 2
    assert not output.exists()
    assert not usage_collection_config_path.exists()


@pytest.mark.parametrize(
    "contents",
    [
        "{not json",
        '{"enabled": true, "extra": "value"}',
        '{"enabled": true, "remote_write_endpoint": "http://"}',
    ],
)
def test_renderer_refuses_an_invalid_config(
    usage_collection_config_path, tmp_path, capsys, contents
):
    # A rejected config loads as disabled, so rendering it would exit 0 with a valid
    # file that collects nothing.
    usage_collection_config_path.parent.mkdir(parents=True)
    usage_collection_config_path.write_text(contents, encoding="utf-8")
    output = tmp_path / "prometheus.yml"

    with pytest.raises(SystemExit) as exit_info:
        usage_collection.main(["--output", str(output)])

    assert exit_info.value.code == 2
    assert "collection config is invalid" in capsys.readouterr().err
    assert not output.exists()
    assert usage_collection_config_path.read_text(encoding="utf-8") == contents


def test_renderer_reports_an_unwritable_output_as_a_failure(
    usage_collection_config_path, tmp_path, monkeypatch, capsys
):
    _write_config(usage_collection_config_path, enabled=False)

    def _raise_os_error(*_args):
        raise OSError("replace failed")

    monkeypatch.setattr(usage_collection.os, "replace", _raise_os_error)

    with pytest.raises(SystemExit) as exit_info:
        usage_collection.main(["--output", str(tmp_path / "prometheus.yml")])

    assert exit_info.value.code == 1
    assert "replace failed" in capsys.readouterr().err


def test_example_prometheus_config_matches_the_builder():
    example_path = (
        Path(__file__).parents[3] / "docker" / "prometheus" / "prometheus.example.yml"
    )
    config = usage_collection.UsageCollectionConfig(
        enabled=True,
        remote_write_endpoint="https://prometheus.example/api/v1/write",
        machine_id="0" * 32,
    )

    assert yaml.safe_load(
        example_path.read_text(encoding="utf-8")
    ) == usage_collection.build_prometheus_config(config)


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
    assert "ttnn_visualizer_usage_collector_parse_errors_total 4" in metrics


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
    assert "ttnn_visualizer_usage_collector_parse_errors_total 1" in metrics


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

    metrics = render_usage_metrics(
        usage_collection.UsageCollectionConfig(
            enabled=True,
            machine_id=uuid.uuid4().hex,
        ),
        log_path=log_path,
    )

    assert "_total{" not in metrics
    assert "ttnn_visualizer_usage_collector_parse_errors_total 1" in metrics


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

    metrics = render_usage_metrics(
        usage_collection.UsageCollectionConfig(
            enabled=True,
            machine_id=uuid.uuid4().hex,
        ),
        log_path=get_event_log_path(),
    )

    for event in EventLogEvent:
        assert f"ttnn_visualizer_{event.value}_total{{" in metrics
    assert "ttnn_visualizer_usage_collector_parse_errors_total 0" in metrics


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
    before = render_usage_metrics(config, log_path=log_path)
    lines_before = len(log_path.read_text(encoding="utf-8").splitlines())

    _compact(log_path)
    after = render_usage_metrics(config, log_path=log_path)

    assert len(log_path.read_text(encoding="utf-8").splitlines()) < lines_before
    assert after == before
    assert 'view="operations"} 6' in after
    assert "ttnn_visualizer_usage_collector_parse_errors_total 0" in after


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


def _enable_recording_opt_out(opt_out, monkeypatch):
    if opt_out == "environment":
        monkeypatch.setenv(RECORDING_DISABLED_ENV_VAR, "true")
    else:
        marker = get_disabled_marker_path()
        marker.parent.mkdir(parents=True, exist_ok=True)
        marker.touch()


@pytest.mark.parametrize("opt_out", ["environment", "marker"])
def test_metrics_endpoint_is_disabled_by_the_recording_opt_out(
    client, app, usage_collection_config_path, monkeypatch, opt_out
):
    app.config["SERVER_MODE"] = False
    _write_config(usage_collection_config_path, enabled=True)
    usage_collection.prepare_usage_collection_config()
    record_event(EventLogEvent.VIEW_OPENED, view=EventLogView.OPERATIONS)
    assert b"ttnn_visualizer_view_opened_total" in client.get("/api/metrics").data

    _enable_recording_opt_out(opt_out, monkeypatch)
    response = client.get("/api/metrics")

    assert response.status_code == 404
    assert b"ttnn_visualizer_view_opened_total" not in response.data


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

    assert "ttnn_visualizer_usage_collector_parse_errors_total 1" in malformed_metrics
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
    assert "ttnn_visualizer_usage_collector_parse_errors_total 1" in recovered_metrics


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
    usage_collection.prepare_usage_collection_config()
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
