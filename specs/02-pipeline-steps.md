# Spec 02 — Pipeline Stages

> **Authoritative model:** the canonical pipeline shape is the per-page
> stage DAG defined in
> [`docs/specs/pipeline-task-model.md`](../docs/specs/pipeline-task-model.md).
> This spec is a per-stage reference: one paragraph per stage with the
> intent, input/output type, and dependency. For runner contracts,
> persistence model, dirty propagation, splits, and the
> `awaiting_review` job state, read the canonical spec.
>
> **Note (2026-06-11 — statechart convergence):** The stage IDs listed in this
> spec are the v1 model. As of the statechart convergence (shipped 2026-06-11),
> the canonical stage set is the 24-stage v2 registry in
> `docs/specs/stage-registry-v2.md`. The per-stage descriptions here remain
> accurate for stages that exist in both v1 and v2; new v2 stages (denoise,
> dewarp, post_transform_crop, wordcheck, hyphen_join, validation, proof_pack,
> zip, submit_check, archive, page_order) are not described in this file.

The pipeline is a **DAG of named per-page stages**. Each stage has:

+ A stable string ID (used in DB rows, on-disk paths, and API URLs).
+ A typed input (numpy / cupy ndarray, bytes, JSON, or page-record
  field) and a typed output (same set).
+ An explicit dependency list (other stage IDs).
+ A persisted on-disk artifact under
  `projects/<id>/pages/<page_id>/stages/<stage_id>/output.<ext>` —
  every stage persists, on every run (Q3, locked).
+ A row in `page_stages` keyed on `(project_id, page_id, stage_id)`
  with `status`, `stage_version`, `config_hash`, `input_hash`.

Stage callables live in a registry: `STAGE_IMPL[stage_id][device]`
where `device ∈ {"cpu", "cuda"}`. The runner picks the device per call
based on availability and `Settings.gpu_backend`. CPU-only stages
register only the `"cpu"` key; mixed-device stages register both and
the framework auto-bridges between numpy and cupy ndarrays.

Pipeline functions live in `core/pipeline/` (spec 09) and are called
by both the in-process FastAPI handlers and the Modal worker. Every
stage receives a `ResolvedPageConfig` per page rather than reaching
into raw config layers.

---

## Project-level orchestration tasks

These are not page stages; they fan out across pages.

| Task | Replaces (deprecated names) | Notes |
|---|---|---|
| `project.ingest` | `JobType.unzip` | Zip / folder ingest — extracts source files, writes initial `PageRecord`s. |
| `project.thumbnails` | `JobType.thumbnails` | Fans out per-page `thumbnail` stage runs. |
| `project.run_stage_all_pages(stage_id)` | `batch_process_pages`, `batch_extract_illustrations`, `batch_ocr`, `batch_text_postprocess` | Generic — runs `stage_id` on every page that needs it. |
| `project.run_dirty(stage_filter?)` | (new) | Runs every dirty stage on every page until clean. |
| `project.build_package` | `build_package` | Reads completed page outputs; gated by `text_review.clean` on all proof-range pages — see canonical spec §`text_review` gate stage. |

The deprecated `JobType.batch_*` names continue to work in M2–M5 as
shims and are removed in M6.

---

## Page-level stages

### `ingest_source`

**Intent:** Persist the source bytes for a page (the original scan).
For root pages this is a copy of the user's upload; for split-child
pages it is the parent's source cropped to `source_crop_bbox`.

**Input:** raw bytes (root) or `(parent_id, source_crop_bbox)` (child).
**Output:** `source_image` — bytes on disk under `source/<stem>.<ext>`
(root) or `pages/<page_id>/source.<ext>` (child).
**Depends on:** `project.ingest` for root pages; parent's
`split_at_stage` output for child pages.

### `thumbnail`

**Intent:** 400-px JPG for the page tagger.

**Input:** `source_image` (bytes).
**Output:** `thumbnail` — JPG bytes under `thumbnails/<stem>.jpg`.
**Depends on:** `ingest_source`.
**Code today:** `core/ingest._make_thumbnail_bytes`.

### `auto_detect_attrs`

**Intent:** Suggest `page_type` (blank / plate_p / normal) and
`alignment` (default / center). Writes onto the `PageRecord` directly;
no image artifact.

**Input:** `source_image` (bytes).
**Output:** `page_type`, `alignment` recorded on `PageRecord`.
**Depends on:** `ingest_source`.
**Code today:** `core/auto_detect.py`.

### `auto_detect_illustrations`

**Intent:** Run the layout detector against the source image and
populate `PageRecord.illustration_regions` with figure / decoration /
table boxes for the user to confirm.

**Input:** `source_image`.
**Output:** `illustration_regions[]` recorded on `PageRecord`.
**Depends on:** `ingest_source`.
**Code today:** `core/illustrations.auto_detect_illustrations`.

### `decode_source`

**Intent:** Decode the source bytes into an in-memory image array.
Was sub-step 4c in the old monolith. For split children, applies the
`source_crop_bbox` slice.

**Input:** `source_image` (bytes).
**Output:** `decoded_color` — BGR uint8 ndarray (numpy or cupy
depending on dispatched device); persisted as PNG.
**Depends on:** `ingest_source`.
**Code today:** `cv2.imdecode` in `process_page.py:88`.

### `initial_crop`

**Intent:** Strip scanner-frame pixels from all four edges. Reads
`ResolvedPageConfig.initial_crop` (page-level override) or
`initial_crop_all` (project-wide).

**Input:** `decoded_color`.
**Output:** `initial_cropped`.
**Depends on:** `decode_source`.
**Code today:** `crop_edges` (sub-step 4d).

### `manual_deskew_pre`

**Intent:** Optional manual rotation before content-edge finding, for
pages with significant scanner-frame skew. Pass-through when
`deskew_before_crop` is None.

**Input:** `initial_cropped`.
**Output:** `pre_deskewed`.
**Depends on:** `initial_crop`.
**Code today:** `rotate_image(deskew_before_crop)` (sub-step 4e).

### `grayscale`

**Intent:** Color → grayscale conversion.

**Input:** `pre_deskewed`.
**Output:** `gray`.
**Depends on:** `manual_deskew_pre`.
**Code today:** `cv2_convert_to_grayscale` (sub-step 4f).

### `threshold`

**Intent:** Binarise (text=0, bg=255). Otsu when
`ResolvedPageConfig.threshold_level is None`, manual otherwise.

**Input:** `gray`.
**Output:** `binary`.
**Depends on:** `grayscale`.
**Code today:** `otsu_binary_thresh` / `binary_thresh` (sub-step 4g).

### `invert`

**Intent:** Flip text/background polarity (text=255, bg=0). Required
input for the edge-finder.

**Input:** `binary`.
**Output:** `inverted`.
**Depends on:** `threshold`.
**Code today:** `invert_image` (sub-step 4h).

### `find_content_edges`

**Intent:** Compute the content bbox on the inverted image. Returns
a 4-tuple `(minX, maxX, minY, maxY)` — no image artifact, just numbers
that flow into `crop_to_content`.

**Input:** `inverted`.
**Output:** `content_bbox` (4-tuple persisted as JSON).
**Depends on:** `invert`.
**Code today:** `find_edges` (sub-step 4i).

### `crop_to_content`

**Intent:** Crop the inverted image to the content bbox, optionally
adding whitespace padding (`white_space_additional`).

**Input:** `inverted` + `content_bbox`.
**Output:** `content_cropped`.
**Depends on:** `find_content_edges` (which depends on `invert`).
**Code today:** `crop_to_rectangle` + `add_whitespace_percentage`
(sub-step 4j).

### `auto_deskew`

**Intent:** Auto-deskew on the cropped content. Pass-through when
`skip_auto_deskew`, when `alignment` is non-default, or when
`rotated_standard` / `single_dimension_rescale` is set.

**Input:** `content_cropped`.
**Output:** `auto_deskewed`.
**Depends on:** `crop_to_content`.
**Code today:** `auto_deskew` (sub-step 4k).

### `morph_fill`

**Intent:** Optional morphological fill to close hairline breaks in
glyphs. Pass-through when `do_morph` is False.

**Input:** `auto_deskewed`.
**Output:** `morphed`.
**Depends on:** `auto_deskew`.
**Code today:** `morph_fill` (sub-step 4l).

### `rescale`

**Intent:** Re-invert (text=0, bg=255) and rescale to canonical short
side (1000 px).

**Input:** `morphed`.
**Output:** `rescaled`.
**Depends on:** `morph_fill`.
**Code today:** `rescale_image(target_short_side=1000)` (sub-step 4m).

### `canvas_map`

**Intent:** Map content onto a canonical-aspect canvas with the
configured alignment. Produces the final proofing image.

**Input:** `rescaled`.
**Output:** `proofing_image` (PNG bytes; the file ultimately referenced
by the legacy `processed_image_key`).
**Depends on:** `rescale`.
**Code today:** `map_content_onto_scaled_canvas` + `cv2.imencode`
(sub-steps 4n + 4o).

### `blank_proof_synth`

**Intent:** Replacement for stages `decode_source` → `morph_fill` for
`page_type ∈ {blank, plate_b, plate_r}`. Synthesises a canonical
blank PNG without running the cropping/deskew chain. Stages
`decode_source` … `morph_fill` are recorded as `not-applicable` for
these pages.

**Input:** `page_type`, `page_h_w_ratio` from `auto_detect_attrs`.
**Output:** `proofing_image`.
**Depends on:** `auto_detect_attrs`.
**Code today:** `core/pipeline/blank_proof.py`.

### `ocr_crop`

**Intent:** Apply the project-wide OCR border crop (top/bottom/left/right)
to the proofing image. Pass-through for blank/plate-p/non-default-
alignment/rotated-standard pages. **Splits are no longer handled here**
— they are sibling pages with their own DAG state.

**Input:** `proofing_image`.
**Output:** `ocr_image` (single PNG per page; one row per child page
after split).
**Depends on:** `canvas_map` (or `blank_proof_synth`).
**Code today:** `core/pipeline/crop_for_ocr.py`.

### `extract_illustrations`

**Intent:** Per `IllustrationRegion`, crop the region from the
**original source image** at native resolution and write to
`hi_res/<prefix>_<NN>.<ext>`. Plate pages auto-synthesise a full-page
region.

**Input:** `source_image` + `illustration_regions[]`.
**Output:** `hi_res_crops[]` (one file per region).
**Depends on:** `auto_detect_illustrations` plus any user edits to
`illustration_regions`.
**Code today:** `core/illustrations.extract_illustration`.

### `ocr`

**Intent:** Run DocTR (or Tesseract) on the OCR-cropped image and
produce structured OCR output (per-word boxes + raw text).

**Input:** `ocr_image`.
**Output:** `ocr_words[]` (JSON), raw `ocr_text` (txt).
**Depends on:** `ocr_crop`.
**Code today:** `core/ocr.py`.

### `text_postprocess`

**Intent:** Sequential regex passes against raw OCR text:

| Pass | Description | Source |
|---|---|---|
| 1. Curly quotes | Normalise to ASCII | hardcoded |
| 2. Em-dash normalize | `—` → `--` | hardcoded |
| 3. Em-dash line-wrap | Join split `--` | hardcoded |
| 4. Trailing punct | Remove space before `:;!?` | hardcoded |
| 5. Hyphen line-join | Use `system.hyphenation_join_list` | system |
| 6. Standard scannos | `system.standard_scannos` | system |
| 7. Custom scannos | `project.custom_scannos` | project |
| 8. Custom regex | `project.custom_regex_passes` | project |

**Input:** raw `ocr_text`.
**Output:** final `ocr_text`.
**Depends on:** `ocr`.
**Code today:** `core/text_postprocess.py`.

### `text_review`

**Intent:** Human attestation gate. Status `not-run` (default) or
`dirty` until the user clicks "Mark page reviewed" in the workbench;
then `clean`. Re-running upstream stages flips this back to `dirty`,
forcing re-attestation.

**Input:** final `ocr_text`.
**Output:** reviewed `ocr_text` plus an attestation timestamp on the
page record.
**Depends on:** `text_postprocess`.
**Surface:** `POST /api/pages/{page_id}/text_review/clean`. There is
no automated path that flips `text_review` to `clean`.

`build_package` is gated by every proof-range page being
`text_review.clean`. When unsatisfied, the project-level
`build_package` job lands in the `awaiting_review` state — see
`docs/specs/pipeline-task-model.md` §`text_review` as gate stage with
awaiting-review UX for the full workflow.

---

## DAG (fan-in / fan-out)

```
ingest_source ─┬─ thumbnail
               ├─ auto_detect_attrs ──→ blank_proof_synth ─→ proofing_image
               ├─ auto_detect_illustrations ─→ extract_illustrations
               └─ decode_source ─→ initial_crop ─→ manual_deskew_pre
                                                          ↓
                                                       grayscale
                                                          ↓
                                                       threshold
                                                          ↓
                                                       invert ─→ find_content_edges
                                                          ↓             ↓
                                                          └→ crop_to_content
                                                                  ↓
                                                              auto_deskew
                                                                  ↓
                                                               morph_fill
                                                                  ↓
                                                               rescale
                                                                  ↓
                                                            canvas_map ─→ proofing_image
                                                                  ↓
                                                              ocr_crop
                                                                  ↓
                                                                 ocr
                                                                  ↓
                                                          text_postprocess
                                                                  ↓
                                                             text_review ─→ (project) build_package
```

`canvas_map` and `blank_proof_synth` are alternative producers of
`proofing_image` (one runs per page, depending on `page_type`).

---

## Step-numbered legacy mapping

The original "step 0..10" numbering is preserved here for transition
purposes. Anyone reading the codebase under the old labels should map
them to the new stage IDs:

| Legacy step | New stage(s) |
|---|---|
| Step 0 — Ingest | `project.ingest` (project-level) → per-page `ingest_source` |
| Step 1 — JP2→JPG | Folded into `decode_source` (cv2 handles JP2 directly) |
| Step 2 — Thumbnails | `thumbnail` |
| Step 3 — Configure (interactive) | `auto_detect_attrs` + `auto_detect_illustrations` writes; UI for `PageRecord` editing |
| Step 4 (4c–4o) — Process page | `decode_source` → `initial_crop` → `manual_deskew_pre` → `grayscale` → `threshold` → `invert` → `find_content_edges` → `crop_to_content` → `auto_deskew` → `morph_fill` → `rescale` → `canvas_map` |
| Step 4b — Blank proof | `blank_proof_synth` |
| Step 4p — Apply page splits | **Splits are sibling pages now** (see canonical spec §Splits as sibling pages); each split-child runs its own DAG. |
| Step 4.5 — Illustrations | `extract_illustrations` |
| Step 5 — Inspect (interactive) | UI surfaces over `text_review.not-run` page filter |
| Step 6 — Crop for OCR | `ocr_crop` |
| Step 7 — OCR | `ocr` |
| Step 8 — Text post-processing | `text_postprocess` |
| Step 9 — Text review (interactive) | `text_review` (gate stage) |
| Step 10 — Package | `project.build_package` (project-level, with `awaiting_review` gate) |

`PipelineState` (the legacy `dict[StepId, StepState]` rolled-up view)
is recomputed from `page_stages` at read time; see spec 08.

---

## Re-run modes (per-page)

+ **`page.run_stage(page_id, stage_id)`** — runs *only* `stage_id`. The
  framework lazy-loads its inputs from the nearest persisted upstream
  output, executes in memory, queues the deferred write, and marks
  every downstream stage `dirty`.
+ **`page.run_from(page_id, stage_id)`** — runs `stage_id` and walks
  downstream in topological order, holding intermediates in memory.
+ **`page.run_dirty(page_id)`** — runs every dirty stage in DAG order.
  Skips `not-applicable`. The default action behind the workbench's
  "Run all dirty stages on this page" button.

---

## Re-run modes (project-level)

+ **`project.run_stage_all_pages(stage_id, only_dirty=True)`** — runs
  one stage on every page that needs it. Replaces the deprecated
  `JobType.batch_process_pages` / `batch_ocr` /
  `batch_text_postprocess` / `batch_extract_illustrations`.
+ **`project.run_dirty(stage_filter?)`** — runs every dirty stage on
  every page until clean. Optional stage filter narrows the sweep
  (e.g. "only run OCR-related stages").
+ **`project.build_package`** — packages reviewed pages. Lands in
  `awaiting_review` if any proof-range page is unreviewed.

---

## Persistence

Every stage's output is persisted on every run (Q3 locked). On-disk
layout:

```
projects/<id>/pages/<page_id>/stages/<stage_id>/output.<ext>
projects/<id>/pages/<page_id>/manifest.json
```

`page_id` is the zero-padded `idx0` for root pages, with a
`/splits/<suffix>` chain for split children. See
`docs/specs/pipeline-task-model.md` §Persistence model and
spec 08 §Storage Layout for the full scheme and dual-write
reconciliation rules.
