# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Pins the operator-facing startup-requirements page to the registry.

A startup requirement is a demand on someone else's environment, and the only place
that audience can read it is the documentation. Tying the page to the registry means a
requirement cannot be added, retimed or tightened without the operator-facing text
changing in the same commit — which also makes it visible in review as a documentation
diff rather than as a threshold buried in a validator (#2004).
"""

import re
from pathlib import Path
from typing import Dict, List

import pytest
from ttnn_visualizer.startup_requirements import STARTUP_REQUIREMENTS

_REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
_STARTUP_DOCS = _REPOSITORY_ROOT / "docs" / "src" / "startup-requirements.md"
_DOCS_INDEX = _REPOSITORY_ROOT / "docs" / "index.rst"
_CONVENTIONS = _REPOSITORY_ROOT / "CONVENTIONS.md"
_AGENTS = _REPOSITORY_ROOT / "AGENTS.md"


def _read(path: Path) -> str:
    if not path.exists():
        pytest.fail(
            f"{path.name} is missing. Startup requirements are demands on an "
            "operator's environment, so their documentation is part of the change."
        )

    return path.read_text(encoding="utf-8")


def _documented_requirements() -> List[Dict[str, str]]:
    """Rows of the "Current requirements" table, keyed by column."""
    source = _read(_STARTUP_DOCS)
    rows = re.findall(
        r"^\| `([a-z0-9-]+)` \| (.+?) \| (.+?) \| (.+?) \| (.+?) \| (.+?) \|$",
        source,
        re.MULTILINE,
    )
    if not rows:
        raise AssertionError(
            f"No requirement rows found in {_STARTUP_DOCS.name}. The table's shape is "
            "part of the contract this test enforces."
        )

    return [
        {
            "id": row[0],
            "env_vars": row[1],
            "condition": row[2],
            "introduced_in": row[3],
            "enforced_from": row[4],
            "posture": row[5],
        }
        for row in rows
    ]


def test_the_docs_list_exactly_the_declared_requirements():
    documented = {row["id"] for row in _documented_requirements()}
    declared = {requirement.id for requirement in STARTUP_REQUIREMENTS}

    assert documented == declared, (
        "The startup-requirements page and the registry disagree about which "
        "requirements exist. Operators cannot read the registry; update "
        f"{_STARTUP_DOCS.name}."
    )


def test_each_documented_requirement_states_the_registry_values():
    documented = {row["id"]: row for row in _documented_requirements()}

    for requirement in STARTUP_REQUIREMENTS:
        row = documented[requirement.id]

        for env_var in requirement.env_vars:
            assert f"`{env_var}`" in row["env_vars"], (
                f"{requirement.id} is checked against {env_var}, which its "
                "documented row does not name."
            )

        assert row["condition"] == requirement.summary
        assert row["introduced_in"] == requirement.introduced_in
        assert row["enforced_from"] == requirement.enforced_from
        assert row["posture"] == ("Hosted" if requirement.hosted_only else "All")


def test_the_docs_explain_the_staged_rollout_and_the_preflight_contract():
    """The two things an operator needs that no single table row carries."""
    source = _read(_STARTUP_DOCS)

    assert "--check-config" in source
    assert "Enforced from" in source
    assert "exits `0`" in source


def test_the_startup_requirements_page_is_published():
    """A page absent from the toctree is not documentation anyone will find."""
    assert "src/startup-requirements" in _read(_DOCS_INDEX)


def test_the_rollout_convention_is_recorded_for_maintainers():
    """The operator page defers to CONVENTIONS.md; that section has to exist."""
    conventions = _read(_CONVENTIONS)

    assert "## Startup requirements" in conventions
    assert "enforced_from" in conventions


def test_both_guidance_files_scope_the_convention_away_from_parse_time_failures():
    """The registry's claim has to stop where the registry's reach stops.

    `_STRICT_BOOLEANS` and the `MAX_CONTENT_LENGTH` parser raise inside
    `Config.__init__`, before `create_app` can apply anything — so tightening one is
    the #2004 class with none of these controls, and every test in this package still
    passes. A maintainer who reads "a condition on operator-supplied configuration that
    the app refuses to start without" concludes, reasonably and wrongly, that they are
    covered. Both files have to say where the boundary is, or the convention over-claims
    exactly where it is most expensive to be wrong.
    """
    for path in (_CONVENTIONS, _AGENTS):
        source = _read(path)

        assert "_STRICT_BOOLEANS" in source, (
            f"{path.name} does not name the parse-time settings the registry cannot "
            "reach, so its description of a startup requirement over-claims."
        )
        assert "MAX_CONTENT_LENGTH" in source, (
            f"{path.name} does not name the parse-time settings the registry cannot "
            "reach, so its description of a startup requirement over-claims."
        )


def test_the_rollout_convention_is_stated_in_agents_md_too():
    """CONVENTIONS.md's maintenance contract requires every convention in both files.

    Not pedantry about where a rule is filed. AGENTS.md is the entry point a contributor
    or agent reads before touching anything; a rollout convention reachable only by
    following a link out of an unrelated SECRET_KEY bullet is one nobody meets until
    they are already editing that particular gate. The rule has to be encounterable
    before the decision it governs.
    """
    agents = _read(_AGENTS)

    assert "### Startup requirements" in agents
    assert "enforced_from" in agents
    assert "CONVENTIONS.md#startup-requirements" in agents
