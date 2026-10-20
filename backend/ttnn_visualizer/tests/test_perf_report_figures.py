# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Report generation must not leave tt-perf-report's stacked-report figure alive (#2135).

These call `_generate_report_uncached` directly, below the report cache, so every
call really generates.
"""

import gc
import os
import subprocess
import sys

import matplotlib.pyplot as plt
import pytest
from matplotlib.figure import Figure
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
        detail_columns=queries.DEFAULT_DETAIL_COLUMNS,
    )
    return _PerformanceReportOptions(**{**defaults, **overrides})


def _smoke_csv() -> str:
    smoke_rows()  # skips when the capture is absent
    return SMOKE_CAPTURE.read_text()


def _count_plots(monkeypatch) -> list:
    """Record each stacked-report plot call, so a test can't pass by never reaching one.

    Each entry is `(no_merge_devices, HAS_MATPLOTLIB)`, the flag as the real plot
    sees it, so a rename upstream that brings the render back fails here.
    """
    calls = []
    plot = perf_report.plot_stacked_report

    def _counting_plot(*args, **kwargs):
        calls.append((kwargs.get("no_merge_devices"), perf_report.HAS_MATPLOTLIB))
        return plot(*args, **kwargs)

    monkeypatch.setattr(perf_report, "plot_stacked_report", _counting_plot)
    return calls


@pytest.fixture(autouse=True)
def _close_stray_figures():
    yield
    plt.close("all")


def _live_figures() -> int:
    return sum(isinstance(obj, Figure) for obj in gc.get_objects())


def test_repeated_generations_leave_no_figure_open(monkeypatch):
    raw_csv = _smoke_csv()
    plots = _count_plots(monkeypatch)
    open_before = plt.get_fignums()
    has_matplotlib = perf_report.HAS_MATPLOTLIB

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
    assert {no_merge for no_merge, _ in plots} == {True, False}
    assert not any(drawn for _, drawn in plots)
    assert perf_report.HAS_MATPLOTLIB == has_matplotlib


def test_repeated_generations_leave_no_figure_alive(monkeypatch):
    """A closed figure lives on in a reference cycle, so closing alone isn't enough."""
    raw_csv = _smoke_csv()
    plots = _count_plots(monkeypatch)
    gc.collect()
    live_before = _live_figures()
    gc.disable()  # so a collection mid-test can't hide a figure that was drawn
    try:
        for generation in range(_GENERATIONS):
            OpsPerformanceReportQueries._generate_report_uncached(
                raw_csv, _options(merge_devices=generation % 2 == 0)
            )
        live_after = _live_figures()
    finally:
        gc.enable()

    assert len(plots) == _GENERATIONS
    assert live_after <= live_before


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
    plots = []

    def _plot(*args, **kwargs):
        plots.append(plt.figure().number)

    monkeypatch.setattr(perf_report, "plot_stacked_report", _plot)
    existing = plt.figure().number

    OpsPerformanceReportQueries._generate_report_uncached(raw_csv, _options())

    assert plots
    assert plt.get_fignums() == [existing]


def test_server_pins_the_agg_backend_over_mplbackend():
    # svg is a non-GUI backend that always imports, so without the pin it would win
    # even on a headless runner, where matplotlib falls back to Agg on its own.
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "import matplotlib, ttnn_visualizer.csv_queries;"
            " print(matplotlib.get_backend())",
        ],
        env={**os.environ, "MPLBACKEND": "svg"},
        capture_output=True,
        text=True,
        check=True,
    )

    assert result.stdout.strip().splitlines()[-1].lower() == "agg"
