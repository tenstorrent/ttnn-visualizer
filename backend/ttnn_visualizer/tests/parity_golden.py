# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""What the agent's parity goldens share: how each is written, held and read by its spec.

`test_agent_failure_parity.py` and `test_agent_perf_flags_parity.py` each write a golden
of a port's answers, and a spec in `tests/` holds the app's functions to it.

    pnpm run agent:parity-golden    <- regenerates every golden
"""

import json
import os
import re
from dataclasses import dataclass
from pathlib import Path

from ttnn_visualizer.utils import str_to_bool

_REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
_UPDATE = "UPDATE_AGENT_PARITY_GOLDEN"


def round_trip(value: object) -> object:
    """A value as a golden holds it, after JSON."""
    return json.loads(json.dumps(value))


@dataclass(frozen=True)
class Golden:
    """`tests/data/<name>.json`, and `tests/<name>.spec.ts` that reads it."""

    name: str

    @property
    def path(self) -> Path:
        return _REPOSITORY_ROOT / "tests" / "data" / f"{self.name}.json"

    @property
    def spec(self) -> Path:
        return _REPOSITORY_ROOT / "tests" / f"{self.name}.spec.ts"

    def check(self, generated: object) -> None:
        """Write the golden when asked to, then require the committed one to match."""
        held = round_trip(generated)
        text = json.dumps(held, separators=(",", ":")) + "\n"
        if str_to_bool(os.environ.get(_UPDATE, "false")):
            self.path.write_text(text)

        assert self.path.exists(), (
            f"Golden file missing: {self.path}. Generate it with "
            "pnpm run agent:parity-golden."
        )
        changed = (
            "A port's answers changed. If the app's functions changed too, regenerate "
            f"with pnpm run agent:parity-golden and check tests/{self.spec.name} passes."
        )
        committed = self.path.read_text()
        assert held == json.loads(committed), changed
        # As text too: a negative zero equals zero, and the app's spec tells them apart.
        assert text == committed, changed

    def check_spec_reads_it(self) -> None:
        assert re.search(
            rf"from '\./data/{re.escape(self.path.name)}'", self.spec.read_text()
        ), f"{self.spec.name} does not read {self.path.name}"
