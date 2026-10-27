# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""The `flags` include group: the performance view's heuristic flags for an agent. #2193

`test_agent_perf_flags_parity.py` holds the port to the app's functions. These hold what
the tools add around it: the device log and the whole report the flags are read against,
the perf model's placeholder the view misreads, and where the flags reach a response.
"""

import json
import math
from pathlib import Path
from unittest.mock import patch

import pytest
from ttnn_visualizer.agent import linking, perf_detail, perf_flags, tools
from ttnn_visualizer.agent.handles import ReportRegistry, load_report
from ttnn_visualizer.agent.perf_flags import FlagRow
from ttnn_visualizer.csv_queries import (
    PROGRAM_CACHE_HIT_COLUMN,
    PROGRAM_HASH_COLUMN,
    DeviceLogMeta,
    DeviceLogProfilerQueries,
    ResolvedSignposts,
)
from ttnn_visualizer.models import Instance
from ttnn_visualizer.tests.smoke_capture import (
    signposted_rows,
    smoke_rows,
    write_ops_perf,
)
from ttnn_visualizer.tests.test_agent_linking import _graph, _write_profiler
from ttnn_visualizer.tests.test_agent_perf_flags_parity import REPORT_ROW_DEFAULTS
from ttnn_visualizer.tests.test_agent_tools import _perf_report
from ttnn_visualizer.tests.test_device_log_columns import MODERN_HEADER

_FLAGS = [perf_detail.DetailGroup.FLAGS.value]
_WORMHOLE_64 = "ARCH: wormhole_b0, CHIP_FREQ[MHz]: 1000, Max Compute Cores: 64"


def _write_device_log(directory: Path, first_line: str) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    (directory / DeviceLogProfilerQueries.DEVICE_LOG_FILE).write_text(
        f"{first_line}\n{MODERN_HEADER}\n", encoding="utf-8"
    )


def _row(row_id, **fields):
    return {"id": str(row_id), **REPORT_ROW_DEFAULTS, **fields}


# 0.03 of the device time on all its cores: 3% utilisation, well under the threshold.
_LOW = {"pm_ideal_ns": "300", "device_time": "10.0"}


def _flag_names(op):
    return [entry["flag"] for entry in op["flags"]]


@pytest.fixture
def handle_with(tmp_path):
    """Performance-only handles, each generating a report of its own `rows`, under a
    device log with `first_line`, or none.

    One patch for every handle, answering by the directory a report is read from, so a
    handle never reads another's rows and nothing outlives the test.
    """
    rows_by_path = {}

    def generate(instance, **overrides):
        return _perf_report(rows_by_path[instance.performance_path])

    def _handle_with(rows, first_line=_WORMHOLE_64):
        directory = tmp_path / f"capture-{len(rows_by_path)}"
        directory.mkdir()
        if first_line is not None:
            _write_device_log(directory, first_line)
        registry = ReportRegistry()
        handle = load_report(registry, performance_path=str(directory))["handle"]
        rows_by_path[registry.get(handle).performance_path] = rows
        return registry, handle

    with patch.object(tools, "_generate_canonical_report", side_effect=generate):
        yield _handle_with


def test_each_handle_the_fixture_makes_reads_its_own_rows(handle_with):
    first = handle_with([_row(1, op_code="First")])
    second = handle_with([_row(1, op_code="Second")])

    assert tools.top_ops(*first)["ops"][0]["op_code"] == "First"
    assert tools.top_ops(*second)["ops"][0]["op_code"] == "Second"


class TestDeviceMeta:
    """The device log as the view reads it: through the one shared reader."""

    @pytest.mark.parametrize(
        ("first_line", "expected"),
        [
            ("\ufeffARCH: blackhole, Max Compute Cores: 120", ("blackhole", 120)),
            ("ARCH: wormhole_b0 Max Compute Cores: 56", ("wormhole_b0", 56)),
        ],
        ids=["bom-before-arch", "no-comma"],
    )
    def test_the_flags_read_the_count_the_view_serves(
        self, handle_with, first_line, expected
    ):
        registry, handle = handle_with([_row(1)], first_line)

        basis = tools.top_ops(registry, handle, include=_FLAGS)["flag_basis"]

        assert (basis["architecture"], basis["max_cores"]) == expected
        assert basis["max_cores_source"] == "device_log"

    def test_a_byte_that_is_not_utf_8_on_line_two_costs_nothing(self, handle_with):
        """The view reads such a log, and so do `load_report` (#2184) and the flags."""
        registry, handle = handle_with([_row(1)], None)
        directory = Path(registry.get(handle).performance_path)
        (directory / DeviceLogProfilerQueries.DEVICE_LOG_FILE).write_bytes(
            b"ARCH: blackhole, CHIP_FREQ[MHz]: 1350, Max Compute Cores: 120\n"
            b"PCIe slot, core_x \xff\n"
        )

        reloaded = load_report(registry, performance_path=str(directory))["handle"]
        basis = tools.top_ops(registry, reloaded, include=_FLAGS)["flag_basis"]

        assert (basis["max_cores"], basis["max_cores_source"]) == (120, "device_log")
        assert tools._device_meta(
            Instance(instance_id="non-utf-8", performance_path=str(directory))
        ) == DeviceLogMeta("blackhole", 1350, 120)


class TestOversizedCells:
    """A cell past the float range reads as infinity, as the view's `parseInt` gives."""

    # The second is past Python's limit on converting a digit string to an int.
    _OVERSIZED = pytest.mark.parametrize("cell", ["9" * 309, "9" * 5000])

    @_OVERSIZED
    def test_a_row_s_cores(self, cell):
        assert perf_flags.row_cores({"cores": cell}) == math.inf

    @_OVERSIZED
    def test_a_row_s_available_cores(self, cell):
        row = perf_flags.typed_row({"available_cores": cell})

        assert row.available_cores == math.inf


class TestResolveMaxCores:
    @pytest.mark.parametrize(
        ("meta", "cores", "expected"),
        [
            (DeviceLogMeta("blackhole", None, 120), [8], (120, "device_log")),
            (DeviceLogMeta("blackhole"), [8], (130, "architecture_default")),
            (None, [8], (64, "architecture_default")),
            (None, [64], (64, "architecture_default")),
            (None, [100], (100, "report_rows")),
            (DeviceLogMeta("horizon"), [8], (64, "architecture_default")),
            (DeviceLogMeta("blackhole", None, 0), [200], (64, "fallback_default")),
        ],
    )
    def test_the_count_says_where_it_came_from(self, meta, cores, expected):
        resolved = perf_flags.resolve_max_cores(meta, [float(count) for count in cores])

        assert (resolved.cores, resolved.source.value) == expected


class TestEvidence:
    def test_figures_are_rounded_and_counts_are_integers(self):
        row = perf_flags.typed_row(
            _row(
                1,
                bound="SLOW",
                dram_percent="41.23456",
                flops_percent="12.98765",
                cores="8",
                available_cores=None,
            )
        )

        flags = perf_flags.heuristic_flags(row, 64)

        # As JSON text, since 8 == 8.0 would pass a comparison of the values.
        assert json.dumps(flags, allow_nan=False) == json.dumps(
            [
                {
                    "flag": "dram_bound",
                    "reason": "slow_dram_above_flops",
                    "dram_percent": 41.235,
                    "flops_percent": 12.988,
                },
                {
                    "flag": "underutilised_cores",
                    "core_capacity": 64,
                    "core_capacity_from": "max_cores",
                },
            ]
        )

    def test_utilisation_is_a_percent_cut_to_three_places(self):
        row = perf_flags.typed_row(_row(1, pm_ideal_ns="12.3456789", device_time="1"))

        (low,) = perf_flags.heuristic_flags(row, 64)

        assert low == {
            "flag": "low_utilisation",
            "core_utilisation_percent": 1.234,
            "roofline_modelled": True,
        }

    @pytest.mark.parametrize(
        "ideal", ["299.95", "299.99", "299.995", "299.9999", "299.99999999"]
    )
    def test_a_utilisation_just_under_the_threshold_never_reads_as_at_it(self, ideal):
        """0.29995 to 0.3 rounds to 30.0 at three places, on a row flagged below 30%."""
        row = perf_flags.typed_row(_row(1, pm_ideal_ns=ideal, device_time="1"))

        (low,) = perf_flags.heuristic_flags(row, 64)

        assert 29.99 <= low["core_utilisation_percent"] < 30

    def test_a_recompute_candidate_carries_no_figure(self):
        """Its program's hash is the `cache` group's `program_hash`."""
        row = perf_flags.typed_row(
            _row(1, hash="h", cache_hit=False), is_first_hash_occurrence=False
        )

        assert perf_flags.heuristic_flags(row, 64) == [{"flag": "recompute_candidate"}]

    def test_a_row_without_a_program_hash_is_never_a_recompute(self):
        """Parsed rows never pair the two, so a typed row holds the view's guard."""
        row = FlagRow(
            total_percent=5.0, is_first_hash_occurrence=False, cache_hit=False
        )

        assert perf_flags.heuristic_flags(row, 64) == []

    def test_a_dram_bound_without_figures_reports_them_as_null(self):
        row = perf_flags.typed_row(_row(1, bound="DRAM", dram_percent="nan"))

        (dram,) = perf_flags.heuristic_flags(row, 64)

        assert dram["reason"] == "bound_dram"
        assert dram["dram_percent"] is None
        assert dram["flops_percent"] is None


class TestFlagFields:
    _INPUTS = perf_flags.flag_inputs(
        [_row(2, hash="h", cache_hit=False), _row(3, hash="h", cache_hit=False)], None
    )

    def test_nothing_is_added_unless_flags_were_asked_for(self):
        assert perf_flags.flag_fields(_row(1, **_LOW), None) == {}
        assert perf_flags.flagged_rows([_row(1, **_LOW)], None) is None
        assert perf_flags.summary(None) == {}

    def test_the_note_names_both_ways_the_flags_differ_from_the_view(self):
        """An agent reads the note, not the docs page."""
        assert "#2162" in perf_flags.FLAGS_NOTE
        assert "signpost range" in perf_flags.FLAGS_NOTE
        assert "report_rows" in perf_flags.FLAGS_NOTE

    def test_a_row_flags_nothing_with_an_empty_list_and_its_gate(self):
        assert perf_flags.flag_fields(_row(1), self._INPUTS) == {
            "total_percent": 5.0,
            "flags": [],
        }

    @pytest.mark.parametrize(
        ("cell", "expected"), [("0.49999", 0.5), ("0.5abc", 0.5), ("", None)]
    )
    def test_the_gates_input_is_the_view_s_parse_of_the_cell(self, cell, expected):
        """Rounded, and null where the view reads a NaN, so it never gates."""
        fields = perf_flags.flag_fields(
            _row(1, total_percent=cell, bound="DRAM"), self._INPUTS
        )

        assert fields["total_percent"] == expected
        assert bool(fields["flags"]) is (cell == "0.5abc")

    @pytest.mark.parametrize("placeholder", ["1", "1.0", " 1"])
    def test_the_perf_models_placeholder_never_reads_as_low_utilisation(
        self, placeholder
    ):
        """The view flags it (#2162); the port does too, which the golden pins."""
        row = _row(1, pm_ideal_ns=placeholder, device_time="100.0")
        typed = perf_flags.typed_row(row)

        assert _flag_names(perf_flags.flag_fields(row, self._INPUTS)) == []
        assert [entry["flag"] for entry in perf_flags.heuristic_flags(typed, 64)] == [
            "low_utilisation"
        ]

    def test_a_modelled_time_however_short_still_flags(self):
        row = _row(1, pm_ideal_ns="2", device_time="100.0")

        assert _flag_names(perf_flags.flag_fields(row, self._INPUTS)) == [
            "low_utilisation"
        ]

    def test_the_placeholder_leaves_the_other_flags_alone(self):
        row = _row(1, pm_ideal_ns="1", bound="DRAM", cores="8", available_cores="")

        assert _flag_names(perf_flags.flag_fields(row, self._INPUTS)) == [
            "dram_bound",
            "underutilised_cores",
        ]

    def test_a_repeat_call_is_named_by_its_row_id(self):
        first = _row(2, hash="h", cache_hit=False)
        repeat = _row(3, hash="h", cache_hit=False)

        assert _flag_names(perf_flags.flag_fields(first, self._INPUTS)) == []
        assert perf_flags.flag_fields(repeat, self._INPUTS)["flags"] == [
            {"flag": "recompute_candidate"}
        ]

    def test_the_inputs_hold_first_calls_and_tally_the_recorded_repeats(self):
        rows = [
            _row(2, hash="a", cache_hit=False),
            _row(3, hash="a", cache_hit=True),
            _row(4, hash="a", cache_hit=False),
            _row(5, hash="a", cache_hit=None),
            _row(6, hash="b", cache_hit=False),
            _row(7, hash=None, cache_hit=False),
        ]

        inputs = perf_flags.flag_inputs(rows, None)

        assert inputs.first_call_ids == {"2", "6"}
        assert (inputs.repeat_hits, inputs.repeat_misses) == (1, 1)
        assert [inputs.is_first_call(row) for row in rows] == [
            True,
            False,
            False,
            False,
            True,
            True,
        ]


class TestProgramCalls:
    def test_a_hash_is_first_called_on_its_first_row_in_report_order(self):
        rows = [
            _row(9, hash="a"),
            _row(3, hash="a"),
            _row(4, hash=None),
            _row(5, hash=""),
            _row(6, hash="b"),
        ]

        assert [
            (row["id"], first) for row, first in perf_flags.program_calls(rows)
        ] == [
            ("9", True),
            ("3", False),
            ("6", True),
        ]

    @pytest.mark.parametrize(
        ("program", "first", "cache_hit", "outcome"),
        [
            ("a", False, False, "miss"),
            ("a", False, True, "hit"),
            ("a", False, None, "unrecorded"),
            ("a", True, False, None),
            (None, False, False, None),
            ("", False, False, None),
        ],
    )
    def test_a_repeat_reads_as_the_view_reads_it(
        self, program, first, cache_hit, outcome
    ):
        """`getRepeatCacheOutcome`: no program, or a first call, is no repeat at all."""
        read = perf_flags.repeat_cache_outcome(program, first, cache_hit)

        assert (read and read.value) == outcome


class TestTopOpsFlags:
    def test_without_include_the_answer_is_unchanged_and_reads_nothing_more(
        self, handle_with
    ):
        registry, handle = handle_with([_row(1, **_LOW)])

        with patch.object(
            perf_flags, "resolve_max_cores", wraps=perf_flags.resolve_max_cores
        ) as resolve:
            result = tools.top_ops(registry, handle)

        assert "flags" not in result["ops"][0]
        assert "flag_basis" not in result
        resolve.assert_not_called()

    def test_another_group_alone_adds_no_flags(self, handle_with):
        registry, handle = handle_with([_row(1, **_LOW)])

        result = tools.top_ops(registry, handle, include=["cores"])

        assert "flags" not in result["ops"][0]
        assert "flag_basis" not in result

    def test_every_row_carries_a_list_and_the_answer_its_basis(self, handle_with):
        registry, handle = handle_with([_row(1, **_LOW), _row(2, device_time="1.0")])

        result = tools.top_ops(registry, handle, include=_FLAGS)

        assert [_flag_names(op) for op in result["ops"]] == [["low_utilisation"], []]
        assert [op["total_percent"] for op in result["ops"]] == [5.0, 5.0]
        assert json.dumps(result["flag_basis"]) == json.dumps(
            {
                "max_cores": 64,
                "max_cores_source": "device_log",
                "architecture": "wormhole_b0",
                "flagged_rows": {
                    "dram_bound": 0,
                    "low_utilisation": 1,
                    "underutilised_cores": 0,
                    "recompute_candidate": 0,
                },
                "note": perf_flags.FLAGS_NOTE,
            }
        )

    def test_flags_alone_say_nothing_about_detail_fields(self, handle_with):
        """They carry none, so `included`, `empty_in_report` and `detail_note` would be
        about nothing in the answer."""
        registry, handle = handle_with([_row(1, **_LOW)])

        alone = tools.top_ops(registry, handle, include=_FLAGS)
        with_config = tools.top_ops(registry, handle, include=["flags", "config"])

        assert not {"included", "empty_in_report", "detail_note"} & set(alone)
        assert with_config["included"] == ["config", "flags"]
        assert "detail_note" in with_config

    def test_flagged_rows_count_every_row_read_not_only_those_returned(
        self, handle_with
    ):
        rows = [_row(index, cores="8", device_time=str(index)) for index in range(40)]
        registry, handle = handle_with(rows)

        result = tools.top_ops(registry, handle, limit=3, include=_FLAGS)

        assert result["returned"] == 3
        assert result["flag_basis"]["flagged_rows"]["underutilised_cores"] == 40
        assert all(
            type(count) is int
            for count in result["flag_basis"]["flagged_rows"].values()
        )

    def test_flagged_rows_are_counted_once_per_handle_and_range(self, handle_with):
        registry, handle = handle_with([_row(1, **_LOW)])

        with patch.object(
            perf_flags, "count_flags", wraps=perf_flags.count_flags
        ) as counted:
            tools.top_ops(registry, handle, include=_FLAGS)
            tools.top_ops(registry, handle, by="cores", include=_FLAGS)

        counted.assert_called_once()

    def test_a_range_a_report_without_signposts_ignores_counts_as_the_whole(
        self, handle_with
    ):
        """tt-perf-report reads the whole file for it, so its counts are the whole's."""
        registry, handle = handle_with([_row(1, **_LOW)])

        with (
            patch.object(
                tools, "_resolve_signposts", return_value=ResolvedSignposts({}, True)
            ),
            patch.object(
                perf_flags, "count_flags", wraps=perf_flags.count_flags
            ) as counted,
        ):
            whole = tools.top_ops(registry, handle, include=_FLAGS)
            ranged = tools.top_ops(
                registry, handle, start_signpost="START", include=_FLAGS
            )

        assert ranged["projection"]["signpost_range_ignored"] is True
        assert (
            ranged["flag_basis"]["flagged_rows"] == whole["flag_basis"]["flagged_rows"]
        )
        counted.assert_called_once()

    def test_program_cache_and_the_flags_count_a_repeat_miss_alike_but_for_the_gate(
        self, handle_with
    ):
        """One rule classifies a repeat; the flags still leave out a host op's, as the
        view does."""
        misses = [_row(index, hash="h", cache_hit=False) for index in (2, 3, 4)]
        alike = handle_with(misses)
        gated = handle_with([*misses, _row(5, hash="h", cache_hit=False, bound="HOST")])

        for (registry, handle), cached, flagged in ((alike, 2, 2), (gated, 3, 2)):
            counts = tools.top_ops(registry, handle, include=_FLAGS)["flag_basis"]
            assert tools.program_cache(registry, handle)["repeat_misses"] == cached
            assert counts["flagged_rows"]["recompute_candidate"] == flagged

    @pytest.mark.parametrize(
        ("cache_hits", "caveat"),
        [([None, False, False], True), ([None, False, True], False), ([None], False)],
        ids=["every-repeat-missed", "one-repeat-hit", "no-repeats"],
    )
    def test_a_run_whose_every_repeat_missed_says_the_cache_may_have_been_off(
        self, handle_with, cache_hits, caveat
    ):
        """The same caveat `program_cache` gives, from one constant."""
        rows = [
            _row(index, hash="h", cache_hit=hit) for index, hit in enumerate(cache_hits)
        ]
        registry, handle = handle_with(rows)

        basis = tools.top_ops(registry, handle, include=_FLAGS)["flag_basis"]
        cache = tools.program_cache(registry, handle)

        assert basis.get("caveat") == (
            perf_flags.CACHE_DISABLED_CAVEAT if caveat else None
        )
        assert (perf_flags.CACHE_DISABLED_CAVEAT in cache.get("caveat", "")) is caveat

    def test_the_device_logs_core_count_is_what_a_row_without_its_own_is_held_to(
        self, handle_with
    ):
        rows = [_row(1, cores="7", available_cores=""), _row(2, cores="8")]
        registry, handle = handle_with(
            rows, "ARCH: blackhole, CHIP_FREQ[MHz]: 1350, Max Compute Cores: 30"
        )

        result = tools.top_ops(registry, handle, include=_FLAGS)

        assert result["flag_basis"]["max_cores"] == 30
        assert result["flag_basis"]["max_cores_source"] == "device_log"
        by_id = {op["id"]: op["flags"] for op in result["ops"]}
        # 7 of the device's 30 is under a quarter; 8 of the row's own 64 is too.
        assert by_id["1"] == [
            {
                "flag": "underutilised_cores",
                "core_capacity": 30,
                "core_capacity_from": "max_cores",
            }
        ]
        assert by_id["2"][0]["core_capacity_from"] == "available_cores"

    @pytest.mark.parametrize(
        ("first_line", "expected"),
        [
            ("ARCH: blackhole, CHIP_FREQ[MHz]: 1350", (130, "architecture_default")),
            ("ARCH: wormhole_b0, CHIP_FREQ[MHz]: 1000", (64, "architecture_default")),
            (None, (64, "architecture_default")),
            ("ARCH: wormhole_b0, Max Compute Cores: 0", (64, "fallback_default")),
        ],
    )
    def test_without_a_count_the_view_falls_back_and_so_does_this(
        self, handle_with, first_line, expected
    ):
        registry, handle = handle_with(
            [_row(1, cores="20", available_cores="")], first_line
        )

        basis = tools.top_ops(registry, handle, include=_FLAGS)["flag_basis"]

        assert (basis["max_cores"], basis["max_cores_source"]) == expected

    def test_no_device_log_names_no_architecture(self, handle_with):
        registry, handle = handle_with([_row(1)], None)

        assert (
            tools.top_ops(registry, handle, include=_FLAGS)["flag_basis"][
                "architecture"
            ]
            is None
        )

    def test_a_row_using_more_cores_than_the_default_raises_the_count(
        self, handle_with
    ):
        """Read over the whole report, so a row the limit leaves out still counts."""
        rows = [
            _row(1, cores="8", available_cores="", device_time="50.0"),
            _row(2, cores="120", available_cores="", device_time="1.0"),
        ]
        registry, handle = handle_with(rows, "ARCH: wormhole_b0")

        result = tools.top_ops(registry, handle, limit=1, include=_FLAGS)

        assert type(result["flag_basis"]["max_cores"]) is int
        assert result["flag_basis"]["max_cores"] == 120
        assert result["flag_basis"]["max_cores_source"] == "report_rows"
        assert type(result["ops"][0]["flags"][0]["core_capacity"]) is int
        assert result["ops"][0]["flags"][0]["core_capacity"] == 120

    def test_a_first_call_outside_the_ranked_rows_still_makes_a_repeat(
        self, handle_with
    ):
        rows = [
            _row(2, hash="h", cache_hit=False, device_time="1.0"),
            _row(3, hash="h", cache_hit=False, device_time="9.0"),
        ]
        registry, handle = handle_with(rows)

        (op,) = tools.top_ops(registry, handle, limit=1, include=_FLAGS)["ops"]

        assert op["id"] == "3"
        assert _flag_names(op) == ["recompute_candidate"]

    @pytest.fixture
    def ranged(self, tmp_path):
        """A handle whose report holds a `START` signpost, and whose window after it
        recomputes the last row's total_percent from 0.1 to 60."""
        rows = [
            _row(2, hash="h", cache_hit=False, total_percent="40.0"),
            _row(3, op_code="START", op_type="signpost", total_percent=""),
            _row(4, hash="h", cache_hit=False, total_percent="0.1", **_LOW),
        ]
        window = [{**rows[2], "total_percent": "60.0"}]

        def generate(instance, **overrides):
            return _perf_report(window if overrides.get("start_signpost") else rows)

        _write_device_log(tmp_path, _WORMHOLE_64)
        registry = ReportRegistry()
        handle = load_report(registry, performance_path=str(tmp_path))["handle"]
        with (
            patch.object(tools, "_generate_canonical_report", side_effect=generate),
            patch.object(
                tools,
                "_resolve_signposts",
                return_value=ResolvedSignposts({"START": [1]}, True),
            ),
        ):
            yield registry, handle

    def test_a_ranged_call_reads_the_window_and_the_whole_report(self, ranged):
        """The window's total_percent gates the flags; the whole report's first calls
        decide a repeat, as `program_cache` counts them."""
        registry, handle = ranged

        whole = tools.top_ops(registry, handle, include=_FLAGS)
        ranged_answer = tools.top_ops(
            registry, handle, start_signpost="START", include=_FLAGS
        )

        whole_flags = {op["id"]: _flag_names(op) for op in whole["ops"]}
        assert whole_flags["4"] == ["recompute_candidate"]
        assert [_flag_names(op) for op in ranged_answer["ops"]] == [
            ["low_utilisation", "recompute_candidate"]
        ]
        assert ranged_answer["ops"][0]["total_percent"] == 60.0
        assert ranged_answer["flag_basis"]["flagged_rows"]["low_utilisation"] == 1
        assert whole["flag_basis"]["flagged_rows"]["low_utilisation"] == 0

    def test_flagged_rows_are_counted_once_for_each_range(self, ranged):
        registry, handle = ranged

        with patch.object(
            perf_flags, "count_flags", wraps=perf_flags.count_flags
        ) as counted:
            tools.top_ops(registry, handle, include=_FLAGS)
            for _ in range(2):
                tools.top_ops(registry, handle, start_signpost="START", include=_FLAGS)

        assert counted.call_count == 2

    def test_the_inputs_are_read_once_per_handle(self, handle_with):
        registry, handle = handle_with([_row(1)])

        with patch.object(
            perf_flags, "resolve_max_cores", wraps=perf_flags.resolve_max_cores
        ) as resolve:
            tools.top_ops(registry, handle, include=_FLAGS)
            tools.top_ops(registry, handle, by="cores", include=["cores", "flags"])

        resolve.assert_called_once()

    def test_an_unreadable_device_log_is_read_as_none(self, handle_with):
        """As the view's request for it fails, and the app then falls back."""
        registry, handle = handle_with([_row(1)])

        with patch.object(
            DeviceLogProfilerQueries,
            "read_device_meta",
            side_effect=OSError("gone"),
        ):
            basis = tools.top_ops(registry, handle, include=_FLAGS)["flag_basis"]

        assert basis["max_cores_source"] == "architecture_default"
        assert basis["architecture"] is None

    @pytest.mark.parametrize("cell", ["", "nan", "inf", "-inf", "not a number"])
    def test_an_empty_or_non_finite_cell_never_reaches_the_answer_as_nan(
        self, handle_with, cell
    ):
        rows = [
            _row(
                1,
                total_percent=cell,
                cores=cell,
                available_cores=cell,
                pm_ideal_ns=cell,
            ),
            _row(2, bound="DRAM", dram_percent=cell, flops_percent=cell),
            _row(3, bound="SLOW", dram_percent="80", flops_percent=cell),
        ]
        registry, handle = handle_with(rows)

        result = tools.top_ops(registry, handle, include=_FLAGS)

        assert result["returned"] == 3
        json.dumps(result, allow_nan=False)

    def test_flags_overwrite_no_field_the_row_already_has(self, handle_with):
        registry, handle = handle_with([_row(1)])

        everything = [group.value for group in perf_detail.DetailGroup]
        (op,) = tools.top_ops(registry, handle, include=everything)["ops"]

        assert list(op).count("flags") == 1
        assert "flags" not in {
            field.name for fields in perf_detail._FIELDS.values() for field in fields
        }


class TestEndToEnd:
    """The mocked rows above skip the generator; these run a real capture through it."""

    def test_a_smoke_capture_is_flagged_as_the_port_reads_its_rows(self, tmp_path):
        """Two of its rows carry the 1 ns placeholder: the view flags both, the tool
        neither."""
        write_ops_perf(tmp_path, smoke_rows())
        _write_device_log(tmp_path, "ARCH: wormhole_b0, CHIP_FREQ[MHz]: 1000")
        registry = ReportRegistry()
        handle = load_report(registry, performance_path=str(tmp_path))["handle"]

        result = tools.top_ops(registry, handle, limit=25, include=_FLAGS)

        rows = tools.canonical_report(registry, handle)["report"]
        placeholders = [
            row for row in rows if perf_detail.is_unmodelled(row["pm_ideal_ns"])
        ]
        assert len(placeholders) == 2
        for row in placeholders:
            assert "low_utilisation" in [
                entry["flag"]
                for entry in perf_flags.heuristic_flags(perf_flags.typed_row(row), 64)
            ]
        by_id = {op["id"]: _flag_names(op) for op in result["ops"]}
        assert all("low_utilisation" not in by_id[row["id"]] for row in placeholders)
        assert result["flag_basis"]["max_cores_source"] == "architecture_default"
        assert any(by_id.values())

    def test_a_signposted_capture_is_flagged_over_its_window(self, tmp_path):
        """The window recomputes total_percent, so an op under the impact gate in the
        whole report can pass it inside the window; and a program first called before
        the window still makes its first call inside the window a repeat."""
        rows = signposted_rows()
        for row in rows:
            row[PROGRAM_HASH_COLUMN] = row["OP CODE"]
            row[PROGRAM_CACHE_HIT_COLUMN] = "False"
        write_ops_perf(tmp_path, rows)
        _write_device_log(tmp_path, _WORMHOLE_64)
        registry = ReportRegistry()
        handle = load_report(registry, performance_path=str(tmp_path))["handle"]
        ranged = tools.SignpostRange("PERF_START", "PERF_END")

        whole = tools.top_ops(registry, handle, limit=25, include=_FLAGS)
        windowed = tools.top_ops(
            registry,
            handle,
            limit=25,
            start_signpost="PERF_START",
            end_signpost="PERF_END",
            include=_FLAGS,
        )

        whole_flags = {op["id"]: _flag_names(op) for op in whole["ops"]}
        window_rows = tools.canonical_report(registry, handle, ranged)["report"]
        crossed = [
            op
            for op in windowed["ops"]
            if "low_utilisation" in _flag_names(op)
            and "low_utilisation" not in whole_flags[op["id"]]
        ]
        assert crossed
        hash_by_id = {row["id"]: row["hash"] for row in window_rows}
        first_in_window = {}
        for row in window_rows:
            first_in_window.setdefault(row["hash"], row["id"])
        called_before = [
            op
            for op in windowed["ops"]
            if first_in_window[hash_by_id[op["id"]]] == op["id"]
            and "recompute_candidate" in _flag_names(op)
        ]
        assert called_before


def _linked_handle(tmp_path, graphs_of):
    """A handle on the smoke capture, every repeat a cache miss, and a profiler report
    whose operations `graphs_of(launched)` gives, from the device ops the rows name."""
    rows = smoke_rows()
    for row in rows:
        row[PROGRAM_HASH_COLUMN] = row["OP CODE"]
        row[PROGRAM_CACHE_HIT_COLUMN] = "False"
    write_ops_perf(tmp_path / "perf", rows)
    _write_device_log(tmp_path / "perf", _WORMHOLE_64)
    performance_only = ReportRegistry()
    handle = load_report(performance_only, performance_path=str(tmp_path / "perf"))
    launched = [
        row["raw_op_code"]
        for row in tools.canonical_report(performance_only, handle["handle"])["report"]
    ]
    graphs, operations = graphs_of(launched)
    profiler_path = _write_profiler(
        tmp_path / "profiler", graphs, operations=operations
    )
    registry = ReportRegistry()
    loaded = load_report(
        registry, performance_path=str(tmp_path / "perf"), profiler_path=profiler_path
    )
    return registry, loaded["handle"]


def _flag_counts(rows):
    counts = {flag.value: 0 for flag in perf_flags.PerfHeuristicFlag}
    for row in rows:
        for name in _flag_names(row):
            counts[name] += 1
    return counts


class TestOperationDetail:
    @pytest.fixture
    def linked(self, tmp_path):
        """Two operations, each launching half the smoke capture's rows."""

        def graphs_of(launched):
            half = len(launched) // 2
            return (
                {
                    1: _graph("ttnn.first", *launched[:half], nested=False),
                    2: _graph("ttnn.second", *launched[half:], nested=False),
                },
                [(1, "ttnn.first"), (2, "ttnn.second")],
            )

        return _linked_handle(tmp_path, graphs_of)

    def test_each_perf_row_carries_the_flags_top_ops_gives_it(self, linked):
        registry, handle = linked

        ranked = linking.top_ops(registry, handle, limit=25, include=_FLAGS)
        top_flags = {op["id"]: op["flags"] for op in ranked["ops"]}
        for operation_id in (1, 2):
            detail = linking.operation_detail(
                registry, handle, operation_id, include=_FLAGS
            )

            assert detail["operation_link"]["status"] == "linked"
            ids = {row["id"] for row in detail["perf_rows"]}
            assert ids and ids <= set(top_flags)
            assert all(
                row["flags"] == top_flags[row["id"]] for row in detail["perf_rows"]
            )

    def test_the_basis_is_the_report_s_and_the_counts_the_operation_s(self, linked):
        """The device, its log and the cache read the same for both tools; the counts
        cover the rows each answer read."""
        registry, handle = linked

        ranked = linking.top_ops(registry, handle, limit=25, include=_FLAGS)
        details = [
            linking.operation_detail(registry, handle, operation_id, include=_FLAGS)
            for operation_id in (1, 2)
        ]

        shared = ("max_cores", "max_cores_source", "architecture", "caveat")
        for detail in details:
            assert all(
                detail["flag_basis"].get(key) == ranked["flag_basis"].get(key)
                for key in shared
            )
            assert detail["perf_row_count"] == len(detail["perf_rows"])
            assert detail["flag_basis"]["flagged_rows"] == _flag_counts(
                detail["perf_rows"]
            )
        assert details[0]["flag_basis"]["flagged_rows"] != (
            ranked["flag_basis"]["flagged_rows"]
        )
        assert ranked["flag_basis"]["flagged_rows"] == _flag_counts(ranked["ops"])

    def test_an_unlinked_operation_reads_no_flags(self, tmp_path):
        """No perf_rows to flag, so the flags' inputs are never read."""
        registry, handle = _linked_handle(
            tmp_path,
            lambda launched: (
                {1: _graph("ttnn.other", "NotARowDeviceOperation", nested=False)},
                [(1, "ttnn.other")],
            ),
        )

        with patch.object(
            perf_flags, "resolve_max_cores", wraps=perf_flags.resolve_max_cores
        ) as resolve:
            detail = linking.operation_detail(registry, handle, 1, include=_FLAGS)

        assert detail["operation_link"]["status"] != "linked"
        assert "flag_basis" not in detail
        assert all("flags" not in row for row in detail.get("perf_rows", []))
        resolve.assert_not_called()

    def test_without_include_a_perf_row_has_no_flags(self, linked):
        registry, handle = linked

        detail = linking.operation_detail(registry, handle, 1)

        assert detail["perf_rows"]
        assert all("flags" not in row for row in detail["perf_rows"])
        assert "flag_basis" not in detail
