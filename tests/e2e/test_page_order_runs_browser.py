"""V — Page Order runs browser verification (marker happy-path + persistence).

This is the MANDATORY browser-verification milestone for the page-numbering-runs
arc. It crosses the real browser → FastAPI → event-store seam that the unit /
vitest tests (which mock the API client) cannot exercise. This repo has a
documented history of mock-green CI hiding severed frontend↔backend chains; only
the real running app catches them.

What it covers
--------------
V.1  app-loads + router deep-link to the Page Order tool (`?stage=page_order`).
V.2  headline marker happy-path (the motivating P3 fix): marking a plate's
     facing blank as "Held out" shows ``[Blank Page]`` (no number) while the
     neighbouring numbered leaves and a *different* counted blank are unchanged.
V.3  persistence survives a full page reload: the marker toggle (run_id → null)
     AND a folio override (label_override) round-trip through the real
     PATCH /pages/{idx0} → event store → GET /pages chain.

Seed mechanism
--------------
Mirrors ``test_grayscale_browser.py``: create the project via the public API,
seed N page records into the per-project event store with
``seed_pages_in_store``, then PATCH each page through the REAL update route
(``PATCH /api/data/projects/{id}/pages/{idx0}``) to set ``leaf_role`` and
``run_id``. The PATCH is the production persist path — seeding through it (rather
than reaching into the extension directly) is itself part of what these tests
verify.

The plate / facing-blank / counted-blank are expressed as:
    scan 0  text   run=body   → numbered "1"
    scan 1  text   run=body   → numbered "2"
    scan 2  plate  run=null   → "—"            (a plate never takes a number)
    scan 3  blank  run=body   → counted "3"    (the plate's FACING BLANK)
    scan 4  blank  run=body   → counted "4"    (a different COUNTED blank)
    scan 5  text   run=body   → numbered "5"

The default run created by ``fetchFolios`` is the single ``body`` run
(arabic, start 1, step 1) — so a leaf only takes a number when its
``run_id == "body"``; clearing it (the "Held out" marker) drops the number and
the client renders ``[Blank Page]``.

CI note: these live in ``tests/e2e/`` and run under ``make e2e`` (which builds
the frontend first). They are intentionally NOT part of ``make ci`` — browser
e2e is a separate, heavier verification step in this repo (see
``test_grayscale_browser.py`` for the same convention).
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import httpx
from playwright.sync_api import Page, expect

from pdomain_prep_for_pgdp.core.models import (
    PageProcessingStatus,
    PageRecord,
    PageType,
)
from tests.fixtures.seed_pages import seed_pages_in_store

if TYPE_CHECKING:
    from .conftest import LiveServer


# ---------------------------------------------------------------------------
# Seed helpers
# ---------------------------------------------------------------------------

_BODY_RUN = "body"

# (page_type, leaf_role, run_id) per scan. run_id=None means the leaf is a
# marker / takes no folio number (plate, or a held-out blank).
_SEED_LEAVES: list[tuple[PageType, str, str | None]] = [
    (PageType.normal, "text", _BODY_RUN),  # scan 0 → "1"
    (PageType.normal, "text", _BODY_RUN),  # scan 1 → "2"
    (PageType.plate_p, "plate", None),  # scan 2 → "—"
    (PageType.blank, "blank", _BODY_RUN),  # scan 3 → counted "3" (facing blank)
    (PageType.blank, "blank", _BODY_RUN),  # scan 4 → counted "4" (control blank)
    (PageType.normal, "text", _BODY_RUN),  # scan 5 → "5"
]

# Indices, named for readability in the assertions below.
_PLATE_SCAN = 2
_FACING_BLANK_SCAN = 3
_COUNTED_BLANK_SCAN = 4
_FIRST_TEXT_SCAN = 0
_LAST_TEXT_SCAN = 5


def _create_project_api(base_url: str, name: str) -> str:
    """Create a project via POST /api/data/projects; return its ID."""
    resp = httpx.post(
        f"{base_url}/api/data/projects",
        json={"name": name, "source_type": "zip"},
        timeout=10,
    )
    assert resp.status_code == 200, f"create_project failed: {resp.text}"
    return resp.json()["project"]["id"]


def _patch_leaf(base_url: str, project_id: str, idx0: int, *, leaf_role: str, run_id: str | None) -> None:
    """PATCH a page's leaf_role + run_id through the REAL update route.

    This is the same path the frontend `persistLeaf` uses, so seeding through it
    verifies the write side of the chain that V.3 later checks the read side of.
    """
    resp = httpx.patch(
        f"{base_url}/api/data/projects/{project_id}/pages/{idx0}",
        json={"leaf_role": leaf_role, "run_id": run_id},
        timeout=10,
    )
    assert resp.status_code == 200, f"patch leaf {idx0} failed: {resp.status_code} {resp.text}"


def _seed_page_order_project(live_server: LiveServer, name: str) -> str:
    """Create + seed a project with a plate, facing blank, counted blank, body text.

    Returns the project_id. Pages are seeded into the event store, then each
    page's leaf_role + run_id is set through the real PATCH route.
    """
    project_id = _create_project_api(live_server.base_url, name)

    records = [
        PageRecord(
            project_id=project_id,
            idx0=idx0,
            prefix=f"p{idx0:04d}",
            source_stem=f"img{idx0:04d}",
            page_type=page_type,
            processing_status=PageProcessingStatus.pending,
        )
        for idx0, (page_type, _role, _run) in enumerate(_SEED_LEAVES)
    ]
    seed_pages_in_store(live_server.settings.data_root, project_id, records, project_name=name)

    # Set leaf_role + run_id via the real route so fetchFolios reads them back.
    for idx0, (_page_type, role, run_id) in enumerate(_SEED_LEAVES):
        _patch_leaf(live_server.base_url, project_id, idx0, leaf_role=role, run_id=run_id)

    return project_id


def _open_page_order(live_server: LiveServer, page: Page, project_id: str) -> list[str]:
    """Deep-link to the Page Order tool; wait for the workspace to render.

    Returns the list of JS page errors captured (asserted empty by callers).
    """
    page_errors: list[str] = []
    page.on("pageerror", lambda exc: page_errors.append(str(exc)))
    # Use a tall desktop viewport so the inspector's right-rail controls (the
    # blank marker toggle) do not overlap the run-spine band at the bottom of
    # the flex column. At the default 720px height the run-spine sits over the
    # lower part of the inspector and intercepts pointer events on the marker
    # button (a layering wrinkle, not a wiring break).
    page.set_viewport_size({"width": 1400, "height": 1100})
    page.goto(
        f"{live_server.base_url}/projects/{project_id}/pipeline?stage=page_order",
        wait_until="load",
    )
    expect(page.locator('[data-testid="pipeline-page"]')).to_be_visible(timeout=20_000)
    expect(page.locator('[data-testid="page-order-tool"]')).to_be_visible(timeout=20_000)
    # The run spine only renders once the machine reaches the workspace state
    # (fetchFolios resolved). This is the proof the tool mounted, not a blank page.
    expect(page.locator('[data-testid="po-run-spine"]')).to_be_visible(timeout=20_000)
    return page_errors


def _computed_label(page: Page, scan: int) -> str:
    """Read the rendered computed-folio label cell for a given leaf row."""
    cell = page.locator(f'[data-testid="po-computed-{scan}"]')
    expect(cell).to_be_visible(timeout=10_000)
    return (cell.text_content() or "").strip()


def _select_leaf(page: Page, scan: int) -> None:
    """Click a leaf row and wait for its inspector to open for that scan."""
    page.locator(f'[data-testid="po-leaf-row-{scan}"]').click()
    inspector = page.locator('[data-testid="po-inspector"]')
    expect(inspector).to_be_visible(timeout=10_000)
    expect(inspector).to_have_attribute("data-scan", str(scan), timeout=10_000)


# ---------------------------------------------------------------------------
# V.1 — app-loads + router deep-link
# ---------------------------------------------------------------------------


def test_v1_app_loads_no_white_screen(live_server: LiveServer, page: Page) -> None:
    """App root renders without a white screen or asset load errors."""
    console_errors: list[str] = []
    page.on(
        "console",
        lambda msg: console_errors.append(msg.text) if msg.type == "error" else None,
    )
    page.goto(live_server.base_url, wait_until="networkidle")

    expect(page.locator("body")).to_be_visible()
    asset_errors = [e for e in console_errors if "Failed to load resource" in e or "SyntaxError" in e]
    assert asset_errors == [], f"Asset load errors: {asset_errors}"
    assert "Not Found" not in page.title()


def test_v1_router_deep_link_page_order(live_server: LiveServer, page: Page) -> None:
    """Direct navigation to ?stage=page_order resolves to the Page Order tool.

    Proves the SPA catch-all + React Router pair the sub-path to PageOrderTool —
    a blank page / 404 here would mean the route is severed.
    """
    project_id = _seed_page_order_project(live_server, "PageOrder Deep Link")
    page_errors = _open_page_order(live_server, page, project_id)

    # The stage chip confirms we landed on page_order, not some default stage.
    expect(page.locator('[data-testid="stage-chip-label"]')).to_have_text("page_order", timeout=10_000)
    assert page_errors == [], f"Page JS errors: {page_errors}"


# ---------------------------------------------------------------------------
# V.2 — headline marker happy-path (the motivating fix)
# ---------------------------------------------------------------------------


def test_v2_held_out_blank_shows_blank_page_label(live_server: LiveServer, page: Page) -> None:
    """Marking the plate's facing blank as 'Held out' shows [Blank Page], no number.

    The fix (P3): a blank leaf with no run renders ``[Blank Page]`` (a marker,
    held out of numbering) — while the neighbouring numbered leaves and a
    *different* counted blank keep their numbers unchanged.
    """
    project_id = _seed_page_order_project(live_server, "PageOrder Marker Happy Path")
    page_errors = _open_page_order(live_server, page, project_id)

    # ── Baseline: the facing blank is counted (has a number), as seeded. ──────
    facing_before = _computed_label(page, _FACING_BLANK_SCAN)
    assert facing_before not in ("[Blank Page]", "—", ""), (
        f"facing blank (scan {_FACING_BLANK_SCAN}) should start COUNTED with a number; got {facing_before!r}"
    )

    plate_label = _computed_label(page, _PLATE_SCAN)
    assert plate_label == "—", f"plate (scan {_PLATE_SCAN}) should render '—'; got {plate_label!r}"

    counted_before = _computed_label(page, _COUNTED_BLANK_SCAN)
    first_text_before = _computed_label(page, _FIRST_TEXT_SCAN)
    last_text_before = _computed_label(page, _LAST_TEXT_SCAN)
    assert counted_before not in ("[Blank Page]", "—", ""), (
        f"control counted blank (scan {_COUNTED_BLANK_SCAN}) should be numbered; got {counted_before!r}"
    )

    # ── Action: select the facing blank, toggle it to 'Held out'. ────────────
    _select_leaf(page, _FACING_BLANK_SCAN)
    # The blank marker toggle is only rendered for blank-role leaves.
    expect(page.locator('[data-testid="po-blank-marker-toggle"]')).to_be_visible(timeout=10_000)
    held_out_btn = page.locator('[data-testid="po-blank-marker-btn"]')
    expect(held_out_btn).to_be_visible(timeout=10_000)
    held_out_btn.click()

    # ── Assert: the facing blank now shows [Blank Page] (held out, no number). ─
    expect(page.locator(f'[data-testid="po-computed-{_FACING_BLANK_SCAN}"]')).to_have_text(
        "[Blank Page]", timeout=10_000
    )

    # The control counted blank is STILL counted (a real number, not a marker).
    # Its *value* legitimately shifts down by one — holding a leaf out of the run
    # renumbers everything after it (scan 4 was "4", becomes "3"). The invariant
    # the fix guarantees is that an *unrelated* blank stays counted, not held out.
    counted_after = _computed_label(page, _COUNTED_BLANK_SCAN)
    assert counted_after not in ("[Blank Page]", "—", ""), (
        f"the other counted blank must stay counted (numbered) when an unrelated "
        f"blank is held out; got {counted_after!r}"
    )

    # The leading text leaf (before the held-out blank) is unaffected — it sits
    # ahead of the removed number in the run, so its label does not change.
    assert _computed_label(page, _FIRST_TEXT_SCAN) == first_text_before, (
        "a numbered leaf BEFORE the held-out blank must keep its exact number"
    )
    # The trailing text leaf stays numbered (its value shifts down by one for the
    # same renumber reason; the point is it is still a real folio number).
    last_text_after = _computed_label(page, _LAST_TEXT_SCAN)
    assert last_text_after not in ("[Blank Page]", "—", ""), (
        f"a numbered leaf after the held-out blank must stay numbered; got {last_text_after!r}"
    )
    # Sanity: the held-out blank genuinely dropped a number from the run, so the
    # leaves after it renumbered down by one.
    assert counted_after != counted_before, (
        "holding out the facing blank should renumber the following counted blank"
    )
    assert last_text_after != last_text_before

    assert page_errors == [], f"Page JS errors: {page_errors}"


# ---------------------------------------------------------------------------
# V.3 — persistence survives a full page reload (the cross-seam check)
# ---------------------------------------------------------------------------


def test_v3_marker_state_persists_across_reload(live_server: LiveServer, page: Page) -> None:
    """The 'Held out' marker (run_id → null) survives a full page reload.

    This is the chain the mocked vitest cannot exercise: the browser PATCH must
    reach the real backend, write the event store, and GET /pages must read the
    cleared run_id back so fetchFolios re-renders the leaf as a marker.
    """
    project_id = _seed_page_order_project(live_server, "PageOrder Marker Persist")
    _open_page_order(live_server, page, project_id)

    # Toggle the facing blank to held-out.
    _select_leaf(page, _FACING_BLANK_SCAN)
    page.locator('[data-testid="po-blank-marker-btn"]').click()
    expect(page.locator(f'[data-testid="po-computed-{_FACING_BLANK_SCAN}"]')).to_have_text(
        "[Blank Page]", timeout=10_000
    )

    # Full reload — fresh navigation, not SPA transition.
    page.goto(
        f"{live_server.base_url}/projects/{project_id}/pipeline?stage=page_order",
        wait_until="load",
    )
    expect(page.locator('[data-testid="po-run-spine"]')).to_be_visible(timeout=20_000)

    # The marker survived the round-trip: still [Blank Page], not a number.
    expect(page.locator(f'[data-testid="po-computed-{_FACING_BLANK_SCAN}"]')).to_have_text(
        "[Blank Page]", timeout=15_000
    )


def test_v3_folio_override_persists_across_reload(live_server: LiveServer, page: Page) -> None:
    """A folio override (label_override) set in the inspector survives reload.

    Exercises the P3.3 label_override chain end-to-end: inspector input → blur →
    OVERRIDE_FOLIO → persistLeaf PATCH → event store → GET /pages → fetchFolios
    repopulates the inspector field on reload.
    """
    project_id = _seed_page_order_project(live_server, "PageOrder Folio Override Persist")
    _open_page_order(live_server, page, project_id)

    override_value = "xvii"

    # Set a folio override on a numbered text leaf.
    _select_leaf(page, _FIRST_TEXT_SCAN)
    folio_input = page.locator('[data-testid="po-inspector-folio-override"]')
    expect(folio_input).to_be_visible(timeout=10_000)
    folio_input.fill(override_value)
    folio_input.press("Enter")  # blur → OVERRIDE_FOLIO → persistLeaf

    # Give the fire-and-forget PATCH a beat to land before reloading.
    page.wait_for_timeout(750)

    # Full reload.
    page.goto(
        f"{live_server.base_url}/projects/{project_id}/pipeline?stage=page_order",
        wait_until="load",
    )
    expect(page.locator('[data-testid="po-run-spine"]')).to_be_visible(timeout=20_000)

    # Re-open the same leaf; the override must be repopulated from the backend.
    _select_leaf(page, _FIRST_TEXT_SCAN)
    folio_input_after = page.locator('[data-testid="po-inspector-folio-override"]')
    expect(folio_input_after).to_have_value(override_value, timeout=15_000)
