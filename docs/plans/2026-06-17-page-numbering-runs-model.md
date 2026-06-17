---
title: Page-numbering Runs Model — implementation plan (P1–P3)
status: ready
created: 2026-06-17
author: ConcaveTrillion
spec: docs/specs/2026-06-15-page-numbering-runs-model.md
design-source: docs/plans/design_handoff_pgdp_app/final/page_order/ + statecharts/tool-page-order.yaml
repo: pdomain-prep-for-pgdp
---

# Page-numbering Runs Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to execute this plan. Dispatch one subagent per task, in order; each task is self-contained (failing test → run-fails → minimal impl → run-passes → commit). Do not batch tasks across milestones. Run `make ci AI=1` at each milestone gate and live-verify on a real book before advancing.

**Goal:** Replace the range-based page-prefix computer with a persisted numbering-runs model so a blank leaf can be either a counted blank (keeps its folio) or a `[Blank Page]` marker (held out of the count), and wire the existing `PageOrderTool` frontend to that real backend.

**Architecture:** A project-scoped `numbering_runs` entity (event-sourced on `PrepProjectAggregate`, dual-write to a JSON artifact) plus new per-leaf fields (`leaf_role`, `run_id`, `label_override`, `plate_tag`, `plate_side`, nullable `ocr_folio`) on `PrepPageExtension`. A pure `core/numbering.py` (`compute_labels` + `reconcile`) mirrors the statechart's pure functions and feeds the `page_order` manifest. A one-shot ranges→runs migration runs on the existing registry-version re-derive path; afterward the range config and `compute_prefix_v2` are deleted.

**Tech Stack:** Python 3.13 / FastAPI / Pydantic v2 / eventsourcing.sqlite (`PrepProjectAggregate`) on the backend; React 19 + XState v5 + Vite on the frontend; pytest (`-n auto`, TDD-first for pure functions) and Playwright (`make e2e`) for verification.

---

## Out of scope / follow-up

This plan covers **P1–P3 only**. Two spec phases are deferred to a follow-up plan:

- **P4 — OCR-folio detection** (the `readingFolios` / `FOLIO_PUSH` reading stage + persisted reconciliation flags + the `sequenceClean` advance gate that depends on real folios). *Why deferred:* it needs a new folio-reading stage (OQ-4 unresolved — new lightweight stage vs. fold into OCR) and detector work in `pdomain-book-tools`, which is out of this repo's scope. P1 **adds** the `ocr_folio` field as nullable so the schema is forward-stable, but nothing populates it; it is `None` throughout P1–P3.
- **P5 — Source first-class `back`/`duplicate`/`inserted-kind`** (spec §7.4, OQ-3). *Why deferred:* it reworks the Source/Files intake layer, which is orthogonal to the numbering fix. P1 **preserves** `page_role` (`back`/`duplicate`) untouched on the Source layer — migration must not lose it.

---

## File Structure

Files created / modified across P1–P3, one responsibility each.

### Backend — model

| File | Responsibility |
|------|----------------|
| `src/pdomain_prep_for_pgdp/core/models.py` | Add `LeafRole` enum, `RunStyle` enum, `StartMode` enum, `PlateSide` enum, `NumberingRun` model, `NumberingRunsArtifact` model. Add range-config DELETION (P1.9 — after migration). |
| `src/pdomain_prep_for_pgdp/core/prep_extension.py` | Add per-leaf fields: `leaf_role`, `run_id`, `label_override`, `plate_tag`, `plate_side`, `ocr_folio` (all nullable / defaulted). |

### Backend — numbering engine (new)

| File | Responsibility |
|------|----------------|
| `src/pdomain_prep_for_pgdp/core/numbering.py` | **New.** Pure `compute_labels(leaves, runs) -> dict[int, Label]` and `reconcile(labels, leaves) -> dict[int, list[str]]`. Mirrors the statechart `computeLabels`/`reconcile`. No I/O. |
| `src/pdomain_prep_for_pgdp/core/numbering_migration.py` | **New.** Pure `seed_runs_from_ranges(config, pages) -> (runs, leaf_assignments)` and `page_type_to_leaf_role(pt) -> (LeafRole, PlateSide \| None)`. The one place that still reads the old range config. |

### Backend — page_order stage

| File | Responsibility |
|------|----------------|
| `src/pdomain_prep_for_pgdp/core/pipeline/steps/page_order.py` | Bump `MANIFEST_VERSION` to 2; `materialize_naming_manifest` now derives prefixes from `compute_labels` over runs (not `compute_prefix_v2`). Manifest entry gains `label` + `run_id`. |

### Backend — persistence + events

| File | Responsibility |
|------|----------------|
| `src/pdomain_prep_for_pgdp/core/pipeline/prep_aggregate.py` | Add `NumberingRunsChanged`, `LeafRoleSet`, `LeafRunSet`, `FolioOverridden`, `PlateTagSet` events + `record_*` methods. |
| `src/pdomain_prep_for_pgdp/core/numbering_store.py` | **New.** `load_runs` / `save_runs` for the project-scoped runs artifact (JSON under `projects/{id}/stages/page_order/runs.json`), the dual-write counterpart to the event. |

### Backend — routes

| File | Responsibility |
|------|----------------|
| `src/pdomain_prep_for_pgdp/api/data/page_order_runs.py` | **New router.** `GET/PUT /projects/{id}/project-stages/page_order/runs` → `NumberingRunsChanged`. |
| `src/pdomain_prep_for_pgdp/api/data/pages.py` | Extend `UpdatePageRequest` + `update_page` with `leaf_role`, `run_id`, `label_override`, `plate_tag`, `plate_side`; emit the four leaf events; recompute prefixes via runs. |
| `src/pdomain_prep_for_pgdp/api/data/__init__.py` (or wherever routers mount) | Mount the new `page_order_runs` router. |

### Backend — migration wiring

| File | Responsibility |
|------|----------------|
| `src/pdomain_prep_for_pgdp/core/pipeline/registry_version.py` | Bump `REGISTRY_VERSION` to 3; the existing 409 re-derive path triggers the runs migration. |
| `src/pdomain_prep_for_pgdp/core/numbering_migration.py` | (above) — invoked by the re-derive path on version bump. |

### Frontend

| File | Responsibility |
|------|----------------|
| `frontend/src/services/tools/pageOrderTool.ts` | Wire `persistRuns`/`persistLeaf` to the real routes; map `LeafRole`↔`leaf_role`; drop the `ocrFolio = page.prefix` stopgap (use real `ocr_folio`); `fetchFolios` reads runs + leaf fields. |
| `frontend/src/api/types.ts` | Regenerated from `/openapi.json` (`make openapi-export`) — do not hand-edit. |
| `frontend/src/pages/pipeline/tools/PageOrderTool.tsx` (or the surface component under `frontend/src/pages/pipeline/`) | Add the `data-testid` contract the e2e suite drives (runs band, inspector role/run toggle, folio override). |

### Tests

| File | Responsibility |
|------|----------------|
| `tests/test_numbering_compute_labels.py` | **New.** Pure-fn unit tests for `compute_labels` (counted blank consumes, marker doesn't, plate unnumbered, roman/arabic/none, continue). |
| `tests/test_numbering_reconcile.py` | **New.** Pure-fn unit tests for `reconcile` (duplicate, out-of-sequence flags). |
| `tests/test_numbering_migration.py` | **New.** ranges→runs seed + `page_type_to_leaf_role` mapping (incl. `plate_b/p/r`→`plate_side`) + golden byte-stability. |
| `tests/test_page_order_manifest_runs.py` | **New.** `materialize_naming_manifest` derives from runs; version-2 manifest shape. |
| `tests/test_page_order_runs_route.py` | **New.** `GET/PUT runs` round-trip + `NumberingRunsChanged` event append. |
| `tests/test_update_page_leaf_fields.py` | **New.** `PATCH /pages/{idx0}` with `leaf_role`/`run_id`/`label_override`/`plate_tag` + events. |
| `frontend/src/services/tools/pageOrderTool.persistence.test.ts` | **New.** persistRuns/persistLeaf hit the real routes with the correct wire shape. |
| `tests/e2e/test_page_order_runs_browser.py` | **New.** Playwright: app loads, headline marker happy-path, React-Router route, export filename. |

---

## Tasks

## Milestone P1 — backend runs model + engine + migration

No UX change. Output: runs persist, labels derive from runs, existing projects migrate byte-stable.

### Task P1.1 — Add numbering enums + `NumberingRun` model

Stub-shaped (model additions) — no test-first required; the validator is exercised by P1.2+.

**Files:**
- Modify `src/pdomain_prep_for_pgdp/core/models.py` (after `PageType`, ~line 130)

**Steps:**
- [ ] Add the enums and run model after `PageType`:
  ```python
  class LeafRole(str, Enum):
      text = "text"
      plate = "plate"
      blank = "blank"
      skip = "skip"
      cover = "cover"


  class RunStyle(str, Enum):
      roman_lower = "roman-lower"
      roman_upper = "roman-upper"
      arabic = "arabic"
      alpha = "alpha"
      none = "none"


  class StartMode(str, Enum):
      set = "set"
      continue_ = "continue"  # pyright: ignore[reportAssignmentType]


  class PlateSide(str, Enum):
      recto = "recto"
      verso = "verso"


  class NumberingRun(ApiModel):
      """One numbering run — design-source: final/page_order/pr-data.js:41-48."""

      id: str
      label: str = ""
      style: RunStyle = RunStyle.arabic
      start_mode: StartMode = StartMode.set
      start: int = 1
      step: int = 1
      role: LeafRole = LeafRole.text
      span: tuple[int, int] | None = None  # [first_scan, last_scan] inclusive, or None for interleaved (plates)
      note: str = ""


  class NumberingRunsArtifact(ApiModel):
      """Project-scoped runs artifact (PUT body + stored JSON)."""

      version: int = 1
      runs: list[NumberingRun] = Field(default_factory=list)
  ```
- [ ] `StartMode.continue_` serializes to `"continue"`: add a model-level note; the enum *value* is `"continue"`, the Python attribute is `continue_` (reserved word).
- [ ] Commit:
  ```sh
  git commit -m "feat(numbering): add LeafRole/RunStyle/StartMode/PlateSide enums + NumberingRun model"
  ```

### Task P1.2 — Add per-leaf numbering fields to `PrepPageExtension`

Stub-shaped (field additions). The fields are nullable / defaulted so existing extensions load unchanged.

**Files:**
- Modify `src/pdomain_prep_for_pgdp/core/prep_extension.py` (in the `# ── Page classification ──` block, ~line 58-67)

**Steps:**
- [ ] Import `LeafRole`, `PlateSide` from `core.models` (extend the existing import block, line 16-25).
- [ ] Add after `page_role` (line 67):
  ```python
  # ── Numbering-runs model (P1) ───────────────────────────────────────
  leaf_role: LeafRole | None = None
  """Page-Order leaf role (text/plate/blank/skip/cover). None = not yet
  classified by Page Order; falls back to a page_type-derived role at read
  time. Distinct from page_type, which is the Source layer."""

  run_id: str | None = None
  """ID of the NumberingRun this leaf belongs to. None for markers
  (role:blank + run:None = [Blank Page] marker), plates, and skips."""

  label_override: str | None = None
  """User-supplied label that overrides the computed folio label. None =
  use the computed label."""

  plate_tag: str | None = None
  """Free-text plate caption (e.g. "Plate VIII"). None for non-plate leaves."""

  plate_side: PlateSide | None = None
  """Recto/verso for a plate or its facing blank. Migrated from
  plate_b/plate_r → verso, plate_p → recto. None for non-plate leaves."""

  ocr_folio: str | None = None
  """Printed folio read by OCR. P4-populated; None throughout P1-P3."""
  ```
- [ ] Commit:
  ```sh
  git commit -m "feat(numbering): add leaf_role/run_id/label_override/plate_tag/plate_side/ocr_folio to PrepPageExtension"
  ```

### Task P1.3 — Pure `compute_labels` (TDD-first)

The heart of the stage. Test-first per repo TDD-first rule.

**Files:**
- Create `tests/test_numbering_compute_labels.py`
- Create `src/pdomain_prep_for_pgdp/core/numbering.py`

**Steps:**
- [ ] Write the failing test. A "leaf" is `(scan, leaf_role, run_id)`; a run is a `NumberingRun`. `compute_labels` returns `{scan: label_str}` (empty string for unnumbered/marker, per `_UNNUMBERED`). Mirror the statechart: a `role:blank` + `run:None` leaf is a marker → `"[Blank Page]"`; a `role:blank` + run → counted (consumes a number); a `role:plate` → `"—"`; a `role:text` + run → run-styled number; `continue` runs pick up the prior run's last number.
  ```python
  from pdomain_prep_for_pgdp.core.models import LeafRole, NumberingRun, RunStyle, StartMode
  from pdomain_prep_for_pgdp.core.numbering import Leaf, compute_labels


  def _leaf(scan, role, run_id):
      return Leaf(scan=scan, leaf_role=role, run_id=run_id)


  def test_text_run_arabic_numbers_sequentially():
      run = NumberingRun(id="body", style=RunStyle.arabic, start_mode=StartMode.set, start=1, step=1, role=LeafRole.text)
      leaves = [_leaf(0, LeafRole.text, "body"), _leaf(1, LeafRole.text, "body"), _leaf(2, LeafRole.text, "body")]
      assert compute_labels(leaves, [run]) == {0: "1", 1: "2", 2: "3"}


  def test_counted_blank_consumes_a_number_marker_does_not():
      run = NumberingRun(id="body", style=RunStyle.arabic, start=1, step=1, role=LeafRole.text)
      leaves = [
          _leaf(0, LeafRole.text, "body"),       # 1
          _leaf(1, LeafRole.blank, "body"),      # counted -> 2
          _leaf(2, LeafRole.blank, None),        # marker -> [Blank Page], no number
          _leaf(3, LeafRole.text, "body"),       # 3 (marker did NOT consume)
      ]
      labels = compute_labels(leaves, [run])
      assert labels[0] == "1"
      assert labels[1] == "2"
      assert labels[2] == "[Blank Page]"
      assert labels[3] == "3"


  def test_plate_is_unnumbered():
      run = NumberingRun(id="body", style=RunStyle.arabic, start=1, step=1, role=LeafRole.text)
      leaves = [_leaf(0, LeafRole.text, "body"), _leaf(1, LeafRole.plate, None), _leaf(2, LeafRole.text, "body")]
      labels = compute_labels(leaves, [run])
      assert labels[1] == "—"
      assert labels[2] == "2"  # plate did not consume the count


  def test_roman_lower_style():
      run = NumberingRun(id="front", style=RunStyle.roman_lower, start=1, step=1, role=LeafRole.text)
      leaves = [_leaf(0, LeafRole.text, "front"), _leaf(1, LeafRole.text, "front")]
      assert compute_labels(leaves, [run]) == {0: "i", 1: "ii"}


  def test_continue_run_picks_up_prior_last_number():
      body = NumberingRun(id="body", style=RunStyle.arabic, start_mode=StartMode.set, start=1, step=1, role=LeafRole.text)
      appendix = NumberingRun(id="appendix", style=RunStyle.arabic, start_mode=StartMode.continue_, start=1, step=1, role=LeafRole.text)
      leaves = [
          _leaf(0, LeafRole.text, "body"),       # 1
          _leaf(1, LeafRole.text, "body"),       # 2
          _leaf(2, LeafRole.text, "appendix"),   # continues -> 3
      ]
      assert compute_labels(leaves, [body, appendix]) == {0: "1", 1: "2", 2: "3"}
  ```
- [ ] Run it; expect failure (module does not exist):
  ```sh
  uv run pytest tests/test_numbering_compute_labels.py -q
  # ModuleNotFoundError: No module named 'pdomain_prep_for_pgdp.core.numbering'
  ```
- [ ] Minimal implementation:
  ```python
  """Pure numbering-runs engine — mirrors statechart computeLabels/reconcile.

  design-source: docs/plans/design_handoff_pgdp_app/statecharts/tool-page-order.yaml
  (actions.computeLabels / actions.reconcile) and final/page_order/pr-data.js.
  No I/O — labels are always derived, never stored truth.
  """

  from __future__ import annotations

  from dataclasses import dataclass

  from pdomain_prep_for_pgdp.core.models import LeafRole, NumberingRun, RunStyle, StartMode

  MARKER = "[Blank Page]"
  UNNUMBERED = "—"

  _ROMAN = [
      (1000, "m"), (900, "cm"), (500, "d"), (400, "cd"), (100, "c"),
      (90, "xc"), (50, "l"), (40, "xl"), (10, "x"), (9, "ix"),
      (5, "v"), (4, "iv"), (1, "i"),
  ]


  def _to_roman(n: int) -> str:
      if n <= 0:
          return str(n)
      out, rem = "", n
      for val, sym in _ROMAN:
          while rem >= val:
              out += sym
              rem -= val
      return out


  def _style_label(style: RunStyle, n: int) -> str:
      if style is RunStyle.roman_lower:
          return _to_roman(n)
      if style is RunStyle.roman_upper:
          return _to_roman(n).upper()
      if style is RunStyle.arabic:
          return str(n)
      if style is RunStyle.alpha:
          return chr(ord("A") + (n - 1)) if 1 <= n <= 26 else str(n)
      return UNNUMBERED  # RunStyle.none


  @dataclass
  class Leaf:
      """Minimal numbering input — scan index, role, run assignment."""

      scan: int
      leaf_role: LeafRole
      run_id: str | None


  def compute_labels(leaves: list[Leaf], runs: list[NumberingRun]) -> dict[int, str]:
      """Compute the folio label per leaf from runs + roles + order.

      A leaf consumes a number iff it is assigned to a run AND its role is
      countable (text or blank). A blank with run:None is a [Blank Page]
      marker; a plate is unnumbered ("—"); a skip/cover with run:None has
      no label ("").
      """
      runs_by_id = {r.id: r for r in runs}
      # Resolve each run's effective start (continue picks up prior run's last).
      counters: dict[str, int] = {}
      last_number: dict[str, int] = {}
      labels: dict[int, str] = {}

      def effective_start(run: NumberingRun) -> int:
          if run.start_mode is StartMode.set:
              return run.start
          # continue: nearest preceding numbered run's last number + step
          for prev in reversed(runs[: runs.index(run)]):
              if prev.style is not RunStyle.none and prev.id in last_number:
                  return last_number[prev.id] + run.step
          return run.start

      for leaf in leaves:
          run = runs_by_id.get(leaf.run_id) if leaf.run_id else None
          if leaf.leaf_role is LeafRole.plate:
              labels[leaf.scan] = UNNUMBERED
              continue
          if run is None:
              labels[leaf.scan] = MARKER if leaf.leaf_role is LeafRole.blank else ""
              continue
          count = counters.get(run.id, 0)
          n = effective_start(run) + count * run.step
          counters[run.id] = count + 1
          last_number[run.id] = n
          labels[leaf.scan] = _style_label(run.style, n)

      return labels
  ```
- [ ] Run it; expect pass:
  ```sh
  uv run pytest tests/test_numbering_compute_labels.py -q   # 5 passed
  ```
- [ ] Commit:
  ```sh
  git commit -m "feat(numbering): pure compute_labels engine (counted blank vs marker vs plate)"
  ```

### Task P1.4 — Pure `reconcile` (TDD-first)

**Files:**
- Create `tests/test_numbering_reconcile.py`
- Modify `src/pdomain_prep_for_pgdp/core/numbering.py`

**Steps:**
- [ ] Write the failing test. `reconcile(labels, leaves)` returns `{scan: [flags]}`. Flag a duplicate computed label; flag `out_of_sequence` when a leaf's `ocr_folio` is present and differs from its computed label. Markers/unnumbered are not flagged.
  ```python
  from pdomain_prep_for_pgdp.core.models import LeafRole
  from pdomain_prep_for_pgdp.core.numbering import Leaf, reconcile


  def _leaf(scan, role, run_id, ocr=None):
      lf = Leaf(scan=scan, leaf_role=role, run_id=run_id)
      lf.ocr_folio = ocr
      return lf


  def test_duplicate_label_flagged():
      labels = {0: "1", 1: "1"}
      leaves = [_leaf(0, LeafRole.text, "b"), _leaf(1, LeafRole.text, "b")]
      flags = reconcile(labels, leaves)
      assert "duplicate" in flags[1]
      assert "duplicate" not in flags[0]


  def test_ocr_mismatch_flagged_out_of_sequence():
      labels = {0: "1"}
      leaves = [_leaf(0, LeafRole.text, "b", ocr="7")]
      assert "out_of_sequence" in reconcile(labels, leaves)[0]


  def test_marker_not_flagged():
      labels = {0: "[Blank Page]"}
      leaves = [_leaf(0, LeafRole.blank, None)]
      assert reconcile(labels, leaves)[0] == []
  ```
- [ ] Add `ocr_folio: str | None = None` to the `Leaf` dataclass (default field) so the test's `lf.ocr_folio = ocr` is typed.
- [ ] Run it; expect failure (`reconcile` undefined).
- [ ] Minimal implementation appended to `numbering.py`:
  ```python
  def reconcile(labels: dict[int, str], leaves: list[Leaf]) -> dict[int, list[str]]:
      """Derive reconciliation flags from computed labels vs OCR folios.

      Flags: ``duplicate`` (same computed number appears twice),
      ``out_of_sequence`` (OCR-read folio disagrees with the computed label).
      Markers ("[Blank Page]") and unnumbered ("—"/"") are never flagged.
      """
      seen: dict[str, int] = {}
      flags: dict[int, list[str]] = {}
      for leaf in leaves:
          lf_flags: list[str] = []
          computed = labels.get(leaf.scan, "")
          if computed and computed not in (MARKER, UNNUMBERED):
              if computed in seen:
                  lf_flags.append("duplicate")
              else:
                  seen[computed] = leaf.scan
              ocr = getattr(leaf, "ocr_folio", None)
              if ocr and ocr != computed:
                  lf_flags.append("out_of_sequence")
          flags[leaf.scan] = lf_flags
      return flags
  ```
  Add `ocr_folio: str | None = None` as a dataclass field on `Leaf` (so `getattr` is unnecessary, but keep it defensive for callers that omit it).
- [ ] Run it; expect pass.
- [ ] Commit:
  ```sh
  git commit -m "feat(numbering): pure reconcile (duplicate + out_of_sequence flags)"
  ```

### Task P1.5 — `page_type_to_leaf_role` mapping (TDD-first)

The migration's role/side mapping. Test-first — the `plate_b/p/r`→`plate_side` mapping is load-bearing and must be pinned.

**Files:**
- Create `tests/test_numbering_migration.py` (mapping tests first; seed tests in P1.6)
- Create `src/pdomain_prep_for_pgdp/core/numbering_migration.py`

**Mapping decision (read from code, stated explicitly):** `config_resolver.py:98,111` groups `plate_b`/`plate_r` with `blank` (no OCR, blank proof synthesised) while `plate_p` is the actual plate image. The wireframe derives `side = role==='blank' ? 'verso' : 'recto'` (`run-leaf.jsx:224`). Therefore:
- `plate_p` → `(LeafRole.plate, PlateSide.recto)` — the illustration leaf.
- `plate_b` → `(LeafRole.plate, PlateSide.verso)` — facing blank *before* the plate.
- `plate_r` → `(LeafRole.plate, PlateSide.verso)` — facing blank *after* (rear of) the plate.
- `normal` → `(LeafRole.text, None)`, `blank` → `(LeafRole.blank, None)`, `skip` → `(LeafRole.skip, None)`, `cover` → `(LeafRole.cover, None)`.

**Steps:**
- [ ] Write the failing test:
  ```python
  import pytest

  from pdomain_prep_for_pgdp.core.models import LeafRole, PageType, PlateSide
  from pdomain_prep_for_pgdp.core.numbering_migration import page_type_to_leaf_role


  @pytest.mark.parametrize(
      ("pt", "role", "side"),
      [
          (PageType.normal, LeafRole.text, None),
          (PageType.blank, LeafRole.blank, None),
          (PageType.skip, LeafRole.skip, None),
          (PageType.cover, LeafRole.cover, None),
          (PageType.plate_p, LeafRole.plate, PlateSide.recto),
          (PageType.plate_b, LeafRole.plate, PlateSide.verso),
          (PageType.plate_r, LeafRole.plate, PlateSide.verso),
      ],
  )
  def test_page_type_to_leaf_role(pt, role, side):
      assert page_type_to_leaf_role(pt) == (role, side)
  ```
- [ ] Run it; expect failure (module missing).
- [ ] Minimal implementation:
  ```python
  """ranges→runs migration helpers (the one place that reads old range config).

  Invoked by the registry-version re-derive path on the v2→v3 bump.
  """

  from __future__ import annotations

  from pdomain_prep_for_pgdp.core.models import LeafRole, PageType, PlateSide

  _ROLE_MAP: dict[PageType, tuple[LeafRole, PlateSide | None]] = {
      PageType.normal: (LeafRole.text, None),
      PageType.blank: (LeafRole.blank, None),
      PageType.skip: (LeafRole.skip, None),
      PageType.cover: (LeafRole.cover, None),
      PageType.plate_p: (LeafRole.plate, PlateSide.recto),
      PageType.plate_b: (LeafRole.plate, PlateSide.verso),
      PageType.plate_r: (LeafRole.plate, PlateSide.verso),
  }


  def page_type_to_leaf_role(pt: PageType) -> tuple[LeafRole, PlateSide | None]:
      """Map a Source-layer PageType to a Page-Order leaf role + plate side."""
      return _ROLE_MAP[pt]
  ```
- [ ] Run it; expect pass.
- [ ] Commit:
  ```sh
  git commit -m "feat(numbering): page_type->leaf_role mapping (plate_b/r->verso, plate_p->recto)"
  ```

### Task P1.6 — `seed_runs_from_ranges` (TDD-first)

Seeds runs from the old `frontmatter`/`bodymatter` config. This is the last reader of the range config.

**Files:**
- Modify `tests/test_numbering_migration.py`
- Modify `src/pdomain_prep_for_pgdp/core/numbering_migration.py`

**Steps:**
- [ ] Write the failing test. `seed_runs_from_ranges(config, pages)` returns `(runs, {scan: run_id})`. Frontmatter range → a `roman-lower` run starting at `frontmatter_page_nbr_start`; bodymatter → an `arabic` run at `bodymatter_page_nbr_start`; out-of-proof / cover → `skip` (no run). Pages keep their computed labels (no renumber on migrate).
  ```python
  from pdomain_prep_for_pgdp.core.models import PageType, ProjectConfig, RunStyle
  from pdomain_prep_for_pgdp.core.numbering_migration import seed_runs_from_ranges


  def _cfg(**kw):
      base = dict(
          book_name="b", source_uri="u",
          proof_start_idx0=0, proof_end_idx0=5,
          frontmatter_start_idx0=0, frontmatter_end_idx0=1, frontmatter_page_nbr_start=1,
          bodymatter_start_idx0=2, bodymatter_end_idx0=5, bodymatter_page_nbr_start=1,
      )
      base.update(kw)
      return ProjectConfig(**base)


  def test_seed_two_runs_front_roman_body_arabic():
      cfg = _cfg()
      page_types = {0: PageType.normal, 1: PageType.normal, 2: PageType.normal,
                    3: PageType.normal, 4: PageType.normal, 5: PageType.normal}
      runs, assign = seed_runs_from_ranges(cfg, page_types)
      front = next(r for r in runs if r.style is RunStyle.roman_lower)
      body = next(r for r in runs if r.style is RunStyle.arabic)
      assert front.start == 1 and body.start == 1
      # frontmatter scans assigned to the roman run, body scans to arabic
      assert assign[0] == front.id and assign[1] == front.id
      assert assign[2] == body.id and assign[5] == body.id


  def test_skip_and_cover_get_no_run():
      cfg = _cfg()
      page_types = {0: PageType.cover, 1: PageType.normal, 2: PageType.normal,
                    3: PageType.skip, 4: PageType.normal, 5: PageType.normal}
      _, assign = seed_runs_from_ranges(cfg, page_types)
      assert assign.get(0) is None  # cover -> no run
      assert assign.get(3) is None  # skip -> no run
  ```
- [ ] Run it; expect failure (`seed_runs_from_ranges` undefined).
- [ ] Minimal implementation appended to `numbering_migration.py`:
  ```python
  from pdomain_prep_for_pgdp.core.models import NumberingRun, ProjectConfig, RunStyle, StartMode


  def seed_runs_from_ranges(
      config: ProjectConfig,
      page_types: dict[int, PageType],
  ) -> tuple[list[NumberingRun], dict[int, str | None]]:
      """Seed numbering runs from the legacy frontmatter/bodymatter ranges.

      Returns (runs, {scan: run_id | None}). Cover/skip and out-of-proof
      pages map to None (no run). The roman/arabic split + start numbers come
      straight from the config so migrated labels stay byte-stable.
      """
      front = NumberingRun(
          id="frontmatter", label="Front matter", style=RunStyle.roman_lower,
          start_mode=StartMode.set, start=config.frontmatter_page_nbr_start, step=1,
          span=(config.frontmatter_start_idx0, config.frontmatter_end_idx0),
      )
      body = NumberingRun(
          id="bodymatter", label="Body", style=RunStyle.arabic,
          start_mode=StartMode.set, start=config.bodymatter_page_nbr_start, step=1,
          span=(config.bodymatter_start_idx0, config.bodymatter_end_idx0),
      )
      assign: dict[int, str | None] = {}
      for scan, pt in page_types.items():
          if scan < config.proof_start_idx0 or scan > config.proof_end_idx0:
              assign[scan] = None
          elif pt in (PageType.skip, PageType.cover):
              assign[scan] = None
          elif config.frontmatter_start_idx0 <= scan <= config.frontmatter_end_idx0:
              assign[scan] = front.id
          elif config.bodymatter_start_idx0 <= scan <= config.bodymatter_end_idx0:
              assign[scan] = body.id
          else:
              assign[scan] = body.id  # in-proof but outside both ranges defaults to body
      return [front, body], assign
  ```
- [ ] Run it; expect pass.
- [ ] Commit:
  ```sh
  git commit -m "feat(numbering): seed_runs_from_ranges (last reader of legacy range config)"
  ```

### Task P1.7 — `materialize_naming_manifest` derives from runs (TDD-first)

Bump manifest to v2 and derive prefixes from `compute_labels` instead of `compute_prefix_v2`. Keep the export filename convention (`<prefix>` unchanged shape) — only the derivation changes.

**Files:**
- Create `tests/test_page_order_manifest_runs.py`
- Modify `src/pdomain_prep_for_pgdp/core/pipeline/steps/page_order.py`

**Steps:**
- [ ] Write the failing test asserting a v2 manifest where a counted blank keeps a numeric prefix and a marker (blank, run:None) gets no number (a `[Blank Page]`-derived prefix). Drive `materialize_naming_manifest` with explicit `runs` + leaf roles (new signature param) rather than ranges.
  ```python
  import json

  from pdomain_prep_for_pgdp.core.models import (
      LeafRole, NumberingRun, PageRecord, PageType, ProjectConfig, RunStyle,
  )
  from pdomain_prep_for_pgdp.core.pipeline.steps.page_order import (
      MANIFEST_VERSION, materialize_naming_manifest,
  )


  def _page(idx0, pt):
      return PageRecord(project_id="p", idx0=idx0, prefix="", source_stem=f"s{idx0}", page_type=pt)


  def test_manifest_v2_marker_has_no_number(tmp_path):
      run = NumberingRun(id="body", style=RunStyle.arabic, start=1, step=1, role=LeafRole.text)
      pages = [_page(0, PageType.normal), _page(1, PageType.blank), _page(2, PageType.normal)]
      # leaf_role/run assignment carried alongside pages for the new signature:
      leaf_roles = {0: (LeafRole.text, "body"), 1: (LeafRole.blank, None), 2: (LeafRole.text, "body")}
      raw = materialize_naming_manifest(
          project_id="p", ordered_pages=pages, project_config=None,
          data_root=tmp_path, runs=[run], leaf_assignments=leaf_roles,
      )
      manifest = json.loads(raw)
      assert manifest["version"] == MANIFEST_VERSION == 2
      by_idx = {e["idx0"]: e for e in manifest["pages"]}
      assert by_idx[0]["label"] == "1"
      assert by_idx[1]["label"] == "[Blank Page]"  # marker: held out
      assert by_idx[2]["label"] == "2"             # marker did not consume
  ```
- [ ] Run it; expect failure (signature has no `runs`/`leaf_assignments`; `MANIFEST_VERSION` is 1; entries have no `label`).
- [ ] Minimal implementation:
  - Bump `MANIFEST_VERSION = 2`.
  - Add `runs: list[NumberingRun]`, `leaf_assignments: dict[int, tuple[LeafRole, str | None]]` params to `materialize_naming_manifest` (keep `project_config` param for signature compatibility but no longer call `compute_prefix_v2`).
  - Build `Leaf` objects from `ordered_pages` + `leaf_assignments`, call `compute_labels`, and set each entry's `label` (+ derive `prefix`/`export_name` from the label, preserving the `<seq><type>` shape for numbered leaves; `skip`/`marker` → `prefix=None`).
  - Add `"label"` and `"run_id"` keys to each manifest entry; add `MANIFEST_VERSION` in the artifact.
- [ ] Run it; expect pass.
- [ ] Commit:
  ```sh
  git commit -m "feat(page_order): manifest v2 derives labels from runs (compute_labels)"
  ```

### Task P1.8 — Runs persistence: events + store + route (TDD-first for the route)

Event additions are stub-shaped; the route round-trip + event-append is test-first.

**Files:**
- Modify `src/pdomain_prep_for_pgdp/core/pipeline/prep_aggregate.py` (add events)
- Create `src/pdomain_prep_for_pgdp/core/numbering_store.py`
- Create `src/pdomain_prep_for_pgdp/api/data/page_order_runs.py`
- Mount router in the data-API aggregator (`src/pdomain_prep_for_pgdp/api/data/__init__.py` or the FastAPI app wiring)
- Create `tests/test_page_order_runs_route.py`

**Steps:**
- [ ] Add events to `PrepProjectAggregate` (stub — mirror the existing `@event` decorator style, ~line 184):
  ```python
  @event("NumberingRunsChanged")
  def record_numbering_runs_changed(
      self, before: list[dict[str, Any]], after: list[dict[str, Any]], actor_id: str,
  ) -> None:
      """Record a full-array replace of the project's numbering runs."""

  @event("LeafRoleSet")
  def record_leaf_role_set(
      self, page_id: str, previous_role: str | None, new_role: str | None, actor_id: str,
  ) -> None:
      """Record a leaf_role change for a page."""

  @event("LeafRunSet")
  def record_leaf_run_set(
      self, page_id: str, previous_run_id: str | None, new_run_id: str | None, actor_id: str,
  ) -> None:
      """Record assigning/clearing a leaf's numbering run (marker toggle)."""

  @event("FolioOverridden")
  def record_folio_overridden(
      self, page_id: str, label_override: str | None, actor_id: str,
  ) -> None:
      """Record a user folio-label override."""

  @event("PlateTagSet")
  def record_plate_tag_set(
      self, page_id: str, plate_tag: str | None, actor_id: str,
  ) -> None:
      """Record a plate caption change."""
  ```
- [ ] Create `numbering_store.py` (stub-shaped JSON dual-write counterpart):
  ```python
  """Project-scoped numbering-runs artifact store (dual-write to events)."""

  from __future__ import annotations

  import json
  from pathlib import Path

  from pdomain_prep_for_pgdp.core.models import NumberingRunsArtifact


  def _runs_path(data_root: Path, project_id: str) -> Path:
      return data_root / "projects" / project_id / "stages" / "page_order" / "runs.json"


  def load_runs(data_root: Path, project_id: str) -> NumberingRunsArtifact:
      path = _runs_path(data_root, project_id)
      if not path.exists():
          return NumberingRunsArtifact()
      return NumberingRunsArtifact.model_validate_json(path.read_bytes())


  def save_runs(data_root: Path, project_id: str, artifact: NumberingRunsArtifact) -> None:
      path = _runs_path(data_root, project_id)
      path.parent.mkdir(parents=True, exist_ok=True)
      path.write_text(artifact.model_dump_json(indent=2), encoding="utf-8")
  ```
- [ ] Write the failing route test (PUT then GET round-trips; event appended):
  ```python
  import pytest

  # Uses the existing app/client fixtures (mirror tests/test_page_order_runs_route
  # siblings such as tests/test_reorder_pages_route.py for the client fixture).


  @pytest.mark.anyio
  async def test_put_then_get_runs_roundtrip(client, seeded_project):
      pid = seeded_project.id
      body = {"version": 1, "runs": [
          {"id": "front", "label": "Front", "style": "roman-lower", "start_mode": "set",
           "start": 1, "step": 1, "role": "text", "span": [0, 1], "note": ""},
          {"id": "body", "label": "Body", "style": "arabic", "start_mode": "set",
           "start": 1, "step": 1, "role": "text", "span": [2, 5], "note": ""},
      ]}
      put = await client.put(f"/api/data/projects/{pid}/project-stages/page_order/runs", json=body)
      assert put.status_code == 200
      got = await client.get(f"/api/data/projects/{pid}/project-stages/page_order/runs")
      assert got.status_code == 200
      assert [r["id"] for r in got.json()["runs"]] == ["front", "body"]
  ```
  (Mirror the client/seeded_project fixtures from `tests/test_reorder_pages_route.py`; reuse, do not invent.)
- [ ] Run it; expect failure (route not mounted).
- [ ] Implement `page_order_runs.py`: `GET` returns `load_runs(...)`; `PUT` validates `NumberingRunsArtifact`, calls `save_runs(...)`, loads the `PrepProjectAggregate` (mirror `reorder_pages`'s `_load_prep_aggregate` block at `pages.py:393-426`), calls `record_numbering_runs_changed`, saves. Mount the router.
- [ ] Run it; expect pass.
- [ ] Commit:
  ```sh
  git commit -m "feat(numbering): runs GET/PUT route + NumberingRunsChanged event + JSON store"
  ```

### Task P1.9 — Migration wiring + range-config DELETION (TDD-first golden, then delete)

The migration runs on the registry-version re-derive path; afterward the range config and `compute_prefix_v2`/`assign_prefixes` are deleted.

**Files:**
- Modify `tests/test_numbering_migration.py` (golden byte-stability test)
- Modify `src/pdomain_prep_for_pgdp/core/pipeline/registry_version.py` (bump `REGISTRY_VERSION` to 3 — actually in `stage_dag.py` where it is defined; bump there)
- Delete range fields from `src/pdomain_prep_for_pgdp/core/models.py` (`ProjectConfig` lines 73-82: `proof_*`, `cover_idx0`, `title_idx0`, `frontmatter_*`, `bodymatter_*`)
- Delete `src/pdomain_prep_for_pgdp/core/assign_prefixes.py`
- Delete `compute_prefix_v2` + `_UNNUMBERED_TYPES` + `_PLATE_SUFFIX` from `src/pdomain_prep_for_pgdp/core/prefix.py`
- Update call sites: `pages.py` (`reorder_pages` line 387, `insert_page` line 754-804), `config_resolver.py:98,111`

**Steps:**
- [ ] Write the golden byte-stability test: build a small project with known ranges, run `seed_runs_from_ranges` + `compute_labels`, and assert the resulting labels equal what `compute_prefix_v2` produced for the same pages (capture the old output as a frozen fixture before deletion). Any diff = migration bug (spec §8.4).
  ```python
  def test_migrated_labels_match_legacy_prefix_v2():
      # Frozen expectation captured from compute_prefix_v2 before its removal.
      cfg = _cfg()  # 6 pages, front [0,1] roman, body [2,5] arabic
      page_types = {i: PageType.normal for i in range(6)}
      runs, assign = seed_runs_from_ranges(cfg, page_types)
      leaves = [Leaf(scan=i, leaf_role=LeafRole.text, run_id=assign[i]) for i in range(6)]
      labels = compute_labels(leaves, runs)
      # Legacy compute_prefix_v2 produced folio i,ii for front; 1,2,3,4 for body.
      assert labels[0] == "i" and labels[1] == "ii"
      assert labels[2] == "1" and labels[5] == "4"
  ```
- [ ] Run it; expect pass (proves the seed reproduces legacy numbering before we cut the old path).
- [ ] Bump `REGISTRY_VERSION` (in `stage_dag.py`) 2 → 3. Existing v2 projects now 409 and take the re-derive path; wire the re-derive to call `seed_runs_from_ranges` + `save_runs` + per-page `leaf_role`/`run_id`/`plate_side` assignment once. (Stub-shaped wiring in the re-derive handler — no new test beyond the golden.)
- [ ] DELETE the range fields from `ProjectConfig`, delete `assign_prefixes.py`, delete `compute_prefix_v2`/`_UNNUMBERED_TYPES`/`_PLATE_SUFFIX` from `prefix.py`. Update `reorder_pages` and `insert_page` in `pages.py` to recompute via `compute_labels` over the project's runs (load via `numbering_store.load_runs`) instead of `compute_prefix`. Update `config_resolver.py` to read `leaf_role`/`plate_side` instead of `plate_b/p/r` where it branches on plate types.
- [ ] Run the full suite; fix any references to deleted symbols:
  ```sh
  uv run pytest tests/ -q --ignore=tests/e2e -n auto
  ```
- [ ] Commit:
  ```sh
  git commit -m "feat(numbering): bump registry v3, migrate ranges->runs, delete range config + compute_prefix_v2"
  ```

### Milestone P1 gate

- [ ] `make ci AI=1` green.
- [ ] Live-verify on a real book (spec §9): `make run`, ingest a real IA book, confirm pages render with the same prefixes as before the migration (no renumber). Confirm a pre-existing v2 project DB triggers the re-derive path without a 500.

---

## Milestone P2 — wire the frontend PageOrderTool to real persistence

The UI already implements the model. This milestone replaces the no-op/stopgap services with real routes.

### Task P2.1 — `persistRuns` hits the real route (TDD-first)

**Files:**
- Modify `frontend/src/services/tools/pageOrderTool.ts`
- Create `frontend/src/services/tools/pageOrderTool.persistence.test.ts`

**Steps:**
- [ ] Write the failing vitest asserting `persistRuns` PUTs the `NumberingRunsArtifact` wire shape (not the old ad-hoc `{start_idx, type_code}` shape) to `/api/data/projects/{id}/project-stages/page_order/runs`. Mock `api.put`; assert URL + body.
  ```ts
  import { describe, it, expect, vi } from "vitest";
  import { api } from "@/api/client";
  import { buildRealPageOrderToolServices } from "./pageOrderTool";
  import type { Run } from "@/machines/tools/pageOrderTool";

  vi.mock("@/api/client", () => ({ api: { put: vi.fn().mockResolvedValue({}), patch: vi.fn(), get: vi.fn(), post: vi.fn() } }));

  describe("persistRuns", () => {
    it("PUTs the NumberingRunsArtifact shape", async () => {
      const svc = buildRealPageOrderToolServices();
      const runs: Run[] = [{ id: "body", label: "Body", style: "arabic", start: { mode: "set", value: 1 }, step: 1, span: [0, 5] }];
      await svc.persistRuns("proj-1", runs);
      expect(api.put).toHaveBeenCalledWith(
        "/api/data/projects/proj-1/project-stages/page_order/runs",
        { version: 1, runs: [{ id: "body", label: "Body", style: "arabic", start_mode: "set", start: 1, step: 1, role: "text", span: [0, 5], note: "" }] },
      );
    });
  });
  ```
- [ ] Run it; expect failure (current `persistRuns` sends the old shape).
- [ ] Rewrite `persistRuns` to map the machine `Run` → `NumberingRun` wire shape (`start.mode`→`start_mode`, `start.value`→`start`, default `role:"text"`, `note:""`).
- [ ] Run it; expect pass.
- [ ] Commit:
  ```sh
  git commit -m "feat(frontend): persistRuns sends NumberingRunsArtifact wire shape"
  ```

### Task P2.2 — `persistLeaf` sends leaf_role + run_id; drop the prefix stopgap (TDD-first)

**Files:**
- Modify `frontend/src/services/tools/pageOrderTool.ts`
- Modify `frontend/src/services/tools/pageOrderTool.persistence.test.ts`

**Steps:**
- [ ] Add a failing test: `persistLeaf` PATCHes `/pages/{scan}` with `{leaf_role, run_id, plate_tag, label_override}` (not just `page_type`), and `fetchFolios` reads `ocr_folio` from the page record (not `prefix`).
  ```ts
  it("persistLeaf PATCHes leaf_role + run_id", async () => {
    const svc = buildRealPageOrderToolServices();
    await svc.persistLeaf("proj-1", { scan: 3, role: "blank", runId: null, flags: [], plateTag: undefined });
    expect(api.patch).toHaveBeenCalledWith(
      "/api/data/projects/proj-1/pages/3",
      expect.objectContaining({ leaf_role: "blank", run_id: null }),
    );
  });
  ```
- [ ] Run it; expect failure.
- [ ] Update `persistLeaf` to send `leaf_role` (from `LeafRole`), `run_id`, `plate_tag`, `label_override`. Update `fetchFolios`'s `WirePageRecord` to include `leaf_role`/`run_id`/`ocr_folio` and build leaves from those (drop `ocrFolio: p.prefix`). Regenerate types: `make openapi-export`.
- [ ] Run vitest; expect pass.
- [ ] Commit:
  ```sh
  git commit -m "feat(frontend): persistLeaf sends leaf_role/run_id; fetchFolios reads ocr_folio"
  ```

### Task P2.3 — `PATCH /pages/{idx0}` accepts leaf fields + emits events (TDD-first)

**Files:**
- Modify `src/pdomain_prep_for_pgdp/api/data/pages.py` (`UpdatePageRequest` ~line 101, `update_page` ~line 446)
- Create `tests/test_update_page_leaf_fields.py`

**Steps:**
- [ ] Write the failing test: PATCH with `leaf_role:"blank"`, `run_id:null` persists those on the extension and appends `LeafRoleSet` + `LeafRunSet` events; PATCH with `plate_tag` appends `PlateTagSet`.
  ```python
  @pytest.mark.anyio
  async def test_patch_sets_leaf_role_and_run(client, seeded_project):
      pid = seeded_project.id
      r = await client.patch(f"/api/data/projects/{pid}/pages/3",
                             json={"leaf_role": "blank", "run_id": None})
      assert r.status_code == 200
      assert r.json()["leaf_role"] == "blank"
      assert r.json()["run_id"] is None
  ```
- [ ] Run it; expect failure (`UpdatePageRequest` has no `leaf_role`).
- [ ] Add `leaf_role: LeafRole | None`, `run_id: str | None`, `label_override: str | None`, `plate_tag: str | None`, `plate_side: PlateSide | None` to `UpdatePageRequest`; apply them in `update_page` via `update_page_extension(...)`; emit `record_leaf_role_set`/`record_leaf_run_set`/`record_folio_overridden`/`record_plate_tag_set` (mirror the `_load_prep_aggregate` block already in `update_page`). Surface the new fields on the `PageRecord` wire shape (add to `models.PageRecord` + `_ext_to_page_record`).
- [ ] Run it; expect pass; `make openapi-export`.
- [ ] Commit:
  ```sh
  git commit -m "feat(api): PATCH /pages accepts leaf_role/run_id/label_override/plate_tag + events"
  ```

### Milestone P2 gate

- [ ] `make ci AI=1` green (includes vitest via frontend CI).
- [ ] Live-verify (spec §9): `make run`, open a project's Page Order tool, edit a run's style and assign a leaf to a run; reload the page; confirm the change survives (runs + leaf role persisted, not lost on refresh).

---

## Milestone P3 — counted-blank vs marker + plate, end-to-end

The headline fix. The model + persistence exist (P1, P2); P3 makes the inspector toggle and the manifest produce the correct user-visible result.

### Task P3.1 — Manifest marker entry has no number; counted blank keeps one (TDD-first)

This is the manifest-level assertion of the headline behavior (P1.7 proved `label`; P3 proves the `prefix`/`export_name`/`skip` consequences).

**Files:**
- Modify `tests/test_page_order_manifest_runs.py`
- Modify `src/pdomain_prep_for_pgdp/core/pipeline/steps/page_order.py`

**Steps:**
- [ ] Add the failing test: a marker leaf (blank, run:None) gets `prefix=None` and is NOT in the numbered-prefix sequence (its neighbours' numbers are unaffected); a counted blank (blank, run:set) gets a real numbered prefix; a plate gets a plate prefix with no folio.
  ```python
  def test_marker_excluded_from_numbered_prefixes(tmp_path):
      run = NumberingRun(id="body", style=RunStyle.arabic, start=1, step=1, role=LeafRole.text)
      pages = [_page(i, PageType.normal) for i in range(4)]
      assign = {0: (LeafRole.text, "body"), 1: (LeafRole.blank, "body"),   # counted
                2: (LeafRole.blank, None), 3: (LeafRole.text, "body")}     # marker
      manifest = json.loads(materialize_naming_manifest(
          project_id="p", ordered_pages=pages, project_config=None,
          data_root=tmp_path, runs=[run], leaf_assignments=assign))
      by_idx = {e["idx0"]: e for e in manifest["pages"]}
      assert by_idx[1]["prefix"] is not None      # counted blank numbered
      assert by_idx[2]["prefix"] is None          # marker: no number
      assert by_idx[3]["label"] == "3"            # neighbour unaffected by marker
  ```
- [ ] Run it; expect failure if the prefix-derivation step still numbers markers.
- [ ] Refine the manifest's prefix-derivation: a leaf whose `label` is `MARKER` → `prefix=None`, added to `skip_ids` only if also `skip` role (markers are kept in order but unnumbered — emit `prefix=None`, `label="[Blank Page]"`, NOT in `skip_ids`). Plates → plate prefix (`<seq><section>p`-style), no folio.
- [ ] Run it; expect pass.
- [ ] Commit:
  ```sh
  git commit -m "feat(page_order): marker leaf gets no number; counted blank + plate correct in manifest"
  ```

### Task P3.2 — Inspector marker toggle = run assignment (TDD-first, frontend)

The inspector toggles counted↔marker by setting/clearing `run_id` (spec D2). The machine already does this via `SET_RUN`; P3.2 ensures the persistence reaches the backend and the label flips.

**Files:**
- Modify `frontend/src/services/tools/pageOrderTool.persistence.test.ts`
- Modify the surface component `frontend/src/pages/pipeline/tools/PageOrderTool.tsx` (inspector run toggle)

**Steps:**
- [ ] Add the failing test: toggling a blank leaf's run from `"body"` to `null` calls `persistLeaf` with `run_id: null` (marker); toggling back calls it with `run_id: "body"` (counted).
- [ ] Run it; expect failure if the inspector doesn't wire the toggle to `SET_RUN`/`persistLeaf`.
- [ ] Wire the inspector's "Counts toward #" / "Held out" control (per `run-leaf.jsx:295-304`) to send `SET_RUN` with `runId: null` (marker) or the body run id (counted).
- [ ] Run it; expect pass.
- [ ] Commit:
  ```sh
  git commit -m "feat(frontend): inspector marker toggle clears/sets run_id (counted<->marker)"
  ```

### Task P3.3 — `data-testid` contract on PageOrderTool controls

Stub-shaped (attribute additions) — no test-first; the e2e milestone exercises them.

**Files:**
- Modify the surface component(s) under `frontend/src/pages/pipeline/tools/PageOrderTool.tsx` (+ child components)

**Steps:**
- [ ] Add `data-testid` attributes the e2e suite drives (real, visible controls — no hidden stubs per workspace feedback):
  - `data-testid="page-order-runs-band"` — the runs spine.
  - `data-testid="page-order-leaf-row-{scan}"` — one per ledger row.
  - `data-testid="page-order-inspector"` — the leaf inspector panel.
  - `data-testid="page-order-inspector-run-toggle"` — the counted/marker toggle.
  - `data-testid="page-order-inspector-role-select"` — the role dropdown.
  - `data-testid="page-order-inspector-folio-override"` — the label override input.
- [ ] Commit:
  ```sh
  git commit -m "feat(frontend): data-testid contract for PageOrderTool e2e"
  ```

### Milestone P3 gate

- [ ] `make ci AI=1` green.
- [ ] Live-verify (spec §9, §10): `make run`, open Page Order on a real book with a plate + facing blank. Mark the facing blank as a marker (clear its run). Confirm: the marker loses its number, the neighbouring pages keep theirs unchanged, a different counted blank keeps its number, and the exported filename for the numbered pages is correct.

---

## Milestone V — Browser verification (MANDATORY — FastAPI + SPA repo)

A Playwright e2e milestone after P3, wired into `make e2e` / CI. Mirror the existing pattern in `tests/e2e/` (`conftest.py` boots uvicorn + chromium; see `test_convergence_app_loads.py`, `test_page_list_browser.py`). `make e2e` runs `frontend-build` first, then `uv run --group e2e pytest tests/e2e -v`.

### Task V.1 — app-loads + React-Router route test

**Files:**
- Create `tests/e2e/test_page_order_runs_browser.py`

**Steps:**
- [ ] Write the app-loads test: navigate to the app root, assert the SPA shell renders (mirror `test_convergence_app_loads.py`'s fixture + assertion shape).
- [ ] Write a React-Router route test: navigate directly to the Page Order tool route for a seeded project (deep link), assert the `page-order-runs-band` testid is present (router resolves the sub-path, not a blank page).
- [ ] Run:
  ```sh
  make e2e AI=1
  ```
- [ ] Commit:
  ```sh
  git commit -m "test(e2e): page-order app-loads + router deep-link"
  ```

### Task V.2 — headline happy-path: marker loses its number, neighbours unchanged

**Files:**
- Modify `tests/e2e/test_page_order_runs_browser.py`

**Steps:**
- [ ] Seed a project with a plate + facing blank + a counted blank (use the existing e2e seed helper from `conftest.py`).
- [ ] Drive: open the Page Order tool, select the plate's facing blank (`page-order-leaf-row-{scan}`), open the inspector (`page-order-inspector`), toggle it to marker (`page-order-inspector-run-toggle`). Assert via the rendered label cell that:
  - the marker row now shows `[Blank Page]` (no number),
  - the two neighbouring numbered rows are unchanged,
  - the counted blank still shows its number,
  - the naming preview for a numbered page shows the expected `<prefix>` filename.
- [ ] Run `make e2e AI=1`; expect pass.
- [ ] Commit:
  ```sh
  git commit -m "test(e2e): marker happy-path (loses number, neighbours unchanged, export filename)"
  ```

### Milestone V gate

- [ ] `make e2e AI=1` green; the new browser tests run in CI (not skipped).
- [ ] `make ci AI=1` green.

---

## Self-Review

Checks performed on this plan before marking it ready.

**Spec-coverage (every P1–P3 spec section maps to a task):**
- §7.1 backend data model → P1.1 (NumberingRun + enums), P1.2 (leaf fields). ✓
- §7.2 numbering engine (`compute_labels`/`reconcile`) → P1.3, P1.4. ✓
- §7.2 manifest from runs → P1.7, P3.1. ✓
- §7.3 API + events (runs CRUD, leaf events) → P1.8, P2.3. ✓
- §7.5 frontend wiring (persistRuns/persistLeaf, drop ocrFolio stopgap) → P2.1, P2.2. ✓
- §8 migration (ranges→runs, page_type→leaf_role, registry bump, golden) → P1.5, P1.6, P1.9. ✓
- §6 D2 counted-vs-marker = run assignment → P3.1, P3.2. ✓
- §6 D4 plate role / OQ-2 plate_side → P1.5 (mapping), P1.2 (field). ✓
- §9 each phase ends ci-green + live-verified → P1/P2/P3 gates. ✓
- §10 testing (pure-fn per role, round-trip, migration golden, live marker) → P1.3/4/6/7, P1.8, P1.9, V.2. ✓
- OQ-1 retire ranges → P1.9 deletion. OQ-4 nullable `ocr_folio` added now → P1.2. OQ-5 registry-bump re-derive → P1.9. ✓
- P4/P5 deferred → Out of scope section. ✓

**Placeholder scan:** No "TBD" / "add error handling" / "write tests for the above" without concrete code. Every code step shows actual code. ✓

**Type/signature consistency across tasks:** `Leaf` dataclass (`scan`, `leaf_role`, `run_id`, `ocr_folio`) is introduced in P1.3 and reused unchanged in P1.4, P1.7, P3.1. `materialize_naming_manifest` gains `runs` + `leaf_assignments: dict[int, tuple[LeafRole, str | None]]` in P1.7 and is called with the same signature in P3.1. `NumberingRun` wire shape (`start_mode`/`start`/`role`/`note`) is identical in the model (P1.1), the route (P1.8), and the frontend mapping (P2.1). `LeafRole`/`PlateSide` enums are referenced consistently. ✓ One known seam: `REGISTRY_VERSION` lives in `stage_dag.py` (imported by `registry_version.py`) — P1.9 bumps it there, not in `registry_version.py`.

**FastAPI + SPA browser-verification present:** Milestone V with data-testid contract (P3.3), app-loads + router deep-link (V.1), headline marker happy-path + export filename (V.2), wired to `make e2e`. ✓

**Assumptions recorded (code diverged from spec's stated line numbers):**
1. Spec §4 cites `core/models.py:67-82` for range fields — actual range fields are `ProjectConfig` lines 73-82 (confirmed). Spec §5 cites `pr-data.js:35-48` for the run shape — actual is lines 41-48 (`PR_RUNS`). Plan uses the verified locations.
2. Spec §5 lists run styles `roman-lower/roman-upper/arabic/alpha/none`, but the existing **frontend** machine (`pageOrderTool.ts:69`) only has `roman/arabic/none`. The plan adopts the **design-source** five-value `RunStyle` on the backend (P1.1) and notes the frontend `RunStyle` is a narrower set — P2 maps the machine's `arabic|roman|none` onto the backend enum (`roman`→`roman-lower`); a full alpha/roman-upper picker is left to a follow-up (not P1–P3 blocking).
3. Spec says runs live "on the project aggregate" as an entity; the codebase persists project-scoped artifacts as **JSON files under `projects/{id}/stages/page_order/`** with an event-sourced dual-write (the `page_order` manifest pattern). The plan mirrors that exactly (`numbering_store.py` + `NumberingRunsChanged` event) rather than inventing a new aggregate-embedded list.
4. `plate_b/p/r`→`plate_side` mapping is not stated in the spec (OQ-2 left open). Derived from `config_resolver.py:98,111` (plate_b/r grouped with blank = facing-blank/verso; plate_p = image/recto) and `run-leaf.jsx:224` (`side = role==='blank' ? 'verso' : 'recto'`). Stated explicitly in P1.5 and pinned by a migration test.
