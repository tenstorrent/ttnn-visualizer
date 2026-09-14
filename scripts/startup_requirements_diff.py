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

It reads the operator-facing table in ``docs/src/startup-requirements.md`` rather than
importing the registry, because that table is checked against the registry by
``test_startup_requirements_docs_parity.py`` and can be read out of an arbitrary git ref
with no checkout, install or import of that revision's code.

Usage:
    python3 scripts/startup_requirements_diff.py --base origin/main --head HEAD
"""

import argparse
import re
import subprocess
import sys
from typing import Dict, List, NamedTuple, Optional

DOCS_PATH = "docs/src/startup-requirements.md"

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


def render(base: Dict[str, Requirement], head: Dict[str, Requirement]) -> str:
    """The Markdown section, or an empty string when nothing changed.

    Empty rather than "no changes" so the caller can append unconditionally and the PR
    body stays quiet on the releases — most of them — that demand nothing of operators.
    """
    added = [head[key] for key in head if key not in base]
    changed = [
        (base[key], head[key]) for key in head if key in base and base[key] != head[key]
    ]
    removed = [base[key] for key in base if key not in head]

    if not (added or changed or removed):
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
            lines.append(
                f"- **`{requirement.id}`** ({requirement.env_vars}) — "
                f"{requirement.condition} "
                f"_Enforced from {requirement.enforced_from}._"
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
