# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""The event log is a privacy commitment expressed as code.

Recording is on by default, so the tests that matter most are the ones asserting it
does *not* happen with the opt-out set or with anything free-form in a field. Hosted
recording additionally pins that separate browser sessions never share a file. The
rest pin the file's contract with the out-of-band collector — totals never go down,
and no line can be forged.
"""

import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path
from types import SimpleNamespace

import pytest
from ttnn_visualizer import event_logging
from ttnn_visualizer.event_logging import (
    _DETAIL_FIELD_ENUMS,
    _REQUIRED_FIELDS,
    CLIENT_EVENT_DETAIL_FIELDS,
    COUNT_FIELD,
    LOG_SIZE_CHECK_INTERVAL_BYTES,
    MAX_EVENT_LOG_BATCH_EVENTS,
    RECORDING_DISABLED_ENV_VAR,
    RUN_ID_ENV_VAR,
    RUN_ID_FIELD,
    DeploymentMode,
    EventLogEvent,
    EventLogView,
    LaunchMode,
    ReportKind,
    ReportLoadFailureReason,
    get_deployment_mode,
    get_event_log_path,
    get_launch_mode,
    is_recording_enabled,
    record_app_start,
    record_event,
    record_events,
)
from ttnn_visualizer.settings import DefaultConfig
from ttnn_visualizer.tests.event_log_readers import (
    parse_event_log_line,
    read_event_log_lines,
    total_event_log_events,
)
from ttnn_visualizer.tests.test_settings import ENV_SAMPLE_PATH

# One budget for the whole set of children, not one each: enough for all of them to
# finish their appends on a slow CI runner, and a hang fails the test rather than
# wedging the suite.
_SUBPROCESS_WRITER_TIMEOUT_SECONDS = 30


# The `event_log_directory` fixture comes from `conftest.py`; the log readers come from
# `event_log_readers.py`. Both are shared with the ingest endpoint's tests.
def _run_event_log_writers(
    directory: Path, writers: int, writes_each: int, batch_size: int = 1
) -> None:
    """Append ``writes_each`` events into ``directory`` from ``writers`` interpreters.

    All-or-nothing on purpose. The children only overlap if every one is spawned
    before any is awaited, and a separate spawn helper and await helper make
    ``spawn(); await(); spawn(); await()`` just as natural to write — which reads
    fine, passes, and silently proves nothing about interleaving.

    Must be called from within the ``event_log_directory`` fixture: the children inherit
    a copy of ``os.environ``, and it is that fixture's ``delenv`` that keeps a
    developer's own ``TTNN_VISUALIZER_RUN_ID`` from reaching them and collapsing
    their run ids into one.
    """
    # A developer shell with the opt-out set would otherwise inherit silence. Popped
    # rather than overridden with a false value: unset is the shipped state, and it is
    # the state every other test in this module runs under.
    child_env = {
        key: value
        for key, value in os.environ.items()
        if key != RECORDING_DISABLED_ENV_VAR
    }
    command = [
        sys.executable,
        "-m",
        "ttnn_visualizer.tests.event_log_writer",
        str(directory),
        str(writes_each),
        str(batch_size),
    ]

    children: list[subprocess.Popen] = []
    deadline = time.monotonic() + _SUBPROCESS_WRITER_TIMEOUT_SECONDS
    try:
        for _ in range(writers):
            # Inside the ``try`` so a fork/exec failure on a loaded runner — the kind
            # of thing that only ever happens in CI — orphans nothing.
            children.append(
                subprocess.Popen(
                    command,
                    env=child_env,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                )
            )

        for child in children:
            try:
                remaining = max(deadline - time.monotonic(), 0)
                _, stderr = child.communicate(timeout=remaining)
            except subprocess.TimeoutExpired:
                child.kill()
                _, stderr = child.communicate()
                pytest.fail(
                    f"event-log writers did not finish within "
                    f"{_SUBPROCESS_WRITER_TIMEOUT_SECONDS}s"
                    f"{f': {stderr}' if stderr else ''}"
                )

            assert child.returncode == 0, stderr
    finally:
        for child in children:
            if child.poll() is None:
                child.kill()
                child.communicate()


def test_concurrent_batches_do_not_interleave(event_log_directory):
    """The single-line case is covered elsewhere; a batch is the harder one.

    A batch goes out as one multi-line ``os.write``, so it is where ``O_APPEND`` is
    doing the most work — and where a regression to a per-line loop would start
    splitting one instance's flush across another's.
    """
    # 10 is deliberately not a multiple of 3: the writer has to finish with a short
    # batch, and a regression that dropped the remainder would fail the line count.
    writers, writes_each, batch_size = 3, 10, 3

    _run_event_log_writers(event_log_directory, writers, writes_each, batch_size)

    lines = read_event_log_lines(event_log_directory)

    assert len(lines) == writers * writes_each
    # Every line whole: a torn write would leave a fragment missing these fields.
    for line in lines:
        fields = parse_event_log_line(line)
        assert all(name in fields for name in _REQUIRED_FIELDS)
        assert fields["view"] == EventLogView.OPERATIONS.value
    # Three run ids, one per interpreter, so the writers really did overlap rather than
    # one having finished before the next was spawned.
    assert len({parse_event_log_line(line)[RUN_ID_FIELD] for line in lines}) == writers


def test_the_path_ignores_every_environment_derived_data_directory(monkeypatch):
    # The whole reason for not using get_app_data_directory(): a collector running as
    # root cannot read the user's shell environment, so the path has to be knowable
    # from outside the process.
    monkeypatch.setenv("TT_METAL_HOME", "/somewhere/tt-metal")
    monkeypatch.setenv("APP_DATA_DIRECTORY", "/somewhere/else")

    assert (
        event_logging.get_event_log_directory()
        == Path.home() / ".ttnn-visualizer" / "usage"
    )


def test_hosted_path_is_partitioned_by_session(event_log_directory):
    event_log_id = "a" * event_logging.EVENT_LOG_ID_LENGTH

    assert (
        event_logging.get_event_log_directory(True, event_log_id)
        == (event_log_directory / event_log_id).resolve()
    )
    assert (
        event_logging.get_event_log_path(True, event_log_id)
        == (
            event_log_directory / event_log_id / event_logging.EVENT_LOG_FILENAME
        ).resolve()
    )
    assert (
        event_logging.get_disabled_marker_path(True) == event_log_directory / "disabled"
    )


def test_production_hosted_root_is_fixed(monkeypatch):
    monkeypatch.setattr(event_logging, "EVENT_LOG_DIRECTORY", None)

    assert event_logging.get_event_log_root(True) == Path("/data/usage")


@pytest.mark.parametrize(
    "event_log_id",
    [None, "", "../escape", "A" * 32, "a" * 31, "a" * 33],
)
def test_hosted_path_refuses_an_invalid_event_log_id(event_log_directory, event_log_id):
    with pytest.raises(ValueError, match="valid event log identifier"):
        event_logging.get_event_log_directory(True, event_log_id)


def test_hosted_path_refuses_a_session_directory_symlink_escape(event_log_directory):
    event_log_id = "a" * event_logging.EVENT_LOG_ID_LENGTH
    outside = event_log_directory.parent / "outside"
    event_log_directory.mkdir()
    outside.mkdir()
    (event_log_directory / event_log_id).symlink_to(outside, target_is_directory=True)

    with pytest.raises(ValueError, match="escaped its configured root"):
        event_logging.get_event_log_directory(True, event_log_id)


def test_recording_is_on_by_default(event_log_directory):
    assert is_recording_enabled() is True


def test_the_environment_switches_recording_off(event_log_directory, monkeypatch):
    monkeypatch.setenv(RECORDING_DISABLED_ENV_VAR, "true")

    assert is_recording_enabled() is False

    record_event(EventLogEvent.APP_START)

    assert read_event_log_lines(event_log_directory) == []


def test_the_marker_file_switches_recording_off(event_log_directory):
    event_log_directory.mkdir(parents=True)
    event_logging.get_disabled_marker_path().touch()

    assert is_recording_enabled() is False

    record_event(EventLogEvent.APP_START)

    assert read_event_log_lines(event_log_directory) == []


def test_an_explicit_false_keeps_recording_on(event_log_directory, monkeypatch):
    # Guards against a presence check: the variable is documented in `.env.sample` at
    # its default, so the commented line being uncommented unchanged must record.
    monkeypatch.setenv(RECORDING_DISABLED_ENV_VAR, "false")

    assert is_recording_enabled() is True

    record_event(EventLogEvent.APP_START)

    assert len(read_event_log_lines(event_log_directory)) == 1


def test_the_documented_default_keeps_recording_on(event_log_directory, monkeypatch):
    # The generic `.env.sample` pin in ``test_settings.py`` cannot reach this setting:
    # ``_documented_boolean_defaults`` keys off a boolean config attribute of the same
    # name, and there is deliberately no ``USAGE_RECORDING_DISABLED`` attribute. So the
    # one boolean whose polarity is inverted — where an inverted sample line is most
    # likely to recur — would otherwise be the only one nothing polices.
    documented = [
        line
        for line in ENV_SAMPLE_PATH.read_text(encoding="utf-8").splitlines()
        if line.strip().startswith(f"# {RECORDING_DISABLED_ENV_VAR}=")
    ]

    # Asserted rather than skipped: a renamed or deleted line must fail here, which is
    # the whole point of pinning the file.
    assert len(documented) == 1

    monkeypatch.setenv(
        RECORDING_DISABLED_ENV_VAR, documented[0].split("=", 1)[1].strip()
    )

    assert is_recording_enabled() is True


def test_the_launch_banner_names_a_working_opt_out(
    event_log_directory, monkeypatch, capsys
):
    # Executable documentation. The banner is where a user actually learns how to opt
    # out, and this rename inverted its instruction — a banner naming a stale variable,
    # or the right one at the wrong polarity, would otherwise ship green.
    from ttnn_visualizer.app import _record_launch

    monkeypatch.setenv(RUN_ID_ENV_VAR, "")
    _record_launch(SimpleNamespace(SERVER_MODE="false", TT_METAL_HOME=None))

    printed = re.search(r"(USAGE_RECORDING_\w+)=(\w+)", capsys.readouterr().out)

    assert printed is not None

    monkeypatch.setenv(printed.group(1), printed.group(2))

    assert is_recording_enabled() is False


@pytest.mark.parametrize("value", ["yes", "off", "", "  ", "Ture"])
def test_an_unrecognised_disable_value_switches_recording_off(
    event_log_directory, monkeypatch, value
):
    # This is the third opt-out branch: false/0 records, true/1 disables, and an
    # unrecognised value disables before the launcher reports it. Other settings keep
    # their declared default after a warning, which here would read a misspelling as
    # consent to record.
    monkeypatch.setenv(RECORDING_DISABLED_ENV_VAR, value)

    assert is_recording_enabled() is False

    record_event(EventLogEvent.APP_START)

    assert read_event_log_lines(event_log_directory) == []


def test_record_launch_reports_an_unrecognised_disable_value_with_its_outcome(
    event_log_directory, monkeypatch, capsys
):
    from ttnn_visualizer.app import _record_launch

    monkeypatch.setenv(RECORDING_DISABLED_ENV_VAR, "yes")

    _record_launch(SimpleNamespace(SERVER_MODE=False, TT_METAL_HOME=None))

    output = capsys.readouterr().out

    assert f"{RECORDING_DISABLED_ENV_VAR}='yes' is not a recognised boolean" in output
    assert "event logging will be disabled" in output
    assert (
        f"Event logging is DISABLED: {RECORDING_DISABLED_ENV_VAR} requests the opt-out"
        in output
    )
    assert read_event_log_lines(event_log_directory) == []


def test_record_launch_reports_a_recognised_environment_opt_out(
    event_log_directory, monkeypatch, capsys
):
    from ttnn_visualizer.app import _record_launch

    monkeypatch.setenv(RECORDING_DISABLED_ENV_VAR, "true")

    _record_launch(SimpleNamespace(SERVER_MODE=False, TT_METAL_HOME=None))

    output = capsys.readouterr().out

    assert "not a recognised boolean" not in output
    assert (
        f"Event logging is DISABLED: {RECORDING_DISABLED_ENV_VAR} requests the opt-out"
        in output
    )
    assert read_event_log_lines(event_log_directory) == []


def test_record_launch_reports_the_marker_file_opt_out(
    event_log_directory, monkeypatch, capsys
):
    from ttnn_visualizer.app import _record_launch

    event_log_directory.mkdir(parents=True)
    marker = event_logging.get_disabled_marker_path()
    marker.touch()

    _record_launch(SimpleNamespace(SERVER_MODE=False, TT_METAL_HOME=None))

    output = capsys.readouterr().out

    assert f"Event logging is DISABLED: the marker file exists at {marker}" in output
    assert read_event_log_lines(event_log_directory) == []


def test_a_disabled_install_leaves_no_directory_behind(
    event_log_directory, monkeypatch
):
    monkeypatch.setenv(RECORDING_DISABLED_ENV_VAR, "true")

    is_recording_enabled()
    record_event(EventLogEvent.APP_START)

    assert not event_log_directory.exists()


def test_server_mode_is_enabled_but_requires_a_session_id(event_log_directory):
    assert is_recording_enabled(server_mode=True) is True

    record_event(EventLogEvent.APP_START, server_mode=True)

    assert read_event_log_lines(event_log_directory) == []


def test_hosted_recording_honours_the_root_marker(event_log_directory):
    event_log_directory.mkdir(parents=True)
    event_logging.get_disabled_marker_path(server_mode=True).touch()

    assert is_recording_enabled(server_mode=True) is False
    assert (
        record_events(
            [(EventLogEvent.VIEW_OPENED, {"view": EventLogView.OPERATIONS})],
            server_mode=True,
            event_log_id="a" * event_logging.EVENT_LOG_ID_LENGTH,
        )
        is False
    )
    assert not (
        event_log_directory / ("a" * event_logging.EVENT_LOG_ID_LENGTH)
    ).exists()


def test_server_mode_is_read_from_the_app_context(app, event_log_directory):
    # A process-level event has no browser session to select a hosted log.
    assert app.config["SERVER_MODE"] is True

    with app.app_context():
        record_event(EventLogEvent.APP_START)

    assert read_event_log_lines(event_log_directory) == []


def test_a_local_app_context_still_records(app, event_log_directory):
    app.config["SERVER_MODE"] = False

    with app.app_context():
        record_event(EventLogEvent.APP_START)

    assert len(read_event_log_lines(event_log_directory)) == 1


def test_a_stringified_server_mode_selects_the_right_posture(event_log_directory):
    # Flask ``settings_override`` can inject a raw string without going through
    # ``override_with_env_variables``; ``"false"`` is truthy, so ``is_flag_enabled`` has
    # to re-parse. Trusting the string would silently stop recording on a local install.
    assert is_recording_enabled(server_mode="false") is True
    assert is_recording_enabled(server_mode="true") is True
    with pytest.raises(ValueError, match="valid event log identifier"):
        event_logging.get_event_log_path(server_mode="true")


def test_the_environment_switch_survives_config_override(monkeypatch):
    # The same stringification the other way round: as a plain bool class attribute
    # this setting would come back as the truthy string "false" and fail open.
    monkeypatch.setenv(RECORDING_DISABLED_ENV_VAR, "true")

    config = DefaultConfig()
    config.override_with_env_variables()

    # Spelled out rather than taken from a constant: the attribute is named for the
    # state and the variable for the opt-out, so there is no single name that names
    # both and a shared constant here would suggest there is.
    assert config.USAGE_RECORDING_ACTIVE is False
    assert config.to_dict()["USAGE_RECORDING_ACTIVE"] is False


def test_event_logging_config_is_active_in_server_mode(
    event_log_directory, monkeypatch
):
    monkeypatch.delenv(RECORDING_DISABLED_ENV_VAR, raising=False)

    config = DefaultConfig()
    config.SERVER_MODE = True

    assert config.USAGE_RECORDING_ACTIVE is True


def test_event_logging_config_reflects_the_marker_file(
    event_log_directory, monkeypatch
):
    monkeypatch.delenv(RECORDING_DISABLED_ENV_VAR, raising=False)
    event_log_directory.mkdir(parents=True)
    event_logging.get_disabled_marker_path().touch()

    config = DefaultConfig()
    config.SERVER_MODE = False

    assert config.USAGE_RECORDING_ACTIVE is False


def test_an_event_round_trips_as_logfmt(event_log_directory):
    record_event(EventLogEvent.APP_START, deployment_mode=DeploymentMode.CONTAINER)

    (line,) = read_event_log_lines(event_log_directory)
    fields = parse_event_log_line(line)

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
def test_an_unsafe_value_writes_no_line_at_all(event_log_directory, value):
    # A partial line would be worse than none: an embedded newline forges a whole
    # extra event in a file another team parses as a privacy-reviewed artefact.
    record_event(EventLogEvent.APP_START, deployment_mode=value)

    assert read_event_log_lines(event_log_directory) == []


def test_an_unsafe_inherited_run_id_is_replaced(event_log_directory, monkeypatch):
    monkeypatch.setenv(RUN_ID_ENV_VAR, "forged\nts=2026-01-01T00:00:00Z")

    record_event(EventLogEvent.APP_START)

    (line,) = read_event_log_lines(event_log_directory)
    assert parse_event_log_line(line)["run_id"] != "forged"


def test_the_run_id_is_inherited_when_it_is_safe(event_log_directory, monkeypatch):
    monkeypatch.setenv(RUN_ID_ENV_VAR, "abc12345")

    record_event(EventLogEvent.APP_START)

    assert (
        parse_event_log_line(read_event_log_lines(event_log_directory)[0])["run_id"]
        == "abc12345"
    )


def test_start_run_generates_a_fresh_safe_identifier_each_time():
    first = event_logging.start_run()
    second = event_logging.start_run()

    assert first != second
    assert len(first) == event_logging.RUN_ID_LENGTH
    assert len(second) == event_logging.RUN_ID_LENGTH
    assert event_logging._is_safe_value(first)
    assert event_logging._is_safe_value(second)


def test_concurrent_subprocess_writers_never_truncate_a_line(event_log_directory):
    # Two separate instances sharing the log — the case ``_append_line``'s
    # ``O_APPEND`` claim is about. An in-process ThreadPool would still pass if
    # every writer funnelled through one shared buffered file object.
    writers = 2
    # The detection margin is thin: at 100 appends each a genuinely broken
    # ``_append_line`` (one line split across two ``os.write`` calls) survives about
    # one run in ten, because the write windows only overlap for as long as they do
    # by accident of interpreter startup taking about as long as the loop. 500 costs
    # ~0.02s and widens the window enough to catch it every time.
    writes_each = 500

    _run_event_log_writers(
        event_log_directory, writers=writers, writes_each=writes_each
    )

    lines = read_event_log_lines(event_log_directory)

    assert len(lines) == writers * writes_each

    parsed = []
    for line in lines:
        try:
            fields = parse_event_log_line(line)
        except ValueError:
            # A line severed mid-token leaves a fragment with no ``=`` in it, which
            # ``parse`` raises on. Quote it: the module's whole reason for existing
            # should not report as a traceback out of a shared helper.
            pytest.fail(f"truncated or interleaved line: {line!r}")

        # Token count as well as key set. Two whole lines merged carry exactly the
        # same four keys as one, so comparing key sets alone would not see the seam.
        assert len(line.split(" ")) == len(_REQUIRED_FIELDS) + 1
        assert set(fields) == {*_REQUIRED_FIELDS, RUN_ID_FIELD}
        assert fields["event"] == "app_start"

        parsed.append(fields)

    # The cross-process premise, pinned rather than merely arranged: every assertion
    # above is equally satisfied by all 1000 lines coming from one interpreter.
    assert len({fields[RUN_ID_FIELD] for fields in parsed}) == writers


def test_app_start_carries_the_baseline_fields(event_log_directory):
    record_app_start(SimpleNamespace(TT_METAL_HOME=None))

    fields = parse_event_log_line(read_event_log_lines(event_log_directory)[0])

    assert fields["event"] == "app_start"
    assert fields["deployment_mode"] == DeploymentMode.LOCAL_UPLOAD.value
    assert fields["launch_mode"] in {mode.value for mode in LaunchMode}
    assert fields["python_version"].count(".") == 1
    assert fields["version"]
    assert fields["os"]


def test_disabled_recording_does_not_build_the_app_start_payload(
    event_log_directory, monkeypatch
):
    monkeypatch.setenv(RECORDING_DISABLED_ENV_VAR, "true")

    def fail_if_called(*_args, **_kwargs):
        raise AssertionError(
            "app_start details must not be built when recording is off"
        )

    monkeypatch.setattr(event_logging, "get_application_version", fail_if_called)
    monkeypatch.setattr(event_logging, "get_deployment_mode", fail_if_called)
    monkeypatch.setattr(event_logging, "get_launch_mode", fail_if_called)
    monkeypatch.setattr(event_logging, "get_operating_system", fail_if_called)
    monkeypatch.setattr(event_logging, "get_python_version", fail_if_called)

    record_app_start(SimpleNamespace(TT_METAL_HOME=None))

    assert read_event_log_lines(event_log_directory) == []


def test_a_write_failure_does_not_break_the_caller(
    event_log_directory, monkeypatch, caplog
):
    # `_append_line` rather than `os.write`: patching the latter is process-global for the
    # duration, so every unrelated write in the window — including the one that emits the
    # warning being asserted on — would raise too.
    def raise_os_error(_line, _log_path, _state, hosted=False):
        raise OSError("disk full")

    monkeypatch.setattr(event_logging, "_append_line", raise_os_error)

    with caplog.at_level("WARNING"):
        record_event(EventLogEvent.APP_START)

    assert read_event_log_lines(event_log_directory) == []
    assert "Unable to record event" in caplog.text


def test_an_app_start_detail_failure_does_not_break_the_caller(
    event_log_directory, monkeypatch, caplog
):
    # Detail helpers are evaluated outside record_event's try when passed as kwargs;
    # record_app_start must absorb those escapes itself.
    monkeypatch.setattr(
        event_logging,
        "get_deployment_mode",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(OSError("EIO")),
    )

    with caplog.at_level("WARNING"):
        record_app_start(SimpleNamespace(TT_METAL_HOME=None))

    assert read_event_log_lines(event_log_directory) == []
    assert "Unable to record event" in caplog.text


def test_deployment_mode_prefers_tt_metal_home(monkeypatch):
    monkeypatch.setattr(event_logging, "is_running_in_container", lambda: True)

    assert get_deployment_mode("/home/user/tt-metal") == DeploymentMode.TT_METAL_HOME


def test_deployment_mode_detects_a_container(monkeypatch):
    monkeypatch.setattr(event_logging, "is_running_in_container", lambda: True)

    assert get_deployment_mode(None) == DeploymentMode.CONTAINER


def test_deployment_mode_falls_back_to_local_upload(monkeypatch):
    monkeypatch.setattr(event_logging, "is_running_in_container", lambda: False)

    assert get_deployment_mode("   ") == DeploymentMode.LOCAL_UPLOAD


def test_launch_mode_is_source_for_an_editable_install(monkeypatch):
    monkeypatch.setattr(
        event_logging,
        "distribution",
        lambda _name: SimpleNamespace(
            read_text=lambda _path: '{"dir_info": {"editable": true}}'
        ),
    )

    assert get_launch_mode() == LaunchMode.SOURCE


def test_launch_mode_is_wheel_for_a_regular_distribution(monkeypatch):
    monkeypatch.setattr(
        event_logging,
        "distribution",
        lambda _name: SimpleNamespace(read_text=lambda _path: None),
    )

    assert get_launch_mode() == LaunchMode.WHEEL


def test_launch_mode_is_hosted_in_server_mode():
    assert get_launch_mode(server_mode=True) == LaunchMode.HOSTED


def _write_log(directory: Path, lines):
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    (directory / event_logging.EVENT_LOG_FILENAME).write_text(
        "\n".join(lines) + "\n", encoding="utf-8"
    )


def test_compaction_keeps_cumulative_totals_monotonic(event_log_directory, monkeypatch):
    monkeypatch.setattr(event_logging, "MAX_LOG_BYTES", 0)
    lines = [
        f"ts=2026-08-0{day % 9 + 1}T10:00:00Z event=app_start schema_version=1 "
        f"run_id=abc1234{day % 9} deployment_mode=local_upload"
        for day in range(40)
    ]
    _write_log(event_log_directory, lines)
    before = total_event_log_events(lines)

    event_logging.compact_if_needed()

    after = read_event_log_lines(event_log_directory)
    assert total_event_log_events(after) == before
    assert len(after) < len(lines)


def test_compaction_does_not_merge_schema_versions(event_log_directory, monkeypatch):
    monkeypatch.setattr(event_logging, "MAX_LOG_BYTES", 0)
    # Interleaved so both versions fall inside the older half that gets summarised.
    lines = [
        f"ts=2026-08-01T10:00:0{index}Z event=app_start "
        f"schema_version={index % 2 + 1} run_id=aaaaaaa{index}"
        for index in range(8)
    ]
    _write_log(event_log_directory, lines)

    event_logging.compact_if_needed()

    summaries = [
        parse_event_log_line(line)
        for line in read_event_log_lines(event_log_directory)
        if COUNT_FIELD in line
    ]
    assert {summary["schema_version"] for summary in summaries} == {"1", "2"}
    assert all(summary[COUNT_FIELD] == "2" for summary in summaries)


def test_compaction_is_idempotent_on_already_counted_lines(
    event_log_directory, monkeypatch
):
    monkeypatch.setattr(event_logging, "MAX_LOG_BYTES", 0)
    lines = [
        "ts=2026-08-01T10:00:00Z event=app_start schema_version=1 count=500",
        "ts=2026-08-01T10:00:01Z event=app_start schema_version=1 count=250",
        "ts=2026-08-01T10:00:02Z event=app_start schema_version=1 run_id=aaaaaaaa",
        "ts=2026-08-01T10:00:03Z event=app_start schema_version=1 run_id=bbbbbbbb",
    ]
    _write_log(event_log_directory, lines)

    event_logging.compact_if_needed()

    assert total_event_log_events(read_event_log_lines(event_log_directory)) == 752


def test_compaction_keeps_lines_it_cannot_parse(event_log_directory, monkeypatch):
    # An NFS-interleaved line must not take the surrounding totals with it.
    monkeypatch.setattr(event_logging, "MAX_LOG_BYTES", 0)
    lines = [
        "ts=2026-08-01T10:00:00Z event=app_start schema_version=1 run_id=aaaaaaaa",
        "garbled",
        "ts=2026-08-01T10:00:02Z event=app_start schema_version=1 run_id=cccccccc",
        "ts=2026-08-01T10:00:03Z event=app_start schema_version=1 run_id=dddddddd",
    ]
    _write_log(event_log_directory, lines)

    event_logging.compact_if_needed()

    assert "garbled" in read_event_log_lines(event_log_directory)


def test_compaction_does_not_dress_up_a_fragment_as_a_summary(
    event_log_directory, monkeypatch
):
    # An interleave that severs a line on a key boundary still parses, so the only
    # thing marking it as junk is its missing fields. Summarising it would give it a
    # timestamp and an event name it never had.
    monkeypatch.setattr(event_logging, "MAX_LOG_BYTES", 0)
    fragment = "schema_version=1 run_id=aaaaaaaa deployment_mode=local_upload"
    lines = [
        fragment,
        "ts=2026-08-01T10:00:01Z event=app_start schema_version=1 run_id=bbbbbbbb",
        "ts=2026-08-01T10:00:02Z event=app_start schema_version=1 run_id=cccccccc",
        "ts=2026-08-01T10:00:03Z event=app_start schema_version=1 run_id=dddddddd",
    ]
    _write_log(event_log_directory, lines)

    event_logging.compact_if_needed()

    compacted = read_event_log_lines(event_log_directory)

    assert fragment in compacted
    assert not any(line.startswith("ts= ") for line in compacted)
    assert not any(event_logging.UNKNOWN_VALUE in line for line in compacted)
    assert total_event_log_events(compacted) == total_event_log_events(lines)


def test_compaction_survives_a_log_that_is_not_valid_utf_8(
    event_log_directory, monkeypatch
):
    # Compaction runs from `main()` before gunicorn is spawned, so a decode error
    # here would stop the server starting rather than cost us a line.
    monkeypatch.setattr(event_logging, "MAX_LOG_BYTES", 0)
    event_log_directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    (event_log_directory / event_logging.EVENT_LOG_FILENAME).write_bytes(
        b"ts=2026-08-01T10:00:00Z event=app_start schema_version=1 run_id=aaaaaaaa\n"
        b"\xff\xfe corrupted\n"
        b"ts=2026-08-01T10:00:02Z event=app_start schema_version=1 run_id=cccccccc\n"
        b"ts=2026-08-01T10:00:03Z event=app_start schema_version=1 run_id=dddddddd\n"
    )

    event_logging.compact_if_needed()

    # May still hold the original bytes when summarising the older half cannot shrink
    # the file (rewrite is skipped). Read the way `_compact` does.
    lines = (
        (event_log_directory / event_logging.EVENT_LOG_FILENAME)
        .read_text(encoding="utf-8", errors="replace")
        .splitlines()
    )

    assert (
        total_event_log_events([line for line in lines if line.startswith("ts=")]) == 3
    )
    assert any("corrupted" in line for line in lines)


def test_a_log_under_the_cap_is_left_alone(event_log_directory):
    lines = ["ts=2026-08-01T10:00:00Z event=app_start schema_version=1"]
    _write_log(event_log_directory, lines)

    event_logging.compact_if_needed()

    assert read_event_log_lines(event_log_directory) == lines


def test_compaction_skips_rewrite_when_nothing_is_summarisable(
    event_log_directory, monkeypatch
):
    # An older half of only unparseable lines cannot shrink the file; rewriting
    # would still pay the replace cost on every launch.
    monkeypatch.setattr(event_logging, "MAX_LOG_BYTES", 0)
    lines = [
        "garbled-one",
        "garbled-two",
        "ts=2026-08-01T10:00:02Z event=app_start schema_version=1 run_id=cccccccc",
        "ts=2026-08-01T10:00:03Z event=app_start schema_version=1 run_id=dddddddd",
    ]
    _write_log(event_log_directory, lines)
    before = get_event_log_path().stat()

    event_logging.compact_if_needed()

    after = get_event_log_path().stat()
    assert read_event_log_lines(event_log_directory) == lines
    assert after.st_mtime_ns == before.st_mtime_ns


def test_the_log_is_not_world_readable(event_log_directory, monkeypatch):
    record_event(EventLogEvent.APP_START)

    assert get_event_log_path().stat().st_mode & 0o077 == 0
    assert event_log_directory.stat().st_mode & 0o077 == 0

    # Compaction used to recreate the log at umask permissions and undo 0o600.
    monkeypatch.setattr(event_logging, "MAX_LOG_BYTES", 0)
    _write_log(
        event_log_directory,
        [
            "ts=2026-08-01T10:00:00Z event=app_start schema_version=1 run_id=aaaaaaaa",
            "ts=2026-08-01T10:00:01Z event=app_start schema_version=1 run_id=bbbbbbbb",
            "ts=2026-08-01T10:00:02Z event=app_start schema_version=1 run_id=cccccccc",
            "ts=2026-08-01T10:00:03Z event=app_start schema_version=1 run_id=dddddddd",
        ],
    )
    # Match the append path's mode so a regression is not masked by _write_log's umask.
    os.chmod(get_event_log_path(), 0o600)

    event_logging.compact_if_needed()

    assert get_event_log_path().stat().st_mode & 0o077 == 0


def test_the_hosted_session_directory_and_log_are_not_world_readable(
    event_log_directory,
):
    event_log_id = "a" * event_logging.EVENT_LOG_ID_LENGTH

    assert record_events(
        [(EventLogEvent.VIEW_OPENED, {"view": EventLogView.OPERATIONS})],
        server_mode=True,
        event_log_id=event_log_id,
    )

    directory = event_log_directory / event_log_id
    assert directory.stat().st_mode & 0o077 == 0
    assert get_event_log_path(True, event_log_id).stat().st_mode & 0o077 == 0


def test_record_launch_replaces_an_inherited_id_and_exports_the_new_one(
    event_log_directory, monkeypatch
):
    from ttnn_visualizer.app import _record_launch

    # setenv (not delenv) so the value _record_launch writes is rolled back at teardown.
    inherited_run_id = "abc12345"
    monkeypatch.setenv(RUN_ID_ENV_VAR, inherited_run_id)
    # The string form `.env.sample` produces, which is truthy if taken at face value.
    _record_launch(SimpleNamespace(SERVER_MODE="false", TT_METAL_HOME=None))

    lines = read_event_log_lines(event_log_directory)

    assert len(lines) == 1
    recorded_run_id = parse_event_log_line(lines[0])["run_id"]
    assert parse_event_log_line(lines[0])["event"] == "app_start"
    assert recorded_run_id != inherited_run_id
    assert os.environ[RUN_ID_ENV_VAR] == recorded_run_id
    assert event_logging.get_run_id() == recorded_run_id


def test_record_launch_reports_hosted_root_and_records_no_app_start(
    event_log_directory, monkeypatch, capsys
):
    from ttnn_visualizer.app import _record_launch

    monkeypatch.setenv(RUN_ID_ENV_VAR, "")
    _record_launch(SimpleNamespace(SERVER_MODE=True, TT_METAL_HOME=None))

    output = capsys.readouterr().out

    assert "Recording hosted events by browser session under" in output
    assert str(event_log_directory) in output
    assert list(event_log_directory.rglob(event_logging.EVENT_LOG_FILENAME)) == []
    # The run id is still exported so workers agree on one if it is switched on later.
    assert os.environ[RUN_ID_ENV_VAR]


def test_every_client_postable_event_has_a_validation_rule():
    """A new event without a rule must fail here, not be rejected in production.

    ``app_start`` is the one exclusion, and it is deliberate: the server records launches
    itself, so a client able to post one could forge the deployment population every
    other figure is read against.
    """
    assert set(CLIENT_EVENT_DETAIL_FIELDS) == set(EventLogEvent) - {
        EventLogEvent.APP_START
    }


def test_every_detail_field_draws_from_an_enum():
    """A detail field with no enum behind it would be validated by nothing at all."""
    for fields in CLIENT_EVENT_DETAIL_FIELDS.values():
        for field in fields:
            assert field in _DETAIL_FIELD_ENUMS


def test_no_client_detail_field_collides_with_a_server_owned_one():
    """The server supplies these, and a client that could set one could forge a line."""
    server_owned = set(_REQUIRED_FIELDS) | {RUN_ID_FIELD, COUNT_FIELD}

    for fields in CLIENT_EVENT_DETAIL_FIELDS.values():
        assert not server_owned.intersection(fields)


def test_every_enum_value_is_safe_to_write_unquoted():
    """logfmt values are unquoted, so a member carrying a space would forge a field."""
    for enum_type in _DETAIL_FIELD_ENUMS.values():
        for member in enum_type:
            assert event_logging._is_safe_value(str(member.value))


def test_record_events_writes_the_whole_batch_or_none_of_it(event_log_directory):
    """The route rejects first, so this is belt and braces — but it is the guarantee.

    An unsafe value reaching the writer must cost the batch, not half of it: a reader
    cannot tell a truncated batch from a complete one, and the file's bounded contents
    are the whole promise being made.
    """
    written = record_events(
        [
            (EventLogEvent.VIEW_OPENED, {"view": EventLogView.OPERATIONS}),
            (EventLogEvent.VIEW_OPENED, {"view": "operations\nts=forged"}),
        ]
    )

    assert written is False
    assert read_event_log_lines(event_log_directory) == []


def test_record_events_appends_a_batch_as_one_write(event_log_directory, monkeypatch):
    """Counts the writes, since the line contents alone cannot tell one from N.

    ``_append_line``'s no-lock design rests on a batch going out in a single
    ``os.write``; a per-event loop would produce identical file contents and interleave
    with another instance's appends.
    """
    writes = []
    real_write = os.write

    def counting_write(descriptor, data):
        # Only this module's appends. `os.write` is process-global while it is patched, so
        # any unrelated write landing in the window would otherwise count as a second one
        # and fail a test that is about batching.
        if data.startswith(b"ts="):
            writes.append(data)
        return real_write(descriptor, data)

    monkeypatch.setattr(event_logging.os, "write", counting_write)

    written = record_events(
        [
            (EventLogEvent.VIEW_OPENED, {"view": EventLogView.OPERATIONS}),
            (EventLogEvent.VIEW_ENGAGED, {"view": EventLogView.OPERATIONS}),
        ]
    )

    lines = read_event_log_lines(event_log_directory)

    assert written is True
    assert len(writes) == 1
    assert [parse_event_log_line(line)["event"] for line in lines] == [
        EventLogEvent.VIEW_OPENED.value,
        EventLogEvent.VIEW_ENGAGED.value,
    ]


def test_a_batch_carries_one_timestamp(event_log_directory, monkeypatch):
    """The module docstring promises a collector this, and it has to be exactly true.

    ``TIMESTAMP_FORMAT`` is second-granular, so stamping per line would split a batch
    that straddled a second boundary across two timestamps.
    """
    timestamps = iter(["2026-08-18T10:00:00Z", "2026-08-18T10:00:01Z"])
    monkeypatch.setattr(event_logging, "_get_timestamp", lambda: next(timestamps))

    record_events(
        [
            (EventLogEvent.VIEW_OPENED, {"view": EventLogView.OPERATIONS}),
            (EventLogEvent.VIEW_ENGAGED, {"view": EventLogView.OPERATIONS}),
        ]
    )

    stamps = {
        parse_event_log_line(line)["ts"]
        for line in read_event_log_lines(event_log_directory)
    }

    assert stamps == {"2026-08-18T10:00:00Z"}


def test_record_events_refuses_to_grow_a_log_past_the_cap(
    event_log_directory, monkeypatch
):
    """The cap is a privacy control, and only launch-time compaction honoured it before.

    Refusing rather than trimming: dropping old lines makes cumulative totals go down,
    which Prometheus reads as a counter reset and then extrapolates — losing history and
    inventing activity at once.

    Several batches rather than one, because one batch is the case a broken cap also
    passes. A version that recomputed the verdict instead of caching it refused the first
    batch, left the byte counter at zero, and then accepted everything until another whole
    interval had been appended — one refusal per interval, indefinitely.
    """
    record_event(EventLogEvent.APP_START)
    before = read_event_log_lines(event_log_directory)

    monkeypatch.setattr(event_logging, "MAX_LOG_BYTES", 0)
    event_logging._local_log_state.bytes_since_size_check = (
        LOG_SIZE_CHECK_INTERVAL_BYTES
    )

    refusals = [
        record_events([(EventLogEvent.VIEW_OPENED, {"view": EventLogView.OPERATIONS})])
        for _ in range(5)
    ]

    assert refusals == [False] * 5
    assert read_event_log_lines(event_log_directory) == before


def test_a_full_hosted_log_does_not_suppress_another_session(
    event_log_directory, monkeypatch
):
    event = (EventLogEvent.VIEW_OPENED, {"view": EventLogView.OPERATIONS})
    first_log_id = "a" * event_logging.EVENT_LOG_ID_LENGTH
    second_log_id = "b" * event_logging.EVENT_LOG_ID_LENGTH

    assert record_events([event], server_mode=True, event_log_id=first_log_id)
    monkeypatch.setattr(event_logging, "MAX_LOG_BYTES", 0)
    first_path = get_event_log_path(True, first_log_id)
    event_logging._ensure_hosted_log_state(first_path).bytes_since_size_check = (
        LOG_SIZE_CHECK_INTERVAL_BYTES
    )

    assert record_events([event], server_mode=True, event_log_id=first_log_id) is False
    assert record_events([event], server_mode=True, event_log_id=second_log_id) is True
    assert len(read_event_log_lines(event_log_directory / first_log_id)) == 1
    assert len(read_event_log_lines(event_log_directory / second_log_id)) == 1


def test_hosted_recording_resumes_after_external_compaction(
    event_log_directory, monkeypatch
):
    event = (EventLogEvent.VIEW_OPENED, {"view": EventLogView.OPERATIONS})
    event_log_id = "a" * event_logging.EVENT_LOG_ID_LENGTH
    now = 100.0
    monkeypatch.setattr(event_logging.time, "monotonic", lambda: now)
    assert record_events([event], server_mode=True, event_log_id=event_log_id)

    log_path = get_event_log_path(True, event_log_id)
    monkeypatch.setattr(event_logging, "MAX_LOG_BYTES", 0)
    event_logging._ensure_hosted_log_state(log_path).bytes_since_size_check = (
        LOG_SIZE_CHECK_INTERVAL_BYTES
    )
    assert record_events([event], server_mode=True, event_log_id=event_log_id) is False

    log_path.write_text("", encoding="utf-8")
    now += event_logging.HOSTED_FULL_LOG_RECHECK_SECONDS

    assert record_events([event], server_mode=True, event_log_id=event_log_id) is True
    assert len(read_event_log_lines(event_log_directory / event_log_id)) == 1


def test_full_hosted_log_rechecks_on_a_bounded_interval(
    event_log_directory, monkeypatch
):
    event = (EventLogEvent.VIEW_OPENED, {"view": EventLogView.OPERATIONS})
    event_log_id = "a" * event_logging.EVENT_LOG_ID_LENGTH
    now = 100.0
    monkeypatch.setattr(event_logging.time, "monotonic", lambda: now)
    assert record_events([event], server_mode=True, event_log_id=event_log_id)

    log_path = get_event_log_path(True, event_log_id)
    state = event_logging._ensure_hosted_log_state(log_path)
    monkeypatch.setattr(event_logging, "MAX_LOG_BYTES", 0)
    state.bytes_since_size_check = LOG_SIZE_CHECK_INTERVAL_BYTES
    assert record_events([event], server_mode=True, event_log_id=event_log_id) is False

    stat_calls = 0
    real_stat = Path.stat

    def counting_stat(path, *args, **kwargs):
        nonlocal stat_calls
        if path == log_path:
            stat_calls += 1
        return real_stat(path, *args, **kwargs)

    monkeypatch.setattr(Path, "stat", counting_stat)
    for _ in range(3):
        assert (
            record_events([event], server_mode=True, event_log_id=event_log_id) is False
        )
    assert stat_calls == 0

    now += event_logging.HOSTED_FULL_LOG_RECHECK_SECONDS
    assert record_events([event], server_mode=True, event_log_id=event_log_id) is False
    assert stat_calls == 1


def test_hosted_log_state_cache_is_bounded(event_log_directory, monkeypatch):
    monkeypatch.setattr(event_logging, "MAX_TRACKED_EVENT_LOGS", 2)

    for index in range(3):
        event_logging._ensure_hosted_log_state(event_log_directory / f"{index}.log")

    assert list(event_logging._hosted_log_state_by_path) == [
        event_log_directory / "1.log",
        event_log_directory / "2.log",
    ]


def test_rejected_new_logs_do_not_evict_admitted_rate_state(
    event_log_directory, monkeypatch
):
    event = (EventLogEvent.VIEW_OPENED, {"view": EventLogView.OPERATIONS})
    admitted_log_id = "a" * event_logging.EVENT_LOG_ID_LENGTH
    rejected_log_id = "b" * event_logging.EVENT_LOG_ID_LENGTH
    monkeypatch.setattr(event_logging, "MAX_TRACKED_EVENT_LOGS", 1)
    monkeypatch.setattr(event_logging, "MAX_HOSTED_EVENT_LOGS", 1)

    assert record_events(
        [event],
        server_mode=True,
        event_log_id=admitted_log_id,
    )
    admitted_path = get_event_log_path(True, admitted_log_id)
    admitted_state = event_logging._ensure_hosted_log_state(admitted_path)
    admitted_state.batches_in_rate_window = event_logging.MAX_HOSTED_BATCHES_PER_MINUTE

    assert (
        record_events(
            [event],
            server_mode=True,
            event_log_id=rejected_log_id,
        )
        is False
    )
    assert list(event_logging._hosted_log_state_by_path) == [admitted_path]
    assert (
        record_events(
            [event],
            server_mode=True,
            event_log_id=admitted_log_id,
        )
        is False
    )


def test_hosted_cap_is_reached_by_ordinary_appends(event_log_directory, monkeypatch):
    event = (EventLogEvent.VIEW_OPENED, {"view": EventLogView.OPERATIONS})
    event_log_id = "a" * event_logging.EVENT_LOG_ID_LENGTH
    assert record_events([event], server_mode=True, event_log_id=event_log_id)

    log_path = get_event_log_path(True, event_log_id)
    line_size = log_path.stat().st_size
    state = event_logging._ensure_hosted_log_state(log_path)
    monkeypatch.setattr(event_logging, "LOG_SIZE_CHECK_INTERVAL_BYTES", line_size * 2)
    monkeypatch.setattr(event_logging, "MAX_LOG_BYTES", line_size * 2)
    state.bytes_since_size_check = 0

    results = [
        record_events([event], server_mode=True, event_log_id=event_log_id)
        for _ in range(10)
    ]

    assert False in results
    first_refusal = results.index(False)
    assert all(result is False for result in results[first_refusal:])


def test_hosted_log_quota_bounds_session_files(event_log_directory, monkeypatch):
    event = (EventLogEvent.VIEW_OPENED, {"view": EventLogView.OPERATIONS})
    monkeypatch.setattr(event_logging, "MAX_HOSTED_EVENT_LOGS", 1)

    assert record_events(
        [event],
        server_mode=True,
        event_log_id="a" * event_logging.EVENT_LOG_ID_LENGTH,
    )
    assert (
        record_events(
            [event],
            server_mode=True,
            event_log_id="b" * event_logging.EVENT_LOG_ID_LENGTH,
        )
        is False
    )
    assert (
        len(list(event_log_directory.glob(f"*/{event_logging.EVENT_LOG_FILENAME}")))
        == 1
    )


def test_hosted_creation_rate_bounds_new_session_files(
    event_log_directory, monkeypatch
):
    event = (EventLogEvent.VIEW_OPENED, {"view": EventLogView.OPERATIONS})
    monkeypatch.setattr(event_logging, "MAX_HOSTED_EVENT_LOG_CREATIONS_PER_MINUTE", 1)

    assert record_events(
        [event],
        server_mode=True,
        event_log_id="a" * event_logging.EVENT_LOG_ID_LENGTH,
    )
    assert (
        record_events(
            [event],
            server_mode=True,
            event_log_id="b" * event_logging.EVENT_LOG_ID_LENGTH,
        )
        is False
    )
    assert (
        len(list(event_log_directory.glob(f"*/{event_logging.EVENT_LOG_FILENAME}")))
        == 1
    )


def test_hosted_rate_limit_bounds_batches_per_log(event_log_directory, monkeypatch):
    event = (EventLogEvent.VIEW_OPENED, {"view": EventLogView.OPERATIONS})
    event_log_id = "a" * event_logging.EVENT_LOG_ID_LENGTH
    now = 100.0
    monkeypatch.setattr(event_logging.time, "monotonic", lambda: now)
    monkeypatch.setattr(event_logging, "MAX_HOSTED_BATCHES_PER_MINUTE", 1)

    assert record_events([event], server_mode=True, event_log_id=event_log_id)
    assert record_events([event], server_mode=True, event_log_id=event_log_id) is False

    now += event_logging.HOSTED_RATE_WINDOW_SECONDS
    assert record_events([event], server_mode=True, event_log_id=event_log_id)


def test_the_cap_is_reached_by_ordinary_appends_alone(event_log_directory, monkeypatch):
    """Nothing here sets the byte counter by hand, unlike every other cap test.

    Those all prime the state's byte counter to the interval, so removing the accumulator
    in ``_append_line`` would disarm the write-path cap for the whole process and leave
    them green. This crosses the interval by appending, and pins that the refusal from
    that crossing is permanent rather than one batch wide.
    """
    event = (EventLogEvent.APP_START, {})

    assert record_events([event]) is True
    line_size = get_event_log_path().stat().st_size

    # Two lines' worth of headroom, so a handful of appends crosses the interval and the
    # log is over the cap by the time it is measured.
    monkeypatch.setattr(event_logging, "LOG_SIZE_CHECK_INTERVAL_BYTES", line_size * 2)
    monkeypatch.setattr(event_logging, "MAX_LOG_BYTES", line_size * 2)
    event_logging._local_log_state.bytes_since_size_check = 0

    results = [record_events([event]) for _ in range(10)]

    assert False in results, "the cap was never reached by appending alone"

    first_refusal = results.index(False)
    assert all(result is False for result in results[first_refusal:])
    # One line for the append above, plus everything accepted before the first refusal.
    assert len(read_event_log_lines(event_log_directory)) == 1 + first_refusal


def test_a_log_exactly_on_the_cap_still_accepts_appends(
    event_log_directory, monkeypatch
):
    """``_is_log_full`` and ``compact_if_needed`` have to agree about the boundary.

    Compaction skips a log at ``<= MAX_LOG_BYTES``, so a ``>=`` in the write path would
    refuse every append to a log sitting exactly on the cap while compaction declined to
    shrink it — wedged, with nothing short of deleting the file to unwedge it.
    """
    for _ in range(4):
        record_event(EventLogEvent.APP_START)

    before = read_event_log_lines(event_log_directory)
    monkeypatch.setattr(
        event_logging, "MAX_LOG_BYTES", get_event_log_path().stat().st_size
    )
    event_logging._local_log_state.bytes_since_size_check = (
        LOG_SIZE_CHECK_INTERVAL_BYTES
    )

    # Compaction leaves a log that is only *at* the cap alone...
    event_logging.compact_if_needed()
    assert read_event_log_lines(event_log_directory) == before

    # ...so the write path must not refuse it, or nothing would ever move it again.
    assert (
        record_events([(EventLogEvent.VIEW_OPENED, {"view": EventLogView.OPERATIONS})])
        is True
    )


def test_compaction_lets_a_full_log_record_again(event_log_directory, monkeypatch):
    """The escape route the module docstring promises, asserted as the sequence it is.

    The refusal is cached, so compaction has to clear it. Without that, shrinking the log
    would leave recording off until the process restarted — and every append in between
    answered as though it had been written.
    """
    event = (EventLogEvent.VIEW_OPENED, {"view": EventLogView.OPERATIONS})

    for _ in range(10):
        record_event(EventLogEvent.APP_START)

    # Between the compacted size and the current one: ten identical launches summarise to
    # a single counted line, so compaction takes the log to roughly six lines.
    monkeypatch.setattr(
        event_logging, "MAX_LOG_BYTES", get_event_log_path().stat().st_size * 4 // 5
    )
    event_logging._local_log_state.bytes_since_size_check = (
        LOG_SIZE_CHECK_INTERVAL_BYTES
    )

    assert record_events([event]) is False

    event_logging.compact_if_needed()
    assert get_event_log_path().stat().st_size <= event_logging.MAX_LOG_BYTES

    assert record_events([event]) is True
    assert total_event_log_events(read_event_log_lines(event_log_directory)) == 11


def test_a_full_batch_of_the_largest_event_is_still_one_write(
    event_log_directory, monkeypatch
):
    """``_append_line`` defers its single-``os.write`` obligation to the batch cap.

    ``MAX_EVENT_LOG_BATCH_EVENTS`` copies of the longest permitted event is the biggest line
    the writer can be handed, so it is where the short-write loop would begin to iterate
    and forfeit the ``O_APPEND`` atomicity the no-lock design rests on.
    """
    writes = []
    real_write = os.write

    def counting_write(descriptor, data):
        if data.startswith(b"ts="):
            writes.append(data)
        return real_write(descriptor, data)

    monkeypatch.setattr(event_logging.os, "write", counting_write)

    largest = (
        EventLogEvent.REPORT_LOAD_FAILED,
        {
            "kind": ReportKind.CLUSTER_DESCRIPTOR,
            "reason_class": ReportLoadFailureReason.UNSUPPORTED_VERSION,
        },
    )

    assert record_events([largest] * MAX_EVENT_LOG_BATCH_EVENTS) is True
    assert len(writes) == 1
    assert len(read_event_log_lines(event_log_directory)) == MAX_EVENT_LOG_BATCH_EVENTS


def test_a_batch_over_the_cap_is_refused_by_the_writer(event_log_directory):
    """The cap binds every batch caller, not just the ingest route.

    ``_append_line`` defers its single-``os.write`` obligation to
    ``MAX_EVENT_LOG_BATCH_EVENTS``, so a caller reaching ``record_events`` directly has to
    meet it too — otherwise the guarantee holds only for the one caller that happens to
    check first. Refused whole, since a truncated batch is exactly what the write path
    promises never to leave behind.
    """
    event = (EventLogEvent.VIEW_OPENED, {"view": EventLogView.OPERATIONS})

    assert record_events([event] * (MAX_EVENT_LOG_BATCH_EVENTS + 1)) is False
    assert read_event_log_lines(event_log_directory) == []


def test_recording_recovers_when_the_directory_is_removed(event_log_directory):
    """The directory may go mid-session — the docs invite the user to delete it.

    Caching the created directory made that permanent: every later append failed on a
    condition one ``mkdir`` fixes, silently, for the rest of the process.
    """
    record_event(EventLogEvent.APP_START)
    shutil.rmtree(event_log_directory)

    record_event(EventLogEvent.APP_START)

    assert len(read_event_log_lines(event_log_directory)) == 1
    assert get_event_log_path().stat().st_mode & 0o077 == 0


def test_hosted_recording_recovers_when_session_directory_is_removed(
    event_log_directory,
):
    event = (EventLogEvent.VIEW_OPENED, {"view": EventLogView.OPERATIONS})
    event_log_id = "a" * event_logging.EVENT_LOG_ID_LENGTH
    assert record_events([event], server_mode=True, event_log_id=event_log_id)
    directory = event_log_directory / event_log_id
    shutil.rmtree(directory)

    assert record_events([event], server_mode=True, event_log_id=event_log_id)
    assert len(read_event_log_lines(directory)) == 1
    assert directory.stat().st_mode & 0o077 == 0
    assert get_event_log_path(True, event_log_id).stat().st_mode & 0o077 == 0


def test_a_persistent_write_failure_warns_once_not_once_per_flush(
    event_log_directory, monkeypatch, caplog
):
    """A full disk fails every flush, and flushes arrive on a route called often.

    One warning each would fill the application log with the failure of the subsystem
    that exists not to disturb it, so the repeats drop to debug.
    """

    def raise_os_error(_line, _log_path, _state, hosted=False):
        raise OSError("disk full")

    monkeypatch.setattr(event_logging, "_append_line", raise_os_error)

    with caplog.at_level("WARNING"):
        for _ in range(5):
            record_events(
                [(EventLogEvent.VIEW_OPENED, {"view": EventLogView.OPERATIONS})]
            )

    warnings = [record for record in caplog.records if "events" in record.getMessage()]

    assert len(warnings) == 1


def test_hosted_write_failure_warnings_are_isolated_by_log(
    event_log_directory, monkeypatch, caplog
):
    def raise_os_error(_line, _log_path, _state, hosted=False):
        raise OSError("disk full")

    monkeypatch.setattr(event_logging, "_append_line", raise_os_error)
    event = (EventLogEvent.VIEW_OPENED, {"view": EventLogView.OPERATIONS})

    with caplog.at_level("WARNING"):
        for _ in range(2):
            record_events(
                [event],
                server_mode=True,
                event_log_id="a" * event_logging.EVENT_LOG_ID_LENGTH,
            )
        record_events(
            [event],
            server_mode=True,
            event_log_id="b" * event_logging.EVENT_LOG_ID_LENGTH,
        )

    warnings = [record for record in caplog.records if "events" in record.getMessage()]
    assert len(warnings) == 2


def test_a_write_landing_again_re_arms_the_failure_warning(
    event_log_directory, monkeypatch, caplog
):
    """Suppression lasts until a write succeeds, not for the life of the process.

    A transient failure must not buy silence for every real one after it.
    """
    real_append = event_logging._append_line

    def raise_os_error(_line, _log_path, _state, hosted=False):
        raise OSError("disk full")

    event = (EventLogEvent.VIEW_OPENED, {"view": EventLogView.OPERATIONS})

    with caplog.at_level("WARNING"):
        monkeypatch.setattr(event_logging, "_append_line", raise_os_error)
        record_events([event])

        monkeypatch.setattr(event_logging, "_append_line", real_append)
        assert record_events([event]) is True

        monkeypatch.setattr(event_logging, "_append_line", raise_os_error)
        record_events([event])

    warnings = [record for record in caplog.records if "events" in record.getMessage()]

    assert len(warnings) == 2


def test_a_hosted_write_landing_re_arms_its_failure_warning(
    event_log_directory, monkeypatch, caplog
):
    real_append = event_logging._append_line

    def raise_os_error(_line, _log_path, _state, hosted=False):
        raise OSError("disk full")

    event = (EventLogEvent.VIEW_OPENED, {"view": EventLogView.OPERATIONS})
    event_log_id = "a" * event_logging.EVENT_LOG_ID_LENGTH

    with caplog.at_level("WARNING"):
        monkeypatch.setattr(event_logging, "_append_line", raise_os_error)
        record_events([event], server_mode=True, event_log_id=event_log_id)

        monkeypatch.setattr(event_logging, "_append_line", real_append)
        assert record_events([event], server_mode=True, event_log_id=event_log_id)

        monkeypatch.setattr(event_logging, "_append_line", raise_os_error)
        record_events([event], server_mode=True, event_log_id=event_log_id)

    warnings = [record for record in caplog.records if "events" in record.getMessage()]
    assert len(warnings) == 2


def test_compaction_keeps_detail_bearing_events_in_separate_buckets(
    event_log_directory, monkeypatch
):
    """``_summarise`` keys on the whole field set, and the new events multiply buckets.

    ``app_start`` alone barely exercises that: ``kind`` x ``source`` is twenty
    combinations before views are counted, and a bucketing bug here silently corrupts
    the ratios the whole file exists to produce.
    """
    monkeypatch.setattr(event_logging, "MAX_LOG_BYTES", 0)
    combinations = [
        ("profiler", "upload"),
        ("profiler", "local_tt_metal"),
        ("mlir", "upload"),
    ]
    # Interleaved, not grouped: `_compact` summarises only the older half, so grouping
    # by combination would leave whole buckets in the untouched half and the assertion
    # below would be about nothing.
    lines = [
        f"ts=2026-08-0{cycle + 1}T10:00:0{index} event=report_loaded schema_version=1 "
        f"run_id=abc1234{cycle} kind={kind} source={source}"
        for cycle in range(4)
        for index, (kind, source) in enumerate(combinations)
    ]
    _write_log(event_log_directory, lines)

    event_logging.compact_if_needed()

    after = read_event_log_lines(event_log_directory)
    summaries = [parse_event_log_line(line) for line in after if COUNT_FIELD in line]

    assert total_event_log_events(after) == len(lines)
    # One summary per combination, none merged into another, and the older half held two
    # of each.
    assert {(summary["kind"], summary["source"]) for summary in summaries} == set(
        combinations
    )
    assert len(summaries) == len(combinations)
    assert all(summary[COUNT_FIELD] == "2" for summary in summaries)


def test_record_events_cannot_have_its_enabled_check_turned_against_it(
    event_log_directory,
):
    """``server_mode`` is a detail field like any other here, not a hidden parameter.

    With ``**kwargs`` it would bind to the parameter instead, and a value of ``true``
    would make the enabled check drop the event — a bypass wearing a no-op's clothes.
    The schema refuses the key, but the batch path takes untrusted keys and must not
    depend on the schema for that.
    """
    written = record_events([(EventLogEvent.VIEW_OPENED, {"server_mode": "true"})])

    assert written is True
    assert (
        parse_event_log_line(read_event_log_lines(event_log_directory)[0])[
            "server_mode"
        ]
        == "true"
    )


def test_record_events_writes_nothing_when_recording_is_disabled(
    event_log_directory, monkeypatch
):
    monkeypatch.setenv(RECORDING_DISABLED_ENV_VAR, "true")

    assert (
        record_events([(EventLogEvent.VIEW_OPENED, {"view": EventLogView.OPERATIONS})])
        is False
    )
    assert read_event_log_lines(event_log_directory) == []
