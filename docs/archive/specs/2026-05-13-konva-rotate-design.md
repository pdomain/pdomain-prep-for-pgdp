# Konva canvas rotate handles for workbench

> **Status**: Draft
> **Last updated**: 2026-05-13
> **Spec-Issue**: ConcaveTrillion/pdomain-prep-for-pgdp#13

## TL;DR

Enable free-rotate on the Konva canvas for the workbench page image. Rotation
angle writes to `ProjectConfigOverrides.manual_deskew_angle` and queues
`manual_deskew_pre` to re-run. Flip is out of scope for this spec.

## Context

The Konva Transformer on `PageWorkbenchPage` has `rotateEnabled=false`. Proofers
occasionally need to correct scanner-frame skew that the `auto_deskew` stage
cannot fix (e.g. book tilted >15° in the scanner). Exposing rotate handles lets
the user set a manual angle that is persisted in `ProjectConfigOverrides` and
re-runs `manual_deskew_pre`.

Spec 06 does not mention rotate, so this is an additive affordance; it must not
break the existing illustration-region-draw or word-bbox-select interactions.

## Constraints

- Must not conflict with the existing marquee word-select or illustration
  region draw mode — rotate handle should only be active in a distinct "rotate
  mode" toggled by a toolbar button.
- Angle written to config must survive page reload (persisted server-side).
- Stage re-run triggered by applying the angle must use the existing
  `POST /stages/manual_deskew_pre/run` route with the new `ResolvedPageConfig`
  plumbing (spec `#81` / `#87`).
- Flip is deferred: too much scope for a rare use case, and `manual_deskew_pre`
  does not currently have a flip impl in the stage registry.
- Discrete 90° CW / 90° CCW / 180° orientation buttons must be provided for
  plates printed sideways or upside-down in a book — free-rotate alone is
  insufficiently precise for this coarse-correction use case.

## Decision

### Rotate mode

A "Rotate" toggle button in the `ModeToolbar` (alongside existing Draw/Select
modes). When active:

- The Konva Transformer switches to `rotateEnabled=true`,
  `resizeEnabled=false`, `borderEnabled=true`.
- The page image node is the transform target (not a word bbox or illustration
  region node).
- Dragging the rotate handle updates a local `draftAngle` state (degrees,
  float, ±180 range).
- An angle readout (e.g. `"−3.5°"`) renders in the toolbar while rotate mode
  is active.
- "Apply" button in the toolbar (or pressing Enter) commits the angle.
- "Reset" button sets `draftAngle = 0` and re-enables the apply path.
- Pressing Escape exits rotate mode without applying.

### Persistence and re-run

On "Apply":

1. `PATCH /api/data/projects/{id}/config-overrides` (or per-page equivalent)
   writes `{"manual_deskew_angle": <draftAngle>}` into the page's
   `ProjectConfigOverrides`.
2. `POST .../stages/manual_deskew_pre/run` fires to re-run the stage with the
   new angle (uses the `ResolvedPageConfig` plumbing from spec `#87`).
3. The `StageChainRail` chip for `manual_deskew_pre` transitions
   `not-run/dirty → running → clean` as normal.
4. Rotate mode exits automatically after a successful run.

If `manual_deskew_pre` is currently `clean` and already has an angle, entering
rotate mode pre-fills `draftAngle` from the stored config value so the user
sees the current angle.

### Discrete orientation buttons

Three buttons in the rotate-mode toolbar: **90° CW**, **90° CCW**, **180°**.
Each button:

1. Adds ±90° or 180° to the current `draftAngle` (wraps within ±180°).
2. Immediately triggers the Apply path (PATCH config + POST re-run) without
   requiring a separate "Apply" click — orientation corrections are deliberate,
   not exploratory.

This covers the common case of a full-page plate scanned sideways or
upside-down, where free-rotate is unnecessarily imprecise.

### Angle range and precision

- Free-rotate (Konva default): any angle ±180°.
- Displayed and stored to one decimal place (e.g. `−3.5`).
- No snap-to-grid — free-rotate is a fine-correction tool. Coarse corrections
  use the discrete orientation buttons.

## Contract / Acceptance

- [ ] "Rotate" button in `ModeToolbar` toggles rotate mode.
- [ ] In rotate mode, Konva shows rotate handle on the page image; drag updates
  the angle readout in the toolbar in real time.
- [ ] Illustration-region-draw and word-bbox-select modes are mutually exclusive
  with rotate mode (switching mode resets the transformer).
- [ ] "Apply" → `PATCH` config + `POST .../manual_deskew_pre/run`; chip
  transitions to `clean`.
- [ ] "Reset" clears `draftAngle` to 0; if applied, clears the config override
  and re-runs.
- [ ] Escape exits rotate mode with no write.
- [ ] Entering rotate mode on a page that already has a stored angle pre-fills
  the readout with the stored value.
- [ ] Flip affordance is absent from the UI (scope deferred).
- [ ] 90° CW, 90° CCW, 180° buttons appear in the rotate-mode toolbar.
- [ ] Each discrete button immediately fires PATCH config + POST re-run (no
  separate "Apply" step).
- [ ] Discrete buttons update `draftAngle` by ±90° or 180°, wrapping within
  ±180°.
- [ ] Vitest: toolbar button toggles mode; Apply fires PATCH + POST; Escape
  cancels; discrete buttons fire immediately.
- [ ] Existing word-bbox and illustration-region tests are unaffected.

## Trade-offs considered

**Discrete 90°/180° buttons vs free-rotate.** Both are needed: free-rotate for
fine skew correction (sub-5° scanner tilt), discrete buttons for coarse
orientation correction (plates printed sideways or upside-down in a book).
The two affordances are complementary, not alternatives.

**View-state only (no persistence).** Simpler — no config write, no re-run.
But the correction is lost on page reload, making it useless for the actual
workflow (correct scan skew → review OCR → build package). Persistence is
required.

**Include flip.** Horizontal flip could correct mirror-scanned pages. But
`manual_deskew_pre` has no flip impl in the stage registry; adding it requires
both backend registry work and frontend affordance in the same slice. Deferred
to keep scope tight.

**Undo.** Rotate/flip is a config change, not a word-data mutation — "Reset"
is sufficient. Participating in the word-delete undo window (spec `#12`) would
require cross-cutting state management that is not worth the complexity here.

## Consequences

- `manual_deskew_pre` stage gains a config-aware path via `ResolvedPageConfig`
  plumbing (spec `#87`). This spec depends on `#87` being landed first (or
  concurrently).
- A new `manual_deskew_angle` field appears in `ProjectConfigOverrides` (or
  per-page config overrides). The OpenAPI spec and `types.gen.ts` regenerate
  automatically.
- `ModeToolbar` gains a third mode. Existing mode-switching logic needs to
  include "rotate" in the mutual-exclusion set.

## Open questions

None — flip, undo, and snap-to-grid decisions all closed above.

## References

- `docs/plans/roadmap.md` §P2 "#10" — rotate/flip context
- `docs/specs/2026-05-13-m4-migration-disk-cost-design.md` §Decision — for
  contrast on how stage config writes are structured
- `frontend/src/pages/PageWorkbenchPage.tsx` — existing Konva canvas and
  ModeToolbar
- `src/pd_prep_for_pgdp/core/models.py` — `ProjectConfigOverrides` shape
- Issue `#87` — ResolvedPageConfig plumbing (prerequisite)
