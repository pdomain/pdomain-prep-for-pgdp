---
kind: archive
status: retired
created_at: "2026-11-11T06:31:41Z"
owner: "CT"
branch: "feat/wave2-interface"
scope: "wave2-interface"
worktree: "/mnt/work/projects/pdomain/pdomain-prep-for-pgdp/.worktrees/feat-wave2-interface"
base_commit: "36fd0fc07d2f218ceceb66dae92ccca4fae18b61"
supersedes: "2026-11-11-052844-job-reliability-fixes-committed-and-awaiting-merge.md"
handoff_reason: "stopping"
host: "claude-code"
created: "2026-11-11"
last_verified: "2026-11-11"
---

# Wave 2 interface items are committed on the branch and await owner review

> **Retired — superseded by `docs/handoff/2026-11-11-072044-night-wave3-browser-fixes-and-issue-work.md`.**

## Goal

Make the image-prep interface honest: real settings, real images, real canvas data and real settings tiers, plus a real
Save a copy. Branch `feat/wave2-interface` starts from `fix/job-reliability` at `1cad35c`, because that branch is not merged.
W2.4 Konva zone splitting was left for a later session.

## Done

Six commits, ahead of `fix/job-reliability`. Nothing was pushed, merged, tagged, released or deployed.

- `2045373` W2.2: review controls use real backend setting keys. Rerun saves the draft as page-tier overrides.
- `820e055` W2.1: real thumbnails and a before and after comparison. The review refreshes when a stage finishes a page.
- `5f451b3` W2.3: canvas map plots measured page sizes. Re-derive saves the median ratio and re-runs every page.
- `096a6a8` W2.5: tier badges and page, project and clear actions in the editor. App Settings covers threshold,
  deskew and denoise.
- `9d1e2a4` W3.10 save-a-copy only: `GET /api/data/projects/{id}/export` downloads a project zip. The stub POST route
  is gone.
- `36fd0fc` applies the code review findings listed under Decisions.
- `make ci AI=1` exited 0 on each of the six trees, from the recorded exit status, not a pipe. The status files are
  `ci-w22.status`, `ci-w21.status`, `ci-w23.status`, `ci-w25.status`, `ci-w310.status` and `ci-review.status` in
  `/mnt/work/pdt/prepw2`.
- One independent reviewer read the whole range. A focused recheck of the fixes returned no findings.

## Not done

- Nothing was checked in a real browser or on a real book. The exit checks in the W2.1, W2.2 and W2.3 reports that need
  `make run` are still open. All work ran on CPU with the GPU hidden, and no GPU job was started.
- The issue reports for W2.1, W2.2, W2.3, W2.5 and W3.10 stay open. Retire them through `doc-retirer` after this reaches
  master. W3.10 must stay open or be split, because its archive half is not done.
- W2.4 is untouched.
- `BULK_RERUN` and `RERUN_STAGE` in `frontend/src/machines/imageStageReview.ts` still have no-op side effects. Bulk Re-run
  and Re-run stage move the banner to Running without starting any work.
- Rows only carry a flag when a stage failed, and that flag is the error text. The flag filter chips and the Same flag
  apply-to choice therefore rarely match anything.
- Review findings left open on purpose, all low severity: a rerun response can overwrite a newer refresh for one event;
  exports have no concurrency or free-space limit; `ImageStageReviewTool` starts a second actor under `CanvasMapTool`;
  Re-derive does not change a page that has its own saved ratio, which the page text now says.

## Failed approaches

- Piping `git commit` through `tail` hid a gitlint rejection for a body line over 100 characters, so W2.1 first looked
  committed when it was not. Check the commit's own exit status.
- The issue's option of a page-tier PUT per page before rerun was rejected. It needs one request per page and cannot
  validate the batch before writing.

## Decisions

- Rerun contract: `POST .../project-stages/{stage_id}/rerun` takes `page_ids` and optional `settings`. It merges settings
  into each page's override. Unknown settings or page ids return 422 before anything is written.
- Review rows now use the zero-padded page id. They used the prefix, so Re-run named a page the runner could not find.
- `threshold_level` and `skip_denoise` default to `null`, which leaves a `PageConfigOverrides` value in place.
- Dewarp has no adjustable settings, because `_dewarp_cpu` ignores its config. Sauvola and adaptive were removed.
- Page sizes come from the PNG header of the `post_transform_crop` output. A body page is within 5% of the median ratio.
- The spreads summary was never built, so nothing was added for it.
- The export includes every file under the project directory plus `pgdp-prep-export.json` with the project and page-stage
  rows. SQLite files use the backup API. A damaged or busy database fails the export. There is no import path yet.

## Decisions the owner still needs to make

1. Archive keep and drop. `archive_v2_cpu` never reads `item_toggles.json` and deletes nothing, although the route docstring
   says it does. `ArchiveTool` still shows `MOCK_ITEMS`. Decide what drop should do before an inventory is built, because
   a real drop deletes artifacts.
2. Bulk Re-run and Re-run stage. Either wire them to the rerun route, or remove the controls.
3. Export scope. The code follows the page text, a zip of the full project. Confirm that, and whether an import is wanted.

Carried over from the job-reliability handoff, which this one replaces:

1. Local CORS default. An unset loopback host still allows any origin. Any web page open in the browser can then call the
   unauthenticated local API, including run, delete, cancel and now export. The alternative is allowing only the Vite dev
   and app origins by default.
2. Stage Cancel button. No control on the pipeline page sends `CANCEL` to a stage runner, and `runAllStale` is not mounted.
3. Interrupted synchronous page runs. A page-stage row left `running` by a synchronous request has no job, so startup does
   not reset it, and `pgdp-prep reindex --heal` skips `running` rows.

## State

The working tree is clean after the handoff commit. Temporary files are under `/mnt/work/pdt/prepw2`. Still open from
`fix/job-reliability`: four issue records to retire after merge (W3.6, W3.4, W3.7,
`2026-11-09-progress-overwrites-cancel`) and the zip timestamp bug, recorded in `docs/issues/2026-11-11-submission-zip-entry-timestamps.md`.

## Pointers

- `docs/issues/README.md`
- `docs/architecture/09-image-prep-settings.md`
- `docs/issues/2026-07-21-w310-save-copy-archive.md`
- `frontend/src/pages/pipeline/tools/ImageStageReviewTool.tsx`
- `frontend/src/pages/pipeline/tools/StageControls.tsx`
- `frontend/src/pages/pipeline/tools/stageSchemas.ts`
- `frontend/src/pages/pipeline/tools/CanvasMapTool.tsx`
- `frontend/src/machines/imageStageReview.ts`
- `src/pdomain_prep_for_pgdp/api/data/project_stages.py`
- `src/pdomain_prep_for_pgdp/core/project_export.py`
- `src/pdomain_prep_for_pgdp/core/pipeline/steps/archive_stage.py`
- `tests/test_image_stage_settings.py`

## Resume steps

1. Review `git log fix/job-reliability..feat/wave2-interface`. Merge `fix/job-reliability` first.
2. Under `make run`, on a real book: move the threshold slider, Re-run, and confirm the After image changes. Open
   canvas map
   and confirm the points match the pages. Download a copy and open the zip.
3. Answer the owner decisions above.
4. After merge, retire the issue reports through `doc-retirer`.
5. Start W2.4 Konva zone splitting.
