---
Status: active
Owner: CT
Created: 2026-11-09
Last verified: 2026-11-13
Kind: issue
Level: I2
---

# SSE event streams cannot authenticate in JWT mode

## Agent Index

- **Kind:** issue
- **Status:** active
- **Level:** I2
- **Last verified:** 2026-11-13
- **Resolution:** Open
- **Severity:** Medium — in JWT mode, progress and stage event streams fail with 401 and reconnect
- **Affected version:** pdomain-prep-for-pgdp master @ `14f0ba8`
- **Read when:** working on SSE hooks, `EventSource`, JWT auth mode, or event-stream authentication.
- **Search terms:** EventSource, SSE, Authorization header, bearer token, jwt mode, session cookie,
  useStageEvents, services/sse.ts, former GH #135
- **Relates to:** [Cookie secure + CORS allowlist (W3.7)](../architecture/06-deployment.md)

## Summary

The browser's native `EventSource` cannot send an `Authorization` header. The app's event streams depend on
`get_user`, which accepts a bearer token or, in apikey mode only, the httpOnly session cookie. Apikey mode now
works because commit `e0b83cf` added that cookie, and `EventSource` sends it on same-origin requests. JWT mode
has no cookie path, so its streams still cannot authenticate. Migrated from GitHub issue #135, which came from
the 2026-05-22 deep code review; this report narrows it to what is still broken.

## Impact

- JWT mode only. Each `EventSource` gets 401 and reconnects, so live progress and stage status never arrive.
- `none` and `apikey` modes are not affected.
- JWT mode belongs to managed deployment, which is deferred, so no current local user hits this.

## Environment / versions

```
frontend/src/services/sse.ts              new EventSource(url, { withCredentials: true }) ×3
frontend/src/hooks/useStageEvents.ts      new EventSource(url)
src/pdomain_prep_for_pgdp/api/dependencies.py  resolve_user_context: apikey cookie first, then bearer
src/pdomain_prep_for_pgdp/api/gpu/jobs.py      GET /jobs/{job_id}/events
```

## Evidence

### 1. What changed since the GitHub issue — checked 2026-11-09

- `frontend/src/hooks/useJobProgress.ts`, cited by the original issue, no longer exists. Streams now open in
  `services/sse.ts` and `hooks/useStageEvents.ts`.
- Commit `e0b83cf` (`fix(security-125-proxy): server-side session cookie for apikey-mode auth`) added the
  `pgdp_session` cookie. `resolve_user_context()` checks it first in apikey mode.

### 2. JWT mode has only the bearer path

```python
# api/dependencies.py resolve_user_context
if settings.auth_mode == "apikey":
    cookie_val = request.cookies.get(COOKIE_NAME)
    ...
return await auth.verify(bearer_token)
```

In JWT mode the request reaches `auth.verify()` with no bearer, because `EventSource` cannot set the header.

### 3. No tests cover streams under JWT

No test opens an event stream with `auth_mode="jwt"`.

## Root-cause hypotheses

1. **(Most likely) The cookie fix was scoped to apikey mode.** Issue #125 needed a server-side credential for
   apikey mode, and JWT streams were left for managed mode.

## Defects to fix

1. **Give event streams a JWT-compatible credential.** Options: fetch-based SSE parsing that sends the bearer,
   a cookie issued after JWT login, or short-lived signed stream URLs. (Primary)
2. **Add auth-mode tests** for the job and stage event streams in apikey and JWT modes.

## Next steps

1. Pick the credential approach when managed mode is scheduled.
2. Until then, keep this report open as the record that JWT streams do not work.

## What is NOT broken

- Event streams in `none` and `apikey` modes.
- Regular REST calls in JWT mode, which send the bearer through `frontend/src/api/client.ts`.

## Resolution

_Open._ When fixed: set frontmatter and Agent Index `Status: retired`, add the resolving commit here, and
route the retirement through `doc-retirer`.
