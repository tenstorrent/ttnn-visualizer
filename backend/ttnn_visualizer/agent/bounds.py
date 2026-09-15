# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""The one result cap the tool surface enforces.

Shared rather than declared per module: `server` quotes this number to an agent
in every limit schema, so a second copy would eventually promise one cap and
enforce another. #2012
"""

from typing import Optional

DEFAULT_LIMIT = 10
MAX_LIMIT = 100


def bounded(limit: Optional[int]) -> int:
    """Clamp a caller's limit into [1, MAX_LIMIT], defaulting when unset.

    A non-numeric limit is refused by name: a bare `int()` failure reaches the
    agent as `invalid literal for int() with base 10: 'abc'`, which does not say
    which argument it is about.
    """
    if limit is None:
        return DEFAULT_LIMIT
    try:
        requested = int(limit)
    except (TypeError, ValueError):
        raise ValueError(f"limit must be a whole number, not {limit!r}") from None
    return max(1, min(requested, MAX_LIMIT))


__all__ = ["DEFAULT_LIMIT", "MAX_LIMIT", "bounded"]
