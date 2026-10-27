# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Reading a captured graph's JSON into the nodes every port walks. #2185

Shared so the link, the failure tools and the circular-buffer port read a graph one way:
the same refusal for one that is not a list of nodes, and the same `counter` rename the
app applies at fetch (`updateDeviceOperationId`, `src/hooks/useAPI.tsx`), so a port
reading node ids never meets an older capture's `counter` on its own.
"""

import json
from typing import List


class UnreadableGraphError(ValueError):
    """A captured graph that is not a JSON list of nodes."""


def parse_graph(raw: str) -> List[object]:
    """A captured graph's nodes, with an older capture's `counter` renamed to `id`.

    Raises `UnreadableGraphError` when `raw` is not a JSON list. Renamed in place, as
    the app does: the nodes are this call's own.
    """
    try:
        nodes = json.loads(raw)
    except ValueError as error:
        raise UnreadableGraphError(str(error)) from None
    if not isinstance(nodes, list):
        raise UnreadableGraphError("not a list of nodes")
    for node in nodes:
        if isinstance(node, dict) and "counter" in node:
            counter = node.pop("counter")
            # JSON holds no `undefined`, so an `id` key present is one the app keeps.
            node.setdefault("id", counter)
    return nodes


__all__ = ["UnreadableGraphError", "parse_graph"]
