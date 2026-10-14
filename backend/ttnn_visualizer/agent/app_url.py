# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Where the web application the agent tools link into lives. #2047

A leaf, so `handles` can check `load_report`'s `app_url` and `app_links` can build
on it without either importing the other.
"""

import ipaddress
import logging
import os
from typing import Optional
from urllib.parse import urlsplit, urlunsplit

logger = logging.getLogger(__name__)

APP_URL_ENV_VAR = "TTNN_VISUALIZER_URL"
DEFAULT_APP_URL = "http://localhost:8000"


class InvalidAppUrlError(ValueError):
    """An app URL a link cannot be built on."""


def _is_loopback(host: str) -> bool:
    if host == "localhost" or host.endswith(".localhost"):
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def checked_app_url(url: object, loopback_only: bool = False) -> str:
    """`url` as the base of a link: http(s) with a host, no query or fragment, no
    trailing slash. `loopback_only` also refuses any host but this machine."""
    if not isinstance(url, str):
        raise InvalidAppUrlError(f"app_url must be a string; got {url!r}")
    parts = urlsplit(url.strip())
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise InvalidAppUrlError(
            f"app_url must be an http or https URL with a host, e.g. "
            f"{DEFAULT_APP_URL}; got {url!r}"
        )
    # A bare `?` or `#` splits as an empty query or fragment, yet still ends the path.
    if "?" in url or "#" in url:
        raise InvalidAppUrlError(
            f"app_url must not carry a query or fragment; got {url!r}"
        )
    if loopback_only and not _is_loopback(parts.hostname):
        raise InvalidAppUrlError(
            "app_url must name this machine (localhost or a loopback address), "
            f"since a link carries local report paths; set {APP_URL_ENV_VAR} to "
            f"link elsewhere; got {url!r}"
        )
    return urlunsplit((parts.scheme, parts.netloc, parts.path.rstrip("/"), "", ""))


def configured_app_url() -> Optional[str]:
    """`TTNN_VISUALIZER_URL`, else the default; None when it is set but unusable."""
    configured = os.environ.get(APP_URL_ENV_VAR)
    if not configured:
        return DEFAULT_APP_URL
    try:
        return checked_app_url(configured)
    except InvalidAppUrlError as error:
        # The default would send the reader to an app the configuration says is not it.
        logger.warning("no links: %s=%s", APP_URL_ENV_VAR, error)
        return None


__all__ = [
    "APP_URL_ENV_VAR",
    "DEFAULT_APP_URL",
    "InvalidAppUrlError",
    "checked_app_url",
    "configured_app_url",
]
