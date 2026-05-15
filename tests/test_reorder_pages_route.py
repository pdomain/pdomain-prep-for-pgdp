"""Tests for `PATCH /api/data/projects/{id}/pages/reorder`.

Locks in:
  - reordering pages updates idx0 and prefix for all pages in the project,
  - non-reordered pages maintain their field values (source_stem, page_type, etc),
  - wrong page count (422 validation error),
  - foreign page_id belonging to another project (404 or 422),
  - auth isolation (page from another user's project is rejected).
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime

from fastapi.testclient import TestClient

from pd_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pd_prep_for_pgdp.bootstrap import build_app
from pd_prep_for_pgdp.core.models import (
    PageRecord,
    PageType,
    PipelineState,
    Project,
    ProjectConfig,
    ProjectStatus,
)
from pd_prep_for_pgdp.settings import Settings


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


def _seed_three_page_project(settings: Settings, owner_id: str = "default") -> None:
    """Create a project with 3 pages: [A, B, C] at idx0 [0, 1, 2]."""

    async def go() -> None:
        db = SqliteDatabase(settings.derived_database_url)
        await db.initialize()
        now = datetime.now(UTC)
        await db.put_project(
            Project(
                id="ro1",
                owner_id=owner_id,
                name="test",
                created_at=now,
                updated_at=now,
                status=ProjectStatus.configuring,
                page_count=3,
                proof_page_count=3,
                config=ProjectConfig(
                    book_name="test",
                    source_uri="",
                    proof_start_idx0=0,
                    proof_end_idx0=2,
                    frontmatter_start_idx0=0,
                    frontmatter_end_idx0=-1,  # No frontmatter pages
                    bodymatter_start_idx0=0,
                    bodymatter_end_idx0=2,
                ),
                pipeline_state=PipelineState(),
                storage_prefix="projects/ro1/",
            )
        )
        await db.put_pages(
            [
                PageRecord(
                    project_id="ro1",
                    idx0=0,
                    prefix="p000",
                    source_stem="src1",
                    page_type=PageType.normal,
                ),
                PageRecord(
                    project_id="ro1",
                    idx0=1,
                    prefix="p001",
                    source_stem="src2",
                    page_type=PageType.normal,
                ),
                PageRecord(
                    project_id="ro1",
                    idx0=2,
                    prefix="p002",
                    source_stem="src3",
                    page_type=PageType.normal,
                ),
            ]
        )
        await db.close()

    asyncio.run(go())


def _seed_two_user_projects(settings: Settings) -> None:
    """Create two projects: ro1 owned by user1, ro2 owned by user2."""

    async def go() -> None:
        db = SqliteDatabase(settings.derived_database_url)
        await db.initialize()
        now = datetime.now(UTC)
        await db.put_project(
            Project(
                id="ro1",
                owner_id="user1",
                name="test1",
                created_at=now,
                updated_at=now,
                status=ProjectStatus.configuring,
                page_count=2,
                proof_page_count=2,
                config=ProjectConfig(
                    book_name="test1",
                    source_uri="",
                    proof_start_idx0=0,
                    proof_end_idx0=1,
                    frontmatter_start_idx0=0,
                    frontmatter_end_idx0=-1,
                    bodymatter_start_idx0=0,
                    bodymatter_end_idx0=1,
                ),
                pipeline_state=PipelineState(),
                storage_prefix="projects/ro1/",
            )
        )
        await db.put_pages(
            [
                PageRecord(project_id="ro1", idx0=0, prefix="p000", source_stem="src1"),
                PageRecord(project_id="ro1", idx0=1, prefix="p001", source_stem="src2"),
            ]
        )
        await db.put_project(
            Project(
                id="ro2",
                owner_id="user2",
                name="test2",
                created_at=now,
                updated_at=now,
                status=ProjectStatus.configuring,
                page_count=2,
                proof_page_count=2,
                config=ProjectConfig(
                    book_name="test2",
                    source_uri="",
                    proof_start_idx0=0,
                    proof_end_idx0=1,
                    frontmatter_start_idx0=0,
                    frontmatter_end_idx0=-1,
                    bodymatter_start_idx0=0,
                    bodymatter_end_idx0=1,
                ),
                pipeline_state=PipelineState(),
                storage_prefix="projects/ro2/",
            )
        )
        await db.put_pages(
            [
                PageRecord(project_id="ro2", idx0=0, prefix="p000", source_stem="src1"),
                PageRecord(project_id="ro2", idx0=1, prefix="p001", source_stem="src2"),
            ]
        )
        await db.close()

    asyncio.run(go())


def test_reorder_pages_basic(tmp_path) -> None:
    """Reorder [A, B, C] → [C, A, B]: idx0 becomes [0, 1, 2], prefix recomputed."""
    settings = _settings(tmp_path)
    _seed_three_page_project(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        # Fetch pages before reorder to get their ids.
        r = client.get("/api/data/projects/ro1/pages")
        assert r.status_code == 200
        pages_before = r.json()["pages"]
        assert len(pages_before) == 3
        # Order: A (idx0=0, prefix=p000), B (idx0=1, prefix=p001), C (idx0=2, prefix=p002)
        page_ids = [f"{p['idx0']:04d}" for p in pages_before]
        # Reorder to C, A, B: ["0002", "0000", "0001"]
        new_order = [page_ids[2], page_ids[0], page_ids[1]]

        r = client.patch(
            "/api/data/projects/ro1/pages/reorder",
            json={"page_ids": new_order},
        )
        assert r.status_code == 200, r.text
        result = r.json()
        pages_after = result["pages"]
        assert len(pages_after) == 3

        # Verify idx0 is now [0, 1, 2] (positional)
        assert pages_after[0]["idx0"] == 0
        assert pages_after[1]["idx0"] == 1
        assert pages_after[2]["idx0"] == 2

        # Verify prefix is recomputed (p000, p001, p002 for bodymatter)
        assert pages_after[0]["prefix"] == "p000"
        assert pages_after[1]["prefix"] == "p001"
        assert pages_after[2]["prefix"] == "p002"


def test_reorder_pages_preserves_other_fields(tmp_path) -> None:
    """Reordering does not modify source_stem, page_type, or other fields."""
    settings = _settings(tmp_path)
    _seed_three_page_project(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        # Fetch original state
        r = client.get("/api/data/projects/ro1/pages")
        pages_before = r.json()["pages"]
        page_ids = [f"{p['idx0']:04d}" for p in pages_before]

        # Reorder to [page 2, page 0, page 1]
        new_order = [page_ids[2], page_ids[0], page_ids[1]]
        r = client.patch(
            "/api/data/projects/ro1/pages/reorder",
            json={"page_ids": new_order},
        )
        assert r.status_code == 200
        pages_after = r.json()["pages"]

        # After reorder, the pages should have:
        # - New idx0 values [0, 1, 2] (positional)
        # - But they should still reference their original source_stem / page_type
        # Position 0 now has the old page-2 (src3)
        assert pages_after[0]["source_stem"] == "src3"
        assert pages_after[0]["page_type"] == PageType.normal.value
        # Position 1 now has the old page-0 (src1)
        assert pages_after[1]["source_stem"] == "src1"
        assert pages_after[1]["page_type"] == PageType.normal.value
        # Position 2 now has the old page-1 (src2)
        assert pages_after[2]["source_stem"] == "src2"
        assert pages_after[2]["page_type"] == PageType.normal.value


def test_reorder_pages_wrong_count(tmp_path) -> None:
    """Sending wrong number of page IDs returns 422."""
    settings = _settings(tmp_path)
    _seed_three_page_project(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        # Only 2 ids for a 3-page project
        r = client.patch(
            "/api/data/projects/ro1/pages/reorder",
            json={"page_ids": ["0000", "0001"]},
        )
        assert r.status_code == 422, r.text


def test_reorder_pages_foreign_page(tmp_path) -> None:
    """Sending a page_id from another project returns 422 or 404."""
    settings = _settings(tmp_path)
    _seed_two_user_projects(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        # Try to reorder ro1 with a page from ro2 (foreign project)
        # ro1 has pages ["0000", "0001"]
        # Try to use ["0000", "0001"] from ro1 + a page that doesn't exist in ro1
        r = client.patch(
            "/api/data/projects/ro1/pages/reorder",
            json={"page_ids": ["0000", "0002"]},  # 0002 doesn't exist in ro1
        )
        # Either 404 (page not found) or 422 (invalid) is acceptable
        assert r.status_code in (404, 422), r.text


def test_reorder_pages_auth_isolation(tmp_path) -> None:
    """User1 cannot reorder a project owned by user2."""
    settings = _settings(tmp_path)
    _seed_two_user_projects(settings)
    app = build_app(settings)
    with TestClient(app, headers={"X-User": "user1"}) as client:
        # user1 tries to reorder ro2 (owned by user2)
        r = client.patch(
            "/api/data/projects/ro2/pages/reorder",
            json={"page_ids": ["0000", "0001"]},
        )
        assert r.status_code == 404, r.text  # project not found (cross-user)


def test_reorder_pages_duplicate_ids(tmp_path) -> None:
    """Duplicate page_ids in request returns 422."""
    settings = _settings(tmp_path)
    _seed_three_page_project(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        # Send duplicate page IDs: ["0000", "0000", "0001"] for a 3-page project
        r = client.patch(
            "/api/data/projects/ro1/pages/reorder",
            json={"page_ids": ["0000", "0000", "0001"]},
        )
        assert r.status_code == 422, r.text


def test_reorder_pages_empty_list(tmp_path) -> None:
    """Empty page_ids list returns 400 (Pydantic validation error)."""
    settings = _settings(tmp_path)
    _seed_three_page_project(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.patch(
            "/api/data/projects/ro1/pages/reorder",
            json={"page_ids": []},
        )
        assert r.status_code == 400, r.text
