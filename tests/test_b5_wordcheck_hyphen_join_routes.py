"""B5 Group 5 — Wordcheck and hyphen_join decision routes (api-v2-deltas §1.9).

Behaviors tested:
- GET  .../stages/wordcheck/flags        → 200 flags projection (or 404 if not clean)
- POST .../stages/wordcheck/decisions    → 200 updated flags projection
- POST .../wordlist-promotion            → 200 {"promoted": true}
- GET  .../stages/hyphen-join/candidates → 200 candidates (or 404 if no text)
- POST .../stages/hyphen-join/decisions  → 200 updated candidates
- 409 for v1 project (registry_version_mismatch)
- 404 for unknown project
"""

from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime

from fastapi.testclient import TestClient

from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pdomain_prep_for_pgdp.bootstrap import build_app
from pdomain_prep_for_pgdp.core.models import (
    PageProcessingStatus,
    PageRecord,
    PipelineState,
    Project,
    ProjectConfig,
    ProjectStatus,
)
from pdomain_prep_for_pgdp.core.pipeline.page_stage_writer import commit_stage_artifact
from pdomain_prep_for_pgdp.settings import Settings
from tests.fixtures.seed_pages import seed_pages_in_store


def _settings(tmp_path):
    return Settings(
        host="127.0.0.1",
        port=8765,
        data_root=tmp_path / "data",
        config_dir=tmp_path / "config",
        storage_backend="filesystem",
        database_url=f"sqlite:///{(tmp_path / 'state.db').as_posix()}",
        auth_mode="none",
        gpu_backend="cpu",
        dispatch_interval_seconds=0,
    )


def _seed_project(settings, project_id: str = "proj1", registry_version: int = 2) -> None:
    async def go() -> None:
        db = SqliteDatabase(settings.derived_database_url)
        await db.initialize()
        now = datetime.now(UTC)
        await db.put_project(
            Project(
                id=project_id,
                owner_id="default",
                name=project_id,
                created_at=now,
                updated_at=now,
                status=ProjectStatus.processing,
                page_count=1,
                proof_page_count=1,
                config=ProjectConfig(book_name=project_id, source_uri=""),
                pipeline_state=PipelineState(),
                storage_prefix=f"projects/{project_id}/",
                registry_version=registry_version,
            )
        )
        await db.close()

    asyncio.run(go())
    seed_pages_in_store(
        settings,
        project_id,
        [
            PageRecord(
                project_id=project_id,
                idx0=0,
                prefix="p001",
                source_stem="src1",
                processing_status=PageProcessingStatus.pending,
            )
        ],
    )


def _make_words_json(words: list[dict]) -> bytes:
    """Build a minimal words.json bytes blob."""
    return json.dumps(words).encode("utf-8")


def _make_wordcheck_artifact(flags: list[dict], total_words: int) -> bytes:
    """Build a wordcheck stage artifact (JSON blob)."""
    return json.dumps({"flags": flags, "flagged_count": len(flags), "total_words": total_words}).encode(
        "utf-8"
    )


async def _seed_clean_stage(settings, project_id, page_id, stage_id, payload):
    db = SqliteDatabase(settings.derived_database_url)
    await db.initialize()
    try:
        await db.init_page_stages_for_page(project_id, page_id)
        await commit_stage_artifact(
            data_root=settings.data_root,
            database=db,
            project_id=project_id,
            page_id=page_id,
            stage_id=stage_id,
            artifact_bytes=payload,
        )
    finally:
        await db.close()


# ─── GET wordcheck flags ─────────────────────────────────────────────────────


def test_get_wordcheck_flags_404_when_stage_not_clean(tmp_path):
    """GET .../wordcheck/flags → 404 when wordcheck stage not clean."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1")
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/data/projects/proj1/pages/0/stages/wordcheck/flags")
    assert r.status_code == 404


def test_get_wordcheck_flags_returns_flags_when_clean(tmp_path):
    """GET .../wordcheck/flags → 200 with flags dict when stage is clean."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1")
    artifact = _make_wordcheck_artifact(
        flags=[{"word_id": "w1", "word_text": "teh", "flag_reason": "bad_word", "status": "open"}],
        total_words=5,
    )
    asyncio.run(_seed_clean_stage(settings, "proj1", "0000", "wordcheck", artifact))
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/data/projects/proj1/pages/0/stages/wordcheck/flags")
    assert r.status_code == 200
    body = r.json()
    assert "flags" in body
    assert "flagged_count" in body
    assert "total_words" in body
    assert body["total_words"] == 5
    assert len(body["flags"]) == 1
    assert body["flags"][0]["word_text"] == "teh"


def test_get_wordcheck_flags_404_unknown_project(tmp_path):
    """GET .../wordcheck/flags → 404 for unknown project."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1")
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/data/projects/no-such/pages/0/stages/wordcheck/flags")
    assert r.status_code == 404


def test_get_wordcheck_flags_409_v1_project(tmp_path):
    """GET .../wordcheck/flags → 409 for v1 project."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1", registry_version=1)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/data/projects/proj1/pages/0/stages/wordcheck/flags")
    assert r.status_code == 409
    assert r.json()["error"] == "registry_version_mismatch"


# ─── POST wordcheck decisions ────────────────────────────────────────────────


def test_post_wordcheck_decisions_returns_updated_flags(tmp_path):
    """POST .../wordcheck/decisions → 200 with updated flags projection."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1")
    artifact = _make_wordcheck_artifact(
        flags=[{"word_id": "w1", "word_text": "teh", "flag_reason": "bad_word", "status": "open"}],
        total_words=3,
    )
    asyncio.run(_seed_clean_stage(settings, "proj1", "0000", "wordcheck", artifact))
    app = build_app(settings)
    decisions = {"decisions": [{"word_id": "w1", "word_text": "teh", "decision": "accepted"}]}
    with TestClient(app) as client:
        r = client.post(
            "/api/data/projects/proj1/pages/0/stages/wordcheck/decisions",
            json=decisions,
        )
    assert r.status_code == 200
    body = r.json()
    assert "flags" in body
    # The flag status should now be "accepted"
    flag = next((f for f in body["flags"] if f["word_id"] == "w1"), None)
    assert flag is not None
    assert flag["status"] == "accepted"


def test_post_wordcheck_decisions_404_when_not_clean(tmp_path):
    """POST .../wordcheck/decisions → 404 when wordcheck stage not clean."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1")
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post(
            "/api/data/projects/proj1/pages/0/stages/wordcheck/decisions",
            json={"decisions": []},
        )
    assert r.status_code == 404


# ─── POST wordlist promotion ─────────────────────────────────────────────────


def test_post_wordlist_promotion_returns_promoted_true(tmp_path):
    """POST .../wordlist-promotion → 200 {"promoted": true}."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1")
    app = build_app(settings)
    payload = {
        "word": "colour",
        "source_stage": "wordcheck",
        "source_page_id": "0000",
        "list_scope": "project",
    }
    with TestClient(app) as client:
        r = client.post("/api/data/projects/proj1/wordlist-promotion", json=payload)
    assert r.status_code == 200
    assert r.json().get("promoted") is True


def test_post_wordlist_promotion_404_unknown_project(tmp_path):
    """POST .../wordlist-promotion → 404 for unknown project."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1")
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post(
            "/api/data/projects/no-such/wordlist-promotion",
            json={
                "word": "colour",
                "source_stage": "wordcheck",
                "source_page_id": "0000",
                "list_scope": "project",
            },
        )
    assert r.status_code == 404


def test_post_wordlist_promotion_409_v1_project(tmp_path):
    """POST .../wordlist-promotion → 409 for v1 project."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1", registry_version=1)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post(
            "/api/data/projects/proj1/wordlist-promotion",
            json={
                "word": "colour",
                "source_stage": "wordcheck",
                "source_page_id": "0000",
                "list_scope": "project",
            },
        )
    assert r.status_code == 409
    assert r.json()["error"] == "registry_version_mismatch"


# ─── GET hyphen-join candidates ──────────────────────────────────────────────


def test_get_hyphen_join_candidates_404_when_no_text(tmp_path):
    """GET .../hyphen-join/candidates → 404 when no text artifact available."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1")
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/data/projects/proj1/pages/0/stages/hyphen-join/candidates")
    assert r.status_code == 404


def test_get_hyphen_join_candidates_returns_candidates(tmp_path):
    """GET .../hyphen-join/candidates → 200 with candidates list."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1")
    # Seed a hyphen_join artifact with text containing a candidate
    text_with_hyphen = "This is a long\nword-\ncontinued text."
    # Actually the pattern is <word>-\n<word> — let's use a proper candidate
    text_with_hyphen = "The quick ex-\nample text here."
    artifact_bytes = text_with_hyphen.encode("utf-8")
    asyncio.run(_seed_clean_stage(settings, "proj1", "0000", "hyphen_join", artifact_bytes))
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/data/projects/proj1/pages/0/stages/hyphen-join/candidates")
    assert r.status_code == 200
    body = r.json()
    assert "candidates" in body
    assert "page_id" in body
    assert body["stage_id"] == "hyphen_join"


def test_get_hyphen_join_candidates_404_unknown_project(tmp_path):
    """GET .../hyphen-join/candidates → 404 for unknown project."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1")
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/data/projects/no-such/pages/0/stages/hyphen-join/candidates")
    assert r.status_code == 404


def test_get_hyphen_join_candidates_409_v1_project(tmp_path):
    """GET .../hyphen-join/candidates → 409 for v1 project."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1", registry_version=1)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/data/projects/proj1/pages/0/stages/hyphen-join/candidates")
    assert r.status_code == 409
    assert r.json()["error"] == "registry_version_mismatch"


# ─── POST hyphen-join decisions ──────────────────────────────────────────────


def test_post_hyphen_join_decisions_returns_candidates(tmp_path):
    """POST .../hyphen-join/decisions → 200 with updated candidates."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1")
    text_with_hyphen = "The ex-\nample is here."
    artifact_bytes = text_with_hyphen.encode("utf-8")
    asyncio.run(_seed_clean_stage(settings, "proj1", "0000", "hyphen_join", artifact_bytes))
    app = build_app(settings)
    with TestClient(app) as client:
        # First get candidates to obtain a candidate_id
        r_get = client.get("/api/data/projects/proj1/pages/0/stages/hyphen-join/candidates")
        assert r_get.status_code == 200
        candidates = r_get.json()["candidates"]
        assert len(candidates) >= 1
        candidate_id = candidates[0]["candidate_id"]

        r = client.post(
            "/api/data/projects/proj1/pages/0/stages/hyphen-join/decisions",
            json={"decisions": [{"candidate_id": candidate_id, "decision": "join"}]},
        )
    assert r.status_code == 200
    body = r.json()
    assert "candidates" in body


def test_post_hyphen_join_decisions_404_when_no_artifact(tmp_path):
    """POST .../hyphen-join/decisions → 404 when no artifact."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1")
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post(
            "/api/data/projects/proj1/pages/0/stages/hyphen-join/decisions",
            json={"decisions": []},
        )
    assert r.status_code == 404
