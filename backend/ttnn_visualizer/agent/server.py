# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Newline-delimited JSON-RPC over stdio, which is what an MCP client speaks.

Hand-rolled rather than taking the `mcp` SDK: the tools are the part with risk
and value, and a dependency on the transport would put a resolver tree and a
licence scan on a spike. Swapping this file for the SDK is contained -- nothing
above it imports anything from here. #1995

Every byte on stdout is protocol. Logs go to stderr, and `tools` captures
tt-perf-report's own printing for the same reason.
"""

import json
import logging
import sys
from typing import Callable, Dict, List, Optional, TextIO

from ttnn_visualizer.agent import tools
from ttnn_visualizer.agent.handles import (
    ReportRegistry,
    UnknownHandleError,
    load_report,
)

logger = logging.getLogger(__name__)

PROTOCOL_VERSION = "2025-06-18"
SERVER_NAME = "ttnn-visualizer"

_LIMIT_SCHEMA = {
    "type": "integer",
    "description": f"Rows to return, capped at {tools.MAX_LIMIT}.",
}
_METRIC_SCHEMA = {
    "type": "string",
    "enum": sorted(tools.SORTABLE_METRICS),
    "description": "Which metric to rank by.",
}


def _tool_table(registry: ReportRegistry) -> Dict[str, Dict]:
    """Name → description, JSON schema and handler.

    Descriptions carry the caveats an agent needs *before* choosing a tool, not
    only in the response: which projection it reads, and what the numbers mean.
    """
    return {
        "load_report": {
            "description": (
                "Register a report directory and list what it can answer. Call this "
                "first; every other tool takes the handle it returns."
            ),
            "schema": {
                "type": "object",
                "properties": {
                    "profiler_path": {
                        "type": "string",
                        "description": "Directory holding db.sqlite and config.json.",
                    },
                    "performance_path": {
                        "type": "string",
                        "description": (
                            "Directory holding ops_perf_results*.csv and "
                            "profile_log_device.csv."
                        ),
                    },
                },
            },
            "handler": lambda arguments: load_report(registry, **arguments),
        },
        "top_ops": {
            "description": (
                "The costliest operations by one metric. Reads the report unfiltered "
                "-- host ops included, no signpost range -- and returns the projection "
                "it used alongside the rows."
            ),
            "schema": {
                "type": "object",
                "properties": {
                    "handle": {"type": "string"},
                    "by": _METRIC_SCHEMA,
                    "limit": _LIMIT_SCHEMA,
                },
                "required": ["handle"],
            },
            "handler": lambda arguments: tools.top_ops(registry, **arguments),
        },
        "zone_timings": {
            "description": (
                "Per-zone, per-RISC totals from profile_log_device.csv: what the "
                "hardware actually spent, by firmware and kernel phase. Cycles are "
                "summed across cores, so they are occupancy rather than elapsed time."
            ),
            "schema": {
                "type": "object",
                "properties": {"handle": {"type": "string"}, "limit": _LIMIT_SCHEMA},
                "required": ["handle"],
            },
            "handler": lambda arguments: tools.zone_timings(registry, **arguments),
        },
        "diff_reports": {
            "description": (
                "Per-op-code deltas between two reports, largest movement first. "
                "Grouped by op code rather than joined on op id, so a change that "
                "adds or reorders ops does not report every later op as changed."
            ),
            "schema": {
                "type": "object",
                "properties": {
                    "handle_a": {"type": "string", "description": "Baseline."},
                    "handle_b": {"type": "string", "description": "After the change."},
                    "by": _METRIC_SCHEMA,
                    "limit": _LIMIT_SCHEMA,
                },
                "required": ["handle_a", "handle_b"],
            },
            "handler": lambda arguments: tools.diff_reports(registry, **arguments),
        },
    }


def _result(request_id: object, payload: Dict) -> Dict:
    return {"jsonrpc": "2.0", "id": request_id, "result": payload}


def _error(request_id: object, code: int, message: str) -> Dict:
    return {
        "jsonrpc": "2.0",
        "id": request_id,
        "error": {"code": code, "message": message},
    }


def _tool_failure(request_id: object, message: str) -> Dict:
    """A tool that refuses is a result, not a protocol error.

    A JSON-RPC error tells the client the call was malformed; "that handle does
    not exist" is an answer the model should read and act on, so it comes back
    as content with `isError` set.
    """
    return _result(
        request_id,
        {"content": [{"type": "text", "text": message}], "isError": True},
    )


def handle_message(message: Dict, table: Dict[str, Dict]) -> Optional[Dict]:
    """One request in, at most one response out. `None` means notification."""
    method = message.get("method")
    request_id = message.get("id")

    if method == "initialize":
        return _result(
            request_id,
            {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {"tools": {}},
                "serverInfo": {"name": SERVER_NAME, "version": "0.1.0"},
            },
        )

    # Notifications carry no id and must not be answered.
    if request_id is None:
        return None

    if method == "tools/list":
        return _result(
            request_id,
            {
                "tools": [
                    {
                        "name": name,
                        "description": entry["description"],
                        "inputSchema": entry["schema"],
                    }
                    for name, entry in table.items()
                ]
            },
        )

    if method == "tools/call":
        params = message.get("params") or {}
        name = str(params.get("name") or "")
        entry = table.get(name)
        if entry is None:
            return _tool_failure(request_id, f"unknown tool {name!r}")

        arguments = params.get("arguments") or {}
        try:
            payload = entry["handler"](arguments)
        except (UnknownHandleError, ValueError) as error:
            return _tool_failure(request_id, str(error))
        except TypeError as error:
            return _tool_failure(request_id, f"bad arguments for {name}: {error}")
        except (
            Exception
        ) as error:  # noqa: BLE001 - the model gets the reason, the log gets the trace
            logger.exception("%s failed", name)
            return _tool_failure(request_id, f"{name} failed: {error}")

        return _result(
            request_id,
            {
                "content": [
                    {"type": "text", "text": json.dumps(payload, indent=2, default=str)}
                ]
            },
        )

    return _error(request_id, -32601, f"method not found: {method}")


def serve(
    stdin: TextIO, stdout: TextIO, registry: Optional[ReportRegistry] = None
) -> None:
    table = _tool_table(registry or ReportRegistry())
    for line in stdin:
        line = line.strip()
        if not line:
            continue
        try:
            message = json.loads(line)
        except json.JSONDecodeError as error:
            stdout.write(
                json.dumps(_error(None, -32700, f"parse error: {error}")) + "\n"
            )
            stdout.flush()
            continue

        response = handle_message(message, table)
        if response is not None:
            stdout.write(json.dumps(response) + "\n")
            stdout.flush()


def main() -> None:
    logging.basicConfig(stream=sys.stderr, level=logging.INFO)
    serve(sys.stdin, sys.stdout)


if __name__ == "__main__":
    main()
