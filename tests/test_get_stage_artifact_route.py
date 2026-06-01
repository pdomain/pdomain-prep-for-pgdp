"""M2 — `GET /api/data/projects/{id}/pages/{idx0}/stages/{stage_id}/artifact`.

Spec: `docs/specs/pipeline-task-model.md` §"API surface" (§Per-page stage
routes). The artifact GET lets the workbench (and direct-link users)
fetch the on-disk bytes a stage produced. M2 ships the minimal
single-file shape — image_bytes / image / gray / binary all serve as
`image/png`; later stages add `text/plain` / `application/json` based
on `Stage.output_type`.

Status code mapping:

- 200: row exists, status is `clean`, file exists at canonical path.
  Body is the raw bytes; Content-Type matches output_type; ETag
  header echoes `input_hash` so the browser can revalidate cheaply.
- 404: project not found OR cross-user OR row's status is not `clean`
  OR the file is missing on disk (drift; reconciler will catch).
- 422: unknown stage_id (validated against PAGE_STAGE_IDS).
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
    PipelineState,
    Project,
    ProjectConfig,
    ProjectStatus,
)
from pdomain_prep_for_pgdp.core.pipeline.page_stage_writer import commit_stage_artifact
from pdomain_prep_for_pgdp.settings import Settings
from tests.fixtures.seed_pages import seed_pages_in_store

if TYPE_CHECKING:
    from collections.abc import Iterator
    from pathlib import Path


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


def _seed_project(settings: Settings, owner_id: str = "default") -> None:
    async def go() -> None:
        db = SqliteDatabase(settings.derived_database_url)
        await db.initialize()
        now = datetime.now(UTC)
        await db.put_project(
            Project(
                id="m2art",
                owner_id=owner_id,
                name="m2art",
                created_at=now,
                updated_at=now,
                status=ProjectStatus.processing,
                page_count=1,
                proof_page_count=1,
                config=ProjectConfig(book_name="m2art", source_uri=""),
                pipeline_state=PipelineState(),
                storage_prefix="projects/m2art/",
            )
        )
        seed_pages_in_store(
            settings,
            "m2art",
            [
                PageRecord(
                    project_id="m2art",
                    idx0=0,
                    prefix="p001",
                    source_stem="src1",
                    processing_status=PageProcessingStatus.pending,
                ),
            ],
        )
        await db.close()

    asyncio.run(go())


def _checkerboard_bgr_png() -> bytes:
    img = np.zeros((20, 20, 3), dtype=np.uint8)
    img[::2, ::2] = (200, 200, 200)
    img[1::2, 1::2] = (200, 200, 200)
    ok, buf = cv2.imencode(".png", img)
    assert ok
    return bytes(buf.tobytes())


async def _seed_clean_stage(
    settings: Settings,
    project_id: str,
    page_id: str,
    stage_id: str,
    payload: bytes,
) -> str:
    """Seed one stage row + on-disk artifact via the canonical writer.

    Returns the row's `input_hash` so tests can assert the ETag echoes it.
    """
    db = SqliteDatabase(settings.derived_database_url)
    await db.initialize()
    try:
        await db.init_page_stages_for_page(project_id, page_id)
        state = await commit_stage_artifact(
            data_root=settings.data_root,
            database=db,
            project_id=project_id,
            page_id=page_id,
            stage_id=stage_id,
            artifact_bytes=payload,
        )
        assert state.input_hash is not None
        return state.input_hash
    finally:
        await db.close()


@pytest.fixture
def seeded_client(tmp_path: Path) -> Iterator[tuple[TestClient, Settings]]:
    settings = _settings(tmp_path)
    _seed_project(settings)
    app = build_app(settings)
    with TestClient(app) as c:
        yield c, settings


# ─── Happy path: 200 with bytes + content-type + ETag ──────────────────────


def test_get_artifact_returns_bytes_with_image_content_type(
    seeded_client: tuple[TestClient, Settings],
) -> None:
    """A clean image-typed stage serves its bytes verbatim with image/png."""
    client, settings = seeded_client
    payload = _checkerboard_bgr_png()
    asyncio.run(_seed_clean_stage(settings, "m2art", "0000", "grayscale", payload))

    r = client.get("/api/data/projects/m2art/pages/0/stages/grayscale/artifact")
    assert r.status_code == 200, r.text
    assert r.content == payload
    assert r.headers["content-type"].startswith("image/png")


def test_get_artifact_etag_matches_input_hash(
    seeded_client: tuple[TestClient, Settings],
) -> None:
    """The response carries an ETag header so the browser can revalidate."""
    client, settings = seeded_client
    payload = _checkerboard_bgr_png()
    input_hash = asyncio.run(_seed_clean_stage(settings, "m2art", "0000", "threshold", payload))

    r = client.get("/api/data/projects/m2art/pages/0/stages/threshold/artifact")
    assert r.status_code == 200, r.text
    etag = r.headers.get("etag")
    assert etag is not None
    # ETag must be wrapped per RFC 7232 (quoted) and echo the row's hash.
    assert input_hash in etag


def test_get_artifact_conditional_returns_304_when_etag_matches(
    seeded_client: tuple[TestClient, Settings],
) -> None:
    """Browser revalidation: If-None-Match equal to current ETag returns 304."""
    client, settings = seeded_client
    payload = _checkerboard_bgr_png()
    asyncio.run(_seed_clean_stage(settings, "m2art", "0000", "invert", payload))

    r1 = client.get("/api/data/projects/m2art/pages/0/stages/invert/artifact")
    etag = r1.headers["etag"]

    r2 = client.get(
        "/api/data/projects/m2art/pages/0/stages/invert/artifact",
        headers={"If-None-Match": etag},
    )
    assert r2.status_code == 304


# ─── 404 paths ─────────────────────────────────────────────────────────────


def test_get_artifact_404_when_status_not_clean(
    seeded_client: tuple[TestClient, Settings],
) -> None:
    """A row that exists but isn't `clean` (e.g. not-run) has no artifact yet.

    Lazy-init creates 22 not-run rows via list_page_stages; querying
    artifact for any of them must 404 rather than serving stale bytes.
    """
    client, _ = seeded_client
    # Trigger lazy-init so the rows exist as `not-run`.
    client.get("/api/data/projects/m2art/pages/0/stages")

    r = client.get("/api/data/projects/m2art/pages/0/stages/grayscale/artifact")
    assert r.status_code == 404


def test_get_artifact_404_for_unknown_project(
    seeded_client: tuple[TestClient, Settings],
) -> None:
    client, _ = seeded_client
    r = client.get("/api/data/projects/nope/pages/0/stages/grayscale/artifact")
    assert r.status_code == 404


def test_get_artifact_404_for_unknown_page(
    seeded_client: tuple[TestClient, Settings],
) -> None:
    client, _ = seeded_client
    r = client.get("/api/data/projects/m2art/pages/99/stages/grayscale/artifact")
    assert r.status_code == 404


def test_get_artifact_404_for_other_users_project(tmp_path: Path) -> None:
    """Non-owner sees 404 (not 403) — pattern matches list_page_stages."""
    settings = _settings(tmp_path)
    _seed_project(settings, owner_id="someone_else")
    payload = _checkerboard_bgr_png()
    asyncio.run(_seed_clean_stage(settings, "m2art", "0000", "grayscale", payload))
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/data/projects/m2art/pages/0/stages/grayscale/artifact")
        assert r.status_code == 404


# ─── 422 / unknown stage_id ────────────────────────────────────────────────


def test_get_artifact_422_for_unknown_stage_id(
    seeded_client: tuple[TestClient, Settings],
) -> None:
    """Unknown stage_id is rejected at the route layer (matches POST /run)."""
    client, _ = seeded_client
    r = client.get("/api/data/projects/m2art/pages/0/stages/not_a_real_stage/artifact")
    assert r.status_code == 422
