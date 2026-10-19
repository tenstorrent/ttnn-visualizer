# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import os
import sys
import time
from pathlib import Path

import orjson
import pytest
from ttnn_visualizer.csv_queries import (
    MAX_CACHED_PERFORMANCE_REPORTS,
    REPORT_ROW_ID_OFFSET,
    OpsPerformanceReportQueries,
)
from ttnn_visualizer.models import Instance

# Kernels before multigrain timestamps (Linux 6.13) stamp ctime from the coarse
# clock, which ticks every 1-4 ms; waiting past this guarantees a new ctime.
COARSE_CLOCK_MARGIN_NS = 10_000_000


def _performance_source(tmp_path: Path, folder: str = "report"):
    performance_path = tmp_path / folder
    performance_path.mkdir()
    source_path = performance_path / "ops_perf_results.csv"
    source_path.write_text("OP TYPE,OP CODE\ntt_dnn_device,Matmul\n")
    instance = Instance(
        instance_id=f"instance-{folder}", performance_path=str(performance_path)
    )
    return instance, source_path


def _capture_uncached_generations(monkeypatch):
    calls = []

    def _fake_generate(cls, raw_csv, options):
        calls.append((raw_csv, options))
        return {
            "report": [{"op_code": options.group_by or "default"}],
            "stacked_report": [],
            "signposts": [],
        }

    monkeypatch.setattr(
        OpsPerformanceReportQueries,
        "_generate_report_uncached",
        classmethod(_fake_generate),
    )
    return calls


def test_identical_source_and_options_generate_once(tmp_path, monkeypatch):
    instance, _ = _performance_source(tmp_path)
    calls = _capture_uncached_generations(monkeypatch)

    first = OpsPerformanceReportQueries.generate_report_json(instance)
    second = OpsPerformanceReportQueries.generate_report_json(instance)

    assert first is second
    assert orjson.loads(first) == {
        "report": [{"op_code": "default"}],
        "stacked_report": [],
        "signposts": [],
    }
    assert len(calls) == 1


def test_the_dict_report_is_never_cached(tmp_path, monkeypatch):
    instance, _ = _performance_source(tmp_path)
    calls = _capture_uncached_generations(monkeypatch)

    OpsPerformanceReportQueries.generate_report(instance)
    OpsPerformanceReportQueries.generate_report(instance)

    assert len(calls) == 2


def test_the_dict_report_does_not_fill_the_json_cache(tmp_path, monkeypatch):
    instance, _ = _performance_source(tmp_path)
    calls = _capture_uncached_generations(monkeypatch)

    OpsPerformanceReportQueries.generate_report(instance)
    OpsPerformanceReportQueries.generate_report_json(instance)
    OpsPerformanceReportQueries.generate_report_json(instance)

    assert len(calls) == 2


def test_explicit_defaults_share_the_omitted_defaults_entry(tmp_path, monkeypatch):
    instance, _ = _performance_source(tmp_path)
    calls = _capture_uncached_generations(monkeypatch)

    OpsPerformanceReportQueries.generate_report_json(instance)
    OpsPerformanceReportQueries.generate_report_json(
        instance,
        start_signpost=None,
        end_signpost=None,
        print_signposts=True,
        hide_host_ops=False,
        merge_devices=True,
        tracing_mode=False,
        group_by=None,
        no_stacked_report=False,
    )

    assert len(calls) == 1


@pytest.mark.parametrize(
    "option, value",
    [
        ("start_signpost", "start"),
        ("end_signpost", "end"),
        ("print_signposts", False),
        ("hide_host_ops", True),
        ("merge_devices", False),
        ("tracing_mode", True),
        ("group_by", "memory"),
        ("no_stacked_report", True),
    ],
)
def test_every_generation_option_participates_in_the_key(
    option, value, tmp_path, monkeypatch
):
    instance, _ = _performance_source(tmp_path)
    calls = _capture_uncached_generations(monkeypatch)

    OpsPerformanceReportQueries.generate_report_json(instance)
    OpsPerformanceReportQueries.generate_report_json(instance, **{option: value})

    assert len(calls) == 2
    assert getattr(calls[1][1], option) == value


def test_a_different_source_path_generates_again(tmp_path, monkeypatch):
    first_instance, _ = _performance_source(tmp_path, "first")
    second_instance, _ = _performance_source(tmp_path, "second")
    calls = _capture_uncached_generations(monkeypatch)

    OpsPerformanceReportQueries.generate_report_json(first_instance)
    OpsPerformanceReportQueries.generate_report_json(second_instance)

    assert len(calls) == 2


def test_a_new_source_mtime_generates_again(tmp_path, monkeypatch):
    instance, source_path = _performance_source(tmp_path)
    calls = _capture_uncached_generations(monkeypatch)
    original_stat = source_path.stat()

    OpsPerformanceReportQueries.generate_report_json(instance)
    newer_ns = original_stat.st_mtime_ns + 1_000_000_000
    os.utime(source_path, ns=(newer_ns, newer_ns))
    OpsPerformanceReportQueries.generate_report_json(instance)

    assert len(calls) == 2


def test_a_new_source_size_generates_again(tmp_path, monkeypatch):
    instance, source_path = _performance_source(tmp_path)
    calls = _capture_uncached_generations(monkeypatch)
    original_stat = source_path.stat()

    OpsPerformanceReportQueries.generate_report_json(instance)
    source_path.write_text(source_path.read_text() + "tt_dnn_device,Add\n")
    os.utime(
        source_path,
        ns=(original_stat.st_atime_ns, original_stat.st_mtime_ns),
    )
    OpsPerformanceReportQueries.generate_report_json(instance)

    assert len(calls) == 2


class _StatWithOverride:
    def __init__(self, real, overrides):
        self._real = real
        self._overrides = overrides

    def __getattr__(self, name):
        return self._overrides.get(name, getattr(self._real, name))


@pytest.mark.parametrize("field", ["st_mtime_ns", "st_ctime_ns", "st_ino", "st_size"])
def test_each_source_stat_field_participates_in_the_key(field, tmp_path, monkeypatch):
    instance, source_path = _performance_source(tmp_path)
    calls = _capture_uncached_generations(monkeypatch)
    resolved_source = source_path.resolve()
    real_stat = Path.stat
    overrides = {}

    def _stat(path, *args, **kwargs):
        result = real_stat(path, *args, **kwargs)
        if path == resolved_source:
            return _StatWithOverride(result, overrides)
        return result

    monkeypatch.setattr(Path, "stat", _stat)

    OpsPerformanceReportQueries.generate_report_json(instance)
    overrides[field] = getattr(real_stat(resolved_source), field) + 1
    OpsPerformanceReportQueries.generate_report_json(instance)

    assert len(calls) == 2


@pytest.mark.skipif(
    sys.platform == "win32",
    reason="st_ctime is the creation time on Windows, so a rewrite does not change it",
)
def test_same_size_rewrite_with_preserved_mtime_generates_again(tmp_path, monkeypatch):
    instance, source_path = _performance_source(tmp_path)
    calls = _capture_uncached_generations(monkeypatch)
    original_stat = source_path.stat()

    OpsPerformanceReportQueries.generate_report_json(instance)
    while time.time_ns() < original_stat.st_ctime_ns + COARSE_CLOCK_MARGIN_NS:
        time.sleep(0.001)
    source_path.write_text("OP TYPE,OP CODE\ntt_dnn_device,Conv2d\n")
    os.utime(
        source_path,
        ns=(original_stat.st_atime_ns, original_stat.st_mtime_ns),
    )
    OpsPerformanceReportQueries.generate_report_json(instance)

    rewritten_stat = source_path.stat()
    assert rewritten_stat.st_size == original_stat.st_size
    assert rewritten_stat.st_ctime_ns != original_stat.st_ctime_ns
    assert len(calls) == 2


def test_report_cache_evicts_the_least_recently_used_entry(tmp_path, monkeypatch):
    instance, _ = _performance_source(tmp_path)
    calls = _capture_uncached_generations(monkeypatch)

    for index in range(MAX_CACHED_PERFORMANCE_REPORTS):
        OpsPerformanceReportQueries.generate_report_json(
            instance, group_by=f"group-{index}"
        )

    OpsPerformanceReportQueries.generate_report_json(instance, group_by="group-0")
    OpsPerformanceReportQueries.generate_report_json(
        instance, group_by=f"group-{MAX_CACHED_PERFORMANCE_REPORTS}"
    )
    OpsPerformanceReportQueries.generate_report_json(instance, group_by="group-0")
    OpsPerformanceReportQueries.generate_report_json(instance, group_by="group-1")

    assert len(calls) == MAX_CACHED_PERFORMANCE_REPORTS + 2


def test_failed_generation_is_retried(tmp_path, monkeypatch):
    instance, _ = _performance_source(tmp_path)
    calls = []

    def _fail_once(cls, raw_csv, options):
        calls.append((raw_csv, options))
        if len(calls) == 1:
            raise RuntimeError("generation failed")
        return {"report": [], "stacked_report": [], "signposts": []}

    monkeypatch.setattr(
        OpsPerformanceReportQueries,
        "_generate_report_uncached",
        classmethod(_fail_once),
    )

    with pytest.raises(RuntimeError, match="generation failed"):
        OpsPerformanceReportQueries.generate_report_json(instance)

    assert orjson.loads(OpsPerformanceReportQueries.generate_report_json(instance)) == {
        "report": [],
        "stacked_report": [],
        "signposts": [],
    }
    assert len(calls) == 2


def _swallow_one_generation_failure(monkeypatch):
    """The next generation succeeds with an error swallowed, so it is degraded."""
    failures = iter([OSError(24, "Too many open files")])
    real_extract_signposts = OpsPerformanceReportQueries.extract_signposts

    def _extract_signposts_failing_once(csv_file, resolved):
        failure = next(failures, None)
        if failure is not None:
            raise failure
        return real_extract_signposts(csv_file, resolved)

    def _write_one_row_perf_report(*args):
        # args[8] is the output CSV path tt-perf-report would fill. A row, so the
        # degraded report cannot match an empty one by accident.
        Path(args[8]).write_text(f"ID,OP Code\n{REPORT_ROW_ID_OFFSET},Matmul\n")

    monkeypatch.setattr(
        OpsPerformanceReportQueries,
        "extract_signposts",
        staticmethod(_extract_signposts_failing_once),
    )
    monkeypatch.setattr(
        "ttnn_visualizer.csv_queries.perf_report.generate_perf_report",
        _write_one_row_perf_report,
    )


def _as_degraded(healthy):
    """`healthy` as the degraded run reads it: the swallowed failure leaves no raw
    CSV rows, so nothing fills in each row's op type."""
    assert len(healthy["report"]) == 1
    return {
        **healthy,
        "report": [{**row, "op_type": None} for row in healthy["report"]],
    }


def test_a_swallowed_generation_failure_is_not_cached(tmp_path, monkeypatch):
    instance, _ = _performance_source(tmp_path)
    _swallow_one_generation_failure(monkeypatch)

    first = OpsPerformanceReportQueries.generate_report_json(instance)
    second = OpsPerformanceReportQueries.generate_report_json(instance)
    third = OpsPerformanceReportQueries.generate_report_json(instance)

    assert first is not second
    assert second is third
    healthy = orjson.loads(second)
    assert healthy["report"][0]["op_type"] == "tt_dnn_device"
    assert orjson.loads(first) == _as_degraded(healthy)


def test_a_degraded_dict_report_is_returned_rather_than_raised(tmp_path, monkeypatch):
    instance, _ = _performance_source(tmp_path)
    _swallow_one_generation_failure(monkeypatch)

    degraded = OpsPerformanceReportQueries.generate_report(instance)
    healthy = OpsPerformanceReportQueries.generate_report(instance)

    assert healthy["report"][0]["op_type"] == "tt_dnn_device"
    assert degraded == _as_degraded(healthy)
