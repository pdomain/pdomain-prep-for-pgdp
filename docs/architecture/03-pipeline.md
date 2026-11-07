# 03 — Pipeline

## Agent Index

- **Kind:** architecture
- **Status:** built
- **Last verified:** 2026-11-07
- **Read when:** changing pipeline stages, dependencies, or execution.
- **Search terms:** pipeline, stage registry, DAG, OCR, artifacts, wordcheck flags, attestation, golden path.

> **Authoritative spec:** the pipeline is a per-page DAG of named
> stages, defined in
> [Current state](../context/current-state.md)
> and described stage-by-stage below. M1–M6
> are all shipped (see [migration decisions](../context/decisions.md)); per AD-7,
> `STAGE_IMPL[stage_id][device]` in `core/pipeline/stage_registry.py`
> is the only execution path. This doc is a code-level guide to where
> each stage's implementation lives today and how OCR mirrors
> `pdomain-ocr-cli`.

## Book path contracts

The book path keeps page prose and wordcheck flags in different files.

OCR writes `words.json` and `raw.txt`. Wordcheck reads both.

Wordcheck writes `flags.json` for the workbench and `output.txt` for the pack chain.
`output.txt` is the OCR page text.
It is not the flags report.

Hyphen join, regex, and text review read UTF-8 page text.

The runner picks the file a consumer needs.
A words consumer gets `words.json`.
A text consumer gets `output.txt`, then `raw.txt`.
The runner does not take the first file named `output.*`.

Text review starts with an empty `attestation.json`.

A page becomes attested when the attest request rewrites `attestation.json`
with `status` set to `clean` and leaves `output.txt` in place.
The request is `POST /api/data/projects/{project_id}/pages/{idx0}/stages/text_review/attest`.
The page must already have `output.txt`.

Project confirm does that write for each page that already has `output.txt`.
It skips the rest.
The route is `POST /api/data/projects/{project_id}/project-stages/text_review/confirm`.

Validation reports `unattested_text_review` until `attestation.status` is `clean`.

Project-stage jobs pass only the arguments each callable accepts.

`build_project_stage_call_kwargs` loads parent artifacts.
The zip stage receives `zip_bytes` from `stages/build_package/output.zip`.
Submit check receives `zip_sha256`, `zip_size_bytes`, and `page_count` from the zip manifest.

The shell runs a non-OCR page stage for every page.
It lists the project pages and posts `project-stages/{stage_id}/rerun` with those page ids.

OCR still uses `page-stages/ocr/run-batch`.

Text zones split posts `suffixes`, `bboxes`, `split_at_stage` of `text_zones`, and `normalized` true.

Coordinates are fractions of the parent image. The server converts them to integer pixels.

The older body with one integer `bbox` still works.

`tests/test_w06_golden_path.py` runs in default `make test`.

The test uses a hermetic OCR fixture, not DocTR.

For a 3-page book it checks:

- prose in each `output.txt`
- a clean attestation on every page
- a clean `text_review` row on every page
- a zip with matched png and txt names

The regex stage runs `postprocess_text` in this order:

1. Curly quotes
2. Em dashes
3. The system hyphenation join list
4. The system scanno table
5. The project scanno table
6. Custom regex passes

A prefix matches the system hyphenation join list after case-folding.
Entries on that list also drop a trailing hyphen before the compare.

An empty text config still turns curly quotes into straight quotes.
It still turns an em dash, U+2014, into `--`.

Regex does not read hyphen decisions.
A prefix on the join list can still be joined after the user chose keep.

Wordcheck writes flags for the workbench.
The package text stays the page prose.

The system bad-word list is the pptext scanno seed plus the existing OCR misspellings.

A project good word suppresses a flag.
A project bad word is added.

Regex does not replace those words in the prose.

Hyphen join with no saved decisions leaves the page text unchanged.

Saved decisions live in `stages/hyphen_join/decisions.json`.

A join splices the prefix and suffix at the saved offset when that span still matches.
A keep leaves the end-of-line hyphen and the newline.

The decision POST writes `source.txt` and `decisions.json` before the stage commit.

A failed commit can leave the stage clean while the decision file is ahead of `output.txt`.

A missing, unreadable, or corrupt decision file is treated as no decisions.
A later POST can overwrite it.

That POST marks later page stages dirty.
It does not mark project stages dirty.
It does not emit the stage-status events a stage re-run emits.
`build_package` stays clean until it runs again.

OCR, wordcheck, and text review load their queues from the API.
Demo and missing project ids settle empty and do not fetch.

A batch OCR clean event carries `idx0`.
A clean event with no `idx0` is ignored.

A later running snapshot does not replace a finished row.

The OCR tool returns to recognising while any row is still running.

Pages that finish while the OCR list is loading are read before the tool can leave recognising.

If one of those reads fails, the tool shows the error and does not open confirm.
After that failure, the live channel stays closed until the tool is opened again.

Illustration packing reads `illustrations/crops.json` when that file exists.
The zip writes each kept image as `images/{prefix}_{NN}.{ext}` in manifest order.
`NN` is the 1-based position, written as two digits.

An empty, unreadable, or non-object manifest packs no illustration images.
A present manifest whose `crops` value is not a list also packs none.

Only a missing `crops.json` uses the legacy `extract_illustrations/` directory.

A successful illustrations commit that writes `crops.json` deletes leftover crop images
in that stage directory whose names are not in the commit.

Packed illustration images are copied as stored and are not run through oxipng.

`POST /api/gpu/extract-illustration` returns 501.

Build's gate is passed only when `passed` is true and `blocker_count` is 0.
Any other readable report is blocked.
A warnings-only report with `passed` true and `blocker_count` 0 is passed.

Build reads the validation artifact on mount.
A missing or unreadable artifact, including a 404, stays unknown.
The demo project does not fetch.

`build_submission_zip` writes the first cover page's canvas PNG
as both `{prefix}.png` and `cover.png`, with the same bytes.

That function defaults `optimize_png` to false.
`ProjectConfig` defaults the same flag to true.
`build_package_v2_cpu` passes true when config is missing, the flag is missing,
or the flag is not a boolean.

When `optimize_png` is true, proofing PNGs go through oxipng at level 4,
and `pgdp.json` records `oxipng_skipped_pages`.
When it is false, the PNG bytes are unchanged.

Looking up cover page ids does not create a page store
when the project events database is absent.

## Evidence

- Code: `src/pdomain_prep_for_pgdp/core/pipeline/steps/wordcheck.py`,
  `src/pdomain_prep_for_pgdp/core/pipeline/stage_runner.py`,
  `src/pdomain_prep_for_pgdp/core/pipeline/stage_dag.py`,
  `src/pdomain_prep_for_pgdp/core/pipeline/project_stage_kwargs.py`,
  `src/pdomain_prep_for_pgdp/core/pipeline/text_review_attestation.py`,
  `src/pdomain_prep_for_pgdp/api/data/pages.py`,
  `frontend/src/services/pipeline.ts`,
  `frontend/src/services/tools/textZonesTool.ts`
- Tests: `tests/test_text_chain_contract.py`
  (`test_text_chain_ocr_to_text_review_is_utf8_prose`),
  `tests/test_w02_project_stage_job_adapter.py`,
  `tests/test_w03_text_review_attestation.py`,
  `tests/test_w05_text_zones_split_contract.py`
  (`test_fe_shaped_normalized_bboxes_body_succeeds`),
  `tests/test_w06_golden_path.py`
  (`test_golden_path_three_page_book_prose_attest_and_zip`),
  `frontend/src/services/pipeline.w04.test.ts`,
  `frontend/src/services/tools/textZonesTool.w05.test.ts`
- Code: `src/pdomain_prep_for_pgdp/core/pipeline/stage_registry.py`,
  `src/pdomain_prep_for_pgdp/core/pipeline/steps/scanno_seed.py`,
  `src/pdomain_prep_for_pgdp/core/pipeline/steps/hyphen_decisions.py`,
  `src/pdomain_prep_for_pgdp/core/pipeline/steps/hyphen_join.py`,
  `src/pdomain_prep_for_pgdp/core/pipeline/steps/build_package.py`,
  `src/pdomain_prep_for_pgdp/core/pipeline/project_ocr_fanout.py`,
  `src/pdomain_prep_for_pgdp/core/pipeline/page_stage_writer.py`,
  `frontend/src/pages/pipeline/tools/OcrTool.tsx`,
  `frontend/src/services/tools/preflightStatus.ts`
- Tests: `tests/test_w11_regex_full_postprocess.py`
  (`test_regex_callable_applies_scanno_quote_and_dash`),
  `tests/test_w12_wordcheck_scanno_list.py`
  (`test_default_wordcheck_flags_pptext_word_and_keeps_prose`),
  `tests/test_w13_hyphen_join_decisions.py`
  (`test_post_join_survives_reload_and_rewrites_output`),
  `tests/test_w15_illustrations_extract.py`
  (`test_crops_manifest_packs_named_files_and_skips_leftovers`),
  `tests/test_w17_cover_oxipng.py`
  (`test_cover_page_is_aliased_to_cover_png`),
  `frontend/src/pages/pipeline/tools/OcrTool.test.tsx`
  (`does not offer confirm until a page that finished during hydrate is loaded`),
  `frontend/src/services/tools/preflightStatus.test.ts`
- Artifacts: none
- Verified: 2026-11-06 with `uv run pytest` on the Python tests in the first Tests list.
  18 passed, including the golden path.
  Vitest ran the frontend tests in that same first list through `mise exec`.
  2026-11-07 `make ci AI=1` passed, including the Wave 1 tests in the second Tests list.

## Stage-to-code map

The registry defines 24 stages plus project-level orchestration tasks.
Today's code lives at:

| Stage / task | Code |
|---|---|
| `project.ingest` (root) | `core/ingest.ingest_source()` |
| `thumbnail` | `core/ingest._make_thumbnail_bytes()` (in-memory, `ProcessPoolExecutor` per AD-9) |
| `auto_detect_attrs` | `core/auto_detect.detect_page_attributes` |
| `auto_detect_illustrations` | `core/illustrations.auto_detect_illustrations` |
| Proofing-chain stages (`decode_source` → `initial_crop` → `manual_deskew_pre` → `grayscale` → `threshold` → `invert` → `find_content_edges` → `crop_to_content` → `auto_deskew` → `morph_fill` → `rescale` → `canvas_map`) | Individual entries in `STAGE_IMPL[stage_id]["cpu"]` (`core/pipeline/stage_registry.py`); each calls a `pdomain_book_tools.image_processing.cv2_processing` primitive |
| `blank_proof_synth` | `core/pipeline/blank_proof.py` |
| `ocr_crop` | `core/pipeline/crop_for_ocr.py` |
| `extract_illustrations` | `core/illustrations.py` (extract + auto-detect) |
| `ocr` | `core/ocr.py` (mirrors pdomain-ocr-cli) |
| `text_postprocess` | `core/text_postprocess.py` |
| `text_review` (gate) | `PATCH /api/data/projects/{id}/pages/{idx0}/text` (edit), `DELETE .../words` + `POST .../words/restore` (word edits), then attest via `text_review` stage run |
| `project.build_package` | `core/packaging.py`; parks in `awaiting_review` job state when any proof-range page is un-attested, then resumes when the gate clears |

## Step 0 — `ingest_source`

Inputs: a `Project`, source key (zip or storage prefix), the storage adapter,
and the database.

For zip sources: `_enumerate_zip` reads the zip from storage, extracts each
image entry under `projects/<id>/source/<stem>.<ext>`. For folder sources:
`_enumerate_folder` walks the storage prefix and reads bytes inline. Both
sort by stem so `idx0` is deterministic.

For each entry `_build_page_records`:

1. Decodes + resizes to a 400-px JPG thumbnail (in-memory cv2; written to
   `projects/<id>/thumbnails/<stem>.jpg`).
2. If `auto_detect=True` (default), runs `core.auto_detect.detect_page_attributes`
   on the source bytes to suggest `page_type` (blank / plate_p / normal) and
   `alignment` (default / center).
3. If a `layout_detector` is supplied, calls `auto_detect_illustrations`
   (writes a tempfile so pdomain-book-tools' detector can take a path) and
   filters to figure / decoration / table regions above the confidence
   threshold.
4. Constructs a `PageRecord` and appends. After each page, `progress_cb`
   fires with `(processed, total, stem)` so the runner emits an SSE event.

Corrupt entries land in `IngestResult.errors` without aborting the batch.

After the loop, if any pages were ingested and `auto_detect=True`, the median
`height/width` ratio is recorded into `Project.config.default_overrides["page_h_w_ratio"]`.

## Proofing chain — per-stage `STAGE_IMPL` entries

Each proofing-chain step (`decode_source` → `initial_crop` →
`manual_deskew_pre` → `grayscale` → `threshold` → `invert` →
`find_content_edges` → `crop_to_content` → `auto_deskew` → `morph_fill` →
`rescale` → `canvas_map`) is an individual entry in `STAGE_IMPL[stage_id]["cpu"]`
(`core/pipeline/stage_registry.py`). `StageRunner` walks the DAG calling
each one with the in-memory upstream artifact, then routes the result
through `commit_stage_artifact` (`core/pipeline/page_stage_writer.py`)
for dual-write to disk + `page_stages` row (AD-2).

When the user requests a single stage with `mode=from`, the runner cascades
to descendants by walking `stage_dag.py`'s parent→child graph and re-running
every reachable dirty stage. Eager dirty propagation on a single-stage run
marks every downstream `clean`/`failed` row `dirty` synchronously
(the current downstream-dirty invariant).

For `page_type ∈ {blank, plate_b, plate_r}` the registry short-circuits to
`blank_proof.create_blank_proof` (canonical-aspect blank PNG) — this is the
`blank_proof_synth` stage.

GPU implementations ship in the v2 registry. CUDA requests map to its `gpu` key.
See [image preparation and settings](09-image-prep-settings.md#cpu-and-gpu-execution)
for supported stages and device selection.

## Stage `ocr_crop` — crop for OCR

Uniform OCR border crop (project-wide top/bottom/left/right) applied to
the proofing image. With splits represented as sibling pages,
each child page runs its own `ocr_crop` independently — the legacy
"yield one crop per split" inner loop is gone. Each page (root or
split-child) produces exactly one `ocr_image` artifact.

## Step 7 — OCR (mirrors pdomain-ocr-cli)

`core/ocr.py` follows `pdomain-ocr-cli/pdomain_ocr_cli/ocr_to_txt.py:307–540` verbatim
(see `feedback_ocr_follows_pdomain_ocr_cli.md` in memory):

1. **Resolve models** (`core/hf_models.py`):
   - `resolve_ocr_models(repo, det_filename, reco_filename, ...)` — local
     paths or HF Hub download with `(.arch, .vocab)` sidecars.
   - `resolve_layout_source(layout_model, layout_checkpoint)` — for
     `pp-doclayout-plus-l`, looks up the HF repo + revision exposed by
     `pdomain_book_tools.layout.adapters.pp_doclayout.PPDocLayoutPlusLDetector`.
   - `prefetch_layout_files()` pre-downloads transformers files so the later
     `from_pretrained()` is a cache hit.
2. **Process-singleton predictors** (`get_predictor()`, `get_layout_detector()`)
   — load each model once per process, keyed by model paths + device.
3. **Per page**:
   - `Document.from_image_ocr_via_doctr(image_path, ..., predictor)`.
   - `layout_detector.detect(image_path)` (skipped when `layout_detector="none"`).
   - Snapshot `pre_reorg = list(page.words)` if `validate_reorg`.
   - `page.reorganize_page(layout=page_layout)` (or no kwarg if no detector).
   - When `validate_reorg`: `validate_word_preservation(pre, post)` → log a
     warning if any words were dropped.
4. **Adapt** the resulting `pdomain_book_tools.ocr.word.Word` objects to spec-08
   `OcrWord` (`_to_ocr_word`).
5. **Tesseract path** (`engine="tesseract"`) bypasses DocTR + layout entirely
   and uses `pytesseract.image_to_string` + `image_to_data` for word boxes.

`engine=` kwarg overrides `cfg.ocr_engine` for one call (so the per-page UI
can force Tesseract on a stubborn page without rewriting the config).

## Step 8 — Text post-process

`core/text_postprocess.py` orchestrator:

```
quotes(curly→straight) → em-dash(→--) → join_hyphenated_lines(allow-list)
→ apply_scannos(system) → apply_scannos(project) → apply_custom_regex_passes(project)
```

Hyphenation join only fires when the prefix is in the allow-list (so genuine
compounds like "self-aware" don't get rejoined). Scannos are case-sensitive
word-boundaried replacements.

## Step 4.5 — Illustrations

`extract_illustration(source_image_bytes, region)` decodes via cv2, clamps
coords, optionally converts to grayscale, and encodes JPG (with quality) or
PNG.

`regions_for_page(page, system, source_dimensions=...)` returns either
the user-confirmed `page.illustration_regions`, or a synthesised full-page
region for `plate_p` pages.

`auto_detect_illustrations(image_path, layout_detector, confidence_threshold)`
runs the detector on the source image and filters to figure / decoration /
table region types above the threshold; type is mapped to spec-05's
`"illustration" | "decoration" | "plate"`.

## Step 10 — Package

`build_package(project, pages, storage)` assembles a zip:

- One `<full_prefix>.png` + `<full_prefix>.txt` per non-ignored page output
  (so splits get their own entries).
- `cover.png` aliased from the page where `idx0 == config.cover_idx0`.
- `images/<prefix>_<NN>.<ext>` for each illustration region whose hi-res
  crop exists at `projects/<id>/hi_res/<prefix>_<NN>.<ext>`.
- `pgdp.json` manifest (book_name, project_id, built_at, page_count,
  illustration_count, pages[], optional cover_prefix / title_prefix).

Written to `projects/<id>/for_zip/<book_name>.zip` via `IStorage.put_bytes`.

## Configuration resolution

The pipeline never reads raw config layers — only a resolved
flat object. `core/config_resolver.py`:

```python
def resolve_page_config(
    system: SystemDefaults,
    project: ProjectConfig,
    page: PageRecord,
) -> ResolvedPageConfig
```

Resolution rule: **page override > project default override > system default**.

Current package naming derives from persisted numbering runs, leaf assignments, and scan order.
The old range-based prefix description is superseded by
[page-numbering runs](08-page-numbering.md). Registry version 3 migrates old ranges;
the page-order naming manifest is version 2.

Stage settings separately resolve page/project/app-wide/registry inheritance and are applied before dispatch.
See [shared settings resolution](09-image-prep-settings.md#shared-settings-resolution).
