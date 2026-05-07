"""Tests-first for `/api/data/projects/{id}/source-preview` (P2 #8 slice 2).

Wraps the pure helper `peek_zip_image_names` (covered separately in
`test_peek_zip_image_names.py`) behind an authorised, ownership-guarded
HTTP route. The route reads the project's already-uploaded `source.zip`
from storage and returns just enough to render the thumbnail strip in
the SPA.

Locks in:
  - happy path returns ``{filenames, total_image_count}`` for a valid zip,
  - ``limit`` query parameter is honoured end-to-end,
  - 404 for an unknown project,
  - 404 for another user's project (don't leak existence — mirrors
    `assets.py`'s collapse of 403 → 404),
  - 404 if `source.zip` hasn't been uploaded yet (uploaded URL was
    presigned but the PUT never landed).
"""

from __future__ import annotations

import asyncio
import io
import zipfile
from datetime import UTC, datetime

from fastapi.testclient import TestClient

from pd_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pd_prep_for_pgdp.adapters.storage.filesystem import FilesystemStorage
from pd_prep_for_pgdp.bootstrap import build_app
from pd_prep_for_pgdp.core.models import (
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


def _seed_project(settings: Settings, owner_id: str = "default") -> None:
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
                pipeline_state=PipelineState(),
                storage_prefix="projects/a1/",
            )
        )
        await db.close()

    asyncio.run(go())


def _seed_source_zip(settings: Settings, names: list[str]) -> None:
    """Write a zip containing one minimal entry per name to storage."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name in names:
            # 1-byte placeholder is fine — peek_zip_image_names doesn't decode.
            zf.writestr(name, b"x")
    raw = buf.getvalue()

    async def go() -> None:
        storage = FilesystemStorage(settings.data_root)
        await storage.put_bytes("projects/a1/source.zip", raw, "application/zip")

    asyncio.run(go())


def test_source_preview_happy_path_returns_filenames_and_total(tmp_path) -> None:
    settings = _settings(tmp_path)
    _seed_project(settings)
    _seed_source_zip(
        settings,
        names=["scan_001.png", "scan_002.png", "scan_003.png", "notes.txt"],
    )
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/data/projects/a1/source-preview")
        assert r.status_code == 200, r.text
        body = r.json()
        # `notes.txt` is excluded — only image entries are counted.
        assert body["total_image_count"] == 3
        assert body["filenames"] == ["scan_001.png", "scan_002.png", "scan_003.png"]


def test_source_preview_limit_param_is_honoured(tmp_path) -> None:
    settings = _settings(tmp_path)
    _seed_project(settings)
    _seed_source_zip(
        settings,
        names=[f"scan_{i:03d}.png" for i in range(10)],
    )
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/data/projects/a1/source-preview", params={"limit": 3})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["total_image_count"] == 10
        assert body["filenames"] == ["scan_000.png", "scan_001.png", "scan_002.png"]


def test_source_preview_404_for_unknown_project(tmp_path) -> None:
    settings = _settings(tmp_path)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/data/projects/no-such/source-preview")
        assert r.status_code == 404


def test_source_preview_404_for_other_users_project(tmp_path) -> None:
    settings = _settings(tmp_path)
    _seed_project(settings, owner_id="someone-else")
    _seed_source_zip(settings, names=["scan_001.png"])
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/data/projects/a1/source-preview")
        # Mirrors assets.py: collapse 403 → 404 to avoid leaking existence.
        assert r.status_code == 404


def test_source_preview_404_when_source_zip_not_yet_uploaded(tmp_path) -> None:
    settings = _settings(tmp_path)
    _seed_project(settings)
    # No _seed_source_zip — project exists, but the PUT to the presigned
    # upload URL never landed.
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/data/projects/a1/source-preview")
        assert r.status_code == 404
