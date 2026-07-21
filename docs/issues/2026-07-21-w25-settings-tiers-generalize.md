---
Status: active
Owner: CT
Created: 2026-07-21
Last verified: 2026-07-21
Kind: issue
Level: I1
---

# 3-tier stage settings UI is polished only on grayscale (W2.5)

## Agent Index

- **Kind:** issue
- **Status:** active
- **Level:** I1
- **Last verified:** 2026-07-21
- **Resolution:** Open
- **Severity:** Medium — shared backend tiers exist; only grayscale exposes full page/project/all UX
- **Affected version:** pdomain-prep-for-pgdp main (2026-07-21 review)
- **Read when:** generalizing settings tiers beyond grayscale, or implementing threshold/deskew/denoise settings panels
- **Search terms:** 3-tier settings, page tier, project tier, all tier, GrayscaleTiers, StageSettingsStore,
  get_effective_3tier, grayscale-gpu-and-shared-settings-tiers, threshold deskew denoise settings UI
- **Relates to:** [Pipeline completion review and continuation plan](../plans/2026-07-21-pipeline-completion-review.md)

## Summary

Backend StageSettingsStore already resolves **page ?? project ?? all ??
registry** for tunable stages, and the grayscale tool has a polished
three-tier UX (workbench per-page save, project default, app Settings
all-tier, source-tier badges, dedicated tests). Other image-prep stages
(threshold, deskew, denoise at minimum) still lack that generalized
settings surface — ISR inline controls are schema fiction (W2.2) and do not
present tier source or all-tier app defaults. Wave 2.5 done when “At least
threshold + deskew + denoise” use the shared 3-tier pattern. Parent design
plan: `docs/plans/grayscale-gpu-and-shared-settings-tiers.md`.

## Impact

- Per-page override and app-wide defaults only feel real on grayscale.
- Inconsistent proofer mental model: grayscale is hi-fi; adjacent stages
  use thin ISR drafts that do not persist through tiers.
- W2.2 draft-on-rerun and W2.5 tiers are complementary: without tier PUT/GET
  UI, even corrected knobs stay hard to manage at project/all scope.
- Open design choice OC-2 in the grayscale plan explicitly deferred
  non-grayscale per-page UI — this issue is that deferred work.

## Environment / versions

```
repo: pdomain-prep-for-pgdp
review date: 2026-07-21
backend: src/pdomain_prep_for_pgdp/core/pipeline/stage_settings.py
  (get_effective_3tier, STAGE_SETTINGS_DEFAULTS, AppWideStageSettings)
grayscale UI: frontend/src/pages/pipeline/tools/grayscale/*
  GrayscaleTiers.test.tsx, GrayscaleSettingsAll.tsx, GrayscalePipelineEditor.tsx
API: page/project/all stage settings routes (types.gen.ts tier operations)
plan: docs/plans/grayscale-gpu-and-shared-settings-tiers.md
parent: docs/plans/2026-07-21-pipeline-completion-review.md §Wave 2 W2.5
```

## Evidence

### 1. Backend model is already shared, not grayscale-only

`stage_settings.py` documents five-level resolution including page, project,
all (pdomain-ops prefs), and registry defaults; “Applies to **all tunable
stages**” was the S1 intent in
`docs/plans/grayscale-gpu-and-shared-settings-tiers.md` Phase S1.

`STAGE_SETTINGS_DEFAULTS` already includes denoise, deskew, canvas_map,
post_transform_crop, post_ocr_crop, crop, grayscale — but **not threshold**
(threshold_level lives on ResolvedPageConfig without a defaults map entry).

### 2. Grayscale is the only polished tier UI

Evidence of grayscale-only productization:

- `frontend/src/pages/pipeline/tools/grayscale/GrayscaleTiers.test.tsx` —
  Save for this page (page tier), Save as project default, app Settings
  all-tier section.
- `GrayscalePipelineEditor.tsx` — per-field “from: page | project | …”
  source badges.
- `GrayscaleTool.tsx` — resolved source tier map from GET
  `…/settings/resolved`; page-tier PUT for “Save for this page.”
- `SettingsPage.test.tsx` — “grayscale all-tier form load.”

No equivalent `*Tiers.test.tsx` or workbench tier chrome for threshold /
deskew / denoise under `frontend/src/pages/pipeline/tools/`.

### 3. ISR path is not tier-aware

Image stages share `ImageStageReviewTool` + `stageSchemas` controls.
Rerun ignores draft (W2.2). There is no tier badge, no “save as project
default,” and no app Settings section for those stages comparable to
`GrayscaleSettingsAll`.

### 4. Plan OC-2 and Wave 2.5 text

From `grayscale-gpu-and-shared-settings-tiers.md`:

- Shared model covers all tunable stages; “only grayscale exposes per-page
  UI initially (others later).”

From pipeline completion Wave 2.5:

- “Generalize grayscale 3-tier settings UI to other tunable stages”
- Done when: “At least threshold + deskew + denoise”

## Root-cause hypotheses

1. **(Most likely) Intentional grayscale-first productization** — Phase F1
   landed full UI for grayscale only (OC-2); other stages kept ISR F5
   controls. Backend tiers are ready; FE generalization was never scheduled
   until this Wave 2 item.
2. **Schema fiction blocks tier UI** — cannot expose honest threshold/deskew
   controls until W2.2 keys match backend; W2.5 should follow or pair with
   W2.2.
3. **Missing STAGE_SETTINGS_DEFAULTS / apply path for threshold** —
   threshold_level may need registry defaults + apply_stage_settings_to_config
   wiring before a tier panel can persist it.

## Defects to fix

1. **No generalized 3-tier settings surface for threshold, deskew, denoise**
   (minimum). (Primary)
2. **No app Settings all-tier editors** for those stages (grayscale-only
   all-tier section today).
3. **threshold not in STAGE_SETTINGS_DEFAULTS / stage settings apply map**
   if still missing when implementation starts — add with W2.2-aligned keys.
4. **ISR or dedicated settings panels must show resolved value + source
   tier** (reuse grayscale badge pattern), not only ephemeral draft state.

## Next steps

1. Read `docs/plans/grayscale-gpu-and-shared-settings-tiers.md` and grayscale
   FE service module as the reference implementation.
2. Sequence with **W2.2**: lock backend keys first, then build tier UI on
   real knobs only.
3. Extract shared hooks/components from grayscale (resolved settings query,
   save page/project/all mutations, source badge) into a reusable module —
   avoid copy-paste per stage.
4. TDD per stage: page PUT → GET resolved sources.page; project default
   affects new pages; all-tier visible on Settings page.
5. Exit: threshold + deskew + denoise each support page override, project
   default, and all-tier at least at parity with grayscale’s tier
   affordances (controls can be simpler than grayscale pipeline editor).

## What is NOT broken (to scope the fix)

- Backend 3-tier resolution and API routes for stages that already have
  settings defaults.
- Grayscale GPU/CPU path and grayscale-specific pipeline editor depth.
- W2.1 thumbs and W2.3 scatter — orthogonal display issues.
- Full GPU settings panels for every stage — out of scope; tiers + knobs
  for the three named stages are enough for Wave 2.5.

## Resolution

*Open.*
