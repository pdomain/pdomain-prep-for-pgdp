"""W1.2 — wordcheck flags the shipped scanno seed and still passes prose through."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

import pytest

from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pdomain_prep_for_pgdp.core.models import (
    PageProcessingStatus,
    PageRecord,
    PageStageStatus,
    Project,
    ProjectConfig,
    ProjectStatus,
)
from pdomain_prep_for_pgdp.core.pipeline.page_stage_writer import commit_stage_artifacts_multi
from pdomain_prep_for_pgdp.core.pipeline.stage_runner import run_stage
from pdomain_prep_for_pgdp.core.pipeline.steps.scanno_seed import pptext_scanno_words
from pdomain_prep_for_pgdp.core.pipeline.steps.wordcheck import wordcheck_v2_cpu
from tests.fixtures.seed_pages import seed_pages_in_store

_PROSE = "The arid land and teh cat.\n"


def _words(*texts: str) -> bytes:
    payload = [
        {
            "id": f"w{index}",
            "text": text,
            "confidence": 0.9,
            "bounding_box": {"x": index * 10, "y": 0, "w": 8, "h": 8},
            "deleted": False,
        }
        for index, text in enumerate(texts)
    ]
    return json.dumps(payload).encode("utf-8")


def test_pptext_seed_includes_known_stealth_scanno() -> None:
    words = pptext_scanno_words()
    assert "arid" in words
    assert "tho" in words
    assert "modem" in words
    assert "Arid" in words
    assert len(words) > 24


def test_default_wordcheck_flags_pptext_word_and_keeps_prose() -> None:
    result = wordcheck_v2_cpu(_words("arid", "teh", "Hello"), _PROSE.encode("utf-8"))
    flags = json.loads(result["flags.json"].decode("utf-8"))
    flagged = {item["word_text"] for item in flags["flags"]}
    assert "arid" in flagged
    assert "teh" in flagged
    assert flags["flagged_count"] > 0
    assert result["output.txt"] == _PROSE.encode("utf-8")


def test_project_good_word_suppresses_seed_flag() -> None:
    from pdomain_prep_for_pgdp.core.pipeline.stage_registry import default_resolved_page_config

    cfg = default_resolved_page_config().model_copy(update={"wordcheck_good_words": ["arid"]})
    result = wordcheck_v2_cpu(_words("arid", "teh"), _PROSE.encode("utf-8"), cfg)
    flags = json.loads(result["flags.json"].decode("utf-8"))
    flagged = {item["word_text"] for item in flags["flags"]}
    assert "arid" not in flagged
    assert "teh" in flagged


def test_project_bad_word_is_unioned() -> None:
    from pdomain_prep_for_pgdp.core.pipeline.stage_registry import default_resolved_page_config

    cfg = default_resolved_page_config().model_copy(update={"wordcheck_bad_words": ["zzzx"]})
    result = wordcheck_v2_cpu(_words("zzzx"), b"zzzx\n", cfg)
    flags = json.loads(result["flags.json"].decode("utf-8"))
    assert flags["flagged_count"] == 1
    assert flags["flags"][0]["word_text"] == "zzzx"
    assert result["output.txt"] == b"zzzx\n"


@pytest.fixture
async def db(tmp_path: Path) -> SqliteDatabase:
    database = SqliteDatabase(f"sqlite:///{(tmp_path / 's.db').as_posix()}")
    await database.initialize()
    return database


@pytest.mark.asyncio
async def test_runner_flags_arid_and_package_text_stays_prose(
    tmp_path: Path,
    db: SqliteDatabase,
) -> None:
    project_id, page_id = "w12", "0000"
    now = datetime.now(UTC)
    await db.put_project(
        Project(
            id=project_id,
            owner_id="default",
            name="w12",
            created_at=now,
            updated_at=now,
            status=ProjectStatus.processing,
            page_count=1,
            proof_page_count=1,
            config=ProjectConfig(
                book_name="w12",
                source_uri="",
                wordcheck_good_words=["cat"],
            ),
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
        stage_id="ocr",
        files={
            "words.json": _words("arid", "teh", "cat"),
            "raw.txt": _PROSE.encode("utf-8"),
        },
        primary_filename="words.json",
    )

    for stage_id in ("wordcheck", "hyphen_join", "regex", "text_review"):
        state = await run_stage(
            data_root=tmp_path,
            database=db,
            project_id=project_id,
            page_id=page_id,
            stage_id=stage_id,
        )
        assert state.status == PageStageStatus.clean, f"{stage_id} failed: {state.error_message!r}"

    stage_dir = tmp_path / "projects" / project_id / "pages" / page_id / "stages"
    flags = json.loads((stage_dir / "wordcheck" / "flags.json").read_text(encoding="utf-8"))
    flagged = {item["word_text"] for item in flags["flags"]}
    assert "arid" in flagged
    assert "teh" in flagged
    assert "cat" not in flagged

    review = (stage_dir / "text_review" / "output.txt").read_text(encoding="utf-8")
    assert review == _PROSE
    assert "flags" not in review
