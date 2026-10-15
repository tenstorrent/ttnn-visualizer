# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""The report-path query parameters an agent tool's link carries, against the app that
reads them (#2047). A rename on either side leaves every link opening no report while
both suites stay green.
"""

import re
from pathlib import Path

from ttnn_visualizer.agent.app_links import PERFORMANCE_PATH_PARAM, PROFILER_PATH_PARAM

_PROJECT_ROOT = Path(__file__).resolve().parents[3]
_READER = _PROJECT_ROOT / "src" / "libs" / "openReportFromLink.ts"


def test_the_app_reads_the_parameters_the_links_carry():
    source = _READER.read_text(encoding="utf-8")
    declared = re.search(r"const REPORT_PATH_PARAMS = \[([^\]]*)\]", source)

    assert declared is not None, f"No REPORT_PATH_PARAMS list in {_READER.name}"
    assert re.findall(r"'([^']+)'", declared.group(1)) == [
        PROFILER_PATH_PARAM,
        PERFORMANCE_PATH_PARAM,
    ]
