"""W0 — critical execution-path fixes: tests must fail first, then pass after fixes.

Tests cover:
  W0.1 — new JobType.run_project_stage + dedicated handler
  W0.4 — gate enforcement at route layer (409 on blocked)
  W0.5 — built_at determinism via StageRunStarted timestamp
  W0.2 — build_package uses v2 path (build_package_v2_cpu)
  W6.3 — deprecated JobTypes removed; deprecated routes gone
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from pathlib import Path

import pytest

from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pdomain_prep_for_pgdp.bootstrap import build_app
from pdomain_prep_for_pgdp.core.models import (
    JobType,
    PageProcessingStatus,
    PageRecord,
    Project,
    ProjectConfig,
    ProjectStageStatus,
    ProjectStatus,
)
from pdomain_prep_for_pgdp.settings import Settings
from tests.fixtures.seed_pages import seed_pages_in_store


def _settings(tmp_path: Path) -> Settings:
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


def _seed_project(
    settings: Settings,
    project_id: str = "proj1",
    registry_version: int = 2,
) -> None:
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


def _set_project_stage_status(
    settings: Settings,
    project_id: str,
    stage_id: str,
    status: str,
) -> None:
    """Helper to set a project stage row status directly in the store."""
    from pdomain_prep_for_pgdp.core.pipeline.project_stages import ProjectStageStore, init_project_stages

    db_path = settings.data_root / "projects" / project_id / "project_stages.db"
    db_path.parent.mkdir(parents=True, exist_ok=True)
    store = ProjectStageStore(db_path)
    # Lazy-init all stages
    rows = store.list_for_project(project_id)
    if not rows:
        for row in init_project_stages(project_id):
            store.write(row)
    # Update the target stage
    row = store.read(project_id, stage_id)
    assert row is not None
    updated = row.model_copy(update={"status": ProjectStageStatus(status)})
    store.write(updated)


# ─── W0.1 — JobType.run_project_stage exists ─────────────────────────────────


def test_job_type_has_run_project_stage() -> None:
    """JobType must have a run_project_stage member (not just run_page_stage)."""
    assert hasattr(JobType, "run_project_stage"), "JobType.run_project_stage missing — W0.1 fix needed"
    assert JobType.run_project_stage.value == "run_project_stage"


# ─── W0.1 — enqueue + drain project-stage job ────────────────────────────────


def test_run_project_stage_job_enqueued_with_correct_type(tmp_path: Path) -> None:
    """POST .../run enqueues a run_project_stage Job, NOT run_page_stage.

    This is the root of W0.1: previously run_project_stage enqueued
    run_page_stage with scope='project' and no page_id — exploding on dequeue.
    """
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1")
    app = build_app(settings)
    from fastapi.testclient import TestClient

    # Use a non-gated stage: source has no project-scoped deps
    stage_id = "source"
    with TestClient(app) as client:
        r = client.post(f"/api/data/projects/proj1/project-stages/{stage_id}/run")
    assert r.status_code == 202
    body = r.json()
    # The job type MUST be run_project_stage — not run_page_stage
    assert body["type"] == "run_project_stage", (
        f"Expected type=run_project_stage, got {body['type']!r} — W0.1 bug still present"
    )


def test_run_project_stage_job_drains_and_stage_reaches_terminal(tmp_path: Path) -> None:
    """Enqueue a run_project_stage job, drain the runner, assert stage row changes.

    This is the audit pattern from test_b5_project_stages. The handler must
    not KeyError on dequeue (W0.1 bug).

    Uses TestClient with dispatch_interval_seconds=0 and a short sleep so the
    in-process job runner (which runs in the same asyncio loop) can drain.
    """
    import time

    from fastapi.testclient import TestClient

    settings = _settings(tmp_path)
    _seed_project(settings, "proj1")

    app = build_app(settings)
    stage_id = "source"

    # TestClient runs everything in one event loop inside its own context.
    # We enqueue and then wait for the runner to drain by polling the DB
    # via the HTTP API (not asyncio.run which would create a conflicting loop).
    final_status: str = "timeout"
    final_stage_status: str = "not-checked"

    with TestClient(app) as client:
        # Enqueue
        r = client.post(f"/api/data/projects/proj1/project-stages/{stage_id}/run")
        assert r.status_code == 202

        # Poll the job via GET until it reaches a terminal state.
        job_id = r.json()["id"]
        for _ in range(50):
            rj = client.get(f"/api/gpu/jobs/{job_id}")
            if rj.status_code == 200:
                status = rj.json().get("status")
                if status in ("complete", "error"):
                    final_status = status
                    break
            time.sleep(0.1)

        # Check project-stage row via the stages API
        rs = client.get(f"/api/data/projects/proj1/project-stages/{stage_id}")
        if rs.status_code == 200:
            final_stage_status = rs.json().get("status", "not-found")

    # Job should be complete or error (not stuck/exploded)
    assert final_status in ("complete", "error"), (
        f"Job did not reach terminal state: {final_status} — handler crashed?"
    )

    assert final_stage_status in ("clean", "failed"), f"Stage row not in terminal state: {final_stage_status}"


# ─── W0.4 — gate enforcement at route layer ──────────────────────────────────


def test_run_project_stage_409_when_gate_blocked(tmp_path: Path) -> None:
    """POST .../build_package/run returns 409 when validation is not clean.

    W0.4: check_stage_gate must be called before enqueue.
    """
    from fastapi.testclient import TestClient

    settings = _settings(tmp_path)
    _seed_project(settings, "proj1")

    # Do NOT set validation to clean — it starts as not-run
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post("/api/data/projects/proj1/project-stages/build_package/run")

    # Must be 409 — gate blocked
    assert r.status_code == 409, f"Expected 409 (gate blocked), got {r.status_code} — W0.4 not implemented"
    body = r.json()
    assert body.get("error") == "stage_gate_blocked", f"Expected error='stage_gate_blocked', got {body}"
    assert "stage_id" in body
    assert "reason" in body


def test_run_project_stage_allowed_when_gate_passes(tmp_path: Path) -> None:
    """POST .../build_package/run returns 202 when all gates are clean.

    W0.4: gate passes → job enqueued.
    """
    from fastapi.testclient import TestClient

    settings = _settings(tmp_path)
    _seed_project(settings, "proj1")

    # Set proof_pack to clean (which transitively requires page_order+validation)
    # For testing gate bypass: set proof_pack status directly
    for dep_sid in ("source", "page_order", "validation", "proof_pack"):
        _set_project_stage_status(settings, "proj1", dep_sid, "clean")

    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post("/api/data/projects/proj1/project-stages/build_package/run")

    # Gate passes — should be 202 (or 409 on registry version, not gate)
    assert r.status_code == 202, f"Expected 202 when gate passes, got {r.status_code}: {r.json()}"


def test_run_source_stage_no_gate(tmp_path: Path) -> None:
    """POST .../source/run never 409 (source has no project-scoped deps)."""
    from fastapi.testclient import TestClient

    settings = _settings(tmp_path)
    _seed_project(settings, "proj1")
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post("/api/data/projects/proj1/project-stages/source/run")

    assert r.status_code == 202, f"Source stage should always pass gate: {r.json()}"


def test_gate_blocked_body_shape(tmp_path: Path) -> None:
    """W0.4 spec: 409 body = {error, stage_id, reason}."""
    from fastapi.testclient import TestClient

    settings = _settings(tmp_path)
    _seed_project(settings, "proj1")
    app = build_app(settings)

    # validation is a dep of proof_pack which is a dep of build_package
    with TestClient(app) as client:
        r = client.post("/api/data/projects/proj1/project-stages/build_package/run")

    assert r.status_code == 409
    body = r.json()
    assert set(body.keys()) >= {"error", "stage_id", "reason"}
    assert body["stage_id"] == "build_package"
    assert isinstance(body["reason"], str)
    assert len(body["reason"]) > 0


# ─── W6.3 — deprecated JobTypes removed ──────────────────────────────────────


def test_deprecated_job_type_build_package_removed() -> None:
    """JobType.build_package must not exist (deprecated — replaced by run_project_stage)."""
    assert not hasattr(JobType, "build_package"), (
        "JobType.build_package still present — W6.3 deprecation not applied"
    )


def test_deprecated_job_type_project_run_dirty_removed() -> None:
    """JobType.project_run_dirty must not exist (deprecated — W6.3)."""
    assert not hasattr(JobType, "project_run_dirty"), (
        "JobType.project_run_dirty still present — W6.3 deprecation not applied"
    )


def test_deprecated_job_type_project_run_stage_all_pages_removed() -> None:
    """JobType.project_run_stage_all_pages must not exist (deprecated — W6.3)."""
    assert not hasattr(JobType, "project_run_stage_all_pages"), (
        "JobType.project_run_stage_all_pages still present — W6.3 deprecation not applied"
    )


def test_deprecated_route_build_package_removed(tmp_path: Path) -> None:
    """POST /projects/{id}/build-package must be 404/405 (route deleted — W6.3)."""
    from fastapi.testclient import TestClient

    settings = _settings(tmp_path)
    _seed_project(settings, "proj1")
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post("/api/data/projects/proj1/build-package")
    assert r.status_code in (404, 405, 410), (
        f"Expected 404/405/410 (route deleted), got {r.status_code} — W6.3 not applied"
    )


def test_deprecated_route_run_dirty_removed(tmp_path: Path) -> None:
    """POST /projects/{id}/run-dirty must be 404/405 (route deleted — W6.3)."""
    from fastapi.testclient import TestClient

    settings = _settings(tmp_path)
    _seed_project(settings, "proj1")
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post("/api/data/projects/proj1/run-dirty")
    assert r.status_code in (404, 405, 410), (
        f"Expected 404/405/410 (route deleted), got {r.status_code} — W6.3 not applied"
    )


def test_deprecated_route_review_status_removed(tmp_path: Path) -> None:
    """GET /projects/{id}/review-status must not match the route (route deleted — W6.3).

    The GET /api/data/projects/{id}/review-status route no longer exists.
    It won't match any /api/data/ route (resulting in 404) — the test verifies
    the route was removed and no longer returns 200 with the ReviewStatusResponse.
    """
    from fastapi.testclient import TestClient

    settings = _settings(tmp_path)
    _seed_project(settings, "proj1")
    app = build_app(settings)
    with TestClient(app, raise_server_exceptions=False) as client:
        r = client.get("/api/data/projects/proj1/review-status")
    # Route deleted: must not be 200 (the old success response)
    assert r.status_code != 200, "Expected non-200 (route deleted), got 200 — W6.3 not applied"


# ─── W0.5 — built_at determinism ─────────────────────────────────────────────


def test_build_package_v2_cpu_deterministic_with_same_built_at(tmp_path: Path) -> None:
    """Two calls with identical inputs + same built_at → byte-identical zips.

    W0.5: built_at must be threaded through the run path.
    This tests the underlying callable directly.
    """
    from pdomain_prep_for_pgdp.core.pipeline.steps.build_package import build_package_v2_cpu

    project_id = "proj-determ"
    data_root = tmp_path / "data"
    project_pages = data_root / "projects" / project_id / "pages"

    # Seed minimal page artifacts so build_package can find them
    page_id = "0001"
    page_stage_dir = project_pages / page_id / "stages"
    for stage in ("canvas_map", "text_review"):
        stage_dir = page_stage_dir / stage
        stage_dir.mkdir(parents=True, exist_ok=True)
        if stage == "canvas_map":
            (stage_dir / "output.png").write_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * 50)
        else:
            (stage_dir / "output.txt").write_text("Hello world.", encoding="utf-8")

    # Write a naming manifest so build_package_v2_cpu doesn't raise MissingNamingManifest
    manifest_dir = data_root / "projects" / project_id / "stages" / "page_order"
    manifest_dir.mkdir(parents=True, exist_ok=True)
    import json

    # Manifest format per page_order.py: version=1, pages=[{page_id, idx0, role, prefix}], skip_ids=[]
    manifest_data = {
        "version": 1,
        "pages": [
            {
                "page_id": page_id,
                "idx0": 1,
                "role": "normal",
                "prefix": "p001",
            }
        ],
        "skip_ids": [],
    }
    (manifest_dir / "output.json").write_text(json.dumps(manifest_data), encoding="utf-8")

    built_at = "2026-06-11T12:00:00+00:00"

    zip1 = build_package_v2_cpu(
        project_id=project_id,
        page_ids=[page_id],
        data_root=data_root,
        book_name="Test Book",
        built_at=built_at,
    )
    zip2 = build_package_v2_cpu(
        project_id=project_id,
        page_ids=[page_id],
        data_root=data_root,
        book_name="Test Book",
        built_at=built_at,
    )

    assert isinstance(zip1, bytes) and len(zip1) > 0
    assert zip1 == zip2, "build_package_v2_cpu must be deterministic with same built_at"


# ─── W0.2 — build_package handler uses v2 path ───────────────────────────────


def test_run_project_stage_handler_calls_v2_build_package(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The run_project_stage handler must call build_package_v2_cpu, not legacy build_package.

    W0.2: _handle_build_package called core.packaging.build_package (v1, no naming
    manifest, no PGDP validation). W0.1's new handler must call build_package_v2_cpu.
    """
    from pdomain_prep_for_pgdp.core.pipeline.steps import build_package as bp_module

    v2_called = []

    original_v2 = bp_module.build_package_v2_cpu

    def _patched_v2(*args: object, **kwargs: object) -> bytes:
        v2_called.append(True)
        return original_v2(*args, **kwargs)

    monkeypatch.setattr(bp_module, "build_package_v2_cpu", _patched_v2)

    # Also patch into the registry so the handler picks it up
    from pdomain_prep_for_pgdp.core.pipeline import stage_registry

    monkeypatch.setitem(
        stage_registry.V2_STAGE_IMPL["build_package"],
        "cpu",
        _patched_v2,
    )

    settings = _settings(tmp_path)
    _seed_project(settings, "proj1")

    # Set all gates clean
    for dep_sid in ("source", "page_order", "validation", "proof_pack"):
        _set_project_stage_status(settings, "proj1", dep_sid, "clean")

    import time

    from fastapi.testclient import TestClient

    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post("/api/data/projects/proj1/project-stages/build_package/run")
        assert r.status_code == 202, f"Expected 202, got {r.status_code}: {r.json()}"

        # Poll the job until terminal
        job_id = r.json()["id"]
        for _ in range(50):
            rj = client.get(f"/api/gpu/jobs/{job_id}")
            if rj.status_code == 200:
                status = rj.json().get("status")
                if status in ("complete", "error"):
                    break
            time.sleep(0.1)

    # v2 callable must have been invoked
    assert v2_called, "build_package_v2_cpu was never called — handler still uses legacy v1 path (W0.2 bug)"
