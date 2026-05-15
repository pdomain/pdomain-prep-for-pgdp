# pd-prep-for-pgdp UI Redesign — Implementation Plan

**Source:** Sibling repo's hi-fi plan
(`../pd-ocr-labeler-spa/docs/specs/2026-05-15-hifi-redesign-plan.md`) plus
this repo's own design mock at `docs/M5 Hi-Fi.html`.
**Date:** 2026-05-15
**Scope:** Transforms the existing M0–M4 surface area (ProjectList,
ProjectConfigure, PageWorkbench, TextReview, ProjectReviewQueue, Jobs,
Settings, Login) into a shared design language with
`pd-ocr-labeler-spa` so a user moving between the two apps feels they
are in the same product family.
**Out of scope:** Postgres adapter, S3 storage, JWT auth UI changes
beyond styling, Konva rotate (separate spec), search panel
re-architecture (separate spec). Backend routes and OpenAPI contract
unchanged.

Each slice targets one subagent session (~200–400 LOC). Run
`make ci AI=1` after every slice.

**Conventions:**

- File paths are relative to repo root.
- Token names (`bgPage`, `ink2`, etc.) expose as CSS custom properties
  (`--bg-page`, `--ink-2`) so they can be re-themed without rebuilding.
- "Existing → evolves" tags identify components being grown, not
  replaced.
- New components live under
  `frontend/src/components/{ui,shell,workbench,review,jobs}/`. Existing
  flat `frontend/src/components/*.tsx` files are migrated in place (or
  moved with `git mv`) only when a slice touches them.

## TL;DR

Adopt the same five-layer design stack `pd-ocr-labeler-spa` is moving
to:

1. **Token layer** — CSS custom properties for colour/spacing/typography,
   dark default + light scheme, identical token *names* across both
   apps (so a shared component lib stays trivially portable later).
2. **Tailwind theme.extend → CSS variables** — semantic utilities
   (`bg-surface`, `text-ink-2`, `border-border-2`) instead of raw
   slate/amber.
3. **shadcn/ui + Radix primitives + `cn()` / CVA** — already partially
   adopted (Tabs, Select, Tooltip, Popover, Dialog, Collapsible,
   AlertDialog). Add Button, DropdownMenu, Accordion, Toggle Group,
   Badge (replace ad-hoc), Progress, Separator.
4. **Lucide icons + Inter + JetBrains Mono** — the `M5 Hi-Fi.html` mock
   already uses these; the wired app does not.
5. **Studio-style shell** — top chrome (Header), optional left rail (for
   per-project nav inside a project), main content, right rail (drawer)
   for context-sensitive workbench detail. The two apps share the
   "header + 3-panel work area" idiom; prep does not need labeler-spa's
   B/L/W target rail (no canvas-target metaphor here).

## Context

`pd-ocr-labeler-spa` is undergoing its M2→M7 hi-fi redesign right now,
driven by `design_handoff_hifi/`. The shell, token system, and
primitive set are documented in five sibling specs:

- `2026-05-15-hifi-redesign-plan.md` (the slice plan)
- `2026-05-12-overview-architecture-design.md`
- `2026-05-12-frontend-shell-design.md`
- `2026-05-12-header-bar-design.md`
- `2026-05-12-toolbar-actions-design.md`

`pd-prep-for-pgdp` is the *structural* reference for that work
(FastAPI + Vite + single-wheel pattern) but its own UI is still
unstyled — Tailwind `theme.extend = {}`, body font is system sans, no
token layer, no shadcn primitives beyond the four already added
(Tabs/Select/Tooltip/Popover plus the Dialog family).

Meanwhile this repo has its own hi-fi mock at `docs/M5 Hi-Fi.html` —
a static React-via-Babel page using Inter + JetBrains Mono, a
slate-900 top nav, status-coloured Badge + StageCell components, and
a left-rail-less but right-drawer-anchored workbench. Its visual
vocabulary (slate base, amber for "review needed", emerald for "done",
blue for "running", red for "errored") is the prep palette we will
keep, expressed in the same *token layer* the labeler-spa is adopting
so the two apps share token names and component APIs while keeping
distinct accent palettes.

## Constraints

- **No backend changes.** Every existing route, payload shape, and
  `data-testid` is preserved. `make ci AI=1` must stay green after
  every slice.
- **Generated `types.gen.ts` is untouched.** `npm run openapi:gen` is
  re-run only when backend models change in unrelated slices.
- **Tailwind 3.4 stays.** No v4 migration as part of this redesign.
- **Konva canvases keep their current renderer.** WordBboxOverlay and
  the workbench rotate stage canvas don't change behaviourally; only
  their chrome (borders, button styles, header) gets restyled.
- **Light mode is default for prep.** Labeler-spa defaults to dark; prep
  defaults to light (matching `M5 Hi-Fi.html`). The token names are
  identical; only the scheme assignment differs. Dark mode is wired
  via `[data-theme="dark"]` for symmetry.
- **No mass `git mv` rewrites.** When a slice restyles a component it
  may also move it under `components/ui/`, `components/shell/`, etc.
  Components untouched by a slice stay in their current flat location.
- **Auth flow visuals are out of scope** beyond shell-level styling
  (LoginPage stays functional; gets header + button restyle only).

## Decision

### 1. Design System Alignment

#### 1.1 Design tokens (shared with labeler-spa)

Adopt the same token *names* labeler-spa Slice 1 introduces, with
prep-appropriate values. New file
`frontend/src/styles/tokens.css`, imported from `index.css` before
the Tailwind directives.

Token groups (light default; dark variant under `[data-theme="dark"]`):

| Group   | Tokens                                                                  | Prep light palette (default)                                    |
|---------|-------------------------------------------------------------------------|-----------------------------------------------------------------|
| bg      | `--bg-page --bg-surface --bg-raised --bg-sunk`                          | slate-50, white, slate-100, slate-200                           |
| border  | `--border-1 --border-2 --border-3`                                      | slate-200, slate-300, slate-400                                 |
| ink     | `--ink-1 --ink-2 --ink-3 --ink-4`                                       | slate-900, slate-700, slate-500, slate-400                      |
| accent  | `--accent --accent-ink`                                                 | slate-900 (primary surface), white (text on accent)             |
| brand   | `--brand --brand-ink`                                                   | amber-500→amber-600 gradient, slate-900                         |
| status  | `--status-done --status-running --status-queued --status-error --status-review` | emerald-500, blue-500, slate-400, red-500, amber-500           |
| status-bg | `--status-done-bg --status-running-bg --status-queued-bg --status-error-bg --status-review-bg` | emerald-50, blue-50, slate-50, red-50, amber-50 |
| stage   | `--stage-clean --stage-dirty --stage-not-run --stage-running --stage-failed --stage-na` | emerald-500, amber-500, slate-300, blue-500, red-500, slate-200 |

Dark mode (`[data-theme="dark"]`) uses labeler-spa's dark token
values verbatim so the *dark* presentation of both apps reads as
one product. Light mode is prep's day-to-day default.

Out of scope for this milestone: the labeler-specific `--layer-*`
(block/para/line/word) tokens — prep has no layer-coloured overlay
metaphor.

#### 1.2 Tailwind config rewire

Edit `frontend/tailwind.config.ts`:

- Populate `theme.extend.colors` with the semantic keys above, each
  pointing at a `var(--…)` reference. Pattern matches labeler-spa
  Slice 2.
- `theme.extend.fontFamily.sans = ["Inter", "ui-sans-serif",
  "system-ui", "sans-serif"]`.
- `theme.extend.fontFamily.mono = ["JetBrains Mono", "ui-monospace",
  "monospace"]`.
- `theme.extend.fontSize` adds `xxs` (10px/1.2) and `xs2` (11px/1.3)
  for the dense Badge/StageCell labels seen in the mock.
- Keep `content` glob.

#### 1.3 Fonts

`@fontsource/inter` and `@fontsource/jetbrains-mono` (npm). Import in
`frontend/src/main.tsx`. Set `body` font-family in `index.css`. Drop
the system-sans stack.

#### 1.4 Packages to add

- `lucide-react` — icons (mock currently inlines SVGs; replace with
  Lucide names per the mock's `Icon` map).
- `class-variance-authority` + `tailwind-merge` + `clsx` — same `cn()`
  helper labeler-spa Slice 0 adds.
- `@fontsource/inter` + `@fontsource/jetbrains-mono`.
- `@radix-ui/react-dropdown-menu` (used by ProfileDropdown rewrite,
  TopNav user menu, jobs row "More" menu).
- `@radix-ui/react-accordion` (jobs row collapsible parent in the
  mock; future SettingsPage section grouping).
- `@radix-ui/react-progress` — replaces the hand-rolled `Progress`
  component in `M5 Hi-Fi.html` and the inline `<div>` progress bars
  currently scattered through `JobsPage` and `StageChainRail`.
- `@radix-ui/react-separator` — visual separators in the drawer and
  in StageChainRail group headers.
- `@radix-ui/react-toggle-group` — *already in* `package.json`; verify
  it's exported through a `ui/ToggleGroup.tsx` wrapper.

shadcn CLI is *not* initialised in this repo (no `components.json`).
Slice P0-1 initialises shadcn with `baseColor: slate` and adds
the new primitives via the CLI; existing hand-written
`Tabs`/`Select`/`Tooltip`/`Popover` wrappers stay (they're already
Radix-backed and conformant) but a sweep updates their class names to
the new token utilities.

### 2. App Shell / Layout

#### 2.1 Top header bar

Replace `App.tsx`'s inline `<header>` with `<TopNav />` modeled on
`M5 Hi-Fi.html:TopNav`. Same shape: dark slate-900 bar (always dark
even in light mode — matches the mock and gives the app a stable
chrome anchor), 56px tall, three regions:

- **Left:** brand glyph (gradient amber square with "p") + `pgdp-prep`
  wordmark + breadcrumb-style nav (`Projects / willa-cather-letters`
  when inside a project).
- **Center spacer + search:** "Search projects…" pill with `⌘K`
  hint. Wires to the existing `SearchPanel` overlay (no new search
  backend — only the trigger surface changes). When `SearchPanel` is
  open the pill renders pressed-state.
- **Right:** `<OpenTasksBell />` (existing bell, restyled with the
  ring-2/ring-slate-900 amber badge from the mock), then
  `<UserMenu />`.

`<UserMenu />` is a Radix `DropdownMenu` replacing the current ad-hoc
`<ProfileDropdown />` + `<AuthBadge />` split. Items:

- Account (`/api/auth/me` user_id readout, mono).
- Theme submenu (Light / Dark / System).
- Sign out (JWT mode) or "apikey mode" badge.

Auth-mode branching stays identical to today's `AuthBadge`; only the
surface changes.

#### 2.2 Page container

Today: `<main className="mx-auto max-w-7xl p-4">`. Change to a CSS
grid container `<AppShell />` (no fixed `max-w-7xl` cap on
workbench/review pages, which need full width):

```
grid-template-rows: 56px 1fr 32px;        /* header / main / footer */
grid-template-areas: "header" "main" "footer";
```

The optional "right drawer" (PageDrawer in the mock, used on the
project page and workbench) is a nested grid inside `main`:

```
grid-template-columns: 1fr 360px;          /* content + drawer */
grid-template-areas: "content drawer";
```

When the drawer is closed (default on review queue, list, jobs) the
grid collapses to a single column.

ServerInfoFooter slots into `footer` (already exists, just restyled
with `bg-page text-ink-4 border-t border-border-1`).

#### 2.3 No left rail in prep

Prep has fewer cross-page modes than labeler-spa, so we do *not*
introduce the B/L/W target rail. Per-project navigation lives in the
header breadcrumb and in `ProjectConfigurePage`'s tabbed content
panel (Pipeline / Pages / Settings tabs — see §4.4).

### 3. Component Library

#### 3.1 Already present (keep, restyle)

- `ui/Tabs.tsx`
- `ui/Select.tsx`
- `ui/Tooltip.tsx`
- `ui/Popover.tsx`
- `ui/Dialog.tsx`
- `ui/AlertDialog.tsx`
- `ui/Collapsible.tsx`

These get a class-name sweep in Slice P0-3 to swap `slate-*` raw
utilities for `bg-surface` / `text-ink-1` / `border-border-1`
tokens. No API changes.

#### 3.2 New primitives to add

| Component        | Source                                | Used by                                                                       |
|------------------|---------------------------------------|-------------------------------------------------------------------------------|
| `ui/Button.tsx`  | shadcn add button (Radix-free CVA)   | Every page; replaces the dozens of inline `bg-slate-900 px-3 …` buttons      |
| `ui/IconButton.tsx` | derive from Button (`size="icon"`) | Header bell, drawer close, jobs "More"                                       |
| `ui/Badge.tsx`   | restyle existing `ui/Badge.tsx`       | Page status, stage status, awaiting-review banner count                       |
| `ui/StatusPip.tsx` | new (mirror labeler-spa Slice 5)   | Inline status dot + label for compact rows                                    |
| `ui/StageCell.tsx` | new (lift from M5 mock)             | StageChainRail tiles, JobsPage page-row 4-cell strip                          |
| `ui/Progress.tsx` | Radix Progress + thin wrapper      | JobsPage rows, PageDrawer overall row, build_package banner                  |
| `ui/Separator.tsx` | Radix Separator                    | Drawer section dividers, settings page                                       |
| `ui/DropdownMenu.tsx` | Radix DropdownMenu                | Header user menu, jobs "More" menu                                           |
| `ui/Accordion.tsx` | Radix Accordion (no tag-stripe)    | SettingsPage section groups; *not* the labeler-spa accent-stripe variant     |
| `ui/ToggleGroup.tsx` | Radix ToggleGroup wrapper        | Stage filter chips in JobsPage / ProjectReviewQueuePage                      |
| `ui/KeyCap.tsx`  | new (mirror labeler-spa Slice 5)     | TextReview hotkey hints, future hotkey-help modal                            |
| `ui/Card.tsx`    | new (light wrapper: bg-surface + border-border-1 + rounded-lg + shadow-sm) | Jobs row, PageDrawer, ProjectList cards, stat tiles |
| `ui/StatTile.tsx` | new (lift from M5 mock `StatTile`)  | ProjectConfigurePage / ProjectReviewQueuePage summary header                  |

All new primitives expose `data-testid` props for E2E coverage and
all live under `frontend/src/components/ui/`.

#### 3.3 Cross-app component parity (not built now)

The following components share names + APIs with labeler-spa for a
later extraction into a shared `pd-ui` package:

- `ui/Button`, `ui/IconButton`, `ui/Badge`, `ui/StatusPip`,
  `ui/KeyCap`, `ui/Progress`, `ui/Separator`, `ui/Card`,
  `ui/ToggleGroup`, `ui/DropdownMenu`.

Divergent (each app owns its own variant): `Accordion` (labeler has
`tag` stripe), `Chip` (labeler-only, tri-state), `StageCell` (prep
only), `Rail` / `Drawer` (labeler-only Studio shell).

### 4. Page-by-page redesign plan

Priority key:

- **P0** = shell-level chrome (tokens, header, footer, AppShell).
- **P1** = high-traffic surfaces (ProjectList, ProjectConfigure,
  PageWorkbench, TextReview).
- **P2** = secondary surfaces (Jobs, ReviewQueue, Settings, Login).

#### 4.1 `ProjectListPage` *(P1, medium)*

What it does: lists discovered projects; "New project" creates a
project from a zip; cards link to each project.

Redesign:

- Page header → `<PageHeader title="Projects" actions={<Button …>}>`
  styled as in M5 mock §ProjectHeader (title + thin description + right
  cluster).
- Project rows → `ui/Card` grid (2 columns at `lg`, 1 column below).
  Each card: project name (semibold), page count + created date in
  `ink-3 mono`, status badges (`done` / `parked` / `running`) from
  current `review-status` query, "Open" → primary Button.
- Empty state → centred `ui/Card` with dashed `border-border-2`,
  inline `Button` to launch the create dialog.
- Create-project dialog: replace the raw `<input>`/`<select>` markup
  with `ui/Input` (new — see §3.2 addendum) and `ui/Select`. Form
  errors stay in `FormErrorBanner` but the banner gets restyled to
  match the mock's left-accent-bar pattern.

#### 4.2 `ProjectConfigurePage` *(P1, large)*

What it does: project metadata editing, pipeline-stage controls,
page-list management, jobs view embedded.

Redesign:

- Top: ProjectHeader from M5 mock §ProjectHeader (title +
  breadcrumb + "Re-import scans" / "Run all dirty stages" / "Build
  package" cluster). The "Build package" amber-dot parked indicator is
  driven off the existing `review-status` query.
- Stat tiles row: `<StatTile value="47" label="Total pages" />` etc.
  using the existing aggregate data already fetched on this page.
- Body splits into `ui/Tabs`:
  - **Pipeline** — current pipeline-controls UI, restyled with
    `Card` wrappers per stage; existing `StageChainRail` reused as-is.
  - **Pages** — page list (current page-list table) becomes a
    `ui/Card` containing the M5 mock's `JobsCard` row layout
    (page-row with `StageCell` strip + Progress + Badge + chevron).
    Each row clicks open the `PageDrawer` (right rail) rather than
    navigating, matching the mock. "Open in workbench" inside the
    drawer is the explicit navigation action.
  - **Settings** — split-/page-config defaults form, restyled with
    `Card` + `Separator` group blocks.
- Right rail: `<PageDrawer />` (new component, lifted from M5
  mock §PageDrawer). Closes by default; opens when a page row is
  clicked; URL keeps `?drawer=<idx0>` so deep-links land in the
  drawer. The mock's Stages / Overall / Review-needed / Actions
  sections all map 1:1 onto current API data.

#### 4.3 `PageWorkbenchPage` *(P1, large)*

What it does: per-page Konva-canvas stage with rotate, illustrations
panel, per-stage controls, save.

Redesign:

- Page header → `<PageHeader title={`Page ${num}`} subtitle={file}
  badge={status} actions={…}>`. Status badge is the same primitive
  as everywhere else.
- Existing `StageChainRail` keeps its layout but its tile chrome
  swaps to `ui/StageCell` so the visual vocabulary matches
  ProjectConfigure Pages tab + JobsPage. Status-coloured rings come
  from `--stage-*` tokens (§1.1).
- `ArtifactViewer` gets `Card` wrappers around each pane;
  Stage-select dropdowns swap their hand-rolled markup for
  `ui/Select`.
- `StageControlsPanel` gets `Card` wrappers per controls group +
  `Separator` between groups. Form fields use `ui/Input` and
  `ui/Select`; "Apply" / "Reset" buttons use `ui/Button` variants
  (`primary` / `secondary`).
- Konva-canvas chrome (the rotate stage) gets a small
  `ui/ToggleGroup` for rotation mode + restyled action buttons. No
  Konva-internal changes.
- Save-status banner uses `ui/Badge` (`kind="warn"` when dirty,
  `kind="done"` when saved) and the existing autosave wiring stays.

#### 4.4 `TextReviewPage` *(P1, medium)*

What it does: side-by-side Konva word overlay + GT textarea, line
diff, word-delete-undo, hotkey-driven.

Redesign:

- PageHeader pattern as in §4.3.
- Left pane: Konva canvas wrapped in `ui/Card`; the
  `WordBboxOverlay` overlay keeps its drawing logic; overlay
  marquee + chip strokes pull from new tokens
  (`--accent`, `--status-error`, `--ink-2`).
- Right pane: GT textarea in a `ui/Card`; "diff" toggle becomes a
  `ui/ToggleGroup` (Text / Diff); LineDiffView gets a class-name
  sweep to the token utilities.
- Word-delete-undo controls: action buttons → `ui/Button`. Undo
  window indicator → small `ui/Badge` (`kind="info"`).
- Hotkey hints under the textarea: render with `ui/KeyCap`. Same
  primitive labeler-spa uses; this is the prep-side proof point for
  the cross-app parity claim in §3.3.

#### 4.5 `JobsPage` *(P2, medium)*

What it does: list jobs (parent rows with collapsible page
children); filter chips; per-row actions.

Redesign:

- Page-level: `<PageHeader />` + filter `ui/ToggleGroup` row
  (All / Running / Queued / Done / Errored / Awaiting review),
  modelled on M5 mock §JobsCard's filter strip.
- Job rows → `ui/Card`, with the parent-row layout from the mock
  (grid-cols `[1fr_220px_140px_110px]`, Progress + Badge +
  IconButton cluster). Expanded children use the same `PageRow`
  pattern as ProjectConfigure §Pages tab — single shared component
  `<JobsPageRow />` reused.
- "Logs" / "More" IconButtons open the existing logs side panel and
  a new `DropdownMenu` (re-run, cancel, copy job_id).

#### 4.6 `ProjectReviewQueuePage` *(P2, small)*

What it does: review-queue list for the parked `build_package` job.

Redesign:

- ReviewBanner (lifted from M5 mock §ReviewBanner) at the top — same
  amber-left-bar styling as the dismissable banner in the mock.
- Page rows reuse `<JobsPageRow />` from §4.5; the queue view is
  conceptually the same shape (page + status + actions).

#### 4.7 `SettingsPage` *(P2, small)*

What it does: edit auth / storage / GPU backend config.

Redesign:

- Wrap each settings group in `ui/Card` with a `ui/Separator`
  beneath the group title.
- Form fields use `ui/Input` / `ui/Select`.
- Save bar at the bottom uses sticky `bg-surface border-t border-border-1`
  with primary + secondary `ui/Button`.

#### 4.8 `LoginPage` *(P2, small)*

What it does: JWT-mode sign-in.

Redesign:

- Single centred `ui/Card`, brand glyph at the top (matches
  `TopNav` left cluster), Input + primary Button. No behavioural
  changes.

#### 4.9 Banners (cross-cutting) *(P0/P1, small)*

`AwaitingReviewBanner`, `DiskCostBanner`, `FormErrorBanner` are all
restyled to the M5 mock's `ReviewBanner` left-accent-bar pattern
(left 4px coloured border + icon + body + actions). Token colors:
amber for review, blue for disk-cost, red for form-error. Component
API unchanged.

### 5. Migration strategy

#### Phase 0 — Tooling bootstrap

- **Slice P0-1 — `shadcn init` + Lucide + CVA/tailwind-merge/clsx.**
  Mirror labeler-spa Slice 0. Wire `frontend/components.json`,
  `frontend/src/lib/utils.ts` (`cn()`), Lucide, the CVA stack. Add
  Button, DropdownMenu, Accordion, Progress, Separator via the CLI.
  Restyle them in Slice P0-3.
  Test: `npm run build` clean; vitest covers `cn()`.
  Dependencies: none.

- **Slice P0-2 — Token layer + Tailwind theme.extend + fonts.**
  Mirror labeler-spa Slices 1+2+3. New
  `frontend/src/styles/tokens.css`, dual scheme, Tailwind config
  wired to `var(--…)`, Inter + JetBrains Mono installed and
  imported. Set `<html data-theme="light">` default in
  `frontend/index.html`. Drop the system-sans body font.
  Test: `frontend/src/styles/tokens.test.ts` (mirror labeler-spa).
  Dependencies: P0-1.

- **Slice P0-3 — Primitive token sweep.**
  Update `ui/Tabs.tsx`, `ui/Select.tsx`, `ui/Tooltip.tsx`,
  `ui/Popover.tsx`, `ui/Dialog.tsx`, `ui/AlertDialog.tsx`,
  `ui/Collapsible.tsx`, `ui/Badge.tsx` class names from raw
  slate-* utilities to token utilities (`bg-surface`,
  `text-ink-1`, …). No API changes. Add `data-testid` if missing.
  Test: existing `.test.tsx` files keep passing; snapshot diffs
  on class names only.
  Dependencies: P0-2.

- **Slice P0-4 — New primitives (Button, StatusPip, Progress,
  Separator, Card, StatTile, KeyCap, StageCell, IconButton).**
  Each gets a `.test.tsx`. CVA variants follow labeler-spa
  conventions where applicable. Button variants: `primary`,
  `secondary`, `outline`, `ghost`, `link`, `amber`, `danger`
  (matches M5 mock). Sizes: `default` (36px), `sm` (32px),
  `xs` (28px), `icon` (square).
  Test: per-primitive vitest.
  Dependencies: P0-2.

- **Slice P0-5 — ToggleGroup, Accordion, DropdownMenu wrappers.**
  Thin Radix wrappers (same pattern as existing `Tabs.tsx`).
  Test: per-wrapper vitest covers value control + keyboard nav.
  Dependencies: P0-1.

#### Phase 1 — Shell

- **Slice P1-1 — `AppShell` grid + `TopNav` brand/breadcrumb/nav.**
  Replace `App.tsx`'s `<header>` and `<main>` with the grid
  container. `TopNav` exposes children for breadcrumb (a per-page
  `<PageBreadcrumb />` is rendered by the page itself via a portal
  into `TopNav`).
  Test: `AppShell.test.tsx`, `TopNav.test.tsx` (logo + nav links +
  active-route highlight).
  Dependencies: P0-4.

- **Slice P1-2 — `OpenTasksBell` + `UserMenu` restyle + `SearchModal`.**
  Move existing bell rendering into `TopNav`. Replace
  `ProfileDropdown` + `AuthBadge` with `UserMenu` (Radix
  DropdownMenu). Theme submenu writes to a new
  `frontend/src/stores/uiPrefs.ts` (zustand) key `theme`
  (`light`|`dark`|`system`); subscribe to media query in
  `system` mode (mirror labeler-spa Slice 24).
  Also add `SearchModal`: Radix `Dialog` wrapping the existing
  `SearchPanel` content. The header search pill and a global
  `useHotkeys("mod+k")` listener both open it; works on any route.
  No backend changes.
  Test: `UserMenu.test.tsx` covers all three theme branches and
  all three auth modes (`none`, `apikey`, `jwt`).
  `SearchModal.test.tsx`: opens on `⌘K`, closes on Escape, renders
  existing SearchPanel content.
  Dependencies: P1-1, P0-5.

- **Slice P1-3 — `ServerInfoFooter` restyle + global banner slot.**
  Move banners (`AwaitingReviewBanner`, `DiskCostBanner`) into a
  named `<main>` top slot rendered before page content (so they
  appear globally and consistently above any page header). Restyle
  per §4.9.
  Test: snapshot of footer + banner stack.
  Dependencies: P1-1.

#### Phase 2 — High-traffic pages

- **Slice P2-1 — ProjectListPage card grid.**
  Apply §4.1. New `PageHeader` extracted from this slice as a
  reusable helper (used by every subsequent page slice).
  Test: extend `ProjectListPage.test.tsx`.
  Dependencies: P0-4, P1-1.

- **Slice P2-2 — ProjectConfigurePage tabs scaffold.**
  Split the current ProjectConfigurePage body into the three tabs
  (Pipeline / Pages / Settings). Tabs are URL-stateful via
  `?tab=…`. Re-host existing components inside the tab panels
  unchanged for this slice.
  Test: `ProjectConfigurePage.test.tsx` extended for tab switching + URL state.
  Dependencies: P0-3, P2-1.

- **Slice P2-3 — ProjectConfigure Pages tab + PageDrawer.**
  Lift `JobsCard` + `PageRow` + `PageDrawer` from the mock into
  real components, wire to `/api/data/projects/:id/pages`. Drawer
  state via `?drawer=<idx0>`. "Open in workbench" links to the
  existing route.
  Test: `PageDrawer.test.tsx` + extended ProjectConfigurePage
  coverage.
  Dependencies: P2-2.

- **Slice P2-4 — PageWorkbenchPage chrome + StageChainRail tiles.**
  Apply §4.3. `StageChainRail` keeps its data hooks; only its
  tile rendering swaps to `ui/StageCell`. `ArtifactViewer`
  wrapping moves to `ui/Card`.
  Test: snapshot of tile rendering with the four stage states.
  Dependencies: P0-3, P0-4, P1-1.

- **Slice P2-5 — StageControlsPanel form sweep.**
  Replace raw inputs/selects with `ui/Input` and `ui/Select`.
  Action buttons → `ui/Button`. No new behaviour.
  Test: existing `StageControlsPanel.test.tsx` keeps passing.
  Dependencies: P2-4.

- **Slice P2-6 — TextReviewPage layout + hotkey hints.**
  Apply §4.4. Add `ui/KeyCap` hotkey hints row beneath the
  textarea pulling from the existing `useHotkeys` registrations
  (extract registration metadata into a new
  `frontend/src/lib/hotkeyMap.ts` similar to labeler-spa Slice 25).
  Test: `TextReviewPage.test.tsx` for hint row; snapshot diff
  on Card wrappers.
  Dependencies: P0-3, P0-4, P1-1.

#### Phase 3 — Secondary pages

- **Slice P3-1 — JobsPage card layout + filter ToggleGroup.**
- **Slice P3-2 — ProjectReviewQueuePage banner + shared PageRow.**
- **Slice P3-3 — SettingsPage Cards + Separators.**
- **Slice P3-4 — LoginPage card centring.**

Each P3 slice is small (≤200 LOC). Test scope: per-page
`.test.tsx` updates only.

#### Phase 4 — Polish

- **Slice P4-1 — Toast wiring (Sonner already in deps).**
  Mirror labeler-spa Slice 26: `frontend/src/lib/toast.ts` with
  `toast.info / success / warn / error`, status-coloured left
  edges via token CSS. `<Toaster position="bottom-right" />` in
  `App.tsx`. Migrate transient `FormErrorBanner` callers that
  were already snackbar-shaped.
  Test: `toast.test.ts`.
  Dependencies: P0-2.

- **Slice P4-2 — Theme toggle wired end-to-end.**
  Already partly built in P1-2; this slice adds the persistence
  layer (zustand `persist` middleware to `localStorage` key
  `pgdp.uiPrefs`) and writes the `[data-theme]` attribute to
  `document.documentElement` on store change.
  Test: extend `uiPrefs.test.ts`.
  Dependencies: P1-2.

- **Slice P4-3 — Hotkey help modal (parallels labeler-spa Slice 25).**
  New `HotkeyHelpModal.tsx` (Radix Dialog) reading from
  `hotkeyMap.ts`. Triggered by `?` global hotkey. KeyCap-powered
  rows. Sections: Navigation / Editing / View.
  Test: open via hotkey; every registered key appears once.
  Dependencies: P2-6.

### Scope estimates per slice

| Phase | Slices | Total LOC est. | Sequential? |
|------|--------|-----------------|--------------|
| P0 | 5 | ~1200 | P0-1 → P0-2 → (P0-3 + P0-4 + P0-5 parallel) |
| P1 | 3 | ~700 | P1-1 → P1-2 → P1-3 |
| P2 | 6 | ~2000 | P2-1 → P2-2 → P2-3; P2-4 → P2-5; P2-6 (parallel across the three families) |
| P3 | 4 | ~800 | Independent |
| P4 | 3 | ~500 | Independent |

### What ships without breaking functionality

Every slice is additive or restyling — no route changes, no payload
changes, no behavioural changes to Konva canvases. Each slice runs
`make ci AI=1` after editing.

Risk surface (test these carefully):

- `App.tsx` shell refactor (P1-1) — covered by every page's existing
  `.test.tsx` plus a new shell test.
- TopNav auth-mode branching (P1-2) — covered by `UserMenu.test.tsx`
  for all three modes.
- Drawer URL state on ProjectConfigure (P2-3) — covered by new
  `PageDrawer.test.tsx` plus extended page test.

### 6. Shared patterns

#### 6.1 Already in scope above

- **Toasts** (Sonner) — Slice P4-1.
- **Theme toggle** (Light/Dark/System) — Slice P1-2 + P4-2.
- **Hotkey help modal** (KeyCap-powered) — Slice P4-3.
- **KeyCap-driven hotkey hints** — Slice P2-6 (TextReview)
  generalised in P4-3.

#### 6.2 Loading states

Adopt labeler-spa's pattern: empty-state cards use dashed
`border-border-2` + centred icon + body + primary action.
Skeleton states for query loading: `bg-sunk animate-pulse` blocks
at the row/card level (not individual text spans).

#### 6.3 Cross-app component sharing — out of scope here, noted for later

The following primitives could move into a shared `pd-ui` workspace
package once both apps land their hi-fi. Naming and APIs match by
design (this spec + labeler-spa hi-fi spec) so the extraction is
mechanical:

- `ui/Button`, `ui/IconButton`, `ui/Badge`, `ui/StatusPip`,
  `ui/KeyCap`, `ui/Progress`, `ui/Separator`, `ui/Card`,
  `ui/ToggleGroup`, `ui/DropdownMenu`, `ui/Accordion` (the
  base, without the labeler-spa tag stripe), `ui/Tabs`,
  `ui/Select`, `ui/Tooltip`, `ui/Popover`, `ui/Dialog`,
  `ui/AlertDialog`, `ui/Collapsible`, `ui/Input`.

Tokens move to a shared `tokens-base.css` with per-app overlay
files defining the brand/accent palette differences.

#### 6.4 Search modal (`⌘K`)

`SearchPanel` exists today as a project-page FTS overlay. In Slice
P1-2 it is promoted to a **global full-screen modal**: a centred
`SearchModal` (Radix `Dialog`) wraps the existing `SearchPanel`
content unchanged. The header pill acts as the visual trigger;
a global `useHotkeys("mod+k")` listener opens the modal on any
route. The search backend (`/api/data/projects?q=…`) is unchanged —
only the trigger surface is promoted from project-page to global.

A full command-palette (actions, page navigation) is out of scope
for this redesign.

### 7. Out of scope

From labeler-spa's hi-fi that does *not* apply to prep:

- **B/L/W target rail** — prep has no block/line/word layer model.
  No `Rail.tsx` analogue.
- **Layer-coloured BBox tokens** (`--layer-block/para/line/word`) —
  no equivalent metaphor. Prep's only canvas overlays
  (WordBboxOverlay, rotate-stage) use status / accent tokens.
- **Chip primitive (tri-state)** — labeler-only; prep's filter rows
  use `ToggleGroup` instead.
- **Accordion `tag` stripe variant** — labeler-only (used in Word
  Detail editor). Prep's Accordion stays base.
- **Word Detail / Char Ranges / Char Fixer / Rebox / Erase
  accordions** — labeler-only domain.
- **Studio Drawer with Worklist + Hierarchy tabs** — labeler-only.
  Prep's drawer (`PageDrawer`) is a simpler context panel.
- **Selection store hierarchical level/path** — labeler-only.
- **PGDP monospace font asset** — labeler defers it; prep uses
  JetBrains Mono everywhere already.

From prep that does *not* apply to labeler:

- **Stage DAG vocabulary** (`StageCell` tones, `--stage-*`) is
  prep-specific; labeler's `--status-*` tokens stay distinct.
- **`build_package` parked-banner pattern** is prep-specific.

## Contract / Acceptance

- `make ci AI=1` passes after every slice.
- Every page's existing `.test.tsx` keeps passing through the slice
  that touches it.
- New primitives each ship with a `.test.tsx`.
- `frontend/src/styles/tokens.css` exists; `[data-theme="dark"]`
  produces visibly different background on `<body>` (asserted in
  vitest by computed style).
- `<html data-theme="light">` is the default in `index.html`.
- Inter + JetBrains Mono load without 404; body computed
  `font-family` contains `"Inter"`.
- `ui/Tabs`, `ui/Select`, `ui/Tooltip`, `ui/Popover`, `ui/Dialog`,
  `ui/AlertDialog`, `ui/Collapsible`, `ui/Badge` consume token
  utilities only (no raw `slate-*` left in their source).
- A user navigating between `pd-ocr-labeler-spa` (in dark mode) and
  `pd-prep-for-pgdp` (in dark mode) reads them as the same product
  family: identical header shape, identical Button/Badge/Progress/
  StatusPip shapes, identical Card chrome, identical empty-state
  pattern.

## Trade-offs considered

**Adopt labeler-spa's dark default vs keep prep light-default.**
Labeler-spa defaults to dark because the canvas is the focal surface
and high-contrast colour-coded overlays read better on dark; prep's
focal surface is forms + tables + thumbnails, which read better on
light. Keep the divergence — only the *default* differs; both apps
honour the same `[data-theme]` toggle, so a user who prefers one
mode gets it everywhere.

**Build a Studio shell with rail + drawer for prep vs simpler header + optional drawer.**
Prep has no B/L/W metaphor and no continuous
selection target. A 40px rail with empty groups would be a fiction.
Keep the shell simpler; reach for parity at the *primitive* and
*token* layer, not at the macro-shell layer.

**One big rewrite slice vs many small slices.** The two apps have
different review cadences and the prep shell touches every page.
Many small slices means `make ci AI=1` stays green and reviewers can
ship incrementally; pay the coordination cost of more PRs.

**Wholesale shadcn-init in P0-1 vs hand-roll all primitives.**
Labeler-spa already paid the shadcn-init cost; this repo benefits
from the same path so the two stay shape-compatible. Hand-rolling
would diverge subtly and make a future shared lib harder.

## Consequences

- Every new page or component must consume tokens via the Tailwind
  utility layer; raw `slate-*` / `amber-*` utilities become a lint
  smell (initially un-enforced; a future eslint plugin can flag
  them).
- The `[data-testid]` contract still drives e2e; new primitives
  must accept and forward `data-testid` through to the rendered
  element.
- Adding a status colour requires updating `tokens.css`,
  `tailwind.config.ts`, and (where relevant) `StageCell` /
  `Badge` CVA variant maps in one commit.
- Theme persistence lands in `localStorage` under
  `pgdp.uiPrefs.theme`; the labeler-spa equivalent key is
  `pdl.uiPrefs.theme`. Keep them distinct so each app remembers
  per-user preference independently.

## Open questions

All previously open questions are resolved (2026-05-15):

- **Header height parity.** ✅ **56px confirmed.** Deliberate divergence
  from labeler-spa's 40px; breadcrumb + search pill need the room.
- **Search-pill / `⌘K` wiring.** ✅ **Full-screen modal, global.**
  `⌘K` opens a centred `SearchModal` (Dialog wrapping `SearchPanel`
  content) on any route, not just the project page. See updated
  §6.4 and Slice P1-2.
- **Awaiting-review banner scope.** ✅ **Project-scoped routes only.**
  Banner renders inside `/projects/:id/*` routes; hidden on Jobs,
  Settings, Login. Today's behaviour is correct; no change needed.
- **Dark mode scope.** ✅ **UserMenu theme toggle ships with the
  redesign.** Light / Dark / System picker in `UserMenu`, persisted
  to `localStorage`. Slice P1-2 wires the toggle; P4-2 completes
  persistence + system-preference sync.

## References

- `../pd-ocr-labeler-spa/docs/specs/2026-05-15-hifi-redesign-plan.md` —
  sibling hi-fi plan; slice numbering, primitive APIs, token
  names match by design.
- `../pd-ocr-labeler-spa/docs/specs/2026-05-12-frontend-shell-design.md`
- `../pd-ocr-labeler-spa/docs/specs/2026-05-12-header-bar-design.md`
- `../pd-ocr-labeler-spa/docs/specs/2026-05-12-toolbar-actions-design.md`
- `docs/M5 Hi-Fi.html` — prep's own visual baseline; the palette,
  Badge, StageCell, PageRow, PageDrawer, and ReviewBanner are all
  lifted from here.
- `docs/specs/2026-05-11-workbench-artifact-viewer-design.md` —
  current StageChainRail / ArtifactViewer contract; visuals
  redesigned but contract untouched.
- `frontend/src/components/` — current flat component layout;
  this spec migrates pieces under `ui/`, `shell/`, `workbench/`,
  `review/`, `jobs/` only when a slice touches them.
