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

import functools
import logging
import os
from pathlib import Path
from typing import Dict, Optional
from urllib.parse import quote, urlencode, urlsplit, urlunsplit

from ttnn_visualizer.agent.handles import ReportRegistry
from ttnn_visualizer.utils import (
    is_valid_performance_report_dir,
    is_valid_profiler_report_dir,
)

logger = logging.getLogger(__name__)

APP_URL_ENV_VAR = "TTNN_VISUALIZER_URL"
DEFAULT_APP_URL = "http://localhost:8000"

# The query parameters `src/libs/openReportFromLink.ts` reads a report's directories from.
PROFILER_PATH_PARAM = "profiler_path"
PERFORMANCE_PATH_PARAM = "performance_path"

OPERATION_ID_PLACEHOLDER = "{operation_id}"

_LINKABLE_RANKS = (None, 0)


class InvalidAppUrlError(ValueError):
    """An app URL a link cannot be built on."""


def checked_app_url(url: object) -> str:
    """`url` as the base of a link: http(s) with a host, no query or fragment, no
    trailing slash."""
    if not isinstance(url, str):
        raise InvalidAppUrlError(f"app URL must be a string; got {url!r}")
    # Python and a browser part ways on these: a browser reads `\` as `/`, so
    # `http://evil.example\@localhost` parses here as localhost and opens evil.example.
    if any(
        char in "\\@" or char.isspace() or not char.isprintable()
        for char in url.strip()
    ):
        raise InvalidAppUrlError(
            "app URL must be a plain http or https URL, with no credentials, "
            f"backslashes or spaces; got {url!r}"
        )
    try:
        parts = urlsplit(url.strip())
        # Read for its check: `port` raises for one out of range, `urlsplit` does not.
        _ = parts.port
    except ValueError as error:
        raise InvalidAppUrlError(
            f"app URL is not a URL ({error}); got {url!r}"
        ) from None
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise InvalidAppUrlError(
            f"app URL must be an http or https URL with a host, e.g. "
            f"{DEFAULT_APP_URL}; got {url!r}"
        )
    # A bare `?` or `#` splits as an empty query or fragment, yet still ends the path.
    if "?" in url or "#" in url:
        raise InvalidAppUrlError(
            f"app URL must not carry a query or fragment; got {url!r}"
        )
    return urlunsplit((parts.scheme, parts.netloc, parts.path.rstrip("/"), "", ""))


def configured_app_url() -> Optional[str]:
    """`TTNN_VISUALIZER_URL`, else the default; None when it is set but unusable."""
    return _checked_configured_url(os.environ.get(APP_URL_ENV_VAR))


# Keyed by the value, so a bad one warns once rather than on every answer.
@functools.lru_cache(maxsize=8)
def _checked_configured_url(configured: Optional[str]) -> Optional[str]:
    if not configured:
        return DEFAULT_APP_URL
    try:
        return checked_app_url(configured)
    except InvalidAppUrlError as error:
        # The default would send the reader to an app the configuration says is not it.
        logger.warning("no links: %s=%s", APP_URL_ENV_VAR, error)
        return None


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


def _link(
    registry: ReportRegistry, handle: str, route: str, params: Dict[str, str]
) -> Optional[str]:
    base = configured_app_url()
    if base is None or not params:
        return None
    return f"{base}{route}?{urlencode(params, quote_via=quote, safe='/')}"


def _operations_link(
    registry: ReportRegistry, handle: str, route: str
) -> Optional[str]:
    """`route` under /operations, when the app can open the memory report."""
    params = _report_params(registry, handle)
    if PROFILER_PATH_PARAM not in params:
        return None
    return _link(registry, handle, route, params)


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
    params = _report_params(registry, handle)
    route = "/operations" if PROFILER_PATH_PARAM in params else "/performance"
    return _with(result, "app_link", _link(registry, handle, route, params))


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
    "APP_URL_ENV_VAR",
    "DEFAULT_APP_URL",
    "InvalidAppUrlError",
    "OPERATION_ID_PLACEHOLDER",
    "PERFORMANCE_PATH_PARAM",
    "PROFILER_PATH_PARAM",
    "checked_app_url",
    "configured_app_url",
    "with_linked_rows_link_template",
    "with_operation_link",
    "with_operation_link_template",
    "with_report_link",
]
