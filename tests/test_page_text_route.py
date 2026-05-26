"""Tests for the page-text routes:

  - PATCH /projects/{id}/pages/{idx0}/text  — write text bytes,
  - GET   /projects/{id}/pages/{idx0}/text/{suffix} — read back.

Locks in:
  - PATCH writes a UTF-8 file under the synthesised key when no recorded
    `output.ocr_text_key` exists yet,
  - GET 404s for missing project / missing page / missing file,
  - GET 404 for another user's project (no-leak),
  - the `_` suffix in the URL maps to "" (whole-page) per spec,
  - GET surfaces persisted OcrWord bboxes when the sibling .words.json
    blob is present, and returns `[]` when it isn't (legacy pages).
"""

from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime

from fastapi.testclient import TestClient

from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pdomain_prep_for_pgdp.adapters.storage.filesystem import FilesystemStorage
from pdomain_prep_for_pgdp.bootstrap import build_app
from pdomain_prep_for_pgdp.core.models import (
    BoundingBox,
    OcrWord,
    PageRecord,
    PipelineState,
    Project,
    ProjectConfig,
    ProjectStatus,
)
from pdomain_prep_for_pgdp.core.ocr_artifacts import words_key_for
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
                id="pt1",
                owner_id=owner_id,
                name="t",
                created_at=now,
                updated_at=now,
                status=ProjectStatus.processing,
                page_count=1,
                proof_page_count=1,
                config=ProjectConfig(book_name="t", source_uri=""),
                pipeline_state=PipelineState(),
                storage_prefix="projects/pt1/",
            )
        )
        await db.put_pages(
            [
                PageRecord(
                    project_id="pt1",
                    idx0=0,
                    prefix="p001",
                    source_stem="src1",
                )
            ]
        )
        await db.close()

    asyncio.run(go())


def test_patch_text_writes_synthesised_key_for_pre_ocr_page(tmp_path) -> None:
    """No `output.ocr_text_key` is recorded yet → handler synthesises the
    `projects/<id>/ocr_text/<stem>_<prefix>.txt` path and writes there."""
    settings = _settings(tmp_path)
    _seed(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.patch(
            "/api/data/projects/pt1/pages/0/text",
            json={"text": "edited content", "split_suffix": ""},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["text_key"].endswith("/ocr_text/src1_p001.txt")

        # GET it back via the read route — `_` decodes to "" (whole-page).
        r2 = client.get("/api/data/projects/pt1/pages/0/text/_")
        assert r2.status_code == 200
        assert r2.json()["text"] == "edited content"


def test_get_text_404_when_file_missing(tmp_path) -> None:
    settings = _settings(tmp_path)
    _seed(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        # Page exists, but no file written yet.
        r = client.get("/api/data/projects/pt1/pages/0/text/_")
        assert r.status_code == 404


def test_get_text_404_for_unknown_project(tmp_path) -> None:
    settings = _settings(tmp_path)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/data/projects/no-such/pages/0/text/_")
        assert r.status_code == 404


def test_get_text_404_for_unknown_page(tmp_path) -> None:
    settings = _settings(tmp_path)
    _seed(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/data/projects/pt1/pages/99/text/_")
        assert r.status_code == 404


def test_get_text_404_for_other_users_project(tmp_path) -> None:
    settings = _settings(tmp_path)
    _seed(settings, owner_id="someone-else")
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/data/projects/pt1/pages/0/text/_")
        assert r.status_code == 404


def test_patch_text_404_for_unknown_project(tmp_path) -> None:
    settings = _settings(tmp_path)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.patch(
            "/api/data/projects/no-such/pages/0/text",
            json={"text": "x", "split_suffix": ""},
        )
        assert r.status_code == 404


def test_patch_text_404_for_unknown_page(tmp_path) -> None:
    settings = _settings(tmp_path)
    _seed(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.patch(
            "/api/data/projects/pt1/pages/99/text",
            json={"text": "x", "split_suffix": ""},
        )
        assert r.status_code == 404


# ─── words sibling-blob round-trip on the GET endpoint ──────────────────────


def test_get_text_returns_empty_words_when_blob_absent(tmp_path) -> None:
    """Legacy pages OCR'd before the words blob existed → GET returns words=[]."""
    settings = _settings(tmp_path)
    _seed(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        # PATCH writes the .txt only — no sibling .words.json.
        r = client.patch(
            "/api/data/projects/pt1/pages/0/text",
            json={"text": "hello", "split_suffix": ""},
        )
        assert r.status_code == 200, r.text
        r2 = client.get("/api/data/projects/pt1/pages/0/text/_")
        assert r2.status_code == 200
        body = r2.json()
        assert body["text"] == "hello"
        assert body["text_key"].endswith("/ocr_text/src1_p001.txt")
        assert body["words"] == []


def test_get_text_surfaces_persisted_words_when_blob_present(tmp_path) -> None:
    """When `<root>.words.json` exists, GET deserialises and returns the list."""
    settings = _settings(tmp_path)
    _seed(settings)

    # Drop a text + words blob directly via the same FilesystemStorage that
    # the app will use, so the route reads our seeded data.
    storage = FilesystemStorage(root=settings.data_root)
    text_key = "projects/pt1/ocr_text/src1_p001.txt"
    words = [
        OcrWord(
            id="w1",
            text="hello",
            confidence=0.99,
            bounding_box=BoundingBox(left=10, top=20, width=30, height=40),
        ),
        OcrWord(
            id="w2",
            text="world",
            confidence=0.5,
            bounding_box=BoundingBox(left=50, top=60, width=70, height=80),
        ),
    ]

    async def seed_blobs() -> None:
        await storage.put_bytes(text_key, b"hello world", "text/plain")
        await storage.put_bytes(
            words_key_for(text_key),
            json.dumps([w.model_dump(mode="json") for w in words]).encode("utf-8"),
            "application/json",
        )

    asyncio.run(seed_blobs())

    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/data/projects/pt1/pages/0/text/_")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["text"] == "hello world"
        assert body["text_key"] == text_key
        assert len(body["words"]) == 2
        assert body["words"][0]["id"] == "w1"
        assert body["words"][0]["text"] == "hello"
        assert body["words"][0]["bounding_box"] == {
            "left": 10,
            "top": 20,
            "width": 30,
            "height": 40,
        }
        assert body["words"][1]["id"] == "w2"


def test_corrupt_words_blob_sets_words_partial_flag(tmp_path) -> None:
    """A corrupt words blob must set words_partial=True, not silently return []."""
    settings = _settings(tmp_path)
    _seed(settings)

    storage = FilesystemStorage(root=settings.data_root)
    text_key = "projects/pt1/ocr_text/src1_p001.txt"

    async def seed_blobs() -> None:
        await storage.put_bytes(text_key, b"hello world", "text/plain")
        await storage.put_bytes(
            words_key_for(text_key),
            b"this is not valid json!!! garbage bytes",
            "application/json",
        )

    asyncio.run(seed_blobs())

    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/data/projects/pt1/pages/0/text/_")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["words"] == []
        assert body["words_partial"] is True
        assert body["words_error"] is not None
