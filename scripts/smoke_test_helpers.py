# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Shared helpers for Playwright smoke tests."""

from __future__ import annotations

import os
import urllib.error
import urllib.request
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

from playwright.async_api import Page, Response

BASE_URL = os.getenv("SMOKE_TEST_BASE_URL", "http://localhost:8000").rstrip("/")
REPO_ROOT = Path(__file__).resolve().parent.parent
DEMO_REPORTS_DIR = REPO_ROOT / "demo-reports"

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
    """Collects /api/ responses with HTTP status >= 500."""

    errors: list[str] = field(default_factory=list)

    def attach(self, page: Page) -> None:
        page.on("response", self._on_response)

    def _on_response(self, response: Response) -> None:
        if "/api/" not in response.url or response.status < 500:
            return
        self.errors.append(
            f"{response.status} {response.request.method} {response.url}"
        )


def extract_profiler_report_dir(zip_path: Path, work_dir: Path) -> Path:
    """Extract the memory-profiler report folder from a demo zip archive."""
    with zipfile.ZipFile(zip_path) as archive:
        db_paths = [name for name in archive.namelist() if name.endswith("/db.sqlite")]
        if not db_paths:
            raise ValueError(f"No db.sqlite found in {zip_path}")

        report_prefix = f"{db_paths[0].rsplit('/', 1)[0]}/"
        report_name = report_prefix.rstrip("/").split("/")[-1]
        report_dir = work_dir / report_name
        report_dir.mkdir(parents=True, exist_ok=True)

        for name in archive.namelist():
            if not name.startswith(report_prefix) or name.endswith("/"):
                continue
            relative_path = name[len(report_prefix) :]
            target = report_dir / relative_path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(archive.read(name))

        return report_dir


async def assert_no_error_ui(page: Page) -> None:
    """Fail when the React router error page is visible."""
    error_page = page.locator("#error-page")
    if await error_page.count() > 0 and await error_page.is_visible():
        message = await error_page.text_content()
        raise AssertionError(f"Error page visible: {message}")
