---
Kind: architecture
Status: built
Owner: CT
Created: 2026-11-07
Last verified: 2026-11-13
---

# Source images, grayscale, and stage settings

## Agent Index

- **Kind:** architecture
- **Status:** built
- **Last verified:** 2026-11-13
- **Read when:** changing Source persistence, grayscale previews, device dispatch, or stage settings tiers.
- **Search terms:** grayscale, GPU, CUDA, settings tiers, Source, thumbnails, page_role.

Source edits and grayscale settings use persisted backend state. Grayscale has real image previews and page,
project, and app-wide settings controls. Shared image review, canvas map, and text-zone editing also use real data.

## Source persistence and previews

Source thumbnails come from the ingest thumbnail blob through `GET /api/data/projects/{id}/pages/{idx0}/thumbnail`.
They are available before grayscale runs. Source role changes, reversible ignore, and insertion persist through
the page service and record workflow events. Removing a page through Source is a reversible ignore operation.

`back` and `duplicate` retain distinct `page_role` values while both use `page_type=skip` for packaging.
Cover and blank remain distinct page types. Page actions use the page's actual `idx0`, not a filtered list position.

The grayscale workbench displays real color input. Its page grid uses a grayscale stage thumbnail when available
and falls back to the ingest thumbnail. The shared image-stage review tool shows the stage output, or the parent
image while that stage has no output.

One project-channel Server-Sent Events (SSE) bridge refreshes tool state and artifact cache keys as stages finish.
See [events and jobs](05-events-and-jobs.md) for event ownership.

## Image review, canvas map, and text zones

Shared image review displays real grid thumbnails and separate parent/output images. Missing output remains
an explicit empty state; completion events and reruns refresh the images. There is no draggable comparison wipe.

Canvas map fetches measured image widths and heights from its aspect-points route. It distinguishes body pages
from outliers, derives the body-page median ratio, merges that ratio into project settings, and reruns pages.

Text zones render stored regions over real page images. Users can draw, edit, delete, and save zones, or adjust
a split gutter and axis before creating sibling crops. Split requests use normalized boxes and the existing
[sibling-page contract](03-pipeline.md#book-path-contracts). Lasso selection, reading-order drag, apply-to-all,
an Overview zone-type chart, and detector-supplied split suggestions remain unimplemented.

## Shared settings resolution

Stage settings resolve field by field in this order: page override, project default, app-wide default, registry
default. Sparse overrides let fields inherit independently. The runner applies the resulting stage settings
to its resolved execution config before dispatch; this is separate from the general config-layer resolver.

Page settings use SQLite tier `page:{page_id}`; project defaults use tier `default`.
App-wide defaults use `pdomain-ops` `LocalFilePrefs` under `stage_settings.<stage_id>`.
An old `stage_settings_all.json` file is a read fallback when the preference key is absent.
App-wide preferences do not have a project event log.
The earlier proposal to event-log every tier did not ship literally.

The image-stage review editor uses the backend setting keys directly. `POST .../project-stages/{stage_id}/rerun` takes
`page_ids` and optional `settings`. It merges `settings` into each page's page-tier override before queueing the jobs,
and rejects a key the stage does not define with 422. `threshold_level` and `skip_denoise` default to `null`, which
leaves the value from `PageConfigOverrides` in place. Dewarp has no adjustable settings.

The controls use `threshold_level`, `skip_auto_deskew`, `min_component_area`, `median_kernel_size`,
`skip_denoise`, `post_transform_crop_insets`, `do_morph`, and `page_h_w_ratio` as appropriate to each stage.
Rerun merges overrides without discarding unrelated keys and rejects unknown keys before enqueue.

Grayscale normalizes legacy flat settings at each tier before merging them.
Its current nested configuration covers flattening, converter/channel choice, color2gray, CLAHE, and output range.
The older mode/gamma proposal is historical, not the current settings schema.

Grayscale shows resolved-source badges and supports page saves, project defaults, and an app Settings editor.
The image-stage review editor offers the same page and project saves and source badges for every stage with controls,
plus Clear page override. The app Settings page has app-wide sections for threshold, deskew, and denoise.

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

Save a copy downloads `GET /api/data/projects/{id}/export`: every file under the project directory, with SQLite files
copied through the backup API, plus `pgdp-prep-export.json` holding the project and page-stage rows. There is no import
path yet. The archive keep list is the project's stage files, from
`GET /api/data/projects/{id}/project-stages/archive/items`.
Open work is on the [roadmap](../plans/roadmap.md#now). The July completion plan is the record of Waves 0–3,
not the queue.

The keep-list route returns an empty inventory for an empty project. Saved keep/drop choices are persisted
separately from the enumerated stage files. This UI and persistence contract does not establish a destructive
cleanup engine. The export is filesystem-only and has no corresponding import operation.

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

Wave 2 and export/inventory behavior was checked against source and tests on 2026-11-13:
`tests/test_image_stage_settings.py`, `tests/test_canvas_aspect.py`, `tests/test_w05_text_zones_split_contract.py`,
`tests/test_project_export.py`, and `tests/test_archive_keep_list.py`; frontend `ImageStageReviewTool.test.tsx`,
`CanvasMapTool.test.tsx`, `TextZonesCanvas.test.tsx`, `StageSettingsAll.test.tsx`, and `ArchiveTool.test.tsx`.
Browser cases are `tests/e2e/test_wave2_screens_browser.py` and `tests/e2e/test_text_zones_canvas_browser.py`.
Implementation commits: `820e055`, `2045373`, `5f451b3`, `e621329`, `096a6a8`, `9d1e2a4`, and `2bc67c8`.
