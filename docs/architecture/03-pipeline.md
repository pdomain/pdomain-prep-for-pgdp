# 03 — Pipeline

> **Authoritative spec:** the pipeline is a per-page DAG of named
> stages, defined in
> [`../specs/pipeline-task-model.md`](../specs/pipeline-task-model.md)
> and described stage-by-stage in `specs/02-pipeline-steps.md`. M1–M6
> are all shipped (see `../archive/plans/roadmap-shipped.md`); per AD-7,
> `STAGE_IMPL[stage_id][device]` in `core/pipeline/stage_registry.py`
> is the only execution path. This doc is a code-level guide to where
> each stage's implementation lives today and how OCR mirrors
> `pdomain-ocr-cli`.

## Stage-to-code map

The canonical spec describes 22 per-page stages plus project-level
orchestration tasks. Today's code lives at:

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
| `project.build_package` | `core/packaging.py`; parks in `awaiting_review` job state when any proof-range page is un-attested, auto-resumes when the gate clears (canonical spec Q7) |

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
(canonical spec Q4).

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
the proofing image. With splits as sibling pages (canonical spec Q6),
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
