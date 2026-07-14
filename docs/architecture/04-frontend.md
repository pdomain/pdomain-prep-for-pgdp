# 04 — Frontend

## Agent Index

- **Kind:** architecture
- **Status:** built
- **Last verified:** 2026-07-14
- **Read when:** changing the React application or its API contract.
- **Search terms:** frontend, React, routes, XState, OpenAPI.

## Stack

- React 19 + Vite + TypeScript (`frontend/`).
- TanStack Query v5 for server state.
- react-konva 19, used by the word-bbox marquee-select overlay
  (`WordBboxOverlay`, `lib/marquee.ts`) inside the text-review tool tab.
- react-router v7 for routing.
- Tailwind for styling.
- `frontend/src/api/client.ts` is a thin typed `fetch` wrapper. Its auth
  behavior differs by `__ENV__.AUTH_MODE` — see "Auth in the SPA" below;
  it does not always attach a Bearer token.
- `frontend/src/api/types.ts` is regenerated from `/openapi.json` via
  `make openapi-export` (`openapi-typescript`). The committed `openapi.json`
  at repo root is the contract source; `tests/test_openapi_spec_committed.py`
  guards it against drift.

## Pages

The former per-page routes (`ProjectConfigurePage`, `PageWorkbenchPage`,
`TextReviewPage`, `CropsGridPage`, `ProjectReviewQueuePage`, `ProjectListPage`)
are gone — the design-handoff statechart work (F3/F4/F5) consolidated
per-page review and per-stage editing into a single `/projects/:id/pipeline`
route (`PipelinePage`) with a stage strip and per-stage **tool tabs**. Each
stage's UI is a `ToolSlotComponent` registered by `stageId` in
`TOOL_REGISTRY` (`frontend/src/pages/pipeline/toolSlot.tsx`) — e.g.
`SourceTool`, `GrayscaleTool`, `PagesGridTool`, `ImageStageReviewTool`,
`TextZonesTool`, `OcrTool`, `PageOrderTool`, `CanvasMapTool`,
`IllustrationsTool`, `WordcheckTool`, `HyphenJoinTool`, `TextReviewTool`,
`RegexTool`, `ValidationTool`, `ProofPackTool`, `BuildPackageTool`,
`ZipTool`, `SubmitCheckTool`, `ArchiveTool` — `resolveToolSlot(stageId)`
falls back to a visible placeholder for any unregistered stage. This table
is verified against the `<Routes>` block in `App.tsx` (currently
`App.tsx:367-416`); all routes except `/projects/:projectId/pipeline` are
wrapped in `CenteredLayout`, which the pipeline route skips to run
full-bleed.

| Path | Component | What it does |
|---|---|---|
| `/login` | `LoginPage` | Renders one of two flows by `__ENV__.AUTH_MODE`. **jwt:** OIDC PKCE — generates a verifier + S256 challenge, redirects to `${JWT_ISSUER}/authorize`, handles the callback (`?code=&state=`), exchanges the code at `${JWT_ISSUER}/token`, calls `setAuthToken(...)`, navigates back. **apikey:** a plain API-key input form; submit calls `loginWithApiKey()`, which `POST`s to `/api/auth/session` and relies on the server-set httpOnly session cookie (the raw key never touches `localStorage`). |
| `/` | `ProjectsPage` | F3 projects surface: 320px left rail (project list, Active/Archived tabs, search + sort) driving a `projectDetail` XState machine for the right pane (activity / attributes / manage tabs). Create-project flow (ported from the retired `ProjectListPage`) lives here: POST project → XHR PUT zip → POST ingest → poll job → navigate. |
| `/jobs` | `JobsPage` | Jobs list with a filter `ToggleGroup` (All / Running / Queued / Done / Errored / Awaiting review), auto-refreshing every 5s via `useQuery({ refetchInterval: 5000 })`. Each row: type + id, progress bar, status badge, logs button, and a "more" menu (copy job ID, cancel, retry). |
| `/projects/:projectId/import` | `PostImportPage` | Post-import surface driven by the `postImport` machine, covering two scenarios: **Pa** (redirected) — index was fast, so the user lands on the new project's pipeline view while thumbnails generate; **Pb** (anchored) — index was slow, so the user stays on the projects list with a `JobsDrawer` overlay tracking import progress. |
| `/projects/:projectId` | — | `<Navigate to="pipeline" replace />` — redirects to the pipeline route; not a rendered page. |
| `/projects/:projectId/pipeline` | `PipelinePage` | F4 pipeline shell (full-bleed, no `CenteredLayout`). Orchestrated by `pipelineShellMachine`, whose `runners` array holds one stageRunner actor per stage; the stage strip renders dots as projections of runner snapshots. Renders the stage strip + tabs + the resolved tool slot for the active stage, or swaps in a `ProjectSettings` panel when in settings mode. Accepts an optional `?stage=<stageId>` query param. |
| `/settings` | `SettingsPage` | Full SystemDefaults editor (image processing, OCR, layout, scannos, hyphenation). Save / Export / Import / Reset buttons. |

## Auth in the SPA

`__ENV__.AUTH_MODE` (injected by `env.js` at runtime) selects one of three
modes. Requests do **not** always carry a Bearer token — only jwt mode does.
Verified against `frontend/src/api/client.ts` and `App.tsx`.

**`none` mode** — no auth at all. `getAuthToken()` still checks
`localStorage`/`__ENV__.API_TOKEN` as a fallback (see jwt mode below) but
nothing sets those in none mode, so requests carry neither a cookie nor a
header. `UserMenu` renders `null`.

**`apikey` mode** — httpOnly session cookie, no token ever touches JS:

- `loginWithApiKey(key)` (`LoginPage`'s apikey form) `POST`s `{ api_key }`
  to `/api/auth/session` with `credentials: "include"`; the server responds
  with an httpOnly `SameSite=Strict` session cookie.
- `getAuthToken()` returns `null` **by design** whenever `AUTH_MODE ===
  "apikey"` — the code comment is explicit: "the bearer is never exposed to
  JS." So the `Authorization` header is never set in this mode.
- Every `request()` call sets `credentials: "include"` unconditionally,
  which is what actually carries the session — the browser attaches the
  httpOnly cookie automatically; the app never reads or stores it.
- `logout()` calls `POST /api/auth/session/logout` (`credentials:
  "include"`) to clear the cookie server-side.

**`jwt` mode** — Bearer token, no cookie dependency:

- `LoginPage` runs the OIDC PKCE flow (see the Pages table) and calls
  `setAuthToken(token)`, which writes `localStorage["pgdp.api_token"]`.
- `getAuthToken()` reads that key first, then falls back to
  `__ENV__.API_TOKEN`.
- `request()` adds `Authorization: Bearer <token>` whenever `getAuthToken()`
  returns non-null — in practice this only fires in jwt mode, since apikey
  mode forces `null` and none mode has nothing populating the token.
- `request()` still sets `credentials: "include"` (harmless in this mode —
  there is no session cookie to send).

`App.tsx` mounts an `AuthGuard` that is a no-op outside jwt mode:

- Eagerly redirects to `/login` if there's no token and the current path
  isn't `/login` (checked via `env.AUTH_MODE !== "jwt"` guard).
- Subscribes to the TanStack QueryCache; any cached query that 401s
  triggers a redirect to `/login`.

`UserMenu` (`frontend/src/components/shell/UserMenu.tsx`, replacing the
former `AuthBadge`/`ProfileDropdown` split) in the header:

- In `none` mode, renders `null`.
- In `apikey` and `jwt` modes, fetches `/api/auth/me` and shows `user_id`.
- In `apikey` mode, shows an "apikey mode" badge with no sign-out action.
- In `jwt` mode, adds a "Sign out" item that calls `logout()`, clears the
  stored token, calls `queryClient.clear()`, and navigates to `/login`.

## Workbench canvas — superseded

**Stale — flagged, not fully re-verified.** This section previously described
a standalone `PageWorkbenchPage` with Konva `Transformer` drag-create/
drag-resize for split and illustration regions. That page and its
`handleAddSplit`/`handleAddRegion`/`commitOverrides` flow no longer exist in
`frontend/src/` (folded away with the other per-page routes — see "Pages"
above). The one remaining Konva-backed interaction is the word-bbox
marquee-select overlay (`WordBboxOverlay` + `lib/marquee.ts`, partial-overlap
selection over OCR word bounding boxes) inside the `text_review` tool tab
(`TextReviewTool`). A full description of current per-stage region-editing UX
(crop/split/illustration equivalents inside `PagesGridTool`,
`ImageStageReviewTool`, `CanvasMapTool`, `IllustrationsTool`) needs its own
verification pass — out of scope for this fix.

## Job progress UX

Two kinds of progress:

1. **`JobProgressInline`** (in RunPipelinePanel and ProjectJobsFeed) — opens
   an `EventSource` against `/api/gpu/jobs/{id}/events`. SSE messages drive
   state updates instantly. On connection error, falls back to one `GET
   /api/data/jobs/{id}` so the UI shows terminal state at minimum.
2. **`JobsPage`** uses `useQuery` with `refetchInterval: 5000` because it's
   listing many jobs at once — SSE-per-job there would be wasteful.

The semantic event types (`progress` / `complete` / `error` / `cancelled`)
let consumers switch on `type` instead of parsing `status`.

## Form patterns

- **Three-state toggles** in `ConfigOverridesPanel`: cycle null → true →
  false → null. `null` shows as "inherit" (the resolver picks the parent layer).
- **Inline rename** in `ProjectTitleEdit`: click-to-edit, Enter to commit,
  Escape to cancel.
- **Confirm-then-delete** in `ProjectListRow`: kebab `⋯` → "Delete project?
  Yes / Cancel" inline replacement.

## What's shipped, what's deferred

- **OpenAPI codegen + drift guard** — shipped. `make openapi-export`
  regenerates `frontend/src/api/types.ts`; `tests/test_openapi_spec_committed.py`
  fails CI if the committed `openapi.json` diverges from the FastAPI app.
- **shadcn/ui + Radix adoption** — §13a shipped 2026-05-15. Dialog,
  AlertDialog, Tooltip, Select, Popover, Collapsible, Badge are Radix
  wrappers (TooltipProvider mounted in `App.tsx`); sonner provides toasts.
- **Vitest + msw harness** — shipped. Run via `make frontend-test`. ~22
  test files covering pure-function helpers, API clients, and mount-level
  page tests.
