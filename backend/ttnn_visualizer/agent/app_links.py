# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Links from a tool's answer to the same thing in the web application. #2047

An `app_link` (or an `app_link_template` for a list) names the report by its
directories, and the app opens them when the link is followed, as
`ttnn-visualizer --profiler-path` does. So a link lands on the report the agent
read rather than on whatever the reader's tab has open, and the server itself
still makes no request and writes nothing.

The app reads every operation at rank 0, so an answer read at any other rank, or
one that does not say its rank, gets no link: it could open another rank's
operation under the same id.
"""

from pathlib import Path
from typing import Dict, Optional
from urllib.parse import quote, urlencode

from ttnn_visualizer.agent.app_url import configured_app_url
from ttnn_visualizer.agent.handles import ReportRegistry
from ttnn_visualizer.utils import (
    is_valid_performance_report_dir,
    is_valid_profiler_report_dir,
)

# The query parameters `src/libs/openReportFromLink.ts` reads a report's directories from.
PROFILER_PATH_PARAM = "profiler_path"
PERFORMANCE_PATH_PARAM = "performance_path"

OPERATION_ID_PLACEHOLDER = "{operation_id}"

_LINKABLE_RANKS = (None, 0)


def _openable(path: Optional[str], is_valid) -> Optional[str]:
    """`path` when the app would open it: it refuses a whole link for either half."""
    return path if path and is_valid(Path(path)) else None


def _report_params(registry: ReportRegistry, handle: str) -> Dict[str, str]:
    instance = registry.get(handle)
    params: Dict[str, str] = {}
    profiler = _openable(instance.profiler_path, is_valid_profiler_report_dir)
    performance = _openable(instance.performance_path, is_valid_performance_report_dir)
    if profiler:
        params[PROFILER_PATH_PARAM] = profiler
    if performance:
        params[PERFORMANCE_PATH_PARAM] = performance
    return params


def _link(registry: ReportRegistry, handle: str, route: str) -> Optional[str]:
    base = registry.app_url(handle) or configured_app_url()
    params = _report_params(registry, handle)
    if base is None or not params:
        return None
    return f"{base}{route}?{urlencode(params, quote_via=quote, safe='/')}"


def _operations_link(
    registry: ReportRegistry, handle: str, route: str
) -> Optional[str]:
    """`route` under /operations, when the app can open the memory report."""
    if PROFILER_PATH_PARAM not in _report_params(registry, handle):
        return None
    return _link(registry, handle, route)


def _reads_the_rank_the_app_shows(answer: Dict[str, object]) -> bool:
    return "rank" in answer and answer["rank"] in _LINKABLE_RANKS


def _with(
    result: Dict[str, object], key: str, link: Optional[str]
) -> Dict[str, object]:
    if link:
        result[key] = link
    return result


def with_report_link(
    registry: ReportRegistry, result: Dict[str, object]
) -> Dict[str, object]:
    """`load_report`'s `result`, plus an `app_link` to the report's operations, or to
    its performance view when the app cannot open its memory report."""
    handle = str(result["handle"])
    link = _operations_link(registry, handle, "/operations") or _link(
        registry, handle, "/performance"
    )
    return _with(result, "app_link", link)


def with_operation_link(
    registry: ReportRegistry, result: Dict[str, object]
) -> Dict[str, object]:
    """`result`, plus an `app_link` to the operation it answers about."""
    if not _reads_the_rank_the_app_shows(result):
        return result
    handle = str(result["handle"])
    route = f"/operations/{result['operation_id']}"
    return _with(result, "app_link", _operations_link(registry, handle, route))


def with_operation_link_template(
    registry: ReportRegistry, result: Dict[str, object]
) -> Dict[str, object]:
    """`result`, plus an `app_link_template` to fill with any operation_id it lists."""
    if not _reads_the_rank_the_app_shows(result):
        return result
    handle = str(result["handle"])
    route = f"/operations/{OPERATION_ID_PLACEHOLDER}"
    return _with(result, "app_link_template", _operations_link(registry, handle, route))


def with_linked_rows_link_template(
    registry: ReportRegistry, result: Dict[str, object]
) -> Dict[str, object]:
    """`top_ops`'s `result`, plus an `app_link_template` when its rows carry operation
    ids: the reports linked, at a rank the app shows."""
    operation_link = result.get("operation_link")
    if not (
        isinstance(operation_link, dict)
        and operation_link.get("status") == "linked"
        and _reads_the_rank_the_app_shows(operation_link)
    ):
        return result
    handle = str(result["handle"])
    route = f"/operations/{OPERATION_ID_PLACEHOLDER}"
    return _with(result, "app_link_template", _operations_link(registry, handle, route))


__all__ = [
    "OPERATION_ID_PLACEHOLDER",
    "PERFORMANCE_PATH_PARAM",
    "PROFILER_PATH_PARAM",
    "with_linked_rows_link_template",
    "with_operation_link",
    "with_operation_link_template",
    "with_report_link",
]
