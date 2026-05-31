#!/usr/bin/env python3
"""
Playwright script to capture screenshots of all pdomain-prep-for-pgdp screens.
Requires: uv run --group e2e python scripts/capture_screenshots.py
Server must be running at BASE_URL below.
"""

import asyncio
import importlib
from collections.abc import Awaitable, Callable, Mapping
from pathlib import Path
from typing import Protocol, cast

BASE_URL = "http://127.0.0.1:58693"
OUT_DIR = Path(__file__).parent.parent / "docs/design-brief/existing-ui/screenshots"
OUT_DIR.mkdir(parents=True, exist_ok=True)

VIEWPORT = {"width": 1440, "height": 900}


class _Locator(Protocol):
    def count(self) -> Awaitable[int]: ...

    def click(self) -> Awaitable[None]: ...


class _Page(Protocol):
    async def goto(self, url: str) -> None: ...

    def get_by_role(self, role: str, /, name: str) -> _Locator: ...

    async def wait_for_load_state(self, state: str) -> None: ...

    async def screenshot(self, path: str, full_page: bool = False) -> bytes: ...

    async def wait_for_timeout(self, timeout: int) -> None: ...


class _Browser(Protocol):
    async def new_page(self, viewport: Mapping[str, int]) -> _Page: ...

    async def close(self) -> None: ...


class _Chromium(Protocol):
    def launch(self) -> Awaitable[_Browser]: ...


class _Playwright(Protocol):
    chromium: _Chromium


class _AsyncPlaywright(Protocol):
    async def __aenter__(self) -> _Playwright: ...

    async def __aexit__(self, *exc: object) -> None: ...


class _PlaywrightModule(Protocol):
    def async_playwright(self) -> _AsyncPlaywright: ...


async def capture(
    playwright: _Playwright,
    url_path: str,
    filename: str,
    *,
    wait_ms: int = 1500,
    setup: Callable[[_Page], Awaitable[None]] | None = None,
) -> None:
    browser = await playwright.chromium.launch()
    page = await browser.new_page(viewport=VIEWPORT)
    await page.goto(f"{BASE_URL}{url_path}")
    await page.wait_for_load_state("networkidle")
    if setup is not None:
        await setup(page)
    await page.wait_for_timeout(wait_ms)
    out = OUT_DIR / filename
    _ = await page.screenshot(path=str(out), full_page=False)
    print(f"  ✓ {filename}")
    await browser.close()


async def main() -> None:
    playwright = cast("_PlaywrightModule", cast("object", importlib.import_module("playwright.async_api")))
    async_playwright = playwright.async_playwright

    async with async_playwright() as pw:
        print("Capturing existing UI screens...")

        # 00 — ProjectListPage
        await capture(pw, "/", "00-project-list.png")

        # 01 — CreateProjectModal (trigger by clicking "+ New Project")
        async def open_create_modal(page: _Page) -> None:
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
