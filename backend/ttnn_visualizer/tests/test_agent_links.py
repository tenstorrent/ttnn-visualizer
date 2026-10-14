# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Links from an agent tool's answer into the web application: `agent/links.py`. #2047

A link must land on the report the agent read. So it carries the report's
directories, and it is withheld wherever the app would open something else under
the same id: another rank, or a report with no operations to open.
"""

import logging

import pytest
from ttnn_visualizer.agent import linking, operations, server
from ttnn_visualizer.agent.handles import ReportRegistry
from ttnn_visualizer.agent.links import (
    APP_URL_ENV_VAR,
    DEFAULT_APP_URL,
    InvalidAppUrlError,
    checked_app_url,
    with_linked_rows_link_template,
    with_operation_link,
    with_operation_link_template,
    with_report_link,
)
from ttnn_visualizer.tests.test_agent_linking import _write_profiler

# A space, to show the query is encoded while its slashes stay readable.
PROFILER = "/reports/bge m3"
PERFORMANCE = "/reports/perf"
REPORT_QUERY = "profiler_path=/reports/bge%20m3&performance_path=/reports/perf"


@pytest.fixture(autouse=True)
def _no_configured_app_url(monkeypatch):
    monkeypatch.delenv(APP_URL_ENV_VAR, raising=False)


def _registry(profiler=PROFILER, performance=PERFORMANCE, app_url=None):
    registry = ReportRegistry()
    return registry, registry.add(profiler, performance, app_url=app_url)


def _link(registry, handle, rank=None):
    return with_operation_link(registry, handle, {"operation_id": 3, "rank": rank})


class TestAppUrl:
    @pytest.mark.parametrize(
        ("url", "expected"),
        [
            ("http://localhost:8001/", "http://localhost:8001"),
            ("https://host.example/visualizer/", "https://host.example/visualizer"),
        ],
    )
    def test_an_http_url_is_taken_without_its_trailing_slash(self, url, expected):
        assert checked_app_url(url) == expected

    @pytest.mark.parametrize(
        "url",
        [
            "javascript:alert(1)",
            "file:///etc/passwd",
            "localhost:8000",
            "http://",
            "http://localhost:8000/?instanceId=x",
            "http://localhost:8000/#top",
        ],
    )
    def test_anything_else_is_refused(self, url):
        with pytest.raises(InvalidAppUrlError):
            checked_app_url(url)

    def test_links_go_to_the_default_app_when_nothing_says_otherwise(self):
        registry, handle = _registry()

        assert _link(registry, handle)["link"].startswith(f"{DEFAULT_APP_URL}/")

    def test_the_environment_moves_every_link(self, monkeypatch):
        monkeypatch.setenv(APP_URL_ENV_VAR, "http://localhost:8001/")
        registry, handle = _registry()

        assert _link(registry, handle)["link"].startswith("http://localhost:8001/")

    def test_a_handle_loaded_with_an_app_url_overrides_the_environment(
        self, monkeypatch
    ):
        monkeypatch.setenv(APP_URL_ENV_VAR, "http://localhost:8001")
        registry, handle = _registry(app_url="http://localhost:5173")

        assert _link(registry, handle)["link"].startswith("http://localhost:5173/")

    def test_a_bad_configured_url_gives_no_link_rather_than_the_default(
        self, monkeypatch, caplog
    ):
        """The default is not the app the configuration names."""
        monkeypatch.setenv(APP_URL_ENV_VAR, "localhost:8001")
        registry, handle = _registry()

        with caplog.at_level(logging.WARNING):
            assert "link" not in _link(registry, handle)
        assert APP_URL_ENV_VAR in caplog.text


class TestReportLink:
    def test_it_opens_the_reports_operations_with_both_directories(self):
        registry, handle = _registry()

        result = with_report_link(registry, {"handle": handle})

        assert result["link"] == f"{DEFAULT_APP_URL}/operations?{REPORT_QUERY}"

    def test_a_performance_report_alone_opens_the_performance_view(self):
        registry, handle = _registry(profiler=None)

        result = with_report_link(registry, {"handle": handle})

        assert result["link"] == (
            f"{DEFAULT_APP_URL}/performance?performance_path=/reports/perf"
        )

    def test_load_report_takes_and_checks_the_app_url(self, tmp_path):
        registry = ReportRegistry()
        handler = server._tool_table(registry)["load_report"]["handler"]
        profiler = _write_profiler(tmp_path / "profiler", {})

        result = handler(
            {"profiler_path": profiler, "app_url": "http://localhost:5173/"}
        )

        assert result["link"] == (
            f"http://localhost:5173/operations?profiler_path={profiler}"
        )
        with pytest.raises(InvalidAppUrlError):
            handler({"profiler_path": profiler, "app_url": "javascript:alert(1)"})


class TestOperationLinks:
    @pytest.mark.parametrize("rank", [None, 0])
    def test_an_operation_at_the_rank_the_app_shows_gets_a_link(self, rank):
        registry, handle = _registry()

        assert _link(registry, handle, rank)["link"] == (
            f"{DEFAULT_APP_URL}/operations/3?{REPORT_QUERY}"
        )

    def test_an_operation_at_another_rank_gets_none(self):
        """The app reads rank 0, so it would open rank 0's operation 3 instead."""
        registry, handle = _registry()

        assert "link" not in _link(registry, handle, rank=1)

    def test_a_handle_without_a_profiler_report_has_no_operation_to_open(self):
        registry, handle = _registry(profiler=None)

        assert "link" not in _link(registry, handle)

    def test_a_list_gets_one_template_to_fill_with_an_operation_id(self):
        registry, handle = _registry()

        result = with_operation_link_template(registry, handle, {"rank": None})

        assert result["link_template"] == (
            f"{DEFAULT_APP_URL}/operations/{{operation_id}}?{REPORT_QUERY}"
        )

    @pytest.mark.parametrize(
        ("status", "has_template"),
        [("linked", True), ("unlinked", False), ("unavailable", False)],
    )
    def test_top_ops_gets_a_template_only_when_its_rows_carry_ids(
        self, status, has_template
    ):
        registry, handle = _registry()

        result = with_linked_rows_link_template(
            registry, handle, {"operation_link": {"status": status}}
        )

        assert ("link_template" in result) is has_template


class TestToolsCarryLinks:
    """Reverting any handler to its bare tool must fail something."""

    @pytest.mark.parametrize(
        ("tool", "module", "key"),
        [
            ("operation_detail", linking, "link"),
            ("operation_provenance", operations, "link"),
            ("find_operations", operations, "link_template"),
            ("memory_profile", operations, "link_template"),
            ("tensor_flow", operations, "link_template"),
            ("top_ops", linking, "link_template"),
        ],
    )
    def test_each_tool_answers_with_its_link(self, monkeypatch, tool, module, key):
        registry, handle = _registry()
        monkeypatch.setattr(
            module,
            tool,
            lambda registry, **arguments: {
                "operation_id": 3,
                "rank": None,
                "operation_link": {"status": "linked"},
            },
        )

        result = server._tool_table(registry)[tool]["handler"]({"handle": handle})

        assert key in result
