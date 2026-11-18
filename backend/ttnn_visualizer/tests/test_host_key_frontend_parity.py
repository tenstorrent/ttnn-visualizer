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

from pathlib import Path

from ttnn_visualizer.enums import HostKeyIssue
from ttnn_visualizer.tests.frontend_parity import typescript_enum_values

_PROJECT_ROOT = Path(__file__).resolve().parents[3]
_DEFINITIONS = _PROJECT_ROOT / "src" / "definitions" / "HostKey.ts"


def test_the_definitions_file_is_where_the_enum_is_declared():
    """Guards the comment in ``enums.py`` that sends the next editor here."""
    assert _DEFINITIONS.is_file(), f"{_DEFINITIONS} does not exist"


def test_host_key_issue_values_match_the_frontend_copy():
    assert typescript_enum_values(_DEFINITIONS, "HostKeyIssue") == {
        issue.value for issue in HostKeyIssue
    }
