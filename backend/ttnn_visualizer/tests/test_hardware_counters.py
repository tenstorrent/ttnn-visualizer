# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Finding tt-metal's hardware counter columns by header shape, and grouping them. #2371"""

import csv
import io
import math

import pytest
from ttnn_visualizer import hardware_counters
from ttnn_visualizer.device_architecture import DeviceArchitecture
from ttnn_visualizer.exceptions import DataFormatError
from ttnn_visualizer.hardware_counters import (
    CaptureGroup,
    CounterAbsence,
    CounterFamily,
    CounterMeasure,
    CounterStat,
    GroupState,
)

# Copied from a Blackhole capture's header as tt-metal writes it.
REAL_HEADERS = [
    "FPU Util Min (%)",
    "FPU Util Median (%)",
    "FPU Util Max (%)",
    "FPU Util Avg (%)",
    "Unpacker-to-Math Data Flow (srcA) Avg (ratio)",
    "Math Waiting on Unpack (T1) Avg (%)",
    "Compute-to-Unpack Ratio Max (ratio)",
    "Avg SFPU util on full grid (%)",
    "Avg FPU util on full grid (%)",
    "Avg Math util on full grid (%)",
]
# Columns of every ops CSV with the same `(%)` suffix, which are not counters.
NOT_COUNTERS = [
    "PM FPU UTIL (%)",
    "NOC UTIL (%)",
    "MULTICAST NOC UTIL (%)",
    "DRAM BW UTIL (%)",
    "DRAM BW UTIL PER CTRL (%)",
    "ETH BW UTIL (%)",
    "NPE CONG IMPACT (%)",
    "DEVICE KERNEL DURATION PER CORE MIN [ns]",
    "OP CODE",
]

# What a one-pass capture of fpu, pack, unpack, instrn and l1_0 holds, by label.
ONE_PASS_LABELS = (
    "FPU Util",
    "Packer Utilization",
    "Unpacker0 Busy T0 Util",
    "Thread 0 Stall Rate",
    "L1 Total Bandwidth Util",
    "NOC Ring 0 Outgoing Util",
    "NOC Ring 0 Util",
)


def _header(labels, stats=("Avg",)):
    return [f"{label} {stat} (%)" for label in labels for stat in stats]


class TestDiscovery:
    def test_tt_metals_headers_are_found_with_their_label_stat_and_measure(self):
        found = hardware_counters.discover(REAL_HEADERS)

        assert found.columns["FPU Util"] == {
            CounterStat.MIN: "FPU Util Min (%)",
            CounterStat.MEDIAN: "FPU Util Median (%)",
            CounterStat.MAX: "FPU Util Max (%)",
            CounterStat.AVG: "FPU Util Avg (%)",
        }
        assert found.measures["FPU Util"] is CounterMeasure.PERCENT
        assert (
            found.column("Unpacker-to-Math Data Flow (srcA)", CounterStat.AVG)
            == "Unpacker-to-Math Data Flow (srcA) Avg (ratio)"
        )
        assert found.measures["Compute-to-Unpack Ratio"] is CounterMeasure.RATIO
        assert "Math Waiting on Unpack (T1)" in found.columns
        assert found.full_grid == {
            "sfpu": "Avg SFPU util on full grid (%)",
            "fpu": "Avg FPU util on full grid (%)",
            "math": "Avg Math util on full grid (%)",
        }

    def test_the_ops_csvs_own_percent_columns_are_not_counters(self):
        found = hardware_counters.discover(NOT_COUNTERS)

        assert not found.has_counters
        assert found.every_column() == []

    def test_a_header_is_matched_as_written_whatever_its_padding(self):
        found = hardware_counters.discover([" FPU Util Avg (%)"])

        assert found.column("FPU Util", CounterStat.AVG) == " FPU Util Avg (%)"

    def test_a_label_this_version_does_not_know_falls_into_other(self):
        found = hardware_counters.discover(["Renamed Busy Metric Avg (%)"])

        assert found.has_counters
        assert hardware_counters.family_of("Renamed Busy Metric") is CounterFamily.OTHER


class TestVendoredLabels:
    def test_every_label_of_tt_llks_catalogue_has_one_family(self):
        labels = [
            label
            for family in CounterFamily
            for label in hardware_counters.labels_of(family)
        ]

        assert len(labels) == 164
        assert len(set(labels)) == len(labels)
        assert hardware_counters.labels_of(CounterFamily.OTHER) == ()

    @pytest.mark.parametrize(
        ("label", "family"),
        [
            ("FPU Util", CounterFamily.COMPUTE),
            ("FPU SFPU Overlap", CounterFamily.COMPUTE),
            ("Math Pipeline Utilization", CounterFamily.COMPUTE),
            ("Unpacker1 Busy T0 Util", CounterFamily.UNPACK),
            ("Packer Utilization", CounterFamily.PACK),
            ("L1 Total Bandwidth Util", CounterFamily.L1_PORTS),
            ("NOC Ring 1 Util", CounterFamily.NOC_RING),
            ("T1 Instrn Issue Rate", CounterFamily.INSTRUCTION_ISSUE),
            ("Thread 2 Stall Rate", CounterFamily.STALLS),
        ],
    )
    def test_a_label_lands_in_its_units_family(self, label, family):
        assert hardware_counters.family_of(label) is family

    @pytest.mark.parametrize(
        ("label", "architecture", "absence"),
        [
            (
                "Packer Engine 0 Util",
                DeviceArchitecture.BLACKHOLE,
                "not_on_architecture",
            ),
            ("Packer Engine 0 Util", DeviceArchitecture.WORMHOLE, "not_captured"),
            (
                "L1 Unpacker0 Ext Util",
                DeviceArchitecture.WORMHOLE,
                "not_on_architecture",
            ),
            ("L1 Unpacker0 Ext Util", DeviceArchitecture.BLACKHOLE, "not_captured"),
            ("NOC Ring 1 Util", DeviceArchitecture.BLACKHOLE, "not_captured"),
            (
                "Thread 3 Stall Rate",
                DeviceArchitecture.BLACKHOLE,
                "not_on_architecture",
            ),
            ("Packer Utilization", DeviceArchitecture.UNKNOWN, "not_captured"),
        ],
    )
    def test_a_missing_column_is_not_captured_or_not_on_the_architecture(
        self, label, architecture, absence
    ):
        found = hardware_counters.discover(_header(["FPU Util"]))

        assert found.absence(label, architecture) is CounterAbsence(absence)

    def test_a_captured_label_has_no_absence(self):
        found = hardware_counters.discover(_header(["FPU Util"]))

        assert found.absence("FPU Util", DeviceArchitecture.BLACKHOLE) is None
        assert (
            hardware_counters.absence_hint(
                found, "FPU Util", DeviceArchitecture.BLACKHOLE
            )
            is None
        )

    @pytest.mark.parametrize(
        ("label", "absence", "fill_hint"),
        [
            (
                "Packer Utilization",
                CounterAbsence.NOT_CAPTURED,
                hardware_counters.label_fill_hint(
                    "Packer Utilization", DeviceArchitecture.BLACKHOLE
                ),
            ),
            ("Thread 3 Stall Rate", CounterAbsence.NOT_ON_ARCHITECTURE, None),
        ],
    )
    def test_only_a_label_a_capture_could_have_held_names_what_fills_it(
        self, label, absence, fill_hint
    ):
        """The one rule the panel's readings and the agent's units both answer by."""
        found = hardware_counters.discover(_header(["FPU Util"]))

        assert hardware_counters.absence_hint(
            found, label, DeviceArchitecture.BLACKHOLE
        ) == (absence, fill_hint)

    def test_quasar_only_labels_are_listed_only_on_quasar(self):
        assert not hardware_counters.is_listed(
            "Thread 3 Stall Rate", DeviceArchitecture.BLACKHOLE
        )
        assert not hardware_counters.is_listed(
            "Thread 3 Stall Rate", DeviceArchitecture.UNKNOWN
        )
        assert hardware_counters.is_listed(
            "Thread 3 Stall Rate", DeviceArchitecture.QUASAR
        )
        assert hardware_counters.is_listed(
            "Packer Engine 0 Util", DeviceArchitecture.BLACKHOLE
        )

    @pytest.mark.parametrize(
        "architecture",
        [
            DeviceArchitecture.UNKNOWN,
            DeviceArchitecture.GRAYSKULL,
            DeviceArchitecture.GRENDEL,
        ],
    )
    def test_an_architecture_the_counters_do_not_cover_reads_as_tensix_1xx(
        self, architecture
    ):
        assert hardware_counters.is_available("Packer Engine 0 Util", architecture)
        assert hardware_counters.is_available("L1 Unpacker0 Ext Util", architecture)
        assert not hardware_counters.is_available("Thread 3 Stall Rate", architecture)


class TestFillHints:
    def test_a_label_names_the_group_that_fills_it(self):
        assert hardware_counters.label_fill_hint("Packer Utilization") == (
            "filled when the capture ran with --profiler-capture-perf-counters=pack"
        )

    def test_a_label_across_two_banks_names_both(self):
        assert hardware_counters.label_fill_hint("FPU Execution Efficiency").endswith(
            "--profiler-capture-perf-counters=fpu,instrn"
        )

    def test_a_label_either_group_fills_names_each_on_blackhole(self):
        assert hardware_counters.label_fill_hint(
            "NOC Ring 1 Util", DeviceArchitecture.BLACKHOLE
        ).endswith("=l1_1 or =l1_3")

    def test_wormhole_drops_blackholes_extra_l1_groups(self):
        assert hardware_counters.label_fill_hint(
            "NOC Ring 1 Util", DeviceArchitecture.WORMHOLE
        ).endswith("=l1_1")

    @pytest.mark.parametrize(
        ("label", "hint"),
        [
            ("NOC Ring 1 Util", "l1_1"),
            ("L1 Mean Client Util", "l1_0 or =l1_1"),
            ("Packer Utilization", "pack"),
        ],
    )
    def test_an_unknown_architecture_names_only_groups_every_architecture_has(
        self, label, hint
    ):
        named = hardware_counters.label_fill_hint(label)

        assert named.endswith(f"--profiler-capture-perf-counters={hint}")
        assert not any(
            group.value in named for group in hardware_counters.BLACKHOLE_ONLY_GROUPS
        )

    def test_a_blackhole_only_counter_says_so_where_the_architecture_is_unknown(self):
        assert hardware_counters.label_fill_hint("L1 Packer Interfaces Util") == (
            "filled on Blackhole when the capture ran with "
            "--profiler-capture-perf-counters=l1_3 or =l1_4"
        )

    def test_a_family_needing_two_l1_groups_says_they_take_two_passes(self):
        hint = hardware_counters.fill_hint(
            hardware_counters.FAMILY_GROUPS[CounterFamily.NOC_RING]
        )

        assert "=l1_0,l1_1" in hint
        assert "--perf-counter-multipass" in hint

    def test_an_unknown_label_still_names_the_flag(self):
        assert "--profiler-capture-perf-counters" in (
            hardware_counters.label_fill_hint("Renamed Busy Metric")
        )


_L1_ANY = tuple(
    (group,)
    for group in (
        CaptureGroup.L1_0,
        CaptureGroup.L1_1,
        CaptureGroup.L1_2,
        CaptureGroup.L1_3,
        CaptureGroup.L1_4,
        CaptureGroup.L1_5,
    )
)

# The tables as they were written by hand before `_FILLS` held the relation once.
REQUIREMENTS_BEFORE = {
    "Math Pipeline Utilization": ((CaptureGroup.UNPACK,),),
    "Math Src Data Ready Rate": ((CaptureGroup.UNPACK,),),
    "Data Hazard Stall Rate": ((CaptureGroup.UNPACK,),),
    "FPU Execution Efficiency": ((CaptureGroup.FPU, CaptureGroup.INSTRN),),
    "Compute-to-Unpack Ratio": ((CaptureGroup.FPU, CaptureGroup.UNPACK),),
    "Math Scoreboard Stall Rate": ((CaptureGroup.PACK, CaptureGroup.UNPACK),),
    "NOC vs Compute Balance": ((CaptureGroup.FPU, CaptureGroup.L1_0),),
    "Unpacker L1 Efficiency": ((CaptureGroup.UNPACK, CaptureGroup.L1_0),),
    "Packer L1 Efficiency": ((CaptureGroup.PACK, CaptureGroup.L1_0),),
    "NOC Ring 0 Util": ((CaptureGroup.L1_0,), (CaptureGroup.L1_2,)),
    "NOC Ring 0 Grant Efficiency": ((CaptureGroup.L1_0,), (CaptureGroup.L1_2,)),
    "NOC Ring 1 Util": ((CaptureGroup.L1_1,), (CaptureGroup.L1_3,)),
    "NOC Ring 1 Grant Efficiency": ((CaptureGroup.L1_1,), (CaptureGroup.L1_3,)),
    "NOC Ring 1 Outgoing Util": ((CaptureGroup.L1_1,),),
    "NOC Ring 1 Incoming Util": ((CaptureGroup.L1_1,),),
    "NOC Ring 1 Outgoing Backpressure": ((CaptureGroup.L1_1,),),
    "NOC Ring 1 Incoming Backpressure": ((CaptureGroup.L1_1,),),
    "L1 Packer Port 8 Util": ((CaptureGroup.L1_1,),),
    "L1 Unpacker1 Ext Util": ((CaptureGroup.L1_1,), (CaptureGroup.L1_2,)),
    "L1 Unpacker1 Ext Backpressure": ((CaptureGroup.L1_1,), (CaptureGroup.L1_2,)),
    "L1 Packer Interfaces Util": ((CaptureGroup.L1_3,), (CaptureGroup.L1_4,)),
    "L1 Packer Interfaces Backpressure": ((CaptureGroup.L1_3,), (CaptureGroup.L1_4,)),
    "L1 Unpacker0 Ext Util": ((CaptureGroup.L1_4,), (CaptureGroup.L1_5,)),
    "L1 Unpacker0 Ext Backpressure": ((CaptureGroup.L1_4,), (CaptureGroup.L1_5,)),
    "L1 Mean Client Util": _L1_ANY,
}
GROUP_ANCHORS_BEFORE = {
    CaptureGroup.FPU: ("FPU Util", "SFPU Util", "MATH Util", "FPU SFPU Overlap"),
    CaptureGroup.PACK: ("Packer Utilization", "Packer Efficiency"),
    CaptureGroup.UNPACK: (
        "Unpacker0 Busy T0 Util",
        "Unpacker1 Busy T0 Util",
        "Math Pipeline Utilization",
        "SrcA Write Actual Efficiency",
    ),
    CaptureGroup.INSTRN: (
        "Any-Thread Stall Rate",
        "Thread 0 Stall Rate",
        "T0 Instrn Issue Rate",
    ),
    CaptureGroup.L1_0: (
        "L1 Total Bandwidth Util",
        "L1 Unpacker Port Util",
        "L1 Port 2 Util",
        "NOC Ring 0 Outgoing Util",
    ),
    CaptureGroup.L1_1: ("L1 Packer Port 8 Util", "NOC Ring 1 Outgoing Util"),
}
BLACKHOLE_WITNESSES_BEFORE = {
    CaptureGroup.L1_2: (
        ("L1 Unpacker1 Ext Util", CaptureGroup.L1_1),
        ("NOC Ring 0 Util", CaptureGroup.L1_0),
    ),
    CaptureGroup.L1_3: (
        ("NOC Ring 1 Util", CaptureGroup.L1_1),
        ("L1 Packer Interfaces Util", CaptureGroup.L1_4),
    ),
    CaptureGroup.L1_4: (
        ("L1 Packer Interfaces Util", CaptureGroup.L1_3),
        ("L1 Unpacker0 Ext Util", CaptureGroup.L1_5),
    ),
    CaptureGroup.L1_5: (("L1 Unpacker0 Ext Util", CaptureGroup.L1_4),),
}


class TestCaptureGroupTables:
    """The anchors and witnesses are derived from the one label-to-groups table."""

    def test_the_anchors_are_the_ones_written_by_hand(self):
        assert hardware_counters._GROUP_ANCHORS == GROUP_ANCHORS_BEFORE

    def test_the_witnesses_are_the_ones_written_by_hand(self):
        assert hardware_counters._BLACKHOLE_WITNESSES == BLACKHOLE_WITNESSES_BEFORE

    def test_every_label_needs_the_groups_it_did(self):
        for family in CounterFamily:
            first = hardware_counters.FAMILY_GROUPS[family][:1]
            for label in hardware_counters.labels_of(family):
                expected = REQUIREMENTS_BEFORE.get(label, (first,) if first else ())
                assert hardware_counters.requirement(label) == expected, label


class TestGroupStates:
    def test_a_one_pass_capture_names_the_groups_it_lacks(self):
        found = hardware_counters.discover(_header(ONE_PASS_LABELS))

        states = hardware_counters.group_states(found, DeviceArchitecture.BLACKHOLE)

        assert {
            group for group, state in states.items() if state is GroupState.FILLED
        } == {
            CaptureGroup.FPU,
            CaptureGroup.PACK,
            CaptureGroup.UNPACK,
            CaptureGroup.INSTRN,
            CaptureGroup.L1_0,
        }
        assert all(
            states[group] is GroupState.NOT_CAPTURED
            for group in (CaptureGroup.L1_1, *hardware_counters.BLACKHOLE_ONLY_GROUPS)
        )

    def test_wormhole_has_no_extra_l1_groups(self):
        found = hardware_counters.discover(_header(ONE_PASS_LABELS))

        states = hardware_counters.group_states(found, DeviceArchitecture.WORMHOLE)

        assert all(
            states[group] is GroupState.NOT_ON_ARCHITECTURE
            for group in hardware_counters.BLACKHOLE_ONLY_GROUPS
        )

    def test_blackholes_extra_groups_are_unknown_beside_l1_0_and_l1_1(self):
        """Their ports feed means over every L1 group captured."""
        found = hardware_counters.discover(
            _header(
                [
                    *ONE_PASS_LABELS,
                    "L1 Packer Port 8 Util",
                    "NOC Ring 1 Util",
                    "L1 Unpacker1 Ext Util",
                    "L1 Packer Interfaces Util",
                    "L1 Unpacker0 Ext Util",
                ]
            )
        )

        states = hardware_counters.group_states(found, DeviceArchitecture.BLACKHOLE)

        assert states[CaptureGroup.L1_1] is GroupState.FILLED
        assert all(
            states[group] is GroupState.UNKNOWN
            for group in hardware_counters.BLACKHOLE_ONLY_GROUPS
        )

    def test_an_extra_group_is_filled_when_the_other_one_was_not_captured(self):
        found = hardware_counters.discover(
            _header(["NOC Ring 0 Util", "L1 Unpacker1 Ext Util", "L1 Mean Client Util"])
        )

        states = hardware_counters.group_states(found, DeviceArchitecture.BLACKHOLE)

        assert states[CaptureGroup.L1_0] is GroupState.NOT_CAPTURED
        assert states[CaptureGroup.L1_1] is GroupState.NOT_CAPTURED
        assert states[CaptureGroup.L1_2] is GroupState.FILLED


class TestCells:
    @pytest.mark.parametrize("cell", ["", " ", "nan", "NaN", "inf", "-inf", "x", None])
    def test_a_blank_or_unreadable_cell_is_no_value(self, cell):
        assert hardware_counters.cell_value(cell) is None

    def test_a_value_is_rounded_to_three_places(self):
        assert hardware_counters.cell_value("9.395752740029262") == 9.396
        assert hardware_counters.cell_value("0") == 0.0


class TestReportColumns:
    def test_a_header_without_counters_adds_nothing(self):
        found = hardware_counters.discover(NOT_COUNTERS)

        assert hardware_counters.report_columns(found, detail=True) == {}

    def test_the_app_gets_each_captured_headline_average_and_the_grid(self):
        found = hardware_counters.discover(
            [*_header(["FPU Util", "Thread 0 Stall Rate"], ("Min", "Max", "Avg"))]
            + ["Avg FPU util on full grid (%)"]
        )

        assert hardware_counters.report_columns(found, detail=False) == {
            "hw_fpu_util": "FPU Util Avg (%)",
            "hw_grid_fpu_util": "Avg FPU util on full grid (%)",
        }

    def test_detail_adds_each_headlines_minimum_and_maximum(self):
        found = hardware_counters.discover(_header(["FPU Util"], ("Min", "Max", "Avg")))

        assert hardware_counters.report_columns(found, detail=True) == {
            "hw_fpu_util": "FPU Util Avg (%)",
            "hw_fpu_util_min": "FPU Util Min (%)",
            "hw_fpu_util_max": "FPU Util Max (%)",
        }

    def test_every_key_it_can_add_is_listed(self):
        found = hardware_counters.discover(
            _header(
                [unit.label for unit in hardware_counters.HEADLINE_UNITS],
                ("Min", "Max", "Avg"),
            )
            + [grid.column for grid in hardware_counters.FULL_GRID_UNITS]
        )

        assert (
            set(hardware_counters.report_columns(found, detail=True))
            == hardware_counters.REPORT_ROW_KEYS
        )


CSV_TEXT = (
    "OP CODE,FPU Util Avg (%),Thread 0 Stall Rate Avg (%)\n"
    "Matmul,9.5,1\n"
    "\n"
    "Concat,,\n"
    "Gelu,0.25,\n"
)


class TestReading:
    def test_a_row_is_found_by_position_skipping_empty_lines(self):
        """`csv.DictReader` skips them, and the generator numbers rows through it."""
        header, row = hardware_counters.read_row(io.StringIO(CSV_TEXT), 2)

        assert header[1] == "FPU Util Avg (%)"
        assert row is not None and row["OP CODE"] == "Gelu"

    @pytest.mark.parametrize("position", [-1, 3, 100])
    def test_a_position_past_either_end_has_no_row(self, position):
        _, row = hardware_counters.read_row(io.StringIO(CSV_TEXT), position)

        assert row is None

    def test_the_table_holds_every_counter_column_by_position(self):
        table = hardware_counters.read_table(io.StringIO(CSV_TEXT))

        assert table.row_count == 3
        assert table.value("FPU Util Avg (%)", 0) == 9.5
        assert table.value("FPU Util Avg (%)", 1) is None
        assert table.value("FPU Util Avg (%)", 2) == 0.25
        assert table.value("Thread 0 Stall Rate Avg (%)", 2) is None
        assert table.value("FPU Util Avg (%)", 3) is None
        assert table.value(None, 0) is None
        assert set(table.values) == {"FPU Util Avg (%)", "Thread 0 Stall Rate Avg (%)"}
        assert math.isnan(table.values["FPU Util Avg (%)"][1])

    def test_the_table_holds_no_median_which_nothing_reads(self):
        header = _header(["FPU Util"], ("Min", "Median", "Max", "Avg"))
        source = io.StringIO(",".join(header) + "\n1,2,3,4\n")

        table = hardware_counters.read_table(source)

        assert set(table.values) == {
            "FPU Util Min (%)",
            "FPU Util Max (%)",
            "FPU Util Avg (%)",
        }

    @pytest.mark.parametrize(
        "cell",
        ["", " ", "nan", "NaN", "inf", "-inf", "1e400", "x", " 12.5 ", "0"]
        + ["9.395752740029262", "-0.0004"],
    )
    def test_a_cell_reads_as_cell_value_reads_it(self, cell):
        table = hardware_counters.read_table(
            io.StringIO(f'FPU Util Avg (%),OP CODE\n"{cell}",Matmul\n')
        )

        assert table.value("FPU Util Avg (%)", 0) == hardware_counters.cell_value(cell)

    def test_a_row_short_of_a_column_has_no_value_there(self):
        table = hardware_counters.read_table(
            io.StringIO("OP CODE,FPU Util Avg (%)\nMatmul\n")
        )

        assert table.row_count == 1
        assert table.value("FPU Util Avg (%)", 0) is None

    def test_a_tables_reader_reads_a_row_as_the_rows_own_reader_does(self):
        """The route reads a CSV row, the agent's tools a table, by one rule."""
        header = _header(["FPU Util"], ("Min", "Median", "Max", "Avg"))
        text = ",".join(header) + "\n1,2,3,4.25\n"
        table = hardware_counters.read_table(io.StringIO(text))
        _, row = hardware_counters.read_row(io.StringIO(text), 0)
        assert row is not None
        from_row = table.header.row_reader(row)

        for stat, _ in hardware_counters.ROW_KEY_STATS:
            assert table.reader(0)("FPU Util", stat) == from_row("FPU Util", stat)
        assert from_row("FPU Util", CounterStat.MIN) == 1
        assert from_row("FPU Util", CounterStat.MEDIAN) == 2
        assert table.reader(0)("FPU Util", CounterStat.MEDIAN) is None

    @pytest.mark.parametrize("position", [None, -1, 1])
    def test_a_tables_reader_without_a_row_reads_nothing(self, position):
        table = hardware_counters.read_table(io.StringIO("FPU Util Avg (%)\n4\n"))

        assert table.reader(position)("FPU Util", CounterStat.AVG) is None
        assert table.reader(0)("Thread 0 Stall Rate", CounterStat.AVG) is None

    @pytest.mark.parametrize(
        "read",
        [
            hardware_counters.read_table,
            lambda source: hardware_counters.read_row(source, 0),
        ],
    )
    def test_an_undecodable_csv_is_a_format_error(self, read):
        source = io.TextIOWrapper(io.BytesIO(b"FPU Util Avg (%)\n\xff\xfe\n"), "utf-8")

        with pytest.raises(DataFormatError):
            read(source)

    @pytest.mark.parametrize(
        "read",
        [
            hardware_counters.read_table,
            lambda source: hardware_counters.read_row(source, 0),
        ],
    )
    def test_a_csv_the_reader_refuses_is_a_format_error(self, read):
        """A field past `csv.field_size_limit`, which every Python's reader refuses."""
        oversized = "x" * (csv.field_size_limit() + 1)
        source = io.StringIO(f"OP CODE,FPU Util Avg (%)\n{oversized},1\n")

        with pytest.raises(DataFormatError, match="could not be read"):
            read(source)


class TestOperationCounters:
    def _counters(
        self, row, labels=ONE_PASS_LABELS, architecture=DeviceArchitecture.BLACKHOLE
    ):
        found = hardware_counters.discover(_header(labels, ("Min", "Max", "Avg")))
        return hardware_counters.operation_counters(row, found, architecture)

    def test_a_unit_carries_its_stats_and_a_missing_one_says_why(self):
        counters = self._counters(
            {
                "FPU Util Min (%)": "8.9",
                "FPU Util Max (%)": "9.9",
                "FPU Util Avg (%)": "9.4",
            }
        )
        units = {unit["unit"]: unit for unit in counters["units"]}

        assert units["fpu"]["avg"] == 9.4
        assert units["fpu"]["min"] == 8.9
        assert units["fpu"]["median"] is None
        assert units["fpu"]["absence"] is None
        assert units["noc_ring1"]["absence"] == "not_captured"
        assert units["noc_ring1"]["fill_hint"].endswith("=l1_1 or =l1_3")
        assert units["packer"]["absence"] == "no_value"
        assert units["packer"]["fill_hint"] is None

    def test_an_op_with_no_counter_value_says_so(self):
        counters = self._counters({"FPU Util Avg (%)": ""})

        assert counters["has_counters"] is True
        assert counters["op_has_counters"] is False
        assert {unit["absence"] for unit in counters["units"]} <= {
            "no_value",
            "not_captured",
        }

    def test_a_family_lists_its_labels_and_the_ones_not_on_its_architecture(self):
        families = {
            family["family"]: family for family in self._counters({})["families"]
        }
        pack = {metric["label"]: metric for metric in families["pack"]["metrics"]}

        assert families["pack"]["captured"] is True
        assert pack["Packer Engine 0 Util"]["absence"] == "not_on_architecture"
        assert pack["Packer Efficiency"]["absence"] == "not_captured"
        assert "Thread 3 Stall Rate" not in {
            metric["label"] for metric in families["stalls"]["metrics"]
        }
        assert "other" not in families

    def test_an_unknown_label_is_listed_under_other(self):
        counters = self._counters(
            {"Renamed Busy Metric Avg (%)": "3"},
            labels=(*ONE_PASS_LABELS, "Renamed Busy Metric"),
        )
        families = {family["family"]: family for family in counters["families"]}

        assert [metric["label"] for metric in families["other"]["metrics"]] == [
            "Renamed Busy Metric"
        ]
        assert families["other"]["metrics"][0]["avg"] == 3.0

    def test_a_report_without_counters_says_so_and_keeps_the_model(self):
        counters = hardware_counters.operation_counters(
            {"PM FPU UTIL (%)": "45.5", "PM COMPUTE [ns]": "900"},
            hardware_counters.discover(NOT_COUNTERS),
            DeviceArchitecture.UNKNOWN,
        )

        assert counters == {
            "has_counters": False,
            "op_has_counters": False,
            "architecture": None,
            "device_id": None,
            "has_compute_kernel": None,
            "units": [],
            "full_grid": [],
            "families": [],
            "performance_model": {"fpu_util": 45.5},
        }

    @pytest.mark.parametrize(
        ("architecture", "named"),
        [
            (DeviceArchitecture.WORMHOLE, "wormhole_b0"),
            (DeviceArchitecture.BLACKHOLE, "blackhole"),
            (DeviceArchitecture.UNKNOWN, None),
        ],
    )
    def test_the_architecture_is_spelled_as_the_device_log_spells_it(
        self, architecture, named
    ):
        assert self._counters({}, architecture=architecture)["architecture"] == named

    @pytest.mark.parametrize(
        ("cell", "device"), [("1", 1), ("0.0", 0), ("", None), ("x", None)]
    )
    def test_it_names_the_device_whose_row_it_read(self, cell, device):
        assert self._counters({"DEVICE ID": cell})["device_id"] == device

    @pytest.mark.parametrize(
        ("cell", "has_kernel"),
        [
            (
                "['ttnn/cpp/ttnn/operations/eltwise/unary/device/kernels/eltwise_sfpu.cpp']",
                True,
            ),
            ("['a.cpp'; 'b.cpp']", True),
            ("[]", False),
            (" [ ] ", False),
            ("", None),
            (None, None),
        ],
    )
    def test_it_says_whether_the_op_has_a_compute_kernel(self, cell, has_kernel):
        row = {} if cell is None else {"COMPUTE KERNEL SOURCE": cell}

        assert self._counters(row)["has_compute_kernel"] is has_kernel

    def test_the_models_placeholder_time_is_not_a_utilisation(self):
        assert hardware_counters.performance_model(
            {"PM FPU UTIL (%)": "0.004", "PM COMPUTE [ns]": "1"}
        ) == {"fpu_util": None}
