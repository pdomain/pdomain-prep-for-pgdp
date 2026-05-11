"""Tests for `GET /healthz` — operational liveness probe.

Roadmap §19. Returns `{status, gpu_backend, dispatcher, db_reachable, mode}`.
Cheap, unauthenticated, JSON, useful for ECS / k8s liveness checks. No write
to the database — the reachability probe is a single bounded read against
`list_recent_jobs` for a synthetic owner that is guaranteed to return zero
rows.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from pd_prep_for_pgdp.bootstrap import build_app
from pd_prep_for_pgdp.settings import Settings


def _settings(tmp_path, **kw) -> Settings:
    base = dict(
        host="127.0.0.1",
        port=8765,
        data_root=tmp_path / "data",
        config_dir=tmp_path / "config",
        storage_backend="filesystem",
        database_url=f"sqlite:///{(tmp_path / 's.db').as_posix()}",
        gpu_backend="cpu",
        dispatch_interval_seconds=0,
        auth_mode="none",
    )
    base.update(kw)
    return Settings(**base)


def test_healthz_returns_ok_payload(tmp_path) -> None:
    app = build_app(_settings(tmp_path))
    with TestClient(app) as client:
        r = client.get("/healthz")
        assert r.status_code == 200
        body = r.json()
        assert body["status"] == "ok"
        # cpu backend in tests; the contract is "the GPUBackend.name string".
        assert body["gpu_backend"] == "cpu"
        # dispatch_interval_seconds=0 -> ImmediateDispatcher.
        assert body["dispatcher"] == "immediate"
        assert body["db_reachable"] is True
        # `mode` echoes the deployment shape so an ops dashboard can group.
        assert body["mode"] == "full"


def test_healthz_reports_batched_dispatcher_when_interval_set(tmp_path) -> None:
    app = build_app(_settings(tmp_path, dispatch_interval_seconds=300))
    with TestClient(app) as client:
        r = client.get("/healthz")
        assert r.status_code == 200
        assert r.json()["dispatcher"] == "batched"


def test_healthz_is_unauthenticated_in_apikey_mode(tmp_path) -> None:
    """Liveness must not require credentials — orchestrators don't have them."""
    app = build_app(_settings(tmp_path, auth_mode="apikey", api_key="secret-xyz"))
    with TestClient(app) as client:
        # No Authorization header on purpose.
        r = client.get("/healthz")
        assert r.status_code == 200
        assert r.json()["status"] == "ok"


def test_healthz_reports_db_unreachable_when_probe_fails(tmp_path) -> None:
    """Patch `list_recent_jobs` to raise; the route swallows it and marks the
    DB unhealthy without 500-ing the route itself (probes that 500 are no
    use to liveness orchestrators)."""
    app = build_app(_settings(tmp_path))

    async def _boom(*_a, **_kw):
        raise RuntimeError("simulated outage")

    with TestClient(app) as client:
        # Replace the bound method on the live database adapter.
        app.state.database.list_recent_jobs = _boom  # type: ignore[method-assign]
        r = client.get("/healthz")
        assert r.status_code == 200
        body = r.json()
        assert body["db_reachable"] is False
        # status reflects degraded health when any probe fails.
        assert body["status"] == "degraded"


def test_healthz_excluded_from_openapi_schema(tmp_path) -> None:
    """`/healthz` is an ops surface, not part of the public API contract."""
    app = build_app(_settings(tmp_path))
    with TestClient(app) as client:
        schema = client.get("/openapi.json").json()
        assert "/healthz" not in schema.get("paths", {})
