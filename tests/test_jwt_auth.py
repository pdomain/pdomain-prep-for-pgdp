"""Tests for `adapters.auth.jwt_.JwtAuth.verify`.

Covers the easy error paths without standing up a real OIDC issuer:
  - no credentials → 401 'missing bearer token',
  - syntactically broken token → 401 'invalid token: ...',
  - the `[jwt]` extra import error path is left to integration testing —
    in this repo the dependency is always available because the dev group
    pulls it in for tests.
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from pd_prep_for_pgdp.adapters.auth.jwt_ import JwtAuth


@pytest.mark.asyncio
async def test_verify_none_credentials_raises_401() -> None:
    auth = JwtAuth(issuer="https://issuer.example", audience="aud")
    with pytest.raises(HTTPException) as exc:
        await auth.verify(None)
    assert exc.value.status_code == 401
    assert "missing bearer token" in str(exc.value.detail)


@pytest.mark.asyncio
async def test_verify_empty_credentials_raises_401() -> None:
    auth = JwtAuth(issuer="https://issuer.example", audience="aud")
    with pytest.raises(HTTPException) as exc:
        await auth.verify("")
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_verify_garbage_token_raises_401(monkeypatch: pytest.MonkeyPatch) -> None:
    """A clearly-malformed token should be rejected with 401 'invalid token'.

    Skipped if the `[jwt]` extra isn't installed (pyjwt is optional in dev).
    """
    pytest.importorskip("jwt")
    import jwt as pyjwt

    auth = JwtAuth(issuer="https://issuer.example", audience="aud")

    class _BoomClient:
        def __init__(self, _url: str) -> None:
            pass

        def get_signing_key_from_jwt(self, _tok: str):
            raise pyjwt.exceptions.DecodeError("not a jwt")

    monkeypatch.setattr("jwt.PyJWKClient", _BoomClient)

    with pytest.raises(HTTPException) as exc:
        await auth.verify("garbage.not.a.jwt")
    assert exc.value.status_code == 401
    assert "invalid token" in str(exc.value.detail)


@pytest.mark.asyncio
async def test_verify_missing_sub_claim_raises_401(monkeypatch: pytest.MonkeyPatch) -> None:
    """A successful decode with no `sub` claim should be rejected — without a
    sub we can't link the request to a user record."""
    pytest.importorskip("jwt")
    import jwt as pyjwt

    auth = JwtAuth(issuer="https://issuer.example", audience="aud")

    class _OkKeyClient:
        def __init__(self, _url: str) -> None:
            pass

        def get_signing_key_from_jwt(self, _tok: str):
            return type("_K", (), {"key": "fake-key"})()

    monkeypatch.setattr("jwt.PyJWKClient", _OkKeyClient)
    monkeypatch.setattr(pyjwt, "decode", lambda *a, **kw: {"aud": "aud", "iss": "https://issuer.example"})

    with pytest.raises(HTTPException) as exc:
        await auth.verify("any.jwt.token")
    assert exc.value.status_code == 401
    assert "sub" in str(exc.value.detail)


@pytest.mark.asyncio
async def test_verify_returns_user_context_on_success(monkeypatch: pytest.MonkeyPatch) -> None:
    """A valid token with a sub claim resolves to a UserContext carrying that sub."""
    pytest.importorskip("jwt")
    import jwt as pyjwt

    auth = JwtAuth(issuer="https://issuer.example", audience="aud")

    class _OkKeyClient:
        def __init__(self, _url: str) -> None:
            pass

        def get_signing_key_from_jwt(self, _tok: str):
            return type("_K", (), {"key": "fake-key"})()

    monkeypatch.setattr("jwt.PyJWKClient", _OkKeyClient)
    monkeypatch.setattr(
        pyjwt,
        "decode",
        lambda *a, **kw: {"sub": "alice", "aud": "aud", "iss": "https://issuer.example"},
    )

    ctx = await auth.verify("any.jwt.token")
    assert ctx.user_id == "alice"


@pytest.mark.asyncio
async def test_connection_error_during_jwt_verify_returns_503(monkeypatch: pytest.MonkeyPatch) -> None:
    """A network failure during JWKS fetch must return 503, not 401."""
    pytest.importorskip("jwt")

    auth = JwtAuth(issuer="https://issuer.example", audience="aud")

    class _NetworkBoomClient:
        def __init__(self, _url: str) -> None:
            pass

        def get_signing_key_from_jwt(self, _tok: str):
            raise ConnectionError("JWKS endpoint unreachable")

    monkeypatch.setattr("jwt.PyJWKClient", _NetworkBoomClient)

    with pytest.raises(HTTPException) as exc:
        await auth.verify("any.jwt.token")
    assert exc.value.status_code == 503
    assert "authentication service unavailable" in str(exc.value.detail)


@pytest.mark.asyncio
async def test_unexpected_error_during_jwt_verify_returns_500(monkeypatch: pytest.MonkeyPatch) -> None:
    """An unexpected (non-JWT, non-network) error must return 500, not 401."""
    pytest.importorskip("jwt")

    auth = JwtAuth(issuer="https://issuer.example", audience="aud")

    class _UnexpectedBoomClient:
        def __init__(self, _url: str) -> None:
            pass

        def get_signing_key_from_jwt(self, _tok: str):
            raise ValueError("something completely unexpected")

    monkeypatch.setattr("jwt.PyJWKClient", _UnexpectedBoomClient)

    with pytest.raises(HTTPException) as exc:
        await auth.verify("any.jwt.token")
    assert exc.value.status_code == 500
    assert "unexpected auth error" in str(exc.value.detail)


@pytest.mark.asyncio
async def test_load_jwks_caches_after_first_call(monkeypatch: pytest.MonkeyPatch) -> None:
    """`_load_jwks` should hit the issuer's discovery endpoint once and
    cache the resulting key map. The second call returns the same dict
    without making more HTTP requests."""
    auth = JwtAuth(issuer="https://issuer.example", audience="aud")

    call_log: list[str] = []

    class _Resp:
        def __init__(self, payload: dict) -> None:
            self._payload = payload

        def json(self) -> dict:
            return self._payload

        def raise_for_status(self) -> None:
            pass

    class _FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            return False

        async def get(self, url: str):
            call_log.append(url)
            if url.endswith("/.well-known/openid-configuration"):
                return _Resp({"jwks_uri": "https://issuer.example/jwks"})
            return _Resp({"keys": [{"kid": "kid-1", "kty": "RSA"}]})

    import httpx

    monkeypatch.setattr(httpx, "AsyncClient", lambda *a, **kw: _FakeClient())

    keys1 = await auth._load_jwks()
    keys2 = await auth._load_jwks()
    assert keys1 is keys2  # cached, same dict instance
    assert "kid-1" in keys1
    # Discovery + JWKS fetch happen exactly once across both calls.
    assert len(call_log) == 2
