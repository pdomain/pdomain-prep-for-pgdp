"""R2 image-tools routes — regex rules, grayscale detect, illustrations detect/persist.

Behaviors tested:
- GET  .../project-stages/regex/rules             -> 200 {rules, counts, snapshotId}
- POST .../project-stages/regex/rules/{rule_id}/apply -> 200 {rule, counts}
- POST .../project-stages/grayscale/detect        -> 200 {mode, why, backend}
- POST .../project-stages/illustrations/detect    -> 200 {items, counts}
- PATCH .../project-stages/illustrations/regions/{region_id} -> 200 {ok}
- 404 for unknown project
- 409 for v1 project (registry_version_mismatch)
"""

from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime

from fastapi.testclient import TestClient

from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pdomain_prep_for_pgdp.bootstrap import build_app
from pdomain_prep_for_pgdp.core.models import (
    PageProcessingStatus,
    PageRecord,
    PipelineState,
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
                pipeline_state=PipelineState(),
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


# ─── regexPass: GET /project-stages/regex/rules ──────────────────────────────


def test_get_regex_rules_returns_empty_list_for_new_project(tmp_path):
    """GET .../project-stages/regex/rules → 200 with empty rules when no rules saved."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1")
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/data/projects/proj1/project-stages/regex/rules")
    assert r.status_code == 200
    body = r.json()
    assert "rules" in body
    assert "counts" in body
    assert "snapshotId" in body
    assert body["rules"] == []
    assert body["snapshotId"] is None


def test_get_regex_rules_returns_saved_rules(tmp_path):
    """GET .../project-stages/regex/rules → 200 with previously saved rules."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1")

    # Pre-seed a rules file.
    rules_dir = settings.data_root / "projects" / "proj1" / "stages" / "regex"
    rules_dir.mkdir(parents=True, exist_ok=True)
    rule = {
        "id": "rule-001",
        "name": "Fix 'teh'",
        "find": r"\bteh\b",
        "repl": "the",
        "flags": "gi",
        "scope": "all",
        "status": "pending",
        "enabled": True,
        "matches": 0,
    }
    (rules_dir / "rules.json").write_text(json.dumps([rule]))

    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/data/projects/proj1/project-stages/regex/rules")
    assert r.status_code == 200
    body = r.json()
    assert len(body["rules"]) == 1
    assert body["rules"][0]["id"] == "rule-001"
    assert body["counts"]["rules"] == 1


def test_get_regex_rules_404_unknown_project(tmp_path):
    """GET .../project-stages/regex/rules → 404 for unknown project."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1")
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/data/projects/no-such/project-stages/regex/rules")
    assert r.status_code == 404


def test_get_regex_rules_409_v1_project(tmp_path):
    """GET .../project-stages/regex/rules → 409 for v1 project."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1", registry_version=1)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/data/projects/proj1/project-stages/regex/rules")
    assert r.status_code == 409
    assert r.json()["error"] == "registry_version_mismatch"


# ─── regexPass: POST /project-stages/regex/rules/{rule_id}/apply ─────────────


def test_apply_regex_rule_marks_rule_applied(tmp_path):
    """POST .../project-stages/regex/rules/{rule_id}/apply → 200 {rule, counts}."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1")

    rules_dir = settings.data_root / "projects" / "proj1" / "stages" / "regex"
    rules_dir.mkdir(parents=True, exist_ok=True)
    rule = {
        "id": "rule-001",
        "name": "Fix 'teh'",
        "find": r"\bteh\b",
        "repl": "the",
        "flags": "gi",
        "scope": "all",
        "status": "pending",
        "enabled": True,
        "matches": 0,
    }
    (rules_dir / "rules.json").write_text(json.dumps([rule]))

    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post("/api/data/projects/proj1/project-stages/regex/rules/rule-001/apply")
    assert r.status_code == 200
    body = r.json()
    assert "rule" in body
    assert "counts" in body
    assert body["rule"]["id"] == "rule-001"
    assert body["rule"]["status"] == "applied"


def test_apply_regex_rule_404_unknown_rule(tmp_path):
    """POST .../project-stages/regex/rules/{rule_id}/apply → 404 if rule not found."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1")

    rules_dir = settings.data_root / "projects" / "proj1" / "stages" / "regex"
    rules_dir.mkdir(parents=True, exist_ok=True)
    (rules_dir / "rules.json").write_text(json.dumps([]))

    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post("/api/data/projects/proj1/project-stages/regex/rules/no-such/apply")
    assert r.status_code == 404


def test_apply_regex_rule_404_unknown_project(tmp_path):
    """POST apply → 404 for unknown project."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1")
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post("/api/data/projects/no-such/project-stages/regex/rules/r1/apply")
    assert r.status_code == 404


def test_apply_regex_rule_409_v1_project(tmp_path):
    """POST apply → 409 for v1 project."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1", registry_version=1)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post("/api/data/projects/proj1/project-stages/regex/rules/r1/apply")
    assert r.status_code == 409
    assert r.json()["error"] == "registry_version_mismatch"


# ─── grayscaleTool: POST /project-stages/grayscale/detect ────────────────────


def test_detect_grayscale_profile_returns_valid_response(tmp_path):
    """POST .../project-stages/grayscale/detect → 200 {mode, why, backend}."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1")
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post("/api/data/projects/proj1/project-stages/grayscale/detect")
    assert r.status_code == 200
    body = r.json()
    assert "mode" in body
    assert "why" in body
    assert "backend" in body
    assert body["mode"] in ("perceptual", "standard")
    assert body["backend"] in ("cpu", "gpu")
    assert isinstance(body["why"], str)
    assert len(body["why"]) > 0


def test_detect_grayscale_profile_404_unknown_project(tmp_path):
    """POST .../grayscale/detect → 404 for unknown project."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1")
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post("/api/data/projects/no-such/project-stages/grayscale/detect")
    assert r.status_code == 404


def test_detect_grayscale_profile_409_v1_project(tmp_path):
    """POST .../grayscale/detect → 409 for v1 project."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1", registry_version=1)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post("/api/data/projects/proj1/project-stages/grayscale/detect")
    assert r.status_code == 409
    assert r.json()["error"] == "registry_version_mismatch"


# ─── illustrationsTool: POST /project-stages/illustrations/detect ────────────


def test_detect_illustrations_returns_empty_for_new_project(tmp_path):
    """POST .../project-stages/illustrations/detect → 200 with empty items."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1")
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post("/api/data/projects/proj1/project-stages/illustrations/detect")
    assert r.status_code == 200
    body = r.json()
    assert "items" in body
    assert "counts" in body
    assert isinstance(body["items"], list)
    counts = body["counts"]
    assert "detected" in counts
    assert "extracted" in counts
    assert "review" in counts
    assert "flagged" in counts


def test_detect_illustrations_404_unknown_project(tmp_path):
    """POST .../illustrations/detect → 404 for unknown project."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1")
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post("/api/data/projects/no-such/project-stages/illustrations/detect")
    assert r.status_code == 404


def test_detect_illustrations_409_v1_project(tmp_path):
    """POST .../illustrations/detect → 409 for v1 project."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1", registry_version=1)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post("/api/data/projects/proj1/project-stages/illustrations/detect")
    assert r.status_code == 409
    assert r.json()["error"] == "registry_version_mismatch"


# ─── illustrationsTool: PATCH /project-stages/illustrations/regions/{region_id}


def test_persist_illustration_region_404_unknown_region(tmp_path):
    """PATCH .../illustrations/regions/{region_id} → 404 if region not found."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1")
    app = build_app(settings)
    region_payload = {
        "id": "no-such",
        "page": "0000",
        "kind": "figure",
        "w": 100,
        "h": 80,
        "status": "review",
        "note": "",
    }
    with TestClient(app) as client:
        r = client.patch(
            "/api/data/projects/proj1/project-stages/illustrations/regions/no-such",
            json=region_payload,
        )
    assert r.status_code == 404


def test_persist_illustration_region_updates_stored_region(tmp_path):
    """PATCH .../illustrations/regions/{region_id} → 200 {ok: true} after persist."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1")

    # Pre-seed a regions file.
    illus_dir = settings.data_root / "projects" / "proj1" / "stages" / "illustrations"
    illus_dir.mkdir(parents=True, exist_ok=True)
    region = {
        "id": "region-001",
        "page": "0000",
        "kind": "figure",
        "w": 200,
        "h": 150,
        "status": "review",
        "note": "",
    }
    (illus_dir / "regions.json").write_text(json.dumps([region]))

    app = build_app(settings)
    updated = {**region, "status": "extracted", "note": "confirmed"}
    with TestClient(app) as client:
        r = client.patch(
            "/api/data/projects/proj1/project-stages/illustrations/regions/region-001",
            json=updated,
        )
    assert r.status_code == 200
    body = r.json()
    assert body.get("ok") is True

    # Verify the file was updated.
    saved = json.loads((illus_dir / "regions.json").read_text())
    assert saved[0]["status"] == "extracted"
    assert saved[0]["note"] == "confirmed"


def test_persist_illustration_region_404_unknown_project(tmp_path):
    """PATCH .../illustrations/regions/{region_id} → 404 for unknown project."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1")
    app = build_app(settings)
    region_payload = {
        "id": "r1",
        "page": "0000",
        "kind": "figure",
        "w": 100,
        "h": 80,
        "status": "review",
        "note": "",
    }
    with TestClient(app) as client:
        r = client.patch(
            "/api/data/projects/no-such/project-stages/illustrations/regions/r1",
            json=region_payload,
        )
    assert r.status_code == 404


def test_persist_illustration_region_409_v1_project(tmp_path):
    """PATCH .../illustrations/regions/{region_id} → 409 for v1 project."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1", registry_version=1)
    app = build_app(settings)
    region_payload = {
        "id": "r1",
        "page": "0000",
        "kind": "figure",
        "w": 100,
        "h": 80,
        "status": "review",
        "note": "",
    }
    with TestClient(app) as client:
        r = client.patch(
            "/api/data/projects/proj1/project-stages/illustrations/regions/r1",
            json=region_payload,
        )
    assert r.status_code == 409
    assert r.json()["error"] == "registry_version_mismatch"
