# Session prompt — pd-prep-for-pgdp hi-fi redesign implementation

Use the `subagent-driven-development` skill to implement the full hi-fi
redesign plan at
`docs/specs/2026-05-15-hifi-redesign-plan.md`.

## Repo context

- Repo: `/workspaces/ocr-container/pd-prep-for-pgdp`
- Branch: `main` (all prior work merged; spec committed at `9ca26e8`)
- CI: `make ci AI=1` — must stay green after every slice
- Frontend test runner: `make test AI=1` (vitest via uv)
- Spec is the **source of truth**; implement exactly what it says, no more

## What the spec covers

5 phases, 21 slices, ~5 200 LOC total. Transforms the existing M0–M4
frontend into the same five-layer design stack as `pd-ocr-labeler-spa`:

1. **Token layer** — `frontend/src/styles/tokens.css` with CSS custom
   properties for colour/spacing, light default + `[data-theme="dark"]`
2. **Tailwind rewire** — `theme.extend` pointing at `var(--…)` refs;
   Inter + JetBrains Mono fonts
3. **shadcn/Radix primitives** — Button, Badge, Progress, Separator,
   DropdownMenu, Accordion, ToggleGroup, Card, StatTile, StageCell,
   StatusPip, KeyCap, IconButton
4. **Studio-style shell** — `TopNav` (56px, always-dark), `AppShell`
   grid, `UserMenu` (DropdownMenu + theme toggle), `SearchModal` (⌘K)
5. **Page-by-page restyling** — ProjectList, ProjectConfigure (+ tabs +
   PageDrawer), PageWorkbench, TextReview, Jobs, ReviewQueue, Settings,
   Login

## Slice order and dependencies

Read `§5` of the spec for the full slice-by-slice spec text and
dependencies. The dependency graph:

```
P0-1 → P0-2 → P0-3
                 └→ P0-4
P0-1 → P0-5
P0-4, P1-1(←P0-4) → P1-2(←P1-1,P0-5) → P1-3(←P1-1)
P0-4, P1-1 → P2-1 → P2-2 → P2-3
P0-3, P0-4, P1-1 → P2-4 → P2-5
P0-3, P0-4, P1-1 → P2-6
P3-1..P3-4  (independent after P2)
P4-1, P4-2(←P1-2), P4-3(←P2-6)  (independent of each other)
```

Implement strictly in dependency order. Do not start a slice until all
its listed dependencies are ✅.

## Rules for every slice

- Start a new feature branch for the whole redesign (`feat/hifi-redesign`)
  before the first slice; all slice commits land on it.
- `make ci AI=1` must pass before committing each slice. If it fails,
  fix before moving to the next slice.
- No route/API/OpenAPI changes — backend is frozen.
- No `data-testid` removals — the e2e contract is preserved.
- Generated `frontend/src/api/types.gen.ts` is untouched.
- Tailwind 3.4 stays (no v4 migration).
- Each new primitive gets its own `.test.tsx` in the same slice.
- Token utilities only in new/restyled components — no raw `slate-*`.
- Commit message per slice: `feat(hifi): <slice-id> — <one-line summary>`

## Key decisions (locked 2026-05-15)

- Header height: **56px** (not labeler-spa's 40px)
- ⌘K: **global full-screen SearchModal** (Radix Dialog wrapping
  existing `SearchPanel`; `useHotkeys("mod+k")` on any route)
- `AwaitingReviewBanner`: **project-scoped routes only** (`/projects/:id/*`)
- Dark mode: **UserMenu Light/Dark/System toggle** + localStorage key
  `pgdp.uiPrefs.theme`; `[data-theme]` written to `document.documentElement`

## Sibling reference

The labeler-spa hi-fi spec at
`../pd-ocr-labeler-spa/docs/specs/2026-05-15-hifi-redesign-plan.md`
is the upstream reference for token names, primitive APIs, and the
shadcn/CVA patterns. When in doubt, match labeler-spa naming exactly
so the two apps stay shape-compatible for a future `pd-ui` extraction.

## Start

Read `docs/specs/2026-05-15-hifi-redesign-plan.md` fully, extract all
21 slices with their full spec text, then proceed slice-by-slice using
the subagent-driven-development skill (implementer → spec reviewer →
code quality reviewer per slice).
