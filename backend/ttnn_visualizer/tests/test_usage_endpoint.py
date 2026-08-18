# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""The ingest endpoint is the one piece of network surface the usage log has.

Nothing in a local install is authenticated and ``ALLOWED_ORIGINS`` is the only other
gate, so an endpoint that trusted its body would let any permitted page write arbitrary
lines into the exact file we are asking IT to parse. The tests that matter most here are
therefore the ones asserting a rejected batch leaves the log *untouched* — a half-written
batch is worse than a refused one, because a reader cannot tell it from a complete one.
"""

import json
from http import HTTPStatus

import pytest
from ttnn_visualizer.tests.conftest import parse, read_lines, total_events
from ttnn_visualizer.usage import (
    EVENT_FIELD,
    RUN_ID_FIELD,
    SCHEMA_VERSION,
    SCHEMA_VERSION_FIELD,
    TIMESTAMP_FIELD,
    UsageEvent,
    get_disabled_marker_path,
)
from ttnn_visualizer.views import MAX_USAGE_BATCH_EVENTS, MAX_USAGE_REQUEST_BYTES

USAGE_ENDPOINT = "/api/usage"

REPORT_LOADED_EVENT = {
    "event": UsageEvent.REPORT_LOADED.value,
    "details": {"kind": "profiler", "source": "upload"},
}
VIEW_OPENED_EVENT = {
    "event": UsageEvent.VIEW_OPENED.value,
    "details": {"view": "operations"},
}


@pytest.fixture(autouse=True)
def isolate_usage_log(usage_directory):
    """Autouse rather than opt-in: forgetting it would append to the developer's own log.

    An opt-in fixture fails open here — a test that omits it still passes, having written
    to ``~/.ttnn-visualizer/usage``.
    """
    return usage_directory


@pytest.fixture(autouse=True)
def local_mode(app):
    # The windowed routes are @local_only, and the shared test app runs in
    # SERVER_MODE. Default every case in this module to local mode so the
    # functional contract is exercised; the 403 case re-enables SERVER_MODE.
    previous = app.config["SERVER_MODE"]
    app.config["SERVER_MODE"] = False
    yield
    app.config["SERVER_MODE"] = previous


def post_events(client, events):
    return client.post(USAGE_ENDPOINT, json={"events": events})


def test_hosted_instance_refuses_to_record(app, client, usage_directory):
    """@local_only: the hosted deployment writes no usage log at all."""
    app.config["SERVER_MODE"] = True

    response = post_events(client, [REPORT_LOADED_EVENT])

    assert response.status_code == HTTPStatus.FORBIDDEN
    assert read_lines(usage_directory) == []


def test_accepted_batch_appends_one_well_formed_line_per_event(client, usage_directory):
    response = post_events(client, [REPORT_LOADED_EVENT, VIEW_OPENED_EVENT])

    assert response.status_code == HTTPStatus.NO_CONTENT

    lines = read_lines(usage_directory)
    assert len(lines) == 2

    first, second = (parse(line) for line in lines)

    assert first[EVENT_FIELD] == UsageEvent.REPORT_LOADED.value
    assert first["kind"] == "profiler"
    assert first["source"] == "upload"
    assert second[EVENT_FIELD] == UsageEvent.VIEW_OPENED.value
    assert second["view"] == "operations"

    for fields in (first, second):
        # Server-supplied, every one of them: a client cannot set any of these.
        assert fields[SCHEMA_VERSION_FIELD] == str(SCHEMA_VERSION)
        assert fields[TIMESTAMP_FIELD].endswith("Z")
        assert fields[RUN_ID_FIELD]


def test_accepted_batch_totals_the_way_the_collector_reads_it(client, usage_directory):
    """Cumulative counts have to come out right, since a decrease reads as a reset."""
    post_events(client, [VIEW_OPENED_EVENT] * 3)

    assert total_events(read_lines(usage_directory)) == 3


@pytest.mark.parametrize(
    "event",
    [
        pytest.param({"event": "not_an_event", "details": {}}, id="unknown_event"),
        pytest.param(
            {"event": UsageEvent.APP_START.value, "details": {}},
            id="server_owned_event",
        ),
        pytest.param(
            {
                "event": UsageEvent.REPORT_LOADED.value,
                "details": {
                    "kind": "profiler",
                    "source": "upload",
                    "extra": "profiler",
                },
            },
            id="unknown_detail_key",
        ),
        pytest.param(
            {"event": UsageEvent.REPORT_LOADED.value, "details": {"kind": "profiler"}},
            id="missing_detail_key",
        ),
        pytest.param(
            {"event": UsageEvent.VIEW_OPENED.value, "details": {"view": "topology"}},
            id="out_of_enum_value",
        ),
        pytest.param(
            {
                "event": UsageEvent.VIEW_OPENED.value,
                "details": {"view": "operations\nts=2026-01-01T00:00:00Z"},
            },
            id="embedded_newline",
        ),
        pytest.param(
            {"event": UsageEvent.VIEW_OPENED.value, "details": {"view": "view=forged"}},
            id="embedded_equals",
        ),
        pytest.param(
            {
                "event": UsageEvent.VIEW_OPENED.value,
                "details": {"view": "operations", "ts": "2026-01-01T00:00:00Z"},
            },
            id="client_supplied_timestamp",
        ),
        pytest.param(
            {
                "event": UsageEvent.VIEW_OPENED.value,
                "details": {"view": "operations", "schema_version": "99"},
            },
            id="client_supplied_schema_version",
        ),
        pytest.param(
            {"event": UsageEvent.VIEW_OPENED.value, "details": {"view": 1}},
            id="non_string_value",
        ),
        pytest.param(
            {"event": UsageEvent.VIEW_OPENED.value, "details": "operations"},
            id="details_not_an_object",
        ),
        pytest.param({"event": UsageEvent.VIEW_OPENED.value}, id="details_absent"),
        pytest.param({"details": {"view": "operations"}}, id="event_name_absent"),
    ],
)
def test_rejected_event_is_refused_and_appends_nothing(client, usage_directory, event):
    response = post_events(client, [event])

    assert response.status_code == HTTPStatus.UNPROCESSABLE_ENTITY
    assert read_lines(usage_directory) == []


def test_rejection_never_echoes_the_offending_value(client):
    """A response body must not become the way free-form text re-enters the system."""
    secret = "modelname-customer-a"

    response = post_events(
        client, [{"event": UsageEvent.VIEW_OPENED.value, "details": {"view": secret}}]
    )

    assert response.status_code == HTTPStatus.UNPROCESSABLE_ENTITY
    assert secret not in response.get_data(as_text=True)


def test_mixed_batch_appends_nothing_at_all(client, usage_directory):
    """The case a naive loop passes: partial acceptance is the failure to guard against."""
    response = post_events(
        client,
        [
            REPORT_LOADED_EVENT,
            VIEW_OPENED_EVENT,
            {"event": UsageEvent.VIEW_OPENED.value, "details": {"view": "topology"}},
        ],
    )

    assert response.status_code == HTTPStatus.UNPROCESSABLE_ENTITY
    assert read_lines(usage_directory) == []


def test_oversized_batch_is_refused(client, usage_directory):
    events = [VIEW_OPENED_EVENT] * (MAX_USAGE_BATCH_EVENTS + 1)

    response = post_events(client, events)

    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert read_lines(usage_directory) == []


def test_batch_at_the_cap_is_accepted(client, usage_directory):
    """Pins the boundary, so the cap cannot drift to off-by-one unnoticed."""
    response = post_events(client, [VIEW_OPENED_EVENT] * MAX_USAGE_BATCH_EVENTS)

    assert response.status_code == HTTPStatus.NO_CONTENT
    assert len(read_lines(usage_directory)) == MAX_USAGE_BATCH_EVENTS


def test_oversized_body_is_refused_before_it_is_parsed(client, usage_directory):
    """413 from Werkzeug, not 400: asserted rather than assumed, as it is framework-owned.

    The body is well-formed and would otherwise be accepted, so only the byte cap can
    reject it. ``MAX_CONTENT_LENGTH`` is unset on a default install, which is why the
    route sets a limit per request.
    """
    padding = "x" * MAX_USAGE_REQUEST_BYTES

    response = client.post(
        USAGE_ENDPOINT,
        data=json.dumps({"events": [VIEW_OPENED_EVENT], "padding": padding}),
        content_type="application/json",
    )

    assert response.status_code == HTTPStatus.REQUEST_ENTITY_TOO_LARGE
    assert read_lines(usage_directory) == []


def test_plain_text_body_is_refused(client, usage_directory):
    """Pins the contract the client's ``sendBeacon`` flush has to honour.

    A bare-string beacon is sent as ``text/plain``, which fails ``is_json`` and lands
    here; the client must post a Blob typed ``application/json``. Requiring the JSON
    content type is also what makes this a non-simple request, so a hostile origin needs
    a preflight ``ALLOWED_ORIGINS`` refuses.
    """
    response = client.post(
        USAGE_ENDPOINT,
        data=json.dumps({"events": [VIEW_OPENED_EVENT]}),
        content_type="text/plain;charset=UTF-8",
    )

    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert read_lines(usage_directory) == []


@pytest.mark.parametrize(
    "payload",
    [
        pytest.param({}, id="events_absent"),
        pytest.param({"events": {}}, id="events_not_a_list"),
        pytest.param({"events": []}, id="events_empty"),
        pytest.param([REPORT_LOADED_EVENT], id="body_not_an_object"),
    ],
)
def test_malformed_body_is_refused(client, usage_directory, payload):
    response = client.post(USAGE_ENDPOINT, json=payload)

    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert read_lines(usage_directory) == []


def test_unparseable_json_is_refused(client, usage_directory):
    response = client.post(
        USAGE_ENDPOINT, data="{not json", content_type="application/json"
    )

    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert read_lines(usage_directory) == []


def test_switch_off_via_environment_writes_nothing(
    client, usage_directory, monkeypatch
):
    """Answers the same either way: whether a log exists here is not the client's business."""
    monkeypatch.setenv("USAGE_RECORDING_ENABLED", "false")

    response = post_events(client, [REPORT_LOADED_EVENT])

    assert response.status_code == HTTPStatus.NO_CONTENT
    assert read_lines(usage_directory) == []


def test_switch_off_via_marker_file_writes_nothing(client, usage_directory):
    """The file half of the off switch, which is independent of the environment half."""
    usage_directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    get_disabled_marker_path().touch()

    response = post_events(client, [REPORT_LOADED_EVENT])

    assert response.status_code == HTTPStatus.NO_CONTENT
    assert read_lines(usage_directory) == []
