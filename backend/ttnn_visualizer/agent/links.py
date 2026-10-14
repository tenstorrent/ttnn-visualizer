# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Links from a tool's answer to the same thing in the web application. #2047

A link names the report by its directories, and the app opens those directories
when the link is followed, as `ttnn-visualizer --profiler-path` does. So a link
lands on the report the agent read rather than on whatever the reader's tab has
open, and the server itself still makes no request and writes nothing.

The app reads every operation at rank 0, so an answer read at any other rank gets
no link: it would open that rank-0 operation under the same id.
"""

import logging
import os
from typing import TYPE_CHECKING, Dict, Optional
from urllib.parse import quote, urlencode, urlsplit

from ttnn_visualizer.models import Instance

if TYPE_CHECKING:
    # `handles` imports `checked_app_url` from here to validate `load_report`.
    from ttnn_visualizer.agent.handles import ReportRegistry

logger = logging.getLogger(__name__)

APP_URL_ENV_VAR = "TTNN_VISUALIZER_URL"
DEFAULT_APP_URL = "http://localhost:8000"

# The query parameters the app reads a report's directories from.
PROFILER_PATH_PARAM = "profiler_path"
PERFORMANCE_PATH_PARAM = "performance_path"

OPERATION_ID_PLACEHOLDER = "{operation_id}"

_LINKABLE_RANKS = (None, 0)


class InvalidAppUrlError(ValueError):
    """An app URL a link cannot be built on."""


def checked_app_url(url: str) -> str:
    """`url` without a trailing slash, refused unless it is an http(s) URL with a host."""
    parts = urlsplit(url.strip())
    if parts.scheme not in ("http", "https") or not parts.netloc:
        raise InvalidAppUrlError(
            f"app_url must be an http or https URL with a host, e.g. "
            f"{DEFAULT_APP_URL}; got {url!r}"
        )
    if parts.query or parts.fragment:
        raise InvalidAppUrlError(
            f"app_url must not carry a query or fragment; got {url!r}"
        )
    return url.strip().rstrip("/")


def _app_url(registry: "ReportRegistry", handle: str) -> Optional[str]:
    override = registry.app_url(handle)
    if override:
        return override
    configured = os.environ.get(APP_URL_ENV_VAR)
    if not configured:
        return DEFAULT_APP_URL
    try:
        return checked_app_url(configured)
    except InvalidAppUrlError as error:
        # Pointing at the default instead would send the reader to an app the
        # configuration says is not the one.
        logger.warning("no links: %s=%s", APP_URL_ENV_VAR, error)
        return None


def _report_query(instance: Instance) -> str:
    params: Dict[str, str] = {}
    if instance.profiler_path:
        params[PROFILER_PATH_PARAM] = instance.profiler_path
    if instance.performance_path:
        params[PERFORMANCE_PATH_PARAM] = instance.performance_path
    return urlencode(params, quote_via=quote, safe="/")


def _link(registry: "ReportRegistry", handle: str, route: str) -> Optional[str]:
    base = _app_url(registry, handle)
    if base is None:
        return None
    return f"{base}{route}?{_report_query(registry.get(handle))}"


def with_report_link(
    registry: "ReportRegistry", result: Dict[str, object]
) -> Dict[str, object]:
    """`load_report`'s `result`, plus a `link` to the report's operations, or to its
    performance view when it has no profiler report."""
    handle = str(result["handle"])
    route = "/operations" if registry.get(handle).profiler_path else "/performance"
    link = _link(registry, handle, route)
    if link:
        result["link"] = link
    return result


def _is_linkable(registry: "ReportRegistry", handle: str, result: Dict) -> bool:
    return bool(registry.get(handle).profiler_path) and (
        result.get("rank") in _LINKABLE_RANKS
    )


def with_operation_link(
    registry: "ReportRegistry", handle: str, result: Dict[str, object]
) -> Dict[str, object]:
    """`result`, plus a `link` to the operation it answers about."""
    if _is_linkable(registry, handle, result):
        link = _link(registry, handle, f"/operations/{result['operation_id']}")
        if link:
            result["link"] = link
    return result


def with_operation_link_template(
    registry: "ReportRegistry", handle: str, result: Dict[str, object]
) -> Dict[str, object]:
    """`result`, plus a `link_template` to fill with any operation_id it lists."""
    if _is_linkable(registry, handle, result):
        template = _link(registry, handle, f"/operations/{OPERATION_ID_PLACEHOLDER}")
        if template:
            result["link_template"] = template
    return result


def with_linked_rows_link_template(
    registry: "ReportRegistry", handle: str, result: Dict[str, object]
) -> Dict[str, object]:
    """`top_ops`'s `result`, plus a `link_template` when its rows carry operation ids."""
    operation_link = result.get("operation_link")
    if isinstance(operation_link, dict) and operation_link.get("status") == "linked":
        with_operation_link_template(registry, handle, result)
    return result


__all__ = [
    "APP_URL_ENV_VAR",
    "DEFAULT_APP_URL",
    "InvalidAppUrlError",
    "OPERATION_ID_PLACEHOLDER",
    "PERFORMANCE_PATH_PARAM",
    "PROFILER_PATH_PARAM",
    "checked_app_url",
    "with_linked_rows_link_template",
    "with_operation_link",
    "with_operation_link_template",
    "with_report_link",
]
