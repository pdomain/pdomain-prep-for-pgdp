"""Slice B — SSE endpoint GET /api/data/projects/{id}/pages/{idx0}/events.

Behavior:
- Returns 200 text/event-stream for a valid project+page.
- Returns 404 for an unknown project.
- First frame is a 'snapshot' event with current stage states.
- Forwards events from StageEventBroker to the client.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from pathlib import Path

from fastapi.testclient import TestClient

from pd_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pd_prep_for_pgdp.bootstrap import build_app
from pd_prep_for_pgdp.core.models import (
    PageProcessingStatus,
    PageRecord,
    PipelineState,
    Project,
    ProjectConfig,
    ProjectStatus,
)
from pd_prep_for_pgdp.settings import Settings


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


def _seed(settings: Settings, project_id: str = "p1") -> None:
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
                pipeline_state=PipelineState(),
                storage_prefix=f"projects/{project_id}/",
            )
        )
        await db.put_pages(
            [
                PageRecord(
                    project_id=project_id,
                    idx0=0,
                    prefix="p001",
                    source_stem="src1",
                    processing_status=PageProcessingStatus.pending,
                ),
            ]
        )
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
    """Test broker that yields one event then terminates, so the SSE stream closes."""

    def __init__(self, event: dict) -> None:
        self._event = event

    async def subscribe(self, key: str) -> AsyncIterator[dict]:  # type: ignore[override]
        yield self._event

    async def publish(self, key: str, event: dict) -> None:
        pass

    async def close(self, key: str) -> None:
        pass


def test_sse_endpoint_returns_404_for_unknown_project(tmp_path: Path) -> None:
    """Unknown project_id → 404 (no streaming)."""
    settings = _settings(tmp_path)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/data/projects/no-such-project/pages/0/events")
        assert r.status_code == 404


def test_sse_endpoint_returns_200_and_snapshot(tmp_path: Path) -> None:
    """Opening the SSE stream yields a 'snapshot' frame followed by stream close."""
    settings = _settings(tmp_path)
    _seed(settings)
    app = build_app(settings)
    # Replace the real broker with one that terminates after the snapshot
    # so the SSE stream closes naturally and the test doesn't hang.
    app.state.stage_events = _TerminatingBroker()

    with TestClient(app) as client, client.stream("GET", "/api/data/projects/p1/pages/0/events") as resp:
        assert resp.status_code == 200
        assert "text/event-stream" in resp.headers.get("content-type", "")
        chunks: list[str] = []
        for line in resp.iter_lines():
            chunks.append(line)
            # Stream closed naturally; parse the events from collected lines.

    data_lines = [ln for ln in chunks if ln.startswith("data:")]
    assert len(data_lines) >= 1
    first = json.loads(data_lines[0][len("data:") :].strip())
    assert first["type"] == "snapshot"
    assert "stages" in first


def test_sse_endpoint_forwards_broker_event(tmp_path: Path) -> None:
    """stage-status events from the broker appear in the SSE stream after the snapshot."""
    settings = _settings(tmp_path)
    _seed(settings)
    app = build_app(settings)
    ev = {"type": "stage-status", "stage_id": "grayscale", "status": "clean"}
    app.state.stage_events = _OneEventBroker(ev)

    with TestClient(app) as client, client.stream("GET", "/api/data/projects/p1/pages/0/events") as resp:
        assert resp.status_code == 200
        chunks: list[str] = []
        for line in resp.iter_lines():
            chunks.append(line)

    data_lines = [ln for ln in chunks if ln.startswith("data:")]
    assert len(data_lines) >= 2  # snapshot + the broker event
    second = json.loads(data_lines[1][len("data:") :].strip())
    assert second["type"] == "stage-status"
    assert second["stage_id"] == "grayscale"
    assert second["status"] == "clean"
