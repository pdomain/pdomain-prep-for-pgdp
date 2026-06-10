# Machine → stage map

**Date:** 2026-06-10
**Status:** Phase 0 gate — frozen alongside `stage-registry-v2.md` and
`api-v2-deltas.md`. Changes require editing this doc in the same commit as
any code that diverges from it.

**Sources:**

- `docs/plans/design_handoff_pgdp_app/statecharts/README.md` §Stage tools
  (Stage → machine map table and Shared machines table)
- `docs/specs/stage-registry-v2.md` §2 (24 stages, scopes, and owning machine
  column)

---

## Note on stage numbering vs execution order

The `#` column in §1 uses **design numbering** (01–24 from
`stage-registry-v2.md §2.1`). This numbering keys the canvas machine
assignments and must not be renumbered.

**Design numbering ≠ execution order.** The topological execution order
(dependency-safe run order) is defined by the `STAGE_DEPS` graph in
`stage-registry-v2.md §2.1` and computed via Kahn's algorithm. The
frontend `STAGE_DEFS` array in `pipelineShell.ts` follows the topological
order (not the design numbering). Concretely: `canvas_map` (design #14)
appears before `text_zones` (design #10) in `STAGE_DEFS` because
`text_zones` does not depend on `canvas_map`, but both share
`post_transform_crop` as their upstream. The authoritative execution order
is `stage-registry-v2.md §2.1 deps` column; the `STAGE_DEFS` array is the
canonical frontend rendering of that order.

---

## 1. Complete stage → machine lookup table

One row per v2 stage (all 24). The machine column is the canonical
JavaScript/TypeScript identifier for the machine definition; "shared" marks
instances of a multi-stage shared machine definition (see §2 for instance
lists). The `stageRunner` column records whether `pipelineShell` spawns a
`stageRunner` instance for this stage (see §3 for the 23-vs-24 resolution).

| # | stage_id | Scope | Machine | Machine file | stageRunner? |
|---|----------|-------|---------|--------------|-------------|
| 01 | `source` | project | `sourceTool` | `tool-source.yaml` | No — `sourceTool` is bespoke, mounted separately by `pipelineShell` |
| 02 | `grayscale` | page | `grayscaleTool` | `tool-grayscale.yaml` | Yes |
| 03 | `crop` | page | `pagesGrid` | `tool-pages-grid.yaml` | Yes |
| 04 | `threshold` | page | `imageStageReview` (shared) | `tool-image-stage-review.yaml` | Yes |
| 05 | `deskew` | page | `imageStageReview` (shared) | `tool-image-stage-review.yaml` | Yes |
| 06 | `denoise` | page | `imageStageReview` (shared) | `tool-image-stage-review.yaml` | Yes |
| 07 | `dewarp` | page | `imageStageReview` (shared) | `tool-image-stage-review.yaml` | Yes |
| 08 | `post_transform_crop` | page | `imageStageReview` (shared) | `tool-image-stage-review.yaml` | Yes |
| 09 | `post_ocr_crop` | page | `imageStageReview` (shared) | `tool-image-stage-review.yaml` | Yes |
| 10 | `text_zones` | page | `textZonesTool` | `tool-text-zones.yaml` | Yes |
| 11 | `ocr` | page | `ocrTool` | `tool-ocr.yaml` | Yes |
| 12 | `page_order` | project | `pageOrderTool` | `tool-page-order.yaml` | Yes |
| 13 | `wordcheck` | page | `wordcheckTool` | `tool-wordcheck.yaml` | Yes |
| 14 | `canvas_map` | page | `imageStageReview` (shared, + extras) | `tool-image-stage-review.yaml` | Yes |
| 15 | `hyphen_join` | page | `hyphenJoin` | `tool-hyphen-join.yaml` | Yes |
| 16 | `text_review` | page | `textReviewTool` | `tool-text-review.yaml` | Yes |
| 17 | `illustrations` | page | `illustrationsTool` | `tool-illustrations.yaml` | Yes |
| 18 | `regex` | page | `regexPass` | `tool-regex.yaml` | Yes |
| 19 | `validation` | project | `validationTool` | `tool-validation.yaml` | Yes |
| 20 | `proof_pack` | project | `proofPackTool` | `tool-proof-pack.yaml` | Yes |
| 21 | `build_package` | project | `buildPackage` | `tool-build-package.yaml` | Yes |
| 22 | `zip` | project | `zipTool` | `tool-zip.yaml` | Yes |
| 23 | `submit_check` | project | `submitCheck` | `tool-submit-check.yaml` | Yes |
| 24 | `archive` | project | `archiveTool` | `tool-archive.yaml` | Yes |

**Total stageRunner instances: 23** (stages 02–24 inclusive; `source` excluded).
See §3 for the authoritative quote and reasoning.

---

## 2. Shared machine instance lists

### `imageStageReview` — 7 instances

Stages using the shared `imageStageReview` machine definition (one XState
`setup().createMachine()` call, instantiated with `input: { stageId, ... }` per
stage):

1. `threshold` (04)
2. `deskew` (05)
3. `denoise` (06)
4. `dewarp` (07)
5. `post_transform_crop` (08)
6. `post_ocr_crop` (09)
7. `canvas_map` (14) — uses the shared machine with additional "extras"
   (canvas-specific compare view and blank-page branch UI)

Source quote from `statecharts/README.md` §Shared machines:

> "`imageStageReview` | **×7** — threshold · deskew · denoise · dewarp ·
> post_transform_crop · post_ocr_crop · canvas_map."

### `pageWorkbench` — 12 instances

Stages served by the `pageWorkbench` machine for the per-page deep-dive tab
(the stage body / `WB_MAP` is data, not a separate machine per stage). The
`WB_MAP` lookup maps each of the following stage IDs to its control schema:

1. `grayscale` (02)
2. `crop` (03)
3. `threshold` (04)
4. `deskew` (05)
5. `denoise` (06)
6. `dewarp` (07)
7. `post_transform_crop` (08)
8. `post_ocr_crop` (09)
9. `text_zones` (10)
10. `ocr` (11)
11. `wordcheck` (13)
12. `canvas_map` (14)

Source quote from `statecharts/README.md` §Project pipeline:

> "`pageWorkbench` | **×12** — per-page tune→re-detect→Apply-&-Continue loop;
> stage control schemas are `WB_MAP` data."

Note: `pageWorkbench` is mounted as the "Page workbench" tab within
`pipelineShell`; it is distinct from the tool machine mounted in the main tool
slot. The 12-stage set covers the page-scoped pipeline stages up through
`canvas_map` that have per-page parameter tuning.

### `pagesGrid` — used for `crop` (and any plain thumbnail-grid stage)

Source quote from `statecharts/README.md` §Shared machines:

> "`pagesGrid` | crop (and any plain thumbnail-grid stage)."

In v2 `crop` is the only stage using `pagesGrid` as its primary tool machine.

---

## 3. The 23 stageRunner instances — authoritative resolution

`source` (stage 01) is the one stage **without** a `stageRunner` instance.
It has its own `sourceTool` machine and is mounted separately by `pipelineShell`.

Evidence from `stage-registry-v2.md §4` (which cites the source documents):

> "`stageRunner` is the shared machine, defined once and **spawned ×23** —
> that's where the 'shared' lives."
> — `statecharts/pipeline-plan.md §8`

The Stage → machine map in `README.md` maps `01 Source` to **`sourceTool`**,
not `stageRunner`. `source` is project-scoped and its machine is `sourceTool`
— a bespoke tool machine, not a `stageRunner` instance.
(Source: `stage-registry-v2.md §4`)

**Implication for `pipelineShell`:** the test asserting that `pipelineShell`
spawns one `stageRunner` per runner-stage with correct `input.stageId` must
assert `count === 23`, not 24.

---

## 4. Bespoke tools (one machine definition per stage)

Stages with no shared machine — each has its own YAML and its own XState
machine definition:

| stage_id | Machine | Notes |
|----------|---------|-------|
| `source` | `sourceTool` | Settings-inheritance pattern defined here (used by all stages) |
| `grayscale` | `grayscaleTool` | — |
| `text_zones` | `textZonesTool` | Owns `APPLY_SPLIT` page-set mutation |
| `ocr` | `ocrTool` | — |
| `page_order` | `pageOrderTool` | Confirm-and-advance gate: clean sequence |
| `wordcheck` | `wordcheckTool` | Cross-project word-list promotion |
| `hyphen_join` | `hyphenJoin` | — |
| `text_review` | `textReviewTool` | Gate: zero open discussions |
| `illustrations` | `illustrationsTool` | — |
| `regex` | `regexPass` | — |
| `validation` | `validationTool` | Gate: zero blockers before `build_package` |
| `proof_pack` | `proofPackTool` | — |
| `build_package` | `buildPackage` | Guard: `preflightPassed` (validation.passed) |
| `zip` | `zipTool` | Deterministic archive + sha256 |
| `submit_check` | `submitCheck` | `SUBMIT → confirming → submitted` (final) |
| `archive` | `archiveTool` | Terminal; cold-storage manifest |

---

## 5. Cross-references

- `stage-registry-v2.md §2.1` — authoritative 24-stage registry table with
  scope, deps, and owning machine column.
- `api-v2-deltas.md §1` — route shape per stage scope.
- `statecharts/README.md` §Stage tools — the map source used for this doc.
- `statecharts/pipeline-plan.md §3, §8` — stageRunner ×23 rationale.
