"""Tests for `adapters.auth.jwt_.JwtAuth.verify`.

Covers the easy error paths without standing up a real OIDC issuer:
  - no credentials → 401 'missing bearer token',
  - syntactically broken token → 401 'invalid token: ...',
  - error branches from the optional jwt dependency.
"""

from __future__ import annotations

import sys
import types
from typing import Protocol, cast

import pytest
from fastapi import HTTPException

from pdomain_prep_for_pgdp.adapters.auth.jwt_ import JwtAuth


class _HttpxResponseLike(Protocol):
    def json(self) -> dict[str, object]: ...

    def raise_for_status(self) -> None: ...


class _JwtDecode(Protocol):
    def __call__(self, token: str, key: object, /, **kwargs: object) -> dict[str, object]: ...


class _JwtModuleLike(Protocol):
    exceptions: object
    decode: _JwtDecode
    PyJWKClient: object


class _JwtError(Exception): ...


def _install_fake_jwt_module(
    monkeypatch: pytest.MonkeyPatch,
    *,
    jwt_error: type[BaseException],
    decode: _JwtDecode,
) -> None:
    module_object = cast(
        "_JwtModuleLike",
        cast("object", types.ModuleType("jwt")),
    )
    module_object.exceptions = types.SimpleNamespace(PyJWTError=jwt_error)
    module_object.decode = decode
    module_object.PyJWKClient = type("_PyJWKClient", (), {})
    monkeypatch.setitem(sys.modules, "jwt", cast("types.ModuleType", cast("object", module_object)))


def _build_jwk_client_factory(key: str) -> type[object]:
    class _FakePyJWKClient:
        def __init__(self, _url: str) -> None: ...

        def get_signing_key_from_jwt(self, _token: str) -> object:
            return types.SimpleNamespace(key=key)

    return _FakePyJWKClient


@pytest.mark.asyncio
async def test_verify_none_credentials_raises_401() -> None:
    auth = JwtAuth(issuer="https://issuer.example", audience="aud")
    with pytest.raises(HTTPException) as exc:
        _ = await auth.verify(None)
    assert exc.value.status_code == 401
    assert "missing bearer token" in str(exc.value.detail)


@pytest.mark.asyncio
async def test_verify_empty_credentials_raises_401() -> None:
    auth = JwtAuth(issuer="https://issuer.example", audience="aud")
    with pytest.raises(HTTPException) as exc:
        _ = await auth.verify("")
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_verify_garbage_token_raises_401(monkeypatch: pytest.MonkeyPatch) -> None:
    class _BadJwtError(_JwtError): ...

    def _decode(_token: str, _key: object, **_kwargs: object) -> dict[str, object]:
        raise _BadJwtError("not a jwt")

    _install_fake_jwt_module(monkeypatch, jwt_error=_BadJwtError, decode=_decode)
    monkeypatch.setattr(sys.modules["jwt"], "PyJWKClient", _build_jwk_client_factory("fake-key"))

    auth = JwtAuth(issuer="https://issuer.example", audience="aud")

    with pytest.raises(HTTPException) as exc:
        _ = await auth.verify("garbage.not.a.jwt")
    assert exc.value.status_code == 401
    assert "invalid token" in str(exc.value.detail)


@pytest.mark.asyncio
async def test_verify_missing_sub_claim_raises_401(monkeypatch: pytest.MonkeyPatch) -> None:
    def _decode(_token: str, _key: object, **_kwargs: object) -> dict[str, object]:
        return {"aud": "aud", "iss": "https://issuer.example"}

    _install_fake_jwt_module(
        monkeypatch,
        jwt_error=_JwtError,
        decode=_decode,
    )
    monkeypatch.setattr(sys.modules["jwt"], "PyJWKClient", _build_jwk_client_factory("fake-key"))

    auth = JwtAuth(issuer="https://issuer.example", audience="aud")

    with pytest.raises(HTTPException) as exc:
        _ = await auth.verify("any.jwt.token")
    assert exc.value.status_code == 401
    assert "sub" in str(exc.value.detail)


@pytest.mark.asyncio
async def test_verify_returns_user_context_on_success(monkeypatch: pytest.MonkeyPatch) -> None:
    def _decode(_token: str, _key: object, **_kwargs: object) -> dict[str, object]:
        return {"sub": "alice", "aud": "aud", "iss": "https://issuer.example"}

    _install_fake_jwt_module(
        monkeypatch,
        jwt_error=_JwtError,
        decode=_decode,
    )
    monkeypatch.setattr(sys.modules["jwt"], "PyJWKClient", _build_jwk_client_factory("fake-key"))

    auth = JwtAuth(issuer="https://issuer.example", audience="aud")

    ctx = await auth.verify("any.jwt.token")
    assert ctx.user_id == "alice"


@pytest.mark.asyncio
async def test_connection_error_during_jwt_verify_returns_503(monkeypatch: pytest.MonkeyPatch) -> None:
    def _decode(_token: str, _key: object, **_kwargs: object) -> dict[str, object]:
        return {"aud": "aud", "iss": "https://issuer.example", "sub": "alice"}

    _install_fake_jwt_module(
        monkeypatch,
        jwt_error=_JwtError,
        decode=_decode,
    )

    class _NetworkBoomClient:
        def __init__(self, _url: str) -> None: ...

        def get_signing_key_from_jwt(self, _tok: str) -> object:
            raise ConnectionError("JWKS endpoint unreachable")

    monkeypatch.setattr(sys.modules["jwt"], "PyJWKClient", _NetworkBoomClient)

    auth = JwtAuth(issuer="https://issuer.example", audience="aud")

    with pytest.raises(HTTPException) as exc:
        _ = await auth.verify("any.jwt.token")
    assert exc.value.status_code == 503
    assert "authentication service unavailable" in str(exc.value.detail)


@pytest.mark.asyncio
async def test_unexpected_error_during_jwt_verify_returns_500(monkeypatch: pytest.MonkeyPatch) -> None:
    def _decode(_token: str, _key: object, **_kwargs: object) -> dict[str, object]:
        return {"aud": "aud", "iss": "https://issuer.example", "sub": "alice"}

    _install_fake_jwt_module(
        monkeypatch,
        jwt_error=_JwtError,
        decode=_decode,
    )

    class _UnexpectedBoomClient:
        def __init__(self, _url: str) -> None: ...

        def get_signing_key_from_jwt(self, _tok: str) -> object:
            raise ValueError("something completely unexpected")

    monkeypatch.setattr(sys.modules["jwt"], "PyJWKClient", _UnexpectedBoomClient)

    auth = JwtAuth(issuer="https://issuer.example", audience="aud")

    with pytest.raises(HTTPException) as exc:
        _ = await auth.verify("any.jwt.token")
    assert exc.value.status_code == 500
    assert "unexpected auth error" in str(exc.value.detail)


@pytest.mark.asyncio
async def test_load_jwks_caches_after_first_call(monkeypatch: pytest.MonkeyPatch) -> None:

    class _Resp:
        def __init__(self, payload: dict[str, object]) -> None:
            self._payload: dict[str, object] = payload

        def json(self) -> dict[str, object]:
            return self._payload

        def raise_for_status(self) -> None: ...

    class _FakeClient:
        def __init__(self, call_log: list[str]) -> None:
            self.call_log: list[str] = call_log

        async def __aenter__(self) -> _FakeClient:
            return self

        async def __aexit__(self, *_: object) -> bool:
            return False

        async def get(self, url: str) -> _HttpxResponseLike:
            self.call_log.append(url)
            if url.endswith("/.well-known/openid-configuration"):
                return _Resp({"jwks_uri": "https://issuer.example/jwks"})
            return _Resp({"keys": [{"kid": "kid-1", "kty": "RSA"}]})

    import httpx

    call_log: list[str] = []

    class _AsyncClientFactory:
        def __init__(self, entries: list[str]) -> None:
            self.entries: list[str] = entries

        def __call__(self, *args: object, **kwargs: object) -> _FakeClient:
            return _FakeClient(self.entries)

    monkeypatch.setattr(httpx, "AsyncClient", _AsyncClientFactory(call_log))

    auth = JwtAuth(issuer="https://issuer.example", audience="aud")
    keys1 = await auth._load_jwks()  # pyright: ignore[reportPrivateUsage]
    keys2 = await auth._load_jwks()  # pyright: ignore[reportPrivateUsage]
    assert keys1 is keys2
    assert "kid-1" in keys1
    assert len(call_log) == 2
