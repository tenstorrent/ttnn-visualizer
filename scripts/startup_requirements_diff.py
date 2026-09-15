# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Report startup requirements that changed between two refs, as Markdown.

Nothing in the release flow says "this version needs configuration the last one did
not". The `v0.102.0` requirement *was* documented — in three files, with rationale —
and still reached production unnoticed, because nothing put it in front of the person
shipping the release (#2004). Documentation that has to be gone looking for is not a
release control.

The release PR runs this against `main..dev` and pastes the result into the PR body, so
a new or tightened requirement arrives as a heading on the thing a human is already
reading before they publish.

Comparing the rows is not enough. A requirement staged in `1.0.0` with
`enforced_from: 2.0.0` has a byte-identical row in both refs, so the release that bumps
the version to `2.0.0` — the release on which it stops being a warning and starts
refusing boots — would change nothing this script could see. It therefore reads the
release version at each ref too, and announces every requirement whose enforcement
boundary the release crosses, changed row or not.

It reads the operator-facing table in ``docs/src/startup-requirements.md`` rather than
importing the registry, because that table is checked against the registry by
``test_startup_requirements_docs_parity.py`` and can be read out of an arbitrary git ref
with no checkout, install or import of that revision's code.

Usage:
    python3 scripts/startup_requirements_diff.py --base origin/main --head HEAD
"""

import argparse
import json
import re
import subprocess
import sys
from typing import Dict, List, NamedTuple, Optional, Tuple

DOCS_PATH = "docs/src/startup-requirements.md"
# The release version of record, read at each ref for the same reason the table is:
# no checkout, install or import of that revision.
VERSION_PATH = "package.json"
_LEADING_DIGITS = re.compile(r"\d+")

_ROW = re.compile(
    r"^\| `(?P<id>[a-z0-9-]+)` \| (?P<env_vars>.+?) \| (?P<condition>.+?) \| "
    r"(?P<introduced_in>.+?) \| (?P<enforced_from>.+?) \| (?P<posture>.+?) \|$",
    re.MULTILINE,
)


class Requirement(NamedTuple):
    id: str
    env_vars: str
    condition: str
    introduced_in: str
    enforced_from: str
    posture: str


def _read_at_ref(ref: str, path: str) -> Optional[str]:
    """The file's contents at ``ref``, or ``None`` if it did not exist there.

    A missing file is the expected state for the release that first introduces this
    page, not an error — every requirement is then new. An unreadable base ref lands in
    the same branch and reports everything as new, which is noise rather than silence:
    this control exists because a missed requirement is the expensive direction.
    """
    result = subprocess.run(
        ["git", "show", f"{ref}:{path}"],
        capture_output=True,
        text=True,
        check=False,
    )
    return result.stdout if result.returncode == 0 else None


def _parse(source: Optional[str]) -> Dict[str, Requirement]:
    if not source:
        return {}

    return {
        match.group("id"): Requirement(**match.groupdict())
        for match in _ROW.finditer(source)
    }


def release_version(ref: str) -> Optional[str]:
    """The release version declared at ``ref``, or ``None`` if it cannot be read.

    ``package.json`` is the version of record the backend itself falls back to
    (``read_version_from_package_json``), and it is the number that ends up in
    ``get_application_version`` — which is what decides whether a requirement is fatal.
    """
    source = _read_at_ref(ref, VERSION_PATH)
    if not source:
        return None

    try:
        version = json.loads(source)["version"]
    except (ValueError, KeyError, TypeError):
        return None

    return version if isinstance(version, str) else None


def _version_key(version: Optional[str]) -> Optional[Tuple[int, ...]]:
    """Leading numeric components, mirroring ``startup_requirements._version_key``.

    Duplicated rather than imported on purpose: this script runs from a bare checkout in
    the release workflow, with no virtualenv and nothing installed, so it stays on the
    standard library. ``test_startup_requirements_release_diff.py`` pins the two to the
    same answers.
    """
    if version is None:
        return None

    components: List[int] = []
    for part in str(version).split("."):
        leading = _LEADING_DIGITS.match(part)
        if leading is None:
            break

        components.append(int(leading.group()))
        if leading.end() != len(part):
            break

    return tuple(components) if components else None


def _at_least(version: Optional[str], floor: str) -> Optional[bool]:
    """Whether ``version`` is at or past ``floor``, or ``None`` if unanswerable."""
    running = _version_key(version)
    required = _version_key(floor)
    if running is None or required is None:
        return None

    width = max(len(running), len(required))
    return running + (0,) * (width - len(running)) >= required + (0,) * (
        width - len(required)
    )


def _newly_enforced(
    requirement: Requirement,
    base_version: Optional[str],
    head_version: Optional[str],
) -> bool:
    """Whether this release is the one on which ``requirement`` starts refusing boots.

    Unanswerable — an unreadable version at either ref, or an ``enforced_from`` the
    table does not state as a release — counts as crossed. The same trade as an
    unreadable base ref elsewhere in this script: a release PR that names a requirement
    it did not need to is noise, and one that stays silent on a requirement that just
    became fatal is #2004.
    """
    was_enforced = _at_least(base_version, requirement.enforced_from)
    is_enforced = _at_least(head_version, requirement.enforced_from)
    if was_enforced is None or is_enforced is None:
        return True

    return is_enforced and not was_enforced


def _describe_change(before: Requirement, after: Requirement) -> List[str]:
    """The fields that moved, named so a reader need not diff the rows themselves."""
    labels = {
        "env_vars": "Environment variables",
        "condition": "Condition",
        "introduced_in": "Introduced in",
        "enforced_from": "Enforced from",
        "posture": "Posture",
    }

    return [
        f"{label}: `{getattr(before, field)}` → `{getattr(after, field)}`"
        for field, label in labels.items()
        if getattr(before, field) != getattr(after, field)
    ]


def render(
    base: Dict[str, Requirement],
    head: Dict[str, Requirement],
    *,
    base_version: Optional[str],
    head_version: Optional[str],
) -> str:
    """The Markdown section, or an empty string when nothing changed.

    Empty rather than "no changes" so the caller can append unconditionally and the PR
    body stays quiet on the releases — most of them — that demand nothing of operators.

    The versions are what let a *silent* change be reported: a staged requirement's row
    does not move on the release that brings it into force, only the release number
    does.
    """
    added = [head[key] for key in head if key not in base]
    changed = [
        (base[key], head[key]) for key in head if key in base and base[key] != head[key]
    ]
    removed = [base[key] for key in base if key not in head]
    # Reported separately from ``added``, whose bullets already state whether this
    # release enforces them, so this section is exactly the set a row diff cannot see.
    newly_enforced = [
        head[key]
        for key in head
        if key in base and _newly_enforced(head[key], base_version, head_version)
    ]

    if not (added or changed or removed or newly_enforced):
        return ""

    lines = [
        "## ⚠️ Startup requirements changed",
        "",
        "This release changes what it demands of a deployment's environment. A "
        "deployment that does not satisfy an **enforced** requirement will not start.",
        "",
        "Run `ttnn-visualizer --check-config` against each target environment before "
        "deploying — see "
        "[docs/src/startup-requirements.md](docs/src/startup-requirements.md).",
        "",
    ]

    if added:
        lines.append("### New requirements")
        lines.append("")
        for requirement in added:
            enforced = _at_least(head_version, requirement.enforced_from)
            timing = (
                f"**Fatal in this release** (enforced from {requirement.enforced_from})."
                if enforced is not False
                else f"Warns until {requirement.enforced_from}."
            )
            lines.append(
                f"- **`{requirement.id}`** ({requirement.env_vars}) — "
                f"{requirement.condition} _{timing}_"
            )
        lines.append("")

    if newly_enforced:
        lines.append("### Now enforced")
        lines.append("")
        lines.append(
            "Declared in an earlier release and staged as a warning. **This release is "
            "the one they stop the app on.** Their documented rows are unchanged, so "
            "nothing else in this diff names them."
        )
        lines.append("")
        for requirement in newly_enforced:
            lines.append(
                f"- **`{requirement.id}`** ({requirement.env_vars}) — "
                f"{requirement.condition} "
                f"_Introduced in {requirement.introduced_in}, enforced from "
                f"{requirement.enforced_from}._"
            )
        lines.append("")

    if changed:
        lines.append("### Changed requirements")
        lines.append("")
        for before, after in changed:
            lines.append(f"- **`{after.id}`**")
            for change in _describe_change(before, after):
                lines.append(f"  - {change}")
        lines.append("")

    if removed:
        lines.append("### Removed requirements")
        lines.append("")
        for requirement in removed:
            lines.append(f"- **`{requirement.id}`** ({requirement.env_vars})")
        lines.append("")

    return "\n".join(lines).rstrip() + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default="origin/main", help="Ref to compare from")
    parser.add_argument("--head", default="HEAD", help="Ref to compare to")
    parser.add_argument("--output", help="Write to this path instead of stdout")
    args = parser.parse_args()

    section = render(
        _parse(_read_at_ref(args.base, DOCS_PATH)),
        _parse(_read_at_ref(args.head, DOCS_PATH)),
        base_version=release_version(args.base),
        head_version=release_version(args.head),
    )

    if args.output:
        # Written only when there is something to say, so the caller can test for a
        # non-empty file rather than parsing this script's output.
        if section:
            with open(args.output, "w", encoding="utf-8") as handle:
                handle.write(section)
    else:
        sys.stdout.write(section)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
