---
Status: active
Owner: CT
Created: 2026-07-21
Last verified: 2026-07-21
Kind: issue
Level: I1
---

# Session cookie `secure=False` and CORS `allow_origins=["*"]` (W3.7)

## Agent Index

- **Kind:** issue
- **Status:** active
- **Level:** I1
- **Last verified:** 2026-07-21
- **Resolution:** Open
- **Severity:** Medium — unsafe defaults if self-hosted beyond localhost HTTP
- **Affected version:** pdomain-prep-for-pgdp (main @ 2026-07-21)
- **Read when:** hardening self-host / HTTPS deploy, apikey session cookies, or Wave 3 ops.
- **Search terms:** secure=False, CORS, allow_origins, session cookie, SameSite, apikey, W3.7
- **Relates to:** [pipeline completion review](../plans/2026-07-21-pipeline-completion-review.md)

## Summary

Apikey-mode session cookies are issued with `secure=False` (hardcoded TODO for
prod). CORS middleware allows all origins, methods, and headers. Acceptable
for local `make run` on HTTP; unsafe defaults for non-local HTTPS or any
deployment where a browser on another origin can call the API with credentials
semantics that operators may misconfigure later.

## Impact

- Session cookie can be sent over plain HTTP if the app is exposed beyond loopback.
- Wildcard CORS is a footgun when auth_mode moves past `none` on a shared host.
- Self-host checklist incomplete without secure cookie + origin allowlist knobs.

## Environment / versions

```
auth session: src/pdomain_prep_for_pgdp/api/auth/session.py
CORS: src/pdomain_prep_for_pgdp/bootstrap.py CORSMiddleware
settings: session_secret, api_key, auth_mode
local default: auth_mode none / apikey on HTTP :8765
```

## Evidence

### 1. Cookie flags

```
# api/auth/session.py ~40–46
response.set_cookie(
    key=COOKIE_NAME,
    value=value,
    httponly=True,
    samesite="strict",
    secure=False,  # False in dev (HTTP); TODO: set True in prod via config
)
```

`httponly` + `samesite=strict` are good; `secure` is never config-driven.

### 2. CORS wildcard

```
# bootstrap.py ~311–316
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
```

No settings field for an allowlist; same stack for all modes.

### 3. Parent plan

§Adapter / ops risks: “CORS `*`; session cookie `secure=False`.”
W3.7 done-when: “Cookie `secure` + CORS allowlist for non-local modes;
Self-host checklist.”

## Root-cause hypotheses

1. **(Most likely) Local-first defaults never gated** — correct for laptop
   HTTP; no `Settings` switch when `auth_mode` or public URL implies TLS.
2. **Credentialed CORS subtlety** — browsers disallow `*` with credentials;
   risk is still misconfiguration and non-browser clients, plus future
   `allow_credentials=True` mistakes.

## Defects to fix

1. **Config-driven cookie `secure`** (default False local; True when HTTPS /
   non-local flag). (Primary)
2. **CORS allowlist setting** for non-local modes (keep `*` only for explicit
   local/dev).
3. **Self-host checklist** documenting both knobs + apikey cookie path.

## Next steps

1. Add `Settings` fields (e.g. `session_cookie_secure`, `cors_allow_origins`).
2. Wire session.py + bootstrap CORS from settings; test matrix none/apikey.
3. Document in deployment / self-host runbook.

## What is NOT broken

- Local `auth_mode=none` development without cookies.
- Cookie HMAC signing and apikey-cookie-first verify path in `get_user`.
- SameSite=strict already set on issue.

## Resolution

*Open.* When fixed: set frontmatter + Agent Index `Status: retired`, link
settings + checklist commit, route retirement through `doc-retirer`.
