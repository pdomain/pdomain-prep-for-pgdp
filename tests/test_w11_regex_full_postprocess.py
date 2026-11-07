"""W1.1 — regex stage runs the full Step-8 postprocess."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

import pytest

from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pdomain_prep_for_pgdp.core.config_resolver import resolve_page_config
from pdomain_prep_for_pgdp.core.models import (
    PageProcessingStatus,
    PageRecord,
    PageStageStatus,
    Project,
    ProjectConfig,
    ProjectStatus,
    SystemDefaults,
)
from pdomain_prep_for_pgdp.core.pipeline.page_stage_writer import commit_stage_artifacts_multi
from pdomain_prep_for_pgdp.core.pipeline.stage_registry import _text_postprocess_cpu
from pdomain_prep_for_pgdp.core.pipeline.stage_runner import run_stage
from tests.fixtures.seed_pages import seed_pages_in_store

_PAGE_TEXT = "The quick “fox” good-\nbye — yes !\n"


@pytest.fixture
async def db(tmp_path: Path) -> SqliteDatabase:
    database = SqliteDatabase(f"sqlite:///{(tmp_path / 's.db').as_posix()}")
    await database.initialize()
    return database


def _stage_dir(data_root: Path, project_id: str, page_id: str, stage_id: str) -> Path:
    return data_root / "projects" / project_id / "pages" / page_id / "stages" / stage_id


def test_regex_callable_applies_scanno_quote_and_dash() -> None:
    from pdomain_prep_for_pgdp.core.pipeline.stage_registry import default_resolved_page_config

    cfg = default_resolved_page_config().model_copy(
        update={
            "standard_scannos": {"quick": "QUICK"},
            "custom_scannos": {"fox": "FOX"},
            "hyphenation_join_list": ["good"],
            "custom_regex_passes": [(r"\s+!", "!")],
        }
    )
    out = _text_postprocess_cpu(_PAGE_TEXT.encode("utf-8"), cfg)
    assert "QUICK" in out
    assert "FOX" in out
    assert "goodbye" in out
    assert "--" in out
    assert "yes!" in out
    assert "“" not in out
    assert "—" not in out


def test_resolve_page_config_copies_text_tables() -> None:
    system = SystemDefaults(
        standard_scannos={"quick": "QUICK"},
        hyphenation_join_list=["good"],
    )
    project = ProjectConfig(
        book_name="B",
        source_uri="",
        custom_scannos={"fox": "FOX"},
        custom_regex_passes=[(r"\s+!", "!")],
        wordcheck_bad_words=["zzzx"],
        wordcheck_good_words=["arid"],
    )
    page = PageRecord(project_id="p", idx0=0, prefix="000", source_stem="s")
    cfg = resolve_page_config(system, project, page)
    assert cfg.standard_scannos == {"quick": "QUICK"}
    assert cfg.custom_scannos == {"fox": "FOX"}
    assert cfg.hyphenation_join_list == ["good"]
    assert cfg.custom_regex_passes == [(r"\s+!", "!")]
    assert cfg.wordcheck_bad_words == ["zzzx"]
    assert cfg.wordcheck_good_words == ["arid"]
    assert cfg.hyphen_join_decisions == []


@pytest.mark.asyncio
async def test_runner_chain_applies_scanno_and_keeps_prose(
    tmp_path: Path,
    db: SqliteDatabase,
) -> None:
    """ocr → wordcheck → hyphen_join → regex → text_review applies a real scanno."""
    project_id, page_id = "w11", "0000"
    now = datetime.now(UTC)
    await db.put_project(
        Project(
            id=project_id,
            owner_id="default",
            name="w11",
            created_at=now,
            updated_at=now,
            status=ProjectStatus.processing,
            page_count=1,
            proof_page_count=1,
            config=ProjectConfig(
                book_name="w11",
                source_uri="",
                custom_scannos={"fox": "FOX"},
                custom_regex_passes=[(r"\s+!", "!")],
            ),
            storage_prefix=f"projects/{project_id}/",
        )
    )
    await db.put_system_defaults(
        "default",
        SystemDefaults(
            standard_scannos={"quick": "QUICK"},
            hyphenation_join_list=["good"],
        ),
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
            "words.json": json.dumps(
                [
                    {
                        "id": "w1",
                        "text": "quick",
                        "confidence": 0.99,
                        "bounding_box": {"x": 0, "y": 0, "w": 10, "h": 10},
                        "deleted": False,
                    }
                ]
            ).encode("utf-8"),
            "raw.txt": _PAGE_TEXT.encode("utf-8"),
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

    wordcheck_text = (_stage_dir(tmp_path, project_id, page_id, "wordcheck") / "output.txt").read_text(
        encoding="utf-8"
    )
    assert wordcheck_text == _PAGE_TEXT
    assert not wordcheck_text.lstrip().startswith("{")

    regex_text = (_stage_dir(tmp_path, project_id, page_id, "regex") / "output.txt").read_text(
        encoding="utf-8"
    )
    review_text = (_stage_dir(tmp_path, project_id, page_id, "text_review") / "output.txt").read_text(
        encoding="utf-8"
    )
    assert review_text == regex_text
    assert "QUICK" in review_text
    assert "FOX" in review_text
    assert "goodbye" in review_text
    assert "yes!" in review_text
    assert "“" not in review_text
    assert "—" not in review_text
    assert '"flags"' not in review_text
