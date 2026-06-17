"""Regression detection: reorder/insert with seeded NumberingRuns recomputes prefixes.

P1.9 closed the regression-detection hole by adding these tests.  The existing
tests in test_reorder_pages_route.py and test_naming_prefix_coverage.py only
ran the empty-runs branch (prefix → ""), so a bug in
compute_project_prefixes-on-reorder/insert would go uncaught.

These tests:
  - Seed a project WITH NumberingRuns persisted via save_runs.
  - Seed pages with leaf_role + run_id so _load_leaf_assignments returns
    non-None assignments for compute_project_prefixes.
  - Call the reorder/insert routes and assert EXACT prefix strings.

Design note on section_letter:
  compute_prefixes_from_runs determines section_letter ("f" vs "p") by whether
  the page's scan (its new idx0 after reorder) falls within the earliest-starting
  run's span.  With a single run spanning [0, n-1], ALL pages fall within that
  span → section_letter = "f" for all.  To get "p" labels you need a second run
  whose span starts AFTER the first run's span ends, making the first run the
  "front section".

Design note on assignment lookup:
  compute_project_prefixes receives ``pre_reorder_assignments`` from reorder_pages
  (built before idx0 mutation).  This is the fix for the cross-run stale-assignment
  bug: _load_leaf_assignments returns {old_idx0: (role, run_id)}, which is correct
  when provided to compute_project_prefixes BEFORE put_page_records updates the store.
  test_cross_run_reorder_prefix_follows_page_membership exercises this path.
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime
from pathlib import Path

from fastapi.testclient import TestClient
from pdomain_ops.page_aggregate import PageAggregate, ProjectAggregate
from pdomain_ops.pages import PageRecord as OpsPageRecord
from pdomain_ops.pages import ProjectRecord, set_extension

from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pdomain_prep_for_pgdp.bootstrap import build_app
from pdomain_prep_for_pgdp.core.models import (
    LeafRole,
    NumberingRun,
    NumberingRunsArtifact,
    PageType,
    Project,
    ProjectConfig,
    ProjectStatus,
    RunStyle,
    StartMode,
)
from pdomain_prep_for_pgdp.core.numbering_store import save_runs
from pdomain_prep_for_pgdp.core.page_store_factory import build_page_service
from pdomain_prep_for_pgdp.core.prep_extension import PrepPageExtension
from pdomain_prep_for_pgdp.settings import Settings

# ─── Helpers ──────────────────────────────────────────────────────────────────


def _settings(tmp_path: Path) -> Settings:
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


def _to_uuid(project_id: str) -> uuid.UUID:
    try:
        return uuid.UUID(project_id)
    except (ValueError, AttributeError):
        return uuid.uuid5(uuid.NAMESPACE_OID, project_id)


def _seed_project_db(settings: Settings, project_id: str, page_count: int) -> None:
    """Create project record in the SQLite DB."""

    async def go() -> None:
        db = SqliteDatabase(settings.derived_database_url)
        await db.initialize()
        now = datetime.now(UTC)
        await db.put_project(
            Project(
                id=project_id,
                owner_id="default",
                name="t",
                created_at=now,
                updated_at=now,
                status=ProjectStatus.processing,
                page_count=page_count,
                proof_page_count=page_count,
                config=ProjectConfig(book_name="t", source_uri=""),
                storage_prefix=f"projects/{project_id}/",
                registry_version=3,  # current — no auto-migration
            )
        )
        await db.close()

    asyncio.run(go())


def _seed_pages_with_runs(
    settings: Settings,
    project_id: str,
    pages_spec: list[dict],
) -> None:
    """Seed pages into the event store with leaf_role + run_id set.

    pages_spec items:
        {
            "idx0": int,
            "leaf_role": LeafRole,
            "run_id": str | None,
            "source_stem": str,  # optional
            "page_type": PageType,  # optional, default normal
        }
    """
    data_root = settings.data_root
    svc = build_page_service(data_root, project_id)
    proj_uuid = _to_uuid(project_id)

    try:
        proj_agg = svc.store.get_project(proj_uuid)
    except Exception:
        proj_record = ProjectRecord(project_id=proj_uuid, name="Test")
        proj_agg = ProjectAggregate(record=proj_record)

    for spec in sorted(pages_spec, key=lambda s: s["idx0"]):
        idx0 = spec["idx0"]
        leaf_role = spec["leaf_role"]
        run_id = spec.get("run_id")
        source_stem = spec.get("source_stem", f"src_{idx0:03d}")
        page_type = spec.get("page_type", PageType.normal)

        page_uuid = uuid.uuid4()
        ops_record = OpsPageRecord(page_id=page_uuid, page_index=idx0, source="raw")
        ext = PrepPageExtension(
            project_id=project_id,
            idx0=idx0,
            prefix="",  # will be recomputed
            source_stem=source_stem,
            ignore=False,
            page_type=page_type,
            leaf_role=leaf_role,
            run_id=run_id,
        )
        set_extension(ops_record, "prep", ext)
        page_agg = PageAggregate(record=ops_record)
        svc.store.save_page(page_agg)
        proj_agg.add_page(page_id=page_uuid, page_index=idx0)

    svc.store.save_project(proj_agg)


def _save_single_run(
    settings: Settings,
    project_id: str,
    run_id: str,
    first: int,
    last: int,
) -> None:
    """Persist a single text run spanning [first, last]."""
    artifact = NumberingRunsArtifact(
        version=1,
        runs=[
            NumberingRun(
                id=run_id,
                label=run_id.capitalize(),
                style=RunStyle.arabic,
                start_mode=StartMode.set,
                start=1,
                step=1,
                role=LeafRole.text,
                span=(first, last),
            )
        ],
    )
    save_runs(settings.data_root, project_id, artifact)


def _save_front_body_runs(
    settings: Settings,
    project_id: str,
    front_first: int,
    front_last: int,
    body_first: int,
    body_last: int,
) -> None:
    """Persist frontmatter + bodymatter runs (non-overlapping spans)."""
    artifact = NumberingRunsArtifact(
        version=1,
        runs=[
            NumberingRun(
                id="front",
                label="Front",
                style=RunStyle.arabic,
                start_mode=StartMode.set,
                start=1,
                step=1,
                role=LeafRole.text,
                span=(front_first, front_last),
            ),
            NumberingRun(
                id="body",
                label="Body",
                style=RunStyle.arabic,
                start_mode=StartMode.set,
                start=1,
                step=1,
                role=LeafRole.text,
                span=(body_first, body_last),
            ),
        ],
    )
    save_runs(settings.data_root, project_id, artifact)


# ─── Reorder tests ────────────────────────────────────────────────────────────


def test_reorder_with_runs_updates_prefix_strings(tmp_path: Path) -> None:
    """Reorder pages within a single run and assert exact recomputed prefix strings.

    Setup: 4 body-text pages, single "body" run spanning [0,3].

    Because there is only one run, compute_prefixes_from_runs uses that run's
    span [0,3] as the front_span → ALL pages get section_letter="f" (all fall
    within the one and only run's span).  This is correct behavior: the single
    run IS the front section.

    Initial prefixes (before reorder):
        idx0=0 → "000f001"
        idx0=1 → "001f002"
        idx0=2 → "002f003"
        idx0=3 → "003f004"

    New order: [page_id=2, page_id=0, page_id=1, page_id=3]
    (move old idx0=2 to position 0, old idx0=0 to position 1,
     old idx0=1 to position 2, old idx0=3 stays at position 3)

    After reorder:
        pos0 → new idx0=0, folio counter restarts from 1 → "000f001"
        pos1 → new idx0=1 → "001f002"
        pos2 → new idx0=2 → "002f003"
        pos3 → new idx0=3 → "003f004"

    The prefix strings look the same — the folio counter runs 1..4 positionally
    in the single run regardless of which physical page occupies each position.
    The critical verification is that the prefixes ARE recomputed (non-empty)
    and follow the run model, not that they change between reorders.
    """
    project_id = "reorder_prefix_test"
    settings = _settings(tmp_path)
    n_pages = 4

    _seed_project_db(settings, project_id, n_pages)

    # Seed pages with run_id="body" so _load_leaf_assignments returns non-None.
    _seed_pages_with_runs(
        settings,
        project_id,
        [{"idx0": i, "leaf_role": LeafRole.text, "run_id": "body"} for i in range(n_pages)],
    )

    # Persist the single run artifact spanning all 4 pages.
    _save_single_run(settings, project_id, "body", first=0, last=n_pages - 1)

    app = build_app(settings)
    with TestClient(app) as client:
        # Fetch pages to get page_ids in idx0 order.
        r = client.get(f"/api/data/projects/{project_id}/pages")
        assert r.status_code == 200, r.text
        pages_before = sorted(r.json()["pages"], key=lambda p: p["idx0"])
        assert len(pages_before) == n_pages

        # The route uses idx0-formatted strings as page IDs ("0000", "0001", …).
        pid = [f"{p['idx0']:04d}" for p in pages_before]

        # New order: [pid[2], pid[0], pid[1], pid[3]]
        # i.e. move old idx0=2 to position 0, old idx0=0 to position 1,
        #      old idx0=1 to position 2, old idx0=3 stays at position 3.
        new_order = [pid[2], pid[0], pid[1], pid[3]]

        r = client.patch(
            f"/api/data/projects/{project_id}/pages/reorder",
            json={"page_ids": new_order},
        )
        assert r.status_code == 200, r.text
        pages_after = sorted(r.json()["pages"], key=lambda p: p["idx0"])

    # Exact prefix assertions.
    # Single run → front_span = [0,3] → all pages section_letter="f".
    # Folio counter: 1st in-run leaf → 1, 2nd → 2, etc. (positional within the run).
    assert pages_after[0]["prefix"] == "000f001", f"pos0 prefix: {pages_after[0]['prefix']!r}"
    assert pages_after[1]["prefix"] == "001f002", f"pos1 prefix: {pages_after[1]['prefix']!r}"
    assert pages_after[2]["prefix"] == "002f003", f"pos2 prefix: {pages_after[2]['prefix']!r}"
    assert pages_after[3]["prefix"] == "003f004", f"pos3 prefix: {pages_after[3]['prefix']!r}"


def test_reorder_with_two_runs_updates_section_letters(tmp_path: Path) -> None:
    """Reorder within the body section of a two-run project.

    Setup: front run [0,1], body run [2,5]. 6 pages total.
    front run has 2 pages (idx0=0,1); body run has 4 pages (idx0=2..5).
    front_span = [0,1] (smallest-start run). body pages idx0>=2 → section_letter="p".

    Reorder: swap body pages idx0=2 and idx0=4 → new order [0,1,4,3,2,5].
    All body pages still have run_id="body" so the stale-assignment issue does
    not apply. The folio counter counts body leaves positionally:
    After reorder, body leaf positions (in reading order by new idx0):
        new idx0=2: old idx0=4 (run_id="body") → body folio 1
        new idx0=3: old idx0=3 (run_id="body") → body folio 2
        new idx0=4: old idx0=2 (run_id="body") → body folio 3
        new idx0=5: old idx0=5 (run_id="body") → body folio 4

    Front pages:
        new idx0=0: old idx0=0 (run_id="front") → in front span [0,1] → "000f001"
        new idx0=1: old idx0=1 (run_id="front") → in front span [0,1] → "001f002"

    Expected:
        idx0=0 → "000f001"
        idx0=1 → "001f002"
        idx0=2 → "002p001"
        idx0=3 → "003p002"
        idx0=4 → "004p003"
        idx0=5 → "005p004"
    """
    project_id = "reorder_two_runs"
    settings = _settings(tmp_path)
    n_pages = 6

    _seed_project_db(settings, project_id, n_pages)

    _seed_pages_with_runs(
        settings,
        project_id,
        [
            {"idx0": 0, "leaf_role": LeafRole.text, "run_id": "front"},
            {"idx0": 1, "leaf_role": LeafRole.text, "run_id": "front"},
            {"idx0": 2, "leaf_role": LeafRole.text, "run_id": "body"},
            {"idx0": 3, "leaf_role": LeafRole.text, "run_id": "body"},
            {"idx0": 4, "leaf_role": LeafRole.text, "run_id": "body"},
            {"idx0": 5, "leaf_role": LeafRole.text, "run_id": "body"},
        ],
    )
    _save_front_body_runs(settings, project_id, 0, 1, 2, 5)

    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get(f"/api/data/projects/{project_id}/pages")
        assert r.status_code == 200, r.text
        pages_before = sorted(r.json()["pages"], key=lambda p: p["idx0"])
        pid = [f"{p['idx0']:04d}" for p in pages_before]

        # Swap body pages at idx0=2 and idx0=4: new order [0,1,4,3,2,5]
        new_order = [pid[0], pid[1], pid[4], pid[3], pid[2], pid[5]]

        r = client.patch(
            f"/api/data/projects/{project_id}/pages/reorder",
            json={"page_ids": new_order},
        )
        assert r.status_code == 200, r.text
        pages_after = sorted(r.json()["pages"], key=lambda p: p["idx0"])

    # Front pages: in front span [0,1] → section_letter="f"
    assert pages_after[0]["prefix"] == "000f001", f"idx0=0: {pages_after[0]['prefix']!r}"
    assert pages_after[1]["prefix"] == "001f002", f"idx0=1: {pages_after[1]['prefix']!r}"

    # Body pages: outside front span [0,1] → section_letter="p"
    # Folio counter increments positionally (all same run_id="body").
    assert pages_after[2]["prefix"] == "002p001", f"idx0=2: {pages_after[2]['prefix']!r}"
    assert pages_after[3]["prefix"] == "003p002", f"idx0=3: {pages_after[3]['prefix']!r}"
    assert pages_after[4]["prefix"] == "004p003", f"idx0=4: {pages_after[4]['prefix']!r}"
    assert pages_after[5]["prefix"] == "005p004", f"idx0=5: {pages_after[5]['prefix']!r}"


# ─── Insert tests ─────────────────────────────────────────────────────────────


def test_insert_mid_shifts_run_span_and_updates_prefix(tmp_path: Path) -> None:
    """Insert at idx0=2 in a 4-page single-run project: spans shift and prefixes recompute.

    P1.9 span-shift logic (insert_at=2, span [0,3]):
        new_s = s + 1 if s > insert_at else s  → 0 ≤ 2 → stays 0
        new_e = e + 1 if e >= insert_at else e  → 3 ≥ 2 → becomes 4
        New span: [0, 4].

    Single "body" run spanning [0,3] → after insert spans [0,4].

    Pages after insert (5 pages, idx0=0..4):
        idx0=0: run_id="body", still in run → folio 1
        idx0=1: run_id="body", → folio 2
        idx0=2: NEW blank, no run_id, no special role → no folio → prefix ""
        idx0=3: old idx0=2 shifted up, run_id="body" → folio 3
        idx0=4: old idx0=3 shifted up, run_id="body" → folio 4

    Single run [0,4] → front_span = [0,4] → ALL pages section_letter="f".
    proof_start = 0 (first scan with run_id or special role).

    Expected prefixes:
        idx0=0: seq=0-0=0 → "000f001"
        idx0=1: seq=1-0=1 → "001f002"
        idx0=2: no run_id → "" (blank, no folio)
        idx0=3: seq=3-0=3 → "003f003"
        idx0=4: seq=4-0=4 → "004f004"
    """
    project_id = "insert_shift_prefix_test"
    settings = _settings(tmp_path)
    n_pages = 4

    _seed_project_db(settings, project_id, n_pages)

    _seed_pages_with_runs(
        settings,
        project_id,
        [{"idx0": i, "leaf_role": LeafRole.text, "run_id": "body"} for i in range(n_pages)],
    )
    _save_single_run(settings, project_id, "body", first=0, last=n_pages - 1)

    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post(
            f"/api/data/projects/{project_id}/pages/insert",
            json={"at_idx0": 2},
        )
        assert r.status_code == 200, r.text
        all_pages = sorted(r.json()["pages"], key=lambda p: p["idx0"])

    assert len(all_pages) == 5

    # idx0=0 and idx0=1: unchanged; single run → section_letter="f"; folio 1,2.
    assert all_pages[0]["idx0"] == 0
    assert all_pages[0]["prefix"] == "000f001", f"idx0=0: {all_pages[0]['prefix']!r}"

    assert all_pages[1]["idx0"] == 1
    assert all_pages[1]["prefix"] == "001f002", f"idx0=1: {all_pages[1]['prefix']!r}"

    # idx0=2: newly inserted blank, no run_id → no folio → prefix "".
    assert all_pages[2]["idx0"] == 2
    assert all_pages[2]["prefix"] == "", f"idx0=2 (inserted blank): {all_pages[2]['prefix']!r}"

    # idx0=3: was idx0=2 before insert (shifted); run_id="body" → folio 3.
    # Folio count: leaves in reading order with a run_id: idx0=0 (folio 1),
    # idx0=1 (folio 2), idx0=3 (folio 3 — idx0=2 blank has no run_id), idx0=4 (folio 4).
    assert all_pages[3]["idx0"] == 3
    assert all_pages[3]["prefix"] == "003f003", f"idx0=3: {all_pages[3]['prefix']!r}"

    # idx0=4: was idx0=3 before insert (shifted); run_id="body" → folio 4.
    assert all_pages[4]["idx0"] == 4
    assert all_pages[4]["prefix"] == "004f004", f"idx0=4: {all_pages[4]['prefix']!r}"


def test_insert_at_start_with_two_runs_shifts_spans(tmp_path: Path) -> None:
    """Insert at idx0=0 prepends a blank; spans shift; shifted pages get correct prefixes.

    Setup: 3 pages.  front run spans [0,0] (1 page); body run spans [1,2] (2 pages).

    P1.9 span-shift logic (insert_at=0):
        front span [0,0]:
            new_s = 0 + 1 if 0 > 0 else 0 → stays 0
            new_e = 0 + 1 if 0 >= 0 else 0 → becomes 1
            New span: [0,1]
        body span [1,2]:
            new_s = 1 + 1 if 1 > 0 else 1 → becomes 2
            new_e = 2 + 1 if 2 >= 0 else 2 → becomes 3
            New span: [2,3]

    After insert at idx0=0:
        idx0=0: NEW blank, no run_id → prefix ""
        idx0=1: old idx0=0 (run_id="front"), now shifted → idx0=1
        idx0=2: old idx0=1 (run_id="body"), shifted → idx0=2
        idx0=3: old idx0=2 (run_id="body"), shifted → idx0=3

    Spans after shift: front [0,1], body [2,3].
    front_span = min-start span = front [0,1].
    proof_start = first scan with run_id.  Old idx0=0 is now at idx0=1 →
    smallest idx0 with run_id = 1 → proof_start = 1.

    Expected prefixes:
        idx0=0: no run_id → ""
        idx0=1: seq=1-1=0, in front span [0,1] → section_letter="f",
                run_id="front", 1st front leaf → folio 1 → "000f001"
        idx0=2: seq=2-1=1, outside front span → section_letter="p",
                run_id="body", 1st body leaf → folio 1 → "001p001"
        idx0=3: seq=3-1=2, outside front span → section_letter="p",
                run_id="body", 2nd body leaf → folio 2 → "002p002"
    """
    project_id = "insert_start_shift"
    settings = _settings(tmp_path)
    n_pages = 3

    _seed_project_db(settings, project_id, n_pages)

    _seed_pages_with_runs(
        settings,
        project_id,
        [
            {"idx0": 0, "leaf_role": LeafRole.text, "run_id": "front"},
            {"idx0": 1, "leaf_role": LeafRole.text, "run_id": "body"},
            {"idx0": 2, "leaf_role": LeafRole.text, "run_id": "body"},
        ],
    )
    _save_front_body_runs(settings, project_id, 0, 0, 1, 2)

    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post(
            f"/api/data/projects/{project_id}/pages/insert",
            json={"at_idx0": 0},
        )
        assert r.status_code == 200, r.text
        all_pages = sorted(r.json()["pages"], key=lambda p: p["idx0"])

    assert len(all_pages) == 4

    # idx0=0: newly inserted blank, no run_id → prefix "".
    assert all_pages[0]["idx0"] == 0
    assert all_pages[0]["prefix"] == "", f"idx0=0 (inserted): {all_pages[0]['prefix']!r}"

    # idx0=1: old idx0=0 (run_id="front"), seq=1-1=0, in front span [0,1] → "000f001".
    assert all_pages[1]["idx0"] == 1
    assert all_pages[1]["prefix"] == "000f001", f"idx0=1: {all_pages[1]['prefix']!r}"

    # idx0=2: old idx0=1 (run_id="body"), seq=2-1=1, outside front span → "001p001".
    assert all_pages[2]["idx0"] == 2
    assert all_pages[2]["prefix"] == "001p001", f"idx0=2: {all_pages[2]['prefix']!r}"

    # idx0=3: old idx0=2 (run_id="body"), seq=3-1=2, outside front span → "002p002".
    assert all_pages[3]["idx0"] == 3
    assert all_pages[3]["prefix"] == "002p002", f"idx0=3: {all_pages[3]['prefix']!r}"


def test_insert_run_span_boundary_conditions(tmp_path: Path) -> None:
    """Insert mid-book; verify span shift and prefix strings.

    Setup: 3 pages, single "body" run spanning [0,2].

    Insert at idx0=1 (mid-span):
        s=0, e=2, insert_at=1:
            new_s = 0 + 1 if 0 > 1 else 0 → stays 0
            new_e = 2 + 1 if 2 >= 1 else 2 → becomes 3
            New span: [0,3]

    After insert at idx0=1 (4 pages total):
        idx0=0: old idx0=0 (run_id="body") → unchanged
        idx0=1: NEW blank, no run_id → prefix ""
        idx0=2: old idx0=1 (run_id="body"), shifted from idx0=1
        idx0=3: old idx0=2 (run_id="body"), shifted from idx0=2

    Single run [0,3] → front_span = [0,3] → ALL pages section_letter="f".
    proof_start = 0 (idx0=0 has run_id).

    Expected prefixes:
        idx0=0: seq=0, folio=1 → "000f001"
        idx0=1: no run_id → ""
        idx0=2: seq=2, folio=2 → "002f002"
        idx0=3: seq=3, folio=3 → "003f003"
    """
    project_id = "insert_span_boundary"
    settings = _settings(tmp_path)
    n_pages = 3

    _seed_project_db(settings, project_id, n_pages)

    _seed_pages_with_runs(
        settings,
        project_id,
        [{"idx0": i, "leaf_role": LeafRole.text, "run_id": "body"} for i in range(n_pages)],
    )
    _save_single_run(settings, project_id, "body", first=0, last=n_pages - 1)

    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post(
            f"/api/data/projects/{project_id}/pages/insert",
            json={"at_idx0": 1},
        )
        assert r.status_code == 200, r.text
        all_pages = sorted(r.json()["pages"], key=lambda p: p["idx0"])

    assert len(all_pages) == 4

    assert all_pages[0]["idx0"] == 0
    assert all_pages[0]["prefix"] == "000f001", f"idx0=0: {all_pages[0]['prefix']!r}"

    assert all_pages[1]["idx0"] == 1
    assert all_pages[1]["prefix"] == "", f"idx0=1 (inserted): {all_pages[1]['prefix']!r}"

    # Old idx0=1 → now idx0=2; seq=2-0=2; folio=2 (2nd body leaf counted).
    assert all_pages[2]["idx0"] == 2
    assert all_pages[2]["prefix"] == "002f002", f"idx0=2: {all_pages[2]['prefix']!r}"

    # Old idx0=2 → now idx0=3; seq=3-0=3; folio=3.
    assert all_pages[3]["idx0"] == 3
    assert all_pages[3]["prefix"] == "003f003", f"idx0=3: {all_pages[3]['prefix']!r}"


def test_cross_run_reorder_prefix_follows_page_membership(tmp_path: Path) -> None:
    """Cross-run reorder: a page's run_id (and therefore prefix style) must
    travel with the page to its new position, not be inherited from the previous
    occupant of that position.

    Setup: 4 pages, two runs.
        front run spans [0,1]: idx0=0 (run_id="front"), idx0=1 (run_id="front")
        body  run spans [2,3]: idx0=2 (run_id="body"),  idx0=3 (run_id="body")

    Cross-run reorder: swap idx0=0 (front) and idx0=2 (body).
    New order: [2, 1, 0, 3]  (old idx0 values in new positions)
        new pos 0 ← old idx0=2 (run_id="body")
        new pos 1 ← old idx0=1 (run_id="front")
        new pos 2 ← old idx0=0 (run_id="front")
        new pos 3 ← old idx0=3 (run_id="body")

    The stale-assignment bug: if compute_project_prefixes looks up run_id by
    the page's NEW idx0 against the STORE's OLD assignments, then:
        new pos 0 (body page) → assignments[0] = "front" → WRONG
        new pos 2 (front page) → assignments[2] = "body" → WRONG

    The correct behavior: run_id travels with the page, so:
        new pos 0 (body page)  keeps run_id="body"
        new pos 1 (front page) keeps run_id="front"
        new pos 2 (front page) keeps run_id="front"
        new pos 3 (body page)  keeps run_id="body"

    With front_span = [0,1] (the earliest-starting run's span in the STORED run
    config — note: the runs themselves are NOT re-spanned by a reorder, only by
    insert; the spans stay [0,1] and [2,3]), the section_letter for each Leaf is
    determined by whether the leaf's NEW scan (new idx0) falls within [0,1]:
        new pos 0 → scan=0, in [0,1] → "f";  run_id="body" → counted body → folio 1
        new pos 1 → scan=1, in [0,1] → "f";  run_id="front" → counted front → folio 1
        new pos 2 → scan=2, not in [0,1] → "p"; run_id="front" → folio 2
        new pos 3 → scan=3, not in [0,1] → "p"; run_id="body" → folio 2

    Expected prefixes (BUG-FREE path):
        idx0=0: body page moved to front zone → section_letter="f", body folio 1 → "000f001"
        idx0=1: front page stays → section_letter="f", front folio 1 → "001f001"
        idx0=2: front page moved to body zone → section_letter="p", front folio 2 → "002p002"
        idx0=3: body page stays → section_letter="p", body folio 2 → "003p002"

    If the stale bug fires, new pos 0 gets run_id="front" and new pos 2 gets
    run_id="body", which changes the folio counts and typically produces wrong
    prefix strings.

    Note on folio counters: compute_prefixes_from_runs increments a separate counter
    per run_id.  "body folio 1" means it is the first leaf with run_id="body" in
    reading order; "front folio 2" means the second leaf with run_id="front".
    """
    project_id = "cross_run_reorder_test"
    settings = _settings(tmp_path)
    n_pages = 4

    _seed_project_db(settings, project_id, n_pages)

    _seed_pages_with_runs(
        settings,
        project_id,
        [
            {"idx0": 0, "leaf_role": LeafRole.text, "run_id": "front"},
            {"idx0": 1, "leaf_role": LeafRole.text, "run_id": "front"},
            {"idx0": 2, "leaf_role": LeafRole.text, "run_id": "body"},
            {"idx0": 3, "leaf_role": LeafRole.text, "run_id": "body"},
        ],
    )
    _save_front_body_runs(settings, project_id, 0, 1, 2, 3)

    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get(f"/api/data/projects/{project_id}/pages")
        assert r.status_code == 200, r.text
        pages_before = sorted(r.json()["pages"], key=lambda p: p["idx0"])
        pid = [f"{p['idx0']:04d}" for p in pages_before]

        # New order: old idx0=2, old idx0=1, old idx0=0, old idx0=3
        # i.e. swap the first front page (idx0=0) with the first body page (idx0=2)
        new_order = [pid[2], pid[1], pid[0], pid[3]]

        r = client.patch(
            f"/api/data/projects/{project_id}/pages/reorder",
            json={"page_ids": new_order},
        )
        assert r.status_code == 200, r.text
        pages_after = sorted(r.json()["pages"], key=lambda p: p["idx0"])

    # The page that moved from idx0=2 (body) to idx0=0 must keep run_id="body".
    # It lands in the front zone (scan=0 in [0,1]) → section_letter="f".
    # It is the first body leaf in reading order → body folio 1.
    assert pages_after[0]["prefix"] == "000f001", (
        f"idx0=0 (body page moved to front zone) expected '000f001', "
        f"got {pages_after[0]['prefix']!r} — stale-assignment bug?"
    )

    # The page at idx0=1 (front, unmoved) stays in front zone → "f", front folio 1.
    assert pages_after[1]["prefix"] == "001f001", (
        f"idx0=1 (front page, unmoved) expected '001f001', got {pages_after[1]['prefix']!r}"
    )

    # The page that moved from idx0=0 (front) to idx0=2 must keep run_id="front".
    # It lands outside the front zone (scan=2 not in [0,1]) → section_letter="p".
    # It is the second front leaf in reading order → front folio 2.
    assert pages_after[2]["prefix"] == "002p002", (
        f"idx0=2 (front page moved to body zone) expected '002p002', "
        f"got {pages_after[2]['prefix']!r} — stale-assignment bug?"
    )

    # The page at idx0=3 (body, unmoved) stays in body zone → "p", body folio 2.
    assert pages_after[3]["prefix"] == "003p002", (
        f"idx0=3 (body page, unmoved) expected '003p002', got {pages_after[3]['prefix']!r}"
    )
