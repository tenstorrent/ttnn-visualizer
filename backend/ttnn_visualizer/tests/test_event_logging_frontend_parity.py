# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Pins the frontend event-log vocabulary to this package's.

The client validates nothing — it cannot, since anything ``ALLOWED_ORIGINS`` permits could
post — so ``event_logging.py`` is the authority and ``src/definitions/EventLogEvent.ts`` is a copy.
Nothing at runtime would report them diverging: the endpoint answers 422 and the client
swallows it by design. This module is the only thing that notices.

It lives in pytest rather than vitest because Python can introspect
:data:`CLIENT_EVENT_DETAIL_FIELDS` directly, whereas a vitest spec would need a Python
toolchain the frontend suite does not have. Parsing TypeScript with a regex is honest here
only because the file it reads is a flat set of string-valued enums with no computation in
it; a test that started failing to find members would fail loudly rather than pass hollowly
(see :func:`_enum_values`).
"""

import json
import re
from enum import Enum
from pathlib import Path
from typing import Dict, Set, Type

import pytest
from ttnn_visualizer import event_logging
from ttnn_visualizer.event_logging import (
    _DETAIL_FIELD_ENUMS,
    CLIENT_EVENT_DETAIL_FIELDS,
    DETAILS_FIELD,
    EVENT_FIELD,
    MAX_EVENT_LOG_BATCH_EVENTS,
    EventLogEvent,
    EventLogView,
    ReportKind,
    ReportLoadFailureReason,
    ReportSource,
)

_REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
_DEFINITIONS = _REPOSITORY_ROOT / "src" / "definitions" / "EventLogEvent.ts"
_RECORD_EVENT = _REPOSITORY_ROOT / "src" / "functions" / "recordEvent.ts"
_ENDPOINTS = _REPOSITORY_ROOT / "src" / "definitions" / "Endpoints.ts"

# Declared in ``event_logging.py`` but never posted by a client: they describe the machine this
# process runs on, and only the server can know them. Named here so that adding a
# client-facing enum without a TypeScript copy fails
# :func:`test_every_client_facing_enum_is_paired`, rather than going unnoticed.
_SERVER_ONLY_ENUMS = frozenset({"DeploymentMode", "LaunchMode", "OperatingSystem"})

_PAIRED_ENUMS: Dict[str, Type[Enum]] = {
    "EventLogEvent": EventLogEvent,
    "ReportKind": ReportKind,
    "ReportSource": ReportSource,
    "ReportLoadFailureReason": ReportLoadFailureReason,
    "EventLogView": EventLogView,
}


def _read(path: Path) -> str:
    if not path.exists():
        pytest.fail(
            f"{path.name} is missing. The frontend vocabulary is a copy of this "
            f"package's, and nothing else checks that they agree."
        )

    return path.read_text(encoding="utf-8")


def _require_match(
    pattern: str, source: str, flags: int, description: str
) -> "re.Match[str]":
    """Search, or fail with a message naming what was expected.

    Raises rather than calling ``pytest.fail`` so the ``None`` case narrows for mypy at the
    call sites, which would otherwise each need a redundant assertion.
    """
    match = re.search(pattern, source, flags)

    if match is None:
        raise AssertionError(description)

    return match


def _enum_values(source: str, name: str) -> Set[str]:
    """The string values of one TS enum, or a failure rather than an empty set.

    An empty result would silently satisfy every comparison below against an enum that had
    also been emptied, so a body that does not parse is an error in its own right.
    """
    body = _require_match(
        rf"export enum {name} {{(.*?)^}}",
        source,
        re.DOTALL | re.MULTILINE,
        f"No `export enum {name}` in {_DEFINITIONS.name}",
    )

    values = set(re.findall(r"=\s*'([^']+)'", body.group(1)))

    if not values:
        raise AssertionError(
            f"`export enum {name}` in {_DEFINITIONS.name} declares no members"
        )

    return values


def _payload_detail_keys(source: str, event: EventLogEvent) -> Set[str]:
    """The keys of the `details` object in the `EventLogEventPayload` branch for one event."""
    branch = _require_match(
        rf"event:\s*EventLogEvent\.{event.name};\s*\n?\s*details:\s*{{(.*?)}}",
        source,
        re.DOTALL,
        f"No EventLogEventPayload branch for {event.name}",
    )

    return set(re.findall(r"(\w+)\s*:", branch.group(1)))


@pytest.mark.parametrize("name, enumeration", sorted(_PAIRED_ENUMS.items()))
def test_every_enum_matches_its_typescript_copy(name, enumeration):
    values = _enum_values(_read(_DEFINITIONS), name)

    assert values == {member.value for member in enumeration}, (
        f"{name} has diverged from event_logging.py. The client would emit events this endpoint "
        f"rejects, and both sides are silent about it."
    )


@pytest.mark.parametrize("event", sorted(CLIENT_EVENT_DETAIL_FIELDS, key=str))
def test_every_client_event_declares_exactly_the_expected_details(event):
    # Exactly, because `validate_client_event` compares detail keys as a set: a missing key
    # fails identically to an unknown one and takes the whole batch with it. This is also
    # what catches a payload that flattened `details` up beside `event`.
    assert _payload_detail_keys(_read(_DEFINITIONS), event) == set(
        CLIENT_EVENT_DETAIL_FIELDS[event]
    )


def test_the_client_payload_cannot_express_a_server_only_event():
    # `app_start` is a real `EventLogEvent` member, so it has to be in the TS enum — but a
    # payload branch for it would let a page forge the population every other figure is
    # read against.
    source = _read(_DEFINITIONS)

    assert EventLogEvent.APP_START not in CLIENT_EVENT_DETAIL_FIELDS
    assert f"EventLogEvent.{EventLogEvent.APP_START.name};" not in source


def test_the_client_batch_cap_matches_the_write_atomicity_cap():
    # The client slices batches to its own constant, so a larger one there would build
    # batches this endpoint refuses wholesale.
    declared = _require_match(
        r"const MAX_BUFFERED_EVENTS = (\d+);",
        _read(_RECORD_EVENT),
        0,
        "No MAX_BUFFERED_EVENTS in recordEvent.ts",
    )

    assert int(declared.group(1)) == MAX_EVENT_LOG_BATCH_EVENTS


def test_every_client_facing_enum_is_paired():
    """A new enum in ``event_logging.py`` must gain a TypeScript copy or be declared server-only.

    ``_PAIRED_ENUMS`` is hand-maintained, so without this the failure mode the parity tests
    exist to prevent reappears one level up: an enum added here and forgotten in the client
    is simply not compared by anything.
    """
    declared = {
        name
        for name, value in vars(event_logging).items()
        if isinstance(value, type) and issubclass(value, Enum) and value is not Enum
    }

    assert declared == set(_PAIRED_ENUMS) | _SERVER_ONLY_ENUMS


def test_the_client_posts_to_the_route_the_blueprint_registers():
    """The path is duplicated in TypeScript, and a mismatch is silent on both sides.

    A renamed route would make every post a 404 that the client swallows by design, so
    nothing anywhere would report it.
    """
    from ttnn_visualizer.app import create_app

    declared = _require_match(
        r"EVENT_LOGGING = '([^']+)'",
        _read(_ENDPOINTS),
        0,
        "No EVENT_LOGGING member in Endpoints.ts",
    ).group(1)

    rules = {
        str(rule)
        for rule in create_app().url_map.iter_rules()
        if "POST" in (rule.methods or set())
    }

    assert declared in rules


def test_the_client_envelope_key_matches_the_route():
    """``{ events }`` in the sender against ``_EVENT_LOG_EVENTS_FIELD`` in the route.

    Renaming one leaves the other posting a body the handler reads as empty, answered with
    a 400 the client never surfaces.
    """
    from ttnn_visualizer.views import _EVENT_LOG_EVENTS_FIELD

    declared = _require_match(
        r"axiosInstance\s*\.post\(Endpoints\.EVENT_LOGGING,\s*\{\s*(\w+)\s*\}\)",
        _read(_RECORD_EVENT),
        re.DOTALL,
        "No axiosInstance.post(Endpoints.EVENT_LOGGING, { ... }) in recordEvent.ts",
    ).group(1)

    assert declared == _EVENT_LOG_EVENTS_FIELD


def test_a_full_batch_of_the_largest_events_fits_the_request_cap():
    """The client knows the count cap but not the byte cap; this is what defends it.

    ``MAX_EVENT_LOG_BATCH_EVENTS`` is mirrored in ``recordEvent.ts`` and pinned above, so an
    oversized *batch* is unreachable from this client. ``MAX_EVENT_LOG_REQUEST_BYTES`` is not
    mirrored anywhere in ``src/``, and the endpoint enforces it as a 413 that the client
    swallows by design — so consuming the headroom would surface as events quietly going
    missing, not as a failure.

    Built from the enums rather than a fixed string so that widening any of them, or adding
    a detail field, is what moves the number.
    """
    from ttnn_visualizer.views import (
        _EVENT_LOG_EVENTS_FIELD,
        MAX_EVENT_LOG_REQUEST_BYTES,
    )

    def widest(field: str) -> str:
        return max((member.value for member in _DETAIL_FIELD_ENUMS[field]), key=len)

    largest = max(
        (
            {
                EVENT_FIELD: event.value,
                DETAILS_FIELD: {field: widest(field) for field in fields},
            }
            for event, fields in CLIENT_EVENT_DETAIL_FIELDS.items()
        ),
        key=lambda entry: len(json.dumps(entry)),
    )

    body = json.dumps({_EVENT_LOG_EVENTS_FIELD: [largest] * MAX_EVENT_LOG_BATCH_EVENTS})

    assert len(body.encode("utf-8")) < MAX_EVENT_LOG_REQUEST_BYTES, (
        "A full batch of the largest event the client can express no longer fits "
        "MAX_EVENT_LOG_REQUEST_BYTES. The endpoint would answer 413 and the client would "
        "swallow it, so the events would simply stop arriving."
    )
