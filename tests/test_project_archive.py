"""Tests for project archive (soft-delete) — P2 #12.

Behavior under test:

- `Project.archived: bool = False` is part of the model and persists round-trip.
- `IDatabase.list_projects()` excludes archived projects by default; pass
  `include_archived=True` to see them.
- `GET /api/data/projects` (the list route) hides archived by default; the
  caller can opt-in with `?include_archived=true`.
- `POST /api/data/projects/{id}/archive` sets `archived=True` (idempotent).
- `POST /api/data/projects/{id}/unarchive` sets `archived=False` (idempotent).
- Both archive endpoints respect ownership (404 for unknown id, 403 for
  wrong owner) and bump `updated_at`.
- Backwards compat: a Project body persisted without an `archived` key
  loads with `archived=False`.
"""

from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pdomain_prep_for_pgdp.bootstrap import build_app
from pdomain_prep_for_pgdp.core.models import (
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


def _make_project(pid: str, *, owner_id: str = "default", archived: bool = False) -> Project:
    now = datetime.now(UTC)
    data: dict = {
        "id": pid,
        "owner_id": owner_id,
        "name": pid,
        "created_at": now,
        "updated_at": now,
        "status": ProjectStatus.complete,
        "page_count": 0,
        "proof_page_count": 0,
        "config": ProjectConfig(book_name=pid, source_uri=""),
        "storage_prefix": f"projects/{pid}/",
    }
    if archived:
        data["archived"] = True
    return Project(**data)


def _seed(settings: Settings, projects: list[Project]) -> None:
    async def go() -> None:
        db = SqliteDatabase(settings.derived_database_url)
        await db.initialize()
        for p in projects:
            await db.put_project(p)
        await db.close()

    asyncio.run(go())


# ── Model -------------------------------------------------------------------


def test_project_model_has_archived_default_false() -> None:
    p = _make_project("m1")
    assert p.archived is False


def test_project_model_serializes_archived_field() -> None:
    p = _make_project("m2", archived=True)
    dumped = p.model_dump()
    assert dumped["archived"] is True


def test_project_model_back_compat_missing_archived_key() -> None:
    """Bodies persisted before the field existed must still parse."""
    now = datetime.now(UTC).isoformat()
    body = {
        "id": "old1",
        "owner_id": "default",
        "name": "old",
        "created_at": now,
        "updated_at": now,
        "status": "complete",
        "page_count": 0,
        "proof_page_count": 0,
        "config": {"book_name": "old", "source_uri": ""},
        "storage_prefix": "projects/old1/",
        # NOTE: no `archived` key
    }
    p = Project.model_validate(json.loads(json.dumps(body)))
    assert p.archived is False


# ── IDatabase.list_projects -------------------------------------------------


def test_list_projects_default_excludes_archived(tmp_path) -> None:
    settings = _settings(tmp_path)
    _seed(settings, [_make_project("a"), _make_project("b", archived=True)])

    async def go() -> list[str]:
        db = SqliteDatabase(settings.derived_database_url)
        await db.initialize()
        try:
            rows = await db.list_projects("default")
        finally:
            await db.close()
        return [p.id for p in rows]

    ids = asyncio.run(go())
    assert ids == ["a"]


def test_list_projects_include_archived_returns_all(tmp_path) -> None:
    settings = _settings(tmp_path)
    _seed(settings, [_make_project("a"), _make_project("b", archived=True)])

    async def go() -> list[tuple[str, bool]]:
        db = SqliteDatabase(settings.derived_database_url)
        await db.initialize()
        try:
            rows = await db.list_projects("default", include_archived=True)
        finally:
            await db.close()
        return sorted((p.id, p.archived) for p in rows)

    rows = asyncio.run(go())
    assert rows == [("a", False), ("b", True)]


# ── GET /api/data/projects --------------------------------------------------


def test_list_route_default_hides_archived(tmp_path) -> None:
    settings = _settings(tmp_path)
    _seed(settings, [_make_project("p1"), _make_project("p2", archived=True)])
    with TestClient(build_app(settings)) as client:
        r = client.get("/api/data/projects")
        assert r.status_code == 200
        ids = sorted(item["id"] for item in r.json())
        assert ids == ["p1"]


def test_list_route_include_archived_query_returns_all(tmp_path) -> None:
    settings = _settings(tmp_path)
    _seed(settings, [_make_project("p1"), _make_project("p2", archived=True)])
    with TestClient(build_app(settings)) as client:
        r = client.get("/api/data/projects?include_archived=true")
        assert r.status_code == 200
        ids = sorted(item["id"] for item in r.json())
        assert ids == ["p1", "p2"]


# ── POST /archive / /unarchive ---------------------------------------------


def test_archive_endpoint_marks_project_archived(tmp_path) -> None:
    settings = _settings(tmp_path)
    _seed(settings, [_make_project("ar1")])
    with TestClient(build_app(settings)) as client:
        before = client.get("/api/data/projects/ar1").json()
        assert before["archived"] is False

        r = client.post("/api/data/projects/ar1/archive")
        assert r.status_code == 200
        body = r.json()
        assert body["archived"] is True
        # `updated_at` advances on archive.
        assert body["updated_at"] >= before["updated_at"]


def test_archive_endpoint_is_idempotent(tmp_path) -> None:
    settings = _settings(tmp_path)
    _seed(settings, [_make_project("ar2", archived=True)])
    with TestClient(build_app(settings)) as client:
        r = client.post("/api/data/projects/ar2/archive")
        assert r.status_code == 200
        assert r.json()["archived"] is True


def test_unarchive_endpoint_clears_archived(tmp_path) -> None:
    settings = _settings(tmp_path)
    _seed(settings, [_make_project("ua1", archived=True)])
    with TestClient(build_app(settings)) as client:
        r = client.post("/api/data/projects/ua1/unarchive")
        assert r.status_code == 200
        assert r.json()["archived"] is False
        # Now visible in default list.
        listing = client.get("/api/data/projects").json()
        assert any(item["id"] == "ua1" for item in listing)


def test_unarchive_endpoint_is_idempotent(tmp_path) -> None:
    settings = _settings(tmp_path)
    _seed(settings, [_make_project("ua2")])
    with TestClient(build_app(settings)) as client:
        r = client.post("/api/data/projects/ua2/unarchive")
        assert r.status_code == 200
        assert r.json()["archived"] is False


@pytest.mark.parametrize("op", ["archive", "unarchive"])
def test_archive_endpoints_404_on_unknown_project(tmp_path, op: str) -> None:
    settings = _settings(tmp_path)
    with TestClient(build_app(settings)) as client:
        r = client.post(f"/api/data/projects/nope/{op}")
        assert r.status_code == 404


def test_archive_does_not_hard_delete(tmp_path) -> None:
    """After archive, GET /projects/{id} still returns the project."""
    settings = _settings(tmp_path)
    _seed(settings, [_make_project("nh1")])
    with TestClient(build_app(settings)) as client:
        client.post("/api/data/projects/nh1/archive")
        r = client.get("/api/data/projects/nh1")
        assert r.status_code == 200
        assert r.json()["archived"] is True
