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
from pathlib import Path

import pytest
from ttnn_visualizer import usage
from ttnn_visualizer.tests.usage_log import (
    parse_usage_line,
    read_usage_lines,
    total_usage_events,
)
from ttnn_visualizer.usage import (
    CLIENT_EVENT_DETAIL_FIELDS,
    EVENT_FIELD,
    MAX_LOG_BYTES,
    RUN_ID_FIELD,
    SCHEMA_VERSION,
    SCHEMA_VERSION_FIELD,
    TIMESTAMP_FIELD,
    USAGE_RECORDING_ENV_VAR,
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
    # `/api/usage` is @local_only and the shared test app runs in SERVER_MODE, which
    # would 403 every case here. Default the module to local mode so the functional
    # contract is exercised; the 403 case re-enables SERVER_MODE.
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
    assert read_usage_lines(usage_directory) == []


def test_accepted_batch_appends_one_well_formed_line_per_event(client, usage_directory):
    response = post_events(client, [REPORT_LOADED_EVENT, VIEW_OPENED_EVENT])

    assert response.status_code == HTTPStatus.NO_CONTENT

    lines = read_usage_lines(usage_directory)
    assert len(lines) == 2

    first, second = (parse_usage_line(line) for line in lines)

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

    assert total_usage_events(read_usage_lines(usage_directory)) == 3


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
            {"event": UsageEvent.VIEW_OPENED.value, "details": {"view": "not_a_view"}},
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
    assert read_usage_lines(usage_directory) == []


@pytest.mark.parametrize(
    "entry",
    [
        pytest.param("view_opened", id="bare_string"),
        pytest.param(None, id="null"),
        pytest.param(["view_opened"], id="list"),
    ],
)
def test_a_batch_element_that_is_not_an_object_is_refused(
    client, usage_directory, entry
):
    response = post_events(client, [entry])

    assert response.status_code == HTTPStatus.UNPROCESSABLE_ENTITY
    assert read_usage_lines(usage_directory) == []


def test_unknown_top_level_event_keys_are_refused(client, usage_directory):
    """Closed at the envelope level too, so a dropped field cannot pass for a sent one."""
    response = post_events(
        client, [{**VIEW_OPENED_EVENT, "run_id": "forged01", "note": "hello"}]
    )

    assert response.status_code == HTTPStatus.UNPROCESSABLE_ENTITY
    assert read_usage_lines(usage_directory) == []


ACCEPTED_EVENTS = {
    UsageEvent.REPORT_LOADED: {"kind": "profiler", "source": "upload"},
    UsageEvent.REPORT_LOAD_FAILED: {
        "kind": "performance",
        "reason_class": "parse_error",
    },
    UsageEvent.VIEW_OPENED: {"view": "operations"},
    UsageEvent.VIEW_ENGAGED: {"view": "performance"},
}


@pytest.mark.parametrize("event", list(ACCEPTED_EVENTS), ids=lambda event: event.value)
def test_every_client_postable_event_round_trips(client, usage_directory, event):
    """All four, not just the two the other cases happen to use.

    A detail tuple naming the wrong-but-valid field — ``view`` where ``reason_class``
    belongs — would satisfy the schema meta-tests and fail only here.
    """
    details = ACCEPTED_EVENTS[event]

    response = post_events(client, [{"event": event.value, "details": details}])

    assert response.status_code == HTTPStatus.NO_CONTENT

    written = parse_usage_line(read_usage_lines(usage_directory)[0])

    assert written[EVENT_FIELD] == event.value
    assert set(CLIENT_EVENT_DETAIL_FIELDS[event]) <= set(written)
    for field, value in details.items():
        assert written[field] == value


def test_a_batch_shares_one_run_id(client, usage_directory):
    """Session shape is only reconstructable if one flush reads as one flush."""
    post_events(client, [REPORT_LOADED_EVENT, VIEW_OPENED_EVENT])

    first, second = (
        parse_usage_line(line) for line in read_usage_lines(usage_directory)
    )

    assert first[RUN_ID_FIELD] == second[RUN_ID_FIELD]


def test_a_full_batch_of_the_largest_event_fits_the_byte_cap(client, usage_directory):
    """The two caps have to be consistent, or a legal max batch 413s.

    ``test_batch_at_the_cap_is_accepted`` uses the smallest event and so leaves most of
    the byte budget unused; this posts the longest permitted detail values, which is the
    combination that would break first if either cap moved.
    """
    largest = {
        "event": UsageEvent.REPORT_LOAD_FAILED.value,
        "details": {
            "kind": "cluster_descriptor",
            "reason_class": "unsupported_version",
        },
    }

    response = post_events(client, [largest] * MAX_USAGE_BATCH_EVENTS)

    assert response.status_code == HTTPStatus.NO_CONTENT
    assert len(read_usage_lines(usage_directory)) == MAX_USAGE_BATCH_EVENTS


def test_a_failed_write_does_not_fail_the_request(
    client, usage_directory, monkeypatch, caplog
):
    """The contract that keeps instrumentation from taking the app down with it.

    Also pins one warning for the batch rather than one per event: a refactor back to
    per-event logging would turn a single failed flush into a screenful on a request
    path.
    """

    def failing_write(*args, **kwargs):
        raise OSError("disk full")

    monkeypatch.setattr(usage.os, "write", failing_write)

    with caplog.at_level("WARNING"):
        response = post_events(client, [REPORT_LOADED_EVENT, VIEW_OPENED_EVENT])

    warnings = [
        record for record in caplog.records if "usage events" in record.getMessage()
    ]

    assert response.status_code == HTTPStatus.NO_CONTENT
    assert read_usage_lines(usage_directory) == []
    assert len(warnings) == 1
    assert "2 usage events" in warnings[0].getMessage()


def test_a_log_at_the_cap_accepts_no_further_events(
    client, usage_directory, monkeypatch
):
    """Growth is client-driven now, so the cap has to hold on the write path too.

    Compaction runs at launch only, so without this an unthrottled client could drive
    the log past a limit the module documents as a privacy control, not just a disk one.

    The log has to exist and hold something first: an absent or empty one is not over
    any cap, so the guard is deliberately silent until there is something to measure.
    """
    post_events(client, [VIEW_OPENED_EVENT])
    already_written = read_usage_lines(usage_directory)
    assert len(already_written) == 1

    monkeypatch.setattr(usage, "MAX_LOG_BYTES", 0)
    monkeypatch.setattr(
        usage, "_bytes_since_size_check", usage.LOG_SIZE_CHECK_INTERVAL_BYTES
    )

    response = post_events(client, [REPORT_LOADED_EVENT])

    assert response.status_code == HTTPStatus.NO_CONTENT
    assert read_usage_lines(usage_directory) == already_written


def test_the_size_check_is_amortised_rather_than_per_request(
    client, usage_directory, monkeypatch
):
    """One stat per interval, not one per flush — this route is called often by design."""
    stats = []
    real_stat = Path.stat

    def counting_stat(self, *args, **kwargs):
        if self.name == usage.USAGE_LOG_NAME:
            stats.append(self)
        return real_stat(self, *args, **kwargs)

    monkeypatch.setattr(Path, "stat", counting_stat)

    for _ in range(5):
        post_events(client, [VIEW_OPENED_EVENT])

    # Snapshot before reading the log back: `read_usage_lines` stats it too, via
    # `exists()`, and would be counted as a sixth request's check.
    checks_during_requests = len(stats)

    assert len(read_usage_lines(usage_directory)) == 5
    # The first append checks (the fixture primes the counter); the remaining four are
    # nowhere near LOG_SIZE_CHECK_INTERVAL_BYTES of appended data.
    assert checks_during_requests == 1


def test_topology_is_not_yet_a_countable_view(client, usage_directory):
    """Deferred deliberately, and this is the only test that should notice.

    ``ROUTES.CLUSTER`` renders ``element: null``, so a ``topology`` counter could only
    ever be zero — which reads as "nobody wants topology". When the page lands, this
    test is the one that should fail, rather than an out-of-enum case that happens to
    have borrowed the value.
    """
    response = post_events(
        client,
        [{"event": UsageEvent.VIEW_OPENED.value, "details": {"view": "topology"}}],
    )

    assert response.status_code == HTTPStatus.UNPROCESSABLE_ENTITY
    assert read_usage_lines(usage_directory) == []


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
            {"event": UsageEvent.VIEW_OPENED.value, "details": {"view": "not_a_view"}},
        ],
    )

    assert response.status_code == HTTPStatus.UNPROCESSABLE_ENTITY
    assert read_usage_lines(usage_directory) == []


def test_oversized_batch_is_refused(client, usage_directory):
    events = [VIEW_OPENED_EVENT] * (MAX_USAGE_BATCH_EVENTS + 1)

    response = post_events(client, events)

    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert read_usage_lines(usage_directory) == []


def test_batch_at_the_cap_is_accepted(client, usage_directory):
    """Pins the boundary, so the cap cannot drift to off-by-one unnoticed."""
    response = post_events(client, [VIEW_OPENED_EVENT] * MAX_USAGE_BATCH_EVENTS)

    assert response.status_code == HTTPStatus.NO_CONTENT
    assert len(read_usage_lines(usage_directory)) == MAX_USAGE_BATCH_EVENTS


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
    assert read_usage_lines(usage_directory) == []


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
    assert read_usage_lines(usage_directory) == []


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
    assert read_usage_lines(usage_directory) == []


def test_unparseable_json_is_refused(client, usage_directory):
    response = client.post(
        USAGE_ENDPOINT, data="{not json", content_type="application/json"
    )

    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert read_usage_lines(usage_directory) == []


def test_switch_off_via_environment_writes_nothing(
    client, usage_directory, monkeypatch
):
    """Answers the same either way: whether a log exists here is not the client's business."""
    monkeypatch.setenv(USAGE_RECORDING_ENV_VAR, "false")

    response = post_events(client, [REPORT_LOADED_EVENT])

    assert response.status_code == HTTPStatus.NO_CONTENT
    assert read_usage_lines(usage_directory) == []


def test_switch_off_via_marker_file_writes_nothing(client, usage_directory):
    """The file half of the off switch, which is independent of the environment half."""
    usage_directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    get_disabled_marker_path().touch()

    response = post_events(client, [REPORT_LOADED_EVENT])

    assert response.status_code == HTTPStatus.NO_CONTENT
    assert read_usage_lines(usage_directory) == []
