"""W1.3 — hyphen decisions persist, rewrite stage text, and replay on re-run."""

from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pdomain_prep_for_pgdp.bootstrap import build_app
from pdomain_prep_for_pgdp.core.models import (
    PageProcessingStatus,
    PageRecord,
    PageStageStatus,
    Project,
    ProjectConfig,
    ProjectStatus,
)
from pdomain_prep_for_pgdp.core.pipeline.page_stage_writer import (
    commit_stage_artifact,
    commit_stage_artifacts_multi,
)
from pdomain_prep_for_pgdp.core.pipeline.stage_registry import default_resolved_page_config
from pdomain_prep_for_pgdp.core.pipeline.stage_runner import run_stage
from pdomain_prep_for_pgdp.core.pipeline.steps.hyphen_decisions import (
    load_hyphen_source_text,
    save_hyphen_decisions,
)
from pdomain_prep_for_pgdp.core.pipeline.steps.hyphen_join import detect_candidates
from pdomain_prep_for_pgdp.settings import Settings
from tests.fixtures.seed_pages import seed_pages_in_store

_TEXT = "The ex-\nample is here.\n"


def _settings(tmp_path: Path) -> Settings:
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


def _seed_project(settings: Settings, project_id: str = "proj1") -> None:
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
                storage_prefix=f"projects/{project_id}/",
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


async def _seed_text_stage(settings: Settings, stage_id: str, payload: bytes) -> None:
    db = SqliteDatabase(settings.derived_database_url)
    await db.initialize()
    try:
        await db.init_page_stages_for_page("proj1", "0000")
        await commit_stage_artifact(
            data_root=settings.data_root,
            database=db,
            project_id="proj1",
            page_id="0000",
            stage_id=stage_id,
            artifact_bytes=payload,
        )
    finally:
        await db.close()


def _stage_file(root: Path, stage_id: str, name: str) -> Path:
    return root / "projects" / "proj1" / "pages" / "0000" / "stages" / stage_id / name


def test_post_join_survives_reload_and_rewrites_output(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    _seed_project(settings)
    asyncio.run(_seed_text_stage(settings, "hyphen_join", _TEXT.encode("utf-8")))
    asyncio.run(_seed_text_stage(settings, "regex", b"stale regex\n"))
    app = build_app(settings)
    with TestClient(app) as client:
        listed = client.get("/api/data/projects/proj1/pages/0/stages/hyphen-join/candidates")
        assert listed.status_code == 200
        candidate_id = listed.json()["candidates"][0]["candidate_id"]
        posted = client.post(
            "/api/data/projects/proj1/pages/0/stages/hyphen-join/decisions",
            json={"decisions": [{"candidate_id": candidate_id, "decision": "join"}]},
        )
        assert posted.status_code == 200
        assert posted.json()["candidates"][0]["decision"] == "join"
        again = client.get("/api/data/projects/proj1/pages/0/stages/hyphen-join/candidates")
    assert again.status_code == 200
    assert again.json()["candidates"][0]["decision"] == "join"
    assert again.json()["candidates"][0]["candidate_id"] == candidate_id

    output = _stage_file(settings.data_root, "hyphen_join", "output.txt").read_text(encoding="utf-8")
    source = _stage_file(settings.data_root, "hyphen_join", "source.txt").read_text(encoding="utf-8")
    saved = json.loads(
        _stage_file(settings.data_root, "hyphen_join", "decisions.json").read_text(encoding="utf-8")
    )
    assert output == "The example is here.\n"
    assert source == _TEXT
    assert saved["decisions"] == [{"candidate_id": candidate_id, "decision": "join"}]

    async def regex_status() -> str:
        db = SqliteDatabase(settings.derived_database_url)
        await db.initialize()
        try:
            row = await db.get_page_stage("proj1", "0000", "regex")
            assert row is not None
            return row.status.value
        finally:
            await db.close()

    assert asyncio.run(regex_status()) == PageStageStatus.dirty.value


def test_post_keep_leaves_hyphen_and_later_join_replaces_it(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    _seed_project(settings)
    asyncio.run(_seed_text_stage(settings, "hyphen_join", _TEXT.encode("utf-8")))
    app = build_app(settings)
    with TestClient(app) as client:
        listed = client.get("/api/data/projects/proj1/pages/0/stages/hyphen-join/candidates")
        candidate_id = listed.json()["candidates"][0]["candidate_id"]
        kept = client.post(
            "/api/data/projects/proj1/pages/0/stages/hyphen-join/decisions",
            json={"decisions": [{"candidate_id": candidate_id, "decision": "keep"}]},
        )
        assert kept.status_code == 200
        assert kept.json()["candidates"][0]["decision"] == "keep"
        joined = client.post(
            "/api/data/projects/proj1/pages/0/stages/hyphen-join/decisions",
            json={"decisions": [{"candidate_id": candidate_id, "decision": "join"}]},
        )
        assert joined.json()["candidates"][0]["decision"] == "join"
    output = _stage_file(settings.data_root, "hyphen_join", "output.txt").read_text(encoding="utf-8")
    assert output == "The example is here.\n"


def test_source_prefers_wordcheck_prose_over_joined_output(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    _seed_project(settings)
    asyncio.run(_seed_text_stage(settings, "hyphen_join", b"The example is here.\n"))
    wordcheck = _stage_file(settings.data_root, "wordcheck", "output.txt")
    wordcheck.parent.mkdir(parents=True, exist_ok=True)
    _ = wordcheck.write_text(_TEXT, encoding="utf-8")
    assert load_hyphen_source_text(settings.data_root, "proj1", "0000") == _TEXT
    app = build_app(settings)
    with TestClient(app) as client:
        listed = client.get("/api/data/projects/proj1/pages/0/stages/hyphen-join/candidates")
    assert listed.status_code == 200
    assert len(listed.json()["candidates"]) == 1


@pytest.fixture
async def db(tmp_path: Path) -> SqliteDatabase:
    database = SqliteDatabase(f"sqlite:///{(tmp_path / 's.db').as_posix()}")
    await database.initialize()
    return database


async def _seed_runner_page(tmp_path: Path, db: SqliteDatabase) -> str:
    project_id, page_id = "w13", "0000"
    now = datetime.now(UTC)
    await db.put_project(
        Project(
            id=project_id,
            owner_id="default",
            name="w13",
            created_at=now,
            updated_at=now,
            status=ProjectStatus.processing,
            page_count=1,
            proof_page_count=1,
            config=ProjectConfig(book_name="w13", source_uri=""),
            storage_prefix=f"projects/{project_id}/",
        )
    )
    seed_pages_in_store(
        tmp_path,
        project_id,
        [
            PageRecord(
                project_id=project_id,
                idx0=0,
                prefix="000",
                source_stem="s",
                processing_status=PageProcessingStatus.pending,
            )
        ],
    )
    await db.init_page_stages_for_page(project_id, page_id)
    await commit_stage_artifacts_multi(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=page_id,
        stage_id="wordcheck",
        files={
            "flags.json": b'{"flags":[],"flagged_count":0,"total_words":1}',
            "output.txt": _TEXT.encode("utf-8"),
        },
        primary_filename="output.txt",
    )
    return detect_candidates(_TEXT)[0]["candidate_id"]


def _hyphen_output(tmp_path: Path) -> str:
    return (
        tmp_path / "projects" / "w13" / "pages" / "0000" / "stages" / "hyphen_join" / "output.txt"
    ).read_text(encoding="utf-8")


@pytest.mark.asyncio
async def test_runner_is_identity_without_decisions(tmp_path: Path, db: SqliteDatabase) -> None:
    _ = await _seed_runner_page(tmp_path, db)
    state = await run_stage(
        data_root=tmp_path,
        database=db,
        project_id="w13",
        page_id="0000",
        stage_id="hyphen_join",
    )
    assert state.status == PageStageStatus.clean
    assert _hyphen_output(tmp_path) == _TEXT


@pytest.mark.asyncio
async def test_runner_applies_saved_decisions_over_caller_config(tmp_path: Path, db: SqliteDatabase) -> None:
    candidate_id = await _seed_runner_page(tmp_path, db)
    save_hyphen_decisions(
        tmp_path,
        "w13",
        "0000",
        [{"candidate_id": candidate_id, "decision": "join"}],
    )
    caller = default_resolved_page_config().model_copy(
        update={"hyphen_join_decisions": [{"candidate_id": candidate_id, "decision": "keep"}]}
    )
    state = await run_stage(
        data_root=tmp_path,
        database=db,
        project_id="w13",
        page_id="0000",
        stage_id="hyphen_join",
        resolved_config=caller,
    )
    assert state.status == PageStageStatus.clean
    assert _hyphen_output(tmp_path) == "The example is here.\n"


@pytest.mark.asyncio
async def test_runner_keeps_caller_decisions_when_disk_is_empty(tmp_path: Path, db: SqliteDatabase) -> None:
    candidate_id = await _seed_runner_page(tmp_path, db)
    caller = default_resolved_page_config().model_copy(
        update={"hyphen_join_decisions": [{"candidate_id": candidate_id, "decision": "join"}]}
    )
    state = await run_stage(
        data_root=tmp_path,
        database=db,
        project_id="w13",
        page_id="0000",
        stage_id="hyphen_join",
        resolved_config=caller,
    )
    assert state.status == PageStageStatus.clean
    assert _hyphen_output(tmp_path) == "The example is here.\n"
