"""P1.8 — GET/PUT /project-stages/page_order/runs round-trip.

Tests that:
- PUT with a NumberingRunsArtifact body → 200, runs.json written, event recorded.
- GET after PUT returns the persisted artifact.
- PUT → GET round-trip preserves run ids and fields.
- 404 for unknown project on GET and PUT.
- 404 for another user's project on GET and PUT (no leak).
- 409 for registry v1 project on GET and PUT.
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
    registry_version: int = 2,
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
                page_count=3,
                proof_page_count=3,
                config=ProjectConfig(book_name="t", source_uri=""),
                storage_prefix=f"projects/{project_id}/",
                registry_version=registry_version,
            )
        )
        await db.close()

    asyncio.run(go())


_RUNS_BODY = {
    "version": 1,
    "runs": [
        {
            "id": "front",
            "label": "Front",
            "style": "roman-lower",
            "start_mode": "set",
            "start": 1,
            "step": 1,
            "role": "text",
            "span": [0, 1],
            "note": "",
        },
        {
            "id": "body",
            "label": "Body",
            "style": "arabic",
            "start_mode": "set",
            "start": 1,
            "step": 1,
            "role": "text",
            "span": [2, 5],
            "note": "",
        },
    ],
}

_RUNS_URL = "/api/data/projects/proj1/project-stages/page_order/runs"


# ─── Round-trip ───────────────────────────────────────────────────────────────


def test_put_then_get_runs_roundtrip(tmp_path: Path) -> None:
    """PUT then GET returns the same runs list."""
    settings = _settings(tmp_path)
    _seed(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        put = client.put(_RUNS_URL, json=_RUNS_BODY)
        assert put.status_code == 200, put.text

        got = client.get(_RUNS_URL)
        assert got.status_code == 200, got.text
        data = got.json()
        assert [r["id"] for r in data["runs"]] == ["front", "body"]


def test_put_runs_persists_to_disk(tmp_path: Path) -> None:
    """PUT writes runs.json to the page_order stage directory."""
    settings = _settings(tmp_path)
    _seed(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        client.put(_RUNS_URL, json=_RUNS_BODY)

    runs_path = settings.data_root / "projects" / "proj1" / "stages" / "page_order" / "runs.json"
    assert runs_path.exists(), "runs.json not created on disk"
    import json

    stored = json.loads(runs_path.read_text())
    assert stored["version"] == 1
    assert len(stored["runs"]) == 2
    assert stored["runs"][0]["id"] == "front"


def test_get_runs_empty_artifact_when_no_put(tmp_path: Path) -> None:
    """GET before any PUT returns empty runs artifact (version=1, runs=[])."""
    settings = _settings(tmp_path)
    _seed(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        got = client.get(_RUNS_URL)
    assert got.status_code == 200, got.text
    data = got.json()
    assert data["runs"] == []
    assert data["version"] == 1


def test_put_runs_records_numbering_runs_changed_event(tmp_path: Path) -> None:
    """PUT records NumberingRunsChanged event in events.db."""
    from pdomain_prep_for_pgdp.core.pipeline.prep_aggregate import (
        PrepApplication,
        PrepProjectAggregate,
    )

    settings = _settings(tmp_path)
    _seed(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.put(_RUNS_URL, json=_RUNS_BODY)
    assert r.status_code == 200

    events_db = settings.data_root / "projects" / "proj1" / "events.db"
    assert events_db.exists(), "events.db not created"

    # Reconstruct aggregate and verify version advanced (event appended).
    agg_id = PrepProjectAggregate.create_id(uuid.uuid5(uuid.NAMESPACE_OID, "proj1"))
    ev_app = PrepApplication(
        env={
            "PERSISTENCE_MODULE": "eventsourcing.sqlite",
            "SQLITE_DBNAME": str(events_db),
        }
    )
    loaded = ev_app.repository.get(agg_id)
    assert loaded.version >= 1  # type: ignore[attr-defined]


# ─── 404 / 409 guards ─────────────────────────────────────────────────────────


def test_put_runs_404_on_missing_project(tmp_path: Path) -> None:
    """PUT → 404 when project does not exist."""
    settings = _settings(tmp_path)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.put(
            "/api/data/projects/NOTEXIST/project-stages/page_order/runs",
            json=_RUNS_BODY,
        )
    assert r.status_code == 404


def test_get_runs_404_on_missing_project(tmp_path: Path) -> None:
    """GET → 404 when project does not exist."""
    settings = _settings(tmp_path)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get(
            "/api/data/projects/NOTEXIST/project-stages/page_order/runs",
        )
    assert r.status_code == 404


def test_put_runs_404_for_other_users_project(tmp_path: Path) -> None:
    """PUT → 404 when project belongs to a different user (no leak)."""
    settings = _settings(tmp_path)
    _seed(settings, owner_id="someone-else")
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.put(_RUNS_URL, json=_RUNS_BODY)
    assert r.status_code == 404


def test_get_runs_404_for_other_users_project(tmp_path: Path) -> None:
    """GET → 404 when project belongs to a different user (no leak)."""
    settings = _settings(tmp_path)
    _seed(settings, owner_id="someone-else")
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get(_RUNS_URL)
    assert r.status_code == 404


def test_put_runs_409_on_registry_v1(tmp_path: Path) -> None:
    """PUT → 409 for a v1 (legacy) project."""
    settings = _settings(tmp_path)
    _seed(settings, registry_version=1)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.put(_RUNS_URL, json=_RUNS_BODY)
    assert r.status_code == 409


def test_get_runs_409_on_registry_v1(tmp_path: Path) -> None:
    """GET → 409 for a v1 (legacy) project."""
    settings = _settings(tmp_path)
    _seed(settings, registry_version=1)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get(_RUNS_URL)
    assert r.status_code == 409


def test_put_runs_empty_body_is_valid(tmp_path: Path) -> None:
    """PUT with {} is valid — NumberingRunsArtifact defaults runs=[] version=1."""
    settings = _settings(tmp_path)
    _seed(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.put(_RUNS_URL, json={})
    assert r.status_code == 200, r.text
    assert r.json()["run_count"] == 0


def test_put_runs_invalid_style_rejected(tmp_path: Path) -> None:
    """PUT with unknown RunStyle value → 4xx (validation error)."""
    settings = _settings(tmp_path)
    _seed(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.put(
            _RUNS_URL,
            json={"version": 1, "runs": [{"id": "x", "style": "bad_style"}]},
        )
    # FastAPI/Pydantic rejects invalid enum values; status is 422 or 400.
    assert r.status_code in (400, 422)
