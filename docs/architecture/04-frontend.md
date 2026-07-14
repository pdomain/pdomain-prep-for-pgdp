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
- react-konva 19 for the workbench canvas.
- react-router v7 for routing.
- Tailwind for styling.
- `frontend/src/api/client.ts` is a thin typed `fetch` wrapper that reads
  the auth token from `getAuthToken()` (localStorage first, then
  `(globalThis as any).__ENV__.API_TOKEN` — `globalThis` rather than
  `window` so the module imports cleanly in jsdom tests).
- `frontend/src/api/types.ts` is regenerated from `/openapi.json` via
  `make openapi-export` (`openapi-typescript`). The committed `openapi.json`
  at repo root is the contract source; `tests/test_openapi_spec_committed.py`
  guards it against drift.

## Pages

| Path | Component | What it does |
|---|---|---|
| `/` | `ProjectListPage` | List + create + delete. Create flow: POST project → XHR PUT zip → POST ingest → poll job → navigate. |
| `/projects/:id` | `ProjectConfigurePage` | Inline rename, Book Settings ranges + layout-confidence slider, RunPipelinePanel + ProjectJobsFeed, BulkActions (page_type/alignment/re-process), PageGrid (thumbnails + status pills + select-to-bulk). Pages list uses `useInfiniteQuery` + `next_cursor`. |
| `/projects/:id/pages/:idx0` | `PageWorkbenchPage` | Konva canvas with view/split/illustration modes. Drag to create rectangles; click to select; Konva Transformer + drag to resize/move (rotate handle shipped #100; flip blocked per roadmap P2.1). Right side: `StageChainRail` (per-stage chips with inline thumbnails, M3), `ArtifactViewer` (side-by-side compare), `StageControlsPanel` (filters `ResolvedPageConfig` to fields the selected stage reads, served by `GET /api/data/pipeline/stages/{stage_id}/fields`). Per-page stage run via `POST .../stages/{stage_id}/run` (optional `?async=true` for slow stages — `run_page_stage` `JobType`). |
| `/projects/:id/pages/:idx0/review` | `TextReviewPage` | Split-pane: image left, editable textarea right. Split-suffix dropdown when the page has splits. Save → `PATCH /api/data/projects/{id}/pages/{idx0}/text`. Re-OCR → `POST .../stages/ocr/run` against the page. Word-delete: `DELETE .../words` (hard or soft-flag); restore via `POST .../words/restore`. |
| `/projects/:id/crops` | `CropsGridPage` | Per-project grid of OCR-crop thumbnails for batch crop review. |
| `/projects/:id/review` | `ProjectReviewQueuePage` | Filtered list of pages with `?review_needed=true` (any non-complete output or processing_error). |
| `/jobs` | `JobsPage` | Last 50 jobs across the owner. Status pill, type, project link, progress, error message. Cancel button (live status), Retry button (terminal error/cancelled). Auto-refreshes every 5s. |
| `/settings` | `SettingsPage` | Full SystemDefaults editor (image processing, OCR, layout, scannos, hyphenation). Save / Export / Import / Reset buttons. |
| `/login` | `LoginPage` | OIDC PKCE flow. Generates verifier + S256 challenge, redirects to `${JWT_ISSUER}/authorize`, handles the callback (`?code=&state=`), exchanges code at `${JWT_ISSUER}/token`, calls `setAuthToken(...)`, navigates back. |

## Auth in the SPA

`api/client.ts`:

- `getAuthToken()` reads `localStorage["pgdp.api_token"]` first, then
  `window.__ENV__.API_TOKEN` (so apikey mode works without a login page).
- `setAuthToken(token | null)` writes/clears the storage key.
- Every request adds `Authorization: Bearer <token>` if a token exists.

`App.tsx` mounts an `AuthGuard` that:

- In JWT mode, eagerly redirects to `/login` if there's no token (and the
  current path isn't `/login`).
- Subscribes to the TanStack QueryCache; any cached query that 401s
  triggers a redirect to `/login`.

`AuthBadge` in the nav:

- In `none` mode, hidden.
- In `apikey` mode, fetches `/api/auth/me` and shows `user_id` as a pill.
- In `jwt` mode, decodes the JWT `sub` claim and shows it; "Sign out"
  button clears the token, calls `queryClient.clear()`, navigates to `/login`.

## Workbench canvas — drag-create + drag-resize

`PageWorkbenchPage` has three modes (`view` / `split` / `illustration`).

**Drawing:** in non-view modes, mousedown → mousemove → mouseup on the Stage
captures a screen-space rectangle. On mouseup it converts back to source-image
coords (via the same `scale` factor used to render the image) and:

- `split` → `handleAddSplit` → `commitOverrides.mutate({ splits: [...splits, next] })`
- `illustration` → `handleAddRegion` → `commitOverrides.mutate({ illustration_regions: [...regions, next] })`

**Editing existing rects:** every Rect registers itself in a `Map<key, Konva.Rect>`
by ref. The Transformer (`react-konva` `Transformer` with `rotateEnabled=false`,
`flipEnabled=false`, `boundBoxFunc` enforcing 8×8 minimum) is attached to the
selected rect's node via `tr.nodes([node])`. `onDragEnd` and `onTransformEnd`
both compute new coords via `rectFromNode(node, scale)` and call the
matching mutation. After transform we reset `scaleX`/`scaleY` to 1 and write
the scaled values into `width`/`height` so the Pydantic source-of-truth
matches what's drawn.

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
