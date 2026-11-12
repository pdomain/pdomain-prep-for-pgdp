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

The [July 2026 pipeline review](2026-07-21-pipeline-completion-review.md) is the record that created Waves 0–3. Waves 0 and 1 shipped. Their contracts are in [Book path contracts](../architecture/03-pipeline.md#book-path-contracts).

[Repository boundary](../architecture/10-repository-boundary.md) says whether a feature should live in this app or in another repository.

Local-first work comes first. That choice is [AD-4](../decisions/architecture-decisions.md).

## Now

Start at Wave 2. Each row is an open issue with evidence.

### Wave 2 — image-prep honesty

| ID | Issue | Done when |
| --- | --- | --- |
| W2.1 | [Real before/after thumbs](../issues/2026-07-21-w21-isr-real-thumbs.md) | Threshold through dewarp show real page thumbs. |
| W2.2 | [stageSchemas match backend knobs](../issues/2026-07-21-w22-schema-backend-alignment.md) | A threshold change changes the output. |
| W2.3 | [canvas map uses real data](../issues/2026-07-21-w23-canvas-map-real-data.md) | Scatter and spreads are not mock points. |
| W2.4 | [text zone Konva UI](../issues/2026-07-21-w24-text-zones-konva.md) | A split works on a real page. |
| W2.5 | [settings tiers beyond grayscale](../issues/2026-07-21-w25-settings-tiers-generalize.md) | Threshold, deskew, and denoise have the same tier controls grayscale has. |

### Wave 3 — quality and operations

| ID | Issue | Done when |
| --- | --- | --- |
| W3.2 | [Playwright smoke in CI](../issues/2026-07-21-w32-playwright-smoke-ci.md) | A smoke subset runs in the default gate. |
| W3.3 | [Seeded OCR browser fixtures](../issues/2026-07-21-w33-seeded-ocr-browser-fixtures.md) | Text-review approval has a fixture-backed browser test. |
| W3.4 | [Reclaim stuck running jobs](../issues/2026-07-21-w34-reclaim-stuck-running.md) | Startup reclaims jobs left `running` after a crash. |
| W3.5 | [reindex --heal](../issues/2026-07-21-w35-reindex-heal.md) | The heal path has an operator-facing surface. |
| W3.6 | [Job and stage cancel](../issues/2026-07-21-w36-job-stage-cancel.md) | Cancel stops the stage, including its data route. |
| W3.7 | [Cookie secure and CORS allowlist](../issues/2026-07-21-w37-cookie-cors-hardening.md) | The session cookie and CORS origins follow the deployment. |
| W3.9 | [OCR folio page order](../issues/2026-07-21-w39-page-order-ocr-folios.md) | Page order can take folios from OCR. |
| W3.10 | [Save a copy and archive inventory](../issues/2026-07-21-w310-save-copy-archive.md) | Save a copy downloads an export. Archive inventory is real. |

### Migrated defects

These items were checked against the code on 2026-11-09. The ledger is the [cutover decision](../decisions/2026-11-09-github-issues-cutover.md).

- [Progress updates overwrite a cancelled job](../issues/2026-11-09-progress-overwrites-cancel.md).
- [SSE streams cannot authenticate in JWT mode](../issues/2026-11-09-jwt-sse-auth.md).
- [CI does not audit dependencies](../issues/2026-11-09-dependency-audit-gate.md).
- [Postgres adapter is selectable but incomplete](../issues/2026-11-09-postgres-adapter-incomplete.md). Close this in this repo. The hosted database product is a [separate repository](../architecture/10-repository-boundary.md#hosted-prep-service).

## Parked in this app

These stay in this repository. None of them jump ahead of Wave 2.

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
- Submission zip entries still take the clock time. `build_submission_zip` stores `built_at` in `pgdp.json` and writes the files with `writestr`, so two builds of the same book can differ. `fix/zip-entry-timestamps` (`ce1f557..b9a75a1`) stamps every entry from `built_at`.

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
| #185, #189 | Split overlay and text-zone canvas | [W2.4](../issues/2026-07-21-w24-text-zones-konva.md) |
| #193 | Save a copy from the Manage tab | [W3.10](../issues/2026-07-21-w310-save-copy-archive.md) |

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
- **Postgres live tests.** Stays in this repo: [Postgres adapter](../issues/2026-11-09-postgres-adapter-incomplete.md). The hosted product around that adapter is a separate repository.
- **install.sh on a clean machine.** Stays in this repo. Listed under [Parked in this app](#parked-in-this-app).
- **Managed container publication.** No GitHub workflow in this checkout publishes an image. That publication belongs to the hosted service.
- **CUDA stage entries.** GPU registry implementations already ship. See [CPU and GPU execution](../architecture/09-image-prep-settings.md#cpu-and-gpu-execution). A representative-book measurement waits on the worker image.
- **Shared GPU container.** `shared_container` builds `SharedContainerStageDispatcher`. Its `process_page`, `run_ocr`, and `run_batch` raise `NotImplementedError`. The service behind the URL is the worker image, not a class in this repo.
- **Thumbnail nvjpeg / DALI.** Deferred by [AD-9](../decisions/architecture-decisions.md). Home is `pdomain-book-tools`.

## How to pick up

1. Read [the overview](../architecture/01-overview.md) and [the repository boundary](../architecture/10-repository-boundary.md).
2. Take the first open row under [Now](#now).
3. Leave [Parked in this app](#parked-in-this-app) and [Separate repositories](#separate-repositories) alone unless the owner asks for that item.
4. Follow [testing](../architecture/07-testing.md). Run `make ci AI=1` before a commit.
5. When an item ships, move the durable behavior into an architecture doc and delete or retire the issue. Record the tombstone in [decisions](../context/decisions.md).

## Goal

Keep one ordered list of open work for this app. Name work that should be a different repository.

## Architecture

Items on this list extend the local-first app in `docs/architecture/`. The July review does not define new work. Retired specs do not either.

## Tech Stack

The stack is FastAPI, Python 3.13, React 19, XState v5, SQLite, and the filesystem. Optional adapters stay as seams until a hosted repository takes them.

## Global Constraints

Local book completion stays ahead of remote deployment. Generated OpenAPI remains the contract. The removed backend `project_run_dirty` fan-out and the phantom `scannocheck` stage stay removed.
