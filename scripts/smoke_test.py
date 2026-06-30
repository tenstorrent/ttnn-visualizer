#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

"""
Playwright smoke tests for the ttnn-visualizer web app.

Verifies the app loads, uploads demo memory reports, and exercises the core
memory-profiler tabs without API or UI errors.
"""

from __future__ import annotations

import asyncio
import sys
import tempfile
from pathlib import Path

from playwright.async_api import Browser, Page, TimeoutError, async_playwright, expect

_SCRIPTS_DIR = Path(__file__).resolve().parent
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))

from smoke_test_helpers import (
    BASE_URL,
    DEMO_REPORT_ZIPS,
    DEMO_REPORTS_DIR,
    MAIN_TAB_NAMES,
    ApiErrorTracker,
    assert_no_error_ui,
    extract_profiler_report_dir,
    verify_server_serving_spa,
)

UPLOAD_TIMEOUT_MS = 180_000
TAB_TIMEOUT_MS = 120_000


async def smoke_test_app_loads(page: Page) -> None:
    """Verify the web app loads and contains expected content."""
    await page.goto(BASE_URL, timeout=10_000)
    await page.wait_for_load_state("networkidle", timeout=10_000)

    title = await page.title()
    print(f"✅ Page loaded successfully. Title: {title}")

    body_text = (await page.text_content("body")) or ""
    if (
        "visualizer" in body_text.lower()
        or "ttnn" in body_text.lower()
        or "tt-nn" in body_text.lower()
    ):
        print("✅ Page contains expected content")
        return

    raise RuntimeError(
        "Page did not contain expected TT-NN Visualizer content.\n"
        f"Body text preview: {body_text[:200]}..."
    )


async def upload_profiler_report(page: Page, report_dir: Path) -> None:
    """Upload a local memory report directory via the Reports page."""
    await page.get_by_role("button", name="Reports").click()
    await page.wait_for_url(f"{BASE_URL}/**")

    upload_input = page.get_by_test_id("local-profiler-upload")
    await upload_input.set_input_files(str(report_dir))

    operations_button = page.get_by_role("button", name="Operations")
    try:
        await expect(operations_button).to_be_enabled(timeout=UPLOAD_TIMEOUT_MS)
    except AssertionError as exc:
        status = page.get_by_test_id("local-profiler-status")
        status_text = (
            await status.text_content() if await status.count() > 0 else "unknown"
        )
        raise TimeoutError(
            f"Operations tab did not become enabled after upload ({status_text})"
        ) from exc

    await assert_no_error_ui(page)
    print(f"✅ Uploaded report from {report_dir.name}")


async def exercise_main_tabs(page: Page) -> None:
    """Click Operations, Tensors, and Buffers and wait for each view to settle."""
    tab_urls = {
        "Operations": "**/operations**",
        "Tensors": "**/tensors**",
        "Buffers": "**/buffer-summary**",
    }

    for tab_name in MAIN_TAB_NAMES:
        tab_button = page.get_by_role("button", name=tab_name)
        if not await tab_button.is_enabled():
            raise AssertionError(f"{tab_name} tab is disabled after upload")

        await tab_button.click()
        await page.wait_for_url(tab_urls[tab_name], timeout=TAB_TIMEOUT_MS)

        spinner = page.locator(".loading-spinner").first
        try:
            if await spinner.is_visible():
                await spinner.wait_for(state="hidden", timeout=TAB_TIMEOUT_MS)
        except TimeoutError:
            # Some views render without a spinner when data is already cached.
            pass

        await page.wait_for_load_state("networkidle", timeout=TAB_TIMEOUT_MS)
        await assert_no_error_ui(page)
        print(f"✅ {tab_name} tab loaded without errors")


async def smoke_test_report_tabs(browser: Browser) -> None:
    """Upload each demo report and walk the main memory-profiler tabs."""
    for zip_name in DEMO_REPORT_ZIPS:
        zip_path = DEMO_REPORTS_DIR / zip_name
        if not zip_path.is_file():
            raise FileNotFoundError(f"Demo report not found: {zip_path}")

        page = await browser.new_page()
        tracker = ApiErrorTracker()
        tracker.attach(page)

        try:
            await page.goto(BASE_URL, timeout=10_000)
            await page.wait_for_load_state("networkidle", timeout=10_000)

            with tempfile.TemporaryDirectory(prefix="smoke-report-") as temp_dir:
                report_dir = extract_profiler_report_dir(zip_path, Path(temp_dir))
                print(f"▶️  Smoke testing {zip_name} ({report_dir.name})")
                await upload_profiler_report(page, report_dir)
                await exercise_main_tabs(page)

            if tracker.errors:
                raise AssertionError(
                    "API errors during report tab smoke test:\n"
                    + "\n".join(tracker.errors)
                )
            print(f"✅ Report tab smoke test passed for {zip_name}")
        finally:
            await page.close()


async def run_smoke_tests() -> None:
    """Run all smoke tests in a single browser session where possible."""
    verify_server_serving_spa()

    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch()

        page = await browser.new_page()
        try:
            await smoke_test_app_loads(page)
        except Exception as exc:
            print(f"❌ App load smoke test failed: {exc}")
            await browser.close()
            raise
        finally:
            await page.close()

        try:
            await smoke_test_report_tabs(browser)
        except Exception as exc:
            print(f"❌ Report tab smoke test failed: {exc}")
            raise
        finally:
            await browser.close()


if __name__ == "__main__":
    try:
        asyncio.run(run_smoke_tests())
    except Exception as exc:
        print(f"❌ Smoke test failed: {exc}")
        sys.exit(1)
