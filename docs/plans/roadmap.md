---
Kind: plan
Status: active
Owner: CT
Created: 2026-05-07
Last verified: 2026-11-12
---

# Roadmap

## Agent Index

- **Kind:** plan
- **Status:** active
- **Last verified:** 2026-11-12
- **Read when:** selecting the next product or engineering task for this app.
- **Search terms:** roadmap, open work, wave 2, wave 3, deferred work, separate repository.

This is the only forward queue. Shipped behavior lives in [architecture](../architecture/01-overview.md).

The [July 2026 pipeline review](2026-07-21-pipeline-completion-review.md) is the record that created Waves 0–3. Waves 0 and 1 shipped. Wave 2 and the finished Wave 3 rows are on `master` in `c16c5e1` and `06d9a5c`. W3.10's save-a-copy download is in that set. Its keep list is the project's stage files. Their contracts are in [Book path contracts](../architecture/03-pipeline.md#book-path-contracts) and [image-prep settings](../architecture/09-image-prep-settings.md).

[Repository boundary](../architecture/10-repository-boundary.md) says whether a feature should live in this app or in another repository.

Local-first work comes first. That choice is [AD-4](../decisions/architecture-decisions.md).

## Now

Open rows are first. Landed rows are already on `master`.

### Open

| ID | Issue | Why it is still open |
| --- | --- | --- |
| W3.9 | [OCR folio page order](../issues/2026-07-21-w39-page-order-ocr-folios.md) | Reconcile-on-load is on `master` in `06d9a5c` (`88d4e14`). Page order still cannot take folios from a detector. `pdomain-book-tools` 0.28.0 has none. No branch holds the detector. |
| — | [SSE streams cannot authenticate in JWT mode](../issues/2026-11-09-jwt-sse-auth.md) | No branch holds this. |
| — | [CI does not audit dependencies](../issues/2026-11-09-dependency-audit-gate.md) | The recipe was added as `make audit` on `master` in `06d9a5c` (`a45325c`). Run it now with `just audit`; it is not part of `just ci`. The lockfile has known advisories. No branch holds the gate. |

### Landed on master

| ID | Issue | On master |
| --- | --- | --- |
| W2.1 | [Real before/after thumbs](../issues/2026-07-21-w21-isr-real-thumbs.md) | `06d9a5c` (`820e055`) |
| W2.2 | [stageSchemas match backend knobs](../issues/2026-07-21-w22-schema-backend-alignment.md) | `06d9a5c` (`2045373`) |
| W2.3 | [canvas map uses real data](../issues/2026-07-21-w23-canvas-map-real-data.md) | `06d9a5c` (`5f451b3`) |
| W2.4 | [text zone Konva UI](../issues/2026-07-21-w24-text-zones-konva.md) | `06d9a5c` (`e621329`). A split works on a real page. Lasso, reading-order drag, and apply-to-all were not part of this row. |
| W2.5 | [settings tiers beyond grayscale](../issues/2026-07-21-w25-settings-tiers-generalize.md) | `06d9a5c` (`096a6a8`) |
| W3.2 | [Playwright smoke in CI](../issues/2026-07-21-w32-playwright-smoke-ci.md) | `06d9a5c` (`59470c4`) |
| W3.3 | [Seeded OCR browser fixtures](../issues/2026-07-21-w33-seeded-ocr-browser-fixtures.md) | `06d9a5c` (`532777a`) |
| W3.4 | [Reclaim stuck running jobs](../issues/2026-07-21-w34-reclaim-stuck-running.md) | `c16c5e1` (`66c5ed2`) |
| W3.5 | [reindex --heal](../issues/2026-07-21-w35-reindex-heal.md) | `06d9a5c` (`1c9393b`), with the [heal runbook](../runbooks/reindex-heal.md) |
| W3.6 | [Job and stage cancel](../issues/2026-07-21-w36-job-stage-cancel.md) | `c16c5e1` (`6b8afe5`) |
| W3.7 | [Cookie secure and CORS allowlist](../issues/2026-07-21-w37-cookie-cors-hardening.md) | `c16c5e1` (`7a96382`) |
| W3.10 | [Save a copy and archive inventory](../issues/2026-07-21-w310-save-copy-archive.md) | Save a copy is `06d9a5c` (`9d1e2a4`). The keep list is the project's stage files. |
| — | [Progress updates overwrite a cancelled job](../issues/2026-11-09-progress-overwrites-cancel.md) | `c16c5e1` (`c85a128`) |
| — | [Postgres adapter](../issues/2026-11-09-postgres-adapter-incomplete.md) | `06d9a5c` (`3e2ecd4`). The hosted database product stays a [separate repository](../architecture/10-repository-boundary.md#hosted-prep-service). |
| — | Submission zip entry times | `06d9a5c` (`ce1f557`). Every entry takes its time from `built_at`. |

## Parked in this app

These stay in this repository. None of them jump ahead of the open rows under Now.

- Visible Compute panel before device warmup. The factory, device-state display, and tests are in the [Compute panel backlog](2026-06-08-compute-settings-panel-backlog.md).
- Upper-case Roman and alphabetic numbering controls. Current limits are in [page numbering](../architecture/08-page-numbering.md#limits-and-remaining-work).
- A first-class Source model for back, duplicate, and inserted pages, beyond the role labels that already exist. Folio detection itself is [W3.9](../issues/2026-07-21-w39-page-order-ocr-folios.md).
- Search ranking, normalization, and an optional cross-project scope. Project-scoped search already ships.
- Source-quality scoring, richer metadata, project comments, structured settings import and export, and deeper illustration format controls.
- Further flip operations, bulk crop re-run, and a global hyphen or scanno library UI in this app. If other tools need the shared detector, that is a library change. See [repository boundary](../architecture/10-repository-boundary.md#scanno-detector-shared-with-other-tools).
- Crop overview and deeper crop settings (former GH #166). [W2.2](../issues/2026-07-21-w22-schema-backend-alignment.md) and [W2.5](../issues/2026-07-21-w25-settings-tiers-generalize.md) do not cover that screen.
- Hyphen-join settings tab (former GH #177). W2.5 is the image-prep tier pattern, not this tab.
- `PUT /cdn/{key}` does not check project ownership. `GET /cdn/{key}` does for `projects/` keys. See [repository boundary](../architecture/10-repository-boundary.md#hosted-prep-service).
- Stronger API-key session CSRF, expiry, revocation, and failed-login visibility, beyond [W3.7](../issues/2026-07-21-w37-cookie-cors-hardening.md).
- An end-to-end install of this wheel from a release asset. [AD-10](../decisions/architecture-decisions.md) records the installer. The 2026-11-07 source audit did not run a clean-machine install.
- English-only UI strings. An i18n (internationalization) layer is this frontend's work if it is ever chosen. The OCR pipeline already takes its language from DocTR.

## Former pd-ui design handoff (GH #152, #156–#198)

GitHub spec issue #152 tracked feature issues #156–#198. The handoff assumed per-stage routes. Statechart convergence built the same capabilities as pipeline tools. The plan was retired in `fdd88cd`.

A 2026-11-09 audit against `14f0ba8` found 18 shipped, 9 partly shipped, 10 superseded, and 6 not built. The per-issue ledger is in the [cutover decision](../decisions/2026-11-09-github-issues-cutover.md).

Recover the original plan and spec with:

```bash
git show fdd88cd^:docs/plans/pd-ui-design-handoff-implementation.md
git show fdd88cd^:docs/specs/2026-05-24-pd-ui-design-handoff-implementation.md
```

The JSX prototype remains at `docs/plans/design_handoff_pgdp_app/`. It is a design reference, not current architecture.

### H1. Not built and not tracked elsewhere

- **Validation auto-fix (former GH #180).** Add `POST /api/projects/{id}/validate/{check}/fix` for a whitelisted fix such as a rename. Validation today has run, artifact, and waive routes.
- **Stage-jump popover (former GH #183).** A searchable stage list on a shortcut. StageStrip dots are the stage navigation. Mod+k opens search.
- **Mobile upload fallback below 768px (former GH #195).** The create-project dialog has no narrow layout. Low priority while the app is a desktop tool.
- **N-gram evidence for hyphen decisions (part of former GH #174 and #177).** No n-gram cache exists in this repo. Build the store in `pdomain-book-tools` or a data package. See [repository boundary](../architecture/10-repository-boundary.md#hyphen-n-gram-store).

### H2. Remaining gaps already tracked elsewhere

| Former GH | Gap | Tracked in |
| --- | --- | --- |
| #164 | Select flagged crops and re-run them in bulk | [Parked in this app](#parked-in-this-app) |
| #166 | Crop overview and deeper crop settings | [Parked in this app](#parked-in-this-app) |
| #168 | Page-order detection from OCR folios | [W3.9](../issues/2026-07-21-w39-page-order-ocr-folios.md) |
| #172 | Global rule library across books | [Parked in this app](#parked-in-this-app), or a shared library if other tools consume it |
| #177 | Hyphen-join settings tab | [Parked in this app](#parked-in-this-app). The n-gram store is a [separate repository](../architecture/10-repository-boundary.md#hyphen-n-gram-store). |
| #185, #189 | Split overlay and text-zone canvas | On master in `06d9a5c`. [W2.4](../issues/2026-07-21-w24-text-zones-konva.md) records the extras that were not in that row. |
| #193 | Save a copy from the Manage tab | The download is on master in `06d9a5c`. The archive keep list is the project's stage files. See [W3.10](../issues/2026-07-21-w310-save-copy-archive.md). |

## Separate repositories

Consider these as their own repositories. Rationale, sibling owners, and evidence are in [Repository boundary](../architecture/10-repository-boundary.md).

| Candidate | Home | Why it is separate |
| --- | --- | --- |
| Hosted prep service | New repository that depends on this package | Postgres, S3 stage writes, container publish, and multi-user sharing are a different product from the local wheel. |
| GPU worker image | A small image repo, or `pdomain-ops` if the suite owner wants one home | This app can select `SharedContainerStageDispatcher`. Its three calls raise `NotImplementedError`. The HTTP service is the other repository. |
| nvjpeg / DALI thumbnails | `pdomain-book-tools` | [AD-9](../decisions/architecture-decisions.md) keeps the CPU pool. Revisit only after a 500-page GPU profile. |
| Hyphen n-gram store | `pdomain-book-tools` or a data package it reads | This app has a regex hyphen step, not a corpus. |
| Shared scanno detector | `pdomain-book-tools` | `wordcheck` stays here. A detector for several tools is a library. |
| PDF preview | A new small exporter | The submission artifact is a zip. `pdomain-pgdp-measure` measures scans and does not write PDFs. |

## Deferred — remote / cloud mode

This heading is the old parking place for remote work. Some rows stay in this repo. The rest are [Separate repositories](#separate-repositories). Detail is in [Repository boundary](../architecture/10-repository-boundary.md).

- **Remote GPU transport.** This app selects `GPUBackend` from `pdomain_ops.gpu`. A replacement for the local store on a remote worker belongs with the worker image.
- **Postgres live tests.** The adapter contract test is on master in `06d9a5c`. It runs when `PGDP_TEST_POSTGRES_URL` is set. `just ci` does not start Postgres. The hosted product around that adapter is a separate repository.
- **install.sh on a clean machine.** Stays in this repo. Listed under [Parked in this app](#parked-in-this-app).
- **Managed container publication.** No GitHub workflow in this checkout publishes an image. That publication belongs to the hosted service.
- **CUDA stage entries.** GPU registry implementations already ship. See [CPU and GPU execution](../architecture/09-image-prep-settings.md#cpu-and-gpu-execution). A representative-book measurement waits on the worker image.
- **Shared GPU container.** `shared_container` builds `SharedContainerStageDispatcher`. Its `process_page`, `run_ocr`, and `run_batch` raise `NotImplementedError`. The service behind the URL is the worker image, not a class in this repo.
- **Thumbnail nvjpeg / DALI.** Deferred by [AD-9](../decisions/architecture-decisions.md). Home is `pdomain-book-tools`.

## How to pick up

1. Read [the overview](../architecture/01-overview.md) and [the repository boundary](../architecture/10-repository-boundary.md).
2. Take the first open row under [Now](#now).
3. Leave [Parked in this app](#parked-in-this-app) and [Separate repositories](#separate-repositories) alone unless the owner asks for that item.
4. Follow [testing](../architecture/07-testing.md). Run `AI=1 just ci` before a commit.
5. When an item ships, move the durable behavior into an architecture doc and delete or retire the issue. Record the tombstone in [decisions](../context/decisions.md).

## Goal

Keep one ordered list of open work for this app. Name work that should be a different repository.

## Architecture

Items on this list extend the local-first app in `docs/architecture/`. The July review does not define new work. Retired specs do not either.

## Tech Stack

The stack is FastAPI, Python 3.13, React 19, XState v5, SQLite, and the filesystem. Optional adapters stay as seams until a hosted repository takes them.

## Global Constraints

Local book completion stays ahead of remote deployment. Generated OpenAPI remains the contract. The removed backend `project_run_dirty` fan-out and the phantom `scannocheck` stage stay removed.
