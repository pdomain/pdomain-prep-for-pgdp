"""Tests for GET /api/data/projects/{id}/page-stages/events.

The project-wide page-stage SSE endpoint subscribes to the project-wide key
``page-stages:{project_id}`` in StageEventBroker. The ``_emit`` helper in
stage_runner publishes to BOTH the per-page key AND this project-wide key so
a single subscription receives stage completions for all pages.

Behavior under test:
- Returns 404 for an unknown project.
- Returns 200 text/event-stream and keeps the stream open for a known project.
- Forwards events published to ``page-stages:{project_id}`` to the client.
- Enforces owner-auth: only the project owner sees events.
- Does NOT forward events published to per-page keys only (isolation).

The ``_emit`` dual-publish integration is covered in test_stage_runner_events.py.
"""

from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime
from typing import TYPE_CHECKING

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
from pdomain_prep_for_pgdp.core.stage_events import project_page_stage_events_key
from pdomain_prep_for_pgdp.settings import Settings
from tests.fixtures.seed_pages import seed_pages_in_store

if TYPE_CHECKING:
    from collections.abc import AsyncIterator
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


def _seed(settings: Settings, project_id: str = "proj-sse", page_count: int = 3) -> None:
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
                page_count=page_count,
                proof_page_count=page_count,
                config=ProjectConfig(book_name=project_id, source_uri=""),
                storage_prefix=f"projects/{project_id}/",
            )
        )
        pages = [
            PageRecord(
                project_id=project_id,
                idx0=i,
                prefix=f"p{i + 1:03d}",
                source_stem=f"src{i}",
                processing_status=PageProcessingStatus.pending,
            )
            for i in range(page_count)
        ]
        seed_pages_in_store(settings, project_id, pages)
        await db.close()

    asyncio.run(go())


class _TerminatingBroker:
    """Test broker that terminates subscribe() immediately so the SSE stream closes."""

    async def subscribe(self, key: str) -> AsyncIterator[dict]:  # type: ignore[override]
        return
        yield  # make it an async generator

    async def publish(self, key: str, event: dict) -> None:
        pass

    async def close(self, key: str) -> None:
        pass


class _OneEventBroker:
    """Test broker that yields one event on the project-wide key then terminates."""

    def __init__(self, event: dict, expected_key: str) -> None:
        self._event = event
        self._expected_key = expected_key
        self.received_keys: list[str] = []

    async def subscribe(self, key: str) -> AsyncIterator[dict]:  # type: ignore[override]
        self.received_keys.append(key)
        if key == self._expected_key:
            yield self._event

    async def publish(self, key: str, event: dict) -> None:
        pass

    async def close(self, key: str) -> None:
        pass


def test_project_page_stage_sse_returns_404_for_unknown_project(tmp_path: Path) -> None:
    """Unknown project_id → 404 (no streaming)."""
    settings = _settings(tmp_path)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/data/projects/no-such-project/page-stages/events")
        assert r.status_code == 404


def test_project_page_stage_sse_returns_200_stream_for_known_project(tmp_path: Path) -> None:
    """Opening the endpoint for a valid project yields 200 text/event-stream."""
    settings = _settings(tmp_path)
    _seed(settings)
    app = build_app(settings)
    # Terminate immediately so the test doesn't hang waiting for events.
    app.state.stage_events = _TerminatingBroker()

    with (
        TestClient(app) as client,
        client.stream("GET", "/api/data/projects/proj-sse/page-stages/events") as resp,
    ):
        assert resp.status_code == 200
        assert "text/event-stream" in resp.headers.get("content-type", "")
        # Consume the (empty) stream — it closes immediately via the terminating broker.
        list(resp.iter_lines())


def test_project_page_stage_sse_forwards_event_from_project_wide_key(tmp_path: Path) -> None:
    """stage-status events published to the project-wide key appear in the stream."""
    settings = _settings(tmp_path)
    _seed(settings)
    app = build_app(settings)

    project_id = "proj-sse"
    expected_key = project_page_stage_events_key(project_id)
    ev = {
        "type": "stage-status",
        "stage_id": "grayscale",
        "status": "clean",
        "job_id": None,
        "error_message": None,
        "idx0": 1,
        "last_run_at": 1_718_000_000,
    }
    broker = _OneEventBroker(ev, expected_key)
    app.state.stage_events = broker

    with (
        TestClient(app) as client,
        client.stream("GET", f"/api/data/projects/{project_id}/page-stages/events") as resp,
    ):
        assert resp.status_code == 200
        chunks: list[str] = []
        for line in resp.iter_lines():
            chunks.append(line)

    # The broker was subscribed with the project-wide key.
    assert expected_key in broker.received_keys

    data_lines = [ln for ln in chunks if ln.startswith("data:")]
    assert len(data_lines) >= 1
    parsed = json.loads(data_lines[0][len("data:") :].strip())
    assert parsed["type"] == "stage-status"
    assert parsed["stage_id"] == "grayscale"
    assert parsed["status"] == "clean"
    assert parsed["idx0"] == 1


def test_project_page_stage_sse_uses_project_wide_key_not_per_page(tmp_path: Path) -> None:
    """The endpoint subscribes to ``page-stages:{project_id}`` (not a per-page key)."""
    settings = _settings(tmp_path)
    _seed(settings, page_count=232)
    app = build_app(settings)

    project_id = "proj-sse"
    expected_key = project_page_stage_events_key(project_id)

    # Broker that records the key it was subscribed with.
    class _RecordingBroker:
        def __init__(self) -> None:
            self.subscribed_keys: list[str] = []

        async def subscribe(self, key: str) -> AsyncIterator[dict]:  # type: ignore[override]
            self.subscribed_keys.append(key)
            return
            yield

        async def publish(self, key: str, event: dict) -> None:
            pass

        async def close(self, key: str) -> None:
            pass

    broker = _RecordingBroker()
    app.state.stage_events = broker

    with (
        TestClient(app) as client,
        client.stream("GET", f"/api/data/projects/{project_id}/page-stages/events") as resp,
    ):
        assert resp.status_code == 200
        list(resp.iter_lines())

    # Exactly one subscription, and it's the project-wide key.
    assert broker.subscribed_keys == [expected_key]
    # NOT a per-page key like "proj-sse:0000"
    assert not any(":" in k and k != expected_key for k in broker.subscribed_keys)


def test_project_page_stage_sse_owner_auth_check(tmp_path: Path) -> None:
    """Project with owner_id != 'default' is not visible to the default user (404)."""
    settings = _settings(tmp_path)

    async def seed_other_owner() -> None:
        db = SqliteDatabase(settings.derived_database_url)
        await db.initialize()
        now = datetime.now(UTC)
        await db.put_project(
            Project(
                id="proj-other",
                owner_id="other-user",  # NOT the default user
                name="proj-other",
                created_at=now,
                updated_at=now,
                status=ProjectStatus.processing,
                page_count=1,
                proof_page_count=1,
                config=ProjectConfig(book_name="proj-other", source_uri=""),
                storage_prefix="projects/proj-other/",
            )
        )
        await db.close()

    asyncio.run(seed_other_owner())

    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/data/projects/proj-other/page-stages/events")
        assert r.status_code == 404
