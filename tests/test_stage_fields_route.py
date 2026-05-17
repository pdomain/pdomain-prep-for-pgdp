"""M3 — GET /api/data/pipeline/stages/{stage_id}/fields.

Returns the sorted list of PageConfigOverrides field names that the named
stage reads. Backed by STAGE_CONFIG_FIELDS in stage_runner.py.

Acceptance:
- threshold → deterministic list including threshold_level
- grayscale → empty list (reads no config fields)
- unknown stage_id → 422
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from fastapi.testclient import TestClient


def test_fields_threshold_includes_threshold_level(client: TestClient) -> None:
    r = client.get("/api/data/pipeline/stages/threshold/fields")
    assert r.status_code == 200
    body = r.json()
    assert "fields" in body
    fields = body["fields"]
    assert "threshold_level" in fields


def test_fields_threshold_is_sorted(client: TestClient) -> None:
    r = client.get("/api/data/pipeline/stages/threshold/fields")
    assert r.status_code == 200
    fields = r.json()["fields"]
    assert fields == sorted(fields)


def test_fields_stage_with_no_config_returns_empty(client: TestClient) -> None:
    r = client.get("/api/data/pipeline/stages/grayscale/fields")
    assert r.status_code == 200
    assert r.json()["fields"] == []


def test_fields_unknown_stage_returns_422(client: TestClient) -> None:
    r = client.get("/api/data/pipeline/stages/BOGUS_STAGE/fields")
    assert r.status_code == 422


def test_fields_find_content_edges(client: TestClient) -> None:
    r = client.get("/api/data/pipeline/stages/find_content_edges/fields")
    assert r.status_code == 200
    fields = r.json()["fields"]
    assert "fuzzy_pct" in fields
    assert "pixel_count_columns" in fields
    assert "pixel_count_rows" in fields


def test_fields_auto_deskew(client: TestClient) -> None:
    r = client.get("/api/data/pipeline/stages/auto_deskew/fields")
    assert r.status_code == 200
    fields = r.json()["fields"]
    assert "skip_auto_deskew" in fields
    assert "deskew_after_crop" in fields


def test_fields_response_includes_stage_id(client: TestClient) -> None:
    r = client.get("/api/data/pipeline/stages/threshold/fields")
    assert r.status_code == 200
    body = r.json()
    assert body["stage_id"] == "threshold"
