# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""The bounds the tool surface enforces: result caps, the choices an argument takes,
and how much captured graph a tool reads at once.

Shared rather than declared per module: `server` quotes the caps to an agent in every
limit schema, so a second copy would eventually promise one cap and enforce another.
#2012 The graph guard is shared because the link and the failure tools read the same
column. The text cuts are shared so that an op code is cut the same way wherever a tool
shows one, as are the other texts that go through them; #2290 tracks the rest. #2208
"""

import hashlib
from typing import TYPE_CHECKING, Any, Dict, Iterable, Optional

if TYPE_CHECKING:
    from ttnn_visualizer.queries import DatabaseQueries

DEFAULT_LIMIT = 10
MAX_LIMIT = 100
# Rows with every `include` group run to about 3 KB each, so 100 of them would pass
# a client's MCP output cap; 25 stay under Claude Code's 25k tokens.
MAX_DETAILED_LIMIT = 25

# An op code past this is the capture's text, not tt-perf-report's: the longest a tool
# shows across 67 local captures is a signpost's 91 characters. #2208
MAX_OP_CODE_CHARS = 256
# 64 bits: a chance match between two texts cut alike is vanishingly unlikely, and a crafted
# one fools only the display, since groups are kept by the whole text.
CUT_DIGEST_CHARS = 16


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


def cut_text(
    field: str, text: object, limit: int, digest: bool = False
) -> Dict[str, object]:
    """`text` under `field`, cut at `limit` characters with its full length, and with
    `digest` a digest of the whole, since two texts can share a cut and a length. A
    BLOB a report keeps where text belongs is cut by its bytes."""
    if not isinstance(text, (str, bytes)) or len(text) <= limit:
        return {field: text}
    fields: Dict[str, object] = {
        field: text[:limit],
        f"{field}_full_length": len(text),
    }
    if digest:
        # A lone surrogate is hashed as written rather than failing the answer.
        encoded = (
            text.encode("utf-8", "surrogatepass") if isinstance(text, str) else text
        )
        whole = hashlib.sha256(encoded).hexdigest()
        fields[f"{field}_digest"] = whole[:CUT_DIGEST_CHARS]
    return fields


def cut_op_code(field: str, op_code: object) -> Dict[str, object]:
    """An op code as every tool shows one: past `MAX_OP_CODE_CHARS`, cut and told apart
    by its digest from another cut alike."""
    return cut_text(field, op_code, MAX_OP_CODE_CHARS, digest=True)


def shown_op_code(op_code: object) -> str:
    """An op code as a refusal quotes it: cut before it is quoted, so the cut and the
    length it gives are the code's own."""
    if isinstance(op_code, str) and len(op_code) > MAX_OP_CODE_CHARS:
        return f"{op_code[:MAX_OP_CODE_CHARS]!r}... ({len(op_code)} characters)"
    return repr(op_code)


def shown_in_text(text: str, limit: int) -> str:
    """`text` for a sentence: past `limit` characters, cut and said to be."""
    if len(text) <= limit:
        return text
    return f"{text[:limit]}... ({len(text)} characters)"


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
    "CUT_DIGEST_CHARS",
    "DEFAULT_LIMIT",
    "GraphTooLargeError",
    "MAX_CAPTURED_GRAPH_CHARS",
    "MAX_DETAILED_LIMIT",
    "MAX_LIMIT",
    "MAX_OP_CODE_CHARS",
    "bounded",
    "cut_op_code",
    "cut_text",
    "ensure_graph_readable",
    "normalised_choice",
    "require_choice",
    "shown_in_text",
    "shown_op_code",
]
