---
Status: active
Owner: CT
Created: 2026-07-21
Last verified: 2026-11-07
Kind: issue
Level: I1
---

# page_order P4 OCR-folios still deferred (W3.9)

## Agent Index

- **Kind:** issue
- **Status:** active
- **Level:** I1
- **Last verified:** 2026-11-07
- **Resolution:** Open
- **Severity:** Low — numbering UX incomplete; manual/run-based labels work
- **Affected version:** pdomain-prep-for-pgdp (main @ 2026-07-21)
- **Read when:** implementing OCR folio detection, page_order ledger, or book-tools detector work.
- **Search terms:** ocr_folio, P4, page_order, FOLIO_PUSH, readingFolios, folio detector, W3.9
- **Relates to:** [pipeline completion review](../plans/2026-07-21-pipeline-completion-review.md),
  [page-numbering runs model](../architecture/08-page-numbering.md)

## Summary

The page-numbering plan shipped P1–P3 (runs model, computed labels, overrides)
and **explicitly deferred P4 — OCR-folio detection**. Schema fields
(`ocr_folio`) are nullable. No shipped detector populates them, though seeded or manually persisted data can.
The page-order machine already loads folios and has reconciliation and `sequenceClean` logic.
W3.9 tracks real detector integration and verification of those existing paths with persisted detector results.

## Impact

- Ledger “OCR folio” column stays empty; misread/out-of-sequence flags from
  OCR never fire on real books.
- Proofers cannot auto-suggest reorder from printed page numbers.
- Not a Wave 0 book-path blocker (manual runs + labels suffice).

## Environment / versions

```
architecture: docs/architecture/08-page-numbering.md (P4 deferred)
retirement: docs/context/decisions.md, 2026-11-07 plan consolidation
models: core/models.py Page.ocr_folio; core/prep_extension.py
FE: frontend/src/services/tools/pageOrderTool.ts ocrFolio: p.ocr_folio ?? null
numbering: core/numbering.py compare vs leaf.ocr_folio
pin: pdomain-book-tools>=0.28.0 (external detector availability not established by this audit)
```

## Evidence

### Current source verification — 2026-11-07

No shipped detector writes OCR folios. Initial fetchFolios loading, reconciliation, and sequenceClean already
exist. Checked machines/tools/pageOrderTool.ts, services/tools/pageOrderTool.ts, core/numbering.py, and the
nullable model fields. The current book-tools minimum is 0.28.0; external detector availability was not checked.

This is source inspection, not a fresh browser/GPU run. Older source excerpts and July review dates below
are historical snapshots; the current findings above take precedence where implementation changed.

### 1. Numbering deferral

The [numbering architecture](../architecture/08-page-numbering.md#limits-and-remaining-work)
preserves the detector deferral. Production uses the initial `loading` / `fetchFolios` path rather than the
earlier streaming design. `sequenceClean` already guards confirmation, and `core/numbering.py` already
derives duplicate and OCR-disagreement flags. Feed persisted detector values into those paths and verify them.
The [consolidation tombstone](../context/decisions.md#retired-numbering-runs-p1p3-implementation-plan)
records why the P1–P3 execution plan retired.

### 2. Nullable schema, with no shipped detector writer

```
# core/models.py ~314–315
ocr_folio: str | None = None
"""Printed folio read by OCR. P4-populated; None throughout P1-P3."""
```

### 3. FE maps field but expects P4 fill

```
# frontend/src/services/tools/pageOrderTool.ts ~341–345
// P2.2: ocrFolio from the real ocr_folio field (null until page_order OCR
// in P4). …
ocrFolio: p.ocr_folio ?? null,
```

### 4. Parent plan

Matrix: page_order FULL backend / FUNCTIONAL FE — “P4 OCR-folios deferred.”
W3.9 done-when: “Folio chips real.” Deferred product list repeats P4.

## Root-cause hypotheses

1. **(Most likely) Cross-repo detector dependency** — folio reader not ready
   or not wired in book-tools at plan time; intentionally parked.
2. **Stage topology open question** — lightweight folio stage vs fold into
   OCR still unresolved (OQ-4 in numbering plan).

## Defects to fix

1. **Populate `ocr_folio` from a real detector** (book-tools) per page. (Primary)
2. **Feed the existing `fetchFolios` loader** with persisted detector results and real folio chips.
3. **Verify existing reconciliation and `sequenceClean`** with detector-backed data; decide any new streaming
   design separately rather than treating the old `readingFolios` proposal as required architecture.
4. **Tests** with synthetic printed-number fixtures (no full DocTR book).

## Next steps

1. Confirm book-tools folio detector API availability at current pin.
2. Choose stage topology (dedicated vs OCR side product).
3. TDD populate + FE ledger; promote any skipped naming/folio e2e notes.

## What is NOT broken

- Runs-based computed labels, overrides, and prefix/naming from P1–P3.
- page_order stage run and confirm without OCR folios.
- Design handoff mocks showing OCR columns (design only).

## Resolution

*Open.* When fixed: set frontmatter + Agent Index `Status: retired`, link P4
implementation, route retirement through `doc-retirer`.
