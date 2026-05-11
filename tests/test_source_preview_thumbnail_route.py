"""Tests-first for source-preview per-image thumbnail (P2 #8 slice 3).

Slice 2 (`/projects/{id}/source-preview`) returns *just the names* + total
count by reading the zip's central directory. The SPA needs an actual
thumbnail per name to render the preview strip; this slice adds:

    GET /api/data/projects/{project_id}/source-preview/{filename}/thumbnail

which extracts the named entry from the project's `source.zip`, runs it
through `_make_thumbnail_bytes`, and returns the JPEG bytes inline.

Locks in:
  - happy path: returns JPEG bytes with `image/jpeg` content-type,
  - 404 for an unknown project,
  - 404 for another user's project (mirrors the 403→404 collapse used by
    `assets.py` and the slice-2 list route — don't leak existence),
  - 404 if `source.zip` hasn't landed yet,
  - 404 for a filename not present in the zip (no information leak about
    near-misses).

Auth and ownership match `source_preview` (slice 2) verbatim — the only
new code path is "extract one named entry, thumbnail it, return bytes".
"""

from __future__ import annotations

import asyncio
import io
import zipfile
from datetime import UTC, datetime

import numpy as np
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


def _png_bytes(w: int, h: int) -> bytes:
    """Encode a synthetic w x h white PNG via cv2 (matches `_make_thumbnail_bytes`'s decoder)."""
    import cv2  # type: ignore[import-not-found]

    img = np.full((h, w, 3), 255, dtype=np.uint8)
    ok, buf = cv2.imencode(".png", img)
    assert ok
    return bytes(buf.tobytes())


def _seed_source_zip(settings: Settings, entries: dict[str, bytes]) -> None:
    """Write a zip with `name -> raw bytes` to storage at projects/a1/source.zip."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, data in entries.items():
            zf.writestr(name, data)
    raw = buf.getvalue()

    async def go() -> None:
        storage = FilesystemStorage(settings.data_root)
        await storage.put_bytes("projects/a1/source.zip", raw, "application/zip")

    asyncio.run(go())


def test_thumbnail_happy_path_returns_jpeg(tmp_path) -> None:
    settings = _settings(tmp_path)
    _seed_project(settings)
    _seed_source_zip(
        settings,
        {"scan_001.png": _png_bytes(2400, 3200)},
    )
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/data/projects/a1/source-preview/scan_001.png/thumbnail")
        assert r.status_code == 200, r.text
        assert r.headers["content-type"] == "image/jpeg"
        # JPEG magic bytes — confirms `_make_thumbnail_bytes` actually ran.
        assert r.content[:3] == b"\xff\xd8\xff"
        assert len(r.content) > 0


def test_thumbnail_404_for_unknown_project(tmp_path) -> None:
    settings = _settings(tmp_path)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/data/projects/no-such/source-preview/x.png/thumbnail")
        assert r.status_code == 404


def test_thumbnail_404_for_other_users_project(tmp_path) -> None:
    settings = _settings(tmp_path)
    _seed_project(settings, owner_id="someone-else")
    _seed_source_zip(settings, {"scan_001.png": _png_bytes(100, 100)})
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/data/projects/a1/source-preview/scan_001.png/thumbnail")
        # Mirrors the slice-2 list route: collapse 403 → 404.
        assert r.status_code == 404


def test_thumbnail_404_when_source_zip_not_yet_uploaded(tmp_path) -> None:
    settings = _settings(tmp_path)
    _seed_project(settings)
    # Project exists but no source.zip — presigned PUT never landed.
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/data/projects/a1/source-preview/scan_001.png/thumbnail")
        assert r.status_code == 404


def test_thumbnail_404_for_unknown_filename(tmp_path) -> None:
    settings = _settings(tmp_path)
    _seed_project(settings)
    _seed_source_zip(settings, {"scan_001.png": _png_bytes(100, 100)})
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/data/projects/a1/source-preview/no_such.png/thumbnail")
        assert r.status_code == 404


def test_thumbnail_404_for_non_image_filename_in_zip(tmp_path) -> None:
    """Even if the entry exists, refuse to thumbnail non-image entries.

    The slice-2 list route already filters non-image entries out of the
    response, so the SPA should never request one — but a hand-rolled
    request for `notes.txt` shouldn't be a 500. Match the "unknown
    filename" branch instead.
    """
    settings = _settings(tmp_path)
    _seed_project(settings)
    _seed_source_zip(
        settings,
        {"scan_001.png": _png_bytes(100, 100), "notes.txt": b"hello"},
    )
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/data/projects/a1/source-preview/notes.txt/thumbnail")
        assert r.status_code == 404
