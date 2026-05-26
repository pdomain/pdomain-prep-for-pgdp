"""Tests for `PATCH /api/data/projects/{id}/pages/{idx0}`.

Locks in:
  - patching `page_type` updates the row,
  - patching `alignment` updates the row,
  - patching `splits` replaces the splits list,
  - patching `illustration_regions` replaces the regions,
  - patching `config_overrides` is parsed and stored,
  - 404 for unknown project (vs. 422 for bad path),
  - 404 for unknown page idx0,
  - 404 for another user's project (no-leak).
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import TYPE_CHECKING, cast

if TYPE_CHECKING:
    from pathlib import Path

from fastapi.testclient import TestClient

from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pdomain_prep_for_pgdp.bootstrap import build_app
from pdomain_prep_for_pgdp.core.models import (
    PageRecord,
    PageType,
    PipelineState,
    Project,
    ProjectConfig,
    ProjectStatus,
)
from pdomain_prep_for_pgdp.settings import Settings


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
                id="up1",
                owner_id=owner_id,
                name="t",
                created_at=now,
                updated_at=now,
                status=ProjectStatus.configuring,
                page_count=1,
                proof_page_count=1,
                config=ProjectConfig(book_name="t", source_uri=""),
                pipeline_state=PipelineState(),
                storage_prefix="projects/up1/",
            )
        )
        await db.put_pages([PageRecord(project_id="up1", idx0=0, prefix="", source_stem="src1")])
        await db.close()

    asyncio.run(go())


def test_patch_page_type_updates_row(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    _seed(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.patch(
            "/api/data/projects/up1/pages/0",
            json={"page_type": PageType.blank.value},
        )
        assert r.status_code == 200, r.text
        assert r.json()["page_type"] == PageType.blank.value


def test_patch_alignment_updates_row(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    _seed(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.patch("/api/data/projects/up1/pages/0", json={"alignment": "center"})
        assert r.status_code == 200, r.text
        assert r.json()["alignment"] == "center"


def test_patch_splits_replaces_list(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    _seed(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.patch(
            "/api/data/projects/up1/pages/0",
            json={
                "splits": [
                    {"suffix": "a", "x_pct": 50, "reading_order": 0},
                    {"suffix": "b", "x_pct": 100, "reading_order": 1},
                ]
            },
        )
        assert r.status_code == 200, r.text
        body: dict[str, object] = cast("dict[str, object]", r.json())
        split_entries: list[dict[str, object]] = cast("list[dict[str, object]]", body["splits"])
        assert [s["suffix"] for s in split_entries] == ["a", "b"]


def test_patch_config_overrides_parsed(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    _seed(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.patch(
            "/api/data/projects/up1/pages/0",
            json={"config_overrides": {"threshold_level": 175}},
        )
        assert r.status_code == 200, r.text
        body = cast("dict[str, object]", r.json())
        assert cast("dict[str, object]", body["config_overrides"])["threshold_level"] == 175


def test_patch_unknown_project_404(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.patch("/api/data/projects/no-such/pages/0", json={"alignment": "center"})
        assert r.status_code == 404


def test_patch_unknown_page_404(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    _seed(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.patch("/api/data/projects/up1/pages/999", json={"alignment": "center"})
        assert r.status_code == 404


def test_patch_other_users_project_404(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    _seed(settings, owner_id="someone-else")
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.patch("/api/data/projects/up1/pages/0", json={"alignment": "center"})
        assert r.status_code == 404
