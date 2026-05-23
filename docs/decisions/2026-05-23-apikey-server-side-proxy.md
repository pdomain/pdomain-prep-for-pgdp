# Decision: server-side proxy for apikey-mode auth (#125)

Date: 2026-05-23
Status: decided

## Threat model

Before commit `a27f62c`, `/env.js` emitted the upstream bearer token
(`PGDP_API_KEY`) in its unauthenticated JSON payload.  Any visitor —
including cross-origin pages that include the script tag — could read
`window.__ENV__.API_TOKEN` and replay calls against any endpoint.
The fix stripped the token from `/env.js`, intentionally breaking
apikey-mode browser auth as a safe interim state.

## Chosen mechanism

**Session cookie issued by a lightweight login endpoint.**

1. `POST /api/auth/session` accepts `{"api_key": "…"}` in JSON.
   The server compares the submitted key to `PGDP_API_KEY` via
   `hmac.compare_digest` (constant-time).  On match it sets a
   **httpOnly, SameSite=Strict** cookie `pgdp_session` whose value
   is a stdlib HMAC-SHA256 MAC over a timestamp+nonce payload,
   signed with `PGDP_SESSION_SECRET`.

2. `POST /api/auth/session/logout` expires the cookie.

3. The `get_user` FastAPI dependency is extended: in apikey mode it
   first checks the `pgdp_session` cookie; if absent or invalid it
   falls back to the Bearer header (unchanged for non-browser callers
   such as scripts or CI).

4. The browser client (`frontend/src/api/client.ts`) gains
   `loginWithApiKey(key)` and `logout()` helpers.  All `fetch` calls
   gain `credentials: "include"` so the cookie is sent automatically;
   the client no longer attaches a `Bearer` header in apikey mode.

### Why HMAC-SHA256 over `itsdangerous` / Starlette sessions

`itsdangerous` is not installed and adding it as a hard dependency
for a single SHA256 MAC is excessive.  The cookie value is not a
general-purpose session store — it carries only a signed timestamp
and a random nonce; all auth state lives server-side in the validated
cookie check.  stdlib `hmac` + `hashlib` is sufficient and has no
extra transitive risk surface.

### Why not JWT for the session token

`pyjwt[crypto]` is listed in `pyproject.toml` but not installed in
the current venv.  Signed cookies via stdlib HMAC are simpler,
equally secure for this use-case, and require no new install-time
dependency.

## Endpoints affected

| Endpoint | Change |
|---|---|
| `POST /api/auth/session` | NEW — login, sets httpOnly cookie |
| `POST /api/auth/session/logout` | NEW — logout, clears cookie |
| All protected routes | `get_user` dependency now accepts cookie OR Bearer |

## Frontend changes

- `credentials: "include"` added to all `fetch` calls (needed for
  the cookie to be sent cross-origin in dev-proxy mode).
- `loginWithApiKey(key)` POSTs to `/api/auth/session`.
- `logout()` POSTs to `/api/auth/session/logout`.
- `getAuthToken()` is no longer called in apikey mode (the cookie
  carries auth implicitly).

## Backward-compat: none / oidc modes

- `none` mode: `get_user` returns `UserContext()` immediately; cookie
  check is skipped entirely.
- `jwt` / oidc mode: `get_user` checks Bearer header only; cookie
  check is skipped entirely.  No regression.
- Non-browser apikey callers (scripts, CI) can still present
  `Authorization: Bearer <key>` directly; the Bearer fallback path
  in `get_user` handles them unchanged.

## Deferred followups

- CSRF protection (double-submit or `Origin` check) — current
  SameSite=Strict mitigates same-site attack surface on modern
  browsers but does not cover all cross-origin edge cases.
- Session rotation / expiry — the cookie is currently session-scoped
  (no `Max-Age`); add explicit TTL + server-side revocation list
  if multi-tenant is ever enabled.
- CORS hardening — restrict `allow_origins` from `["*"]` to
  configured trusted origins (separate issue).
- Observability — log failed login attempts.
