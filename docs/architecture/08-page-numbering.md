---
Kind: architecture
Status: built
Owner: CT
Created: 2026-11-07
Last verified: 2026-11-07
---

# Page-numbering runs

## Agent Index

- **Kind:** architecture
- **Status:** built
- **Last verified:** 2026-11-07
- **Read when:** changing page order, folio labels, naming manifests, or ranges migration.
- **Search terms:** numbering runs, counted blank, marker, folio, page_order, P1 P2 P3.

Page numbering derives display labels and package names from persisted runs and each leaf's role and run assignment.
The page-order tool saves runs and leaf changes through the API. Labels are derived values, not stored truth.

## Runs and leaf assignments

`NumberingRun` describes the style, starting value, step, span, and start mode of a numbering sequence.
The backend supports lower- and upper-case Roman, Arabic, alphabetic, and unnumbered styles.
A continuing run starts one step after the nearest preceding numbered run's last value when one exists.

Prep page extensions hold `leaf_role`, `run_id`, `label_override`, `plate_tag`, `plate_side`, and nullable `ocr_folio`.
The Source layer's `page_role` remains separate from numbering roles.

A blank assigned to a run consumes a number. A blank without a run displays `[Blank Page]` and consumes none.
A plate displays an em dash and consumes no number. Clearing a run assignment requires an explicit JSON null;
omitting the field preserves its stored value.

The pure numbering engine also derives reconciliation flags. It marks duplicate computed labels and disagreements
with supplied OCR folios. It excludes marker and unnumbered labels from those checks.

## Persistence and migration

The numbering store reads and writes the project artifact `stages/page_order/runs.json`.
Prep workflow events record run and leaf edits. Page leaf metadata lives in the shared page store described in
[backend ownership](02-backend.md#page-lifecycle-service-corepage_store_factorypy).
GET and PUT `/api/data/projects/{id}/project-stages/page_order/runs` read and save the typed runs artifact.
PATCH `/api/data/projects/{id}/pages/{idx0}` persists leaf fields.

Registry-version migration seeds runs and leaf assignments from legacy ranges before advancing a version-2
project to version 3. New projects use the current runs model. Range-based naming is no longer the live contract.
Migration preserves legacy naming except for the deliberate correction that excludes interior skipped leaves from counting.

## Naming manifest

The page-order stage writes manifest version 2 with a display `label`, `run_id`, and filename `prefix` per entry.
Display style and filename folio are separate: filename folios use Arabic ordinals even for Roman display labels.
The sequence starts at the first in-proof scan and uses three digits, or four when the scan span exceeds 999.
Cover prefixes use `e`; other prefixes use front/body section letters and preserve legacy plate suffixes.
Skip leaves and unassigned ordinary leaves are excluded from package naming.
Blank markers remain in manifest order with no filename prefix. Only skip-role leaves enter `skip_ids`.

## Limits and remaining work

Automated OCR-folio detection remains open in
[W3.9](../issues/2026-07-21-w39-page-order-ocr-folios.md).
The machine already loads through `fetchFolios` and guards confirmation with `sequenceClean`.
The nullable field and reconciliation function do not establish that a detector populates production values.
Integrate persisted detector results with those existing paths; a new streaming design is a separate choice.

The frontend offers only Roman, Arabic, and unnumbered styles. It maps Roman to lower-case Roman on save.
Upper-case Roman reloads as Roman, and alphabetic reloads as unnumbered; saving can lose those distinctions.
Keep that UI expansion separate from the shipped runs model.

Source `back` and `duplicate` labels already persist separately from packaging type.
The broader inserted-kind follow-up remains deferred; see [intent](../context/intent-map.md).

## Evidence

- Code: `core/models.py`, `core/prep_extension.py`, `core/numbering.py`, `core/numbering_store.py`,
  `core/numbering_migration.py`, and `core/pipeline/steps/page_order.py` under `src/pdomain_prep_for_pgdp/`.
- Frontend: `frontend/src/services/tools/pageOrderTool.ts` and `frontend/src/pages/pipeline/tools/PageOrderTool.tsx`.
- Tests: `tests/test_page_order_manifest_runs.py::test_manifest_v2_counted_blank_vs_marker`,
  `tests/test_numbering_compute_labels.py`, `tests/test_numbering_reconcile.py`,
  `tests/test_numbering_migration.py::test_golden_with_skip_excluded`, and the page-order service and tool tests.
- Verified: 2026-11-07 by source inspection. Full CI is the integration gate; no new live-book verification is claimed.
