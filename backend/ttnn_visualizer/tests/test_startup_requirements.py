# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Pins the startup-requirement registry and the staged-rollout machinery.

The registry pin below is the point of this file. Everything else verifies that the
mechanism works; the pin is what makes a change to *policy* — a new condition on
operator configuration, or a tightened threshold — fail CI in a place whose failure
message asks the question review did not ask in #2004.
"""

import io
import logging
from typing import Any, Dict

import pytest
from ttnn_visualizer.event_logging import UNKNOWN_VALUE
from ttnn_visualizer.settings import DEFAULT_SECRET_KEY, MIN_HOSTED_SECRET_KEY_BYTES
from ttnn_visualizer.startup_requirements import (
    STARTUP_REQUIREMENTS,
    Severity,
    StartupRequirement,
    _at_least,
    _version_key,
    enforce,
    evaluate,
    report,
    severity_for,
)

# Every requirement, spelled out. Deriving this from ``STARTUP_REQUIREMENTS`` would make
# the test agree with whatever the registry says and detect nothing — the exact failure
# that let #2003 move the SECRET_KEY floor without a single case failing.
_PINNED_REGISTRY = {
    "hosted-secret-key": {
        "env_vars": ("SECRET_KEY",),
        "hosted_only": True,
        "introduced_in": "0.102.0",
        "enforced_from": "0.102.0",
    },
}

_REGISTRY_CHANGED = """
The declared startup requirements no longer match the pin in this test.

If you are adding a requirement, or making an existing one stricter, answer this
before updating the pin:

    Does every deployment that exists today already satisfy this condition?

You cannot answer it from this repository. SECRET_KEY, and every value like it, is
provisioned outside it, so CI supplies a conforming value and the suite passes no
matter what real deployments hold. That is how v0.102.0 shipped a requirement no
hosted deployment met and restart-looped every worker (#2004).

If the answer is no, or you do not know, set `enforced_from` to a later release than
the one you are shipping in. The condition then logs a warning and the app starts,
which is the window operators need to change a value they provision elsewhere.

See docs/src/startup-requirements.md.
"""


def _requirement(**overrides) -> StartupRequirement:
    """A throwaway requirement, so mechanism tests don't depend on registry contents."""
    fields: Dict[str, Any] = {
        "id": "test-requirement",
        "env_vars": ("TEST_VAR",),
        "summary": "TEST_VAR must be set.",
        "hosted_only": False,
        "introduced_in": "1.0.0",
        "enforced_from": "1.0.0",
        "remedy": "Set TEST_VAR.",
        "check": lambda config: None if config.get("TEST_VAR") else "TEST_VAR is unset",
    }
    fields.update(overrides)
    return StartupRequirement(**fields)


def test_the_declared_requirements_match_the_pin():
    declared = {
        requirement.id: {
            "env_vars": requirement.env_vars,
            "hosted_only": requirement.hosted_only,
            "introduced_in": requirement.introduced_in,
            "enforced_from": requirement.enforced_from,
        }
        for requirement in STARTUP_REQUIREMENTS
    }

    assert declared == _PINNED_REGISTRY, _REGISTRY_CHANGED


def test_every_requirement_is_enforced_no_earlier_than_it_was_introduced():
    """A requirement cannot be fatal in a release that predates it.

    The reverse ordering would describe a condition retroactively enforced against
    releases shipped before it existed, which is not a thing the rollout can mean.
    """
    for requirement in STARTUP_REQUIREMENTS:
        assert _at_least(requirement.enforced_from, requirement.introduced_in), (
            f"{requirement.id} claims to be enforced from "
            f"{requirement.enforced_from}, before it was introduced in "
            f"{requirement.introduced_in}"
        )


def test_every_requirement_names_the_variables_an_operator_must_set():
    for requirement in STARTUP_REQUIREMENTS:
        assert requirement.env_vars, f"{requirement.id} names no environment variable"
        assert requirement.remedy.strip(), f"{requirement.id} offers no remedy"


@pytest.mark.parametrize(
    "version, expected",
    [
        ("0.102.0", (0, 102, 0)),
        ("1.2", (1, 2)),
        # A local build's suffix compares as the release it is a pre-release of rather
        # than falling into the unknown branch and being treated as fully enforced.
        ("0.103.0.dev1", (0, 103, 0)),
        ("unknown", None),
        ("", None),
    ],
)
def test_version_key_reads_leading_numeric_components(version, expected):
    assert _version_key(version) == expected


@pytest.mark.parametrize(
    "version, floor, expected",
    [
        ("0.102.0", "0.102.0", True),
        ("0.103.0", "0.102.0", True),
        ("0.101.9", "0.102.0", False),
        # Padding, so a two-component version is comparable with a three-component one.
        ("1.0", "1.0.0", True),
        ("1.0", "1.0.1", False),
        # Numeric, not lexicographic: "0.9.0" must not sort above "0.102.0".
        ("0.9.0", "0.102.0", False),
        ("unknown", "0.102.0", True),
    ],
)
def test_at_least_compares_versions_numerically(version, floor, expected):
    assert _at_least(version, floor) is expected


def test_a_requirement_not_yet_due_only_warns():
    """The rollout window: declared now, fatal later, app starts in between."""
    staged = _requirement(introduced_in="1.0.0", enforced_from="2.0.0")

    assert severity_for(staged, "1.0.0") is Severity.WARN
    assert severity_for(staged, "1.5.0") is Severity.WARN
    assert severity_for(staged, "2.0.0") is Severity.ERROR


def test_an_unknown_running_version_enforces_everything():
    """Fails closed: a version we cannot read must not silently relax a gate."""
    staged = _requirement(enforced_from="99.0.0")

    assert severity_for(staged, UNKNOWN_VALUE) is Severity.ERROR


def test_enforce_starts_the_app_when_a_staged_requirement_is_unmet(caplog):
    staged = _requirement(enforced_from="2.0.0")

    with caplog.at_level(logging.WARNING):
        enforce({}, version="1.0.0", requirements=[staged])

    assert "test-requirement" in caplog.text
    assert "2.0.0" in caplog.text
    assert "Set TEST_VAR." in caplog.text


def test_enforce_refuses_the_start_once_a_requirement_is_due():
    with pytest.raises(RuntimeError, match="TEST_VAR is unset"):
        enforce({}, version="2.0.0", requirements=[_requirement(enforced_from="2.0.0")])


def test_enforce_names_every_unmet_requirement_rather_than_the_first():
    """So a boot log lists everything to fix, not the next thing to discover."""
    first = _requirement(id="first", check=lambda config: "first is unset")
    second = _requirement(id="second", check=lambda config: "second is unset")

    with pytest.raises(RuntimeError) as failure:
        enforce({}, version="1.0.0", requirements=[first, second])

    assert "first is unset" in str(failure.value)
    assert "second is unset" in str(failure.value)


def test_a_hosted_only_requirement_is_not_evaluated_locally():
    hosted = _requirement(hosted_only=True, check=lambda config: "always fails")

    assert (
        evaluate({"SERVER_MODE": False}, version="1.0.0", requirements=[hosted]) == []
    )
    assert evaluate({"SERVER_MODE": True}, version="1.0.0", requirements=[hosted])


def test_report_exits_zero_when_the_environment_satisfies_the_release():
    stream = io.StringIO()

    exit_code = report(
        {"TEST_VAR": "set"},
        version="1.0.0",
        requirements=[_requirement()],
        stream=stream,
    )

    assert exit_code == 0
    assert "✓ This release's startup requirements are satisfied." in stream.getvalue()


def test_report_exits_nonzero_when_the_release_would_not_start():
    stream = io.StringIO()

    exit_code = report(
        {}, version="1.0.0", requirements=[_requirement()], stream=stream
    )

    assert exit_code == 1
    assert "will NOT start" in stream.getvalue()


def test_report_exits_zero_but_warns_for_a_requirement_that_is_not_yet_due():
    stream = io.StringIO()

    exit_code = report(
        {},
        version="1.0.0",
        requirements=[_requirement(enforced_from="2.0.0")],
        stream=stream,
    )

    assert exit_code == 0
    assert "fails to start from 2.0.0" in stream.getvalue()


def test_report_distinguishes_a_skipped_requirement_from_a_satisfied_one():
    """An operator must not read "checked nothing" as "cleared"."""
    stream = io.StringIO()

    report(
        {"SERVER_MODE": False},
        version="1.0.0",
        requirements=[_requirement(hosted_only=True)],
        stream=stream,
    )

    assert "not applicable to this posture" in stream.getvalue()


@pytest.mark.parametrize(
    "secret_key",
    [None, "", DEFAULT_SECRET_KEY, "short", b"short"],
)
def test_the_hosted_secret_key_requirement_refuses_an_insecure_value(secret_key):
    findings = evaluate({"SERVER_MODE": True, "SECRET_KEY": secret_key})

    assert [finding.requirement.id for finding in findings] == ["hosted-secret-key"]
    assert findings[0].is_fatal


def test_the_hosted_secret_key_requirement_accepts_a_conforming_value():
    assert evaluate({"SERVER_MODE": True, "SECRET_KEY": "x" * 8}) == []


def test_a_local_install_keeps_the_development_secret_key():
    """The floor is a hosted condition; a local install runs on the default."""
    assert evaluate({"SERVER_MODE": False, "SECRET_KEY": DEFAULT_SECRET_KEY}) == []

    enforce({"SERVER_MODE": False, "SECRET_KEY": DEFAULT_SECRET_KEY})


def test_enforcing_the_hosted_secret_key_requirement_raises_the_documented_message():
    """The wording is load-bearing: `.env.sample` and the docs quote the byte count.

    Asserted against the real registry entry rather than a throwaway one, because this
    is the message an operator reads out of a boot log at the worst possible moment.
    """
    with pytest.raises(RuntimeError, match="SERVER_MODE requires SECRET_KEY"):
        enforce({"SERVER_MODE": True, "SECRET_KEY": DEFAULT_SECRET_KEY})


@pytest.mark.parametrize("length, accepted", [(7, False), (8, True)])
def test_the_hosted_secret_key_floor_is_pinned_with_literals(length, accepted):
    """Pins the floor with literals rather than deriving it from the constant.

    Written as ``MIN_HOSTED_SECRET_KEY_BYTES - 1`` and ``MIN_HOSTED_SECRET_KEY_BYTES``,
    these cases would move with the constant and keep passing — the failure mode the
    test exists to prevent, and the one that let #2003 change the floor without a
    single case failing. See #2004.
    """
    findings = evaluate({"SERVER_MODE": True, "SECRET_KEY": "k" * length})

    assert (findings == []) is accepted


def test_the_hosted_secret_key_floor_constant_matches_the_pinned_boundary():
    """Fails if the constant moves away from the boundary pinned above.

    The two live together deliberately: the literals catch a validator that stops
    honouring the floor, and this catches a floor that changes without the literals
    being reconsidered. Changing the floor means editing both, which is the point —
    it is a policy decision, currently a stopgap pending #2002.
    """
    assert MIN_HOSTED_SECRET_KEY_BYTES == 8
