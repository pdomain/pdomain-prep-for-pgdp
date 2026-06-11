"""I2 — App-loads, sub-path routing, SPA contract.

Verifies that the converged app (new XState UI on real v2 backend) boots
correctly in a headless Chromium, serves all SPA routes without 404, and
fires no console errors on initial load.

These tests are fast (<5s each) because they do not run pipeline stages.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import httpx
from playwright.sync_api import Page, expect

if TYPE_CHECKING:
    from .conftest import LiveServer


# ── helpers ────────────────────────────────────────────────────────────────────


def _create_project(base_url: str, name: str = "I2 Test Project") -> str:
    """Create a project via the API and return its project_id."""
    resp = httpx.post(
        f"{base_url}/api/data/projects",
        json={"name": name, "source_type": "zip"},
        timeout=10,
    )
    assert resp.status_code == 200, f"create_project failed: {resp.text}"
    return resp.json()["project"]["id"]


# ── I2 deliverable 1: App-loads test ───────────────────────────────────────────


def test_app_loads_no_console_errors(live_server: LiveServer, page: Page) -> None:
    """Root / renders the SPA; no JavaScript errors on initial load.

    The key assertion is that the React app mounts cleanly — no 'oe.jsxDEV is
    not a function' crashes from pdomain-ui, no missing resource 404s.
    """
    console_errors: list[str] = []
    page_errors: list[str] = []
    page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
    page.on("pageerror", lambda exc: page_errors.append(str(exc)))

    page.goto(live_server.base_url, wait_until="networkidle")

    # Root element of the SPA must be visible
    expect(page.locator("body")).to_be_visible()

    # The projects page renders its container
    expect(page.locator('[data-testid="projects-page"]')).to_be_visible(timeout=10_000)

    # No JavaScript page-level errors (e.g. jsxDEV crashes)
    assert page_errors == [], f"Page errors on load: {page_errors}"

    # No resource-load failures in the console
    resource_errors = [e for e in console_errors if "Failed to load resource" in e]
    assert resource_errors == [], f"Resource load errors: {resource_errors}"


def test_app_loads_header_visible(live_server: LiveServer, page: Page) -> None:
    """AppHeader from pdomain-ui renders correctly — confirms pdomain-ui boot."""
    page.goto(live_server.base_url, wait_until="networkidle")

    # AppShell from pdomain-ui renders — the header should contain the app name
    # or at minimum not be blank. We assert the Projects page is visible (which
    # implies AppShell rendered successfully since ProjectsPage is a child of it).
    expect(page.locator('[data-testid="projects-page"]')).to_be_visible(timeout=10_000)

    # The "New project" button should be visible — it's in the header rail of ProjectsPage
    expect(page.get_by_role("button", name="New project").first).to_be_visible()


# ── I2 deliverable 4: Direct sub-path route tests ─────────────────────────────


def test_react_router_subpath_projects(live_server: LiveServer, page: Page) -> None:
    """/projects sub-path renders SPA, not a 404."""
    errors: list[str] = []
    page.on("pageerror", lambda exc: errors.append(str(exc)))

    page.goto(f"{live_server.base_url}/projects", wait_until="networkidle")

    # Not a 404 error page
    assert "Not Found" not in page.title()
    assert "404" not in page.title()
    expect(page.locator("body")).to_be_visible()
    assert errors == [], f"Page errors on /projects: {errors}"


def test_react_router_subpath_jobs(live_server: LiveServer, page: Page) -> None:
    """/jobs sub-path renders the SPA (React Router), not a raw 404."""
    errors: list[str] = []
    page.on("pageerror", lambda exc: errors.append(str(exc)))

    page.goto(f"{live_server.base_url}/jobs", wait_until="networkidle")
    assert "Not Found" not in page.title()
    assert "404" not in page.title()
    assert errors == [], f"Page errors on /jobs: {errors}"


def test_pipeline_subpath_renders_stage_tool(live_server: LiveServer, page: Page) -> None:
    """/projects/:id/pipeline?stage=threshold renders the stage tool, not a 404.

    This is the I2 deliverable 4 requirement — a direct sub-path URL must
    serve the SPA which then mounts the correct stage tool in the tool slot.
    The ?stage= param determines which tool is active.
    """
    errors: list[str] = []
    page.on("pageerror", lambda exc: errors.append(str(exc)))

    project_id = _create_project(live_server.base_url, "Sub-path Route Test")

    # Navigate directly to the pipeline page with ?stage=threshold — this
    # simulates a user bookmarking or sharing a deep-link to a specific stage.
    # Use "load" not "networkidle": the pipeline page holds open an SSE connection
    # which prevents networkidle from ever firing.
    page.goto(
        f"{live_server.base_url}/projects/{project_id}/pipeline?stage=threshold",
        wait_until="load",
    )

    # No page errors (React app must not crash)
    assert errors == [], f"Page errors on pipeline subpath: {errors}"

    # The pipeline-page container is visible (not a 404)
    expect(page.locator('[data-testid="pipeline-page"]')).to_be_visible(timeout=15_000)

    # The stage strip is rendered — confirms the pipeline loaded
    expect(page.locator('[data-testid="stage-strip"]')).to_be_visible(timeout=10_000)

    # The current stage chip shows "threshold"
    expect(page.locator('[data-testid="stage-chip-label"]')).to_have_text("threshold", timeout=10_000)


def test_pipeline_subpath_renders_archive_tool(live_server: LiveServer, page: Page) -> None:
    """/projects/:id/pipeline?stage=archive renders ArchiveTool correctly."""
    errors: list[str] = []
    page.on("pageerror", lambda exc: errors.append(str(exc)))

    project_id = _create_project(live_server.base_url, "Archive Sub-path Test")

    # Use "load" not "networkidle" — SSE keeps the connection open indefinitely.
    page.goto(
        f"{live_server.base_url}/projects/{project_id}/pipeline?stage=archive",
        wait_until="load",
    )

    assert errors == [], f"Page errors: {errors}"
    expect(page.locator('[data-testid="pipeline-page"]')).to_be_visible(timeout=15_000)

    # Archive stage is in the "Pack" group and the chip should show "archive"
    expect(page.locator('[data-testid="stage-chip-label"]')).to_have_text("archive", timeout=10_000)

    # ArchiveTool renders its container — confirms the tool slot resolved correctly
    expect(page.locator('[data-testid="archive-tool"]')).to_be_visible(timeout=10_000)


def test_settings_subpath_renders(live_server: LiveServer, page: Page) -> None:
    """/settings sub-path renders the SettingsPage, not a 404."""
    errors: list[str] = []
    page.on("pageerror", lambda exc: errors.append(str(exc)))

    page.goto(f"{live_server.base_url}/settings", wait_until="load")
    assert errors == [], f"Page errors on /settings: {errors}"
    assert "Not Found" not in page.title()
    expect(page.locator("body")).to_be_visible()
