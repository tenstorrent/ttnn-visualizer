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

import sqlite3
from unittest.mock import patch

import pytest
from ttnn_visualizer import csv_queries
from ttnn_visualizer.agent import server, tools
from ttnn_visualizer.agent.bounds import MAX_LIMIT
from ttnn_visualizer.agent.handles import (
    MAX_SCOPED_REPORTS,
    ReportRegistry,
    UnknownHandleError,
    load_report,
)
from ttnn_visualizer.csv_queries import DeviceLogProfilerQueries, ResolvedSignposts
from ttnn_visualizer.event_logging import (
    EVENT_FIELD,
    EVENT_LOG_FILENAME,
    OUTCOME_FIELD,
    RECORDING_DISABLED_ENV_VAR,
    TOOL_FIELD,
    EventLogEvent,
    McpToolName,
    McpToolOutcome,
    get_application_version,
)
from ttnn_visualizer.exceptions import DataFormatError, InvalidSignpostRange
from ttnn_visualizer.models import Instance
from ttnn_visualizer.tests.event_log_readers import (
    parse_event_log_line,
    read_event_log_lines,
)
from ttnn_visualizer.tests.smoke_capture import (
    SIGNPOST_START_POSITION,
    SIGNPOSTED_WINDOW_IDS,
    SMOKE_CAPTURE_DIR,
    signpost,
    signposted_rows,
    smoke_rows,
    write_ops_perf,
)
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


def _perf_report(rows, signpost_range_ignored=False):
    return {
        "report": rows,
        "stacked_report": [],
        "signposts": [],
        "signpost_range_ignored": signpost_range_ignored,
    }


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


# The signposts a patched handle "holds", in file order. Every name the mocked
# tests range over is here, since a name a report lacks is now refused against this
# list before a report is generated.
_PATCHED_SIGNPOSTS = ["PERF_DECODE", "PERF_DECODE_END", "A", "B", "C", "START", "END"]


def _signposts_in(*handles):
    """Patch the signpost read: the named handles' CSVs hold `_PATCHED_SIGNPOSTS`,
    others none.

    The mocked tests write no CSV for `range_ignored` to read.
    """

    def resolve(instance):
        held = instance.instance_id in handles
        names = (
            {name: [index] for index, name in enumerate(_PATCHED_SIGNPOSTS)}
            if held
            else {}
        )
        return ResolvedSignposts(names, True)

    return patch.object(tools, "_resolve_signposts", side_effect=resolve)


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
        assert set(loaded["unanswerable"]) == {
            "find_operations",
            "operation_detail",
            "memory_profile",
            "tensor_flow",
            "operation_provenance",
        }
        assert loaded["capture"]["ARCH"] == "wormhole_b0"
        assert loaded["performance_csv"] == "ops_perf_results_x.csv"

    def test_it_never_names_a_tool_that_is_not_registered(self, tmp_path):
        """`operations` was listed whenever a `db.sqlite` was present, but no such
        tool existed — so an agent reading the list had a name it could not call.
        Every name in either list must be one the transport registers."""
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
        assert loaded["data_present_without_tools"] == []

    def test_a_partial_database_answers_only_what_it_can(self, tmp_path):
        """A truncated capture can hold `operations` and not `buffers`. Probing
        one table advertised all four tools and then failed three of them with
        "no such table" -- the same broken promise as naming an unregistered
        tool, for the same reason. #2012
        """
        profiler = tmp_path / "profiler"
        profiler.mkdir()
        connection = sqlite3.connect(profiler / "db.sqlite")
        connection.executescript(
            "CREATE TABLE operations (operation_id int, name text, duration float);"
        )
        connection.commit()
        connection.close()

        loaded = load_report(ReportRegistry(), profiler_path=str(profiler))

        assert loaded["answerable"] == ["find_operations"]
        assert {
            "memory_profile",
            "operation_detail",
            "tensor_flow",
            "operation_provenance",
        } <= set(loaded["unanswerable"])

    def test_an_empty_database_file_is_not_answerable(self, tmp_path):
        """A zero-byte `db.sqlite` opens as a valid empty database.

        Checking only that the file exists advertised all four database tools and
        then failed each of them with "no such table", which is the same broken
        promise as naming an unregistered tool. #2012
        """
        profiler = tmp_path / "profiler"
        profiler.mkdir()
        (profiler / "db.sqlite").write_text("", encoding="utf-8")

        loaded = load_report(ReportRegistry(), profiler_path=str(profiler))

        assert loaded["answerable"] == []
        assert "find_operations" in loaded["unanswerable"]

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
    @pytest.fixture(autouse=True)
    def signposted(self):
        with _signposts_in("report-1"):
            yield

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

        Unranged it is inert — `ignore_signposts` returns the frame before the
        strip runs — and ranged it keeps the signposts inside the window, so a
        projection that exists to not filter must keep declaring it true. A range
        is per call and stays out of this constant: the operation link is matched
        against the whole report (#2122).
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

        assert result["returned"] == MAX_LIMIT
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

    def test_a_range_reaches_the_generator_and_is_echoed(self, tmp_path):
        """The window is tt-perf-report's, not a cut of the whole snapshot (#2122)."""
        registry = self._registry(tmp_path)
        with patch.object(
            tools, "_generate_canonical_report", return_value=_perf_report([_row()])
        ) as generate:
            result = tools.top_ops(
                registry,
                "report-1",
                start_signpost="PERF_DECODE",
                end_signpost="PERF_DECODE_END",
            )

        _, overrides = generate.call_args
        assert overrides == {
            "start_signpost": "PERF_DECODE",
            "end_signpost": "PERF_DECODE_END",
        }
        assert result["projection"] == {
            **tools.CANONICAL_PROJECTION,
            "start_signpost": "PERF_DECODE",
            "end_signpost": "PERF_DECODE_END",
            "boundary_signposts_included": False,
            "signpost_range_ignored": False,
        }

    def test_an_unranged_projection_names_no_range(self, tmp_path):
        registry = self._registry(tmp_path)
        with patch.object(
            tools, "_generate_canonical_report", return_value=_perf_report([_row()])
        ):
            result = tools.top_ops(registry, "report-1")

        assert result["projection"] == tools.CANONICAL_PROJECTION

    def test_a_range_on_a_report_without_signposts_says_it_was_ignored(self, tmp_path):
        registry = self._registry(tmp_path)
        with (
            _signposts_in(),
            patch.object(
                tools, "_generate_canonical_report", return_value=_perf_report([_row()])
            ) as generate,
        ):
            result = tools.top_ops(registry, "report-1", start_signpost="PERF_START")

        assert result["projection"]["signpost_range_ignored"] is True
        # tt-perf-report would read the whole file for it, so the whole is what runs.
        generate.assert_called_once_with(registry.get("report-1"))

    @pytest.mark.parametrize("argument", ["start_signpost", "end_signpost"])
    def test_an_overlong_signpost_name_is_refused_before_anything_is_read(
        self, tmp_path, argument
    ):
        registry = self._registry(tmp_path)
        name = "S" * (tools.MAX_SIGNPOST_NAME_LENGTH + 1)
        with patch.object(tools, "_generate_canonical_report") as generate:
            with pytest.raises(ValueError, match=f"{argument} is 257 characters"):
                tools.top_ops(registry, "report-1", **{argument: name})

        generate.assert_not_called()

    def test_a_signpost_name_at_the_limit_is_accepted(self, tmp_path):
        """Refused for its length is one thing; this one is refused for being
        absent, which proves it got past the length check."""
        registry = self._registry(tmp_path)
        name = "S" * tools.MAX_SIGNPOST_NAME_LENGTH
        with pytest.raises(ValueError, match="no signpost named"):
            tools.top_ops(registry, "report-1", start_signpost=name)

    def test_a_name_the_report_lacks_is_refused_without_generating(self, tmp_path):
        """Refused against the signposts already read: an agent guessing names
        pays no report generation and no second read of the CSV."""
        registry = self._registry(tmp_path)
        with (
            _signposts_in("report-1") as resolve,
            patch.object(tools, "_generate_canonical_report") as generate,
        ):
            for _ in range(3):
                with pytest.raises(ValueError, match="no signpost named 'TYPO'"):
                    tools.top_ops(registry, "report-1", start_signpost="TYPO")

        generate.assert_not_called()
        assert resolve.call_count == 1

    def test_signposts_are_read_once_per_handle(self, tmp_path):
        registry = self._registry(tmp_path)
        with (
            _signposts_in("report-1") as resolve,
            patch.object(
                tools, "_generate_canonical_report", return_value=_perf_report([_row()])
            ),
        ):
            tools.top_ops(registry, "report-1", start_signpost="A")
            tools.top_ops(registry, "report-1", start_signpost="B")
            tools.top_ops(registry, "report-1", end_signpost="END")

        assert resolve.call_count == 1

    def test_ranges_on_a_report_without_signposts_share_the_whole_snapshot(
        self, tmp_path
    ):
        """Every name is accepted there, so one copy per name would grow without
        bound on an agent's guesses."""
        registry = self._registry(tmp_path)
        with (
            _signposts_in(),
            patch.object(
                tools, "_generate_canonical_report", return_value=_perf_report([_row()])
            ) as generate,
        ):
            tools.top_ops(registry, "report-1", start_signpost="A")
            tools.top_ops(registry, "report-1", start_signpost="B", end_signpost="C")
            whole = tools.top_ops(registry, "report-1")

        generate.assert_called_once()
        assert "signpost_range_ignored" not in whole["projection"]

    @pytest.mark.parametrize(
        "start, end, expected",
        [
            (None, "END", (None, "END")),
            ("", "END", (None, "END")),
            ("START", None, ("START", None)),
        ],
    )
    def test_a_one_sided_range_reaches_the_generator(
        self, tmp_path, start, end, expected
    ):
        registry = self._registry(tmp_path)
        with patch.object(
            tools, "_generate_canonical_report", return_value=_perf_report([_row()])
        ) as generate:
            result = tools.top_ops(
                registry, "report-1", start_signpost=start, end_signpost=end
            )

        assert generate.call_args.kwargs == {
            "start_signpost": expected[0],
            "end_signpost": expected[1],
        }
        assert (
            result["projection"]["start_signpost"],
            result["projection"]["end_signpost"],
        ) == expected

    def test_each_range_is_kept_apart_from_the_whole_report(self, tmp_path):
        """A window served from the whole snapshot, or the reverse, is a wrong answer
        that looks right; each read is generated once and kept under its range."""
        registry = self._registry(tmp_path)
        whole = _perf_report([_row(id="1"), _row(id="2")])
        window = _perf_report([_row(id="2")])

        def generate_for(_instance, **overrides):
            return window if overrides.get("start_signpost") else whole

        with patch.object(
            tools, "_generate_canonical_report", side_effect=generate_for
        ) as generate:
            first_whole = tools.top_ops(registry, "report-1")
            first_window = tools.top_ops(registry, "report-1", start_signpost="A")
            again_whole = tools.top_ops(registry, "report-1", by="op_to_op_gap")
            again_window = tools.top_ops(registry, "report-1", start_signpost="A")

        assert generate.call_count == 2
        assert first_whole["op_count"] == again_whole["op_count"] == 2
        assert first_window["op_count"] == again_window["op_count"] == 1

    def test_an_empty_signpost_name_is_no_range(self, tmp_path):
        """`check_signpost_range` reads an empty name as no bound, so it must not
        generate a second copy of the whole report."""
        registry = self._registry(tmp_path)
        with patch.object(
            tools, "_generate_canonical_report", return_value=_perf_report([_row()])
        ) as generate:
            tools.top_ops(registry, "report-1")
            result = tools.top_ops(
                registry, "report-1", start_signpost="", end_signpost=""
            )

        generate.assert_called_once()
        assert result["projection"] == tools.CANONICAL_PROJECTION

    def test_a_refused_range_is_raised_and_not_kept(self, tmp_path):
        """One the pre-check passes but the generator refuses -- its own check
        stays authoritative -- is not cached either."""
        registry = self._registry(tmp_path)
        with patch.object(
            tools,
            "_generate_canonical_report",
            side_effect=[
                InvalidSignpostRange("signpost 'A' occurs once"),
                _perf_report([_row()]),
            ],
        ) as generate:
            with pytest.raises(ValueError, match="occurs once"):
                tools.top_ops(registry, "report-1", start_signpost="A")
            tools.top_ops(registry, "report-1", start_signpost="A")

        assert generate.call_count == 2

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
        """tt-perf-report prints this warning to the terminal; a tool response
        has no terminal, so it has to carry the warning itself.

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


class TestPartitionCaveatEndToEnd:
    """The mocked rows above pin the branch; this pins the wiring underneath it.

    Between the two sits the parser -- #1994's `sub_device_id` entry in
    `REPORT_COLUMN_HEADERS` and tt-perf-report 1.3.0's `SUB DEVICE ID` column.
    Mocking `_generate_canonical_report` skips exactly that, so a rename either
    side would leave the mocked tests green and every real report uncaveated.
    Only the sub-device column is synthesised here; the rest is a real capture
    through the real report generator.
    """

    def _capture(self, tmp_path, name, sub_device_ids):
        import csv

        source = SMOKE_CAPTURE_DIR / "ops_perf_results.csv"
        if not source.is_file():
            pytest.skip(f"{source} is not present")
        rows = list(csv.DictReader(source.open()))
        destination = tmp_path / name
        destination.mkdir()
        fields = list(rows[0].keys()) + ["SUB DEVICE ID"]
        with (destination / "ops_perf_results.csv").open("w", newline="") as out:
            writer = csv.DictWriter(out, fieldnames=fields)
            writer.writeheader()
            for index, row in enumerate(rows):
                row["SUB DEVICE ID"] = sub_device_ids[index % len(sub_device_ids)]
                writer.writerow(row)
        return destination

    def _handle(self, registry, tmp_path, name, sub_device_ids):
        capture = self._capture(tmp_path, name, sub_device_ids)
        return load_report(registry, performance_path=str(capture))["handle"]

    def test_the_generated_rows_carry_the_sub_device_the_capture_recorded(
        self, tmp_path
    ):
        registry = ReportRegistry()
        handle = self._handle(registry, tmp_path, "partitioned", ["0", "1"])

        report = tools._generate_canonical_report(registry.get(handle))
        recorded = {
            str(row.get("sub_device_id", "")).strip()
            for row in report.get("report", [])
        }

        assert recorded == {"0", "1"}

    def test_a_real_partitioned_capture_is_caveated(self, tmp_path):
        registry = ReportRegistry()
        handle = self._handle(registry, tmp_path, "partitioned", ["0", "1"])

        assert "2 sub-devices" in tools.top_ops(registry, handle)["caveat"]

    def test_a_real_single_sub_device_capture_is_not(self, tmp_path):
        """The other half: a caveat on every report is a caveat nobody reads."""
        registry = ReportRegistry()
        handle = self._handle(registry, tmp_path, "whole", ["0"])

        assert "caveat" not in tools.top_ops(registry, handle)

    def test_a_diff_of_two_partitioned_captures_is_caveated(self, tmp_path):
        registry = ReportRegistry()
        before = self._handle(registry, tmp_path, "before", ["0", "1"])
        after = self._handle(registry, tmp_path, "after", ["0", "1"])

        diff = tools.diff_reports(registry, before, after)

        assert "2 sub-devices" in diff["caveat"]


class TestSignpostRangeEndToEnd:
    """A range through the real generator (#2122).

    No demo or fixture capture holds signposts, so the shared smoke helper
    inserts them, as it does for the HTTP route's signpost tests.
    """

    def _handle(self, registry, tmp_path, rows=None):
        directory = tmp_path / "signposted"
        write_ops_perf(directory, signposted_rows() if rows is None else rows)
        return load_report(registry, performance_path=str(directory))["handle"]

    def _ranged(self, registry, handle, **overrides):
        return tools.top_ops(
            registry,
            handle,
            by="total_percent",
            limit=MAX_LIMIT,
            **{"start_signpost": "PERF_START", "end_signpost": "PERF_END", **overrides},
        )

    @staticmethod
    def _report_ids(registry, handle, signposts=None):
        rows = tools.canonical_report(registry, handle, signposts)["report"]
        return {int(row["id"]) for row in rows}

    def test_the_window_holds_the_rows_between_the_signposts_and_no_other(
        self, tmp_path
    ):
        """Read from the generated rows, not the ranking: ranking drops every
        signpost, so only the rows themselves show a bound left in."""
        registry = ReportRegistry()
        handle = self._handle(registry, tmp_path)

        whole_ids = self._report_ids(registry, handle)
        ranged_ids = self._report_ids(
            registry, handle, tools.SignpostRange("PERF_START", "PERF_END")
        )

        assert ranged_ids == whole_ids & set(SIGNPOSTED_WINDOW_IDS)
        assert ranged_ids
        # The bounds themselves sit just outside the window, in the whole report.
        bounds = {min(SIGNPOSTED_WINDOW_IDS) - 1, max(SIGNPOSTED_WINDOW_IDS) + 1}
        assert bounds <= whole_ids
        assert not bounds & ranged_ids
        assert self._ranged(registry, handle)["op_count"] == len(ranged_ids)

    def test_a_signpost_inside_the_window_is_kept(self, tmp_path):
        """`print_signposts` stays true so an inner marker is not stripped."""
        rows = signposted_rows()
        # Well inside the window; the end signpost moves down one and still bounds it.
        inner = SIGNPOST_START_POSITION + 4
        rows.insert(inner, signpost("PERF_INNER", rows[inner]))
        registry = ReportRegistry()
        handle = self._handle(registry, tmp_path, rows)

        report = tools.canonical_report(
            registry, handle, tools.SignpostRange("PERF_START", "PERF_END")
        )["report"]

        assert any(
            row.get("op_type") == "signpost" and "PERF_INNER" in str(row.get("op_code"))
            for row in report
        )

    def test_total_percent_is_recomputed_over_the_window(self, tmp_path):
        """What a cut of the whole snapshot would get wrong, and why it regenerates."""
        registry = ReportRegistry()
        handle = self._handle(registry, tmp_path)

        whole = tools.top_ops(registry, handle, by="total_percent", limit=MAX_LIMIT)
        ranged = self._ranged(registry, handle)

        window_ids = {op["id"] for op in ranged["ops"]}
        cut_from_whole = sum(
            op["total_percent"] for op in whole["ops"] if op["id"] in window_ids
        )
        assert ranged["total_percent_total"] == pytest.approx(100.0, abs=0.5)
        assert cut_from_whole < ranged["total_percent_total"] - 1

    def test_a_name_the_report_lacks_is_refused(self, tmp_path):
        registry = ReportRegistry()
        handle = self._handle(registry, tmp_path)

        with pytest.raises(ValueError, match="no signpost named 'PERF_TYPO'"):
            self._ranged(registry, handle, start_signpost="PERF_TYPO")

    def test_an_end_before_the_start_is_refused(self, tmp_path):
        registry = ReportRegistry()
        handle = self._handle(registry, tmp_path)

        with pytest.raises(ValueError, match="before start signpost"):
            self._ranged(
                registry, handle, start_signpost="PERF_END", end_signpost="PERF_START"
            )

    def test_a_range_on_a_capture_without_signposts_is_read_whole(self, tmp_path):
        """The real signpost read, not a patched one, agrees with tt-perf-report:
        the unmodified smoke capture has no signposts, so a range reads it whole."""
        registry = ReportRegistry()
        handle = self._handle(registry, tmp_path, smoke_rows())

        whole = tools.top_ops(registry, handle, limit=MAX_LIMIT)
        ranged = tools.top_ops(
            registry, handle, limit=MAX_LIMIT, start_signpost="PERF_START"
        )

        assert ranged["projection"]["signpost_range_ignored"] is True
        assert ranged["op_count"] == whole["op_count"]
        assert ranged["ops"] == whole["ops"]

    def test_an_unreadable_capture_is_a_data_format_error_on_a_ranged_read(
        self, tmp_path
    ):
        """The signpost read now runs before any report is generated, so it is
        where a capture pandas cannot tokenise is first met. An unterminated quote
        fails that read itself; a merely ragged row would not."""
        directory = tmp_path / "unterminated"
        directory.mkdir()
        (directory / "ops_perf_results.csv").write_text(
            'OP TYPE,OP CODE\nsignpost,"A\n'
        )
        registry = ReportRegistry()
        handle = load_report(registry, performance_path=str(directory))["handle"]

        with pytest.raises(
            DataFormatError, match="could not read the report's signposts"
        ):
            tools.top_ops(registry, handle, start_signpost="A")


class TestScopedSnapshots:
    """Ranged snapshots are evicted, not pinned; whole ones are pinned."""

    def test_the_least_recently_used_range_is_evicted_first(self, tmp_path):
        registry = ReportRegistry()
        write_device_log(tmp_path, MODERN_HEADER, [])
        load_report(registry, performance_path=str(tmp_path))
        built = []

        def build(scope):
            def _build(_instance):
                built.append(scope)
                return scope

            return _build

        registry.cached_report("report-1", build(None))
        for scope in range(MAX_SCOPED_REPORTS):
            registry.cached_report("report-1", build(scope), scope=scope)
        # Touch the oldest, so the next one in evicts the second oldest instead.
        registry.cached_report("report-1", build(0), scope=0)
        registry.cached_report("report-1", build("new"), scope="new")
        built.clear()

        registry.cached_report("report-1", build(0), scope=0)
        registry.cached_report("report-1", build(1), scope=1)
        registry.cached_report("report-1", build(None))

        assert built == [1]

    def test_clearing_the_registry_drops_ranged_snapshots_too(self, tmp_path):
        registry = ReportRegistry()
        write_device_log(tmp_path, MODERN_HEADER, [])
        load_report(registry, performance_path=str(tmp_path))
        built = []
        registry.cached_report("report-1", built.append, scope="x")

        registry.clear()
        load_report(registry, performance_path=str(tmp_path))
        registry.cached_report("report-1", built.append, scope="x")

        assert len(built) == 2


class TestDiffReports:
    @pytest.fixture(autouse=True)
    def signposted(self):
        with _signposts_in("report-1", "report-2"):
            yield

    def _two_reports(self, tmp_path):
        registry = ReportRegistry()
        for name in ("a", "b"):
            directory = tmp_path / name
            directory.mkdir()
            write_device_log(directory, MODERN_HEADER, [])
            load_report(registry, performance_path=str(directory))
        return registry

    def test_one_range_applies_to_both_reports(self, tmp_path):
        registry = self._two_reports(tmp_path)
        with patch.object(
            tools,
            "_generate_canonical_report",
            side_effect=[_perf_report([_row()]), _perf_report([_row()])],
        ) as generate:
            diff = tools.diff_reports(
                registry,
                "report-1",
                "report-2",
                start_signpost="PERF_DECODE",
                end_signpost="PERF_DECODE_END",
            )

        assert [call.kwargs for call in generate.call_args_list] == [
            {"start_signpost": "PERF_DECODE", "end_signpost": "PERF_DECODE_END"}
        ] * 2
        assert diff["projection"]["start_signpost"] == "PERF_DECODE"
        assert diff["projection"]["signpost_range_ignored"] is False

    @pytest.mark.parametrize("ignored_side", ["report-1", "report-2"])
    def test_a_range_only_one_report_can_honour_is_refused(
        self, tmp_path, ignored_side
    ):
        """A window against a whole report reports every row outside the window
        as a change: an apparent regression, or win, made of rows."""
        registry = self._two_reports(tmp_path)
        signposted = {"report-1", "report-2"} - {ignored_side}
        with (
            _signposts_in(*signposted),
            patch.object(tools, "_generate_canonical_report") as generate,
        ):
            with pytest.raises(
                ValueError, match=f"{ignored_side!r} holds no signposts"
            ):
                tools.diff_reports(
                    registry, "report-1", "report-2", start_signpost="PERF_START"
                )

        # Refused from the signpost check alone, before either report is built.
        generate.assert_not_called()

    def test_a_range_neither_report_can_honour_is_answered_and_flagged(self, tmp_path):
        registry = self._two_reports(tmp_path)
        reports = [_perf_report([_row()]), _perf_report([_row()])]
        with (
            _signposts_in(),
            patch.object(tools, "_generate_canonical_report", side_effect=reports),
        ):
            diff = tools.diff_reports(
                registry, "report-1", "report-2", start_signpost="PERF_START"
            )

        assert diff["projection"]["signpost_range_ignored"] is True

    def test_a_range_refused_for_one_report_is_not_kept_for_either(self, tmp_path):
        """The report that generated stays cached; the refused one is built again."""
        registry = self._two_reports(tmp_path)
        with patch.object(
            tools,
            "_generate_canonical_report",
            side_effect=[
                _perf_report([_row()]),
                InvalidSignpostRange("no signpost named 'PERF_DECODE_END'"),
                _perf_report([_row()]),
            ],
        ) as generate:
            with pytest.raises(ValueError, match="no signpost named"):
                tools.diff_reports(
                    registry, "report-1", "report-2", end_signpost="PERF_DECODE_END"
                )
            tools.diff_reports(
                registry, "report-1", "report-2", end_signpost="PERF_DECODE_END"
            )

        assert generate.call_count == 3

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

        assert pairing == {
            "unmatched_starts": 1,
            "unmatched_ends": 1,
            "dropped_starts": 0,
        }
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
        assert pairing == {
            "unmatched_starts": 0,
            "unmatched_ends": 0,
            "dropped_starts": 0,
        }


class TestOpenZoneCeiling:
    def test_starts_past_the_ceiling_are_counted_rather_than_held(
        self, tmp_path, monkeypatch
    ):
        """A malformed log can open a zone on every row and close none.

        The map is bounded so the read cannot be made to grow with the file, and
        what the bound cost is reported — a truncated read must not be
        indistinguishable from a complete one.
        """
        monkeypatch.setattr(csv_queries, "MAX_OPEN_ZONE_STARTS", 2)
        never_closed = [
            f"1,{index},1,BRISC,{index},1000,0,1,,,LEAK,ZONE_START,1,brisc.cc,"
            for index in range(5)
        ]
        write_device_log(tmp_path, MODERN_HEADER, never_closed)
        instance = Instance(instance_id="pytest", performance_path=str(tmp_path))

        with DeviceLogProfilerQueries(instance, stream=True) as queries:
            _summary, pairing = queries.query_zone_summary()

        assert pairing["unmatched_starts"] == 2
        assert pairing["dropped_starts"] == 3

    def test_the_caveat_says_the_log_is_malformed(self, tmp_path, monkeypatch):
        monkeypatch.setattr(csv_queries, "MAX_OPEN_ZONE_STARTS", 1)
        registry = ReportRegistry()
        write_device_log(
            tmp_path,
            MODERN_HEADER,
            [
                "1,1,1,BRISC,1,1000,0,1,,,LEAK,ZONE_START,1,brisc.cc,",
                "1,2,1,BRISC,2,1000,0,1,,,LEAK,ZONE_START,1,brisc.cc,",
            ],
        )
        load_report(registry, performance_path=str(tmp_path))

        result = tools.zone_timings(registry, "report-1")

        assert "open-zone ceiling" in result["caveat"]
        assert "malformed" in result["caveat"]


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
    @pytest.fixture(autouse=True)
    def _never_touch_the_real_event_log(self, event_log_directory):
        """Any tools/call reaches the recorder now; none may write outside tmp_path."""

    def _table(self):
        return server._tool_table(ReportRegistry())

    def test_it_advertises_every_tool_with_a_schema(self):
        response = server.handle_message(
            {"jsonrpc": "2.0", "id": 1, "method": "tools/list"}, self._table()
        )

        advertised = {tool["name"] for tool in response["result"]["tools"]}
        assert advertised == {
            "load_report",
            "top_ops",
            "zone_timings",
            "diff_reports",
            "find_operations",
            "operation_detail",
            "memory_profile",
            "tensor_flow",
            "operation_provenance",
        }
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

    def test_a_refused_signpost_range_comes_back_as_content(self, tmp_path):
        """`InvalidSignpostRange` is a `ValueError`, so the model reads why."""
        registry = ReportRegistry()
        write_device_log(tmp_path, MODERN_HEADER, [])
        load_report(registry, performance_path=str(tmp_path))
        with (
            _signposts_in("report-1"),
            patch.object(tools, "_generate_canonical_report") as generate,
            patch.object(server, "record_event") as record,
        ):
            response = server.handle_message(
                {
                    "jsonrpc": "2.0",
                    "id": 2,
                    "method": "tools/call",
                    "params": {
                        "name": "top_ops",
                        "arguments": {"handle": "report-1", "start_signpost": "TYPO"},
                    },
                },
                server._tool_table(registry),
            )

        assert response["result"]["isError"] is True
        assert "no signpost named 'TYPO'" in response["result"]["content"][0]["text"]
        assert record.call_args.kwargs["outcome"] is McpToolOutcome.REFUSED
        # Refused from the argument the server passed through, not a stubbed raise.
        generate.assert_not_called()

    @pytest.mark.parametrize("tool", ["top_ops", "diff_reports"])
    def test_the_signpost_arguments_are_advertised(self, tool):
        """A client sends only what the schema declares; a range missing from it
        would be invisible to agents however well the tool handled one."""
        response = server.handle_message(
            {"jsonrpc": "2.0", "id": 1, "method": "tools/list"}, self._table()
        )

        schema = next(
            entry["inputSchema"]
            for entry in response["result"]["tools"]
            if entry["name"] == tool
        )
        assert {"start_signpost", "end_signpost"} <= set(schema["properties"])

    def test_a_one_sided_ranged_diff_comes_back_as_content(self, tmp_path):
        registry = ReportRegistry()
        for name in ("a", "b"):
            directory = tmp_path / name
            directory.mkdir()
            write_device_log(directory, MODERN_HEADER, [])
            load_report(registry, performance_path=str(directory))
        with (
            _signposts_in("report-1"),
            patch.object(server, "record_event") as record,
        ):
            response = server.handle_message(
                {
                    "jsonrpc": "2.0",
                    "id": 4,
                    "method": "tools/call",
                    "params": {
                        "name": "diff_reports",
                        "arguments": {
                            "handle_a": "report-1",
                            "handle_b": "report-2",
                            "start_signpost": "PERF_DECODE",
                        },
                    },
                },
                server._tool_table(registry),
            )

        text = response["result"]["content"][0]["text"]
        assert response["result"]["isError"] is True
        assert "'report-2' holds no signposts" in text
        assert record.call_args.kwargs["outcome"] is McpToolOutcome.REFUSED

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
        assert response["result"]["serverInfo"]["version"] == get_application_version()

    def test_initialize_reports_the_package_version(self):
        # Equality with the real helper alone would pass if both sides were
        # "unknown"; a sentinel proves the value is read from the helper.
        with patch.object(server, "get_application_version", return_value="9.9.9"):
            response = server.handle_message(
                {"jsonrpc": "2.0", "id": 5, "method": "initialize", "params": {}},
                self._table(),
            )

        assert response["result"]["serverInfo"]["version"] == "9.9.9"

    def test_a_successful_call_is_recorded(self):
        table = self._table()
        table["load_report"]["handler"] = lambda arguments: {"handle": "report-1"}

        with patch.object(server, "record_event") as record:
            response = server.handle_message(
                {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "tools/call",
                    "params": {"name": "load_report", "arguments": {}},
                },
                table,
            )

        assert "error" not in response
        record.assert_called_once_with(
            EventLogEvent.MCP_TOOL_CALLED,
            server_mode=False,
            tool=McpToolName.LOAD_REPORT,
            outcome=McpToolOutcome.OK,
        )

    def test_a_refused_call_is_recorded(self):
        with patch.object(server, "record_event") as record:
            server.handle_message(
                {
                    "jsonrpc": "2.0",
                    "id": 2,
                    "method": "tools/call",
                    "params": {"name": "top_ops", "arguments": {"handle": "absent"}},
                },
                self._table(),
            )

        record.assert_called_once_with(
            EventLogEvent.MCP_TOOL_CALLED,
            server_mode=False,
            tool=McpToolName.TOP_OPS,
            outcome=McpToolOutcome.REFUSED,
        )

    def test_an_unknown_tool_is_not_recorded(self):
        with patch.object(server, "record_event") as record:
            server.handle_message(
                {
                    "jsonrpc": "2.0",
                    "id": 3,
                    "method": "tools/call",
                    "params": {"name": "not_a_tool", "arguments": {}},
                },
                self._table(),
            )

        record.assert_not_called()

    def test_an_unexpected_failure_is_recorded_as_error(self):
        table = self._table()

        def fail(_arguments):
            raise RuntimeError("boom")

        table["load_report"]["handler"] = fail

        with patch.object(server, "record_event") as record:
            response = server.handle_message(
                {
                    "jsonrpc": "2.0",
                    "id": 5,
                    "method": "tools/call",
                    "params": {"name": "load_report", "arguments": {}},
                },
                table,
            )

        assert response["result"]["isError"] is True
        record.assert_called_once_with(
            EventLogEvent.MCP_TOOL_CALLED,
            server_mode=False,
            tool=McpToolName.LOAD_REPORT,
            outcome=McpToolOutcome.ERROR,
        )

    def test_a_disabled_recorder_still_answers(self, monkeypatch, event_log_directory):
        monkeypatch.setenv(RECORDING_DISABLED_ENV_VAR, "true")
        table = self._table()
        table["load_report"]["handler"] = lambda arguments: {"handle": "report-1"}

        response = server.handle_message(
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {"name": "load_report", "arguments": {}},
            },
            table,
        )

        assert response["result"]["content"][0]["text"]
        assert "error" not in response
        assert not (event_log_directory / EVENT_LOG_FILENAME).exists()

    def test_an_unregistered_name_is_not_recorded_by_the_helper(self):
        with patch.object(server, "record_event") as record:
            server._record_tool_call("not_a_tool", McpToolOutcome.OK)

        record.assert_not_called()

    def test_a_successful_call_writes_a_schema_line(self, event_log_directory):
        table = self._table()
        table["load_report"]["handler"] = lambda arguments: {"handle": "report-1"}

        server.handle_message(
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {"name": "load_report", "arguments": {}},
            },
            table,
        )

        (line,) = read_event_log_lines(event_log_directory)
        fields = parse_event_log_line(line)

        assert fields[EVENT_FIELD] == EventLogEvent.MCP_TOOL_CALLED.value
        assert fields[TOOL_FIELD] == McpToolName.LOAD_REPORT.value
        assert fields[OUTCOME_FIELD] == McpToolOutcome.OK.value


def test_registered_tools_are_the_mcp_tool_name_vocabulary():
    """A handwritten table can still omit an enum member, or sneak in a string key."""
    assert {member.value for member in McpToolName} == set(
        server._tool_table(ReportRegistry())
    )


def test_main_skips_compaction_when_recording_is_disabled(monkeypatch):
    order = []
    monkeypatch.setattr(server, "compact_if_needed", lambda: order.append("compact"))
    monkeypatch.setattr(server, "serve", lambda *args, **kwargs: order.append("serve"))
    monkeypatch.setattr(server, "is_recording_enabled", lambda: False)
    monkeypatch.setattr(server, "get_recording_disabled_reason", lambda: "opt-out")

    server.main()

    assert order == ["serve"]


def test_main_compacts_then_serves_when_recording_is_enabled(monkeypatch):
    order = []
    monkeypatch.setattr(server, "compact_if_needed", lambda: order.append("compact"))
    monkeypatch.setattr(server, "serve", lambda *args, **kwargs: order.append("serve"))
    monkeypatch.setattr(server, "is_recording_enabled", lambda: True)
    monkeypatch.setattr(server, "get_event_log_path", lambda: "/tmp/events.log")
    monkeypatch.setattr(server, "describe_opt_out", lambda: "opt-out")

    server.main()

    assert order == ["compact", "serve"]


def test_main_serves_when_event_log_startup_raises(monkeypatch):
    def raise_no_home():
        raise RuntimeError("Could not determine home directory.")

    order = []
    monkeypatch.setattr(server, "is_recording_enabled", raise_no_home)
    monkeypatch.setattr(server, "compact_if_needed", lambda: order.append("compact"))
    monkeypatch.setattr(server, "serve", lambda *args, **kwargs: order.append("serve"))

    server.main()

    assert order == ["serve"]


class TestProjectRow:
    def test_a_row_says_which_roofline_model_ran_and_its_category(self):
        """A blank bound means "never modelled" or "measured, fine"; only bound_analysis tells which."""
        projected = tools.project_row(
            _row(bound="", bound_analysis="none", op_category="Other")
        )

        assert projected["bound"] is None
        assert projected["bound_analysis"] == "none"
        assert projected["op_category"] == "Other"

    def test_a_row_without_the_columns_reports_them_as_null(self):
        projected = tools.project_row(_row())

        assert projected["bound_analysis"] is None
        assert projected["op_category"] is None


class TestCountableDeviceTime:
    """Restates `isCountableDeviceTime`'s cases (`tests/durationBuckets.spec.ts`):
    a share counted any other way would disagree with the app's."""

    @pytest.mark.parametrize(
        "device_time", ["", None, "0", 0, "-5", "nan", "inf", "-inf", "1e400", True]
    )
    def test_a_blank_non_finite_or_non_positive_time_counts_for_nothing(
        self, device_time
    ):
        assert tools.countable_device_time({"device_time": device_time}) is None

    @pytest.mark.parametrize(
        ("device_time", "expected"), [("0.5", 0.5), ("12345", 12345.0), (3, 3.0)]
    )
    def test_a_positive_finite_time_counts(self, device_time, expected):
        assert tools.countable_device_time({"device_time": device_time}) == expected

    def test_a_row_without_the_column_counts_for_nothing(self):
        assert tools.countable_device_time({}) is None
