---
Status: active
Owner: CT
Created: 2026-07-21
Last verified: 2026-07-21
Kind: issue
Level: I1
---

# page_order P4 OCR-folios still deferred (W3.9)

## Agent Index

- **Kind:** issue
- **Status:** active
- **Level:** I1
- **Last verified:** 2026-07-21
- **Resolution:** Open
- **Severity:** Low — numbering UX incomplete; manual/run-based labels work
- **Affected version:** pdomain-prep-for-pgdp (main @ 2026-07-21)
- **Read when:** implementing OCR folio detection, page_order ledger, or book-tools detector work.
- **Search terms:** ocr_folio, P4, page_order, FOLIO_PUSH, readingFolios, folio detector, W3.9
- **Relates to:** [pipeline completion review](../plans/2026-07-21-pipeline-completion-review.md),
  [page-numbering runs model](../plans/2026-06-17-page-numbering-runs-model.md)

## Summary

The page-numbering plan shipped P1–P3 (runs model, computed labels, overrides)
and **explicitly deferred P4 — OCR-folio detection**. Schema fields
(`ocr_folio`) are forward-stable and always `None` until a detector populates
them. UI ledger can reconcile OCR vs computed labels in design, but production
has no folio-reading stage or book-tools detector integration. W3.9 tracks
landing P4 when the detector is available.

## Impact

- Ledger “OCR folio” column stays empty; misread/out-of-sequence flags from
  OCR never fire on real books.
- Proofers cannot auto-suggest reorder from printed page numbers.
- Not a Wave 0 book-path blocker (manual runs + labels suffice).

## Environment / versions

```
plan: docs/plans/2026-06-17-page-numbering-runs-model.md (P4 deferred)
models: core/models.py Page.ocr_folio; core/prep_extension.py
FE: frontend/src/services/tools/pageOrderTool.ts ocrFolio: p.ocr_folio ?? null
numbering: core/numbering.py compare vs leaf.ocr_folio
pin: pdomain-book-tools>=0.21.0 (detector may still be missing or incomplete)
```

## Evidence

### 1. Numbering plan deferral

```
# docs/plans/2026-06-17-page-numbering-runs-model.md ~25–28
This plan covers **P1–P3 only**. Two spec phases are deferred…
- **P4 — OCR-folio detection** (the `readingFolios` / `FOLIO_PUSH` reading
  stage + persisted reconciliation flags + the `sequenceClean` advance gate
  that depends on real folios). *Why deferred:* it needs a new folio-reading
  stage … and detector work in `pdomain-book-tools`…
```

### 2. Schema always nullable in product path

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
2. **FOLIO_PUSH / reading phase** in page_order machine with live chips.
3. **Reconciliation flags + sequenceClean gate** once folios exist.
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
