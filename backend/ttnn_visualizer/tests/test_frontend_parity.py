# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""`typescript_string_constant`, tested directly: every constant its callers read is
well formed, so they would pass however loose it got. #2372"""

import pytest
from ttnn_visualizer.tests.frontend_parity import typescript_string_constant


@pytest.mark.parametrize(
    "source",
    [
        pytest.param("export const HINT = 'filled';\n", id="one-line"),
        pytest.param("export const HINT =\n    'filled';\n", id="prettier-wrapped"),
    ],
)
def test_it_reads_a_quoted_constant_on_its_line_or_the_next(tmp_path, source):
    path = tmp_path / "constants.ts"
    path.write_text(source, encoding="utf-8")

    assert typescript_string_constant(path, "HINT") == "filled"


@pytest.mark.parametrize(
    "source",
    [
        pytest.param("export const HINT =\n  fn('x');\n", id="a-call"),
        pytest.param('export const HINT = "filled";\n', id="double-quoted"),
        pytest.param("export const HINT =\n\n    'filled';\n", id="two-lines-down"),
    ],
)
def test_it_refuses_any_other_shape(tmp_path, source):
    path = tmp_path / "constants.ts"
    path.write_text(source, encoding="utf-8")

    with pytest.raises(AssertionError, match="HINT"):
        typescript_string_constant(path, "HINT")
