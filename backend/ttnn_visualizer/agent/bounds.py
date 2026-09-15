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
    """Clamp a caller's limit into [1, MAX_LIMIT], defaulting when unset."""
    if limit is None:
        return DEFAULT_LIMIT
    return max(1, min(int(limit), MAX_LIMIT))


__all__ = ["DEFAULT_LIMIT", "MAX_LIMIT", "bounded"]
