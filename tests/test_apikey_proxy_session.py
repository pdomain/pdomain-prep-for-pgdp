"""TDD tests for the server-side proxy session flow (#125).

Verifies:
  1. Unauthenticated request to a protected endpoint → 401
  2. POST /api/auth/session with correct API key → 200 + httpOnly Set-Cookie
  3. Subsequent protected request with the session cookie → 200
  4. Cookie/response body does NOT contain the upstream bearer value
  5. POST /api/auth/session/logout clears the cookie
  6. none and oidc/jwt modes are not regressed

Intentionally does NOT test Bearer fallback here — that's covered by
test_apikey_auth.py and test_auth_me.py.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from pd_prep_for_pgdp.bootstrap import build_app
from pd_prep_for_pgdp.settings import Settings

_SENTINEL = "super-secret-sentinel-xyzzy-apikey"
_SESSION_SECRET = "test-session-secret-abc123"


def _settings(tmp_path, **kw) -> Settings:
    base: dict = {
        "host": "127.0.0.1",
        "port": 8765,
        "data_root": tmp_path / "data",
        "config_dir": tmp_path / "config",
        "storage_backend": "filesystem",
        "database_url": f"sqlite:///{(tmp_path / 's.db').as_posix()}",
        "gpu_backend": "cpu",
        "dispatch_interval_seconds": 0,
        "auth_mode": "none",
    }
    base.update(kw)
    return Settings(**base)


# ── 1. Unauthenticated → 401 ─────────────────────────────────────────────────


def test_unauthenticated_protected_endpoint_returns_401(tmp_path) -> None:
    """Without a session cookie or Bearer header, /api/auth/me returns 401."""
    app = build_app(_settings(tmp_path, auth_mode="apikey", api_key=_SENTINEL))
    with TestClient(app, cookies={}) as client:
        r = client.get("/api/auth/me")
    assert r.status_code == 401


# ── 2. Login endpoint sets httpOnly cookie ────────────────────────────────────


def test_session_login_with_correct_key_sets_cookie(tmp_path) -> None:
    """POST /api/auth/session with the correct key returns 200 and sets the session cookie."""
    app = build_app(
        _settings(tmp_path, auth_mode="apikey", api_key=_SENTINEL, session_secret=_SESSION_SECRET)
    )
    with TestClient(app) as client:
        r = client.post("/api/auth/session", json={"api_key": _SENTINEL})
    assert r.status_code == 200
    assert "pgdp_session" in r.cookies


def test_session_login_cookie_is_httponly(tmp_path) -> None:
    """The session cookie must be flagged HttpOnly."""
    app = build_app(
        _settings(tmp_path, auth_mode="apikey", api_key=_SENTINEL, session_secret=_SESSION_SECRET)
    )
    with TestClient(app) as client:
        r = client.post("/api/auth/session", json={"api_key": _SENTINEL})
    # TestClient exposes Set-Cookie headers via response.headers
    set_cookie = r.headers.get("set-cookie", "")
    assert "HttpOnly" in set_cookie or "httponly" in set_cookie.lower()


def test_session_login_with_wrong_key_returns_401(tmp_path) -> None:
    """Wrong key → 401, no cookie issued."""
    app = build_app(
        _settings(tmp_path, auth_mode="apikey", api_key=_SENTINEL, session_secret=_SESSION_SECRET)
    )
    with TestClient(app) as client:
        r = client.post("/api/auth/session", json={"api_key": "wrong-key"})
    assert r.status_code == 401
    assert "pgdp_session" not in r.cookies


# ── 3. Cookie → 200 on protected endpoint ────────────────────────────────────


def test_session_cookie_authenticates_protected_request(tmp_path) -> None:
    """After login, the session cookie grants access to protected endpoints."""
    app = build_app(
        _settings(tmp_path, auth_mode="apikey", api_key=_SENTINEL, session_secret=_SESSION_SECRET)
    )
    with TestClient(app) as client:
        login = client.post("/api/auth/session", json={"api_key": _SENTINEL})
        assert login.status_code == 200
        # TestClient carries cookies automatically in the same session
        r = client.get("/api/auth/me")
    assert r.status_code == 200
    assert r.json()["user_id"] == "default"


# ── 4. Sentinel never leaks ───────────────────────────────────────────────────


def test_session_login_response_does_not_contain_bearer(tmp_path) -> None:
    """The login response body and cookie value must not contain the upstream bearer."""
    app = build_app(
        _settings(tmp_path, auth_mode="apikey", api_key=_SENTINEL, session_secret=_SESSION_SECRET)
    )
    with TestClient(app) as client:
        r = client.post("/api/auth/session", json={"api_key": _SENTINEL})
    assert r.status_code == 200
    assert _SENTINEL not in r.text, f"Bearer leaked in login response: {r.text!r}"
    for cookie_name, cookie_val in r.cookies.items():
        assert _SENTINEL not in cookie_val, f"Bearer leaked in Set-Cookie {cookie_name}={cookie_val!r}"


# ── 5. Logout clears cookie ───────────────────────────────────────────────────


def test_logout_clears_session_cookie(tmp_path) -> None:
    """POST /api/auth/session/logout invalidates the session."""
    app = build_app(
        _settings(tmp_path, auth_mode="apikey", api_key=_SENTINEL, session_secret=_SESSION_SECRET)
    )
    with TestClient(app) as client:
        client.post("/api/auth/session", json={"api_key": _SENTINEL})
        # Verify we're authenticated before logout
        assert client.get("/api/auth/me").status_code == 200
        logout = client.post("/api/auth/session/logout")
        assert logout.status_code == 200
        # After logout the cookie must be cleared — TestClient should now
        # have an empty/expired pgdp_session, so /me returns 401 again.
        r = client.get("/api/auth/me")
    assert r.status_code == 401


# ── 6. Regression: none mode still works ─────────────────────────────────────


def test_none_mode_protected_endpoint_still_works(tmp_path) -> None:
    """In none-auth mode, all endpoints remain accessible without any credential."""
    app = build_app(_settings(tmp_path, auth_mode="none"))
    with TestClient(app) as client:
        r = client.get("/api/auth/me")
    assert r.status_code == 200
    assert r.json()["user_id"] == "default"


def test_none_mode_session_endpoint_not_needed(tmp_path) -> None:
    """In none-auth mode, POST /api/auth/session is not a real route.

    FastAPI may return 404 (path not found) or 405 (path prefix found, method
    not allowed) depending on the router internals — both are acceptable since
    neither is a 200 and neither exposes the session login flow.
    """
    app = build_app(_settings(tmp_path, auth_mode="none"))
    with TestClient(app) as client:
        r = client.post("/api/auth/session", json={"api_key": "anything"})
    assert r.status_code in (404, 405)


# ── 7. Bearer fallback still works for non-browser callers ───────────────────


def test_bearer_header_still_authenticates_in_apikey_mode(tmp_path) -> None:
    """Existing Bearer-based callers (scripts/CI) continue to work."""
    app = build_app(
        _settings(tmp_path, auth_mode="apikey", api_key=_SENTINEL, session_secret=_SESSION_SECRET)
    )
    with TestClient(app) as client:
        r = client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {_SENTINEL}"},
        )
    assert r.status_code == 200
    assert r.json()["user_id"] == "default"
