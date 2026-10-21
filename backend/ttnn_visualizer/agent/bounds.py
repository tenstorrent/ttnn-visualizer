# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""The result caps the tool surface enforces.

Shared rather than declared per module: `server` quotes these numbers to an agent
in every limit schema, so a second copy would eventually promise one cap and
enforce another. #2012
"""

from typing import Optional

DEFAULT_LIMIT = 10
MAX_LIMIT = 100
# Rows with every `include` group run to about 3 KB each, so 100 of them would pass
# a client's MCP output cap; 25 stay under Claude Code's 25k tokens.
MAX_DETAILED_LIMIT = 25


# The captured graph a tool will read in one go. The largest real total across 85 local
# captures is 55.6 MB, so this refuses a pathological file, never a real one.
MAX_CAPTURED_GRAPH_CHARS = 1 << 30


def bounded(limit: Optional[int], maximum: int = MAX_LIMIT) -> int:
    """Clamp a caller's limit into [1, maximum], defaulting when unset.

    A non-numeric limit is refused by name: a bare `int()` failure reaches the
    agent as `invalid literal for int() with base 10: 'abc'`, which does not say
    which argument it is about.
    """
    if limit is None:
        return min(DEFAULT_LIMIT, maximum)
    try:
        requested = int(limit)
    except (TypeError, ValueError):
        raise ValueError(f"limit must be a whole number, not {limit!r}") from None
    return max(1, min(requested, maximum))


__all__ = [
    "DEFAULT_LIMIT",
    "MAX_CAPTURED_GRAPH_CHARS",
    "MAX_DETAILED_LIMIT",
    "MAX_LIMIT",
    "bounded",
]
