---
title: GPU grayscale (GEGL CuPy) + shared 3-tier stage settings
repo: pdomain-prep-for-pgdp (+ pdomain-book-tools)
status: planning
created: 2026-06-15
---

# GPU grayscale + shared page/project/all stage settings

Two CT directives (2026-06-15):
1. Grayscale must be **GPU-capable via the GEGL CuPy grayscale** CT wrote in book-tools — not CPU-only.
2. Stage settings become a **shared 3-tier model**: **page** override → **project** default → **all** (app-wide) default.

## Phase G1 — book-tools: align the GEGL CuPy grayscale (prereq)
- Locate CT's GEGL-based CuPy grayscale in `pdomain_book_tools/image_processing/cupy_processing/`.
- Make it interchangeable with the CPU `cv2_processing.to_grayscale` (v0.20.0): same param surface
  (`mode` perceptual/standard, `sampler_radius`, `gamma`, `output_range`), same in/out contract
  (BGR ndarray in, uint8 grayscale out), graceful when CuPy/GPU absent. Align/extend if it differs.
- Tests for parity (GPU result ≈ CPU result within tolerance). Release a book-tools minor **only if changed**.

## Phase S1 — prep: shared 3-tier settings model (foundational)
- Extend `StageSettingsStore` + `apply_stage_settings_to_config` to resolve **page ?? project ?? all**.
- Storage mapping:
  - **all** (app-wide, across projects) → `pdomain-ops` prefs (the app-level prefs mechanism).
  - **project** default → `StageSettingsStore` keyed `(project_id, stage)` — today's "save as default".
  - **page** override → `StageSettingsStore` new per-page tier keyed `(project_id, stage, idx0)`.
- API: read/write each tier incl. per-page; GET returns the resolved value + which tier supplied it.
- Event-logged (dual-write). Applies to **all tunable stages**, not just grayscale (shared mechanism).

## Phase G2 — prep: grayscale GPU impl + dispatch fix
- Register a grayscale **GPU stage impl** calling the GEGL CuPy fn; add to `_GPU_CAPABLE_STAGE_IDS` / `_GPU_IMPL_MAP`.
- **Fix the dispatch bug** the audit found: GPU impls register under key `"gpu"` but jobs send `"cuda"`
  → `V2_STAGE_IMPL[stage]["cuda"]` KeyErrors. Map device→impl-key so GPU actually runs (fixes ALL GPU stages).
- CPU `to_grayscale` stays the fallback when no GPU / CuPy unavailable. Verify on the local GPU.

## Phase F1 — frontend: per-page override + project + all
- Workbench: **per-page override** control (sets the page tier); show the **resolved** value + its source tier.
- Project default = existing "Save as default" (project tier). App **all** default editable in app Settings.
- Wire to the 3-tier API; per-page tune re-runs only that page.

## Verify / land
- Live on the local GPU + 233-page sample: GPU grayscale runs; a per-page override changes only that page;
  project/all defaults resolve correctly. `make ci` green each phase. ff-merge → push (CT-authorized).

## Open design choices (confirm)
- OC-1: **all** default in `pdomain-ops` prefs (app-global) vs a global row in `StageSettingsStore`. (Recommend prefs.)
- OC-2: shared model now covers all tunable stages; only grayscale exposes per-page UI initially (others later)?
- OC-3: GPU auto-selected when available (PD_GPU_BACKEND), with CPU fallback — confirm default is "use GPU if present".
