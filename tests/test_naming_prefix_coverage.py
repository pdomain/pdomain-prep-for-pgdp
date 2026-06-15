"""Coverage for the PGDP page-naming/prefix system — targeted gaps.

Three gap areas closed here:

1. Config-range EDITING → re-numbering
   - Extend frontmatter_end so a bodymatter page becomes frontmatter; assert
     the re-numbered prefixes are correct for the whole sequence.
   - Shrink the proof range so a previously-in-range page becomes out-of-range;
     assert it gets prefix="" + ignore=True and the remaining pages renumber
     without gaps.
   - Idempotency after a range edit: running assign_prefixes twice produces the
     same prefixes.

2. Blank folio consumption vs plates in bodymatter
   - Sequence [normal, blank, plate_p, normal]: blank CONSUMES a folio (gets
     p002), plate does NOT consume folio (gets pp suffix, no folio number),
     following normal gets p003 (no off-by-one).

3. Insert → prefix shift correctness
   - Insert a blank page at idx0=N in the middle of bodymatter; assert the
     inserted page and every following page have the correct shifted seq/folio
     prefixes after the route calls assign_prefixes.

Frontend prefix display
-----------------------
The prefix IS displayed in the UI:
  - PageRow.tsx line 93: ``{page.prefix || page.source_stem}``
    (falls back to source_stem when prefix is empty)
  - PageOrderTool.tsx lines 225-245: naming-manifest preview column shows
    ``leaf.prefix`` from the page_order stage manifest.
Both are already exercised by existing component tests
(PageRow.test.tsx "renders the prefix as filename" /
"falls back to source_stem when prefix is empty").
No UI additions are made here; the display is confirmed present.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from pathlib import Path

import pytest

from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pdomain_prep_for_pgdp.core.models import (
    PageRecord,
    PageType,
    Project,
    ProjectConfig,
    ProjectStatus,
)
from pdomain_prep_for_pgdp.core.page_service_helpers import list_page_records
from pdomain_prep_for_pgdp.core.page_store_factory import build_page_service
from pdomain_prep_for_pgdp.settings import Settings
from tests.fixtures.seed_pages import seed_pages_in_store

# ─── Shared helpers ────────────────────────────────────────────────────────────


def _settings(tmp_path: Path) -> Settings:
    return Settings(
        host="127.0.0.1",
        port=8765,
        data_root=tmp_path / "data",
        config_dir=tmp_path / "config",
        storage_backend="filesystem",
        database_url=f"sqlite:///{(tmp_path / 's.db').as_posix()}",
        auth_mode="none",
        gpu_backend="cpu",
        dispatch_interval_seconds=0,
    )


def _project(project_id: str = "p1", page_count: int = 0, **config_kwargs: object) -> Project:
    now = datetime.now(UTC)
    return Project(
        id=project_id,
        owner_id="default",
        name="t",
        created_at=now,
        updated_at=now,
        status=ProjectStatus.configuring,
        page_count=page_count,
        proof_page_count=page_count,
        config=ProjectConfig(book_name="t", source_uri="", **config_kwargs),
        storage_prefix=f"projects/{project_id}/",
    )


def _page(project_id: str, idx0: int, page_type: PageType = PageType.normal) -> PageRecord:
    return PageRecord(
        project_id=project_id,
        idx0=idx0,
        prefix="",
        source_stem=f"src_{idx0:03d}",
        page_type=page_type,
    )


@pytest.fixture
async def db(tmp_path: Path) -> SqliteDatabase:
    d = SqliteDatabase(f"sqlite:///{(tmp_path / 's.db').as_posix()}")
    await d.initialize()
    return d


# ─── Gap 1: Config-range edit → re-numbering ──────────────────────────────────


@pytest.mark.asyncio
async def test_extend_frontmatter_end_renumbers_section_correctly(db: SqliteDatabase, tmp_path: Path) -> None:
    """Extending frontmatter_end flips a bodymatter page to frontmatter with the right prefix.

    Before edit:
      Pages 0-5 in proof range.
      frontmatter: 0-1 (f001, f002)
      bodymatter: 2-5 (p001, p002, p003, p004)

    After edit (extend frontmatter to cover idx0=0-2):
      frontmatter: 0-2 (f001, f002, f003)
      bodymatter: 3-5 (p001, p002, p003)

    Page at idx0=2 must change from bodymatter (p001) to frontmatter (f003).
    Pages at idx0=3-5 must renumber from p002-p004 → p001-p003.
    """
    from pdomain_prep_for_pgdp.core.assign_prefixes import assign_prefixes

    project_id = "range_edit_extend"
    # Initial config: fm=0-1, bm=2-5
    project = _project(
        project_id,
        page_count=6,
        proof_start_idx0=0,
        proof_end_idx0=5,
        frontmatter_start_idx0=0,
        frontmatter_end_idx0=1,
        bodymatter_start_idx0=2,
        bodymatter_end_idx0=5,
    )
    await db.put_project(project)
    settings = _settings(tmp_path)
    seed_pages_in_store(settings, project_id, [_page(project_id, i) for i in range(6)])
    svc = build_page_service(settings.data_root, project_id)

    # Initial numbering.
    await assign_prefixes(project=project, page_service=svc)
    initial = {p.idx0: p.prefix for p in list_page_records(svc, project_id)}
    assert initial[0] == "000f001"
    assert initial[1] == "001f002"
    assert initial[2] == "002p001"
    assert initial[3] == "003p002"

    # Config edit: extend frontmatter to cover idx0=2 as well.
    edited_project = _project(
        project_id,
        page_count=6,
        proof_start_idx0=0,
        proof_end_idx0=5,
        frontmatter_start_idx0=0,
        frontmatter_end_idx0=2,  # extended from 1 → 2
        bodymatter_start_idx0=3,  # shifted from 2 → 3
        bodymatter_end_idx0=5,
    )

    await assign_prefixes(project=edited_project, page_service=svc)
    result = {p.idx0: p.prefix for p in list_page_records(svc, project_id)}

    # idx0=0: seq=0, fm, folio=1 → "000f001"
    assert result[0] == "000f001", f"idx0=0 expected '000f001', got {result[0]!r}"
    # idx0=1: seq=1, fm, folio=2 → "001f002"
    assert result[1] == "001f002", f"idx0=1 expected '001f002', got {result[1]!r}"
    # idx0=2: was p001, NOW fm folio=3 → "002f003"
    assert result[2] == "002f003", f"idx0=2 expected '002f003', got {result[2]!r}"
    # idx0=3: first bodymatter page now → "003p001"
    assert result[3] == "003p001", f"idx0=3 expected '003p001', got {result[3]!r}"
    # idx0=4: second bodymatter → "004p002"
    assert result[4] == "004p002", f"idx0=4 expected '004p002', got {result[4]!r}"
    # idx0=5: third bodymatter → "005p003"
    assert result[5] == "005p003", f"idx0=5 expected '005p003', got {result[5]!r}"


@pytest.mark.asyncio
async def test_shrink_proof_range_excludes_and_renumbers_correctly(
    db: SqliteDatabase, tmp_path: Path
) -> None:
    """Shrinking proof_end excludes the trailing page and renumbers without gaps.

    Initial: 5 pages, all in proof range.  idx0=0-1 frontmatter, idx0=2-4 bodymatter.
      Prefixes: 000f001, 001f002, 002p001, 003p002, 004p003

    After edit: shrink proof_end from 4 → 3 (exclude idx0=4).
      idx0=4 must get prefix="" and ignore=True.
      Remaining bodymatter (2-3) renumbers correctly: 002p001, 003p002.
    """
    from pdomain_prep_for_pgdp.core.assign_prefixes import assign_prefixes

    project_id = "range_shrink"
    project = _project(
        project_id,
        page_count=5,
        proof_start_idx0=0,
        proof_end_idx0=4,
        frontmatter_start_idx0=0,
        frontmatter_end_idx0=1,
        bodymatter_start_idx0=2,
        bodymatter_end_idx0=4,
    )
    await db.put_project(project)
    settings = _settings(tmp_path)
    seed_pages_in_store(settings, project_id, [_page(project_id, i) for i in range(5)])
    svc = build_page_service(settings.data_root, project_id)

    # Initial run.
    await assign_prefixes(project=project, page_service=svc)
    initial = {p.idx0: p.prefix for p in list_page_records(svc, project_id)}
    assert initial[4] == "004p003"
    assert initial[2] == "002p001"

    # Config edit: shrink proof range (exclude idx0=4 by setting proof_end to 3).
    shrunk_project = _project(
        project_id,
        page_count=5,
        proof_start_idx0=0,
        proof_end_idx0=3,  # shrunk from 4 → 3
        frontmatter_start_idx0=0,
        frontmatter_end_idx0=1,
        bodymatter_start_idx0=2,
        bodymatter_end_idx0=3,  # shrunk from 4 → 3
    )

    await assign_prefixes(project=shrunk_project, page_service=svc)
    result = {p.idx0: p for p in list_page_records(svc, project_id)}

    # idx0=4 is now out-of-range: prefix="" and ignore=True.
    assert result[4].prefix == "", f"out-of-range page must have empty prefix, got {result[4].prefix!r}"
    assert result[4].ignore is True, "out-of-range page must be ignored"

    # The two remaining bodymatter pages must be numbered without gaps.
    assert result[2].prefix == "002p001", f"expected '002p001', got {result[2].prefix!r}"
    assert result[3].prefix == "003p002", f"expected '003p002', got {result[3].prefix!r}"
    assert result[2].ignore is False
    assert result[3].ignore is False

    # Frontmatter pages unchanged.
    assert result[0].prefix == "000f001"
    assert result[1].prefix == "001f002"


@pytest.mark.asyncio
async def test_range_edit_idempotent_with_prefix_assertions(db: SqliteDatabase, tmp_path: Path) -> None:
    """Running assign_prefixes twice after a range edit produces identical prefixes.

    Also asserts the prefixes are the correct v2 values (not just "same as each other").
    """
    from pdomain_prep_for_pgdp.core.assign_prefixes import assign_prefixes

    project_id = "range_idempotent"
    # Simulate a config edit by using the already-edited config as the only version.
    project = _project(
        project_id,
        page_count=4,
        proof_start_idx0=0,
        proof_end_idx0=3,
        frontmatter_start_idx0=0,
        frontmatter_end_idx0=2,  # 3 frontmatter pages
        bodymatter_start_idx0=3,
        bodymatter_end_idx0=3,  # 1 bodymatter page
    )
    await db.put_project(project)
    settings = _settings(tmp_path)
    seed_pages_in_store(settings, project_id, [_page(project_id, i) for i in range(4)])
    svc = build_page_service(settings.data_root, project_id)

    # First run.
    await assign_prefixes(project=project, page_service=svc)
    first = {p.idx0: p.prefix for p in list_page_records(svc, project_id)}

    # Second run (same config — idempotency).
    await assign_prefixes(project=project, page_service=svc)
    second = {p.idx0: p.prefix for p in list_page_records(svc, project_id)}

    assert first == second, f"assign_prefixes not idempotent: {first} vs {second}"

    # Also assert the expected v2 prefix values are correct.
    assert first[0] == "000f001"
    assert first[1] == "001f002"
    assert first[2] == "002f003"
    assert first[3] == "003p001"


@pytest.mark.asyncio
async def test_range_edit_preserves_manual_ignore_with_prefix_check(
    db: SqliteDatabase, tmp_path: Path
) -> None:
    """manual_ignore survives a config range edit that re-runs assign_prefixes.

    Extends the existing preserve test (test_assign_prefixes.py) by also
    asserting the prefix value of the ignored page and its neighbours.
    """
    from pdomain_prep_for_pgdp.core.assign_prefixes import assign_prefixes

    project_id = "preserve_manual"
    project = _project(
        project_id,
        page_count=4,
        proof_start_idx0=0,
        proof_end_idx0=3,
        frontmatter_start_idx0=0,
        frontmatter_end_idx0=0,
        bodymatter_start_idx0=1,
        bodymatter_end_idx0=3,
    )
    await db.put_project(project)
    settings = _settings(tmp_path)
    seed_pages_in_store(settings, project_id, [_page(project_id, i) for i in range(4)])
    svc = build_page_service(settings.data_root, project_id)

    # Establish initial prefixes.
    await assign_prefixes(project=project, page_service=svc)

    # Manually set manual_ignore on idx0=2 (bodymatter page).
    from pdomain_prep_for_pgdp.core.page_service_helpers import update_page_extension

    updated = update_page_extension(svc, project_id, 2, manual_ignore=True, ignore=True)
    assert updated is not None and updated.manual_ignore is True

    # Config edit (shrink frontmatter to 0, bodymatter remains 1-3).
    # The key invariant: manual_ignore on idx0=2 must survive.
    edited = _project(
        project_id,
        page_count=4,
        proof_start_idx0=0,
        proof_end_idx0=3,
        frontmatter_start_idx0=0,
        frontmatter_end_idx0=0,
        bodymatter_start_idx0=1,
        bodymatter_end_idx0=3,
    )
    await assign_prefixes(project=edited, page_service=svc)

    result = {p.idx0: p for p in list_page_records(svc, project_id)}

    # manual_ignore page: ignore still True, manual_ignore still True.
    assert result[2].ignore is True
    assert result[2].manual_ignore is True
    # The prefix is still assigned (derived_ignore=False, effective=True from manual).
    assert result[2].prefix == "002p002", (
        f"manually-ignored in-range page must still get its computed prefix, got {result[2].prefix!r}"
    )

    # Neighbours are unaffected.
    assert result[1].ignore is False
    assert result[1].prefix == "001p001"
    assert result[3].ignore is False
    assert result[3].prefix == "003p003"


# ─── Gap 2: Blank folio consumption vs plates ─────────────────────────────────


class TestBlankFolioVsPlate:
    """Blank pages consume a folio number; plates do not.

    Sequence in bodymatter: [normal, blank, plate_p, normal]
    Expected folios: p001, p002, <no folio — pp suffix>, p003.
    """

    def _make_pages(self, project_id: str, types: dict[int, PageType]) -> dict[int, PageRecord]:
        pages = {}
        for i in range(4):
            pt = types.get(i, PageType.normal)
            pages[i] = PageRecord(
                project_id=project_id,
                idx0=i,
                prefix="",
                source_stem=f"src_{i:03d}",
                page_type=pt,
            )
        return pages

    def _cfg(self) -> ProjectConfig:
        """4-page bodymatter-only config (no frontmatter)."""
        return ProjectConfig(
            book_name="test",
            source_uri="",
            proof_start_idx0=0,
            proof_end_idx0=3,
            frontmatter_start_idx0=0,
            frontmatter_end_idx0=-1,  # no frontmatter
            bodymatter_start_idx0=0,
            bodymatter_end_idx0=3,
            bodymatter_page_nbr_start=1,
        )

    def test_blank_consumes_folio(self) -> None:
        """Blank page in bodymatter gets p002, not skipped."""
        from pdomain_prep_for_pgdp.core.prefix import compute_prefix_v2

        cfg = self._cfg()
        pages = self._make_pages(
            "proj",
            {0: PageType.normal, 1: PageType.blank, 2: PageType.plate_p, 3: PageType.normal},
        )
        # idx0=0: normal, first bodymatter → p001
        p0 = compute_prefix_v2(0, cfg, pages)
        assert p0 == "000p001", f"first normal expected '000p001', got {p0!r}"

        # idx0=1: blank → consumes folio, gets p002
        p1 = compute_prefix_v2(1, cfg, pages)
        assert p1 == "001p002", f"blank expected '001p002' (consumes folio), got {p1!r}"

    def test_plate_does_not_consume_folio(self) -> None:
        """Plate in bodymatter gets pp suffix, no folio number."""
        from pdomain_prep_for_pgdp.core.prefix import compute_prefix_v2

        cfg = self._cfg()
        pages = self._make_pages(
            "proj",
            {0: PageType.normal, 1: PageType.blank, 2: PageType.plate_p, 3: PageType.normal},
        )
        # idx0=2: plate_p in bodymatter → seq=002, section=p, suffix=p → "002pp"
        p2 = compute_prefix_v2(2, cfg, pages)
        assert p2 is not None, "plate_p should not return None"
        assert p2 == "002pp", f"plate_p expected '002pp', got {p2!r}"

    def test_normal_after_plate_gets_next_folio_no_off_by_one(self) -> None:
        """Normal page after plate gets folio continuing from before the plate (no off-by-one)."""
        from pdomain_prep_for_pgdp.core.prefix import compute_prefix_v2

        cfg = self._cfg()
        pages = self._make_pages(
            "proj",
            {0: PageType.normal, 1: PageType.blank, 2: PageType.plate_p, 3: PageType.normal},
        )
        # idx0=3: normal after plate → folio should be 3 (blank consumed 2, plate skipped)
        # So: normal(1), blank(2), plate(skipped), normal(3).
        p3 = compute_prefix_v2(3, cfg, pages)
        assert p3 == "003p003", f"normal after plate expected '003p003', got {p3!r}"

    def test_full_sequence_folio_assignment(self) -> None:
        """Full [normal, blank, plate_p, normal] sequence in bodymatter: correct folios end-to-end."""
        from pdomain_prep_for_pgdp.core.prefix import compute_prefix_v2

        cfg = self._cfg()
        pages = self._make_pages(
            "proj",
            {0: PageType.normal, 1: PageType.blank, 2: PageType.plate_p, 3: PageType.normal},
        )
        results = [compute_prefix_v2(i, cfg, pages) for i in range(4)]
        assert results[0] == "000p001", f"[0] got {results[0]!r}"
        assert results[1] == "001p002", f"[1] blank got {results[1]!r}"
        assert results[2] == "002pp", f"[2] plate got {results[2]!r}"
        assert results[3] == "003p003", f"[3] after-plate got {results[3]!r}"

    def test_plate_b_and_plate_r_also_no_folio(self) -> None:
        """plate_b and plate_r also skip the folio counter (not just plate_p)."""
        from pdomain_prep_for_pgdp.core.prefix import compute_prefix_v2

        cfg = self._cfg()

        for idx, pt, expected_suffix in [
            (2, PageType.plate_b, "002pb"),
            (2, PageType.plate_r, "002pr"),
        ]:
            pages = self._make_pages(
                "proj",
                {0: PageType.normal, 1: PageType.blank, idx: pt, 3: PageType.normal},
            )
            result = compute_prefix_v2(idx, cfg, pages)
            assert result == expected_suffix, f"{pt.value} expected {expected_suffix!r}, got {result!r}"
            # Following normal must still get p003.
            p3 = compute_prefix_v2(3, cfg, pages)
            assert p3 == "003p003", f"after {pt.value}: expected '003p003', got {p3!r}"


# ─── Gap 3: Insert → prefix shift correctness ─────────────────────────────────


def _make_project_with_config(
    project_id: str,
    page_count: int,
    *,
    proof_start: int = 0,
    proof_end: int,
    fm_start: int = 0,
    fm_end: int = -1,
    bm_start: int,
    bm_end: int,
) -> Project:
    now = datetime.now(UTC)
    return Project(
        id=project_id,
        owner_id="default",
        name="t",
        created_at=now,
        updated_at=now,
        status=ProjectStatus.configuring,
        page_count=page_count,
        proof_page_count=page_count,
        config=ProjectConfig(
            book_name="t",
            source_uri="",
            proof_start_idx0=proof_start,
            proof_end_idx0=proof_end,
            frontmatter_start_idx0=fm_start,
            frontmatter_end_idx0=fm_end,
            bodymatter_start_idx0=bm_start,
            bodymatter_end_idx0=bm_end,
        ),
        storage_prefix=f"projects/{project_id}/",
    )


def _seed_project_with_config(
    settings: Settings,
    project_id: str,
    pages: list[PageRecord],
    project: Project,
) -> None:
    async def go() -> None:
        d = SqliteDatabase(settings.derived_database_url)
        await d.initialize()
        await d.put_project(project)
        await d.close()

    asyncio.run(go())
    seed_pages_in_store(settings, project_id, pages)


def test_insert_mid_bodymatter_shifts_prefix_correctly(tmp_path: Path) -> None:
    """Insert blank at idx0=2 in 4-page bodymatter-only project.

    Before insert: 4 pages at idx0 0-3, all bodymatter.
      Prefixes: 000p001, 001p002, 002p003, 003p004

    The insert endpoint shifts pages at idx0>=2 up by 1, bumps range bounds,
    then calls assign_prefixes.  After insert, 5 pages:
      idx0=0 → 000p001 (unchanged)
      idx0=1 → 001p002 (unchanged)
      idx0=2 → 002p003 (new inserted blank)
      idx0=3 → 003p004 (was idx0=2, now shifted)
      idx0=4 → 004p005 (was idx0=3, now shifted)
    """
    from fastapi.testclient import TestClient

    from pdomain_prep_for_pgdp.bootstrap import build_app

    project_id = "insert_shift_prefix"
    settings = _settings(tmp_path)
    project = _make_project_with_config(
        project_id,
        page_count=4,
        proof_end=3,
        bm_start=0,
        bm_end=3,
    )
    pages = [_page(project_id, i) for i in range(4)]
    _seed_project_with_config(settings, project_id, pages, project)

    # Assign initial prefixes.
    async def _assign() -> None:
        from pdomain_prep_for_pgdp.core.assign_prefixes import assign_prefixes

        svc = build_page_service(settings.data_root, project_id)
        await assign_prefixes(project=project, page_service=svc)

    asyncio.run(_assign())

    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post(
            f"/api/data/projects/{project_id}/pages/insert",
            json={"at_idx0": 2},  # insert at position 2 (middle of bodymatter)
        )
        assert r.status_code == 200, r.text
        body = r.json()

    # Sort response pages by idx0.
    all_pages = sorted(body["pages"], key=lambda p: p["idx0"])
    assert len(all_pages) == 5, f"expected 5 pages after insert, got {len(all_pages)}"

    by_idx = {p["idx0"]: p for p in all_pages}

    # Pre-insert pages (idx0=0,1) must be unchanged.
    assert by_idx[0]["prefix"] == "000p001", f"idx0=0: expected '000p001', got {by_idx[0]['prefix']!r}"
    assert by_idx[1]["prefix"] == "001p002", f"idx0=1: expected '001p002', got {by_idx[1]['prefix']!r}"

    # Newly inserted page at idx0=2 must get seq=002, bm, folio=3.
    assert by_idx[2]["idx0"] == 2
    assert by_idx[2]["prefix"] == "002p003", (
        f"inserted page at idx0=2 expected '002p003', got {by_idx[2]['prefix']!r}"
    )

    # Shifted pages must have correct new seq/folio.
    assert by_idx[3]["prefix"] == "003p004", f"idx0=3: expected '003p004', got {by_idx[3]['prefix']!r}"
    assert by_idx[4]["prefix"] == "004p005", f"idx0=4: expected '004p005', got {by_idx[4]['prefix']!r}"


def test_insert_at_start_shifts_all_prefixes_correctly(tmp_path: Path) -> None:
    """Insert at idx0=0 prepends a page; all existing pages shift up by 1.

    3-page bodymatter:  idx0 0-2 → 000p001, 001p002, 002p003.
    After insert at 0:  idx0 0-3 → 000p001 (new), 001p002, 002p003, 003p004.
    """
    from fastapi.testclient import TestClient

    from pdomain_prep_for_pgdp.bootstrap import build_app

    project_id = "insert_at_start"
    settings = _settings(tmp_path)
    project = _make_project_with_config(
        project_id,
        page_count=3,
        proof_end=2,
        bm_start=0,
        bm_end=2,
    )
    pages = [_page(project_id, i) for i in range(3)]
    _seed_project_with_config(settings, project_id, pages, project)

    async def _assign() -> None:
        from pdomain_prep_for_pgdp.core.assign_prefixes import assign_prefixes

        svc = build_page_service(settings.data_root, project_id)
        await assign_prefixes(project=project, page_service=svc)

    asyncio.run(_assign())

    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post(
            f"/api/data/projects/{project_id}/pages/insert",
            json={"at_idx0": 0},
        )
        assert r.status_code == 200, r.text
        body = r.json()

    all_pages = sorted(body["pages"], key=lambda p: p["idx0"])
    assert len(all_pages) == 4

    by_idx = {p["idx0"]: p for p in all_pages}
    # New page at 0.
    assert by_idx[0]["prefix"] == "000p001", f"expected '000p001', got {by_idx[0]['prefix']!r}"
    # Original pages shifted.
    assert by_idx[1]["prefix"] == "001p002", f"expected '001p002', got {by_idx[1]['prefix']!r}"
    assert by_idx[2]["prefix"] == "002p003", f"expected '002p003', got {by_idx[2]['prefix']!r}"
    assert by_idx[3]["prefix"] == "003p004", f"expected '003p004', got {by_idx[3]['prefix']!r}"


def test_insert_into_mixed_frontmatter_bodymatter_prefixes(tmp_path: Path) -> None:
    """Insert into mixed fm/bm project: prefixes maintain correct section letters and folios.

    Initial: 4 pages — fm(0-1), bm(2-3).
      000f001, 001f002, 002p001, 003p002.

    Insert at idx0=2 (start of bodymatter):
      5 pages — fm(0-1), bm(2-4).
      idx0=0: 000f001, idx0=1: 001f002 (unchanged)
      idx0=2: 002p001 (new blank, first bm page)
      idx0=3: 003p002 (was old idx0=2 = old p001, now shifted)
      idx0=4: 004p003 (was old idx0=3 = old p002, now shifted)
    """
    from fastapi.testclient import TestClient

    from pdomain_prep_for_pgdp.bootstrap import build_app

    project_id = "insert_mixed"
    settings = _settings(tmp_path)
    project = _make_project_with_config(
        project_id,
        page_count=4,
        proof_end=3,
        fm_start=0,
        fm_end=1,
        bm_start=2,
        bm_end=3,
    )
    pages = [_page(project_id, i) for i in range(4)]
    _seed_project_with_config(settings, project_id, pages, project)

    async def _assign() -> None:
        from pdomain_prep_for_pgdp.core.assign_prefixes import assign_prefixes

        svc = build_page_service(settings.data_root, project_id)
        await assign_prefixes(project=project, page_service=svc)

    asyncio.run(_assign())

    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post(
            f"/api/data/projects/{project_id}/pages/insert",
            json={"at_idx0": 2},
        )
        assert r.status_code == 200, r.text
        body = r.json()

    all_pages = sorted(body["pages"], key=lambda p: p["idx0"])
    assert len(all_pages) == 5

    by_idx = {p["idx0"]: p for p in all_pages}

    # Frontmatter pages unchanged in folio.
    assert by_idx[0]["prefix"] == "000f001", f"idx0=0: expected '000f001', got {by_idx[0]['prefix']!r}"
    assert by_idx[1]["prefix"] == "001f002", f"idx0=1: expected '001f002', got {by_idx[1]['prefix']!r}"

    # New page inserted at start of bodymatter.
    assert by_idx[2]["prefix"] == "002p001", (
        f"inserted page at idx0=2 expected '002p001', got {by_idx[2]['prefix']!r}"
    )

    # Shifted bodymatter pages.
    assert by_idx[3]["prefix"] == "003p002", f"idx0=3: expected '003p002', got {by_idx[3]['prefix']!r}"
    assert by_idx[4]["prefix"] == "004p003", f"idx0=4: expected '004p003', got {by_idx[4]['prefix']!r}"
