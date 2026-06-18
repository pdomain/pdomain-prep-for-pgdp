"""I1 regression: page-MUTATING routes must auto-migrate v2 → v3 first.

The page-STAGE routes call ``_check_registry_page`` / ``migrate_if_needed`` so a
``registry_version=2`` project is migrated to v3 (runs) before the handler reads
runs or stamps leaf fields.  The page-MUTATING routes (reorder/update/insert/
split) historically skipped that guard, causing data degradation on pre-existing
v2 projects:

  * reorder/insert ran ``compute_project_prefixes`` over an EMPTY runs list
    (no runs.json on a v2 project) → every prefix resolved to None →
    ``page.prefix = ... or ""`` WIPED every page's prefix to "".
  * update_page wrote leaf_role/run_id onto a still-v2 project; the next stage
    route's ``migrate_project_to_v3`` then re-derived from page_type and
    CLOBBERED the user's edit.

This test seeds a true v2 project (no runs.json, leaf_role=None on every page,
legacy ranges in the RAW stored config so the migration can seed runs) and
proves the mutating routes now migrate-first.

The bug shape matches a prior repo incident (stage_settings legacy-schema
migration); the fix mirrors the stage routes exactly.
"""

from __future__ import annotations

import asyncio
import json
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
    PageType,
    Project,
    ProjectConfig,
    ProjectStatus,
)
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


# Legacy range fields the v2->v3 migration reads out of the RAW stored config.
# Front [0,1] roman, body [2,3] arabic, proof [0,3] — these were DELETED from
# ProjectConfig in P1.9, so they live only in the raw JSON blob on disk.
_LEGACY_RANGES = {
    "proof_start_idx0": 0,
    "proof_end_idx0": 3,
    "frontmatter_start_idx0": 0,
    "frontmatter_end_idx0": 1,
    "bodymatter_start_idx0": 2,
    "bodymatter_end_idx0": 3,
    "frontmatter_page_nbr_start": 1,
    "bodymatter_page_nbr_start": 1,
}


def _seed_v2_project_with_ranges(
    settings: Settings,
    project_id: str,
    page_count: int,
    owner_id: str = "default",
) -> None:
    """Create a registry_version=2 project whose RAW config carries legacy ranges.

    ProjectConfig drops the range fields (extra="ignore"), so we put the project
    normally then patch the stored body's ``config`` dict to inject the legacy
    range keys — exactly the shape a real pre-P1.9 v2 project has on disk.
    """

    async def go() -> None:
        db = SqliteDatabase(settings.derived_database_url)
        await db.initialize()
        now = datetime.now(UTC)
        project = Project(
            id=project_id,
            owner_id=owner_id,
            name="t",
            created_at=now,
            updated_at=now,
            status=ProjectStatus.processing,
            page_count=page_count,
            proof_page_count=page_count,
            config=ProjectConfig(book_name="t", source_uri=""),
            storage_prefix=f"projects/{project_id}/",
            registry_version=2,
        )
        await db.put_project(project)

        # Inject the legacy range fields into the raw stored config blob so
        # migrate_project_to_v3 (LegacyRanges.from_config_dict) can seed runs.
        body = json.loads(project.model_dump_json())
        body["config"].update(_LEGACY_RANGES)
        patched = json.dumps(body)

        def _patch() -> None:
            with db._cursor() as cur:
                _ = cur.execute(
                    "INSERT OR REPLACE INTO projects (id, owner_id, body, updated_at) VALUES (?, ?, ?, ?)",
                    (project_id, owner_id, patched, now.timestamp()),
                )

        await db._run(_patch)
        await db.close()

    asyncio.run(go())


def _seed_pages_v2(
    settings: Settings,
    project_id: str,
    page_count: int,
) -> None:
    """Seed pages with leaf_role=None / run_id=None (the v2 pre-migration shape).

    page_type=normal so migrate_project_to_v3 re-derives leaf_role=text and
    assigns each page to its declared range's run.
    """
    data_root = settings.data_root
    svc = build_page_service(data_root, project_id)
    proj_uuid = _to_uuid(project_id)

    try:
        proj_agg = svc.store.get_project(proj_uuid)
    except Exception:
        proj_agg = ProjectAggregate(record=ProjectRecord(project_id=proj_uuid, name="Test"))

    for idx0 in range(page_count):
        page_uuid = uuid.uuid4()
        ops_record = OpsPageRecord(page_id=page_uuid, page_index=idx0, source="raw")
        ext = PrepPageExtension(
            project_id=project_id,
            idx0=idx0,
            prefix="",
            source_stem=f"src_{idx0:03d}",
            ignore=False,
            page_type=PageType.normal,
            leaf_role=None,  # v2 shape — not yet classified
            run_id=None,
        )
        set_extension(ops_record, "prep", ext)
        svc.store.save_page(PageAggregate(record=ops_record))
        proj_agg.add_page(page_id=page_uuid, page_index=idx0)

    svc.store.save_project(proj_agg)


# ─── reorder: prefixes must NOT be wiped on a v2 project ──────────────────────


def test_reorder_on_v2_project_does_not_wipe_prefixes(tmp_path: Path) -> None:
    """reorder_pages on a v2 project migrates first, so prefixes are NOT wiped.

    Without the migrate-first guard, compute_project_prefixes runs over the
    (empty) runs of a still-v2 project and every prefix collapses to "".  With
    the guard, the migration seeds front [0,1] / body [2,3] runs from the legacy
    ranges, so the recomputed prefixes are real, runs-derived strings.
    """
    project_id = "v2_reorder"
    settings = _settings(tmp_path)
    n_pages = 4

    _seed_v2_project_with_ranges(settings, project_id, n_pages)
    _seed_pages_v2(settings, project_id, n_pages)

    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get(f"/api/data/projects/{project_id}/pages")
        assert r.status_code == 200, r.text
        pages_before = sorted(r.json()["pages"], key=lambda p: p["idx0"])
        pid = [f"{p['idx0']:04d}" for p in pages_before]

        # Within-section reorder: swap the two body pages (idx0=2, idx0=3).
        # Both share the body run, so the stale-assignment ambiguity does not
        # apply — we are only proving the prefixes survive migration.
        new_order = [pid[0], pid[1], pid[3], pid[2]]

        r = client.patch(
            f"/api/data/projects/{project_id}/pages/reorder",
            json={"page_ids": new_order},
        )
        assert r.status_code == 200, r.text
        pages_after = sorted(r.json()["pages"], key=lambda p: p["idx0"])

    prefixes = [p["prefix"] for p in pages_after]
    # The bug wiped every prefix to "".  Assert none are empty and they are the
    # real runs-derived values (front roman section "f", body arabic section "p").
    assert all(prefixes), f"prefixes were wiped to empty: {prefixes!r}"
    assert prefixes == ["000f001", "001f002", "002p001", "003p002"], (
        f"expected runs-derived prefixes, got {prefixes!r}"
    )


def test_insert_on_v2_project_does_not_wipe_prefixes(tmp_path: Path) -> None:
    """insert_page on a v2 project migrates first, so existing prefixes survive."""
    project_id = "v2_insert"
    settings = _settings(tmp_path)
    n_pages = 4

    _seed_v2_project_with_ranges(settings, project_id, n_pages)
    _seed_pages_v2(settings, project_id, n_pages)

    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post(
            f"/api/data/projects/{project_id}/pages/insert",
            json={"at_idx0": 4},  # append at end — does not shift existing runs
        )
        assert r.status_code == 200, r.text
        all_pages = sorted(r.json()["pages"], key=lambda p: p["idx0"])

    # The 4 pre-existing pages keep their runs-derived prefixes (NOT wiped to "").
    existing_prefixes = [p["prefix"] for p in all_pages[:4]]
    assert all(existing_prefixes), f"existing prefixes were wiped to empty on insert: {existing_prefixes!r}"
    assert existing_prefixes == ["000f001", "001f002", "002p001", "003p002"], (
        f"expected runs-derived prefixes, got {existing_prefixes!r}"
    )


# ─── update_page: a leaf edit on a v2 project must SURVIVE (not be clobbered) ──


def test_update_page_leaf_edit_survives_on_v2_project(tmp_path: Path) -> None:
    """update_page on a v2 project migrates first, so the leaf edit is not clobbered.

    Without the guard, the PATCH writes leaf_role/run_id onto a still-v2 project;
    a later stage-route access runs migrate_project_to_v3, which re-derives from
    page_type and OVERWRITES the user's edit.  With the guard, update_page
    migrates to v3 first (stamping page_type-derived defaults), THEN applies the
    user's edit on top — and because the project is now v3, no later migration
    re-derives over it, so the edit survives a subsequent read.
    """
    project_id = "v2_update"
    settings = _settings(tmp_path)
    n_pages = 4

    _seed_v2_project_with_ranges(settings, project_id, n_pages)
    _seed_pages_v2(settings, project_id, n_pages)

    app = build_app(settings)
    with TestClient(app) as client:
        # User reclassifies page idx0=2 (a body-text page) as a plate.
        patch = client.patch(
            f"/api/data/projects/{project_id}/pages/2",
            json={"leaf_role": "plate", "run_id": None, "plate_tag": "Plate VIII"},
        )
        assert patch.status_code == 200, patch.text
        assert patch.json()["leaf_role"] == "plate"

        # Touch a stage route to force any (now no-op) migration to run again.
        stages = client.get(f"/api/data/projects/{project_id}/pages/2/stages")
        assert stages.status_code == 200, stages.text

        # The user's edit must SURVIVE — not be re-derived back to text/body.
        got = client.get(f"/api/data/projects/{project_id}/pages/2")
        assert got.status_code == 200, got.text
        body = got.json()

    assert body["leaf_role"] == "plate", (
        f"user's leaf_role edit was clobbered by re-derivation: {body['leaf_role']!r}"
    )
    assert body["run_id"] is None, f"run_id was clobbered: {body['run_id']!r}"
    assert body["plate_tag"] == "Plate VIII", f"plate_tag lost: {body['plate_tag']!r}"


def test_mutating_route_still_409s_on_v1_project(tmp_path: Path) -> None:
    """A pre-v2 (v1) project still 409s on a mutating route (no auto-migration)."""
    project_id = "v1_reorder"
    settings = _settings(tmp_path)
    n_pages = 2

    # Seed a v1 project (registry_version=1) — only v2 auto-migrates.
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
                page_count=n_pages,
                proof_page_count=n_pages,
                config=ProjectConfig(book_name="t", source_uri=""),
                storage_prefix=f"projects/{project_id}/",
                registry_version=1,
            )
        )
        await db.close()

    asyncio.run(go())
    _seed_pages_v2(settings, project_id, n_pages)

    app = build_app(settings)
    with TestClient(app) as client:
        r = client.patch(
            f"/api/data/projects/{project_id}/pages/reorder",
            json={"page_ids": ["0001", "0000"]},
        )
    assert r.status_code == 409, r.text
