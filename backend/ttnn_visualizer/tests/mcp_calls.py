# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""A tools/call through the MCP server, as an agent's client sends one."""

from typing import Dict, Tuple
from unittest.mock import patch

from ttnn_visualizer.agent import server
from ttnn_visualizer.agent.handles import ReportRegistry
from ttnn_visualizer.event_logging import McpToolOutcome


def tool_call(
    registry: ReportRegistry, name: str, arguments: Dict
) -> Tuple[Dict, McpToolOutcome]:
    """The call's result, and the outcome its usage event records, unwritten."""
    with patch.object(server, "record_event") as record:
        response = server.handle_message(
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {"name": name, "arguments": arguments},
            },
            server._tool_table(registry),
        )
    assert response is not None
    assert record.called, f"{name} answered without recording a usage event"
    return response["result"], record.call_args.kwargs["outcome"]
