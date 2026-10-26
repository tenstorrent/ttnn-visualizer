# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Reading a value as the app's JavaScript reads it, shared so every port reads one the
same way. #2219

`Number`, `parseInt`, `parseFloat`, a template literal, `Math.max` and truthiness, as the
ports of the app's functions need them; mirror a change in the TS each port names.
"""

import math
import re
from typing import Union

# What `parseFloat` and `parseInt(…, 10)` read: the longest such prefix, after spaces.
_JS_FLOAT = re.compile(
    r"[+-]?(?:Infinity|(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?)"
)
_JS_INT = re.compile(r"[+-]?[0-9]+")
# What `parseInt` and `parseFloat` skip first; Python's `str.strip` skips another set.
JS_WHITESPACE = (
    "\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006"
    "\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
)

Number = Union[int, float]


class Missing:
    """A key absent from a node's params, which JavaScript reads as `undefined`."""


MISSING = Missing()


def js_number(value: object) -> float:
    """`Number(value)` as the app reads a graph param."""
    if value is None:
        return 0.0
    if isinstance(value, bool):
        return float(value)
    if isinstance(value, (int, float)):
        return float(value)
    if not isinstance(value, str):
        return math.nan
    text = value.strip()
    if text == "":
        return 0.0
    if text[:2].lower() in ("0x", "0o", "0b"):
        try:
            return float(int(text, 0))
        except ValueError:
            return math.nan
    if "_" in text or text.lower().strip("+-") in ("inf", "infinity", "nan"):
        return {
            "Infinity": math.inf,
            "+Infinity": math.inf,
            "-Infinity": -math.inf,
        }.get(text, math.nan)
    try:
        return float(text)
    except ValueError:
        return math.nan


def js_template(value: object) -> str:
    """`${value}`, which is also `String(value)`.

    Not `Number::toString` at the extremes: an integral float of 1e21 or more is written
    out in full where JavaScript uses an exponent, and Python's repr turns to one below
    1e-4 where JavaScript waits until below 1e-6. Graph params and report cells arrive
    as strings, so neither is reached by a capture.
    """
    if isinstance(value, Missing):
        return "undefined"
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, float):
        if math.isnan(value):
            return "NaN"
        if math.isinf(value):
            return "Infinity" if value > 0 else "-Infinity"
        if value.is_integer():
            return str(int(value))
    return str(value)


def parse_int(value: object) -> Number:
    """`parseInt(value, 10)`: the leading integer of its string form, else NaN."""
    match = _JS_INT.match(js_template(value).lstrip(JS_WHITESPACE))
    return int(match.group(0)) if match else math.nan


def parse_float(value: object) -> float:
    """`parseFloat(value)`: the leading decimal of its string form, else NaN."""
    match = _JS_FLOAT.match(js_template(value).lstrip(JS_WHITESPACE))
    return float(match.group(0)) if match else math.nan


def js_max(left: Number, right: Number) -> Number:
    """`Math.max`, which is NaN when either side is."""
    if math.isnan(left) or math.isnan(right):
        return math.nan
    return max(left, right)


def is_truthy(value: object) -> bool:
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
    "Number",
    "is_truthy",
    "js_max",
    "js_number",
    "js_template",
    "parse_float",
    "parse_int",
]
