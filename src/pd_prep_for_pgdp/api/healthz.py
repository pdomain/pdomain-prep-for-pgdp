"""GET /healthz — operational liveness probe.

Roadmap §19. Returns enough adapter state for an orchestrator (ECS / k8s /
load balancer) to make a sensible liveness or readiness decision without
having to pull credentials. Unauthenticated by design — probes don't carry
tokens.

Shape:
    {
        "status": "ok" | "degraded",
        "gpu_backend": str,      # GPUBackend.name
        "dispatcher": str,       # "immediate" | "batched"
        "db_reachable": bool,    # cheap read against the database adapter
        "mode": str              # Settings.mode ("full" | "gpu_worker_only")
    }

Probe semantics:
- The DB probe is `list_recent_jobs("__healthz__", limit=1)`. The synthetic
  owner_id is guaranteed to return zero rows, so the probe is read-only and
  bounded. Any exception flips `db_reachable=False` and `status=degraded`.
- 500-ing this route would defeat the purpose; orchestrators want a 200 with
  a body that says "I'm alive but degraded" so they can alert without
  also marking the pod dead.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Request
from pydantic import BaseModel

from pd_prep_for_pgdp.dispatcher.batched import BatchDispatcher

log = logging.getLogger(__name__)

router = APIRouter()

# Sentinel owner_id used for the read-only DB probe. Pages / projects / jobs
# never have this owner so the probe is guaranteed to return an empty list.
_HEALTHZ_OWNER_SENTINEL = "__healthz__"


class HealthzResponse(BaseModel):
    status: str
    gpu_backend: str
    dispatcher: str
    db_reachable: bool
    mode: str


@router.get("/healthz", include_in_schema=False)
async def healthz(request: Request) -> HealthzResponse:
    state = request.app.state
    settings = state.settings
    gpu = state.gpu_backend
    dispatcher = state.dispatcher
    database = state.database

    db_reachable = True
    try:
        await database.list_recent_jobs(_HEALTHZ_OWNER_SENTINEL, limit=1)
    except Exception as e:  # pragma: no cover - exercised via test patch
        log.warning("healthz db probe failed: %s", e)
        db_reachable = False

    dispatcher_name = "batched" if isinstance(dispatcher, BatchDispatcher) else "immediate"

    return HealthzResponse(
        status="ok" if db_reachable else "degraded",
        gpu_backend=gpu.name,
        dispatcher=dispatcher_name,
        db_reachable=db_reachable,
        mode=settings.mode,
    )


def install_healthz(app) -> None:  # type: ignore[no-untyped-def]
    """Register `GET /healthz`. Call before the SPA mount so the catch-all
    fallback doesn't shadow it (the SPA fallback only handles `/{full_path}`
    after include_in_schema=False routes are registered, but mounting first
    is the consistent pattern used elsewhere — see env_js / cdn)."""
    app.include_router(router)
