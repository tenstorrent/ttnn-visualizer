# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""A hosted session can only reach the reports it uploaded, plus the demos.

Under `SERVER_MODE` every visitor shares one upload directory, and a report an update
names gets its path computed from that name. So a stored name that differs from the
folder actually created, or a name a caller picks through `PUT /instance`, would point
the instance at whichever folder carries it, and the read endpoints would then serve
that folder to the caller. Reports an update or upload leaves out keep their paths.
"""

import json
from http import HTTPStatus
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace

import pytest
from ttnn_visualizer import file_uploads
from ttnn_visualizer.app import create_app
from ttnn_visualizer.enums import ConnectionTestStates
from ttnn_visualizer.extensions import db
from ttnn_visualizer.models import InstanceTable
from ttnn_visualizer.tests.fixture_settings import base_test_settings

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
    assert "db.sqlite must be at the top of its folder" in response.get_json()["error"]
    listing = attacker.get("/api/profiler", query_string={"instanceId": "attacker"})
    assert victim_folder not in [folder["path"] for folder in listing.get_json()]
    # The refused upload's folder is gone, not left behind empty.
    assert not list(_profiler_root(hosted_app).glob("*_mine"))


def test_local_refused_reupload_keeps_the_existing_reports_files(app):
    """A local re-upload writes into the existing folder; a refusal removes only its own parts."""
    app.config["SERVER_MODE"] = False
    app.config["LOCAL_DATA_DIRECTORY"] = Path(app.config["LOCAL_DATA_DIRECTORY"])
    report = _profiler_root(app) / "report"
    report.mkdir(parents=True)
    (report / "db.sqlite").write_bytes(b"existing")
    (report / "config.json").write_bytes(b"{}")
    client = app.test_client()

    response = _upload_profiler(
        client, "mine", [("nested/db.sqlite", b"sqlite")], folder_name="report"
    )

    assert response.status_code == HTTPStatus.UNPROCESSABLE_ENTITY
    assert (report / "db.sqlite").read_bytes() == b"existing"
    assert (report / "config.json").exists()
    assert not (report / "nested").exists()


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


def test_hosted_instance_update_refuses_another_sessions_performance_report(
    hosted_app,
):
    victim = hosted_app.test_client()
    _upload_performance(victim, "victim-instance", "perf_run")
    victim_folder = _stored_instance(hosted_app, "victim-instance").active_report[
        "performance_name"
    ]
    attacker = hosted_app.test_client()

    response = _put_instance(
        attacker,
        "attacker",
        {"performance_name": victim_folder, "performance_location": "local"},
    )

    assert response.status_code == HTTPStatus.FORBIDDEN
    assert not _stored_instance(hosted_app, "attacker").performance_path


def test_hosted_instance_update_refuses_a_name_that_extends_an_own_one(
    hosted_app, monkeypatch
):
    """Selection is exact membership: an own `<ts>_rep` grants nothing on `<ts>_report`."""
    monkeypatch.setattr(
        file_uploads, "time", SimpleNamespace(time=lambda: 1_700_000_000)
    )
    victim_folder = _upload_victim_report(hosted_app)
    attacker = hosted_app.test_client()
    own_folder = _upload_profiler(
        attacker, "attacker", [("vic/db.sqlite", b"sqlite")]
    ).get_json()["path"]
    assert victim_folder.startswith(own_folder)

    response = _put_instance(
        attacker,
        "attacker",
        {"profiler_name": victim_folder, "profiler_location": "local"},
    )

    assert response.status_code == HTTPStatus.FORBIDDEN


def test_hosted_instance_update_selects_a_demo(hosted_app):
    demo = "WH_DEMO_n300-llama"
    (_profiler_root(hosted_app) / demo).mkdir(parents=True)
    client = hosted_app.test_client()

    response = _put_instance(
        client, "mine", {"profiler_name": demo, "profiler_location": "local"}
    )

    assert response.status_code == HTTPStatus.OK, response.get_data(as_text=True)


def _upload_own_profiler(client):
    return _upload_profiler(
        client, "mine", [("report/db.sqlite", b"sqlite")]
    ).get_json()["path"]


def _upload_own_performance(client):
    response = _upload_performance(client, "mine", "perf_run")
    assert response.status_code == HTTPStatus.OK, response.get_data(as_text=True)
    # Its response carries no folder name; the instance stores the created one.
    with client.application.app_context():
        stored = InstanceTable.query.filter_by(instance_id="mine").first()
        return stored.active_report["performance_name"]


_OWN_REPORT_KINDS = pytest.mark.parametrize(
    "upload, kind",
    [(_upload_own_profiler, "profiler"), (_upload_own_performance, "performance")],
    ids=["memory", "performance"],
)


@_OWN_REPORT_KINDS
def test_hosted_listing_shows_an_own_report(hosted_app, upload, kind):
    client = hosted_app.test_client()
    folder = upload(client)

    listing = client.get(f"/api/{kind}", query_string={"instanceId": "mine"})

    assert listing.status_code == HTTPStatus.OK, listing.get_data(as_text=True)
    assert folder in [report["path"] for report in listing.get_json()]


@_OWN_REPORT_KINDS
def test_hosted_instance_update_selects_an_own_report_of_each_kind(
    hosted_app, upload, kind
):
    client = hosted_app.test_client()
    folder = upload(client)
    _put_instance(client, "mine", {f"{kind}_name": ""})

    response = _put_instance(
        client, "mine", {f"{kind}_name": folder, f"{kind}_location": "local"}
    )

    assert response.status_code == HTTPStatus.OK, response.get_data(as_text=True)
    assert _stored_instance(hosted_app, "mine").active_report[f"{kind}_name"] == folder


@_OWN_REPORT_KINDS
def test_hosted_instance_update_reselects_its_report_once_the_upload_entry_is_gone(
    hosted_app, upload, kind
):
    """The instance's current report stays selectable after the session's FIFO drops it."""
    client = hosted_app.test_client()
    folder = upload(client)
    with client.session_transaction() as flask_session:
        flask_session[f"{kind}_paths"] = []

    response = _put_instance(
        client, "mine", {f"{kind}_name": folder, f"{kind}_location": "local"}
    )

    assert response.status_code == HTTPStatus.OK, response.get_data(as_text=True)


@pytest.mark.parametrize(
    "name_key", ["profiler_name", "performance_name", "npe_name", "mlir_name"]
)
@pytest.mark.parametrize("name", [0, False, [], {}, 7])
def test_hosted_instance_update_refuses_a_name_that_is_not_a_string(
    hosted_app, name_key, name
):
    client = hosted_app.test_client()

    response = _put_instance(client, "mine", {name_key: name})

    assert response.status_code == HTTPStatus.FORBIDDEN
    assert client.get(
        "/api/instance", query_string={"instanceId": "mine"}
    ).status_code == (HTTPStatus.OK)


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


# ---- An instance is reachable only from the session that created it ---------


def test_hosted_instance_refuses_another_session_naming_it_in_the_query(hosted_app):
    """Naming another session's instance used to enrol it, and its reports with it."""
    victim_folder = _upload_victim_report(hosted_app)
    attacker = hosted_app.test_client()

    update = _put_instance(attacker, "victim-instance", {"performance_name": ""})
    history = attacker.get(
        "/api/operation-history", query_string={"instanceId": "victim-instance"}
    )
    listing = attacker.get("/api/profiler", query_string={"instanceId": "attacker"})

    assert update.status_code == HTTPStatus.FORBIDDEN
    assert update.get_json()["reason"] == "instance_not_owned"
    assert history.status_code == HTTPStatus.FORBIDDEN
    assert victim_folder not in [folder["path"] for folder in listing.get_json()]
    assert _stored_instance(hosted_app, "victim-instance").active_report[
        "profiler_name"
    ] == (victim_folder)


@pytest.mark.parametrize(
    "upload",
    [
        lambda client, instance_id: _upload_profiler(
            client, instance_id, [("mine/db.sqlite", b"sqlite")]
        ),
        lambda client, instance_id: _upload_performance(client, instance_id, "mine"),
        lambda client, instance_id: client.post(
            "/api/local/upload/npe",
            query_string={"instanceId": instance_id},
            data={"files": [(BytesIO(b"{}"), "trace.json")]},
            content_type="multipart/form-data",
        ),
    ],
    ids=["profiler", "performance", "npe"],
)
def test_hosted_upload_refuses_another_sessions_instance(hosted_app, upload):
    victim_folder = _upload_victim_report(hosted_app)
    attacker = hosted_app.test_client()

    response = upload(attacker, "victim-instance")

    assert response.status_code == HTTPStatus.FORBIDDEN
    assert _stored_instance(hosted_app, "victim-instance").active_report[
        "profiler_name"
    ] == (victim_folder)


def test_hosted_session_keeps_using_its_own_instance(hosted_app):
    client = hosted_app.test_client()
    folder = _upload_profiler(
        client, "mine", [("report/db.sqlite", b"sqlite")]
    ).get_json()["path"]

    response = client.get("/api/instance", query_string={"instanceId": "mine"})

    assert response.status_code == HTTPStatus.OK
    assert response.get_json()["active_report"]["profiler_name"] == folder


def test_hosted_instance_saved_before_owners_goes_to_the_first_session_using_it(
    hosted_app,
):
    with hosted_app.app_context():
        db.session.add(InstanceTable(instance_id="legacy", active_report={}))
        db.session.commit()
    first = hosted_app.test_client()

    claimed = first.get("/api/instance", query_string={"instanceId": "legacy"})
    again = first.get("/api/instance", query_string={"instanceId": "legacy"})
    stranger = hosted_app.test_client().get(
        "/api/instance", query_string={"instanceId": "legacy"}
    )

    assert claimed.status_code == HTTPStatus.OK
    assert again.status_code == HTTPStatus.OK
    assert stranger.status_code == HTTPStatus.FORBIDDEN


def test_local_instances_are_shared_across_clients(app):
    """Locally there is one user, so a second client reaches the same instance."""
    app.config["SERVER_MODE"] = False
    app.test_client().get("/api/instance", query_string={"instanceId": "mine"})

    response = app.test_client().get(
        "/api/instance", query_string={"instanceId": "mine"}
    )

    assert response.status_code == HTTPStatus.OK


def test_hosted_upload_keeps_the_path_of_a_report_it_leaves_out(hosted_app):
    """Uploads rebuilt every other report's path from its stored name, as updates did."""
    victim_folder = _upload_victim_report(hosted_app)
    client = hosted_app.test_client()
    _upload_profiler(client, "mine", [("report/db.sqlite", b"sqlite")])
    with hosted_app.app_context():
        row = InstanceTable.query.filter_by(instance_id="mine").first()
        row.active_report = {**row.active_report, "profiler_name": victim_folder}
        db.session.commit()
    profiler_path_before = _stored_instance(hosted_app, "mine").profiler_path

    response = _upload_performance(client, "mine", "perf_run")

    assert response.get_json()["status"] == ConnectionTestStates.OK.value
    assert _stored_instance(hosted_app, "mine").profiler_path == profiler_path_before
    history = client.get("/api/operation-history", query_string={"instanceId": "mine"})
    assert history.get_json() != _SECRET


# ---- Session entries from before the checks are ignored ---------------------


def test_hosted_listing_ignores_an_enrolled_instance_another_session_owns(hosted_app):
    """Naming an instance used to enrol it in the session; the cookie keeps that entry."""
    victim_folder = _upload_victim_report(hosted_app)
    attacker = hosted_app.test_client()
    attacker.get("/api/instance", query_string={"instanceId": "attacker"})
    with attacker.session_transaction() as flask_session:
        flask_session["instances"] = ["victim-instance", "attacker"]

    listing = attacker.get("/api/profiler", query_string={"instanceId": "attacker"})
    update = _put_instance(
        attacker,
        "attacker",
        {"profiler_name": victim_folder, "profiler_location": "local"},
    )

    assert victim_folder not in [folder["path"] for folder in listing.get_json()]
    assert update.status_code == HTTPStatus.FORBIDDEN


def test_hosted_listing_ignores_a_stored_path_below_a_report_folder(hosted_app):
    """An upload with a nested `db.sqlite` used to store `<ts>_mine/<other>/db.sqlite`."""
    victim_folder = _upload_victim_report(hosted_app)
    attacker = hosted_app.test_client()
    nested = (
        _profiler_root(hosted_app) / "1700000000_mine" / victim_folder / "db.sqlite"
    )
    with attacker.session_transaction() as flask_session:
        flask_session["profiler_paths"] = [str(nested)]

    listing = attacker.get("/api/profiler", query_string={"instanceId": "attacker"})
    update = _put_instance(
        attacker,
        "attacker",
        {"profiler_name": victim_folder, "profiler_location": "local"},
    )

    assert victim_folder not in [folder["path"] for folder in listing.get_json()]
    assert update.status_code == HTTPStatus.FORBIDDEN


# ---- The page hands every request on it one owner token ----------------------


def test_requests_leaving_a_page_together_share_its_owner_token(monkeypatch, tmp_path):
    """A page's first requests leave before any of them returns a cookie.

    Each used to mint its own owner token, so all but the first were refused as
    another session's and the page reloaded. The page response now carries the token.
    """
    monkeypatch.setenv("FLASK_ENV", "production")
    page_app = create_app(settings_override=base_test_settings(str(tmp_path)))
    page_app.config["LOCAL_DATA_DIRECTORY"] = Path(
        page_app.config["LOCAL_DATA_DIRECTORY"]
    )
    (tmp_path / "index.html").write_text("<script>/* SERVER_CONFIG */</script>")
    page_app.static_folder = str(tmp_path)
    page_cookie = (
        page_app.test_client().get(page_app.config["BASE_PATH"]).headers["Set-Cookie"]
    )
    session_cookie = page_cookie.split(";", 1)[0].split("=", 1)[1]

    # Two requests sent before either response: each holds only the page's cookie.
    responses = []
    for path in ("/api/instance", "/api/profiler"):
        request_client = page_app.test_client()
        request_client.set_cookie("session", session_cookie)
        responses.append(
            request_client.get(path, query_string={"instanceId": "new-tab"})
        )

    assert [response.status_code for response in responses] == [
        HTTPStatus.OK,
        HTTPStatus.OK,
    ]
