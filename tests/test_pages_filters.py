"""Tests-first for the lesser-used `GET /projects/{id}/pages` query filters.

`review_needed=true` is already tested in test_review_queue.py; this file
covers the rest:
  - `page_type=blank` returns only blank pages,
  - `has_splits=true` returns only pages with at least one split,
  - `status=error` returns only pages whose processing_status is error,
  - `review_needed=false` returns only pages that DON'T need review,
  - the response's `total` reflects the filtered count when any filter is set,
    and the unfiltered list count when none is.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime

from fastapi.testclient import TestClient

from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pdomain_prep_for_pgdp.bootstrap import build_app
from pdomain_prep_for_pgdp.core.models import (
    PageOutput,
    PageProcessingStatus,
    PageRecord,
    PageSplit,
    PageType,
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


def _seed(settings: Settings) -> None:
    """Project pf1 with 5 pages: normal/blank/normal/with-splits/with-error."""

    async def go() -> None:
        db = SqliteDatabase(settings.derived_database_url)
        await db.initialize()
        now = datetime.now(UTC)
        await db.put_project(
            Project(
                id="pf1",
                owner_id="default",
                name="t",
                created_at=now,
                updated_at=now,
                status=ProjectStatus.processing,
                page_count=5,
                proof_page_count=5,
                config=ProjectConfig(book_name="t", source_uri=""),
                pipeline_state=PipelineState(),
                storage_prefix="projects/pf1/",
            )
        )
        await db.put_pages(
            [
                PageRecord(
                    project_id="pf1",
                    idx0=0,
                    prefix="p001",
                    source_stem="p1",
                    page_type=PageType.normal,
                ),
                PageRecord(
                    project_id="pf1",
                    idx0=1,
                    prefix="p002",
                    source_stem="p2",
                    page_type=PageType.blank,
                ),
                PageRecord(
                    project_id="pf1",
                    idx0=2,
                    prefix="p003",
                    source_stem="p3",
                    page_type=PageType.normal,
                    outputs=[
                        PageOutput(
                            full_prefix="p003",
                            split_suffix=None,
                            reading_order=0,
                            ocr_status=PageProcessingStatus.complete,
                        )
                    ],
                ),
                PageRecord(
                    project_id="pf1",
                    idx0=3,
                    prefix="p004",
                    source_stem="p4",
                    page_type=PageType.normal,
                    splits=[PageSplit(suffix="a", x_pct=50, reading_order=0)],
                ),
                PageRecord(
                    project_id="pf1",
                    idx0=4,
                    prefix="p005",
                    source_stem="p5",
                    page_type=PageType.normal,
                    processing_status=PageProcessingStatus.error,
                ),
            ]
        )
        await db.close()

    asyncio.run(go())


def test_filter_by_page_type_blank(tmp_path) -> None:
    settings = _settings(tmp_path)
    _seed(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/data/projects/pf1/pages?page_type=blank")
        assert r.status_code == 200
        body = r.json()
        assert body["total"] == 1
        assert [p["idx0"] for p in body["pages"]] == [1]


def test_filter_by_has_splits_true(tmp_path) -> None:
    settings = _settings(tmp_path)
    _seed(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/data/projects/pf1/pages?has_splits=true")
        assert r.status_code == 200
        body = r.json()
        assert body["total"] == 1
        assert [p["idx0"] for p in body["pages"]] == [3]


def test_filter_by_status_error(tmp_path) -> None:
    settings = _settings(tmp_path)
    _seed(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/data/projects/pf1/pages?status=error")
        assert r.status_code == 200
        body = r.json()
        assert body["total"] == 1
        assert [p["idx0"] for p in body["pages"]] == [4]


def test_filter_review_needed_false_excludes_error_pages(tmp_path) -> None:
    settings = _settings(tmp_path)
    _seed(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/data/projects/pf1/pages?review_needed=false&limit=100")
        assert r.status_code == 200
        body = r.json()
        # The error page (idx0=4) should NOT appear; the others should.
        idxs = [p["idx0"] for p in body["pages"]]
        assert 4 not in idxs
        # All other pages: 0/1/2/3.
        assert set(idxs) == {0, 1, 2, 3}


def test_total_reflects_unfiltered_count_when_no_filters(tmp_path) -> None:
    settings = _settings(tmp_path)
    _seed(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/data/projects/pf1/pages?limit=100")
        body = r.json()
        assert body["total"] == 5
        assert len(body["pages"]) == 5
