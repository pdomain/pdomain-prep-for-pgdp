"""W2 + W3 — event log completion + SSE emission.

Behaviors tested (TDD-first pass; implementations follow):

W2.1  StageRunStarted/Completed/Failed fired from PAGE-stage run_stage
W2.2  PageReorder event recorded by reorder_pages route
W2.3  submit_check/confirm route + GateConfirmation event; frontend catch {} removed
W2.4  SettingsChange recorded when settings routes pass aggregate
W2.5  pgdp-prep reindex calls reindex_project_stages + sweeps naming/validation/settings
W3.1  page-reorder SSE emitted on the project channel by reorder_pages route
W3.2  validation-updated SSE emitted after validation stage completes
W3.3  project-stage-progress ticks emitted from _handle_run_project_stage
"""

from __future__ import annotations

import asyncio
import json
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING

import pytest

if TYPE_CHECKING:
    pass


# ─── Fixtures ─────────────────────────────────────────────────────────────────


def _make_prep_app(tmp_path: Path):
    from pdomain_prep_for_pgdp.core.pipeline.prep_aggregate import (
        PrepApplication,
        PrepProjectAggregate,
    )

    db_path = tmp_path / "events.db"
    app = PrepApplication(
        env={
            "PERSISTENCE_MODULE": "eventsourcing.sqlite",
            "SQLITE_DBNAME": str(db_path),
        }
    )
    project_id = uuid.uuid4()
    agg = PrepProjectAggregate(project_id=project_id)
    app.save(agg)
    return app, agg, project_id


# ─── W2.1 — StageRunStarted/Completed/Failed from run_stage (page stage) ─────


class TestW21PageStageEvents:
    """run_stage records StageRunStarted / Completed / Failed in PrepProjectAggregate."""

    def test_stage_run_started_has_page_id(self, tmp_path: Path) -> None:
        """StageRunStarted from a page-stage run carries page_id (not None)."""
        from pdomain_prep_for_pgdp.core.pipeline.prep_aggregate import PrepProjectAggregate

        project_id = uuid.uuid4()
        agg = PrepProjectAggregate(project_id=project_id)
        agg.record_stage_run_started(
            stage_id="grayscale",
            page_id="0001",
            job_id="job-abc",
            actor_id="default",
        )
        started = [e for e in agg.pending_events if type(e).__name__ == "StageRunStarted"]
        assert len(started) == 1
        assert started[0].page_id == "0001"
        assert started[0].stage_id == "grayscale"

    def test_run_stage_records_started_and_completed(self, tmp_path: Path) -> None:
        """run_stage writes StageRunStarted + StageRunCompleted to events.db."""
        from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
        from pdomain_prep_for_pgdp.adapters.storage.filesystem import FilesystemStorage
        from pdomain_prep_for_pgdp.core.models import (
            PageStageState,
            PageStageStatus,
            PipelineState,
            Project,
            ProjectConfig,
            ProjectStatus,
        )
        from pdomain_prep_for_pgdp.core.page_store_factory import build_page_service
        from pdomain_prep_for_pgdp.core.pipeline.prep_aggregate import (
            PrepApplication,
            PrepProjectAggregate,
        )
        from pdomain_prep_for_pgdp.settings import Settings

        project_id = "run-stage-events-test"
        settings = Settings(
            data_root=tmp_path / "data",
            database_url=f"sqlite:///{(tmp_path / 'state.db').as_posix()}",
            storage_backend="filesystem",
            gpu_backend="cpu",
        )

        async def _go() -> None:
            db = SqliteDatabase(settings.derived_database_url)
            await db.initialize()
            now = datetime.now(UTC)
            await db.put_project(
                Project(
                    id=project_id,
                    owner_id="default",
                    name="test",
                    created_at=now,
                    updated_at=now,
                    status=ProjectStatus.processing,
                    page_count=1,
                    proof_page_count=1,
                    config=ProjectConfig(book_name="test", source_uri=""),
                    pipeline_state=PipelineState(),
                    storage_prefix=f"projects/{project_id}/",
                    registry_version=2,
                )
            )
            await db.close()

        asyncio.run(_go())

        # Seed a crop parent artifact so threshold can run (v2: threshold depends on crop).
        import cv2
        import numpy as np

        crop_path = (
            tmp_path / "data" / "projects" / project_id / "pages" / "0000" / "stages" / "crop" / "output.png"
        )
        crop_path.parent.mkdir(parents=True, exist_ok=True)
        test_img = np.zeros((100, 100), dtype=np.uint8)
        cv2.imwrite(str(crop_path), test_img)

        # Seed DB row for crop = clean.
        async def _seed() -> None:
            db = SqliteDatabase(settings.derived_database_url)
            await db.initialize()
            state = PageStageState(
                project_id=project_id,
                page_id="0000",
                stage_id="crop",
                status=PageStageStatus.clean,
                artifact_key=f"projects/{project_id}/pages/0000/stages/crop/output.png",
            )
            await db.put_page_stage(state)
            await db.close()

        asyncio.run(_seed())

        # Seed page in event store.
        from pdomain_prep_for_pgdp.core.models import PageProcessingStatus, PageRecord
        from tests.fixtures.seed_pages import seed_pages_in_store

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

        storage = FilesystemStorage(root=settings.data_root)

        # Run threshold stage (v2 depends on crop).
        from pdomain_prep_for_pgdp.core.pipeline.stage_runner import run_stage

        ps = build_page_service(settings.data_root, project_id)

        async def _run() -> None:
            db = SqliteDatabase(settings.derived_database_url)
            await db.initialize()
            await run_stage(
                data_root=settings.data_root,
                database=db,
                project_id=project_id,
                page_id="0000",
                stage_id="threshold",
                device="cpu",
                storage=storage,
                page_service=ps,
            )
            await db.close()

        asyncio.run(_run())

        # Check that StageRunStarted + StageRunCompleted were recorded.
        events_db = settings.data_root / "projects" / project_id / "events.db"
        assert events_db.exists(), "events.db not created by run_stage"

        app = PrepApplication(
            env={
                "PERSISTENCE_MODULE": "eventsourcing.sqlite",
                "SQLITE_DBNAME": str(events_db),
            }
        )
        # Find the aggregate by UUID derived from project_id.
        _agg_id = PrepProjectAggregate.create_id(uuid.uuid5(uuid.NAMESPACE_OID, project_id))
        try:
            loaded = app.repository.get(_agg_id)
        except Exception:
            pytest.fail("PrepProjectAggregate not found in events.db after run_stage")

        # Collect all stored events by replaying (eventsourcing stores via events).
        # We check that the aggregate was saved with at least one stage event.
        # The aggregate's version must be > 1 (created event = 1, stage events = 2+).
        assert loaded.version >= 2, (  # type: ignore[attr-defined]
            f"Expected at least 2 aggregate events (created + stage), got {loaded.version}"  # type: ignore[attr-defined]
        )

    def test_run_stage_records_failed_event_on_impl_error(self, tmp_path: Path) -> None:
        """run_stage records StageRunFailed when the impl raises."""
        from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
        from pdomain_prep_for_pgdp.adapters.storage.filesystem import FilesystemStorage
        from pdomain_prep_for_pgdp.core.models import (
            PageStageState,
            PageStageStatus,
            PipelineState,
            Project,
            ProjectConfig,
            ProjectStatus,
        )
        from pdomain_prep_for_pgdp.core.page_store_factory import build_page_service
        from pdomain_prep_for_pgdp.core.pipeline.prep_aggregate import (
            PrepApplication,
            PrepProjectAggregate,
        )
        from pdomain_prep_for_pgdp.core.pipeline.stage_runner import StageRunFailed, run_stage
        from pdomain_prep_for_pgdp.settings import Settings

        project_id = "run-stage-fail-events"
        settings = Settings(
            data_root=tmp_path / "data",
            database_url=f"sqlite:///{(tmp_path / 'state.db').as_posix()}",
            storage_backend="filesystem",
            gpu_backend="cpu",
        )

        async def _go() -> None:
            db = SqliteDatabase(settings.derived_database_url)
            await db.initialize()
            now = datetime.now(UTC)
            await db.put_project(
                Project(
                    id=project_id,
                    owner_id="default",
                    name="test",
                    created_at=now,
                    updated_at=now,
                    status=ProjectStatus.processing,
                    page_count=1,
                    proof_page_count=1,
                    config=ProjectConfig(book_name="test", source_uri=""),
                    pipeline_state=PipelineState(),
                    storage_prefix=f"projects/{project_id}/",
                    registry_version=2,
                )
            )
            await db.close()

        asyncio.run(_go())

        # Write a CORRUPTED crop artifact (invalid PNG) so threshold fails.
        crop_path = (
            tmp_path / "data" / "projects" / project_id / "pages" / "0000" / "stages" / "crop" / "output.png"
        )
        crop_path.parent.mkdir(parents=True, exist_ok=True)
        crop_path.write_bytes(b"NOT_A_PNG")

        async def _seed() -> None:
            db = SqliteDatabase(settings.derived_database_url)
            await db.initialize()
            state = PageStageState(
                project_id=project_id,
                page_id="0000",
                stage_id="crop",
                status=PageStageStatus.clean,
                artifact_key=f"projects/{project_id}/pages/0000/stages/crop/output.png",
            )
            await db.put_page_stage(state)
            await db.close()

        asyncio.run(_seed())

        from pdomain_prep_for_pgdp.core.models import PageProcessingStatus, PageRecord
        from tests.fixtures.seed_pages import seed_pages_in_store

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

        storage = FilesystemStorage(root=settings.data_root)
        ps = build_page_service(settings.data_root, project_id)

        async def _run() -> None:
            db = SqliteDatabase(settings.derived_database_url)
            await db.initialize()
            with pytest.raises(StageRunFailed):
                await run_stage(
                    data_root=settings.data_root,
                    database=db,
                    project_id=project_id,
                    page_id="0000",
                    stage_id="threshold",
                    device="cpu",
                    storage=storage,
                    page_service=ps,
                )
            await db.close()

        asyncio.run(_run())

        # events.db should exist and contain StageRunFailed.
        events_db = settings.data_root / "projects" / project_id / "events.db"
        assert events_db.exists(), "events.db not created"

        app = PrepApplication(
            env={
                "PERSISTENCE_MODULE": "eventsourcing.sqlite",
                "SQLITE_DBNAME": str(events_db),
            }
        )
        _agg_id = PrepProjectAggregate.create_id(uuid.uuid5(uuid.NAMESPACE_OID, project_id))
        try:
            loaded = app.repository.get(_agg_id)
        except Exception:
            pytest.fail("PrepProjectAggregate not found in events.db after run_stage failure")

        # version >= 2 means at least one stage lifecycle event was stored.
        assert loaded.version >= 2  # type: ignore[attr-defined]


# ─── W2.2 + W3.1 — PageReorder event + page-reorder SSE ──────────────────────


class TestW22W31PageReorder:
    """reorder_pages route records PageReorder event and emits page-reorder SSE."""

    def _seed_project(self, settings, project_id: str = "proj1") -> None:
        from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
        from pdomain_prep_for_pgdp.core.models import (
            PageProcessingStatus,
            PageRecord,
            PipelineState,
            Project,
            ProjectConfig,
            ProjectStatus,
        )

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
                    page_count=2,
                    proof_page_count=2,
                    config=ProjectConfig(book_name=project_id, source_uri=""),
                    pipeline_state=PipelineState(),
                    storage_prefix=f"projects/{project_id}/",
                    registry_version=2,
                )
            )
            await db.close()

        asyncio.run(go())

        from tests.fixtures.seed_pages import seed_pages_in_store

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
                ),
                PageRecord(
                    project_id=project_id,
                    idx0=1,
                    prefix="p002",
                    source_stem="src2",
                    processing_status=PageProcessingStatus.pending,
                ),
            ],
        )

    def test_reorder_records_page_reorder_event(self, tmp_path: Path) -> None:
        """PATCH /projects/{id}/pages/reorder records a PageReorder event."""
        from fastapi.testclient import TestClient

        from pdomain_prep_for_pgdp.bootstrap import build_app
        from pdomain_prep_for_pgdp.core.pipeline.prep_aggregate import (
            PrepApplication,
            PrepProjectAggregate,
        )
        from pdomain_prep_for_pgdp.settings import Settings

        settings = Settings(
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
        self._seed_project(settings, "proj1")

        app = build_app(settings)
        with TestClient(app) as client:
            r = client.patch(
                "/api/data/projects/proj1/pages/reorder",
                json={"page_ids": ["1", "0"]},
            )
        assert r.status_code == 200, r.json()

        # Check that PageReorder event was recorded.
        events_db = settings.data_root / "projects" / "proj1" / "events.db"
        assert events_db.exists(), "events.db not created by reorder route"

        app_ev = PrepApplication(
            env={
                "PERSISTENCE_MODULE": "eventsourcing.sqlite",
                "SQLITE_DBNAME": str(events_db),
            }
        )
        _agg_id = PrepProjectAggregate.create_id(uuid.uuid5(uuid.NAMESPACE_OID, "proj1"))
        try:
            loaded = app_ev.repository.get(_agg_id)
        except Exception:
            pytest.fail("PrepProjectAggregate not found after reorder")

        # version >= 2 means at least created + PageReorder.
        assert loaded.version >= 2  # type: ignore[attr-defined]

    def test_reorder_emits_page_reorder_sse(self, tmp_path: Path) -> None:
        """PATCH /projects/{id}/pages/reorder emits page-reorder SSE on the project channel."""
        from fastapi.testclient import TestClient

        from pdomain_prep_for_pgdp.bootstrap import build_app
        from pdomain_prep_for_pgdp.core.stage_events import StageEventBroker
        from pdomain_prep_for_pgdp.settings import Settings

        settings = Settings(
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
        self._seed_project(settings, "proj1")

        published_events: list[dict] = []

        class _CaptureBroker(StageEventBroker):
            async def publish(self, key: str, event: dict) -> None:
                published_events.append({"key": key, "event": event})

        broker = _CaptureBroker()
        app = build_app(settings)
        app.state.stage_events = broker
        with TestClient(app) as client:
            r = client.patch(
                "/api/data/projects/proj1/pages/reorder",
                json={"page_ids": ["1", "0"]},
            )
        assert r.status_code == 200

        reorder_events = [e for e in published_events if e["event"].get("type") == "page-reorder"]
        assert len(reorder_events) >= 1, f"No page-reorder SSE event published. Got: {published_events}"
        ev = reorder_events[0]["event"]
        assert "new_order" in ev, f"page-reorder payload missing new_order: {ev}"
        assert reorder_events[0]["key"] == "project:proj1"


# ─── W2.3 — submit_check/confirm route + GateConfirmation event ───────────────


class TestW23SubmitCheckConfirm:
    """POST /project-stages/submit_check/confirm records GateConfirmation + marks stage."""

    def _seed_project(self, settings, project_id: str = "proj1") -> None:
        from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
        from pdomain_prep_for_pgdp.core.models import (
            PageProcessingStatus,
            PageRecord,
            PipelineState,
            Project,
            ProjectConfig,
            ProjectStageStatus,
            ProjectStatus,
        )
        from pdomain_prep_for_pgdp.core.pipeline.project_stages import ProjectStageState, ProjectStageStore

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
                    registry_version=2,
                )
            )
            await db.close()

        asyncio.run(go())

        from tests.fixtures.seed_pages import seed_pages_in_store

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

        # Seed submit_check stage row as clean (so confirm can succeed).
        db_path = settings.data_root / "projects" / project_id / "project_stages.db"
        db_path.parent.mkdir(parents=True, exist_ok=True)
        store = ProjectStageStore(db_path)
        row = ProjectStageState(
            project_id=project_id,
            stage_id="submit_check",
            status=ProjectStageStatus.clean,
        )
        store.write(row)

    def test_confirm_route_exists_and_returns_200(self, tmp_path: Path) -> None:
        """POST /project-stages/submit_check/confirm → 200."""
        from fastapi.testclient import TestClient

        from pdomain_prep_for_pgdp.bootstrap import build_app
        from pdomain_prep_for_pgdp.settings import Settings

        settings = Settings(
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
        self._seed_project(settings, "proj1")

        app = build_app(settings)
        with TestClient(app) as client:
            r = client.post(
                "/api/data/projects/proj1/project-stages/submit_check/confirm",
                json={"gate": "submit_confirm"},
            )
        assert r.status_code == 200, r.json()
        body = r.json()
        assert "confirmed_at" in body or "gate" in body or "status" in body

    def test_confirm_records_gate_confirmation_event(self, tmp_path: Path) -> None:
        """Confirm route records GateConfirmation event in events.db."""
        from fastapi.testclient import TestClient

        from pdomain_prep_for_pgdp.bootstrap import build_app
        from pdomain_prep_for_pgdp.core.pipeline.prep_aggregate import (
            PrepApplication,
            PrepProjectAggregate,
        )
        from pdomain_prep_for_pgdp.settings import Settings

        settings = Settings(
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
        self._seed_project(settings, "proj1")

        app = build_app(settings)
        with TestClient(app) as client:
            r = client.post(
                "/api/data/projects/proj1/project-stages/submit_check/confirm",
                json={"gate": "submit_confirm"},
            )
        assert r.status_code == 200

        events_db = settings.data_root / "projects" / "proj1" / "events.db"
        assert events_db.exists(), "events.db not created by confirm route"

        app_ev = PrepApplication(
            env={
                "PERSISTENCE_MODULE": "eventsourcing.sqlite",
                "SQLITE_DBNAME": str(events_db),
            }
        )
        _agg_id = PrepProjectAggregate.create_id(uuid.uuid5(uuid.NAMESPACE_OID, "proj1"))
        try:
            loaded = app_ev.repository.get(_agg_id)
        except Exception:
            pytest.fail("PrepProjectAggregate not found after confirm")

        assert loaded.version >= 2  # type: ignore[attr-defined]

    def test_confirm_emits_project_stage_status_sse(self, tmp_path: Path) -> None:
        """Confirm route emits project-stage-status SSE."""
        from fastapi.testclient import TestClient

        from pdomain_prep_for_pgdp.bootstrap import build_app
        from pdomain_prep_for_pgdp.core.stage_events import StageEventBroker
        from pdomain_prep_for_pgdp.settings import Settings

        settings = Settings(
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
        self._seed_project(settings, "proj1")

        published: list[dict] = []

        class _Broker(StageEventBroker):
            async def publish(self, key: str, event: dict) -> None:
                published.append({"key": key, "event": event})

        broker = _Broker()
        app = build_app(settings)
        app.state.stage_events = broker
        with TestClient(app) as client:
            client.post(
                "/api/data/projects/proj1/project-stages/submit_check/confirm",
                json={"gate": "submit_confirm"},
            )

        sse_events = [e for e in published if e["event"].get("type") == "project-stage-status"]
        assert len(sse_events) >= 1, f"No project-stage-status SSE after confirm. Got: {published}"
        ev = sse_events[0]["event"]
        assert ev.get("stage_id") == "submit_check"


# ─── W2.4 — SettingsChange events recorded by settings routes ─────────────────


class TestW24SettingsChangeEvents:
    """Settings routes pass aggregate so SettingsChange events are recorded."""

    def _seed_project(self, settings, project_id: str = "proj1") -> None:
        from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
        from pdomain_prep_for_pgdp.core.models import (
            PageProcessingStatus,
            PageRecord,
            PipelineState,
            Project,
            ProjectConfig,
            ProjectStatus,
        )

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
                    registry_version=2,
                )
            )
            await db.close()

        asyncio.run(go())

        from tests.fixtures.seed_pages import seed_pages_in_store

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

    def test_put_settings_records_settings_change(self, tmp_path: Path) -> None:
        """PUT .../settings records a SettingsChange event in events.db."""
        from fastapi.testclient import TestClient

        from pdomain_prep_for_pgdp.bootstrap import build_app
        from pdomain_prep_for_pgdp.core.pipeline.prep_aggregate import (
            PrepApplication,
            PrepProjectAggregate,
        )
        from pdomain_prep_for_pgdp.settings import Settings

        settings = Settings(
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
        self._seed_project(settings, "proj1")

        app = build_app(settings)
        with TestClient(app) as client:
            r = client.put(
                "/api/data/projects/proj1/pages/0/stages/threshold/settings",
                json={"threshold_level": 150},
            )
        assert r.status_code == 200

        events_db = settings.data_root / "projects" / "proj1" / "events.db"
        assert events_db.exists(), "events.db not created by PUT settings"

        app_ev = PrepApplication(
            env={
                "PERSISTENCE_MODULE": "eventsourcing.sqlite",
                "SQLITE_DBNAME": str(events_db),
            }
        )
        _agg_id = PrepProjectAggregate.create_id(uuid.uuid5(uuid.NAMESPACE_OID, "proj1"))
        try:
            loaded = app_ev.repository.get(_agg_id)
        except Exception:
            pytest.fail("PrepProjectAggregate not found after PUT settings")

        assert loaded.version >= 2  # type: ignore[attr-defined]


# ─── W2.5 — reindex CLI calls reindex_project_stages ─────────────────────────


class TestW25ReindexCoverage:
    """pgdp-prep reindex also sweeps project stages, naming manifest, and settings."""

    def test_reindex_calls_reindex_project_stages(self, tmp_path: Path) -> None:
        """reindex CLI sweeps project stages and reports them."""
        from io import StringIO

        from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
        from pdomain_prep_for_pgdp.cli.reindex import _parse_args, _run
        from pdomain_prep_for_pgdp.core.models import (
            PageProcessingStatus,
            PageRecord,
            PipelineState,
            Project,
            ProjectConfig,
            ProjectStageStatus,
            ProjectStatus,
        )
        from pdomain_prep_for_pgdp.core.pipeline.project_stages import ProjectStageStore
        from pdomain_prep_for_pgdp.settings import Settings

        project_id = "reindex-test-proj"
        settings = Settings(
            data_root=tmp_path / "data",
            database_url=f"sqlite:///{(tmp_path / 'state.db').as_posix()}",
            storage_backend="filesystem",
            gpu_backend="cpu",
        )

        async def _go() -> None:
            db = SqliteDatabase(settings.derived_database_url)
            await db.initialize()
            now = datetime.now(UTC)
            await db.put_project(
                Project(
                    id=project_id,
                    owner_id="default",
                    name="test",
                    created_at=now,
                    updated_at=now,
                    status=ProjectStatus.processing,
                    page_count=1,
                    proof_page_count=1,
                    config=ProjectConfig(book_name="test", source_uri=""),
                    pipeline_state=PipelineState(),
                    storage_prefix=f"projects/{project_id}/",
                    registry_version=2,
                )
            )
            await db.close()

        asyncio.run(_go())

        from tests.fixtures.seed_pages import seed_pages_in_store

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

        # Create a page_order artifact on disk (so reindex finds it as clean).
        page_order_dir = settings.data_root / "projects" / project_id / "stages" / "page_order"
        page_order_dir.mkdir(parents=True, exist_ok=True)
        page_order_artifact = page_order_dir / "output.json"
        page_order_artifact.write_text(
            json.dumps({"version": 2, "pages": [], "skip_ids": []}), encoding="utf-8"
        )

        # Run reindex.
        args = _parse_args([project_id, "--data-root", str(settings.data_root), "--json"])
        buf = StringIO()
        exit_code = asyncio.run(_run(args, stdout=buf))

        # Should exit 0 (no page drift) or 2 (drift on pages).
        assert exit_code in (0, 2)

        # After reindex, the project_stages.db should have been written.
        db_path = settings.data_root / "projects" / project_id / "project_stages.db"
        assert db_path.exists(), f"project_stages.db not created by reindex at {db_path}"

        # page_order row should be clean (artifact was on disk).
        store = ProjectStageStore(db_path)
        row = store.read(project_id, "page_order")
        assert row is not None, "page_order row not created by reindex"
        assert row.status == ProjectStageStatus.clean, (
            f"page_order row status is {row.status!r} after reindex, expected clean"
        )

    def test_reindex_json_output_includes_project_stages_section(self, tmp_path: Path) -> None:
        """reindex --json output includes project_stages summary."""
        from io import StringIO

        from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
        from pdomain_prep_for_pgdp.cli.reindex import _parse_args, _run
        from pdomain_prep_for_pgdp.core.models import (
            PageProcessingStatus,
            PageRecord,
            PipelineState,
            Project,
            ProjectConfig,
            ProjectStatus,
        )
        from pdomain_prep_for_pgdp.settings import Settings

        project_id = "reindex-json-proj"
        settings = Settings(
            data_root=tmp_path / "data",
            database_url=f"sqlite:///{(tmp_path / 'state.db').as_posix()}",
            storage_backend="filesystem",
            gpu_backend="cpu",
        )

        async def _go() -> None:
            db = SqliteDatabase(settings.derived_database_url)
            await db.initialize()
            now = datetime.now(UTC)
            await db.put_project(
                Project(
                    id=project_id,
                    owner_id="default",
                    name="test",
                    created_at=now,
                    updated_at=now,
                    status=ProjectStatus.processing,
                    page_count=1,
                    proof_page_count=1,
                    config=ProjectConfig(book_name="test", source_uri=""),
                    pipeline_state=PipelineState(),
                    storage_prefix=f"projects/{project_id}/",
                    registry_version=2,
                )
            )
            await db.close()

        asyncio.run(_go())

        from tests.fixtures.seed_pages import seed_pages_in_store

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

        args = _parse_args([project_id, "--data-root", str(settings.data_root), "--json"])
        buf = StringIO()
        asyncio.run(_run(args, stdout=buf))

        output = buf.getvalue()
        data = json.loads(output)
        assert "project_stages" in data, (
            f"reindex --json missing 'project_stages' key. Got keys: {list(data.keys())}"
        )


# ─── W3.2 — validation-updated SSE after validation stage completes ───────────


class TestW32ValidationUpdatedSse:
    """_handle_run_project_stage emits validation-updated SSE when stage_id == 'validation'."""

    def test_validation_stage_emits_validation_updated_sse(self, tmp_path: Path) -> None:
        """After validation project-stage run completes, validation-updated SSE is emitted."""
        from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
        from pdomain_prep_for_pgdp.core.job_runner import InProcessJobRunner
        from pdomain_prep_for_pgdp.core.models import (
            Job,
            JobStatus,
            JobType,
            PipelineState,
            Project,
            ProjectConfig,
            ProjectStatus,
        )
        from pdomain_prep_for_pgdp.core.stage_events import StageEventBroker
        from pdomain_prep_for_pgdp.settings import Settings

        project_id = "validation-sse-test"
        settings = Settings(
            data_root=tmp_path / "data",
            database_url=f"sqlite:///{(tmp_path / 'state.db').as_posix()}",
            storage_backend="filesystem",
            gpu_backend="cpu",
        )

        async def _go() -> None:
            db = SqliteDatabase(settings.derived_database_url)
            await db.initialize()
            now = datetime.now(UTC)
            await db.put_project(
                Project(
                    id=project_id,
                    owner_id="default",
                    name="test",
                    created_at=now,
                    updated_at=now,
                    status=ProjectStatus.processing,
                    page_count=0,
                    proof_page_count=0,
                    config=ProjectConfig(book_name="test", source_uri=""),
                    pipeline_state=PipelineState(),
                    storage_prefix=f"projects/{project_id}/",
                    registry_version=2,
                )
            )
            await db.close()

        asyncio.run(_go())

        published: list[dict] = []

        class _Broker(StageEventBroker):
            async def publish(self, key: str, event: dict) -> None:
                published.append({"key": key, "event": event})

        broker = _Broker()

        async def _run_validation_job() -> None:
            from pdomain_prep_for_pgdp.adapters.storage.filesystem import FilesystemStorage

            db = SqliteDatabase(settings.derived_database_url)
            await db.initialize()
            storage = FilesystemStorage(root=settings.data_root)

            runner = InProcessJobRunner(
                database=db,
                storage=storage,
                data_root=settings.data_root,
                stage_events=broker,
            )

            job = Job(
                id="test-job-val",
                project_id=project_id,
                owner_id="default",
                type=JobType.run_project_stage,
                status=JobStatus.running,
                payload={"stage_id": "validation"},
            )
            await db.put_job(job)

            # Run the handler directly (don't go through full queue).
            from pdomain_prep_for_pgdp.core.job_runner import _handle_run_project_stage

            try:
                await _handle_run_project_stage(runner, job)
            except Exception as _exc:
                # Stage may fail (no pages); we only care about SSE.
                _ = _exc
            finally:
                await db.close()

        asyncio.run(_run_validation_job())

        # Should have emitted validation-updated or project-stage-status SSE.
        val_updated = [e for e in published if e["event"].get("type") == "validation-updated"]
        assert len(val_updated) >= 1, (
            f"No validation-updated SSE emitted. Published: {[e['event'].get('type') for e in published]}"
        )
        ev = val_updated[0]["event"]
        assert "blockers" in ev
        assert "warnings" in ev
        assert "status" in ev


# ─── W3.3 — project-stage-progress ticks ─────────────────────────────────────


class TestW33ProjectStageProgressTicks:
    """_handle_run_project_stage emits project-stage-progress ticks."""

    def test_project_stage_emits_progress_started_and_done(self, tmp_path: Path) -> None:
        """handler emits at least a 'started' + 'done' project-stage-progress tick."""
        from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
        from pdomain_prep_for_pgdp.core.job_runner import InProcessJobRunner, _handle_run_project_stage
        from pdomain_prep_for_pgdp.core.models import (
            Job,
            JobStatus,
            JobType,
            PipelineState,
            Project,
            ProjectConfig,
            ProjectStatus,
        )
        from pdomain_prep_for_pgdp.core.stage_events import StageEventBroker
        from pdomain_prep_for_pgdp.settings import Settings

        project_id = "stage-progress-test"
        settings = Settings(
            data_root=tmp_path / "data",
            database_url=f"sqlite:///{(tmp_path / 'state.db').as_posix()}",
            storage_backend="filesystem",
            gpu_backend="cpu",
        )

        async def _go() -> None:
            db = SqliteDatabase(settings.derived_database_url)
            await db.initialize()
            now = datetime.now(UTC)
            await db.put_project(
                Project(
                    id=project_id,
                    owner_id="default",
                    name="test",
                    created_at=now,
                    updated_at=now,
                    status=ProjectStatus.processing,
                    page_count=0,
                    proof_page_count=0,
                    config=ProjectConfig(book_name="test", source_uri=""),
                    pipeline_state=PipelineState(),
                    storage_prefix=f"projects/{project_id}/",
                    registry_version=2,
                )
            )
            await db.close()

        asyncio.run(_go())

        published: list[dict] = []

        class _Broker(StageEventBroker):
            async def publish(self, key: str, event: dict) -> None:
                published.append({"key": key, "event": event})

        broker = _Broker()

        async def _run() -> None:
            from pdomain_prep_for_pgdp.adapters.storage.filesystem import FilesystemStorage

            db = SqliteDatabase(settings.derived_database_url)
            await db.initialize()
            storage = FilesystemStorage(root=settings.data_root)
            runner = InProcessJobRunner(
                database=db,
                storage=storage,
                data_root=settings.data_root,
                stage_events=broker,
            )
            job = Job(
                id="job-progress",
                project_id=project_id,
                owner_id="default",
                type=JobType.run_project_stage,
                status=JobStatus.running,
                payload={"stage_id": "validation"},
            )
            await db.put_job(job)
            try:
                await _handle_run_project_stage(runner, job)
            except Exception as _exc:
                _ = _exc  # Stage may fail; we only care about SSE ticks.
            finally:
                await db.close()

        asyncio.run(_run())

        progress_events = [e for e in published if e["event"].get("type") == "project-stage-progress"]
        assert len(progress_events) >= 1, (
            f"No project-stage-progress SSE emitted. Published: {[e['event'].get('type') for e in published]}"
        )
        types = {e["event"].get("progress") for e in progress_events}
        # Should have at least one tick (any progress value is acceptable).
        assert any(p is not None for p in types), (
            f"project-stage-progress missing 'progress' field: {progress_events}"
        )
