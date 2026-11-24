# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""`stall_breakdown`: the ops an agent picks, ranked by stalled device time, and what a
capture without the counters or the CB waits is told. #2372"""

import errno
import json
import re
from pathlib import Path
from unittest.mock import patch

import pytest
from ttnn_visualizer import csv_queries, hardware_counters, pipeline_stalls
from ttnn_visualizer.agent import hw_utilisation, server, stall_breakdown, tools
from ttnn_visualizer.agent.bounds import MAX_DETAILED_LIMIT, MAX_ECHOED_CHARS
from ttnn_visualizer.agent.handles import ReportRegistry, load_report
from ttnn_visualizer.csv_queries import (
    REPORT_ROW_ID_OFFSET,
    OpsPerformanceReportQueries,
)
from ttnn_visualizer.tests.hardware_counter_capture import (
    stat_column,
    write_device_log,
)
from ttnn_visualizer.tests.smoke_capture import signpost, smoke_rows, write_ops_perf
from ttnn_visualizer.tests.stall_capture import (
    CB_RESERVE_BACK,
    CB_WAIT_FRONT,
    COMPUTE,
    INPUT_STARVED,
    INPUT_STARVED_POSITION,
    OUTPUT_BLOCKED_POSITION,
    STALE_CB_POSITION,
    STALL_OPS,
    UNPACK_BOUND_POSITION,
    StallOp,
    counter_average,
    dropped_cb_sum_rows,
    stall_rows,
    two_device_stall_rows,
    write_stall_capture,
)

COUNTERS_FLAG = "--profiler-capture-perf-counters=instrn,unpack,pack,fpu"
SUM_FLAG = "--enable-sum-profiling"


def _write(directory):
    write_stall_capture(directory)
    return directory


def _load(directory):
    registry = ReportRegistry()
    return registry, load_report(registry, performance_path=str(directory))["handle"]


@pytest.fixture
def captured(tmp_path):
    return _load(_write(tmp_path / "captured"))


@pytest.fixture
def without_sum_profiling(tmp_path):
    write_stall_capture(tmp_path / "no-sum", sum_profiling=False)
    return _load(tmp_path / "no-sum")


def _perf_id(position):
    return str(position + REPORT_ROW_ID_OFFSET)


def _ops_csv_unreadable_once():
    """An `open` for `csv_queries` that refuses its first open of the ops CSV, which
    only the sum-profiling scan makes, as a passing permission error would."""
    denied = []

    def opener(path, *args, **kwargs):
        if not denied and Path(path).name.startswith("ops_perf_results"):
            denied.append(path)
            raise PermissionError(errno.EACCES, "Permission denied", str(path))
        return open(path, *args, **kwargs)

    return opener, denied


def _ids(answer):
    return [op["id"] for op in answer["ops"]]


def _timed_ids_by_device_time():
    """The fixture's rows, costliest kernel first, as report ids."""
    order = sorted(
        range(len(STALL_OPS)), key=lambda position: -STALL_OPS[position].kernel_ns
    )
    return [_perf_id(position) for position in order]


class TestSelection:
    def test_by_default_it_reads_the_costliest_ops_by_device_time(self, captured):
        registry, handle = captured

        answer = stall_breakdown.stall_breakdown(registry, handle, limit=3)

        assert answer["selection"] == "top_device_time"
        assert set(_ids(answer)) == set(_timed_ids_by_device_time()[:3])
        assert answer["matched"] == len(STALL_OPS)
        assert answer["returned"] == 3

    def test_a_limit_is_capped(self, captured):
        registry, handle = captured

        answer = stall_breakdown.stall_breakdown(registry, handle, limit=1000)

        assert answer["returned"] == min(len(STALL_OPS), MAX_DETAILED_LIMIT)

    def test_perf_ids_read_those_rows_once_each(self, captured):
        registry, handle = captured
        wanted = [
            _perf_id(UNPACK_BOUND_POSITION),
            int(_perf_id(INPUT_STARVED_POSITION)),
            _perf_id(UNPACK_BOUND_POSITION),
        ]

        answer = stall_breakdown.stall_breakdown(registry, handle, perf_ids=wanted)

        assert answer["selection"] == "perf_ids"
        assert _ids(answer) == [
            _perf_id(INPUT_STARVED_POSITION),
            _perf_id(UNPACK_BOUND_POSITION),
        ]
        assert answer["matched"] == 2

    @pytest.mark.parametrize(
        "op_code",
        ["Untilize", "untilize", "  UNTILIZE  "],
        ids=["exact", "lower", "padded"],
    )
    def test_an_op_code_reads_every_call_whatever_its_case(self, captured, op_code):
        registry, handle = captured

        answer = stall_breakdown.stall_breakdown(registry, handle, op_code=op_code)

        assert answer["selection"] == "op_code"
        assert answer["op_code"] == op_code
        assert _ids(answer) == [
            _perf_id(INPUT_STARVED_POSITION),
            _perf_id(OUTPUT_BLOCKED_POSITION),
        ]

    def test_an_op_codes_calls_are_ranked_before_the_limit_cuts_them(self, tmp_path):
        """Its first call in CSV order is the less stalled, once its CB sums are cut."""
        rows = stall_rows()
        rows[INPUT_STARVED_POSITION] = {
            **rows[INPUT_STARVED_POSITION],
            CB_WAIT_FRONT: "880",
            CB_RESERVE_BACK: "88",
        }
        write_ops_perf(tmp_path / "first-is-least", rows)
        registry, handle = _load(tmp_path / "first-is-least")

        answer = stall_breakdown.stall_breakdown(
            registry, handle, op_code="Untilize", limit=1
        )

        assert _ids(answer) == [_perf_id(OUTPUT_BLOCKED_POSITION)]
        assert answer["matched"] == 2

    def test_only_the_calls_an_op_code_returns_are_read_in_full(self, captured):
        """A decode loop calls one op code thousands of times."""
        registry, handle = captured

        with patch.object(
            stall_breakdown, "_op_entry", wraps=stall_breakdown._op_entry
        ) as read:
            answer = stall_breakdown.stall_breakdown(
                registry, handle, op_code="Untilize", limit=1
            )

        assert answer["matched"] == 2
        assert read.call_count == 1

    def test_a_limit_cuts_an_op_codes_ranking_without_reordering_it(self, tmp_path):
        """Every op as one op code: stalled ops, then ties on no stall and on device
        time, which the cut keeps in the order the full ranking gives them."""
        rows = [{**row, "OP CODE": "Untilize"} for row in stall_rows()]
        write_ops_perf(tmp_path / "one-op-code", rows)
        registry, handle = _load(tmp_path / "one-op-code")

        def ops(limit):
            return stall_breakdown.stall_breakdown(
                registry, handle, op_code="Untilize", limit=limit
            )["ops"]

        ranked = ops(len(STALL_OPS))
        assert len(ranked) == len(STALL_OPS)
        for limit in range(1, len(STALL_OPS)):
            assert ops(limit) == ranked[:limit]

    def test_perf_ids_are_all_answered_whatever_the_limit(self, captured):
        registry, handle = captured
        wanted = [_perf_id(INPUT_STARVED_POSITION), _perf_id(UNPACK_BOUND_POSITION)]

        answer = stall_breakdown.stall_breakdown(
            registry, handle, perf_ids=wanted, limit=1
        )

        assert answer["returned"] == 2

    def test_a_long_perf_id_is_cut_in_its_refusal(self, captured):
        registry, handle = captured
        long_id = "9" * 500
        shown = repr(long_id)

        with pytest.raises(ValueError) as refusal:
            stall_breakdown.stall_breakdown(registry, handle, perf_ids=[long_id])

        assert long_id not in str(refusal.value)
        assert re.search(
            re.escape(f"{shown[:MAX_ECHOED_CHARS]}... ({len(shown)} characters)"),
            str(refusal.value),
        )

    def test_an_op_code_matches_a_calls_raw_op_code(self, tmp_path):
        """tt-perf-report adds a matmul's shapes to its op code; an agent passes the
        raw one, as `MatmulDeviceOperation`."""
        generate = tools._generate_canonical_report

        def with_shapes(instance, **overrides):
            report = generate(instance, **overrides)
            for row in report["report"]:
                if row.get("raw_op_code") == "Untilize":
                    row["op_code"] = "Untilize 32 x 64"
            return report

        with patch.object(tools, "_generate_canonical_report", side_effect=with_shapes):
            registry, handle = _load(_write(tmp_path / "shaped"))
            answer = stall_breakdown.stall_breakdown(
                registry, handle, op_code="untilize"
            )

        assert _ids(answer) == [
            _perf_id(INPUT_STARVED_POSITION),
            _perf_id(OUTPUT_BLOCKED_POSITION),
        ]
        assert {op["op_code"] for op in answer["ops"]} == {"Untilize 32 x 64"}

    def test_an_unknown_op_code_is_refused_with_the_reports_op_codes(self, captured):
        registry, handle = captured

        with pytest.raises(ValueError, match="'Untilize', 'Embeddings'"):
            stall_breakdown.stall_breakdown(registry, handle, op_code="Matmul")

    @pytest.mark.parametrize(
        ("arguments", "match"),
        [
            ({"perf_ids": ["2"], "op_code": "Untilize"}, "not both"),
            ({"perf_ids": []}, "non-empty list"),
            ({"perf_ids": "2"}, "non-empty list"),
            ({"perf_ids": [True]}, "not a performance row id"),
            ({"perf_ids": [str(i) for i in range(MAX_DETAILED_LIMIT + 1)]}, "at most"),
            ({"perf_ids": ["9999"]}, "not an operation_id"),
            ({"op_code": 7}, "op_code must be text"),
            ({"op_code": "x" * 300}, "of at most 256"),
            ({"limit": "many"}, "limit must be"),
        ],
    )
    def test_a_bad_argument_is_refused_by_name(self, captured, arguments, match):
        registry, handle = captured

        with pytest.raises(ValueError, match=match):
            stall_breakdown.stall_breakdown(registry, handle, **arguments)

    def test_a_signpost_is_refused(self, tmp_path):
        rows = stall_rows()
        rows.insert(0, signpost("PERF_START", rows[0]))
        write_ops_perf(tmp_path / "signposted", rows)
        write_device_log(tmp_path / "signposted")
        registry, handle = _load(tmp_path / "signposted")

        with pytest.raises(ValueError, match="is the signpost 'PERF_START"):
            stall_breakdown.stall_breakdown(registry, handle, perf_ids=[_perf_id(0)])


class TestRanking:
    def test_ops_rank_by_stalled_device_time_and_ops_without_one_come_last(
        self, captured
    ):
        registry, handle = captured

        ops = stall_breakdown.stall_breakdown(registry, handle, limit=25)["ops"]
        stalled = [op["stalled_us"] for op in ops if op["stalled_us"] is not None]

        assert stalled == sorted(stalled, reverse=True)
        assert ops[: len(stalled)] == [op for op in ops if op["stalled_us"] is not None]
        unstalled = [op["device_time"] for op in ops[len(stalled) :]]
        assert unstalled == sorted(unstalled, reverse=True)

    def test_a_cb_polls_stalled_time_is_its_average_per_core(self, captured):
        registry, handle = captured

        op = stall_breakdown.stall_breakdown(
            registry, handle, perf_ids=[_perf_id(INPUT_STARVED_POSITION)]
        )["ops"][0]

        assert op["stalled_us"] == pytest.approx(
            op["device_time"] * op["stalled_percent"] / 100, abs=1e-3
        )
        assert op["stalled_us"] == (
            op["threads"][0]["instrumentation"]["cb_wait_front"]["per_core_us"]
        )
        assert op["largest_wait"]["label"] == "cb_wait_front"
        assert op["largest_wait"]["source"] == "instrumentation"

    def test_each_counter_reads_its_own_min_and_max(self, captured):
        registry, handle = captured

        op = stall_breakdown.stall_breakdown(
            registry, handle, perf_ids=[_perf_id(INPUT_STARVED_POSITION)]
        )["ops"][0]
        stall = counter_average(INPUT_STARVED_POSITION, "Thread 2 Stall Rate")

        assert op["threads"][2]["hardware_counters"]["stall_rate"] == {
            "avg": stall,
            "min": round(stall * 0.9, 3),
            "max": round(stall * 1.1, 3),
        }

    def test_each_row_reads_as_every_tool_reads_one(self, captured):
        registry, handle = captured

        op = stall_breakdown.stall_breakdown(
            registry, handle, perf_ids=[_perf_id(UNPACK_BOUND_POSITION)]
        )["ops"][0]

        assert {"id", "op_code", "device_time", "cores", "bound"} <= op.keys()
        assert op["device"] == 0
        assert op["core_count"] == STALL_OPS[UNPACK_BOUND_POSITION].cores

    def test_an_op_without_a_compute_kernel_has_its_cb_copy_ignored(self, captured):
        registry, handle = captured

        op = stall_breakdown.stall_breakdown(
            registry, handle, perf_ids=[_perf_id(STALE_CB_POSITION)]
        )["ops"][0]

        assert op["has_compute_kernel"] is False
        assert op["counters"]["state"] == "no_value"
        assert op["cb_waits"] == {"state": "ignored", "fill_hint": None}
        assert op["stalled_us"] is None

    @pytest.mark.parametrize(
        ("device_1_kernel_ns", "kept"), [(30_000, 1), (20_000, 0)], ids=["1", "0"]
    )
    def test_a_merged_ops_cells_and_counters_are_the_kept_devices(
        self, tmp_path, device_1_kernel_ns, kept
    ):
        """tt-perf-report keeps the slower device's row; its CB sums, core count and
        counters must all be that row's, not mixed with the other device's."""
        theirs = StallOp(
            64,
            device_1_kernel_ns,
            COMPUTE,
            640_000,
            64_000,
            {**INPUT_STARVED, "Thread 0 Stall Rate": 9.0},
        )
        write_ops_perf(
            tmp_path / "two-devices",
            two_device_stall_rows({INPUT_STARVED_POSITION: theirs}),
        )
        registry, handle = _load(tmp_path / "two-devices")
        merged = next(
            row
            for row in tools.canonical_report(registry, handle)["report"]
            if not tools.is_signpost_row(row)
        )
        ours = STALL_OPS[INPUT_STARVED_POSITION]
        expected = theirs if kept == 1 else ours

        stall_rate = (
            9.0
            if kept == 1
            else counter_average(INPUT_STARVED_POSITION, "Thread 0 Stall Rate")
        )
        by_id = stall_breakdown.stall_breakdown(
            registry, handle, perf_ids=[merged["id"]]
        )["ops"][0]
        # The op code's other call stalls less, so the ranking puts this row first.
        ranked = stall_breakdown.stall_breakdown(
            registry, handle, op_code="Untilize", limit=2
        )["ops"]
        by_op_code = ranked[0]

        assert len(ranked) == 2
        assert by_op_code["id"] == merged["id"]
        assert ranked[1]["stalled_us"] < by_op_code["stalled_us"]
        for op in (by_id, by_op_code):
            front = op["threads"][0]
            assert op["device"] == kept
            assert op["core_count"] == expected.cores
            assert front["hardware_counters"]["stall_rate"]["avg"] == stall_rate
            assert front["instrumentation"]["cb_wait_front"]["per_core_us"] == round(
                expected.cb_wait_front_ns / expected.cores / 1000, 3
            )

    def test_the_report_total_is_every_ops_device_time_not_the_returned_ones(
        self, captured
    ):
        registry, handle = captured
        rows = tools.canonical_report(registry, handle)["report"]

        answer = stall_breakdown.stall_breakdown(registry, handle, limit=1)

        assert answer["returned"] == 1
        assert answer["report_device_time_total"] == pytest.approx(
            sum(tools.countable_device_time(row) or 0.0 for row in rows), abs=1e-3
        )


class TestCapture:
    def test_it_says_which_groups_the_capture_filled(self, captured):
        registry, handle = captured

        answer = stall_breakdown.stall_breakdown(registry, handle)

        assert answer["capture_groups"] == {
            "instrn": "filled",
            "unpack": "filled",
            "pack": "filled",
        }
        assert answer["sum_profiling"] is True
        assert "fill_hint" not in answer

    def test_a_capture_without_the_unpack_and_pack_groups_says_what_fills_them(
        self, tmp_path
    ):
        """Its threads still read, but the math pipeline's stalls need both groups."""
        unpack_or_pack = (
            "Packer Utilization",
            "Unpacker0 Busy T0 Util",
            "Data Hazard Stall Rate",
            "Math Scoreboard Stall Rate",
        )
        rows = [
            {
                column: cell
                for column, cell in row.items()
                if not column.startswith(unpack_or_pack)
            }
            for row in stall_rows()
        ]
        write_ops_perf(tmp_path / "instrn-only", rows)
        registry, handle = _load(tmp_path / "instrn-only")

        answer = stall_breakdown.stall_breakdown(registry, handle)

        assert answer["capture_groups"] == {
            "instrn": "filled",
            "unpack": "not_captured",
            "pack": "not_captured",
        }
        assert answer["sum_profiling"] is True
        assert COUNTERS_FLAG in answer["fill_hint"]

    def test_the_note_carries_the_blind_spot_and_the_sum_over_cores(self, captured):
        registry, handle = captured

        note = stall_breakdown.stall_breakdown(registry, handle)["note"]

        assert "counters cannot see" in note
        assert "sums each over the op's cores" in note
        assert "never add up" in note
        assert "never their sum" in note

    def test_without_sum_profiling_it_answers_and_names_the_flag(
        self, without_sum_profiling
    ):
        registry, handle = without_sum_profiling

        answer = stall_breakdown.stall_breakdown(
            registry, handle, perf_ids=[_perf_id(INPUT_STARVED_POSITION)]
        )
        op = answer["ops"][0]

        assert op["cb_waits"] == {
            "state": "not_captured",
            "fill_hint": pipeline_stalls.CB_WAITS_FILL_HINT,
        }
        assert (
            op["stalled_percent"]
            == op["threads"][2]["hardware_counters"]["stall_rate"]["avg"]
        )
        assert op["largest_wait"]["downstream"] is True
        assert answer["sum_profiling"] is False
        assert COUNTERS_FLAG in answer["fill_hint"]
        assert SUM_FLAG in answer["fill_hint"]
        assert SUM_FLAG in answer["caveat"]
        assert "near 0 does not mean" in answer["caveat"]

    def test_a_partitioned_capture_without_sum_profiling_carries_both_caveats(
        self, tmp_path
    ):
        rows = [
            {**row, "SUB DEVICE ID": str(position % 2)}
            for position, row in enumerate(stall_rows(sum_profiling=False))
        ]
        write_ops_perf(tmp_path / "partitioned", rows)
        registry, handle = _load(tmp_path / "partitioned")

        caveat = stall_breakdown.stall_breakdown(registry, handle)["caveat"]

        assert "spans 2 sub-devices" in caveat
        assert stall_breakdown.NO_SUM_PROFILING_CAVEAT in caveat

    def test_a_capture_without_sum_profiling_is_read_for_it_once(
        self, without_sum_profiling
    ):
        """Through the counters route's reader, once for the handle."""
        registry, handle = without_sum_profiling

        with patch.object(
            OpsPerformanceReportQueries,
            "read_sum_profiled",
            wraps=OpsPerformanceReportQueries.read_sum_profiled,
        ) as read:
            stall_breakdown.stall_breakdown(registry, handle)
            stall_breakdown.stall_breakdown(registry, handle, op_code="Untilize")

        read.assert_called_once()

    def test_two_handles_on_one_capture_read_it_once(self, tmp_path):
        write_stall_capture(tmp_path / "no-sum", sum_profiling=False)
        registry = ReportRegistry()
        handles = [
            load_report(registry, performance_path=str(tmp_path / "no-sum"))["handle"]
            for _ in range(2)
        ]

        with patch.object(
            OpsPerformanceReportQueries,
            "read_sum_profiled",
            wraps=OpsPerformanceReportQueries.read_sum_profiled,
        ) as read:
            answers = [
                stall_breakdown.stall_breakdown(registry, handle) for handle in handles
            ]

        assert handles[0] != handles[1]
        assert [answer["sum_profiling"] for answer in answers] == [False, False]
        read.assert_called_once()

    def test_a_failed_sum_profiling_read_fails_the_call_and_is_not_kept(self, captured):
        """Kept, a passing read error would read as "no sum profiling", naming the flag,
        for the capture's lifetime."""
        registry, handle = captured
        opener, denied = _ops_csv_unreadable_once()

        with patch("ttnn_visualizer.csv_queries.open", side_effect=opener, create=True):
            with pytest.raises(PermissionError):
                stall_breakdown.stall_breakdown(registry, handle)
            scan = csv_queries._sum_profiled.cache_info()
            answer = stall_breakdown.stall_breakdown(registry, handle)

        assert len(denied) == 1
        # The scan ran once and kept nothing: the refused open was its own.
        assert (scan.misses, scan.currsize) == (1, 0)
        assert answer["sum_profiling"] is True

    def test_cb_waits_on_a_dropped_devices_rows_alone_still_mean_sum_profiling(
        self, tmp_path
    ):
        """Whether a capture was sum-profiled is a fact about its CSV, not about the rows
        tt-perf-report keeps: here the slower device's row, without CB sums, is kept."""
        rows, _ = dropped_cb_sum_rows()
        directory = tmp_path / "two-devices"
        write_ops_perf(directory, rows)
        write_device_log(directory)
        registry, handle = _load(directory)
        merged = next(
            row
            for row in tools.canonical_report(registry, handle)["report"]
            if not tools.is_signpost_row(row)
        )

        answer = stall_breakdown.stall_breakdown(
            registry, handle, perf_ids=[merged["id"]]
        )
        op = answer["ops"][0]

        assert op["device"] == 0
        assert op["cb_waits"] == {"state": "no_value", "fill_hint": None}
        assert answer["sum_profiling"] is True
        assert "fill_hint" not in answer
        assert "caveat" not in answer

    @pytest.mark.parametrize(
        "rows",
        [
            pytest.param(smoke_rows, id="no-counters"),
            pytest.param(
                lambda: [
                    {**row, stat_column("FPU Util", "Avg"): "9.4"}
                    for row in smoke_rows()
                ],
                id="no-instrn-group",
            ),
        ],
    )
    def test_a_capture_without_the_thread_counters_is_refused_naming_both_flags(
        self, tmp_path, rows
    ):
        write_ops_perf(tmp_path / "plain", rows())
        registry, handle = _load(tmp_path / "plain")

        with pytest.raises(ValueError) as refusal:
            stall_breakdown.stall_breakdown(registry, handle)

        assert COUNTERS_FLAG in str(refusal.value)
        assert SUM_FLAG in str(refusal.value)

    def test_a_capture_with_cb_waits_alone_is_refused_as_out_of_scope(self, tmp_path):
        rows = [
            {
                column: cell
                for column, cell in row.items()
                if not column.endswith(("(%)", "(ratio)"))
            }
            for row in stall_rows()
        ]
        write_ops_perf(tmp_path / "sums-only", rows)
        registry, handle = _load(tmp_path / "sums-only")

        with pytest.raises(ValueError, match="CB waits alone are out of scope"):
            stall_breakdown.stall_breakdown(registry, handle)

    def test_wait_labels_the_capture_lacks_are_named_once(self, tmp_path):
        rows = [
            {column: cell for column, cell in row.items() if "Semaphore" not in column}
            for row in stall_rows()
        ]
        write_ops_perf(tmp_path / "fewer", rows)
        registry, handle = _load(tmp_path / "fewer")

        answer = stall_breakdown.stall_breakdown(registry, handle)

        assert len(answer["wait_labels_absent"]) == 6
        assert "wait_labels_absent" not in stall_breakdown.stall_breakdown(
            *_load(_write(tmp_path / "full"))
        )

    def test_the_counters_are_read_once_for_it_and_hw_utilisation(self, captured):
        registry, handle = captured

        with patch.object(
            hardware_counters, "read_table", wraps=hardware_counters.read_table
        ) as read:
            stall_breakdown.stall_breakdown(registry, handle)
            hw_utilisation.hw_utilisation(registry, handle)
            stall_breakdown.stall_breakdown(registry, handle, op_code="Untilize")

        assert read.call_count == 1


class TestTransport:
    def test_load_report_lists_it_only_for_a_capture_with_thread_counters(
        self, tmp_path
    ):
        write_stall_capture(tmp_path / "captured")
        write_ops_perf(tmp_path / "plain", smoke_rows())
        registry = ReportRegistry()

        captured = load_report(registry, performance_path=str(tmp_path / "captured"))
        plain = load_report(registry, performance_path=str(tmp_path / "plain"))

        assert "stall_breakdown" in captured["answerable"]
        assert "stall_breakdown" in plain["unanswerable"]

    def test_load_report_lists_it_as_unanswerable_for_a_capture_without_instrn(
        self, tmp_path
    ):
        """A capture of the fpu group alone has counters, which `hw_utilisation`
        answers, but no thread's stall rate."""
        rows = [{**row, stat_column("FPU Util", "Avg"): "9.4"} for row in smoke_rows()]
        write_ops_perf(tmp_path / "fpu-only", rows)

        inventory = load_report(
            ReportRegistry(), performance_path=str(tmp_path / "fpu-only")
        )

        assert "hw_utilisation" in inventory["answerable"]
        assert "stall_breakdown" in inventory["unanswerable"]

    def test_it_is_registered_and_answers_a_call(self, captured):
        registry, handle = captured
        table = server._tool_table(registry)

        response = server.handle_message(
            {
                "jsonrpc": "2.0",
                "id": 7,
                "method": "tools/call",
                "params": {
                    "name": "stall_breakdown",
                    "arguments": {"handle": handle, "op_code": "Untilize"},
                },
            },
            table,
        )
        answer = json.loads(response["result"]["content"][0]["text"])

        assert table["stall_breakdown"]["title"]
        assert answer["returned"] == 2

    def test_a_refusal_comes_back_as_a_tool_error(self, tmp_path):
        write_ops_perf(tmp_path / "plain", smoke_rows())
        registry, handle = _load(tmp_path / "plain")

        response = server.handle_message(
            {
                "jsonrpc": "2.0",
                "id": 8,
                "method": "tools/call",
                "params": {"name": "stall_breakdown", "arguments": {"handle": handle}},
            },
            server._tool_table(registry),
        )

        assert response["result"]["isError"] is True
        assert SUM_FLAG in response["result"]["content"][0]["text"]

    def test_a_failed_sum_profiling_read_comes_back_as_a_tool_error(self, captured):
        """Not as an answer without sum profiling."""
        registry, handle = captured
        opener, _ = _ops_csv_unreadable_once()

        with patch("ttnn_visualizer.csv_queries.open", side_effect=opener, create=True):
            response = server.handle_message(
                {
                    "jsonrpc": "2.0",
                    "id": 9,
                    "method": "tools/call",
                    "params": {
                        "name": "stall_breakdown",
                        "arguments": {"handle": handle},
                    },
                },
                server._tool_table(registry),
            )
        text = response["result"]["content"][0]["text"]
        scan = csv_queries._sum_profiled.cache_info()

        assert response["result"]["isError"] is True
        assert text.startswith("stall_breakdown failed:")
        assert "Permission denied" in text
        assert (scan.misses, scan.currsize) == (1, 0)

    def test_the_schema_caps_perf_ids_at_the_enforced_limit(self):
        schema = server._tool_table(ReportRegistry())["stall_breakdown"]["schema"]

        assert schema["properties"]["perf_ids"]["maxItems"] == (
            stall_breakdown.MAX_PERF_IDS
        )
        assert stall_breakdown.MAX_PERF_IDS == MAX_DETAILED_LIMIT

    def test_each_perf_id_is_described_as_every_tools_perf_id_is(self):
        schema = server._tool_table(ReportRegistry())["stall_breakdown"]["schema"]

        assert schema["properties"]["perf_ids"]["items"] == server._PERF_ID_SCHEMA

    def test_the_canonical_rows_carry_the_raw_columns_the_stalls_read(self, captured):
        registry, handle = captured

        row = tools.canonical_report(registry, handle)["report"][INPUT_STARVED_POSITION]

        assert row["core_count"] == str(STALL_OPS[INPUT_STARVED_POSITION].cores)
        assert stall_breakdown._raw_cells(row)[
            pipeline_stalls.CORE_COUNT_COLUMN
        ] == str(STALL_OPS[INPUT_STARVED_POSITION].cores)
