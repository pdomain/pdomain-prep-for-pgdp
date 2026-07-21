---
Status: active
Owner: CT
Created: 2026-07-21
Last verified: 2026-07-21
Kind: issue
Level: I1
---

# CanvasMapTool aspect scatter and page rows use mock data (W2.3)

## Agent Index

- **Kind:** issue
- **Status:** active
- **Level:** I1
- **Last verified:** 2026-07-21
- **Resolution:** Open
- **Severity:** Medium — canvas_map review surface is THIN / schematic
- **Affected version:** pdomain-prep-for-pgdp main (2026-07-21 review)
- **Read when:** upgrading canvas_map UI, wiring aspect scatter or spreads, or assessing TOOL_REGISTRY fidelity for
  canvas_map
- **Search terms:** CanvasMapTool, AspectScatterPlaceholder, mockPages, canvas-map-aspect-scatter, page_h_w_ratio,
  spreads, mock scatter, makeCanvasMapServices
- **Relates to:** [Pipeline completion review and continuation plan](../plans/2026-07-21-pipeline-completion-review.md)

## Summary

`CanvasMapTool` wraps `ImageStageReviewTool` with canvas_map extras, but the
aspect scatter is hard-coded mock points and the stage services factory
seeds four fake `mockPages`. Backend `canvas_map` is a real FULL (+ GPU)
stage that maps content onto a common canvas using `page_h_w_ratio` and
alignment. Frontend never plots real page dimensions or spreads from
artifacts / page attrs. Wave 2.3 done when “Mock points removed.”

## Impact

- Proofer cannot see real body-cluster vs outlier pages (plates, foldouts).
- Re-derive / review UX looks complete while data is fiction — same honesty
  class as W2.1 fake thumbs.
- Parent plan frontend ladder rates canvas_map **THIN / MOCK**.
- Completeness matrix highest gap: “Mock scatter services in UI.”

## Environment / versions

```
repo: pdomain-prep-for-pgdp
review date: 2026-07-21
UI: frontend/src/pages/pipeline/tools/CanvasMapTool.tsx
registry: `_canvas_map_cpu` / `_canvas_map_v2_cpu` (+ GPU) in stage_registry.py
settings: STAGE_SETTINGS_DEFAULTS["canvas_map"] → do_morph, page_h_w_ratio
attrs: `_auto_detect_attrs_cpu` emits height, width, h_w_ratio
parent plan: docs/plans/2026-07-21-pipeline-completion-review.md §Wave 2 W2.3
```

## Evidence

### 1. Hard-coded scatter points

```94:106:frontend/src/pages/pipeline/tools/CanvasMapTool.tsx
function AspectScatterPlaceholder() {
  // Mocked body-cluster points (schematic only — real data from I1 API)
  const points = [
    { x: 0.41, y: 0.51, body: true },
    { x: 0.42, y: 0.52, body: true },
    { x: 0.43, y: 0.5, body: true },
    { x: 0.42, y: 0.53, body: true },
    { x: 0.44, y: 0.49, body: true },
    { x: 0.4, y: 0.54, body: true },
    { x: 0.22, y: 0.35, body: false }, // outlier: plate
    { x: 0.55, y: 0.7, body: false }, // outlier: foldout
    { x: 0.18, y: 0.18, body: false }, // outlier: initial
  ];
```

`data-testid="canvas-map-aspect-scatter"` always renders this set.

### 2. Mock stage page services

```45:60:frontend/src/pages/pipeline/tools/CanvasMapTool.tsx
function makeCanvasMapServices(projectId: string, stageId: string) {
  const mockPages = Array.from({ length: 4 }, (_, i) => ({
    idx: `page-${i + 1}`,
    prefix: `p${String(i + 1).padStart(3, "0")}`,
    state: "clean" as const,
    ...
  return {
    fetchStagePages: () =>
      Promise.resolve({
        rows: mockPages,
        totals: {
          total: 4,
          done: 4,
```

What it proves: canvas_map tool does not use `buildRealImageStageReviewServices`
for page rows; extras sit on a mock machine feed.

### 3. File header admits deferred fidelity

Comments state full spread/overview views deferred to I1; F5 only required
TOOL_REGISTRY registration + schema + ISR shell. Design references
CmapOverview / CmapSpreads from design handoff remain unimplemented with
real data.

### 4. Backend has real geometry; UI schema still fiction

`_canvas_map_cpu` uses `cfg.page_h_w_ratio` (default 1.294) and
`cfg.alignment` with `map_content_onto_scaled_canvas`. Settings defaults:

```86:89:src/pdomain_prep_for_pgdp/core/pipeline/stage_settings.py
    "canvas_map": {
        "do_morph": False,
        "page_h_w_ratio": 1.294,
    },
```

`_auto_detect_attrs_cpu` returns `height`, `width`, `h_w_ratio` per page —
natural scatter inputs. UI `CANVAS_MAP_SCHEMA` still exposes mm margins /
targetCanvas body|a4|letter (W2.2 alignment debt).

## Root-cause hypotheses

1. **(Most likely) F5 registration shell never replaced mock factory** —
   `makeCanvasMapServices` was a stand-in; real ISR services exist for
   other stages but CanvasMapTool still constructs local mocks.
2. **No aggregate API for aspect points / spreads** — even with real page
   rows, scatter needs width/height (or ratio) per page; that may live only
   in source attrs or image headers, not in the current pages-aggregate
   shape. Confirm by checking canvas_map / auto_detect artifact consumers.
3. **Spreads require page_order / verso-recto pairing** — facing-page
   mirror summary may need ordering metadata not yet joined into the tool.

## Defects to fix

1. **Remove mock scatter points** — plot real per-page aspect (or w/h)
   from stage/page metadata. (Primary)
2. **Replace `makeCanvasMapServices` mock rows** with real fetch (shared
   ISR services or canvas_map aggregate).
3. **Spreads summary from real facing pairs** (or hide until data exists —
   do not keep fictional mirror status).
4. **Align extras controls with `do_morph` / `page_h_w_ratio`** (coordinate
   with W2.2 if schemas stay in stageSchemas).

## Next steps

1. Locate real dimension sources: auto_detect `output.json` attrs, source
   image headers, or canvas_map run metadata.
2. Define a minimal scatter DTO: `{ pageId, width, height, ratio, body? }[]`
   and a service that fills it for the open project.
3. TDD: with N fixture pages of known sizes, scatter renders N points at
   expected relative positions; assert mock constant list is gone.
4. Wire CanvasMapTool to real services; keep AspectScatter only as a
   presentational component over props.
5. Exit check: open canvas_map on a multi-page book — points move when
   pages differ; no hard-coded plate/foldout outliers.

## What is NOT broken (to scope the fix)

- Backend canvas_map image transform and GPU path.
- TOOL_REGISTRY entry and machine extras hooks (REDERIVE event surface).
- Image-stage fake thumbs in shared ISR (W2.1) — fix shared or pass real
  thumbs through once services are real.
- Full design-handoff multi-tab Cmap artboard is fidelity backlog beyond
  “mock points removed.”

## Resolution

*Open.*
