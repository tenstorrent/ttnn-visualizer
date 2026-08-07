# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""The usage log is a privacy commitment expressed as code.

Recording is on by default, so the tests that matter most are the ones asserting it
does *not* happen: under ``SERVER_MODE``, with the switch off, and with anything
free-form in a field. The rest pin the file's contract with the out-of-band
collector — totals never go down, and no line can be forged.
"""

import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace

import pytest
from ttnn_visualizer import usage
from ttnn_visualizer.settings import DefaultConfig
from ttnn_visualizer.usage import (
    COUNT_FIELD,
    RUN_ID_ENV_VAR,
    USAGE_RECORDING_ENV_VAR,
    DeploymentMode,
    UsageEvent,
    get_deployment_mode,
    get_usage_log_path,
    is_recording_enabled,
    record_app_start,
    record_event,
)


@pytest.fixture
def usage_directory(tmp_path, monkeypatch):
    """Redirect the log into a temporary directory and reset per-process state.

    Every test in this module depends on this: without it they would write to the
    developer's real ``~/.ttnn-visualizer/usage``.
    """
    directory = tmp_path / "usage"
    monkeypatch.setattr(usage, "USAGE_DIRECTORY", directory)
    monkeypatch.setattr(usage, "_run_id", None)
    monkeypatch.delenv(RUN_ID_ENV_VAR, raising=False)
    monkeypatch.delenv(USAGE_RECORDING_ENV_VAR, raising=False)

    return directory


def read_lines(directory: Path):
    log_path = directory / usage.USAGE_LOG_NAME
    if not log_path.exists():
        return []

    return log_path.read_text(encoding="utf-8").splitlines()


def parse(line: str):
    return dict(token.split("=", 1) for token in line.split(" "))


def total_events(lines):
    """Cumulative count the way the collector derives it: ``count``, default 1."""
    return sum(int(parse(line).get(COUNT_FIELD, "1")) for line in lines)


def test_the_path_ignores_every_environment_derived_data_directory(monkeypatch):
    # The whole reason for not using get_app_data_directory(): a collector running as
    # root cannot read the user's shell environment, so the path has to be knowable
    # from outside the process.
    monkeypatch.setenv("TT_METAL_HOME", "/somewhere/tt-metal")
    monkeypatch.setenv("APP_DATA_DIRECTORY", "/somewhere/else")

    assert usage.get_usage_directory() == Path.home() / ".ttnn-visualizer" / "usage"


def test_recording_is_on_by_default(usage_directory):
    assert is_recording_enabled() is True


def test_the_environment_switches_recording_off(usage_directory, monkeypatch):
    monkeypatch.setenv(USAGE_RECORDING_ENV_VAR, "false")

    assert is_recording_enabled() is False

    record_event(UsageEvent.APP_START)

    assert read_lines(usage_directory) == []


def test_the_marker_file_switches_recording_off(usage_directory):
    usage_directory.mkdir(parents=True)
    usage.get_disabled_marker_path().touch()

    assert is_recording_enabled() is False

    record_event(UsageEvent.APP_START)

    assert read_lines(usage_directory) == []


def test_a_disabled_install_leaves_no_directory_behind(usage_directory, monkeypatch):
    monkeypatch.setenv(USAGE_RECORDING_ENV_VAR, "false")

    is_recording_enabled()
    record_event(UsageEvent.APP_START)

    assert not usage_directory.exists()


def test_nothing_is_recorded_under_server_mode(usage_directory):
    assert is_recording_enabled(server_mode=True) is False

    record_event(UsageEvent.APP_START, server_mode=True)

    assert read_lines(usage_directory) == []


def test_server_mode_is_read_from_the_app_context(app, usage_directory):
    # The shared fixture is a hosted app (SERVER_MODE: True). A caller inside a
    # request should not have to know that to be refused.
    assert app.config["SERVER_MODE"] is True

    with app.app_context():
        record_event(UsageEvent.APP_START)

    assert read_lines(usage_directory) == []


def test_a_local_app_context_still_records(app, usage_directory):
    app.config["SERVER_MODE"] = False

    with app.app_context():
        record_event(UsageEvent.APP_START)

    assert len(read_lines(usage_directory)) == 1


def test_a_stringified_server_mode_does_not_disable_recording(usage_directory):
    # `.env.sample` documents `SERVER_MODE=false`, and override_with_env_variables
    # copies that raw string over the parsed bool — where it is truthy. Trusting it
    # would silently stop recording on an ordinary local install.
    assert is_recording_enabled(server_mode="false") is True
    assert is_recording_enabled(server_mode="true") is False


def test_the_environment_switch_survives_config_override(monkeypatch):
    # The same stringification the other way round: as a plain bool class attribute
    # this setting would come back as the truthy string "false" and fail open.
    monkeypatch.setenv(USAGE_RECORDING_ENV_VAR, "false")

    config = DefaultConfig()
    config.override_with_env_variables()

    assert config.USAGE_RECORDING_ENABLED is False
    assert config.to_dict()[USAGE_RECORDING_ENV_VAR] is False


def test_an_event_round_trips_as_logfmt(usage_directory):
    record_event(UsageEvent.APP_START, deployment_mode=DeploymentMode.CONTAINER)

    (line,) = read_lines(usage_directory)
    fields = parse(line)

    assert fields["event"] == "app_start"
    assert fields["schema_version"] == "1"
    assert fields["deployment_mode"] == "container"
    assert fields["ts"].endswith("Z")
    assert len(fields["ts"]) == len("2026-08-07T18:17:03Z")


@pytest.mark.parametrize(
    "value",
    ["two words", "with\nnewline", "key=value", 'quote"', "path/to/report"],
    ids=["space", "newline", "separator", "quote", "path"],
)
def test_an_unsafe_value_writes_no_line_at_all(usage_directory, value):
    # A partial line would be worse than none: an embedded newline forges a whole
    # extra event in a file another team parses as a privacy-reviewed artefact.
    record_event(UsageEvent.APP_START, deployment_mode=value)

    assert read_lines(usage_directory) == []


def test_an_unsafe_inherited_run_id_is_replaced(usage_directory, monkeypatch):
    monkeypatch.setenv(RUN_ID_ENV_VAR, "forged\nts=2026-01-01T00:00:00Z")

    record_event(UsageEvent.APP_START)

    (line,) = read_lines(usage_directory)
    assert parse(line)["run_id"] != "forged"


def test_the_run_id_is_inherited_when_it_is_safe(usage_directory, monkeypatch):
    monkeypatch.setenv(RUN_ID_ENV_VAR, "abc12345")

    record_event(UsageEvent.APP_START)

    assert parse(read_lines(usage_directory)[0])["run_id"] == "abc12345"


def test_concurrent_writers_never_truncate_a_line(usage_directory):
    writes = 200

    with ThreadPoolExecutor(max_workers=8) as executor:
        for _ in range(writes):
            executor.submit(record_event, UsageEvent.APP_START)

    lines = read_lines(usage_directory)

    assert len(lines) == writes
    assert all(
        line.startswith("ts=") and " event=app_start " in f"{line} " for line in lines
    )


def test_app_start_carries_the_baseline_fields(usage_directory):
    record_app_start(SimpleNamespace(TT_METAL_HOME=None))

    fields = parse(read_lines(usage_directory)[0])

    assert fields["event"] == "app_start"
    assert fields["deployment_mode"] == DeploymentMode.LOCAL_UPLOAD.value
    assert fields["python_version"].count(".") == 1
    assert fields["version"]
    assert fields["os"]


def test_deployment_mode_prefers_tt_metal_home(monkeypatch):
    monkeypatch.setattr(usage, "is_running_in_container", lambda: True)

    assert get_deployment_mode("/home/user/tt-metal") == DeploymentMode.TT_METAL_HOME


def test_deployment_mode_detects_a_container(monkeypatch):
    monkeypatch.setattr(usage, "is_running_in_container", lambda: True)

    assert get_deployment_mode(None) == DeploymentMode.CONTAINER


def test_deployment_mode_falls_back_to_local_upload(monkeypatch):
    monkeypatch.setattr(usage, "is_running_in_container", lambda: False)

    assert get_deployment_mode("   ") == DeploymentMode.LOCAL_UPLOAD


def write_log(directory: Path, lines):
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    (directory / usage.USAGE_LOG_NAME).write_text(
        "\n".join(lines) + "\n", encoding="utf-8"
    )


def test_compaction_keeps_cumulative_totals_monotonic(usage_directory, monkeypatch):
    monkeypatch.setattr(usage, "MAX_LOG_BYTES", 0)
    lines = [
        f"ts=2026-08-0{day % 9 + 1}T10:00:00Z event=app_start schema_version=1 "
        f"run_id=abc1234{day % 9} deployment_mode=local_upload"
        for day in range(40)
    ]
    write_log(usage_directory, lines)
    before = total_events(lines)

    usage.compact_if_needed()

    after = read_lines(usage_directory)
    assert total_events(after) == before
    assert len(after) < len(lines)


def test_compaction_does_not_merge_schema_versions(usage_directory, monkeypatch):
    monkeypatch.setattr(usage, "MAX_LOG_BYTES", 0)
    # Interleaved so both versions fall inside the older half that gets summarised.
    lines = [
        f"ts=2026-08-01T10:00:0{index}Z event=app_start "
        f"schema_version={index % 2 + 1} run_id=aaaaaaa{index}"
        for index in range(8)
    ]
    write_log(usage_directory, lines)

    usage.compact_if_needed()

    summaries = [
        parse(line) for line in read_lines(usage_directory) if COUNT_FIELD in line
    ]
    assert {summary["schema_version"] for summary in summaries} == {"1", "2"}
    assert all(summary[COUNT_FIELD] == "2" for summary in summaries)


def test_compaction_is_idempotent_on_already_counted_lines(
    usage_directory, monkeypatch
):
    monkeypatch.setattr(usage, "MAX_LOG_BYTES", 0)
    lines = [
        "ts=2026-08-01T10:00:00Z event=app_start schema_version=1 count=500",
        "ts=2026-08-01T10:00:01Z event=app_start schema_version=1 count=250",
        "ts=2026-08-01T10:00:02Z event=app_start schema_version=1 run_id=aaaaaaaa",
        "ts=2026-08-01T10:00:03Z event=app_start schema_version=1 run_id=bbbbbbbb",
    ]
    write_log(usage_directory, lines)

    usage.compact_if_needed()

    assert total_events(read_lines(usage_directory)) == 752


def test_compaction_keeps_lines_it_cannot_parse(usage_directory, monkeypatch):
    # An NFS-interleaved line must not take the surrounding totals with it.
    monkeypatch.setattr(usage, "MAX_LOG_BYTES", 0)
    lines = [
        "ts=2026-08-01T10:00:00Z event=app_start schema_version=1 run_id=aaaaaaaa",
        "garbled",
        "ts=2026-08-01T10:00:02Z event=app_start schema_version=1 run_id=cccccccc",
        "ts=2026-08-01T10:00:03Z event=app_start schema_version=1 run_id=dddddddd",
    ]
    write_log(usage_directory, lines)

    usage.compact_if_needed()

    assert "garbled" in read_lines(usage_directory)


def test_a_log_under_the_cap_is_left_alone(usage_directory):
    lines = ["ts=2026-08-01T10:00:00Z event=app_start schema_version=1"]
    write_log(usage_directory, lines)

    usage.compact_if_needed()

    assert read_lines(usage_directory) == lines


def test_the_log_is_not_world_readable(usage_directory):
    record_event(UsageEvent.APP_START)

    assert get_usage_log_path().stat().st_mode & 0o077 == 0
    assert usage_directory.stat().st_mode & 0o077 == 0


def test_record_launch_records_one_line_and_exports_the_run_id(
    usage_directory, monkeypatch
):
    from ttnn_visualizer.app import _record_launch

    monkeypatch.delenv(RUN_ID_ENV_VAR, raising=False)
    # The string form `.env.sample` produces, which is truthy if taken at face value.
    _record_launch(SimpleNamespace(SERVER_MODE="false", TT_METAL_HOME=None))

    lines = read_lines(usage_directory)

    assert len(lines) == 1
    assert parse(lines[0])["event"] == "app_start"
    assert os.environ[RUN_ID_ENV_VAR] == parse(lines[0])["run_id"]


def test_record_launch_records_nothing_in_server_mode(usage_directory, monkeypatch):
    from ttnn_visualizer.app import _record_launch

    monkeypatch.delenv(RUN_ID_ENV_VAR, raising=False)
    _record_launch(SimpleNamespace(SERVER_MODE=True, TT_METAL_HOME=None))

    assert read_lines(usage_directory) == []
    # The run id is still exported so workers agree on one if it is switched on later.
    assert os.environ[RUN_ID_ENV_VAR]
