---
Kind: decision
Status: active
Owner: CT
Created: 2026-11-13
Last verified: 2026-11-13
---

# Retire landed Wave 2 and Wave 3 issue reports

## Context

Fifteen issue reports still described shipped fixes as open work. Fresh read-only analyzers checked each
against code, tests, and implementation commits at base `38e7209`. Their durable contracts now live in architecture.

## Decision

Retire the reports listed below using the direct `doc-retirer` procedure. No optional planner/apply engine
was invoked. No spec or fully implemented plan is being retired, so no missing spec review was waived.
The July review, roadmap, Compute backlog, research, and historical decisions remain intact.

## Consequences

The open issue index now contains folio detection, JWT stream authentication, and automated dependency auditing.
Lasso, reading-order drag, apply-to-all, zone charts, detector split suggestions, and project import remain
parked. Cancellation remains cooperative; schema migration and hosted deployment remain separate work.
Three compact tombstones preserve immutable cutover links and source/test citations. Other resolved reports
are deleted; their original bytes remain in `38e7209`. Removal commit: the commit containing this receipt.

## Supersedes / Superseded-by

This receipt supersedes the open-defect descriptions in the reports below, not any owner policy or dated finding.
The roadmap remains the only forward queue under the [queue decision](2026-11-12-roadmap-is-the-queue.md).

## Retirement records

### 2026-07-21-w21-isr-real-thumbs

- Old path: `docs/issues/2026-07-21-w21-isr-real-thumbs.md`
- Outcome: implemented, then retired on 2026-11-13.
- Superseded by: [current contract](../architecture/09-image-prep-settings.md).
- Evidence: 820e055 implements real ISR stage images; merged in 06d9a5c. Follow-up b2e78d1 fixes browser-observed
  behavior and stage completion refresh.
- Rationale kept: current contract and this receipt; original report in `38e7209`.
- Remaining work: limits and deferred work stay in architecture and the roadmap.

### 2026-07-21-w22-schema-backend-alignment

- Old path: `docs/issues/2026-07-21-w22-schema-backend-alignment.md`
- Outcome: implemented, then retired on 2026-11-13.
- Superseded by: [current contract](../architecture/09-image-prep-settings.md).
- Evidence: 2045373 implements backend-aligned controls and rerun settings; 36fd0fc follows up on review; both are
  integrated through 06d9a5c.
- Rationale kept: current contract and this receipt; original report in `38e7209`.
- Remaining work: limits and deferred work stay in architecture and the roadmap.

### 2026-07-21-w23-canvas-map-real-data

- Old path: `docs/issues/2026-07-21-w23-canvas-map-real-data.md`
- Outcome: implemented, then retired on 2026-11-13.
- Superseded by: [current contract](../architecture/09-image-prep-settings.md).
- Evidence: 5f451b3 implements measured canvas-map page sizes, integrated through 06d9a5c; 36fd0fc includes subsequent
  canvas-map correction.
- Rationale kept: current contract and this receipt; original report in `38e7209`.
- Remaining work: limits and deferred work stay in architecture and the roadmap.

### 2026-07-21-w24-text-zones-konva

- Old path: `docs/issues/2026-07-21-w24-text-zones-konva.md`
- Outcome: implemented, then retired on 2026-11-13.
- Superseded by: [current contract](../architecture/09-image-prep-settings.md).
- Evidence: e621329 implements real-image Konva zone/split editors and is integrated in 06d9a5c; issue resolution and
  roadmap both identify that merge.
- Rationale kept: current contract and this receipt; original report in `38e7209`.
- Remaining work: limits and deferred work stay in architecture and the roadmap.

### 2026-07-21-w25-settings-tiers-generalize

- Old path: `docs/issues/2026-07-21-w25-settings-tiers-generalize.md`
- Outcome: implemented, then retired on 2026-11-13.
- Superseded by: [current contract](../architecture/09-image-prep-settings.md).
- Evidence: 096a6a8 adds shared stage review settings tiers, integrated in 06d9a5c; 36fd0fc addresses review and
  stale-save behavior.
- Rationale kept: current contract and this receipt; original report in `38e7209`.
- Remaining work: limits and deferred work stay in architecture and the roadmap.

### 2026-07-21-w310-save-copy-archive

- Old path: `docs/issues/2026-07-21-w310-save-copy-archive.md`
- Outcome: implemented, then retired on 2026-11-13.
- Superseded by: [current contract](../architecture/09-image-prep-settings.md).
- Evidence: 9d1e2a4 implements downloadable project copy, integrated in 06d9a5c; 36fd0fc follows up on SQLite export
  correctness. 2bc67c8 implements the real stage-file archive inventory and keep toggles.
- Rationale kept: current contract and this receipt; original report in `38e7209`.
- Remaining work: limits and deferred work stay in architecture and the roadmap.

### 2026-07-21-w32-playwright-smoke-ci

- Old path: `docs/issues/2026-07-21-w32-playwright-smoke-ci.md`
- Outcome: implemented, then retired on 2026-11-13.
- Superseded by: [current contract](../architecture/07-testing.md).
- Evidence: 59470c4 adds smoke CI gate; 1347ba1 and ff780df preserve it in justfile and remove Make.
- Rationale kept: current contract and this receipt; original report in `38e7209`.
- Remaining work: limits and deferred work stay in architecture and the roadmap.

### 2026-07-21-w33-seeded-ocr-browser-fixtures

- Old path: `docs/issues/2026-07-21-w33-seeded-ocr-browser-fixtures.md`
- Outcome: implemented, then retired on 2026-11-13.
- Superseded by: [current contract](../architecture/07-testing.md).
- Evidence: 532777a replaces documentation approval stub with tests/e2e/test_seeded_text_chain_browser.py and
  tests/fixtures/seed_stages.py.
- Rationale kept: current contract and this receipt; original report in `38e7209`.
- Remaining work: limits and deferred work stay in architecture and the roadmap.

### 2026-07-21-w34-reclaim-stuck-running

- Old path: `docs/issues/2026-07-21-w34-reclaim-stuck-running.md`
- Outcome: implemented, then retired on 2026-11-13.
- Superseded by: [current contract](../architecture/05-events-and-jobs.md).
- Evidence: 66c5ed2 implements bootstrap startup reclamation in src/pdomain_prep_for_pgdp/bootstrap.py:286 and
  core/job_runner.py:316; database/base.py,sqlite.py,postgres.py add fail_running_jobs.
- Rationale kept: current contract and this receipt; original report in `38e7209`.
- Remaining work: limits and deferred work stay in architecture and the roadmap.

### 2026-07-21-w35-reindex-heal

- Old path: `docs/issues/2026-07-21-w35-reindex-heal.md`
- Outcome: implemented, then retired on 2026-11-13.
- Superseded by: [current contract](../runbooks/reindex-heal.md).
- Evidence: 1c9393b76bdeaa22eadc98a0299723a06abe06e7 adds docs/runbooks/reindex-heal.md and fixes retained-file orphan
  drift in cli/reindex.py and core/pipeline/page_stage_writer.py.
- Rationale kept: current contract and this receipt; original report in `38e7209`.
- Remaining work: limits and deferred work stay in architecture and the roadmap.

### 2026-07-21-w36-job-stage-cancel

- Old path: `docs/issues/2026-07-21-w36-job-stage-cancel.md`
- Outcome: implemented, then retired on 2026-11-13.
- Superseded by: [current contract](../architecture/05-events-and-jobs.md).
- Evidence: 6b8afe5 adds stage-scoped POST route in src/pdomain_prep_for_pgdp/api/data/project_stages.py and scoped
  database cancellation in adapters/database/{base,sqlite,postgres}.py.
- Rationale kept: current contract and this receipt; original report in `38e7209`.
- Remaining work: limits and deferred work stay in architecture and the roadmap.

### 2026-07-21-w37-cookie-cors-hardening

- Old path: `docs/issues/2026-07-21-w37-cookie-cors-hardening.md`
- Outcome: implemented, then retired on 2026-11-13.
- Superseded by: [current contract](../architecture/06-deployment.md).
- Evidence: 7a96382 wires settings.effective_session_cookie_secure into api/auth/session.py and
  effective_cors_allow_origins into bootstrap.py.
- Rationale kept: current contract and this receipt; original report in `38e7209`.
- Remaining work: limits and deferred work stay in architecture and the roadmap.

### 2026-11-09-postgres-adapter-incomplete

- Old path: `docs/issues/2026-11-09-postgres-adapter-incomplete.md`
- Outcome: implemented, then retired on 2026-11-13.
- Superseded by: [current contract](../architecture/02-backend.md).
- Evidence: 3e2ecd4450d370258e879d85aac33ead865853ac completes PostgresDatabase; merged by the documented master
  checkpoint 06d9a5c9b0a07f6cf4a1119d908d82867d38df2f.
- Rationale kept: current contract and this receipt; original report in `38e7209`.
- Remaining work: limits and deferred work stay in architecture and the roadmap.

### 2026-11-09-progress-overwrites-cancel

- Old path: `docs/issues/2026-11-09-progress-overwrites-cancel.md`
- Outcome: implemented, then retired on 2026-11-13.
- Superseded by: [current contract](../architecture/05-events-and-jobs.md).
- Evidence: c85a1282b3dcd0ecf6f06cbbda1f7b448a3f10c9 implements cancellation-preserving writes.
- Rationale kept: current contract and this receipt; original report in `38e7209`.
- Remaining work: limits and deferred work stay in architecture and the roadmap.

### 2026-11-11-submission-zip-entry-timestamps

- Old path: `docs/issues/2026-11-11-submission-zip-entry-timestamps.md`
- Outcome: implemented, then retired on 2026-11-13.
- Superseded by: [current contract](../architecture/03-pipeline.md).
- Evidence: ce1f5577abc3a44883d48b36539789fca661e145 fixes archive timestamps; merge checkpoint
  06d9a5c9b0a07f6cf4a1119d908d82867d38df2f is recorded in the issue.
- Rationale kept: current contract and this receipt; original report in `38e7209`.
- Remaining work: limits and deferred work stay in architecture and the roadmap.
