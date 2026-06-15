---
title: Grayscale as a composable CPU/GPU pipeline with 3-tier settings
status: draft (for CT review)
created: 2026-06-15
repo: pdomain-prep-for-pgdp (+ pdomain-book-tools)
related: docs/plans/grayscale-gpu-and-shared-settings-tiers.md
---

## 1. Summary

Replace the single-algorithm grayscale stage with a **composable pipeline** that runs on **CPU or GPU**
(GPU auto-selected when present, CPU fallback), tuned via the **shared 3-tier settings** (page → project → all):

```text
[ optional: Background-flatten ]  →  [ pick ONE converter ]  →  [ optional: CLAHE ]
  illumination normalization          BT.601 luma                 local contrast
  (color, pre-convert)                CIELAB L*                    (gray, post-convert)
                                      Color2Gray (CuPy)
                                      Green / best-channel
```

Converters are mutually exclusive; flatten and CLAHE compose with any converter. Each op has a CPU and a
CuPy implementation in `pdomain-book-tools` so CPU and GPU produce matching results.

## 2. Motivation

Scanned book pages have problems plain luminance can't fix: yellowing/foxing (color cast), uneven lighting and
gutter shadows, faded ink, and color plates. Different books need different treatments, and the strongest results
come from *combining* steps (e.g. flatten → green-channel → CLAHE). A single fixed conversion can't express that;
a small pipeline can, and the 3-tier settings let a global default be overridden per project and per page.

CT confirmed (2026-06-15): composable pipeline; modes = BT.601 luma, CIELAB L*, Color2Gray, Green/best-channel,
Background-flatten (pre), CLAHE (post); GPU via the CuPy path; settings shared page/project/all.

## 3. Goals / non-goals

Goals:

- A grayscale stage that runs `flatten? → converter → clahe?` with per-op params, on CPU or GPU.
- CPU and GPU impls per op in book-tools, producing matching output (parity-tested).
- Whole pipeline config is a stage-settings value resolved page → project → all → registry default.
- GPU auto-select + the dispatch-key fix so GPU stages actually run.

Non-goals:

- Binarization / thresholding (separate stage).
- Rolling-ball vs morphological background — pick one defensible flatten method first (OQ-2).
- Re-OCR or detector changes.

## 4. Pipeline model

A grayscale config is:

- `flatten`: `{ enabled: bool, method: "blur-divide", radius: int, strength: float }` (optional pre-step, on color).
- `converter`: one of
  - `luma` — BT.601 weighted luma (the "standard" default). No params.
  - `lab_l` — CIELAB L* channel. No params.
  - `color2gray` — contrast-preserving (CuPy `cupy_color_to_gray` + new CPU port).
    Params: `radius, samples, iterations, enhance_shadows`.
  - `best_channel` — pick green by default, or auto highest-contrast. Params: `channel: "green"|"red"|"blue"|"auto"`.
- `clahe`: `{ enabled: bool, clip_limit: float, tile_grid: int }` (optional post-step, on gray).
- `output_range`: optional final linear stretch `(min,max)` (carry-over from today; off by default).

The stage applies flatten (if enabled) on the color image, runs the chosen converter to 1-channel, then CLAHE
(if enabled), then output-range stretch (if set), and writes the uint8 grayscale artifact.

## 5. Per-operation implementations (book-tools)

All live in `pdomain_book_tools/image_processing/` with CPU (`cv2_processing`/numpy) and GPU (`cupy_processing`)
variants behind a thin selector; CuPy guarded by `require_cupy()` with CPU fallback.

- Background-flatten: CPU = `cv2.GaussianBlur` (large kernel) then `divide` (or morphological open) and rescale;
  GPU = `cupyx.scipy.ndimage` equivalent.
- BT.601 luma: CPU = `cv2.cvtColor(BGR2GRAY)` (or `to_grayscale(mode="standard")`); GPU = weighted channel sum.
- CIELAB L*: CPU = `cv2.cvtColor(BGR2LAB)` → L; GPU = color-transform in CuPy.
- Color2Gray: GPU = existing `cupy_color_to_gray` / `np_uint8_color_to_gray`; CPU = **new numpy port of the same
  math** (the missing piece — there is no CPU Color2Gray today, only the `run_gegl_c2g` binary shim). Parity-tested vs GPU.
- Green/best-channel: trivial channel select; "auto" picks the channel with max variance/contrast. CPU + CuPy.
- CLAHE: CPU = `cv2.createCLAHE`; GPU = CuPy CLAHE (tile histogram eq).

`to_grayscale` (v0.20.0 BT.709) stays in book-tools; the stage's "standard" converter uses BT.601 luma. If a
book-tools release is needed for the new functions, cut a minor and bump prep.

## 6. Settings integration (3-tier, already built in S1)

The 3-tier `StageSettingsStore` (page ?? project ?? all ?? registry, commit 9df1101) carries the whole grayscale
pipeline config as the stage-settings value. `STAGE_SETTINGS_DEFAULTS["grayscale"]` becomes the default pipeline
(`flatten off, converter=luma, clahe off`). `apply_stage_settings_to_config` maps the nested config onto the run.
The "all" tier moves to `pdomain-ops` prefs per OC-1 (S1 currently uses a JSON file — fixup).

## 7. Stage execution + GPU dispatch

- Register a grayscale GPU stage impl; add grayscale to `_GPU_CAPABLE_STAGE_IDS` / `_GPU_IMPL_MAP`.
- **Fix the dispatch-key bug** (audit): GPU impls register under `"gpu"` but jobs send `"cuda"` → KeyError. Map the
  device value to the impl key so GPU runs (fixes every GPU-capable stage, not just grayscale). CPU stays fallback.
- Device chosen by `PD_GPU_BACKEND` / availability; verify on the local GPU. Dual-write (artifact + row + event) unchanged.

## 8. Frontend

- Workbench grayscale panel becomes the pipeline editor: flatten toggle+params, converter picker+params, CLAHE
  toggle+params, optional output-range. Shows the **resolved** value and which tier supplied it (page/project/all).
- Per-page override writes the page tier; "Save as project default" writes the project tier; app Settings edits the
  "all" tier. Apply&Run / Re-run unchanged.

## 8a. Auto / best-default detector

Extend the existing grayscale `detect` endpoint from "pick a mode" to "recommend the whole pipeline", GPU-aware.
It samples ~8 pages spread across the book and reads four signals:

- color presence — mean Cb/Cr std in YCbCr (today's check);
- foxing / color cast — per-channel mean & contrast imbalance (degraded red, yellow cast);
- uneven illumination — low-frequency luminance spread (heavy downsample → background gradient);
- faded / low contrast — luma histogram spread + high-pass energy.

It composes a pipeline config and picks the converter GPU-aware:

- GPU present and meaningful color → `color2gray`;
- strong foxing/yellowing → `best_channel` (green);
- mostly clean B&W → `luma`;
- CPU-only with color → `best_channel` (Color2Gray is too slow on CPU for long books);

and sets `flatten.enabled` / `clahe.enabled` from the illumination / contrast signals. The response includes a
human reason string (like today's detect banner). Surfaced as the **Auto** action (apply per page or as the project
default) and optionally **auto-run on ingest to seed the project default**. The static registry default stays plain
`luma` for determinism; "Auto" is what produces the real best default.

## 9. Migration

Existing grayscale settings (`grayscale_mode/sampler_radius/gamma/output_range`) map to the new config:
`mode=standard → converter=luma`; `mode=perceptual → converter=color2gray` (closest contrast-preserving intent) or
keep a `luma_bt709` converter if exact continuity is wanted (OQ-1); `output_range` carries over. Stamp the settings
schema version; old values upgrade on read.

## 10. Phasing

- P0 — book-tools: implement the 6 ops CPU+CuPy (+ Color2Gray CPU port) with parity tests; release; bump prep.
- P1 — prep backend: pipeline config schema + execution (flatten→convert→clahe→range) on CPU; STAGE defaults; map settings.
- P2 — prep: GPU impls wired + the dispatch-key fix; verify on local GPU (CPU/GPU parity on a real page).
- P3 — settings: fix "all"→ops prefs; grayscale pipeline config flows through the 3-tier resolution end-to-end.
- P4 — frontend: pipeline editor + resolved/source display + per-tier save.
- P5 — live-verify on the 233-page sample: flatten+green+CLAHE visibly better; per-page override affects only that page.

Each phase ends `make ci` green + live-verified.

## 11. Testing

- Per-op CPU/GPU **parity** tests (GPU result ≈ CPU within tolerance) on synthetic color images.
- Pipeline composition: flatten→converter→clahe produces expected ordering; each op's params change output (byte-diff).
- 3-tier resolution of the pipeline config (page over project over all); per-page override applied at run time.
- Migration: old settings → new config equivalence.

## 12. Open questions (CT)

- OQ-1: RESOLVED in part — static default stays `luma`; the **Auto detector (§8a)** computes the GPU-aware best
  default. Remaining sub-question: for existing `mode=perceptual` projects, migrate to a `luma_bt709` converter for
  exact prior output (no surprise), with Color2Gray offered as a new choice? (Recommend yes — exact continuity.)
- OQ-2: Background-flatten method — Gaussian blur-divide (simple, fast) vs morphological/rolling-ball (better on
  textured paper)? Start with blur-divide?
- OQ-3: "auto" best-channel metric — variance, gradient energy, or text-stroke contrast?
- OQ-4: CLAHE on GPU — implement in CuPy, or run CLAHE on CPU even in the GPU path (small cost) to avoid a CuPy CLAHE?
- OQ-5: Should background-flatten also be exposable as its own enhancement stage later, or grayscale-only for now?
