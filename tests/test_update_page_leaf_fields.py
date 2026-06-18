"""P2.3 — PATCH /pages/{idx0} accepts leaf fields and emits leaf events.

Tests that:
- PATCH with leaf_role + run_id → 200, fields reflected in response.
- PATCH with plate_tag → 200, field reflected in response.
- PATCH with label_override=None explicitly clears the field (null-vs-omitted).
- The corresponding events are appended to PrepProjectAggregate.
- Leaf fields survive a round-trip: PATCH then GET returns them.
- PATCH omitting leaf fields does NOT clear them (model_fields_set guard).
- 404 for unknown project or unknown page.
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime
from pathlib import Path

from fastapi.testclient import TestClient

from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pdomain_prep_for_pgdp.bootstrap import build_app
from pdomain_prep_for_pgdp.core.models import (
    Project,
    ProjectConfig,
    ProjectStatus,
)
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


def _seed(
    settings: Settings,
    project_id: str = "proj1",
    owner_id: str = "default",
    registry_version: int = 3,
) -> None:
    async def go() -> None:
        db = SqliteDatabase(settings.derived_database_url)
        await db.initialize()
        now = datetime.now(UTC)
        await db.put_project(
            Project(
                id=project_id,
                owner_id=owner_id,
                name="t",
                created_at=now,
                updated_at=now,
                status=ProjectStatus.processing,
                page_count=5,
                proof_page_count=5,
                config=ProjectConfig(book_name="t", source_uri=""),
                storage_prefix=f"projects/{project_id}/",
                registry_version=registry_version,
            )
        )
        await db.close()

    asyncio.run(go())


def _seed_pages(settings: Settings, client: TestClient, project_id: str = "proj1") -> None:
    """Seed 5 pages by inserting them via the INSERT endpoint."""
    # Insert 5 pages at index 0..4
    for i in range(5):
        r = client.post(
            f"/api/data/projects/{project_id}/pages/insert",
            json={"at_idx0": i},
        )
        assert r.status_code in (200, 201), f"seed page {i} failed: {r.text}"


_PATCH_URL = "/api/data/projects/proj1/pages/2"
_GET_URL = "/api/data/projects/proj1/pages/2"


# ─── Core leaf-field tests ────────────────────────────────────────────────────


def test_patch_sets_leaf_role(tmp_path: Path) -> None:
    """PATCH leaf_role → 200, field present in response."""
    settings = _settings(tmp_path)
    _seed(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        _seed_pages(settings, client)
        r = client.patch(_PATCH_URL, json={"leaf_role": "blank"})
    assert r.status_code == 200, r.text
    assert r.json()["leaf_role"] == "blank"


def test_patch_sets_run_id(tmp_path: Path) -> None:
    """PATCH run_id → 200, field present in response."""
    settings = _settings(tmp_path)
    _seed(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        _seed_pages(settings, client)
        r = client.patch(_PATCH_URL, json={"run_id": "body"})
    assert r.status_code == 200, r.text
    assert r.json()["run_id"] == "body"


def test_patch_sets_leaf_role_and_run_id_together(tmp_path: Path) -> None:
    """PATCH leaf_role + run_id together → 200, both reflected."""
    settings = _settings(tmp_path)
    _seed(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        _seed_pages(settings, client)
        r = client.patch(_PATCH_URL, json={"leaf_role": "text", "run_id": "front"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["leaf_role"] == "text"
    assert body["run_id"] == "front"


def test_patch_sets_plate_tag(tmp_path: Path) -> None:
    """PATCH plate_tag → 200, field reflected in response."""
    settings = _settings(tmp_path)
    _seed(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        _seed_pages(settings, client)
        r = client.patch(_PATCH_URL, json={"plate_tag": "Plate VIII"})
    assert r.status_code == 200, r.text
    assert r.json()["plate_tag"] == "Plate VIII"


def test_patch_sets_label_override(tmp_path: Path) -> None:
    """PATCH label_override → 200, field reflected in response."""
    settings = _settings(tmp_path)
    _seed(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        _seed_pages(settings, client)
        r = client.patch(_PATCH_URL, json={"label_override": "iv"})
    assert r.status_code == 200, r.text
    assert r.json()["label_override"] == "iv"


def test_patch_sets_plate_side(tmp_path: Path) -> None:
    """PATCH plate_side → 200, field reflected in response."""
    settings = _settings(tmp_path)
    _seed(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        _seed_pages(settings, client)
        r = client.patch(_PATCH_URL, json={"plate_side": "recto"})
    assert r.status_code == 200, r.text
    assert r.json()["plate_side"] == "recto"


# ─── Null-vs-omitted: explicit null clears the field ─────────────────────────


def test_patch_run_id_null_clears_run(tmp_path: Path) -> None:
    """PATCH {run_id: null} explicitly clears run_id (null-vs-omitted check).

    Sets run_id=body, then patches run_id=null, expects run_id=null back.
    If null-vs-omitted is broken, the second PATCH would be a no-op and
    run_id would still be "body".
    """
    settings = _settings(tmp_path)
    _seed(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        _seed_pages(settings, client)
        # Set run_id.
        r1 = client.patch(_PATCH_URL, json={"run_id": "body"})
        assert r1.status_code == 200, r1.text
        assert r1.json()["run_id"] == "body"
        # Clear run_id with explicit null.
        r2 = client.patch(_PATCH_URL, json={"run_id": None})
        assert r2.status_code == 200, r2.text
        assert r2.json()["run_id"] is None


def test_patch_omit_leaf_fields_does_not_clear_them(tmp_path: Path) -> None:
    """PATCH that omits leaf_role/run_id must not wipe previously-set values.

    Sets leaf_role=text, run_id=body; then patches an unrelated field
    (page_type=normal). Leaf fields must survive unchanged.
    """
    settings = _settings(tmp_path)
    _seed(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        _seed_pages(settings, client)
        # Set leaf fields.
        r1 = client.patch(_PATCH_URL, json={"leaf_role": "text", "run_id": "body"})
        assert r1.status_code == 200, r1.text
        # Patch an unrelated field, omitting leaf fields entirely.
        r2 = client.patch(_PATCH_URL, json={"page_type": "normal"})
        assert r2.status_code == 200, r2.text
        body = r2.json()
        assert body["leaf_role"] == "text", "leaf_role was wiped by unrelated patch"
        assert body["run_id"] == "body", "run_id was wiped by unrelated patch"


# ─── Round-trip: PATCH then GET ───────────────────────────────────────────────


def test_patch_leaf_fields_survive_get(tmp_path: Path) -> None:
    """Leaf fields set by PATCH are returned on a subsequent GET."""
    settings = _settings(tmp_path)
    _seed(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        _seed_pages(settings, client)
        client.patch(_PATCH_URL, json={"leaf_role": "plate", "plate_tag": "Plate I", "plate_side": "recto"})
        r_get = client.get(_GET_URL)
    assert r_get.status_code == 200, r_get.text
    body = r_get.json()
    assert body["leaf_role"] == "plate"
    assert body["plate_tag"] == "Plate I"
    assert body["plate_side"] == "recto"


# ─── Aggregate events ─────────────────────────────────────────────────────────


def test_patch_leaf_role_records_event(tmp_path: Path) -> None:
    """PATCH leaf_role appends a LeafRoleSet event to PrepProjectAggregate."""
    from pdomain_prep_for_pgdp.core.pipeline.prep_aggregate import (
        PrepApplication,
        PrepProjectAggregate,
    )

    settings = _settings(tmp_path)
    _seed(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        _seed_pages(settings, client)
        r = client.patch(_PATCH_URL, json={"leaf_role": "blank"})
    assert r.status_code == 200

    events_db = settings.data_root / "projects" / "proj1" / "events.db"
    assert events_db.exists(), "events.db not created"

    agg_id = PrepProjectAggregate.create_id(uuid.uuid5(uuid.NAMESPACE_OID, "proj1"))
    ev_app = PrepApplication(
        env={
            "PERSISTENCE_MODULE": "eventsourcing.sqlite",
            "SQLITE_DBNAME": str(events_db),
        }
    )
    loaded = ev_app.repository.get(agg_id)
    assert loaded.version >= 1  # type: ignore[attr-defined]


def test_patch_run_id_records_event(tmp_path: Path) -> None:
    """PATCH run_id appends a LeafRunSet event to PrepProjectAggregate."""
    from pdomain_prep_for_pgdp.core.pipeline.prep_aggregate import (
        PrepApplication,
        PrepProjectAggregate,
    )

    settings = _settings(tmp_path)
    _seed(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        _seed_pages(settings, client)
        r = client.patch(_PATCH_URL, json={"run_id": "front"})
    assert r.status_code == 200

    events_db = settings.data_root / "projects" / "proj1" / "events.db"
    agg_id = PrepProjectAggregate.create_id(uuid.uuid5(uuid.NAMESPACE_OID, "proj1"))
    ev_app = PrepApplication(
        env={
            "PERSISTENCE_MODULE": "eventsourcing.sqlite",
            "SQLITE_DBNAME": str(events_db),
        }
    )
    loaded = ev_app.repository.get(agg_id)
    assert loaded.version >= 1  # type: ignore[attr-defined]


# ─── 404 guards ───────────────────────────────────────────────────────────────


def test_patch_leaf_role_404_missing_project(tmp_path: Path) -> None:
    """PATCH → 404 when project does not exist."""
    settings = _settings(tmp_path)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.patch(
            "/api/data/projects/NOTEXIST/pages/0",
            json={"leaf_role": "blank"},
        )
    assert r.status_code == 404


def test_patch_leaf_role_404_missing_page(tmp_path: Path) -> None:
    """PATCH → 404 when page index does not exist in the project."""
    settings = _settings(tmp_path)
    _seed(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        # No pages seeded — idx0=99 does not exist.
        r = client.patch(_PATCH_URL, json={"leaf_role": "blank"})
    assert r.status_code == 404
