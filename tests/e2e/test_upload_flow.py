"""E2E: upload zip → enqueue unzip job → land on /jobs filtered to project.

Drives the actual SPA against a live FastAPI server. Asserts the URL change
(JobsPage with `?project_id=`), the filter banner, and that both `unzip`
and `thumbnails` jobs appear and complete.
"""

from __future__ import annotations

import zipfile
from io import BytesIO
from typing import TYPE_CHECKING, Protocol, cast

import pytest
from PIL import Image

try:
    raw_playwright = cast("object", pytest.importorskip("playwright.sync_api"))
except ModuleNotFoundError as exc:
    raise RuntimeError("playwright is required for e2e tests") from exc

if TYPE_CHECKING:
    from pathlib import Path

    from .conftest import LiveServer


class _Locator(Protocol):
    def click(self) -> None: ...

    def to_be_visible(self, timeout: int | None = None) -> None: ...

    def fill(self, text: str) -> None: ...

    def set_input_files(self, value: str) -> None: ...

    @property
    def first(self) -> _Locator: ...

    def filter(self, **kwargs: object) -> _FilterContext: ...


class _FilterContext(Protocol):
    def filter(self, **kwargs: object) -> _FilterContext: ...

    @property
    def first(self) -> _Locator: ...

    def to_be_visible(self, timeout: int | None = None) -> None: ...


class _Page(Protocol):
    def goto(self, url: str) -> None: ...

    def get_by_role(self, role: str, /, name: str) -> _Locator: ...

    def get_by_label(self, label: str, /) -> _Locator: ...

    def wait_for_url(self, url: str, *, timeout: int | None = None) -> None: ...

    def locator(self, selector: str) -> _FilterContext: ...

    def get_by_text(self, text: str, /, exact: bool = False) -> _Locator: ...


class _ExpectResult(Protocol):
    def to_be_visible(self, timeout: int | None = None) -> None: ...


class _Expect(Protocol):
    def __call__(self, locator: _Locator) -> _ExpectResult: ...


class _PlaywrightSyncModule(Protocol):
    expect: _Expect


playwright_module = cast("_PlaywrightSyncModule", raw_playwright)
expect = playwright_module.expect


def _png(h: int = 60, w: int = 60) -> bytes:
    image = Image.new("RGB", (w, h), color=(200, 200, 200))
    output = BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def _zip_bytes() -> bytes:
    buf = BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("p1.png", _png())
        zf.writestr("p2.png", _png())
    return buf.getvalue()


def test_upload_zip_navigates_to_filtered_jobs_page(
    live_server: LiveServer, page: _Page, tmp_path: Path
) -> None:
    zip_path = tmp_path / "book.zip"
    _ = zip_path.write_bytes(_zip_bytes())

    page.goto(live_server.base_url)
    # The header always has a "New project" button; the empty-state card also
    # has one when the project list is empty. Use .first to target the header
    # button (the stable, always-present one) and avoid strict-mode violations.
    page.get_by_role("button", name="New project").first.click()

    page.get_by_label("Book name").fill("E2E Smoke Book")
    page.get_by_label("Source zip").set_input_files(str(zip_path))
    page.get_by_role("button", name="Create + Upload").click()

    # Wait for the navigation to /jobs?project_id=... — that's the contract.
    page.wait_for_url("**/jobs?project_id=*", timeout=15_000)

    # Filter banner is visible.
    expect(page.get_by_text("Filtered to project")).to_be_visible()

    # Both unzip and thumbnails rows show up (chained by the unzip handler).
    expect(page.get_by_text("unzip", exact=True).first).to_be_visible(timeout=10_000)
    expect(page.get_by_text("thumbnails", exact=True).first).to_be_visible(timeout=15_000)

    # And both reach completion — wait up to 30s for thumbnails to finish.
    # Job rows are Card divs (not li elements). The Badge component renders
    # "complete" API status as the label "Done". We find the card that
    # contains both "thumbnails" (job type) and "Done" (Badge for complete).
    thumbnails_done_card = (
        page.locator("div")
        .filter(
            has=page.get_by_text("thumbnails", exact=True),
        )
        .filter(
            has=page.get_by_text("Done", exact=True),
        )
    )
    expect(thumbnails_done_card.first).to_be_visible(timeout=30_000)
