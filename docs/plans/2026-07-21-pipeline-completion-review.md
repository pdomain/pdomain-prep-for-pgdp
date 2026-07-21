---
title: Pipeline completion review and continuation plan
status: active
created: 2026-07-21
author: multi-agent deep review
repo: pdomain-prep-for-pgdp
kind: plan
---

# Pipeline completion review and continuation plan

## Agent Index

- **Kind:** plan
- **Status:** active
- **Last verified:** 2026-07-21
- **Read when:** picking the next pipeline workstream, assessing E2E readiness, or reconciling roadmap vs code.
- **Search terms:** pipeline gaps, stage completeness, E2E book path, continuation plan, text chain, pack chain, hi-fi backlog, wordcheck contract.

## Goal

Give an evidence-based picture of where the 24-stage pipeline is solid,
where it is only scaffolded, and what to build next so a user can finish a
real book on `make run`.

## Summary verdict

**Structural spine is shipped. End-to-end book completion is not.**

What is real today:

- 24 v2 stages registered with non-placeholder CPU callables
- Dual-write page and project stage stores, registry v3 numbering runs
- Full TOOL_REGISTRY + XState machines for every stage
- Strong pure-function packaging, naming, and gate DAG tests
- Hi-fi Source and Grayscale surfaces

What still fails a real book walk:

1. **Wordcheck / text-chain artifact contract** — flags JSON vs text DAG (see B0)
2. OCR compound parent-load only reads `output.*` (B1)
3. Project-stage job runner kwargs do not match stage callables (B2)
4. Text review attestation never becomes `status: clean` on disk (B3)
5. Shell runs only page `0000` for most page stages (B4)
6. OCR / wordcheck / text_review UI paths lack live queue SSE (B5)
7. Illustrations extract and package path naming are incomplete (B6)
8. Regex stage is not full text postprocess (B8)
9. Default CI never runs a golden book path or real DocTR

Roadmap (`docs/plans/roadmap.md`) marks historical P0–P3 UX tickets shipped.
That overstates live pipeline readiness. Treat this plan as the forward
queue for pipeline depth.

Adversarial review (2026-07-21) corrected several gaps in the first draft
of this plan: the wordcheck text contract, weak Wave 0 exit criteria,
attestation writer specificity, `build_package` cover/oxipng fidelity,
W0.1 sequencing, and golden-path CI placement.

---

## Architecture

### Stage topology

Page image path:

```
source → grayscale → crop → threshold → deskew → denoise → dewarp
  → post_transform_crop → canvas_map → post_ocr_crop → ocr
  → wordcheck → hyphen_join → regex → text_review
```

Parallel branches:

- `illustrations` off `source`
- `text_zones` off `post_transform_crop` (with `canvas_map`)

Project pack chain:

```
source → page_order → validation → proof_pack → build_package
  → zip → submit_check → archive
```

Canonical IDs live in `src/pdomain_prep_for_pgdp/core/models.py`
(`V2_PAGE_STAGE_IDS` + `V2_PROJECT_STAGE_IDS`). DAG deps live in
`core/pipeline/stage_dag.py`. Dispatch lives in
`core/pipeline/stage_registry.py` (`_V2_REAL_CPU_IMPLS`).

### Text-chain data contract (required design)

The live runner must preserve **two products** after OCR:

| Consumer | Needs | Source file |
|----------|-------|-------------|
| `wordcheck` | word list + boxes | OCR `words.json` |
| `hyphen_join` → `regex` → `text_review` → package `.txt` | UTF-8 page text | OCR `raw.txt` (then each stage’s text output) |

Today:

- DAG: `wordcheck` `input_type="words+text"`, `output_type="text"` (`stage_dag.py`)
- Impl: `wordcheck_v2_cpu` returns **flags-only JSON** (`steps/wordcheck.py`)
- `hyphen_join_v2_cpu` expects UTF-8 text (`steps/hyphen_join.py`)

**Do not** treat “flag-only wordcheck” as the live runner contract. Flags are
a side product. The text pipeline must pass through (or rewrite) real page
text. Fix options (pick one in Wave 0):

1. **Compound wordcheck** — emit `flags.json` + `output.txt` (pass-through or
   lightly edited OCR text); dual-write both; hyphen_join loads text.
2. **DAG rewire** — `hyphen_join` depends on `ocr` (text) and optionally
   wordcheck flags as a parallel input; package still reads text_review text.
3. **Runner fan-in** — stage runner loads parent artifacts **by consumer
   need** (`words.json` vs `raw.txt` / `output.txt`), not a single `output.*`.

Parent load must never blindly prefer `raw.txt` into wordcheck (JSON
expected) or flags JSON into hyphen_join (text expected).

### Maturity legend

| Depth | Meaning |
|-------|---------|
| **FULL** | Real transform, dual-write-shaped output, solid unit tests |
| **PARTIAL** | Callable exists; shallow logic, wrong artifact, or job path broken |
| **GATE** | Attestation / review; no material transform by design |
| **HI-FI / FUNCTIONAL / THIN / MOCK** | Frontend fidelity |

---

## Completeness matrix

### Backend stages

| stage_id | scope | Backend depth | Frontend | Highest gap |
|----------|-------|---------------|----------|-------------|
| source | project | PARTIAL | **HI-FI** | Job re-run signature vs ingest path |
| grayscale | page | FULL (+ GPU) | **HI-FI** | Flip/pre-rotate dirty-hash incomplete |
| crop | page | FULL | FUNCTIONAL | Edge detect runs on gray, not binary |
| threshold | page | FULL (+ GPU) | FUNCTIONAL | UI schema (Sauvola/adaptive) not backend |
| deskew | page | FULL (+ GPU) | FUNCTIONAL | Default skip; UI knobs not wired |
| denoise | page | FULL (+ GPU) | FUNCTIONAL | Schema names ≠ backend params |
| dewarp | page | FULL | FUNCTIONAL | Schema is design fiction; no settings model |
| post_transform_crop | page | FULL (+ GPU) | FUNCTIONAL | Default 0 insets; draft ignored on rerun |
| canvas_map | page | FULL (+ GPU) | **THIN** | Mock scatter services in UI |
| post_ocr_crop | page | FULL | FUNCTIONAL | Shared review only |
| text_zones | page | PARTIAL | FUNCTIONAL | Contour zones only; split FE/BE body mismatch |
| ocr | page | FULL | **THIN** | Compound load; no PAGE_PUSH bridge; CI mocks DocTR |
| wordcheck | page | PARTIAL | **THIN** | Flags JSON vs DAG `text`; tiny default list; UI scanning |
| hyphen_join | page | PARTIAL | FUNCTIONAL | Expects text; decisions thin; scan API real |
| regex | page | PARTIAL | FUNCTIONAL | Quotes/em-dash only; full postprocess unused |
| text_review | page | GATE incomplete | **MOCK** | Empty attestation; mock queue; no per-page clean writer |
| illustrations | page | PARTIAL | FUNCTIONAL | Detect only; no hi-res crops; pack path wrong |
| page_order | project | FULL | FUNCTIONAL | P4 OCR-folios deferred |
| validation | project | PARTIAL | FUNCTIONAL | Attestation-only rules; job kwargs risk |
| proof_pack | project | PARTIAL | FUNCTIONAL | Manifest only; kwargs risk |
| build_package | project | PARTIAL† | FUNCTIONAL | Needs clean upstreams + real text; no cover/oxipng |
| zip | project | PARTIAL | FUNCTIONAL | Needs `zip_bytes` not supplied by job runner |
| submit_check | project | PARTIAL | FUNCTIONAL | Needs zip stats not injected |
| archive | project | PARTIAL | **THIN** | Project-stage inventory only; mock keep list |

† Pure zip assembly of PNG+TXT is real (`steps/build_package.py`), but PGDP
fidelity lags legacy `core/packaging.py` (no `cover.png` alias, no oxipng).
Do not call the stage FULL for product packaging.

**Counts:** FULL ~11 · PARTIAL ~12 · GATE incomplete 1 · STUB 0

### What works for a careful expert

Ingest → image prep → OCR (page runner) can run. Pure
`build_package_v2_cpu` can emit a prefix-named zip when
`canvas_map`, `text_review`, and the naming manifest are pre-seeded
(as B4 tests do). That is not the same as a live attested book package.

### What a normal proofer cannot do today

Click through a real book to a clean attested package with correct page
text, illustrations, scanno cleanup, hyphen decisions, and live text review.

---

## Critical defects (blockers)

These are code-backed, not speculative. Fix before more UI polish.

### B0 — Wordcheck / text-chain artifact contract (highest risk)

DAG and package path assume **text** flows ocr → wordcheck → hyphen_join →
regex → text_review. Implementation returns **flags JSON** from wordcheck
and does not pass through OCR text.

- Evidence: `stage_dag.py` wordcheck `output_type="text"`; `steps/wordcheck.py`
  returns `{"flags", "flagged_count", "total_words"}`; `hyphen_join.py`
  decodes UTF-8 page text
- Impact: fixing parent load alone can produce **silent wrong `.txt` files**
  (flags JSON packaged as page text) if hyphen_join/regex consume wordcheck
  output
- Fix: Wave 0 contract work (see Architecture § Text-chain data contract);
  do not ship “keep flag-only” as the runner contract

### B1 — Compound parent load only reads `output.*`

OCR writes `words.json` + `raw.txt`. The page runner loads compound
parents by scanning for `output.*` only.

- Evidence: `stage_runner.py` (compound load ~468–485),
  `stage_registry.py` `_ocr_cpu` return keys (~1030–1033)
- Impact: **wordcheck fails dependency load** (cannot open OCR compound
  dir). After a naive B1-only fix that still feeds a single blob downstream,
  hyphen_join/regex may **silently treat flags JSON as page text** until B0
  is fixed. Restate: load-fail at wordcheck; wrong text risk after partial fix.

### B2 — Project-stage job kwargs do not match callables

Job runner always passes
`project_id`, `page_ids`, `data_root`, `book_name`, `cfg`.
Comments claim "impls ignore extras". Python does not ignore unexpected kwargs.

| Stage | Problem |
|-------|---------|
| validation, proof_pack | Extra `book_name` → TypeError |
| zip | Needs `zip_bytes`; gets generic kwargs |
| submit_check | Needs sha256 / size / page_count |
| archive | Signature mismatch |
| source | Expects source bytes path, not project kwargs |

- Evidence: `job_runner.py` ~577–600; stage signatures in `steps/*.py`
- Unit tests often call pure functions directly, so CI stays green

### B3 — Text-review attestation never becomes clean

Stage writes `attestation.json` as `{}`.
Validation requires `attestation.status == "clean"`.

**No real writer for per-page clean attestation today:**

- Project `POST …/project-stages/text_review/confirm` marks the **project**
  stage row via `_confirm_stage_impl` (`api/data/project_stages.py` ~1123–1146).
  It does **not** rewrite each page’s `attestation.json`.
- Registry docstring mentions `POST …/text_review/clean`; that route is
  **phantom** (not implemented under pages/project_stages).

- Evidence: `stage_registry.py` ~1052–1068; `validation.py` ~104–113;
  `project_stages.py` confirm path
- Impact: pack gate always blocks unless artifacts are hand-seeded
- Fix requirement: name and implement the route/event that writes
  `attestation.json` with `{"status": "clean", …}` per page (or change
  validation to a different attested source of truth), with an API test

### B4 — Shell runStage only runs page 0000

Non-OCR page stages POST only to `pages/0000/stages/{id}/run`.
Comment: "full per-page orchestration is I2".

- Evidence: `frontend/src/services/pipeline.ts` ~140–148
- Impact: Run stage / run-all-stale cannot process a multi-page book

### B5 — Interactive text tools stuck or mocked

| Tool | Production behavior |
|------|---------------------|
| OcrTool | Starts in `recognising`; no PAGE_PUSH bridge |
| WordcheckTool | Waits for SCAN_DONE; mock removed; no SSE replacement |
| TextReviewTool | `setTimeout` + `MOCK_ITEMS` on mount |
| ArchiveTool | Seeded with `MOCK_ITEMS` |
| HyphenJoinTool | Scan service is **real** (`services/tools/hyphenJoin.ts`); decision persist + workbench still thin; file header “F5 mock-only” is stale |

- Evidence: tool components under `frontend/src/pages/pipeline/tools/`

### B6 — Illustrations extract path incomplete

- Stage returns detect-only `regions.json`
- Primary multi-artifact type expects `crops.json`
- Package collector still looks under `extract_illustrations/`, not `illustrations/`
- GPU extract route raises `NotImplementedError`

### B7 — text_zones APPLY_SPLIT contract mismatch

Backend: `{ bbox, split_at_stage, suffixes }`
Frontend: `{ suffixes, bboxes }` without `split_at_stage`

- Impact: split UI 422s at runtime

### B8 — Regex stage is not Step-8 postprocess

Stage only normalizes curly quotes and em dashes.
Full `postprocess_text` (scannos, hyphen list, custom regex) exists in
`text_postprocess.py` but is not used by the registry entry.

### B9 — build_package PGDP fidelity gaps (vs legacy packaging)

v2 `build_package` writes prefix PNG/TXT + `pgdp.json` only.
Legacy `core/packaging.py` also:

- aliases cover page as `cover.png`
- runs oxipng on proofing images when enabled

- Evidence: `steps/build_package.py` ~210–251 vs `packaging.py` ~67–140
- Product decision required: port cover + oxipng into v2, or document
  explicit defer with CT OK

---

## Secondary gaps (high leverage, not first-hour blockers)

### Image-prep UI honesty

Shared `ImageStageReviewTool` shows fake thumbs and a wipe placeholder.
Rerun ignores draft schema params for threshold / deskew / denoise / dewarp.
Dewarp and canvas_map control schemas do not match backend knobs.

### Pack chain shallowness

- proof_pack: path manifest only
- zip: integrity wrapper over supplied bytes
- submit_check: empty-zip / zero-page rules only
- archive: inventory of project-stage dirs, not full page artifacts
- cover.png / oxipng: see B9

### Known bug-fix plan (parallel, mostly shipped)

[2026-07-14 review fixes](2026-07-14-review-fixes.md) listed nine bugs.
**Re-verified 2026-07-21:** tasks **1–7 and 9 are shipped** (suite auth
middleware, suite `app_id`, `resolve_job_device`, job timeout, zip off-loop,
rerun `put_job`, AppShell `api.*` client, `pdomain-ops>=0.11.2`).

Residual: plan file still marked draft with open wording; task 8 / broader
stale architecture docs → [W3.8](../issues/2026-07-21-w38-stale-docs-refresh.md)
and [parallel residual issue](../issues/2026-07-21-parallel-2026-07-14-review-fixes.md).

Do **not** re-implement shipped tasks. W0.4 still needs multi-page shell
orchestration; batch rerun enqueue (task 6) is already available if used.

### Deferred product (correctly parked)

From roadmap and intent-map:

- Modal / shared GPU container / managed container publish
- Postgres page_stages + FTS
- S3 dual-write writer (stage artifacts are Path-local)
- Compute settings panel (no warmup without visible UI)
- page_order P4 OCR-folios; P5 source back/duplicate first-class
- PDF export, multi-user sharing, i18n
- Save-a-copy project export (`comingSoon`)
- Scanno research productization (`docs/research/findings-scannos.md`)

### Adapter / ops risks

- Stuck `running` jobs after process crash (no reclaim)
- Optimistic deferred write marks DB clean before disk lands
- CDN PUT lacks ownership check in multi-user modes
- CORS `*`; session cookie `secure=False`
- apikey mode is single-tenant (`user_id="default"`)
- Architecture docs lag code (GPU “not shipped”, v1 micro-stage tables, book-tools 0.17 notes)
- **`pgdp-prep reindex --heal`** and **job/stage cancel** are dual-write exit
  paths; covered in Wave 3 (or explicit defer), not only stuck-running reclaim

### Test blind spots

- `make ci` excludes Playwright e2e
- No full API golden path: source → archive on dual-written artifacts
- Real DocTR not in default CI
- 3-page fixture only; no 20–100 page load behavior
- No property tests on pure naming / dirty / postprocess

---

## Frontend maturity ladder

```
HI-FI        source, grayscale
FUNCTIONAL   crop, ISR image stages, text_zones, page_order, illustrations,
             regex, validation, proof_pack, build_package, zip, submit_check,
             hyphen_join (scan API real; decisions thinner)
THIN / MOCK  canvas_map, ocr, wordcheck, text_review, archive
```

Design handoff under `docs/plans/design_handoff_pgdp_app/final/` still
describes richer Konva boards, scanno grids, and pack overview tabs.
Those are fidelity backlog, not missing registry entries.

---

## Continuation plan

Work in order. Each wave ends with a green `make ci AI=1` and the wave’s
**falsifiable** exit criteria below.

**Decomposed issues:** one governed node per work item under
[`docs/issues/`](../issues/README.md). Use those files for implementation
detail; this section is the queue order only.

### Wave 0 — Correctness (book path; 1–2 weeks focused)

**Priority order for book blockers** (do these first):

| ID | Issue | Work | Done when (falsifiable) |
|----|-------|------|-------------------------|
| W0.0 / W0.1 | [w00-text-chain-contract](../issues/2026-07-21-w00-text-chain-contract.md) | **Text-chain contract (B0+B1):** compound wordcheck / DAG rewire / runner fan-in; load-by-consumer-need | Runner test: ocr→…→text_review produces **UTF-8 page text**, not flags JSON; wordcheck still emits flags for UI |
| W0.2 | [w02-project-stage-job-adapter](../issues/2026-07-21-w02-project-stage-job-adapter.md) | Stage-specific project job adapter (B2) | validation→…→submit_check via jobs without TypeError; zip has sha256 |
| W0.3 | [w03-text-review-attestation](../issues/2026-07-21-w03-text-review-attestation.md) | Per-page attestation writer (B3) | API attest N pages → validation has zero `unattested_text_review` without hand-seeding |
| W0.4 | [w04-multi-page-stage-run](../issues/2026-07-21-w04-multi-page-stage-run.md) | Multi-page page-stage run (B4) | 3-page book: run crop/threshold cleans **all** pages |
| W0.5 | [w05-text-zones-split-contract](../issues/2026-07-21-w05-text-zones-split-contract.md) | text_zones APPLY_SPLIT FE/BE (B7) | APPLY_SPLIT succeeds in API + service test |
| W0.6 | [w06-golden-path-ci](../issues/2026-07-21-w06-golden-path-ci.md) | Golden-path regression in default CI | Asserts real text, clean attestation, N-page dual-write, matched png/txt |

**Parallel track (not Wave 0 exit):** remaining [2026-07-14 review fixes](2026-07-14-review-fixes.md) tasks 1–5, 7–9 (suite auth, app_id, device, timeout, zip off-loop, AppShell client, docs, pin). Each task uses its own red/green test from that plan.

**Wave 0 exit criteria (all required):**

1. Golden-path API test is in `make test` / `make ci` and green.
2. Asserted page text is UTF-8 prose, not wordcheck flags JSON.
3. Attestation unblocks validation without hand-seeded files.
4. Multi-page stage run cleans all pages in the fixture.
5. Pack project stages run via job runner without kwargs TypeError.
6. No TypeError on validation→zip path.

### Wave 1 — Text and pack product path (2–3 weeks)

| ID | Issue | Work | Done when |
|----|-------|------|-----------|
| W1.1 | [w11-regex-full-postprocess](../issues/2026-07-21-w11-regex-full-postprocess.md) | Wire `regex` to full `postprocess_text` | Runner asserts scanno apply |
| W1.2 | [w12-wordcheck-scanno-list](../issues/2026-07-21-w12-wordcheck-scanno-list.md) | Real system scanno list; flags = side product | Flags on bad fixture; package text still correct |
| W1.3 | [w13-hyphen-join-decisions](../issues/2026-07-21-w13-hyphen-join-decisions.md) | Persist hyphen decisions end-to-end | Decision survives reload; text changes |
| W1.4 | [w14-text-tools-live-sse](../issues/2026-07-21-w14-text-tools-live-sse.md) | OCR / wordcheck / text_review live queues | Tools leave scanning without test hooks |
| W1.5 | [w15-illustrations-extract](../issues/2026-07-21-w15-illustrations-extract.md) | Illustrations extract + pack path | Zip has `images/` when region present |
| W1.6 | [w16-validation-preflight](../issues/2026-07-21-w16-validation-preflight.md) | PREFLIGHT fan-in validation → build | Build gate reflects validation report |
| W1.7 | [w17-build-package-cover-oxipng](../issues/2026-07-21-w17-build-package-cover-oxipng.md) | cover.png + oxipng or CT defer | Cover alias or signed defer note |

**Exit criteria:** Expert user completes one short book zip → downloadable
package with attested **correct** text, matched png/txt pairs, and at least
one illustration when present (cover/oxipng per W1.7).

### Wave 2 — Image-prep honesty and hi-fi (2–4 weeks)

| ID | Issue | Work | Done when |
|----|-------|------|-----------|
| W2.1 | [w21-isr-real-thumbs](../issues/2026-07-21-w21-isr-real-thumbs.md) | Real before/after thumbs | No synthetic paper for threshold–dewarp |
| W2.2 | [w22-schema-backend-alignment](../issues/2026-07-21-w22-schema-backend-alignment.md) | stageSchemas ↔ backend knobs | Changing threshold changes output |
| W2.3 | [w23-canvas-map-real-data](../issues/2026-07-21-w23-canvas-map-real-data.md) | Real scatter / spreads | Mock points removed |
| W2.4 | [w24-text-zones-konva](../issues/2026-07-21-w24-text-zones-konva.md) | Konva split / zone overlays | Split works on a real page |
| W2.5 | [w25-settings-tiers-generalize](../issues/2026-07-21-w25-settings-tiers-generalize.md) | 3-tier settings beyond grayscale | At least threshold + deskew + denoise |

**Exit criteria:** Proofer can visually QA image prep and crop/split without
leaving the pipeline shell.

### Wave 3 — Quality and ops (ongoing)

| ID | Issue | Work | Done when |
|----|-------|------|-----------|
| W3.1 | — | ~~Golden-path in CI~~ | **Moved to [W0.6](../issues/2026-07-21-w06-golden-path-ci.md)** |
| W3.2 | [w32-playwright-smoke-ci](../issues/2026-07-21-w32-playwright-smoke-ci.md) | Playwright smoke in CI | Failing UI registry breaks CI |
| W3.3 | [w33-seeded-ocr-browser-fixtures](../issues/2026-07-21-w33-seeded-ocr-browser-fixtures.md) | Seeded OCR browser fixtures | W6.2 text skips closed |
| W3.4 | [w34-reclaim-stuck-running](../issues/2026-07-21-w34-reclaim-stuck-running.md) | Reclaim stuck `running` jobs | Crash recovery test |
| W3.5 | [w35-reindex-heal](../issues/2026-07-21-w35-reindex-heal.md) | reindex --heal coverage | Heal path documented + tested |
| W3.6 | [w36-job-stage-cancel](../issues/2026-07-21-w36-job-stage-cancel.md) | Job/stage cancel | Cancel works or explicit defer |
| W3.7 | [w37-cookie-cors-hardening](../issues/2026-07-21-w37-cookie-cors-hardening.md) | Cookie secure + CORS allowlist | Self-host checklist |
| W3.8 | [w38-stale-docs-refresh](../issues/2026-07-21-w38-stale-docs-refresh.md) | Stale architecture docs | Doc matches code |
| W3.9 | [w39-page-order-ocr-folios](../issues/2026-07-21-w39-page-order-ocr-folios.md) | page_order P4 OCR-folios | Folio chips real |
| W3.10 | [w310-save-copy-archive](../issues/2026-07-21-w310-save-copy-archive.md) | Save-a-copy + archive inventory | No `comingSoon` stub |

**Parallel track:** [2026-07-14 review fixes umbrella](../issues/2026-07-21-parallel-2026-07-14-review-fixes.md)

### Explicitly later (do not start unless local path is solid)

- Modal S3 bodies, SharedContainer, managed container publish
- Postgres page_stages + FTS
- S3 PageStageWriter
- Multi-user sharing / JWT multi-tenant productization
- PDF export, i18n
- Full scanno stealth fusion from research doc

---

## Recommended next session sequence

1. **Confirm W0.0 text-chain design** with CT (compound wordcheck vs DAG rewire vs runner fan-in).
2. **TDD W0.0 + W0.1 + W0.6 skeleton** — failing golden-path test first.
3. **W0.2 job adapter** — pack stages runnable.
4. **W0.3 attestation writer** — real per-page clean path.
5. **W0.4 multi-page run** — wire shell to existing batch/rerun enqueue (task 6 already shipped).
6. **W0.5 split contract**.
7. Land golden-path green in CI; only then Wave 1 or Wave 2.
8. Residual: update draft 2026-07-14 plan status; W3.8 for remaining doc drift.

Use worktrees for implementation branches. Run `make ci AI=1` before each
commit. Prefer pure-function TDD for adapter and artifact-key logic.

---

## Evidence index

| Topic | Primary locations |
|-------|-------------------|
| Stage IDs | `core/models.py` V2_*_STAGE_IDS |
| DAG text types | `core/pipeline/stage_dag.py` wordcheck/hyphen_join |
| Wordcheck flags-only | `core/pipeline/steps/wordcheck.py` |
| Hyphen expects text | `core/pipeline/steps/hyphen_join.py` |
| Impl registry | `core/pipeline/stage_registry.py` `_V2_REAL_CPU_IMPLS` |
| Compound load bug | `core/pipeline/stage_runner.py` ~468–485 |
| Job kwargs | `core/job_runner.py` ~577–600 |
| Empty attestation | `stage_registry.py` ~1067–1068; `steps/validation.py` ~104–113 |
| Project confirm only | `api/data/project_stages.py` text_review confirm |
| Shell page-0 run | `frontend/src/services/pipeline.ts` ~140–148 |
| Text UI mocks | `TextReviewTool.tsx`, `WordcheckTool.tsx`, `OcrTool.tsx`, `ArchiveTool.tsx` |
| Hyphen scan real | `frontend/src/services/tools/hyphenJoin.ts` |
| Pack pure path | `steps/build_package.py`; legacy cover/oxipng `core/packaging.py` |
| E2E stops at gate | `tests/test_e2e_pipeline.py` |
| Browser suite | `tests/e2e/` (excluded from `make ci`) |
| Review bug list | [2026-07-14-review-fixes.md](2026-07-14-review-fixes.md) |
| Design handoff | `docs/plans/design_handoff_pgdp_app/` |
| Prior roadmap | [roadmap.md](roadmap.md) |
| Reindex heal | `cli/reindex.py` / dual-write docs |

---

## Review method

This plan was produced by eight parallel read-only explore agents covering:

1. Backend stage completeness
2. Frontend tool / service fidelity
3. API route inventory and stubs
4. OCR → text → pack E2E path
5. Test and e2e coverage
6. Adapters, dual-write, jobs, security
7. Design handoff vs shipped UI
8. Image-prep chain deep map

Orchestrator spot-checked the highest-risk claims against source, then an
independent adversarial review corrected plan gaps (B0 contract, Wave 0
exit strength, attestation writer specificity, build_package fidelity,
W0.1 sequencing, golden-path CI placement, reindex/cancel ops).

## Tech Stack

Unchanged: FastAPI, Python 3.13, React 19, XState v5, SQLite/filesystem,
pdomain-book-tools, pdomain-ops. Optional GPU via CuPy keys in the registry.

## Global Constraints

- Local-first before cloud adapters
- Dual-write remains mandatory; do not bypass with ad-hoc file writes
- No phantom `scannocheck` stage; improve `wordcheck` (flags + text contract)
- Generated OpenAPI remains the contract
- Do not reintroduce backend `project_run_dirty` fan-out
- TDD for pure artifact/adapter logic; `make ci AI=1` before commit
- Wave 0 golden-path asserts **content correctness**, not only “stages ran”
