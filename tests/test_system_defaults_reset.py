"""Test the spec-defaults reset endpoint.

`DELETE /api/data/system/defaults` returns the row to spec-08 defaults.
Verifies:
  - PUT a custom value, DELETE, GET → spec defaults again,
  - DELETE on a never-set row succeeds (idempotent),
  - response is the new (default) SystemDefaults.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from fastapi.testclient import TestClient


def test_reset_returns_to_spec_defaults(client: TestClient) -> None:
    r = client.get("/api/data/system/defaults").json()
    r["text_threshold"] = 99
    client.put("/api/data/system/defaults", json=r)
    assert client.get("/api/data/system/defaults").json()["text_threshold"] == 99

    reset = client.delete("/api/data/system/defaults")
    assert reset.status_code == 200, reset.text
    body = reset.json()
    assert body["text_threshold"] == 140  # spec default
    after = client.get("/api/data/system/defaults").json()
    assert after["text_threshold"] == 140


def test_reset_on_unset_row_idempotent(client: TestClient) -> None:
    r = client.delete("/api/data/system/defaults")
    assert r.status_code == 200
    assert r.json()["text_threshold"] == 140
