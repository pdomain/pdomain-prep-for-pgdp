"""GET /api/auth/me — return the resolved UserContext."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from pdomain_prep_for_pgdp.adapters.auth import UserContext
from pdomain_prep_for_pgdp.api.dependencies import get_user

router = APIRouter(tags=["auth"])


@router.get("/me", response_model=UserContext, operation_id="get_current_user")
async def me(user: UserContext = Depends(get_user)) -> UserContext:
    return user
