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
import re
import sys
from dataclasses import dataclass
from enum import Enum
from typing import Any, Callable, List, Mapping, Optional, Sequence, TextIO, Tuple

from ttnn_visualizer.event_logging import UNKNOWN_VALUE, get_application_version
from ttnn_visualizer.settings import DEFAULT_SECRET_KEY, MIN_HOSTED_SECRET_KEY_BYTES
from ttnn_visualizer.utils import is_flag_enabled

logger = logging.getLogger(__name__)

# Registry metadata names one of our own releases, and is held to that exactly. See
# :meth:`StartupRequirement.__post_init__` for why this is stricter than
# :func:`_version_key`, which reads the *running* version.
_RELEASE_PATTERN = re.compile(r"^\d+\.\d+\.\d+$")


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

    def __post_init__(self) -> None:
        """Reject metadata that does not name a release, at import rather than at boot.

        ``_version_key`` is deliberately lenient, because the *running* version can be a
        local build like ``0.103.0.dev1``. That leniency must not reach these two fields.
        An ``enforced_from`` of ``"next"`` parses to nothing, :func:`_at_least` answers
        ``True`` for an unparseable side, and a requirement someone meant to stage ships
        fatal — #2004 reintroduced by a typo. ``"1.x.0"`` is quieter still: it truncates
        to ``1`` and compares as ``1.0.0``, so it is wrong without ever looking unset.

        Failing closed is the right answer for a version we read at runtime and cannot
        parse. It is the wrong answer for a literal in this file, which a person wrote
        and CI can reject outright.
        """
        for field in ("introduced_in", "enforced_from"):
            value = getattr(self, field)
            if not isinstance(value, str) or not _RELEASE_PATTERN.match(value):
                raise ValueError(
                    f"{self.id}: {field} is {value!r}, which does not name a release. "
                    "Startup-requirement metadata must be an exact MAJOR.MINOR.PATCH "
                    "version; anything else silently decides whether this requirement "
                    "is fatal."
                )

        if not _at_least(self.enforced_from, self.introduced_in):
            raise ValueError(
                f"{self.id}: enforced_from {self.enforced_from} precedes introduced_in "
                f"{self.introduced_in}. A requirement cannot be fatal in a release that "
                "shipped before it existed."
            )

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
    """Leading numeric components of the *running* version, or ``None`` if none.

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

    ``floor`` comes from registry metadata, which
    :meth:`StartupRequirement.__post_init__` has already held to an exact
    ``MAJOR.MINOR.PATCH``, so only ``version`` — read at runtime — can be unparseable.
    That case answers ``True``: see :func:`severity_for` for why unknown fails closed.
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
    """Refuse a hosted start on a ``SECRET_KEY`` that is the default, or short trimmed.

    What makes the signed session cookie an integrity boundary across workers and
    restarts is that the key is *stable and non-default*; the byte floor contributes
    nothing to that property. The floor counts UTF-8 bytes rather than entropy, so it
    admits a short dictionary word as readily as a random value of the same size — it
    catches an unset or placeholder key, and nothing more. Do not read it as
    establishing key strength.

    The default clause is load-bearing only if ``MIN_HOSTED_SECRET_KEY_BYTES`` drops
    below six or ``DEFAULT_SECRET_KEY`` grows: at five bytes against a floor of eight,
    the default already fails on length, so nothing observable rests on the clause
    today. It stays because #2002 may move or remove the floor, and
    ``test_the_development_default_is_refused_independently_of_the_floor`` patches the
    floor down to keep it honest in the meantime.

    The floor measures what survives a trim, because eight spaces are not a short key
    but are not a key at all. The trim decides admission only — Flask signs with the
    configured value, whitespace included, so ``"key12345"`` and ``" key12345 "`` stay
    two different signing keys whose cookies do not interchange. Normalising the value
    itself would rotate the key for every deployment carrying stray whitespace, which
    is the session loss this check exists to avoid.

    Which whitespace trims is a consequence of that ordering rather than a property of
    trimming. A ``str`` — every operator-facing path, since ``os.getenv`` returns one —
    is trimmed before encoding, so everything ``str.isspace`` accepts goes, including
    non-breaking and ideographic spaces. A ``bytes`` or ``bytearray`` key, reachable
    only through ``settings_override``, loses exactly the six bytes in
    ``b" \t\n\r\x0b\x0c"``, because arbitrary bytes cannot be decoded to find the rest.
    A byte-order mark is not whitespace to Python on either path, so a run of U+FEFF
    counts toward the floor whatever the type.

    #2002 tracks replacing the length test with a key-derivation step, which raises the
    cost of attacking a weak key without any deployment having to change the key it
    already has.
    """
    secret_key = config.get("SECRET_KEY")
    trimmed = (
        bytes(secret_key).strip()
        if isinstance(secret_key, (bytes, bytearray))
        else str(secret_key or "").strip().encode("utf-8")
    )
    if (
        trimmed == DEFAULT_SECRET_KEY.encode("utf-8")
        or len(trimmed) < MIN_HOSTED_SECRET_KEY_BYTES
    ):
        return (
            "SERVER_MODE requires SECRET_KEY to contain at least "
            f"{MIN_HOSTED_SECRET_KEY_BYTES} bytes excluding surrounding whitespace, "
            "and not use the development default"
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
        "Under SERVER_MODE, SECRET_KEY must be non-default and at least "
        f"{MIN_HOSTED_SECRET_KEY_BYTES} bytes excluding surrounding whitespace."
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
