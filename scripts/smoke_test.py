#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

"""
Simple smoke test using Playwright to verify the ttnn-visualizer web app loads correctly.
"""

import asyncio
import sys

from playwright.async_api import async_playwright


async def smoke_test():
    """Run basic smoke test to verify the web app loads."""
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()

        try:
            # Navigate to the app
            await page.goto("http://localhost:8000", timeout=10000)

            # Wait for the page to load and check title
            await page.wait_for_load_state("networkidle", timeout=10000)
            title = await page.title()
            print(f"✅ Page loaded successfully. Title: {title}")

            # Check if the page contains expected content
            body_text = await page.text_content("body")
            if (
                "visualizer" in body_text.lower()
                or "ttnn" in body_text.lower()
                or "tt-nn" in body_text.lower()
            ):
                print("✅ Page contains expected content")
            else:
                print(
                    "⚠️  Page may not have loaded correctly - no expected content found"
                )
                print(f"Body text preview: {body_text[:200]}...")

        except Exception as e:
            print(f"❌ Smoke test failed: {e}")
            raise
        finally:
            await browser.close()


if __name__ == "__main__":
    # Run the test
    asyncio.run(smoke_test())
