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
#
# ``summary`` and ``remedy`` are pinned as literals rather than skipped as prose: they
# are the whole of what an operator is told, in the preflight report and in the
# documentation table, so a threshold that moves in them has moved for the audience that
# has to act on it.
_PINNED_REGISTRY = {
    "hosted-secret-key": {
        "env_vars": ("SECRET_KEY",),
        "hosted_only": True,
        "introduced_in": "0.102.0",
        "enforced_from": "0.102.0",
        "summary": (
            "Under SERVER_MODE, SECRET_KEY must be non-default and at least 8 bytes."
        ),
        "remedy": (
            "Set SECRET_KEY to a stable random value, the same one on every worker: "
            "python3 -c 'import secrets; print(secrets.token_urlsafe(48))'"
        ),
    },
}

# What each registered checker accepts and rejects, as literal inputs. Metadata alone is
# not the requirement: a validator can be tightened while ``env_vars``, ``hosted_only``
# and both release fields stay byte-identical, and the pin above, the docs-parity test
# and the release diff would all stay quiet. These vectors are what makes "tightening a
# requirement fails CI" true of the condition itself rather than only of its label.
#
# Written as literals for the reason in #2004: every SECRET_KEY case was once spelled
# ``"x" * MIN_HOSTED_SECRET_KEY_BYTES``, so when #2003 moved the constant, none of them
# failed. A vector derived from the thing under test cannot detect a change to it.
_PINNED_BEHAVIOUR = {
    "hosted-secret-key": {
        "rejected": (
            {},
            {"SECRET_KEY": None},
            {"SECRET_KEY": ""},
            {"SECRET_KEY": DEFAULT_SECRET_KEY},
            {"SECRET_KEY": "k" * 7},
            {"SECRET_KEY": b"k" * 7},
        ),
        "accepted": (
            {"SECRET_KEY": "k" * 8},
            {"SECRET_KEY": b"k" * 8},
            {"SECRET_KEY": "H4sBq2wXm9ZrT7vN1cKdLpYeUg3fRjA8"},
        ),
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

_BEHAVIOUR_CHANGED = """
A registered checker no longer accepts and rejects what this test pins it to.

The registry metadata can be identical and still describe a different condition —
`env_vars`, `hosted_only`, `introduced_in` and `enforced_from` say nothing about where
a validator draws its line. If you moved that line, the question in _REGISTRY_CHANGED
applies unchanged:

    Does every deployment that exists today already satisfy this condition?

A tightened validator is a new requirement wearing the old one's metadata. Stage it the
same way: give it a later `enforced_from` unless you can show every deployment complies.

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
            "summary": requirement.summary,
            "remedy": requirement.remedy,
        }
        for requirement in STARTUP_REQUIREMENTS
    }

    assert declared == _PINNED_REGISTRY, _REGISTRY_CHANGED


def test_every_registered_checker_has_pinned_input_vectors():
    """A requirement added without vectors is a condition nothing in CI describes.

    The metadata pin would still fail for it — but its failure message asks whether
    deployments comply with a *summary*, and the summary is not what runs at boot.
    """
    assert {requirement.id for requirement in STARTUP_REQUIREMENTS} == set(
        _PINNED_BEHAVIOUR
    ), _BEHAVIOUR_CHANGED

    for requirement_id, vectors in _PINNED_BEHAVIOUR.items():
        assert vectors["accepted"], f"{requirement_id} pins no accepted input"
        assert vectors["rejected"], f"{requirement_id} pins no rejected input"


def _pinned_vectors():
    for requirement_id, vectors in _PINNED_BEHAVIOUR.items():
        for outcome, accepted in (("accepted", True), ("rejected", False)):
            for index, config in enumerate(vectors[outcome]):
                yield pytest.param(
                    requirement_id,
                    config,
                    accepted,
                    id=f"{requirement_id}-{outcome}-{index}",
                )


@pytest.mark.parametrize("requirement_id, config, accepted", list(_pinned_vectors()))
def test_each_registered_checker_matches_its_pinned_vectors(
    requirement_id, config, accepted
):
    """Where each validator actually draws its line, pinned against literal inputs.

    This is the case #2003 needed and did not have: the floor moved, every derived
    assertion moved with it, and nothing failed. The 7-byte and 8-byte vectors above are
    the boundary as a policy decision, written as the numbers they are.
    """
    requirement = {candidate.id: candidate for candidate in STARTUP_REQUIREMENTS}[
        requirement_id
    ]

    assert (requirement.check(config) is None) is accepted, _BEHAVIOUR_CHANGED


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


@pytest.mark.parametrize(
    "field, value",
    [
        # Parses to nothing, so `_at_least` would answer True for either side and a
        # requirement meant to be staged would ship fatal.
        ("enforced_from", "next"),
        ("enforced_from", "TBD"),
        ("enforced_from", ""),
        # Worse than unparseable: truncates to `1` and silently compares as `1.0.0`.
        ("enforced_from", "1.x.0"),
        ("enforced_from", "0.103.0.dev1"),
        ("introduced_in", "next"),
        ("introduced_in", "1.x.0"),
        ("enforced_from", None),
        ("introduced_in", 1.0),
    ],
)
def test_registry_metadata_that_does_not_name_a_release_is_refused(field, value):
    """Leniency about the running version must not extend to these two literals.

    `_version_key` drops trailing non-numeric components so a local `0.103.0.dev1`
    build compares as the release it precedes. Applied to registry metadata the same
    leniency decides, without saying so, whether a requirement is fatal — which is the
    #2004 failure with a typo in place of a review oversight.
    """
    with pytest.raises(ValueError, match="does not name a release"):
        _requirement(**{field: value})


def test_a_requirement_cannot_be_enforced_before_it_was_introduced():
    """Structural, not merely asserted over the registry: the object cannot exist."""
    with pytest.raises(ValueError, match="precedes introduced_in"):
        _requirement(introduced_in="2.0.0", enforced_from="1.0.0")


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


def test_the_hosted_secret_key_requirement_is_wired_into_the_registry_as_fatal():
    """What the checker decides is pinned by the vectors above; this is the wiring.

    That the entry is reached through ``evaluate`` at all, in hosted posture, and that
    this release treats it as fatal rather than staged.
    """
    findings = evaluate({"SERVER_MODE": True, "SECRET_KEY": DEFAULT_SECRET_KEY})

    assert [finding.requirement.id for finding in findings] == ["hosted-secret-key"]
    assert findings[0].is_fatal


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


def test_the_hosted_secret_key_floor_constant_matches_the_pinned_boundary():
    """Fails if the constant moves away from the boundary pinned in _PINNED_BEHAVIOUR.

    The two live together deliberately: the vectors catch a validator that stops
    honouring the floor, and this catches a floor that changes without the vectors
    being reconsidered. Changing the floor means editing both, which is the point —
    it is a policy decision, currently a stopgap pending #2002.
    """
    assert MIN_HOSTED_SECRET_KEY_BYTES == 8
