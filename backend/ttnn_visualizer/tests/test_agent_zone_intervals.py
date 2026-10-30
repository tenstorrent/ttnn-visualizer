# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""`zone_intervals`: how long a zone that recurs within a run takes from one start to
the next, per device, core and RISC.

The fixtures write each RISC's rows in time order, as tt-metal does, and split runs the
way the reader must: at kernel starts and at changes of run host ID or trace replay.
#2155
"""

from itertools import zip_longest
from typing import List
from unittest.mock import patch

import pytest
from ttnn_visualizer import csv_queries
from ttnn_visualizer.agent import server, tools
from ttnn_visualizer.agent.handles import ReportRegistry, load_report
from ttnn_visualizer.event_logging import McpToolOutcome
from ttnn_visualizer.tests.smoke_capture import SMOKE_CAPTURE_DIR
from ttnn_visualizer.tests.test_agent_tools import (
    UNTYPED_HEADER,
    UNTYPED_ROWS,
    _write_devices,
)
from ttnn_visualizer.tests.test_device_log_columns import (
    MODERN_HEADER,
    PRE_RENAME_HEADER,
    modern_row,
    write_device_log,
)

# The fixtures' clock is 1000 MHz, so a thousand cycles is one microsecond.
RUN = 1024
LOOP = "LOOP"


def _zone(slot, x, y, risc, start, end, zone=LOOP, **ids):
    return [
        modern_row(slot, x, y, risc, start, zone, "ZONE_START", **ids),
        modern_row(slot, x, y, risc, end, zone, "ZONE_END", **ids),
    ]


def _run(slot, x, y, risc, kernel_start, loop_starts, zone=LOOP, width=100, **ids):
    """One kernel run on one RISC, with ``zone`` starting at each of ``loop_starts``."""
    kernel = f"{risc.split('_')[0]}-KERNEL"
    rows = [modern_row(slot, x, y, risc, kernel_start, kernel, "ZONE_START", **ids)]
    for start in loop_starts:
        rows += _zone(slot, x, y, risc, start, start + width, zone=zone, **ids)
    end = max(loop_starts, default=kernel_start) + width + 1
    rows.append(modern_row(slot, x, y, risc, end, kernel, "ZONE_END", **ids))
    return rows


def _every(start: int, step: int, count: int) -> List[int]:
    return [start + step * index for index in range(count)]


def _intervals(tmp_path, rows, zone=LOOP, header=MODERN_HEADER, **arguments):
    registry = ReportRegistry()
    write_device_log(tmp_path, header, rows)
    load_report(registry, performance_path=str(tmp_path))
    return tools.zone_intervals(registry, "report-1", zone, **arguments)


class TestIntervals:
    def test_an_interval_runs_start_to_start_within_a_run(self, tmp_path):
        rows = _run(0, 1, 1, "BRISC", 0, [100, 1100, 2100, 3600])

        answer = _intervals(tmp_path, rows)

        (timeline,) = answer["by_core_risc"]
        assert timeline == {
            "device": 0,
            "x": 1,
            "y": 1,
            "risc": "BRISC",
            "occurrences": 4,
            "runs": 1,
            "intervals": 3,
            "median_us": 1.0,
            "min_us": 1.0,
            "max_us": 1.5,
            "runs_at_marker_limit": 0,
        }
        assert answer["zone"] == LOOP
        assert answer["clock_mhz"] == 1000
        assert answer["arch"] == "wormhole_b0"
        assert "caveat" not in answer

    def test_each_risc_is_its_own_timeline(self, tmp_path):
        """Their starts alternate in time, but a BRISC start and an NCRISC start are
        never an interval."""
        rows = [
            *_run(0, 1, 1, "BRISC", 0, [100, 2100]),
            *_run(0, 1, 1, "NCRISC", 0, [600, 3600]),
        ]

        answer = _intervals(tmp_path, rows)

        figures = {
            entry["risc"]: entry["median_us"] for entry in answer["by_core_risc"]
        }
        assert figures == {"BRISC": 2.0, "NCRISC": 3.0}

    def test_runs_hold_when_timelines_interleave_in_the_file(self, tmp_path):
        """One pass holds each timeline's open run, so a kernel start on one RISC must
        not end another's run, wherever their rows fall in the file."""
        brisc = [
            *_run(0, 1, 1, "BRISC", 0, [100, 1100, 2100]),
            *_run(0, 1, 1, "BRISC", 50_000, [50_100, 52_100]),
        ]
        ncrisc = _run(0, 1, 1, "NCRISC", 0, [150, 3150, 6150])
        other_device = _run(1, 1, 1, "BRISC", 0, [100, 1600])
        (tmp_path / "contiguous").mkdir()
        (tmp_path / "alternating").mkdir()

        contiguous = _intervals(
            tmp_path / "contiguous", [*brisc, *ncrisc, *other_device]
        )
        alternating = _intervals(
            tmp_path / "alternating",
            [
                row
                for rows in zip_longest(brisc, ncrisc, other_device)
                for row in rows
                if row
            ],
        )

        assert alternating["by_core_risc"] == contiguous["by_core_risc"]
        assert alternating["by_device"] == contiguous["by_device"]
        assert [entry["runs"] for entry in contiguous["by_core_risc"]] == [1, 1, 2]

    def test_devices_never_pool(self, tmp_path):
        """The same core on two devices: each device's clock is its own, so neither its
        intervals nor its summary may take the other's starts."""
        rows = [
            *_run(0, 1, 1, "BRISC", 0, [100, 1100, 2100]),
            *_run(1, 1, 1, "BRISC", 0, [150, 3150, 6150]),
        ]

        answer = _intervals(tmp_path, rows)

        assert [
            (device["device"], device["intervals"], device["median_us"])
            for device in answer["by_device"]
        ] == [(0, 2, 1.0), (1, 2, 3.0)]
        assert answer["device_count"] == 2

    def test_a_device_summary_reads_every_one_of_its_timelines(self, tmp_path):
        rows = [
            *_run(0, 1, 1, "BRISC", 0, [100, 1100]),
            *_run(0, 2, 1, "BRISC", 0, [100, 3100, 6100]),
            *_run(0, 2, 1, "NCRISC", 0, [100, 2100]),
        ]

        (device,) = _intervals(tmp_path, rows)["by_device"]

        assert device == {
            "device": 0,
            "cores": 2,
            "occurrences": 7,
            "runs": 3,
            "intervals": 4,
            "median_us": 2.5,
            "min_us": 1.0,
            "max_us": 3.0,
            "runs_at_marker_limit": 0,
        }

    def test_a_median_tied_once_rounded_ranks_the_larger_maximum_first(self, tmp_path):
        """Ranked on the figures shown: 1000.5 cycles shows as 1.0 us, as 1000 does."""
        rows = [
            *_run(0, 1, 1, "BRISC", 0, [100, 1100, 2101]),
            *_run(0, 2, 1, "BRISC", 0, [100, 1100, 2100, 3100, 4600]),
        ]

        answer = _intervals(tmp_path, rows)

        assert [
            (entry["x"], entry["median_us"], entry["max_us"])
            for entry in answer["by_core_risc"]
        ] == [(2, 1.0, 1.5), (1, 1.0, 1.001)]

    def test_devices_past_the_cap_are_counted(self, tmp_path):
        rows = [
            *_run(0, 1, 1, "BRISC", 0, [100, 1100]),
            *_run(1, 1, 1, "BRISC", 0, [100, 1100]),
        ]

        with patch.object(tools, "MAX_LIMIT", 1):
            answer = _intervals(tmp_path, rows)

        assert (answer["device_count"], len(answer["by_device"])) == (2, 1)

    def test_padded_cells_are_read_stripped(self, tmp_path):
        rows = [
            row.replace(",BRISC,", ", BRISC ,").replace(f",{LOOP},", f", {LOOP} ,")
            for row in _run(0, 1, 1, "BRISC", 0, [100, 1100])
        ]

        (timeline,) = _intervals(tmp_path, rows)["by_core_risc"]

        assert (timeline["risc"], timeline["intervals"]) == ("BRISC", 1)

    def test_a_tied_median_ranks_the_larger_maximum_first(self, tmp_path):
        rows = [
            *_run(0, 1, 1, "BRISC", 0, [100, 1100, 2100, 4100]),
            *_run(0, 2, 1, "BRISC", 0, [100, 1100, 2100, 5100]),
        ]

        answer = _intervals(tmp_path, rows)

        assert [(entry["x"], entry["max_us"]) for entry in answer["by_core_risc"]] == [
            (2, 3.0),
            (1, 2.0),
        ]

    def test_timelines_rank_slowest_first_and_are_capped(self, tmp_path):
        rows = [
            *_run(0, 1, 1, "BRISC", 0, [100, 1100]),
            *_run(0, 2, 1, "BRISC", 0, [100, 3100]),
            *_run(0, 3, 1, "BRISC", 0, [100, 2100]),
        ]

        answer = _intervals(tmp_path, rows, limit=2)

        assert [entry["x"] for entry in answer["by_core_risc"]] == [2, 3]
        assert answer["returned"] == 2
        assert answer["timeline_count"] == 3

    def test_the_zone_name_is_matched_whole(self, tmp_path):
        rows = [
            *_run(0, 1, 1, "BRISC", 0, [100, 1100], zone="LOOP-INNER"),
            *_run(0, 2, 1, "BRISC", 0, [100, 2100]),
        ]

        answer = _intervals(tmp_path, rows, zone=f"  {LOOP} ")

        assert [entry["x"] for entry in answer["by_core_risc"]] == [2]


class TestRuns:
    def test_a_kernel_start_ends_a_run(self, tmp_path):
        """Two runs under one run host ID, as a cached program's relaunch can be: the
        gap from the first run's last start to the second's first is dispatch."""
        rows = [
            *_run(0, 1, 1, "BRISC", 0, [100, 1100]),
            *_run(0, 1, 1, "BRISC", 50_000, [50_100, 51_100]),
        ]

        (timeline,) = _intervals(tmp_path, rows)["by_core_risc"]

        assert (timeline["runs"], timeline["intervals"], timeline["max_us"]) == (
            2,
            2,
            1.0,
        )

    def test_a_new_run_host_id_ends_a_run_without_a_kernel_start(self, tmp_path):
        rows = [
            *_zone(0, 1, 1, "BRISC", 100, 200, run=1),
            *_zone(0, 1, 1, "BRISC", 1100, 1200, run=1),
            *_zone(0, 1, 1, "BRISC", 9100, 9200, run=2),
            *_zone(0, 1, 1, "BRISC", 10_100, 10_200, run=2),
        ]

        (timeline,) = _intervals(tmp_path, rows)["by_core_risc"]

        assert (timeline["runs"], timeline["intervals"], timeline["max_us"]) == (
            2,
            2,
            1.0,
        )

    def test_a_trace_replay_is_parted_by_its_kernel_start(self, tmp_path):
        """A traced op's replays share their run host ID, and each starts its kernel."""
        rows = [
            *_run(0, 1, 1, "BRISC", 0, [100, 1100], trace=3, counter=1),
            *_run(0, 1, 1, "BRISC", 9000, [9100, 10_100], trace=3, counter=2),
        ]

        (timeline,) = _intervals(tmp_path, rows)["by_core_risc"]

        assert (timeline["runs"], timeline["intervals"], timeline["max_us"]) == (
            2,
            2,
            1.0,
        )

    def test_trace_cells_that_change_at_a_flush_do_not_part_a_run(self, tmp_path):
        """As on a real all-gather capture: the trace cells fill in at the end of the
        profiler's flush, partway through one zone of one kernel run."""
        flushed = {"trace": 0, "counter": 1}
        rows = [
            modern_row(0, 1, 1, "NCRISC", 0, "NCRISC-KERNEL", "ZONE_START"),
            *_zone(0, 1, 1, "NCRISC", 100, 200),
            modern_row(0, 1, 1, "NCRISC", 1100, LOOP, "ZONE_START"),
            *_zone(0, 1, 1, "NCRISC", 1150, 1480, zone="PROFILER-NOC-QUICK-SEND")[:1],
            modern_row(
                0,
                1,
                1,
                "NCRISC",
                1480,
                "PROFILER-NOC-QUICK-SEND",
                "ZONE_END",
                **flushed,
            ),
            modern_row(0, 1, 1, "NCRISC", 1500, LOOP, "ZONE_END", **flushed),
            *_zone(0, 1, 1, "NCRISC", 2100, 2200, **flushed),
            *_zone(0, 1, 1, "NCRISC", 3100, 3200, **flushed),
            modern_row(0, 1, 1, "NCRISC", 3300, "NCRISC-KERNEL", "ZONE_END", **flushed),
        ]

        answer = _intervals(tmp_path, rows)

        (timeline,) = answer["by_core_risc"]
        assert (timeline["runs"], timeline["occurrences"]) == (1, 4)
        # 1100 to 2100 times the flush as well, so it is left out.
        assert (timeline["intervals"], timeline["max_us"]) == (2, 1.0)
        assert answer["caveat"] == (
            "1 intervals of 'LOOP' spanned one of the device profiler's own zones, such "
            "as a flush of its full buffer partway through a run, and were left out, "
            "since they time the profiler as well."
        )

    def test_the_profilers_own_zone_can_be_timed(self, tmp_path):
        """Asked for, a profiler zone is not a flush in the way of its own intervals."""
        rows = _run(
            0, 1, 1, "BRISC", 0, [100, 1100, 2100], zone="PROFILER-NOC-QUICK-PUSH"
        )

        answer = _intervals(tmp_path, rows, zone="PROFILER-NOC-QUICK-PUSH")

        assert answer["by_core_risc"][0]["intervals"] == 2
        assert "caveat" not in answer

    def test_runs_carry_across_chunks(self, tmp_path):
        """The log is read a chunk at a time, and a run's state outlives its chunk."""
        rows = [
            *_run(0, 1, 1, "BRISC", 0, [100, 1100, 3100]),
            *_run(0, 1, 1, "BRISC", 50_000, [50_100, 52_100]),
            *_run(1, 1, 1, "BRISC", 0, _every(100, 1000, 125)),
        ]
        whole = _intervals(tmp_path, rows)

        with patch.object(csv_queries, "CSV_CHUNK_SIZE", 3):
            chunked = _intervals(tmp_path, rows)

        assert chunked == whole
        assert [entry["runs_at_marker_limit"] for entry in whole["by_device"]] == [0, 1]

    def test_a_zone_that_starts_once_a_run_has_no_intervals(self, tmp_path):
        rows = [
            *_run(0, 1, 1, "BRISC", 0, [100]),
            *_run(0, 1, 1, "BRISC", 50_000, [50_100]),
        ]

        answer = _intervals(tmp_path, rows, zone="BRISC-KERNEL")

        assert answer["by_core_risc"] == []
        assert answer["timeline_count"] == 0
        (device,) = answer["by_device"]
        assert (device["occurrences"], device["runs"], device["median_us"]) == (
            2,
            2,
            None,
        )
        # Its ends are read too, so nothing is unpaired.
        assert answer["caveat"] == (
            "'BRISC-KERNEL' never started twice in one run on any core's RISC, so it "
            "has no intervals: a firmware or kernel zone marks each run once, and a "
            "zone inside a loop needs two iterations in one run."
        )

    def test_timelines_without_intervals_are_counted_not_ranked(self, tmp_path):
        rows = [
            *_run(0, 1, 1, "BRISC", 0, [100, 1100]),
            *_run(0, 2, 1, "BRISC", 0, [100]),
        ]

        answer = _intervals(tmp_path, rows)

        assert [entry["x"] for entry in answer["by_core_risc"]] == [1]
        assert answer["caveat"] == (
            "1 of 2 core-RISC timelines have no usable intervals of 'LOOP', so they "
            "are not ranked."
        )

    def test_a_zone_whose_every_interval_is_left_out_is_not_said_never_to_recur(
        self, tmp_path
    ):
        rows = _run(0, 1, 1, "BRISC", 0, [100, 1100])
        rows[3:3] = _zone(0, 1, 1, "BRISC", 500, 510, zone="PROFILER-NOC-QUICK-PUSH")

        answer = _intervals(tmp_path, rows)

        assert answer["by_core_risc"] == []
        assert answer["caveat"].startswith(
            "'LOOP' started more than once in a run, but none of its intervals is "
            "usable: each was left out for a reason given below. 1 intervals of"
        )

    def test_a_pre_rename_log_reads_begin_and_end(self, tmp_path):
        rows = [
            f"0,1,1,BRISC,1,{cycles},0,0,{RUN},{zone},{phase},1,k.cc"
            for cycles, zone, phase in [
                (0, "BRISC-KERNEL", "begin"),
                (100, LOOP, "begin"),
                (200, LOOP, "end"),
                (2100, LOOP, "begin"),
                (2200, LOOP, "end"),
                (2300, "BRISC-KERNEL", "end"),
            ]
        ]

        (timeline,) = _intervals(tmp_path, rows, header=PRE_RENAME_HEADER)[
            "by_core_risc"
        ]

        assert timeline["median_us"] == 2.0


class TestMarkerLimit:
    CAPACITY = csv_queries.L1_ZONE_MARKER_CAPACITY

    def test_a_run_that_fills_the_l1_buffer_is_counted(self, tmp_path):
        """125 zones are 250 markers, all one run can record."""
        rows = _run(0, 1, 1, "ERISC", 0, _every(100, 1000, self.CAPACITY // 2))

        answer = _intervals(tmp_path, rows)

        (timeline,) = answer["by_core_risc"]
        assert timeline["runs_at_marker_limit"] == 1
        assert answer["by_device"][0]["runs_at_marker_limit"] == 1
        assert "filled its L1 profiler buffer: 250 markers (125 zones)" in (
            answer["caveat"]
        )

    def test_one_zone_short_of_it_is_not(self, tmp_path):
        rows = _run(0, 1, 1, "ERISC", 0, _every(100, 1000, self.CAPACITY // 2 - 1))

        answer = _intervals(tmp_path, rows)

        assert answer["by_core_risc"][0]["runs_at_marker_limit"] == 0
        assert "caveat" not in answer

    def test_other_zones_in_the_run_fill_it_too(self, tmp_path):
        loops = _every(100, 1000, self.CAPACITY // 2 - 10)
        others = [
            row
            for start in _every(500, 1000, 10)
            for row in _zone(0, 1, 1, "ERISC", start, start + 10, zone="OTHER")
        ]
        rows = _run(0, 1, 1, "ERISC", 0, loops)
        rows = [rows[0], *sorted(rows[1:-1] + others, key=_cycles), rows[-1]]

        answer = _intervals(tmp_path, rows)

        assert answer["by_core_risc"][0]["runs_at_marker_limit"] == 1

    def test_firmware_and_kernel_zones_have_slots_of_their_own(self, tmp_path):
        rows = [
            modern_row(0, 1, 1, "ERISC", 0, "ERISC-FW", "ZONE_START"),
            *_run(0, 1, 1, "ERISC", 10, _every(100, 1000, self.CAPACITY // 2 - 1)),
            modern_row(0, 1, 1, "ERISC", 10**9, "ERISC-FW", "ZONE_END"),
        ]

        answer = _intervals(tmp_path, rows)

        assert answer["by_core_risc"][0]["runs_at_marker_limit"] == 0

    def test_a_flush_partway_lets_a_run_hold_more_than_a_buffer(self, tmp_path):
        """The profiler's flush is a zone of its own, and it empties the buffer."""
        # One zone short of a full buffer on each side of the flush.
        each = self.CAPACITY // 2 - 1
        loops = _every(100, 1000, 2 * each)
        rows = _run(0, 1, 1, "BRISC", 0, loops)
        flush = loops[each] - 500
        rows[1 + 2 * each : 1 + 2 * each] = _zone(
            0, 1, 1, "BRISC", flush, flush + 10, zone="PROFILER-NOC-QUICK-PUSH"
        )

        answer = _intervals(tmp_path, rows)

        (timeline,) = answer["by_core_risc"]
        assert (timeline["occurrences"], timeline["runs_at_marker_limit"]) == (
            2 * each,
            0,
        )
        assert timeline["intervals"] == 2 * each - 2
        assert answer["caveat"].startswith("1 intervals of 'LOOP' spanned one of")

    def test_the_buffer_can_fill_again_after_a_flush(self, tmp_path):
        rows = _run(0, 1, 1, "BRISC", 0, _every(100, 1000, self.CAPACITY // 2))
        rows[1:1] = _zone(0, 1, 1, "BRISC", 50, 60, zone="PROFILER-NOC-QUICK-PUSH")

        answer = _intervals(tmp_path, rows)

        assert answer["by_core_risc"][0]["runs_at_marker_limit"] == 1

    def test_a_full_run_stays_counted_after_a_flush(self, tmp_path):
        loops = _every(100, 1000, self.CAPACITY // 2 + 2)
        rows = _run(0, 1, 1, "BRISC", 0, loops)
        flush = loops[self.CAPACITY // 2] - 500
        at = 1 + 2 * (self.CAPACITY // 2)
        rows[at:at] = _zone(
            0, 1, 1, "BRISC", flush, flush + 10, zone="PROFILER-NOC-QUICK-PUSH"
        )

        answer = _intervals(tmp_path, rows)

        assert answer["by_core_risc"][0]["runs_at_marker_limit"] == 1

    def test_timestamped_rows_do_not_count_toward_the_limit(self, tmp_path):
        rows = _run(0, 1, 1, "NCRISC", 0, _every(100, 1000, self.CAPACITY // 2 - 1))
        rows[1:1] = [
            modern_row(0, 1, 1, "NCRISC", 50 + index, "", "TS_DATA")
            for index in range(4)
        ]

        answer = _intervals(tmp_path, rows)

        assert answer["by_core_risc"][0]["runs_at_marker_limit"] == 0
        assert "This log also records timestamped data" in answer["caveat"]

    def test_a_kernel_zone_carries_no_marker_limit_caveats(self, tmp_path):
        """The limit never cuts a zone with a slot of its own, so neither timestamped
        data nor accumulate mode can make it miss one."""
        rows = _run(0, 1, 1, "BRISC", 0, [100, 1100])
        rows[1:1] = [
            modern_row(0, 1, 1, "BRISC", 50, "", "TS_DATA"),
            *_zone(0, 1, 1, "BRISC", 60, 70, zone="PROFILER-DRAM-PUSH"),
        ]

        answer = _intervals(tmp_path, rows, zone="BRISC-KERNEL")

        assert "runs_at_marker_limit" not in answer["caveat"]

    def test_a_kernel_zone_is_never_cut_short(self, tmp_path):
        rows = _run(0, 1, 1, "ERISC", 0, _every(100, 1000, self.CAPACITY // 2))

        answer = _intervals(tmp_path, rows, zone="ERISC-KERNEL")

        assert answer["by_device"][0]["runs_at_marker_limit"] == 0
        assert "filled its L1 profiler buffer" not in answer["caveat"]

    def test_an_accumulate_mode_log_says_the_count_can_miss(self, tmp_path):
        """One buffer spans several runs, so no single run need reach the count."""
        rows = _run(0, 1, 1, "BRISC", 0, [100, 1100])
        rows[-1:-1] = _zone(0, 1, 1, "BRISC", 1300, 1310, zone="PROFILER-DRAM-PUSH")

        answer = _intervals(tmp_path, rows)

        assert answer["caveat"] == (
            "This log holds PROFILER-DRAM-PUSH or PROFILER-NOC-FLUSH zones, which "
            "tt-metal writes only in its accumulate mode, where one L1 buffer spans "
            "several runs: runs_at_marker_limit can miss a run whose zones it cut short."
        )

    def test_the_limit_is_per_run(self, tmp_path):
        rows = [
            *_run(0, 1, 1, "ERISC", 0, _every(100, 1000, 100)),
            *_run(0, 1, 1, "ERISC", 10**7, _every(10**7 + 100, 1000, 100)),
        ]

        answer = _intervals(tmp_path, rows)

        assert answer["by_core_risc"][0]["runs_at_marker_limit"] == 0


def _cycles(row: str) -> int:
    return int(row.split(",")[5])


class TestGaps:
    def test_timestamped_data_is_said_to_share_the_buffer(self, tmp_path):
        rows = _run(0, 1, 1, "NCRISC", 0, [100, 1100])
        rows.insert(2, modern_row(0, 1, 1, "NCRISC", 150, "", "TS_DATA"))

        answer = _intervals(tmp_path, rows)

        assert answer["by_core_risc"][0]["intervals"] == 1
        assert answer["caveat"].startswith("This log also records timestamped data")

    def test_unpaired_starts_and_ends_are_said(self, tmp_path):
        rows = _run(0, 1, 1, "BRISC", 0, [100, 1100])[:-1] + [
            modern_row(0, 1, 1, "BRISC", 2100, LOOP, "ZONE_START"),
            modern_row(0, 1, 1, "BRISC", 3000, "BRISC-KERNEL", "ZONE_END"),
        ]

        answer = _intervals(tmp_path, rows)

        assert answer["by_core_risc"][0]["occurrences"] == 3
        assert "1 starts and 0 ends of 'LOOP' did not pair" in answer["caveat"]

    def test_a_start_replaced_before_its_end_is_unpaired(self, tmp_path):
        rows = [
            modern_row(0, 1, 1, "BRISC", 0, "BRISC-KERNEL", "ZONE_START"),
            modern_row(0, 1, 1, "BRISC", 100, LOOP, "ZONE_START"),
            *_zone(0, 1, 1, "BRISC", 1100, 1200),
            modern_row(0, 1, 1, "BRISC", 1300, "BRISC-KERNEL", "ZONE_END"),
        ]

        answer = _intervals(tmp_path, rows)

        assert "1 starts and 0 ends of 'LOOP' did not pair" in answer["caveat"]

    def test_zones_never_pair_across_runs(self, tmp_path):
        """A start whose end was lost and an end whose start was lost, in two runs of
        one run host ID, are two unpaired markers, not one zone."""
        rows = [
            *_run(0, 1, 1, "BRISC", 0, [100, 1100])[:-1],
            modern_row(0, 1, 1, "BRISC", 2100, LOOP, "ZONE_START"),
            modern_row(0, 1, 1, "BRISC", 3000, "BRISC-KERNEL", "ZONE_END"),
            modern_row(0, 1, 1, "BRISC", 50_000, "BRISC-KERNEL", "ZONE_START"),
            modern_row(0, 1, 1, "BRISC", 50_200, LOOP, "ZONE_END"),
        ]

        answer = _intervals(tmp_path, rows)

        assert "1 starts and 1 ends of 'LOOP' did not pair" in answer["caveat"]

    def test_a_firmware_zone_across_dispatches_has_no_intervals(self, tmp_path):
        """Each start falls in the run before its own kernel start: three runs, none
        holding two starts, and pairs kept by run host ID."""
        rows = []
        for start in (0, 10_000, 20_000):
            rows += [
                modern_row(0, 1, 1, "BRISC", start, "BRISC-FW", "ZONE_START"),
                *_run(0, 1, 1, "BRISC", start + 10, [start + 100]),
                modern_row(0, 1, 1, "BRISC", start + 500, "BRISC-FW", "ZONE_END"),
            ]

        answer = _intervals(tmp_path, rows, zone="BRISC-FW")

        (device,) = answer["by_device"]
        assert (
            device["runs"],
            device["median_us"],
            device["runs_at_marker_limit"],
        ) == (
            3,
            None,
            0,
        )
        assert "did not pair" not in answer["caveat"]

    def test_a_firmware_zone_pairs_across_its_kernel_start(self, tmp_path):
        """Its start comes before the kernel start that opens its run."""
        rows = [
            modern_row(0, 1, 1, "BRISC", 0, "BRISC-FW", "ZONE_START"),
            *_run(0, 1, 1, "BRISC", 10, [100]),
            modern_row(0, 1, 1, "BRISC", 500, "BRISC-FW", "ZONE_END"),
        ]

        answer = _intervals(tmp_path, rows, zone="BRISC-FW")

        assert "did not pair" not in answer["caveat"]

    def test_a_start_out_of_time_order_is_left_out(self, tmp_path):
        rows = _run(0, 1, 1, "BRISC", 0, [100, 3100, 2100])

        answer = _intervals(tmp_path, rows)

        assert answer["by_core_risc"][0]["intervals"] == 1
        assert "1 starts of 'LOOP' came before the start ahead of them" in (
            answer["caveat"]
        )

    def test_the_next_interval_runs_from_the_last_start_kept(self, tmp_path):
        rows = _run(0, 1, 1, "BRISC", 0, [100, 3100, 2100, 4100])

        (timeline,) = _intervals(tmp_path, rows)["by_core_risc"]

        assert (timeline["intervals"], timeline["min_us"], timeline["max_us"]) == (
            2,
            1.0,
            3.0,
        )

    def test_rows_that_are_not_numbers_are_left_out_and_counted(self, tmp_path):
        rows = _run(0, 1, 1, "BRISC", 0, [100, 1100, 2100])
        rows.insert(3, modern_row(0, 1, 1, "BRISC", "x", LOOP, "ZONE_START"))

        answer = _intervals(tmp_path, rows)

        assert answer["by_core_risc"][0]["intervals"] == 2
        assert (
            "1 rows have a slot, core, run or cycle count that is not a finite number"
            in (answer["caveat"])
        )

    def test_starts_past_the_open_start_ceiling_say_the_log_is_malformed(
        self, tmp_path
    ):
        rows = [
            modern_row(0, 1, 1, "BRISC", 0, "BRISC-KERNEL", "ZONE_START"),
            modern_row(0, 1, 1, "BRISC", 100, LOOP, "ZONE_START"),
            modern_row(0, 2, 1, "BRISC", 0, "BRISC-KERNEL", "ZONE_START"),
            modern_row(0, 2, 1, "BRISC", 100, LOOP, "ZONE_START"),
        ]

        with patch.object(csv_queries, "MAX_OPEN_ZONE_STARTS", 1):
            answer = _intervals(tmp_path, rows)

        assert (
            "1 starts went unpaired past the open-zone ceiling, which a well-formed "
            "capture does not reach: treat this log as malformed."
        ) in answer["caveat"]

    def test_timelines_past_the_ceiling_are_left_out_and_counted(self, tmp_path):
        rows = [
            *_run(0, 1, 1, "BRISC", 0, [100, 1100]),
            *_run(0, 2, 1, "BRISC", 0, [100, 1100]),
        ]

        with patch.object(csv_queries, "MAX_ZONE_TIMELINES", 1):
            answer = _intervals(tmp_path, rows)

        assert answer["timeline_count"] == 1
        # A kernel start and two zones' starts and ends: the kernel's end is not read.
        assert "5 rows belong to core-RISC timelines past the" in answer["caveat"]


class TestRefusals:
    def test_a_zone_whose_starts_were_all_unreadable_says_so(self, tmp_path):
        rows = _run(0, 1, 1, "BRISC", 0, [100, 1100])
        rows[1] = modern_row(0, 1, 1, "BRISC", "x", LOOP, "ZONE_START")
        rows[3] = modern_row(0, 1, 1, "BRISC", "y", LOOP, "ZONE_START")

        with pytest.raises(ValueError) as refusal:
            _intervals(tmp_path, rows)

        assert str(refusal.value) == (
            "'LOOP' starts 2 times in profile_log_device.csv, but none could be read: "
            "2 have a slot, core, run or cycle count that is not a finite number, and 0 lie "
            "on core-RISC timelines past the 200000 followed at once"
        )

    def test_a_zone_past_the_timeline_ceiling_says_so(self, tmp_path):
        rows = _run(0, 1, 1, "BRISC", 0, [100, 1100])

        with (
            patch.object(csv_queries, "MAX_ZONE_TIMELINES", 0),
            patch.object(tools, "MAX_ZONE_TIMELINES", 0),
            pytest.raises(ValueError) as refusal,
        ):
            _intervals(tmp_path, rows)

        assert str(refusal.value).endswith(
            ": 0 have a slot, core, run or cycle count that is not a finite number, and 2 lie "
            "on core-RISC timelines past the 0 followed at once"
        )

    def test_the_zone_asked_for_is_counted_past_the_names_cap(self, tmp_path):
        """Uncounted, its unreadable starts would read as a zone the log lacks."""
        rows = [
            *_run(0, 2, 1, "BRISC", 0, [100], zone="OTHER"),
            modern_row(0, 1, 1, "BRISC", "x", LOOP, "ZONE_START"),
        ]

        with (
            patch.object(csv_queries, "MAX_COUNTED_ZONE_NAMES", 1),
            pytest.raises(ValueError) as refusal,
        ):
            _intervals(tmp_path, rows)

        assert str(refusal.value).startswith(
            "'LOOP' starts 1 times in profile_log_device.csv, but none could be read"
        )

    def test_a_refusal_says_when_the_zone_names_were_capped(self, tmp_path):
        rows = _run(0, 1, 1, "BRISC", 0, [100, 1100])

        with (
            patch.object(csv_queries, "MAX_COUNTED_ZONE_NAMES", 1),
            patch.object(tools, "MAX_COUNTED_ZONE_NAMES", 1),
            pytest.raises(ValueError) as refusal,
        ):
            _intervals(tmp_path, rows, zone="LOPO")

        assert str(refusal.value).endswith(
            "; the log names more zones than the 1 counted"
        )

    def test_an_oversized_zone_name_is_not_listed(self, tmp_path):
        """It is the capture's text, read by an agent that acts on a refusal."""
        long_name = "Z" * (tools.MAX_ZONE_NAME_LENGTH + 1)
        rows = [
            *_run(0, 1, 1, "BRISC", 0, [100, 1100]),
            *_run(0, 2, 1, "BRISC", 0, [100], zone=long_name),
        ]

        with pytest.raises(ValueError) as refusal:
            _intervals(tmp_path, rows, zone="LOPO")

        assert long_name not in str(refusal.value)
        assert str(refusal.value).endswith(
            "; 1 more have names longer than 256 characters, which are not listed"
        )

    def test_an_oversized_zone_argument_is_refused(self, tmp_path):
        with pytest.raises(ValueError, match="zone is 257 characters; a zone name is"):
            _intervals(tmp_path, _run(0, 1, 1, "BRISC", 0, [100]), zone="Q" * 257)

    def test_a_log_with_no_zone_starts_says_so(self, tmp_path):
        rows = [modern_row(0, 1, 1, "BRISC", 100, LOOP, "ZONE_END")]

        with pytest.raises(ValueError) as refusal:
            _intervals(tmp_path, rows)

        assert str(refusal.value) == (
            "profile_log_device.csv records no zone starts, so there is no 'LOOP' to time"
        )

    def test_an_unknown_zone_names_the_zones_the_log_starts(self, tmp_path):
        rows = [
            *_run(0, 1, 1, "BRISC", 0, [100, 1100, 2100]),
            *_run(0, 2, 1, "BRISC", 0, [100], zone="OTHER"),
        ]

        with pytest.raises(ValueError) as refusal:
            _intervals(tmp_path, rows, zone="LOPO")

        assert str(refusal.value) == (
            "no zone named 'LOPO' starts in profile_log_device.csv. Its zones by "
            "starts, most first: 'LOOP' (3), 'BRISC-KERNEL' (2), 'OTHER' (1)"
        )

    def test_the_listed_zones_are_capped(self, tmp_path):
        rows = _run(0, 1, 1, "BRISC", 0, [100, 1100, 2100])

        with (
            patch.object(tools, "MAX_LISTED_ZONES", 1),
            pytest.raises(ValueError, match="'LOOP' \\(3\\), and 1 more$"),
        ):
            _intervals(tmp_path, rows, zone="LOPO")

    def test_a_blank_zone_is_refused(self, tmp_path):
        with pytest.raises(ValueError, match="zone must name a zone the device log"):
            _intervals(tmp_path, _run(0, 1, 1, "BRISC", 0, [100]), zone=" ")

    def test_a_report_without_a_device_log_is_refused(self, tmp_path):
        registry = ReportRegistry()
        load_report(registry, performance_path=str(tmp_path))

        with pytest.raises(ValueError, match="has no profile_log_device.csv"):
            tools.zone_intervals(registry, "report-1", LOOP)

    def test_a_log_without_a_clock_is_refused(self, tmp_path):
        log = write_device_log(tmp_path, MODERN_HEADER, _run(0, 1, 1, "BRISC", 0, [1]))
        log.write_text(log.read_text().replace(", CHIP_FREQ[MHz]: 1000", ""))
        registry = ReportRegistry()
        loaded = load_report(registry, performance_path=str(tmp_path))

        assert "zone_intervals" in loaded["unanswerable"]
        with pytest.raises(ValueError, match="no positive CHIP_FREQ"):
            tools.zone_intervals(registry, "report-1", LOOP)

    def test_a_log_that_cannot_tell_starts_from_ends_is_refused(self, tmp_path):
        with pytest.raises(ValueError, match="marks no zone starts or ends"):
            _intervals(tmp_path, UNTYPED_ROWS, zone="MATMUL", header=UNTYPED_HEADER)


class TestServer:
    def _call(self, registry, arguments):
        with patch.object(server, "record_event") as record:
            response = server.handle_message(
                {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "tools/call",
                    "params": {"name": "zone_intervals", "arguments": arguments},
                },
                server._tool_table(registry),
            )
        return response["result"], record.call_args.kwargs["outcome"]

    def test_it_answers_through_the_server(self, tmp_path):
        registry = ReportRegistry()
        write_device_log(tmp_path, MODERN_HEADER, _run(0, 1, 1, "BRISC", 0, [1, 1001]))
        load_report(registry, performance_path=str(tmp_path))

        result, outcome = self._call(registry, {"handle": "report-1", "zone": LOOP})

        assert result.get("isError") is not True
        assert '"median_us":1.0' in result["content"][0]["text"]
        assert outcome is McpToolOutcome.OK

    @pytest.mark.parametrize(
        "header, rows, zone, refusal",
        [
            (MODERN_HEADER, None, "LOPO", "no zone named 'LOPO'"),
            (UNTYPED_HEADER, UNTYPED_ROWS, "MATMUL", "marks no zone starts or ends"),
        ],
    )
    def test_a_refusal_through_the_server_is_recorded_as_one(
        self, tmp_path, header, rows, zone, refusal
    ):
        registry = ReportRegistry()
        write_device_log(tmp_path, header, rows or _run(0, 1, 1, "BRISC", 0, [1]))
        load_report(registry, performance_path=str(tmp_path))

        result, outcome = self._call(registry, {"handle": "report-1", "zone": zone})

        assert result["isError"] is True
        assert refusal in result["content"][0]["text"]
        assert outcome is McpToolOutcome.REFUSED

    def test_a_profiler_only_handle_is_refused_as_the_agents_to_fix(self, tmp_path):
        registry = ReportRegistry()
        load_report(registry, profiler_path=str(_write_devices(tmp_path, [(0, 0)])))

        result, outcome = self._call(registry, {"handle": "report-1", "zone": LOOP})

        assert result["isError"] is True
        assert "loaded without a performance_path" in result["content"][0]["text"]
        assert outcome is McpToolOutcome.REFUSED

    def test_the_schema_requires_the_zone(self):
        response = server.handle_message(
            {"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
            server._tool_table(ReportRegistry()),
        )
        (schema,) = [
            tool["inputSchema"]
            for tool in response["result"]["tools"]
            if tool["name"] == "zone_intervals"
        ]

        assert schema["required"] == ["handle", "zone"]
        assert schema["properties"]["zone"]["maxLength"] == tools.MAX_ZONE_NAME_LENGTH


def test_the_smoke_capture_reads_end_to_end():
    """The committed capture holds only firmware and kernel zones, which start once a
    run, so it reads whole and has no intervals."""
    if not (
        SMOKE_CAPTURE_DIR / csv_queries.DeviceLogProfilerQueries.DEVICE_LOG_FILE
    ).is_file():
        pytest.skip(f"{SMOKE_CAPTURE_DIR} is not present")
    registry = ReportRegistry()
    handle = load_report(registry, performance_path=str(SMOKE_CAPTURE_DIR))["handle"]

    answer = tools.zone_intervals(registry, handle, "BRISC-KERNEL")

    assert answer["by_device"][0]["occurrences"] > 0
    assert (answer["timeline_count"], answer["by_core_risc"]) == (0, [])
    assert "never started twice in one run" in answer["caveat"]
