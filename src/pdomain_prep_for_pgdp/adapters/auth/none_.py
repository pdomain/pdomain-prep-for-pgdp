"""No-auth adapter — every request resolves to user_id="default"."""

from __future__ import annotations

from .base import UserContext


class NoneAuth:
    async def verify(self, credentials: str | None) -> UserContext:
        _ = credentials
        return UserContext()
