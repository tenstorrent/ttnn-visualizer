# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""The `reason` a hosted refusal of another session's instance carries, against the app
that matches it to start the tab on a fresh instance. A rename on either side leaves a
tab whose cookie was lost refused on every request while both suites stay green.
"""

import re
from pathlib import Path

from ttnn_visualizer.decorators import INSTANCE_NOT_OWNED

_PROJECT_ROOT = Path(__file__).resolve().parents[3]
_READER = _PROJECT_ROOT / "src" / "libs" / "axiosInstance.ts"


def test_the_app_matches_the_reason_the_refusal_carries():
    source = _READER.read_text(encoding="utf-8")
    declared = re.search(r"const INSTANCE_NOT_OWNED = '([^']+)'", source)

    assert declared is not None, f"No INSTANCE_NOT_OWNED in {_READER.name}"
    assert declared.group(1) == INSTANCE_NOT_OWNED
