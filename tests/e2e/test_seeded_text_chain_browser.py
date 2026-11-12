"""Text review and wordcheck against seeded flags, with no OCR run."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING

import httpx
from playwright.sync_api import Page, expect

from pdomain_prep_for_pgdp.core.models import PageProcessingStatus, PageRecord
from tests.fixtures.seed_pages import seed_pages_in_store
from tests.fixtures.seed_stages import ReviewPageSeed, seed_review_pages

if TYPE_CHECKING:
    from .conftest import LiveServer

_SEEDS = (
    ReviewPageSeed("0000", (("w-a", "tbe"), ("w-b", "arid"))),
    ReviewPageSeed("0001", (("w-c", "modem"),)),
    ReviewPageSeed("0002", (("w-signed", "signedoff"),), attested=True),
)


def _seed(live_server: LiveServer, name: str) -> str:
    resp = httpx.post(
        f"{live_server.base_url}/api/data/projects", json={"name": name, "source_type": "zip"}, timeout=10
    )
    assert resp.status_code == 200, resp.text
    project_id: str = resp.json()["project"]["id"]
    seed_pages_in_store(
        live_server.settings,
        project_id,
        [
            PageRecord(
                project_id=project_id,
                idx0=idx0,
                prefix=f"p{idx0 + 1:04d}",
                source_stem=f"img{idx0}",
                processing_status=PageProcessingStatus.pending,
            )
            for idx0 in range(len(_SEEDS))
        ],
        project_name=project_id,
    )
    seed_review_pages(live_server.settings, project_id, _SEEDS)
    return project_id


def _open_stage(page: Page, live_server: LiveServer, project_id: str, stage_id: str) -> None:
    _ = page.goto(f"{live_server.base_url}/projects/{project_id}/pipeline?stage={stage_id}")


def test_review_queue_lists_flags_from_unattested_pages_only(live_server: LiveServer, page: Page) -> None:
    project_id = _seed(live_server, "Seeded queue")
    _open_stage(page, live_server, project_id, "text_review")
    expect(page.get_by_test_id("text-review-queue-list")).to_be_visible(timeout=15_000)
    for item_id in ("w-a", "w-b", "w-c"):
        expect(page.get_by_test_id(f"queue-item-row-{item_id}")).to_be_visible()
    expect(page.get_by_test_id("queue-item-row-w-signed")).to_have_count(0)


def test_text_review_approval_attests_every_open_page(live_server: LiveServer, page: Page) -> None:
    project_id = _seed(live_server, "Seeded approval")
    _open_stage(page, live_server, project_id, "text_review")
    expect(page.get_by_test_id("queue-item-row-w-a")).to_be_visible(timeout=15_000)

    page.get_by_test_id("approve-item-w-a").click()
    expect(page.get_by_test_id("queue-item-row-w-a")).to_have_count(0)

    with page.expect_response(lambda r: r.url.endswith("/text_review/approve-low-risk")) as low_risk:
        page.get_by_test_id("text-review-approve-low-risk").click()
    assert low_risk.value.status == 200

    confirm = page.get_by_test_id("text-review-confirm-advance")
    expect(confirm).to_be_enabled()
    with page.expect_response(lambda r: r.url.endswith("/text_review/confirm")) as confirmed:
        confirm.click()
    assert confirmed.value.status == 200
    expect(page.get_by_test_id("text-review-tool-settled")).to_be_visible(timeout=10_000)

    stages_root = live_server.settings.data_root / "projects" / project_id / "pages"
    for page_id in ("0000", "0001"):
        attestation_path = stages_root / page_id / "stages" / "text_review" / "attestation.json"
        assert json.loads(attestation_path.read_text())["status"] == "clean"
        rows = httpx.get(
            f"{live_server.base_url}/api/data/projects/{project_id}/pages/{int(page_id)}/stages", timeout=10
        ).json()
        assert next(r for r in rows if r["stage_id"] == "text_review")["status"] == "clean"


def test_wordcheck_lists_seeded_suspects_and_keep_clears_one(live_server: LiveServer, page: Page) -> None:
    project_id = _seed(live_server, "Seeded wordcheck")
    _open_stage(page, live_server, project_id, "wordcheck")
    expect(page.get_by_test_id("wordcheck-suspect-list")).to_be_visible(timeout=15_000)
    for item_id in ("w-a", "w-b", "w-c", "w-signed"):
        expect(page.get_by_test_id(f"suspect-row-{item_id}")).to_be_visible()
    expect(page.get_by_test_id("suspect-row-w-a")).to_contain_text("tbe")

    page.get_by_test_id("keep-suspect-w-a").click()
    expect(page.get_by_test_id("keep-suspect-w-a")).to_have_count(0)
