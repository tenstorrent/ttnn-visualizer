# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Shared helpers for Playwright smoke tests."""

from __future__ import annotations

import os
import re
import urllib.error
import urllib.request
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

from playwright.async_api import Page, Response
from report_fixtures import (  # noqa: F401 - re-exported for smoke_test.py
    DEMO_REPORTS_DIR,
    PERFORMANCE_FIXTURE_DIR,
    PROFILER_MARKER_FILE,
    REPO_ROOT,
    extract_report_dir,
)

BASE_URL = os.getenv("SMOKE_TEST_BASE_URL", "http://localhost:8000").rstrip("/")
HOME_URL = re.compile(f"^{re.escape(BASE_URL)}/?$")

DEMO_REPORT_ZIPS = (
    "n300-llama.zip",
    "segformer_decoder_3119846618735255520.zip",
    "segformer_encoder_11911356357027855134.zip",
)

MAIN_TAB_NAMES = ("Operations", "Tensors", "Buffers")

SERVER_SETUP_HINT = """\
Smoke tests require the production server with a built frontend at {base_url}.

Development mode (pnpm dev + flask:start-debug) only serves the API on port 8000.
The React app runs on Vite at http://localhost:5173 instead.

In a separate terminal:
  pnpm build
  FLASK_ENV=production uv run ttnn-visualizer

Or:
  pnpm serve
"""


def verify_server_serving_spa(base_url: str = BASE_URL) -> None:
    """Fail fast when the server is not serving the built SPA."""
    request = urllib.request.Request(base_url, headers={"Accept": "text/html"})
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            content_type = response.headers.get("Content-Type", "")
            body = response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        content_type = exc.headers.get("Content-Type", "")
        body = exc.read().decode("utf-8", errors="replace")
    except urllib.error.URLError as exc:
        raise RuntimeError(
            f"Could not reach {base_url}.\n\n{SERVER_SETUP_HINT.format(base_url=base_url)}"
        ) from exc

    if "application/json" in content_type or body.lstrip().startswith("{"):
        raise RuntimeError(
            f"{base_url} returned JSON instead of the SPA.\n\n"
            f"{SERVER_SETUP_HINT.format(base_url=base_url)}"
        )

    if 'id="root"' not in body and "TT-NN Visualizer" not in body:
        raise RuntimeError(
            f"{base_url} did not return the TT-NN Visualizer app.\n\n"
            f"Response preview: {body[:200]!r}\n\n"
            f"{SERVER_SETUP_HINT.format(base_url=base_url)}"
        )


@dataclass
class ApiErrorTracker:
    """Records every `/api/` response, and flags the ones with status >= 500.

    Flagging only 5xx is deliberately not enough on its own: the report-root bug
    this suite guards against surfaces as a 404, and the perf page legitimately
    404s profiler-scoped requests when no memory report is loaded, so blanket
    4xx failure would be wrong. Instead every status is recorded per path, and
    scenarios assert that the endpoints they claim to cover were actually seen
    answering 2xx — which makes a coverage claim checkable rather than
    aspirational.
    """

    errors: list[str] = field(default_factory=list)
    statuses_by_path: dict[str, set[int]] = field(default_factory=dict)

    def attach(self, page: Page) -> None:
        page.on("response", self._on_response)

    def _on_response(self, response: Response) -> None:
        path = urlsplit(response.url).path
        if "/api/" not in path:
            return

        self.statuses_by_path.setdefault(path, set()).add(response.status)

        if response.status >= 500:
            self.errors.append(
                f"{response.status} {response.request.method} {response.url}"
            )

    def assert_no_server_errors(self, label: str) -> None:
        if self.errors:
            raise AssertionError(
                f"API errors during {label}:\n" + "\n".join(self.errors)
            )

    def assert_answered_ok(self, paths: Iterable[str]) -> None:
        """Fail unless each path was observed answering 2xx at least once."""
        missing = []
        for path in paths:
            seen = self.statuses_by_path.get(path)
            if not seen:
                missing.append(f"{path} (never requested)")
            elif not any(200 <= status < 300 for status in seen):
                missing.append(f"{path} (only saw {sorted(seen)})")

        if missing:
            raise AssertionError(
                "Endpoints the smoke test claims to cover did not answer 2xx:\n"
                + "\n".join(missing)
            )


def extract_profiler_report_dir(zip_path: Path, work_dir: Path) -> Path:
    """Extract the memory-profiler report folder from a demo zip archive."""
    return extract_report_dir(zip_path, work_dir, PROFILER_MARKER_FILE)


async def assert_no_error_ui(page: Page) -> None:
    """Fail when the React router error page is visible."""
    error_page = page.locator("#error-page")
    if await error_page.count() > 0 and await error_page.is_visible():
        message = await error_page.text_content()
        raise AssertionError(f"Error page visible: {message}")
