# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Reading a value as the app's JavaScript reads it, shared so every port reads one the
same way. #2219

`Number`, `String` and a template literal, `parseInt`, `parseFloat`, `trim` and `\s`,
`Math.max`, `Number.isFinite`, division and truthiness, as the ports of the app's functions need
them; mirror a change in the TS each port names. A Python int is a JSON number, which
JavaScript holds as a double, so each read takes it as one.
"""

import math
import re
from decimal import Decimal
from typing import TypeGuard, Union

# An unsigned decimal. Each digit run can be split only one way, so a long run ending in
# a non-digit fails in linear time rather than quadratic.
_DECIMAL = r"(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?"
# What `parseFloat` and `parseInt(…, 10)` read: the longest such prefix, after spaces.
_JS_FLOAT = re.compile(rf"[+-]?(?:Infinity|{_DECIMAL})")
_JS_INT = re.compile(r"[+-]?[0-9]+")
# What `Number` reads whole: a decimal, a radix literal (unsigned), or an infinity.
_JS_DECIMAL = re.compile(rf"[+-]?{_DECIMAL}")
_JS_RADIX = re.compile(r"0(?:[xX][0-9a-fA-F]+|[oO][0-7]+|[bB][01]+)")
_JS_INFINITY = re.compile(r"[+-]?Infinity")
# JavaScript's whitespace: what `\s`, `trim`, `Number`, `parseInt` and `parseFloat` skip.
# Python's `\s` and `str.strip` read another set.
JS_WHITESPACE = (
    "\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006"
    "\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
)

# Past this many digits before the point, `Number::toString` turns to an exponent.
_MAX_PLAIN_DIGITS = 21
# Past this many zeros after the point, likewise.
_MAX_LEADING_ZEROS = 6
# Up to here every integer is a double, and both languages print it digit for digit.
_MAX_SAFE_INTEGER = 2**53

NumberValue = Union[int, float]


class Missing:
    """A key absent from a node's params, which JavaScript reads as `undefined`."""


MISSING = Missing()


def _double(value: int) -> float:
    """A JSON integer as JavaScript holds it: the nearest double, past the range an
    infinity."""
    try:
        return float(value)
    except OverflowError:
        return math.inf if value > 0 else -math.inf


def js_number(value: object) -> float:
    """`Number(value)`."""
    if value is None:
        return 0.0
    if isinstance(value, Missing):
        return math.nan
    if isinstance(value, bool):
        return float(value)
    if isinstance(value, int):
        return _double(value)
    if isinstance(value, float):
        return value
    if isinstance(value, list):
        return js_number(js_template(value))
    if not isinstance(value, str):
        return math.nan
    text = js_trim(value)
    if text == "":
        return 0.0
    if _JS_INFINITY.fullmatch(text):
        return -math.inf if text.startswith("-") else math.inf
    if _JS_RADIX.fullmatch(text):
        return _double(int(text, 0))
    if _JS_DECIMAL.fullmatch(text):
        return float(text)
    return math.nan


def _number_text(number: float) -> str:
    """`Number::toString`: the shortest digits that read back as `number`, which
    Python's repr also gives, laid out by ECMA-262's rules rather than Python's."""
    if math.isnan(number):
        return "NaN"
    if number == 0:
        return "0"
    if math.isinf(number):
        return "Infinity" if number > 0 else "-Infinity"
    if number.is_integer() and abs(number) <= _MAX_SAFE_INTEGER:
        return str(int(number))
    sign = "-" if number < 0 else ""
    parts = Decimal(repr(abs(number))).as_tuple()
    assert isinstance(parts.exponent, int)
    # The value is 0.digits × 10**point.
    point = len(parts.digits) + parts.exponent
    digits = "".join(str(digit) for digit in parts.digits).rstrip("0")
    count = len(digits)
    if count <= point <= _MAX_PLAIN_DIGITS:
        return sign + digits + "0" * (point - count)
    if 0 < point <= _MAX_PLAIN_DIGITS:
        return sign + digits[:point] + "." + digits[point:]
    if -_MAX_LEADING_ZEROS < point <= 0:
        return sign + "0." + "0" * -point + digits
    exponent = point - 1
    mantissa = digits[0] + ("." + digits[1:] if count > 1 else "")
    return f"{sign}{mantissa}e{'+' if exponent >= 0 else '-'}{abs(exponent)}"


def js_template(value: object) -> str:
    """`${value}`, which is also `String(value)`."""
    if isinstance(value, Missing):
        return "undefined"
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        if abs(value) <= _MAX_SAFE_INTEGER:
            return str(value)
        return _number_text(_double(value))
    if isinstance(value, float):
        return _number_text(value)
    if isinstance(value, list):
        return ",".join(
            "" if item is None or isinstance(item, Missing) else js_template(item)
            for item in value
        )
    if isinstance(value, dict):
        return "[object Object]"
    return str(value)


def js_trim(text: str) -> str:
    """`String.prototype.trim`."""
    return text.strip(JS_WHITESPACE)


def js_parse_int(value: object) -> NumberValue:
    """`parseInt(value, 10)`: the leading integer of its string form, else NaN.

    Read through a float, as JavaScript's number is, so a prefix past the float range is
    an infinity and one past 2**53 rounds, as in the app. An int has no negative zero,
    so that one stays a float.
    """
    match = _JS_INT.match(js_template(value).lstrip(JS_WHITESPACE))
    if not match:
        return math.nan
    number = float(match.group(0))
    if not math.isfinite(number) or (number == 0 and math.copysign(1.0, number) < 0):
        return number
    return int(number)


def js_parse_float(value: object) -> float:
    """`parseFloat(value)`: the leading decimal of its string form, else NaN."""
    match = _JS_FLOAT.match(js_template(value).lstrip(JS_WHITESPACE))
    return float(match.group(0)) if match else math.nan


def js_max(left: NumberValue, right: NumberValue) -> NumberValue:
    """`Math.max`, which is NaN when either side is and takes 0 over -0."""
    if math.isnan(left) or math.isnan(right):
        return math.nan
    if left == right:
        return left if math.copysign(1.0, left) > 0 else right
    return max(left, right)


def js_divide(numerator: float, denominator: float) -> float:
    """IEEE division, as JavaScript divides; Python raises on a zero denominator."""
    if denominator != 0:
        return numerator / denominator
    if numerator == 0 or math.isnan(numerator):
        return math.nan
    return math.copysign(math.inf, numerator) * math.copysign(1.0, denominator)


def js_is_finite(value: object) -> TypeGuard[float]:
    """`Number.isFinite`, which is false for anything not already a number."""
    if isinstance(value, bool):
        return False
    if isinstance(value, int):
        return math.isfinite(_double(value))
    return isinstance(value, float) and math.isfinite(value)


def js_truthy(value: object) -> bool:
    """JavaScript's truthiness, which some of the app's reads test a value by first."""
    if value is None or isinstance(value, Missing):
        return False
    if isinstance(value, float):
        return value != 0 and not math.isnan(value)
    if isinstance(value, (bool, int, str)):
        return bool(value)
    return True


__all__ = [
    "JS_WHITESPACE",
    "MISSING",
    "Missing",
    "NumberValue",
    "js_divide",
    "js_is_finite",
    "js_max",
    "js_number",
    "js_parse_float",
    "js_parse_int",
    "js_template",
    "js_trim",
    "js_truthy",
]
