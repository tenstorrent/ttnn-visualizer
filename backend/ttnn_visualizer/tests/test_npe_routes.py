# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""HTTP-contract tests for the #861 NPE windowed-loading routes.

Exercises ``GET /api/npe/summary`` and ``GET /api/npe/window`` through the Flask
``client`` fixture, locking down the status-code mapping the routes narrow to:
404 (missing file / out-of-range timestep), 422 (malformed report), and 400
(non-integer ``t``). Also checks that an uploaded report stays readable through them,
and through ``GET /api/npe``, after another report is selected or uploaded.
"""

import sqlite3
from io import BytesIO
from pathlib import Path

import orjson
import pytest
import zstd
from ttnn_visualizer.enums import ConnectionTestStates
from ttnn_visualizer.extensions import db
from ttnn_visualizer.models import InstanceTable, ReportLocation
from ttnn_visualizer.npe_index import get_index_path
from ttnn_visualizer.utils import NPE_UPLOAD_EXTENSIONS

API = "/api"


@pytest.fixture(autouse=True)
def local_mode(app):
    # The windowed routes are @local_only, and the shared test app runs in
    # SERVER_MODE. Default every case in this module to local mode so the
    # functional contract is exercised; the 403 case re-enables SERVER_MODE.
    previous = app.config["SERVER_MODE"]
    app.config["SERVER_MODE"] = False
    yield
    app.config["SERVER_MODE"] = previous


def _make_npe_object(n_transfers: int = 3, n_timesteps: int = 4) -> dict:
    transfers = [
        {"id": i, "src": [0, 0, 0], "dst": [[0, 1, 1]], "total_bytes": 128, "route": []}
        for i in range(n_transfers)
    ]
    timesteps = []
    for t in range(n_timesteps):
        active = [] if t == 0 else list(range(n_transfers))
        timesteps.append(
            {
                "start_cycle": float(t * 10),
                "end_cycle": float(t * 10 + 9),
                "active_transfers": active,
                "link_demand": [[0, 0, 0, "NOC0_EAST", 224.8]] if active else [],
                "noc": {
                    "NOC0": {"avg_link_demand": 12.3, "avg_link_util": 7.8},
                    "NOC1": {"avg_link_demand": 0.0, "avg_link_util": 0.0},
                },
                "avg_link_demand": 12.3,
                "avg_link_util": 7.8,
                "mcast_write_link_util": 1.2,
            }
        )
    return {
        "common_info": {"version": "1.0.0", "arch": "wormhole_b0"},
        "chips": {"0": {}},
        "zones": [],
        "noc_transfers": transfers,
        "timestep_data": timesteps,
    }


@pytest.fixture
def make_npe_instance(app):
    """Register an instance pointing at an on-disk NPE file (or none).

    Returns the ``instance_id`` to pass as the ``instanceId`` query param.
    """
    counter = [0]

    def _make(npe_bytes: bytes | None, suffix: str = ".json") -> str:
        counter[0] += 1
        instance_id = f"pytest-npe-{counter[0]}"
        npe_path = None
        if npe_bytes is not None:
            path = (
                Path(app.config["APP_DATA_DIRECTORY"]) / f"trace-{counter[0]}{suffix}"
            )
            path.write_bytes(npe_bytes)
            npe_path = str(path)

        with app.app_context():
            db.session.add(
                InstanceTable(
                    instance_id=instance_id,
                    active_report={},
                    npe_path=npe_path,
                )
            )
            db.session.commit()
        return instance_id

    return _make


def test_summary_happy_path(client, make_npe_instance):
    instance_id = make_npe_instance(orjson.dumps(_make_npe_object(n_timesteps=4)))
    resp = client.get(f"{API}/npe/summary", query_string={"instanceId": instance_id})

    assert resp.status_code == 200
    assert resp.headers.get("X-Content-Type-Options") == "nosniff"
    body = resp.get_json()
    assert body["n_timesteps"] == 4
    assert isinstance(body["timesteps"], dict)
    assert len(body["timesteps"]["active_count"]) == 4
    assert body["has_fabric_events"] is False


def test_summary_reports_fabric_events_for_a_fabric_trace(client, make_npe_instance):
    obj = _make_npe_object(n_timesteps=4)
    obj["noc_transfers"][-1]["fabric_event_type"] = True
    instance_id = make_npe_instance(orjson.dumps(obj))

    resp = client.get(f"{API}/npe/summary", query_string={"instanceId": instance_id})

    assert resp.status_code == 200
    assert resp.get_json()["has_fabric_events"] is True


def test_summary_rebuilds_an_index_written_before_the_fabric_flag(
    client, make_npe_instance
):
    # read_summary reads has_fabric_events strictly; that is only safe because an
    # index from INDEX_VERSION 5 is rebuilt before it is read. #2356
    obj = _make_npe_object(n_timesteps=4)
    obj["noc_transfers"][-1]["fabric_event_type"] = True
    instance_id = make_npe_instance(orjson.dumps(obj))
    query = {"instanceId": instance_id}
    assert client.get(f"{API}/npe/summary", query_string=query).status_code == 200

    with client.application.app_context():
        npe_path = InstanceTable.query.filter_by(instance_id=instance_id).one().npe_path
    conn = sqlite3.connect(get_index_path(npe_path))
    with conn:
        conn.execute("DELETE FROM meta WHERE key = 'has_fabric_events'")
        conn.execute("UPDATE meta SET value = '5' WHERE key = 'index_version'")
    conn.close()

    resp = client.get(f"{API}/npe/summary", query_string=query)

    assert resp.status_code == 200
    assert resp.get_json()["has_fabric_events"] is True


def test_window_happy_path(client, make_npe_instance):
    instance_id = make_npe_instance(orjson.dumps(_make_npe_object(n_timesteps=4)))
    resp = client.get(
        f"{API}/npe/window", query_string={"instanceId": instance_id, "t": 1}
    )

    assert resp.status_code == 200
    assert resp.headers.get("X-Content-Type-Options") == "nosniff"
    body = resp.get_json()
    assert body["t"] == 1
    assert body["timestep"]["active_transfers"] == [0, 1, 2]
    assert len(body["transfers"]) == 3


def test_summary_missing_file_is_404(client, make_npe_instance):
    instance_id = make_npe_instance(None)
    resp = client.get(f"{API}/npe/summary", query_string={"instanceId": instance_id})
    assert resp.status_code == 404


def test_window_missing_file_is_404(client, make_npe_instance):
    instance_id = make_npe_instance(None)
    resp = client.get(
        f"{API}/npe/window", query_string={"instanceId": instance_id, "t": 0}
    )
    assert resp.status_code == 404


def test_window_out_of_range_timestep_is_404(client, make_npe_instance):
    instance_id = make_npe_instance(orjson.dumps(_make_npe_object(n_timesteps=2)))
    resp = client.get(
        f"{API}/npe/window", query_string={"instanceId": instance_id, "t": 99}
    )
    assert resp.status_code == 404


def test_window_non_integer_timestep_is_400(client, make_npe_instance):
    instance_id = make_npe_instance(orjson.dumps(_make_npe_object(n_timesteps=2)))
    resp = client.get(
        f"{API}/npe/window", query_string={"instanceId": instance_id, "t": "abc"}
    )
    assert resp.status_code == 400


def test_summary_malformed_report_is_422(client, make_npe_instance):
    instance_id = make_npe_instance(b"{not valid json")
    resp = client.get(f"{API}/npe/summary", query_string={"instanceId": instance_id})
    assert resp.status_code == 422


def test_summary_corrupt_zst_is_422(client, make_npe_instance):
    # .zst is the production format; a truncated/corrupt upload raises zstd.Error,
    # which is NOT a ValueError — without the explicit arm it fell through to 500.
    instance_id = make_npe_instance(b"not-a-valid-zstd-frame", suffix=".zst")
    resp = client.get(f"{API}/npe/summary", query_string={"instanceId": instance_id})
    assert resp.status_code == 422


def test_window_corrupt_zst_is_422(client, make_npe_instance):
    instance_id = make_npe_instance(b"not-a-valid-zstd-frame", suffix=".zst")
    resp = client.get(
        f"{API}/npe/window", query_string={"instanceId": instance_id, "t": 0}
    )
    assert resp.status_code == 422


def test_summary_missing_instance_id_is_400(client):
    resp = client.get(f"{API}/npe/summary")
    assert resp.status_code == 400


def test_summary_forbidden_under_server_mode(client, make_npe_instance, app):
    # @local_only: the windowed routes must refuse SERVER_MODE (the endpoint is
    # blueprint-registered unconditionally, so the client SERVER_MODE gate can't
    # protect it on a hosted deploy — see views.py comment).
    instance_id = make_npe_instance(orjson.dumps(_make_npe_object(n_timesteps=2)))
    app.config["SERVER_MODE"] = True
    resp = client.get(f"{API}/npe/summary", query_string={"instanceId": instance_id})
    assert resp.status_code == 403


def test_window_forbidden_under_server_mode(client, make_npe_instance, app):
    # Window shares the same @local_only decorator stack and is the other half of
    # the index-build DoS/disk surface, so it must 403 under SERVER_MODE too.
    instance_id = make_npe_instance(orjson.dumps(_make_npe_object(n_timesteps=2)))
    app.config["SERVER_MODE"] = True
    resp = client.get(
        f"{API}/npe/window", query_string={"instanceId": instance_id, "t": 1}
    )
    assert resp.status_code == 403


def _upload_npe(
    client, instance_id: str, payload: bytes, file_name: str = "trace.json"
) -> None:
    response = client.post(
        f"{API}/local/upload/npe",
        query_string={"instanceId": instance_id},
        data={"files": [(BytesIO(payload), file_name)]},
        content_type="multipart/form-data",
    )
    assert response.get_json()["status"] == ConnectionTestStates.OK.value


def _stored_instance(client, instance_id: str) -> InstanceTable:
    with client.application.app_context():
        return InstanceTable.query.filter_by(instance_id=instance_id).one()


def _upload_memory_report(client, instance_id: str) -> str:
    """Upload a memory report and return the name its listing shows."""
    response = client.post(
        f"{API}/local/upload/profiler",
        query_string={"instanceId": instance_id},
        data={
            "files": [(BytesIO(b"not opened by the upload"), "memory-run/db.sqlite")]
        },
        content_type="multipart/form-data",
    )
    assert response.status_code == 200, response.get_data(as_text=True)
    # Success carries the folder's `path`; a refused upload is a 200 with a status.
    assert "path" in response.get_json(), response.get_data(as_text=True)
    return Path(_stored_instance(client, instance_id).profiler_path).parent.name


def _upload_performance_report(client, instance_id: str) -> str:
    """Upload a performance report and return the name its listing shows."""
    response = client.post(
        f"{API}/local/upload/performance",
        query_string={"instanceId": instance_id},
        data={
            "files": [
                (BytesIO(b"csv,bytes\n"), "perf-run/profile_log_device.csv"),
                (BytesIO(b"op,perf\n"), "perf-run/ops_perf_results_2026.csv"),
            ]
        },
        content_type="multipart/form-data",
    )
    assert response.get_json()["status"] == ConnectionTestStates.OK.value
    return Path(_stored_instance(client, instance_id).performance_path).name


def _put_active_report(client, instance_id: str, active_report: dict):
    return client.put(
        f"{API}/instance",
        query_string={"instanceId": instance_id},
        json={"active_report": active_report},
    )


def _select(client, instance_id: str, kind: str, name: str) -> None:
    """Select a report the way the report pickers do, naming no NPE report."""
    response = _put_active_report(
        client,
        instance_id,
        {f"{kind}_name": name, f"{kind}_location": ReportLocation.LOCAL.value},
    )
    assert response.status_code == 200, response.get_data(as_text=True)


def _select_memory_report(client, instance_id, upload_npe):
    name = _upload_memory_report(client, instance_id)
    upload_npe()
    _select(client, instance_id, "profiler", name)


def _upload_a_memory_report(client, instance_id, upload_npe):
    upload_npe()
    _upload_memory_report(client, instance_id)


def _select_performance_report(client, instance_id, upload_npe):
    name = _upload_performance_report(client, instance_id)
    upload_npe()
    _select(client, instance_id, "performance", name)


def _upload_a_performance_report(client, instance_id, upload_npe):
    upload_npe()
    _upload_performance_report(client, instance_id)


@pytest.mark.parametrize("server_mode", [False, True], ids=["local", "server-mode"])
@pytest.mark.parametrize(
    "then_change_another_report",
    [
        pytest.param(_select_memory_report, id="select-memory-report"),
        pytest.param(_upload_a_memory_report, id="upload-memory-report"),
        pytest.param(_select_performance_report, id="select-performance-report"),
        pytest.param(_upload_a_performance_report, id="upload-performance-report"),
    ],
)
def test_an_uploaded_npe_report_stays_readable_when_another_report_changes(
    app, client, server_mode, then_change_another_report
):
    """#2381: each of these updates repointed the NPE report at its upload folder."""
    app.config["SERVER_MODE"] = server_mode
    app.config["LOCAL_DATA_DIRECTORY"] = Path(app.config["LOCAL_DATA_DIRECTORY"])
    instance_id = "pytest-npe-and-another-report"
    payload = orjson.dumps(_make_npe_object(n_timesteps=3))

    then_change_another_report(
        client, instance_id, lambda: _upload_npe(client, instance_id, payload)
    )

    assert Path(_stored_instance(client, instance_id).npe_path).read_bytes() == payload
    query = {"instanceId": instance_id}
    response = client.get(f"{API}/npe", query_string=query)
    assert response.status_code == 200
    assert response.get_data() == payload
    if not server_mode:
        summary = client.get(f"{API}/npe/summary", query_string=query)
        assert summary.status_code == 200
        assert summary.get_json()["n_timesteps"] == 3
        window = client.get(f"{API}/npe/window", query_string={**query, "t": 1})
        assert window.status_code == 200


def test_an_explicit_npe_path_wins_over_the_npe_name(app, client):
    app.config["LOCAL_DATA_DIRECTORY"] = Path(app.config["LOCAL_DATA_DIRECTORY"])
    instance_id = "pytest-npe-explicit-path"
    payload = orjson.dumps(_make_npe_object(n_timesteps=2))
    _upload_npe(client, instance_id, payload)
    first = _stored_instance(client, instance_id).npe_path
    other = orjson.dumps(_make_npe_object(n_timesteps=3))
    _upload_npe(client, instance_id, other, file_name="other.json")

    response = _put_active_report(
        client, instance_id, {"npe_name": "other", "npe_path": first}
    )

    assert response.status_code == 200
    assert _stored_instance(client, instance_id).npe_path == first
    npe = client.get(f"{API}/npe", query_string={"instanceId": instance_id})
    assert npe.status_code == 200
    assert npe.get_data() == payload


@pytest.mark.parametrize(
    "file_name", ["trace.json", "trace.npeviz.zst", "trace.zst", "trace.npeviz"]
)
def test_naming_an_npe_upload_finds_the_file_it_saved(app, client, file_name):
    """The folder and name the upload writes are the ones `get_npe_path` reads."""
    app.config["LOCAL_DATA_DIRECTORY"] = Path(app.config["LOCAL_DATA_DIRECTORY"])
    instance_id = "pytest-npe-named"
    _upload_npe(client, instance_id, b"{}", file_name=file_name)
    uploaded = _stored_instance(client, instance_id)
    assert Path(uploaded.npe_path).name == file_name

    response = _put_active_report(
        client, instance_id, {"npe_name": uploaded.active_report["npe_name"]}
    )

    assert response.status_code == 200
    assert _stored_instance(client, instance_id).npe_path == uploaded.npe_path


@pytest.mark.parametrize("extension", NPE_UPLOAD_EXTENSIONS)
def test_every_accepted_npe_extension_uploads_names_and_serves(app, client, extension):
    """#2406: the upload check, `get_npe_path` and `GET /npe` each list the NPE
    formats; an extension added to the upload list alone fails here."""
    app.config["LOCAL_DATA_DIRECTORY"] = Path(app.config["LOCAL_DATA_DIRECTORY"])
    instance_id = "pytest-npe-every-extension"
    file_name = f"trace{extension}"
    payload = orjson.dumps(_make_npe_object(n_timesteps=2))
    # Its own literal, not `is_zstd_trace`: the predicate is what is under test.
    stored = zstd.compress(payload) if extension == ".zst" else payload
    _upload_npe(client, instance_id, stored, file_name=file_name)
    uploaded = _stored_instance(client, instance_id)

    response = _put_active_report(
        client, instance_id, {"npe_name": uploaded.active_report["npe_name"]}
    )

    assert response.status_code == 200
    assert _stored_instance(client, instance_id).npe_path == uploaded.npe_path
    npe = client.get(f"{API}/npe", query_string={"instanceId": instance_id})
    assert npe.status_code == 200
    assert npe.get_data() == payload


def test_an_npe_upload_named_only_by_its_extension_is_read_compressed(app, client):
    """A file named `.zst` passes the upload check but has no `Path.suffix`; it is
    still read as zstd frames."""
    app.config["LOCAL_DATA_DIRECTORY"] = Path(app.config["LOCAL_DATA_DIRECTORY"])
    instance_id = "pytest-npe-bare-zst"
    payload = orjson.dumps(_make_npe_object(n_timesteps=2))
    _upload_npe(client, instance_id, zstd.compress(payload), file_name=".zst")
    uploaded = _stored_instance(client, instance_id)

    response = _put_active_report(
        client, instance_id, {"npe_name": uploaded.active_report["npe_name"]}
    )

    assert response.status_code == 200
    npe = client.get(f"{API}/npe", query_string={"instanceId": instance_id})
    assert npe.status_code == 200
    assert npe.get_data() == payload


@pytest.mark.parametrize(
    "file_name, compressed",
    [("trace.npeviz.zst", True), (".zst", True), ("trace.json", False)],
)
def test_the_performance_npe_timeline_reads_each_trace_format(
    app, client, file_name, compressed
):
    app.config["LOCAL_DATA_DIRECTORY"] = Path(app.config["LOCAL_DATA_DIRECTORY"])
    instance_id = "pytest-npe-timeline"
    _upload_performance_report(client, instance_id)
    npe_folder = Path(_stored_instance(client, instance_id).performance_path, "npe_viz")
    npe_folder.mkdir(exist_ok=True)
    timeline = _make_npe_object(n_timesteps=2)
    payload = orjson.dumps(timeline)
    (npe_folder / file_name).write_bytes(
        zstd.compress(payload) if compressed else payload
    )

    response = client.get(
        f"{API}/performance/npe/timeline",
        query_string={"instanceId": instance_id, "filename": file_name},
    )

    assert response.status_code == 200
    assert response.get_json() == timeline


def test_a_refused_npe_upload_names_every_accepted_extension(client):
    response = client.post(
        f"{API}/local/upload/npe",
        query_string={"instanceId": "pytest-npe-refused"},
        data={"files": [(BytesIO(b"{}"), "trace.txt")]},
        content_type="multipart/form-data",
    )

    body = response.get_json()
    assert body["status"] == ConnectionTestStates.FAILED.value
    for extension in NPE_UPLOAD_EXTENSIONS:
        assert extension in body["message"]


def test_npe_reads_a_file_of_another_extension_as_json(app, client, tmp_path):
    """A local `PUT /instance` may store any path; `/npe` reads it as the index
    routes do, as JSON unless it ends in `.zst`."""
    app.config["LOCAL_DATA_DIRECTORY"] = Path(app.config["LOCAL_DATA_DIRECTORY"])
    instance_id = "pytest-npe-other-extension"
    _upload_npe(client, instance_id, b"{}")
    payload = orjson.dumps(_make_npe_object(n_timesteps=2))
    other = tmp_path / "trace.txt"
    other.write_bytes(payload)

    response = _put_active_report(client, instance_id, {"npe_path": str(other)})

    assert response.status_code == 200
    npe = client.get(f"{API}/npe", query_string={"instanceId": instance_id})
    assert npe.status_code == 200
    assert npe.get_data() == payload


@pytest.mark.parametrize("server_mode", [False, True], ids=["local", "server-mode"])
def test_an_empty_npe_name_clears_the_npe_report(app, client, server_mode):
    app.config["SERVER_MODE"] = server_mode
    app.config["LOCAL_DATA_DIRECTORY"] = Path(app.config["LOCAL_DATA_DIRECTORY"])
    instance_id = "pytest-npe-cleared"
    _upload_npe(client, instance_id, orjson.dumps(_make_npe_object(n_timesteps=2)))

    response = _put_active_report(client, instance_id, {"npe_name": ""})

    assert response.status_code == 200
    instance = _stored_instance(client, instance_id)
    assert instance.npe_path is None
    assert "npe_name" not in instance.active_report
    npe = client.get(f"{API}/npe", query_string={"instanceId": instance_id})
    assert npe.status_code == 404
