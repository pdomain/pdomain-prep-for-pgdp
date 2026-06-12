"""Authorisation/404 tests for `api.data.projects` routes.

Locks in the per-route owner check:
  - GET /projects/{id} returns 403 when the project belongs to another user,
  - PATCH /projects/{id}/config returns 403 in the same case,
  - DELETE /projects/{id} returns 403 in the same case (NOT 404 — the
    delete path explicitly distinguishes "missing" (204 silent) from
    "exists but not yours" (403)).
  - PATCH /projects/{id}/config returns 404 for a missing project.

Note: most other routes return 404 for owner mismatch (no-leak); these
three return 403 because the spec wants single-tenant deployments to see
"yes there is a project here, no you can't read it" rather than a 404
that hides existence.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime

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


def _seed(settings: Settings, owner_id: str) -> None:
    async def go() -> None:
        db = SqliteDatabase(settings.derived_database_url)
        await db.initialize()
        now = datetime.now(UTC)
        await db.put_project(
            Project(
                id="pa1",
                owner_id=owner_id,
                name="t",
                created_at=now,
                updated_at=now,
                status=ProjectStatus.processing,
                page_count=0,
                proof_page_count=0,
                config=ProjectConfig(book_name="t", source_uri=""),
                storage_prefix="projects/pa1/",
            )
        )
        await db.close()

    asyncio.run(go())


def test_get_project_403_for_other_user(tmp_path) -> None:
    settings = _settings(tmp_path)
    _seed(settings, owner_id="someone-else")
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/data/projects/pa1")
        assert r.status_code == 403


def test_update_config_403_for_other_user(tmp_path) -> None:
    settings = _settings(tmp_path)
    _seed(settings, owner_id="someone-else")
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.patch(
            "/api/data/projects/pa1/config",
            json={"project_config": {"book_name": "stolen"}},
        )
        assert r.status_code == 403


def test_update_config_404_for_unknown_project(tmp_path) -> None:
    settings = _settings(tmp_path)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.patch(
            "/api/data/projects/no-such/config",
            json={"project_config": {"book_name": "x"}},
        )
        assert r.status_code == 404


def test_delete_project_403_for_other_user(tmp_path) -> None:
    """DELETE explicitly distinguishes missing (silent 204) vs. forbidden (403)."""
    settings = _settings(tmp_path)
    _seed(settings, owner_id="someone-else")
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.delete("/api/data/projects/pa1")
        assert r.status_code == 403
