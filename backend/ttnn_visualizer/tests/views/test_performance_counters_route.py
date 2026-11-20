# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""`GET /api/performance/counters/<perf_id>`: one row's every counter label. #2371"""

import csv
from http import HTTPStatus
from pathlib import Path

import pytest
from ttnn_visualizer.csv_queries import (
    REPORT_ROW_ID_OFFSET,
    OpsPerformanceReportQueries,
)
from ttnn_visualizer.extensions import db
from ttnn_visualizer.models import Instance, InstanceTable
from ttnn_visualizer.tests.hardware_counter_capture import (
    PERCENT_LABELS,
    UNKNOWN_LABEL,
    WORMHOLE_PREAMBLE,
    counter_rows,
    is_counted,
    label_values,
    write_counter_capture,
)
from ttnn_visualizer.tests.smoke_capture import smoke_rows, write_ops_perf

ROUTE = "/api/performance/counters"
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
    assert _get(client, counted, perf_id).status_code == HTTPStatus.NOT_FOUND


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


def test_an_id_that_is_not_a_number_is_a_bad_request(client, counted):
    assert _get(client, counted, "abc").status_code == HTTPStatus.BAD_REQUEST


def test_it_needs_an_instance(client):
    assert client.get(f"{ROUTE}/2").status_code == HTTPStatus.BAD_REQUEST
