"""W0.0 / W0.1 — text-chain artifact contract (B0 + B1).

Issue: docs/issues/2026-07-21-w00-text-chain-contract.md
Plan:  docs/plans/2026-07-21-pipeline-completion-review.md § Text-chain data contract

Contract:
  - OCR emits words.json + raw.txt
  - wordcheck loads words JSON (not raw.txt); still emits flags for the UI
  - wordcheck also dual-writes page text so the text DAG stays prose
  - hyphen_join → regex → text_review consume UTF-8 prose, never flags JSON
  - text_review output.txt is real page text
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import TYPE_CHECKING

import pytest

from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pdomain_prep_for_pgdp.core.models import PageStageStatus
from pdomain_prep_for_pgdp.core.pipeline.page_stage_writer import commit_stage_artifacts_multi
from pdomain_prep_for_pgdp.core.pipeline.stage_runner import run_stage

if TYPE_CHECKING:
    pass


@pytest.fixture
async def db(tmp_path: Path) -> SqliteDatabase:
    d = SqliteDatabase(f"sqlite:///{(tmp_path / 's.db').as_posix()}")
    await d.initialize()
    return d


def _sample_words() -> list[dict[str, object]]:
    return [
        {
            "id": "w1",
            "text": "Hello",
            "confidence": 0.99,
            "bounding_box": {"x": 0, "y": 0, "w": 20, "h": 12},
            "deleted": False,
        },
        {
            "id": "w2",
            "text": "world",
            "confidence": 0.98,
            "bounding_box": {"x": 22, "y": 0, "w": 24, "h": 12},
            "deleted": False,
        },
        {
            "id": "w3",
            "text": "teh",  # known scanno — should flag
            "confidence": 0.7,
            "bounding_box": {"x": 50, "y": 0, "w": 16, "h": 12},
            "deleted": False,
        },
    ]


_PAGE_TEXT = "Hello world teh\n"


async def _seed_clean_ocr(
    *,
    db: SqliteDatabase,
    data_root: Path,
    project_id: str,
    page_id: str,
    words: list[dict[str, object]] | None = None,
    page_text: str = _PAGE_TEXT,
) -> None:
    await db.init_page_stages_for_page(project_id, page_id)
    words_payload = words if words is not None else _sample_words()
    await commit_stage_artifacts_multi(
        data_root=data_root,
        database=db,
        project_id=project_id,
        page_id=page_id,
        stage_id="ocr",
        files={
            "words.json": json.dumps(words_payload).encode("utf-8"),
            "raw.txt": page_text.encode("utf-8"),
        },
        primary_filename="words.json",
    )


def _stage_dir(data_root: Path, project_id: str, page_id: str, stage_id: str) -> Path:
    return data_root / "projects" / project_id / "pages" / page_id / "stages" / stage_id


def _assert_not_flags_json(text: str, *, label: str) -> None:
    """Page text must not be the wordcheck flags report masquerading as prose."""
    stripped = text.strip()
    assert stripped, f"{label} must be non-empty UTF-8 prose"
    if stripped.startswith("{"):
        try:
            parsed = json.loads(stripped)
        except json.JSONDecodeError:
            return
        assert "flags" not in parsed, (
            f"{label} looks like wordcheck flags JSON, not page prose: {stripped[:120]!r}"
        )


@pytest.mark.asyncio
async def test_wordcheck_loads_ocr_words_json_not_raw_txt(
    tmp_path: Path,
    db: SqliteDatabase,
) -> None:
    """B1: wordcheck must open OCR compound dir via words.json, not fail on missing output.*."""
    project_id, page_id = "tc1", "0000"
    await _seed_clean_ocr(db=db, data_root=tmp_path, project_id=project_id, page_id=page_id)

    state = await run_stage(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=page_id,
        stage_id="wordcheck",
    )
    assert state.status == PageStageStatus.clean

    stage_dir = _stage_dir(tmp_path, project_id, page_id, "wordcheck")
    flags_path = stage_dir / "flags.json"
    assert flags_path.is_file(), "wordcheck must dual-write flags.json for the workbench"
    flags = json.loads(flags_path.read_text(encoding="utf-8"))
    assert "flags" in flags
    assert flags["total_words"] == 3
    # "teh" is in the default scanno list
    assert flags["flagged_count"] >= 1


@pytest.mark.asyncio
async def test_wordcheck_dual_writes_page_text_passthrough(
    tmp_path: Path,
    db: SqliteDatabase,
) -> None:
    """B0 compound wordcheck: flags side product + output.txt pass-through of OCR prose."""
    project_id, page_id = "tc2", "0000"
    await _seed_clean_ocr(db=db, data_root=tmp_path, project_id=project_id, page_id=page_id)

    await run_stage(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=page_id,
        stage_id="wordcheck",
    )

    text_path = _stage_dir(tmp_path, project_id, page_id, "wordcheck") / "output.txt"
    assert text_path.is_file(), "wordcheck must emit output.txt for the text DAG"
    text = text_path.read_text(encoding="utf-8")
    assert text == _PAGE_TEXT
    _assert_not_flags_json(text, label="wordcheck output.txt")


@pytest.mark.asyncio
async def test_text_chain_ocr_to_text_review_is_utf8_prose(
    tmp_path: Path,
    db: SqliteDatabase,
) -> None:
    """Full chain: ocr → wordcheck → hyphen_join → regex → text_review.

    text_review output.txt must be UTF-8 prose matching the OCR page text
    (modulo hyphen/regex transforms), never wordcheck flags JSON.
    """
    project_id, page_id = "tc3", "0000"
    page_text = "The quick brown fox.\n"
    await _seed_clean_ocr(
        db=db,
        data_root=tmp_path,
        project_id=project_id,
        page_id=page_id,
        words=[
            {
                "id": "w1",
                "text": "The",
                "confidence": 0.99,
                "bounding_box": {"x": 0, "y": 0, "w": 10, "h": 10},
                "deleted": False,
            },
            {
                "id": "w2",
                "text": "quick",
                "confidence": 0.99,
                "bounding_box": {"x": 12, "y": 0, "w": 20, "h": 10},
                "deleted": False,
            },
        ],
        page_text=page_text,
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

    review_txt = _stage_dir(tmp_path, project_id, page_id, "text_review") / "output.txt"
    assert review_txt.is_file()
    final = review_txt.read_text(encoding="utf-8")
    _assert_not_flags_json(final, label="text_review output.txt")
    # Default hyphen_join/regex leave clean prose intact (no EOL hyphens / no quote transforms).
    assert "quick" in final
    assert "fox" in final
    assert "flags" not in final

    # Flags remain available as a side product, not as the text path.
    flags_path = _stage_dir(tmp_path, project_id, page_id, "wordcheck") / "flags.json"
    assert flags_path.is_file()
    flags = json.loads(flags_path.read_text(encoding="utf-8"))
    assert isinstance(flags.get("flags"), list)
