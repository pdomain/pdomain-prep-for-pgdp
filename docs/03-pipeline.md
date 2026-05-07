# 03 — Pipeline

> **Authoritative spec:** the pipeline is a per-page DAG of named
> stages, defined in
> [`docs/specs/pipeline-task-model.md`](specs/pipeline-task-model.md)
> and described stage-by-stage in `specs/02-pipeline-steps.md`. This
> doc is a code-level guide to where each stage's implementation lives
> today and how OCR mirrors `pd-ocr-cli`. Step IDs from the legacy
> step-numbered model are kept for transition; see spec 02 §Step-numbered
> legacy mapping for the stage-to-step crosswalk.

## Stage-to-code map

The canonical spec describes 16 per-page stages plus project-level
orchestration tasks. Today's code lives at:

| Stage / task | Code | Status |
|---|---|---|
| `project.ingest` | `core/ingest.py` `ingest_source()` | ✅ shipped (still under legacy "Step 0") |
| `ingest_source` (per-page) | `core/ingest.py` (root pages); split-child path lands in M1 | ✅ root / 🟡 child |
| `thumbnail` | `core/ingest.py` `_make_thumbnail_bytes()` (in-memory) | ✅ |
| `auto_detect_attrs` / `auto_detect_illustrations` | `core/auto_detect.py` / `core/illustrations.auto_detect_illustrations` | ✅ |
| `decode_source` … `canvas_map` (the proofing chain) | bundled in `core/pipeline/process_page.py` `process_page_cpu()` today; M2 unbundles into `STAGE_IMPL[...]['cpu']` entries | 🟡 bundled |
| `blank_proof_synth` | `core/pipeline/blank_proof.py` | ✅ |
| `ocr_crop` | `core/pipeline/crop_for_ocr.py` | ✅ |
| `extract_illustrations` | `core/illustrations.py` (extract + auto-detect) | ✅ |
| `ocr` | `core/ocr.py` (mirrors pd-ocr-cli) | ✅ |
| `text_postprocess` | `core/text_postprocess.py` | ✅ |
| `text_review` (gate) | `PATCH /pages/{idx0}/text` (edit) + `POST /api/pages/{id}/text_review/clean` (attest); the explicit gate route lands in M2 | 🟡 partial |
| `project.build_package` | `core/packaging.py`; the `awaiting_review` parking state lands in M5 | 🟡 partial |

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
   (writes a tempfile so pd-book-tools' detector can take a path) and
   filters to figure / decoration / table regions above the confidence
   threshold.
4. Constructs a `PageRecord` and appends. After each page, `progress_cb`
   fires with `(processed, total, stem)` so the runner emits an SSE event.

Corrupt entries land in `IngestResult.errors` without aborting the batch.

After the loop, if any pages were ingested and `auto_detect=True`, the median
`height/width` ratio is recorded into `Project.config.default_overrides["page_h_w_ratio"]`.

## Stage 4 sub-chain — proofing chain (CPU implementation)

The proofing-chain stages (`decode_source` → `initial_crop` →
`manual_deskew_pre` → `grayscale` → `threshold` → `invert` →
`find_content_edges` → `crop_to_content` → `auto_deskew` → `morph_fill` →
`rescale` → `canvas_map`) are currently bundled in
`process_page_cpu(source_image_bytes, cfg: ResolvedPageConfig)` —
a single function that runs the whole chain in sequence using
`pd_book_tools.image_processing.cv2_processing` primitives. The
function returns `ProcessPageOutput(proofing_png, pre_ocr_png, height,
width)`.

M2 introduces the `STAGE_IMPL[stage_id][device]` registry (canonical
spec Q5) — each sub-step gets a registered callable and the runner
walks the DAG calling them individually with in-memory artifacts. M5
routes every existing call through the registry; M6 deletes
`process_page_cpu` outright (the project-level "run all CPU stages
in a row" path becomes an imperative composition of registry calls).

For `page_type ∈ {blank, plate_b, plate_r}` the function short-circuits to a
canonical-aspect blank PNG (`blank_proof.create_blank_proof`) — this is
the `blank_proof_synth` stage in the canonical DAG.

The GPU path (`adapters/gpu/local.py`) is a thin subclass of `CpuBackend`
(DocTR / PyTorch auto-pick `cuda:0`). `pd_book_tools.image_processing.cupy_processing`
primitives are still owed for the Step-4 image-processing fast path — see
roadmap M2/M5 for when they wire up via the registry's `"cuda"` entries.

## Stage `ocr_crop` — crop for OCR

Uniform OCR border crop (project-wide top/bottom/left/right) applied to
the proofing image. With splits as sibling pages (canonical spec Q6),
each child page runs its own `ocr_crop` independently — the legacy
"yield one crop per split" inner loop is gone. Each page (root or
split-child) produces exactly one `ocr_image` artifact.

## Step 7 — OCR (mirrors pd-ocr-cli)

`core/ocr.py` follows `pd-ocr-cli/pd_ocr_cli/ocr_to_txt.py:307–540` verbatim
(see `feedback_ocr_follows_pd_ocr_cli.md` in memory):

1. **Resolve models** (`core/hf_models.py`):
   - `resolve_ocr_models(repo, det_filename, reco_filename, ...)` — local
     paths or HF Hub download with `(.arch, .vocab)` sidecars.
   - `resolve_layout_source(layout_model, layout_checkpoint)` — for
     `pp-doclayout-plus-l`, looks up the HF repo + revision exposed by
     `pd_book_tools.layout.adapters.pp_doclayout.PPDocLayoutPlusLDetector`.
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
4. **Adapt** the resulting `pd_book_tools.ocr.word.Word` objects to spec-08
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

Spec 01 says the pipeline never reads raw config layers — only a resolved
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
