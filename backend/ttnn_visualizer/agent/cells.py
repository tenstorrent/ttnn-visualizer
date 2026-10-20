# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Reading a report cell as a number, shared so every tool reads one the same way."""

import math
from typing import Optional


def finite_number(value: object) -> Optional[float]:
    """A cell as a float, or None where it is blank, not a number, or not finite.

    Report cells arrive as strings, including the numeric ones. A NaN or an infinity
    would reach the client as invalid JSON.
    """
    if isinstance(value, bool) or value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        number = float(value)
    elif isinstance(value, str):
        try:
            number = float(value)
        except ValueError:
            return None
    else:
        return None
    return number if math.isfinite(number) else None


__all__ = ["finite_number"]
