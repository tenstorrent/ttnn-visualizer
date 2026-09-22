# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Pins the agent-tools page to the registered tool table.

The page is not a description of the MCP surface, it is the only description. An agent
picks a tool from that table and reads the caveats beside it to know how to read the
answer, so a tool that is registered but undocumented is invisible to the client that
would use it. Nothing enforced that before: the tools and the page stayed in step by
habit, and the MCP route now renders this same file in the application (#2035), which
turns a missing row from a documentation gap into a user-visible one.
"""

import re
from pathlib import Path
from typing import Dict, Set

import pytest
from ttnn_visualizer.agent import server
from ttnn_visualizer.agent.handles import ReportRegistry

_REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
_AGENT_DOCS = _REPOSITORY_ROOT / "docs" / "src" / "agent-tools.md"
_DOCS_INDEX = _REPOSITORY_ROOT / "docs" / "index.rst"
_AGENTS = _REPOSITORY_ROOT / "AGENTS.md"


def _read(path: Path) -> str:
    if not path.exists():
        pytest.fail(
            f"{path.name} is missing. The agent-tools page is the only description of "
            "the MCP surface an agent can read, so it is part of the change."
        )

    return path.read_text(encoding="utf-8")


def _documented_tools() -> Dict[str, str]:
    """Rows of the tool table: name → what it answers."""
    # `[a-z0-9_]` and a tolerant line end on purpose: a digit in a tool name or a
    # trailing space on the row would otherwise drop it from this mapping, and the
    # failure would report a documented tool as undocumented — pointing at the wrong fix.
    rows = re.findall(
        r"^\| `([a-z0-9_]+)` \| (.+?) \|\s*$", _read(_AGENT_DOCS), re.MULTILINE
    )
    if not rows:
        raise AssertionError(
            f"No tool rows found in {_AGENT_DOCS.name}. The table's shape is part of "
            "the contract this test enforces, so a reformat has to keep the `| `name` "
            "| answer |` row or update this parser."
        )

    names = [name for name, _ in rows]
    duplicates = sorted({name for name in names if names.count(name) > 1})
    if duplicates:
        raise AssertionError(
            f"{_AGENT_DOCS.name} lists {duplicates} more than once. Every comparison "
            "below is against a set, so a duplicate row would survive all of them; it "
            "is rejected here instead."
        )

    return dict(rows)


def _registered_tools() -> Set[str]:
    return set(server._tool_table(ReportRegistry()))


def test_the_docs_table_lists_exactly_the_registered_tools():
    documented = set(_documented_tools())
    registered = _registered_tools()

    assert documented == registered, (
        f"undocumented: {sorted(registered - documented)}, "
        f"documented but not registered: {sorted(documented - registered)}"
    )


def test_every_documented_tool_says_what_it_answers():
    # A name on its own does not help an agent choose, which is the table's whole job.
    # This catches a whitespace-only cell. A genuinely empty one (`| `x` |  |`) does not
    # match the row pattern at all, so it drops out of the mapping and the set comparison
    # above reports it as undocumented — the right answer by a different route.
    blank = [
        name for name, answers in _documented_tools().items() if not answers.strip()
    ]

    assert not blank, f"tool rows with no description: {sorted(blank)}"


def test_the_agent_tools_page_is_published():
    assert "src/agent-tools" in _read(
        _DOCS_INDEX
    ), "The page is only useful if it is built. Add it to the toctree in index.rst."


def test_agents_md_points_at_the_agent_tools_page():
    """The pointer, and only the pointer.

    Naming this after #2036 would overclaim: that issue asks for AGENTS.md to *require*
    a new tool be documented, and the section still introduces the page as reference
    material. Writing that rule is #2036's own change (#2038). What this pins is the
    reference the rule hangs off, so the section cannot stop naming the page at all.
    """
    guidance = _read(_AGENTS)
    section = guidance[guidance.index("### Agent-facing tools") :]
    section = section[: section.index("###", len("### Agent-facing tools"))]

    assert "docs/src/agent-tools.md" in section, (
        "AGENTS.md must point at the agent-tools page from the Agent-facing tools "
        "section, so adding a tool without documenting it is visible in review."
    )
