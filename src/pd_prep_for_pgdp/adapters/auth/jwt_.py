"""JWT auth (managed mode).

Lazy-imports `pyjwt`. OIDC discovery + JWKS fetch is deferred until
`verify()` is first called.
"""

from __future__ import annotations

import logging
from typing import Protocol, TypedDict, cast

from fastapi import HTTPException

from .base import UserContext

log = logging.getLogger(__name__)


class _DiscoveryDocument(TypedDict):
    jwks_uri: str


class _JwkEntry(TypedDict):
    kid: str


class _JwksDocument(TypedDict):
    keys: list[_JwkEntry]


class _JwtSigningKey(Protocol):
    key: object


class _PyJwkClient(Protocol):
    def get_signing_key_from_jwt(self, token: str) -> _JwtSigningKey: ...


class _PyJwkClientFactory(Protocol):
    def __call__(self, uri: str) -> _PyJwkClient: ...


class _PyJwtExceptions(Protocol):
    PyJWTError: type[Exception]


class _PyJwtDecode(Protocol):
    def __call__(
        self,
        jwt: str,
        key: object,
        *,
        algorithms: list[str],
        audience: str | None,
        issuer: str,
    ) -> dict[str, object]: ...


class JwtAuth:
    def __init__(self, issuer: str, audience: str | None = None) -> None:
        self._issuer: str = issuer.rstrip("/")
        self._audience: str | None = audience
        self._jwks: dict[str, object] | None = None

    async def _load_jwks(self) -> dict[str, object]:
        if self._jwks is not None:
            return self._jwks
        try:
            import httpx
        except ImportError as e:
            raise RuntimeError("httpx required for JWT auth") from e
        async with httpx.AsyncClient(timeout=5.0) as client:
            disc = await client.get(f"{self._issuer}/.well-known/openid-configuration")
            _ = disc.raise_for_status()
            discovery = cast(_DiscoveryDocument, disc.json())
            jwks_uri = discovery["jwks_uri"]
            jwks = await client.get(jwks_uri)
            _ = jwks.raise_for_status()
        jwks_doc = cast(_JwksDocument, jwks.json())
        self._jwks = {entry["kid"]: entry for entry in jwks_doc["keys"]}
        return self._jwks

    async def verify(self, credentials: str | None) -> UserContext:
        if not credentials:
            raise HTTPException(status_code=401, detail="missing bearer token")
        try:
            import jwt as pyjwt  # pyright: ignore[reportMissingImports]
        except ImportError as e:
            raise RuntimeError(
                "JWT auth requires the [jwt] extra: install with 'pip install pd-prep-for-pgdp[jwt]'"
            ) from e

        decode = cast(_PyJwtDecode, pyjwt.decode)
        exceptions = cast(_PyJwtExceptions, pyjwt.exceptions)
        jwks_url = f"{self._issuer}/.well-known/jwks.json"
        pyjwk_client_factory = cast(_PyJwkClientFactory, pyjwt.PyJWKClient)
        jwks_client = pyjwk_client_factory(jwks_url)
        try:
            signing_key = jwks_client.get_signing_key_from_jwt(credentials)
            claims = decode(
                credentials,
                signing_key.key,
                algorithms=["RS256", "ES256"],
                audience=self._audience,
                issuer=self._issuer,
            )
        except exceptions.PyJWTError as e:
            raise HTTPException(status_code=401, detail=f"invalid token: {e}") from e
        except (ConnectionError, TimeoutError, OSError) as e:
            raise HTTPException(status_code=503, detail="authentication service unavailable") from e
        except Exception as e:
            log.exception("unexpected error during JWT verification")
            raise HTTPException(status_code=500, detail="unexpected auth error") from e

        user_id = claims.get("sub")
        if not isinstance(user_id, str) or not user_id:
            raise HTTPException(status_code=401, detail="token missing 'sub' claim")
        return UserContext(user_id=user_id)
