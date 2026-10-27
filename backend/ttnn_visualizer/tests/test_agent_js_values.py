# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""The JavaScript reads every agent port shares. #2219

The parity goldens hold these as the ports use them, on the inputs a capture or a report
writes; these hold the edges the goldens do not reach. Every expectation is what node gives
for the same input.
"""

import math
import time

import pytest
from ttnn_visualizer.agent.js_values import (
    MISSING,
    js_divide,
    js_is_finite,
    js_max,
    js_number,
    js_parse_float,
    js_parse_int,
    js_template,
    js_trim,
    js_truthy,
)


def _same(actual: float, expected: float) -> bool:
    """Equal as JavaScript's `Object.is` compares: NaN is NaN, and -0 is not 0."""
    if math.isnan(expected):
        return math.isnan(actual)
    return actual == expected and math.copysign(1.0, actual) == math.copysign(
        1.0, expected
    )


class TestJsParseInt:
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
            # `String(5e-7)` is "5e-7", `String(5e-5)` is "0.00005", and `String(1e21)`
            # is "1e+21".
            (5e-7, 5),
            (5e-5, 0),
            (1e21, 1),
            # An int has no -0, so it stays a float.
            ("-0", -0.0),
            ("0", 0),
        ],
    )
    def test_it_reads_as_parse_int_does(self, value, expected):
        assert _same(js_parse_int(value), expected)

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
        assert _same(js_parse_int(value), expected)

    def test_an_integer_stays_an_integer(self):
        assert isinstance(js_parse_int("4096"), int)

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
        assert js_parse_int(value) == expected


class TestJsParseFloat:
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
            # `String(5e-7)` is "5e-7" and `String(1e21)` is "1e+21", which read back whole.
            (5e-7, 5e-7),
            (1e21, 1e21),
            # `String(-0)` is "0", so only the string keeps the sign.
            (-0.0, 0.0),
            ("-0", -0.0),
            (None, math.nan),
            (MISSING, math.nan),
        ],
    )
    def test_it_reads_as_parse_float_does(self, value, expected):
        assert _same(js_parse_float(value), expected)


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
            ("-0x10", math.nan),
            ("0x1_0", math.nan),
            ("\u0664\u0662", math.nan),
            ("1e", math.nan),
            ("5.", 5.0),
            ("+.5e-2", 0.005),
            ("-0", -0.0),
            ("0X10", 16.0),
            ("+0x10", math.nan),
            (" 0x10 ", 16.0),
            ("1e400", math.inf),
            ("-.5", -0.5),
            pytest.param(10**400, math.inf, id="int-past-the-float-range"),
            ([5], 5.0),
            ([], 0.0),
            ({}, math.nan),
        ],
    )
    def test_it_reads_as_number_does(self, value, expected):
        assert _same(js_number(value), expected)

    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            ("\ufeff12", 12.0),
            ("12\u3000", 12.0),
            # Python's whitespace, not JavaScript's.
            ("\x1c12", math.nan),
            ("12\x85", math.nan),
        ],
    )
    def test_it_skips_javascript_s_whitespace_only(self, value, expected):
        assert _same(js_number(value), expected)

    @pytest.mark.parametrize("value", ["1" * 100_000 + "x", "1." + "1" * 100_000 + "x"])
    def test_a_long_digit_run_is_read_in_linear_time(self, value):
        # A pattern that splits a digit run more than one way takes minutes here.
        started = time.perf_counter()

        assert math.isnan(js_number(value))
        assert time.perf_counter() - started < 1


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
            (-0.0, "0"),
            (0.1, "0.1"),
            (1e20, "100000000000000000000"),
            (1e21, "1e+21"),
            (-1.5e300, "-1.5e+300"),
            (1e-6, "0.000001"),
            (5e-5, "0.00005"),
            (1e-7, "1e-7"),
            (123e-20, "1.23e-18"),
            (5e-324, "5e-324"),
            # A JSON integer is a double to JavaScript.
            (9007199254740993, "9007199254740992"),
            pytest.param(10**400, "Infinity", id="int-past-the-float-range"),
            ([1, None, MISSING, "a", [2, 3]], "1,,,a,2,3"),
            ({}, "[object Object]"),
        ],
    )
    def test_it_renders_as_javascript_does(self, value, expected):
        assert js_template(value) == expected


class TestJsTrim:
    @pytest.mark.parametrize(
        ("text", "expected"),
        [
            (" \t12\n", "12"),
            ("\ufeff12\u3000", "12"),
            # Python's whitespace, not JavaScript's.
            ("\x1c12\x85", "\x1c12\x85"),
        ],
    )
    def test_it_trims_javascript_s_whitespace_only(self, text, expected):
        assert js_trim(text) == expected


class TestJsMax:
    @pytest.mark.parametrize(
        ("left", "right", "expected"),
        [
            (1, 2, 2),
            (2, 1, 2),
            (math.nan, 1, math.nan),
            (1, math.nan, math.nan),
            (-0.0, 0.0, 0.0),
            (0.0, -0.0, 0.0),
            (-0.0, -0.0, -0.0),
            # The ports mix an int 0 with a parsed -0.
            (0, -0.0, 0.0),
            (-0.0, 0, 0.0),
        ],
    )
    def test_it_reads_as_math_max_does(self, left, right, expected):
        assert _same(js_max(left, right), expected)


class TestJsDivide:
    @pytest.mark.parametrize(
        ("numerator", "denominator", "expected"),
        [
            (6.0, 3.0, 2.0),
            (1.0, 0.0, math.inf),
            (1.0, -0.0, -math.inf),
            (-1.0, 0.0, -math.inf),
            (0.0, 0.0, math.nan),
            (math.nan, 0.0, math.nan),
        ],
    )
    def test_it_divides_as_ieee_does(self, numerator, denominator, expected):
        assert _same(js_divide(numerator, denominator), expected)


class TestJsIsFinite:
    @pytest.mark.parametrize("value", [0, -0.0, 1.5, 2**1000])
    def test_finite_numbers(self, value):
        assert js_is_finite(value)

    @pytest.mark.parametrize(
        "value",
        [
            math.nan,
            math.inf,
            pytest.param(-(10**400), id="int-past-the-float-range"),
            "1",
            True,
            None,
            MISSING,
        ],
    )
    def test_everything_else(self, value):
        assert not js_is_finite(value)


class TestJsTruthy:
    @pytest.mark.parametrize(
        "value", [None, MISSING, "", 0, 0.0, -0.0, math.nan, False]
    )
    def test_falsy_values(self, value):
        assert not js_truthy(value)

    @pytest.mark.parametrize("value", ["0", "false", 1, -1.5, True, [], {}])
    def test_truthy_values(self, value):
        assert js_truthy(value)
