---
repo: pdomain/pdomain-prep-for-pgdp
spec: docs/specs/pipeline-task-model.md
status: draft — CT review
---

# GPU- and Memory-Efficient Pipeline Execution Plan

Goal: run multi-stage image processing per page **without per-stage PNG
round-trips and without GPU↔CPU ping-pong**, while preserving every contract
the pipeline model guarantees (per-stage artifacts, dual-write, re-runnability,
inspection, SSE granularity, settings, dirty propagation).

Facts audit: 2026-06-11 (main @ 3035364), across prep-for-pgdp, book-tools,
ops.

## Current costs (measured shape, per page, image-prep chain of 10 stages)

- 10× `cv2.imdecode` + 9× `cv2.imencode(".png")` on the naive path
  (~15–30 ms/codec pair → **67–135 s of pure codec waste per 500-page book**).
- The shipped `StageWriteExecutor` (deferred-write, spec-sanctioned
  "memory-resident execution model") already removes the *decode* on
  consecutive runs via its bytes cache — but every stage still pays the
  **encode** to populate the cache.
- `_ocr_cpu` writes a temp PNG file and calls the single-image OCR API even
  though `Document.from_images_ocr_via_doctr` (batch, ndarray-in) exists and
  is already used by `pdomain_ops.gpu.doctr_batch`.
- `_dewarp_cpu` hardcodes `prefer_gpu=False` even though book-tools ships a
  CuPy dewarp backend selected by that flag.
- book-tools has **unused CuPy mirrors** for: threshold, invert, rotate,
  morph, rescale, canvas, textline_dewarp (under the `[gpu]` extra). Missing
  mirrors: deskew (Hough), denoise (connectedComponents), crop/edge-finding.
- DocTR det+reco are torch (auto-CUDA); predictor is a process singleton;
  `pick_doctr_batch_sizes` + OOM backoff already exist in ops.

## Hard constraints (all stay — citations in pipeline-task-model.md)

1. **Q3**: every stage persists an on-disk artifact — no checkpoint-only mode.
   (Async write via the bounded executor is the sanctioned mechanism.)
2. **Q1/Q9**: dual-write transactional; async write failure → stage `failed` +
   dirty cascade, loudly.
3. **Q8**: bounded write pool + queue; back-pressure blocks producers.
4. Per-stage: individually re-runnable from nearest persisted upstream,
   individually inspectable artifact, per-stage `config_hash`, per-stage SSE
   `running→clean` events, per-stage settings.

Consequence: we fuse **execution**, never **artifacts**. Each stage still
emits its artifact + row + event; only the codec/transfer work moves off the
hot path.

## Phase 1 — Memory wins, no new infrastructure (prep-for-pgdp only)

1. **ndarray passthrough in StageWriteExecutor**: `put_artifact` accepts
   `ndarray | bytes`; PNG encode moves into the background writer thread
   (lazy, just before the disk write); `consume_artifact` returns the ndarray
   directly to the next stage. Removes all 9 hot-path encodes. Memory bound:
   refcounted eviction already exists; add a byte-budget cap (configurable,
   e.g. `PGDP_STAGE_CACHE_MB`, default sized to ~4 pages of float-free uint8
   arrays) that falls back to encode-and-evict under pressure.
2. **OCR without temp files**: `_ocr_cpu` calls the ndarray batch API with a
   single-image list; delete the imwrite/unlink. (Also unlocks Phase 3.)
3. **Kill the ingest anti-patterns**: `_auto_detect_attrs_cpu` re-encode and
   `_auto_detect_illustrations_cpu` temp-file — upstream book-tools API
   additions to accept ndarrays (placement: book-tools; small).

Expected: ~135–270 ms/page hot-path savings + fewer allocations; zero contract
changes; fully testable with existing equivalence tests.

## Phase 2 — GPU-resident segment execution

Concept: a **device-resident segment runner**. Within one `run_from`/run-all
pass over a page, consecutive stages whose impls have GPU mirrors execute on
a CuPy array that **stays on the GPU**; transfers happen only at segment
boundaries (a CPU-only stage, or artifact materialization).

- Segment map (today): `threshold → (deskew CPU) → (denoise CPU) → dewarp →
  post_transform_crop → canvas_map → rescale` — i.e. two GPU islands split by
  deskew+denoise.
- **Upstream work to widen the islands (placement: book-tools)**: CuPy mirrors
  for `auto_deskew` (projection-profile variant is GPU-friendly; avoid Hough)
  and `denoise_binary` (cupyx connected-components exists in
  `cupyx.scipy.ndimage.label`). With those two, the whole binary chain
  threshold→canvas_map is one GPU island.
- Artifact emission from GPU: the segment runner hands the executor either
  the device array (downloaded asynchronously in the writer thread:
  `cupy.asnumpy` → encode → fsync) or downloads at the boundary when the
  cache must serve a CPU consumer. Per-stage events/rows/config-hash emitted
  exactly as today, per stage, as each stage completes on-device.
- Dispatch selection: extend the existing impl registry from
  `{stage: {"cpu": fn}}` to `{"cpu": fn, "gpu": fn}` with device chosen by
  `pdomain_ops.gpu.pick_device` / `PD_GPU_BACKEND`; per-stage fallback to CPU
  keeps behavior identical when CuPy is absent (the `[gpu]` extra stays
  optional).
- VRAM bound: one page's chain peaks at a handful of uint8 full-page arrays;
  cap concurrent on-GPU pages (Phase 3) via a semaphore sized from free VRAM
  minus the DocTR predictor's residency.

## Phase 3 — Cross-page batching and pipelining

1. **Batch OCR**: collect N pages' OCR inputs (ndarrays, from Phase 1 cache)
   and run one `from_images_ocr_via_doctr` forward pass via ops'
   `run_doctr_batch` (det/reco batch sizes from `pick_doctr_batch_sizes`,
   OOM backoff included). Expected 2–4× OCR throughput on GPU. Integration
   point: the run-all/run-dirty project fan-out, which today runs pages
   strictly sequentially.
2. **Page pipelining**: while page k runs its GPU segment, page k−1's OCR
   batch accumulates and page k+1 decodes — a 3-slot pipeline bounded by the
   write-executor back-pressure (Q8) and the VRAM semaphore. No new
   frameworks: a small asyncio/thread orchestration in the run-all handler.
3. **Progress + events**: per-stage SSE unchanged; the batch OCR emits
   per-page `stage-status` as each page's results land (the batch API returns
   per-image results).

## Placement summary (library-placement rule)

- book-tools: ndarray-in APIs for detect_page_attributes /
  auto_detect_illustrations; CuPy mirrors for deskew + denoise; (existing
  mirrors already there).
- ops: nothing new required (doctr_batch + pick_device reused); possible
  later: a generic device-segment helper if a second app wants it.
- prep-for-pgdp: executor ndarray cache, segment runner, registry
  cpu/gpu entries, run-all pipelining.

## Sequencing & verification

- Phase 1 first (pure refactor, equivalence tests assert byte-identical
  artifacts vs the old path; perf test asserts encode-count via a counter).
- Phase 2 gated on the two book-tools mirrors (release + pin bump);
  GPU↔CPU equivalence tests with tolerance (binary images: exact equality
  expected for threshold/invert/morph; dewarp golden-tolerance).
- Phase 3 last; e2e on the local GPU (workspace has one) with a 20-page
  synthetic book: wall-clock + VRAM ceiling assertions.
- Dependencies on the seam plan: W0 (job handler / LongJobRunner) should land
  first — Phase 3's run-all integration builds on the fixed async path; W1
  (settings threading) must land first so segment execution reads the same
  effective settings as single-stage runs.

## Decisions (CT, 2026-06-11)

1. **CuPy** is the GPU vehicle for the cv2 chain (reuses book-tools' existing
   mirrors; torch stays DocTR-only).
2. **Phase order: 1 → 3 → 2.** Batch OCR (run-all throughput) before
   GPU-resident segments (workbench latency).
3. Cache/VRAM defaults are implementation-proposed, tuned on the local GPU:
   `PGDP_STAGE_CACHE_MB` default 512; VRAM page-semaphore sized at startup
   from free VRAM minus DocTR predictor residency.
