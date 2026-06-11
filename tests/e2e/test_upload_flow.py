"""E2E: create project + upload zip → navigate to PostImportPage.

Tests the new create-project flow introduced in the v2 pipeline convergence:
  - "New project" opens the CreateProjectModal
  - User fills the book name and uploads a zip file
  - On success the app navigates to /projects/:id/import (PostImportPage)
    instead of the old /jobs?project_id=* destination

The old destination (/jobs?project_id=*) is no longer the post-create target.
This test replaces the original test_upload_zip_navigates_to_filtered_jobs_page
which asserted the now-deleted jobs-page routing.
"""

from __future__ import annotations

import zipfile
from io import BytesIO
from typing import TYPE_CHECKING

from PIL import Image
from playwright.sync_api import Page, expect

if TYPE_CHECKING:
    from pathlib import Path

    from .conftest import LiveServer


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


def test_upload_zip_navigates_to_import_page(live_server: LiveServer, page: Page, tmp_path: Path) -> None:
    """Create project + upload zip → navigate to /projects/:id/import.

    This is the v2 post-create landing page (PostImportPage), which replaced
    the old /jobs?project_id=* destination.

    FLOW:
    1. Navigate to /
    2. Click "New project" (opens CreateProjectModal)
    3. Fill book name using data-testid="create-project-name"
    4. Set zip file using data-testid="create-project-zip-input"
    5. Click "Create + Upload" (data-testid="create-project-submit-btn")
    6. Wait for navigation to /projects/:id/import
    7. Assert PostImportPage renders (body visible, no crash)
    """
    zip_path = tmp_path / "book.zip"
    zip_path.write_bytes(_zip_bytes())

    errors: list[str] = []
    page.on("pageerror", lambda exc: errors.append(str(exc)))

    page.goto(live_server.base_url, wait_until="networkidle")
    expect(page.locator('[data-testid="projects-page"]')).to_be_visible(timeout=10_000)

    # Open the create-project modal via the "New project" button.
    # Use .first to avoid strict-mode violation when both header and empty-state
    # buttons are present.
    page.get_by_role("button", name="New project").first.click()

    # Modal dialog should appear
    expect(page.locator('[data-testid="create-project-dialog"]')).to_be_visible(timeout=5_000)

    # Fill the book name — use data-testid (label is a <span>, no aria association)
    page.locator('[data-testid="create-project-name"]').fill("E2E Upload Flow Test")

    # Set the zip file via the file input
    page.locator('[data-testid="create-project-zip-input"]').set_input_files(str(zip_path))

    # Submit — "Create + Upload"
    page.locator('[data-testid="create-project-submit-btn"]').click()

    # After success: the modal closes and the SPA navigates to /projects/:id/import
    # (PostImportPage). Wait up to 30s for the upload + job enqueue to complete.
    page.wait_for_url("**/projects/*/import", timeout=30_000)

    # PostImportPage renders (not a 404, not a crash)
    assert errors == [], f"Page errors after create + upload: {errors}"
    expect(page.locator("body")).to_be_visible()
    assert "Not Found" not in page.title()
