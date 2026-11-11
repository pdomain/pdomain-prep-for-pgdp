"""W2.4: the Text Zones editors work on real page images in Chromium.

Each page gets a synthetic two-column scan as its source blob and ingest
thumbnail. Page 0000 also has a post_transform_crop image and a detector
text_zones artifact, so its zone editor opens with stored zones. Page 0001
has neither, so it exercises the thumbnail fallback and the split path.
"""

from __future__ import annotations

import json
import os
from typing import TYPE_CHECKING

import cv2
import httpx
import numpy as np
from playwright.sync_api import ConsoleMessage, Locator, Page, expect

from pdomain_prep_for_pgdp.core.models import PageProcessingStatus, PageRecord
from pdomain_prep_for_pgdp.core.page_service_helpers import update_page_extension
from pdomain_prep_for_pgdp.core.page_store_factory import build_page_service
from tests.fixtures.seed_pages import seed_pages_in_store
from tests.fixtures.seed_stages import commit_stages

if TYPE_CHECKING:
    from .conftest import LiveServer

SCAN_W = 800
SCAN_H = 600
LEFT_COLUMN = (60, 60, 280, 480)
RIGHT_COLUMN = (460, 60, 280, 480)


def _png(img: np.ndarray) -> bytes:
    ok, buf = cv2.imencode(".png", img)
    assert ok
    return bytes(buf.tobytes())


def _two_column_scan() -> np.ndarray:
    """A white spread with two blocks of dark 'text lines' and a clear gutter."""
    img = np.full((SCAN_H, SCAN_W), 255, dtype=np.uint8)
    for x, y, w, h in (LEFT_COLUMN, RIGHT_COLUMN):
        for line_y in range(y, y + h, 16):
            img[line_y : line_y + 6, x : x + w] = 30
    return img


def _seed(live_server: LiveServer, name: str) -> str:
    base = live_server.base_url
    resp = httpx.post(f"{base}/api/data/projects", json={"name": name, "source_type": "zip"}, timeout=10)
    assert resp.status_code == 200, resp.text
    project_id: str = resp.json()["project"]["id"]
    settings = live_server.settings
    seed_pages_in_store(
        settings,
        project_id,
        [
            PageRecord(
                project_id=project_id,
                idx0=idx0,
                prefix=f"p{idx0 + 1:04d}",
                source_stem=f"img{idx0}",
                processing_status=PageProcessingStatus.pending,
            )
            for idx0 in range(2)
        ],
        project_name=project_id,
    )
    scan = _two_column_scan()
    thumb = cv2.resize(scan, (SCAN_W // 4, SCAN_H // 4), interpolation=cv2.INTER_AREA)
    service = build_page_service(settings.data_root, project_id)
    source_hash = service.blobs.write(_png(scan))
    thumb_hash = service.blobs.write(_png(thumb))
    for idx0 in range(2):
        _ = update_page_extension(
            service, project_id, idx0, source_blob_hash=source_hash, thumbnail_blob_hash=thumb_hash
        )
    detector_zones = {
        "zones": [
            {"zone_id": f"z{i:03d}", "bbox": list(box), "zone_type": "text", "area": box[2] * box[3]}
            for i, box in enumerate((LEFT_COLUMN, RIGHT_COLUMN), start=1)
        ],
        "image_width": SCAN_W,
        "image_height": SCAN_H,
    }
    commit_stages(
        settings,
        project_id,
        {
            "0000": [
                ("post_transform_crop", _png(scan)),
                ("text_zones", json.dumps(detector_zones).encode()),
            ]
        },
    )
    return project_id


def _open_text_zones(page: Page, live_server: LiveServer, project_id: str) -> list[str]:
    errors: list[str] = []

    def record(msg: ConsoleMessage) -> None:
        # The zone canvas probes post_transform_crop first; a 404 there is the
        # documented fallback to the thumbnail, not an error.
        is_fallback_probe = "post_transform_crop/artifact" in msg.location.get("url", "")
        if msg.type == "error" and not is_fallback_probe:
            errors.append(f"{msg.text} @ {msg.location.get('url', '')}")

    page.on("console", record)
    page.on("pageerror", lambda exc: errors.append(str(exc)))
    _ = page.goto(f"{live_server.base_url}/projects/{project_id}/pipeline?stage=text_zones")
    expect(page.get_by_test_id("text-zones-tool")).to_be_visible(timeout=15_000)
    return errors


def _card(page: Page, idx: str) -> Locator:
    return page.locator(f'[data-testid="zone-page-card"][data-idx="{idx}"]')


def _shot(page: Page, name: str) -> None:
    shot_dir = os.environ.get("PGDP_E2E_SHOT_DIR")
    if shot_dir:
        _ = page.screenshot(path=f"{shot_dir}/{name}.png", full_page=True)


def _aggregate_row(live_server: LiveServer, project_id: str, idx: str) -> dict[str, object]:
    rows = httpx.get(
        f"{live_server.base_url}/api/data/projects/{project_id}/project-stages/text_zones/pages-aggregate",
        timeout=10,
    ).json()["rows"]
    return next(r for r in rows if r["idx"] == idx)


def test_cards_show_real_thumbnails(live_server: LiveServer, page: Page) -> None:
    project_id = _seed(live_server, "Zones thumbs")
    errors = _open_text_zones(page, live_server, project_id)
    for idx in ("0000", "0001"):
        img = _card(page, idx).get_by_test_id("zone-card-image")
        expect(img).to_have_js_property("complete", True)
        assert img.evaluate("el => el.naturalWidth") == SCAN_W // 4
    assert errors == []


def test_zone_editor_draws_stored_zones_and_saves_a_drawn_zone(live_server: LiveServer, page: Page) -> None:
    project_id = _seed(live_server, "Zones draw")
    errors = _open_text_zones(page, live_server, project_id)
    _card(page, "0000").click()

    canvas = page.get_by_test_id("zone-canvas")
    expect(canvas).to_have_attribute("data-image-loaded", "true")
    expect(canvas).to_have_attribute(
        "data-image-src", f"/api/data/projects/{project_id}/pages/0/stages/post_transform_crop/artifact"
    )
    expect(canvas).to_have_attribute("data-zone-count", "2")
    expect(page.get_by_text("I1: Konva")).to_have_count(0)
    _shot(page, "zone-editor-stored")

    # Draw a box over the lower middle of the page with the box tool.
    page.get_by_test_id("zone-tool-box").click()
    page.get_by_test_id("zone-draw-type").select_option("illustration")
    box = canvas.bounding_box()
    assert box is not None
    page.mouse.move(box["x"] + box["width"] * 0.30, box["y"] + box["height"] * 0.85)
    page.mouse.down()
    page.mouse.move(box["x"] + box["width"] * 0.50, box["y"] + box["height"] * 0.90, steps=5)
    page.mouse.move(box["x"] + box["width"] * 0.70, box["y"] + box["height"] * 0.95, steps=5)
    page.mouse.up()
    expect(canvas).to_have_attribute("data-zone-count", "3")
    _shot(page, "zone-editor-drawn")

    page.get_by_test_id("zone-editor-save").click()
    expect(page.get_by_test_id("zone-editor-panel")).to_have_count(0)

    row = _aggregate_row(live_server, project_id, "0000")
    assert row["zones"] == 3
    zones = row["_zones"]
    assert isinstance(zones, list)
    drawn = [z for z in zones if isinstance(z, dict) and z.get("type") == "illustration"]
    assert len(drawn) == 1
    assert abs(float(drawn[0]["x"]) - 0.30) < 0.02
    assert abs(float(drawn[0]["w"]) - 0.40) < 0.02
    assert abs(float(drawn[0]["y"]) - 0.85) < 0.02
    assert errors == []


def test_split_on_a_real_page_creates_siblings_at_the_dragged_gutter(
    live_server: LiveServer, page: Page
) -> None:
    project_id = _seed(live_server, "Zones split")
    errors = _open_text_zones(page, live_server, project_id)
    _card(page, "0001").click()

    # No post_transform_crop yet: the zone canvas falls back to the thumbnail.
    canvas = page.get_by_test_id("zone-canvas")
    expect(canvas).to_have_attribute("data-image-loaded", "true")
    expect(canvas).to_have_attribute("data-image-src", f"/api/data/projects/{project_id}/pages/1/thumbnail")

    page.get_by_test_id("zone-editor-split").click()
    preview = page.get_by_test_id("split-preview-canvas")
    expect(preview).to_have_attribute("data-image-loaded", "true")
    expect(preview).to_have_attribute("data-gutter", "0.5")

    # Drag the gutter to 40% of the page width on the Konva stage.
    stage = page.get_by_test_id("split-source-stage")
    box = stage.bounding_box()
    assert box is not None
    mid_y = box["y"] + box["height"] / 2
    page.mouse.move(box["x"] + box["width"] * 0.5, mid_y)
    page.mouse.down()
    page.mouse.move(box["x"] + box["width"] * 0.45, mid_y, steps=4)
    page.mouse.move(box["x"] + box["width"] * 0.40, mid_y, steps=4)
    page.mouse.up()
    expect(preview).to_have_attribute("data-gutter", "0.4")
    expect(page.get_by_test_id("split-child-a")).to_contain_text("p0002a")
    expect(page.get_by_test_id("split-child-b")).to_contain_text("p0002b")
    _shot(page, "split-editor-dragged")

    page.get_by_test_id("split-editor-apply").click()
    expect(page.get_by_test_id("split-editor-panel")).to_have_count(0)
    _shot(page, "split-applied")
    expect(_card(page, "0001")).to_contain_text("p0002")
    expect(_card(page, "0001")).to_have_attribute("data-state", "split")
    # Each child shows a thumbnail of its own half of the spread.
    for child_idx in ("0002", "0003"):
        img = _card(page, child_idx).get_by_test_id("zone-card-image")
        expect(img).to_have_js_property("complete", True)
        assert img.evaluate("el => el.naturalWidth") > 0

    pages = httpx.get(f"{live_server.base_url}/api/data/projects/{project_id}/pages", timeout=10).json()
    records = pages["pages"] if isinstance(pages, dict) else pages
    children = sorted(
        (p for p in records if p.get("parent_page_id") is not None),
        key=lambda p: p["split_index"],
    )
    assert [c["split_suffix"] for c in children] == ["a", "b"]
    assert [c["split_at_stage"] for c in children] == ["text_zones", "text_zones"]
    gutter_px = round(0.4 * SCAN_W)
    assert [tuple(c["source_crop_bbox"]) for c in children] == [
        (0, 0, gutter_px, SCAN_H),
        (gutter_px, 0, SCAN_W - gutter_px, SCAN_H),
    ]
    assert errors == []
