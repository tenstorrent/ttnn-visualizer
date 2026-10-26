# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Why a performance row took its time, and whether programs were built again. #2153

The field groups are a wire contract an agent reads by name, so their names are pinned.
The failure that matters most is a null an agent cannot place: a field the capture never
recorded must not read as one the operation lacks, which is what `empty_in_report` is for.
"""

import json
from unittest.mock import patch

import pytest
from ttnn_visualizer.agent import perf_detail, server, tools
from ttnn_visualizer.agent.bounds import MAX_DETAILED_LIMIT, MAX_LIMIT, bounded
from ttnn_visualizer.agent.handles import ReportRegistry, load_report
from ttnn_visualizer.agent.perf_detail import DetailGroup
from ttnn_visualizer.csv_queries import (
    PROGRAM_CACHE_HIT_COLUMN,
    PROGRAM_HASH_COLUMN,
    REPORT_ROW_ID_OFFSET,
    OpsPerformanceReportQueries,
    ResolvedSignposts,
)
from ttnn_visualizer.tests.smoke_capture import smoke_rows, write_ops_perf
from ttnn_visualizer.tests.test_agent_linking import _graph, _write_profiler
from ttnn_visualizer.tests.test_agent_tools import _perf_report
from ttnn_visualizer.tests.test_device_log_columns import (
    MODERN_HEADER,
    write_device_log,
)

FIELD_NAMES = {
    DetailGroup.CONFIG: [
        "math_fidelity",
        "input_0_datatype",
        "input_1_datatype",
        "output_datatype",
        "input_0_memory",
        "dram_sharded",
        "inner_dim_block_size",
        "output_subblock_h",
        "output_subblock_w",
    ],
    DetailGroup.UTILISATION: [
        "dram_gb_per_s",
        "dram_percent",
        "tflops",
        "flops_percent",
        "ideal_us",
        "ideal_compute_us",
        "ideal_bandwidth_us",
        "fpu_util_percent",
    ],
    DetailGroup.NOC: [
        "noc_util_percent",
        "multicast_noc_util_percent",
        "dram_bw_util_percent",
        "dram_bw_util_per_controller",
        "eth_bw_util_per_core",
        "npe_congestion_impact_percent",
    ],
    DetailGroup.RISCS: [
        "kernel_us",
        "brisc_us",
        "ncrisc_us",
        "trisc0_us",
        "trisc1_us",
        "trisc2_us",
        "erisc_us",
        "compute_cb_wait_front_us",
        "compute_cb_reserve_back_us",
    ],
    DetailGroup.CORES: [
        "available_cores",
        "first_to_last_start_us",
        "per_core_min_us",
        "per_core_max_us",
        "per_core_avg_us",
    ],
    DetailGroup.DISPATCH: [
        "op_to_op_gap_us",
        "dispatch_cq_cmd_op_us",
        "dispatch_go_send_wait_us",
        "metal_trace_id",
        "metal_trace_replay_session_id",
    ],
    DetailGroup.CACHE: ["program_hash", "program_cache_hit", "global_call_count"],
    DetailGroup.KERNELS: [
        "compute_kernels",
        "compute_kernel_hashes",
        "data_movement_kernels",
        "data_movement_kernel_hashes",
    ],
    DetailGroup.ADVICE: ["advice"],
    # Its one field, `flags`, is `perf_flags`', read against the whole report.
    DetailGroup.FLAGS: [],
}

# What `empty_in_report` says fills a field whose column is there; the rest are empty.
FILLED_BY = {
    "--collect-noc-traces": FIELD_NAMES[DetailGroup.NOC],
    "--profile-dispatch-cores": ["dispatch_cq_cmd_op_us", "dispatch_go_send_wait_us"],
    "captured metal trace": ["metal_trace_id", "metal_trace_replay_session_id"],
    "performance model": [
        "ideal_us",
        "ideal_compute_us",
        "ideal_bandwidth_us",
        "fpu_util_percent",
    ],
}


def _row(row_id, **fields):
    return {
        "id": str(row_id),
        "op_code": "Matmul",
        "device_time": "10.0",
        "op_type": "tt_dnn_device",
        **fields,
    }


@pytest.fixture
def handle_with(tmp_path):
    """A performance-only handle whose generated report holds `rows`."""
    patches = []

    def _handle_with(rows):
        registry = ReportRegistry()
        write_device_log(tmp_path, MODERN_HEADER, [])
        handle = load_report(registry, performance_path=str(tmp_path))["handle"]
        patcher = patch.object(
            tools, "_generate_canonical_report", return_value=_perf_report(rows)
        )
        patches.append(patcher)
        return registry, handle, patcher.start()

    yield _handle_with
    for patcher in patches:
        patcher.stop()


class TestParseInclude:
    def test_nothing_asked_adds_nothing(self):
        assert perf_detail.parse_include(None) == ()
        assert perf_detail.parse_include([]) == ()

    def test_groups_come_back_once_each_in_a_stable_order(self):
        assert perf_detail.parse_include(["advice", "config", "advice"]) == (
            DetailGroup.CONFIG,
            DetailGroup.ADVICE,
        )

    def test_a_long_unknown_name_is_cut_short_in_the_refusal(self):
        with pytest.raises(ValueError) as refused:
            perf_detail.parse_include(["x" * 100_000])

        assert len(str(refused.value)) < 200

    def test_an_unknown_group_is_refused_with_the_ones_that_exist(self):
        with pytest.raises(ValueError) as refused:
            perf_detail.parse_include(["config", "timings"])

        assert "'timings'" in str(refused.value)
        assert all(group.value in str(refused.value) for group in DetailGroup)

    @pytest.mark.parametrize("include", ["config", {"config": True}, [1]])
    def test_anything_but_a_list_of_names_is_refused(self, include):
        with pytest.raises(ValueError, match="include"):
            perf_detail.parse_include(include)


class TestDetailFields:
    @pytest.mark.parametrize("group", list(DetailGroup))
    def test_each_group_returns_exactly_its_documented_fields(self, group):
        assert list(perf_detail.detail_fields({}, [group])) == FIELD_NAMES[group]

    def test_a_row_without_the_columns_reports_every_field_as_null(self):
        fields = perf_detail.detail_fields({}, list(DetailGroup))

        assert set(fields.values()) == {None}

    def test_nanosecond_columns_are_reported_in_microseconds(self):
        row = {
            "device_kernel_duration": "6612",
            "trisc0_kernel_duration": "6313",
            "pm_ideal_ns": "1568",
            "device_kernel_first_to_last_start": "370",
        }

        fields = perf_detail.detail_fields(
            row, [DetailGroup.RISCS, DetailGroup.UTILISATION, DetailGroup.CORES]
        )

        assert fields["kernel_us"] == 6.612
        assert fields["trisc0_us"] == 6.313
        assert fields["ideal_us"] == 1.568
        assert fields["first_to_last_start_us"] == 0.37

    @pytest.mark.parametrize("cell", ["", "nan", "NaN", "inf", "-inf", "not a number"])
    def test_an_empty_or_non_finite_cell_is_null_rather_than_nan(self, cell):
        """A NaN would reach the client as invalid JSON."""
        fields = perf_detail.detail_fields(
            {"dram_percent": cell, "pm_ideal_ns": cell, "input_1_datatype": cell},
            [DetailGroup.UTILISATION, DetailGroup.CONFIG],
        )

        assert fields["dram_percent"] is None
        assert fields["ideal_us"] is None
        if cell in ("", "nan", "NaN"):
            assert fields["input_1_datatype"] is None

    def test_flags_and_counts_are_typed(self):
        row = {
            "dram_sharded": "True",
            "cache_hit": False,
            "inner_dim_block_size": "2",
            "global_call_count": "14337",
        }

        fields = perf_detail.detail_fields(row, [DetailGroup.CONFIG, DetailGroup.CACHE])

        assert fields["dram_sharded"] is True
        assert fields["program_cache_hit"] is False
        assert fields["inner_dim_block_size"] == 2
        assert fields["global_call_count"] == 14337

    def test_kernel_lists_are_split_as_tt_metal_writes_them(self):
        row = {
            "compute_kernel_source": "[]",
            "data_movement_kernel_source": (
                "['kernels/dataflow/reader.cpp'; 'kernels/dataflow/writer.cpp']"
            ),
            "data_movement_kernel_hash": "['reader/1/'; 'writer/2/']",
        }

        fields = perf_detail.detail_fields(row, [DetailGroup.KERNELS])

        # `[]` is a captured "no compute kernel"; a missing cell is no capture at all.
        assert fields["compute_kernels"] == []
        assert fields["compute_kernel_hashes"] is None
        assert fields["data_movement_kernels"] == [
            "kernels/dataflow/reader.cpp",
            "kernels/dataflow/writer.cpp",
        ]
        assert fields["data_movement_kernel_hashes"] == ["reader/1/", "writer/2/"]

    def test_advice_is_the_list_tt_perf_report_wrote(self):
        fields = perf_detail.detail_fields(
            {"advice": ["Increase grid size", " "]}, [DetailGroup.ADVICE]
        )

        assert fields["advice"] == ["Increase grid size"]


class TestPerfModelPlaceholder:
    """tt-metal's performance model leaves its ideal times at 1 ns when it sets none."""

    def test_a_placeholder_ideal_time_is_null_rather_than_a_nanosecond(self):
        row = {"pm_ideal_ns": "1", "pm_compute_ns": "1", "pm_bandwidth_ns": "1"}

        fields = perf_detail.detail_fields(row, [DetailGroup.UTILISATION])

        assert fields["ideal_us"] is None
        assert fields["ideal_compute_us"] is None
        assert fields["ideal_bandwidth_us"] is None

    def test_fpu_utilisation_from_a_placeholder_compute_time_is_null(self):
        fields = perf_detail.detail_fields(
            {"pm_compute_ns": "1", "pm_fpu_util": "0.012"}, [DetailGroup.UTILISATION]
        )

        assert fields["fpu_util_percent"] is None

    def test_a_modelled_time_is_kept_however_short(self):
        fields = perf_detail.detail_fields(
            {"pm_ideal_ns": "2", "pm_compute_ns": "1568", "pm_fpu_util": "6.54"},
            [DetailGroup.UTILISATION],
        )

        assert fields["ideal_us"] == 0.002
        assert fields["ideal_compute_us"] == 1.568
        assert fields["fpu_util_percent"] == 6.54

    def test_a_report_of_placeholders_names_them_as_unmodelled(self):
        named = perf_detail.empty_in_report(
            perf_detail.empty_fields([{"pm_ideal_ns": "1"}, {"pm_ideal_ns": "1"}]),
            [DetailGroup.UTILISATION],
        )

        assert "performance model" in named["ideal_us"]


class TestMathFidelity:
    @pytest.mark.parametrize(
        ("cell", "fidelity"),
        [("LoFi", "LoFi"), ("HiFi2", "HiFi2"), ("HiFi3", "HiFi3"), ("HiFi4", "HiFi4")],
    )
    def test_the_raw_column_gives_the_fidelity(self, cell, fidelity):
        fields = perf_detail.detail_fields(
            {"raw_math_fidelity": cell}, [DetailGroup.CONFIG]
        )

        assert fields["math_fidelity"] == fidelity

    @pytest.mark.parametrize("cell", ["", "nan", "LoFi BFP8 x BFP8 => BFP8", "MaxFi"])
    def test_anything_but_a_fidelity_is_null(self, cell):
        fields = perf_detail.detail_fields(
            {"raw_math_fidelity": cell}, [DetailGroup.CONFIG]
        )

        assert fields["math_fidelity"] is None

    def test_tt_perf_reports_composite_cell_is_not_read(self):
        """It names a fidelity for matmuls only, and an eltwise's would read as none."""
        fields = perf_detail.detail_fields(
            {"math_fidelity": "LoFi BFP8 x BFP8 => BFP8"}, [DetailGroup.CONFIG]
        )

        assert fields["math_fidelity"] is None


class TestFieldContract:
    def test_every_field_reads_a_column_the_generator_writes(self):
        """A misspelt column would read as empty on every row, and be named as such."""
        queries = OpsPerformanceReportQueries
        written = {
            *queries.REPORT_COLUMN_HEADERS,
            *queries.PASSTHROUGH_COLUMNS,
            *queries.DETAIL_COLUMNS,
            # `set_hash_from_results` names these itself.
            "hash",
            "cache_hit",
        }

        read = {
            column
            for fields in perf_detail._FIELDS.values()
            for field in fields
            for column in (field.column, field.model_column)
            if column
        }

        assert read <= written, sorted(read - written)

    def test_every_nanosecond_column_is_read_in_microseconds(self):
        """A `_us` field read through anything else would be off by a thousand."""
        queries = OpsPerformanceReportQueries
        headers = {**queries.PASSTHROUGH_COLUMNS, **queries.DETAIL_COLUMNS}

        for fields in perf_detail._FIELDS.values():
            for field in fields:
                in_nanoseconds = headers.get(field.column, "").endswith("[ns]")
                assert in_nanoseconds == (
                    field.read is perf_detail._microseconds
                ), field.name
                # tt-perf-report writes the op-to-op gap in microseconds already.
                assert field.name.endswith("_us") == (
                    in_nanoseconds or field.column == "op_to_op_gap"
                ), field.name

    def test_every_field_says_what_fills_it(self):
        """A `noc` field added without its option would read as empty on every row."""
        names = [name for group in DetailGroup for name in FIELD_NAMES[group]]

        named = perf_detail.empty_in_report(
            {name: False for name in names}, list(DetailGroup)
        )

        for name in names:
            hint = next(
                (hint for hint, fields in FILLED_BY.items() if name in fields),
                "empty on every row of the report",
            )
            assert hint in named[name], name

    def test_no_detail_field_overwrites_a_field_the_row_already_has(self, handle_with):
        """They are spread over the row last, so a shared name would win silently."""
        registry, handle, _ = handle_with([_row(1)])
        base = set(tools.top_ops(registry, handle)["ops"][0]) | {
            "operation_id",
            "device_time_share_percent",
        }

        names = {
            field.name for fields in perf_detail._FIELDS.values() for field in fields
        }

        assert not names & base


class TestEmptyInReport:
    def test_a_field_no_row_carries_is_named_with_what_fills_it(self):
        rows = [
            {"device_kernel_duration": "100", "erisc_kernel_duration": ""},
            {"dispatch_go_send_wait_time": ""},
        ]

        named = perf_detail.empty_in_report(
            perf_detail.empty_fields(rows), [DetailGroup.DISPATCH, DetailGroup.RISCS]
        )

        assert "--profile-dispatch-cores" in named["dispatch_go_send_wait_us"]
        assert named["erisc_us"] == "empty on every row of the report"
        assert "kernel_us" not in named

    def test_a_column_the_report_lacks_is_not_sent_to_a_capture_option(self):
        """Re-capturing on the same tt-metal cannot fill a column its CSV has not got."""
        rows = [{"noc_util": "1.1"}, {"noc_util": "", "dram_bw_util": ""}]

        named = perf_detail.empty_in_report(
            perf_detail.empty_fields(rows), [DetailGroup.NOC]
        )

        assert "--collect-noc-traces" in named["dram_bw_util_percent"]
        assert "not among this report's columns" in named["eth_bw_util_per_core"]
        assert "noc_util_percent" not in named

    def test_a_field_one_row_carries_is_not_named(self):
        rows = [{"inner_dim_block_size": ""}, {"inner_dim_block_size": "2"}]

        named = perf_detail.empty_in_report(
            perf_detail.empty_fields(rows), [DetailGroup.CONFIG]
        )

        assert "inner_dim_block_size" not in named

    @pytest.mark.parametrize(
        ("header", "reason"),
        [
            ({PROGRAM_HASH_COLUMN, PROGRAM_CACHE_HIT_COLUMN}, "empty on every row"),
            (set(), "not among this report's columns"),
        ],
    )
    def test_the_header_tells_an_empty_program_column_from_a_missing_one(
        self, header, reason
    ):
        """The generator reads both a blank program cell and a missing column as None."""
        rows = [{"hash": None, "cache_hit": None}]

        named = perf_detail.empty_in_report(
            perf_detail.empty_fields(rows, header), [DetailGroup.CACHE]
        )

        assert reason in named["program_hash"]
        assert reason in named["program_cache_hit"]

    def test_only_the_included_groups_are_named(self):
        named = perf_detail.empty_in_report(
            perf_detail.empty_fields([{}]), [DetailGroup.NOC]
        )

        assert set(named) == set(FIELD_NAMES[DetailGroup.NOC])


class TestBounded:
    @pytest.mark.parametrize(
        ("limit", "maximum", "expected"),
        [(None, 25, 10), (None, 5, 5), (0, 25, 1), (1000, 25, 25)],
    )
    def test_a_limit_defaults_and_is_clamped_within_the_maximum(
        self, limit, maximum, expected
    ):
        assert bounded(limit, maximum) == expected

    def test_a_non_numeric_limit_is_refused_by_name(self):
        with pytest.raises(ValueError, match="limit must be a whole number, not 'x'"):
            bounded("x", 25)


class TestTopOpsInclude:
    def test_without_include_a_row_keeps_its_shape(self, handle_with):
        registry, handle, _ = handle_with([_row(1, raw_math_fidelity="HiFi4")])

        result = tools.top_ops(registry, handle)

        assert set(result["ops"][0]) == {
            "id",
            "op_code",
            "device_time",
            "cores",
            "bound",
            "bound_analysis",
            "op_category",
            "device",
            "sub_device_id",
            "op_type",
        }
        assert not {"included", "empty_in_report", "detail_note"} & set(result)

    def test_include_adds_the_groups_fields_to_every_row(self, handle_with):
        rows = [
            _row(1, device_time="30.0", raw_math_fidelity="HiFi4", cache_hit=True),
            _row(2, device_time="20.0", raw_math_fidelity="LoFi", cache_hit=False),
        ]
        registry, handle, _ = handle_with(rows)

        result = tools.top_ops(registry, handle, include=["cache", "config"])

        assert [op["math_fidelity"] for op in result["ops"]] == ["HiFi4", "LoFi"]
        assert [op["program_cache_hit"] for op in result["ops"]] == [True, False]
        assert result["included"] == ["config", "cache"]
        assert result["detail_note"] == perf_detail.DETAIL_NOTE

    def test_a_field_is_empty_in_report_only_if_no_row_of_it_carries_one(
        self, handle_with
    ):
        """The returned row lacks a block size; a row the limit left out has one."""
        rows = [
            _row(1, device_time="30.0", inner_dim_block_size=""),
            _row(2, device_time="1.0", inner_dim_block_size="4"),
        ]
        registry, handle, _ = handle_with(rows)

        result = tools.top_ops(registry, handle, limit=1, include=["config"])

        assert result["ops"][0]["inner_dim_block_size"] is None
        assert "inner_dim_block_size" not in result["empty_in_report"]
        assert "output_subblock_h" in result["empty_in_report"]

    def test_a_field_no_row_carries_is_left_out_of_the_rows(self, handle_with):
        """empty_in_report already says it is null everywhere; each row need not."""
        registry, handle, _ = handle_with([_row(1, raw_math_fidelity="HiFi4")])

        result = tools.top_ops(registry, handle, include=["config"])

        assert result["ops"][0]["math_fidelity"] == "HiFi4"
        assert "output_subblock_h" not in result["ops"][0]
        assert "output_subblock_h" in result["empty_in_report"]

    def test_an_empty_include_is_the_plain_answer(self, handle_with):
        rows = [_row(index, device_time=str(index)) for index in range(MAX_LIMIT + 5)]
        registry, handle, _ = handle_with(rows)

        result = tools.top_ops(registry, handle, limit=MAX_LIMIT + 5, include=[])

        assert result["returned"] == MAX_LIMIT
        assert not {"included", "empty_in_report", "detail_note"} & set(result)

    def test_include_caps_the_rows_lower_than_the_plain_answer(self, handle_with):
        rows = [_row(index, device_time=str(index)) for index in range(40)]
        registry, handle, _ = handle_with(rows)

        plain = tools.top_ops(registry, handle, limit=100)
        detailed = tools.top_ops(registry, handle, limit=100, include=["cache"])

        assert plain["returned"] == 40
        assert detailed["returned"] == MAX_DETAILED_LIMIT

    def test_a_bad_limit_is_refused_before_the_report_is_generated(self, handle_with):
        registry, handle, generate = handle_with([_row(1)])

        for tool in (tools.top_ops, tools.program_cache):
            with pytest.raises(ValueError, match="limit must be a whole number"):
                tool(registry, handle, limit="ten")

        generate.assert_not_called()

    def test_a_ranged_call_names_only_what_the_whole_report_lacks(self, tmp_path):
        """The window lacks a block size that a row before it has."""
        rows = [
            _row(2, inner_dim_block_size="4"),
            _row(3, op_code="START", op_type="signpost"),
            _row(4, inner_dim_block_size=""),
        ]

        def generate(instance, **overrides):
            return _perf_report(rows[2:] if overrides.get("start_signpost") else rows)

        registry = ReportRegistry()
        write_device_log(tmp_path, MODERN_HEADER, [])
        handle = load_report(registry, performance_path=str(tmp_path))["handle"]
        with (
            patch.object(tools, "_generate_canonical_report", side_effect=generate),
            patch.object(
                tools,
                "_resolve_signposts",
                return_value=ResolvedSignposts({"START": [1]}, True),
            ),
        ):
            result = tools.top_ops(
                registry, handle, start_signpost="START", include=["config"]
            )

        assert [op["id"] for op in result["ops"]] == ["4"]
        assert "inner_dim_block_size" not in result["empty_in_report"]

    def test_the_empty_fields_are_read_once_per_handle(self, handle_with):
        registry, handle, _ = handle_with([_row(1)])

        with patch.object(
            perf_detail, "empty_fields", wraps=perf_detail.empty_fields
        ) as empty_fields:
            tools.top_ops(registry, handle, include=["config"])
            tools.top_ops(registry, handle, include=["riscs"])

        empty_fields.assert_called_once()

    def test_an_unknown_group_is_refused_before_the_report_is_generated(
        self, handle_with
    ):
        registry, handle, generate = handle_with([_row(1)])

        with pytest.raises(ValueError, match="unknown include group"):
            tools.top_ops(registry, handle, include=["why"])

        generate.assert_not_called()


def _cached(row_id, program, hit, op_code="Matmul"):
    return _row(row_id, op_code=op_code, hash=program, cache_hit=hit)


class TestProgramCache:
    def test_a_program_seen_before_is_a_repeat_call(self, handle_with):
        rows = [
            _cached(2, "a", False),
            _cached(3, "a", True),
            _cached(4, "a", False),
            _cached(5, "b", False),
        ]
        registry, handle, _ = handle_with(rows)

        result = tools.program_cache(registry, handle)

        assert result["op_codes"] == [
            {
                "op_code": "Matmul",
                "calls": 4,
                "programs": 2,
                "repeat_calls": 2,
                "repeat_hits": 1,
                "repeat_misses": 1,
                "repeat_unrecorded": 0,
                "first_repeat_miss_perf_id": "4",
            }
        ]
        assert result["repeat_hit_percent"] == 50.0
        assert "caveat" not in result

    def test_a_first_call_is_first_in_report_order_not_id_order(self, handle_with):
        """The performance view walks its rows in order; so does this."""
        registry, handle, _ = handle_with(
            [_cached(9, "a", False), _cached(3, "a", False)]
        )

        result = tools.program_cache(registry, handle)

        assert result["op_codes"][0]["first_repeat_miss_perf_id"] == "3"

    def test_calls_are_grouped_by_the_raw_op_code_not_the_shape(self, handle_with):
        rows = [
            _cached(2, "a", False, op_code="Matmul 64 x 64 x 64"),
            _cached(3, "b", False, op_code="Matmul 128 x 64 x 64"),
            _cached(4, "a", False, op_code="Matmul 64 x 64 x 64"),
        ]
        for row in rows:
            row["raw_op_code"] = "MatmulDeviceOperation"
        registry, handle, _ = handle_with(rows)

        result = tools.program_cache(registry, handle)

        assert result["grouped_by"] == "raw_op_code"
        assert [
            (entry["op_code"], entry["programs"]) for entry in result["op_codes"]
        ] == [("MatmulDeviceOperation", 2)]

    def test_a_repeat_call_with_no_recorded_result_is_neither_hit_nor_miss(
        self, handle_with
    ):
        rows = [_cached(2, "a", False), _cached(3, "a", None), _cached(4, "a", None)]
        registry, handle, _ = handle_with(rows)

        result = tools.program_cache(registry, handle)

        entry = result["op_codes"][0]
        assert (
            entry["repeat_calls"],
            entry["repeat_hits"],
            entry["repeat_misses"],
            entry["repeat_unrecorded"],
        ) == (2, 0, 0, 2)
        assert result["repeat_unrecorded"] == 2
        # A 0% would read as every repeat missing.
        assert result["repeat_hit_percent"] is None
        assert "2 of 2 repeat calls recorded no cache result" in result["caveat"]
        assert "there is no hit percentage." in result["caveat"]
        # The table footer leaves them out too (#2169), so the caveat no longer contrasts it.
        assert "counts them as misses" not in result["caveat"]
        # Nothing says these missed, so nothing says the cache was off.
        assert "program cache disabled" not in result["caveat"]

    def test_the_hit_rate_is_out_of_the_repeats_that_recorded_a_result(
        self, handle_with
    ):
        rows = [
            _cached(2, "a", False),
            _cached(3, "a", True),
            _cached(4, "a", None),
            _cached(5, "a", False),
        ]
        registry, handle, _ = handle_with(rows)

        result = tools.program_cache(registry, handle)

        assert (result["repeat_hits"], result["repeat_misses"]) == (1, 1)
        assert result["repeat_unrecorded"] == 1
        assert result["repeat_hit_percent"] == 50.0
        assert "1 of 3 repeat calls recorded no cache result" in result["caveat"]
        assert "the hit percentage is out of the rest." in result["caveat"]

    def test_every_recorded_repeat_missing_still_says_the_cache_may_have_been_off(
        self, handle_with
    ):
        rows = [_cached(2, "a", False), _cached(3, "a", None), _cached(4, "a", False)]
        registry, handle, _ = handle_with(rows)

        result = tools.program_cache(registry, handle)

        assert result["repeat_hit_percent"] == 0.0
        assert "1 of 2 repeat calls recorded no cache result" in result["caveat"]
        assert "program cache disabled" in result["caveat"]

    def test_rows_without_a_program_hash_are_not_counted(self, handle_with):
        rows = [
            _cached(2, "a", False),
            _row(3, op_code="signpost", op_type="signpost"),
            _row(4, op_code="aten::add (torch)", hash=None),
        ]
        registry, handle, _ = handle_with(rows)

        result = tools.program_cache(registry, handle)

        assert result["calls"] == 1
        assert [entry["op_code"] for entry in result["op_codes"]] == ["Matmul"]

    def test_the_op_code_with_the_most_repeat_misses_comes_first(self, handle_with):
        rows = [
            _cached(2, "add", False, op_code="Add"),
            _cached(3, "add", True, op_code="Add"),
            _cached(4, "add", True, op_code="Add"),
            _cached(5, "mm", False, op_code="Matmul"),
            _cached(6, "mm", False, op_code="Matmul"),
            _cached(7, "relu", False, op_code="Relu"),
        ]
        registry, handle, _ = handle_with(rows)

        result = tools.program_cache(registry, handle)

        assert [entry["op_code"] for entry in result["op_codes"]] == [
            "Matmul",
            "Add",
            "Relu",
        ]

    def test_op_codes_tied_on_misses_and_repeats_are_in_name_order(self, handle_with):
        rows = [
            _cached(2, "z", False, op_code="Zeta"),
            _cached(3, "z", False, op_code="Zeta"),
            _cached(4, "a", False, op_code="Alpha"),
            _cached(5, "a", False, op_code="Alpha"),
        ]
        registry, handle, _ = handle_with(rows)

        result = tools.program_cache(registry, handle)

        assert [entry["op_code"] for entry in result["op_codes"]] == ["Alpha", "Zeta"]

    def test_a_hashed_row_with_no_op_code_is_counted_under_an_empty_one(
        self, handle_with
    ):
        rows = [
            _cached(2, "a", False, op_code=None),
            _cached(3, "a", True, op_code=None),
        ]
        registry, handle, _ = handle_with(rows)

        result = tools.program_cache(registry, handle)

        assert [(entry["op_code"], entry["calls"]) for entry in result["op_codes"]] == [
            ("", 2)
        ]

    def test_a_limit_is_capped_and_the_totals_cover_every_op_code(self, handle_with):
        rows = [
            _cached(index, str(index), False, op_code=f"Op{index}")
            for index in range(150)
        ]
        registry, handle, _ = handle_with(rows)

        result = tools.program_cache(registry, handle, limit=10_000)

        assert result["returned"] == MAX_LIMIT
        assert result["op_code_count"] == 150
        assert result["programs"] == 150

    def test_no_repeat_calls_gives_no_hit_rate(self, handle_with):
        registry, handle, _ = handle_with(
            [_cached(2, "a", False), _cached(3, "b", False)]
        )

        result = tools.program_cache(registry, handle)

        assert result["repeat_calls"] == 0
        assert result["repeat_hit_percent"] is None
        assert "caveat" not in result

    def test_a_run_where_every_repeat_call_missed_says_the_cache_may_have_been_off(
        self, handle_with
    ):
        registry, handle, _ = handle_with(
            [_cached(2, "a", False), _cached(3, "a", False)]
        )

        result = tools.program_cache(registry, handle)

        assert result["repeat_hit_percent"] == 0.0
        assert "program cache disabled" in result["caveat"]

    def test_a_capture_without_program_hashes_says_why_nothing_was_counted(
        self, handle_with
    ):
        registry, handle, _ = handle_with([_row(2), _row(3)])

        result = tools.program_cache(registry, handle)

        assert result["op_codes"] == []
        assert PROGRAM_HASH_COLUMN in result["caveat"]


# Both program columns, and a Latin-1 cell where UTF-8 is expected.
_NOT_UTF_8 = (
    f"OP CODE,{PROGRAM_HASH_COLUMN},{PROGRAM_CACHE_HIT_COLUMN}\n"
    "Matmul \u00b5s,a,True\n"
).encode("latin-1")


class TestProgramCacheInventory:
    @pytest.mark.parametrize(
        ("columns", "answerable"),
        [
            ([PROGRAM_HASH_COLUMN, PROGRAM_CACHE_HIT_COLUMN], True),
            ([PROGRAM_HASH_COLUMN], False),
            ([], False),
        ],
    )
    def test_it_is_answerable_only_with_both_program_columns(
        self, tmp_path, columns, answerable
    ):
        write_ops_perf(
            tmp_path,
            [{**row, **{col: "1" for col in columns}} for row in smoke_rows()],
        )

        loaded = load_report(ReportRegistry(), performance_path=str(tmp_path))

        assert "top_ops" in loaded["answerable"]
        assert ("program_cache" in loaded["answerable"]) is answerable

    @pytest.mark.parametrize(
        ("content", "problem"),
        [
            pytest.param(b"", "empty", id="empty"),
            pytest.param(b" \n", "empty", id="whitespace-only"),
            pytest.param(b",\n", "empty", id="comma-only"),
            # The encoding named is the locale's, which `top_ops` reads with too.
            pytest.param(_NOT_UTF_8, "not ", id="not-utf-8"),
            pytest.param(
                f"OP CODE,OP TYPE,DEVICE ID,{PROGRAM_HASH_COLUMN},{PROGRAM_CACHE_HIT_COLUMN}\n".encode(
                    "utf-8"
                ),
                "no data rows",
                id="header-only",
            ),
            pytest.param(
                f"OP CODE,OP TYPE,GLOBAL CALL COUNT,{PROGRAM_HASH_COLUMN},{PROGRAM_CACHE_HIT_COLUMN}\nMatmul,tt_dnn_device,1,a,True\n".encode(
                    "utf-8"
                ),
                "missing columns: DEVICE ID",
                id="missing-device-id",
            ),
            pytest.param(
                (
                    f"OP CODE,OP TYPE,DEVICE ID,{PROGRAM_HASH_COLUMN},{PROGRAM_CACHE_HIT_COLUMN}\n"
                    + ("Matmul,tt_dnn_device,0,a,True\n" * 400)
                ).encode("utf-8")
                + b"Matmul \xb5s,tt_dnn_device,0,a,True\n",
                "not ",
                id="non-utf-8-past-8k",
            ),
        ],
    )
    def test_a_header_that_cannot_be_read_leaves_it_unanswerable(
        self, tmp_path, content, problem
    ):
        """#2170: and says why, so an agent can tell an empty capture from a
        corrupt one without calling `top_ops` to find out."""
        (tmp_path / "ops_perf_results.csv").write_bytes(content)

        loaded = load_report(ReportRegistry(), performance_path=str(tmp_path))

        assert "top_ops" not in loaded["answerable"]
        assert "program_cache" not in loaded["answerable"]
        assert loaded["performance_csv_problem"].startswith(problem)

    @pytest.mark.parametrize(
        "content",
        [b"", _NOT_UTF_8],
        ids=["empty", "not-utf-8"],
    )
    def test_a_header_that_cannot_be_read_has_no_program_columns(
        self, tmp_path, content
    ):
        """The generator reads a blank program cell as None, so only the header
        could tell an empty column from a missing one."""
        (tmp_path / "ops_perf_results.csv").write_bytes(content)
        registry = ReportRegistry()
        handle = load_report(registry, performance_path=str(tmp_path))["handle"]

        with patch.object(
            tools,
            "_generate_canonical_report",
            return_value=_perf_report([_row(2, hash=None, cache_hit=None)]),
        ):
            result = tools.top_ops(registry, handle, include=["cache"])

        for name in ("program_hash", "program_cache_hit"):
            assert "not among this report's columns" in result["empty_in_report"][name]

    def test_a_csv_that_is_not_utf_8_is_refused_by_the_generator(self, tmp_path):
        """tt-perf-report's input is decoded whole, so no tool reads past the header."""
        (tmp_path / "ops_perf_results.csv").write_bytes(_NOT_UTF_8)
        registry = ReportRegistry()
        handle = load_report(registry, performance_path=str(tmp_path))["handle"]

        with pytest.raises(UnicodeDecodeError):
            tools.program_cache(registry, handle)


class TestTransport:
    def _tools(self):
        response = server.handle_message(
            {"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
            server._tool_table(ReportRegistry()),
        )
        return {tool["name"]: tool for tool in response["result"]["tools"]}

    @pytest.mark.parametrize("tool", ["top_ops", "operation_detail"])
    def test_include_offers_exactly_the_groups(self, tool):
        schema = self._tools()[tool]["inputSchema"]["properties"]["include"]

        assert schema["type"] == "array"
        assert schema["items"]["enum"] == [group.value for group in DetailGroup]

    def test_program_cache_takes_a_handle_and_a_limit(self):
        schema = self._tools()["program_cache"]["inputSchema"]

        assert set(schema["properties"]) == {"handle", "limit"}
        assert schema["required"] == ["handle"]


class TestEndToEnd:
    """The mocked rows above skip the generator; these run a real capture through it."""

    def _load(self, tmp_path, rows):
        registry = ReportRegistry()
        write_ops_perf(tmp_path, rows)
        return registry, load_report(registry, performance_path=str(tmp_path))

    def _handle(self, tmp_path, rows):
        registry, loaded = self._load(tmp_path, rows)
        return registry, loaded["handle"]

    def test_the_raw_columns_reach_the_rows_in_microseconds(self, tmp_path):
        rows = smoke_rows()
        registry, handle = self._handle(tmp_path, rows)

        result = tools.top_ops(registry, handle, include=["cores", "kernels"])

        raw_by_id = {
            str(index + REPORT_ROW_ID_OFFSET): row for index, row in enumerate(rows)
        }
        for op in result["ops"]:
            raw = raw_by_id[op["id"]]
            expected = float(raw["DEVICE KERNEL DURATION PER CORE MIN [ns]"]) / 1000
            assert op["per_core_min_us"] == round(expected, 3)
            assert (
                op["compute_kernels"]
                == perf_detail.detail_fields(
                    {"compute_kernel_source": raw["COMPUTE KERNEL SOURCE"]},
                    [DetailGroup.KERNELS],
                )["compute_kernels"]
            )

    def test_a_merged_rows_detail_comes_from_the_device_tt_perf_report_kept(
        self, tmp_path
    ):
        """The slowest device's row, except a collective's, which keeps the first's."""
        rows = []
        for row in smoke_rows():
            slower = {**row, "DEVICE ID": "1"}
            duration = float(row["DEVICE KERNEL DURATION [ns]"] or 0)
            slower["DEVICE KERNEL DURATION [ns]"] = str(int(duration * 2))
            slower["DEVICE KERNEL FIRST TO LAST START [ns]"] = "999000"
            rows += [{**row, "DEVICE ID": "0"}, slower]
        registry, handle = self._handle(tmp_path, rows)

        ops = tools.top_ops(registry, handle, limit=25, include=["cores"])["ops"]

        collectives = [op for op in ops if "AllGather" in op["op_code"]]
        assert collectives and len(collectives) < len(ops)
        for op in ops:
            raw = rows[int(op["id"]) - REPORT_ROW_ID_OFFSET]
            assert raw["DEVICE ID"] == ("0" if op in collectives else "1")
            expected = float(raw["DEVICE KERNEL FIRST TO LAST START [ns]"]) / 1000
            assert op["first_to_last_start_us"] == round(expected, 3)

    def test_math_fidelity_is_the_csvs_own_column(self, tmp_path):
        rows = smoke_rows()
        registry, handle = self._handle(tmp_path, rows)

        result = tools.top_ops(registry, handle, include=["config"])

        raw_by_id = {
            str(index + REPORT_ROW_ID_OFFSET): row for index, row in enumerate(rows)
        }
        assert result["ops"]
        for op in result["ops"]:
            raw = raw_by_id[op["id"]]["MATH FIDELITY"] or None
            assert op.get("math_fidelity") == raw

    def test_no_advice_is_an_empty_list_and_never_an_empty_field(self, tmp_path):
        """[] is tt-perf-report's answer that it has no advice, not a missing column."""
        registry, handle = self._handle(tmp_path, smoke_rows())

        result = tools.top_ops(registry, handle, include=["advice"])

        assert result["ops"]
        assert all(op["advice"] == [] for op in result["ops"])
        assert "advice" not in result["empty_in_report"]

    def test_repeated_detail_cells_share_one_string(self, tmp_path):
        """A run repeats its kernel paths on every call; each is held once."""
        registry, handle = self._handle(tmp_path, smoke_rows())

        rows = tools.canonical_report(registry, handle)["report"]

        sources = [row["data_movement_kernel_source"] for row in rows]
        repeated = [text for text in set(sources) if sources.count(text) > 1]
        assert repeated
        for text in repeated:
            assert len({id(source) for source in sources if source == text}) == 1

    def test_a_column_the_capture_left_empty_is_named_with_its_option(self, tmp_path):
        """The smoke capture has the dispatch columns, with nothing in them."""
        registry, handle = self._handle(tmp_path, smoke_rows())

        result = tools.top_ops(registry, handle, include=["dispatch"])

        assert (
            "--profile-dispatch-cores"
            in result["empty_in_report"]["dispatch_cq_cmd_op_us"]
        )
        assert "op_to_op_gap_us" not in result["empty_in_report"]

    @pytest.mark.parametrize(
        ("columns", "reason"),
        [
            ([PROGRAM_HASH_COLUMN, PROGRAM_CACHE_HIT_COLUMN], "empty on every row"),
            ([], "not among this report's columns"),
        ],
    )
    def test_an_empty_program_column_is_told_from_a_missing_one(
        self, tmp_path, columns, reason
    ):
        rows = [{**row, **{column: "" for column in columns}} for row in smoke_rows()]
        registry, handle = self._handle(tmp_path, rows)

        result = tools.top_ops(registry, handle, include=["cache"])

        assert reason in result["empty_in_report"]["program_hash"]
        assert reason in result["empty_in_report"]["program_cache_hit"]

    def test_program_cache_counts_what_the_capture_recorded(self, tmp_path):
        rows = smoke_rows()
        # One program per op code: its first call builds it, and every later one hits.
        seen = set()
        for row in rows:
            row[PROGRAM_HASH_COLUMN] = row["OP CODE"]
            row[PROGRAM_CACHE_HIT_COLUMN] = (
                "True" if row["OP CODE"] in seen else "False"
            )
            seen.add(row["OP CODE"])
        registry, loaded = self._load(tmp_path, rows)

        assert "program_cache" in loaded["answerable"]
        result = tools.program_cache(registry, loaded["handle"])

        assert result["programs"] == len({row["OP CODE"] for row in rows})
        assert result["repeat_misses"] == 0
        assert result["repeat_hits"] == result["repeat_calls"] > 0


# Claude Code cuts an MCP answer off at 25k tokens: about 75 KB of this JSON at 3 bytes a token.
ANSWER_BUDGET_BYTES = 75_000

ALL_GROUPS = [group.value for group in DetailGroup]

# A real matmul's kernels (2026_08_19_16_47_08, row 325): kernel lists are most of a
# detailed row, and the smoke capture's are a fraction of a real report's.
_COMPUTE_KERNEL = (
    "ttnn/cpp/ttnn/operations/matmul/device/kernels/compute/"
    "bmm_large_block_zm_fused_bias_activation.cpp",
    "bmm_large_block_zm_fused_bias_activation/13541336121582845819/",
)
_DATAFLOW = "ttnn/cpp/ttnn/operations/matmul/device/kernels/dataflow/"
_DATA_MOVEMENT_KERNELS = [
    (
        f"{_DATAFLOW}reader_bmm_tile_layout_in0_receiver.cpp",
        "reader_bmm_tile_layout_in0_receiver/7412344114578890896/",
    ),
    (
        f"{_DATAFLOW}reader_bmm_tile_layout_in1_receiver_writer_padding.cpp",
        "reader_bmm_tile_layout_in1_receiver_writer_padding/6147085516725974914/",
    ),
    (
        f"{_DATAFLOW}reader_bmm_tile_layout_in1_sender_writer_padding.cpp",
        "reader_bmm_tile_layout_in1_sender_writer_padding/12433275300672697615/",
    ),
    (
        f"{_DATAFLOW}reader_bmm_tile_layout_in0_sender_padding.cpp",
        "reader_bmm_tile_layout_in0_sender_padding/10430792387788596414/",
    ),
]
# A dram-sharded matmul's fifth reader, on every third row.
_SHARDED_READER = (
    f"{_DATAFLOW}reader_bmm_tile_layout_in1_sender_dram_sharded.cpp",
    "reader_bmm_tile_layout_in1_sender_dram_sharded/3305941238877262011/",
)


def _kernel_list(entries):
    return "[" + "; ".join(f"'{entry}'" for entry in entries) + "]"


def _dense_rows():
    """Smoke rows at a real report's size, each flagged as often as the view would.

    Equal device times and no op-to-op gaps put every row over the impact gate; a few
    cores, a 20 ns ideal time and a program called again with no cache hit give each
    row low utilisation, underutilised cores and, after its first call, a recompute.
    """
    rows = [dict(row) for _ in range(5) for row in smoke_rows()]
    for index, row in enumerate(rows):
        kernels = _DATA_MOVEMENT_KERNELS + ([_SHARDED_READER] if index % 3 == 0 else [])
        if not row["OP CODE"].endswith("DeviceOperation"):
            row["OP CODE"] += "DeviceOperation"
        row.update(
            {
                "COMPUTE KERNEL SOURCE": _kernel_list([_COMPUTE_KERNEL[0]]),
                "COMPUTE KERNEL HASH": _kernel_list([_COMPUTE_KERNEL[1]]),
                "DATA MOVEMENT KERNEL SOURCE": _kernel_list(
                    path for path, _ in kernels
                ),
                "DATA MOVEMENT KERNEL HASH": _kernel_list(key for _, key in kernels),
                "DEVICE KERNEL DURATION [ns]": "8000",
                "DEVICE FW DURATION [ns]": "8000",
                "OP TO OP LATENCY [ns]": "0",
                "PM IDEAL [ns]": "20",
                "CORE COUNT": "4",
                PROGRAM_HASH_COLUMN: str(5186395005779690972 + len(row["OP CODE"])),
                PROGRAM_CACHE_HIT_COLUMN: "False",
            }
        )
    return rows


def _linked_table(tmp_path, rows):
    """A tool table over `rows` and one profiler operation that launched all of them."""
    write_ops_perf(tmp_path / "perf", rows)
    performance_only = ReportRegistry()
    handle = load_report(performance_only, performance_path=str(tmp_path / "perf"))
    launched = [
        row["raw_op_code"]
        for row in tools.canonical_report(performance_only, handle["handle"])["report"]
    ]
    profiler_path = _write_profiler(
        tmp_path / "profiler",
        {1: _graph("ttnn.model", *launched, nested=False)},
        operations=[(1, "ttnn.model")],
    )
    registry = ReportRegistry()
    load_report(
        registry, performance_path=str(tmp_path / "perf"), profiler_path=profiler_path
    )
    return server._tool_table(registry)


class TestAnswerSize:
    """Unmocked `tools/call`s on a linked capture: the detailed-row cap is for these."""

    @pytest.fixture(autouse=True)
    def _never_touch_the_real_event_log(self, event_log_directory):
        """Any tools/call reaches the recorder; none may write outside tmp_path."""

    @pytest.fixture
    def table(self, tmp_path):
        """Five smoke runs, one profiler operation launching all of them, and one
        repeat call that missed the program cache."""
        rows = [dict(row) for _ in range(5) for row in smoke_rows()]
        seen = set()
        for row in rows:
            row[PROGRAM_HASH_COLUMN] = row["OP CODE"]
            row[PROGRAM_CACHE_HIT_COLUMN] = (
                "True" if row["OP CODE"] in seen else "False"
            )
            seen.add(row["OP CODE"])
        first_repeat = len(rows) // 5
        for row in rows[first_repeat : first_repeat + 2]:
            row[PROGRAM_CACHE_HIT_COLUMN] = "False"
        return _linked_table(tmp_path, rows)

    @pytest.fixture
    def dense(self, tmp_path):
        """Rows as long and as flagged as a real report's: the budget's worst case.

        Indented, the real linked pair (`2026_08_19_16_47_08` with `bge_m3_aug19_1645`)
        once went past the budget with flags, and so did this table.
        """
        return _linked_table(tmp_path, _dense_rows())

    def _call(self, table, name, arguments):
        response = server.handle_message(
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {
                    "name": name,
                    "arguments": {"handle": "report-1", **arguments},
                },
            },
            table,
        )
        assert response is not None and not response["result"].get("isError")
        text = response["result"]["content"][0]["text"]
        assert len(text.encode()) < ANSWER_BUDGET_BYTES
        payload = json.loads(text)
        json.dumps(payload, allow_nan=False)
        return payload

    @staticmethod
    def _assert_dense(rows):
        """The table is only the worst case while its rows stay this flagged."""
        assert len(rows) == MAX_DETAILED_LIMIT
        assert sum(len(row["flags"]) for row in rows) >= 2.5 * len(rows)
        assert all(len(row["data_movement_kernels"]) >= 4 for row in rows)

    def test_top_ops_with_every_group_fits_the_budget(self, dense):
        result = self._call(
            dense, "top_ops", {"limit": MAX_LIMIT, "include": ALL_GROUPS}
        )

        assert result["returned"] == MAX_DETAILED_LIMIT
        assert result["operation_link"]["status"] == "linked"
        self._assert_dense(result["ops"])

    def test_operation_detail_with_every_group_fits_the_budget(self, dense):
        result = self._call(
            dense, "operation_detail", {"operation_id": 1, "include": ALL_GROUPS}
        )

        assert result["perf_row_count"] > MAX_DETAILED_LIMIT
        self._assert_dense(result["perf_rows"])
        # Every row of the operation carries it, past the cap as well as within it.
        assert (
            result["flag_basis"]["flagged_rows"]["low_utilisation"]
            == result["perf_row_count"]
        )

    def test_program_cache_fits_the_budget_and_names_the_missing_operation(self, table):
        result = self._call(table, "program_cache", {"limit": MAX_LIMIT})

        (missed,) = [entry for entry in result["op_codes"] if entry["repeat_misses"]]
        assert missed["first_repeat_miss_operation_id"] == 1
        assert result["operation_link"]["status"] == "linked"
