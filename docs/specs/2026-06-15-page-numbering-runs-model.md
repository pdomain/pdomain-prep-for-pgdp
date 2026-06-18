---
status: draft (for CT review)
created: 2026-06-15
author: ConcaveTrillion
supersedes-parts-of: stage-registry-v2 numbering (assign_prefixes / compute_prefix_v2)
design-source: docs/plans/design_handoff_pgdp_app/final/page_order/ + statecharts/tool-page-order.yaml
---

# Page-numbering data model: align to the wireframe

## 1. Summary

The PGDP page-numbering model in the backend is a **range-based prefix computer**
(`assign_prefixes` + `compute_prefix_v2`: seq + section-letter + folio, driven by
`frontmatter/bodymatter/proof_*_idx0` config ranges). The authoritative design
(`final/page_order/`) specifies a richer **numbering-runs model**: ordered leaves
with a role (text/plate/blank/skip), grouped into editable **numbering runs** (style +
start mode), with **OCR-folio reconciliation** and explicit handling of the two blank
cases. The frontend `PageOrderTool` already implements this model in its XState machine —
but unbacked (runs aren't persisted; `ocrFolio` is faked from the prefix).

This spec defines expanding the **backend** data model + numbering engine to the design's
runs model, persisting runs, adding OCR-folio detection + reconciliation, and migrating off
the range-based prefix computer and the `plate_b/p/r` PageType split. It is the model that
makes "some blanks are numbered, others are not (plate blanks before/after)" expressible.

## 2. Motivation

A blank scan can be one of two fundamentally different things, and our model can't tell them apart:

- a **counted blank** — a blank leaf the printer still paginates (consumes a page number),
  e.g. a blank verso in the body;
- a **[Blank Page] marker** — the unnumbered blank leaf of an inserted plate (before/after
  the illustration), held *out* of the count but kept in scan order.

Today both can only be marked `blank` (which always consumes a folio) — so plate blanks are
numbered incorrectly. The design solves this cleanly: `role:blank` + **assigned to a run** =
counted; `role:blank` + **run:null** = marker. That requires a runs model the backend lacks.

## 3. Goals / non-goals

### Goals

- Persist a **numbering-runs** model (project-scoped) and per-leaf role/run/folio/flags.
- Numbering is **derived from runs** (style + start + order), not from config ranges.
- Distinguish **counted blank** vs **[Blank Page] marker**, and **plate** (unnumbered) leaves.
- Add **OCR-folio detection** + **reconciliation** (read vs computed) with flags + override.
- Wire the existing `PageOrderTool` frontend to **real persistence** (it already has the model).
- Migrate existing projects (ranges → runs; `plate_b/p/r` → `role:plate`) with no data loss.

### Non-goals (this spec)

- Re-OCR / detector changes beyond reading a printed folio number per page.
- Changing the export/zip filename convention (`<prefix>.png/.txt`) — only how the prefix is *derived*.
- Reworking the Source/Files intake UI beyond the `back`/`duplicate`/`inserted-kind` reconciliation (§7.4).

## 4. Current state (migrate FROM)

- **Numbering = config ranges + prefix computer.** `core/models.py:67-82`:
  `proof_start/end_idx0`, `frontmatter_start/end_idx0`, `bodymatter_start/end_idx0`,
  `frontmatter_page_nbr_start`, `bodymatter_page_nbr_start`, `cover_idx0`, `title_idx0`.
  `core/prefix.py::compute_prefix_v2` → `<seq><section-letter><folio>`;
  `_UNNUMBERED_TYPES = {plate_b, plate_p, plate_r, cover}`.
  `core/assign_prefixes.py` re-derives `prefix` + effective `ignore` on every config edit.
- **page_order stage** (`core/pipeline/steps/page_order.py`) materializes a flat naming
  manifest: `{version, pages:[{page_id, idx0, role(=page_type), prefix, export_name}], skip_ids}`.
- **PageRecord/PrepPageExtension numbering fields**: `prefix`, `ignore`, `manual_ignore`,
  `page_type` (PageType), `page_role` (back/duplicate). **No `ocr_folio` / detected printed number. No runs.**
- **Frontend `PageOrderTool`** already models: `leaves[]` (scan, role∈text/plate/blank/skip/cover,
  runId, folioLabel, ocrFolio, flags[], plateTag, prefix), `runs[]`, reconciliation, run CRUD,
  inspector overrides — but `ocrFolio` is read from `page.prefix` and **runs are not persisted**
  (statechart `persistRuns`/`persistLeaf` have no backend).

## 5. Target model (migrate TO) — from the wireframe

**Numbering run** (`final/page_order/pr-data.js:35-48`):
`{ id, label, style∈{roman-lower,roman-upper,arabic,alpha,none}, startMode∈{set,continue},
  start, step, role∈{text,plate,blank,skip}, span:[first,last]|null, count, lastNum, note }`.
User can **add / edit / split / merge / renumber** runs (drag a band boundary to split/merge;
a `continue` run inherits the prior run's last number; a `set` run restarts).

**Leaf** (`pr-data.js:69-76`):
`{ scan(idx0), role, folio(OCR-read|null), label(computed), run|null, flag, tag(plate caption),
  note, boundary }`. `role ∈ {text, plate, blank, skip}`.

**The two blanks** (`page-order-unified.jsx:77-93`, `run-leaf.jsx:296-304`):

- **counted blank** = `role:blank, run:<a run>, flag:countedBlank` → consumes a page number.
- **[Blank Page] marker** = `role:blank, run:null, flag:marker` → held out of the count, borrows
  the neighbour's number so it sorts in place. Toggled by assigning/clearing the run in the inspector.

**Plate** = `role:plate, run:'plates'(interleaved, span:null), flag:unnumbered, tag:'Plate VIII'`;
its facing blank = the marker above. **Side (recto/verso, before/after) is narrative `note` only**,
derived in the inspector (`side = role==='blank' ? 'verso' : 'recto'`), **not a stored field**.

**Folio reconciliation** (`statecharts/tool-page-order.yaml`, `po-data.js:11-18`):
`computeLabels` (pure: label per leaf from run style+order) then `reconcile` (pure: flags from
computed-vs-OCR) run after every edit. Flags: `outOfSequence, gap, duplicate, misread,
missingNumber, nonNumeric, unnumbered, marker, countedBlank, renumber, continue`. The inspector
lets the user **override** a computed label; advance is guarded by `sequenceClean`
(no out-of-sequence / duplicates).

**Statechart events** (`tool-page-order.yaml`): `FOLIO_PUSH/FOLIOS_DONE` (OCR folios stream in),
`ADD_RUN/CONFIRM_ADD/EDIT_RUN/SET_STYLE/SET_START/REMOVE_RUN(mergeUp)`, `SET_ROLE/SET_RUN`,
`OVERRIDE_FOLIO`, `SET_PLATE_TAG`, `DROP(reorder)`, `SET_NAME_PART`, `CONFIRM_ADVANCE`.

## 6. Design decisions (recommendations — confirm in review)

- **D1 — Two layers, not one.** Keep Source `page_type`/file-state ("what is this scan":
  page/cover/back/blank/duplicate/inserted) AND add a Page-Order **leaf role** ("how is it numbered":
  text/plate/blank/skip) + run assignment. Source seeds an initial leaf role; Page Order refines it.
  *Rationale:* the design separates the two stages; conflating them is what blocks the blank distinction.
- **D2 — Counted vs marker = run assignment.** Model exactly as the design: `role:blank` +
  run → counted; `role:blank` + `run:null` → marker. No separate boolean. `countedBlank`/`marker`
  flags are *derived*. *Rationale:* one mechanism, matches the wireframe, no redundant state.
- **D3 — Numbering engine = runs, not ranges.** Replace `compute_prefix_v2`'s range logic with a
  runs-based `compute_labels(leaves, runs)` (skip unnumbered roles + markers; apply style+start+step;
  `continue` resolves from prior run's `lastNum`). The export prefix is derived from the computed
  label + role. Config ranges (`frontmatter/bodymatter/proof_*`) become a **migration seed only** (§9).
- **D4 — Plate is a role, drop `plate_b/p/r`.** Migrate `plate_b/p/r` → `role:plate`. Side
  (recto/verso) is narrative `note`, not a stored enum (per the design). *Rationale:* the b/p/r
  split encodes side in the type; the design keeps a single plate role. If a stored side is later
  needed for the filename suffix, add an optional `plate_side` field — flagged as open question OQ-2.
- **D5 — Persist runs as a project-scoped entity + events.** New `numbering_runs` on the project
  aggregate; event-sourced (dual-write contract). Frontend `persistRuns/persistLeaf` get real routes.
- **D6 — OCR folio is new.** Add `ocr_folio: str | None` per page, populated by a folio-reading
  step (the `readingFolios` phase). Reconciliation flags are derived (may be cached, not source-of-truth).

## 7. Proposed changes

### 7.1 Backend data model

- **Project aggregate**: `numbering_runs: list[NumberingRun]` where
  `NumberingRun = {id, label, style, start_mode, start, step, role, span|None, note}`.
- **PageRecord / PrepPageExtension** add: `leaf_role: LeafRole` (text/plate/blank/skip),
  `run_id: str | None`, `ocr_folio: str | None`, `label_override: str | None`, `plate_tag: str | None`.
  Keep `page_type`/`page_role` (Source layer); `prefix`/`export_name` become **derived** outputs.
- **Derived (not stored as source-of-truth)**: `label` (computed), `flags[]`, effective `prefix`.

### 7.2 Numbering engine

- New `core/numbering.py::compute_labels(leaves, runs) -> {idx0: Label}` (pure) + `reconcile(...)` (pure),
  mirroring the statechart's `computeLabels`/`reconcile`. `page_order` stage materializes the manifest
  from these (replacing the range-based path). `assign_prefixes`/`compute_prefix_v2` retire after migration
  (kept temporarily behind the migration seed).

### 7.3 API + events (event-sourced)

- Runs CRUD: `GET/PUT /projects/{id}/numbering-runs` (+ granular add/edit/remove) → events
  `NumberingRunsChanged`. Leaf edits: extend `PATCH /pages/{idx0}` with `leaf_role`, `run_id`,
  `label_override`, `plate_tag` → events `LeafRoleSet`, `LeafRunSet`, `FolioOverridden`, `PlateTagSet`.
  Folio read: `FOLIO_PUSH` via the existing per-page SSE channel during folio-reading.
- All mutations append events (dual-write); `pgdp-prep reindex` unaffected in shape.

### 7.4 Source reconciliation (smaller)

- Make `back`, `duplicate`, and `inserted` (+ `kind`: missing/blank/errata/manual) **first-class**
  rather than `skip`+`page_role`. Confirm whether `back`/`duplicate` should map to leaf role `skip`
  (dropped) by default. (Open question OQ-3.)

### 7.5 Frontend

- Wire `PageOrderTool` `persistRuns/persistLeaf/persistOrder/persistNaming` + `FOLIO_PUSH` to the
  new routes/SSE. Remove the `ocrFolio = page.prefix` stopgap. The machine model already matches —
  this is mostly service wiring + replacing fixtures with the real wire shape.

## 8. Migration (breaking, seeded — no data loss)

1. **Ranges → runs:** seed runs from config: `frontmatter` range → a `roman-lower` run starting at
   `frontmatter_page_nbr_start`; `bodymatter` range → an `arabic` run starting at `bodymatter_page_nbr_start`;
   `cover_idx0`/out-of-proof → `skip`. Pages keep their computed labels (no renumber on migrate).
2. **page_type → leaf_role:** `normal→text`, `plate_b/p/r→plate`, `blank→blank` (assigned to its
   range's run = counted by default; the user demotes plate-facing blanks to markers), `skip→skip`,
   `cover→skip` (role) with Source `page_type=cover` retained.
3. Stamp a registry/model version; mismatched old projects get the existing "re-ingest/re-derive" path.
4. Verify migrated manifests are byte-stable vs the old range-based manifest for representative books
   (golden test) — any diff is a migration bug.

## 9. Phasing

- **P1 — backend runs model + engine + migration** (no UX change): NumberingRun entity + events,
  leaf fields, `compute_labels`/`reconcile`, manifest from runs, ranges→runs seed, golden byte-stability test.
- **P2 — wire frontend PageOrderTool to real persistence** (runs CRUD, leaf role/run, override) — the UI exists.
- **P3 — counted-blank vs marker + plate** end-to-end (the headline fix) incl. inspector toggle + naming.
- **P4 — OCR folio detection** (`readingFolios`/`FOLIO_PUSH`) + persisted reconciliation flags + `sequenceClean` gate.
- **P5 — Source first-class back/duplicate/inserted-kind** (§7.4).

Each phase ends `make ci` green + **live-verified on a real book** (the lesson from the prior arc:
mocked tests hid severed chains — cross the seam and run the app).

## 10. Testing

- Pure-fn unit tests for `compute_labels`/`reconcile` per role/flag (counted blank consumes; marker
  doesn't; plate unnumbered; continue/renumber; roman/arabic/alpha/none).
- Round-trip + event-append for runs CRUD and leaf edits.
- Migration golden test (ranges→runs byte-stable manifest).
- Live: mark a plate's facing blank as a marker → it loses its number, neighbours unchanged; a counted
  blank keeps its number; export filenames correct.

## 11. Open questions (for CT)

- **OQ-1:** Keep config ranges (`frontmatter/bodymatter/proof_*`) as a *convenience seed* for runs, or
  retire them entirely once runs exist? (Recommend: keep as seed + a "rebuild runs from ranges" action.)
- **OQ-2:** Do we ever need a **stored** plate side (recto/verso) for the filename suffix, or is the
  design's narrative-note-only sufficient? (Affects whether `plate_b/r` info is truly discardable.)
- **OQ-3:** Should Source `back`/`duplicate` map to leaf role `skip` by default, or `text`-but-excluded?
- **OQ-4:** OCR folio detection source — a new lightweight stage, or fold into existing OCR output?
- **OQ-5:** Is the registry-version bump + re-derive acceptable for existing local projects (no in-place migration tool)?
