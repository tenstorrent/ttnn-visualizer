# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""The agent tool surface: bounded results, a stated projection, honest caveats.

The tools an agent reaches for have a failure mode the UI does not: a wrong
answer is indistinguishable from a right one, because nothing renders next to it
for a human to sanity-check. So the properties pinned here are the ones that
keep an answer honest — that the projection is canonical rather than the view's,
that a total on a partitioned run carries its caveat, that a limit is capped,
and that a zone pairing survives the chunk boundary it is invisible across.
See #1995.
"""

from pathlib import Path
from unittest.mock import patch

import pytest
from ttnn_visualizer import csv_queries
from ttnn_visualizer.agent import server, tools
from ttnn_visualizer.agent.handles import (
    ReportRegistry,
    UnknownHandleError,
    load_report,
)
from ttnn_visualizer.csv_queries import DeviceLogProfilerQueries
from ttnn_visualizer.exceptions import DataFormatError
from ttnn_visualizer.models import Instance
from ttnn_visualizer.tests.test_device_log_columns import (
    MODERN_HEADER,
    PREAMBLE,
    write_device_log,
)

ZONED_ROWS = [
    # Two cores running the same zone, so `cores` counts distinctly from
    # `occurrences`.
    "1,1,1,BRISC,10,1000,0,1,,,MATMUL,ZONE_START,1,brisc.cc,",
    "1,1,1,BRISC,11,1400,0,1,,,MATMUL,ZONE_END,1,brisc.cc,",
    "1,2,1,BRISC,12,2000,0,1,,,MATMUL,ZONE_START,1,brisc.cc,",
    "1,2,1,BRISC,13,2100,0,1,,,MATMUL,ZONE_END,1,brisc.cc,",
    "1,1,1,NCRISC,14,3000,0,1,,,READ,ZONE_START,1,ncrisc.cc,",
    "1,1,1,NCRISC,15,3050,0,1,,,READ,ZONE_END,1,ncrisc.cc,",
]

# The same core coordinates on a second PCIe slot. Every capture in `reports/`
# spans several slots -- 8 and 32 -- so coordinates alone are not a core.
TWO_SLOT_ROWS = [
    "1,1,1,BRISC,10,1000,0,1,,,MATMUL,ZONE_START,1,brisc.cc,",
    "1,1,1,BRISC,11,1200,0,1,,,MATMUL,ZONE_END,1,brisc.cc,",
    "2,1,1,BRISC,12,5000,0,1,,,MATMUL,ZONE_START,1,brisc.cc,",
    "2,1,1,BRISC,13,5300,0,1,,,MATMUL,ZONE_END,1,brisc.cc,",
]

# No `type` column, so a start cannot be told from an end.
UNTYPED_HEADER = (
    "PCIe slot, core_x, core_y, RISC processor type, timer_id,"
    " time[cycles since reset], data, run host ID, zone name, source line,"
    " source file"
)
UNTYPED_ROWS = [
    "1,1,1,BRISC,10,1000,0,1,MATMUL,1,brisc.cc",
    "1,1,1,BRISC,11,1400,0,1,MATMUL,1,brisc.cc",
]


def _perf_report(rows):
    return {"report": rows, "stacked_report": [], "signposts": []}


def _row(**overrides):
    row = {
        "id": "1",
        "op_code": "Matmul",
        "device_time": "10.0",
        "cores": "64",
        "device": "0",
        "op_to_op_gap": "1.0",
        "total_percent": "50.0",
    }
    row.update(overrides)
    return row


class TestReportInventory:
    def test_a_performance_only_report_says_which_tools_apply(self, tmp_path):
        """The Blaze-shaped case: perf data, no SQLite, no graph capture.

        An agent told only "loaded" would spend a call each discovering that the
        operation questions have no input.
        """
        write_device_log(tmp_path, MODERN_HEADER, [])
        (tmp_path / "ops_perf_results_x.csv").write_text("ID\n", encoding="utf-8")

        loaded = load_report(ReportRegistry(), performance_path=str(tmp_path))

        assert loaded["handle"] == "report-1"
        assert set(loaded["answerable"]) == {"top_ops", "zone_timings"}
        assert loaded["unanswerable"] == []
        assert loaded["capture"]["ARCH"] == "wormhole_b0"
        assert loaded["performance_csv"] == "ops_perf_results_x.csv"

    def test_it_never_names_a_tool_that_is_not_registered(self, tmp_path):
        """`operations` was listed whenever a `db.sqlite` was present, but no such
        tool exists — so an agent reading the list had a name it could not call.
        Data the report holds is reported separately from what can be asked."""
        write_device_log(tmp_path, MODERN_HEADER, [])
        profiler = tmp_path / "profiler"
        profiler.mkdir()
        (profiler / "db.sqlite").write_text("", encoding="utf-8")

        loaded = load_report(
            ReportRegistry(),
            profiler_path=str(profiler),
            performance_path=str(tmp_path),
        )

        registered = set(server._tool_table(ReportRegistry()))
        assert set(loaded["answerable"]) | set(loaded["unanswerable"]) <= registered
        assert loaded["data_present_without_tools"] == ["operations_database"]

    def test_a_missing_directory_is_refused_with_the_path(self, tmp_path):
        with pytest.raises(ValueError, match="performance_path is not a directory"):
            load_report(ReportRegistry(), performance_path=str(tmp_path / "absent"))

    def test_at_least_one_path_is_required(self):
        with pytest.raises(ValueError, match="one of profiler_path"):
            load_report(ReportRegistry())

    def test_an_unknown_handle_names_the_handles_that_exist(self, tmp_path):
        registry = ReportRegistry()
        write_device_log(tmp_path, MODERN_HEADER, [])
        load_report(registry, performance_path=str(tmp_path))

        with pytest.raises(UnknownHandleError, match="report-1"):
            registry.get("report-9")

    def test_two_reports_are_live_at_once(self, tmp_path):
        """`diff_reports` needs both, which a cache of one could not hold."""
        registry = ReportRegistry()
        first = tmp_path / "a"
        second = tmp_path / "b"
        for directory in (first, second):
            directory.mkdir()
            write_device_log(directory, MODERN_HEADER, [])

        handle_a = load_report(registry, performance_path=str(first))["handle"]
        handle_b = load_report(registry, performance_path=str(second))["handle"]

        assert handle_a != handle_b
        assert (
            registry.get(handle_a).performance_path
            != registry.get(handle_b).performance_path
        )


class TestTopOps:
    def _registry(self, tmp_path):
        registry = ReportRegistry()
        write_device_log(tmp_path, MODERN_HEADER, [])
        load_report(registry, performance_path=str(tmp_path))
        return registry

    def test_it_reads_the_report_unfiltered_and_says_so(self, tmp_path):
        """The #1883 lesson: a view filter handed over unannounced is a wrong answer.

        `get_performance_results_report` defaults to hiding host ops. A tool that
        inherited that default would drop rows an agent is reasoning about, so the
        projection is both explicit and reported back.
        """
        registry = self._registry(tmp_path)
        with patch.object(
            tools, "_generate_canonical_report", return_value=_perf_report([_row()])
        ) as generate:
            result = tools.top_ops(registry, "report-1")

        assert tools.CANONICAL_PROJECTION["hide_host_ops"] is False
        assert result["projection"]["hide_host_ops"] is False
        generate.assert_called_once()

    def test_the_projection_declares_no_filter(self, tmp_path):
        """`print_signposts` drops rows rather than only omitting a printout.

        It is inert while no tool passes a signpost range — `ignore_signposts`
        returns the frame before the strip runs — so this pins the declaration
        rather than an observable difference: a projection that exists to not
        filter should not carry a filter it would honour if a range arrived.
        """
        assert tools.CANONICAL_PROJECTION == {
            "hide_host_ops": False,
            "merge_devices": True,
            "print_signposts": True,
        }

    def test_a_limit_is_capped_rather_than_honoured(self, tmp_path):
        registry = self._registry(tmp_path)
        rows = [_row(id=str(index), device_time=str(index)) for index in range(500)]
        with patch.object(
            tools, "_generate_canonical_report", return_value=_perf_report(rows)
        ):
            result = tools.top_ops(registry, "report-1", limit=10_000)

        assert result["returned"] == tools.MAX_LIMIT
        assert result["op_count"] == 500

    def test_it_ranks_by_the_requested_metric(self, tmp_path):
        registry = self._registry(tmp_path)
        rows = [
            _row(id="a", device_time="1.0", op_to_op_gap="90.0"),
            _row(id="b", device_time="50.0", op_to_op_gap="1.0"),
        ]
        with patch.object(
            tools, "_generate_canonical_report", return_value=_perf_report(rows)
        ):
            by_time = tools.top_ops(registry, "report-1", by="device_time")
            by_gap = tools.top_ops(registry, "report-1", by="op_to_op_gap")

        assert [op["id"] for op in by_time["ops"]] == ["b", "a"]
        assert [op["id"] for op in by_gap["ops"]] == ["a", "b"]

    def test_a_report_is_generated_once_per_handle(self, tmp_path):
        """Four questions of one report should not run tt-perf-report four times.

        Each call re-parses the CSV, shells through the library and writes three
        temp files.
        """
        registry = self._registry(tmp_path)
        with patch.object(
            tools, "_generate_canonical_report", return_value=_perf_report([_row()])
        ) as generate:
            tools.top_ops(registry, "report-1")
            tools.top_ops(registry, "report-1", by="op_to_op_gap")
            tools.top_ops(registry, "report-1", limit=5)

        generate.assert_called_once()

    def test_only_additive_metrics_get_a_total(self, tmp_path):
        """`dram` is GB/s and `cores` is a per-op allocation.

        Summing either across operations produces an authoritative-looking number
        that is not a bandwidth or a core count.
        """
        registry = self._registry(tmp_path)
        rows = [_row(dram="12.5", cores="64"), _row(id="2", dram="8.0", cores="32")]
        with patch.object(
            tools, "_generate_canonical_report", return_value=_perf_report(rows)
        ):
            additive = tools.top_ops(registry, "report-1", by="device_time")
            per_op = tools.top_ops(registry, "report-1", by="dram")
            allocation = tools.top_ops(registry, "report-1", by="cores")

        assert "device_time_total" in additive
        assert "dram_total" not in per_op
        assert "cores_total" not in allocation

    def test_a_signpost_row_is_identifiable_in_the_response(self, tmp_path):
        """The projection keeps signpost rows on the grounds that `op_type` tells
        them apart, so the field has to reach the caller."""
        registry = self._registry(tmp_path)
        rows = [_row(op_type="signpost", op_code="start_of_layer")]
        with patch.object(
            tools, "_generate_canonical_report", return_value=_perf_report(rows)
        ):
            result = tools.top_ops(registry, "report-1")

        assert result["ops"][0]["op_type"] == "signpost"

    def test_an_unknown_metric_lists_the_ones_that_exist(self, tmp_path):
        registry = self._registry(tmp_path)
        with pytest.raises(ValueError, match="device_time"):
            tools.top_ops(registry, "report-1", by="wall_clock")

    def test_a_partitioned_report_carries_the_totals_caveat(self, tmp_path):
        """tt-perf-report warns about this; the visualizer does not (#1994).

        Ops on different sub-devices can run concurrently, so the sum is not
        elapsed time. An agent reading the total without this would conclude the
        run was twice as long as it was.
        """
        registry = self._registry(tmp_path)
        rows = [_row(id="1", sub_device_id="0"), _row(id="2", sub_device_id="1")]
        with patch.object(
            tools, "_generate_canonical_report", return_value=_perf_report(rows)
        ):
            result = tools.top_ops(registry, "report-1")

        assert "2 sub-devices" in result["caveat"]

    def test_a_single_sub_device_report_carries_no_caveat(self, tmp_path):
        registry = self._registry(tmp_path)
        rows = [_row(id="1", sub_device_id="0"), _row(id="2", sub_device_id="0")]
        with patch.object(
            tools, "_generate_canonical_report", return_value=_perf_report(rows)
        ):
            result = tools.top_ops(registry, "report-1")

        assert "caveat" not in result


class TestDiffReports:
    def _two_reports(self, tmp_path):
        registry = ReportRegistry()
        for name in ("a", "b"):
            directory = tmp_path / name
            directory.mkdir()
            write_device_log(directory, MODERN_HEADER, [])
            load_report(registry, performance_path=str(directory))
        return registry

    def test_identical_reports_diff_to_zero(self, tmp_path):
        registry = self._two_reports(tmp_path)
        rows = [_row(device_time="10.0"), _row(id="2", device_time="5.0")]
        with patch.object(
            tools, "_generate_canonical_report", return_value=_perf_report(rows)
        ):
            result = tools.diff_reports(registry, "report-1", "report-2")

        assert result["delta_total"] == 0.0
        assert all(change["delta"] == 0.0 for change in result["changes"])

    def test_it_groups_by_op_code_so_a_shifted_id_is_not_a_diff(self, tmp_path):
        """An inserted op renumbers every op after it; an id join would call
        each of those a change."""
        registry = self._two_reports(tmp_path)
        before = [_row(id="1", op_code="Matmul", device_time="10.0")]
        after = [
            _row(id="1", op_code="Reshard", device_time="2.0"),
            _row(id="2", op_code="Matmul", device_time="10.0"),
        ]
        with patch.object(
            tools,
            "_generate_canonical_report",
            side_effect=[_perf_report(before), _perf_report(after)],
        ):
            result = tools.diff_reports(registry, "report-1", "report-2")

        by_op = {change["op_code"]: change for change in result["changes"]}
        assert by_op["Matmul"]["delta"] == 0.0
        assert by_op["Reshard"]["delta"] == 2.0
        assert by_op["Reshard"]["count_before"] == 0

    def test_a_partitioned_diff_carries_the_caveat_too(self, tmp_path):
        """A delta of two unsound totals is unsound the same way — and this is the
        response most likely to be acted on, since it answers "did it help"."""
        registry = self._two_reports(tmp_path)
        before = [_row(sub_device_id="0"), _row(id="2", sub_device_id="1")]
        after = [_row(sub_device_id="0"), _row(id="2", sub_device_id="1")]
        with patch.object(
            tools,
            "_generate_canonical_report",
            side_effect=[_perf_report(before), _perf_report(after)],
        ):
            result = tools.diff_reports(registry, "report-1", "report-2")

        assert "2 sub-devices" in result["caveat"]

    @pytest.mark.parametrize("metric", ["dram", "flops", "cores"])
    def test_a_non_additive_metric_is_refused_rather_than_summed(
        self, tmp_path, metric
    ):
        """Every number in a diff is a per-op-code sum, so a rate cannot be one.

        One 10-TFLOPS matmul against two at 8 would read as 10 → 16: an apparent
        gain where every invocation regressed. Refusing beats inventing an
        aggregation the caller did not ask for.
        """
        registry = self._two_reports(tmp_path)

        with pytest.raises(ValueError, match="per-operation rate or allocation"):
            tools.diff_reports(registry, "report-1", "report-2", by=metric)

    def test_the_refusal_names_the_metrics_that_do_work(self, tmp_path):
        registry = self._two_reports(tmp_path)

        with pytest.raises(ValueError, match="device_time"):
            tools.diff_reports(registry, "report-1", "report-2", by="flops")

    def test_the_largest_movement_comes_first_in_either_direction(self, tmp_path):
        registry = self._two_reports(tmp_path)
        before = [
            _row(op_code="Slower", device_time="1.0"),
            _row(op_code="Faster", device_time="50.0"),
        ]
        after = [
            _row(op_code="Slower", device_time="8.0"),
            _row(op_code="Faster", device_time="10.0"),
        ]
        with patch.object(
            tools,
            "_generate_canonical_report",
            side_effect=[_perf_report(before), _perf_report(after)],
        ):
            result = tools.diff_reports(registry, "report-1", "report-2")

        assert [change["op_code"] for change in result["changes"]] == [
            "Faster",
            "Slower",
        ]


class TestZoneSummary:
    def test_it_pairs_starts_with_ends_per_core(self, tmp_path):
        instance = Instance(instance_id="pytest", performance_path=str(tmp_path))
        write_device_log(tmp_path, MODERN_HEADER, ZONED_ROWS)

        with DeviceLogProfilerQueries(instance, stream=True) as queries:
            summary, _pairing = queries.query_zone_summary()

        by_zone = {entry["zone"]: entry for entry in summary}
        # 400 cycles on core (1,1) plus 100 on core (2,1).
        assert by_zone["MATMUL"]["total_cycles"] == 500
        assert by_zone["MATMUL"]["occurrences"] == 2
        assert by_zone["MATMUL"]["cores"] == 2
        assert by_zone["MATMUL"]["mean_cycles"] == 250.0
        # Costliest first, which is why anyone asks.
        assert [entry["zone"] for entry in summary] == ["MATMUL", "READ"]

    def test_a_pair_split_across_chunks_still_matches(self, tmp_path, monkeypatch):
        """The reason starts are held in a dict rather than the rows.

        A real capture is ~724k rows, so a zone's start and end routinely land in
        different chunks. Pairing within a chunk would drop most of the file.
        """
        write_device_log(tmp_path, MODERN_HEADER, ZONED_ROWS)
        monkeypatch.setattr(csv_queries, "CSV_CHUNK_SIZE", 1)
        instance = Instance(instance_id="pytest", performance_path=str(tmp_path))

        with DeviceLogProfilerQueries(instance, stream=True) as queries:
            summary, _pairing = queries.query_zone_summary()

        by_zone = {entry["zone"]: entry for entry in summary}
        assert by_zone["MATMUL"]["total_cycles"] == 500
        assert by_zone["MATMUL"]["occurrences"] == 2

    def test_a_core_is_scoped_to_its_device(self, tmp_path):
        """`(core_x, core_y)` repeats on every PCIe slot.

        Without the slot in the identity, two devices' cores are one core: the
        count collapses, and one device's start can be closed by another's end
        — across per-device cycle counters, which makes the duration meaningless.
        The local captures span 8 and 32 slots, where this understated the core
        count by the same factor.
        """
        write_device_log(tmp_path, MODERN_HEADER, TWO_SLOT_ROWS)
        instance = Instance(instance_id="pytest", performance_path=str(tmp_path))

        with DeviceLogProfilerQueries(instance, stream=True) as queries:
            summary, _pairing = queries.query_zone_summary()

        assert summary[0]["cores"] == 2
        assert summary[0]["occurrences"] == 2
        # 200 cycles on slot 1 plus 300 on slot 2, each paired within its device.
        assert summary[0]["total_cycles"] == 500

    def test_unpaired_starts_and_ends_are_reported(self, tmp_path):
        """A truncated capture leaves starts open, which a total cannot show."""
        truncated = [
            "1,1,1,BRISC,10,1000,0,1,,,MATMUL,ZONE_START,1,brisc.cc,",
            "1,1,1,BRISC,11,1400,0,1,,,MATMUL,ZONE_END,1,brisc.cc,",
            # Opens and never closes: the capture stopped here.
            "1,1,1,BRISC,12,2000,0,1,,,MATMUL,ZONE_START,1,brisc.cc,",
            # Closes something that was never opened in this file.
            "1,3,3,NCRISC,13,9000,0,1,,,READ,ZONE_END,1,ncrisc.cc,",
        ]
        write_device_log(tmp_path, MODERN_HEADER, truncated)
        instance = Instance(instance_id="pytest", performance_path=str(tmp_path))

        with DeviceLogProfilerQueries(instance, stream=True) as queries:
            summary, pairing = queries.query_zone_summary()

        assert pairing == {"unmatched_starts": 1, "unmatched_ends": 1}
        assert summary[0]["occurrences"] == 1

    def test_a_capture_missing_a_column_this_query_reads_is_refused(self, tmp_path):
        """Refused here rather than by widening `REQUIRED_DEVICE_LOG_COLUMNS`.

        That list gates every route, and its own comment records that requiring
        columns a query does not read rejects captures which work fine.
        """
        header = MODERN_HEADER.replace(" core_y,", " not_core_y,")
        write_device_log(tmp_path, header, [])
        instance = Instance(instance_id="pytest", performance_path=str(tmp_path))

        with DeviceLogProfilerQueries(instance, stream=True) as queries:
            with pytest.raises(DataFormatError, match="core_y"):
                queries.query_zone_summary()

    def test_a_capture_without_the_type_column_reports_occurrences_only(self, tmp_path):
        """`type` is deliberately not required, so durations must degrade, not lie."""
        write_device_log(tmp_path, UNTYPED_HEADER, UNTYPED_ROWS)
        instance = Instance(instance_id="pytest", performance_path=str(tmp_path))

        with DeviceLogProfilerQueries(instance, stream=True) as queries:
            summary, _pairing = queries.query_zone_summary()

        assert summary[0]["occurrences"] == 2
        assert summary[0]["total_cycles"] is None
        assert summary[0]["mean_cycles"] is None

    def test_the_capture_clock_is_read_from_the_preamble(self, tmp_path):
        """`offset=1` skips that line, so nothing else can reach the clock."""
        write_device_log(tmp_path, MODERN_HEADER, ZONED_ROWS)
        instance = Instance(instance_id="pytest", performance_path=str(tmp_path))

        metadata = DeviceLogProfilerQueries.read_capture_metadata(instance)

        assert metadata["ARCH"] == "wormhole_b0"
        assert metadata["CHIP_FREQ[MHz]"] == "1000"
        assert PREAMBLE.startswith("ARCH")


class TestZoneTimingsTool:
    def test_cycles_are_converted_with_the_capture_clock(self, tmp_path):
        registry = ReportRegistry()
        write_device_log(tmp_path, MODERN_HEADER, ZONED_ROWS)
        load_report(registry, performance_path=str(tmp_path))

        result = tools.zone_timings(registry, "report-1")

        matmul = next(zone for zone in result["zones"] if zone["zone"] == "MATMUL")
        assert result["clock_mhz"] == 1000.0
        # 500 cycles at 1000 MHz is 0.5 us.
        assert matmul["total_us"] == 0.5
        # The sum-across-cores reading has to be stated; the number invites the other.
        assert "occupancy" in result["note"]


class TestPreRenameCaptures:
    def test_a_begin_end_capture_pairs_rather_than_double_counting(self, tmp_path):
        """Pre-rename logs mark boundaries in `zone phase`, not `type`.

        Reading only `type` counted a `begin` and its `end` as two occurrences
        and threw the duration between them away — one invocation reported as
        two, which is worse than reporting none.
        """
        header = (
            "PCIe slot, core_x, core_y, RISC processor type, timer_id,"
            " time[cycles since reset], stat value, run ID, run host ID,  zone name,"
            " zone phase, source line, source file"
        )
        rows = [
            "0,1,1,BRISC,924,1000,0,0,480,BRISC-FW,begin,396,brisc.cc",
            "0,1,1,BRISC,66460,1700,0,0,480,BRISC-FW,end,396,brisc.cc",
        ]
        write_device_log(tmp_path, header, rows)
        instance = Instance(instance_id="pytest", performance_path=str(tmp_path))

        with DeviceLogProfilerQueries(instance, stream=True) as queries:
            summary, pairing = queries.query_zone_summary()

        assert summary[0]["occurrences"] == 1
        assert summary[0]["total_cycles"] == 700
        assert pairing == {"unmatched_starts": 0, "unmatched_ends": 0}


class TestZeroDuration:
    def test_a_zone_that_opened_and_closed_on_one_cycle_reports_zero(self, tmp_path):
        """Zero is a measurement; `None` means the capture could not say."""
        instant = [
            "1,1,1,BRISC,10,1000,0,1,,,INSTANT,ZONE_START,1,brisc.cc,",
            "1,1,1,BRISC,11,1000,0,1,,,INSTANT,ZONE_END,1,brisc.cc,",
        ]
        registry = ReportRegistry()
        write_device_log(tmp_path, MODERN_HEADER, instant)
        load_report(registry, performance_path=str(tmp_path))

        result = tools.zone_timings(registry, "report-1")

        assert result["zones"][0]["total_cycles"] == 0
        assert result["zones"][0]["total_us"] == 0.0


class TestTransport:
    def _table(self):
        return server._tool_table(ReportRegistry())

    def test_it_advertises_every_tool_with_a_schema(self):
        response = server.handle_message(
            {"jsonrpc": "2.0", "id": 1, "method": "tools/list"}, self._table()
        )

        advertised = {tool["name"] for tool in response["result"]["tools"]}
        assert advertised == {"load_report", "top_ops", "zone_timings", "diff_reports"}
        assert all(
            tool["inputSchema"]["type"] == "object"
            for tool in response["result"]["tools"]
        )

    def test_a_notification_is_not_answered(self):
        """A response to a notification is a protocol violation."""
        assert (
            server.handle_message(
                {"jsonrpc": "2.0", "method": "notifications/initialized"}, self._table()
            )
            is None
        )

    def test_a_refused_call_comes_back_as_content_not_a_protocol_error(self):
        """The model should read the reason and act on it, which an error frame
        does not let it do."""
        response = server.handle_message(
            {
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/call",
                "params": {"name": "top_ops", "arguments": {"handle": "absent"}},
            },
            self._table(),
        )

        assert response["result"]["isError"] is True
        assert "unknown handle" in response["result"]["content"][0]["text"]
        assert "error" not in response

    @pytest.mark.parametrize("frame", ["[]", "null", "7", '"text"'])
    def test_a_non_object_frame_is_refused_rather_than_fatal(self, frame):
        """`json.loads` returns whatever the client sent. Calling `.get` on a list
        raised out of `serve` and ended the session on one malformed frame."""
        import json as json_module

        response = server.handle_message(json_module.loads(frame), self._table())

        assert response["error"]["code"] == -32600

    @pytest.mark.parametrize("params", [[], "text", 7])
    def test_non_object_params_are_refused(self, params):
        response = server.handle_message(
            {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": params},
            self._table(),
        )

        assert response["error"]["code"] == -32602

    def test_a_non_string_method_is_refused(self):
        response = server.handle_message(
            {"jsonrpc": "2.0", "id": 1, "method": 123}, self._table()
        )

        assert response["error"]["code"] == -32600

    def test_ping_is_answered(self):
        """The protocol's liveness check. A `-32601` here reads as a failed health
        check and a compliant client may restart the server."""
        response = server.handle_message(
            {"jsonrpc": "2.0", "id": 7, "method": "ping"}, self._table()
        )

        assert response["result"] == {}
        assert "error" not in response

    def test_an_unknown_method_is_a_protocol_error(self):
        response = server.handle_message(
            {"jsonrpc": "2.0", "id": 3, "method": "resources/list"}, self._table()
        )

        assert response["error"]["code"] == -32601

    def test_initialize_reports_the_tools_capability(self):
        response = server.handle_message(
            {"jsonrpc": "2.0", "id": 4, "method": "initialize", "params": {}},
            self._table(),
        )

        assert response["result"]["capabilities"] == {"tools": {}}
        assert response["result"]["serverInfo"]["name"] == "ttnn-visualizer"
