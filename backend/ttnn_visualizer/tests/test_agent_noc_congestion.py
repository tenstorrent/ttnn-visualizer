# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""`noc_congestion`: how congested a tt-npe trace's NoC links were. #2156

Every trace here is synthetic, written in `tmp_path` as tt-npe lays one out: per
timestep a `link_demand` list of `[device, y, x, link, demand]` rows. The tool reads
the app's index of a trace when that is current and the trace itself otherwise, so the
parity tests answer one trace both ways.
"""

import gc
import json
import logging
import math
import os
import sqlite3
import time
import weakref
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import orjson
import pytest
import zstd
from ttnn_visualizer import npe_index
from ttnn_visualizer.agent import noc_congestion, server
from ttnn_visualizer.agent.app_links import APP_URL_ENV_VAR
from ttnn_visualizer.agent.bounds import DEFAULT_LIMIT, MAX_LIMIT
from ttnn_visualizer.agent.handles import ReportRegistry, load_report
from ttnn_visualizer.agent.tool_names import McpToolName
from ttnn_visualizer.event_logging import McpToolOutcome
from ttnn_visualizer.tests.mcp_calls import tool_call
from ttnn_visualizer.tests.npe_fixtures import execute, listing
from ttnn_visualizer.tests.test_agent_core_spread import THREE_CORES
from ttnn_visualizer.tests.test_agent_perf_detail import ANSWER_BUDGET_BYTES
from ttnn_visualizer.tests.test_device_log_columns import (
    MODERN_HEADER,
    write_device_log,
)

A = (0, 0, 0, "NOC0_EAST")
B = (0, 0, 1, "NOC0_EAST")
C = (0, 1, 0, "NOC1_WEST")

COMMON_INFO = {
    "version": "1.0.0",
    "arch": "wormhole_b0",
    "device_name": "n300",
    "congestion_model_name": "fast",
    "cycles_per_timestep": 10,
    "link_demand": 12.3456,
    "link_util": 7.891,
    "max_link_demand": 28.5,
    "dram_bw_util": 40.25,
    "noc": {
        "NOC0": {
            "avg_link_demand": 15.5,
            "avg_link_util": 9.25,
            "max_link_demand": 30.0,
        },
        "NOC1": {
            "avg_link_demand": 9.125,
            "avg_link_util": 6.5,
            "max_link_demand": 27.0,
        },
    },
}

ROWS_CAVEAT = (
    "{} link demand entries were not a link's coordinates, a name of at most 32 "
    "bytes and a non-negative number, and were left out."
)
TIMESTEPS_CAVEAT = (
    "{} timesteps were not a timestep's object or held no list of link demand, and "
    "count as idle."
)
CHANGED_CAVEAT = (
    "trace.json has changed or gone since this handle read it, and this is that read; "
    "call load_report again to read it as it is now."
)

# A zstd frame header alone: single segment, a four-byte content size of 3 GiB.
_THREE_GIB_FRAME_HEADER = (
    npe_index.ZSTD_MAGIC + b"\xa0" + (3 << 30).to_bytes(4, "little")
)


_SKIPPABLE_FRAME = (0x184D2A50).to_bytes(4, "little") + b"\x04\x00\x00\x00skip"


def _unsized_frame(content: bytes) -> bytes:
    """One raw block in a frame that declares no content size, as a stream writes."""
    block = (len(content) << 3 | 0x01).to_bytes(3, "little")
    return npe_index.ZSTD_MAGIC + b"\x00\x58" + block + content


def _step(t: int, *rows: object) -> dict:
    """Timestep `t`, ten cycles long."""
    return {"start_cycle": t * 10, "end_cycle": t * 10 + 9, "link_demand": list(rows)}


def _bare(t: int) -> dict:
    """Timestep `t` with no `link_demand` key at all."""
    return {"start_cycle": t * 10, "end_cycle": t * 10 + 9}


def _trace(*steps: object, common_info=COMMON_INFO, transfers=None) -> dict:
    return {
        "common_info": common_info,
        "noc_transfers": [{"id": 0}, {"id": 1}] if transfers is None else transfers,
        "timestep_data": list(steps),
    }


def _hand_checked() -> dict:
    """Three links over eight timesteps, with three bursts, worked by hand below."""
    return _trace(
        _step(0, [*A, 50.0], [*B, 20.0]),
        _step(1, [*A, 150.0], [*B, 120.0]),
        _step(2, [*A, 90.0], [*B, 200.0]),
        _step(3, [*A, 100.0]),
        _step(4, [*C, 200.0]),
        _bare(5),
        _step(6, [*B, 110.0], [*C, 110.0]),
        _step(7, [*A, 120.0]),
        transfers=[{"id": 0}, {"id": 1}, {"id": 1}, {"id": None}],
    )


def _fields(link: tuple) -> dict:
    device, y, x, name = link
    return {"device": device, "y": y, "x": x, "link": name}


def _link_of(row: dict) -> tuple:
    return row["device"], row["y"], row["x"], row["link"]


def _peak(demand: float, link: tuple, t: int) -> dict:
    return {
        "demand_percent": demand,
        "timestep": t,
        "start_cycle": t * 10,
        "end_cycle": t * 10 + 9,
        **_fields(link),
    }


def _write(directory: Path, trace: object, name: str = "trace.json") -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / name
    data = orjson.dumps(trace)
    path.write_bytes(zstd.compress(data) if path.suffix == ".zst" else data)
    return path


def _rewrite(path: Path, trace: object) -> None:
    path.write_bytes(orjson.dumps(trace))
    # Strictly later, so the rewrite cannot land in the first write's clock tick.
    later = time.time() + 10
    os.utime(path, (later, later))


def _load(registry: ReportRegistry, path: Path) -> str:
    return str(load_report(registry, npe_path=str(path))["handle"])


def _call(registry: ReportRegistry, handle: str, **arguments) -> dict:
    return noc_congestion.noc_congestion(registry, handle, **arguments)


def _answer(path: Path, **arguments) -> dict:
    registry = ReportRegistry()
    return _call(registry, _load(registry, path), **arguments)


def _answered(directory: Path, trace: object, **arguments) -> dict:
    return _answer(_write(directory, trace), **arguments)


def _without(answer: dict, *keys: str) -> dict:
    return {key: value for key, value in answer.items() if key not in keys}


def _counted_reads(monkeypatch) -> list:
    """The bytes of each trace parsed."""
    reads: list = []
    real_parse = npe_index.parse_trace

    def counting_parse(data, compressed):
        reads.append(data)
        return real_parse(data, compressed)

    monkeypatch.setattr(npe_index, "parse_trace", counting_parse)
    return reads


def _never_read(data, compressed):
    raise AssertionError("the trace was parsed, not its index")


def _memory_report(directory: Path) -> Path:
    """A memory report with one operation, enough for `find_operations`."""
    directory.mkdir(parents=True)
    connection = sqlite3.connect(directory / "db.sqlite")
    try:
        connection.executescript(
            "CREATE TABLE operations (operation_id int UNIQUE, name text, "
            "duration float); INSERT INTO operations VALUES (1, 'ttnn.add', 0.1);"
        )
    finally:
        connection.close()
    return directory


def _never_build(npe_path):
    raise AssertionError(f"an index was built for {npe_path}")


class TestAnswer:
    def test_it_names_the_trace_and_what_the_trace_says_of_itself(self, tmp_path):
        answer = _answered(tmp_path, _hand_checked())

        assert _without(
            answer,
            "run",
            "worst_link",
            "worst_link_ties",
            "congested_timesteps",
            "congested_percent",
            "burst_count",
            "bursts",
            "link_count",
            "busiest_links",
        ) == {
            "handle": "report-1",
            "npe_trace": "trace.json",
            "arch": "wormhole_b0",
            "device": "n300",
            "congestion_model": "fast",
            "cycles_per_timestep": 10,
            "timesteps": 8,
            "first_cycle": 0,
            "last_cycle": 79,
            # Ids 0 and 1: a repeated id is one transfer, and one without an id none.
            "transfers": 2,
            "note": noc_congestion.NOC_CONGESTION_NOTE,
        }

    def test_run_is_the_traces_own_summary(self, tmp_path):
        assert _answered(tmp_path, _hand_checked())["run"] == {
            "link_demand_percent": 12.346,
            "link_util_percent": 7.891,
            "highest_timestep_average_demand_percent": 28.5,
            "dram_bw_util_percent": 40.25,
            "by_noc": {
                "NOC0": {
                    "link_demand_percent": 15.5,
                    "link_util_percent": 9.25,
                    "highest_timestep_average_demand_percent": 30.0,
                },
                "NOC1": {
                    "link_demand_percent": 9.125,
                    "link_util_percent": 6.5,
                    "highest_timestep_average_demand_percent": 27.0,
                },
            },
        }

    @pytest.mark.parametrize("value", ["abc", None, True, [1.0]])
    def test_a_run_figure_that_is_not_a_number_reads_as_none(self, tmp_path, value):
        info = {**COMMON_INFO, "link_demand": value}

        run = _answered(tmp_path, _trace(_step(0), common_info=info))["run"]

        assert run["link_demand_percent"] is None

    def test_mcast_utilisation_is_given_where_the_trace_has_it(self, tmp_path):
        info = {**COMMON_INFO, "mcast_write_link_util": 3.5}

        run = _answered(tmp_path, _trace(_step(0), common_info=info))["run"]

        assert run["mcast_write_link_util_percent"] == 3.5

    @pytest.mark.parametrize("value", ["abc", None], ids=["text", "null"])
    def test_mcast_utilisation_is_left_out_where_the_trace_has_none(
        self, tmp_path, value
    ):
        absent = _answered(tmp_path / "absent", _trace(_step(0)))["run"]
        info = {**COMMON_INFO, "mcast_write_link_util": value}
        unreadable = _answered(tmp_path, _trace(_step(0), common_info=info))["run"]

        assert "mcast_write_link_util_percent" not in absent
        assert "mcast_write_link_util_percent" not in unreadable

    def test_by_noc_keeps_the_first_nocs_by_name_that_read_as_one(self, tmp_path):
        figures = {"avg_link_demand": 1.0, "avg_link_util": 1.0, "max_link_demand": 1.0}
        nocs = {f"NOC{n}": figures for n in range(noc_congestion.MAX_NOCS, -1, -1)}
        nocs["A" * (noc_congestion.MAX_LINK_NAME_LENGTH + 1)] = figures
        nocs["AAA"] = 5
        info = {**COMMON_INFO, "noc": nocs}

        run = _answered(tmp_path, _trace(_step(0), common_info=info))["run"]

        assert list(run["by_noc"]) == [
            f"NOC{n}" for n in range(noc_congestion.MAX_NOCS)
        ]

    @pytest.mark.parametrize("nocs", [None, [], "NOC0"])
    def test_a_noc_summary_that_is_not_an_object_is_left_out(self, tmp_path, nocs):
        info = {**COMMON_INFO, "noc": nocs}

        run = _answered(tmp_path, _trace(_step(0), common_info=info))["run"]

        assert "by_noc" not in run

    def test_a_label_longer_than_any_tt_npe_writes_reads_as_none(self, tmp_path):
        longest = "x" * noc_congestion.MAX_LABEL_LENGTH
        info = {
            **COMMON_INFO,
            "arch": longest,
            "device_name": longest + "x",
            "congestion_model_name": 7,
        }

        answer = _answered(tmp_path, _trace(_step(0), common_info=info))

        assert answer["arch"] == longest
        assert answer["device"] is None
        assert answer["congestion_model"] is None

    def test_a_mesh_device_names_the_device_before_its_device_name(self, tmp_path):
        info = {**COMMON_INFO, "mesh_device": "T3K"}

        answer = _answered(tmp_path, _trace(_step(0), common_info=info))

        assert answer["device"] == "T3K"

    def test_worst_link_is_the_earliest_highest_demand_with_its_ties(self, tmp_path):
        answer = _answered(tmp_path, _hand_checked())

        assert answer["worst_link"] == _peak(200.0, B, 2)
        # B at timestep 2 and C at 4.
        assert answer["worst_link_ties"] == 2

    def test_a_timesteps_busiest_link_is_the_first_of_its_ties(self, tmp_path):
        answer = _answered(tmp_path, _trace(_step(0, [*C, 150.0], [*B, 150.0])))

        assert answer["worst_link"] == _peak(150.0, C, 0)
        assert answer["worst_link_ties"] == 2

    def test_congested_timesteps_are_those_whose_busiest_link_passed_100(
        self, tmp_path
    ):
        answer = _answered(tmp_path, _hand_checked())

        assert answer["congested_timesteps"] == 5
        assert answer["congested_percent"] == 62.5

    def test_bursts_are_runs_of_congested_timesteps_ranked_by_peak(self, tmp_path):
        answer = _answered(tmp_path, _hand_checked())

        assert answer["burst_count"] == 3
        assert answer["bursts"] == [
            {
                "start_cycle": 10,
                "end_cycle": 29,
                "timesteps": 2,
                "peak": _peak(200.0, B, 2),
            },
            {
                "start_cycle": 40,
                "end_cycle": 49,
                "timesteps": 1,
                "peak": _peak(200.0, C, 4),
            },
            {
                "start_cycle": 60,
                "end_cycle": 79,
                "timesteps": 2,
                "peak": _peak(120.0, A, 7),
            },
        ]

    def test_busiest_links_rank_by_mean_demand_over_every_timestep(self, tmp_path):
        answer = _answered(tmp_path, _hand_checked())

        assert answer["link_count"] == 3
        assert answer["busiest_links"] == [
            {
                **_fields(A),
                "mean_demand_percent": 63.75,
                "peak_demand_percent": 150.0,
                "congested_percent": 25.0,
            },
            {
                **_fields(B),
                "mean_demand_percent": 56.25,
                "peak_demand_percent": 200.0,
                "congested_percent": 37.5,
            },
            {
                **_fields(C),
                "mean_demand_percent": 38.75,
                "peak_demand_percent": 200.0,
                "congested_percent": 25.0,
            },
        ]

    def test_links_of_equal_mean_rank_by_peak_then_by_link(self, tmp_path):
        trace = _trace(
            _step(0, [*C, 50.0], [*B, 50.0], [*A, 100.0]),
            _step(1, [*C, 50.0], [*B, 50.0]),
        )

        links = _answered(tmp_path, trace)["busiest_links"]

        assert [_link_of(row) for row in links] == [A, B, C]

    def test_limit_slices_bursts_and_links_but_not_their_counts(self, tmp_path):
        answer = _answered(tmp_path, _hand_checked(), limit=1)

        assert answer["burst_count"] == answer["link_count"] == 3
        assert [burst["peak"]["timestep"] for burst in answer["bursts"]] == [2]
        assert [_link_of(row) for row in answer["busiest_links"]] == [A]

    def test_without_a_limit_bursts_and_links_stop_at_the_default(self, tmp_path):
        answer = _answered(tmp_path, _crowded_trace())

        assert answer["burst_count"] > DEFAULT_LIMIT
        assert answer["link_count"] > DEFAULT_LIMIT
        assert len(answer["bursts"]) == len(answer["busiest_links"]) == DEFAULT_LIMIT

    def test_a_trace_with_no_readable_rows_has_no_worst_link(self, tmp_path):
        answer = _answered(tmp_path, _trace(_step(0), _bare(1)))

        assert answer["worst_link"] is None
        assert answer["worst_link_ties"] == 0
        assert answer["congested_percent"] == 0.0
        assert answer["burst_count"] == answer["link_count"] == 0
        assert answer["bursts"] == answer["busiest_links"] == []
        assert "caveat" not in answer

    @pytest.mark.parametrize("name", ["trace.json", "trace.npeviz", "trace.npeviz.zst"])
    def test_each_trace_format_gives_the_same_answer(self, tmp_path, name):
        answer = _answer(_write(tmp_path, _hand_checked(), name))

        assert answer["npe_trace"] == name
        assert _without(answer, "npe_trace") == _without(
            _answered(tmp_path / "json", _hand_checked()), "npe_trace"
        )


class TestBursts:
    def test_exactly_100_percent_is_not_congestion(self, tmp_path):
        answer = _answered(tmp_path, _trace(_step(0, [*A, 100.0]), _step(1, [*A, 100])))

        assert answer["congested_timesteps"] == answer["burst_count"] == 0
        assert answer["busiest_links"][0]["congested_percent"] == 0.0
        assert answer["worst_link"]["demand_percent"] == 100.0
        assert answer["worst_link_ties"] == 2

    def test_a_demand_is_cut_to_three_decimals_as_the_index_stores_it(self, tmp_path):
        trace = _trace(_step(0, [*A, 100.0009]), _step(1, [*B, 150.0009]))

        answer = _answered(tmp_path, trace)

        assert answer["congested_timesteps"] == 1
        assert answer["worst_link"]["demand_percent"] == 150.0
        assert [row["peak_demand_percent"] for row in answer["busiest_links"]] == [
            150.0,
            100.0,
        ]

    @pytest.mark.parametrize(
        "between",
        [_step(1, [*A]), _step(1), _bare(1), _step(1, [*A, 40.0]), 7],
        ids=[
            "unreadable-row",
            "no-rows",
            "no-link-demand",
            "uncongested",
            "not-a-step",
        ],
    )
    def test_a_timestep_with_no_congested_link_ends_a_burst(self, tmp_path, between):
        trace = _trace(_step(0, [*A, 150.0]), between, _step(2, [*A, 150.0]))

        answer = _answered(tmp_path, trace)

        assert answer["burst_count"] == 2
        assert [burst["timesteps"] for burst in answer["bursts"]] == [1, 1]

    def test_a_burst_open_at_the_last_timestep_is_kept(self, tmp_path):
        trace = _trace(
            _step(0, [*A, 10.0]), _step(1, [*A, 150.0]), _step(2, [*B, 160.0])
        )

        assert _answered(tmp_path, trace)["bursts"] == [
            {
                "start_cycle": 10,
                "end_cycle": 29,
                "timesteps": 2,
                "peak": _peak(160.0, B, 2),
            }
        ]

    def test_bursts_rank_by_peak_then_length_then_start(self, tmp_path):
        trace = _trace(
            _step(0, [*A, 150.0]),
            _step(1),
            _step(2, [*A, 150.0]),
            _step(3, [*A, 120.0]),
            _step(4),
            _step(5, [*A, 150.0]),
            _step(6),
            _step(7, [*A, 300.0]),
        )

        bursts = _answered(tmp_path, trace)["bursts"]

        assert [
            (burst["peak"]["demand_percent"], burst["timesteps"], burst["start_cycle"])
            for burst in bursts
        ] == [(300.0, 1, 70), (150.0, 2, 20), (150.0, 1, 0), (150.0, 1, 50)]

    def test_a_bursts_peak_is_its_earliest_highest_demand(self, tmp_path):
        trace = _trace(
            _step(0, [*A, 150.0]), _step(1, [*B, 180.0]), _step(2, [*C, 180.0])
        )

        assert _answered(tmp_path, trace)["bursts"][0]["peak"] == _peak(180.0, B, 1)

    def test_a_timestep_without_a_cycle_leaves_the_bursts_span(self, tmp_path):
        trace = _trace(
            {**_step(0, [*A, 10.0]), "start_cycle": None},
            _step(1, [*A, 150.0]),
            {**_step(2, [*A, 150.0]), "end_cycle": None},
        )

        answer = _answered(tmp_path, trace)

        assert answer["first_cycle"] == 10
        assert answer["last_cycle"] == 19
        assert _without(answer["bursts"][0], "peak") == {
            "start_cycle": 10,
            "end_cycle": 19,
            "timesteps": 2,
        }


_GOOD = [*A, 50.0]


class TestMalformedInput:
    @pytest.mark.parametrize(
        "row",
        [
            pytest.param([*A], id="short"),
            pytest.param([], id="empty"),
            pytest.param({"device": 0, "link": "NOC0_EAST", "demand": 5.0}, id="dict"),
            pytest.param("0,0,0,NOC0_EAST,50.0", id="string"),
            pytest.param(None, id="null"),
            pytest.param(7, id="number"),
            pytest.param([0.5, 0, 0, "NOC0_EAST", 50.0], id="fractional-device"),
            pytest.param([0, "0", 0, "NOC0_EAST", 50.0], id="string-y"),
            pytest.param([0, 0, None, "NOC0_EAST", 50.0], id="null-x"),
            pytest.param([[0], 0, 0, "NOC0_EAST", 50.0], id="list-device"),
            pytest.param([0, 0, 0, 7, 50.0], id="numeric-link"),
            pytest.param([0, 0, 0, "N" * 33, 50.0], id="link-past-32"),
            pytest.param([*B, True], id="bool-demand"),
            pytest.param([*B, -1.0], id="negative-demand"),
            pytest.param([*B, -5], id="negative-int-demand"),
            pytest.param([*B, -0.001], id="negative-past-truncation"),
            pytest.param([*B, 1.7e308], id="demand-1.7e308"),
            pytest.param([*B, "50.0"], id="string-demand"),
            pytest.param([*B, None], id="null-demand"),
        ],
    )
    def test_a_row_that_is_not_a_links_demand_is_counted_and_left_out(
        self, tmp_path, row
    ):
        answer = _answered(tmp_path, _trace(_step(0, _GOOD, row)))
        clean = _answered(tmp_path / "clean", _trace(_step(0, _GOOD)))

        assert answer["caveat"] == ROWS_CAVEAT.format(1)
        assert _without(answer, "caveat") == clean

    @pytest.mark.parametrize(
        "demand", [math.nan, math.inf, -math.inf], ids=["nan", "inf", "-inf"]
    )
    def test_a_demand_json_cannot_hold_is_counted_and_left_out(
        self, tmp_path, monkeypatch, demand
    ):
        # orjson refuses NaN and infinities, so the parsed trace is handed over as is.
        trace = _trace(_step(0, _GOOD, [*B, demand]))
        path = _write(tmp_path, _trace(_step(0)))
        monkeypatch.setattr(npe_index, "parse_trace", lambda data, compressed: trace)

        answer = _answer(path)

        assert answer["link_count"] == 1
        assert answer["caveat"] == ROWS_CAVEAT.format(1)

    @pytest.mark.parametrize("device", [0.0, False])
    def test_a_coordinate_that_is_not_an_int_is_left_out_after_its_link_is_seen(
        self, tmp_path, device
    ):
        answer = _answered(
            tmp_path, _trace(_step(0, _GOOD, [device, 0, 0, "NOC0_EAST", 70.0]))
        )

        assert answer["busiest_links"][0]["peak_demand_percent"] == 50.0
        assert answer.get("caveat") == ROWS_CAVEAT.format(1)

    def test_whole_number_demands_are_read(self, tmp_path):
        answer = _answered(tmp_path, _trace(_step(0, [*A, 150]), _step(1, [*A, 0])))

        assert answer["worst_link"]["demand_percent"] == 150
        assert answer["burst_count"] == 1
        assert answer["busiest_links"] == [
            {
                **_fields(A),
                "mean_demand_percent": 75.0,
                "peak_demand_percent": 150,
                "congested_percent": 50.0,
            }
        ]
        assert "caveat" not in answer

    def test_a_link_name_as_long_as_tt_npe_writes_is_kept(self, tmp_path):
        name = "N" * noc_congestion.MAX_LINK_NAME_LENGTH

        answer = _answered(tmp_path, _trace(_step(0, [0, 0, 0, name, 50.0])))

        assert answer["busiest_links"][0]["link"] == name
        assert "caveat" not in answer

    def test_a_demand_just_below_zero_reads_as_zero_as_the_index_stores_it(
        self, tmp_path
    ):
        answer = _answered(tmp_path, _trace(_step(0, [*A, -0.0005])))

        assert answer["worst_link"]["demand_percent"] == 0.0
        assert answer["busiest_links"][0]["peak_demand_percent"] == 0.0
        assert "caveat" not in answer

    @pytest.mark.parametrize(
        "link_demand",
        ["NOC0_EAST", {"NOC0_EAST": 50.0}, 7, None],
        ids=["string", "dict", "number", "null"],
    )
    def test_a_timestep_whose_link_demand_is_not_a_list_counts_as_idle(
        self, tmp_path, link_demand
    ):
        trace = _trace(
            _step(0, [*A, 150.0]),
            {**_step(1), "link_demand": link_demand},
            _step(2, [*A, 150.0]),
        )

        answer = _answered(tmp_path, trace)

        assert answer["caveat"] == TIMESTEPS_CAVEAT.format(1)
        assert answer["timesteps"] == 3
        assert answer["burst_count"] == 2

    def test_timesteps_that_are_not_objects_count_as_idle(self, tmp_path):
        trace = _trace(
            _step(0, [*A, 150.0]), 7, None, "step", [], _step(5, [*A, 150.0])
        )

        answer = _answered(tmp_path, trace)

        assert answer["caveat"] == TIMESTEPS_CAVEAT.format(4)
        assert answer["timesteps"] == 6
        assert answer["burst_count"] == 2
        assert answer["busiest_links"][0]["mean_demand_percent"] == 50.0

    def test_the_caveat_counts_rows_then_timesteps(self, tmp_path):
        trace = _trace(
            _step(0, _GOOD, [*A], None), 7, {**_step(2), "link_demand": "NOC0_EAST"}
        )

        answer = _answered(tmp_path, trace)

        assert answer["caveat"] == " ".join(
            [ROWS_CAVEAT.format(2), TIMESTEPS_CAVEAT.format(2)]
        )

    @pytest.mark.parametrize(
        "cycle, read",
        [
            (2**63 - 1, 2**63 - 1),
            (-(2**63), -(2**63)),
            (2**63, None),
            (2**64 - 1, None),
            (1e20, None),
            (-1e20, None),
            (12.7, 12),
            ("12", 12),
            ("twelve", None),
        ],
    )
    def test_a_cycle_is_read_as_a_whole_number_within_int64(
        self, tmp_path, cycle, read
    ):
        trace = _trace(
            {**_step(0, [*A, 150.0]), "start_cycle": cycle, "end_cycle": cycle}
        )

        answer = _answered(tmp_path, trace)

        assert answer["first_cycle"] == answer["last_cycle"] == read
        assert answer["bursts"][0]["start_cycle"] == read
        assert answer["bursts"][0]["end_cycle"] == read
        assert answer["worst_link"]["start_cycle"] == read

    def test_links_past_the_limit_are_left_out_and_counted(self, tmp_path, monkeypatch):
        monkeypatch.setattr(noc_congestion, "MAX_LINKS", 2)
        trace = _trace(
            _step(0, [*A, 10.0], [*B, 20.0], [*C, 300.0]),
            _step(1, [*C, 5.0], [*A, 30.0]),
        )

        answer = _answered(tmp_path, trace)

        assert answer["link_count"] == 2
        assert [_link_of(row) for row in answer["busiest_links"]] == [A, B]
        assert answer["worst_link"]["demand_percent"] == 30.0
        assert answer["caveat"] == (
            "2 link demand entries were for links past the first 2 read, and were left "
            "out, so every figure but run, the trace's own summary, covers those links "
            "only."
        )


def _parity_trace() -> dict:
    """Every way the index stores a row or a timestep differently from the trace."""
    return _trace(
        _step(0, [*A, 100.0009], [*B, 150.0009], [*C, 0.0009]),
        {
            **_step(1, [*A, 120], [*B, 99.9999, None], [*C, 5.0, "LOCAL"]),
            "start_cycle": 10.5,
            "end_cycle": 19.7,
        },
        _bare(2),
        _step(
            3,
            [*A, 250.5555],
            [*B],
            "abc",
            {"a": 1},
            [*C, True],
            [0, 0, 0, "N" * 33, 5.0],
            [0, 0, 2, "NOC0_EAST", -0.0005],
            [*B, -1.0],
        ),
        {**_step(4), "link_demand": "NOC0_EAST"},
        {**_step(5, [*C, 101.0]), "start_cycle": -3.5},
        transfers=[{"id": 0}, {"id": 1}, {"id": 1}, {"id": 2.0}, {"id": None}],
    )


class TestIndexParity:
    @pytest.mark.parametrize("name", ["trace.json", "trace.npeviz", "trace.npeviz.zst"])
    def test_an_index_answers_as_the_trace_does(self, tmp_path, monkeypatch, name):
        path = _write(tmp_path, _parity_trace(), name)
        from_trace = _answer(path)
        npe_index.ensure_index(str(path))
        monkeypatch.setattr(npe_index, "parse_trace", _never_read)

        assert _answer(path) == from_trace
        assert from_trace["transfers"] == 3
        assert from_trace["link_count"] == 4
        assert from_trace["caveat"] == " ".join(
            [ROWS_CAVEAT.format(6), TIMESTEPS_CAVEAT.format(1)]
        )

    def test_a_stale_index_gives_way_to_the_trace(self, tmp_path, monkeypatch):
        path = _write(tmp_path, _parity_trace())
        npe_index.ensure_index(str(path))
        _rewrite(path, _hand_checked())
        reads = _counted_reads(monkeypatch)

        answer = _answer(path)

        assert reads == [path.read_bytes()]
        assert answer == _answered(tmp_path / "fresh", _hand_checked())

    def test_an_index_reads_a_boolean_cycle_as_the_trace_does(self, tmp_path):
        path = _write(tmp_path, _trace({**_step(0, [*A, 150.0]), "start_cycle": True}))
        from_trace = _answer(path)
        npe_index.ensure_index(str(path))

        assert _answer(path) == from_trace

    @pytest.mark.parametrize(
        "statement",
        [
            "UPDATE meta SET value = 'abc' WHERE key = 'index_version'",
            "UPDATE meta SET value = 'not json' WHERE key = 'common_info'",
            "DELETE FROM meta WHERE key = 'common_info'",
            "UPDATE timestep SET link_demand = 'not json' WHERE t = 3",
            "DROP TABLE transfer",
        ],
        ids=[
            "text-version",
            "common-info-not-json",
            "no-common-info",
            "link-demand-not-json",
            "no-transfer-table",
        ],
    )
    def test_a_damaged_index_falls_back_to_the_trace(
        self, tmp_path, monkeypatch, statement
    ):
        path = _write(tmp_path, _parity_trace())
        from_trace = _answer(path)
        execute(npe_index.ensure_index(str(path)), statement)
        reads = _counted_reads(monkeypatch)

        assert _answer(path) == from_trace
        assert len(reads) == 1

    def test_a_fallback_from_a_damaged_index_is_logged(self, tmp_path, caplog):
        path = _write(tmp_path, _parity_trace())
        from_trace = _answer(path)
        execute(
            npe_index.ensure_index(str(path)),
            "UPDATE meta SET value = 'not json' WHERE key = 'common_info'",
        )

        with caplog.at_level(logging.WARNING, logger=noc_congestion.__name__):
            assert _answer(path) == from_trace

        (record,) = [
            record
            for record in caplog.records
            if record.name == noc_congestion.__name__
        ]
        assert record.getMessage().startswith(
            "NoC congestion: the index of trace.json could not be read ("
        )

    def test_an_index_removed_after_its_check_falls_back_and_stays_gone(
        self, tmp_path, monkeypatch
    ):
        path = _write(tmp_path, _parity_trace())
        from_trace = _answer(path)
        db_path = npe_index.ensure_index(str(path))
        checked = npe_index.fresh_index

        def removed_after_check(npe_path):
            found = checked(npe_path)
            db_path.unlink()
            return found

        monkeypatch.setattr(npe_index, "fresh_index", removed_after_check)

        assert _answer(path) == from_trace
        assert not db_path.exists()


class TestNeverWrites:
    @pytest.mark.parametrize("sidecar", ["none", "stale", "current"])
    def test_no_call_writes_beside_the_trace(self, tmp_path, monkeypatch, sidecar):
        path = _write(tmp_path, _hand_checked())
        if sidecar != "none":
            npe_index.ensure_index(str(path))
        if sidecar == "stale":
            later = time.time() + 10
            os.utime(path, (later, later))
        assert (npe_index.fresh_index(str(path)) is not None) is (sidecar == "current")
        monkeypatch.setattr(npe_index, "ensure_index", _never_build)
        before = listing(tmp_path)
        registry = ReportRegistry()

        _call(registry, _load(registry, path))
        _call(registry, _load(registry, path), limit=1)

        assert listing(tmp_path) == before


class TestRefusals:
    def test_a_handle_loaded_without_a_trace_is_refused(self, tmp_path):
        registry = ReportRegistry()
        handle = load_report(registry, performance_path=str(tmp_path))["handle"]

        with pytest.raises(
            ValueError, match="'report-1' was loaded without an npe_path"
        ):
            _call(registry, handle)

    @pytest.mark.parametrize(
        "name, content, why",
        [
            ("trace.json", b"{not json", "is not a readable tt-npe trace"),
            ("trace.json", b"[]", "does not start as a tt-npe trace does"),
            ("trace.json", b"{}", "holds no timestep_data list"),
            ("trace.json", b'{"timestep_data": {}}', "holds no timestep_data list"),
            ("trace.json", b'{"timestep_data": []}', "records no timesteps"),
            (
                "trace.npeviz.zst",
                npe_index.ZSTD_MAGIC + b"not a frame" * 4,
                "is not a readable tt-npe trace",
            ),
            (
                "trace.npeviz.zst",
                b'{"timestep_data": []}',
                "does not start as a tt-npe trace does",
            ),
            (
                "trace.npeviz.zst",
                zstd.compress(b"{not json"),
                "is not a readable tt-npe trace",
            ),
            ("trace.npeviz.zst", zstd.compress(b"[]"), "holds no timestep_data list"),
        ],
        ids=[
            "garbage-json",
            "json-list",
            "no-timestep-data",
            "timestep-data-dict",
            "no-timesteps",
            "garbage-zst",
            "json-named-zst",
            "zst-of-garbage-json",
            "zst-of-a-list",
        ],
    )
    def test_a_file_that_is_not_a_trace_is_refused_with_why(
        self, tmp_path, name, content, why
    ):
        path = tmp_path / name
        path.write_bytes(content)
        registry = ReportRegistry()
        handle = _load(registry, path)

        with pytest.raises(ValueError, match=why) as refused:
            _call(registry, handle)
        assert str(refused.value).startswith(name)

    @pytest.mark.parametrize(
        "replace",
        [Path.unlink, lambda path: (path.unlink(), path.mkdir())],
        ids=["deleted", "now-a-directory"],
    )
    def test_a_trace_gone_before_the_first_call_is_refused(self, tmp_path, replace):
        path = _write(tmp_path, _hand_checked())
        registry = ReportRegistry()
        handle = _load(registry, path)
        replace(path)

        with pytest.raises(ValueError, match="trace.json is no longer a readable file"):
            _call(registry, handle)

    @pytest.mark.skipif(
        not hasattr(os, "geteuid") or os.geteuid() == 0,
        reason="root reads a file whatever its mode",
    )
    def test_an_unreadable_trace_is_refused(self, tmp_path):
        path = _write(tmp_path, _hand_checked())
        registry = ReportRegistry()
        handle = _load(registry, path)
        path.chmod(0)
        try:
            reloaded = load_report(registry, npe_path=str(path))
            assert "noc_congestion" in reloaded["unanswerable"]
            with pytest.raises(
                ValueError, match="trace.json cannot be read: Permission denied"
            ):
                _call(registry, handle)
        finally:
            path.chmod(0o600)

    def test_a_trace_declaring_more_json_than_the_tool_parses_is_refused_unread(
        self, tmp_path, monkeypatch
    ):
        path = tmp_path / "trace.npeviz.zst"
        path.write_bytes(_THREE_GIB_FRAME_HEADER)
        reads = _counted_reads(monkeypatch)
        registry = ReportRegistry()
        handle = _load(registry, path)

        with pytest.raises(
            ValueError,
            match="holds 3,221,225,472 bytes of JSON, past the 1,073,741,824",
        ):
            _call(registry, handle)
        assert reads == []

    def test_frames_that_pass_the_limit_together_are_refused_unread(
        self, tmp_path, monkeypatch
    ):
        data = orjson.dumps(_hand_checked())
        path = tmp_path / "trace.npeviz.zst"
        path.write_bytes(zstd.compress(data) + zstd.compress(b" " * len(data)))
        reads = _counted_reads(monkeypatch)
        monkeypatch.setattr(noc_congestion, "MAX_TRACE_JSON_BYTES", 2 * len(data) - 1)

        with pytest.raises(ValueError, match=f"holds {2 * len(data):,} bytes of JSON"):
            _answer(path)
        assert reads == []

        monkeypatch.setattr(noc_congestion, "MAX_TRACE_JSON_BYTES", 2 * len(data))
        assert _answer(path)["timesteps"] == 8

    def test_a_skippable_frame_does_not_hide_the_frames_after_it(
        self, tmp_path, monkeypatch
    ):
        path = tmp_path / "trace.npeviz.zst"
        path.write_bytes(
            zstd.compress(b"{}") + _SKIPPABLE_FRAME + _THREE_GIB_FRAME_HEADER
        )
        reads = _counted_reads(monkeypatch)

        with pytest.raises(ValueError, match="holds 3,221,225,474 bytes of JSON"):
            _answer(path)
        assert reads == []

    @pytest.mark.parametrize(
        "content, why",
        [
            (
                lambda data: zstd.compress(data) + _unsized_frame(b" "),
                "is not zstd frames that each declare their size",
            ),
            (
                lambda data: _SKIPPABLE_FRAME + zstd.compress(data),
                "does not start as a tt-npe trace does",
            ),
            (
                lambda data: zstd.compress(data) + b"\x00\x01",
                "is not zstd frames that each declare their size",
            ),
        ],
        ids=["unsized-frame", "leading-skippable-frame", "trailing-bytes"],
    )
    def test_a_zst_whose_size_cannot_be_bounded_is_refused_unread(
        self, tmp_path, monkeypatch, content, why
    ):
        path = tmp_path / "trace.npeviz.zst"
        path.write_bytes(content(orjson.dumps(_hand_checked())))
        reads = _counted_reads(monkeypatch)

        with pytest.raises(ValueError, match=why):
            _answer(path)
        assert reads == []

    def test_a_file_that_does_not_start_as_a_trace_is_refused_unread(
        self, tmp_path, monkeypatch
    ):
        path = tmp_path / "trace.json"
        path.write_bytes(b"  " + orjson.dumps([_hand_checked()]))
        reads = _counted_reads(monkeypatch)

        with pytest.raises(ValueError, match="does not start as a tt-npe trace does"):
            _answer(path)
        assert reads == []

    def test_a_trace_that_grows_after_its_size_was_read_is_refused(
        self, tmp_path, monkeypatch
    ):
        path = _write(tmp_path, _hand_checked())
        # As if the first 16 bytes were all of it when its size was read.
        monkeypatch.setattr(os, "fstat", lambda fd: SimpleNamespace(st_size=16))
        reads = _counted_reads(monkeypatch)

        with pytest.raises(ValueError, match="trace.json grew while it was read"):
            _answer(path)
        assert reads == []

    def test_json_past_the_limit_is_refused_unread(self, tmp_path, monkeypatch):
        path = _write(tmp_path, _hand_checked())
        size = path.stat().st_size
        reads = _counted_reads(monkeypatch)
        monkeypatch.setattr(noc_congestion, "MAX_TRACE_JSON_BYTES", size - 1)

        with pytest.raises(ValueError, match=f"holds {size:,} bytes of JSON"):
            _answer(path)
        assert reads == []

        monkeypatch.setattr(noc_congestion, "MAX_TRACE_JSON_BYTES", size)
        assert _answer(path)["timesteps"] == 8


class TestPinning:
    def test_two_calls_and_two_handles_on_one_trace_read_it_once(
        self, tmp_path, monkeypatch
    ):
        path = _write(tmp_path, _hand_checked())
        reads = _counted_reads(monkeypatch)
        registry = ReportRegistry()
        first, second = _load(registry, path), _load(registry, path)

        answers = [
            _call(registry, first),
            _call(registry, first),
            _call(registry, second),
        ]

        assert len(reads) == 1
        assert answers[0] == answers[1] == {**answers[2], "handle": first}

    def test_a_rewrite_before_the_first_call_is_what_the_handle_reads(self, tmp_path):
        path = _write(tmp_path, _hand_checked())
        registry = ReportRegistry()
        handle = _load(registry, path)
        _rewrite(path, _trace(_step(0, [*A, 10.0])))

        answer = _call(registry, handle)

        assert answer["timesteps"] == 1
        assert "caveat" not in answer

    def test_a_first_read_that_failed_refuses_the_trace_rewritten(
        self, tmp_path, monkeypatch
    ):
        path = _write(tmp_path, _hand_checked())
        registry = ReportRegistry()
        handle = _load(registry, path)
        real_parse = npe_index.parse_trace

        def exhausted(data, compressed):
            raise MemoryError

        monkeypatch.setattr(npe_index, "parse_trace", exhausted)
        with pytest.raises(MemoryError):
            _call(registry, handle)
        monkeypatch.setattr(npe_index, "parse_trace", real_parse)
        _rewrite(path, _trace(_step(0, [*A, 10.0])))

        with pytest.raises(ValueError, match="has changed since 'report-1' first read"):
            _call(registry, handle)
        assert _call(registry, _load(registry, path))["timesteps"] == 1

    def test_a_rewritten_trace_leaves_the_old_handle_on_its_first_read(
        self, tmp_path, monkeypatch
    ):
        path = _write(tmp_path, _hand_checked())
        registry = ReportRegistry()
        old = _load(registry, path)
        first = _call(registry, old)
        _rewrite(path, _trace(_step(0, [*A, 10.0])))
        reads = _counted_reads(monkeypatch)

        again = _call(registry, old)
        fresh = _call(registry, _load(registry, path))

        assert again["caveat"] == CHANGED_CAVEAT
        assert _without(again, "caveat") == first
        assert fresh["timesteps"] == 1
        assert "caveat" not in fresh
        assert len(reads) == 1

    def test_a_deleted_trace_leaves_the_old_handle_on_its_first_read(self, tmp_path):
        path = _write(tmp_path, _hand_checked())
        registry = ReportRegistry()
        handle = _load(registry, path)
        first = _call(registry, handle)
        path.unlink()

        again = _call(registry, handle)

        assert again["caveat"] == CHANGED_CAVEAT
        assert _without(again, "caveat") == first

    def test_a_refusal_is_kept_rather_than_read_again(self, tmp_path, monkeypatch):
        path = tmp_path / "trace.json"
        path.write_bytes(b"{not json")
        reads = _counted_reads(monkeypatch)
        registry = ReportRegistry()
        first, second = _load(registry, path), _load(registry, path)
        refusals = []

        for handle in (first, first, second):
            with pytest.raises(
                ValueError, match="not a readable tt-npe trace"
            ) as refused:
                _call(registry, handle)
            refusals.append(str(refused.value))

        assert len(reads) == 1
        assert len(set(refusals)) == 1

    def test_a_refused_trace_rewritten_is_read_by_a_new_handle(self, tmp_path):
        path = tmp_path / "trace.json"
        path.write_bytes(b"{not json")
        registry = ReportRegistry()
        with pytest.raises(ValueError):
            _call(registry, _load(registry, path))
        _rewrite(path, _hand_checked())

        assert _call(registry, _load(registry, path))["timesteps"] == 8

    def test_a_cached_refusal_keeps_nothing_of_the_parsed_trace(
        self, tmp_path, monkeypatch
    ):
        """The refusal is kept for the registry's lifetime, so it must not hold the
        parse its frames saw."""

        class _Parsed(dict):
            pass

        parsed: list = []

        def parse(data, compressed):
            trace = _Parsed(common_info={})
            parsed.append(weakref.ref(trace))
            return trace

        monkeypatch.setattr(npe_index, "parse_trace", parse)
        registry = ReportRegistry()
        handle = _load(registry, _write(tmp_path, _hand_checked()))

        for _ in range(2):
            with pytest.raises(ValueError, match="no timestep_data list"):
                _call(registry, handle)
        gc.collect()

        assert len(parsed) == 1
        assert parsed[0]() is None


class TestLoadReport:
    @pytest.mark.parametrize("name", ["trace.json", "trace.npeviz", "trace.npeviz.zst"])
    def test_a_trace_alone_answers_noc_congestion_and_nothing_else(
        self, tmp_path, name
    ):
        path = _write(tmp_path, _hand_checked(), name)

        loaded = load_report(ReportRegistry(), npe_path=str(path))

        assert loaded["answerable"] == ["noc_congestion"]
        assert loaded["npe_path"] == str(path.resolve())
        assert loaded["profiler_path"] is None
        assert loaded["performance_path"] is None

    @pytest.mark.parametrize(
        "name, write",
        [
            ("trace.json", lambda path: execute(path, "CREATE TABLE t (x INTEGER)")),
            ("trace.json", lambda path: path.write_bytes(b'[{"timestep_data": []}]')),
            ("trace.json", lambda path: path.write_bytes(b"")),
            ("trace.zst", lambda path: path.write_bytes(b'{"timestep_data": []}')),
        ],
        ids=["sqlite", "json-list", "empty", "json-named-zst"],
    )
    def test_a_file_that_does_not_start_as_a_trace_answers_nothing(
        self, tmp_path, name, write
    ):
        path = tmp_path / name
        write(path)

        loaded = load_report(ReportRegistry(), npe_path=str(path))

        assert loaded["answerable"] == []
        assert "noc_congestion" in loaded["unanswerable"]

    def test_a_trace_beside_a_performance_capture_answers_with_it(self, tmp_path):
        (tmp_path / "perf").mkdir()
        write_device_log(tmp_path / "perf", MODERN_HEADER, THREE_CORES)
        path = _write(tmp_path, _hand_checked())
        registry = ReportRegistry()

        loaded = load_report(
            registry, performance_path=str(tmp_path / "perf"), npe_path=str(path)
        )
        handle = str(loaded["handle"])

        assert loaded["answerable"] == [
            "zone_timings",
            "zone_intervals",
            "noc_congestion",
        ]
        assert tool_call(registry, "zone_timings", {"handle": handle})[1] is (
            McpToolOutcome.OK
        )
        assert _call(registry, handle)["timesteps"] == 8

    def test_a_trace_beside_a_memory_report_answers_with_it(self, tmp_path):
        memory = _memory_report(tmp_path / "memory")
        path = _write(tmp_path, _hand_checked())
        registry = ReportRegistry()

        loaded = load_report(
            registry, memory_report_path=str(memory), npe_path=str(path)
        )
        handle = str(loaded["handle"])

        assert {"find_operations", "noc_congestion"} <= set(loaded["answerable"])
        assert tool_call(registry, "find_operations", {"handle": handle})[1] is (
            McpToolOutcome.OK
        )
        assert _call(registry, handle)["timesteps"] == 8

    def test_positional_arguments_keep_what_they_bound(self, tmp_path):
        """npe_path comes after memory_report_path, which callers could already pass."""
        memory = _memory_report(tmp_path / "memory")
        path = _write(tmp_path, _hand_checked())

        loaded = load_report(ReportRegistry(), None, None, str(memory), str(path))

        assert loaded["profiler_path"] == str(memory.resolve())
        assert loaded["npe_path"] == str(path.resolve())

    def test_a_directory_is_refused_as_an_npe_path(self, tmp_path):
        with pytest.raises(ValueError, match="npe_path is not a file"):
            load_report(ReportRegistry(), npe_path=str(tmp_path))

    def test_a_missing_trace_is_refused_with_its_path(self, tmp_path):
        with pytest.raises(ValueError, match="npe_path is not a file: .*absent.json"):
            load_report(ReportRegistry(), npe_path=str(tmp_path / "absent.json"))

    def test_with_no_path_the_refusal_names_all_three(self):
        with pytest.raises(
            ValueError,
            match="one of memory_report_path, performance_path or npe_path is required",
        ):
            load_report(ReportRegistry())


def _crowded_trace() -> dict:
    """Over a hundred bursts and links, each field as wide as a readable trace makes
    it: u64 coordinates, 32-character names, int64 cycles and 64-character labels."""
    widest = 2**64 - 1
    cycle = 2**63 - 1 - 1000
    links = [
        [widest - i, widest - i, widest - i, f"{i:032d}"] for i in range(3 * MAX_LIMIT)
    ]
    steps = []
    for t in range(2 * MAX_LIMIT + 40):
        rows = []
        if t % 2 == 0:
            rows = [
                [*link, 100.123456789 + 1234567.891 * ((i * 7 + t) % 300) / 7]
                for i, link in enumerate(links)
            ]
        steps.append(
            {"start_cycle": cycle + t, "end_cycle": cycle + t, "link_demand": rows}
        )
    label = "x" * noc_congestion.MAX_LABEL_LENGTH
    figure = 1234567.891234
    nocs = {
        f"{n:032d}": {
            "avg_link_demand": figure,
            "avg_link_util": figure,
            "max_link_demand": figure,
        }
        for n in range(noc_congestion.MAX_NOCS)
    }
    info = {
        "arch": label,
        "mesh_device": label,
        "congestion_model_name": label,
        "cycles_per_timestep": cycle,
        "link_demand": figure,
        "link_util": figure,
        "max_link_demand": figure,
        "dram_bw_util": figure,
        "mcast_write_link_util": figure,
        "noc": nocs,
    }
    return _trace(*steps, common_info=info)


class TestThroughTheServer:
    def test_load_report_takes_a_trace_alone(self, tmp_path):
        path = _write(tmp_path, _hand_checked())

        result, outcome = tool_call(
            ReportRegistry(), "load_report", {"npe_path": str(path)}
        )

        assert outcome is McpToolOutcome.OK
        assert json.loads(result["content"][0]["text"])["answerable"] == [
            "noc_congestion"
        ]

    @pytest.mark.parametrize("configured", [None, "http://localhost:5173/"])
    def test_a_trace_alone_has_no_app_link(self, tmp_path, monkeypatch, configured):
        if configured is None:
            monkeypatch.delenv(APP_URL_ENV_VAR, raising=False)
        else:
            monkeypatch.setenv(APP_URL_ENV_VAR, configured)
        path = _write(tmp_path, _hand_checked())

        result, _ = tool_call(ReportRegistry(), "load_report", {"npe_path": str(path)})

        assert "app_link" not in json.loads(result["content"][0]["text"])

    def test_an_answer_is_recorded_as_ok(self, tmp_path):
        registry = ReportRegistry()
        handle = _load(registry, _write(tmp_path, _hand_checked()))

        result, outcome = tool_call(registry, "noc_congestion", {"handle": handle})

        assert not result.get("isError")
        assert json.loads(result["content"][0]["text"])["burst_count"] == 3
        assert outcome is McpToolOutcome.OK

    def test_a_handle_without_a_trace_is_recorded_as_refused(self, tmp_path):
        registry = ReportRegistry()
        handle = load_report(registry, performance_path=str(tmp_path))["handle"]

        result, outcome = tool_call(registry, "noc_congestion", {"handle": handle})

        assert result["isError"] is True
        assert "without an npe_path" in result["content"][0]["text"]
        # A deliberate refusal, not an unexpected failure. #1819
        assert outcome is McpToolOutcome.REFUSED

    @pytest.mark.parametrize(
        "name, content",
        [
            ("trace.json", b"{not json"),
            ("trace.npeviz.zst", npe_index.ZSTD_MAGIC + b"not a frame" * 4),
            ("trace.npeviz.zst", _THREE_GIB_FRAME_HEADER),
        ],
        ids=["garbage-json", "garbage-zst", "past-the-limit"],
    )
    def test_a_trace_the_tool_cannot_read_is_recorded_as_refused(
        self, tmp_path, name, content
    ):
        path = tmp_path / name
        path.write_bytes(content)
        registry = ReportRegistry()
        handle = _load(registry, path)

        result, outcome = tool_call(registry, "noc_congestion", {"handle": handle})

        assert result["isError"] is True
        assert result["content"][0]["text"].startswith(name)
        assert outcome is McpToolOutcome.REFUSED

    def test_a_hundred_bursts_and_links_stay_within_a_clients_answer_budget(
        self, tmp_path
    ):
        registry = ReportRegistry()
        handle = _load(registry, _write(tmp_path, _crowded_trace()))

        result, _ = tool_call(
            registry, "noc_congestion", {"handle": handle, "limit": MAX_LIMIT}
        )

        text = result["content"][0]["text"]
        answer = json.loads(text)
        assert answer["burst_count"] > MAX_LIMIT
        assert answer["link_count"] > MAX_LIMIT
        assert len(answer["bursts"]) == len(answer["busiest_links"]) == MAX_LIMIT
        assert len(text.encode()) < ANSWER_BUDGET_BYTES


_TRACE_TOOLS = {McpToolName.LOAD_REPORT, McpToolName.NOC_CONGESTION}


def _required_arguments(name: McpToolName, handle: str) -> dict:
    """The arguments a call must name, the handle in each handle slot."""
    schema = server._tool_table(ReportRegistry())[name]["schema"]
    arguments: dict = {}
    for key in schema.get("required", []):
        kind = schema["properties"][key]["type"]
        if kind == "integer":
            arguments[key] = 1
        else:
            arguments[key] = handle if key.startswith("handle") else "LOOP"
    return arguments


class TestOtherToolsOnATrace:
    @pytest.mark.parametrize(
        "name", [name for name in McpToolName if name not in _TRACE_TOOLS]
    )
    def test_every_other_tool_refuses_a_trace_only_handle(self, tmp_path, name):
        registry = ReportRegistry()
        handle = _load(registry, _write(tmp_path, _hand_checked()))

        result, outcome = tool_call(
            registry, name.value, _required_arguments(name, handle)
        )

        assert result["isError"] is True
        assert outcome is McpToolOutcome.REFUSED
        text = result["content"][0]["text"]
        assert "performance" in text or "memory" in text

    def test_a_limit_that_is_not_a_number_is_refused_by_name(self, tmp_path):
        registry = ReportRegistry()
        handle = _load(registry, _write(tmp_path, _hand_checked()))

        result, outcome = tool_call(
            registry, "noc_congestion", {"handle": handle, "limit": "abc"}
        )

        assert outcome is McpToolOutcome.REFUSED
        assert "limit" in result["content"][0]["text"]

    def test_a_limit_of_zero_answers_one(self, tmp_path):
        registry = ReportRegistry()
        handle = _load(registry, _write(tmp_path, _hand_checked()))

        result, outcome = tool_call(
            registry, "noc_congestion", {"handle": handle, "limit": 0}
        )

        answer = json.loads(result["content"][0]["text"])
        assert outcome is McpToolOutcome.OK
        assert (len(answer["bursts"]), len(answer["busiest_links"])) == (1, 1)
