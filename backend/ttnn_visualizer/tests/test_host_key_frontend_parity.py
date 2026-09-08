# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Pins ``HostKeyIssue`` against its TypeScript copy.

The enum crosses the wire as strings, and nothing at runtime reports a divergence: an
``issue`` the client does not recognise makes ``isHostKeyStatus`` return false and the
whole prompt silently disappears — the user is left with the same dead end the feature
exists to remove. Follows the pattern ``test_event_logging_frontend_parity.py`` established for
the event-log vocabulary.
"""

import re
from pathlib import Path
from typing import Set

from ttnn_visualizer.enums import HostKeyIssue

_PROJECT_ROOT = Path(__file__).resolve().parents[3]
_DEFINITIONS = _PROJECT_ROOT / "src" / "definitions" / "HostKey.ts"


def _typescript_enum_values(name: str) -> Set[str]:
    """The string values of one TS enum, or a failure rather than an empty set.

    An empty result would satisfy the comparison below against an enum that had also been
    emptied, so a body that does not parse is an error in its own right.
    """
    source = _DEFINITIONS.read_text(encoding="utf-8")
    body = re.search(
        rf"export enum {name} {{(.*?)^}}", source, re.DOTALL | re.MULTILINE
    )

    assert body is not None, f"No `export enum {name}` in {_DEFINITIONS.name}"

    values = set(re.findall(r"=\s*'([^']+)'", body.group(1)))

    assert values, f"`export enum {name}` in {_DEFINITIONS.name} declares no members"
    return values


def test_the_definitions_file_is_where_the_enum_is_declared():
    """Guards the comment in ``enums.py`` that sends the next editor here."""
    assert _DEFINITIONS.is_file(), f"{_DEFINITIONS} does not exist"


def test_host_key_issue_values_match_the_frontend_copy():
    assert _typescript_enum_values("HostKeyIssue") == {
        issue.value for issue in HostKeyIssue
    }
