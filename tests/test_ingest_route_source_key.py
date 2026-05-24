"""Security regression: POST /api/gpu/ingest must reject source_key outside
the authenticated project's storage prefix.

Issue #127 — Ingest accepts arbitrary storage keys for an owned project.

The route validates project ownership but (before the fix) does NOT validate
that `source_key` falls under the project's own prefix. A caller who owns
project P_B could supply `source_key = "projects/P_A/uploads/source.zip"`,
causing the runner to extract P_A's source images into P_B.

This file locks in:
  - Cross-project source_key returns 400.
  - Own-project source_key returns 202 (happy path, pre-enqueue only).
  - Leading-slash variants are normalised correctly.
  - Missing project still returns 404.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from fastapi.testclient import TestClient


# ── helpers ───────────────────────────────────────────────────────────────────


def _create_project(client: TestClient) -> str:
    """Create a project via the data API and return its id."""
    r = client.post(
        "/api/data/projects",
        json={"name": "Test Book", "source_type": "zip"},
    )
    assert r.status_code == 200, r.text
    return r.json()["project"]["id"]  # type: ignore[no-any-return]


def _post_ingest(client: TestClient, project_id: str, source_key: str) -> object:
    return client.post(
        "/api/gpu/ingest",
        json={
            "project_id": project_id,
            "source_key": source_key,
            "source_type": "zip",
        },
    )


# ── Slice 1 — route-level source_key validation ────────────────────────────


def test_ingest_rejects_cross_project_source_key(client: TestClient) -> None:
    """Supplying another project's source_key must return 400.

    Before the fix the route returns 202; after the fix it returns 400.
    """
    own_id = _create_project(client)
    r = _post_ingest(client, own_id, "projects/some-other-project/uploads/source.zip")
    assert r.status_code == 400, r.text  # type: ignore[attr-defined]


def test_ingest_accepts_own_project_source_key(client: TestClient) -> None:
    """source_key under the own project prefix must be accepted (202)."""
    own_id = _create_project(client)
    r = _post_ingest(client, own_id, f"projects/{own_id}/uploads/source.zip")
    assert r.status_code == 202, r.text  # type: ignore[attr-defined]


def test_ingest_rejects_cross_project_source_key_with_leading_slash(
    client: TestClient,
) -> None:
    """CDN-relative keys with a leading slash — cross-project still returns 400."""
    own_id = _create_project(client)
    r = _post_ingest(client, own_id, "/projects/other-project/uploads/source.zip")
    assert r.status_code == 400, r.text  # type: ignore[attr-defined]


def test_ingest_accepts_own_project_source_key_with_leading_slash(
    client: TestClient,
) -> None:
    """Leading-slash own-project key is normalised and accepted (202)."""
    own_id = _create_project(client)
    r = _post_ingest(client, own_id, f"/projects/{own_id}/uploads/source.zip")
    assert r.status_code == 202, r.text  # type: ignore[attr-defined]


def test_ingest_missing_project_returns_404(client: TestClient) -> None:
    """Unknown project_id still returns 404 regardless of source_key."""
    r = _post_ingest(client, "nonexistent-id", "projects/nonexistent-id/uploads/s.zip")
    assert r.status_code == 404  # type: ignore[attr-defined]
