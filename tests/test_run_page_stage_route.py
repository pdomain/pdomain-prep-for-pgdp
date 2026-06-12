"""M2 Slice 4 — `POST /api/data/projects/{id}/pages/{idx0}/stages/{stage_id}/run`.

Spec: `docs/specs/pipeline-task-model.md` §"API surface" (§Per-page stage
routes) — the per-page run endpoint that the workbench chip rail
(Slice 5) calls when the user clicks a chip.

Behavior:

- Validates project ownership (404 on miss / cross-user).
- Validates the page exists (404).
- Validates `stage_id` is in `V2_PAGE_STAGE_IDS` (422 unprocessable).
- Calls `run_stage`. On success returns the freshly-committed row
  (status=clean). On `StageDependenciesNotMet` returns 409 conflict
  with a message naming the missing parents. On `StageOutputUnsupported`
  returns 501 not-implemented (the multi-artifact writer is queued).
  On `StageRunFailed` returns 500 with the error message — but the
  page_stages row is already marked `failed`, so the chip rail can
  re-fetch and show the failure inline.

Slice 4 does **not** wrap this in a Job — for the simple stages we have
real impls for (grayscale/threshold/invert), the runner is fast enough
to run synchronously in the request handler. JobType.run_page_stage
lands when slow stages (ocr, extract_illustrations) get wired.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import TYPE_CHECKING

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pdomain_prep_for_pgdp.bootstrap import build_app
from pdomain_prep_for_pgdp.core.models import (
    PageProcessingStatus,
    PageRecord,
    PageStageState,
    PageStageStatus,
    Project,
    ProjectConfig,
    ProjectStatus,
)
from pdomain_prep_for_pgdp.core.page_service_helpers import update_page_extension
from pdomain_prep_for_pgdp.core.page_store_factory import build_page_service
from pdomain_prep_for_pgdp.core.pipeline.page_stage_writer import commit_stage_artifact
from pdomain_prep_for_pgdp.settings import Settings
from tests.fixtures.seed_pages import seed_pages_in_store

if TYPE_CHECKING:
    from collections.abc import Iterator
    from pathlib import Path

# ─── Fixtures ───────────────────────────────────────────────────────────────


def _settings(tmp_path: Path) -> Settings:
    return Settings(
        host="127.0.0.1",
        port=8765,
        data_root=tmp_path / "data",
        config_dir=tmp_path / "config",
        storage_backend="filesystem",
        database_url=f"sqlite:///{(tmp_path / 's.db').as_posix()}",
        gpu_backend="cpu",
        dispatch_interval_seconds=0,
        auth_mode="none",
    )


def _seed(settings: Settings, owner_id: str = "default") -> None:
    async def go() -> None:
        db = SqliteDatabase(settings.derived_database_url)
        await db.initialize()
        now = datetime.now(UTC)
        await db.put_project(
            Project(
                id="m2s4",
                owner_id=owner_id,
                name="m2s4",
                created_at=now,
                updated_at=now,
                status=ProjectStatus.processing,
                page_count=1,
                proof_page_count=1,
                config=ProjectConfig(book_name="m2s4", source_uri=""),
                storage_prefix="projects/m2s4/",
            )
        )
        seed_pages_in_store(
            settings,
            "m2s4",
            [
                PageRecord(
                    project_id="m2s4",
                    idx0=0,
                    prefix="p001",
                    source_stem="src1",
                    processing_status=PageProcessingStatus.pending,
                ),
            ],
        )
        # Seed a source image blob so v2 root page stages (grayscale) can load it.
        # v2 grayscale has no page-scoped deps — it reads from BlobStore directly.
        svc = build_page_service(settings.data_root, "m2s4")
        blob_hash = svc.blobs.write(_checkerboard_bgr_png())
        update_page_extension(svc, "m2s4", 0, source_blob_hash=blob_hash)
        await db.close()

    asyncio.run(go())


def _checkerboard_bgr_png() -> bytes:
    img = np.zeros((20, 20, 3), dtype=np.uint8)
    img[::2, ::2] = (200, 200, 200)
    img[1::2, 1::2] = (200, 200, 200)
    ok, buf = cv2.imencode(".png", img)
    assert ok
    return bytes(buf.tobytes())


async def _seed_clean_parent(
    settings: Settings, project_id: str, page_id: str, stage_id: str, payload: bytes
) -> None:
    """Seed one parent stage row + on-disk artifact via the canonical writer."""
    db = SqliteDatabase(settings.derived_database_url)
    await db.initialize()
    try:
        await db.init_page_stages_for_page(project_id, page_id)
        await commit_stage_artifact(
            data_root=settings.data_root,
            database=db,
            project_id=project_id,
            page_id=page_id,
            stage_id=stage_id,
            artifact_bytes=payload,
        )
    finally:
        await db.close()


@pytest.fixture
def seeded_client(tmp_path: Path) -> Iterator[tuple[TestClient, Settings]]:
    settings = _settings(tmp_path)
    _seed(settings)
    app = build_app(settings)
    with TestClient(app) as c:
        yield c, settings


# ─── Happy path: 200 + clean row ───────────────────────────────────────────


def test_run_stage_route_grayscale_happy_path(
    seeded_client: tuple[TestClient, Settings],
) -> None:
    """POST run on `grayscale` returns 200 and a clean PageStageState row.

    v2 DAG: `grayscale` has no page-scoped dependencies (its only dep is the
    project-scoped `source` stage, which is not checked at the page-stage level).
    No parent seeding is needed.
    """
    client, _ = seeded_client

    r = client.post("/api/data/projects/m2s4/pages/0/stages/grayscale/run")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["stage_id"] == "grayscale"
    assert body["status"] == PageStageStatus.clean.value
    assert body["last_run_at"] is not None
    assert body["input_hash"] is not None


def test_run_stage_route_returns_409_when_dependencies_not_met(
    seeded_client: tuple[TestClient, Settings],
) -> None:
    """Without seeding the parent, the runner raises StageDependenciesNotMet.
    The route translates to 409 Conflict so the UI can prompt for auto-run.

    v2 DAG: `crop` depends on `grayscale`. Running `crop` without `grayscale`
    being clean triggers the dep-not-met 409.
    """
    client, _ = seeded_client
    # Lazy-init the rows so the page is known but no parent is clean yet.
    client.get("/api/data/projects/m2s4/pages/0/stages")

    r = client.post("/api/data/projects/m2s4/pages/0/stages/crop/run")
    assert r.status_code == 409, r.text
    assert "grayscale" in r.text


def test_run_stage_route_returns_409_for_ocr_without_parent(
    seeded_client: tuple[TestClient, Settings],
) -> None:
    """`ocr` returns 409 when its parent `post_ocr_crop` is not clean.

    v2 DAG: `ocr` depends on `post_ocr_crop` (which replaced `ocr_crop`).
    Running `ocr` without the parent chain produces 409.
    """
    client, _ = seeded_client
    client.get("/api/data/projects/m2s4/pages/0/stages")

    r = client.post("/api/data/projects/m2s4/pages/0/stages/ocr/run")
    assert r.status_code == 409, r.text
    assert "post_ocr_crop" in r.text


# ─── Validation paths ──────────────────────────────────────────────────────


def test_run_stage_route_422_for_unknown_stage_id(
    seeded_client: tuple[TestClient, Settings],
) -> None:
    """An unknown `stage_id` is rejected at the route layer, not the runner."""
    client, _ = seeded_client
    r = client.post("/api/data/projects/m2s4/pages/0/stages/not_a_real_stage/run")
    assert r.status_code == 422, r.text


def test_run_stage_route_404_for_unknown_project(
    seeded_client: tuple[TestClient, Settings],
) -> None:
    client, _ = seeded_client
    r = client.post("/api/data/projects/nope/pages/0/stages/grayscale/run")
    assert r.status_code == 404


def test_run_stage_route_404_for_unknown_page(
    seeded_client: tuple[TestClient, Settings],
) -> None:
    client, _ = seeded_client
    r = client.post("/api/data/projects/m2s4/pages/99/stages/grayscale/run")
    assert r.status_code == 404


def test_run_stage_route_404_for_other_users_project(tmp_path: Path) -> None:
    """Non-owner sees 404, not 403 — same pattern as list_page_stages."""
    settings = _settings(tmp_path)
    _seed(settings, owner_id="someone_else")
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post("/api/data/projects/m2s4/pages/0/stages/grayscale/run")
        assert r.status_code == 404


# ─── Failure path: registered impl raises ──────────────────────────────────


def test_run_stage_route_500_when_impl_raises_with_failed_row(
    seeded_client: tuple[TestClient, Settings],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A registered impl that raises causes the runner to mark the row failed
    + raise StageRunFailed. The route surfaces 500. A subsequent GET shows
    the row's `status=failed` so the chip rail tooltip can explain.

    v2 DAG: `grayscale` has no page-scoped deps, so no parent seeding needed.
    The monkeypatch now targets V2_STAGE_IMPL since v2 stage IDs are routed there.
    """
    client, _ = seeded_client

    from pdomain_prep_for_pgdp.core.pipeline import stage_registry

    def _kaboom(_x, cfg=None):
        raise ValueError("synthetic stage failure for tests")

    monkeypatch.setitem(stage_registry.V2_STAGE_IMPL["grayscale"], "cpu", _kaboom)

    r = client.post("/api/data/projects/m2s4/pages/0/stages/grayscale/run")
    assert r.status_code == 500, r.text

    # The row is now `failed` with the exception message in error_message.
    rows_resp = client.get("/api/data/projects/m2s4/pages/0/stages")
    assert rows_resp.status_code == 200
    by_id = {row["stage_id"]: row for row in rows_resp.json()}
    failed_row = by_id["grayscale"]
    assert failed_row["status"] == PageStageStatus.failed.value
    assert "synthetic" in (failed_row["error_message"] or "")


# ─── Issue #58: 422 for not-applicable stage ───────────────────────────────


def test_run_stage_route_422_for_not_applicable_stage(
    seeded_client: tuple[TestClient, Settings],
) -> None:
    """POST to run a stage whose current status is `not-applicable` returns 422.

    B5 §1.1: uses v2 stage ID (grayscale). The stage is seeded as not-applicable
    for this page, so the route returns 422 with a not-applicable message.
    """
    client, settings = seeded_client

    async def _mark_not_applicable() -> None:
        db = SqliteDatabase(settings.derived_database_url)
        await db.initialize()
        try:
            await db.init_page_stages_for_page("m2s4", "0000")
            await db.put_page_stage(
                PageStageState(
                    project_id="m2s4",
                    page_id="0000",
                    stage_id="grayscale",
                    status=PageStageStatus.not_applicable,
                )
            )
        finally:
            await db.close()

    asyncio.run(_mark_not_applicable())

    r = client.post("/api/data/projects/m2s4/pages/0/stages/grayscale/run")
    assert r.status_code == 422, r.text
    assert "not-applicable" in r.text.lower()
