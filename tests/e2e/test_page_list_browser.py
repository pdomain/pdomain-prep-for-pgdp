"""Browser verification: page-list renders from event store data; split flow works."""

from __future__ import annotations

import os
import socket

import pytest
from playwright.sync_api import Page, expect

BASE = os.environ.get("PGDP_TEST_BASE_URL", "http://127.0.0.1:8765")


def _app_reachable() -> bool:
    """Return True if the app is listening at BASE."""
    try:
        from urllib.parse import urlparse

        parsed = urlparse(BASE)
        host = parsed.hostname or "127.0.0.1"
        port = parsed.port or 8765
        with socket.create_connection((host, port), timeout=2):
            return True
    except OSError:
        return False


@pytest.mark.skipif(not _app_reachable(), reason="App not running — start with make run-cpu")
def test_app_loads(page: Page) -> None:
    """SPA root loads; no console errors about missing resources."""
    errors: list[str] = []
    page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
    page.goto(BASE)
    page.wait_for_load_state("networkidle")
    expect(page.locator("body")).to_be_visible()
    resource_errors = [e for e in errors if "Failed to load resource" in e]
    assert resource_errors == [], f"Resource load errors: {resource_errors}"


@pytest.mark.skipif(not _app_reachable(), reason="App not running — start with make run-cpu")
def test_react_router_subpath(page: Page) -> None:
    """Navigating to a sub-path renders the SPA (React Router), not a 404."""
    page.goto(f"{BASE}/projects")
    page.wait_for_load_state("networkidle")
    assert "Not Found" not in page.title()
    expect(page.locator("body")).to_be_visible()


@pytest.mark.skip(
    reason=(
        "ProjectConfigurePage retired 2026-06-16: /projects/<id> now redirects "
        "to /projects/<id>/pipeline (PipelinePage). The pages-card testid no longer "
        "exists at this URL. Page-list is accessible via the source/page-order tools "
        "in the pipeline shell. Update this test if a direct page-list view is "
        "re-introduced."
    ),
)
def test_page_list_renders_from_event_store(page: Page, project_id: str) -> None:
    """After ingest, page-list renders rows loaded from the event store.

    RETIREMENT NOTE: This test navigated to /projects/<id> which previously
    rendered ProjectConfigurePage (with a pages-card). That route now redirects
    to PipelinePage, which does not have a pages-card. The page-order tool in the
    pipeline shell provides page management instead.
    """
    page.goto(f"{BASE}/projects/{project_id}")
    page.wait_for_load_state("networkidle")
    pages_card = page.locator('[data-testid="pages-card"]')
    expect(pages_card).to_be_visible()
    first_row = page.locator('[data-testid="page-row-0"]')
    expect(first_row).to_be_visible()
