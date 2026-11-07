---
Kind: architecture
Status: built
Owner: CT
Created: 2026-11-07
Last verified: 2026-11-07
---

# Source images, grayscale, and stage settings

## Agent Index

- **Kind:** architecture
- **Status:** built
- **Last verified:** 2026-11-07
- **Read when:** changing Source persistence, grayscale previews, device dispatch, or stage settings tiers.
- **Search terms:** grayscale, GPU, CUDA, settings tiers, Source, thumbnails, page_role.

Source edits and grayscale settings use persisted backend state. Grayscale has real image previews and page,
project, and app-wide settings controls. Other image-prep tools still have open integration work.

## Source persistence and previews

Source thumbnails come from the ingest thumbnail blob through `GET /api/data/projects/{id}/pages/{idx0}/thumbnail`.
They are available before grayscale runs. Source role changes, reversible ignore, and insertion persist through
the page service and record workflow events. Removing a page through Source is a reversible ignore operation.

`back` and `duplicate` retain distinct `page_role` values while both use `page_type=skip` for packaging.
Cover and blank remain distinct page types. Page actions use the page's actual `idx0`, not a filtered list position.

The grayscale workbench displays real color input. Its page grid uses a grayscale stage thumbnail when available
and falls back to the ingest thumbnail. These fixes do not establish real thumbnails in the shared image-stage
review tool; that remains [W2.1](../issues/2026-07-21-w21-isr-real-thumbs.md).

One project-channel Server-Sent Events (SSE) bridge refreshes tool state and artifact cache keys as stages finish.
See [events and jobs](05-events-and-jobs.md) for event ownership.

## Shared settings resolution

Stage settings resolve field by field in this order: page override, project default, app-wide default, registry
default. Sparse overrides let fields inherit independently. The runner applies the resulting stage settings
to its resolved execution config before dispatch; this is separate from the general config-layer resolver.

Page settings use SQLite tier `page:{page_id}`; project defaults use tier `default`.
App-wide defaults use `pdomain-ops` `LocalFilePrefs` under `stage_settings.<stage_id>`.
An old `stage_settings_all.json` file is a read fallback when the preference key is absent.
App-wide preferences do not have a project event log. The earlier proposal to event-log every tier did not ship literally.

Grayscale normalizes legacy flat settings at each tier before merging them.
Its current nested configuration covers flattening, converter/channel choice, color2gray, CLAHE, and output range.
The older mode/gamma proposal is historical, not the current settings schema.

Grayscale shows resolved-source badges and supports page saves, project defaults, and an app Settings editor.
Generalizing that UI to threshold, deskew, and denoise remains
[W2.5](../issues/2026-07-21-w25-settings-tiers-generalize.md).

## CPU and GPU execution

The registry includes GPU implementations for grayscale, threshold, deskew, dewarp, post-transform crop,
canvas map, and denoise. Dispatch normalizes CUDA requests to the registry's GPU implementation key.
Grayscale calls the book-tools composable pipeline with GPU use enabled on that path.
Optional GPU dependencies remain guarded; CPU execution remains available.

Each job enqueue resolves the device from the app preference, then the suite preference, then automatic detection.
Changing a device preference affects the next enqueue without restarting the process.
This backend behavior does not provide a visible Compute panel or authorize startup warmup.
That work remains in the [Compute panel backlog](../plans/2026-06-08-compute-settings-panel-backlog.md).

## Remaining product work

Archived-project Save a copy still reports a coming-soon action rather than downloading an export.
[W3.10](../issues/2026-07-21-w310-save-copy-archive.md) tracks real export and archive inventory.
The active [completion plan](../plans/2026-07-21-pipeline-completion-review.md) owns the remaining image-prep queue.

## Evidence

- Code: `api/data/pages.py`, `core/device_resolution.py`, `core/pipeline/stage_settings.py`,
  and `core/pipeline/stage_registry.py` under `src/pdomain_prep_for_pgdp/`.
- Frontend: `frontend/src/services/tools/sourceTool.ts`, `frontend/src/machines/lib/pageToolSseBridge.ts`,
  and `frontend/src/pages/pipeline/tools/grayscale/`.
- Tests: `tests/test_3tier_stage_settings.py`, `tests/test_grayscale_3tier_resolution.py`,
  `tests/test_stage_dispatch_device_key.py`, `tests/test_grayscale_stage_params.py`,
  `frontend/src/pages/pipeline/tools/SourceTool.test.tsx`, and
  `frontend/src/pages/pipeline/tools/grayscale/GrayscaleTiers.test.tsx`.
- History: `0c12b37`, `a2e09d8`, `bbe6e66`, `9df1101`, `825f287`, `244cbc0`, and `7894d32`.
- Verified: 2026-11-07 by source and test inspection. No fresh live GPU or representative-book benchmark was run.
