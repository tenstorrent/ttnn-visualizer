# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""The hardware counters an agent reads: the `counters` include group, the sort metrics
and `hw_utilisation`. #2371"""

import json
from unittest.mock import patch

import pytest
from ttnn_visualizer import hardware_counters
from ttnn_visualizer.agent import hw_utilisation, server, tools
from ttnn_visualizer.agent.bounds import MAX_LIMIT
from ttnn_visualizer.agent.handles import ReportRegistry, load_report
from ttnn_visualizer.csv_queries import REPORT_ROW_ID_OFFSET
from ttnn_visualizer.tests.hardware_counter_capture import (
    PERCENT_LABELS,
    RATIO_LABELS,
    UNKNOWN_LABEL,
    WORMHOLE_PREAMBLE,
    counter_rows,
    is_counted,
    label_values,
    stat_column,
    write_counter_capture,
    write_device_log,
)
from ttnn_visualizer.tests.smoke_capture import smoke_rows, write_ops_perf

FLAG = "--profiler-capture-perf-counters"
COUNTER_METRICS = ("hw_fpu_util", "hw_sfpu_util", "hw_math_util")


@pytest.fixture
def counted(tmp_path):
    write_counter_capture(tmp_path / "counted")
    registry = ReportRegistry()
    handle = load_report(registry, performance_path=str(tmp_path / "counted"))["handle"]
    return registry, handle


@pytest.fixture
def wormhole(tmp_path):
    write_counter_capture(tmp_path / "wormhole", WORMHOLE_PREAMBLE)
    registry = ReportRegistry()
    handle = load_report(registry, performance_path=str(tmp_path / "wormhole"))[
        "handle"
    ]
    return registry, handle


@pytest.fixture
def plain(tmp_path):
    write_ops_perf(tmp_path / "plain", smoke_rows())
    registry = ReportRegistry()
    handle = load_report(registry, performance_path=str(tmp_path / "plain"))["handle"]
    return registry, handle


def _average(label, row):
    """The fixture's average for `label` on a report row, or None where it has none."""
    position = int(row["id"]) - REPORT_ROW_ID_OFFSET
    if not is_counted(position):
        return None
    *_, average = label_values(PERCENT_LABELS.index(label), position)
    return average


def _timed_rows(registry, handle):
    return [
        row
        for row in tools.canonical_report(registry, handle)["report"]
        if tools.countable_device_time(row) is not None
    ]


class TestSortMetrics:
    def test_fpu_sfpu_and_math_utilisation_are_sort_keys_named_as_the_rows_name_them(
        self,
    ):
        assert {
            metric: tools.SORTABLE_METRICS[metric] for metric in COUNTER_METRICS
        } == {metric: metric for metric in COUNTER_METRICS}
        assert not set(COUNTER_METRICS) & tools.ADDITIVE_METRICS

    def test_no_sort_key_reads_as_the_perf_models_figure(self):
        """`project_row` names a row's value after its sort key, beside `fpu_util_percent`."""
        assert not {"fpu_util", "sfpu_util", "math_util"} & set(tools.SORTABLE_METRICS)

    def test_top_ops_ranks_the_busiest_first_and_skips_ops_without_one(self, counted):
        registry, handle = counted

        answer = tools.top_ops(registry, handle, by="hw_sfpu_util", limit=MAX_LIMIT)
        values = [op["hw_sfpu_util"] for op in answer["ops"]]

        assert values == sorted(values, reverse=True)
        assert None not in values
        assert len(values) == sum(
            1
            for row in tools.canonical_report(registry, handle)["report"]
            if _average("SFPU Util", row) is not None
        )
        assert "hw_sfpu_util_total" not in answer

    def test_a_capture_without_counters_ranks_none_and_says_what_fills_them(
        self, plain
    ):
        registry, handle = plain

        answer = tools.top_ops(registry, handle, by="hw_fpu_util")

        assert answer["ops"] == []
        assert f"{FLAG}=fpu" in answer["caveat"]
        assert "hw_fpu_util" in answer["caveat"]

    def test_diff_reports_still_refuses_a_rate(self, counted):
        registry, handle = counted

        with pytest.raises(ValueError, match="not meaningful.*'hw_fpu_util'"):
            tools.diff_reports(registry, handle, handle, by="hw_fpu_util")

    def test_the_old_names_are_refused(self, counted):
        registry, handle = counted

        with pytest.raises(ValueError, match="hw_fpu_util"):
            tools.top_ops(registry, handle, by="fpu_util")


class TestCountersGroup:
    def test_each_row_carries_the_averages_and_their_range(self, counted):
        registry, handle = counted

        answer = tools.top_ops(registry, handle, by="hw_fpu_util", include=["counters"])
        top = answer["ops"][0]

        assert top["hw_fpu_util_percent"] == top["hw_fpu_util"]
        assert (
            top["hw_fpu_util_min_percent"]
            < top["hw_fpu_util_percent"]
            < (top["hw_fpu_util_max_percent"])
        )
        assert top["hw_grid_fpu_util_percent"] is not None

    def test_a_group_the_capture_lacks_names_its_flag_not_a_missing_column(
        self, counted
    ):
        registry, handle = counted

        answer = tools.top_ops(registry, handle, include=["counters"])
        empty = answer["empty_in_report"]

        assert set(empty) == {
            f"hw_{unit}{suffix}_percent"
            for unit in ("packer_util", "noc_ring1_util")
            for suffix in ("", "_min", "_max")
        }
        assert all(FLAG in hint for hint in empty.values())
        assert empty["hw_packer_util_percent"].endswith("=pack")
        assert "hw_packer_util_percent" not in answer["ops"][0]

    def test_a_blackhole_capture_names_either_l1_group_for_a_noc_ring(self, counted):
        registry, handle = counted

        empty = tools.top_ops(registry, handle, include=["counters"])["empty_in_report"]

        assert empty["hw_noc_ring1_util_percent"].endswith(f"{FLAG}=l1_1 or =l1_3")

    def test_a_wormhole_capture_is_never_sent_to_blackholes_l1_groups(self, wormhole):
        registry, handle = wormhole

        empty = tools.top_ops(registry, handle, include=["counters"])["empty_in_report"]

        assert empty["hw_noc_ring1_util_percent"].endswith(f"{FLAG}=l1_1")
        assert not any(
            group.value in hint
            for hint in empty.values()
            for group in hardware_counters.BLACKHOLE_ONLY_GROUPS
        )

    def test_without_a_device_log_only_groups_every_architecture_has_are_named(
        self, tmp_path
    ):
        write_ops_perf(tmp_path / "no-log", counter_rows())
        registry = ReportRegistry()
        handle = load_report(registry, performance_path=str(tmp_path / "no-log"))[
            "handle"
        ]

        empty = tools.top_ops(registry, handle, include=["counters"])["empty_in_report"]

        assert empty["hw_noc_ring1_util_percent"].endswith(f"{FLAG}=l1_1")

    def test_a_capture_without_counters_names_every_field_with_its_flag(self, plain):
        registry, handle = plain

        answer = tools.top_ops(registry, handle, include=["counters"])

        assert len(answer["empty_in_report"]) == len(hardware_counters.REPORT_ROW_KEYS)
        assert all(FLAG in hint for hint in answer["empty_in_report"].values())

    def test_operation_detail_takes_it_too(self):
        table = server._tool_table(ReportRegistry())
        include = table["operation_detail"]["schema"]["properties"]["include"]

        assert "counters" in include["items"]["enum"]


class TestSummary:
    def test_a_capture_without_counters_is_refused_naming_the_flag(self, plain):
        registry, handle = plain

        with pytest.raises(ValueError, match=f"{FLAG}=<groups>"):
            hw_utilisation.hw_utilisation(registry, handle)

    def test_a_units_average_is_weighted_by_device_time(self, counted):
        registry, handle = counted
        rows = _timed_rows(registry, handle)
        valued = [(row, _average("FPU Util", row)) for row in rows]
        valued = [(row, value) for row, value in valued if value is not None]
        times = [tools.countable_device_time(row) for row, _ in valued]
        expected = sum(value * time for (_, value), time in zip(valued, times)) / sum(
            times
        )

        answer = hw_utilisation.hw_utilisation(registry, handle)
        fpu = next(unit for unit in answer["units"] if unit["unit"] == "fpu")

        assert fpu["weighted_avg_percent"] == pytest.approx(expected, abs=1e-3)
        assert fpu["ops_with_value"] == len(valued)
        assert 0 < fpu["device_time_share_percent"] < 100
        assert answer["device_time_unit"] == "us"

    def test_a_units_top_ops_kept_it_busy_longest(self, counted):
        registry, handle = counted

        answer = hw_utilisation.hw_utilisation(registry, handle)
        sfpu = next(unit for unit in answer["units"] if unit["unit"] == "sfpu")
        busy = [op["busy_us"] for op in sfpu["top_ops"]]

        assert len(busy) == hw_utilisation.TOP_OPS_PER_UNIT
        assert busy == sorted(busy, reverse=True)
        top = sfpu["top_ops"][0]
        assert top["busy_us"] == pytest.approx(
            top["avg"] / 100 * top["device_time"], abs=1e-3
        )

    def test_a_unit_the_capture_lacks_says_what_fills_it(self, counted):
        registry, handle = counted

        units = {
            unit["unit"]: unit
            for unit in hw_utilisation.hw_utilisation(registry, handle)["units"]
        }

        assert units["packer"]["state"] == "not_captured"
        assert units["packer"]["fill_hint"].endswith(f"{FLAG}=pack")
        assert "weighted_avg_percent" not in units["packer"]
        assert units["noc_ring1"]["fill_hint"].endswith("=l1_1 or =l1_3")

    def test_it_says_which_groups_the_capture_filled(self, counted):
        registry, handle = counted

        groups = hw_utilisation.hw_utilisation(registry, handle)["capture_groups"]

        assert groups == {
            "fpu": "filled",
            "pack": "not_captured",
            "unpack": "filled",
            "instrn": "filled",
            "l1_0": "filled",
            "l1_1": "not_captured",
            "l1_2": "not_captured",
            "l1_3": "not_captured",
            "l1_4": "not_captured",
            "l1_5": "not_captured",
        }

    def test_families_list_the_labels_held_and_those_not_on_the_architecture(
        self, counted
    ):
        registry, handle = counted

        answer = hw_utilisation.hw_utilisation(registry, handle)
        families = {family["family"]: family for family in answer["families"]}

        assert answer["architecture"] == "blackhole"
        assert families["compute"]["labels"] == ["FPU Util", "SFPU Util", "MATH Util"]
        assert "Packer Engine 0 Util" in families["pack"]["not_on_architecture"]
        assert families["pack"]["captured"] is False
        assert FLAG in families["pack"]["fill_hint"]
        assert families["other"]["labels"] == [UNKNOWN_LABEL]

    def test_the_note_says_whose_row_a_merged_op_reads(self, counted):
        registry, handle = counted

        note = hw_utilisation.hw_utilisation(registry, handle)["note"]

        assert "slowest device's row" in note
        assert "rather than read as 0" in note

    def test_the_architecture_is_spelled_as_the_flags_spell_it(self, wormhole):
        registry, handle = wormhole

        assert (
            hw_utilisation.hw_utilisation(registry, handle)["architecture"]
            == "wormhole_b0"
        )

    def test_a_device_log_that_cannot_be_read_leaves_the_architecture_unknown(
        self, counted
    ):
        registry, handle = counted

        with patch.object(
            tools.DeviceLogProfilerQueries,
            "read_device_meta",
            side_effect=PermissionError("unreadable"),
        ):
            answer = hw_utilisation.hw_utilisation(registry, handle)

        units = {unit["unit"]: unit for unit in answer["units"]}
        assert answer["architecture"] is None
        assert units["noc_ring1"]["fill_hint"].endswith(f"{FLAG}=l1_1")

    def test_other_lists_a_capped_number_of_labels_and_counts_the_rest(self, tmp_path):
        """An agent's answer is bounded however many labels a later tt-metal renames."""
        renamed = [
            f"Renamed Metric {index}"
            for index in range(hw_utilisation.MAX_LISTED_OTHER_LABELS + 5)
        ]
        overlong = "Renamed " + "x" * hw_utilisation.MAX_COUNTER_LABEL_LENGTH
        rows = [
            {
                **row,
                **{stat_column(label, "Avg"): "1.5" for label in [overlong, *renamed]},
            }
            for row in counter_rows()
        ]
        write_ops_perf(tmp_path / "renamed", rows)
        registry = ReportRegistry()
        handle = load_report(registry, performance_path=str(tmp_path / "renamed"))[
            "handle"
        ]

        families = {
            family["family"]: family
            for family in hw_utilisation.hw_utilisation(registry, handle)["families"]
        }
        other = families["other"]

        assert other["labels"] == [
            UNKNOWN_LABEL,
            *renamed[: hw_utilisation.MAX_LISTED_OTHER_LABELS - 1],
        ]
        assert other["labels_unlisted"] == len(renamed) + 2 - len(other["labels"])
        assert overlong not in other["labels"]

    def test_the_counters_are_read_once_per_handle(self, counted):
        registry, handle = counted

        with patch.object(
            hardware_counters, "read_table", wraps=hardware_counters.read_table
        ) as read:
            hw_utilisation.hw_utilisation(registry, handle)
            hw_utilisation.hw_utilisation(registry, handle, label="FPU Util")

        assert read.call_count == 1


class TestRanking:
    def test_highest_ranks_by_busy_time(self, counted):
        registry, handle = counted

        ranked = hw_utilisation.hw_utilisation(
            registry, handle, label="MATH Util", limit=MAX_LIMIT
        )["ranked"]
        busy = [op["busy_us"] for op in ranked["ops"]]

        assert ranked["weighted"] is True
        assert busy == sorted(busy, reverse=True)
        assert ranked["op_count"] == len(busy)

    def test_lowest_ranks_by_idle_time(self, counted):
        registry, handle = counted

        ranked = hw_utilisation.hw_utilisation(
            registry, handle, label="FPU Util", order="lowest", limit=MAX_LIMIT
        )["ranked"]
        top = ranked["ops"][0]

        assert top["idle_us"] == pytest.approx(
            (1 - top["avg"] / 100) * top["device_time"], abs=1e-3
        )
        idle = [op["idle_us"] for op in ranked["ops"]]
        assert idle == sorted(idle, reverse=True)

    def test_unweighted_ranks_by_the_average_itself(self, counted):
        registry, handle = counted

        ranked = hw_utilisation.hw_utilisation(
            registry, handle, label="FPU Util", order="lowest", weighted=False
        )["ranked"]
        averages = [op["avg"] for op in ranked["ops"]]

        assert averages == sorted(averages)
        assert "idle_us" not in ranked["ops"][0]

    def test_a_ratio_ranks_by_its_value_and_refuses_a_weight(self, counted):
        registry, handle = counted
        label = RATIO_LABELS[0]

        ranked = hw_utilisation.hw_utilisation(registry, handle, label=label)["ranked"]

        assert ranked["measure"] == "ratio"
        assert ranked["weighted"] is False
        with pytest.raises(ValueError, match="weighted false"):
            hw_utilisation.hw_utilisation(registry, handle, label=label, weighted=True)

    def test_a_label_is_matched_whatever_its_case(self, counted):
        registry, handle = counted

        ranked = hw_utilisation.hw_utilisation(registry, handle, label="fpu util")[
            "ranked"
        ]

        assert ranked["label"] == "FPU Util"

    def test_any_label_ranks_including_one_this_version_does_not_know(self, counted):
        registry, handle = counted

        ranked = hw_utilisation.hw_utilisation(registry, handle, label=UNKNOWN_LABEL)[
            "ranked"
        ]

        assert ranked["family"] == "other"
        assert ranked["ops"]

    def test_a_known_label_the_capture_lacks_says_what_fills_it(self, counted):
        registry, handle = counted

        with pytest.raises(ValueError, match=f"{FLAG}=l1_1 or =l1_3"):
            hw_utilisation.hw_utilisation(registry, handle, label="NOC Ring 1 Util")

    def test_a_label_not_on_the_architecture_says_so(self, counted):
        registry, handle = counted

        with pytest.raises(ValueError, match="not available on this architecture"):
            hw_utilisation.hw_utilisation(
                registry, handle, label="Packer Engine 0 Util"
            )

    def test_an_unknown_label_is_refused_pointing_at_the_listing(self, counted):
        registry, handle = counted

        with pytest.raises(ValueError, match="without label"):
            hw_utilisation.hw_utilisation(registry, handle, label="Nope")

    def test_an_overlong_label_is_refused_before_any_read(self, counted):
        registry, handle = counted

        with (
            patch.object(tools, "hardware_counter_table") as read,
            pytest.raises(ValueError, match="counter label"),
        ):
            hw_utilisation.hw_utilisation(registry, handle, label="x" * 500)
        read.assert_not_called()

    @pytest.mark.parametrize(
        ("arguments", "match"),
        [
            ({"order": "sideways"}, "unknown order"),
            ({"weighted": "yes"}, "weighted must be"),
            ({"limit": "many"}, "limit must be"),
        ],
    )
    def test_a_bad_argument_is_refused_by_name(self, counted, arguments, match):
        registry, handle = counted

        with pytest.raises(ValueError, match=match):
            hw_utilisation.hw_utilisation(
                registry, handle, label="FPU Util", **arguments
            )

    def test_a_limit_is_capped(self, counted):
        registry, handle = counted

        ranked = hw_utilisation.hw_utilisation(
            registry, handle, label="FPU Util", limit=1
        )["ranked"]

        assert len(ranked["ops"]) == 1
        assert ranked["op_count"] > 1


class TestPartitionedCapture:
    """Summed device time overstates elapsed time over sub-devices that ran at once."""

    @staticmethod
    def _handle(tmp_path, name, rows):
        partitioned = [
            {**row, "SUB DEVICE ID": str(position % 2)}
            for position, row in enumerate(rows)
        ]
        write_ops_perf(tmp_path / name, partitioned)
        write_device_log(tmp_path / name)
        registry = ReportRegistry()
        return (
            registry,
            load_report(registry, performance_path=str(tmp_path / name))["handle"],
        )

    def test_the_summary_names_the_partitioning(self, tmp_path):
        registry, handle = self._handle(tmp_path, "counted", counter_rows())

        caveat = hw_utilisation.hw_utilisation(registry, handle)["caveat"]

        assert "spans 2 sub-devices" in caveat

    def test_ranking_an_uncounted_one_by_a_counter_says_each_caveat_once(
        self, tmp_path
    ):
        registry, handle = self._handle(tmp_path, "plain", smoke_rows())

        caveat = tools.top_ops(registry, handle, by="hw_fpu_util")["caveat"]

        assert caveat.count("spans 2 sub-devices") == 1
        assert caveat.count("No row carries hw_fpu_util") == 1


class TestTransport:
    def test_load_report_lists_it_only_for_a_capture_with_counters(
        self, tmp_path, counted
    ):
        write_ops_perf(tmp_path / "plain", smoke_rows())
        registry, _ = counted

        assert (
            "hw_utilisation"
            in load_report(registry, performance_path=str(tmp_path / "counted"))[
                "answerable"
            ]
        )
        assert (
            "hw_utilisation"
            in load_report(registry, performance_path=str(tmp_path / "plain"))[
                "unanswerable"
            ]
        )

    def test_it_is_registered_and_answers_a_call(self, counted):
        registry, handle = counted
        table = server._tool_table(registry)

        response = server.handle_message(
            {
                "jsonrpc": "2.0",
                "id": 7,
                "method": "tools/call",
                "params": {
                    "name": "hw_utilisation",
                    "arguments": {"handle": handle, "label": "SFPU Util"},
                },
            },
            table,
        )
        answer = json.loads(response["result"]["content"][0]["text"])

        assert table["hw_utilisation"]["title"]
        assert answer["ranked"]["label"] == "SFPU Util"

    def test_a_capture_without_counters_comes_back_as_a_refusal(self, plain):
        registry, handle = plain

        response = server.handle_message(
            {
                "jsonrpc": "2.0",
                "id": 8,
                "method": "tools/call",
                "params": {"name": "hw_utilisation", "arguments": {"handle": handle}},
            },
            server._tool_table(registry),
        )

        assert response["result"]["isError"] is True
        assert FLAG in response["result"]["content"][0]["text"]
