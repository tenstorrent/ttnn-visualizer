# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Pins the SPA's hosted upload cap against the backend's.

The client uses its copy for the dev branch of ``getServerConfig`` and its pre-upload
size check, while Flask enforces its own. Nothing at runtime reports a divergence: a
larger client value starts uploads the server refuses, a smaller one refuses uploads the
server would accept. Follows the pattern ``test_event_logging_frontend_parity.py``
established.
"""

import math
import re
from pathlib import Path

from ttnn_visualizer.settings import _HOSTED_DEFAULT_MAX_CONTENT_LENGTH

_PROJECT_ROOT = Path(__file__).resolve().parents[3]
_DEFINITIONS = _PROJECT_ROOT / "src" / "definitions" / "ServerConfig.ts"


def test_the_hosted_default_upload_cap_matches_the_frontend_copy():
    source = _DEFINITIONS.read_text(encoding="utf-8")
    declared = re.search(
        r"export const HOSTED_DEFAULT_MAX_CONTENT_LENGTH = ([\d\s*]+);", source
    )

    assert declared is not None, (
        f"No HOSTED_DEFAULT_MAX_CONTENT_LENGTH written as a product of integers "
        f"in {_DEFINITIONS.name}"
    )

    factors = [int(factor) for factor in declared.group(1).split("*")]

    assert math.prod(factors) == _HOSTED_DEFAULT_MAX_CONTENT_LENGTH
