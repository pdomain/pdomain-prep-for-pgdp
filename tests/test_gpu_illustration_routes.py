"""Lock in the contract of the not-yet-wired GPU illustration routes.

These three routes are stubs today (per spec 05 — wiring lands in a
later iteration). Locks in:
  - POST /suggest-splits returns 200 with `{splits: []}`,
  - POST /suggest-illustrations returns 200 with `{regions: []}`,
  - POST /extract-illustration returns 501. The page stage writes crops;
    this route does not.

When these routes are wired up, the failing assertions here force a
test rewrite — that's intentional, so the contract change is conscious.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi.testclient import TestClient

from pdomain_prep_for_pgdp.bootstrap import build_app

if TYPE_CHECKING:
    from pdomain_prep_for_pgdp.settings import Settings


def test_suggest_splits_returns_empty_list(client: TestClient) -> None:
    r = client.post(
        "/api/gpu/suggest-splits",
        json={"project_id": "any", "idx0": 0},
    )
    assert r.status_code == 200
    assert r.json() == {"splits": []}


def test_suggest_illustrations_returns_empty_list(client: TestClient) -> None:
    r = client.post(
        "/api/gpu/suggest-illustrations",
        json={"project_id": "any", "idx0": 0},
    )
    assert r.status_code == 200
    assert r.json() == {"regions": []}


def test_extract_illustration_returns_501(settings: Settings) -> None:
    """The interactive extract route stays a 501. Crops come from the stage."""
    app = build_app(settings)
    with TestClient(app, raise_server_exceptions=False) as client:
        r = client.post(
            "/api/gpu/extract-illustration",
            json={
                "project_id": "any",
                "idx0": 0,
                "region_index": 1,
                "output_format": "jpg",
            },
        )
        assert r.status_code == 501
        body = r.json()
        assert body["error"] == "http_501"
        assert "illustrations stage" in body["message"]
