# 04 — Frontend

## Agent Index

- **Kind:** architecture
- **Status:** built
- **Last verified:** 2026-11-07
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
- `frontend/src/api/types.gen.ts` is regenerated from `/openapi.json` via
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
modes. API-key mode uses a cookie. Other modes may attach a stored or environment token.
Verified against `frontend/src/api/client.ts` and `App.tsx`.

**`none` mode** — no auth at all. `getAuthToken()` still checks
`localStorage`/`__ENV__.API_TOKEN` as a fallback (see jwt mode below) but
the login flow does not populate them in none mode. If a token is already stored or supplied by the environment,
the client can still attach it. Requests always use `credentials: "include"`. `UserMenu` renders `null`.

**`apikey` mode** — httpOnly session cookie; the entered key is transient and not persisted as a JS bearer:

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
  returns non-null. API-key mode forces `null`; none mode also uses this token lookup.
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

The standalone PageWorkbenchPage is removed. Text-review word selection uses `WordBboxOverlay`,
the shared pdomain-ui `PageImageCanvas`, and react-konva rectangle overlays.
TextZonesTool and OcrTool still include schematic canvas placeholders; full interactive region editing
must not be inferred from the old workbench design. Shared image-review thumbnails and canvas scatter
remain [W2.1](../issues/2026-07-21-w21-isr-real-thumbs.md) and
[W2.3](../issues/2026-07-21-w23-canvas-map-real-data.md).

## Job progress UX

PipelinePage subscribes to project-stage and project page-stage streams. Tool bridges refresh their state
and artifacts from those messages. ZipTool uses project SSE and fetches its manifest.
JobsPage polls through TanStack Query every five seconds.
The removed JobProgressInline/RunPipelinePanel/ProjectJobsFeed are not current rendering surfaces.

SSE wire event names and JSON body types are distinct; see [job events](05-events-and-jobs.md#jobeventbroker).

## Form patterns

Current form ownership follows the projects surface, pipeline tool registry, and per-tool XState machines.
The former ConfigOverridesPanel, ProjectTitleEdit, and ProjectListRow examples are removed.
Grayscale's persisted tier controls are documented in [image settings](09-image-prep-settings.md).
The generated `types.gen.ts` and retained handwritten `types.ts` coexist; generation does not mean every
consumer already imports generated types.

## What's shipped, what's deferred

Source persistence, real grayscale previews, and grayscale tier controls are described in
[image preparation and settings](09-image-prep-settings.md).
The persisted page-order tool and its style limitations are described in [numbering runs](08-page-numbering.md).

- **OpenAPI codegen + drift guard** — shipped. `make openapi-export`
  regenerates `frontend/src/api/types.gen.ts`; `tests/test_openapi_spec_committed.py`
  fails CI if the committed `openapi.json` diverges from the FastAPI app.
- **shadcn/ui + Radix adoption** — §13a shipped 2026-05-15. Dialog,
  AlertDialog, Tooltip, Select, Popover, Collapsible, Badge are Radix
  wrappers (TooltipProvider mounted in `App.tsx`); sonner provides toasts.
- **Vitest + msw harness** — shipped. Run via `make frontend-test`.
  Tests cover pure-function helpers, API clients, and mount-level
  page tests.
