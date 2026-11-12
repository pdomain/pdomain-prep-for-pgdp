---
Kind: architecture
Status: built
Owner: CT
Created: 2026-11-12
Last verified: 2026-11-12
---

# Repository boundary

## Agent Index

- **Kind:** architecture
- **Status:** built
- **Last verified:** 2026-11-12
- **Read when:** deciding whether a feature belongs in this app, in a sibling library, or in a new repository.
- **Search terms:** repository boundary, sibling repos, hosted prep, GPU worker, separate repository.

This repository is the local app that turns a folder of scanned pages into a PGDP submission package. Shared libraries
already live in sibling repositories. Hosted multi-user execution, a GPU worker image, and shared language data should
be built elsewhere when that work starts.

The forward queue for this app is the [roadmap](../plans/roadmap.md).

## What this repository owns

One operator runs one local process. The app is a FastAPI server, a React pipeline UI, a 24-stage registry, SQLite, and
files on disk. It owns stage tools, jobs, page workflow, and the zip a PGDP project expects.

Page lifecycle and in-process GPU dispatch come from `pdomain-ops`. Image and OCR primitives come from
`pdomain-book-tools`. This app wires those libraries into a book workflow. It does not reimplement them.

## Sibling repositories already in use

These directories sit next to this repo under `/mnt/work/projects/pdomain/`. Versions below are the minimums this app
declares.

| Repository | What it owns | How this app uses it |
| --- | --- | --- |
| `pdomain-book-tools` | OCR, geometry, and image primitives | `pdomain-book-tools>=0.28.0`. Grayscale calls its composable pipeline. |
| `pdomain-ops` | Suite registry, shared preferences, page store, GPU backend protocol | `pdomain-ops>=0.11.2`. This app uses `PagesApplication` and `LocalPageStore`, `GPUBackend` (`ModalStageDispatcher`, `SharedContainerStageDispatcher`), suite prefs, and `mount_routes`. Pack-stage comments mention `LongJobRunner`. The app does not call it. |
| `pdomain-book-contracts` | Shared contracts | `pdomain-book-contracts>=0.2.0`. |
| `pdomain-ui` | Shared React UI | `@pdomain/pdomain-ui` `^0.12.1` in `frontend/package.json`. |
| `pdomain-ocr-cli` | OCR command line and the install pattern this repo mirrors | The OCR stage follows it. |
| `pdomain-ocr-labeler-spa`, `pdomain-ocr-trainer-spa`, `pdomain-ocr-training`, `pdomain-ocr-synth` | Labeling, training, and synthetic pages | Out of this app. |
| `pdomain-pgdp-measure` | Font-free measurement of scans | A measurement library. It is not a prep stage and it does not export PDFs. |
| `pdomain-index-pip`, `pdomain-index-npm` | Package indexes | Where published wheels and npm packages go. |
| `pdomain-fonts` | Fonts | Not a pipeline stage. |

`/mnt/work/projects/pdomain/pdomain-source-data` is present. This review found no README there, so no new work is
assigned to it.

## Work to build in another repository

Build these when someone chooses that product. Until then they stay parked on the roadmap. Do not grow them inside the
local book path.

### Hosted prep service

A hosted service needs a live Postgres contract, an S3 stage writer, container publication, multi-user sharing, and
Fargate or Modal coordination. [Deployment](06-deployment.md) records the local wheel, the incomplete Postgres builder,
and the absence of a release workflow in this checkout.

The missing `IDatabase` methods are an open defect in this repo: [Postgres
adapter](../issues/2026-11-09-postgres-adapter-incomplete.md). That issue should end with the adapter either completed
behind a real database test or no longer selectable.

The hosted product around it is a new repository that depends on this package. Multi-user sharing belongs there too.

Project data routes compare `project.owner_id` with `user.user_id`. `GET /cdn/{key}` does that for keys under
`projects/`. `PUT /cdn/{key}` authenticates. It does not run that ownership check. Closing that gap stays in this repo.

`/healthz`, `/env.js`, and `/api/server-info` are unauthenticated.

### GPU worker image

This app calls `GPUBackend` and `pdomain_ops.gpu.doctr_batch.run_doctr_batch`.

When `gpu_backend=shared_container`, bootstrap in `bootstrap.py` builds `SharedContainerStageDispatcher` from
`pdomain-ops`. That class stores a base URL and an API key. `process_page`, `run_ocr`, and `run_batch` raise
`NotImplementedError`. `tests/test_managed_backends.py` shows those raises.

The HTTP service that would answer those calls is a separate image. Put that entrypoint in a small worker repository.
Put it in `pdomain-ops` instead if the suite owner wants one library to ship it. This app should keep selecting the
backend.

A book-scale GPU memory and throughput check belongs with that worker. It is not a UI feature.

### GPU thumbnail decode

[AD-9](../decisions/architecture-decisions.md) keeps thumbnail generation on a CPU process pool. An nvjpeg or DALI path
is an image-library change. The home is `pdomain-book-tools`. Make that change only after a profile of a book of at
least 500 pages on a GPU host. The profile must show the CPU pool dominating Step 2 after storage I/O.

### Hyphen n-gram store

Hyphen detection in this app is the regex in the hyphen-join step. The pd-ui handoff expected an n-gram SQLite store
from `pdomain-book-tools`. No such store exists here.

A corpus and lookup belong in `pdomain-book-tools` or in a data package that library reads. This app's hyphen stage
would call that lookup.

### Scanno detector shared with other tools

`wordcheck` stays the scanno stage in this app. [Scanno research](../research/findings-scannos.md) can improve its
flagging.

A detector used by labeling, training, or measurement as well as by this app belongs in `pdomain-book-tools`. This app
should not gain a second scanno stage.

### PDF preview

A PGDP submission is a zip. A PDF sanity check is a separate exporter. It is closer to post-processing than to a
pipeline stage.

`pdomain-pgdp-measure` measures scans. It is the wrong home for PDF output. Add a PDF tool only as its own small
repository if a user asks for one.

## What stays here

Wave 2 and Wave 3 of the book UI stay in this repo. So do these:

- job cancel and crash recovery
- reindex repair
- cookie and CORS hardening
- Playwright smoke in CI
- the dependency audit
- JWT authentication for server-sent events
- the visible Compute panel
- numbering controls
- an end-to-end install of this wheel

The static JSX under `docs/plans/design_handoff_pgdp_app/` is the pd-ui design prototype. The shipped UI is the pipeline
shell and `TOOL_REGISTRY`. The prototype remains a design reference for screens that are not built. It is not a product
and it is not architecture.

## Evidence

- Code and packaging: `pyproject.toml`, `frontend/package.json`,
  [deployment](06-deployment.md), [overview](01-overview.md).
- Sibling charters read 2026-11-12. The `pdomain-ops` README records in-process GPU
  dispatch, and cloud is deferred. The `pdomain-pgdp-measure` README records
  measurement, not export.
- Decisions: [AD-9](../decisions/architecture-decisions.md) for thumbnails.
  [AD-4](../decisions/architecture-decisions.md) for local-first priority.
- Open seam: [Postgres adapter issue](../issues/2026-11-09-postgres-adapter-incomplete.md).
- Queue: [roadmap](../plans/roadmap.md).
