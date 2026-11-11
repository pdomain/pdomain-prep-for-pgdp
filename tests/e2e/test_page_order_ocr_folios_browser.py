"""Persisted OCR folios reach the page-order ledger and its confirm gate."""

from __future__ import annotations

from typing import TYPE_CHECKING

import httpx
from playwright.sync_api import Page, expect

from pdomain_prep_for_pgdp.core.models import PageProcessingStatus, PageRecord
from pdomain_prep_for_pgdp.core.page_service_helpers import update_page_extension
from pdomain_prep_for_pgdp.core.page_store_factory import build_page_service
from tests.fixtures.seed_pages import seed_pages_in_store

if TYPE_CHECKING:
    from .conftest import LiveServer


def _seed(live_server: LiveServer, name: str, folios: tuple[str, ...]) -> str:
    base = live_server.base_url
    resp = httpx.post(f"{base}/api/data/projects", json={"name": name, "source_type": "zip"}, timeout=10)
    assert resp.status_code == 200, resp.text
    project_id: str = resp.json()["project"]["id"]
    data_root = live_server.settings.data_root
    seed_pages_in_store(
        data_root,
        project_id,
        [
            PageRecord(
                project_id=project_id,
                idx0=idx0,
                prefix=f"p{idx0 + 1:04d}",
                source_stem=f"img{idx0}",
                processing_status=PageProcessingStatus.pending,
            )
            for idx0 in range(len(folios))
        ],
        project_name=project_id,
    )
    service = build_page_service(data_root, project_id)
    for idx0, folio in enumerate(folios):
        _ = update_page_extension(service, project_id, idx0, ocr_folio=folio)
        patched = httpx.patch(
            f"{base}/api/data/projects/{project_id}/pages/{idx0}",
            json={"leaf_role": "text", "run_id": "body"},
            timeout=10,
        )
        assert patched.status_code == 200, patched.text
    return project_id


def _open_page_order(page: Page, live_server: LiveServer, project_id: str) -> None:
    _ = page.goto(f"{live_server.base_url}/projects/{project_id}/pipeline?stage=page_order")
    expect(page.get_by_test_id("po-ledger")).to_be_visible(timeout=15_000)


def test_matching_folios_show_in_the_ledger_and_allow_confirm(live_server: LiveServer, page: Page) -> None:
    project_id = _seed(live_server, "Folios match", ("1", "2", "3"))
    _open_page_order(page, live_server, project_id)
    for scan, folio in enumerate(("1", "2", "3")):
        expect(page.get_by_test_id(f"po-leaf-row-{scan}")).to_contain_text(folio)
    expect(page.get_by_test_id("po-flag-chip-outOfSequence")).to_have_count(0)
    expect(page.get_by_test_id("po-confirm-advance-btn")).to_be_enabled()


def test_disagreeing_folio_flags_the_page_and_blocks_confirm(live_server: LiveServer, page: Page) -> None:
    project_id = _seed(live_server, "Folios disagree", ("1", "9", "3"))
    _open_page_order(page, live_server, project_id)
    row = page.get_by_test_id("po-leaf-row-1")
    expect(row).to_contain_text("9")
    expect(row.get_by_test_id("po-flag-chip-outOfSequence")).to_be_visible()
    expect(page.get_by_test_id("po-confirm-advance-btn")).to_be_disabled()
