# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Report generation must not leave tt-perf-report's stacked-report figure open (#2135).

These call `_generate_report_uncached` directly, below the report cache, so every
call really draws.
"""

import matplotlib
import matplotlib.pyplot as plt
import pytest
from tt_perf_report import perf_report
from ttnn_visualizer.csv_queries import (
    OpsPerformanceReportQueries,
    _PerformanceReportOptions,
)
from ttnn_visualizer.exceptions import DataFormatError
from ttnn_visualizer.tests.smoke_capture import SMOKE_CAPTURE, smoke_rows

_GENERATIONS = 5


def _options(**overrides) -> _PerformanceReportOptions:
    queries = OpsPerformanceReportQueries
    defaults = dict(
        start_signpost=queries.DEFAULT_START_SIGNPOST,
        end_signpost=queries.DEFAULT_END_SIGNPOST,
        print_signposts=queries.DEFAULT_PRINT_SIGNPOSTS,
        hide_host_ops=queries.DEFAULT_NO_HOST_OPS,
        merge_devices=queries.DEFAULT_MERGE_DEVICES,
        tracing_mode=queries.DEFAULT_TRACING_MODE,
        group_by=queries.DEFAULT_GROUP_BY,
        no_stacked_report=queries.DEFAULT_NO_STACKED_REPORT,
    )
    return _PerformanceReportOptions(**{**defaults, **overrides})


def _smoke_csv() -> str:
    smoke_rows()  # skips when the capture is absent
    return SMOKE_CAPTURE.read_text()


def _count_plots(monkeypatch) -> list:
    """Record each stacked-report plot, so a test can't pass by never drawing one."""
    calls = []
    plot = perf_report.plot_stacked_report

    def _counting_plot(*args, **kwargs):
        calls.append(kwargs.get("no_merge_devices"))
        return plot(*args, **kwargs)

    monkeypatch.setattr(perf_report, "plot_stacked_report", _counting_plot)
    return calls


@pytest.fixture(autouse=True)
def _close_stray_figures():
    yield
    plt.close("all")


def test_repeated_generations_leave_no_figure_open(monkeypatch):
    raw_csv = _smoke_csv()
    plots = _count_plots(monkeypatch)
    open_before = plt.get_fignums()

    # Merged and per-device runs open their figure through different pyplot calls.
    for generation in range(_GENERATIONS):
        OpsPerformanceReportQueries._generate_report_uncached(
            raw_csv,
            _options(
                merge_devices=generation % 2 == 0,
                hide_host_ops=generation % 3 == 0,
            ),
        )

    assert plt.get_fignums() == open_before
    assert len(plots) == _GENERATIONS
    assert set(plots) == {True, False}


def test_a_failed_generation_closes_the_figure_it_opened(monkeypatch):
    raw_csv = _smoke_csv()

    def _plot_then_fail(*args, **kwargs):
        plt.figure()
        raise RuntimeError("plot failed")

    monkeypatch.setattr(perf_report, "plot_stacked_report", _plot_then_fail)
    open_before = plt.get_fignums()

    with pytest.raises(DataFormatError, match="plot failed"):
        OpsPerformanceReportQueries._generate_report_uncached(raw_csv, _options())

    assert plt.get_fignums() == open_before


def test_figures_open_before_generation_stay_open(monkeypatch):
    raw_csv = _smoke_csv()
    plots = _count_plots(monkeypatch)
    existing = plt.figure().number

    OpsPerformanceReportQueries._generate_report_uncached(raw_csv, _options())

    assert plots
    assert plt.get_fignums() == [existing]


def test_server_draws_with_the_agg_backend():
    assert matplotlib.get_backend().lower() == "agg"
