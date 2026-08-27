#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

"""
Playwright smoke tests for the ttnn-visualizer web app.

Verifies the app loads, uploads demo memory reports and a performance report,
and exercises the core memory-profiler tabs plus the performance and NPE views
without API or UI errors.
"""

from __future__ import annotations

import asyncio
import sys
import tempfile
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path

from playwright.async_api import (
    Browser,
    Locator,
    Page,
    TimeoutError,
    async_playwright,
    expect,
)

_SCRIPTS_DIR = Path(__file__).resolve().parent
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))

from smoke_test_helpers import (
    BASE_URL,
    DEMO_REPORT_ZIPS,
    DEMO_REPORTS_DIR,
    HOME_URL,
    MAIN_TAB_NAMES,
    PERFORMANCE_FIXTURE_DIR,
    ApiErrorTracker,
    assert_no_error_ui,
    extract_profiler_report_dir,
    verify_server_serving_spa,
)

UPLOAD_TIMEOUT_MS = 180_000
TAB_TIMEOUT_MS = 120_000
TAB_ENABLED_TIMEOUT_MS = 5_000
SPINNER_VISIBLE_TIMEOUT_MS = 2_000
PAGE_LOAD_TIMEOUT_MS = 10_000


@dataclass(frozen=True)
class UploadKind:
    """The four values that differ between the two report upload flows."""

    label: str
    upload_test_id: str
    status_test_id: str
    gate_button: str


PROFILER_UPLOAD = UploadKind(
    label="memory report",
    upload_test_id="local-profiler-upload",
    status_test_id="local-profiler-status",
    gate_button="Operations",
)

PERFORMANCE_UPLOAD = UploadKind(
    label="performance report",
    upload_test_id="local-performance-upload",
    status_test_id="local-performance-status",
    gate_button="Performance",
)

# Performance routes the SPA actually calls, asserted via the response tracker.
SPA_PERFORMANCE_ROUTES = (
    "/api/performance",
    "/api/performance/perf-results/report",
    "/api/performance/device-log/meta",
    "/api/performance/npe/manifest",
    "/api/performance/npe/timeline",
)

# Performance routes #1859 lists that no SPA code path calls, so no
# browser-driven walk can reach them. Asserted directly instead of silently
# left uncovered — see `assert_unreachable_routes_answer`.
UNREACHABLE_PERFORMANCE_ROUTES = (
    "/api/performance/device-log",
    "/api/performance/device-log/raw",
    "/api/performance/perf-results",
    "/api/performance/perf-results/raw",
)

# `NPE.tsx` renders `NPEProcessingStatus` for every failure mode rather than the
# router error page, so these are what a broken timeline looks like.
NPE_FAILURE_TEST_IDS = (
    "npe-processing-invalid-data",
    "npe-processing-invalid-version",
    "npe-processing-invalid-json",
    "npe-processing-empty-trace",
    "npe-processing-unhandled-error",
)


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


def nav_button(page: Page, name: str) -> Locator:
    """Locate a main-navigation button by its exact accessible name.

    `get_by_role(name=...)` matches a case-insensitive *substring* by default,
    and the report picker relabels itself to the active report once an upload
    lands — so a fixture directory named `smoke-performance-report` also matched
    a loose "Performance" lookup. Two matches is a strict-mode violation, which
    surfaces as an immediate assertion failure rather than a timeout and only
    once the picker has re-rendered, which made it fail on some CI matrix legs
    and not others. Every nav button carries an `aria-label` identical to its
    text, so matching exactly is safe here and keeps any report name from
    colliding with a nav lookup.
    """
    return page.get_by_role("button", name=name, exact=True)


@asynccontextmanager
async def tracked_page(
    browser: Browser, label: str
) -> AsyncIterator[tuple[Page, ApiErrorTracker]]:
    """Open a page with an attached `ApiErrorTracker`, asserted on clean exit.

    Owning the assertion here means a new scenario cannot forget to check the
    tracker it attached.
    """
    page = await browser.new_page()
    tracker = ApiErrorTracker()
    tracker.attach(page)

    try:
        await page.goto(BASE_URL, timeout=PAGE_LOAD_TIMEOUT_MS)
        await page.wait_for_load_state("networkidle", timeout=PAGE_LOAD_TIMEOUT_MS)

        yield page, tracker

        tracker.assert_no_server_errors(label)
    finally:
        await page.close()


async def upload_report(page: Page, report_dir: Path, kind: UploadKind) -> None:
    """Upload a local report directory via the Reports page."""
    await nav_button(page, "Reports").click()
    await page.wait_for_url(HOME_URL)

    upload_input = page.get_by_test_id(kind.upload_test_id)
    await upload_input.set_input_files(str(report_dir))

    gate_button = nav_button(page, kind.gate_button)
    try:
        await expect(gate_button).to_be_enabled(timeout=UPLOAD_TIMEOUT_MS)
    except AssertionError as exc:
        status = page.get_by_test_id(kind.status_test_id)
        status_text = (
            await status.text_content() if await status.count() > 0 else "unknown"
        )
        raise TimeoutError(
            f"{kind.gate_button} tab did not become enabled after uploading the "
            f"{kind.label} ({status_text})"
        ) from exc

    await assert_no_error_ui(page)
    print(f"✅ Uploaded {kind.label} from {report_dir.name}")


async def wait_for_view_to_settle(page: Page) -> None:
    """Wait out the loading spinner and in-flight requests for the current view."""
    spinner = page.locator(".loading-spinner").first
    try:
        await spinner.wait_for(state="visible", timeout=SPINNER_VISIBLE_TIMEOUT_MS)
        await spinner.wait_for(state="hidden", timeout=TAB_TIMEOUT_MS)
    except TimeoutError:
        # Some views render without a spinner when data is already cached.
        pass

    await page.wait_for_load_state("networkidle", timeout=TAB_TIMEOUT_MS)


async def exercise_main_tabs(page: Page) -> None:
    """Click Operations, Tensors, and Buffers and wait for each view to settle."""
    tab_urls = {
        "Operations": "**/operations**",
        "Tensors": "**/tensors**",
        "Buffers": "**/buffer-summary**",
    }

    for tab_name in MAIN_TAB_NAMES:
        tab_button = nav_button(page, tab_name)
        await expect(tab_button).to_be_enabled(timeout=TAB_ENABLED_TIMEOUT_MS)

        await tab_button.click()
        await page.wait_for_url(tab_urls[tab_name], timeout=TAB_TIMEOUT_MS)

        await wait_for_view_to_settle(page)
        await assert_no_error_ui(page)
        print(f"✅ {tab_name} tab loaded without errors")


async def assert_npe_view_rendered(page: Page) -> None:
    """Fail unless the NPE route actually rendered a timeline.

    `assert_no_error_ui` only looks for the router `#error-page`, and the API
    error tracker ignores anything below 500 — but every NPE failure mode
    (invalid data, invalid JSON, empty trace) renders `NPEProcessingStatus`
    instead, and a 404 or 422 from the timeline endpoint lands there too.
    Without a positive assertion this leg passes no matter what came back,
    which would leave the fixture's `global_call_count` join unverified —
    the very thing it exists to prove.
    """
    npe_view = page.get_by_test_id("npe-view").or_(
        page.get_by_test_id("npe-windowed-view")
    )

    try:
        await npe_view.first.wait_for(state="visible", timeout=TAB_TIMEOUT_MS)
    except TimeoutError as exc:
        reported = [
            test_id
            for test_id in NPE_FAILURE_TEST_IDS
            if await page.get_by_test_id(test_id).count() > 0
        ]
        detail = f" NPE reported: {', '.join(reported)}." if reported else ""
        raise AssertionError(f"NPE timeline did not render a view.{detail}") from exc

    for test_id in NPE_FAILURE_TEST_IDS:
        if await page.get_by_test_id(test_id).count() > 0:
            raise AssertionError(f"NPE view rendered a failure state: {test_id}")


async def assert_unreachable_routes_answer(page: Page) -> None:
    """Cover the performance routes that no SPA code path calls.

    Grepping `Endpoints.PERFORMANCE` across `src/` turns up callers for only
    five of the nine routes #1859 enumerates; `views.py` even marks
    `/device-log/raw` as no longer used. No browser-driven walk can reach the
    other four, so they are asserted directly against the instance the upload
    just bound rather than being quietly left off the list.
    """
    instance_id = await page.evaluate("() => sessionStorage.getItem('instanceId')")
    if not instance_id:
        raise AssertionError("SPA did not store an instanceId to query with")

    for route in UNREACHABLE_PERFORMANCE_ROUTES:
        response = await page.request.get(
            f"{BASE_URL}{route}", params={"instanceId": instance_id}
        )
        if response.status >= 400:
            body = (await response.text())[:200]
            raise AssertionError(f"{route} answered {response.status}: {body}")
        print(f"✅ {route} answered {response.status}")

    # A 200 carrying mislabelled columns is exactly how #1941 shipped, so the
    # device log gets a shape check on top of its status.
    device_log = await (
        await page.request.get(
            f"{BASE_URL}/api/performance/device-log", params={"instanceId": instance_id}
        )
    ).json()
    if not isinstance(device_log, list) or not device_log:
        raise AssertionError(f"/api/performance/device-log returned {device_log!r}")
    missing = {"zone_name", "run_host_ID", "type"} - set(device_log[0])
    if missing:
        raise AssertionError(f"/api/performance/device-log is missing keys: {missing}")
    print("✅ /api/performance/device-log returned named columns")


async def exercise_performance_tab(page: Page) -> None:
    """Open the Performance view and follow its NPE timeline link.

    Visiting the tab covers the perf-results report, device-log meta and NPE
    manifest endpoints. The NPE link is rendered only when a manifest entry's
    `global_call_count` matches a report row, so clicking it — rather than
    navigating to the timeline URL directly — is what proves that join survived
    ingestion, on top of covering `/api/performance/npe/timeline`.
    """
    performance_button = nav_button(page, "Performance")
    await expect(performance_button).to_be_enabled(timeout=TAB_ENABLED_TIMEOUT_MS)

    await performance_button.click()
    await page.wait_for_url("**/performance**", timeout=TAB_TIMEOUT_MS)
    await wait_for_view_to_settle(page)
    await assert_no_error_ui(page)
    print("✅ Performance tab loaded without errors")

    npe_link = page.get_by_test_id("perf-npe-link").first
    try:
        await npe_link.wait_for(state="visible", timeout=TAB_ENABLED_TIMEOUT_MS)
    except TimeoutError as exc:
        raise AssertionError(
            "No NPE link in the performance table. The fixture's npe_viz/manifest.json "
            "should join a report row by global_call_count — regenerate it with "
            "scripts/generate_smoke_perf_fixture.py if the report shape changed."
        ) from exc

    await npe_link.click()
    await page.wait_for_url("**/npe/**", timeout=TAB_TIMEOUT_MS)
    await wait_for_view_to_settle(page)
    await assert_no_error_ui(page)
    await assert_npe_view_rendered(page)
    print("✅ NPE timeline rendered a view")


async def smoke_test_performance_report(browser: Browser) -> None:
    """Upload the performance fixture and exercise the performance views.

    Kept separate from the memory-report walk: the fixture is independent of
    `DEMO_REPORT_ZIPS`, and the Performance tab is gated on its own active-report
    state, so it cannot simply be appended to `MAIN_TAB_NAMES`.
    """
    if not PERFORMANCE_FIXTURE_DIR.is_dir():
        raise FileNotFoundError(
            f"Performance fixture not found: {PERFORMANCE_FIXTURE_DIR}"
        )

    async with tracked_page(browser, "performance smoke test") as (page, tracker):
        print(f"▶️  Smoke testing performance report ({PERFORMANCE_FIXTURE_DIR.name})")
        await upload_report(page, PERFORMANCE_FIXTURE_DIR, PERFORMANCE_UPLOAD)
        await exercise_performance_tab(page)
        await assert_unreachable_routes_answer(page)

        # Turns the coverage claim into an assertion: every performance route
        # the SPA drives must have been seen answering 2xx during this walk.
        tracker.assert_answered_ok(SPA_PERFORMANCE_ROUTES)

    print("✅ Performance smoke test passed")


async def smoke_test_report_tabs(browser: Browser) -> None:
    """Upload each demo report and walk the main memory-profiler tabs."""
    for zip_name in DEMO_REPORT_ZIPS:
        zip_path = DEMO_REPORTS_DIR / zip_name
        if not zip_path.is_file():
            raise FileNotFoundError(f"Demo report not found: {zip_path}")

        async with tracked_page(browser, f"report tab smoke test ({zip_name})") as (
            page,
            _tracker,
        ):
            with tempfile.TemporaryDirectory(prefix="smoke-report-") as temp_dir:
                report_dir = extract_profiler_report_dir(zip_path, Path(temp_dir))
                print(f"▶️  Smoke testing {zip_name} ({report_dir.name})")
                await upload_report(page, report_dir, PROFILER_UPLOAD)
                await exercise_main_tabs(page)

        print(f"✅ Report tab smoke test passed for {zip_name}")


async def run_smoke_tests() -> None:
    """Run all smoke tests in a single browser session where possible."""
    verify_server_serving_spa()

    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch()

        try:
            page = await browser.new_page()
            try:
                await smoke_test_app_loads(page)
            except Exception as exc:
                print(f"❌ App load smoke test failed: {exc}")
                raise
            finally:
                await page.close()

            try:
                await smoke_test_report_tabs(browser)
            except Exception as exc:
                print(f"❌ Report tab smoke test failed: {exc}")
                raise

            try:
                await smoke_test_performance_report(browser)
            except Exception as exc:
                print(f"❌ Performance smoke test failed: {exc}")
                raise
        finally:
            await browser.close()


if __name__ == "__main__":
    try:
        asyncio.run(run_smoke_tests())
    except Exception as exc:
        print(f"❌ Smoke test failed: {exc}")
        sys.exit(1)
