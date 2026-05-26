"""API-key auth — single shared bearer token, single user."""

from __future__ import annotations

import hmac

from fastapi import HTTPException

from .base import UserContext


class ApiKeyAuth:
    def __init__(self, expected_key: str) -> None:
        if not expected_key:
            raise ValueError("ApiKeyAuth requires a non-empty key")
        self._expected: str = expected_key

    async def verify(self, credentials: str | None) -> UserContext:
        if not credentials or not hmac.compare_digest(credentials, self._expected):
            raise HTTPException(status_code=401, detail="invalid or missing api key")
        return UserContext()
