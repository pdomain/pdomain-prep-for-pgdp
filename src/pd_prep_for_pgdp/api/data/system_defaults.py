"""/api/data/system/defaults — global tunables (per-user in hosted mode)."""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends
from fastapi.responses import Response

from pd_prep_for_pgdp.api.dependencies import get_database, get_user
from pd_prep_for_pgdp.core.models import SystemDefaults

if TYPE_CHECKING:
    from pd_prep_for_pgdp.adapters.auth import UserContext
    from pd_prep_for_pgdp.adapters.database import IDatabase

router = APIRouter(tags=["system"])


@router.get("/system/defaults", response_model=SystemDefaults, operation_id="get_system_defaults")
async def get_system_defaults(
    user: UserContext = Depends(get_user),
    db: IDatabase = Depends(get_database),
) -> SystemDefaults:
    return await db.get_system_defaults(user.user_id)


@router.put("/system/defaults", response_model=SystemDefaults, operation_id="put_system_defaults")
async def put_system_defaults(
    body: SystemDefaults,
    user: UserContext = Depends(get_user),
    db: IDatabase = Depends(get_database),
) -> SystemDefaults:
    await db.put_system_defaults(user.user_id, body)
    return body


@router.get("/system/defaults/export", operation_id="export_system_defaults")
async def export_system_defaults(
    user: UserContext = Depends(get_user),
    db: IDatabase = Depends(get_database),
) -> Response:
    """Return the SystemDefaults as a downloadable JSON file."""
    defaults = await db.get_system_defaults(user.user_id)
    body = defaults.model_dump_json(indent=2)
    return Response(
        content=body,
        media_type="application/json",
        headers={"Content-Disposition": 'attachment; filename="pgdp-prep-defaults.json"'},
    )


@router.post("/system/defaults/import", response_model=SystemDefaults, operation_id="import_system_defaults")
async def import_system_defaults(
    body: SystemDefaults,
    user: UserContext = Depends(get_user),
    db: IDatabase = Depends(get_database),
) -> SystemDefaults:
    """Replace the stored SystemDefaults with an imported JSON document.

    Behaves like PUT — sharing the response shape so the frontend can
    `setDraft(response)` and the next GET will agree.
    """
    await db.put_system_defaults(user.user_id, body)
    return body


@router.delete("/system/defaults", response_model=SystemDefaults, operation_id="reset_system_defaults")
async def reset_system_defaults(
    user: UserContext = Depends(get_user),
    db: IDatabase = Depends(get_database),
) -> SystemDefaults:
    """Reset the stored SystemDefaults to spec-08 defaults. Idempotent."""
    fresh = SystemDefaults()
    await db.put_system_defaults(user.user_id, fresh)
    return fresh
