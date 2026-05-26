"""IAuth Protocol + the UserContext that routes inject."""

from __future__ import annotations

from typing import Protocol

from pydantic import BaseModel


class UserContext(BaseModel):
    user_id: str = "default"


class IAuth(Protocol):
    async def verify(self, credentials: str | None) -> UserContext: ...
