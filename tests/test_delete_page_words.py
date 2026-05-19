"""Tests for `DELETE /api/data/projects/{id}/pages/{idx0}/words`
and `POST /api/data/projects/{id}/pages/{idx0}/words/restore`
(roadmap §9a — soft-delete + restore endpoint).

Locks in:
  - soft-delete: deleted words stay in storage with ``deleted: true``;
    ``remaining_words`` in the response contains only non-deleted words;
  - ``get_page_text`` filters deleted words from the overlay;
  - ``restore`` flips ``deleted`` back to ``false`` for matched ids;
  - happy path: delete a subset of word ids, both ``<root>.words.json``
    and ``<root>.txt`` are rewritten, response carries the survivors
    and rebuilt text;
  - empty ``word_ids`` is a no-op (200, deleted_count=0) — the response
    still reflects the current canonical state;
  - unknown ids are silently skipped (idempotent);
  - text rebuild groups words by line via y-midpoint clustering and
    joins lines with ``\\n``;
  - 404 for missing project / missing page / missing words blob /
    other user's project (no-leak).
"""

from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime

from fastapi.testclient import TestClient

from pd_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pd_prep_for_pgdp.adapters.storage.filesystem import FilesystemStorage
from pd_prep_for_pgdp.bootstrap import build_app
from pd_prep_for_pgdp.core.models import (
    BoundingBox,
    OcrWord,
    PageRecord,
    PipelineState,
    Project,
    ProjectConfig,
    ProjectStatus,
)
from pd_prep_for_pgdp.core.ocr_artifacts import words_key_for
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


def _seed_words(settings: Settings, words: list[OcrWord], text: str) -> tuple[str, str]:
    """Drop a ``<root>.txt`` + ``<root>.words.json`` pair into storage and
    return ``(text_key, words_key)``."""
    storage = FilesystemStorage(root=settings.data_root)
    text_key = "projects/pt1/ocr_text/src1_p001.txt"
    wkey = words_key_for(text_key)

    async def go() -> None:
        await storage.put_bytes(text_key, text.encode("utf-8"), "text/plain")
        await storage.put_bytes(
            wkey,
            json.dumps([w.model_dump(mode="json") for w in words]).encode("utf-8"),
            "application/json",
        )

    asyncio.run(go())
    return text_key, wkey


def _read_storage_bytes(settings: Settings, key: str) -> bytes:
    storage = FilesystemStorage(root=settings.data_root)

    async def go() -> bytes:
        return await storage.get_bytes(key)

    return asyncio.run(go())


def _word(id_: str, text: str, left: int, top: int, width: int = 30, height: int = 20) -> OcrWord:
    return OcrWord(
        id=id_,
        text=text,
        confidence=0.99,
        bounding_box=BoundingBox(left=left, top=top, width=width, height=height),
    )


# ─── happy path (soft-delete) ────────────────────────────────────────────────


def test_delete_words_rewrites_words_blob_and_text(tmp_path) -> None:
    settings = _settings(tmp_path)
    _seed_project(settings)
    words = [
        _word("w1", "hello", left=10, top=10),
        _word("w2", "noise", left=50, top=10),  # to be deleted
        _word("w3", "world", left=10, top=50),
    ]
    text_key, wkey = _seed_words(settings, words, "hello noise\nworld")

    app = build_app(settings)
    with TestClient(app) as client:
        r = client.request(
            "DELETE",
            "/api/data/projects/pt1/pages/0/words",
            json={"word_ids": ["w2"], "split_suffix": ""},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["deleted_count"] == 1
        assert body["text_key"] == text_key
        assert body["words_key"] == wkey
        # remaining_words contains only non-deleted words
        assert [w["id"] for w in body["remaining_words"]] == ["w1", "w3"]
        # Two lines (different y-midpoints), each one word.
        assert body["text"] == "hello\nworld"

    # Storage: all 3 words persisted, but w2 has deleted=True.
    raw = _read_storage_bytes(settings, wkey)
    persisted = json.loads(raw.decode("utf-8"))
    assert len(persisted) == 3  # soft-delete: w2 stays in storage
    persisted_by_id = {w["id"]: w for w in persisted}
    assert persisted_by_id["w1"]["deleted"] is False
    assert persisted_by_id["w2"]["deleted"] is True
    assert persisted_by_id["w3"]["deleted"] is False
    # Text file rebuilt from survivors only.
    assert _read_storage_bytes(settings, text_key).decode("utf-8") == "hello\nworld"


def test_delete_words_groups_same_line_by_y_midpoint(tmp_path) -> None:
    """Words whose y-midpoints are within half the smaller height live
    on the same rebuilt line and are joined with a single space."""
    settings = _settings(tmp_path)
    _seed_project(settings)
    words = [
        _word("w1", "the", left=10, top=10, width=20, height=20),
        _word("w2", "quick", left=40, top=12, width=30, height=18),  # same line as w1
        _word("w3", "fox", left=10, top=80, width=20, height=20),  # next line
    ]
    _seed_words(settings, words, "irrelevant — will be rebuilt")

    app = build_app(settings)
    with TestClient(app) as client:
        # Delete nothing — we just want to read back the rebuilt text.
        r = client.request(
            "DELETE",
            "/api/data/projects/pt1/pages/0/words",
            json={"word_ids": []},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["deleted_count"] == 0
        assert body["text"] == "the quick\nfox"


# ─── idempotency / edge cases ───────────────────────────────────────────────


def test_delete_words_unknown_id_silently_skipped(tmp_path) -> None:
    settings = _settings(tmp_path)
    _seed_project(settings)
    words = [
        _word("w1", "hello", left=10, top=10),
        _word("w2", "world", left=50, top=10),
    ]
    _seed_words(settings, words, "hello world")

    app = build_app(settings)
    with TestClient(app) as client:
        r = client.request(
            "DELETE",
            "/api/data/projects/pt1/pages/0/words",
            json={"word_ids": ["nope", "also-nope"]},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["deleted_count"] == 0
        assert [w["id"] for w in body["remaining_words"]] == ["w1", "w2"]


def test_delete_words_empty_list_is_noop_with_canonical_text(tmp_path) -> None:
    settings = _settings(tmp_path)
    _seed_project(settings)
    words = [
        _word("w1", "alpha", left=10, top=10),
        _word("w2", "beta", left=10, top=50),
    ]
    _seed_words(settings, words, "stale text on disk")

    app = build_app(settings)
    with TestClient(app) as client:
        r = client.request(
            "DELETE",
            "/api/data/projects/pt1/pages/0/words",
            json={"word_ids": []},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["deleted_count"] == 0
        assert body["text"] == "alpha\nbeta"  # rewritten from words, not the stale string


def test_delete_words_delete_all_yields_empty_text(tmp_path) -> None:
    settings = _settings(tmp_path)
    _seed_project(settings)
    words = [_word("w1", "only", left=10, top=10)]
    text_key, wkey = _seed_words(settings, words, "only")

    app = build_app(settings)
    with TestClient(app) as client:
        r = client.request(
            "DELETE",
            "/api/data/projects/pt1/pages/0/words",
            json={"word_ids": ["w1"]},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["deleted_count"] == 1
        assert body["remaining_words"] == []
        assert body["text"] == ""

    assert _read_storage_bytes(settings, text_key) == b""

    # The word is still in storage (soft-delete).
    raw = _read_storage_bytes(settings, wkey)
    persisted = json.loads(raw.decode("utf-8"))
    assert len(persisted) == 1
    assert persisted[0]["deleted"] is True


def test_delete_words_already_deleted_not_recounted(tmp_path) -> None:
    """Deleting an already-deleted word should not increment deleted_count."""
    settings = _settings(tmp_path)
    _seed_project(settings)
    words = [
        _word("w1", "hello", left=10, top=10),
        _word("w2", "noise", left=50, top=10),
    ]
    _seed_words(settings, words, "hello noise")

    app = build_app(settings)
    with TestClient(app) as client:
        # First delete: w2 becomes deleted=True
        r = client.request(
            "DELETE",
            "/api/data/projects/pt1/pages/0/words",
            json={"word_ids": ["w2"]},
        )
        assert r.status_code == 200
        assert r.json()["deleted_count"] == 1

        # Second delete of same id: already deleted, count should be 0
        r2 = client.request(
            "DELETE",
            "/api/data/projects/pt1/pages/0/words",
            json={"word_ids": ["w2"]},
        )
        assert r2.status_code == 200
        assert r2.json()["deleted_count"] == 0


# ─── restore endpoint ────────────────────────────────────────────────────────


def test_restore_words_flips_deleted_flag(tmp_path) -> None:
    """Delete a word, then restore it; it should reappear in remaining_words
    and have deleted=False in storage."""
    settings = _settings(tmp_path)
    _seed_project(settings)
    words = [
        _word("w1", "hello", left=10, top=10),
        _word("w2", "noise", left=50, top=10),
        _word("w3", "world", left=10, top=50),
    ]
    text_key, wkey = _seed_words(settings, words, "hello noise\nworld")

    app = build_app(settings)
    with TestClient(app) as client:
        # Delete w2
        r = client.request(
            "DELETE",
            "/api/data/projects/pt1/pages/0/words",
            json={"word_ids": ["w2"]},
        )
        assert r.status_code == 200
        assert r.json()["deleted_count"] == 1

        # Restore w2
        r2 = client.post(
            "/api/data/projects/pt1/pages/0/words/restore",
            json={"word_ids": ["w2"]},
        )
        assert r2.status_code == 200, r2.text
        body = r2.json()
        assert body["restored_count"] == 1
        assert body["text_key"] == text_key
        assert body["words_key"] == wkey
        # All three words should be back in remaining_words
        remaining_ids = {w["id"] for w in body["remaining_words"]}
        assert remaining_ids == {"w1", "w2", "w3"}
        # Text should be rebuilt from all three: w1+w2 share y_mid=20 (same line),
        # w3 is on its own line at y_mid=60.
        assert body["text"] == "hello noise\nworld"

    # Storage: all words with deleted=False
    raw = _read_storage_bytes(settings, wkey)
    persisted = json.loads(raw.decode("utf-8"))
    persisted_by_id = {w["id"]: w for w in persisted}
    assert persisted_by_id["w2"]["deleted"] is False


def test_restore_words_unknown_id_skipped(tmp_path) -> None:
    """Restoring an unknown id should succeed with restored_count=0."""
    settings = _settings(tmp_path)
    _seed_project(settings)
    words = [_word("w1", "hello", left=10, top=10)]
    _seed_words(settings, words, "hello")

    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post(
            "/api/data/projects/pt1/pages/0/words/restore",
            json={"word_ids": ["no-such-id"]},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["restored_count"] == 0
        assert [w["id"] for w in body["remaining_words"]] == ["w1"]


def test_restore_words_404_missing_words_blob(tmp_path) -> None:
    """Restore returns 404 when there is no words blob at all."""
    settings = _settings(tmp_path)
    _seed_project(settings)
    # No _seed_words call

    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post(
            "/api/data/projects/pt1/pages/0/words/restore",
            json={"word_ids": ["w1"]},
        )
        assert r.status_code == 404


# ─── get_page_text filters deleted words ────────────────────────────────────


def test_get_page_text_filters_deleted_words(tmp_path) -> None:
    """After a soft-delete, GET /text/{suffix} should return words without
    deleted ones in the overlay."""
    settings = _settings(tmp_path)
    _seed_project(settings)

    # Seed words where w2 is already marked deleted in storage
    w1 = _word("w1", "hello", left=10, top=10)
    w2 = OcrWord(
        id="w2",
        text="noise",
        confidence=0.99,
        bounding_box=BoundingBox(left=50, top=10, width=30, height=20),
        deleted=True,  # pre-deleted in storage
    )
    w3 = _word("w3", "world", left=10, top=50)

    storage = FilesystemStorage(root=settings.data_root)
    text_key = "projects/pt1/ocr_text/src1_p001.txt"
    wkey = words_key_for(text_key)

    async def go() -> None:
        await storage.put_bytes(text_key, b"hello world", "text/plain")
        payload = json.dumps([w.model_dump(mode="json") for w in [w1, w2, w3]])
        await storage.put_bytes(wkey, payload.encode("utf-8"), "application/json")

    asyncio.run(go())

    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/data/projects/pt1/pages/0/text/_")
        assert r.status_code == 200, r.text
        body = r.json()
        word_ids = [w["id"] for w in body["words"]]
        assert "w1" in word_ids
        assert "w3" in word_ids
        assert "w2" not in word_ids  # deleted word filtered out


# ─── 404 paths ──────────────────────────────────────────────────────────────


def test_delete_words_404_when_words_blob_missing(tmp_path) -> None:
    settings = _settings(tmp_path)
    _seed_project(settings)
    # No ``_seed_words`` call — page exists but no .words.json on disk.

    app = build_app(settings)
    with TestClient(app) as client:
        r = client.request(
            "DELETE",
            "/api/data/projects/pt1/pages/0/words",
            json={"word_ids": ["w1"]},
        )
        assert r.status_code == 404


def test_delete_words_404_for_unknown_project(tmp_path) -> None:
    settings = _settings(tmp_path)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.request(
            "DELETE",
            "/api/data/projects/no-such/pages/0/words",
            json={"word_ids": ["w1"]},
        )
        assert r.status_code == 404


def test_delete_words_404_for_unknown_page(tmp_path) -> None:
    settings = _settings(tmp_path)
    _seed_project(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.request(
            "DELETE",
            "/api/data/projects/pt1/pages/99/words",
            json={"word_ids": ["w1"]},
        )
        assert r.status_code == 404


def test_delete_words_404_for_other_users_project(tmp_path) -> None:
    settings = _settings(tmp_path)
    _seed_project(settings, owner_id="someone-else")
    words = [_word("w1", "hi", left=10, top=10)]
    _seed_words(settings, words, "hi")

    app = build_app(settings)
    with TestClient(app) as client:
        r = client.request(
            "DELETE",
            "/api/data/projects/pt1/pages/0/words",
            json={"word_ids": ["w1"]},
        )
        assert r.status_code == 404
