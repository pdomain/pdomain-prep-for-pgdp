---
Status: active
Owner: CT
Created: 2026-07-21
Last verified: 2026-07-21
Kind: issue
Level: I1
---

# TextZonesTool is schematic; Konva zone/split UI deferred (W2.4)

## Agent Index

- **Kind:** issue
- **Status:** active
- **Level:** I1
- **Last verified:** 2026-07-21
- **Resolution:** Open
- **Severity:** Medium — split/zone QA blocked on schematic canvas; depends on W0.5
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
**Depends on W0.5** (text_zones APPLY_SPLIT FE/BE contract) — building Konva
on a 422ing split body wastes effort. Wave 2.4 done when “Design-level split
works on a real page.”

## Impact

- Users cannot draw/adjust zones or verify split gutters on actual page
  imagery inside the tool.
- Contour-only backend zones (PARTIAL stage) remain hard to review.
- Split UX cannot be product-validated until W0.5 body alignment and this
  Konva surface both land.
- Parent plan rates text_zones frontend FUNCTIONAL (machine/tabs exist) but
  still calls out split FE/BE mismatch (B7 / W0.5) and design-handoff Konva
  boards as fidelity backlog.

## Environment / versions

```
repo: pdomain-prep-for-pgdp
review date: 2026-07-21
UI: frontend/src/pages/pipeline/tools/TextZonesTool.tsx
services: frontend/src/services/tools/textZonesTool.ts
machine: frontend/src/machines/tools/textZonesTool.ts
dependency: W0.5 — docs/issues/2026-07-21-w05-text-zones-split-contract.md
  (parent plan B7 / Wave 0 W0.5)
design: docs/plans/design_handoff_pgdp_app/final/text_zones/
parent plan: docs/plans/2026-07-21-pipeline-completion-review.md §Wave 2 W2.4
```

## Evidence

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

### 4. Split body contract still diverges (W0.5 prerequisite)

Parent plan B7: backend expects `{ bbox, split_at_stage, suffixes }`;
frontend historically `{ suffixes, bboxes }` without `split_at_stage`.

Live service still posts a divergent shape:

```103:113:frontend/src/services/tools/textZonesTool.ts
  // At I1 the endpoint accepts { suffixes, bboxes } where bboxes is a list.
  const result = await api.post<...>(
    `/api/data/projects/${encodeURIComponent(projectId)}/pages/${encodeURIComponent(pageId)}/split`,
    {
      suffixes: ["a", "b"],
      bboxes: [bboxA, bboxB],
    },
  );
```

W2.4 must not ship Konva APPLY_SPLIT until W0.5 makes this succeed in API +
service tests.

### 5. Plan done-when

Wave 2.4: “text_zones Konva split / zone overlays” → “Design-level split
works on a real page.”

## Root-cause hypotheses

1. **(Most likely) Deliberate F5 schematic + blocked on split contract** —
   design handoff required Konva; implementation stopped at tab shell and
   service stubs; W0.5 still open so interactive split was deprioritized.
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
3. **Split apply path** — only after **W0.5**: correct body including
   `split_at_stage` (and canonical bbox field names); design-level split on
   a real page must succeed end-to-end.
4. **Wire redetect/persist layout results into the canvas**, not only
   machine context totals.

## Next steps

1. **Gate:** confirm W0.5 issue closed (APPLY_SPLIT API + service test green)
   before deep Konva work.
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

*Open.*
