# CLAUDE.md

Quick reference for AI assistants working on this repo.

## What this repo is

Web app that converts a folder/zip of scanned book images into a PGDP-ready
submission package. Single Python wheel ships everywhere — solo proofer on a
laptop, small-team self-hosted, or hosted multi-tenant.

Architecture overview lives in `specs/00-overview.md`. The full spec set
(`specs/00`–`specs/09`) is the **source of truth** for design decisions —
they encode an already-applied refactor proposal (`specs/REFACTOR-PROPOSAL.md`),
so treat 00–09 as canonical and the proposal as historical context.

## Quick orientation

- **Backend:** FastAPI + uvicorn, Python 3.13. `src/pd_prep_for_pgdp/`.
- **Frontend:** React 19 + Vite + TS + TanStack Query + Konva + Tailwind. `frontend/`.
- **Pipeline core:** `src/pd_prep_for_pgdp/core/` — mode-agnostic, used by every adapter.
- **Adapters:** `src/pd_prep_for_pgdp/adapters/` — `IStorage` (filesystem/S3),
  `IDatabase` (SQLite/Postgres), `IAuth` (none/apikey/jwt), `GPUBackend`
  (cpu/local/modal/shared_container). Selected at startup by `Settings`.
- **OCR:** `core/ocr.py` mirrors `pd-ocr-cli`'s flow verbatim: load DocTR
  predictor (process-singleton) → load layout detector → run page →
  `page.reorganize_page(layout=...)` → optional `validate_word_preservation`.
  See `pd-ocr-cli/pd_ocr_cli/ocr_to_txt.py:307-540` for the canonical reference.
- **Pipeline steps:** spec 02. Step IDs: 0/1/2 ingest, 4 process page,
  4.5 illustrations, 6 OCR crop, 7 OCR, 8 text post-process, 10 package.

## Run tests

```sh
cd /workspaces/ocr-container/pd-prep-for-pgdp
make test    # canonical — `uv run pytest tests/ -v --ignore=tests/e2e`
make e2e     # Playwright e2e suite (separate uv group)
```

The project has its own `.venv/` (provisioned by `make setup` via `uv`).
Targeted runs: `uv run pytest -k <pattern>`. Prefer Make targets.

## Run the app

```sh
# Canonical single-process run (builds SPA bundle, then launches pgdp-prep)
make run        # auto-detect GPU; comes up at http://127.0.0.1:8765
make run-cpu    # same, but forces PGDP_GPU_BACKEND=cpu

# Local dev with hot-reload (two-process)
make frontend-dev    # one terminal — Vite on :5173
uv run pgdp-prep --reload --frontend-dev http://localhost:5173   # other terminal — :8765
```

## Test conventions

- **TDD-first** for pure-function additions (resolver, prefix, packaging
  manifests, scannos, etc). Write the test with concrete expected output, then
  the implementation. See `tests/test_text_postprocess.py` for the pattern.
- **Stub-shaped work** (route stubs, adapter Protocols) is exempt — just
  write the stub.
- **Pipeline modules** that depend on cv2 / pd-book-tools get
  integration-shaped tests on synthetic inputs (e.g. `test_process_page.py`'s
  black-on-white round-trip through Step 4).

## Known spec quirks

- **`compute_prefix` off-by-one:** the spec's loop `range(start, min(idx0, end+1))`
  is empty when `idx0 == start`, so the first frontmatter page resolves to
  `f000` instead of `f001` despite `frontmatter_page_nbr_start=1`.
  Implementation matches the spec verbatim; `test_compute_prefix_basic_numbering`
  asserts current `f000` behavior so a future fix is an intentional change.

## Decisions (locked 2026-05-07 — details in linked specs)

- **Pipeline task-model refactor:** per-page stage DAG + dirty propagation + splits-as-sibling-pages.
  No new `JobType.batch_*` values; no new sub-steps in `core/pipeline/process_page.py` monolith.
  Spec: `docs/specs/pipeline-task-model.md`.
- **Dual-write contract:** every stage write = transaction across on-disk artifact + `page_stages`
  DB row. `pgdp-prep reindex` is source-of-truth arbiter. Never bypass this path.
- **Splits = sibling pages:** split produces N new sibling `Page` rows with `parent_page_id` /
  `source_crop_bbox` / `split_index` / `split_at_stage`. Not config on `ocr_crop`.
- **Local-first:** active work = SQLite + filesystem + CPU. Cloud/remote items parked in `docs/08-roadmap.md §Deferred`.
- `pd-book-tools` pinned to `v0.9.0`. Upgrade: `make upgrade-pd-book-tools`.
- `gpu_backend="cpu"` is the test default. `LocalBackend` subclasses `CpuBackend`; Modal/SharedContainer require real config.
- `make build` runs `frontend-build` first so the wheel ships with the SPA bundle.
- Data API: every route filters by `user.user_id`; flipping `auth_mode` `none`→`jwt` is multi-user-safe.

## Sibling repos

In `/workspaces/ocr-container/` (when present):

- `pd-book-tools/` — shared OCR/geometry/image-processing primitives.
- `pd-ocr-cli/` — the install.sh + uv-tool pattern this repo mirrors.
- `pd-ocr-labeler/` — separate labeler UI (DocTR labels).
- `pd-ocr-trainer/` — DocTR training, out of scope here.

## Spec lifecycle

Design spec files (`docs/specs/<date>-<topic>-design.md`) live in `docs/specs/` while the
milestone's chore issues are open. When the last chore closes and the implementation ships,
move the file to `docs/architecture/` and commit. See workspace `docs/conventions.md`.
