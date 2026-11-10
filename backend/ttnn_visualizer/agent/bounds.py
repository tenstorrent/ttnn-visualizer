# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""The bounds the tool surface enforces: result caps, the choices an argument takes,
and how much captured graph a tool reads at once.

Shared rather than declared per module: `server` quotes the caps to an agent in every
limit schema, so a second copy would eventually promise one cap and enforce another.
#2012 The graph guard is shared because the link and the failure tools read the same
column. A bound that leaves out or refuses a name counts its `answer_size`, the bytes
an answer's budget counts. #2255
"""

import json
from typing import TYPE_CHECKING, Any, Dict, Iterable, Optional

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


def answer_size(name: str) -> int:
    """The bytes a name takes in an answer: UTF-8, with JSON's escapes and the wire's
    escape of a lone surrogate, so a control character is six and a wide one four."""
    encoded = json.dumps(name, ensure_ascii=False).encode("utf-8", "backslashreplace")
    return len(encoded) - 2


def name_fits(name: str, limit: int) -> bool:
    """Whether a name takes at most `limit` bytes of an answer; one longer than that in
    characters never does, so it is not encoded."""
    return len(name) <= limit and answer_size(name) <= limit


def normalised_choice(value: Optional[str]) -> Optional[str]:
    """A choice as `require_choice` compares it: trimmed and upper-cased, None if blank."""
    return (value.strip().upper() or None) if isinstance(value, str) else value


def require_choice(kind: str, value: str, allowed: Iterable[str]) -> None:
    """Refuse `value` unless it is one of `allowed`, naming every choice."""
    if value not in allowed:
        raise ValueError(
            f"unknown {kind} {value!r}; expected one of {', '.join(sorted(allowed))}"
        )


__all__ = [
    "DEFAULT_LIMIT",
    "GraphTooLargeError",
    "MAX_CAPTURED_GRAPH_CHARS",
    "MAX_DETAILED_LIMIT",
    "MAX_LIMIT",
    "bounded",
    "ensure_graph_readable",
    "normalised_choice",
    "require_choice",
    "answer_size",
    "name_fits",
]
