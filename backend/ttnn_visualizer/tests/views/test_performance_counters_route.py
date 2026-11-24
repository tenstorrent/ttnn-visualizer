# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""`GET /api/performance/counters/<perf_id>`: one row's every counter label (#2371)
and its stalls per thread (#2372)."""

import csv
from http import HTTPStatus
from pathlib import Path
from unittest.mock import patch

import pytest
from ttnn_visualizer import csv_queries, hardware_counters, pipeline_stalls
from ttnn_visualizer.agent import hw_utilisation
from ttnn_visualizer.agent.handles import ReportRegistry, load_report
from ttnn_visualizer.csv_queries import (
    REPORT_ROW_ID_OFFSET,
    DeviceLogProfilerQueries,
    OpsPerformanceReportQueries,
)
from ttnn_visualizer.extensions import db
from ttnn_visualizer.file_source import FileSource
from ttnn_visualizer.models import Instance, InstanceTable
from ttnn_visualizer.tests.frontend_parity import typescript_interface_keys
from ttnn_visualizer.tests.hardware_counter_capture import (
    PERCENT_LABELS,
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
from ttnn_visualizer.tests.stall_capture import (
    CB_RESERVE_BACK,
    CB_WAIT_FRONT,
    CORE_COUNT,
    INPUT_STARVED_POSITION,
    OUTPUT_BLOCKED_POSITION,
    STALE_CB_POSITION,
    STALL_OPS,
    UNNAMED_STALL_POSITION,
    UNPACK_BOUND_POSITION,
    counter_average,
    kernel_share,
    stall_rows,
    write_stall_capture,
)

ROUTE = "/api/performance/counters"
_STALLS_MODEL = (
    Path(__file__).resolve().parents[4] / "src" / "model" / "PipelineStalls.ts"
)
COUNTED_POSITION = 0
# Both record no counters: the first names a compute kernel, the second `[]`.
UNCOUNTED_POSITION = 4
UNCOUNTED_WITHOUT_KERNEL_POSITION = 9


def _mount(app, directory: Path) -> str:
    instance_id = f"pytest-counters-{directory.name}"
    with app.app_context():
        db.session.add(
            InstanceTable(
                instance_id=instance_id,
                active_report={},
                performance_path=str(directory),
            )
        )
        db.session.commit()
    return instance_id


def _get(client, instance_id, perf_id):
    return client.get(f"{ROUTE}/{perf_id}", query_string={"instanceId": instance_id})


@pytest.fixture
def counted(app, tmp_path):
    write_counter_capture(tmp_path / "counted")
    return _mount(app, tmp_path / "counted")


def _units(body):
    return {unit["unit"]: unit for unit in body["units"]}


def _families(body):
    return {family["family"]: family for family in body["families"]}


def test_a_row_carries_each_units_stats_from_its_csv_row(client, counted):
    assert is_counted(COUNTED_POSITION)
    response = _get(client, counted, COUNTED_POSITION + REPORT_ROW_ID_OFFSET)

    assert response.status_code == HTTPStatus.OK
    body = response.get_json()
    minimum, median, maximum, average = label_values(
        PERCENT_LABELS.index("FPU Util"), COUNTED_POSITION
    )
    assert body["perf_id"] == COUNTED_POSITION + REPORT_ROW_ID_OFFSET
    assert body["has_counters"] is True
    assert body["op_has_counters"] is True
    assert body["architecture"] == "blackhole"
    assert {
        key: _units(body)["fpu"][key] for key in ("min", "median", "max", "avg")
    } == {"min": minimum, "median": median, "max": maximum, "avg": average}
    assert _units(body)["fpu"]["absence"] is None


def test_a_group_the_capture_lacks_is_not_captured_never_zero(client, counted):
    body = _get(client, counted, COUNTED_POSITION + REPORT_ROW_ID_OFFSET).get_json()

    for unit, hint in (("packer", "=pack"), ("noc_ring1", "=l1_1 or =l1_3")):
        reading = _units(body)[unit]
        assert reading["absence"] == "not_captured"
        assert reading["avg"] is None
        assert reading["fill_hint"].endswith(hint)
        assert "--profiler-capture-perf-counters" in reading["fill_hint"]


def test_a_label_the_architecture_lacks_is_not_on_architecture(client, counted):
    body = _get(client, counted, COUNTED_POSITION + REPORT_ROW_ID_OFFSET).get_json()
    pack = {metric["label"]: metric for metric in _families(body)["pack"]["metrics"]}

    assert pack["Packer Engine 0 Util"]["absence"] == "not_on_architecture"
    assert pack["Packer Engine 0 Util"]["fill_hint"] is None
    assert pack["Packer Utilization"]["absence"] == "not_captured"


def test_on_wormhole_the_same_label_could_have_been_captured(app, client, tmp_path):
    write_counter_capture(tmp_path / "wormhole", WORMHOLE_PREAMBLE)
    instance_id = _mount(app, tmp_path / "wormhole")

    body = _get(client, instance_id, REPORT_ROW_ID_OFFSET).get_json()
    pack = {metric["label"]: metric for metric in _families(body)["pack"]["metrics"]}

    assert body["architecture"] == "wormhole_b0"
    assert pack["Packer Engine 0 Util"]["absence"] == "not_captured"


def test_an_op_without_counters_has_no_value_rather_than_zero(client, counted):
    assert not is_counted(UNCOUNTED_POSITION)
    body = _get(client, counted, UNCOUNTED_POSITION + REPORT_ROW_ID_OFFSET).get_json()

    assert body["op_has_counters"] is False
    assert _units(body)["fpu"]["absence"] == "no_value"
    assert _units(body)["fpu"]["avg"] is None
    assert all(grid["value"] is None for grid in body["full_grid"])


@pytest.mark.parametrize(
    ("position", "has_kernel"),
    [(UNCOUNTED_POSITION, True), (UNCOUNTED_WITHOUT_KERNEL_POSITION, False)],
)
def test_it_says_whether_an_op_without_counters_has_a_compute_kernel(
    client, counted, position, has_kernel
):
    """Which the panel needs to tell a missing kernel from counters never recorded."""
    assert not is_counted(position)
    body = _get(client, counted, position + REPORT_ROW_ID_OFFSET).get_json()

    assert body["op_has_counters"] is False
    assert body["has_compute_kernel"] is has_kernel


def test_a_device_log_that_cannot_be_read_leaves_the_architecture_unknown(
    client, counted
):
    """As the agent reads it, so the panel's fill hints and the agent's agree."""
    with patch.object(
        DeviceLogProfilerQueries,
        "read_device_meta",
        side_effect=PermissionError("unreadable"),
    ):
        response = _get(client, counted, COUNTED_POSITION + REPORT_ROW_ID_OFFSET)

    assert response.status_code == HTTPStatus.OK
    body = response.get_json()
    assert body["architecture"] is None
    assert _units(body)["noc_ring1"]["fill_hint"].endswith("=l1_1")


def test_the_panel_and_the_agent_say_alike_why_a_unit_has_no_value(
    client, counted, tmp_path
):
    body = _get(client, counted, COUNTED_POSITION + REPORT_ROW_ID_OFFSET).get_json()
    registry = ReportRegistry()
    handle = load_report(registry, performance_path=str(tmp_path / "counted"))["handle"]
    agent = {
        unit["unit"]: unit
        for unit in hw_utilisation.hw_utilisation(registry, handle)["units"]
    }

    panel = {
        unit: (reading["absence"], reading["fill_hint"])
        for unit, reading in _units(body).items()
        if reading["absence"] in ("not_captured", "not_on_architecture")
    }

    assert set(panel) == {"packer", "noc_ring1"}
    assert panel == {
        unit: (agent[unit]["state"], agent[unit].get("fill_hint")) for unit in panel
    }


def test_a_label_this_version_does_not_know_is_listed_under_other(client, counted):
    body = _get(client, counted, COUNTED_POSITION + REPORT_ROW_ID_OFFSET).get_json()

    assert [metric["label"] for metric in _families(body)["other"]["metrics"]] == [
        UNKNOWN_LABEL
    ]


def test_the_full_grid_columns_come_apart_from_the_units(client, counted):
    body = _get(client, counted, COUNTED_POSITION + REPORT_ROW_ID_OFFSET).get_json()

    assert [grid["unit"] for grid in body["full_grid"]] == ["fpu", "sfpu", "math"]
    assert all(grid["value"] is not None for grid in body["full_grid"])


def test_a_report_without_counters_says_so_and_keeps_the_models_figure(
    app, client, tmp_path
):
    rows = [
        {**row, "PM FPU UTIL (%)": "42.5", "PM COMPUTE [ns]": "900"}
        for row in smoke_rows()
    ]
    write_ops_perf(tmp_path / "plain", rows)
    instance_id = _mount(app, tmp_path / "plain")

    body = _get(client, instance_id, REPORT_ROW_ID_OFFSET).get_json()

    assert body["has_counters"] is False
    assert body["units"] == body["families"] == body["full_grid"] == []
    assert body["performance_model"] == {"fpu_util": 42.5}


def test_the_models_placeholder_compute_time_reads_as_unmodelled(app, client, tmp_path):
    rows = [
        {**row, "PM FPU UTIL (%)": "0.004", "PM COMPUTE [ns]": "1"}
        for row in counter_rows()
    ]
    write_ops_perf(tmp_path / "placeholder", rows)
    instance_id = _mount(app, tmp_path / "placeholder")

    body = _get(client, instance_id, REPORT_ROW_ID_OFFSET).get_json()

    assert body["performance_model"] == {"fpu_util": None}


@pytest.mark.parametrize("perf_id", [0, 1, 10_000])
def test_a_row_past_either_end_is_not_found(client, counted, perf_id):
    response = _get(client, counted, perf_id)

    assert response.status_code == HTTPStatus.NOT_FOUND
    assert response.get_json()["error"] == f"No performance row {perf_id}."


@pytest.mark.parametrize("perf_id", ["+10000", "0010000"])
def test_a_missing_row_is_named_by_the_number_rather_than_the_text_of_the_url(
    client, counted, perf_id
):
    response = _get(client, counted, perf_id)

    assert response.status_code == HTTPStatus.NOT_FOUND
    assert response.get_json()["error"] == "No performance row 10000."
    assert perf_id not in response.get_data(as_text=True)


@pytest.mark.parametrize("perf_id", ["abc", "<b>7"])
def test_an_id_that_is_not_a_whole_number_is_refused_without_echoing_it(
    client, counted, perf_id
):
    response = _get(client, counted, perf_id)

    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert response.get_json()["error"] == "Invalid performance row id."
    assert perf_id not in response.get_data(as_text=True)


def _write(directory: Path, content: bytes) -> None:
    directory.mkdir()
    (directory / "ops_perf_results.csv").write_bytes(content)


def test_a_folder_without_a_performance_csv_is_not_found(app, client, tmp_path):
    (tmp_path / "empty").mkdir()
    instance_id = _mount(app, tmp_path / "empty")

    response = _get(client, instance_id, REPORT_ROW_ID_OFFSET)

    assert response.status_code == HTTPStatus.NOT_FOUND
    assert "No performance results file" in response.get_json()["error"]


def test_a_csv_with_a_header_and_no_rows_has_no_row_to_find(app, client, tmp_path):
    _write(tmp_path / "header-only", b"OP CODE,FPU Util Avg (%)\n")
    instance_id = _mount(app, tmp_path / "header-only")

    assert (
        _get(client, instance_id, REPORT_ROW_ID_OFFSET).status_code
        == HTTPStatus.NOT_FOUND
    )


@pytest.mark.parametrize(
    "content",
    [
        pytest.param(b"OP CODE,FPU Util Avg (%)\n\xff\xfe,1\n", id="undecodable"),
        pytest.param(
            b"OP CODE,FPU Util Avg (%)\n"
            + b"x" * (csv.field_size_limit() + 1)
            + b",1\n",
            id="field-past-the-csv-limit",
        ),
    ],
)
def test_a_csv_that_cannot_be_read_is_unprocessable(app, client, tmp_path, content):
    _write(tmp_path / "unreadable", content)
    instance_id = _mount(app, tmp_path / "unreadable")

    response = _get(client, instance_id, REPORT_ROW_ID_OFFSET)

    assert response.status_code == HTTPStatus.UNPROCESSABLE_ENTITY
    assert "could not be read" in response.get_json()["error"]


class TestMultiDevice:
    """The smoke capture is two devices, merged into one row per op by tt-perf-report."""

    @pytest.fixture
    def merged_rows(self, tmp_path):
        write_counter_capture(tmp_path / "merged")
        instance = Instance(
            instance_id="merged", performance_path=str(tmp_path / "merged")
        )
        return OpsPerformanceReportQueries.generate_report(instance)["report"]

    def test_each_merged_row_names_the_device_whose_row_it_reads(
        self, client, counted, merged_rows
    ):
        devices = {
            row["id"]: _get(client, counted, row["id"]).get_json()["device_id"]
            for row in merged_rows
        }

        assert devices == {row["id"]: int(row["device"]) for row in merged_rows}
        assert set(devices.values()) == {0, 1}

    @pytest.mark.parametrize(
        ("op_code", "device"),
        [
            # Device 1's Embeddings ran 7,964 ns against device 0's 7,772.
            ("Embeddings", 1),
            # A collective keeps device 0's row though device 1's ran longer.
            ("AllGather", 0),
        ],
    )
    def test_the_row_is_the_slowest_devices_but_the_first_for_a_collective(
        self, client, counted, merged_rows, op_code, device
    ):
        row = next(row for row in merged_rows if row["op_code"] == op_code)

        assert _get(client, counted, row["id"]).get_json()["device_id"] == device


class TestRequestedName:
    """The panel always names its report's folder, which can be a sibling of the one
    the instance mounts; read from the mounted one, the numbers would still look right.
    """

    SIBLING_FPU_AVG = 77.5

    @pytest.fixture
    def mounted(self, app, tmp_path):
        write_counter_capture(tmp_path / "mounted")
        rows = counter_rows()
        rows[COUNTED_POSITION] = {
            **rows[COUNTED_POSITION],
            stat_column("FPU Util", "Avg"): repr(self.SIBLING_FPU_AVG),
        }
        write_ops_perf(tmp_path / "sibling", rows)
        write_device_log(tmp_path / "sibling", WORMHOLE_PREAMBLE)
        return _mount(app, tmp_path / "mounted")

    def _read(self, client, instance_id, **query):
        body = client.get(
            f"{ROUTE}/{COUNTED_POSITION + REPORT_ROW_ID_OFFSET}",
            query_string={"instanceId": instance_id, **query},
        ).get_json()
        return body["architecture"], _units(body)["fpu"]["avg"]

    def _mounted_fpu_avg(self):
        *_, average = label_values(PERCENT_LABELS.index("FPU Util"), COUNTED_POSITION)
        return average

    def test_the_named_report_answers_rather_than_the_mounted_one(
        self, app, client, mounted
    ):
        app.config["SERVER_MODE"] = False

        assert self._read(client, mounted, name="sibling") == (
            "wormhole_b0",
            self.SIBLING_FPU_AVG,
        )
        assert self._read(client, mounted) == ("blackhole", self._mounted_fpu_avg())

    def test_server_mode_ignores_the_name(self, app, client, mounted):
        assert app.config["SERVER_MODE"] is True

        assert self._read(client, mounted, name="sibling") == (
            "blackhole",
            self._mounted_fpu_avg(),
        )


def test_an_id_that_is_not_a_number_is_a_bad_request(client, counted):
    assert _get(client, counted, "abc").status_code == HTTPStatus.BAD_REQUEST


def test_it_needs_an_instance(client):
    assert client.get(f"{ROUTE}/2").status_code == HTTPStatus.BAD_REQUEST


class TestStalls:
    """The Stalls tab's figures ride the same fetch. #2372"""

    @pytest.fixture
    def stalled(self, app, tmp_path):
        write_stall_capture(tmp_path / "stalled")
        return _mount(app, tmp_path / "stalled")

    def _stalls(self, client, instance_id, position):
        response = _get(client, instance_id, position + REPORT_ROW_ID_OFFSET)
        assert response.status_code == HTTPStatus.OK
        return response.get_json()["stalls"]

    @staticmethod
    def _one_op_without_cb_sums():
        """A sum-profiled capture's rows, the input-starved op's CB sums blank."""
        rows = stall_rows()
        rows[INPUT_STARVED_POSITION] = {
            **rows[INPUT_STARVED_POSITION],
            CB_WAIT_FRONT: "",
            CB_RESERVE_BACK: "",
        }
        return rows

    def test_each_thread_carries_its_counters_and_the_cb_waits_per_core(
        self, client, stalled
    ):
        op = STALL_OPS[INPUT_STARVED_POSITION]

        stalls = self._stalls(client, stalled, INPUT_STARVED_POSITION)
        threads = {thread["thread"]: thread for thread in stalls["threads"]}

        assert [thread["role"] for thread in stalls["threads"]] == [
            "unpack",
            "math",
            "pack",
        ]
        assert threads["t0"]["hardware_counters"]["stall_rate"]["avg"] == (
            counter_average(INPUT_STARVED_POSITION, "Thread 0 Stall Rate")
        )
        assert threads["t0"]["instrumentation"]["cb_wait_front"] == {
            "sum_us": op.cb_wait_front_ns / 1000,
            "per_core_us": op.cb_wait_front_ns / op.cores / 1000,
            "kernel_share_percent": kernel_share(
                INPUT_STARVED_POSITION, op.cb_wait_front_ns
            ),
        }
        assert stalls["core_count"] == op.cores
        assert stalls["kernel_duration_us"] == op.kernel_ns / 1000
        assert stalls["largest_wait"]["label"] == "cb_wait_front"

    def test_an_op_without_a_compute_kernel_ignores_its_copied_cb_sums(
        self, client, stalled
    ):
        stalls = self._stalls(client, stalled, STALE_CB_POSITION)

        assert stalls["has_compute_kernel"] is False
        assert stalls["cb_waits"]["state"] == "ignored"
        assert stalls["stalled_percent"] is None
        assert all(thread["instrumentation"] is None for thread in stalls["threads"])

    def test_a_counter_capture_without_sum_profiling_names_what_fills_its_cb_waits(
        self, client, counted
    ):
        """The counters fixture's compute ops carry a thread stall rate and no CB sums."""
        body = _get(client, counted, COUNTED_POSITION + REPORT_ROW_ID_OFFSET).get_json()

        assert body["stalls"]["counters"] == {"state": "filled", "fill_hint": None}
        assert body["stalls"]["cb_waits"] == {
            "state": "not_captured",
            "fill_hint": pipeline_stalls.CB_WAITS_FILL_HINT,
        }

    def test_a_compute_op_without_cb_sums_in_a_sum_profiled_capture_has_no_value(
        self, app, client, tmp_path
    ):
        """Never told to add a flag the capture already ran with."""
        write_ops_perf(tmp_path / "one-blank", self._one_op_without_cb_sums())
        instance_id = _mount(app, tmp_path / "one-blank")

        stalls = self._stalls(client, instance_id, INPUT_STARVED_POSITION)

        assert stalls["cb_waits"] == {"state": "no_value", "fill_hint": None}

    def test_the_capture_is_read_for_sum_profiling_only_when_asked_and_once(
        self, client, counted, stalled
    ):
        """Only a compute op without CB sums asks, and the answer is kept per file."""
        with patch.object(
            pipeline_stalls,
            "capture_has_cb_waits",
            wraps=pipeline_stalls.capture_has_cb_waits,
        ) as read:
            for position in (INPUT_STARVED_POSITION, STALE_CB_POSITION):
                self._stalls(client, stalled, position)
            self._stalls(client, counted, UNCOUNTED_WITHOUT_KERNEL_POSITION)
            unasked = read.call_count
            for _ in range(2):
                self._stalls(client, counted, COUNTED_POSITION)

        assert unasked == 0
        assert read.call_count == 1

    @pytest.mark.parametrize("unreadable", ["oversized-field", "invalid-utf-8"])
    @pytest.mark.parametrize(
        ("cb_wait_first", "state"),
        [(False, "not_captured"), (True, "no_value")],
        ids=["bad-row-first", "cb-wait-first"],
    )
    def test_a_row_the_scan_cannot_read_leaves_an_earlier_ops_counters_answered(
        self, app, client, tmp_path, unreadable, cb_wait_first, state
    ):
        """Asked whether the capture had sum profiling, the scan reads past the row
        asked for, which was a 200 before the stalls rode along. A row it can't read
        before any CB wait counts as none, and that answer is kept."""
        # The rows below rely on this order: the asked op, then the one whose CB wait
        # may come first, the padding, and the bad row.
        assert (
            INPUT_STARVED_POSITION
            < UNPACK_BOUND_POSITION
            < OUTPUT_BLOCKED_POSITION
            < UNNAMED_STALL_POSITION
        )
        marker = "UNREADABLE"
        no_sums = {CB_WAIT_FRONT: "", CB_RESERVE_BACK: ""}
        rows = stall_rows()
        rows[INPUT_STARVED_POSITION] = {**rows[INPUT_STARVED_POSITION], **no_sums}
        if not cb_wait_first:
            rows[UNPACK_BOUND_POSITION] = {**rows[UNPACK_BOUND_POSITION], **no_sums}
        # Text decodes in 8 KiB chunks: this keeps the bad row's bytes out of the
        # chunks that hold the rows before this one.
        rows[OUTPUT_BLOCKED_POSITION] = {
            **rows[OUTPUT_BLOCKED_POSITION],
            **no_sums,
            "ATTRIBUTES": "x" * 20_000,
        }
        rows[UNNAMED_STALL_POSITION] = {
            **rows[UNNAMED_STALL_POSITION],
            "ATTRIBUTES": (
                "x" * (csv.field_size_limit() + 1)
                if unreadable == "oversized-field"
                else marker
            ),
        }
        destination = write_ops_perf(tmp_path / "unreadable-later", rows)
        destination.write_bytes(
            destination.read_bytes().replace(marker.encode(), b"\xff\xfe")
        )
        instance_id = _mount(app, tmp_path / "unreadable-later")

        with patch.object(
            pipeline_stalls,
            "capture_has_cb_waits",
            wraps=pipeline_stalls.capture_has_cb_waits,
        ) as read:
            responses = [
                _get(client, instance_id, INPUT_STARVED_POSITION + REPORT_ROW_ID_OFFSET)
                for _ in range(2)
            ]

        assert [response.status_code for response in responses] == [HTTPStatus.OK] * 2
        body = responses[0].get_json()
        assert body["op_has_counters"] is True
        assert body["stalls"]["counters"]["state"] == "filled"
        assert body["stalls"]["cb_waits"]["state"] == state
        assert read.call_count == 1

    @pytest.mark.parametrize(
        "gone", ["removed", "removed-after-its-stat", "replaced-by-a-folder"]
    )
    def test_a_csv_gone_after_its_row_was_read_still_answers_the_row(
        self, app, client, tmp_path, gone
    ):
        """The scan for sum profiling reads the file the row came from; gone or
        unreadable, it counts as none rather than failing the request. Other ops have
        CB sums, so a scan that read the file would answer no_value."""
        destination = write_ops_perf(tmp_path / "gone", self._one_op_without_cb_sums())
        instance_id = _mount(app, tmp_path / "gone")
        read_row = hardware_counters.read_row
        source_at = FileSource.at

        def take_away():
            destination.unlink()
            if gone == "replaced-by-a-folder":
                destination.mkdir()

        def read_then_take_away(source, position):
            found = read_row(source, position)
            if gone != "removed-after-its-stat":
                take_away()
            return found

        def stat_then_take_away(path):
            found = source_at(path)
            if gone == "removed-after-its-stat":
                take_away()
            return found

        with (
            patch.object(
                hardware_counters, "read_row", side_effect=read_then_take_away
            ),
            patch.object(FileSource, "at", side_effect=stat_then_take_away) as stat,
        ):
            response = _get(
                client, instance_id, INPUT_STARVED_POSITION + REPORT_ROW_ID_OFFSET
            )

        assert response.status_code == HTTPStatus.OK
        assert response.get_json()["stalls"]["cb_waits"]["state"] == "not_captured"
        assert stat.call_count == 1
        assert csv_queries._sum_profiled.cache_info().currsize == 0

    def test_a_capture_written_after_the_row_was_read_is_not_the_one_scanned(
        self, app, client, tmp_path
    ):
        """The folder's newest CSV can change mid-request; the row's own is scanned."""
        directory = tmp_path / "superseded"
        older = write_ops_perf(directory, stall_rows(sum_profiling=False))
        newer = write_ops_perf(tmp_path / "newer", stall_rows())
        instance_id = _mount(app, directory)
        newest = [older, newer]

        with patch.object(
            csv_queries, "newest_ops_perf_file", side_effect=lambda _: newest.pop(0)
        ):
            response = _get(
                client, instance_id, INPUT_STARVED_POSITION + REPORT_ROW_ID_OFFSET
            )

        assert response.status_code == HTTPStatus.OK
        assert response.get_json()["stalls"]["cb_waits"]["state"] == "not_captured"

    def test_the_answer_has_the_keys_the_app_reads(self, client, stalled):
        """`src/model/PipelineStalls.ts` describes this answer, keys and nesting."""
        stalls = self._stalls(client, stalled, INPUT_STARVED_POSITION)

        def check(answer, interface):
            required, optional = typescript_interface_keys(_STALLS_MODEL, interface)
            assert required <= answer.keys() <= required | optional, interface

        check(stalls, "OperationStalls")
        check(stalls["counters"], "StallPart")
        check(stalls["cb_waits"], "StallPart")
        check(stalls["largest_wait"], "LargestWait")
        polls = []
        for thread in stalls["threads"]:
            check(thread, "ThreadStalls")
            counters = thread["hardware_counters"]
            check(counters, "ThreadHardwareCounters")
            for stat in ("issue_rate", "stall_rate", "stall_overlap"):
                check(counters[stat], "StallStat")
            for named in counters["waits"] + counters.get("math_pipeline_stalls", []):
                check(named, "NamedStallStat")
            polls += (thread["instrumentation"] or {}).values()
        for poll in polls:
            check(poll, "CbWait")
        assert len(polls) == 2
        assert any(
            "math_pipeline_stalls" in thread["hardware_counters"]
            for thread in stalls["threads"]
        )

    @pytest.mark.parametrize("cell", ["1e30", "0", "-8"])
    def test_a_core_count_that_is_no_count_leaves_the_shares_null(
        self, app, client, tmp_path, cell
    ):
        """A count past 64 bits once failed the whole answer, the Utilization tab's too."""
        rows = stall_rows()
        rows[INPUT_STARVED_POSITION] = {
            **rows[INPUT_STARVED_POSITION],
            CORE_COUNT: cell,
        }
        write_ops_perf(tmp_path / "bad-count", rows)
        instance_id = _mount(app, tmp_path / "bad-count")

        stalls = self._stalls(client, instance_id, INPUT_STARVED_POSITION)
        front = stalls["threads"][0]["instrumentation"]["cb_wait_front"]

        assert stalls["core_count"] is None
        assert front["per_core_us"] is None
        assert front["kernel_share_percent"] is None
