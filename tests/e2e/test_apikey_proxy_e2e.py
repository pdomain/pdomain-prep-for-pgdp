"""E2E: apikey-mode server-side proxy login / logout / session flow (#125).

Covers the manual verification checklist from the design note (d5cb3dd):
  a. Login form renders in apikey mode (input + button; no OIDC redirect).
  b. Wrong key shows error; URL stays /login; no session cookie set.
  c. Correct key logs in and redirects to /; pgdp_session cookie is httpOnly.
  d. window.__ENV__ does NOT contain the API key.
  e. Reload keeps the session (no bounce to /login).
  f. Logout via API clears the cookie; subsequent /api/auth/me returns 401.
  g. Bearer-header fallback still works for non-browser callers.

The ``apikey_live_server`` session fixture (defined in conftest.py) boots the
FastAPI app with ``auth_mode="apikey"`` and the test API key ``test-key-xyzzy``.

Note on scenario (f): the UserMenu only shows a "Sign out" item in jwt mode, not
in apikey mode (by design — the UI in apikey mode shows an "apikey mode" badge
only).  We therefore test logout via a direct ``page.request`` call to
``POST /api/auth/session/logout``, which is how the ``logout()`` client function
works internally.  This tests the same browser-context credential path as the UI
would, using Playwright's built-in credential/cookie isolation.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from playwright.sync_api import Page, expect

if TYPE_CHECKING:
    from .conftest import LiveServer

# ── Helpers ──────────────────────────────────────────────────────────────────


def _login(page: Page, base_url: str, api_key: str) -> None:
    """Navigate to /login, fill the key, and submit."""
    page.goto(f"{base_url}/login")
    # The form has a password input with placeholder "API key".
    page.get_by_placeholder("API key").fill(api_key)
    page.get_by_role("button", name="Sign in").click()


# ── Tests ─────────────────────────────────────────────────────────────────────


def test_login_form_renders_in_apikey_mode(apikey_live_server: LiveServer, page: Page) -> None:
    """(a) /login shows the apikey form — not an OIDC spinner."""
    page.goto(f"{apikey_live_server.base_url}/login")

    # The password input with placeholder "API key" must be visible.
    expect(page.get_by_placeholder("API key")).to_be_visible()

    # The submit button must be visible.
    expect(page.get_by_role("button", name="Sign in")).to_be_visible()

    # No "Redirecting to your identity provider" text (that's the JWT spinner).
    expect(page.get_by_text("Redirecting to your identity provider")).not_to_be_visible()


def test_wrong_key_shows_error_stays_on_login(apikey_live_server: LiveServer, page: Page) -> None:
    """(b) Wrong key → error message visible; URL stays /login; no session cookie."""
    page.goto(f"{apikey_live_server.base_url}/login")
    page.get_by_placeholder("API key").fill("wrong-key")
    page.get_by_role("button", name="Sign in").click()

    # An error message must appear.
    expect(page.get_by_text("Login failed", exact=False)).to_be_visible(timeout=5_000)

    # URL must still be /login.
    assert "/login" in page.url, f"Expected /login in URL, got: {page.url}"

    # No session cookie must have been set.
    cookies = page.context.cookies()
    session_cookies = [c for c in cookies if c["name"] == "pgdp_session"]
    assert not session_cookies, f"Expected no session cookie after wrong key; got: {session_cookies}"


def test_correct_key_logs_in_and_sets_cookie(apikey_live_server: LiveServer, page: Page) -> None:
    """(c) Correct key → redirect to /; pgdp_session cookie is httpOnly."""
    _login(page, apikey_live_server.base_url, "test-key-xyzzy")

    # Must redirect to /.
    page.wait_for_url(f"{apikey_live_server.base_url}/", timeout=10_000)

    # The pgdp_session cookie must exist and be httpOnly.
    cookies = page.context.cookies()
    session_cookies = [c for c in cookies if c["name"] == "pgdp_session"]
    assert session_cookies, "Expected pgdp_session cookie after successful login"
    cookie = session_cookies[0]
    assert cookie.get("httpOnly") is True, f"Expected httpOnly=True on pgdp_session, got: {cookie}"
    # sameSite is returned as a string by Playwright ("Strict" / "Lax" / "None").
    same_site = cookie.get("sameSite", "")
    assert same_site.lower() == "strict", f"Expected sameSite=Strict on pgdp_session, got: {same_site!r}"


def test_env_js_does_not_expose_api_key(apikey_live_server: LiveServer, page: Page) -> None:
    """(d) window.__ENV__ on / must not contain the API key value."""
    # Ensure we're logged in first (cookie-based auth).
    _login(page, apikey_live_server.base_url, "test-key-xyzzy")
    page.wait_for_url(f"{apikey_live_server.base_url}/", timeout=10_000)

    env_json: str = page.evaluate("JSON.stringify(window.__ENV__ ?? {})")
    assert "test-key-xyzzy" not in env_json, f"API key leaked in window.__ENV__: {env_json}"
    assert "API_TOKEN" not in env_json, f"Unexpected API_TOKEN key in window.__ENV__: {env_json}"


def test_reload_keeps_session(apikey_live_server: LiveServer, page: Page) -> None:
    """(e) After login, reloading the page stays authenticated (not bounced to /login)."""
    _login(page, apikey_live_server.base_url, "test-key-xyzzy")
    page.wait_for_url(f"{apikey_live_server.base_url}/", timeout=10_000)

    page.reload()
    # Must still be on /, not /login.
    assert page.url.rstrip("/") == apikey_live_server.base_url.rstrip("/"), (
        f"Expected to stay on /, got: {page.url}"
    )

    # An authenticated API call via page.request (same browser context) must succeed.
    resp = page.request.get(f"{apikey_live_server.base_url}/api/auth/me")
    assert resp.status == 200, f"/api/auth/me returned {resp.status} after reload"
    body = resp.json()
    assert body.get("user_id") == "default", f"Unexpected user_id: {body}"


def test_logout_clears_cookie_and_rejects_auth(apikey_live_server: LiveServer, page: Page) -> None:
    """(f) Logging out via POST /api/auth/session/logout clears the cookie;
    subsequent /api/auth/me returns 401.

    The UserMenu does not show a Sign-out item in apikey mode (only jwt mode has
    that), so we exercise the logout endpoint directly via page.request — this
    uses the same browser context and cookie jar as the UI would.
    """
    _login(page, apikey_live_server.base_url, "test-key-xyzzy")
    page.wait_for_url(f"{apikey_live_server.base_url}/", timeout=10_000)

    # Confirm authenticated before logout.
    pre_resp = page.request.get(f"{apikey_live_server.base_url}/api/auth/me")
    assert pre_resp.status == 200, f"Expected 200 before logout, got {pre_resp.status}"

    # Call the logout endpoint via the browser context (carries the session cookie).
    logout_resp = page.request.post(f"{apikey_live_server.base_url}/api/auth/session/logout")
    assert logout_resp.status == 200, f"Expected 200 from logout endpoint, got {logout_resp.status}"

    # pgdp_session cookie must be absent or empty after logout.
    cookies = page.context.cookies()
    session_cookies = [c for c in cookies if c["name"] == "pgdp_session" and c.get("value")]
    assert not session_cookies, f"Expected no active pgdp_session cookie after logout; got: {session_cookies}"

    # Subsequent /api/auth/me must return 401.
    post_resp = page.request.get(f"{apikey_live_server.base_url}/api/auth/me")
    assert post_resp.status == 401, f"Expected 401 after logout, got {post_resp.status}"


def test_bearer_header_fallback_for_scripts(apikey_live_server: LiveServer, page: Page) -> None:
    """(g) Non-browser callers can still authenticate with Authorization: Bearer.

    Scripts and CI that pass the bearer key directly must continue to work —
    the session-cookie mechanism is additive, not a replacement.
    """
    # Use a fresh context with no cookies so only the Bearer header is in play.
    resp = page.request.get(
        f"{apikey_live_server.base_url}/api/auth/me",
        headers={"Authorization": "Bearer test-key-xyzzy"},
    )
    assert resp.status == 200, f"Expected 200 with Bearer header, got {resp.status}"
    body = resp.json()
    assert body.get("user_id") == "default", f"Unexpected user_id in Bearer response: {body}"
