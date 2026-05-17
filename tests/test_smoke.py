"""Smoke test — `build_app()` produces a working FastAPI app.

Asserts the wiring of:
  * adapter selection (filesystem + sqlite + none-auth + cpu-gpu),
  * route registration (data + gpu),
  * the "fresh DB has no projects" base case.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from fastapi.testclient import TestClient


def test_list_projects_empty(client: TestClient) -> None:
    r = client.get("/api/data/projects")
    assert r.status_code == 200
    assert r.json() == []


def test_get_system_defaults_returns_defaults(client: TestClient) -> None:
    r = client.get("/api/data/system/defaults")
    assert r.status_code == 200
    body = r.json()
    # Sanity-check a few field defaults from spec 08 / 01.
    assert body["text_threshold"] == 140
    assert body["page_h_w_ratio"] == 1.65
    assert body["ocr_engine"] == "doctr"


def test_create_then_list_project(client: TestClient) -> None:
    r = client.post(
        "/api/data/projects",
        json={"name": "Belloc — The Four Men", "source_type": "zip"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    project_id = body["project"]["id"]
    assert body["project"]["name"] == "Belloc — The Four Men"
    assert body["project"]["status"] == "ingesting"
    assert body["upload_url"]  # filesystem mode returns a /cdn URL
    assert body["upload_key"] == f"projects/{project_id}/source.zip"

    r2 = client.get("/api/data/projects")
    assert r2.status_code == 200
    listing = r2.json()
    assert len(listing) == 1
    assert listing[0]["id"] == project_id


def test_openapi_spec_is_buildable(client: TestClient) -> None:
    """Pydantic source-of-truth: /openapi.json must always be valid JSON."""
    r = client.get("/openapi.json")
    assert r.status_code == 200
    spec = r.json()
    assert "paths" in spec
    assert "/api/data/projects" in spec["paths"]
    # M6: /api/gpu/process-page deleted — per-stage endpoint replaced it.
    assert "/api/gpu/process-page" not in spec["paths"]
