# Pipeline Task Model — granular per-page stages with dirty propagation

> **Status:** locked (2026-05-07). Spec-only — implementation lands in M1–M6
> per `docs/08-roadmap.md` §P0.5.
>
> **Spec-Issue**: ConcaveTrillion/pd-prep-for-pgdp#17
>
> **Supersedes (in intent):** the coarse-grained `JobType` set
> (`batch_process_pages`, `batch_extract_illustrations`, `batch_ocr`,
> `batch_text_postprocess`, `build_package`) as the *user-visible*
> pipeline shape. Those job types remain available as fan-out
> orchestrators during M5, then are removed in M6.

This spec is the **single source of truth** for the pipeline task-model.
The rest of the spec set (`specs/00`–`specs/09`, `docs/02-backend.md`,
`docs/03-pipeline.md`, `docs/06-deployment.md`, `docs/08-roadmap.md`)
links here for the canonical model rather than restating it.

---

## Why this exists

Today the user sees seven row-types in the workbench (ingest,
thumbnails, batch_process_pages, batch_extract_illustrations, batch_ocr,
batch_text_postprocess, build_package). `batch_process_pages` is a
monolithic Step 4 (`core/pipeline/process_page.py`) that runs 4c → 4o
in one shot. When a single sub-step is wrong (e.g. the auto-deskew
over-rotated; the threshold ate a thin glyph row), the user has no way
to:

1. See the intermediate image after each sub-step.
2. Re-run *just* the affected sub-step.
3. Make downstream sub-steps inherit the corrected upstream artifact
   without rerunning the whole page.

This spec replaces that monolith with a **DAG of named stages**, each
with a typed input/output artifact, persisted state, and a dirty-
propagation rule. The workbench surfaces every stage's artifact and
gives the user "run this stage / run from here / rerun all dirty"
controls.

The orchestration shape is unchanged for headless / batch users: a
project-level "process all pages" task fans out to per-stage page tasks
internally.

---

## Two scopes of task

The current pipeline mixes "operate on the whole project" with "operate
on one page" under a single `JobType` enum. The new model splits them:

### Project-level tasks

Operate on the whole project, or on a stage *across* all pages.

| Task | Replaces | Notes |
|---|---|---|
| `project.ingest` | `JobType.unzip` | Zip / folder ingest. |
| `project.thumbnails` | `JobType.thumbnails` | Step 2 fan-out. |
| `project.run_stage_all_pages(stage_id)` | `batch_process_pages`, `batch_extract_illustrations`, `batch_ocr`, `batch_text_postprocess` | Generic — runs `stage_id` on every page that needs it. |
| `project.run_dirty(stage_filter?)` | (new) | Runs every dirty stage on every page until clean. Optional stage filter narrows the sweep. |
| `project.build_package` | `build_package` | Reads completed page outputs; **gated by `text_review.clean` on every page** — see §`text_review` gate below. |
| `project.report` | (new, later) | Project-wide reports (page count by status, error summary, etc.). |

### Page-level tasks

Operate on one page. Each is a single stage execution.

| Task | Notes |
|---|---|
| `page.run_stage(page_id, stage_id)` | Run one stage on one page; mark downstream dirty. |
| `page.run_from(page_id, stage_id)` | Run `stage_id` and all downstream stages serially. |
| `page.run_dirty(page_id)` | Run all currently-dirty stages on this page in DAG order. |
| `page.split(page_id, params)` | Create N sibling child pages (see §Splits). |
| `page.unsplit(child_id)` | Delete the children of a parent page; restore parent (see §Splits). |
| `page.text_review.clean(page_id)` | Mark `text_review` clean for this page (human attestation). |

`page_id` rather than `idx0` because a page now also carries split-child
identity (see §Splits). For unsplit pages, `page_id` is derivable from
`(project_id, idx0)`. All page-level tasks are also valid as
project-level fan-outs (the project-level form just iterates pages).

---

## Per-page stage DAG

The current `process_page_cpu(source_image_bytes, cfg)` body is a linear
chain (4c→4o). We promote each step to a named stage with an explicit
input artifact name, output artifact name, and dependency list.

Stage IDs are stable strings (used as DB keys, storage path components,
and API query strings). They are versioned via `stage_version` (Q4).

### Page-level stages

Pre-existing today (already discrete; just naming them):

| Stage ID | Input | Output | Depends on | Code today |
|---|---|---|---|---|
| `ingest_source` | source bytes from upload | `source_image` (the original scan, persisted) | (project.ingest) | `core/ingest.py` |
| `thumbnail` | `source_image` | `thumbnail` (400-px JPG) | `ingest_source` | `core/ingest._make_thumbnail_bytes` |
| `auto_detect_attrs` | `source_image` | `page_type`, `alignment` (recorded on `PageRecord`) | `ingest_source` | `core/auto_detect.py` |
| `auto_detect_illustrations` | `source_image` | `illustration_regions[]` (recorded on `PageRecord`) | `ingest_source` | `core/illustrations.auto_detect_illustrations` |

New, decomposed from `process_page_cpu` (current sub-steps 4c–4o):

| Stage ID | Input | Output | Depends on | Code today |
|---|---|---|---|---|
| `decode_source` | `source_image` (bytes) | `decoded_color` (BGR ndarray; persisted as PNG) | `ingest_source` | 4c — `cv2.imdecode` |
| `initial_crop` | `decoded_color` | `initial_cropped` | `decode_source` | 4d — `crop_edges` |
| `manual_deskew_pre` | `initial_cropped` | `pre_deskewed` | `initial_crop` | 4e — `rotate_image(deskew_before_crop)` |
| `grayscale` | `pre_deskewed` | `gray` | `manual_deskew_pre` | 4f — `cv2_convert_to_grayscale` |
| `threshold` | `gray` | `binary` | `grayscale` | 4g — `otsu_binary_thresh` / `binary_thresh` |
| `invert` | `binary` | `inverted` (text=255) | `threshold` | 4h — `invert_image` |
| `find_content_edges` | `inverted` | `content_bbox` (4-tuple, no image) | `invert` | 4i — `find_edges` |
| `crop_to_content` | `inverted` + `content_bbox` | `content_cropped` | `find_content_edges` | 4j — `crop_to_rectangle` (+ optional `add_whitespace_percentage`) |
| `auto_deskew` | `content_cropped` | `auto_deskewed` | `crop_to_content` | 4k — `auto_deskew` (or pass-through) |
| `morph_fill` | `auto_deskewed` | `morphed` (or pass-through) | `auto_deskew` | 4l — `morph_fill` |
| `rescale` | `morphed` (re-inverted) | `rescaled` | `morph_fill` | 4m — `rescale_image(target_short_side=1000)` |
| `canvas_map` | `rescaled` | `proofing_image` (canonical aspect, PNG bytes) | `rescale` | 4n + 4o — `map_content_onto_scaled_canvas` + `cv2.imencode` |

Then the post-Step-4 chain (each is already a named module, just
formalised):

| Stage ID | Input | Output | Depends on | Code today |
|---|---|---|---|---|
| `ocr_crop` | `proofing_image` | `ocr_image` (per-page, single output) | `canvas_map` | `core/pipeline/crop_for_ocr.py` |
| `extract_illustrations` | `source_image` + `illustration_regions` | `hi_res_crops[]` | `auto_detect_illustrations` (and any user edits to `illustration_regions`) | `core/illustrations.extract_illustration` |
| `ocr` | `ocr_image` | `ocr_words[]`, raw `ocr_text` | `ocr_crop` | `core/ocr.py` |
| `text_postprocess` | raw `ocr_text` | final `ocr_text` | `ocr` | `core/text_postprocess.py` |
| `text_review` | final `ocr_text` | reviewed `ocr_text` (user-edited) + attestation | `text_postprocess` | gate stage; see §`text_review` gate |

`build_package` is **project-level**, not a page stage; it consumes
each page's `text_review` output plus `extract_illustrations` outputs.
Splits are no longer config-on-`ocr_crop` — they are **sibling pages**
(see §Splits).

### Blank-page short circuit

For `page_type ∈ {blank, plate_b, plate_r}` the current code returns
a synthesised blank PNG. In the new model:

+ Stages `decode_source` … `morph_fill` are **skipped** and recorded as
  `not-applicable` (a separate status from `clean`/`dirty`).
+ `rescale` + `canvas_map` are replaced by a single
  `blank_proof_synth` stage that depends on `auto_detect_attrs` (it
  needs `page_type` + `page_h_w_ratio`) and emits `proofing_image`.

The DAG is the same downstream of `canvas_map` / `blank_proof_synth`
(they're the two producers of `proofing_image`).

### `plate_p` page

For `page_type=plate_p` the OCR / text stages are skipped (status
`not-applicable`). `extract_illustrations` does the real work — the
whole page becomes one illustration crop.

### DAG (fan-in/fan-out)

```
ingest_source ─┬─ thumbnail
               ├─ auto_detect_attrs
               ├─ auto_detect_illustrations ─→ extract_illustrations ──┐
               └─ decode_source ─→ initial_crop ─→ manual_deskew_pre   │
                                                          ↓             │
                                                       grayscale        │
                                                          ↓             │
                                                       threshold        │
                                                          ↓             │
                                                       invert ─→ find_content_edges
                                                          ↓             ↓
                                                          └→ crop_to_content
                                                                  ↓
                                                              auto_deskew
                                                                  ↓
                                                               morph_fill
                                                                  ↓
                                                               rescale
                                                                  ↓
                                                            canvas_map ─→ proofing_image
                                                                  ↓
                                                              ocr_crop
                                                                  ↓
                                                                 ocr
                                                                  ↓
                                                          text_postprocess
                                                                  ↓
                                                             text_review ─┐
                                                                          ▼
                                                                 (project) build_package
```

`auto_detect_attrs` also feeds `canvas_map` (page_type / alignment) and
the upstream `find_content_edges` indirectly through resolved config —
but **artifact-level** dependency is only what the algorithm reads as
bytes / numbers. Config changes are handled via the `config_hash`
input-fingerprint, not via DAG edges; otherwise every stage would
depend on everything that touches `ProjectConfig`.

---

## Splits as sibling pages (Q6 lock)

A **split** turns one parent page into N **sibling child pages**, each
of which starts at the post-ingest stage and runs the full pipeline
independently. This replaces the older notion of splits as
configuration on `ocr_crop`.

### Why sibling pages, not config

A single `ocr_crop` config-list collapses the children into one row,
which means:

+ The user cannot run `auto_deskew` differently per split (legitimate:
  a 2-column page where the left column is straight but the right is
  visibly skewed by 3°).
+ Dirty propagation is awkward — re-running upstream of `ocr_crop`
  marks the whole list dirty, even when only one split's parameters
  changed.
+ The workbench artifact viewer cannot show "the OCR'd binary image
  for split b" without a special path-suffix scheme.

Sibling pages reuse the per-page DAG verbatim. Children are first-class
rows in `page_stages` and inherit every workbench affordance.

### Data model on Page

Every page row carries:

| Column | Meaning |
|---|---|
| `parent_page_id` | FK to parent page id (NULL for root pages). |
| `source_crop_bbox` | `(x, y, w, h)` on the parent's source image, in original-source coordinate space. Required when `parent_page_id IS NOT NULL`. |
| `split_index` | 1-based index among siblings (1, 2, 3, …). NULL for root pages. |
| `split_at_stage` | The stage on the parent at which the split was created — typically `auto_detect_attrs` (split immediately after ingest), but the spec allows splits at any stage whose output is an image (e.g. after `auto_deskew` if the user wants to split *post-deskew*). Records the stage ID as a string. |
| `reading_order` | Determines output sort order across siblings. Inherited from the user's split definition. |
| `split_suffix` | The user-chosen suffix that gets appended in the page prefix (`a`, `b`, `cl`, …). |

Splits are recursive: a child page may itself be split, producing
grandchildren. The `parent_page_id` chain is finite and acyclic by
construction (creation always creates a fresh child id; you cannot
re-parent).

### Workbench treatment

When a parent page has been split (one or more rows reference it as
`parent_page_id`):

+ The page list **hides the parent by default**. A "Show split parents"
  toggle reveals it.
+ Children appear as auto-suffixed entries: parent prefix `f042` →
  children `f042-1`, `f042-2`, … in the list. The numeric suffix is
  the `split_index`; the user-facing `split_suffix` (`a`, `b`, `cl`)
  is shown next to it where the user has set one.
+ Each child page is a normal workbench target — opening it shows the
  full stage chain, with `decode_source` driven by the `source_crop_bbox`
  rather than the parent's full source.
+ A "Reverse split" affordance on any child:
    1. Deletes all sibling rows of that child (its parent's other children).
    2. Restores the parent to visible.
    3. Marks all derived stage state on the deleted children as
       discarded (the rows are deleted; their on-disk artifacts are
       cleaned up by the reindex CLI).
    4. Does **not** modify the parent's stage state — the parent never
       lost its rows when the children were created.

### Numbering / prefix resolution

`compute_prefix(page_id, project, pages)` recurses up the
`parent_page_id` chain. For a child page:

1. Compute the parent's prefix as if the child didn't exist.
2. Append the child's `split_suffix` to the parent's prefix.

For example, a parent at `idx0=49` resolving to `p045` plus a child
with `split_suffix="a"` resolves to `p045a`. Recursive splits compose
left-to-right: a grandchild whose parent is `p045a` and whose own
suffix is `b` resolves to `p045ab`.

`build_package` flattens prefixes into PGDP filenames using
`<full_prefix>.png` / `<full_prefix>.txt` — the existing convention.
The package iterates pages in `(parent_idx0, split_index)` order so
sibling pages stay adjacent in the zip.

### Stage state on children

A child page's `page_stages` rows look identical to a root page's
rows. The row count is the same (16). Differences:

+ `decode_source` reads the parent's source image, then crops to
  `source_crop_bbox`. This is recorded in the stage's `input_hash`
  alongside the `(parent_id, bbox)` so a parent re-ingest correctly
  marks the child's `decode_source` dirty.
+ `extract_illustrations` on a child only fires if the child page
  has its own `illustration_regions` (the child's bbox-cropped
  source). Whole-page plates from the parent stay on the parent.

---

## `text_review` as gate stage with awaiting-review UX (Q7 lock)

`text_review` is a DAG stage with statuses `not-run` / `dirty` / `clean` /
`failed`. **`clean` requires a user action** — the "Mark page reviewed"
button on the page workbench. There is no automated path that flips
`text_review` from `dirty` to `clean`; if `text_postprocess` reruns,
its downstream `text_review` row goes back to `dirty` and the user
must re-attest.

Default for new projects: `text_review` is **on** for every page.
Project setting `require_text_review` (already in spec) starts at
`true`.

### `awaiting_review` job state

`build_package` is gated by all proof-range pages being
`text_review.clean`. **It does not refuse the build** when some pages
are unreviewed. Instead the project-level `build_package` job
transitions to a new `awaiting_review` state:

```python
class JobStatus(str, Enum):
    queued          = "queued"
    scheduled       = "scheduled"
    running         = "running"
    awaiting_review = "awaiting_review"     # NEW — see Q7
    complete        = "complete"
    error           = "error"
    cancelled       = "cancelled"
```

The job stays parked in `awaiting_review` until either:

1. **Every** proof-range page is `text_review.clean` — the runner
   transitions the job to `running` and proceeds with packaging.
2. The user explicitly cancels — the job moves to `cancelled`.

While parked, the job still exists, still has its `id`, still appears
in `GET /api/data/jobs`, and the SSE stream stays open emitting
`awaiting_review` heartbeats every ~30 s with a count of
remaining-unreviewed pages.

### UI surfaces

When a project has any `awaiting_review` job:

+ **Project banner.** A persistent banner on every project route shows
  "3 pages awaiting review before package can build" with a primary
  action that navigates to the next unreviewed page in the workbench.
+ **Open Tasks bell.** A bell icon in the app shell top-bar shows a
  numeric badge equal to the count of unreviewed pages plus any other
  human-input items (currently just unreviewed pages; future: e.g.
  illustration regions awaiting confirmation). Clicking the bell opens
  a dropdown listing each item with a click-through.
+ **Workbench page-level "Mark reviewed" button.** When clicked, fires
  `POST /api/pages/{id}/text_review/clean`. The DAG runner checks
  whether any `awaiting_review` jobs in this project now have all
  pages clean and, if so, advances them to `running`.

### Failure modes

+ User edits text in the workbench → the `text_review` row is *already*
  the user's working state; the edit just stays in `dirty` until they
  click "Mark reviewed".
+ User clicks "Mark reviewed" while `text_postprocess` is concurrently
  re-running → race resolved by the eager dirty cascade: when
  `text_postprocess` completes, `text_review` is set to `dirty` again,
  overwriting the user's `clean`. The UI shows a banner: "Text was
  re-postprocessed; please review again."

---

## Memory-resident execution model

The per-page stage DAG operates on **in-memory image objects** during
a page-processing run, not through disk between every stage. Disk I/O
is reserved for persistence checkpoints; it is not on the per-stage
critical path.

### In-memory by default during a run

When stages 1..N execute as part of a single page-processing pass
(e.g. `page.run_dirty(page_id)`, `page.run_from(page_id, stage_id)`,
or a project-level fan-out's per-page worker), the output of stage K
is held in RAM and passed directly to its DAG-downstream dependents.
The DAG executor maintains a **refcount / last-consumer** scheme keyed
by artifact name: each in-memory artifact's refcount equals the number
of stages in this run that still have it as an unconsumed input. The
artifact may be released only when refcount falls to zero **and** any
deferred persistence has been queued.

### Deferred disk writes

Every stage's output is destined for persistence (Q3 — every
intermediate, always). The write does not block the DAG. The
serialized artifact is submitted to a **bounded executor with a
bounded queue** (Q8) and the DAG immediately advances to the next
stage on the in-memory copy.

Failures in deferred writes are surfaced as a **stage failure** (Q9 —
fail loudly). They mark the row's `status` as `failed` and propagate
dirty to all downstream stages. See §Persistence model below for the
dual-write transactional dance.

### Drop-on-last-consumer

Once an in-memory artifact has been consumed by all of its DAG-
downstream dependents in this run **and** its persistence has been
queued, the runner drops its reference so the GC can reclaim the
buffer. For a long page-process pass this keeps peak RAM bounded by
the working-set size of the DAG (typically 2–3 active artifacts), not
the cumulative size of the full chain.

### Lazy load on partial / single-stage reruns

When a user invokes "rerun stage K on page Y" from the workbench:

1. Only stage K's input artifacts are loaded from disk — from the
   nearest persisted upstream output. Earlier stages are not
   re-executed.
2. Stage K runs against those in-memory inputs.
3. Dirty propagation flags downstream stages (per §Dirty propagation),
   but those reruns — when triggered — also follow the memory-resident
   pattern starting from K's output. They do not round-trip through
   disk between K and K+1.

This means a "rerun K then run dirty" sequence on a single page pulls
upstream(K-1) once, then runs K..N entirely in RAM, persisting all
intermediates off the critical path.

### Workbench artifact viewer

The artifact viewer (per §Workbench UX) reads from disk. It does
**not** trigger or require an in-memory DAG run; it is a
read-after-the-fact view. This decouples "interactive inspect" from
"compute pipeline" so that opening a page in the workbench costs only
object-storage reads.

---

## Cross-references between Q3, Q8, Q9

These three locks interact tightly:

+ **Q3 (every intermediate, always)** means every stage produces a
  persistence write — there is no "checkpoint vs. non-checkpoint"
  distinction.
+ **Q9 (fail loudly)** means any write failure marks the stage `failed`,
  not warned-but-clean.
+ Together, Q3 + Q9 mean disk hiccups would crash the DAG without
  back-pressure. **Q8 (bounded executor, bounded queue)** is therefore
  load-bearing — when disk is slow, the DAG executor blocks on
  submission rather than letting the in-flight write set grow
  unboundedly. This is intentional: blocking the DAG on a slow disk
  is the correct behavior because the alternative is RAM growth that
  ends in OOM.

---

## Persistence model

> The on-disk state below is the **canonical state** of a page's
> artifacts. Every stage write is a transaction across the DB row and
> the on-disk file (Q1-followup): the page's stage state in the DB and
> on disk move together.

### Filesystem layout (under `~/pgdp-projects/<id>/`, via `IStorage`)

Existing keys (preserved):

```
projects/<id>/source/<stem>.<ext>            # ingest_source output (root pages)
projects/<id>/thumbnails/<stem>.jpg          # thumbnail output
projects/<id>/hi_res/<prefix>_<NN>.<ext>     # extract_illustrations output
projects/<id>/for_zip/<book_name>.zip        # build_package output
```

New per-stage artifact keys — **every stage of every page**, indexed
by `page_id` (which encodes the parent chain for split children):

```
projects/<id>/pages/<page_id>/source.<ext>          # for split children: the cropped source
projects/<id>/pages/<page_id>/stages/<stage_id>/output.<ext>
projects/<id>/pages/<page_id>/stages/<stage_id>/input_hash.txt    # debugging aid
projects/<id>/pages/<page_id>/manifest.json         # roll-up of stage statuses
```

Concrete examples:

```
projects/<id>/pages/0042/stages/threshold/output.png
projects/<id>/pages/0042/stages/canvas_map/output.png   # == proofing_image
projects/<id>/pages/0042/stages/ocr_crop/output.png
projects/<id>/pages/0042/stages/ocr/words.json
projects/<id>/pages/0042/stages/ocr/raw.txt
projects/<id>/pages/0042/stages/text_postprocess/output.txt
projects/<id>/pages/0042/manifest.json
```

`page_id` for root pages is the zero-padded 4-digit `idx0`
(`0042`). For split children, `page_id` is parent path plus suffix:
`0042/splits/a` for the first child of `0042`. Recursive splits compose:
`0042/splits/a/splits/b` for a grandchild. This places child stage
artifacts under their parent's directory tree, which is how the
reindex CLI walks the filesystem to detect drift.

### Disk-cost implication

Every-intermediate persistence at typical proof sizes (~1–2 MB
per stage output) means roughly **16× source-page footprint per
page**. A 500-page book at 2 MB/source-page expands to ~16 GB of
stage artifacts. M4 migration must surface this in the upgrade UI;
M5+ may add a `pgdp-prep --prune-stage-artifacts` opt-in for users
who are done proofing and want to recover the disk. Pruning is an
explicit user choice — it permanently disables fast workbench reruns
on that project unless the user re-runs the full DAG to repopulate.

### SQLite schema

Normalised `page_stages` table (Q1).

```sql
CREATE TABLE IF NOT EXISTS page_stages (
    project_id    TEXT    NOT NULL,
    page_id       TEXT    NOT NULL,    -- zero-padded idx0 for root, with /splits/<suffix> chain for children
    stage_id      TEXT    NOT NULL,
    status        TEXT    NOT NULL,    -- 'not-run' | 'clean' | 'dirty' | 'running' | 'failed' | 'not-applicable'
    stage_version INTEGER NOT NULL,    -- bumped when the stage's code/algorithm changes (Q4)
    config_hash   TEXT,                -- hash(resolved-config-fields-this-stage-reads)
    input_hash    TEXT,                -- hash(upstream artifact fingerprints)
    artifact_key  TEXT,                -- IStorage key, NULL when never-run
    last_run_at   REAL,                -- epoch seconds
    duration_ms   INTEGER,
    error_message TEXT,
    job_id        TEXT,                -- last job that touched this row
    PRIMARY KEY (project_id, page_id, stage_id)
);
CREATE INDEX IF NOT EXISTS page_stages_proj_status
    ON page_stages(project_id, status);
CREATE INDEX IF NOT EXISTS page_stages_proj_page
    ON page_stages(project_id, page_id);
```

The `pages` table gains the split-related columns specified above
(`parent_page_id`, `source_crop_bbox`, `split_index`, `split_at_stage`,
`reading_order`, `split_suffix`).

The existing `pages.body` JSON keeps `processing_status` / `outputs`
as **rolled-up** views (all stages clean ⇒ page complete), recomputed
by the runner whenever a stage transitions. We do **not** duplicate
per-stage state in two places.

### Dual-write reconciliation (Q1-followup lock)

Each stage write is a **two-target transaction**: the on-disk artifact
and the DB row. Best-effort sequence:

```
1. Compute artifact bytes in RAM.
2. Write to disk: open temp file → write → fsync → atomic rename to final path.
3. Begin DB transaction.
4. UPDATE page_stages SET status='clean', artifact_key=<key>,
      last_run_at=now, duration_ms=..., input_hash=..., config_hash=... ;
5. COMMIT.
6. On step-5 failure: delete the on-disk file we just renamed,
   set status='failed' in a separate transaction.
```

Failure modes the spec must surface to ops (in the reindex report):

| What happened | Detection | Resolution |
|---|---|---|
| Step 2 fails (disk full, permission) | OSError before any DB work | Mark row `status='failed'` with the OS error message. No file to delete. |
| Step 5 fails after step 2 | Best-effort delete of the file in step 6; if delete fails, file becomes an orphan | Reindex CLI sees: file present, no DB row → flagged as orphan, prompts user to delete or re-claim. |
| Both succeed but a later read sees a hash mismatch | Reindex hashes file vs. recorded `input_hash`/derived expected | DB row wins because reconciliation reruns the stage (its `clean` claim is sourced from the DB). The on-disk file is overwritten on next stage execution. |
| Process crashes mid-write | Temp file exists (no atomic rename), DB row still `running` | On next startup, runner sweeps `status='running'` rows older than 60 s and resets them to `dirty` (their previous predecessor's output is still on disk). Temp files older than 60 s are deleted. |

A **periodic reconciler** runs on project open and on a configurable
interval (default 30 min; `PGDP_RECONCILE_INTERVAL_SECONDS`). It walks
the `projects/<id>/pages/` tree and compares against `page_stages`,
emitting a report. A `pgdp-prep reindex <project_id>` CLI command
runs the same scan on demand and offers a `--heal` flag that:

+ Deletes orphan files (file present, no DB row).
+ Marks DB rows whose file is missing as `failed`.
+ Optionally rehashes files and flips DB rows to `dirty` when their
  recorded hash doesn't match (default: report only; `--heal` flag
  does the flip).

The reindex implementation is part of M1. It is **the** source-of-truth
arbiter when DB and disk disagree.

---

## Dirty propagation (Q2 lock — eager)

When stage `S` on page `P` re-runs (or its config / input fingerprint
changes), all stages reachable from `S` in the DAG on page `P` get
status `dirty`. The transition is **eager** at write time:

```python
def mark_dirty(project_id, page_id, stage_id):
    UPDATE page_stages
       SET status = 'dirty', artifact_key = NULL
     WHERE project_id = ?
       AND page_id    = ?
       AND stage_id IN (<topologically_downstream_of(stage_id)>);
```

The downstream set is a static lookup — `STAGE_DAG.descendants(stage_id)`
— not a DB query. The DAG is hard-coded in the runner, so this is just
an in-memory transitive closure.

### Cross-page dirty propagation: split children

When a parent page's stage K reruns and that K is upstream of the
split point, all child pages' `decode_source` rows are also marked
dirty (their input — the parent's K-output, cropped to
`source_crop_bbox` — has changed). The framework handles this by
treating each split child as a normal downstream consumer of its
parent's `split_at_stage` output.

A page is **complete** iff every applicable stage has `status='clean'`.
Project-level `build_package` reads `pages` rows whose computed
"complete" rolls true; pages with any dirty / failed / running stage
are skipped (and surfaced via the awaiting-review banner).

### Re-run modes

+ `page.run_stage(page_id, stage_id)` — runs *only* `stage_id`. Marks
  downstream dirty.
+ `page.run_from(page_id, stage_id)` — runs `stage_id`, then walks
  downstream in topological order, running each.
+ `page.run_dirty(page_id)` — runs every dirty stage in DAG order. Skips
  `not-applicable`. Used when the user has fiddled with multiple
  upstream stages and wants the page to settle.

---

## Stage versioning (Q4 lock)

Each stage has an integer `stage_version` in a static registry:

```python
# core/pipeline/dag.py
STAGE_VERSIONS = {
    "ingest_source": 1,
    "thumbnail": 1,
    "auto_detect_attrs": 1,
    "auto_detect_illustrations": 1,
    "decode_source": 1,
    "initial_crop": 1,
    "manual_deskew_pre": 1,
    "grayscale": 1,
    "threshold": 1,
    "invert": 1,
    "find_content_edges": 1,
    "crop_to_content": 1,
    "auto_deskew": 1,
    "morph_fill": 1,
    "rescale": 1,
    "canvas_map": 1,
    "blank_proof_synth": 1,
    "ocr_crop": 1,
    "extract_illustrations": 1,
    "ocr": 1,
    "text_postprocess": 1,
    "text_review": 1,
}
```

Bump by hand when the stage's algorithm changes (e.g. a `pd-book-tools`
upgrade rewrites `auto_deskew`). On read of a `page_stages` row, if
`stage_version < STAGE_VERSIONS[stage_id]`, the row is treated as
`dirty` regardless of stored status. The next stage rerun overwrites
the version.

Auto-derive (hash of stage source) is deferred unless manual bumping
becomes a chronic source of bugs.

---

## Stage implementation registry (Q5 lock — `STAGE_IMPL[stage_id][device]`)

The current `LocalBackend` / `CpuBackend` class hierarchy is **replaced
by end of M5** with a registry:

```python
# core/pipeline/registry.py
STAGE_IMPL: dict[str, dict[str, Callable]] = {
    "auto_deskew": {
        "cpu":  cpu_impls.auto_deskew_cpu,    # numpy ndarray in/out
        "cuda": gpu_impls.auto_deskew_cuda,   # cupy ndarray in/out
    },
    "ocr": {
        "cpu":  cpu_impls.ocr_cpu,
        # No "cuda" key: DocTR auto-picks cuda:0 inside the cpu impl
        # when torch.cuda.is_available(). The registry value is
        # device-agnostic for stages that delegate to PyTorch.
    },
    ...
}
```

Each stage call site looks up `STAGE_IMPL[stage_id][device]` where
`device ∈ {"cpu", "cuda"}` is selected per-call by the framework based
on `Settings.gpu_backend` and per-stage availability.

### M2 introduces, M5 cuts over, M6 deletes

+ **M2** lands the registry alongside the existing `LocalBackend` /
  `CpuBackend` classes. Stage callables route through the registry;
  the old classes still provide their non-stage entrypoints
  (`run_batch`, `run_ocr`, `process_page`).
+ **M5** has every stage call site go through the registry. The old
  classes still exist but their methods are thin wrappers that call
  the registry.
+ **M6** deletes the `LocalBackend` and `CpuBackend` classes, replacing
  them with a small `pick_device()` helper that the registry consults.

---

## In-memory artifact type model (Q10 lock — device-aware)

Every stage declares the input and output artifact types it accepts /
produces. The framework auto-bridges across stage boundaries.

### Canonical types

| Device | Type | Metadata struct |
|---|---|---|
| CPU | `numpy.ndarray` | `ImageMeta(dpi: int, channel_order: Literal["bgr","gray","binary"], geometry_hints: dict, device_label: str = "cpu")` |
| CUDA | `cupy.ndarray` (when CuPy is importable and `STAGE_IMPL[stage_id]['cuda']` is dispatched) | same `ImageMeta` with `device_label="cuda:0"` |

The `ImageMeta` struct rides alongside the array as a named tuple
`(array, meta)` — no Python class hierarchy.

### Type-conversion rules

A stage declares its accepted input set:

```python
@stage("threshold", inputs={"numpy", "cupy"}, output="cupy" if cuda else "numpy")
def threshold_cuda(arr, meta): ...
```

When a producer's output type doesn't match the consumer's accepted
set, the framework auto-bridges:

+ `cupy → numpy`: `cupy.asnumpy(arr)` (DEVICE→HOST PCIe transfer).
+ `numpy → cupy`: `cupy.asarray(arr)` (HOST→DEVICE PCIe transfer).

Every auto-bridge emits a `logger.debug` line including the from/to
device labels — a hidden PCIe round-trip on a hot path is surfaced in
debug logs so it can be optimised by reordering stages or pinning
device selection.

### CPU-only stages

A stage that has no `cuda` entry in `STAGE_IMPL` is CPU-only. Its
declared inputs are `{"numpy"}`. If an upstream stage produced cupy,
the framework inserts a `cupy.asnumpy` bridge before the call. This
keeps the framework's device choice per-stage rather than per-page
— mixed pipelines are first-class.

### GPU-aware stages

A stage with both `"cpu"` and `"cuda"` entries in `STAGE_IMPL` accepts
either input type. The framework picks the device based on:

1. `Settings.gpu_backend` (e.g. `"cuda"` ⇒ prefer CUDA when available).
2. Whether the upstream artifact is already on the preferred device
   (avoid unnecessary bridging).
3. Per-stage capability fallbacks (a stage that's only registered for
   `"cpu"` always picks CPU regardless).

---

## API surface

New routes to support per-stage execution and the workbench artifact
viewer. All page-id route segments accept either an `idx0` (root page)
or the structured split-child id (`0042/splits/a`).

### Per-page stage routes

| Route | Body / Query | Behaviour |
|---|---|---|
| `GET /api/pages/{page_id}/stages` | — | Returns ordered list of `PageStageState` for this page. |
| `POST /api/pages/{page_id}/stages/{stage_id}/run` | `{mode: "single" \| "from"}` | Synchronous per-stage execution. `single` runs only this stage; `from` runs this stage and all downstream. |
| `GET /api/pages/{page_id}/stages/{stage_id}/artifact` | — | Binary stream of the stage's output artifact (PNG / JSON / TXT depending on stage). 404 when never-run. |
| `POST /api/pages/{page_id}/split` | `{children: [{bbox, split_suffix, reading_order}, ...], split_at_stage: str}` | Creates N sibling child pages of this parent. Returns the new page IDs. |
| `POST /api/pages/{page_id}/unsplit` | — | Reverses the split: deletes this page's siblings and restores the parent to visible. Caller must be a child page. |
| `POST /api/pages/{page_id}/text_review/clean` | — | Marks `text_review` clean for this page (human attestation). |

### Project-level stage routes

| Route | Body / Query | Behaviour |
|---|---|---|
| `GET /api/projects/{id}/stages` | `?stage_id=&status=` | Project-wide stage view; cheap because of the `(project_id, status)` index. |
| `POST /api/projects/{id}/stages/{stage_id}/run-all` | `{only_dirty: bool}` | Project-level fan-out. Returns a `job_id`. |
| `POST /api/projects/{id}/run-dirty` | `{stage_filter?: [...]}` | Project-wide "run everything dirty". Returns a `job_id`. |
| `POST /api/projects/{id}/build-package` | — | Submits `build_package` job; transitions to `awaiting_review` if any pages are unreviewed. |

### Existing endpoints during M1–M5

`POST /api/gpu/process-page` and `POST /api/gpu/run-ocr-page` remain
through M5 as thin shims onto the per-stage runner. They are removed
in M6.

`POST /api/gpu/jobs` continues to exist as the project-level
fan-out endpoint. New job types:

```python
class JobType(str, Enum):
    # Existing
    unzip = "unzip"
    thumbnails = "thumbnails"
    build_package = "build_package"
    # NEW
    project_run_stage_all = "project.run_stage_all_pages"
    project_run_dirty     = "project.run_dirty"
    page_run_stage        = "page.run_stage"     # used by run_dirty mode
    # DEPRECATED in M5, REMOVED in M6
    batch_process_pages = "batch_process_pages"
    batch_ocr = "batch_ocr"
    batch_text_postprocess = "batch_text_postprocess"
    batch_extract_illustrations = "batch_extract_illustrations"
```

`Job.payload` for the new types carries `{stage_id, page_ids?,
only_dirty}`. SSE events include `stage_id` and `page_id` so the
workbench can highlight the stage currently running.

---

## Workbench UX (per-page view)

Per-page route stays `/project/{id}/page/{page_id}`. Layout sketch:

```
┌─────────────────────────────────────────────────────────────────────┐
│ p045 (idx 49)                            [Run dirty] [Run from →]  │
│                                                                      │
│ ┌── Stage chain ────────────────────────────────────────────────┐  │
│ │ ●  ingest_source        clean    artifact: source/<stem>.jp2  │  │
│ │ ●  thumbnail            clean    artifact: thumbnails/<stem>… │  │
│ │ ●  auto_detect_attrs    clean    page_type=normal             │  │
│ │ ●  auto_detect_illus    clean    3 regions                    │  │
│ │ ─                                                              │  │
│ │ ●  decode_source        clean                                  │  │
│ │ ●  initial_crop         clean    [view artifact]               │  │
│ │ ●  manual_deskew_pre    n/a      (no override set)             │  │
│ │ ●  grayscale            clean    [view artifact]               │  │
│ │ ⚠  threshold            DIRTY    (changed level: 140→160)      │  │
│ │ ○  invert               not-run                                │  │
│ │ ○  find_content_edges   not-run                                │  │
│ │ … (etc.)                                                       │  │
│ │                                                                │  │
│ │ Affordances per row: [▶ Run this]  [▶ Run from here]           │  │
│ │ Header affordances:  [Run all dirty]  [Reset page (re-run all)]│  │
│ └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│ ┌── Artifact viewer ─────────────────────────────────────────────┐  │
│ │ Stage: [threshold ▼]    Compare with: [grayscale ▼]            │  │
│ │ ┌────────────┐  ┌────────────┐                                  │  │
│ │ │ before     │  │ after      │   ←  side-by-side artifacts      │  │
│ │ │ (gray)     │  │ (binary)   │      at full image res           │  │
│ │ └────────────┘  └────────────┘                                  │  │
│ │ Diff overlay: [✓]  Histogram: [✓]                              │  │
│ └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│ ┌── Stage controls (selected stage: threshold) ──────────────────┐  │
│ │  Otsu auto                              [✓]                    │  │
│ │  Manual level                           [   140 ]              │  │
│ │  ─                                                              │  │
│ │  [Apply + Run this stage]    [Apply + Run from here]            │  │
│ └────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

Reads:

+ `GET /api/pages/{page_id}/stages` for the chain.
+ `GET /api/pages/{page_id}/stages/{stage_id}/artifact` for the
  artifact viewer panes (binary stream; for image stages it's a PNG;
  for `ocr` it's the words.json).

Writes:

+ Selecting a stage → populates Stage controls panel with the subset
  of `ResolvedPageConfig` fields relevant to that stage (a static map
  on the frontend). "Apply" PATCHes `page.config_overrides`, then
  fires `POST /api/pages/{page_id}/stages/{stage_id}/run`.
+ The stage chain rail listens on the page's job SSE stream for stage
  transitions and updates row status live.

Non-image stages (`find_content_edges` returns a 4-tuple,
`auto_detect_attrs` writes onto the page record) render as a small
numeric / textual artifact rather than an image preview.

`extract_illustrations` is a stage in the chain but its "artifact" is
the hi-res crop set; the existing illustration panel from
`specs/06-page-workbench.md` is the right viewer for it.

The split-creation tooling lives in this same view: a "Create split"
button enters bbox-drawing mode against the current selected stage's
artifact (typically `auto_detect_attrs` or `auto_deskew`); on commit,
`POST /api/pages/{page_id}/split` creates the children and the page
list redirects to the first child. "Reverse split" lives on each
child page's header.

---

## Migration story (M4)

Existing projects under `~/pgdp-projects/<id>/` have:

+ Source files at `source/<stem>.<ext>` ✅ (preserved verbatim).
+ Thumbnails at `thumbnails/<stem>.jpg` ✅.
+ Possibly cached proofing PNGs at the legacy
  `processed_image_key` / `pre_ocr_image_key` paths ✅.
+ OCR text + words at the legacy keys.
+ **No** `pages/<id>/stages/` tree.
+ `pages` rows with `processing_status` ∈ {pending, processing,
  complete, error}.

**Lazy-migrate on first access.** When the runner or workbench first
reads `page_stages` for `(project_id, page_id)` and finds zero rows:

1. Synthesise a `page_stages` row per stage. Status is derived from
   the legacy `processing_status`:
   + `complete` → mark every applicable stage `dirty` (because we
     don't have the per-stage artifacts on disk; the legacy outputs
     were never persisted as stage artifacts). The legacy
     `canvas_map`-equivalent file at the old `processed_image_key`
     stays in place — but its `page_stages` row is `dirty` because
     re-running the DAG from scratch is the only way to populate the
     intermediates the workbench needs.
   + `error` → mark every stage `failed` with the legacy
     `processing_error` recorded on the latest stage that had output.
   + `pending` / `processing` → all stages `not-run`.
2. `stage_version` is set to the current code's version (so we don't
   immediately mark the page dirty under "code changed underneath").
3. `config_hash` and `input_hash` are computed.
4. Write the rows in one transaction.

The user sees: when they open an old project after upgrade, the
workbench correctly shows every stage as `dirty` (or `failed` /
`not-run`). The page list still works — `processing_status` is
recomputed from the per-stage rolled-up status. To get the per-stage
artifact viewer populated, they click "Run all dirty stages on this
page" (or the project-level "Run dirty everywhere"). This is consistent
with "we never had those checkpoints before, and now we do."

A `pgdp-prep migrate-projects --force-rebuild` CLI affordance is added
for users who want to forcibly rebuild from scratch (clears all
existing artifacts and DB rows). Opt-in, never automatic.

---

## Open questions — Locked (2026-05-07)

The ten questions below are **locked** as of 2026-05-07; the body of
this spec describes the canonical behaviour. If a locked decision turns
out to be materially worse than its alternative during implementation,
surface it for re-evaluation rather than silently flipping.

| # | Decision | Spec section |
|---|---|---|
| Q1 | Stage-state persistence: normalised `page_stages` SQLite table. | §Persistence model > SQLite schema |
| Q1-followup | Source-of-truth (local mode): **dual-write with reconciliation**. Every stage write commits the on-disk file AND the DB row transactionally; reindex CLI heals drift. | §Persistence model > Dual-write reconciliation |
| Q2 | Dirty propagation: **eager** UPDATE cascade at write time. | §Dirty propagation |
| Q3 | Artifact persistence: **every intermediate, always.** No checkpoint-only mode; no `PGDP_FULL_STAGE_ARTIFACTS` switch. | §Persistence model |
| Q4 | Stage versioning: manual `STAGE_VERSIONS` integer registry per stage in M2. | §Stage versioning |
| Q5 | Backend collapse: unify into `STAGE_IMPL[stage_id][device]` registry; old `LocalBackend` / `CpuBackend` deleted by end of M5. | §Stage implementation registry |
| Q6 | Splits: **first-class sibling pages**, not config on `ocr_crop`. Children get full DAG state and per-stage workbench affordances. | §Splits as sibling pages |
| Q7 | `text_review`: gate stage; default ON; `awaiting_review` job state when `build_package` runs against unreviewed pages. | §`text_review` as gate stage |
| Q8 | Deferred-write executor: bounded executor + bounded queue. Default pool size = `min(cpu_count(), 4)`; queue cap = 4× pool size. Knob: `PGDP_STAGE_WRITE_POOL_SIZE` + `PGDP_STAGE_WRITE_QUEUE_CAP`. | §Memory-resident execution model > Deferred disk writes |
| Q9 | Deferred-write failure status: **always fail loudly.** Any write failure (intermediate or otherwise) → stage `status='failed'`. | §Memory-resident execution model > Deferred disk writes (and §Cross-references between Q3, Q8, Q9) |
| Q10 | Canonical in-memory artifact: **device-aware.** CPU = `numpy.ndarray + ImageMeta`; CUDA = `cupy.ndarray + ImageMeta`. Auto-bridging on stage-boundary type mismatch with debug logging. | §In-memory artifact type model |

---

## Migration order (cross-reference with `docs/08-roadmap.md` §P0.5)

+ **M1** — schema + DAG enumeration. `page_stages` table; split-related
  page columns; `core/pipeline/dag.py` with stage list + descendants();
  `pgdp-prep reindex` CLI; dual-write reconciler skeleton. No runner,
  no UI.
+ **M2** — per-page runner + dirty propagation. `STAGE_IMPL` registry
  introduced. Stage-version registry. Bounded write executor. Eager
  dirty cascade. New per-page-stage routes. Old endpoints become
  shims onto the new runner.
+ **M3** — workbench artifact viewer. Stage-chain rail; artifact
  viewer pane; stage controls panel; SSE stage-transition updates.
+ **M4** — migration of existing projects (lazy synthesis on first
  read; `migrate-projects --force-rebuild` CLI). Disk-cost callout in
  upgrade UI.
+ **M5** — project-level fan-out. New `JobType.project_run_*` values;
  the registry becomes the **only** path through stage execution
  (every old method becomes a shim). `awaiting_review` job state
  ships with the `build_package` gate.
+ **M6** — cleanup. Delete `LocalBackend` / `CpuBackend` classes;
  delete deprecated `JobType.batch_*` values; delete the
  `process_page_cpu` monolithic body (now an imperative composition
  of registry calls in a single helper for project-level CPU runs).
