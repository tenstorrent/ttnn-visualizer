# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Pins the user-facing event-logging reference to the event schema."""

import re
from enum import Enum
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Dict, List, Set
from unittest.mock import patch

import pytest
from ttnn_visualizer import event_logging
from ttnn_visualizer.event_logging import (
    _DETAIL_FIELD_ENUMS,
    CLIENT_EVENT_DETAIL_FIELDS,
    COUNT_FIELD,
    DISABLED_MARKER_NAME,
    EVENT_FIELD,
    EVENT_LOG_FILENAME,
    EVENT_LOG_ID_LENGTH,
    HOSTED_EVENT_LOG_ROOT,
    MAX_HOSTED_BATCHES_PER_MINUTE,
    MAX_HOSTED_EVENT_LOG_CREATIONS_PER_MINUTE,
    MAX_HOSTED_EVENT_LOGS,
    RECORDING_DISABLED_ENV_VAR,
    RUN_ID_FIELD,
    RUN_ID_LENGTH,
    SCHEMA_VERSION,
    SCHEMA_VERSION_FIELD,
    TIMESTAMP_FIELD,
    EventLogEvent,
)
from ttnn_visualizer.settings import MIN_HOSTED_SECRET_KEY_BYTES
from ttnn_visualizer.utils import FALSE_VALUES, TRUE_VALUES

_REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
_EVENT_LOGGING_DOCS = _REPOSITORY_ROOT / "docs" / "src" / "event-logging.md"
_DOCS_INDEX = _REPOSITORY_ROOT / "docs" / "index.rst"


def _read(path: Path) -> str:
    if not path.exists():
        pytest.fail(
            f"{path.name} is missing. Event logging is user-visible and its "
            "documentation is part of the event schema's review gate."
        )

    return path.read_text(encoding="utf-8")


def _event_sections(source: str) -> Dict[str, str]:
    matches = re.findall(
        r"^### `([^`]+)`\s*$\n(.*?)(?=^### |\Z)",
        source,
        re.DOTALL | re.MULTILINE,
    )
    if not matches:
        raise AssertionError(f"No event sections found in {_EVENT_LOGGING_DOCS.name}")

    events = [event for event, _ in matches]
    if len(events) != len(set(events)):
        raise AssertionError(
            f"Duplicate event sections found in {_EVENT_LOGGING_DOCS.name}"
        )

    return dict(matches)


def _heading_section(source: str, heading: str) -> str:
    match = re.search(
        rf"^{re.escape(heading)}\s*$\n(.*?)(?=^## |\Z)",
        source,
        re.DOTALL | re.MULTILINE,
    )
    if match is None:
        raise AssertionError(
            f"No `{heading}` section found in {_EVENT_LOGGING_DOCS.name}"
        )

    return match.group(1)


def _documented_fields(section: str) -> Set[str]:
    fields = re.findall(r"^- `([^`]+)`:", section, re.MULTILINE)
    if len(fields) != len(set(fields)):
        raise AssertionError(
            f"Duplicate field declarations found in {_EVENT_LOGGING_DOCS.name}"
        )

    return set(fields)


def _app_start_details() -> Dict[str, Any]:
    with (
        patch.object(event_logging, "is_recording_enabled", return_value=True),
        patch.object(event_logging, "record_event") as record_event,
    ):
        event_logging.record_app_start(
            SimpleNamespace(TT_METAL_HOME=None), server_mode=False
        )

    record_event.assert_called_once()
    return {
        field: value
        for field, value in record_event.call_args.kwargs.items()
        if field != "server_mode"
    }


def _documented_value_sets(source: str, field: str) -> List[Set[str]]:
    declarations = re.findall(
        rf"^- `{re.escape(field)}`:\s*(.+)$", source, re.MULTILINE
    )
    if not declarations:
        raise AssertionError(f"No `{field}` field found in {_EVENT_LOGGING_DOCS.name}")

    return [set(re.findall(r"`([^`]+)`", declaration)) for declaration in declarations]


def _documented_values_matching(
    source: str, pattern: str, description: str
) -> Set[str]:
    match = re.search(pattern, source)
    if match is None:
        raise AssertionError(f"No {description} found in {_EVENT_LOGGING_DOCS.name}")

    return set(re.findall(r"`([^`]+)`", match.group(1)))


def test_the_event_logging_docs_page_is_in_the_resources_toctree():
    expected_entry = f"src/{_EVENT_LOGGING_DOCS.stem}"
    toctrees = re.findall(
        r"^\.\. toctree::\s*$\n(.*?)(?=^\.\. toctree::|\Z)",
        _read(_DOCS_INDEX),
        re.DOTALL | re.MULTILINE,
    )
    resources_toctrees = [
        toctree
        for toctree in toctrees
        if re.search(r"^\s+:caption:\s+Resources\s*$", toctree, re.MULTILINE)
    ]

    assert len(resources_toctrees) == 1
    assert expected_entry in {
        entry.strip()
        for entry in re.findall(r"^\s+src/\S+$", resources_toctrees[0], re.MULTILINE)
    }


def test_the_event_logging_docs_page_has_an_spdx_header():
    source = _read(_EVENT_LOGGING_DOCS)

    assert "SPDX-License-Identifier: Apache-2.0" in source
    assert "SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC" in source


def test_every_usage_event_has_exactly_one_documented_section():
    sections = _event_sections(_read(_EVENT_LOGGING_DOCS))

    assert set(sections) == {event.value for event in EventLogEvent}


@pytest.mark.parametrize("event", sorted(EventLogEvent, key=str))
def test_every_event_documents_exactly_its_specific_fields(event):
    section = _event_sections(_read(_EVENT_LOGGING_DOCS))[event.value]
    expected_fields = (
        set(_app_start_details())
        if event is EventLogEvent.APP_START
        else set(CLIENT_EVENT_DETAIL_FIELDS[event])
    )

    assert _documented_fields(section) == expected_fields


@pytest.mark.parametrize(
    "field, enumeration",
    sorted(_DETAIL_FIELD_ENUMS.items()),
)
def test_every_closed_client_detail_field_documents_exactly_its_enum(
    field, enumeration
):
    expected_values = {member.value for member in enumeration}

    assert all(
        values == expected_values
        for values in _documented_value_sets(_read(_EVENT_LOGGING_DOCS), field)
    )


def test_every_closed_server_detail_field_documents_exactly_its_enum():
    source = _read(_EVENT_LOGGING_DOCS)

    for field, value in _app_start_details().items():
        if isinstance(value, Enum):
            assert _documented_value_sets(source, field) == [
                {member.value for member in type(value)}
            ]


def test_the_event_logging_docs_name_every_common_log_field():
    source = _read(_EVENT_LOGGING_DOCS)
    section = _heading_section(source, "## Log fields")

    assert _documented_fields(section) == {
        TIMESTAMP_FIELD,
        EVENT_FIELD,
        SCHEMA_VERSION_FIELD,
        RUN_ID_FIELD,
        COUNT_FIELD,
    }
    assert _documented_value_sets(section, SCHEMA_VERSION_FIELD) == [
        {str(SCHEMA_VERSION)}
    ]
    assert _documented_value_sets(section, RUN_ID_FIELD) == [{str(RUN_ID_LENGTH)}]
    assert _documented_value_sets(section, EVENT_FIELD) == [
        {event.value for event in EventLogEvent}
    ]


def test_the_event_logging_docs_name_the_fixed_paths_and_environment_control():
    with (
        patch.object(event_logging, "EVENT_LOG_DIRECTORY", None),
        patch.object(event_logging.Path, "home", return_value=Path("~")),
    ):
        event_log_directory = event_logging.get_event_log_directory()

    source = _read(_EVENT_LOGGING_DOCS)

    assert str(event_log_directory / EVENT_LOG_FILENAME) in source
    assert str(event_log_directory / DISABLED_MARKER_NAME) in source
    assert str(HOSTED_EVENT_LOG_ROOT / "<event-log-id>" / EVENT_LOG_FILENAME) in source
    assert str(HOSTED_EVENT_LOG_ROOT / DISABLED_MARKER_NAME) in source
    assert f"{EVENT_LOG_ID_LENGTH}-character event log ID" in source
    assert f"at least {MIN_HOSTED_SECRET_KEY_BYTES} bytes" in source
    assert f"at most {MAX_HOSTED_EVENT_LOGS:,} hosted event logs" in source
    assert (
        f"at most {MAX_HOSTED_EVENT_LOG_CREATIONS_PER_MINUTE} new event logs per minute"
        in source
    )
    assert (
        f"at most {MAX_HOSTED_BATCHES_PER_MINUTE} batches per event log per minute"
        in source
    )
    assert RECORDING_DISABLED_ENV_VAR in source
    assert _documented_values_matching(
        source,
        r"Setting it to (.*?) switches recording off\.",
        "documented disabling values",
    ) == set(TRUE_VALUES)
    assert _documented_values_matching(
        source,
        r"setting it to (.*?), keeps recording on\.",
        "documented enabling values",
    ) == set(FALSE_VALUES)
