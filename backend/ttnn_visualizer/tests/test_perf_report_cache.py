# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import os
from pathlib import Path

import pytest
from ttnn_visualizer.csv_queries import (
    MAX_CACHED_PERFORMANCE_REPORTS,
    OpsPerformanceReportQueries,
    clear_performance_report_cache,
)
from ttnn_visualizer.models import Instance


@pytest.fixture(autouse=True)
def _clear_report_cache():
    clear_performance_report_cache()
    yield
    clear_performance_report_cache()


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

    first = OpsPerformanceReportQueries.generate_report(instance)
    second = OpsPerformanceReportQueries.generate_report(instance)

    assert first is second
    assert len(calls) == 1


def test_explicit_defaults_share_the_omitted_defaults_entry(tmp_path, monkeypatch):
    instance, _ = _performance_source(tmp_path)
    calls = _capture_uncached_generations(monkeypatch)

    OpsPerformanceReportQueries.generate_report(instance)
    OpsPerformanceReportQueries.generate_report(
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

    OpsPerformanceReportQueries.generate_report(instance)
    OpsPerformanceReportQueries.generate_report(instance, **{option: value})

    assert len(calls) == 2
    assert getattr(calls[1][1], option) == value


def test_a_different_source_path_generates_again(tmp_path, monkeypatch):
    first_instance, _ = _performance_source(tmp_path, "first")
    second_instance, _ = _performance_source(tmp_path, "second")
    calls = _capture_uncached_generations(monkeypatch)

    OpsPerformanceReportQueries.generate_report(first_instance)
    OpsPerformanceReportQueries.generate_report(second_instance)

    assert len(calls) == 2


def test_a_new_source_mtime_generates_again(tmp_path, monkeypatch):
    instance, source_path = _performance_source(tmp_path)
    calls = _capture_uncached_generations(monkeypatch)
    original_stat = source_path.stat()

    OpsPerformanceReportQueries.generate_report(instance)
    newer_ns = original_stat.st_mtime_ns + 1_000_000_000
    os.utime(source_path, ns=(newer_ns, newer_ns))
    OpsPerformanceReportQueries.generate_report(instance)

    assert len(calls) == 2


def test_a_new_source_size_generates_again(tmp_path, monkeypatch):
    instance, source_path = _performance_source(tmp_path)
    calls = _capture_uncached_generations(monkeypatch)
    original_stat = source_path.stat()

    OpsPerformanceReportQueries.generate_report(instance)
    source_path.write_text(source_path.read_text() + "tt_dnn_device,Add\n")
    os.utime(
        source_path,
        ns=(original_stat.st_atime_ns, original_stat.st_mtime_ns),
    )
    OpsPerformanceReportQueries.generate_report(instance)

    assert len(calls) == 2


def test_same_size_rewrite_with_preserved_mtime_generates_again(tmp_path, monkeypatch):
    instance, source_path = _performance_source(tmp_path)
    calls = _capture_uncached_generations(monkeypatch)
    original_stat = source_path.stat()

    OpsPerformanceReportQueries.generate_report(instance)
    source_path.write_text("OP TYPE,OP CODE\ntt_dnn_device,Conv2d\n")
    os.utime(
        source_path,
        ns=(original_stat.st_atime_ns, original_stat.st_mtime_ns),
    )
    OpsPerformanceReportQueries.generate_report(instance)

    assert source_path.stat().st_size == original_stat.st_size
    assert len(calls) == 2


def test_report_cache_evicts_the_least_recently_used_entry(tmp_path, monkeypatch):
    instance, _ = _performance_source(tmp_path)
    calls = _capture_uncached_generations(monkeypatch)

    for index in range(MAX_CACHED_PERFORMANCE_REPORTS):
        OpsPerformanceReportQueries.generate_report(instance, group_by=f"group-{index}")

    OpsPerformanceReportQueries.generate_report(instance, group_by="group-0")
    OpsPerformanceReportQueries.generate_report(
        instance, group_by=f"group-{MAX_CACHED_PERFORMANCE_REPORTS}"
    )
    OpsPerformanceReportQueries.generate_report(instance, group_by="group-0")
    OpsPerformanceReportQueries.generate_report(instance, group_by="group-1")

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
        OpsPerformanceReportQueries.generate_report(instance)

    assert OpsPerformanceReportQueries.generate_report(instance)["report"] == []
    assert len(calls) == 2
