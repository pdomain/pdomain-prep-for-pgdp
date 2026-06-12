"""FTS5 full-text search — SQLite backend.

Spec: docs/specs/2026-05-11-search-across-pages-design.md
Issue: #74 — SQLite FTS5 table + text_review clean-write upsert (v2).

Acceptance bullets verified here:
 A. A successful text_review clean write upserts the FTS5 row within
    the same transaction (search returns results immediately after commit).
 B. Searching a term that appears only in a split child returns the child's
    page row, not the parent's.
 C. Re-running text_review on a page with changed content produces
    updated text in the FTS5 row; old text is gone.
 D. pgdp-prep reindex --heal repairs index drift without data loss.
 E. Local FTS5 score is mapped to the normalized [0.0, 1.0] range.

In v2, ``text_review`` is the final attested text stage (compound output:
``output.txt`` + ``attestation.json``). It replaces v1 ``text_postprocess``
as the FTS trigger. Seeded via ``commit_stage_artifacts_multi``.
"""

from __future__ import annotations

import io
import json
from datetime import UTC, datetime
from typing import TYPE_CHECKING

import pytest

from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pdomain_prep_for_pgdp.cli.reindex import _parse_args, _run
from pdomain_prep_for_pgdp.core.models import (
    Project,
    ProjectConfig,
    ProjectStatus,
)
from pdomain_prep_for_pgdp.core.pipeline.page_stage_writer import (
    commit_stage_artifact,
    commit_stage_artifacts_multi,
)

if TYPE_CHECKING:
    from pathlib import Path


def _text_review_files(text: str) -> dict[str, bytes]:
    """Build the minimal text_review compound-output files dict."""
    return {
        "output.txt": text.encode("utf-8"),
        "attestation.json": json.dumps({"attested_by": "human", "version": 1}).encode(),
    }


@pytest.fixture
async def db(tmp_path: Path) -> SqliteDatabase:
    d = SqliteDatabase(f"sqlite:///{(tmp_path / 's.db').as_posix()}")
    await d.initialize()
    return d


def _project(project_id: str = "proj1") -> Project:
    now = datetime.now(UTC)
    return Project(
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


@pytest.mark.asyncio
async def test_text_review_commit_upserts_fts(tmp_path: Path, db: SqliteDatabase) -> None:
    """After committing a text_review artifact, search returns the text."""
    text = "The quick brown fox jumps over the lazy dog"
    await commit_stage_artifacts_multi(
        data_root=tmp_path,
        database=db,
        project_id="p1",
        page_id="0042",
        stage_id="text_review",
        files=_text_review_files(text),
        primary_filename="output.txt",
        idx0=42,
    )
    results, total = await db.search("p1", "fox")
    assert total >= 1
    assert any(r.page_id == "0042" for r in results)


@pytest.mark.asyncio
async def test_text_review_commit_upserts_fts_multi_word(tmp_path: Path, db: SqliteDatabase) -> None:
    """Phrase search also finds the indexed page."""
    text = "Chapter Seven begins here with a notable passage"
    await commit_stage_artifacts_multi(
        data_root=tmp_path,
        database=db,
        project_id="p1",
        page_id="0007",
        stage_id="text_review",
        files=_text_review_files(text),
        primary_filename="output.txt",
        idx0=7,
    )
    results, total = await db.search("p1", "notable passage")
    assert total >= 1
    result = next(r for r in results if r.page_id == "0007")
    assert result.idx0 == 7


@pytest.mark.asyncio
async def test_non_text_review_stage_does_not_populate_fts(tmp_path: Path, db: SqliteDatabase) -> None:
    """Committing a non-text stage (e.g. threshold) does not create FTS entries."""
    await commit_stage_artifact(
        data_root=tmp_path,
        database=db,
        project_id="p1",
        page_id="0001",
        stage_id="threshold",
        artifact_bytes=b"\x89PNG\r\n\x1a\n" + b"\x00" * 100,
    )
    _, total = await db.search("p1", "fox")
    assert total == 0


@pytest.mark.asyncio
async def test_split_child_indexed_independently(tmp_path: Path, db: SqliteDatabase) -> None:
    """A split child with unique text is found; parent with other text is not."""
    parent_text = "Ordinary parent page text about nothing special"
    child_text = "Unique term xylophone appears only on the split child"

    # Index parent
    await commit_stage_artifacts_multi(
        data_root=tmp_path,
        database=db,
        project_id="p1",
        page_id="0010",
        stage_id="text_review",
        files=_text_review_files(parent_text),
        primary_filename="output.txt",
        idx0=10,
    )
    # Index split child (different page_id, same idx0 space)
    await commit_stage_artifacts_multi(
        data_root=tmp_path,
        database=db,
        project_id="p1",
        page_id="0010a",
        stage_id="text_review",
        files=_text_review_files(child_text),
        primary_filename="output.txt",
        idx0=10,
    )

    results, total = await db.search("p1", "xylophone")
    assert total >= 1
    ids = [r.page_id for r in results]
    assert "0010a" in ids
    assert "0010" not in ids


@pytest.mark.asyncio
async def test_rerun_text_review_replaces_fts_row(tmp_path: Path, db: SqliteDatabase) -> None:
    """After re-running text_review with new text, old text is gone."""
    old_text = "oldword uniquetoken alpha"
    new_text = "freshword newtoken beta"

    await commit_stage_artifacts_multi(
        data_root=tmp_path,
        database=db,
        project_id="p1",
        page_id="0003",
        stage_id="text_review",
        files=_text_review_files(old_text),
        primary_filename="output.txt",
        idx0=3,
    )

    old_results, _ = await db.search("p1", "uniquetoken")
    assert any(r.page_id == "0003" for r in old_results)

    # Re-run with new content
    await commit_stage_artifacts_multi(
        data_root=tmp_path,
        database=db,
        project_id="p1",
        page_id="0003",
        stage_id="text_review",
        files=_text_review_files(new_text),
        primary_filename="output.txt",
        idx0=3,
    )

    # Old text should be gone
    _, old_total = await db.search("p1", "uniquetoken")
    assert old_total == 0

    # New text should be present
    new_after, new_total = await db.search("p1", "newtoken")
    assert new_total >= 1
    assert any(r.page_id == "0003" for r in new_after)


@pytest.mark.asyncio
async def test_reindex_heal_repairs_missing_fts_entry(tmp_path: Path) -> None:
    """--heal populates FTS for pages with clean text_review artifacts but no FTS row."""
    import pdomain_prep_for_pgdp.cli.reindex as _reindex_mod
    from pdomain_prep_for_pgdp.settings import Settings

    data_root = tmp_path / "data"
    data_root.mkdir(parents=True, exist_ok=True)
    db_url = f"sqlite:///{(tmp_path / 'state.db').as_posix()}"

    db = SqliteDatabase(db_url)
    await db.initialize()

    project = _project("proj1")
    await db.put_project(project)

    # Commit text_review artifact WITHOUT idx0 (simulating pre-FTS state:
    # the commit_stage_artifacts_multi FTS path is skipped when idx0=None).
    text = "driftword unique ancient content"
    await commit_stage_artifacts_multi(
        data_root=data_root,
        database=db,
        project_id="proj1",
        page_id="0000",
        stage_id="text_review",
        files=_text_review_files(text),
        primary_filename="output.txt",
        # No idx0 → FTS not populated
    )

    # Verify FTS is empty before heal
    _, total_before = await db.search("proj1", "driftword")
    assert total_before == 0
    await db.close()

    # Run reindex --heal (which should also repair FTS drift)
    monkey_settings = Settings(
        data_root=data_root,
        config_dir=tmp_path / "config",
        database_url=db_url,
        gpu_backend="cpu",
        auth_mode="none",
        dispatch_interval_seconds=0,
    )
    saved = _reindex_mod.Settings
    _reindex_mod.Settings = lambda: monkey_settings  # type: ignore[assignment,misc]
    try:
        args = _parse_args(["proj1", "--heal"])
        buf = io.StringIO()
        rc = await _run(args, stdout=buf)
        assert rc == 0
    finally:
        _reindex_mod.Settings = saved

    # Verify FTS is now populated
    db2 = SqliteDatabase(db_url)
    await db2.initialize()
    results_after, total_after = await db2.search("proj1", "driftword")
    assert total_after >= 1
    assert any(r.page_id == "0000" for r in results_after)
    await db2.close()


@pytest.mark.asyncio
async def test_search_score_normalized_range(tmp_path: Path, db: SqliteDatabase) -> None:
    """All search result scores are in [0.0, 1.0]."""
    texts = [
        ("0000", 0, "alpha beta gamma delta epsilon"),
        ("0001", 1, "beta gamma delta epsilon zeta"),
        ("0002", 2, "gamma delta epsilon zeta eta"),
    ]
    for page_id, idx0, text in texts:
        await commit_stage_artifacts_multi(
            data_root=tmp_path,
            database=db,
            project_id="p1",
            page_id=page_id,
            stage_id="text_review",
            files=_text_review_files(text),
            primary_filename="output.txt",
            idx0=idx0,
        )

    results, total = await db.search("p1", "gamma")
    assert total >= 1
    for r in results:
        assert 0.0 <= r.score <= 1.0, f"score {r.score} out of [0, 1] range"


@pytest.mark.asyncio
async def test_search_pagination(tmp_path: Path, db: SqliteDatabase) -> None:
    """limit + offset return correct pages, total_count is accurate."""
    for i in range(5):
        await commit_stage_artifacts_multi(
            data_root=tmp_path,
            database=db,
            project_id="p1",
            page_id=f"{i:04d}",
            stage_id="text_review",
            files=_text_review_files(f"keyword content page {i}"),
            primary_filename="output.txt",
            idx0=i,
        )

    _, total = await db.search("p1", "keyword", limit=100, offset=0)
    assert total == 5

    page1, _ = await db.search("p1", "keyword", limit=2, offset=0)
    page2, _ = await db.search("p1", "keyword", limit=2, offset=2)
    assert len(page1) == 2
    assert len(page2) == 2
    assert {r.page_id for r in page1}.isdisjoint({r.page_id for r in page2})


@pytest.mark.asyncio
async def test_long_s_normalization(tmp_path: Path, db: SqliteDatabase) -> None:
    """Long-s (U+017F) in indexed text is found by searching with regular s."""
    long_s = chr(0x17F)
    text = f"The la{long_s}t word wa{long_s} {long_s}aid"
    await commit_stage_artifacts_multi(
        data_root=tmp_path,
        database=db,
        project_id="p1",
        page_id="0099",
        stage_id="text_review",
        files=_text_review_files(text),
        primary_filename="output.txt",
        idx0=99,
    )
    # Searching with regular 's' should find the long-s text
    results, total = await db.search("p1", "last")
    assert total >= 1
    assert any(r.page_id == "0099" for r in results)


@pytest.mark.asyncio
async def test_search_is_scoped_to_project(tmp_path: Path, db: SqliteDatabase) -> None:
    """Search results are scoped to one project; other projects' text is not returned."""
    await commit_stage_artifacts_multi(
        data_root=tmp_path,
        database=db,
        project_id="p1",
        page_id="0000",
        stage_id="text_review",
        files=_text_review_files("unique rareword belongs to project one"),
        primary_filename="output.txt",
        idx0=0,
    )
    await commit_stage_artifacts_multi(
        data_root=tmp_path,
        database=db,
        project_id="p2",
        page_id="0000",
        stage_id="text_review",
        files=_text_review_files("other rareword belongs to project two"),
        primary_filename="output.txt",
        idx0=0,
    )
    results_p1, total_p1 = await db.search("p1", "rareword")
    assert total_p1 == 1
    assert results_p1[0].page_id == "0000"

    _, total_p2 = await db.search("p2", "rareword")
    assert total_p2 == 1
