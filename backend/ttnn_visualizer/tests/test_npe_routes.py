# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""HTTP-contract tests for the #861 NPE windowed-loading routes.

Exercises ``GET /api/npe/summary`` and ``GET /api/npe/window`` through the Flask
``client`` fixture, locking down the status-code mapping the routes narrow to:
404 (missing file / out-of-range timestep), 422 (malformed report), and 400
(non-integer ``t``).
"""

from pathlib import Path

import orjson
import pytest
from ttnn_visualizer.extensions import db
from ttnn_visualizer.models import InstanceTable

API = "/api"


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


def test_summary_missing_instance_id_is_400(client):
    resp = client.get(f"{API}/npe/summary")
    assert resp.status_code == 400
