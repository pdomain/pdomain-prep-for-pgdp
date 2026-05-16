#!/usr/bin/env python3
"""
Playwright script to capture screenshots of all pd-prep-for-pgdp screens.
Requires: uv run --group e2e python scripts/capture-screenshots.py
Server must be running at BASE_URL below.
"""

import asyncio
from pathlib import Path

BASE_URL = "http://127.0.0.1:58693"
OUT_DIR = Path(__file__).parent.parent / "docs/design-brief/existing-ui/screenshots"
OUT_DIR.mkdir(parents=True, exist_ok=True)

VIEWPORT = {"width": 1440, "height": 900}


async def capture(playwright, url_path: str, filename: str, *, wait_ms: int = 1500, setup=None):
    browser = await playwright.chromium.launch()
    page = await browser.new_page(viewport=VIEWPORT)
    await page.goto(f"{BASE_URL}{url_path}")
    await page.wait_for_load_state("networkidle")
    if setup:
        await setup(page)
    await page.wait_for_timeout(wait_ms)
    out = OUT_DIR / filename
    await page.screenshot(path=str(out), full_page=False)
    print(f"  ✓ {filename}")
    await browser.close()


async def main():
    from playwright.async_api import async_playwright

    async with async_playwright() as pw:
        print("Capturing existing UI screens...")

        # 00 — ProjectListPage
        await capture(pw, "/", "00-project-list.png")

        # 01 — CreateProjectModal (trigger by clicking "+ New Project")
        async def open_create_modal(page):
            btn = page.get_by_role("button", name="New Project")
            if await btn.count():
                await btn.click()
                await page.wait_for_timeout(300)

        await capture(pw, "/", "01-new-project-modal.png", setup=open_create_modal)

        # 02 — JobsPage
        await capture(pw, "/jobs", "02-jobs-page.png")

        # 08 — SettingsPage
        await capture(pw, "/settings", "08-settings.png")

        print("\nNote: Routes /projects/:id/* require an existing project.")
        print("Run the app, create a project, then re-run this script for workbench shots.")
        print("\nDone. Screenshots saved to:", OUT_DIR)


if __name__ == "__main__":
    asyncio.run(main())
