// po-data.js — Page order stage (stage 11, OCR group) sample data.
// Uses the OCR'd printed page numbers (folios) to detect scans that are out of
// sequence — misfed leaves, a flipped bifolium, a duplicate scan, a numbering
// gap — and proposes a corrected order. Front matter (roman / unnumbered) is
// handled separately from the arabic body.
//
// Each row is a scan in CAPTURE order: scan = position as scanned, folio =
// printed number OCR read (null = none found), want = the position it should
// sit at once sorted.

const PO_FLAGS = {
  outOfSequence: { label: 'out-of-seq',   tone: 'var(--mismatch)', desc: 'Folio is lower/higher than its neighbours — scan is in the wrong place' },
  missingNumber: { label: 'no-folio',     tone: 'var(--fuzzy)',    desc: 'No printed page number found on the scan' },
  duplicate:     { label: 'duplicate',    tone: 'var(--mismatch)', desc: 'Two scans carry the same folio' },
  gap:           { label: 'gap',          tone: 'var(--ocr)',      desc: 'A folio is missing between neighbours — a leaf may be absent' },
  nonNumeric:    { label: 'roman/front',  tone: 'var(--gt)',       desc: 'Roman numeral or unnumbered front-matter page' },
  misread:       { label: 'misread',      tone: 'var(--fuzzy)',    desc: 'OCR likely misread the folio (low score)' },
};

// scan order 1..18. folio = OCR'd printed number. ok = in correct place.
const PO_ROWS = [
  { scan: 1,  prefix: 'p0001', folio: 'i',   kind: 'roman', state: 'clean',   flags: ['nonNumeric'] },
  { scan: 2,  prefix: 'p0002', folio: 'ii',  kind: 'roman', state: 'clean',   flags: ['nonNumeric'] },
  { scan: 3,  prefix: 'p0003', folio: null,  kind: 'front', state: 'flagged', flags: ['missingNumber'] },
  { scan: 4,  prefix: 'p0004', folio: '1',   kind: 'arabic', state: 'clean' },
  { scan: 5,  prefix: 'p0005', folio: '2',   kind: 'arabic', state: 'clean' },
  // out of sequence: folio 5 sits where 3 should be
  { scan: 6,  prefix: 'p0006', folio: '5',   kind: 'arabic', state: 'flagged', flags: ['outOfSequence'], want: 9 },
  { scan: 7,  prefix: 'p0007', folio: '3',   kind: 'arabic', state: 'flagged', flags: ['outOfSequence'], want: 7 },
  { scan: 8,  prefix: 'p0008', folio: '4',   kind: 'arabic', state: 'clean' },
  // the displaced 5's true neighbour
  { scan: 9,  prefix: 'p0009', folio: '6',   kind: 'arabic', state: 'clean' },
  { scan: 10, prefix: 'p0010', folio: '7',   kind: 'arabic', state: 'clean' },
  // gap: 8 missing (folio jumps 7 → 9)
  { scan: 11, prefix: 'p0011', folio: '9',   kind: 'arabic', state: 'flagged', flags: ['gap'] },
  { scan: 12, prefix: 'p0012', folio: '10',  kind: 'arabic', state: 'clean' },
  // duplicate: two scans read 11
  { scan: 13, prefix: 'p0013', folio: '11',  kind: 'arabic', state: 'flagged', flags: ['duplicate'] },
  { scan: 14, prefix: 'p0014', folio: '11',  kind: 'arabic', state: 'flagged', flags: ['duplicate'] },
  // misread: '1Z' should be 12
  { scan: 15, prefix: 'p0015', folio: '1Z',  kind: 'arabic', state: 'flagged', flags: ['misread'], want: 16, suggest: '12' },
  { scan: 16, prefix: 'p0016', folio: '13',  kind: 'arabic', state: 'reviewed', flags: ['outOfSequence'] },
  { scan: 17, prefix: 'p0017', folio: '14',  kind: 'arabic', state: 'clean' },
  { scan: 18, prefix: 'p0018', folio: '15',  kind: 'arabic', state: 'clean' },
];

const PO_TOTALS_RUNNING = {
  total: 387, scanned: 240, numbered: 318, outOfSeq: 5, gaps: 2, dupes: 1, missing: 14,
  running: 147, rateHz: 22.0,
};
const PO_TOTALS_REVIEW = {
  total: 387, numbered: 358, outOfSeq: 6, gaps: 3, dupes: 2, missing: 18, reviewed: 1, flagged: 9,
  running: 0, rateHz: 0,
};
const PO_TOTALS_DONE = {
  total: 387, numbered: 358, outOfSeq: 0, gaps: 3, dupes: 0, missing: 18, reviewed: 9, flagged: 0,
  running: 0, rateHz: 0,
};

const PO_FLAG_COUNTS = {
  outOfSequence: 6,
  missingNumber: 18,
  gap:           3,
  duplicate:     2,
  misread:       3,
  nonNumeric:    12,
};

Object.assign(window, {
  PO_FLAGS, PO_ROWS, PO_TOTALS_RUNNING, PO_TOTALS_REVIEW, PO_TOTALS_DONE, PO_FLAG_COUNTS,
});
