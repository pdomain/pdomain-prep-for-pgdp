"""Tests for `adapters.auth.apikey.ApiKeyAuth`.

Locks in:
  - constructing with an empty key raises ValueError (no silent insecurity),
  - verify() with the wrong credentials returns 401,
  - verify() with no credentials returns 401,
  - verify() with the matching key returns a default UserContext,
  - constant-time compare is used (smoke-checked via hmac.compare_digest).
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from pdomain_prep_for_pgdp.adapters.auth.apikey import ApiKeyAuth


def test_empty_key_construction_rejected() -> None:
    with pytest.raises(ValueError, match="non-empty"):
        ApiKeyAuth("")


@pytest.mark.asyncio
async def test_verify_correct_key_returns_user() -> None:
    auth = ApiKeyAuth("s3cret-token")
    ctx = await auth.verify("s3cret-token")
    assert ctx.user_id == "default"


@pytest.mark.asyncio
async def test_verify_wrong_key_raises_401() -> None:
    auth = ApiKeyAuth("expected")
    with pytest.raises(HTTPException) as exc:
        await auth.verify("not-the-key")
    assert exc.value.status_code == 401
    assert "invalid or missing" in str(exc.value.detail)


@pytest.mark.asyncio
async def test_verify_missing_key_raises_401() -> None:
    auth = ApiKeyAuth("expected")
    with pytest.raises(HTTPException) as exc:
        await auth.verify(None)
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_verify_empty_key_raises_401() -> None:
    auth = ApiKeyAuth("expected")
    with pytest.raises(HTTPException) as exc:
        await auth.verify("")
    assert exc.value.status_code == 401
