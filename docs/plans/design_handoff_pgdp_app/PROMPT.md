# Claude Code prompt — converge **pdomain-prep-for-pgdp** onto this design package

> **Rewritten 2026-06-10.** The original version of this prompt assumed an empty
> repo. The app now exists and is substantial; this brief describes how to
> converge it onto the design package. Decisions here were locked in
> `docs/specs/2026-06-10-statechart-convergence-design.md` — read that spec
> first; it is authoritative where this prompt is silent.

---

## Mission

Converge the **existing** pdomain-prep-for-pgdp app — a working FastAPI + React
PGDP prep pipeline — onto this design package: re-cut the backend to the
design's 24 user-facing stages, rebuild the frontend on XState v5 per the
statecharts, and recreate the `final/` canvases faithfully.

The package contains three layers, each authoritative for a different thing:

1. **`final/`** — high-fidelity HTML/JSX design canvases. **Authoritative for
   look & layout.** 24 pipeline stages + a Projects landing page + the Pipeline
   shell + the App-shell template, each rendered as a grid of artboards covering
   every state (empty, running, flagged, settled, error, bulk-select,
   inline-edit, …).
2. **`statecharts/`** — 28 framework-neutral statechart YAMLs. **Authoritative
   for behavior.** Every machine, event, guard, action, and service the UI
   needs, including how machines compose (who spawns whom, what re-keys on
   selection, how staleness fans out). Start with `statecharts/README.md` — it
   is the architecture document — then `statecharts/pipeline-plan.md` for the
   rationale. `statechart-authoring-guide.md` defines the YAML vocabulary.
3. **`design-system/`** — `tokens.css` (the full token set) and `ui-base.jsx` /
   `template.jsx` (the atom kit + page chrome). **Authoritative for the visual
   language**, reconciled against pdomain-ui rather than duplicated (see below).

`COMPONENT_INDEX.md` is an auto-extracted inventory: every component per file
plus a frequency table. Identifiers appearing in many files are the shared kit;
identifiers in one file are page-scoped.

**Fidelity: high.** The `final/` canvases are the intended pixel appearance, not
sketches. Recreate them faithfully — colors, spacing, type come from tokens,
never hard-coded.

## What already exists (converge from, don't rebuild blind)

- **Backend:** FastAPI + Python 3.13. A shipped per-page stage DAG (currently 22
  micro-stages) with dirty propagation, splits-as-sibling-pages, a dual-write
  contract (artifact + stage-state row + **event log**), per-page SSE stage
  events, and adapters (`IStorage`/`IDatabase`/`IAuth`/`GPUBackend`).
- **Frontend:** React 19 + Vite + TS, TanStack Query, Zustand (theme), Konva
  canvas, OpenAPI-generated types, SSE hooks, word-delete undo buffer. No
  XState yet.
- **Shared library:** `@pdomain/pdomain-ui` (AppShell, tokens, primitives) is
  already a dependency.

**Reuse the plumbing:** OpenAPI client + codegen, SSE hooks (wrap them as XState
actors), Konva canvas components, the undo buffer, and all backend stage
execution code (old micro-stages fold into the new 24 stages as internal
steps — see the spec §4.2). Rebuild the **surfaces**; delete each old route when
its replacement lands.

## Locked decisions (do not relitigate)

1. **Full convergence** — backend re-cut + frontend rebuild in one plan,
   contract-first.
2. **Backend registry re-cut to the design's 24 stages, 1:1.** Page-scoped and
   project-scoped stages per the spec §4.3. New `project_stages` state for the
   tail (source, page_order, validation → archive).
3. **Breaking change, no data migration.** Registry version stamped per
   project; mismatches get a structured "re-ingest required" error.
4. **Event-driven historized data model is a requirement.** The event store
   stays the system of record; every state-changing action (stage run, settings
   change, review decision, reorder, split, gate confirmation) appends a
   traceable event. The dual-write contract and `pgdp-prep reindex` arbiter are
   unchanged in shape, re-keyed to the v2 registry. UI machines are
   projections; the server stays authoritative via event log + SSE push.
5. **XState v5 + TanStack Query split:** machines own interaction/orchestration
   state exactly per the YAMLs; TanStack Query stays the server cache; SSE
   pushes become `STAGE_PUSH`/`STATUS_PUSH` machine events.
6. **pdomain-ui promotion:** reconcile `tokens.css` into pdomain-ui's token set;
   promote generic atoms/chrome (KeyCap, Segmented, StepDots, JobsDrawer/JobsPill,
   …) into pdomain-ui per the Phase 0 promotion list. Stage tools stay
   app-local. Use `make local-dev` linked mode while iterating.

## What the design files are (and are not)

These are **design references written as HTML prototypes** — plain untyped JSX
in `<script type="text/babel">` tags, sharing components via
`Object.assign(window, …)`, rendered inside a `DesignCanvas`/`DCSection`/
`DCArtboard` exploration grid. They are **not production code to copy in**.
Recreate them in this repo's environment (React + TS + Vite, repo conventions,
pdomain-ui components where they exist).

Strip the prototype scaffolding entirely:

- `DesignCanvas` / `DCSection` / `DCArtboard` / `CanvasNav` / per-stage
  `app.jsx` — exploration chrome, do not port. Each `DCArtboard` is one
  (component, props/state) pair; treat it as a test fixture or Storybook story.
- `*-data.js` files — hand-written sample data mimicking server responses. Use
  them to sanity-check API/data types against the real OpenAPI schema, then
  discard.
- Babel-standalone and `window`-sharing — replace with ESM modules.
- `FakeThumb`-style placeholder visuals — replace with real page-image
  rendering (Konva components already exist).

## Execution model

Work is decomposed for **parallel subagents** in the implementation plan (see
`docs/plans/` — the convergence plan produced from the spec). Summary:

- **Phase 0 (sequential):** freeze the contracts — 24-stage registry table,
  OpenAPI deltas, machine ↔ stage map, pdomain-ui promotion list, mock
  fixtures. Everything downstream builds against these frozen artifacts.
- **Track B (backend, parallel by group):** registry + DAG core + event
  vocabulary, then stage groups (image prep / OCR-text / new tail /
  project-scoped plumbing + routes + SSE).
- **Track F (frontend, parallel):** design system + pdomain-ui promotion;
  shared machines (`stageRunner`, `imageStageReview`, `pageWorkbench` — one
  definition each, instantiated with `input: { stageId, … }`) + invariant
  tests; projects shells; pipeline shell; stage tools batched by launcher group
  (Source / Image prep / OCR / Compose / Text / Pack).
- **Integration per stage group:** frontend flips mock → real.

Machine invariants that must have unit tests: two-step delete, staleness
fan-out, the validation→build→zip→submit gate chain,
`textZonesTool.APPLY_SPLIT` page-set mutation.

## Guardrails

- **Statecharts win on behavior; canvases win on appearance.** If a canvas
  shows a state the statechart doesn't model (or vice versa), flag it in
  `IMPLEMENTATION_NOTES.md` rather than silently inventing a resolution.
- Derived data stays derived — page labels, dot colors, counts, badge tones are
  projections, never stored state (statecharts README, pattern 5).
- Server-authoritative status: optimistic intents reconciled by
  `STAGE_PUSH`/`STATUS_PUSH` over the existing SSE channel.
- Every mutating route appends its event(s); no state change bypasses the event
  log.
- Preserve `data-screen-label` / `data-comment-anchor` attributes where the
  designs place them.
- No `!important`. No new token names where pdomain-ui/`tokens.css` already has
  one.
- Keep commits reviewable: one commit per task; stage tools batched by group.
  Repo rules apply (`make ci AI=1` before committing; no pushes without
  say-so; no GitHub PRs).

## Done when

- The backend registry is the 24 design stages; old projects fail fast with the
  re-ingest error; `pgdp-prep reindex` rebuilds state from events + artifacts
  under the v2 registry.
- Every machine in `statecharts/` has a typed XState v5 implementation with its
  guards/actions/services dictionaries filled in, and tests for the invariants
  above.
- Every `final/<stage>/` canvas state is reproducible in the app (fixture or
  story per artboard).
- The app runs end-to-end: create project → import → run pipeline stages →
  resolve flags → validate → build → zip → submit-check → archive.
- `IMPLEMENTATION_NOTES.md` exists and is honest about gaps.
