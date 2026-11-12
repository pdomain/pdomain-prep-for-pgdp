"""The Wave 2 image-prep screens against a live server in real Chromium."""

from __future__ import annotations

import re
import zipfile
from typing import TYPE_CHECKING

import httpx
import pytest
from playwright.sync_api import ConsoleMessage, Page, expect

from pdomain_prep_for_pgdp.core.models import PageProcessingStatus, PageRecord
from tests.fixtures.seed_pages import seed_pages_in_store
from tests.fixtures.seed_stages import commit_stages, gradient_png

if TYPE_CHECKING:
    from pathlib import Path

    from .conftest import LiveServer


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
            for idx0 in range(3)
        ],
        project_name=project_id,
    )
    commit_stages(
        settings,
        project_id,
        {
            f"{idx0:04d}": [
                ("crop", gradient_png()),
                ("threshold", gradient_png()),
                ("post_transform_crop", gradient_png(height, 100)),
                ("canvas_map", gradient_png(height, 100)),
            ]
            for idx0, height in enumerate((130, 132, 100))
        },
        dirty=[("0000", "threshold")],
    )
    return project_id


@pytest.fixture
def console_errors(page: Page) -> list[str]:
    errors: list[str] = []

    def record(msg: ConsoleMessage) -> None:
        if msg.type == "error":
            errors.append(f"{msg.text} @ {msg.location.get('url', '')}")

    page.on("console", record)
    page.on("pageerror", lambda exc: errors.append(str(exc)))
    return errors


def _open_stage(page: Page, base_url: str, project_id: str, stage_id: str) -> None:
    _ = page.goto(f"{base_url}/projects/{project_id}/pipeline?stage={stage_id}")
    expect(page.get_by_test_id(f"image-stage-review-tool-{stage_id}")).to_be_visible(timeout=15_000)


def _open_flagged_editor(page: Page) -> None:
    page.get_by_test_id("page-thumb-0000").click()
    expect(page.get_by_test_id("inline-editor-0000")).to_be_visible()


def test_review_grid_loads_real_thumbnails(
    live_server: LiveServer, page: Page, console_errors: list[str]
) -> None:
    project_id = _seed(live_server, "Wave2 thumbs")
    _open_stage(page, live_server.base_url, project_id, "threshold")
    for page_id in ("0000", "0001", "0002"):
        thumb = page.get_by_test_id(f"page-thumb-{page_id}").locator("img")
        expect(thumb).to_have_count(1)
        expect(thumb).to_have_js_property("complete", True)
        assert thumb.evaluate("el => el.naturalWidth") > 0
    assert console_errors == []


def test_editor_shows_before_image_and_real_threshold_control(live_server: LiveServer, page: Page) -> None:
    project_id = _seed(live_server, "Wave2 editor")
    _open_stage(page, live_server.base_url, project_id, "threshold")
    _open_flagged_editor(page)
    before = page.get_by_test_id("wipe-viewer").get_by_alt_text("Before")
    expect(before).to_be_visible()
    expect(before).to_have_js_property("complete", True)
    assert before.evaluate("el => el.naturalWidth") > 0
    expect(page.get_by_test_id("control-threshold_level")).to_be_visible()


def test_clean_page_shows_its_after_image(live_server: LiveServer, page: Page) -> None:
    project_id = _seed(live_server, "Wave2 after")
    _open_stage(page, live_server.base_url, project_id, "threshold")
    _open_flagged_editor(page)
    page.get_by_test_id("page-thumb-0001").click()
    expect(page.get_by_test_id("inline-editor-0001")).to_be_visible()
    after = page.get_by_test_id("wipe-viewer").get_by_alt_text("After")
    expect(after).to_be_visible()
    expect(after).to_have_js_property("complete", True)
    assert after.evaluate("el => el.naturalWidth") > 0


def test_rerun_with_edited_threshold_produces_after_image(
    live_server: LiveServer, page: Page, console_errors: list[str]
) -> None:
    project_id = _seed(live_server, "Wave2 rerun")
    _open_stage(page, live_server.base_url, project_id, "threshold")
    _open_flagged_editor(page)
    page.get_by_test_id("slider-threshold_level").fill("200")
    expect(page.get_by_test_id("edited-threshold_level")).to_be_visible()
    page.get_by_test_id("rerun-btn").click()

    def row_state() -> dict[str, object]:
        rows = httpx.get(
            f"{live_server.base_url}/api/data/projects/{project_id}/project-stages/threshold/pages",
            timeout=10,
        ).json()["rows"]
        return next(r for r in rows if r["idx"] == "0000")

    for _ in range(100):
        if row_state()["state"] == "clean":
            break
        page.wait_for_timeout(200)
    assert row_state()["state"] == "clean", row_state()
    expect(page.get_by_test_id("review-inline-error")).to_have_count(0)
    thumb = page.get_by_test_id("page-thumb-0000").locator("img")
    expect(thumb).to_have_attribute("src", re.compile(r"/stages/threshold/thumbnail\?v="), timeout=10_000)
    assert console_errors == []


def test_save_for_page_shows_tier_badge_then_clear_removes_it(live_server: LiveServer, page: Page) -> None:
    project_id = _seed(live_server, "Wave2 tiers")
    _open_stage(page, live_server.base_url, project_id, "threshold")
    _open_flagged_editor(page)
    page.get_by_test_id("slider-threshold_level").fill("150")
    page.get_by_role("button", name="Save for this page").click()
    badge = page.get_by_test_id("source-threshold_level")
    expect(badge).to_contain_text(re.compile("page", re.IGNORECASE), timeout=10_000)
    clear = page.get_by_role("button", name="Clear page override")
    expect(clear).to_be_enabled()
    clear.click()
    expect(badge).not_to_contain_text(re.compile("page", re.IGNORECASE), timeout=10_000)


def test_canvas_map_plots_measured_pages(live_server: LiveServer, page: Page) -> None:
    project_id = _seed(live_server, "Wave2 canvas")
    _open_stage(page, live_server.base_url, project_id, "canvas_map")
    expect(page.get_by_test_id("canvas-map-tool")).to_be_visible()
    for page_id in ("0000", "0001", "0002"):
        expect(page.get_by_test_id(f"aspect-point-{page_id}")).to_have_count(1, timeout=10_000)
    expect(page.get_by_test_id("canvas-map-rederive-btn")).to_be_enabled()


def test_save_a_copy_downloads_project_zip(live_server: LiveServer, page: Page, tmp_path: Path) -> None:
    project_id = _seed(live_server, "Wave2 copy")
    _ = page.goto(f"{live_server.base_url}/")
    row = page.get_by_test_id(f"project-row-{project_id}")
    expect(row).to_be_visible(timeout=15_000)
    row.click()
    page.get_by_test_id("tab-manage").click()
    with page.expect_download(timeout=20_000) as download:
        page.get_by_test_id("manage-action-btn-saveCopy").click()
    target = tmp_path / "copy.zip"
    download.value.save_as(target)
    with zipfile.ZipFile(target) as archive:
        names = archive.namelist()
    assert "pgdp-prep-export.json" in names
    assert any(n.endswith("threshold/output.png") for n in names), names[:20]


def test_app_settings_lists_stage_defaults(live_server: LiveServer, page: Page) -> None:
    _ = page.goto(f"{live_server.base_url}/settings")
    for title in ("Threshold stage defaults", "Deskew stage defaults", "Denoise stage defaults"):
        expect(page.get_by_text(title, exact=True)).to_be_visible(timeout=15_000)
