"""W0.5 — text_zones APPLY_SPLIT body matches SplitPageRequest.

Issue: docs/issues/2026-07-21-w05-text-zones-split-contract.md
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
from fastapi.testclient import TestClient

from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pdomain_prep_for_pgdp.bootstrap import build_app
from pdomain_prep_for_pgdp.core.models import (
    PageProcessingStatus,
    PageRecord,
    Project,
    ProjectConfig,
    ProjectStatus,
)
from pdomain_prep_for_pgdp.core.page_service_helpers import update_page_extension
from pdomain_prep_for_pgdp.core.page_store_factory import build_page_service
from pdomain_prep_for_pgdp.settings import Settings
from tests.fixtures.seed_pages import seed_pages_in_store


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


def _png(h: int = 100, w: int = 200) -> bytes:
    import cv2

    img = np.full((h, w, 3), 220, dtype=np.uint8)
    ok, buf = cv2.imencode(".png", img)
    assert ok
    return bytes(buf.tobytes())


def _seed_with_source(settings: Settings, project_id: str = "tz1") -> None:
    async def go() -> None:
        db = SqliteDatabase(settings.derived_database_url)
        await db.initialize()
        now = datetime.now(UTC)
        await db.put_project(
            Project(
                id=project_id,
                owner_id="default",
                name=project_id,
                created_at=now,
                updated_at=now,
                status=ProjectStatus.processing,
                page_count=1,
                proof_page_count=1,
                config=ProjectConfig(book_name=project_id, source_uri=""),
                storage_prefix=f"projects/{project_id}/",
                registry_version=3,
            )
        )
        await db.close()

    asyncio.run(go())
    seed_pages_in_store(
        settings,
        project_id,
        [
            PageRecord(
                project_id=project_id,
                idx0=0,
                prefix="p001",
                source_stem="src0",
                processing_status=PageProcessingStatus.pending,
            )
        ],
    )
    svc = build_page_service(settings.data_root, project_id)
    blob_hash = svc.blobs.write(_png(100, 200))
    update_page_extension(svc, project_id, 0, source_blob_hash=blob_hash)


def test_legacy_bbox_body_still_works(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    _seed_with_source(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post(
            "/api/data/projects/tz1/pages/0/split",
            json={
                "bbox": [0, 0, 100, 100],
                "split_at_stage": "text_zones",
                "suffixes": ["a", "b"],
            },
        )
        assert r.status_code == 200, r.text
        assert len(r.json()["children"]) == 2


def test_fe_shaped_normalized_bboxes_body_succeeds(tmp_path: Path) -> None:
    """Body shape that textZonesTool.applySplit actually posts (W0.5)."""
    settings = _settings(tmp_path)
    _seed_with_source(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post(
            "/api/data/projects/tz1/pages/0/split",
            json={
                "suffixes": ["a", "b"],
                "bboxes": [[0, 0, 0.5, 1], [0.5, 0, 0.5, 1]],
                "split_at_stage": "text_zones",
                "normalized": True,
            },
        )
        assert r.status_code == 200, r.text
        children = r.json()["children"]
        assert len(children) == 2
        # Pixel conversion of 0.5 * 200 width → 100
        assert children[0]["source_crop_bbox"] == [0, 0, 100, 100]
        assert children[1]["source_crop_bbox"] == [100, 0, 100, 100]
        assert children[0]["split_at_stage"] == "text_zones"
        assert children[0]["split_suffix"] == "a"
        assert children[1]["split_suffix"] == "b"


def test_old_fe_body_without_split_at_stage_still_422(tmp_path: Path) -> None:
    """Regression: the pre-W0.5 FE body must not silently succeed."""
    settings = _settings(tmp_path)
    _seed_with_source(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post(
            "/api/data/projects/tz1/pages/0/split",
            json={
                "suffixes": ["a", "b"],
                "bboxes": [[0, 0, 0.5, 1], [0.5, 0, 0.5, 1]],
            },
        )
        # FastAPI may return 422 (validation) or 400 depending on error path.
        assert r.status_code in {400, 422}
