"""Tests for `GET /api/data/projects/{id}/pages/{idx0}`.

Locks in:
  - returns the PageRecord on the happy path,
  - 404 for unknown project_id,
  - 404 for unknown page idx0,
  - 404 for another user's project (no-leak).

Also covers the `_needs_review` helper's `ocr_error` branch by adding a
filtered listing test that exercises a page whose output has a non-empty
`ocr_error` (status=complete but error present, e.g. word-preservation
validation failed).
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
    PipelineState,
    Project,
    ProjectConfig,
    ProjectStatus,
)
from pdomain_prep_for_pgdp.settings import Settings
from tests.fixtures.seed_pages import seed_pages_in_store


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


def _seed(settings: Settings, owner_id: str = "default") -> None:
    async def go() -> None:
        db = SqliteDatabase(settings.derived_database_url)
        await db.initialize()
        now = datetime.now(UTC)
        await db.put_project(
            Project(
                id="gp1",
                owner_id=owner_id,
                name="t",
                created_at=now,
                updated_at=now,
                status=ProjectStatus.processing,
                page_count=2,
                proof_page_count=2,
                config=ProjectConfig(book_name="t", source_uri=""),
                pipeline_state=PipelineState(),
                storage_prefix="projects/gp1/",
            )
        )
        seed_pages_in_store(
            settings,
            "gp1",
            [
                PageRecord(
                    project_id="gp1",
                    idx0=0,
                    prefix="p001",
                    source_stem="src1",
                    outputs=[
                        # ocr_status=complete BUT ocr_error is set —
                        # _needs_review should return True via the
                        # ocr_error branch (page also needs review).
                        PageOutput(
                            full_prefix="p001",
                            split_suffix=None,
                            reading_order=0,
                            ocr_status=PageProcessingStatus.complete,
                            ocr_error="word-preservation validation failed",
                        )
                    ],
                ),
                # Page 1: clean — no review needed.
                PageRecord(
                    project_id="gp1",
                    idx0=1,
                    prefix="p002",
                    source_stem="src2",
                    outputs=[
                        PageOutput(
                            full_prefix="p002",
                            split_suffix=None,
                            reading_order=0,
                            ocr_status=PageProcessingStatus.complete,
                        )
                    ],
                ),
            ],
        )
        await db.close()

    asyncio.run(go())


def test_get_page_returns_record(tmp_path) -> None:
    settings = _settings(tmp_path)
    _seed(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/data/projects/gp1/pages/0")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["idx0"] == 0
        assert body["prefix"] == "p001"


def test_get_page_404_for_unknown_project(tmp_path) -> None:
    settings = _settings(tmp_path)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/data/projects/no-such/pages/0")
        assert r.status_code == 404


def test_get_page_404_for_unknown_idx(tmp_path) -> None:
    settings = _settings(tmp_path)
    _seed(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/data/projects/gp1/pages/99")
        assert r.status_code == 404


def test_get_page_404_for_other_users_project(tmp_path) -> None:
    settings = _settings(tmp_path)
    _seed(settings, owner_id="someone-else")
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/data/projects/gp1/pages/0")
        assert r.status_code == 404


def test_review_needed_includes_ocr_error_pages(tmp_path) -> None:
    """A page with ocr_status=complete but ocr_error set should appear in
    the review-needed listing — that's the `_needs_review` branch at
    pages.py:96-97."""
    settings = _settings(tmp_path)
    _seed(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/data/projects/gp1/pages?review_needed=true&limit=100")
        assert r.status_code == 200
        body = r.json()
        idxs = sorted(p["idx0"] for p in body["pages"])
        # Page 0 has ocr_error → needs review. Page 1 is clean.
        assert idxs == [0]
