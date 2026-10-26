# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""The JavaScript reads every agent port shares. #2219

The parity goldens hold these as the ports use them, on the inputs a capture or a report
writes; these hold the edges the goldens do not reach.
"""

import math

import pytest
from ttnn_visualizer.agent.js_values import (
    MISSING,
    is_truthy,
    js_max,
    js_number,
    js_template,
    parse_float,
    parse_int,
)


def _same(actual: float, expected: float) -> bool:
    if math.isnan(expected):
        return math.isnan(actual)
    return actual == expected


class TestParseInt:
    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            ("4096", 4096),
            (" 4096", 4096),
            ("4096abc", 4096),
            ("-12", -12),
            (2048, 2048),
            (2048.7, 2048),
            ("0x10", 0),
            ("٤", math.nan),
            ("abc", math.nan),
            ("", math.nan),
            (None, math.nan),
            (MISSING, math.nan),
            (True, math.nan),
            (math.inf, math.nan),
            # `String(5e-7)` is "5e-7".
            (5e-7, 5),
        ],
    )
    def test_it_reads_as_parse_int_does(self, value, expected):
        assert _same(parse_int(value), expected)

    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            ("\ufeff12", 12),
            ("\u00a012", 12),
            ("\u300012", 12),
            # Python's whitespace, not JavaScript's.
            ("\x1c12", math.nan),
            ("\x8512", math.nan),
        ],
    )
    def test_it_skips_javascript_s_whitespace_only(self, value, expected):
        assert _same(parse_int(value), expected)

    def test_an_integer_stays_an_integer(self):
        assert isinstance(parse_int("4096"), int)

    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            ("9" * 309, math.inf),
            ("-" + "9" * 309, -math.inf),
            # Past Python's limit on converting a long digit string to an int.
            ("9" * 5000, math.inf),
            # Rounded to the nearest float, as `parseInt` gives it.
            ("9007199254740993", 9007199254740992),
        ],
    )
    def test_it_reads_a_long_prefix_as_javascript_s_number_does(self, value, expected):
        assert parse_int(value) == expected


class TestParseFloat:
    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            (" 1.5e3x", 1500.0),
            (".5", 0.5),
            ("-Infinity", -math.inf),
            ("Infinity", math.inf),
            (math.inf, math.inf),
            ("inf", math.nan),
            ("\ufeff2.5", 2.5),
            (None, math.nan),
            (MISSING, math.nan),
        ],
    )
    def test_it_reads_as_parse_float_does(self, value, expected):
        assert _same(parse_float(value), expected)


class TestJsNumber:
    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            (None, 0.0),
            ("", 0.0),
            ("  ", 0.0),
            ("12", 12.0),
            (" 12 ", 12.0),
            ("0x10", 16.0),
            ("0b11", 3.0),
            ("1_000", math.nan),
            ("Infinity", math.inf),
            ("-Infinity", -math.inf),
            ("inf", math.nan),
            ("12abc", math.nan),
            (True, 1.0),
            (MISSING, math.nan),
        ],
    )
    def test_it_reads_as_number_does(self, value, expected):
        assert _same(js_number(value), expected)


class TestJsTemplate:
    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            (12, "12"),
            (12.0, "12"),
            (math.nan, "NaN"),
            (-math.inf, "-Infinity"),
            (None, "null"),
            (True, "true"),
            ("{}", "{}"),
            (MISSING, "undefined"),
        ],
    )
    def test_it_renders_as_javascript_does(self, value, expected):
        assert js_template(value) == expected


class TestJsMax:
    @pytest.mark.parametrize(
        ("left", "right", "expected"),
        [
            (1, 2, 2),
            (2, 1, 2),
            (math.nan, 1, math.nan),
            (1, math.nan, math.nan),
        ],
    )
    def test_it_is_nan_when_either_side_is(self, left, right, expected):
        assert _same(js_max(left, right), expected)


class TestIsTruthy:
    @pytest.mark.parametrize(
        "value", [None, MISSING, "", 0, 0.0, -0.0, math.nan, False]
    )
    def test_falsy_values(self, value):
        assert not is_truthy(value)

    @pytest.mark.parametrize("value", ["0", "false", 1, -1.5, True, [], {}])
    def test_truthy_values(self, value):
        assert is_truthy(value)
