# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Conditions on operator-supplied configuration that gate startup.

Why this is a registry rather than a handful of ``raise`` statements in
``create_app``: a requirement on operator configuration is the one class of change
this repository's tests *cannot* validate. Our suites check that a validator behaves
correctly given an input; the input comes from a deployment's environment, which lives
outside this repository. CI has nothing to compare against, so a change that makes a
previously-acceptable configuration fatal is invisible to it by construction. That is
what shipped in ``v0.102.0`` and restart-looped every hosted worker (#2004).

Three properties follow from declaring requirements as data, and none of them are
available to an inline ``raise``:

* **Tightening one is a visible diff.** ``tests/test_startup_requirements.py`` pins the
  whole registry against literals, so adding a requirement or moving a threshold fails
  CI until someone edits the pin — which is the moment to ask whether deployments that
  exist today already comply.
* **A new requirement can be staged.** ``enforced_from`` names the release the condition
  becomes fatal in; before it, the same condition logs a warning and the app starts. See
  :func:`severity_for` for the rollout convention.
* **The environment can be checked without starting the service.** ``evaluate`` runs
  against any config mapping, so ``ttnn-visualizer --check-config`` can answer "will this
  release boot here?" *before* a deploy stops the running one.

To add a requirement, append a :class:`StartupRequirement`, update the pin in
``tests/test_startup_requirements.py`` and the table in
``docs/src/startup-requirements.md`` (a parity test enforces both), and set
``enforced_from`` to a later release than the one you are shipping in unless you can
show every existing deployment already satisfies it.
"""

import logging
import sys
from dataclasses import dataclass
from enum import Enum
from typing import Any, Callable, List, Mapping, Optional, Sequence, TextIO, Tuple

from ttnn_visualizer.event_logging import UNKNOWN_VALUE, get_application_version
from ttnn_visualizer.settings import DEFAULT_SECRET_KEY, MIN_HOSTED_SECRET_KEY_BYTES
from ttnn_visualizer.utils import is_flag_enabled

logger = logging.getLogger(__name__)


class Severity(Enum):
    """What an unsatisfied requirement does to startup."""

    WARN = "warn"
    ERROR = "error"


@dataclass(frozen=True)
class StartupRequirement:
    """One condition on operator-supplied configuration, checked before serving.

    ``check`` returns ``None`` when satisfied, or the operator-facing message explaining
    what to set when it is not. It receives the resolved config as a mapping rather than
    reading the environment, so the same requirement can be evaluated against a running
    app's ``app.config``, a ``Config`` instance, or a dict in a test.
    """

    id: str
    env_vars: Tuple[str, ...]
    summary: str
    hosted_only: bool
    introduced_in: str
    enforced_from: str
    remedy: str
    check: Callable[[Mapping[str, Any]], Optional[str]]

    def applies_to(self, config: Mapping[str, Any]) -> bool:
        """Whether this requirement is in scope for the posture ``config`` describes.

        A hosted-only requirement is not merely skipped locally, it is *not a
        requirement* locally — a local install is expected to run on the development
        defaults. Reported as "not applicable" rather than "passed" so preflight output
        cannot be read as having cleared a hosted deployment it never checked.
        """
        if not self.hosted_only:
            return True

        return is_flag_enabled(config.get("SERVER_MODE", False))


@dataclass(frozen=True)
class Finding:
    """An unsatisfied requirement, with the severity this release applies to it."""

    requirement: StartupRequirement
    severity: Severity
    message: str

    @property
    def is_fatal(self) -> bool:
        return self.severity is Severity.ERROR


def _version_key(version: str) -> Optional[Tuple[int, ...]]:
    """Leading numeric components of a version, or ``None`` if there are none.

    Deliberately not ``packaging.version``: that arrives only as a transitive dependency
    here, and the comparison this needs is over our own ``MAJOR.MINOR.PATCH`` releases.
    Trailing non-numeric components are dropped rather than rejected so a local
    ``0.103.0.dev1`` build compares as ``0.103.0`` instead of falling into the unknown
    branch and being treated as fully enforced.
    """
    components: List[int] = []
    for part in str(version).split("."):
        if not part.isdigit():
            break

        components.append(int(part))

    return tuple(components) if components else None


def _at_least(version: str, floor: str) -> bool:
    """Whether ``version`` is at or past ``floor``, padding to a common length.

    ``None`` for ``version`` means we could not determine what release this is, and the
    answer is ``True``: see :func:`severity_for` for why unknown fails closed.
    """
    running = _version_key(version)
    required = _version_key(floor)
    if running is None or required is None:
        return True

    width = max(len(running), len(required))
    padded_running = running + (0,) * (width - len(running))
    padded_required = required + (0,) * (width - len(required))
    return padded_running >= padded_required


def severity_for(requirement: StartupRequirement, version: str) -> Severity:
    """Whether this release refuses to start on ``requirement``, or only complains.

    The rollout convention this implements: a *new* condition on operator configuration
    ships with ``enforced_from`` set to a later release than the one introducing it. In
    between, a deployment that does not comply starts and logs a warning on every boot,
    which is the window operators need to change a value that is provisioned outside
    this repository. Making a new condition immediately fatal takes that window away,
    and is what turned #2004 into an outage rather than a warning in a log.

    An unknown running version enforces. A hard failure with a clear message is
    recoverable; silently downgrading a security gate because we could not read our own
    version number is not, and in practice the version resolves from the installed
    distribution or ``package.json``, so this branch means something is already wrong.
    """
    if version == UNKNOWN_VALUE:
        return Severity.ERROR

    return (
        Severity.ERROR
        if _at_least(version, requirement.enforced_from)
        else Severity.WARN
    )


def _hosted_secret_key_failure(config: Mapping[str, Any]) -> Optional[str]:
    """Refuse a hosted start on a default, empty or obviously-short ``SECRET_KEY``.

    What makes the signed session cookie an integrity boundary across workers and
    restarts is that the key is *stable and non-default*; the byte floor contributes
    nothing to that property. The floor counts UTF-8 bytes rather than entropy, so it
    admits a short dictionary word as readily as a random value of the same size — it
    catches an unset or placeholder key, and nothing more. Do not read it as
    establishing key strength.

    #2002 tracks replacing the length test with a key-derivation step, which raises the
    cost of attacking a weak key without any deployment having to change the key it
    already has.
    """
    secret_key = config.get("SECRET_KEY")
    encoded = (
        secret_key
        if isinstance(secret_key, bytes)
        else str(secret_key or "").encode("utf-8")
    )
    if secret_key == DEFAULT_SECRET_KEY or len(encoded) < MIN_HOSTED_SECRET_KEY_BYTES:
        return (
            "SERVER_MODE requires SECRET_KEY to contain at least "
            f"{MIN_HOSTED_SECRET_KEY_BYTES} bytes and not use the development default"
        )

    return None


# Enforced from the release that introduced it, which the convention above says not to
# do — recorded honestly rather than backdated. It shipped that way in v0.102.0, took
# hosted down, and #2003 lowered the floor so existing deployments comply. Restaging it
# as a warning now would weaken a gate that deployments already satisfy, which is the
# opposite trade from the one the convention is about.
_HOSTED_SECRET_KEY = StartupRequirement(
    id="hosted-secret-key",
    env_vars=("SECRET_KEY",),
    summary=(
        f"Under SERVER_MODE, SECRET_KEY must be non-default and at least "
        f"{MIN_HOSTED_SECRET_KEY_BYTES} bytes."
    ),
    hosted_only=True,
    introduced_in="0.102.0",
    enforced_from="0.102.0",
    remedy=(
        "Set SECRET_KEY to a stable random value, the same one on every worker: "
        "python3 -c 'import secrets; print(secrets.token_urlsafe(48))'"
    ),
    check=_hosted_secret_key_failure,
)


STARTUP_REQUIREMENTS: Tuple[StartupRequirement, ...] = (_HOSTED_SECRET_KEY,)


def evaluate(
    config: Mapping[str, Any],
    *,
    version: Optional[str] = None,
    requirements: Sequence[StartupRequirement] = STARTUP_REQUIREMENTS,
) -> List[Finding]:
    """Every unsatisfied requirement in scope for ``config``, not just the first.

    Reporting all of them matters for preflight: an operator fixing a deployment one
    error per restart is the slow version of the incident this exists to prevent.
    """
    resolved_version = version if version is not None else get_application_version()

    findings = []
    for requirement in requirements:
        if not requirement.applies_to(config):
            continue

        failure = requirement.check(config)
        if failure is None:
            continue

        findings.append(
            Finding(
                requirement=requirement,
                severity=severity_for(requirement, resolved_version),
                message=failure,
            )
        )

    return findings


def enforce(
    config: Mapping[str, Any],
    *,
    version: Optional[str] = None,
    requirements: Sequence[StartupRequirement] = STARTUP_REQUIREMENTS,
) -> None:
    """Log staged requirements, and refuse the start if any enforced one is unmet.

    Raises with *every* fatal message rather than the first, so a boot log names
    everything that has to change instead of revealing the next problem on the next
    restart.
    """
    findings = evaluate(config, version=version, requirements=requirements)

    for finding in findings:
        if finding.is_fatal:
            continue

        logger.warning(
            "Startup requirement %r is not satisfied: %s This becomes a startup "
            "failure in %s. %s",
            finding.requirement.id,
            finding.message,
            finding.requirement.enforced_from,
            finding.requirement.remedy,
        )

    fatal = [finding for finding in findings if finding.is_fatal]
    if not fatal:
        return

    raise RuntimeError(
        "\n".join(
            f"{finding.message}. {finding.requirement.remedy}" for finding in fatal
        )
    )


def _posture(config: Mapping[str, Any]) -> str:
    return (
        "hosted (SERVER_MODE enabled)"
        if is_flag_enabled(config.get("SERVER_MODE", False))
        else "local (SERVER_MODE disabled)"
    )


def report(
    config: Mapping[str, Any],
    *,
    version: Optional[str] = None,
    requirements: Sequence[StartupRequirement] = STARTUP_REQUIREMENTS,
    stream: Optional[TextIO] = None,
) -> int:
    """Print every requirement's status and return a process exit code.

    The contract a deploy depends on is the exit code: ``0`` means this release's
    startup requirements are satisfied by this environment. Requirements that *pass* are
    printed too, so the output is evidence of what was checked rather than only of what
    broke — an empty report and a report of a posture with no applicable requirements
    are otherwise indistinguishable.
    """
    out = stream if stream is not None else sys.stdout
    resolved_version = version if version is not None else get_application_version()
    findings = {
        finding.requirement.id: finding
        for finding in evaluate(
            config, version=resolved_version, requirements=requirements
        )
    }

    print(f"ttnn-visualizer {resolved_version} startup requirements", file=out)
    print(f"Posture: {_posture(config)}", file=out)
    print("", file=out)

    for requirement in requirements:
        if not requirement.applies_to(config):
            print(f"  –  {requirement.id}: not applicable to this posture", file=out)
            continue

        finding = findings.get(requirement.id)
        if finding is None:
            print(f"  ✓  {requirement.id}: {requirement.summary}", file=out)
            continue

        marker = "❌" if finding.is_fatal else "⚠️ "
        print(f"  {marker} {requirement.id}: {finding.message}", file=out)
        print(f"      Set: {', '.join(requirement.env_vars)}", file=out)
        print(f"      {requirement.remedy}", file=out)
        if not finding.is_fatal:
            print(
                f"      Starts with a warning today; fails to start from "
                f"{requirement.enforced_from}.",
                file=out,
            )

    fatal = [finding for finding in findings.values() if finding.is_fatal]
    print("", file=out)
    if fatal:
        print(
            f"❌ {len(fatal)} unmet requirement(s). This release will NOT start in "
            "this environment.",
            file=out,
        )
        return 1

    staged = len(findings) - len(fatal)
    if staged:
        print(
            f"⚠️  Starts, with {staged} requirement(s) not yet satisfied that a later "
            "release will enforce.",
            file=out,
        )
    else:
        print("✓ This release's startup requirements are satisfied.", file=out)

    return 0
