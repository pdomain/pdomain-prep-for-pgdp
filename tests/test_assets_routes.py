"""Tests-first for `/api/data/projects/{id}/assets/{upload,download}-url`.

The routes guard storage access so a malicious caller can't presign a URL
for *another* project's prefix. Locks in:
  - upload-url returns a presigned URL when the key is inside the project's prefix,
  - upload-url 400s if the key escapes the project prefix,
  - download-url has the same prefix guard,
  - both 404 for unknown / other-user projects.
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


def _seed(settings: Settings, owner_id: str = "default") -> None:
    async def go() -> None:
        db = SqliteDatabase(settings.derived_database_url)
        await db.initialize()
        now = datetime.now(UTC)
        await db.put_project(
            Project(
                id="a1",
                owner_id=owner_id,
                name="t",
                created_at=now,
                updated_at=now,
                status=ProjectStatus.ingesting,
                page_count=0,
                proof_page_count=0,
                config=ProjectConfig(book_name="t", source_uri=""),
                storage_prefix="projects/a1/",
            )
        )
        await db.close()

    asyncio.run(go())


def test_upload_url_succeeds_inside_prefix(tmp_path) -> None:
    settings = _settings(tmp_path)
    _seed(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post(
            "/api/data/projects/a1/assets/upload-url",
            json={"key": "projects/a1/source.zip", "content_type": "application/zip"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["upload_url"]
        assert body["expires_in"] == 3600


def test_upload_url_rejects_key_outside_prefix(tmp_path) -> None:
    settings = _settings(tmp_path)
    _seed(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post(
            "/api/data/projects/a1/assets/upload-url",
            json={
                "key": "projects/other-project/sneaky.zip",  # different prefix
                "content_type": "application/zip",
            },
        )
        assert r.status_code == 400


def test_download_url_succeeds_inside_prefix(tmp_path) -> None:
    settings = _settings(tmp_path)
    _seed(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get(
            "/api/data/projects/a1/assets/download-url",
            params={"key": "projects/a1/for_zip/book.zip"},
        )
        assert r.status_code == 200
        assert r.json()["download_url"]


def test_download_url_rejects_key_outside_prefix(tmp_path) -> None:
    settings = _settings(tmp_path)
    _seed(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get(
            "/api/data/projects/a1/assets/download-url",
            params={"key": "projects/other-project/secret.zip"},
        )
        assert r.status_code == 400


def test_upload_url_404_for_unknown_project(tmp_path) -> None:
    settings = _settings(tmp_path)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post(
            "/api/data/projects/no-such/assets/upload-url",
            json={"key": "projects/no-such/x", "content_type": "image/png"},
        )
        assert r.status_code == 404


def test_upload_url_404_for_other_users_project(tmp_path) -> None:
    settings = _settings(tmp_path)
    _seed(settings, owner_id="someone-else")
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post(
            "/api/data/projects/a1/assets/upload-url",
            json={"key": "projects/a1/x", "content_type": "image/png"},
        )
        assert r.status_code == 404


def test_download_url_404_for_unknown_project(tmp_path) -> None:
    settings = _settings(tmp_path)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get(
            "/api/data/projects/no-such/assets/download-url",
            params={"key": "projects/no-such/x"},
        )
        assert r.status_code == 404
