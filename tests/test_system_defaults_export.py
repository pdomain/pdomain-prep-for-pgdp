"""Test the export → import round-trip on system defaults.

Locks in:
  - GET .../export returns the current SystemDefaults as a JSON file
    download (Content-Disposition attachment),
  - POST .../import accepts that exact body and replaces the stored row,
  - the next GET reflects the imported values.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from fastapi.testclient import TestClient


def test_export_returns_attachment(client: TestClient) -> None:
    r = client.get("/api/data/system/defaults/export")
    assert r.status_code == 200
    cd = r.headers.get("content-disposition", "")
    assert "attachment" in cd.lower()
    assert "filename" in cd.lower()
    body = r.json()
    assert body["text_threshold"] == 140  # spec default


def test_import_replaces_defaults(client: TestClient) -> None:
    payload = client.get("/api/data/system/defaults").json()
    payload["text_threshold"] = 99
    payload["ocr_engine"] = "tesseract"

    r = client.post("/api/data/system/defaults/import", json=payload)
    assert r.status_code == 200, r.text

    after = client.get("/api/data/system/defaults").json()
    assert after["text_threshold"] == 99
    assert after["ocr_engine"] == "tesseract"


def test_import_rejects_bad_payload(client: TestClient) -> None:
    r = client.post(
        "/api/data/system/defaults/import",
        json={"text_threshold": "not a number"},
    )
    assert r.status_code in (400, 422)
