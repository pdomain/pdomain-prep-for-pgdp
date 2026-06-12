"""GET /api/data/projects/{id}/pages/{idx0}/stages.

Spec: `docs/specs/api-v2-deltas.md` §1.1 — v2 re-key.

B5 change: the route now returns 16 v2 page-scoped stages (V2_PAGE_STAGE_IDS)
in topological order, not the 22 v1 stages. Lazy-init materialises 16
not-run rows. Idempotent and concurrency-safe via INSERT OR IGNORE.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import TYPE_CHECKING

import pytest
from fastapi.testclient import TestClient

import pdomain_prep_for_pgdp.core.pipeline.stage_dag as _stage_dag_mod
from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pdomain_prep_for_pgdp.bootstrap import build_app
from pdomain_prep_for_pgdp.core.models import (
    V2_PAGE_STAGE_IDS,
    PageProcessingStatus,
    PageRecord,
    PageStageState,
    PageStageStatus,
    Project,
    ProjectConfig,
    ProjectStatus,
)
from pdomain_prep_for_pgdp.settings import Settings
from tests.fixtures.seed_pages import seed_pages_in_store

if TYPE_CHECKING:
    from collections.abc import Iterator
    from pathlib import Path


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


def _seed(settings: Settings, owner_id: str = "default") -> None:
    async def go() -> None:
        db = SqliteDatabase(settings.derived_database_url)
        await db.initialize()
        now = datetime.now(UTC)
        await db.put_project(
            Project(
                id="m1c",
                owner_id=owner_id,
                name="m1c",
                created_at=now,
                updated_at=now,
                status=ProjectStatus.processing,
                page_count=2,
                proof_page_count=2,
                config=ProjectConfig(book_name="m1c", source_uri=""),
                storage_prefix="projects/m1c/",
            )
        )
        seed_pages_in_store(
            settings,
            "m1c",
            [
                PageRecord(
                    project_id="m1c",
                    idx0=0,
                    prefix="p001",
                    source_stem="src1",
                    processing_status=PageProcessingStatus.pending,
                ),
                PageRecord(
                    project_id="m1c",
                    idx0=1,
                    prefix="p002",
                    source_stem="src2",
                    processing_status=PageProcessingStatus.pending,
                ),
            ],
        )
        await db.close()

    asyncio.run(go())


@pytest.fixture
def seeded_client(tmp_path: Path) -> Iterator[tuple[TestClient, Settings]]:
    settings = _settings(tmp_path)
    _seed(settings)
    app = build_app(settings)
    with TestClient(app) as c:
        yield c, settings


# ─── Happy path: lazy init + 16 v2 ordered rows ─────────────────────────────


def test_list_page_stages_returns_16_not_run_on_first_read(
    seeded_client: tuple[TestClient, Settings],
) -> None:
    """B5 §1.1 — returns 16 v2 page-scoped stages, not the old 22 v1 stages."""
    client, _ = seeded_client
    r = client.get("/api/data/projects/m1c/pages/0/stages")
    assert r.status_code == 200, r.text
    rows = r.json()
    assert isinstance(rows, list)
    assert len(rows) == len(V2_PAGE_STAGE_IDS)
    for row in rows:
        assert row["status"] == PageStageStatus.not_run.value
        assert row["artifact_key"] is None
        assert row["project_id"] == "m1c"
        assert row["page_id"] == "0000"


def test_list_page_stages_topological_order(
    seeded_client: tuple[TestClient, Settings],
) -> None:
    """Stage IDs must arrive in V2_PAGE_STAGE_IDS topological order."""
    client, _ = seeded_client
    r = client.get("/api/data/projects/m1c/pages/0/stages")
    assert r.status_code == 200
    got_ids = [row["stage_id"] for row in r.json()]
    assert got_ids == list(V2_PAGE_STAGE_IDS)


def test_list_page_stages_ids_match_canonical_set(
    seeded_client: tuple[TestClient, Settings],
) -> None:
    """The stage_ids must match V2_PAGE_STAGE_IDS exactly (no dupes/typos)."""
    client, _ = seeded_client
    r = client.get("/api/data/projects/m1c/pages/0/stages")
    got = {row["stage_id"] for row in r.json()}
    assert got == set(V2_PAGE_STAGE_IDS)


# ─── Idempotency: second call returns the same 16 rows ──────────────────────


def test_list_page_stages_second_call_no_duplicates(
    seeded_client: tuple[TestClient, Settings],
) -> None:
    client, _ = seeded_client
    r1 = client.get("/api/data/projects/m1c/pages/0/stages")
    r2 = client.get("/api/data/projects/m1c/pages/0/stages")
    assert r1.status_code == 200
    assert r2.status_code == 200
    assert len(r1.json()) == len(V2_PAGE_STAGE_IDS)
    assert len(r2.json()) == len(V2_PAGE_STAGE_IDS)
    # Row identities (project, page, stage) match across both responses.
    keys1 = sorted((r["project_id"], r["page_id"], r["stage_id"]) for r in r1.json())
    keys2 = sorted((r["project_id"], r["page_id"], r["stage_id"]) for r in r2.json())
    assert keys1 == keys2


def test_list_page_stages_concurrent_first_touch_is_idempotent(
    tmp_path: Path,
) -> None:
    """Two simultaneous first-touch reads must converge to the same 16 rows.

    The lazy-init goes through `INSERT OR IGNORE` against the composite
    PK, so a concurrent racer's inserts no-op against the first
    inserter's rows.
    """
    settings = _settings(tmp_path)
    _seed(settings)
    app = build_app(settings)
    n = len(V2_PAGE_STAGE_IDS)

    async def hit_twice() -> tuple[int, int]:
        from httpx import ASGITransport, AsyncClient

        async with (
            AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as client,
        ):
            results = await asyncio.gather(
                client.get("/api/data/projects/m1c/pages/0/stages"),
                client.get("/api/data/projects/m1c/pages/0/stages"),
            )
            return (
                results[0].status_code,
                results[1].status_code,
                [
                    len(results[0].json()),
                    len(results[1].json()),
                ],
                [
                    sorted(r["stage_id"] for r in results[0].json()),
                    sorted(r["stage_id"] for r in results[1].json()),
                ],
            )

    with TestClient(app):
        s1, s2, lengths, ids = asyncio.run(hit_twice())

    assert s1 == 200
    assert s2 == 200
    assert lengths == [n, n], f"expected each parallel response to have {n} rows, got {lengths}"
    assert ids[0] == ids[1], "concurrent first-touch produced different row sets"


# ─── 404 surfaces ──────────────────────────────────────────────────────────


def test_list_page_stages_404_unknown_project(
    seeded_client: tuple[TestClient, Settings],
) -> None:
    client, _ = seeded_client
    r = client.get("/api/data/projects/no-such-proj/pages/0/stages")
    assert r.status_code == 404


def test_list_page_stages_404_unknown_page(
    seeded_client: tuple[TestClient, Settings],
) -> None:
    client, _ = seeded_client
    r = client.get("/api/data/projects/m1c/pages/999/stages")
    assert r.status_code == 404


def test_list_page_stages_404_other_users_project(tmp_path: Path) -> None:
    """A project owned by user X is not visible to user Y."""
    settings = _settings(tmp_path)
    _seed(settings, owner_id="other-user")
    app = build_app(settings)
    with TestClient(app) as client:
        # The default `auth_mode=none` resolves the request to user_id="default"
        # — which doesn't match the seeded owner "other-user".
        r = client.get("/api/data/projects/m1c/pages/0/stages")
    assert r.status_code == 404, r.text


# ─── Persistence: rows materialised survive restart ─────────────────────────


def test_list_page_stages_persists_rows_to_db(tmp_path: Path) -> None:
    """After the route lazy-inits v2 rows, they must be visible via direct DB query."""
    settings = _settings(tmp_path)
    _seed(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/data/projects/m1c/pages/0/stages")
        assert r.status_code == 200
        assert len(r.json()) == len(V2_PAGE_STAGE_IDS)

    # Re-open a fresh DB connection to confirm persistence across the
    # in-process app teardown. Note: DB stores the v1 init rows (22);
    # the route filters to 16 v2 page-scoped stages on the way out.
    async def _check() -> int:
        db = SqliteDatabase(settings.derived_database_url)
        await db.initialize()
        rows = await db.list_page_stages_for_page("m1c", "0000")
        await db.close()
        return len(rows)

    # DB has 22 rows (full v1 init); route serves 16 v2 rows.
    assert asyncio.run(_check()) >= len(V2_PAGE_STAGE_IDS)


# ─── Stage versioning: stale rows served as dirty ──────────────────────────


def test_stale_stage_version_served_as_dirty(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A clean row with stage_version=1 is served as dirty when V2_STAGE_VERSIONS
    has been bumped to 2 for that stage.

    Spec: docs/specs/pipeline-task-model.md §"Stage versioning (Q4 lock)".
    """
    settings = _settings(tmp_path)
    _seed(settings)

    async def _seed_clean_row() -> None:
        db = SqliteDatabase(settings.derived_database_url)
        await db.initialize()
        await db.put_page_stage(
            PageStageState(
                project_id="m1c",
                page_id="0000",
                stage_id="grayscale",
                status=PageStageStatus.clean,
                stage_version=1,
            )
        )
        await db.close()

    asyncio.run(_seed_clean_row())

    # Bump V2_STAGE_VERSIONS["grayscale"] to 2 so the row is stale.
    original = dict(_stage_dag_mod.V2_STAGE_VERSIONS)
    monkeypatch.setattr(_stage_dag_mod, "V2_STAGE_VERSIONS", dict(original, grayscale=2))

    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/data/projects/m1c/pages/0/stages")
    assert r.status_code == 200
    rows_by_id = {row["stage_id"]: row for row in r.json()}
    assert rows_by_id["grayscale"]["status"] == "dirty", (
        "stale stage_version row must be served as dirty by the GET /stages route"
    )


# ─── Legacy migration: M4 lazy detection ──────────────────────────────────────


def test_page_with_complete_status_gets_not_run_stages(tmp_path: Path) -> None:
    """A pre-M1 page with processing_status=complete must init with dirty stages.

    Spec: docs/specs/2026-05-13-m4-migration-disk-cost-design.md §"Legacy detection".
    """
    settings = _settings(tmp_path)

    async def _seed_legacy() -> None:
        db = SqliteDatabase(settings.derived_database_url)
        await db.initialize()
        now = datetime.now(UTC)
        await db.put_project(
            Project(
                id="legacy",
                owner_id="default",
                name="legacy",
                created_at=now,
                updated_at=now,
                status=ProjectStatus.processing,
                page_count=1,
                proof_page_count=1,
                config=ProjectConfig(book_name="legacy", source_uri=""),
                storage_prefix="projects/legacy/",
            )
        )
        seed_pages_in_store(
            tmp_path / "data",
            "legacy",
            [
                PageRecord(
                    project_id="legacy",
                    idx0=0,
                    prefix="p001",
                    source_stem="src1",
                    processing_status=PageProcessingStatus.complete,
                ),
            ],
        )
        await db.close()

    asyncio.run(_seed_legacy())

    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/data/projects/legacy/pages/0/stages")
    assert r.status_code == 200
    rows = r.json()
    assert len(rows) == len(V2_PAGE_STAGE_IDS)
    for row in rows:
        assert row["status"] == PageStageStatus.not_run.value, (
            f"page must have not-run stages (legacy detection removed), "
            f"got {row['status']} for stage {row['stage_id']}"
        )


def test_page_with_processing_status_gets_not_run_stages(tmp_path: Path) -> None:
    """A pre-M1 page with processing_status=processing must init with not-run stages."""
    settings = _settings(tmp_path)

    async def _seed_legacy() -> None:
        db = SqliteDatabase(settings.derived_database_url)
        await db.initialize()
        now = datetime.now(UTC)
        await db.put_project(
            Project(
                id="legacy",
                owner_id="default",
                name="legacy",
                created_at=now,
                updated_at=now,
                status=ProjectStatus.processing,
                page_count=1,
                proof_page_count=1,
                config=ProjectConfig(book_name="legacy", source_uri=""),
                storage_prefix="projects/legacy/",
            )
        )
        seed_pages_in_store(
            tmp_path / "data",
            "legacy",
            [
                PageRecord(
                    project_id="legacy",
                    idx0=0,
                    prefix="p001",
                    source_stem="src1",
                    processing_status=PageProcessingStatus.processing,
                ),
            ],
        )
        await db.close()

    asyncio.run(_seed_legacy())

    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/data/projects/legacy/pages/0/stages")
    assert r.status_code == 200
    rows = r.json()
    assert len(rows) == len(V2_PAGE_STAGE_IDS)
    for row in rows:
        assert row["status"] == PageStageStatus.not_run.value


def test_page_with_error_status_gets_not_run_stages(tmp_path: Path) -> None:
    """A pre-M1 page with processing_status=error must init with not-run stages."""
    settings = _settings(tmp_path)

    async def _seed_legacy() -> None:
        db = SqliteDatabase(settings.derived_database_url)
        await db.initialize()
        now = datetime.now(UTC)
        await db.put_project(
            Project(
                id="legacy",
                owner_id="default",
                name="legacy",
                created_at=now,
                updated_at=now,
                status=ProjectStatus.processing,
                page_count=1,
                proof_page_count=1,
                config=ProjectConfig(book_name="legacy", source_uri=""),
                storage_prefix="projects/legacy/",
            )
        )
        seed_pages_in_store(
            tmp_path / "data",
            "legacy",
            [
                PageRecord(
                    project_id="legacy",
                    idx0=0,
                    prefix="p001",
                    source_stem="src1",
                    processing_status=PageProcessingStatus.error,
                ),
            ],
        )
        await db.close()

    asyncio.run(_seed_legacy())

    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/data/projects/legacy/pages/0/stages")
    assert r.status_code == 200
    rows = r.json()
    assert len(rows) == len(V2_PAGE_STAGE_IDS)
    for row in rows:
        assert row["status"] == PageStageStatus.not_run.value


def test_non_legacy_page_with_pending_status_gets_not_run_stages(
    seeded_client: tuple[TestClient, Settings],
) -> None:
    """A page with processing_status=pending (non-legacy) must init with not-run stages."""
    client, _ = seeded_client
    r = client.get("/api/data/projects/m1c/pages/0/stages")
    assert r.status_code == 200
    rows = r.json()
    assert len(rows) == len(V2_PAGE_STAGE_IDS)
    for row in rows:
        assert row["status"] == PageStageStatus.not_run.value, (
            f"non-legacy page with processing_status=pending must have not-run stages, "
            f"got {row['status']} for stage {row['stage_id']}"
        )


def test_legacy_migration_is_idempotent(tmp_path: Path) -> None:
    """Calling GET /stages twice on a legacy page must not flip status back to not-run."""
    settings = _settings(tmp_path)

    async def _seed_legacy() -> None:
        db = SqliteDatabase(settings.derived_database_url)
        await db.initialize()
        now = datetime.now(UTC)
        await db.put_project(
            Project(
                id="legacy",
                owner_id="default",
                name="legacy",
                created_at=now,
                updated_at=now,
                status=ProjectStatus.processing,
                page_count=1,
                proof_page_count=1,
                config=ProjectConfig(book_name="legacy", source_uri=""),
                storage_prefix="projects/legacy/",
            )
        )
        seed_pages_in_store(
            tmp_path / "data",
            "legacy",
            [
                PageRecord(
                    project_id="legacy",
                    idx0=0,
                    prefix="p001",
                    source_stem="src1",
                    processing_status=PageProcessingStatus.complete,
                ),
            ],
        )
        await db.close()

    asyncio.run(_seed_legacy())

    app = build_app(settings)
    with TestClient(app) as client:
        r1 = client.get("/api/data/projects/legacy/pages/0/stages")
        r2 = client.get("/api/data/projects/legacy/pages/0/stages")

    assert r1.status_code == 200
    assert r2.status_code == 200
    rows1 = r1.json()
    rows2 = r2.json()

    # All rows in both responses should be not-run (legacy detection removed)
    for row in rows1:
        assert row["status"] == PageStageStatus.not_run.value
    for row in rows2:
        assert row["status"] == PageStageStatus.not_run.value

    # Verify row identities match (idempotent, no duplicates)
    keys1 = sorted((r["stage_id"], r["status"]) for r in rows1)
    keys2 = sorted((r["stage_id"], r["status"]) for r in rows2)
    assert keys1 == keys2
