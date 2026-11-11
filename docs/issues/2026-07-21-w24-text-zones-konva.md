---
Status: active
Owner: CT
Created: 2026-07-21
Last verified: 2026-11-11
Kind: issue
Level: I1
---

# TextZonesTool is schematic; Konva zone/split UI deferred (W2.4)

## Agent Index

- **Kind:** issue
- **Status:** active
- **Level:** I1
- **Last verified:** 2026-11-11
- **Resolution:** Fixed on `feat/night-prep4`, awaiting merge
- **Severity:** Medium — split/zone QA blocked on schematic canvas; W0.5 body contract is shipped
- **Affected version:** pdomain-prep-for-pgdp main (2026-07-21 review)
- **Read when:** implementing text_zones hi-fi Konva board, split overlays, or after W0.5 split contract lands
- **Search terms:** TextZonesTool, Konva, zone-canvas-area, split-preview-canvas, schematic zone, APPLY_SPLIT,
  ZoneCardThumb, I1: Konva, text_zones
- **Relates to:** [Pipeline completion review and continuation plan](../plans/2026-07-21-pipeline-completion-review.md)

## Summary

`TextZonesTool` is registered and has real-ish service wiring for some
routes, but the visual surface is schematic: zone card thumbs are CSS
blocks, the page canvas is a placeholder labeled “Page canvas with zone
overlays (I1: Konva)”, and split preview is “Split preview (I1: Konva)”.
Design-level split/zone editing on a real page image is not available.
W0.5 (the APPLY_SPLIT body) shipped on 2026-11-06. See
[Book path contracts](../architecture/03-pipeline.md#book-path-contracts).
Wave 2.4 done when “Design-level split works on a real page.”

## Impact

- Users cannot draw/adjust zones or verify split gutters on actual page
  imagery inside the tool.
- Contour-only backend zones (PARTIAL stage) remain hard to review.
- Split UX still needs this Konva surface before a proofer can validate a
  split on a real page image. The request body itself is shipped.
- Parent plan rates text_zones frontend FUNCTIONAL (machine/tabs exist).
  Design-handoff Konva boards remain fidelity backlog.

## Environment / versions

```
repo: pdomain-prep-for-pgdp
review date: 2026-07-21
UI: frontend/src/pages/pipeline/tools/TextZonesTool.tsx
services: frontend/src/services/tools/textZonesTool.ts
machine: frontend/src/machines/tools/textZonesTool.ts
dependency: W0.5 shipped — docs/architecture/03-pipeline.md (Book path contracts)
design: docs/plans/design_handoff_pgdp_app/final/text_zones/
parent plan: docs/plans/2026-07-21-pipeline-completion-review.md §Wave 2 W2.4
```

## Evidence

### Current source verification — 2026-11-07

W0.5 split-body translation is implemented; real page imagery and editable zone/split overlays remain absent.
Checked services/tools/textZonesTool.ts and TextZonesTool.tsx.

This is source inspection, not a fresh browser/GPU run. Older source excerpts and July review dates below
are historical snapshots; the current findings above take precedence where implementation changed.

### 1. Zone card thumbs are schematic

```64:66:frontend/src/pages/pipeline/tools/TextZonesTool.tsx
// ---------------------------------------------------------------------------
// Zone card thumbnail (schematic — no real image at F5)
// ---------------------------------------------------------------------------
```

`ZoneCardThumb` paints abstract blocks + optional dashed split guide; no
page image URL.

### 2. Explicit Konva placeholders in zone editor and split preview

```279:294:frontend/src/pages/pipeline/tools/TextZonesTool.tsx
      {/* Schematic page + zones area */}
      <div
        data-testid="zone-canvas-area"
        ...
      >
        Page canvas with zone overlays (I1: Konva)
      </div>
```

```409:423:frontend/src/pages/pipeline/tools/TextZonesTool.tsx
      {/* Schematic split preview */}
      <div
        data-testid="split-preview-canvas"
        ...
      >
        Split preview (I1: Konva)
```

What it proves: Konva (or any real canvas overlay) was never landed; labels
document intentional deferral.

### 3. Header still describes F5 mock heritage

File header: “At F5: mock-only wiring… At I1: replace the mock services…”.
Meanwhile `buildRealTextZonesToolServices` exists and maps several routes —
service layer is ahead of the visual surface.

### 4. Split body contract shipped (W0.5)

The service now parses the scan index and posts suffixes, normalized boxes, `split_at_stage=text_zones`,
and `normalized=true` to the page split route. W0.5 shipped with API and service tests.
The remaining work is real imagery and editable zone/gutter overlays, then end-to-end UI verification.

### 5. Plan done-when

Wave 2.4: “text_zones Konva split / zone overlays” → “Design-level split
works on a real page.”

## Root-cause hypotheses

1. **(Most likely) Deliberate F5 schematic not replaced** — the split service contract shipped,
   but the visual surface still lacks real image/overlay binding.
2. **Real services partially landed without image/overlay binding** —
   redetect/layout routes may return zones, but UI never maps them onto an
   image layer.
3. **Missing shared image stage component** — no reuse of Source/ISR image
   viewer + Konva layer stack yet; each tool reinvented placeholders.

## Defects to fix

1. **Schematic zone/split canvases** — replace with real page image + Konva
   (or equivalent) overlays for zones and split gutters. (Primary)
2. **Schematic zone card thumbs** — real post_transform_crop / text_zones
   parent imagery (same honesty theme as W2.1).
3. **Interactive split integration** — use the shipped W0.5 body contract; verify a design-level split
   on a real page end-to-end.
4. **Wire redetect/persist layout results into the canvas**, not only
   machine context totals.

## Next steps

1. Reuse the shipped W0.5 API/service contract while building real overlays.
2. Read design handoff under `docs/plans/design_handoff_pgdp_app/final/text_zones/`
   for required gestures (zone drag, gutter drag, split into a/b).
3. Spike: Konva stage over artifact image with one zone rect + one gutter
   line from fixture layout JSON.
4. TDD service contract (owned by W0.5) + component tests for canvas
   testids rendering overlays from props (not placeholder text).
5. Exit: on a real page, user adjusts split gutter and APPLY_SPLIT creates
   sibling pages; overlays match stored bboxes.

## What is NOT broken (to scope the fix)

- TOOL_REGISTRY `text_zones` entry and three-tab shell.
- Backend contour zone detection exists (PARTIAL depth — contour-only is a
  separate quality gap, not this UI issue).
- Dependency on Wave 0 multi-page run / attestation is out of scope here.
- Full scanno/OCR canvas work is other stages.

## Resolution

Fixed on `feat/night-prep4`, not yet merged. Retire this report through `doc-retirer` after merge.

- Page cards show the page's ingest thumbnail. Split children now get a thumbnail of their own crop at split time.
- The zone editor is a Konva board over the `post_transform_crop` image, falling back to the ingest thumbnail. It
  draws the stored zones from the pages aggregate, adds a zone by dragging, and re-types or deletes zones from a list.
- Save layout and Keep as one now call the layout route and close only on success. Before, both were no-ops.
- The zone editor opens the split editor for any page. The split editor shows the source image with the gutter,
  moves it by dragging or with a slider, previews both children, and applies the split.
- The pages aggregate keys rows by the zero-padded `idx0` and carries `idx0` and `_zones`. Rows were keyed by prefix,
  so per-page calls parsed `p0001` as `NaN`.

Verified in Chromium by `tests/e2e/test_text_zones_canvas_browser.py`: stored zones on the page image, a drawn zone
saved and read back, and a dragged 40% gutter producing children with crops `(0, 0, 320, 600)` and
`(320, 0, 480, 600)` on an 800x600 scan.

Not done: the lasso tool, drag-to-reorder reading order, "apply to all splits", and the zone-type chart on the
Overview tab. The detector still suggests no splits, so the Splits filter stays at zero.
