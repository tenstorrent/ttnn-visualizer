# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Links from an agent tool's answer into the web application. #2047

A link must land on the report the agent read. So it carries the report's
directories, names only what the app would open, and is withheld wherever the app
would open something else under the same id: another rank, or an answer that does
not say its rank.
"""

import json
import logging

import pytest
from ttnn_visualizer.agent import linking, operations, server
from ttnn_visualizer.agent.app_links import (
    with_linked_rows_link_template,
    with_operation_link,
    with_operation_link_template,
    with_report_link,
)
from ttnn_visualizer.agent.app_url import (
    APP_URL_ENV_VAR,
    DEFAULT_APP_URL,
    InvalidAppUrlError,
    checked_app_url,
)
from ttnn_visualizer.agent.handles import ReportRegistry
from ttnn_visualizer.tests.test_agent_linking import (
    _GRAPHS,
    _write_profiler,
    _write_ranked_profiler,
)


@pytest.fixture(autouse=True)
def _no_configured_app_url(monkeypatch):
    monkeypatch.delenv(APP_URL_ENV_VAR, raising=False)


@pytest.fixture
def reports(tmp_path):
    """A memory and a performance report the app could open; a space in the name, to
    show the query is encoded while its slashes stay readable."""
    profiler = tmp_path / "bge m3"
    profiler.mkdir()
    (profiler / "db.sqlite").touch()
    performance = tmp_path / "perf"
    performance.mkdir()
    (performance / "profile_log_device.csv").touch()
    (performance / "ops_perf_results_2026.csv").touch()
    query = (
        f"profiler_path={str(profiler).replace(' ', '%20')}"
        f"&performance_path={performance}"
    )
    return str(profiler), str(performance), query


def _registry(profiler, performance, app_url=None):
    registry = ReportRegistry()
    return registry, registry.add(profiler, performance, app_url=app_url)


def _answer(handle, rank=None, **extra):
    return {"handle": handle, "operation_id": 3, "rank": rank, **extra}


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
            "http://:8000",
            "http://localhost:8000/?instanceId=x",
            "http://localhost:8000/#top",
            # Empty, yet either would still end the path: links would carry no report.
            "http://localhost:8000/?",
            "http://localhost:8000#",
            8000,
        ],
    )
    def test_anything_else_is_refused(self, url):
        with pytest.raises(InvalidAppUrlError):
            checked_app_url(url)

    @pytest.mark.parametrize(
        "url", ["http://localhost:5173", "http://127.0.0.1:8000", "http://[::1]:8000"]
    )
    def test_an_agent_may_name_this_machine(self, url):
        assert checked_app_url(url, loopback_only=True) == url

    def test_an_agent_may_not_send_local_paths_to_another_host(self):
        """A link carries absolute paths, and an agent can be steered by what it reads."""
        with pytest.raises(InvalidAppUrlError, match=APP_URL_ENV_VAR):
            checked_app_url("https://evil.example", loopback_only=True)

    def test_links_go_to_the_default_app_when_nothing_says_otherwise(self, reports):
        registry, handle = _registry(*reports[:2])

        link = with_operation_link(registry, _answer(handle))["app_link"]

        assert link.startswith(f"{DEFAULT_APP_URL}/")

    def test_the_environment_moves_every_link_to_any_host(self, monkeypatch, reports):
        monkeypatch.setenv(APP_URL_ENV_VAR, "https://lab.example/visualizer/")
        registry, handle = _registry(*reports[:2])

        link = with_operation_link(registry, _answer(handle))["app_link"]

        assert link.startswith("https://lab.example/visualizer/operations/3?")

    def test_a_handle_loaded_with_an_app_url_overrides_the_environment(
        self, monkeypatch, reports
    ):
        monkeypatch.setenv(APP_URL_ENV_VAR, "http://localhost:8001")
        registry, handle = _registry(*reports[:2], app_url="http://localhost:5173")

        link = with_operation_link(registry, _answer(handle))["app_link"]

        assert link.startswith("http://localhost:5173/")

    def test_a_bad_configured_url_gives_no_link_rather_than_the_default(
        self, monkeypatch, reports, caplog
    ):
        """The default is not the app the configuration names."""
        monkeypatch.setenv(APP_URL_ENV_VAR, "localhost:8001")
        registry, handle = _registry(*reports[:2])

        with caplog.at_level(logging.WARNING):
            assert "app_link" not in with_operation_link(registry, _answer(handle))
        assert APP_URL_ENV_VAR in caplog.text


class TestReportLink:
    def test_it_opens_the_reports_operations_with_both_directories(self, reports):
        profiler, performance, query = reports
        registry, handle = _registry(profiler, performance)

        result = with_report_link(registry, {"handle": handle})

        assert result["app_link"] == f"{DEFAULT_APP_URL}/operations?{query}"

    def test_a_performance_report_alone_opens_the_performance_view(self, reports):
        _, performance, _ = reports
        registry, handle = _registry(None, performance)

        result = with_report_link(registry, {"handle": handle})

        assert result["app_link"] == (
            f"{DEFAULT_APP_URL}/performance?performance_path={performance}"
        )

    def test_a_half_the_app_cannot_open_is_left_out_rather_than_sinking_the_link(
        self, reports, tmp_path
    ):
        """The app refuses a whole link for either half it cannot load."""
        _, performance, _ = reports
        no_database = tmp_path / "no-database"
        no_database.mkdir()
        registry, handle = _registry(str(no_database), performance)

        result = with_report_link(registry, {"handle": handle})

        assert result["app_link"] == (
            f"{DEFAULT_APP_URL}/performance?performance_path={performance}"
        )

    def test_nothing_the_app_could_open_gets_no_link(self, tmp_path):
        registry, handle = _registry(str(tmp_path), str(tmp_path))

        assert "app_link" not in with_report_link(registry, {"handle": handle})

    def test_load_report_takes_and_checks_the_app_url(self, tmp_path):
        registry = ReportRegistry()
        handler = server._tool_table(registry)["load_report"]["handler"]
        profiler = _write_profiler(tmp_path / "profiler", {})

        result = handler(
            {"profiler_path": profiler, "app_url": "http://localhost:5173/"}
        )

        assert result["app_link"] == (
            f"http://localhost:5173/operations?profiler_path={profiler}"
        )
        with pytest.raises(InvalidAppUrlError):
            handler({"profiler_path": profiler, "app_url": "https://evil.example"})


class TestOperationLinks:
    @pytest.mark.parametrize("rank", [None, 0])
    def test_an_operation_at_the_rank_the_app_shows_gets_a_link(self, reports, rank):
        registry, handle = _registry(*reports[:2])

        result = with_operation_link(registry, _answer(handle, rank))

        assert result["app_link"] == f"{DEFAULT_APP_URL}/operations/3?{reports[2]}"

    @pytest.mark.parametrize(
        "wrap", [with_operation_link, with_operation_link_template]
    )
    def test_an_answer_at_another_rank_gets_none(self, reports, wrap):
        """The app reads rank 0, so it would open rank 0's operation instead."""
        registry, handle = _registry(*reports[:2])

        result = wrap(registry, _answer(handle, rank=1))

        assert "app_link" not in result and "app_link_template" not in result

    @pytest.mark.parametrize(
        "wrap", [with_operation_link, with_operation_link_template]
    )
    def test_an_answer_that_does_not_say_its_rank_gets_none(self, reports, wrap):
        registry, handle = _registry(*reports[:2])
        answer = _answer(handle)
        del answer["rank"]

        result = wrap(registry, answer)

        assert "app_link" not in result and "app_link_template" not in result

    def test_a_handle_without_a_memory_report_has_no_operation_to_open(self, reports):
        registry, handle = _registry(None, reports[1])

        assert "app_link" not in with_operation_link(registry, _answer(handle))

    def test_a_list_gets_one_template_to_fill_with_an_operation_id(self, reports):
        registry, handle = _registry(*reports[:2])

        result = with_operation_link_template(registry, _answer(handle))

        assert result["app_link_template"] == (
            f"{DEFAULT_APP_URL}/operations/{{operation_id}}?{reports[2]}"
        )

    @pytest.mark.parametrize(
        ("operation_link", "has_template"),
        [
            ({"status": "linked", "rank": 0}, True),
            ({"status": "linked", "rank": None}, True),
            ({"status": "linked", "rank": 1}, False),
            ({"status": "unlinked"}, False),
            ({"status": "unavailable"}, False),
        ],
    )
    def test_top_ops_gets_a_template_only_when_its_rows_carry_ids_the_app_shows(
        self, reports, operation_link, has_template
    ):
        registry, handle = _registry(*reports[:2])

        result = with_linked_rows_link_template(
            registry, {"handle": handle, "operation_link": operation_link}
        )

        assert ("app_link_template" in result) is has_template


class TestToolsCarryLinks:
    """Reverting any handler to its bare tool must fail something."""

    @pytest.mark.parametrize(
        ("tool", "module", "key"),
        [
            ("operation_detail", linking, "app_link"),
            ("operation_provenance", operations, "app_link"),
            ("find_operations", operations, "app_link_template"),
            ("memory_profile", operations, "app_link_template"),
            ("tensor_flow", operations, "app_link_template"),
            ("top_ops", linking, "app_link_template"),
        ],
    )
    def test_each_tool_answers_with_its_link(
        self, monkeypatch, reports, tool, module, key
    ):
        registry, handle = _registry(*reports[:2])
        monkeypatch.setattr(
            module,
            tool,
            lambda registry, **arguments: _answer(
                handle, operation_link={"status": "linked", "rank": 0}
            ),
        )

        result = server._tool_table(registry)[tool]["handler"]({"handle": handle})

        assert key in result

    def test_find_operations_at_another_rank_carries_no_template(self, tmp_path):
        """End to end, so a tool that stopped saying its rank would show up here."""
        registry = ReportRegistry()
        table = server._tool_table(registry)
        profiler = _write_ranked_profiler(tmp_path / "ranked", _GRAPHS)
        handle = table["load_report"]["handler"]({"profiler_path": profiler})["handle"]
        find = table["find_operations"]["handler"]

        rank_zero = find({"handle": handle, "name_contains": "ttnn", "rank": 0})
        rank_one = find({"handle": handle, "name_contains": "ttnn", "rank": 1})

        assert "app_link_template" in rank_zero
        assert "app_link_template" not in rank_one

    @pytest.mark.parametrize(
        "tool",
        [
            "operation_detail",
            "operation_provenance",
            "find_operations",
            "memory_profile",
            "tensor_flow",
            "top_ops",
        ],
    )
    def test_a_call_without_a_handle_is_still_refused(self, event_log_directory, tool):
        """The wrapper must not read the handle before the tool reports it missing."""
        response = server.handle_message(
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {"name": tool, "arguments": {}},
            },
            server._tool_table(ReportRegistry()),
        )

        text = json.loads(json.dumps(response))["result"]["content"][0]["text"]
        assert text.startswith(f"bad arguments for {tool}")
