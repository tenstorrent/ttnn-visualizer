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
from urllib.parse import parse_qs, urlsplit

import pytest
from ttnn_visualizer.agent import app_links, failures, linking, operations, server
from ttnn_visualizer.agent.app_links import (
    APP_URL_ENV_VAR,
    DEFAULT_APP_URL,
    InvalidAppUrlError,
    checked_app_url,
    with_linked_rows_link_template,
    with_operation_link,
    with_operation_link_template,
    with_report_link,
)
from ttnn_visualizer.agent.handles import ReportRegistry
from ttnn_visualizer.tests.test_agent_linking import _write_profiler
from ttnn_visualizer.tests.test_agent_operations import (
    _RANKED_REPORT_SQL,
    _write_report,
)

# Every character `quote` and `URLSearchParams` could disagree on. Its encoding is
# what `tests/openReportFromLink.spec.ts` reads back, so the two must change together.
AWKWARD_NAME = "a+b&c#d%e é"
AWKWARD_NAME_ENCODED = "a%2Bb%26c%23d%25e%20%C3%A9"

# One tensor and one argument on each rank under the same ids, for `tensor_flow` and
# `operation_provenance`.
_RANKED_TENSORS_SQL = """
CREATE TABLE operation_arguments (
    operation_id int, name text, value text, rank int NOT NULL DEFAULT 0
);
INSERT INTO operation_arguments VALUES (1, 'dim', '0', 0), (1, 'dim', '1', 1);
INSERT INTO tensors (
    tensor_id, shape, dtype, layout, memory_config, device_id, address, buffer_type,
    size, rank
) VALUES (1, 'Shape([1])', 'BFLOAT16', 'TILE', '', 0, 100, 'L1', 2, 0),
         (1, 'Shape([1])', 'BFLOAT16', 'TILE', '', 0, 100, 'L1', 2, 1);
INSERT INTO output_tensors VALUES (1, 0, 1, 0), (1, 0, 1, 1);
"""


@pytest.fixture(autouse=True)
def _no_configured_app_url(monkeypatch):
    monkeypatch.delenv(APP_URL_ENV_VAR, raising=False)
    app_links._checked_configured_url.cache_clear()


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


def _registry(profiler, performance):
    registry = ReportRegistry()
    return registry, registry.add(profiler, performance)


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
            "http://[::1",
            "http://localhost:99999",
            8000,
        ],
    )
    def test_anything_else_is_refused(self, url):
        with pytest.raises(InvalidAppUrlError):
            checked_app_url(url)

    @pytest.mark.parametrize(
        "url",
        [
            # Python reads the host as localhost; a browser reads `\\` as `/`.
            "http://evil.example\\@localhost",
            "http://evil.example\\\uff20localhost",
            "http://user@localhost:8000",
            "http://local host:8000",
            "http://localhost:8000\x00",
        ],
    )
    def test_a_url_python_and_a_browser_would_read_apart_is_refused(self, url):
        with pytest.raises(InvalidAppUrlError):
            checked_app_url(url)

    def test_links_go_to_the_default_app_when_nothing_says_otherwise(self, reports):
        registry, handle = _registry(*reports[:2])

        link = with_operation_link(registry, _answer(handle))["app_link"]

        assert link.startswith(f"{DEFAULT_APP_URL}/")

    def test_the_environment_moves_every_link_to_any_host(self, monkeypatch, reports):
        monkeypatch.setenv(APP_URL_ENV_VAR, "https://lab.example/visualizer/")
        registry, handle = _registry(*reports[:2])

        link = with_operation_link(registry, _answer(handle))["app_link"]

        assert link.startswith("https://lab.example/visualizer/operations/3?")

    def test_a_bad_configured_url_gives_no_link_rather_than_the_default(
        self, monkeypatch, reports, caplog
    ):
        """The default is not the app the configuration names."""
        monkeypatch.setenv(APP_URL_ENV_VAR, "localhost:8001")
        registry, handle = _registry(*reports[:2])

        with caplog.at_level(logging.WARNING):
            assert "app_link" not in with_operation_link(registry, _answer(handle))
            assert "app_link" not in with_operation_link(registry, _answer(handle))
        # Once, not once per answer.
        assert [r.getMessage() for r in caplog.records].count(
            caplog.records[0].getMessage()
        ) == 1
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

    def test_an_awkward_path_comes_back_out_of_the_query_unchanged(self, tmp_path):
        profiler = tmp_path / AWKWARD_NAME
        profiler.mkdir()
        (profiler / "db.sqlite").touch()
        registry, handle = _registry(str(profiler), None)

        query = urlsplit(
            with_report_link(registry, {"handle": handle})["app_link"]
        ).query

        assert query.endswith(f"/{AWKWARD_NAME_ENCODED}")
        assert parse_qs(query)["profiler_path"] == [str(profiler)]

    def test_nothing_the_app_could_open_gets_no_link(self, tmp_path):
        registry, handle = _registry(str(tmp_path), str(tmp_path))

        assert "app_link" not in with_report_link(registry, {"handle": handle})

    def test_load_report_answers_with_a_link_to_the_report(self, monkeypatch, tmp_path):
        monkeypatch.setenv(APP_URL_ENV_VAR, "http://localhost:5173/")
        registry = ReportRegistry()
        handler = server._tool_table(registry)["load_report"]["handler"]
        profiler = _write_profiler(tmp_path / "profiler", {})

        result = handler({"profiler_path": profiler})

        assert result["app_link"] == (
            f"http://localhost:5173/operations?profiler_path={profiler}"
        )


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
            ("program_cache", linking, "app_link_template"),
            ("errors", failures, "app_link_template"),
            ("dram_fallbacks", failures, "app_link_template"),
            ("l1_peak", failures, "app_link_template"),
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

    @pytest.mark.parametrize(
        "tool",
        [
            "operation_detail",
            "operation_provenance",
            "find_operations",
            "memory_profile",
            "tensor_flow",
            "top_ops",
            "program_cache",
            "errors",
            "dram_fallbacks",
            "l1_peak",
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


class TestRankGatingOnRealAnswers:
    """Each tool's own answer must state its rank; one that stopped would either lose
    its link or link rank 1's id to rank 0's operation, and the faked answers above
    would not notice."""

    @pytest.fixture
    def ranked(self, tmp_path):
        path = _write_report(
            tmp_path / "ranked", _RANKED_REPORT_SQL + _RANKED_TENSORS_SQL
        )
        registry = ReportRegistry()
        table = server._tool_table(registry)
        handle = table["load_report"]["handler"]({"profiler_path": path})["handle"]
        return table, handle

    @pytest.mark.parametrize(
        ("tool", "arguments", "key"),
        [
            ("find_operations", {}, "app_link_template"),
            ("memory_profile", {}, "app_link_template"),
            ("tensor_flow", {"tensor_id": 1}, "app_link_template"),
            ("operation_detail", {"operation_id": 1}, "app_link"),
            ("operation_provenance", {"operation_id": 1}, "app_link"),
            ("errors", {}, "app_link_template"),
            ("dram_fallbacks", {}, "app_link_template"),
            ("l1_peak", {}, "app_link_template"),
        ],
    )
    def test_a_link_at_rank_0_and_none_at_rank_1(self, ranked, tool, arguments, key):
        table, handle = ranked
        handler = table[tool]["handler"]

        assert key in handler({"handle": handle, **arguments, "rank": 0})
        assert key not in handler({"handle": handle, **arguments, "rank": 1})
