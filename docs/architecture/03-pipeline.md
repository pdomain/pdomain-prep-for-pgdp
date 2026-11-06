# 03 — Pipeline

## Agent Index

- **Kind:** architecture
- **Status:** built
- **Last verified:** 2026-07-14
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
- Artifacts: none
- Verified: 2026-11-06 with `uv run pytest` on the Python tests named above.
  18 passed, including the golden path.
  Vitest ran the frontend tests in this list through `mise exec`.

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

A GPU fast path is not yet shipped: every `STAGE_IMPL[stage_id]` only has a
`"cpu"` entry today. A `"cuda"` device key backed by
`pdomain_book_tools.image_processing.cupy_processing` primitives is parked under
roadmap §D5 (Deferred — remote / cloud mode); the registry is already the
only call path so wiring it would be additive.

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

`compute_prefix(idx0, project, pages_by_idx)` derives `f###` / `p###` /
`p###[bpr]` from the proof / frontmatter / bodymatter ranges + page types.
*Known off-by-one* in the spec's loop: `range(start, min(idx0, end+1))` is
empty when `idx0 == start`, so the first frontmatter page resolves to `f000`
not `f001`. Implementation matches spec verbatim; test asserts current
behaviour.
