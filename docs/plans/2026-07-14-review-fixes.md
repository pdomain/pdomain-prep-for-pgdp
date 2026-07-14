---
Status: draft
Owner: CT
Created: 2026-07-14
Last verified: 2026-07-14
Kind: plan
---

# Confirmed Bug Fixes — pdomain-prep-for-pgdp (2026-07-14)

## Agent Index

- **Kind:** plan
- **Status:** draft
- **Read when:** executing or reviewing the 2026-07-14 cross-repo review fixes
  ported from pdomain-ocr-simple-gui.
- **Search terms:** suite auth, app_id unknown mount, device resolver, job
  timeout, zip off-loop, rerun enqueue, AppShell token, pin bump.

## Goal

Fix nine confirmed bugs in `pdomain-prep-for-pgdp` without building any unfinished features. Each task is TDD-first (failing test committed before the implementation), verified with `make ci AI=1`, and scoped to avoid unnecessary collisions with parallel work in the same files.

Explicitly out of scope (file a tracking issue instead of "fixing"): `OcrTool.tsx` engine/backend selectors (decorative pending I1 — `frontend/src/pages/pipeline/tools/OcrTool.tsx:7,827,835,1037`), no-op export/settings handlers marked "wired at I1" (`frontend/src/pages/pipeline/tools/TextZonesTool.tsx:11`), and `HyphenJoinTool`'s mock-only `scanHyphenation` (`frontend/src/pages/pipeline/tools/HyphenJoinTool.tsx:13`). These are unfinished-feature markers, not regressions.

## Architecture

This app enforces auth **per-route** via `UserDep` (`api/dependencies.py:130` `get_user`), not global middleware — unlike the sister app `pdomain-ocr-simple-gui`, which protects `/api/suite/*` with a `BaseHTTPMiddleware`. We must adapt, not port: attach `get_user` as a dependency object to the specific mutating suite `APIRoute`s via `route.dependant.dependencies`, using `fastapi.dependencies.utils.get_parameterless_sub_dependant`. This is safe because `APIRoute.get_route_handler()` closes over the same `Dependant` object reference; appending to its `.dependencies` list before the first request is served changes behavior on every subsequent request. Verified against this repo's installed FastAPI.

The sister app already fixed its own "unknown app_id" and "device pref not resolved" bugs with a `_build_suite_app()` + `_migrate_unknown_app_prefs()` + device-resolver pattern reading a bundled `pdomain-suite.json`. This repo ships an equivalent fragment: `src/pdomain_prep_for_pgdp/pdomain-suite.json` (`app_id: "pdomain-prep-for-pgdp"`). This repo has no lifespan-managed `_prefs_adapter` singleton, and `AppWideStageSettings` already talks to the same default-rooted `LocalFilePrefs()`, so `SuiteAdapters.local()`'s default is already the single shared store (isolated per-test via the autouse `isolate_suite_data_dir` fixture in `tests/conftest.py:64-77`).

Job dispatch runs through `InProcessJobRunner` (`core/job_runner.py`), not `LocalStageDispatcher` — jobs are DB-backed rows polled by `run_pending`/`_run_one`. Device threading and the timeout fix must work within that model: resolve the device once at enqueue time in the API route, write it into `Job.payload["device"]`, and let the existing `payload.get("device", "cpu")` reads pick it up unchanged.

## Tech Stack

- Backend: FastAPI + Python 3.13, `uv run pytest` / `make test AI=1` (never bare `pytest`/`python`).
- Frontend: React 19 + Vite + TS, Vitest + MSW (`make frontend-test`).
- `pdomain-ops` supplies `mount_routes`, `SuiteAdapters`, `InstalledApp`, `LocalFilePrefs`, `resolve_effective_device`.
- Gate: `make ci AI=1` before any commit (`Makefile:315`).
- Docs: docgraph-governed (`DOCGRAPH.md`); reindex/check after doc edits.

## Global Constraints

- Run `make ci AI=1` before every commit; never bare `pytest`/`python -m pytest` — always `uv run pytest` or `make test AI=1`.
- TDD-first: failing test committed before implementation (docs/pin tasks exempt).
- Work in isolated worktrees; nothing is pushed without explicit human approval.
- Backend tasks 1, 2, 4 all edit `bootstrap.py`; 3, 4 edit `core/job_runner.py`; 3, 6 edit `api/data/project_stages.py`; Task 6 depends on Task 3's `resolve_job_device` helper — run the backend-core tasks (1→2→3→4→6) sequentially in one worktree. Task 5 (`core/ingest.py`), Task 7 (frontend), Task 8 (docs), Task 9 (pin) are independent.
- After editing any doc, reindex docgraph and check same-turn.

## Task grouping / sequencing

1. **Group A — `bootstrap.py`**: Task 1 (auth) then Task 2 (app_id + migration) — same post-mount block, sequential.
2. **Group B — `core/job_runner.py`**: Task 3 (device threading) then Task 4 (timeout).
3. **Group C — independent files**: Task 5 (`core/ingest.py`), Task 6 (`api/data/project_stages.py`), Task 7 (frontend `App.tsx`).
4. **Group D — housekeeping**: Task 8 (docs), Task 9 (pin bump).

## Task 1 — Require auth on mutating /api/suite/* routes

**RED-TEAM CORRECTION (critical):** the original per-route `route.dependant.dependencies` approach does NOT work here. This repo's FastAPI (0.139.0) wraps `mount_routes`' included sub-router in an opaque `_IncludedRouter` that never appears in `app.routes` as `APIRoute`, so a loop over `app.routes` only reaches the directly-mounted `device`/`update` routes and silently MISSES `PUT /api/suite/prefs/common`, `PUT /api/suite/prefs/apps/{app_id}`, and `POST /api/suite/launch` (reproduced live: `PUT /api/suite/prefs/common` returned 204 with no token). Use a **middleware** instead — version-robust, no dependency on route topology.

`bootstrap.py:315` `mount_routes(app, SuiteAdapters.local())` gives no auth. Mutating routes reachable with zero credentials in apikey/jwt mode: `PUT /api/suite/device`, `PUT /api/suite/prefs/common`, `PUT /api/suite/prefs/apps/{app_id}`, `POST /api/suite/launch`, `POST /api/suite/update`. GET routes and `/healthz` stay open (matches `tests/test_healthz.py:58`).

**Implementation:** add a `BaseHTTPMiddleware` (or `@app.middleware("http")`) that, for requests whose method is in `{POST,PUT,PATCH,DELETE}` AND whose path starts with `/api/suite/`, runs the SAME auth check `get_user` does — reusing `request.app.state.auth` (set at `bootstrap.py:274`, an `IAuth` with `async verify(credentials: str | None) -> UserContext` that raises `HTTPException(401)` on bad/missing creds and returns a default `UserContext()` in none mode without raising). Mirror `get_user`'s apikey-cookie-first logic (`api/dependencies.py:102-127`): in apikey mode check `request.cookies.get(COOKIE_NAME)` via `verify_cookie_value(...)` first; else extract the Bearer token from the `Authorization` header and `await app.state.auth.verify(token)`. On `HTTPException` return a `JSONResponse(status_code=exc.status_code, ...)`; otherwise call `next`. Register it AFTER `app.state.auth` is set. Because none-mode `verify` never raises, existing `tests/test_suite_routes.py` (none mode) stay green.

Test first in `tests/test_suite_routes_auth.py` — parametrize all five mutating paths in apikey mode: 401 without token, 200/204 with `Authorization: Bearer <key>`; plus `GET /api/suite/installed` → 200 without token (GETs stay open). This test guards the exact routes the broken approach missed. TDD, then `make ci AI=1`. Commit: `fix(auth): require auth on mutating suite routes`.

## Task 2 — Mount suite routes under the real app_id + migration

`bootstrap.py:315` omits `suite_app=`, so device/prefs persist under `apps["unknown"]`. Add `_build_suite_app()` (reads bundled `pdomain-suite.json` + `sys.executable` + `importlib.metadata.version`) and `_migrate_unknown_app_prefs()` (clears `compute_device` from `apps["unknown"]`, copying to the real app_id if the real key is empty — PrefsAdapter has no delete, so clear the value). Mount: `mount_routes(app, adapters, suite_app=_build_suite_app())`. Test first in `tests/test_bootstrap_suite_app.py`. Commit: `fix(suite): mount routes with real app id and migrate stray prefs`.

## Task 3 — Thread resolved device into job payloads

OCR always runs cpu: `api/data/project_stages.py:543` hardcodes `device="cpu"`; enqueue paths never set `payload["device"]`. Add `core/device_resolution.py::resolve_job_device()` (wraps `resolve_effective_device(LocalFilePrefs(), "pdomain-prep-for-pgdp")`, falls back to `pick_device()`). Set `payload["device"]=resolve_job_device()` at the enqueue sites (`project_stages.py:461,543`, `pages.py:1646-1661`) and pass `device=` to the sync `run_stage` call (`pages.py:1675-1688`). Test first in `tests/test_device_resolution.py` + a route test asserting `payload["device"]=="cuda"` when the app pref is set. Commit: `feat(compute): resolve device preference into job payloads`.

## Task 4 — Configurable job-handler timeout

`core/job_runner.py:259-263` `_run_one()` awaits the handler inside `async with sem:` with no `asyncio.wait_for` — a hung handler wedges the job and holds a slot. Add `Settings.job_handler_timeout_seconds: float | None = 900.0` (env `PGDP_JOB_HANDLER_TIMEOUT_SECONDS`), a constructor arg on `InProcessJobRunner`, and wrap the dispatch in `asyncio.wait_for`; on `TimeoutError` mark the job failed and return (releasing the slot). Document the honest limitation: cancelling the await does not kill an underlying `anyio.to_thread` OS thread. Test first in `tests/test_job_runner_timeout.py`. Commit: `fix(jobs): bound job handlers with a configurable timeout`.

## Task 5 — Move zip decompression off the event loop

`core/ingest.py:414-470` `_enumerate_zip` is async but does blocking `zipfile`/`zf.read()` inline (the size-cap `_check_zip_limits` is already good — keep it). Split: a sync `_read_zip_entries(raw)` helper dispatched via `anyio.to_thread.run_sync`, then the stem-collision bookkeeping + async `storage.put_bytes` back on the loop. Test first in `tests/test_ingest_zip_thread_offload.py` (spy on `anyio.to_thread.run_sync`). Existing ingest tests are the regression gate. Commit: `fix(ingest): decompress zips off the event loop`.

## Task 6 — Fix rerun_project_stage_pages to actually enqueue jobs

`api/data/project_stages.py:1468-1516` `rerun_project_stage_pages` marks pages dirty but never calls `db.put_job` despite its docstring — the rerun UI action silently no-ops. Enqueue one `Job(type=JobType.run_page_stage, payload={project_id, page_id, stage_id, data_root, device})` per page, mirroring the async route at `pages.py:1646-1661`, threading `resolve_job_device()`. Test first: extend `tests/test_w4_aggregates.py::TestBatchedRerunRoute` asserting N run_page_stage jobs enqueued. Commit: `fix(rerun): enqueue run_page_stage jobs for batched rerun`.

## Task 7 — Route AppShell suite calls through the authenticated client

`frontend/src/App.tsx:91,131,158,199,210` use raw `fetch()` with no `Authorization` for `/api/suite/*`; once Task 1 lands these 401 under apikey/jwt. Replace with `api.get/put/post` (already imported, attaches Bearer via `getAuthToken()` + `credentials:"include"`; `api.post(path, undefined, {query})` is the bodyless-with-query form). Drop the redundant `res.ok`/`res.json()` (the client throws on non-2xx, caught by the existing fallbacks).

**RED-TEAM NOTE:** the current `App.test.tsx` mocks (`:21-72`) stub `AppShell`/`SuiteSiblingsProvider` as pure pass-throughs that never invoke `uiPrefsConfig.load`/`fetchInstalled`/`postLaunch`, so those five functions are unreachable from a mounted `<App/>` and an MSW spy has nothing to intercept. The test task MUST first extend those mocks (e.g. the `AppShell` mock calls `uiPrefsConfig.load()` in a `useEffect`; expose the sibling `value.fetchInstalled`/`postLaunch` so the test can invoke them) — otherwise the assertion can never fire. `getAuthToken()` reads `localStorage.getItem("pgdp.api_token")`; default test auth mode is none, which does NOT null the token, so a Bearer assertion is reachable once the mocks are fixed. Commit: `fix(frontend): authenticate AppShell suite calls`.

## Task 8 — Correct stale frontend architecture doc

`docs/architecture/04-frontend.md` (marked built/verified 2026-07-14) documents routes/components that no longer exist (ProjectConfigurePage, PageWorkbenchPage, TextReviewPage, CropsGridPage, ProjectReviewQueuePage, ProjectListPage) — consolidated into PipelinePage + tool tabs — and an "auth-token-always" claim contradicting the apikey cookie path. Rewrite the Pages table against `App.tsx:385-430` and the auth section against all three modes; bump `Last verified`. Reindex docgraph + check. Commit: `docs(frontend): re-verify routes and auth against code`.

## Task 9 — Bump pdomain-ops pin

`pyproject.toml:17` pins `pdomain-ops>=0.11.0`; 0.11.1 (device-display fix) is released. Prefer `make update-pdomain-deps`; if it pulls unrelated sibling bumps, split them — this task is scoped to the `pdomain-ops` pin. `uv lock`, `make ci AI=1`. Commit: `chore: require pdomain-ops>=0.11.1`.

## Cross-cutting verification

Run each group's focused tests, then `make ci AI=1` as the final gate before every commit. Nothing is pushed.
