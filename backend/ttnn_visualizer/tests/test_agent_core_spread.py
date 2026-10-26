# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""`core_spread`: one operation's kernel time across its cores, on one device.

A perf row's global call count is the device log's `run host ID` and its device the
log's `PCIe slot`. Every local capture checked held that one-to-one, and a core's
span read this way reproduced tt-metal's `DEVICE KERNEL DURATION PER CORE` columns to
the nanosecond, so the fixtures here build both files on that join. #2173
"""

import json
from unittest.mock import patch

import pytest
from ttnn_visualizer import csv_queries
from ttnn_visualizer.agent import server, tools
from ttnn_visualizer.agent.handles import ReportRegistry, load_report
from ttnn_visualizer.csv_queries import DeviceLogProfilerQueries
from ttnn_visualizer.event_logging import McpToolOutcome
from ttnn_visualizer.exceptions import DataFormatError
from ttnn_visualizer.models import Instance
from ttnn_visualizer.tests.smoke_capture import (
    SMOKE_CAPTURE_DIR,
    smoke_rows,
    write_ops_perf,
)
from ttnn_visualizer.tests.test_agent_tools import UNTYPED_HEADER, _perf_report, _row
from ttnn_visualizer.tests.test_device_log_columns import (
    MODERN_HEADER,
    PRE_RENAME_HEADER,
    PREAMBLE,
    write_device_log,
)

# The fixtures' clock is 1000 MHz, so a thousand cycles is one microsecond.
RUN = 1024


def _zone(slot, x, y, risc, start, end, run=RUN, zone=None):
    """A paired zone in `MODERN_HEADER`'s layout, a kernel unless named otherwise."""
    zone = zone or f"{risc.split('_')[0]}-KERNEL"
    return [
        f"{slot},{x},{y},{risc},1,{start},0,{run},,,{zone},ZONE_START,1,k.cc,",
        f"{slot},{x},{y},{risc},2,{end},0,{run},,,{zone},ZONE_END,1,k.cc,",
    ]


# Three cores on device 0 with spans of 1.2, 2.0 and 3.0 us. The firmware zone
# wrapping the first is wider than its kernels and must not count.
THREE_CORES = [
    *_zone(0, 1, 1, "BRISC", 0, 5000, zone="BRISC-FW"),
    *_zone(0, 1, 1, "BRISC", 0, 1000),
    *_zone(0, 1, 1, "TRISC_0", 100, 1200),
    *_zone(0, 2, 1, "BRISC", 0, 2000),
    *_zone(0, 3, 1, "BRISC", 0, 3000),
]


def _op(perf_id="1", call_count=RUN, device=0, **overrides):
    fields = {
        "id": perf_id,
        "global_call_count": str(call_count),
        "device": str(device),
        "cores": "3",
    }
    fields.update(overrides)
    return _row(**fields)


def _spread(tmp_path, log_rows, perf_rows, header=MODERN_HEADER, **arguments):
    registry = ReportRegistry()
    write_device_log(tmp_path, header, log_rows)
    load_report(registry, performance_path=str(tmp_path))
    with patch.object(
        tools, "_generate_canonical_report", return_value=_perf_report(perf_rows)
    ):
        return tools.core_spread(registry, "report-1", **arguments)


class TestStatistics:
    def test_the_spread_is_read_across_cores(self, tmp_path):
        op = _spread(tmp_path, THREE_CORES, [_op()], perf_id="1")["ops"][0]

        assert op["in_log"] is True
        assert op["cores_in_log"] == 3
        assert op["core_span"] == {
            "min_us": 1.2,
            "median_us": 2.0,
            "max_us": 3.0,
            "imbalance": 1.5,
        }
        assert op["slowest_cores"] == [
            {"x": 3, "y": 1, "span_us": 3.0},
            {"x": 2, "y": 1, "span_us": 2.0},
            {"x": 1, "y": 1, "span_us": 1.2},
        ]

    def test_each_risc_is_spread_on_its_own(self, tmp_path):
        op = _spread(tmp_path, THREE_CORES, [_op()], perf_id="1")["ops"][0]

        assert op["by_risc"]["BRISC"] == {
            "min_us": 1.0,
            "median_us": 2.0,
            "max_us": 3.0,
            "imbalance": 1.5,
        }
        assert op["by_risc"]["TRISC_0"]["max_us"] == 1.1

    def test_the_slowest_cores_are_capped(self, tmp_path):
        rows = [
            line
            for x in range(1, tools.SLOWEST_CORES + 3)
            for line in _zone(0, x, 1, "BRISC", 0, 1000 * x)
        ]

        op = _spread(tmp_path, rows, [_op(cores="7")], perf_id="1")["ops"][0]

        assert len(op["slowest_cores"]) == tools.SLOWEST_CORES
        assert op["slowest_cores"][0]["x"] == tools.SLOWEST_CORES + 2

    def test_the_perf_csv_figures_ride_alongside(self, tmp_path):
        perf = _op(
            device_kernel_duration_per_core_min="1200",
            device_kernel_duration_per_core_max="3000",
            device_kernel_duration_per_core_avg="2066.667",
        )

        op = _spread(tmp_path, THREE_CORES, [perf], perf_id="1")["ops"][0]

        # The same definition read two ways: tt-metal's columns and the log's spans.
        assert op["per_core_min_us"] == op["core_span"]["min_us"]
        assert op["per_core_max_us"] == op["core_span"]["max_us"]


class TestDevicesNeverPool:
    def test_another_device_on_the_same_run_is_left_out(self, tmp_path):
        """Same run ID and coordinates on slot 1: a longer span that must not leak in."""
        rows = THREE_CORES + _zone(1, 1, 1, "BRISC", 0, 9000)

        result = _spread(tmp_path, rows, [_op()], perf_id="1")

        op = result["ops"][0]
        assert op["device"] == 0
        assert op["cores_in_log"] == 3
        assert op["core_span"]["max_us"] == 3.0

    def test_each_op_reads_its_own_device(self, tmp_path):
        rows = THREE_CORES + _zone(1, 1, 1, "BRISC", 0, 9000, run=RUN + 1)
        perf_rows = [
            _op(device_time="5"),
            _op(perf_id="2", call_count=RUN + 1, device=1, cores="1", device_time="9"),
        ]

        ops = _spread(tmp_path, rows, perf_rows)["ops"]

        assert [(op["id"], op["device"]) for op in ops] == [("2", 1), ("1", 0)]
        assert ops[0]["core_span"]["max_us"] == 9.0


class TestRefusals:
    def test_an_unknown_perf_id_is_refused(self, tmp_path):
        with pytest.raises(ValueError, match="not an operation_id"):
            _spread(tmp_path, THREE_CORES, [_op()], perf_id="99")

    def test_a_signpost_is_refused(self, tmp_path):
        signpost = _op(op_code="PERF_START", op_type="signpost")

        with pytest.raises(ValueError, match="signpost"):
            _spread(tmp_path, THREE_CORES, [signpost], perf_id="1")

    def test_a_row_without_a_call_count_is_refused(self, tmp_path):
        host_op = _op(global_call_count="")

        with pytest.raises(ValueError, match="host op"):
            _spread(tmp_path, THREE_CORES, [host_op], perf_id="1")

    def test_a_log_without_a_clock_is_refused(self, tmp_path):
        write_device_log(tmp_path, MODERN_HEADER, THREE_CORES)
        path = tmp_path / DeviceLogProfilerQueries.DEVICE_LOG_FILE
        lines = path.read_text().splitlines()
        path.write_text("\n".join(["ARCH: wormhole_b0", *lines[1:]]) + "\n")
        registry = ReportRegistry()
        load_report(registry, performance_path=str(tmp_path))

        with patch.object(
            tools, "_generate_canonical_report", return_value=_perf_report([_op()])
        ):
            with pytest.raises(ValueError, match="CHIP_FREQ"):
                tools.core_spread(registry, "report-1", perf_id="1")

    def test_a_log_without_phases_has_no_durations_to_spread(self, tmp_path):
        rows = ["0,1,1,BRISC,10,1000,0,1024,BRISC-KERNEL,1,brisc.cc"]

        with pytest.raises(DataFormatError, match="no kernel durations"):
            _spread(tmp_path, rows, [_op()], header=UNTYPED_HEADER, perf_id="1")


class TestCaveats:
    def test_an_op_missing_from_the_log_says_so_rather_than_reading_zero(
        self, tmp_path
    ):
        result = _spread(tmp_path, THREE_CORES, [_op(call_count=RUN + 7)], perf_id="1")

        op = result["ops"][0]
        assert op["in_log"] is False
        assert "core_span" not in op
        assert "1 of 1 operations have no kernel zones" in result["caveat"]

    def test_fewer_cores_than_the_row_reports_is_caveated(self, tmp_path):
        result = _spread(tmp_path, THREE_CORES, [_op(cores="4")], perf_id="1")

        assert "fewer cores" in result["caveat"]
        assert "host log" in result["caveat"]

    def test_an_unpaired_start_in_the_requested_run_is_caveated(self, tmp_path):
        open_start = "0,4,1,BRISC,1,0,0,1024,,,BRISC-KERNEL,ZONE_START,1,k.cc,"

        result = _spread(tmp_path, THREE_CORES + [open_start], [_op()], perf_id="1")

        assert "1 zone starts and 0 ends did not pair" in result["caveat"]

    def test_an_unpaired_start_in_another_run_is_not_this_ops_concern(self, tmp_path):
        open_start = "0,4,1,BRISC,1,0,0,9999,,,BRISC-KERNEL,ZONE_START,1,k.cc,"

        result = _spread(tmp_path, THREE_CORES + [open_start], [_op()], perf_id="1")

        assert "caveat" not in result

    def test_a_complete_read_carries_no_caveat(self, tmp_path):
        assert "caveat" not in _spread(tmp_path, THREE_CORES, [_op()], perf_id="1")


class TestRanking:
    def test_without_a_perf_id_it_ranks_device_ops_by_device_time(self, tmp_path):
        perf_rows = [
            _op(perf_id="1", device_time="1"),
            _op(perf_id="2", call_count=RUN + 1, device_time="3"),
            _op(perf_id="3", call_count=RUN + 2, device_time="2"),
            _op(perf_id="4", op_code="PERF_START", op_type="signpost", device_time="9"),
            _op(perf_id="5", global_call_count="", device_time="8"),
        ]

        result = _spread(tmp_path, THREE_CORES, perf_rows, limit=2)

        assert [op["id"] for op in result["ops"]] == ["2", "3"]

    def test_the_limit_is_capped_at_the_detailed_cap(self, tmp_path):
        perf_rows = [
            _op(perf_id=str(index), call_count=RUN + index) for index in range(40)
        ]

        result = _spread(tmp_path, THREE_CORES, perf_rows, limit=1000)

        assert result["returned"] == tools.MAX_DETAILED_LIMIT

    def test_every_op_comes_from_one_read_of_the_log(self, tmp_path):
        perf_rows = [
            _op(perf_id=str(index), call_count=RUN + index) for index in range(3)
        ]

        with patch.object(
            DeviceLogProfilerQueries,
            "query_core_spans",
            autospec=True,
            side_effect=DeviceLogProfilerQueries.query_core_spans,
        ) as read:
            _spread(tmp_path, THREE_CORES, perf_rows)

        assert read.call_count == 1
        assert read.call_args.args[1] == {(RUN + index, 0) for index in range(3)}


def test_a_pre_rename_capture_pairs_begin_with_end(tmp_path):
    """`zone phase` begin/end, and `run host ID` after a `run ID` column."""
    rows = [
        "0,1,1,BRISC,1,0,0,0,1024,BRISC-KERNEL,begin,1,k.cc",
        "0,1,1,BRISC,2,1500,0,0,1024,BRISC-KERNEL,end,1,k.cc",
    ]

    op = _spread(
        tmp_path, rows, [_op(cores="1")], header=PRE_RENAME_HEADER, perf_id="1"
    )["ops"][0]

    assert op["core_span"]["max_us"] == 1.5


def test_the_smoke_capture_reads_end_to_end():
    """The committed capture through the real generator: its device log is a slice.

    It holds one kernel core of call 1024 on device 0, which the perf CSV says ran on
    eight, and nothing for the rest, so every gap caveat has something to say.
    """
    registry = ReportRegistry()
    handle = load_report(registry, performance_path=str(SMOKE_CAPTURE_DIR))["handle"]

    result = tools.core_spread(registry, handle, limit=25)

    in_log = [op for op in result["ops"] if op["in_log"]]
    assert [(op["global_call_count"], op["device"]) for op in in_log] == [(1024, 0)]
    assert in_log[0]["cores_in_log"] < in_log[0]["cores"]
    assert "have no kernel zones" in result["caveat"]
    assert "fewer cores" in result["caveat"]


class TestPairing:
    """The pairing `query_zone_summary` pins, held for `query_core_spans` too."""

    def test_a_pair_split_across_chunks_still_matches(self, tmp_path, monkeypatch):
        """Chunks are filtered before pairing, so a start and its end in different
        chunks, with other runs' and firmware rows between them, must still pair."""
        monkeypatch.setattr(csv_queries, "CSV_CHUNK_SIZE", 1)
        start, end = _zone(0, 1, 1, "BRISC", 0, 1000)
        between = [
            *_zone(0, 1, 1, "BRISC", 100, 900, zone="BRISC-FW"),
            *_zone(0, 9, 9, "BRISC", 0, 7000, run=RUN + 5),
        ]
        rows = [start, *between, end, *THREE_CORES[4:]]

        result = _spread(tmp_path, rows, [_op()], perf_id="1")

        # Core (1,1) runs BRISC 0-1000 and TRISC_0 100-1200, so its span is 1.2 us
        # only if the split BRISC pair matched: unmatched, it would read 1.1.
        assert result["ops"][0]["core_span"] == {
            "min_us": 1.2,
            "median_us": 2.0,
            "max_us": 3.0,
            "imbalance": 1.5,
        }
        assert "caveat" not in result

    def test_starts_past_the_ceiling_say_the_log_is_malformed(
        self, tmp_path, monkeypatch
    ):
        monkeypatch.setattr(csv_queries, "MAX_OPEN_ZONE_STARTS", 1)
        never_closed = [
            "0,4,1,BRISC,1,0,0,1024,,,BRISC-KERNEL,ZONE_START,1,k.cc,",
            "0,5,1,BRISC,1,0,0,1024,,,BRISC-KERNEL,ZONE_START,1,k.cc,",
        ]

        result = _spread(tmp_path, THREE_CORES + never_closed, [_op()], perf_id="1")

        assert "were dropped at the open-zone ceiling" in result["caveat"]
        assert "malformed" in result["caveat"]

    def test_an_end_without_a_start_is_caveated(self, tmp_path):
        lone_end = "0,4,1,BRISC,2,900,0,1024,,,BRISC-KERNEL,ZONE_END,1,k.cc,"

        result = _spread(tmp_path, [lone_end, *THREE_CORES], [_op()], perf_id="1")

        assert "0 zone starts and 1 ends did not pair" in result["caveat"]

    def test_a_repeated_kernel_on_one_core_widens_its_span(self, tmp_path):
        rows = [
            *_zone(0, 1, 1, "BRISC", 0, 1000),
            *_zone(0, 1, 1, "BRISC", 2000, 2500),
        ]

        op = _spread(tmp_path, rows, [_op(cores="1")], perf_id="1")["ops"][0]

        assert op["core_span"]["max_us"] == 2.5
        assert op["by_risc"]["BRISC"]["max_us"] == 1.5

    def test_a_zero_median_has_no_imbalance_and_stays_valid_json(self, tmp_path):
        rows = [*_zone(0, 1, 1, "BRISC", 500, 500), *_zone(0, 2, 1, "BRISC", 0, 0)]

        result = _spread(tmp_path, rows, [_op(cores="2")], perf_id="1")

        assert result["ops"][0]["core_span"]["imbalance"] is None
        json.dumps(result, allow_nan=False)


@pytest.mark.parametrize(
    "query", ["query_zone_summary", "query_core_spans"], ids=["summary", "spans"]
)
def test_a_ragged_row_mid_file_is_a_data_error_while_streaming(tmp_path, query):
    """`stream=True` reads only the header up front, so a bad row surfaces while the
    zone queries walk the chunks, and must still arrive as bad data, not a fault."""
    # An unterminated quote: the zone queries read with `usecols`, under which
    # pandas drops a row's surplus fields rather than refusing them.
    rows = [*THREE_CORES[:2], '0,1,1,BRISC,1,"unterminated', *THREE_CORES[2:]]
    write_device_log(tmp_path, MODERN_HEADER, rows)
    instance = Instance(instance_id="pytest", performance_path=str(tmp_path))
    arguments = {"runs": {(RUN, 0)}} if query == "query_core_spans" else {}

    with DeviceLogProfilerQueries(instance, stream=True) as queries:
        with pytest.raises(DataFormatError, match="could not be parsed"):
            getattr(queries, query)(**arguments)


class TestInventory:
    def test_a_pre_rename_log_with_a_perf_csv_answers_core_spread(self, tmp_path):
        """The inventory reads the same phase spellings `query_core_spans` pairs on."""
        rows = [
            "0,1,1,BRISC,1,0,0,0,1024,BRISC-KERNEL,begin,1,k.cc",
            "0,1,1,BRISC,2,1500,0,0,1024,BRISC-KERNEL,end,1,k.cc",
        ]
        write_device_log(tmp_path, PRE_RENAME_HEADER, rows)
        write_ops_perf(tmp_path, smoke_rows())

        loaded = load_report(ReportRegistry(), performance_path=str(tmp_path))

        assert "core_spread" in loaded["answerable"]

    def test_blank_lines_before_the_header_are_skipped(self, tmp_path):
        """As pandas and `_scan_csv` skip them, so the tool and the list agree."""
        path = tmp_path / DeviceLogProfilerQueries.DEVICE_LOG_FILE
        path.write_text(
            "\n".join([PREAMBLE, "", MODERN_HEADER, *THREE_CORES]) + "\n",
            encoding="utf-8",
        )
        write_ops_perf(tmp_path, smoke_rows())

        loaded = load_report(ReportRegistry(), performance_path=str(tmp_path))

        assert "core_spread" in loaded["answerable"]

    def test_an_answerable_log_answers(self, tmp_path):
        """Listed as answerable means the call returns rather than refuses."""
        write_device_log(tmp_path, MODERN_HEADER, THREE_CORES)
        write_ops_perf(tmp_path, smoke_rows())
        registry = ReportRegistry()

        loaded = load_report(registry, performance_path=str(tmp_path))

        assert "core_spread" in loaded["answerable"]
        assert "ops" in tools.core_spread(registry, loaded["handle"], limit=1)


class TestThroughTheServer:
    @pytest.fixture(autouse=True)
    def _never_touch_the_real_event_log(self, event_log_directory):
        """Every tools/call reaches the recorder; none may write outside tmp_path."""

    def _call(self, tmp_path, log_rows, arguments, header=MODERN_HEADER):
        registry = ReportRegistry()
        write_device_log(tmp_path, header, log_rows)
        load_report(registry, performance_path=str(tmp_path))
        with (
            patch.object(
                tools, "_generate_canonical_report", return_value=_perf_report([_op()])
            ),
            patch.object(server, "record_event") as record,
        ):
            response = server.handle_message(
                {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "tools/call",
                    "params": {
                        "name": "core_spread",
                        "arguments": {"handle": "report-1", **arguments},
                    },
                },
                server._tool_table(registry),
            )
        return response["result"], record.call_args.kwargs["outcome"]

    def test_an_integer_perf_id_answers(self, tmp_path):
        """The schema takes a string or an integer; ids are matched as text."""
        result, outcome = self._call(tmp_path, THREE_CORES, {"perf_id": 1})

        assert not result.get("isError")
        assert json.loads(result["content"][0]["text"])["ops"][0]["id"] == "1"
        assert outcome is McpToolOutcome.OK

    def test_a_log_without_phases_is_refused_with_why(self, tmp_path):
        rows = ["0,1,1,BRISC,10,1000,0,1024,BRISC-KERNEL,1,brisc.cc"]

        result, _outcome = self._call(
            tmp_path, rows, {"perf_id": "1"}, header=UNTYPED_HEADER
        )

        assert result["isError"] is True
        assert "no kernel durations" in result["content"][0]["text"]

    def test_a_log_without_a_clock_is_refused(self, tmp_path):
        write_device_log(tmp_path, MODERN_HEADER, THREE_CORES)
        path = tmp_path / DeviceLogProfilerQueries.DEVICE_LOG_FILE
        lines = path.read_text().splitlines()
        path.write_text("\n".join(["ARCH: wormhole_b0", *lines[1:]]) + "\n")
        registry = ReportRegistry()
        load_report(registry, performance_path=str(tmp_path))

        with (
            patch.object(
                tools, "_generate_canonical_report", return_value=_perf_report([_op()])
            ),
            patch.object(server, "record_event") as record,
        ):
            response = server.handle_message(
                {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "tools/call",
                    "params": {
                        "name": "core_spread",
                        "arguments": {"handle": "report-1", "perf_id": "1"},
                    },
                },
                server._tool_table(registry),
            )

        assert response["result"]["isError"] is True
        assert "CHIP_FREQ" in response["result"]["content"][0]["text"]
        assert record.call_args.kwargs["outcome"] is McpToolOutcome.REFUSED
