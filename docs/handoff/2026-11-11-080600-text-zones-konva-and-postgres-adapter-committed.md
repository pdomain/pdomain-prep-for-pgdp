---
kind: handoff
status: "active"
created: "2026-11-11"
created_at: "2026-11-11T08:06:03Z"
owner: "CT"
branch: "feat/night-prep4"
scope: "wave2-interface"
worktree: "/mnt/work/projects/pdomain/pdomain-prep-for-pgdp/.worktrees/night-prep4"
base_commit: "3e2ecd4450d370258e879d85aac33ead865853ac"
supersedes: "2026-11-11-072044-night-wave3-browser-fixes-and-issue-work.md"
handoff_reason: "stopping"
host: "claude-code"
---

# Text zones now edits real page images, and the Postgres adapter is complete

## Goal

Do the W2.4 text-zones Konva issue, verified in real Chromium, then the Postgres adapter issue if it could be tested
against a real local Postgres without system packages or sudo. One commit per item, test-first.

`feat/night-prep4` starts from `feat/night-wave3`, which starts from `feat/wave2-interface`, which starts from
`fix/job-reliability`. None of the four is merged. Nothing was pushed, merged, tagged, released or deployed.

## Done

- `e621329` W2.4. Both Text Zones editors are Konva boards over the page image. The zone editor shows the
  `post_transform_crop` image, falling back to the ingest thumbnail, with stored zones drawn on top. Dragging adds a
  zone, and a list re-types or deletes zones. Save layout and Keep as one now call the layout route; before, both
  were no-ops. A "Split page…" button opens the split editor for any page. The split editor shows the source image
  with a gutter you drag, plus axis buttons, a slider and child previews. Page cards show real thumbnails, and split
  children now get a thumbnail of their own crop.
- `3e2ecd4` Postgres. `PostgresDatabase` implements all `IDatabase` methods: page stages in a normalised table,
  search over a `simple` tsvector column, and `list_distinct_owner_ids`. The `pyright: ignore` in `build_database()`
  is gone. `tests/test_database_contract.py` runs one contract against SQLite always and Postgres when
  `PGDP_TEST_POSTGRES_URL` is set.

Bug found and fixed in W2.4: the text-zones pages aggregate keyed rows by prefix, so every per-page call parsed
`p0001` as `NaN`. Rows are now keyed by the zero-padded `idx0`.

## Verification

`make ci AI=1` exited 0 for both final trees, from the recorded status files in `/mnt/work/pdt/prep4`:
`ci-w24.status` for `e621329` and `ci-pg3.status` for `3e2ecd4`.

- W2.4 in Chromium: `tests/e2e/test_text_zones_canvas_browser.py`, 3 passed. It checks real thumbnails, stored zones
  on the page image, a drawn zone saved and read back, and a dragged 40% gutter producing children with crops
  `(0, 0, 320, 600)` and `(320, 0, 480, 600)` on an 800x600 scan. I also looked at the screenshots. This test is not
  in the `e2e_smoke` set, so `make ci` does not run it. The full Playwright suite was not run.
- Postgres: 23 contract cases plus `tests/test_postgres_adapter.py`, 27 passed against `postgres:17-alpine` in a
  throwaway Docker container on 127.0.0.1:55432, on the final code. The container is stopped and was started with
  `--rm`. `make ci` runs only the SQLite half.

## Failed approaches and mistakes

- The first two Postgres CI runs failed. Run 1 had an over-long Markdown line. Run 2 failed my conformance test,
  which imported the adapter and needs `psycopg`; CI has no `[postgres]` extra. A `cat status && commit` chain
  committed run 2's tree as `dfaddb3` anyway. I fixed the test to read the class with `ast`, re-ran CI to exit 0, and
  amended the local commit into `3e2ecd4`. `dfaddb3` is not on any branch.
- `uv run --extra postgres` installs psycopg into the worktree venv; `make ci` removes it again with `uv sync`.

## Decisions

- Postgres was finished, not made to fail fast, because a real Postgres was available through Docker without sudo.
  Pulling the `postgres:17-alpine` image is the only thing installed.
- Postgres accepts only v2 stage ids in its CHECK constraint; it holds no pre-v2 data.
- The split preview uses the ingest thumbnail as the source image. Split boxes are fractions of the source image,
  and the thumbnail keeps its aspect.
- A manual split shows "manual" in place of the default 80% confidence the machine assigns.

## Not done

- No independent code review ran for either commit.
- W2.4 leaves out the lasso tool, drag-to-reorder reading order, "apply to all splits", and the zone-type chart.
- The split parent stays in the page grid with state `split`, and the Splits filter counts only detector
  suggestions, which the detector never makes. So that filter shows zero.
- No migration exists for a Postgres database made by the old schema. `CREATE TABLE IF NOT EXISTS` adds the new
  tables on the next start.
- Both issue reports say "fixed, awaiting merge" and stay active. Retire them through `doc-retirer` after merge.

## Decisions the owner still needs to make

1. **Split suggestions.** The detector never sets `splitSuggested`, so splits are manual from the zone editor.
   Decide whether the text_zones stage should propose splits.
2. **Split parent in the grid.** Decide whether a split parent should stay visible, be hidden, or show as a group.
3. **Postgres in CI.** Decide whether CI should start a Postgres service and set `PGDP_TEST_POSTGRES_URL`.

The three decisions in the superseded handoff are still open: the W3.9 folio detector, the audit gate, and opening a
clean page in the review.

## State

The working tree is clean after this handoff commit. Temporary files and screenshots are in `/mnt/work/pdt/prep4`.

## Pointers

- `docs/issues/2026-07-21-w24-text-zones-konva.md`
- `docs/issues/2026-11-09-postgres-adapter-incomplete.md`
- `frontend/src/pages/pipeline/tools/TextZonesTool.tsx`
- `frontend/src/pages/pipeline/tools/textZones/`
- `frontend/src/machines/tools/textZonesTool.ts`
- `src/pdomain_prep_for_pgdp/adapters/database/postgres.py`
- `tests/e2e/test_text_zones_canvas_browser.py`
- `tests/test_database_contract.py`

## Resume steps

1. Review `git log feat/night-wave3..feat/night-prep4`. Merge in order: `fix/job-reliability`,
   `feat/wave2-interface`, `feat/night-wave3`, then this branch.
2. Run `make e2e AI=1` once on the merged tree, since only the new text-zones browser test was run.
3. To re-check Postgres, follow the container steps in the `tests/test_database_contract.py` docstring.
4. Answer the owner decisions above, then retire the finished issue reports through `doc-retirer`.
