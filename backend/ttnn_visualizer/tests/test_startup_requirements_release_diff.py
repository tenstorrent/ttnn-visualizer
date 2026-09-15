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
import json
import sys
from pathlib import Path

import pytest
from ttnn_visualizer import startup_requirements

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


def _render(base, head, base_version="1.0.0", head_version="1.0.0"):
    """``render`` with the release versions defaulted to a bump-free release."""
    return diff.render(base, head, base_version=base_version, head_version=head_version)


def test_an_unchanged_release_renders_nothing():
    """Most releases demand nothing new; those PR bodies must stay quiet."""
    requirements = {"example": _requirement()}

    assert _render(requirements, requirements) == ""


def test_a_new_requirement_staged_for_a_later_release_says_it_only_warns():
    section = _render({}, {"example": _requirement(enforced_from="1.4.0")})

    assert "Startup requirements changed" in section
    assert "New requirements" in section
    assert "`example`" in section
    assert "Warns until 1.4.0" in section


def test_a_new_requirement_that_is_fatal_on_arrival_says_so():
    """The #2004 shape. The reader needs it separated from a staged one at a glance."""
    section = _render(
        {},
        {"example": _requirement(enforced_from="1.1.0")},
        base_version="1.0.0",
        head_version="1.1.0",
    )

    assert "Fatal in this release" in section


def test_a_tightened_condition_is_announced_as_a_change():
    before = {"example": _requirement(condition="EXAMPLE must be at least 8 bytes.")}
    after = {"example": _requirement(condition="EXAMPLE must be at least 32 bytes.")}

    section = _render(before, after)

    assert "Changed requirements" in section
    assert "at least 8 bytes" in section
    assert "at least 32 bytes" in section


def test_retiming_a_requirement_is_announced_as_a_change():
    """Moving ``enforced_from`` edits the row, so the row diff catches this one."""
    before = {"example": _requirement(enforced_from="2.0.0")}
    after = {"example": _requirement(enforced_from="1.5.0")}

    section = _render(before, after)

    assert "Enforced from" in section
    assert "`2.0.0` → `1.5.0`" in section


def test_a_staged_requirement_coming_into_force_is_announced_on_an_unchanged_row():
    """The release that turns a warning into a refused boot is the dangerous one.

    Nothing about the requirement changes then. It was declared in an earlier release
    with a later ``enforced_from``, its documented row is byte-identical at both refs,
    and only the release version moves past the boundary — so a diff that compared rows
    alone would stay silent on exactly the release most likely to stop a deployment.
    """
    staged = {"example": _requirement(introduced_in="1.0.0", enforced_from="2.0.0")}

    section = diff.render(staged, staged, base_version="1.9.0", head_version="2.0.0")

    assert "Now enforced" in section
    assert "`example`" in section
    assert "enforced from 2.0.0" in section
    assert "Changed requirements" not in section


def test_a_requirement_that_is_still_staged_after_the_bump_stays_quiet():
    """The boundary, from the other side: a version bump is not by itself news."""
    staged = {"example": _requirement(introduced_in="1.0.0", enforced_from="2.0.0")}

    assert diff.render(staged, staged, base_version="1.0.0", head_version="1.9.0") == ""


def test_a_requirement_already_enforced_before_this_release_stays_quiet():
    already = {"example": _requirement(introduced_in="1.0.0", enforced_from="1.0.0")}

    assert (
        diff.render(already, already, base_version="1.5.0", head_version="2.0.0") == ""
    )


def test_an_unreadable_release_version_errs_toward_noise():
    """Silence here is the failure this script exists to prevent; noise is not."""
    staged = {"example": _requirement(enforced_from="2.0.0")}

    section = diff.render(staged, staged, base_version=None, head_version="2.0.0")

    assert "Now enforced" in section


def test_the_release_version_is_read_from_package_json():
    assert (
        diff.release_version("HEAD")
        == json.loads((_REPOSITORY_ROOT / "package.json").read_text(encoding="utf-8"))[
            "version"
        ]
    )


@pytest.mark.parametrize(
    "version", ["0.102.0", "1.2", "0.103.0.dev1", "unknown", "", None]
)
def test_the_version_reader_agrees_with_the_one_that_decides_severity(version):
    """The script duplicates ``_version_key`` to stay stdlib-only; pin them together.

    A release-PR notice that disagreed with the runtime about which release enforces a
    requirement would be worse than no notice at all.
    """
    expected = None if version is None else startup_requirements._version_key(version)

    assert diff._version_key(version) == expected


def test_a_removed_requirement_is_reported():
    section = _render({"example": _requirement()}, {})

    assert "Removed requirements" in section
    assert "`example`" in section


def test_the_notice_tells_the_reader_what_to_do_about_it():
    """A warning without the next action is one more thing to scroll past."""
    section = _render({}, {"example": _requirement()})

    assert "--check-config" in section
    assert "docs/src/startup-requirements.md" in section


def test_a_missing_page_on_the_base_ref_reports_everything_as_new():
    """The release that first introduces the page, and any unreadable base ref.

    Erring toward noise: a missed requirement is the expensive direction.
    """
    assert diff._parse(None) == {}
    assert "New requirements" in _render(diff._parse(None), {"e": _requirement()})
