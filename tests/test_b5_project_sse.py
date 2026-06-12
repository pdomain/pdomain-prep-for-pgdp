"""B5 Group 6 — Project SSE channel GET /api/data/projects/{id}/events.

Behaviors tested:
- 404 for unknown project.
- On-connect snapshot frame has type=project-snapshot with project_stages list.
- Incremental project-stage-status event arrives after stage run.
- 409 registry-version guard fires before the stream opens.
"""

from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

from fastapi.testclient import TestClient

from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pdomain_prep_for_pgdp.bootstrap import build_app
from pdomain_prep_for_pgdp.core.models import (
    PageProcessingStatus,
    PageRecord,
    Project,
    ProjectConfig,
    ProjectStatus,
)
from pdomain_prep_for_pgdp.settings import Settings
from tests.fixtures.seed_pages import seed_pages_in_store


def _settings(tmp_path):
    return Settings(
        host="127.0.0.1",
        port=8765,
        data_root=tmp_path / "data",
        config_dir=tmp_path / "config",
        storage_backend="filesystem",
        database_url=f"sqlite:///{(tmp_path / 'state.db').as_posix()}",
        auth_mode="none",
        gpu_backend="cpu",
        dispatch_interval_seconds=0,
    )


def _seed_project(settings, project_id: str = "proj1", registry_version: int = 2) -> None:
    async def go() -> None:
        db = SqliteDatabase(settings.derived_database_url)
        await db.initialize()
        now = datetime.now(UTC)
        await db.put_project(
            Project(
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
                registry_version=registry_version,
            )
        )
        await db.close()

    asyncio.run(go())
    seed_pages_in_store(
        settings,
        project_id,
        [
            PageRecord(
                project_id=project_id,
                idx0=0,
                prefix="p001",
                source_stem="src1",
                processing_status=PageProcessingStatus.pending,
            )
        ],
    )


class _TerminatingBroker:
    """A drop-in broker that yields pre-loaded events then raises StopAsyncIteration."""

    def __init__(self, events: list[dict]) -> None:
        self._events = list(events)

    async def publish(self, key: str, event: dict) -> None:
        pass

    def subscribe(self, key: str) -> AsyncIterator[dict]:
        return _TerminatingIter(list(self._events))


class _TerminatingIter:
    def __init__(self, events: list[dict]) -> None:
        self._events = events
        self._idx = 0

    def __aiter__(self) -> _TerminatingIter:
        return self

    async def __anext__(self) -> dict:
        if self._idx >= len(self._events):
            raise StopAsyncIteration
        ev = self._events[self._idx]
        self._idx += 1
        return ev


# ─── Route existence ─────────────────────────────────────────────────────────


def test_project_events_404_unknown_project(tmp_path):
    """GET /projects/nope/events → 404."""
    settings = _settings(tmp_path)
    app = build_app(settings)
    # Use a terminating broker so the request doesn't hang.
    app.state.stage_events = _TerminatingBroker([])

    with TestClient(app) as client:
        r = client.get("/api/data/projects/nope/events")
    assert r.status_code == 404


# ─── On-connect snapshot ──────────────────────────────────────────────────────


def test_project_events_snapshot_frame(tmp_path):
    """First SSE frame has type=project-snapshot with project_stages list."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1")
    app = build_app(settings)
    app.state.stage_events = _TerminatingBroker([])

    with TestClient(app) as client, client.stream("GET", "/api/data/projects/proj1/events") as resp:
        assert resp.status_code == 200
        chunks: list[str] = []
        for line in resp.iter_lines():
            chunks.append(line)

    data_lines = [ln for ln in chunks if ln.startswith("data:")]
    assert len(data_lines) >= 1
    first = json.loads(data_lines[0][len("data:") :].strip())
    assert first["type"] == "project-snapshot"
    assert "project_stages" in first
    assert isinstance(first["project_stages"], list)


def test_project_events_incremental_push(tmp_path):
    """Incremental project-stage-status event is relayed to the SSE stream."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1")
    app = build_app(settings)
    push = {
        "type": "project-stage-status",
        "stage_id": "source",
        "status": "clean",
        "job_id": "abc123",
        "error_message": None,
    }
    app.state.stage_events = _TerminatingBroker([push])

    with TestClient(app) as client, client.stream("GET", "/api/data/projects/proj1/events") as resp:
        chunks: list[str] = []
        for line in resp.iter_lines():
            chunks.append(line)

    data_lines = [ln for ln in chunks if ln.startswith("data:")]
    event_types = [json.loads(ln[len("data:") :].strip())["type"] for ln in data_lines]
    assert "project-snapshot" in event_types
    assert "project-stage-status" in event_types


def test_project_events_409_v1_project(tmp_path):
    """Project events route returns 409 for a v1 project."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1", registry_version=1)
    app = build_app(settings)
    app.state.stage_events = _TerminatingBroker([])

    with TestClient(app) as client:
        r = client.get("/api/data/projects/proj1/events")
    assert r.status_code == 409
    body = r.json()
    assert body["error"] == "registry_version_mismatch"
