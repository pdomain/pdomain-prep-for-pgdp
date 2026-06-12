"""Tests for the reverse-split (unsplit) endpoint.

Issue #56: Splits workbench page-list + reverse-split UI.

Spec: docs/specs/pipeline-task-model.md §"Splits as sibling pages".
Acceptance:
- DELETE /projects/{project_id}/pages/{idx0}/split on a split-child
  deletes all sibling child rows, deletes their page_stages rows, and
  returns the parent page unchanged.
- The parent is NOT a split-child, so it remains visible in list_pages.
- Calling unsplit on a root page returns 422.
- Calling unsplit on a non-existent page returns 404.
- After unsplit, orphaned on-disk stage artifacts become visible to
  ``pgdp-prep reindex --heal`` because the page_stages rows are gone.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime

from fastapi.testclient import TestClient

from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pdomain_prep_for_pgdp.bootstrap import build_app
from pdomain_prep_for_pgdp.core.models import (
    PageRecord,
    PageStageState,
    PageStageStatus,
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


def _seed(settings: Settings) -> None:
    """Seed project us1 with one parent page (idx0=0) and two children (idx0=1, idx0=2)."""

    async def go() -> None:
        db = SqliteDatabase(settings.derived_database_url)
        await db.initialize()
        now = datetime.now(UTC)
        await db.put_project(
            Project(
                id="us1",
                owner_id="default",
                name="unsplit-test",
                created_at=now,
                updated_at=now,
                status=ProjectStatus.processing,
                page_count=3,
                proof_page_count=2,
                config=ProjectConfig(book_name="us1", source_uri=""),
                storage_prefix="projects/us1/",
            )
        )
        seed_pages_in_store(
            settings,
            "us1",
            [
                # Root parent page
                PageRecord(
                    project_id="us1",
                    idx0=0,
                    prefix="f001",
                    source_stem="img_001",
                ),
                # Split child 1
                PageRecord(
                    project_id="us1",
                    idx0=1,
                    prefix="f001a",
                    source_stem="img_001",
                    parent_page_id="0000",
                    source_crop_bbox=(0, 0, 500, 1000),
                    split_index=1,
                    split_at_stage="auto_deskew",
                    split_suffix="a",
                    reading_order=0,
                ),
                # Split child 2
                PageRecord(
                    project_id="us1",
                    idx0=2,
                    prefix="f001b",
                    source_stem="img_001",
                    parent_page_id="0000",
                    source_crop_bbox=(500, 0, 500, 1000),
                    split_index=2,
                    split_at_stage="auto_deskew",
                    split_suffix="b",
                    reading_order=1,
                ),
            ],
        )
        # Add a fake page_stages row for child 1 so we can verify it's deleted.
        await db.put_page_stage(
            PageStageState(
                project_id="us1",
                page_id="0001",
                stage_id="decode_source",
                status=PageStageStatus.clean,
                stage_version=1,
            )
        )
        await db.close()

    asyncio.run(go())


def test_unsplit_returns_parent_page(tmp_path) -> None:
    """DELETE .../pages/1/split returns the parent page (idx0=0)."""
    settings = _settings(tmp_path)
    _seed(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.delete("/api/data/projects/us1/pages/1/split")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["idx0"] == 0
        assert body["prefix"] == "f001"
        assert body["parent_page_id"] is None


def test_unsplit_deletes_both_siblings(tmp_path) -> None:
    """After unsplit, neither child appears in list_pages."""
    settings = _settings(tmp_path)
    _seed(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        client.delete("/api/data/projects/us1/pages/1/split")
        r = client.get("/api/data/projects/us1/pages?limit=100")
        assert r.status_code == 200
        idxs = [p["idx0"] for p in r.json()["pages"]]
        assert 1 not in idxs
        assert 2 not in idxs


def test_unsplit_parent_still_visible(tmp_path) -> None:
    """After unsplit, the parent page (idx0=0) remains in list_pages."""
    settings = _settings(tmp_path)
    _seed(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        client.delete("/api/data/projects/us1/pages/1/split")
        r = client.get("/api/data/projects/us1/pages?limit=100")
        idxs = [p["idx0"] for p in r.json()["pages"]]
        assert 0 in idxs


def test_unsplit_deletes_page_stages_rows(tmp_path) -> None:
    """After unsplit, the children's page_stages rows are gone (orphan detection ready)."""
    settings = _settings(tmp_path)
    _seed(settings)

    async def check() -> list[PageStageState]:
        db = SqliteDatabase(settings.derived_database_url)
        await db.initialize()
        rows = await db.list_page_stages_for_page("us1", "0001")
        await db.close()
        return rows

    app = build_app(settings)
    with TestClient(app) as client:
        client.delete("/api/data/projects/us1/pages/1/split")

    remaining = asyncio.run(check())
    assert remaining == []


def test_unsplit_422_for_root_page(tmp_path) -> None:
    """Calling unsplit on a root (non-split-child) page returns 422."""
    settings = _settings(tmp_path)
    _seed(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.delete("/api/data/projects/us1/pages/0/split")
        assert r.status_code == 422


def test_unsplit_404_for_missing_page(tmp_path) -> None:
    """Calling unsplit on a page that doesn't exist returns 404."""
    settings = _settings(tmp_path)
    _seed(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.delete("/api/data/projects/us1/pages/99/split")
        assert r.status_code == 404


def test_unsplit_404_for_missing_project(tmp_path) -> None:
    """Calling unsplit on a project that doesn't exist returns 404."""
    settings = _settings(tmp_path)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.delete("/api/data/projects/no-such/pages/1/split")
        assert r.status_code == 404
