"""E2E: upload zip → enqueue unzip job → land on /jobs filtered to project.

Drives the actual SPA against a live FastAPI server. Asserts the URL change
(JobsPage with `?project_id=`), the filter banner, and that both `unzip`
and `thumbnails` jobs appear and complete.
"""

from __future__ import annotations

import io
import re
import zipfile
from typing import TYPE_CHECKING

import numpy as np
import pytest
from playwright.sync_api import Page, expect

if TYPE_CHECKING:
    from .conftest import LiveServer


def _png(h: int = 60, w: int = 60) -> bytes:
    cv2 = pytest.importorskip("cv2")
    img = np.full((h, w, 3), 200, dtype=np.uint8)
    ok, buf = cv2.imencode(".png", img)
    assert ok
    return bytes(buf.tobytes())


def _zip_bytes() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("p1.png", _png())
        zf.writestr("p2.png", _png())
    return buf.getvalue()


def test_upload_zip_navigates_to_filtered_jobs_page(live_server: LiveServer, page: Page, tmp_path) -> None:
    pytest.importorskip("cv2")

    zip_path = tmp_path / "book.zip"
    zip_path.write_bytes(_zip_bytes())

    page.goto(live_server.base_url)
    # The header always has a "New project" button; the empty-state card also
    # has one when the project list is empty. Use .first to target the header
    # button (the stable, always-present one) and avoid strict-mode violations.
    page.get_by_role("button", name="New project").first.click()

    page.get_by_label("Book name").fill("E2E Smoke Book")
    page.get_by_label("Source zip").set_input_files(str(zip_path))
    page.get_by_role("button", name=re.compile(r"Create \+ Upload")).click()

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
