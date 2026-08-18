# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Pins the frontend usage vocabulary to this package's.

The client validates nothing — it cannot, since anything ``ALLOWED_ORIGINS`` permits could
post — so ``usage.py`` is the authority and ``src/definitions/UsageEvent.ts`` is a copy.
Nothing at runtime would report them diverging: the endpoint answers 422 and the client
swallows it by design. This module is the only thing that notices.

It lives in pytest rather than vitest because Python can introspect
:data:`CLIENT_EVENT_DETAIL_FIELDS` directly, whereas a vitest spec would need a Python
toolchain the frontend suite does not have. Parsing TypeScript with a regex is honest here
only because the file it reads is a flat set of string-valued enums with no computation in
it; a test that started failing to find members would fail loudly rather than pass hollowly
(see :func:`_enum_values`).
"""

import re
from enum import Enum
from pathlib import Path
from typing import Dict, Set, Type

import pytest
from ttnn_visualizer.usage import (
    CLIENT_EVENT_DETAIL_FIELDS,
    MAX_USAGE_BATCH_EVENTS,
    ReportKind,
    ReportLoadFailureReason,
    ReportSource,
    UsageEvent,
    UsageView,
)

_REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
_DEFINITIONS = _REPOSITORY_ROOT / "src" / "definitions" / "UsageEvent.ts"
_RECORD_USAGE = _REPOSITORY_ROOT / "src" / "functions" / "recordUsage.ts"

_PAIRED_ENUMS: Dict[str, Type[Enum]] = {
    "UsageEvent": UsageEvent,
    "ReportKind": ReportKind,
    "ReportSource": ReportSource,
    "ReportLoadFailureReason": ReportLoadFailureReason,
    "UsageView": UsageView,
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


def _payload_detail_keys(source: str, event: UsageEvent) -> Set[str]:
    """The keys of the `details` object in the `UsageEventPayload` branch for one event."""
    branch = _require_match(
        rf"event:\s*UsageEvent\.{event.name};\s*\n?\s*details:\s*{{(.*?)}}",
        source,
        re.DOTALL,
        f"No UsageEventPayload branch for {event.name}",
    )

    return set(re.findall(r"(\w+)\s*:", branch.group(1)))


@pytest.mark.parametrize("name, enumeration", sorted(_PAIRED_ENUMS.items()))
def test_every_enum_matches_its_typescript_copy(name, enumeration):
    values = _enum_values(_read(_DEFINITIONS), name)

    assert values == {member.value for member in enumeration}, (
        f"{name} has diverged from usage.py. The client would emit events this endpoint "
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
    # `app_start` is a real `UsageEvent` member, so it has to be in the TS enum — but a
    # payload branch for it would let a page forge the population every other figure is
    # read against.
    source = _read(_DEFINITIONS)

    assert UsageEvent.APP_START not in CLIENT_EVENT_DETAIL_FIELDS
    assert f"UsageEvent.{UsageEvent.APP_START.name};" not in source


def test_the_client_batch_cap_matches_the_write_atomicity_cap():
    # The client slices batches to its own constant, so a larger one there would build
    # batches this endpoint refuses wholesale.
    declared = _require_match(
        r"const MAX_BUFFERED_EVENTS = (\d+);",
        _read(_RECORD_USAGE),
        0,
        "No MAX_BUFFERED_EVENTS in recordUsage.ts",
    )

    assert int(declared.group(1)) == MAX_USAGE_BATCH_EVENTS
