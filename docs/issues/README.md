---
Status: active
Owner: CT
Created: 2026-07-21
Last verified: 2026-11-07
Kind: process
Level: I1
---

# Issues

## Agent Index

- **Kind:** process
- **Status:** active
- **Level:** I1
- **Last verified:** 2026-11-07
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

The July review fixes shipped. Their contracts are in
[backend safeguards](../architecture/02-backend.md#suite-identity-authentication-and-job-safeguards).
The 2026-11-07 source audit completed W3.8. Current architecture and the retirement ledger preserve its findings.

## Open issues

Wave 0 (correctness, book path) shipped on 2026-11-06. The reports were retired.
Current behavior is in [Book path contracts](../architecture/03-pipeline.md#book-path-contracts).
The tombstone is in [decisions](../context/decisions.md).

### Wave 1 — Text and pack product path

Shipped on 2026-11-07. The reports were retired.
Current behavior is in [Book path contracts](../architecture/03-pipeline.md#book-path-contracts).
The tombstone is in [decisions](../context/decisions.md).

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
- [page_order P4 OCR-folios (W3.9)](2026-07-21-w39-page-order-ocr-folios.md)
- [Save-a-copy export and archive inventory (W3.10)](2026-07-21-w310-save-copy-archive.md)

Resolved reports are deleted, so this index tracks open work only. Past
resolutions live in the `docs/context/decisions.md` tombstones and in git
history.
