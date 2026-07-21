---
Status: active
Owner: CT
Created: 2026-07-21
Last verified: 2026-07-21
Kind: issue
Level: I1
---

# ImageStageReviewTool uses synthetic paper thumbs and a wipe placeholder (W2.1)

## Agent Index

- **Kind:** issue
- **Status:** active
- **Level:** I1
- **Last verified:** 2026-07-21
- **Resolution:** Open
- **Severity:** Medium — image-prep visual QA is fake for threshold–dewarp
- **Affected version:** pdomain-prep-for-pgdp main (2026-07-21 review)
- **Read when:** implementing Wave 2 image-prep honesty, wiring stage artifact images into ISR, or judging
  ImageStageReviewTool maturity
- **Search terms:** ImageStageReviewTool, PageThumb, wipe-viewer, fake thumbs, synthetic paper, before/after wipe, stage
  artifact, threshold deskew denoise dewarp
- **Relates to:** [Pipeline completion review and continuation plan](../plans/2026-07-21-pipeline-completion-review.md)

## Summary

Shared `ImageStageReviewTool` is the review surface for threshold, deskew,
denoise, dewarp, post_transform_crop (and related image stages). Grid
thumbnails are hand-drawn CSS paper with simulated ink lines, not stage
artifacts. The inline editor “before/after wipe” is a labeled placeholder
with no images. A proofer cannot visually QA image-prep results inside the
pipeline shell for the stages that need it most.

## Impact

- Visual QA for threshold–dewarp is effectively dead in the shared surface.
- Flag review and accept/rerun can proceed without the user ever seeing the
  real parent or output image.
- Wave 2 exit criterion (“proofer can visually QA image prep without
  leaving the pipeline shell”) cannot pass while synthetic paper remains.
- Source stage already has a real-thumb pattern (`source/RealThumb.tsx`);
  ISR lags that pattern and trains users to distrust the review grid.

## Environment / versions

```
repo: pdomain-prep-for-pgdp
review date: 2026-07-21
frontend: frontend/src/pages/pipeline/tools/ImageStageReviewTool.tsx
artifact API: GET /api/data/projects/{id}/pages/{idx0}/stages/{stage_id}/artifact
  (src/pdomain_prep_for_pgdp/api/data/pages.py — get_page_stage_artifact)
parent plan: docs/plans/2026-07-21-pipeline-completion-review.md §Wave 2 W2.1
```

## Evidence

### 1. Fake page thumbnails in the flag grid

`PageThumb` is explicitly labeled fake and paints a CSS paper block with a
repeating-linear-gradient “ink lines” pattern and a prefix label — no
`<img>` and no artifact URL:

```250:288:frontend/src/pages/pipeline/tools/ImageStageReviewTool.tsx
/** Fake page thumbnail for the grid */
function PageThumb({ row }: { row: PageRow }) {
  const isFlagged = row.state === "flagged";
  return (
    <div
      data-testid={`page-thumb-${row.idx}`}
      ...
        background: isFlagged ? "oklch(0.92 0.02 60)" : "oklch(0.93 0 0)",
      ...
      {/* Simulated page content */}
      <div
        style={{
          ...
          backgroundImage: `repeating-linear-gradient(to bottom, oklch(0.32 0 0) 0 1.5px, transparent 1.5px 6px)`,
```

What it proves: grid thumbs never load stage PNGs for any ISR stage.

### 2. Before/after wipe is a text-only placeholder

Inline editor wipe region is a 160px split pane with the strings “before”
and “after”; no image sources, no drag-wipe over real pixels:

```498:537:frontend/src/pages/pipeline/tools/ImageStageReviewTool.tsx
      {/* Before/after wipe placeholder */}
      <div
        data-testid="wipe-viewer"
        style={{
          height: 160,
          background: "var(--bg-page)",
          display: "grid",
          gridTemplateColumns: "1fr 6px 1fr",
        }}
      >
        ...
          before
        ...
          after
```

What it proves: the wipe control is UI chrome only.

### 3. Real artifact endpoint already exists on the backend

`GET …/pages/{idx0}/stages/{stage_id}/artifact` serves dual-written stage
output (`get_page_stage_artifact` in `api/data/pages.py`). Source already
uses live thumbs via `source/RealThumb.tsx` + ingest thumbnail URLs. ISR
does not consume the stage artifact route for parent or child images.

### 4. Plan classification

Parent plan completeness matrix: ISR image stages are **FUNCTIONAL** on
controls/machine wiring, but secondary gap “Image-prep UI honesty” states
shared ISR “shows fake thumbs and a wipe placeholder.” Wave 2.1 done when:
“No synthetic paper for threshold–dewarp.”

## Root-cause hypotheses

1. **(Most likely) F5 mock surface never upgraded for images** —
   `ImageStageReviewTool` header still documents F5 layout and “mock
   service adapter” heritage; thumbs and wipe were deliberately schematic
   until an I1 image pass. Confirms if no artifact URL builder exists in
   ISR services.
2. **Services fetch page rows without image keys** — even after real
   `buildRealImageStageReviewServices`, row shape may lack
   before/after URLs, so the component has nothing to render. Distinguishes
   by inspecting fetchStagePages response mapping.
3. **Thumb generation path is source-only** — ingest thumbs exist; stage
   outputs may only be full `output.png` with no downscaled CDN key, making
   full-res loads expensive. Would confirm need for on-the-fly resize or
   stage thumb dual-write.

## Defects to fix

1. **Synthetic grid thumbs** — replace `PageThumb` fake paper with real
   stage (or parent) artifact images for threshold–dewarp (and other ISR
   stages that share the surface). (Primary)
2. **Wipe placeholder** — wire before = parent stage output, after =
   current stage output (or draft preview when available); real wipe or
   side-by-side at minimum.
3. **Missing image URL contract on PageRow / services** — ensure fetch and
   re-run responses (or client-side URL builders) supply stable image URLs
   for both sides of the comparison.

## Next steps

1. Inventory existing artifact/thumbnail routes and how Source
   `RealThumb` builds URLs; prefer reuse over a third pattern.
2. Add failing component tests: grid thumb is an `<img>` (or RealThumb)
   with stage artifact src; wipe-viewer contains image content, not only
   “before”/“after” labels.
3. Implement URL builder + `PageThumb` / wipe viewer; keep FakePaper only
   as loading/error fallback (same as Source).
4. Spot-check threshold and dewarp after a real stage run under
   `make run` / focused frontend tests; no synthetic paper on those
   stages (W2.1 exit).

## What is NOT broken (to scope the fix)

- Backend image stages (threshold, deskew, denoise, dewarp) have real CPU
  (and often GPU) callables dual-writing image artifacts.
- ISR machine, flag grid selection, and control editor chrome exist.
- Source hi-fi thumbs (`RealThumb`) are a working reference, not the defect.
- Schema-vs-backend param honesty is **W2.2**, not this issue.

## Resolution

*Open.*
