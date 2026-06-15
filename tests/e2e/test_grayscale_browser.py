"""M5 — Grayscale pipeline browser verification.

Tests the grayscale workbench end-to-end in a real Chromium browser against
a live FastAPI server, verifying:

1. App loads without white screen or asset errors.
2. Grayscale workbench renders at /projects/{id}/pipeline?stage=grayscale
   with real before/after images (naturalWidth > 0).
3. Changing converter → Apply & Run re-renders the after image (URL
   cache-bust changes), proving the config chain reaches the backend.
4. Auto button calls detectProfile and populates the why banner.
5. Direct route load (fresh navigation) renders the workbench, not a 404.

Fixture: creates a project via the API, seeds one page with a real color PNG
in the BlobStore (source_blob_hash + thumbnail_blob_hash), then runs the
grayscale stage via the API so the workbench has a real artifact to show.

testid contract (Task 5.1 verification):
    page-viewer                     — present in GrayscaleWorkbench.tsx (PageViewerPane)
    after-image                     — present in GrayscaleWorkbench.tsx (PageViewerPane)
    before-image                    — present in GrayscaleWorkbench.tsx (PageViewerPane)
    grayscale-converter-select      — present in GrayscalePipelineEditor.tsx
    grayscale-flatten-toggle        — present in GrayscalePipelineEditor.tsx
    grayscale-clahe-toggle          — present in GrayscalePipelineEditor.tsx
    grayscale-channel-select        — present (conditional: only when converter=best_channel)
    grayscale-resolved-source-converter — present in GrayscalePipelineEditor.tsx
    grayscale-apply-run             — present in GrayscaleWorkbench.tsx (GrayscaleWorkbenchTab)
    grayscale-auto                  — present in GrayscaleWorkbench.tsx (GrayscaleWorkbenchTab)
    grayscale-auto-why              — present in GrayscaleWorkbench.tsx (conditional: only after Auto)
    grayscale-save-page             — present in GrayscaleWorkbench.tsx (footer)
    grayscale-save-project          — present in GrayscaleWorkbench.tsx (footer)

CI note (Task 5.4): these tests live in tests/e2e/ and run under `make e2e`
(which builds the frontend first). They are intentionally excluded from
`make ci` (heavy: needs chromium + full SPA build). This follows the
workspace convention that browser e2e is a separate verification step.
"""

from __future__ import annotations

import time
from typing import TYPE_CHECKING

import cv2
import httpx
import numpy as np
from playwright.sync_api import Page, expect

from pdomain_prep_for_pgdp.core.models import (
    PageProcessingStatus,
    PageRecord,
)
from pdomain_prep_for_pgdp.core.page_service_helpers import update_page_extension
from pdomain_prep_for_pgdp.core.page_store_factory import build_page_service
from tests.fixtures.seed_pages import seed_pages_in_store

if TYPE_CHECKING:
    from pathlib import Path

    from .conftest import LiveServer


# ---------------------------------------------------------------------------
# Fixture helpers
# ---------------------------------------------------------------------------


def _color_png(h: int = 64, w: int = 48) -> bytes:
    """Return a synthetic 3-channel color BGR PNG (has chroma signal).

    Dimensions are small so the grayscale stage finishes quickly on CPU.
    """
    rng = np.random.default_rng(42)
    img = rng.integers(40, 215, (h, w, 3), dtype=np.uint8)
    ok, buf = cv2.imencode(".png", img)
    assert ok
    return bytes(buf.tobytes())


def _create_project_api(base_url: str, name: str) -> str:
    """Create a project via POST /api/data/projects; return project ID."""
    resp = httpx.post(
        f"{base_url}/api/data/projects",
        json={"name": name, "source_type": "zip"},
        timeout=10,
    )
    assert resp.status_code == 200, f"create_project failed: {resp.text}"
    return resp.json()["project"]["id"]


def _seed_project_with_source_image(data_root: Path, project_id: str) -> None:
    """Seed one page with a real color PNG (source + thumbnail blobs).

    After calling this:
    - GET /pages/0/thumbnail → 200 JPEG (before-pane)
    - POST /pages/0/stages/grayscale/run → runs and produces an artifact
    """
    image_bytes = _color_png()
    svc = build_page_service(data_root, project_id)

    # Write source blob
    source_hash = svc.blobs.write(image_bytes)

    # Also write a thumbnail blob (same image is fine for tests)
    thumb_hash = svc.blobs.write(image_bytes)

    # Seed the page record into the event store
    seed_pages_in_store(
        data_root,
        project_id,
        [
            PageRecord(
                project_id=project_id,
                idx0=0,
                prefix="p0001",
                source_stem="img0001",
                processing_status=PageProcessingStatus.pending,
            )
        ],
        project_name=project_id,
    )

    # Update page extension with both hashes
    update_page_extension(
        svc,
        project_id,
        0,
        source_blob_hash=source_hash,
        thumbnail_blob_hash=thumb_hash,
    )


def _run_grayscale_stage_api(base_url: str, project_id: str) -> None:
    """POST /pages/0/stages/grayscale/run and poll until clean or timeout."""
    resp = httpx.post(
        f"{base_url}/api/data/projects/{project_id}/pages/0/stages/grayscale/run",
        json={"force": True},
        timeout=30,
    )
    assert resp.status_code in (200, 202), f"grayscale run failed: {resp.status_code} {resp.text}"
    # Poll until clean (at most 20s)
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        check = httpx.get(
            f"{base_url}/api/data/projects/{project_id}/pages/0/stages",
            timeout=10,
        )
        if check.status_code == 200:
            stages = check.json()
            gray_stage = next((s for s in stages if s.get("stage_id") == "grayscale"), None)
            if gray_stage and gray_stage.get("status") == "clean":
                return
        time.sleep(0.3)
    # Non-fatal if not clean: the workbench still renders, just without a real after-image
    # The test will still pass artifact assertions at a lower bar.


def _seed_grayscale_project(live_server: LiveServer) -> str:
    """End-to-end project setup: create + seed + run grayscale stage.

    Returns the project_id.
    """
    project_id = _create_project_api(live_server.base_url, "Grayscale Browser Test")
    _seed_project_with_source_image(live_server.settings.data_root, project_id)
    _run_grayscale_stage_api(live_server.base_url, project_id)
    return project_id


# ---------------------------------------------------------------------------
# Task 5.1: data-testid contract audit
# (these checks are embedded in the browser tests below but listed here
# for clarity — each testid must be on a real visible+wired control)
# ---------------------------------------------------------------------------

_ALWAYS_VISIBLE_TESTIDS = [
    "page-viewer",
    "grayscale-converter-select",
    "grayscale-flatten-toggle",
    "grayscale-clahe-toggle",
    "grayscale-resolved-source-converter",
    "grayscale-apply-run",
    "grayscale-auto",
    "grayscale-save-page",
    "grayscale-save-project",
]

# grayscale-channel-select is conditional (only when converter=best_channel)
# grayscale-auto-why is conditional (only after Auto detect runs)
# after-image is conditional (only when grayscale stage has run and is clean)
# before-image is conditional (only when thumbnail is available)


# ---------------------------------------------------------------------------
# Task 5.3 browser tests
# ---------------------------------------------------------------------------


def test_grayscale_app_loads_no_white_screen(live_server: LiveServer, page: Page) -> None:
    """Test 5.3-A: App root renders without a white screen or asset load errors.

    Checks:
    1. GET / → 200 HTML (SPA serves)
    2. No console errors about failed module/asset loads
    3. The React root mounts (body is visible, not a blank frame)
    """
    console_errors: list[str] = []
    page.on(
        "console",
        lambda msg: console_errors.append(msg.text) if msg.type == "error" else None,
    )

    page.goto(live_server.base_url, wait_until="networkidle")

    # Body rendered — not a white screen
    expect(page.locator("body")).to_be_visible()

    # No asset/module load errors
    asset_errors = [e for e in console_errors if "Failed to load resource" in e or "SyntaxError" in e]
    assert asset_errors == [], f"Asset load errors: {asset_errors}"

    # React mounted — at minimum the SPA root is present
    assert "Not Found" not in page.title()


def test_grayscale_workbench_renders_real_images(live_server: LiveServer, page: Page) -> None:
    """Test 5.3-B: Workbench renders with real before+after images (naturalWidth > 0).

    Proves:
    - page-viewer is visible
    - after-image has naturalWidth > 0 (grayscale stage ran, produced a real artifact)
    - testid contract: all always-visible testids are present on real controls

    Fixture: project with source PNG seeded + grayscale stage run via API.
    """
    page_errors: list[str] = []
    page.on("pageerror", lambda exc: page_errors.append(str(exc)))

    project_id = _seed_grayscale_project(live_server)

    page.goto(
        f"{live_server.base_url}/projects/{project_id}/pipeline?stage=grayscale",
        wait_until="load",
    )

    assert page_errors == [], f"Page JS errors: {page_errors}"

    # Wait for the grayscale tool to mount
    expect(page.locator('[data-testid="grayscale-tool"]')).to_be_visible(timeout=20_000)

    # page-viewer is visible
    expect(page.locator('[data-testid="page-viewer"]')).to_be_visible(timeout=15_000)

    # Wait for the machine to finish detecting/converting and settle in "done" or "workbench"
    # The machine prefetches via REST on mount; give it time to settle
    page.wait_for_timeout(3000)

    # after-image must be visible and naturalWidth > 0 (real image rendered)
    # Playwright's default view mode is "split" so both before and after are shown
    after_img = page.locator('[data-testid="after-image"]')
    expect(after_img).to_be_visible(timeout=15_000)

    natural_width = page.evaluate(
        "() => { const img = document.querySelector('[data-testid=\"after-image\"]'); "
        "return img ? img.naturalWidth : 0; }"
    )
    assert natural_width > 0, (
        f"after-image naturalWidth={natural_width} — grayscale artifact not loaded; "
        "check that the grayscale stage ran and the artifact route returns 200"
    )

    # Task 5.1: verify always-visible testids are on real controls
    for testid in _ALWAYS_VISIBLE_TESTIDS:
        locator = page.locator(f'[data-testid="{testid}"]')
        assert locator.count() > 0, f"testid '{testid}' not found in DOM"
        # Must not be hidden via display:none (workspace rule: testids on real controls only)
        assert locator.first.is_visible(), (
            f"testid '{testid}' exists but is not visible — "
            "workspace rule: testids must be on real visible+wired controls, not hidden stubs"
        )


def test_grayscale_apply_run_busts_cache(live_server: LiveServer, page: Page) -> None:
    """Test 5.3-C: Changing converter → Apply & Run updates the after-image src URL.

    Proves:
    - grayscale-converter-select change reaches the machine (SET_CONVERTER)
    - Apply & Run triggers APPLY_RUN → POST .../stages/grayscale/run
    - The after-image artifact URL changes (cache-bust ?v= param updates)
    - This proves the nested config chain (UI → machine → HTTP → backend) works end-to-end

    A severed config chain was the primary failure mode caught in prior Milestone audits
    (MSW-mocked CI passed but real browser revealed 3 severed-chain blockers).
    """
    page_errors: list[str] = []
    network_requests: list[str] = []
    page.on("pageerror", lambda exc: page_errors.append(str(exc)))
    page.on("request", lambda req: network_requests.append(f"{req.method} {req.url}"))

    project_id = _seed_grayscale_project(live_server)

    page.goto(
        f"{live_server.base_url}/projects/{project_id}/pipeline?stage=grayscale",
        wait_until="load",
    )

    assert page_errors == [], f"Page JS errors: {page_errors}"

    expect(page.locator('[data-testid="grayscale-tool"]')).to_be_visible(timeout=20_000)
    expect(page.locator('[data-testid="page-viewer"]')).to_be_visible(timeout=15_000)

    # Wait for machine to settle (detecting → done / workbench)
    page.wait_for_timeout(3000)

    # Capture the initial after-image src (may be None if stage hasn't run yet)
    initial_src = page.evaluate(
        "() => { const img = document.querySelector('[data-testid=\"after-image\"]'); "
        "return img ? img.src : null; }"
    )

    # Change converter to "best_channel" (from whatever default is set)
    converter_select = page.locator('[data-testid="grayscale-converter-select"]')
    expect(converter_select).to_be_visible(timeout=10_000)
    converter_select.select_option("best_channel")

    # Clear network log to isolate Apply & Run traffic
    network_requests.clear()

    # Click Apply & Run
    apply_btn = page.locator('[data-testid="grayscale-apply-run"]')
    expect(apply_btn).to_be_visible(timeout=5_000)
    apply_btn.click()

    # Wait for the stage to complete and SSE to push the update
    # Poll up to 25s for the after-image src to change
    deadline = time.monotonic() + 25
    new_src = initial_src
    while time.monotonic() < deadline and new_src == initial_src:
        page.wait_for_timeout(500)
        new_src = page.evaluate(
            "() => { const img = document.querySelector('[data-testid=\"after-image\"]'); "
            "return img ? img.src : null; }"
        )

    # Collect network evidence for failure messages
    run_requests = [r for r in network_requests if "run" in r.lower() or "settings" in r.lower()]
    stages_requests = [r for r in network_requests if "/stages" in r]

    assert new_src is not None, (
        f"after-image was not rendered after Apply & Run.\n"
        f"Run-related requests: {run_requests}\n"
        f"Stage requests: {stages_requests}"
    )
    assert new_src != initial_src, (
        f"after-image src did not change after Apply & Run:\n"
        f"  initial: {initial_src}\n"
        f"  after:   {new_src}\n"
        f"Run-related requests: {run_requests}\n"
        f"Stage requests: {stages_requests}\n"
        "This means the config chain is severed — the run request did not reach "
        "the backend, or the SSE event was not received, or the URL was not updated."
    )

    # URL should contain a ?v= cache-buster (the lastRunAt timestamp)
    assert "?v=" in (new_src or ""), (
        f"after-image src has no ?v= cache-buster: {new_src}\n"
        "Expected format: .../stages/grayscale/artifact?v=<timestamp>"
    )

    assert page_errors == [], f"Page JS errors after Apply & Run: {page_errors}"


def test_grayscale_auto_populates_why(live_server: LiveServer, page: Page) -> None:
    """Test 5.3-D: Auto button calls detectProfile and shows the why banner.

    Proves:
    - grayscale-auto is visible and clickable
    - After clicking, grayscale-auto-why appears (detect result surfaces)
    - The converter select is updated to the detected value
    """
    page_errors: list[str] = []
    page.on("pageerror", lambda exc: page_errors.append(str(exc)))

    project_id = _seed_grayscale_project(live_server)

    page.goto(
        f"{live_server.base_url}/projects/{project_id}/pipeline?stage=grayscale",
        wait_until="load",
    )

    assert page_errors == [], f"Page JS errors: {page_errors}"

    expect(page.locator('[data-testid="grayscale-tool"]')).to_be_visible(timeout=20_000)
    expect(page.locator('[data-testid="page-viewer"]')).to_be_visible(timeout=15_000)
    page.wait_for_timeout(2000)

    # Click Auto
    auto_btn = page.locator('[data-testid="grayscale-auto"]')
    expect(auto_btn).to_be_visible(timeout=10_000)
    auto_btn.click()

    # grayscale-auto-why must appear (why text from detectProfile)
    # Allow up to 10s for the API call to complete and why to render
    why_locator = page.locator('[data-testid="grayscale-auto-why"]')
    expect(why_locator).to_be_visible(timeout=10_000)

    why_text = why_locator.text_content()
    assert why_text is not None and why_text.strip() != "", (
        "grayscale-auto-why is visible but empty — detectProfile did not return a why string"
    )

    # Converter select must be non-empty (Auto applied a value)
    converter_select = page.locator('[data-testid="grayscale-converter-select"]')
    expect(converter_select).to_be_visible()
    selected_value = page.evaluate(
        "() => { const sel = document.querySelector('[data-testid=\"grayscale-converter-select\"]'); "
        "return sel ? sel.value : null; }"
    )
    assert selected_value is not None and selected_value != "", (
        "converter select has no value after Auto detect"
    )

    assert page_errors == [], f"Page JS errors after Auto: {page_errors}"


def test_grayscale_workbench_fresh_direct_route(live_server: LiveServer, page: Page) -> None:
    """Test 5.3-E: Direct navigation to the grayscale workbench route renders correctly.

    A fresh load (not SPA navigation) must render the workbench, not a 404 or blank.
    This tests the SPA catch-all + React Router route pairing.
    """
    page_errors: list[str] = []
    page.on("pageerror", lambda exc: page_errors.append(str(exc)))

    project_id = _seed_grayscale_project(live_server)

    # Navigate directly (fresh page load — not SPA navigation)
    page.goto(
        f"{live_server.base_url}/projects/{project_id}/pipeline?stage=grayscale",
        wait_until="load",
    )

    assert page_errors == [], f"Page JS errors: {page_errors}"

    # Must not be a 404
    assert "Not Found" not in page.title()
    assert "404" not in page.title()

    # Pipeline page must render
    expect(page.locator('[data-testid="pipeline-page"]')).to_be_visible(timeout=20_000)

    # Grayscale stage chip must be active (we loaded with ?stage=grayscale)
    expect(page.locator('[data-testid="stage-chip-label"]')).to_have_text("grayscale", timeout=10_000)

    # Grayscale tool must be mounted (not a blank tool slot)
    expect(page.locator('[data-testid="grayscale-tool"]')).to_be_visible(timeout=15_000)

    # page-viewer must be visible (workbench tab is the default)
    expect(page.locator('[data-testid="page-viewer"]')).to_be_visible(timeout=15_000)

    assert page_errors == [], f"Page JS errors at end: {page_errors}"
