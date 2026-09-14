# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Covers the release-PR notice for changed startup requirements.

``scripts/startup_requirements_diff.py`` is the only thing that tells the person
publishing a release that it demands configuration the previous one did not (#2004).
It runs once per release, in CI, where nobody is watching it — so the failure mode
worth guarding is silence: a real change that renders as an empty section and is
appended to a PR body unnoticed.
"""

import importlib.util
import sys
from pathlib import Path

import pytest

_REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
_SCRIPT = _REPOSITORY_ROOT / "scripts" / "startup_requirements_diff.py"
_STARTUP_DOCS = _REPOSITORY_ROOT / "docs" / "src" / "startup-requirements.md"


def _load_script():
    """Import the script by path: ``scripts/`` is not an importable package."""
    spec = importlib.util.spec_from_file_location("startup_requirements_diff", _SCRIPT)
    if spec is None or spec.loader is None:
        pytest.fail(f"{_SCRIPT} could not be loaded")

    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


diff = _load_script()


def _requirement(**overrides):
    fields = {
        "id": "example",
        "env_vars": "`EXAMPLE`",
        "condition": "EXAMPLE must be set.",
        "introduced_in": "1.0.0",
        "enforced_from": "1.0.0",
        "posture": "Hosted",
    }
    fields.update(overrides)
    return diff.Requirement(**fields)


def test_the_parser_reads_the_real_documentation_table():
    """Against the live page, so a table reformat cannot quietly orphan the parser."""
    parsed = diff._parse(_STARTUP_DOCS.read_text(encoding="utf-8"))

    assert "hosted-secret-key" in parsed
    assert parsed["hosted-secret-key"].env_vars == "`SECRET_KEY`"


def test_an_unchanged_release_renders_nothing():
    """Most releases demand nothing new; those PR bodies must stay quiet."""
    requirements = {"example": _requirement()}

    assert diff.render(requirements, requirements) == ""


def test_a_new_requirement_is_announced_with_the_release_it_is_enforced_from():
    section = diff.render({}, {"example": _requirement(enforced_from="1.4.0")})

    assert "Startup requirements changed" in section
    assert "New requirements" in section
    assert "`example`" in section
    assert "Enforced from 1.4.0" in section


def test_a_tightened_condition_is_announced_as_a_change():
    before = {"example": _requirement(condition="EXAMPLE must be at least 8 bytes.")}
    after = {"example": _requirement(condition="EXAMPLE must be at least 32 bytes.")}

    section = diff.render(before, after)

    assert "Changed requirements" in section
    assert "at least 8 bytes" in section
    assert "at least 32 bytes" in section


def test_bringing_a_staged_requirement_into_force_is_announced():
    """The release that turns a warning into a refused boot is the dangerous one.

    Nothing else about the requirement changes then — only ``enforced_from`` — so a
    diff that compared conditions alone would stay silent on exactly the release most
    likely to stop a deployment.
    """
    before = {"example": _requirement(enforced_from="2.0.0")}
    after = {"example": _requirement(enforced_from="1.5.0")}

    section = diff.render(before, after)

    assert "Enforced from" in section
    assert "`2.0.0` → `1.5.0`" in section


def test_a_removed_requirement_is_reported():
    section = diff.render({"example": _requirement()}, {})

    assert "Removed requirements" in section
    assert "`example`" in section


def test_the_notice_tells_the_reader_what_to_do_about_it():
    """A warning without the next action is one more thing to scroll past."""
    section = diff.render({}, {"example": _requirement()})

    assert "--check-config" in section
    assert "docs/src/startup-requirements.md" in section


def test_a_missing_page_on_the_base_ref_reports_everything_as_new():
    """The release that first introduces the page, and any unreadable base ref.

    Erring toward noise: a missed requirement is the expensive direction.
    """
    assert diff._parse(None) == {}
    assert "New requirements" in diff.render(diff._parse(None), {"e": _requirement()})
