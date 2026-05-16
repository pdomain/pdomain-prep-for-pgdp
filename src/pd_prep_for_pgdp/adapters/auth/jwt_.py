"""JWT auth (managed mode).

Lazy-imports `pyjwt`. OIDC discovery + JWKS fetch is deferred until
`verify()` is first called.
"""

from __future__ import annotations

import logging

from fastapi import HTTPException

from .base import UserContext

log = logging.getLogger(__name__)


class JwtAuth:
    def __init__(self, issuer: str, audience: str | None = None) -> None:
        self._issuer = issuer.rstrip("/")
        self._audience = audience
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
            disc.raise_for_status()
            jwks_uri = disc.json()["jwks_uri"]
            jwks = await client.get(jwks_uri)
            jwks.raise_for_status()
        self._jwks = {k["kid"]: k for k in jwks.json().get("keys", [])}
        return self._jwks

    async def verify(self, credentials: str | None) -> UserContext:
        if not credentials:
            raise HTTPException(status_code=401, detail="missing bearer token")
        try:
            import jwt as pyjwt
            from jwt import PyJWKClient
        except ImportError as e:
            raise RuntimeError(
                "JWT auth requires the [jwt] extra: install with 'pip install pd-prep-for-pgdp[jwt]'"
            ) from e

        jwks_url = f"{self._issuer}/.well-known/jwks.json"
        jwks_client = PyJWKClient(jwks_url)
        try:
            signing_key = jwks_client.get_signing_key_from_jwt(credentials)
            claims = pyjwt.decode(
                credentials,
                signing_key.key,
                algorithms=["RS256", "ES256"],
                audience=self._audience,
                issuer=self._issuer,
            )
        except pyjwt.exceptions.PyJWTError as e:
            raise HTTPException(status_code=401, detail=f"invalid token: {e}") from e
        except (ConnectionError, TimeoutError, OSError) as e:
            raise HTTPException(status_code=503, detail="authentication service unavailable") from e
        except Exception as e:
            log.exception("unexpected error during JWT verification")
            raise HTTPException(status_code=500, detail="unexpected auth error") from e

        user_id = claims.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="token missing 'sub' claim")
        return UserContext(user_id=user_id)
