"""Tests-first for the project-level review queue.

A reviewer needs to see every page that still has work pending — pages
where the OCR text differs from the source, where reorganization dropped
words, or where processing errored. The page-list endpoint already
supports filtering, but spec 03 calls for a dedicated review queue too.

Locks in:
  - `GET /api/data/projects/{id}/pages?review_needed=true` returns only
    pages where any output's `ocr_status != complete` OR any output has
    a non-empty `ocr_error`,
  - the `total` field reflects the filtered count (so the UI can show
    "3 of 400 pages need review"),
  - default behavior (no filter) is unchanged.
"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi.testclient import TestClient

from pdomain_prep_for_pgdp.bootstrap import build_app
from pdomain_prep_for_pgdp.core.models import (
    PageOutput,
    PageProcessingStatus,
    PageRecord,
    PipelineState,
    Project,
    ProjectConfig,
    ProjectStatus,
)
from pdomain_prep_for_pgdp.settings import Settings


def _settings(tmp_path) -> Settings:
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


def _seed(settings: Settings, project_id: str = "rq1") -> None:
    """Create a project + 4 pages: 2 complete, 1 errored, 1 still pending."""
    import asyncio

    async def go() -> None:
        from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase

        db = SqliteDatabase(settings.derived_database_url)
        await db.initialize()
        now = datetime.now(UTC)
        project = Project(
            id=project_id,
            owner_id="default",
            name="t",
            created_at=now,
            updated_at=now,
            status=ProjectStatus.reviewing,
            page_count=4,
            proof_page_count=4,
            config=ProjectConfig(book_name="t", source_uri=""),
            pipeline_state=PipelineState(),
            storage_prefix=f"projects/{project_id}/",
        )
        await db.put_project(project)
        pages = [
            PageRecord(
                project_id=project_id,
                idx0=0,
                prefix="p001",
                source_stem="s0",
                outputs=[
                    PageOutput(
                        full_prefix="p001",
                        split_suffix=None,
                        reading_order=0,
                        ocr_status=PageProcessingStatus.complete,
                    )
                ],
            ),
            PageRecord(
                project_id=project_id,
                idx0=1,
                prefix="p002",
                source_stem="s1",
                outputs=[
                    PageOutput(
                        full_prefix="p002",
                        split_suffix=None,
                        reading_order=0,
                        ocr_status=PageProcessingStatus.complete,
                    )
                ],
            ),
            PageRecord(
                project_id=project_id,
                idx0=2,
                prefix="p003",
                source_stem="s2",
                outputs=[
                    PageOutput(
                        full_prefix="p003",
                        split_suffix=None,
                        reading_order=0,
                        ocr_status=PageProcessingStatus.error,
                        ocr_error="DocTR returned no words",
                    )
                ],
            ),
            PageRecord(
                project_id=project_id,
                idx0=3,
                prefix="p004",
                source_stem="s3",
                outputs=[
                    PageOutput(
                        full_prefix="p004",
                        split_suffix=None,
                        reading_order=0,
                        ocr_status=PageProcessingStatus.pending,
                    )
                ],
            ),
        ]
        await db.put_pages(pages)
        await db.close()

    asyncio.run(go())


def test_review_needed_filter_returns_only_incomplete_pages(tmp_path) -> None:
    settings = _settings(tmp_path)
    _seed(settings)
    app = build_app(settings)

    with TestClient(app) as client:
        r = client.get("/api/data/projects/rq1/pages?review_needed=true&limit=100")
        assert r.status_code == 200, r.text
        body = r.json()
        idxs = sorted(p["idx0"] for p in body["pages"])
        assert idxs == [2, 3]
        assert body["total"] == 2


def test_review_needed_false_keeps_existing_behavior(tmp_path) -> None:
    settings = _settings(tmp_path)
    _seed(settings)
    app = build_app(settings)

    with TestClient(app) as client:
        r = client.get("/api/data/projects/rq1/pages?limit=100")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["total"] == 4
