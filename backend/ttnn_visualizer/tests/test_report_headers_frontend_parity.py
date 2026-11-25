# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Pins ``ACTIVE_MEMORY_REPORT_HEADER`` against its TypeScript copy.

The client accepts a response without the header, so renaming either copy turns the
#2375 guard off and every memory read is cached unchecked again, with nothing at
runtime to say so. Each side's own tests import their own copy, so this is the only
test that sees both. HTTP header names are case-insensitive, and the frontend copy is
lower-case because axios normalises response header names.
"""

from pathlib import Path

from ttnn_visualizer.decorators import ACTIVE_MEMORY_REPORT_HEADER
from ttnn_visualizer.tests.frontend_parity import typescript_string_constant

_PROJECT_ROOT = Path(__file__).resolve().parents[3]
_DEFINITIONS = _PROJECT_ROOT / "src" / "definitions" / "ReportHeaders.ts"


def test_the_definitions_file_is_where_the_header_is_declared():
    """Guards the comment in ``decorators.py`` that sends the next editor there."""
    assert _DEFINITIONS.is_file(), f"{_DEFINITIONS} does not exist"


def test_active_memory_report_header_matches_the_frontend_copy():
    frontend_header = typescript_string_constant(
        _DEFINITIONS, "ACTIVE_MEMORY_REPORT_HEADER"
    )

    assert frontend_header.lower() == ACTIVE_MEMORY_REPORT_HEADER.lower()


def test_the_frontend_copy_is_lower_case():
    """axios lower-cases response header names, so a mixed-case key never matches."""
    frontend_header = typescript_string_constant(
        _DEFINITIONS, "ACTIVE_MEMORY_REPORT_HEADER"
    )

    assert frontend_header == frontend_header.lower()
