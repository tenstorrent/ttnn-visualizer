# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Registered MCP tool names.

A leaf so ``event_logging`` and ``server`` can share the vocabulary without a cycle:
``server`` already imports ``event_logging``, so the enum cannot live there and be
imported back. Values are the JSON-RPC tool names.
"""

from enum import Enum


class McpToolName(str, Enum):
    LOAD_REPORT = "load_report"
    TOP_OPS = "top_ops"
    OP_BREAKDOWN = "op_breakdown"
    PROGRAM_CACHE = "program_cache"
    ZONE_TIMINGS = "zone_timings"
    CORE_SPREAD = "core_spread"
    DIFF_REPORTS = "diff_reports"
    FIND_OPERATIONS = "find_operations"
    OPERATION_DETAIL = "operation_detail"
    MEMORY_PROFILE = "memory_profile"
    TENSOR_FLOW = "tensor_flow"
    OPERATION_PROVENANCE = "operation_provenance"
    ERRORS = "errors"
    DRAM_FALLBACKS = "dram_fallbacks"
    L1_PEAK = "l1_peak"
    CRITICAL_PATH = "critical_path"
    SUBGRAPH_BETWEEN = "subgraph_between"
