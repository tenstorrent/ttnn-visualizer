# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""The device log's first line, as `/api/performance/device-log/meta` serves it. #2193

The route and the agent's heuristic flags read the device's core count through one
reader, `DeviceLogProfilerQueries.read_device_meta`. The route's answers here are the
ones it gave before the reader was shared, so moving the parse changed nothing it serves.
"""

from http import HTTPStatus

import pytest
from ttnn_visualizer.csv_queries import (
    DeviceLogMeta,
    DeviceLogProfilerQueries,
    parse_device_meta,
)
from ttnn_visualizer.extensions import db
from ttnn_visualizer.models import Instance, InstanceTable

META_ENDPOINT = "/api/performance/device-log/meta"
_HEADER = b"PCIe slot, core_x, core_y, RISC processor type, timer_id\n"

# First lines as bytes, each with what the route answers for it.
CASES = [
    pytest.param(
        b"ARCH: blackhole, CHIP_FREQ[MHz]: 1350, Max Compute Cores: 130\n" + _HEADER,
        {"architecture": "blackhole", "frequency": 1350, "max_cores": 130},
        id="current",
    ),
    pytest.param(
        b"ARCH: wormhole_b0, CHIP_FREQ[MHz]: 1000\n" + _HEADER,
        {"architecture": "wormhole_b0", "frequency": 1000, "max_cores": None},
        id="no-core-count",
    ),
    pytest.param(
        b"\xef\xbb\xbfARCH: wormhole_b0, CHIP_FREQ[MHz]: 1000, Max Compute Cores: 64\n",
        {"architecture": "wormhole_b0", "frequency": 1000, "max_cores": 64},
        id="bom-before-arch",
    ),
    pytest.param(
        b"ARCH: wormhole_b0 Max Compute Cores: 56\n" + _HEADER,
        {"architecture": "wormhole_b0", "frequency": None, "max_cores": 56},
        id="no-comma",
    ),
    pytest.param(
        b"ARCH: blackhole, CHIP_FREQ[MHz]: 1350, Max Compute Cores: 120\n"
        b"PCIe slot, core_x \xff\n",
        {"architecture": "blackhole", "frequency": 1350, "max_cores": 120},
        id="non-utf-8-on-line-2",
    ),
    pytest.param(
        b"ARCH: black\xffhole, CHIP_FREQ[MHz]: 1350\n",
        {"architecture": "blackhole", "frequency": 1350, "max_cores": None},
        id="non-utf-8-on-line-1",
    ),
    pytest.param(
        _HEADER,
        {"architecture": None, "frequency": None, "max_cores": None},
        id="no-preamble",
    ),
    pytest.param(
        b"",
        {"architecture": None, "frequency": None, "max_cores": None},
        id="empty",
    ),
]


@pytest.fixture
def device_log(tmp_path):
    def _device_log(content: bytes):
        (tmp_path / DeviceLogProfilerQueries.DEVICE_LOG_FILE).write_bytes(content)
        return tmp_path

    return _device_log


@pytest.fixture
def mounted(app, tmp_path):
    """An instance whose performance report is `tmp_path`, for the route."""
    instance_id = "pytest-device-log-meta"
    with app.app_context():
        db.session.add(
            InstanceTable(
                instance_id=instance_id,
                active_report={},
                performance_path=str(tmp_path),
            )
        )
        db.session.commit()
    return instance_id


@pytest.mark.parametrize(("content", "expected"), CASES)
def test_the_route_serves_the_first_line_it_always_has(
    client, mounted, device_log, content, expected
):
    device_log(content)

    response = client.get(META_ENDPOINT, query_string={"instanceId": mounted})

    assert response.status_code == HTTPStatus.OK
    assert response.get_json() == expected


@pytest.mark.parametrize(("content", "expected"), CASES)
def test_the_shared_reader_reads_what_the_route_serves(device_log, content, expected):
    directory = device_log(content)

    meta = DeviceLogProfilerQueries.read_device_meta(
        Instance(instance_id="device-log-meta", performance_path=str(directory))
    )

    assert meta == DeviceLogMeta(**expected)
    assert all(
        type(value) is int for value in (meta.frequency, meta.max_cores) if value
    )


def test_a_value_is_found_anywhere_on_the_line():
    assert parse_device_meta(
        "RUN_ID: x, Max Compute Cores: 72 cores, ARCH:wormhole_b0 (n300)"
    ) == DeviceLogMeta("wormhole_b0", None, 72)


def test_the_route_still_refuses_a_report_without_a_device_log(client, mounted):
    response = client.get(META_ENDPOINT, query_string={"instanceId": mounted})

    assert response.status_code == HTTPStatus.NOT_FOUND
