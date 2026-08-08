---
Status: active
Owner: CT
Created: 2026-07-21
Last verified: 2026-07-21
Kind: process
Level: I1
---

# Issues

## Agent Index

- **Kind:** process
- **Status:** active
- **Level:** I1
- **Last verified:** 2026-07-21
- **Read when:** filing a bug / defect / investigation report, or looking up an
  open issue's status, evidence, or resolution.
- **Search terms:** issues folder, bug report, defect report, issue template,
  issue lifecycle, kind issue, pipeline completion.

## Purpose

`docs/issues/` holds **governed, evidence-bearing issue reports** — bugs, silent
failures, regressions, and investigations that need a durable, citable record.
Each report is a docgraph node so it is retrievable and linkable from plans and
context docs.

Pipeline completion work items decomposed from
[pipeline completion review](../plans/2026-07-21-pipeline-completion-review.md)
live here as one file each (Wave 0–3). Historical UX tickets and deferred cloud
work stay on [roadmap](../plans/roadmap.md) unless they become evidence-bearing
defects.

## Convention

- **Location:** `docs/issues/`
- **Filename:** `YYYY-MM-DD-short-slug.md` (creation date + terse kebab slug).
- **Metadata:** YAML frontmatter **and** a matching `## Agent Index` block.
  Keep frontmatter `Status:` and Agent Index `Status:` identical.
  - `Kind: issue`
  - `Level:` `I1` repo-wide, `I2` narrow/local
  - Open issues: `Status: active` + `Resolution: Open`
  - Closed (`Resolution: Resolved|Won't fix|Duplicate`): route through
    `doc-retirer`, which deletes the report after promoting anything durable
    into the doc that owns it and writing a tombstone to
    `docs/context/decisions.md`. Git history keeps the report.
- **Required sections** (docgraph): Summary, Impact, Environment / versions,
  Evidence, Root-cause hypotheses, Defects to fix, Next steps, Resolution.
- **Link it:** list under **Open issues** below and from the parent plan.
- **Stage + reindex:** `git add`, then `docgraph reindex` and
  `docgraph check --strict` same turn.
- **Template:** copy `TEMPLATE.md` in this folder (index-excluded; do not
  markdown-link the template file).

## Parent plan

[Pipeline completion review and continuation plan](../plans/2026-07-21-pipeline-completion-review.md)

Parallel bug track (not Wave 0 exit):
[2026-07-14 review fixes](../plans/2026-07-14-review-fixes.md)

## Open issues

### Wave 0 — Correctness (book path)

- [Text-chain contract and compound parent load (W0.0 / W0.1)](2026-07-21-w00-text-chain-contract.md)
- [Project-stage job kwargs adapter (W0.2)](2026-07-21-w02-project-stage-job-adapter.md)
- [Per-page text_review attestation writer (W0.3)](2026-07-21-w03-text-review-attestation.md)
- [Multi-page page-stage run from shell (W0.4)](2026-07-21-w04-multi-page-stage-run.md)
- [text_zones APPLY_SPLIT FE/BE contract (W0.5)](2026-07-21-w05-text-zones-split-contract.md)
- [Golden-path CI regression (W0.6)](2026-07-21-w06-golden-path-ci.md)

### Wave 1 — Text and pack product path

- [Wire regex stage to full postprocess_text (W1.1)](2026-07-21-w11-regex-full-postprocess.md)
- [Wordcheck system scanno list (W1.2)](2026-07-21-w12-wordcheck-scanno-list.md)
- [Hyphen_join decision persistence (W1.3)](2026-07-21-w13-hyphen-join-decisions.md)
- [OCR / wordcheck / text_review live queues (W1.4)](2026-07-21-w14-text-tools-live-sse.md)
- [Illustrations extract and package path (W1.5)](2026-07-21-w15-illustrations-extract.md)
- [Validation PREFLIGHT fan-in to build_package (W1.6)](2026-07-21-w16-validation-preflight.md)
- [build_package cover.png and oxipng (W1.7)](2026-07-21-w17-build-package-cover-oxipng.md)

### Wave 2 — Image-prep honesty and hi-fi

- [ImageStageReview real before/after thumbs (W2.1)](2026-07-21-w21-isr-real-thumbs.md)
- [stageSchemas aligned with backend knobs (W2.2)](2026-07-21-w22-schema-backend-alignment.md)
- [canvas_map real scatter and spreads (W2.3)](2026-07-21-w23-canvas-map-real-data.md)
- [text_zones Konva split UI (W2.4)](2026-07-21-w24-text-zones-konva.md)
- [3-tier settings beyond grayscale (W2.5)](2026-07-21-w25-settings-tiers-generalize.md)

### Wave 3 — Quality and ops

- [Playwright smoke subset in CI (W3.2)](2026-07-21-w32-playwright-smoke-ci.md)
- [Seeded OCR fixtures for browser text tools (W3.3)](2026-07-21-w33-seeded-ocr-browser-fixtures.md)
- [Reclaim stuck running jobs on startup (W3.4)](2026-07-21-w34-reclaim-stuck-running.md)
- [reindex --heal coverage (W3.5)](2026-07-21-w35-reindex-heal.md)
- [Job/stage cancel path (W3.6)](2026-07-21-w36-job-stage-cancel.md)
- [Cookie secure + CORS allowlist (W3.7)](2026-07-21-w37-cookie-cors-hardening.md)
- [Stale architecture docs refresh (W3.8)](2026-07-21-w38-stale-docs-refresh.md)
- [page_order P4 OCR-folios (W3.9)](2026-07-21-w39-page-order-ocr-folios.md)
- [Save-a-copy export and archive inventory (W3.10)](2026-07-21-w310-save-copy-archive.md)

### Parallel track

- [2026-07-14 review fixes residual (tasks 1–7,9 shipped; docs
  leftover)](2026-07-21-parallel-2026-07-14-review-fixes.md)

Resolved reports are deleted, so this index tracks open work only. Past
resolutions live in the `docs/context/decisions.md` tombstones and in git
history.
