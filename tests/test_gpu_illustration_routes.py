"""Lock in the contract of the not-yet-wired GPU illustration routes.

These three routes are stubs today (per spec 05 — wiring lands in a
later iteration). Locks in:
  - POST /suggest-splits returns 200 with `{splits: []}`,
  - POST /suggest-illustrations returns 200 with `{regions: []}`,
  - POST /extract-illustration surfaces as 500 internal_error (the
    NotImplementedError isn't an HTTPException, so the catch-all in
    api.middleware.error_handler turns it into an envelope).

When these routes are wired up, the failing assertions here force a
test rewrite — that's intentional, so the contract change is conscious.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi.testclient import TestClient

from pd_prep_for_pgdp.bootstrap import build_app

if TYPE_CHECKING:
    from pd_prep_for_pgdp.settings import Settings


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


def test_extract_illustration_returns_500_until_wired(settings: Settings) -> None:
    """Use a local TestClient with `raise_server_exceptions=False` so the
    catch-all error handler's response reaches us instead of the bare
    NotImplementedError surfacing as a Starlette ServerError."""
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
        # NotImplementedError → 500 internal_error envelope.
        assert r.status_code == 500
        body = r.json()
        assert body["error"] == "internal_error"
        assert "not yet wired" in body["message"]
