"""Tests for `POST /api/data/projects/{id}/pages/{idx0}/split`.

Acceptance (from issue #52):
- POSTing {bbox, split_at_stage, suffixes} creates N child page rows visible in
  the project page list.
- Each child row has the six split columns correctly populated.
- Existing single-page pipeline tests still pass (covered by fast-check).
- Recursive splits work (a child can be split into grandchildren).
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime

from fastapi.testclient import TestClient

from pd_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pd_prep_for_pgdp.bootstrap import build_app
from pd_prep_for_pgdp.core.models import (
    PageRecord,
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


def _seed(settings: Settings, owner_id: str = "default", page_count: int = 1) -> None:
    async def go() -> None:
        db = SqliteDatabase(settings.derived_database_url)
        await db.initialize()
        now = datetime.now(UTC)
        await db.put_project(
            Project(
                id="sp1",
                owner_id=owner_id,
                name="t",
                created_at=now,
                updated_at=now,
                status=ProjectStatus.configuring,
                page_count=page_count,
                proof_page_count=page_count,
                config=ProjectConfig(book_name="t", source_uri=""),
                pipeline_state=PipelineState(),
                storage_prefix="projects/sp1/",
            )
        )
        pages = [
            PageRecord(
                project_id="sp1",
                idx0=i,
                prefix=f"f{i + 1:03d}",
                source_stem=f"img_{i:04d}",
            )
            for i in range(page_count)
        ]
        await db.put_pages(pages)
        await db.close()

    asyncio.run(go())


# ─── Happy path: basic split creates 2 children ──────────────────────────────


def test_split_creates_two_children(tmp_path) -> None:
    """POST /split with 2 suffixes creates 2 child page rows."""
    settings = _settings(tmp_path)
    _seed(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post(
            "/api/data/projects/sp1/pages/0/split",
            json={
                "bbox": [0, 0, 300, 400],
                "split_at_stage": "auto_detect_attrs",
                "suffixes": ["a", "b"],
            },
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "children" in body
        assert len(body["children"]) == 2


def test_split_children_have_correct_split_columns(tmp_path) -> None:
    """Each split-child row has the six split columns populated correctly."""
    settings = _settings(tmp_path)
    _seed(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post(
            "/api/data/projects/sp1/pages/0/split",
            json={
                "bbox": [10, 20, 300, 400],
                "split_at_stage": "auto_detect_attrs",
                "suffixes": ["a", "b"],
            },
        )
        assert r.status_code == 200, r.text
        children = r.json()["children"]

        # parent_page_id — both children point at parent's page_id ("0000")
        assert children[0]["parent_page_id"] == "0000"
        assert children[1]["parent_page_id"] == "0000"

        # source_crop_bbox — same bbox for all children (they read the same source)
        assert children[0]["source_crop_bbox"] == [10, 20, 300, 400]
        assert children[1]["source_crop_bbox"] == [10, 20, 300, 400]

        # split_index — 1-based
        assert children[0]["split_index"] == 1
        assert children[1]["split_index"] == 2

        # split_at_stage
        assert children[0]["split_at_stage"] == "auto_detect_attrs"
        assert children[1]["split_at_stage"] == "auto_detect_attrs"

        # split_suffix
        assert children[0]["split_suffix"] == "a"
        assert children[1]["split_suffix"] == "b"

        # reading_order — 0-based among created siblings
        assert children[0]["reading_order"] == 0
        assert children[1]["reading_order"] == 1


def test_split_children_visible_in_page_list(tmp_path) -> None:
    """Children created by /split appear in GET /pages."""
    settings = _settings(tmp_path)
    _seed(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        client.post(
            "/api/data/projects/sp1/pages/0/split",
            json={
                "bbox": [0, 0, 300, 400],
                "split_at_stage": "auto_detect_attrs",
                "suffixes": ["a", "b"],
            },
        )
        r = client.get("/api/data/projects/sp1/pages")
        assert r.status_code == 200, r.text
        pages = r.json()["pages"]
        # original parent + 2 children
        assert len(pages) == 3
        suffixes = [p.get("split_suffix") for p in pages]
        assert "a" in suffixes
        assert "b" in suffixes


def test_split_child_inherits_parent_prefix(tmp_path) -> None:
    """Child prefix = parent prefix + suffix."""
    settings = _settings(tmp_path)
    _seed(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post(
            "/api/data/projects/sp1/pages/0/split",
            json={
                "bbox": [0, 0, 300, 400],
                "split_at_stage": "auto_detect_attrs",
                "suffixes": ["a", "b"],
            },
        )
        children = r.json()["children"]
        assert children[0]["prefix"] == "f001a"
        assert children[1]["prefix"] == "f001b"


# ─── Recursive splits ─────────────────────────────────────────────────────────


def test_recursive_split_creates_grandchildren(tmp_path) -> None:
    """A split-child can itself be split to create grandchildren."""
    settings = _settings(tmp_path)
    _seed(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        # First split: parent page 0 → children at idx0 1, 2
        r1 = client.post(
            "/api/data/projects/sp1/pages/0/split",
            json={
                "bbox": [0, 0, 300, 400],
                "split_at_stage": "auto_detect_attrs",
                "suffixes": ["a", "b"],
            },
        )
        assert r1.status_code == 200, r1.text
        child_a_idx0 = r1.json()["children"][0]["idx0"]

        # Second split: split the first child
        r2 = client.post(
            f"/api/data/projects/sp1/pages/{child_a_idx0}/split",
            json={
                "bbox": [0, 0, 150, 400],
                "split_at_stage": "auto_deskew",
                "suffixes": ["i", "ii"],
            },
        )
        assert r2.status_code == 200, r2.text
        grandchildren = r2.json()["children"]
        assert len(grandchildren) == 2

        # Grandchildren point at the child (not the original root)
        expected_parent_id = f"{child_a_idx0:04d}"
        assert grandchildren[0]["parent_page_id"] == expected_parent_id
        assert grandchildren[1]["parent_page_id"] == expected_parent_id

        # Grandchildren have their own split fields
        assert grandchildren[0]["split_suffix"] == "i"
        assert grandchildren[1]["split_suffix"] == "ii"


# ─── Error cases ──────────────────────────────────────────────────────────────


def test_split_unknown_project_404(tmp_path) -> None:
    settings = _settings(tmp_path)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post(
            "/api/data/projects/no-such/pages/0/split",
            json={"bbox": [0, 0, 300, 400], "split_at_stage": "auto_detect_attrs", "suffixes": ["a"]},
        )
        assert r.status_code == 404


def test_split_unknown_page_404(tmp_path) -> None:
    settings = _settings(tmp_path)
    _seed(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post(
            "/api/data/projects/sp1/pages/999/split",
            json={"bbox": [0, 0, 300, 400], "split_at_stage": "auto_detect_attrs", "suffixes": ["a"]},
        )
        assert r.status_code == 404


def test_split_other_users_project_404(tmp_path) -> None:
    settings = _settings(tmp_path)
    _seed(settings, owner_id="someone-else")
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post(
            "/api/data/projects/sp1/pages/0/split",
            json={"bbox": [0, 0, 300, 400], "split_at_stage": "auto_detect_attrs", "suffixes": ["a"]},
        )
        assert r.status_code == 404


def test_split_unknown_stage_422(tmp_path) -> None:
    """An unknown split_at_stage returns 422."""
    settings = _settings(tmp_path)
    _seed(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post(
            "/api/data/projects/sp1/pages/0/split",
            json={"bbox": [0, 0, 300, 400], "split_at_stage": "no_such_stage", "suffixes": ["a"]},
        )
        assert r.status_code == 422


def test_split_empty_suffixes_422(tmp_path) -> None:
    """An empty suffixes list returns 422."""
    settings = _settings(tmp_path)
    _seed(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post(
            "/api/data/projects/sp1/pages/0/split",
            json={"bbox": [0, 0, 300, 400], "split_at_stage": "auto_detect_attrs", "suffixes": []},
        )
        assert r.status_code == 422
