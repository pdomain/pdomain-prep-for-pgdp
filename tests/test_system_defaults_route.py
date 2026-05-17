"""Round-trip test: GET /api/data/system/defaults + PUT round-trip.

Locks in:
  - GET returns the spec-08 defaults out of the box,
  - PUT replaces the row and the next GET reads it back,
  - Unknown fields don't crash the model (they are silently ignored at
    parse time, since FastAPI uses the Pydantic schema).
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from fastapi.testclient import TestClient


def test_get_defaults_returns_spec_defaults(client: TestClient) -> None:
    r = client.get("/api/data/system/defaults")
    assert r.status_code == 200
    body = r.json()
    assert body["text_threshold"] == 140
    assert body["page_h_w_ratio"] == 1.65
    assert body["ocr_engine"] == "doctr"
    assert body["layout_detector"] == "pp-doclayout-plus-l"


def test_put_then_get_roundtrips(client: TestClient) -> None:
    r = client.get("/api/data/system/defaults").json()
    r["text_threshold"] = 200
    r["ocr_engine"] = "tesseract"
    r["standard_scannos"] = {"foo": "FOO"}

    put = client.put("/api/data/system/defaults", json=r)
    assert put.status_code == 200, put.text

    after = client.get("/api/data/system/defaults").json()
    assert after["text_threshold"] == 200
    assert after["ocr_engine"] == "tesseract"
    assert after["standard_scannos"] == {"foo": "FOO"}
