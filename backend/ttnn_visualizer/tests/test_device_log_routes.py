# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""The device-log routes, over HTTP.

`test_device_log_columns.py` drives `DeviceLogProfilerQueries` directly, which
leaves three things it cannot see: the `DataFormatError` -> 422 translation, the
row cap the handlers pass, and `orjson.dumps` over whatever dtypes pandas infers
for a 15-column capture. Deleting `limit=DEVICE_LOG_ROW_LIMIT` from either
handler used to leave the whole suite green. See #1941.

The list route carries two bounds -- `max_rows` on the parse and `limit` on the
response -- and asserting the response length pins neither, because either one
alone satisfies it. They are pinned separately below: `max_rows` by watching the
read, `limit` by removing the parse bound first. See #1946.
"""

from pathlib import Path

import pandas as pd
import pytest
from ttnn_visualizer import csv_queries
from ttnn_visualizer.csv_queries import DeviceLogProfilerQueries
from ttnn_visualizer.extensions import db
from ttnn_visualizer.models import InstanceTable
from ttnn_visualizer.tests.test_device_log_columns import (
    LEGACY_HEADER,
    MODERN_HEADER,
    MODERN_ROWS,
    write_device_log,
)
from ttnn_visualizer.views import DEVICE_LOG_ROW_LIMIT

LIST_ROUTE = "/api/performance/device-log"
ZONE_ROUTE = "/api/performance/device-log/zone"

# `BRISC-FW` overruns the cap so its answer is truncated; `TRISC-FW` stays under
# it so its answer is not. Every `TRISC-FW` row sits past the first
# `DEVICE_LOG_ROW_LIMIT` rows of the file, so a zone handler that stopped the
# parse at the cap would find none of them.
BRISC_ROW_COUNT = DEVICE_LOG_ROW_LIMIT + 50
TRISC_ROW_COUNT = DEVICE_LOG_ROW_LIMIT - 40


def _mount(app, directory: Path, header: str, rows: list[str]) -> str:
    """Write a device log and bind an instance to its directory."""
    write_device_log(directory, header, rows)

    instance_id = f"pytest-device-log-{directory.name}"
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


@pytest.fixture
def modern_instance(app, tmp_path):
    """A 15-column capture with more rows than either route will return."""
    brisc = [row for row in MODERN_ROWS if "BRISC-FW" in row]
    trisc = [row for row in MODERN_ROWS if "TRISC-FW" in row]

    rows = [brisc[index % len(brisc)] for index in range(BRISC_ROW_COUNT)]
    rows += [trisc[index % len(trisc)] for index in range(TRISC_ROW_COUNT)]

    return _mount(app, tmp_path, MODERN_HEADER, rows)


def test_list_route_serves_named_columns(client, modern_instance):
    """The reported regression, at the layer the user actually hit."""
    response = client.get(LIST_ROUTE, query_string={"instanceId": modern_instance})

    assert response.status_code == 200, response.get_data(as_text=True)

    first = response.get_json()[0]
    assert first["zone_name"] == "BRISC-FW"
    assert first["type"] == "ZONE_START"
    # The 15-column capture's additions, through `orjson` rather than pandas.
    assert "trace_id" in first and "trace_id_counter" in first
    assert "stat_value" not in first


def test_list_route_caps_its_rows(client, modern_instance):
    """A capture is ~724k rows; the handler must not serve all of them."""
    response = client.get(LIST_ROUTE, query_string={"instanceId": modern_instance})

    assert len(response.get_json()) == DEVICE_LOG_ROW_LIMIT


def test_list_route_bounds_the_parse_not_only_the_response(
    client, modern_instance, monkeypatch
):
    """`max_rows` is the memory half of the cap, and the body never shows it.

    A real capture is ~724k rows / ~288 MB parsed, so a handler that dropped
    `max_rows` would answer identically while restoring the original memory
    profile. Only the read itself distinguishes them.
    """
    reads: list[dict] = []
    read_csv = pd.read_csv

    def recording_read_csv(*args, **kwargs):
        reads.append(kwargs)
        return read_csv(*args, **kwargs)

    monkeypatch.setattr(csv_queries.pd, "read_csv", recording_read_csv)

    response = client.get(LIST_ROUTE, query_string={"instanceId": modern_instance})

    assert response.status_code == 200, response.get_data(as_text=True)
    assert reads, "the route never read the capture"
    assert all(call.get("nrows") == DEVICE_LOG_ROW_LIMIT for call in reads), reads


def test_list_route_caps_the_response_independently_of_the_parse(
    client, modern_instance, monkeypatch
):
    """With the parse bound removed, `limit` alone still has to cap the body.

    The two bounds mask each other: with `max_rows` in place, dropping `limit`
    changes nothing observable. This takes `max_rows` out of the picture so the
    response cap is pinned on its own.
    """
    read_csv = pd.read_csv

    def ignoring_nrows(*args, **kwargs):
        kwargs.pop("nrows", None)
        return read_csv(*args, **kwargs)

    monkeypatch.setattr(csv_queries.pd, "read_csv", ignoring_nrows)

    response = client.get(LIST_ROUTE, query_string={"instanceId": modern_instance})

    # The capture holds more rows than the cap, so an uncapped body is longer.
    assert BRISC_ROW_COUNT + TRISC_ROW_COUNT > DEVICE_LOG_ROW_LIMIT
    assert len(response.get_json()) == DEVICE_LOG_ROW_LIMIT


def test_zone_route_caps_and_says_so(client, modern_instance):
    """A capped answer has to be distinguishable from a complete one.

    Every row in this capture is `BRISC-FW` or `TRISC-FW`, and there are more
    `BRISC-FW` than the cap, so the response is necessarily truncated.
    """
    response = client.get(
        f"{ZONE_ROUTE}/BRISC-FW", query_string={"instanceId": modern_instance}
    )

    assert response.status_code == 200, response.get_data(as_text=True)

    payload = response.get_json()
    assert payload["zone"] == "BRISC-FW"
    assert payload["truncated"] is True
    assert len(payload["rows"]) == DEVICE_LOG_ROW_LIMIT
    assert {row["zone_name"] for row in payload["rows"]} == {"BRISC-FW"}


def test_zone_route_reports_a_complete_answer_as_complete(client, modern_instance):
    """`truncated` must not be true for every response, or it says nothing."""
    response = client.get(
        f"{ZONE_ROUTE}/TRISC-FW", query_string={"instanceId": modern_instance}
    )

    payload = response.get_json()
    assert payload["truncated"] is False
    assert len(payload["rows"]) == TRISC_ROW_COUNT


def test_zone_route_scans_past_the_list_cap(client, modern_instance):
    """The filter must see the whole file, not the first `DEVICE_LOG_ROW_LIMIT` rows.

    Every `TRISC-FW` row sits past the cap, so a handler that reused the list
    route's `max_rows` would return an empty list here rather than a short one.
    """
    response = client.get(
        f"{ZONE_ROUTE}/TRISC-FW", query_string={"instanceId": modern_instance}
    )

    assert len(response.get_json()["rows"]) == TRISC_ROW_COUNT


def test_zone_route_never_holds_the_whole_capture(client, modern_instance, monkeypatch):
    """#1946: the zone filter walks the capture, it does not hold it.

    Dropping `stream=True` changes no response, so the read itself is the only
    thing that can pin it: a real capture is ~288 MB parsed and this route is
    not `@local_only`. Every read it makes must be either the header alone or a
    bounded chunk.
    """
    reads: list[dict] = []
    read_csv = pd.read_csv

    def recording_read_csv(*args, **kwargs):
        reads.append(kwargs)
        return read_csv(*args, **kwargs)

    monkeypatch.setattr(csv_queries.pd, "read_csv", recording_read_csv)

    response = client.get(
        f"{ZONE_ROUTE}/BRISC-FW", query_string={"instanceId": modern_instance}
    )

    assert response.status_code == 200, response.get_data(as_text=True)
    assert reads, "the route never read the capture"
    for call in reads:
        assert call.get("nrows") == 0 or call.get(
            "chunksize"
        ), f"unbounded read of the whole capture: {call}"


@pytest.mark.parametrize("route", [LIST_ROUTE, f"{ZONE_ROUTE}/BRISC-FW"])
def test_a_short_header_is_refused_with_422(client, app, tmp_path, route):
    """A capture missing a load-bearing column must not be answered with 200."""
    header = LEGACY_HEADER.replace(" zone name,", "")
    rows = ["1,1,1,BRISC,18952,14595968859092,0,1025,ZONE_START,433,brisc.cc,"]
    instance_id = _mount(app, tmp_path, header, rows)

    response = client.get(route, query_string={"instanceId": instance_id})

    assert response.status_code == 422
    assert "zone name" in response.get_json()["error"]


@pytest.mark.parametrize("route", [LIST_ROUTE, f"{ZONE_ROUTE}/BRISC-FW"])
def test_an_unparseable_capture_is_refused_with_422(client, app, tmp_path, route):
    """A truncated capture is bad data, not a 500 with a traceback.

    Both routes are reachable by anyone under SERVER_MODE, so letting pandas'
    `EmptyDataError` reach the catch-all hands the caller a log-filling
    primitive and tells them nothing. See #1946.
    """
    path = tmp_path / DeviceLogProfilerQueries.DEVICE_LOG_FILE
    path.write_text("ARCH: wormhole_b0\n", encoding="utf-8")

    instance_id = f"pytest-device-log-{tmp_path.name}"
    with app.app_context():
        db.session.add(
            InstanceTable(
                instance_id=instance_id,
                active_report={},
                performance_path=str(tmp_path),
            )
        )
        db.session.commit()

    response = client.get(route, query_string={"instanceId": instance_id})

    assert response.status_code == 422
    assert "could not be parsed" in response.get_json()["error"]
