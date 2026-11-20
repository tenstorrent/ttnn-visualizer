# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""One op's stalls per thread, as the counters route and `stall_breakdown` both read
them. #2372"""

import csv
import io
from typing import Any, Dict, List

import pytest
from ttnn_visualizer import hardware_counters, pipeline_stalls
from ttnn_visualizer.csv_queries import OpsPerformanceReportQueries
from ttnn_visualizer.exceptions import DataFormatError
from ttnn_visualizer.hardware_counters import CounterFamily, CounterHeader
from ttnn_visualizer.pipeline_stalls import (
    CbWaitZone,
    StallSource,
    StallState,
    operation_stalls,
)
from ttnn_visualizer.tests.stall_capture import (
    CB_RESERVE_BACK,
    CB_WAIT_FRONT,
    CORE_COUNT,
    INPUT_STARVED_POSITION,
    KERNEL_DURATION,
    NO_CB_POSITION,
    OUTPUT_BLOCKED_POSITION,
    PER_CORE_KERNEL,
    STALE_CB_POSITION,
    STALL_OPS,
    UNNAMED_STALL_POSITION,
    UNPACK_BOUND_POSITION,
    UNRECORDED_POSITION,
    counter_average,
    kernel_share,
    per_core_kernel_us,
    stall_rows,
)


@pytest.fixture(scope="module")
def rows() -> List[Dict[str, str]]:
    return stall_rows()


def _never_asked() -> bool:
    raise AssertionError("asked whether the capture had sum profiling")


def _stalls(row: Dict[str, str], sum_profiled=_never_asked) -> Dict[str, Any]:
    header = hardware_counters.discover(row.keys())
    return operation_stalls(row, header.row_reader(row), header, sum_profiled)


def _thread(stalls: Dict[str, Any], thread: str) -> Dict[str, Any]:
    return next(entry for entry in stalls["threads"] if entry["thread"] == thread)


def _counters(stalls: Dict[str, Any], thread: str) -> Dict[str, Any]:
    counters = _thread(stalls, thread)["hardware_counters"]
    assert counters is not None
    return counters


def _without(row: Dict[str, str], dropped: str) -> Dict[str, str]:
    """The row without every column of the labels containing `dropped`."""
    return {column: cell for column, cell in row.items() if dropped not in column}


class TestLabels:
    @pytest.mark.parametrize("thread", pipeline_stalls.THREADS)
    def test_every_label_it_reads_is_one_tt_llk_names(self, thread):
        assert hardware_counters.family_of(thread.issue_rate) is (
            CounterFamily.INSTRUCTION_ISSUE
        )
        for label in (
            thread.stall_rate,
            thread.stall_overlap,
            *thread.waits,
            *thread.math_pipeline_stalls,
        ):
            assert hardware_counters.family_of(label) is CounterFamily.STALLS, label

    def test_every_named_wait_belongs_to_one_thread(self):
        waits = [label for thread in pipeline_stalls.THREADS for label in thread.waits]

        assert len(waits) == len(set(waits))

    def test_the_raw_columns_are_ones_the_agent_rows_carry(self):
        """`stall_breakdown` reads them back through the report's detail columns."""
        carried = {
            *OpsPerformanceReportQueries.PASSTHROUGH_COLUMNS.values(),
            *OpsPerformanceReportQueries.DETAIL_COLUMNS.values(),
        }

        assert set(pipeline_stalls.RAW_COLUMNS) <= carried


class TestCbWaits:
    def test_the_csvs_sum_is_divided_by_the_ops_core_count(self, rows):
        op = STALL_OPS[INPUT_STARVED_POSITION]
        stalls = _stalls(rows[INPUT_STARVED_POSITION])

        front = _thread(stalls, "t0")["instrumentation"]
        assert front == {
            CbWaitZone.WAIT_FRONT.value: {
                "sum_us": op.cb_wait_front_ns / 1000,
                "per_core_us": op.cb_wait_front_ns / op.cores / 1000,
                "kernel_share_percent": kernel_share(
                    INPUT_STARVED_POSITION, op.cb_wait_front_ns
                ),
            }
        }
        assert stalls["core_count"] == op.cores
        assert stalls["kernel_duration_us"] == op.kernel_ns / 1000

    def test_cb_reserve_back_is_the_pack_threads(self, rows):
        op = STALL_OPS[OUTPUT_BLOCKED_POSITION]
        stalls = _stalls(rows[OUTPUT_BLOCKED_POSITION])

        back = _thread(stalls, "t2")["instrumentation"][CbWaitZone.RESERVE_BACK.value]
        assert back["kernel_share_percent"] == kernel_share(
            OUTPUT_BLOCKED_POSITION, op.cb_reserve_back_ns
        )
        assert _thread(stalls, "t1")["instrumentation"] is None

    @pytest.mark.parametrize("cell", ["0", "-8", "1e30", "", "x"])
    def test_without_a_usable_core_count_only_the_sum_is_given(self, rows, cell):
        """A count past what a JSON number holds would fail the route's answer."""
        row = {**rows[INPUT_STARVED_POSITION], CORE_COUNT: cell}

        stalls = _stalls(row)
        front = _thread(stalls, "t0")["instrumentation"]["cb_wait_front"]

        assert stalls["core_count"] is None
        assert front["sum_us"] is not None
        assert front["per_core_us"] is None
        assert front["kernel_share_percent"] is None
        assert stalls["stalled_thread"] == "t2"

    @pytest.mark.parametrize(
        ("cell", "count"), [("88", 88), ("88.0", 88), (str(2**53 - 1), 2**53 - 1)]
    )
    def test_a_core_count_is_read_as_a_whole_number(self, rows, cell, count):
        row = {**rows[INPUT_STARVED_POSITION], CORE_COUNT: cell}

        assert pipeline_stalls.core_count(row) == count

    @pytest.mark.parametrize("cell", ["", "0", "-26000"])
    def test_without_a_kernel_duration_there_is_no_share(self, rows, cell):
        row = {**rows[INPUT_STARVED_POSITION], KERNEL_DURATION: cell}

        stalls = _stalls(row)
        front = _thread(stalls, "t0")["instrumentation"]["cb_wait_front"]

        assert front["per_core_us"] is not None
        assert front["kernel_share_percent"] is None
        assert stalls["kernel_duration_us"] is None

    def test_an_op_without_a_compute_kernel_has_its_copied_sums_ignored(self, rows):
        """tt-metal repeats the previous op's sums on it, so they are never read."""
        stale = rows[STALE_CB_POSITION]
        assert stale[CB_WAIT_FRONT] == rows[STALE_CB_POSITION - 1][CB_WAIT_FRONT]

        stalls = _stalls(stale)

        assert stalls["has_compute_kernel"] is False
        assert stalls["cb_waits"] == {
            "state": StallState.IGNORED.value,
            "fill_hint": None,
        }
        assert all(entry["instrumentation"] is None for entry in stalls["threads"])
        assert stalls["stalled_percent"] is None
        assert stalls["stalled_us"] is None
        assert stalls["largest_wait"] is None

    def test_an_op_without_a_compute_kernel_or_sums_has_no_value(self, rows):
        stalls = _stalls(rows[NO_CB_POSITION])

        assert stalls["cb_waits"]["state"] == StallState.NO_VALUE.value
        assert stalls["counters"]["state"] == StallState.NO_VALUE.value

    @pytest.mark.parametrize(
        ("sum_profiled", "state", "fill_hint"),
        [
            (False, StallState.NOT_CAPTURED, pipeline_stalls.CB_WAITS_FILL_HINT),
            (True, StallState.NO_VALUE, None),
        ],
    )
    def test_a_compute_op_without_sums_says_whether_the_capture_had_them(
        self, rows, sum_profiled, state, fill_hint
    ):
        row = {**rows[INPUT_STARVED_POSITION], CB_WAIT_FRONT: "", CB_RESERVE_BACK: ""}

        stalls = _stalls(row, lambda: sum_profiled)

        assert stalls["cb_waits"] == {"state": state.value, "fill_hint": fill_hint}
        assert _thread(stalls, "t0")["instrumentation"] is None

    def test_the_cb_sums_fill_hint_names_the_sum_profiling_flag(self):
        assert pipeline_stalls.CB_WAITS_FILL_HINT.endswith(
            pipeline_stalls.SUM_PROFILING_FLAG
        )

    @pytest.mark.parametrize(
        "position", [INPUT_STARVED_POSITION, STALE_CB_POSITION, NO_CB_POSITION]
    )
    def test_the_capture_is_asked_of_a_compute_op_without_sums_alone(
        self, rows, position
    ):
        """The route would otherwise read the whole CSV for any op."""
        assert _stalls(rows[position])["cb_waits"]["state"] != (
            StallState.NOT_CAPTURED.value
        )


class TestCaptureHasCbWaits:
    @staticmethod
    def _csv(rows: List[Dict[str, str]]) -> io.StringIO:
        header = list(rows[0].keys())
        lines = [",".join(header)] + [
            ",".join(f'"{row.get(column, "")}"' for column in header) for row in rows
        ]
        return io.StringIO("\n".join(lines) + "\n")

    def test_a_compute_op_with_a_cb_sum_means_sum_profiling(self, rows):
        assert pipeline_stalls.capture_has_cb_waits(self._csv(rows))

    def test_without_one_it_had_none(self):
        assert not pipeline_stalls.capture_has_cb_waits(
            self._csv(stall_rows(sum_profiling=False))
        )

    def test_a_copied_sum_on_an_op_without_a_compute_kernel_does_not_count(self, rows):
        stale_only = [
            (
                row
                if position == STALE_CB_POSITION
                else {**row, CB_WAIT_FRONT: "", CB_RESERVE_BACK: ""}
            )
            for position, row in enumerate(rows)
        ]

        assert not pipeline_stalls.capture_has_cb_waits(self._csv(stale_only))

    def test_a_csv_the_reader_refuses_is_a_format_error(self):
        oversized = "x" * (csv.field_size_limit() + 1)
        source = io.StringIO(f"{CB_WAIT_FRONT},OP CODE\n,{oversized}\n")

        with pytest.raises(DataFormatError, match="could not be read"):
            pipeline_stalls.capture_has_cb_waits(source)

    def test_a_csv_without_the_columns_had_none(self):
        assert not pipeline_stalls.capture_has_cb_waits(io.StringIO("OP CODE\nAdd\n"))


class TestCounters:
    def test_each_thread_reads_its_issue_and_stall_rates_across_cores(self, rows):
        stalls = _stalls(rows[INPUT_STARVED_POSITION])

        for thread, role, number in (
            ("t0", "unpack", 0),
            ("t1", "math", 1),
            ("t2", "pack", 2),
        ):
            entry = _thread(stalls, thread)
            stall = counter_average(
                INPUT_STARVED_POSITION, f"Thread {number} Stall Rate"
            )
            assert entry["role"] == role
            assert entry["hardware_counters"]["stall_rate"] == {
                "avg": stall,
                "min": round(stall * 0.9, 3),
                "max": round(stall * 1.1, 3),
            }
            assert entry["hardware_counters"]["issue_rate"]["avg"] == counter_average(
                INPUT_STARVED_POSITION, f"T{number} Instrn Issue Rate"
            )

    def test_named_waits_rank_by_average_and_the_zeros_are_named(self, rows):
        counters = _counters(_stalls(rows[INPUT_STARVED_POSITION]), "t0")

        assert [wait["label"] for wait in counters["waits"]] == [
            "THCON Idle Wait T0",
            "Unpack Idle Wait T0",
            "CFG Idle Wait T0",
        ]
        assert counters["zero_waits"] == [
            "Unpack Waiting on Pack (T0)",
            "MOVE Idle Wait T0",
            "Semaphore Zero Wait T0",
            "Semaphore Full Wait T0",
            "SrcA Clear Wait",
            "SrcB Clear Wait",
        ]

    def test_a_wait_above_0_on_some_core_is_listed_though_its_average_rounds_to_0(
        self, rows
    ):
        counters = _counters(_stalls(rows[UNPACK_BOUND_POSITION]), "t0")
        cfg = next(
            wait for wait in counters["waits"] if wait["label"] == "CFG Idle Wait T0"
        )

        assert cfg["avg"] == 0
        assert cfg["max"] == 0.05
        assert "CFG Idle Wait T0" not in counters["zero_waits"]

    def test_math_pipeline_stalls_are_the_math_threads_alone(self, rows):
        stalls = _stalls(rows[OUTPUT_BLOCKED_POSITION])

        assert [
            stall["label"] for stall in _counters(stalls, "t1")["math_pipeline_stalls"]
        ] == ["Math Scoreboard Stall Rate", "Data Hazard Stall Rate"]
        assert "math_pipeline_stalls" not in _counters(stalls, "t0")
        assert "math_pipeline_stalls" not in _counters(stalls, "t2")

    def test_stall_overlap_is_read_as_tt_llks_ratio(self, rows):
        overlap = _counters(_stalls(rows[INPUT_STARVED_POSITION]), "t2")[
            "stall_overlap"
        ]

        assert overlap["avg"] == counter_average(
            INPUT_STARVED_POSITION, "Stall Overlap T2"
        )

    def test_a_capture_without_the_instrn_group_is_not_captured(self, rows):
        row = _without(_without(rows[INPUT_STARVED_POSITION], "Stall Rate"), "Wait")

        stalls = _stalls(row)

        assert stalls["counters"] == {
            "state": StallState.NOT_CAPTURED.value,
            "fill_hint": pipeline_stalls.COUNTERS_FILL_HINT,
        }
        assert all(entry["hardware_counters"] is None for entry in stalls["threads"])
        assert stalls["stalled_percent"] == kernel_share(
            INPUT_STARVED_POSITION, STALL_OPS[INPUT_STARVED_POSITION].cb_wait_front_ns
        )

    def test_a_compute_op_whose_counters_were_not_recorded_has_no_value(self, rows):
        stalls = _stalls(rows[UNRECORDED_POSITION])

        assert stalls["has_compute_kernel"] is True
        assert stalls["counters"] == {
            "state": StallState.NO_VALUE.value,
            "fill_hint": None,
        }
        assert all(entry["hardware_counters"] is None for entry in stalls["threads"])
        assert stalls["cb_waits"]["state"] == StallState.FILLED.value

    def test_wait_labels_a_capture_with_the_thread_counters_lacks_are_named(self, rows):
        row = _without(rows[INPUT_STARVED_POSITION], "Semaphore")

        absent = pipeline_stalls.wait_labels_absent(
            hardware_counters.discover(row.keys())
        )

        assert absent == [
            "Semaphore Zero Wait T0",
            "Semaphore Full Wait T0",
            "Semaphore Zero Wait T1",
            "Semaphore Full Wait T1",
            "Semaphore Zero Wait T2",
            "Semaphore Full Wait T2",
        ]
        assert pipeline_stalls.wait_labels_absent(CounterHeader()) == []


class TestStalledShare:
    def test_it_is_the_largest_stall_or_cb_share_never_their_sum(self, rows):
        op = STALL_OPS[INPUT_STARVED_POSITION]
        stalls = _stalls(rows[INPUT_STARVED_POSITION])

        assert stalls["stalled_percent"] == kernel_share(
            INPUT_STARVED_POSITION, op.cb_wait_front_ns
        )
        assert stalls["stalled_thread"] == "t0"
        assert stalls["largest_wait"] == {
            "label": CbWaitZone.WAIT_FRONT.value,
            "source": StallSource.INSTRUMENTATION.value,
            "percent": stalls["stalled_percent"],
            "downstream": False,
        }

    def test_a_stall_rate_above_the_cb_share_sets_it_and_names_the_threads_wait(
        self, rows
    ):
        stalls = _stalls(rows[UNPACK_BOUND_POSITION])
        stall = counter_average(UNPACK_BOUND_POSITION, "Thread 0 Stall Rate")

        assert stalls["stalled_percent"] == stall
        assert stall > kernel_share(
            UNPACK_BOUND_POSITION, STALL_OPS[UNPACK_BOUND_POSITION].cb_wait_front_ns
        )
        # A wait can read above its thread's stall rate.
        assert stalls["largest_wait"] == {
            "label": "Unpack Idle Wait T0",
            "source": StallSource.HARDWARE_COUNTER.value,
            "percent": counter_average(UNPACK_BOUND_POSITION, "Unpack Idle Wait T0"),
            "downstream": False,
        }

    def test_the_packer_waiting_on_math_is_named_as_a_downstream_wait(self, rows):
        """Without the CB sums, the input-starved op's largest stall is the packer's,
        whose top wait only says that a stage before it held the pipeline up."""
        row = {**rows[INPUT_STARVED_POSITION], CB_WAIT_FRONT: "", CB_RESERVE_BACK: ""}

        stalls = _stalls(row, lambda: False)

        assert stalls["stalled_thread"] == "t2"
        assert stalls["largest_wait"] == {
            "label": "Semaphore Zero Wait T2",
            "source": StallSource.HARDWARE_COUNTER.value,
            "percent": counter_average(
                INPUT_STARVED_POSITION, "Semaphore Zero Wait T2"
            ),
            "downstream": True,
        }

    @pytest.mark.parametrize("thread", pipeline_stalls.THREADS)
    def test_a_downstream_wait_is_one_of_its_threads_waits(self, thread):
        assert set(thread.downstream_waits) <= set(thread.waits)

    def test_the_pack_cores_cb_poll_can_set_it(self, rows):
        stalls = _stalls(rows[OUTPUT_BLOCKED_POSITION])

        assert stalls["stalled_thread"] == "t2"
        assert stalls["largest_wait"]["label"] == CbWaitZone.RESERVE_BACK.value

    def test_a_cb_polls_stalled_time_is_its_own_average_per_core(self, rows):
        stalls = _stalls(rows[INPUT_STARVED_POSITION])

        assert stalls["stalled_us"] == (
            _thread(stalls, "t0")["instrumentation"]["cb_wait_front"]["per_core_us"]
        )

    def test_a_stall_rates_stalled_time_is_of_the_per_core_kernel_time(self, rows):
        """A stall rate is a share of each core's own counted cycles, so the op's device
        time, from its first core's start to its last's end, would overstate it."""
        stalls = _stalls(rows[UNPACK_BOUND_POSITION])

        assert stalls["stalled_us"] == pytest.approx(
            stalls["stalled_percent"] / 100 * per_core_kernel_us(UNPACK_BOUND_POSITION),
            abs=1e-3,
        )
        assert stalls["stalled_us"] < (
            stalls["stalled_percent"] / 100 * stalls["kernel_duration_us"]
        )

    def test_without_a_per_core_kernel_time_a_stall_rate_has_none(self, rows):
        row = {**rows[UNPACK_BOUND_POSITION], PER_CORE_KERNEL: ""}

        stalls = _stalls(row)

        assert stalls["stalled_percent"] is not None
        assert stalls["stalled_us"] is None

    def test_a_stall_no_named_wait_explains_names_none(self, rows):
        stalls = _stalls(rows[UNNAMED_STALL_POSITION])

        assert stalls["stalled_thread"] == "t1"
        assert stalls["stalled_percent"] == counter_average(
            UNNAMED_STALL_POSITION, "Thread 1 Stall Rate"
        )
        assert stalls["largest_wait"] is None
