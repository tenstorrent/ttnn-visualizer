# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""A hosted session can only reach the reports it uploaded, plus the demos.

Under `SERVER_MODE` every visitor shares one upload directory, and an instance's report
paths are recomputed from its stored report names on every update. So a stored name
that differs from the folder actually created, or a name a caller picks through
`PUT /instance`, points the instance at whichever folder carries it, and the read
endpoints then serve that folder to the caller.
"""

import json
from http import HTTPStatus
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace

import pytest
from ttnn_visualizer import file_uploads
from ttnn_visualizer.enums import ConnectionTestStates
from ttnn_visualizer.extensions import db
from ttnn_visualizer.models import InstanceTable

_SECRET = ["another session's operation history"]


@pytest.fixture
def hosted_app(app):
    app.config["SERVER_MODE"] = True
    app.config["LOCAL_DATA_DIRECTORY"] = Path(app.config["LOCAL_DATA_DIRECTORY"])
    return app


def _profiler_root(app) -> Path:
    return app.config["LOCAL_DATA_DIRECTORY"] / app.config["PROFILER_DIRECTORY_NAME"]


def _upload_profiler(client, instance_id, parts, folder_name=None):
    data = {"files": [(BytesIO(body), name) for name, body in parts]}
    if folder_name is not None:
        data["folderName"] = folder_name
    return client.post(
        "/api/local/upload/profiler",
        query_string={"instanceId": instance_id},
        data=data,
        content_type="multipart/form-data",
    )


def _upload_performance(client, instance_id, folder):
    return client.post(
        "/api/local/upload/performance",
        query_string={"instanceId": instance_id},
        data={
            "files": [
                (BytesIO(b"csv,bytes\n"), f"{folder}/profile_log_device.csv"),
                (BytesIO(b"op,perf\n"), f"{folder}/ops_perf_results_2026.csv"),
            ]
        },
        content_type="multipart/form-data",
    )


def _upload_victim_report(app) -> str:
    """Upload a report from a separate session and return the folder it landed in."""
    victim = app.test_client()
    response = _upload_profiler(
        victim,
        "victim-instance",
        [
            ("victim/db.sqlite", b"sqlite"),
            ("victim/operation_history.json", json.dumps(_SECRET).encode()),
        ],
    )
    assert response.status_code == HTTPStatus.OK, response.get_data(as_text=True)
    return response.get_json()["path"]


def _stored_instance(app, instance_id) -> InstanceTable:
    with app.app_context():
        return InstanceTable.query.filter_by(instance_id=instance_id).first()


def _put_instance(client, caller_instance_id, active_report, **extra):
    return client.put(
        "/api/instance",
        query_string={"instanceId": caller_instance_id},
        json={"active_report": active_report, **extra},
    )


# ---- Uploads store the folder they created --------------------------------


def test_hosted_profiler_upload_stores_the_created_folder_name(hosted_app):
    client = hosted_app.test_client()

    response = _upload_profiler(client, "mine", [("report/db.sqlite", b"sqlite")])

    assert response.status_code == HTTPStatus.OK, response.get_data(as_text=True)
    folder = response.get_json()["path"]
    assert folder != "report" and folder.endswith("_report")
    stored = _stored_instance(hosted_app, "mine")
    assert stored.active_report["profiler_name"] == folder
    assert Path(stored.profiler_path) == _profiler_root(hosted_app) / folder / (
        "db.sqlite"
    )


def test_hosted_performance_upload_stores_the_created_folder_name(hosted_app):
    client = hosted_app.test_client()

    response = _upload_performance(client, "mine", "perf_run")

    assert response.get_json()["status"] == ConnectionTestStates.OK.value
    stored = _stored_instance(hosted_app, "mine")
    assert (
        stored.active_report["performance_name"] == Path(stored.performance_path).name
    )
    assert stored.active_report["performance_name"].endswith("_perf_run")


def test_a_later_upload_does_not_repoint_the_memory_report_at_another_session(
    hosted_app,
):
    """Upload under another session's folder name, then any upload that rebuilds paths.

    Before the fix the stored name was the client's, so the performance upload's
    instance update rebuilt `profiler_path` as `<profiler dir>/<victim folder>`.
    """
    victim_folder = _upload_victim_report(hosted_app)
    attacker = hosted_app.test_client()
    _upload_profiler(
        attacker, "attacker", [("db.sqlite", b"sqlite")], folder_name=victim_folder
    )
    profiler_path_before = _stored_instance(hosted_app, "attacker").profiler_path

    _upload_performance(attacker, "attacker", "perf_run")

    assert _stored_instance(hosted_app, "attacker").profiler_path == (
        profiler_path_before
    )
    response = attacker.get(
        "/api/operation-history", query_string={"instanceId": "attacker"}
    )
    assert response.get_json() != _SECRET


def test_hosted_profiler_upload_refuses_a_database_below_the_report_folder(
    hosted_app,
):
    """A nested `db.sqlite` would make its client-named sub-folder the listed report."""
    victim_folder = _upload_victim_report(hosted_app)
    attacker = hosted_app.test_client()

    response = _upload_profiler(
        attacker,
        "attacker",
        [(f"{victim_folder}/db.sqlite", b"sqlite")],
        folder_name="mine",
    )

    assert response.status_code == HTTPStatus.UNPROCESSABLE_ENTITY
    listing = attacker.get("/api/profiler", query_string={"instanceId": "attacker"})
    assert victim_folder not in [folder["path"] for folder in listing.get_json()]


@pytest.mark.parametrize("malware_scanner", [None, "true"])
def test_hosted_upload_keeps_every_part_in_one_folder_as_the_clock_ticks(
    hosted_app, monkeypatch, malware_scanner
):
    """Each part used to take its own timestamp, so a second boundary split the report.

    With the scanner on, parts are scanned one by one, which makes crossing a boundary
    likely; `db.sqlite` then landed outside the first part's folder and the upload 422d.
    """
    hosted_app.config["MALWARE_SCANNER"] = malware_scanner
    ticks = iter(range(1_700_000_000, 1_700_001_000))
    monkeypatch.setattr(file_uploads, "time", SimpleNamespace(time=lambda: next(ticks)))
    client = hosted_app.test_client()

    response = _upload_profiler(
        client,
        "mine",
        [
            ("report/operation_history.json", b"[]"),
            ("report/db.sqlite", b"sqlite"),
        ],
    )

    assert response.status_code == HTTPStatus.OK, response.get_data(as_text=True)
    folder = response.get_json()["path"]
    assert sorted(
        path.name for path in (_profiler_root(hosted_app) / folder).iterdir()
    ) == [
        "db.sqlite",
        "operation_history.json",
    ]


# ---- PUT /instance is confined to the session's own reports ----------------


def test_hosted_instance_update_selects_an_own_report(hosted_app):
    client = hosted_app.test_client()
    folder = _upload_profiler(
        client, "mine", [("report/db.sqlite", b"sqlite")]
    ).get_json()["path"]
    _put_instance(client, "mine", {"profiler_name": ""})

    response = _put_instance(
        client, "mine", {"profiler_name": folder, "profiler_location": "local"}
    )

    assert response.status_code == HTTPStatus.OK, response.get_data(as_text=True)
    assert Path(_stored_instance(hosted_app, "mine").profiler_path) == (
        _profiler_root(hosted_app) / folder / "db.sqlite"
    )


def test_hosted_instance_update_clears_a_report(hosted_app):
    client = hosted_app.test_client()
    _upload_profiler(client, "mine", [("report/db.sqlite", b"sqlite")])

    response = _put_instance(client, "mine", {"profiler_name": ""})

    assert response.status_code == HTTPStatus.OK
    assert not _stored_instance(hosted_app, "mine").profiler_path


def test_hosted_instance_update_refuses_another_sessions_report(hosted_app):
    victim_folder = _upload_victim_report(hosted_app)
    attacker = hosted_app.test_client()

    response = _put_instance(
        attacker,
        "attacker",
        {"profiler_name": victim_folder, "profiler_location": "local"},
    )

    assert response.status_code == HTTPStatus.FORBIDDEN
    history = attacker.get(
        "/api/operation-history", query_string={"instanceId": "attacker"}
    )
    assert history.get_json() != _SECRET


@pytest.mark.parametrize(
    "active_report",
    [
        {"profiler_name": "x", "profiler_location": "local", "profiler_path": "/etc"},
        {"performance_path": "/etc"},
        {"npe_path": "/etc/passwd"},
        {"mlir_path": "/etc/passwd"},
        {"npe_name": "anything"},
        {"mlir_name": "anything"},
        {"profiler_name": "../..", "profiler_location": "local"},
    ],
)
def test_hosted_instance_update_refuses_paths_and_unlisted_names(
    hosted_app, active_report
):
    client = hosted_app.test_client()

    response = _put_instance(client, "mine", active_report)

    assert response.status_code == HTTPStatus.FORBIDDEN
    stored = _stored_instance(hosted_app, "mine")
    assert not (stored and stored.profiler_path)


def test_hosted_instance_update_refuses_a_remote_location(hosted_app):
    client = hosted_app.test_client()
    folder = _upload_profiler(
        client, "mine", [("report/db.sqlite", b"sqlite")]
    ).get_json()["path"]

    response = _put_instance(
        client, "mine", {"profiler_name": folder, "profiler_location": "remote"}
    )

    assert response.status_code == HTTPStatus.FORBIDDEN


def test_hosted_instance_update_refuses_another_instance(hosted_app):
    victim_folder = _upload_victim_report(hosted_app)
    attacker = hosted_app.test_client()

    response = _put_instance(
        attacker, "attacker", {"profiler_name": ""}, instance_id="victim-instance"
    )

    assert response.status_code == HTTPStatus.FORBIDDEN
    assert _stored_instance(hosted_app, "victim-instance").active_report[
        "profiler_name"
    ] == (victim_folder)


def test_local_instance_update_still_accepts_an_explicit_path(app, tmp_path):
    """The restriction is hosted-only: local API consumers may pin a path."""
    app.config["SERVER_MODE"] = False
    db_path = tmp_path / "report" / "db.sqlite"
    client = app.test_client()

    response = _put_instance(
        client,
        "mine",
        {
            "profiler_name": "report",
            "profiler_location": "local",
            "profiler_path": str(db_path),
        },
    )

    assert response.status_code == HTTPStatus.OK
    assert _stored_instance(app, "mine").profiler_path == str(db_path)


def test_hosted_instance_update_keeps_the_path_of_a_report_it_leaves_out(hosted_app):
    """A row saved before uploads stored the created folder holds the client's name.

    That name is never checked, so an update that leaves the memory report out must not
    rebuild its path from it: here the stored name is another session's folder.
    """
    victim_folder = _upload_victim_report(hosted_app)
    client = hosted_app.test_client()
    _upload_profiler(client, "mine", [("report/db.sqlite", b"sqlite")])
    with hosted_app.app_context():
        row = InstanceTable.query.filter_by(instance_id="mine").first()
        row.active_report = {**row.active_report, "profiler_name": victim_folder}
        db.session.commit()
    profiler_path_before = _stored_instance(hosted_app, "mine").profiler_path

    response = _put_instance(client, "mine", {"performance_name": ""})

    assert response.status_code == HTTPStatus.OK, response.get_data(as_text=True)
    assert _stored_instance(hosted_app, "mine").profiler_path == profiler_path_before
    history = client.get("/api/operation-history", query_string={"instanceId": "mine"})
    assert history.get_json() != _SECRET
