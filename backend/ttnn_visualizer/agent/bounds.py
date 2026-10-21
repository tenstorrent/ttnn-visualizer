# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""The result caps the tool surface enforces.

Shared rather than declared per module: `server` quotes these numbers to an agent
in every limit schema, so a second copy would eventually promise one cap and
enforce another. #2012
"""

from typing import TYPE_CHECKING, Any, Dict, Optional

if TYPE_CHECKING:
    from ttnn_visualizer.queries import DatabaseQueries

DEFAULT_LIMIT = 10
MAX_LIMIT = 100
# Rows with every `include` group run to about 3 KB each, so 100 of them would pass
# a client's MCP output cap; 25 stay under Claude Code's 25k tokens.
MAX_DETAILED_LIMIT = 25


# The captured graph a tool will read in one go. The largest real total across 85 local
# captures is 55.6 MB, so this refuses a pathological file, never a real one.
MAX_CAPTURED_GRAPH_CHARS = 1 << 30


class GraphTooLargeError(ValueError):
    """More captured graph than a tool will hold in memory to read."""


def ensure_graph_readable(
    queries: "DatabaseQueries", filters: Optional[Dict[str, Any]], reader: str
) -> None:
    """Refuse a read of more captured graph than `MAX_CAPTURED_GRAPH_CHARS`.

    `filters` must be the ones the read will use: `query_device_operations` loads
    every graph they match at once. `reader` names what would read it, for the
    refusal.
    """
    graph_size = queries.query_captured_graph_size(filters=filters)
    if graph_size > MAX_CAPTURED_GRAPH_CHARS:
        raise GraphTooLargeError(
            f"this capture holds {graph_size:,} characters of captured graph, past "
            f"the {MAX_CAPTURED_GRAPH_CHARS:,} {reader} will read"
        )


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
    "GraphTooLargeError",
    "MAX_CAPTURED_GRAPH_CHARS",
    "MAX_DETAILED_LIMIT",
    "MAX_LIMIT",
    "bounded",
    "ensure_graph_readable",
]
