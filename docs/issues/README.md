---
Status: active
Owner: CT
Created: 2026-07-21
Last verified: 2026-11-13
Kind: process
Level: I1
---

# Issues

## Agent Index

- **Kind:** process
- **Status:** active
- **Level:** I1
- **Last verified:** 2026-11-13
- **Read when:** filing a bug / defect / investigation report, or looking up an
  open issue's status, evidence, or resolution.
- **Search terms:** issues folder, bug report, defect report, issue template,
  issue lifecycle, kind issue, pipeline completion.

## Purpose

`docs/issues/` holds **governed, evidence-bearing issue reports** — bugs, silent
failures, regressions, and investigations that need a durable, citable record.
Each report is a docgraph node so it is retrievable and linkable from plans and
context docs.

Pipeline completion work items decomposed from the
[July pipeline review](../plans/2026-07-21-pipeline-completion-review.md)
live here as one file each (Wave 0–3). The forward queue is the
[roadmap](../plans/roadmap.md). File an issue when a parked item becomes an
evidence-bearing defect.

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

- [OCR-folio page-order detection (W3.9)](2026-07-21-w39-page-order-ocr-folios.md)
- [SSE streams cannot authenticate in JWT mode (former GH #135)](2026-11-09-jwt-sse-auth.md)
- [Automated dependency audit gate (former GH #146)](2026-11-09-dependency-audit-gate.md)

Wave 0, Wave 1, Wave 2, and the completed Wave 3 reports have retired after promotion.
The [2026-11-13 retirement receipt](../decisions/2026-11-13-landed-work-retirement.md) records the latest
fifteen outcomes and their architecture replacements. Three compact tombstones preserve historical citations;
other resolved reports remain in git history. The [roadmap](../plans/roadmap.md) holds all open and parked work.
