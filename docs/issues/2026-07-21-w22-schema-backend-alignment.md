---
Status: active
Owner: CT
Created: 2026-07-21
Last verified: 2026-07-21
Kind: issue
Level: I1
---

# stageSchemas knobs do not match backend settings; draft ignored on rerun (W2.2)

## Agent Index

- **Kind:** issue
- **Status:** active
- **Level:** I1
- **Last verified:** 2026-07-21
- **Resolution:** Open
- **Severity:** High — UI implies tunable image prep that does not change output
- **Affected version:** pdomain-prep-for-pgdp main (2026-07-21 review)
- **Read when:** changing image-stage settings UI, StageSettingsStore keys, or ISR rerun payload; or debugging
  “threshold slider does nothing”
- **Search terms:** stageSchemas, sauvola, adaptive, threshold_level, dewarp stiffness, thin_plate_spline, reRunPages,
  `_draft`, denoise blobSizeMin, maxAngleDeg, post_transform_crop insets
- **Relates to:** [Pipeline completion review and continuation plan](../plans/2026-07-21-pipeline-completion-review.md)

## Summary

`frontend/src/pages/pipeline/tools/stageSchemas.ts` exposes design-era control
keys (Sauvola/adaptive threshold, dewarp TPS/stiffness, denoise blob sizes,
deskew algorithms) that do not match `ResolvedPageConfig` /
`STAGE_SETTINGS_DEFAULTS` / stage registry callables. On top of the schema
fiction, ISR `reRunPages` takes a `draft` argument and **discards it**
(`_draft`), posting only `page_ids`. Changing a slider and clicking Re-run
cannot change threshold output. Wave 2.2 done when “Changing threshold level
changes output.”

## Impact

- Proofers believe they are tuning binarization/deskew/denoise/dewarp when
  controls are either ignored or map to non-existent backend knobs.
- Silent wrong mental model: accept-as-is and rerun look productive; output
  stays at registry/project defaults.
- Blocks honest image-prep QA even after real thumbs (W2.1).
- post_transform_crop schema margins (`marginTop` etc.) do not match backend
  `post_transform_crop_insets` tuple — same class of defect.

## Environment / versions

```
repo: pdomain-prep-for-pgdp
review date: 2026-07-21
UI schemas: frontend/src/pages/pipeline/tools/stageSchemas.ts
ISR services: frontend/src/services/tools/imageStageReview.ts
backend settings: src/pdomain_prep_for_pgdp/core/pipeline/stage_settings.py
config model: src/pdomain_prep_for_pgdp/core/models.py (ResolvedPageConfig)
registry: src/pdomain_prep_for_pgdp/core/pipeline/stage_registry.py
parent plan: docs/plans/2026-07-21-pipeline-completion-review.md §Wave 2 W2.2
```

## Evidence

### 1. Threshold UI offers Sauvola / adaptive; backend is level or Otsu

UI (`THRESHOLD_SCHEMA`):

- `method`: `sauvola` | `otsu` | `adaptive` (default sauvola)
- `threshold` slider 0–255 (default 140)
- `windowSize`, `kFactor` for Sauvola/adaptive

Backend `_threshold_cpu`:

```253:270:src/pdomain_prep_for_pgdp/core/pipeline/stage_registry.py
def `_threshold_cpu`(image: ImageArray, cfg: StageConfig = None) -> ImageArray:
    """Binarise a 2-D grayscale ndarray.

    When ``cfg.threshold_level`` is set, applies a fixed-level binary threshold.
    Otherwise falls back to Otsu auto-thresholding.
    """
    if cfg is not None and cfg.threshold_level is not None:
        ...
        return binary_thresh(image, level=cfg.threshold_level)
    ...
    return otsu_binary_thresh(image)
```

`ResolvedPageConfig` field is `threshold_level: int | None`. There is no
Sauvola/adaptive path in the v2 registry. `STAGE_SETTINGS_DEFAULTS` has **no
threshold entry** today.

What it proves: method / windowSize / kFactor are design fiction relative to
shipped CPU threshold.

### 2. Denoise schema names ≠ backend params

UI: `blobSizeMin`, `blobSizeMax`, `protectFootMarks`.

Backend / settings:

- `STAGE_SETTINGS_DEFAULTS["denoise"]`: `min_component_area`, `median_kernel_size`
- `ResolvedPageConfig`: `denoise_min_component_area`, `denoise_median_kernel_size`,
  `skip_denoise`
- `_denoise_cpu` uses `min_component_area` + `median_kernel_size` only

### 3. Deskew schema ≠ backend knobs

UI: `maxAngleDeg`, `algorithm` ∈ {projection, hough, auto}.

Backend: `skip_auto_deskew` (registry default **True** = skip), plus
legacy angles `deskew_before_crop` / `deskew_after_crop` on config —
not max-angle or algorithm select. Stage settings default is only
`{"skip_auto_deskew": True}`.

### 4. Dewarp schema is pure design fiction; impl ignores cfg

UI: `model` thin_plate_spline | polynomial | cylinder, `stiffness`,
`gutterRemove`.

Backend `_dewarp_cpu`:

```876:882:src/pdomain_prep_for_pgdp/core/pipeline/stage_registry.py
    _ = cfg
    TextlineDisparityDewarp = cast(
        "type",
        `_load_attr`("pdomain_book_tools.geometry_correction", "TextlineDisparityDewarp"),
    )

    dewarper = TextlineDisparityDewarp(prefer_gpu=False)
```

No stage-settings defaults for dewarp. Config is intentionally unused.

### 5. post_transform_crop draft schema vs insets

UI: four `marginTop/Bottom/Left/Right` sliders default **4**.

Backend: `post_transform_crop_insets: tuple[int,int,int,int] = (0,0,0,0)` and
`STAGE_SETTINGS_DEFAULTS["post_transform_crop"]` uses that tuple. Parent plan
notes default 0 insets and “draft ignored on rerun.”

### 6. ISR reRunPages drops draft

```56:66:frontend/src/services/tools/imageStageReview.ts
async function reRunPages(
  projectId: string,
  stageId: string,
  `_draft`: Record<string, unknown>,
  pageIds: string[],
): Promise<PageRow[]> {
  try {
    const result = await api.post<{ rows: PageRow[] }>(
      `/api/data/projects/${encodeURIComponent(projectId)}/project-stages/${encodeURIComponent(stageId)}/rerun`,
      { page_ids: pageIds },
    );
```

Machine type comments claim `POST …/rerun { params, pageIds }`; live body is
`{ page_ids }` only. Draft from `SET_PARAM` never reaches the runner.

### 7. canvas_map schema also mismatched (feeds W2.3 polish)

UI: targetCanvas body/a4/letter, mm margins, mirrorFacingMargins.

Backend settings: `do_morph`, `page_h_w_ratio` (default 1.294). Align schema
as part of this work or explicitly split under W2.3 — do not leave fiction.

## Root-cause hypotheses

1. **(Most likely) Design handoff schemas never reconciled with
   StageSettingsStore / registry** — F5 `stageSchemas.ts` was a WB_MAP
   analog from design JSX; W1 settings work wired grayscale (and some
   denoise/deskew/canvas keys) without rewriting ISR control defs.
2. **Rerun route is page-id-only by design of W4 Group 3** — service
   intentionally posts only `page_ids`; applying draft needs either
   page-tier settings PUT before rerun or an expanded rerun body.
3. **Missing threshold stage-settings entry** — even a correct UI key
   `threshold_level` has no defaults map entry / apply path for the stage
   settings panel, so project/all tiers cannot own it yet (ties to W2.5).

## Defects to fix

1. **Align each ISR schema control key 1:1 with backend settings /
   ResolvedPageConfig fields** (or remove the control). Primary mapping
   targets:
   - threshold → `threshold_level` (drop sauvola/adaptive unless book-tools
     lands them first)
   - denoise → `min_component_area` / `median_kernel_size` / `skip_denoise`
   - deskew → `skip_auto_deskew` (+ real angles if product wants them)
   - dewarp → either no tunable UI or real TextlineDisparityDewarp knobs
   - post_transform_crop → `post_transform_crop_insets`
2. **Apply draft on rerun** — map draft → page-tier (or request params) so
   re-run uses new values; stop ignoring `_draft`. (Primary product defect)
3. **Falsifiable threshold test** — change level, rerun, assert output
   bytes / hash differ (plan exit: “Changing threshold level changes
   output”).

## Next steps

1. Produce a one-page key map: schema key → settings key → ResolvedPageConfig
   field → registry use, per stage (threshold, deskew, denoise, dewarp,
   post_transform_crop; canvas_map optional here).
2. TDD: failing test that ISR/settings path with `threshold_level=N` yields
   different binary than Otsu/default for a synthetic gray page.
3. Rewrite `stageSchemas` controls from the map; delete fiction options.
4. Implement draft apply: PUT page-tier settings then existing rerun, **or**
   extend rerun body with params and teach job/stage runner to merge them —
   pick one contract and document it.
5. Manual check under `make run`: slider move + Re-run changes the after
   image (requires W2.1 thumbs or direct artifact GET).

## What is NOT broken (to scope the fix)

- Backend transforms themselves (Otsu/fixed threshold, denoise_binary,
  TextlineDisparityDewarp) work when cfg is set via the real config path.
- Grayscale already has nested schema + 3-tier UI (W2.5 generalizes that).
- Fake thumbs (W2.1) and canvas scatter mocks (W2.3) are separate issues.
- Deprecating fiction knobs is preferred over implementing Sauvola solely
  to match a stale schema.

## Resolution

*Open.*
