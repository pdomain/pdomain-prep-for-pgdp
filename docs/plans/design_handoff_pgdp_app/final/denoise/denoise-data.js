// denoise-data.js — Denoise-stage (stage 7, Image group) sample data.
// Cleans the bilevel output from Threshold: removes speckle / pepper noise,
// fills pin-holes, clears ink-bleed blobs — WITHOUT eroding real text.
//
// The hard part: a blind despeckler can't tell a printer's signature mark, a
// foot page-number, or a catchword from a stray speckle. So denoise runs a
// FAST FIRST-PASS word/mark detector before cleaning and PROTECTS any
// connected component that reads as intentional ink. The full OCR stage (10)
// still does real recognition later; this first pass is only an "is this ink
// meant to be here?" classifier.
//
// per-page state:
//   running   — worker still detecting + cleaning
//   clean     — cleaned, nothing flagged (may still carry protected marks)
//   flagged   — a check failed (review needed)
//   reviewed  — user inspected a flagged page and accepted
//   failed    — worker errored
//
// noise    = residual speckle density 0..1 (quality signal, post-clean)
// eroded   = true if despeckle ate thin strokes
// blackΔ   = change in ink coverage from the clean pass (negative = removed)
// protect  = array of protected marginalia the first-pass detector kept:
//            { kind: 'pageNum'|'signature'|'catchword'|'footnote', conf }

const DENOISE_FLAGS = {
  residualNoise:   { label: 'residual-noise', tone: 'var(--mismatch)', desc: 'Speckle still present after the despeckle pass' },
  textEroded:      { label: 'text-eroded',    tone: 'var(--mismatch)', desc: 'Despeckle ate thin strokes / serifs (over-clean)' },
  protectConflict: { label: 'protect-conflict',tone: 'var(--ocr)',     desc: 'Despeckle wanted to drop a component the first-pass OCR protected' },
  markAtRisk:      { label: 'mark-at-risk',   tone: 'var(--fuzzy)',    desc: 'A low-scoring mark (page number / printer mark) nearly removed as noise' },
  holesFilled:     { label: 'holes-filled',   tone: 'var(--fuzzy)',    desc: 'Pin-holes closed — but so were letter counters (e, o, a)' },
  blobRemains:     { label: 'blob-remains',   tone: 'var(--gt)',       desc: 'Ink-bleed blob survived the cleanup' },
};

// Mark kinds the first-pass detector recognises in the margins.
const MARK_KINDS = {
  pageNum:   { label: 'page no.',   icon: 'fileText' },
  signature: { label: 'sig. mark',  icon: 'package' },  // printer's signature / gathering mark
  catchword: { label: 'catchword',  icon: 'arrowR' },
  footnote:  { label: 'footnote *', icon: 'sparkles' },
};

const DENOISE_ROWS = [
  // Clean, but the detector protected a foot page-number on most pages.
  { idx: 0,  prefix: 'p0001', state: 'clean', noise: 0.04, blackD: -0.012, pageNumber: '1',
    protect: [{ kind: 'pageNum', conf: 0.93 }] },
  { idx: 1,  prefix: 'p0002', state: 'clean', noise: 0.03, blackD: -0.010, pageNumber: '2',
    protect: [{ kind: 'pageNum', conf: 0.95 }] },
  // Clean + a printer's signature mark at the foot (the classic "looks like a speckle")
  { idx: 2,  prefix: 'p0003', state: 'clean', noise: 0.05, blackD: -0.014, pageNumber: '3',
    protect: [{ kind: 'pageNum', conf: 0.91 }, { kind: 'signature', conf: 0.68 }] },
  // Flagged: protect-conflict — despeckle wanted to drop the signature mark, OCR kept it (low conf)
  { idx: 3,  prefix: 'p0004', state: 'flagged', flags: ['protectConflict', 'markAtRisk'],
    noise: 0.06, blackD: -0.018, pageNumber: '4',
    protect: [{ kind: 'signature', conf: 0.52 }, { kind: 'pageNum', conf: 0.88 }] },
  // Flagged: residual noise (heavy pepper survived)
  { idx: 4,  prefix: 'p0005', state: 'flagged', flags: ['residualNoise'],
    noise: 0.34, blackD: -0.040, pageNumber: '5',
    protect: [{ kind: 'pageNum', conf: 0.90 }] },
  { idx: 5,  prefix: 'p0006', state: 'clean', noise: 0.04, blackD: -0.011, pageNumber: '6',
    protect: [{ kind: 'pageNum', conf: 0.94 }, { kind: 'catchword', conf: 0.71 }] },
  // Reviewed: holes filled (counters closed) — accepted
  { idx: 6,  prefix: 'p0007', state: 'reviewed', flags: ['holesFilled'],
    noise: 0.05, blackD: 0.022, pageNumber: '7',
    protect: [{ kind: 'pageNum', conf: 0.92 }] },
  // Flagged: text eroded (thin serifs gone)
  { idx: 7,  prefix: 'p0008', state: 'flagged', flags: ['textEroded'],
    noise: 0.03, blackD: -0.061, pageNumber: '8', eroded: true,
    protect: [{ kind: 'pageNum', conf: 0.89 }] },
  { idx: 8,  prefix: 'p0009', state: 'clean', noise: 0.04, blackD: -0.012, pageNumber: '9',
    protect: [{ kind: 'pageNum', conf: 0.93 }] },
  // Flagged: mark-at-risk — a faint foot page-number the detector almost dropped
  { idx: 9,  prefix: 'p0010', state: 'flagged', flags: ['markAtRisk'],
    noise: 0.07, blackD: -0.020, pageNumber: '10',
    protect: [{ kind: 'pageNum', conf: 0.41 }] },
  { idx: 10, prefix: 'p0011', state: 'clean', noise: 0.04, blackD: -0.013, pageNumber: '11',
    protect: [{ kind: 'pageNum', conf: 0.94 }] },
  // Flagged: blob remains (ink-bleed blob in margin)
  { idx: 11, prefix: 'p0012', state: 'flagged', flags: ['blobRemains'],
    noise: 0.12, blackD: -0.026, pageNumber: '12',
    protect: [{ kind: 'pageNum', conf: 0.90 }, { kind: 'footnote', conf: 0.66 }] },
  // Reviewed
  { idx: 12, prefix: 'p0013', state: 'reviewed', flags: ['residualNoise'],
    noise: 0.18, blackD: -0.030, pageNumber: '13',
    protect: [{ kind: 'pageNum', conf: 0.91 }] },
  { idx: 13, prefix: 'p0014', state: 'clean', noise: 0.04, blackD: -0.011, pageNumber: '14',
    protect: [{ kind: 'pageNum', conf: 0.93 }, { kind: 'signature', conf: 0.74 }] },
  // Flagged: protect-conflict again (catchword nearly dropped)
  { idx: 14, prefix: 'p0015', state: 'flagged', flags: ['protectConflict'],
    noise: 0.06, blackD: -0.017, pageNumber: '15',
    protect: [{ kind: 'catchword', conf: 0.48 }, { kind: 'pageNum', conf: 0.87 }] },
  { idx: 15, prefix: 'p0016', state: 'running' },
  { idx: 16, prefix: 'p0017', state: 'running' },
  { idx: 17, prefix: 'p0018', state: 'running' },
];

const DENOISE_TOTALS_RUNNING = {
  total: 387, done: 154, flagged: 8, clean: 142, reviewed: 4, errors: 0, protectedMarks: 169,
  running: 233, rateHz: 9.6, avgBlackD: '-1.4%',
};
const DENOISE_TOTALS_REVIEW = {
  total: 387, done: 387, flagged: 18, clean: 365, reviewed: 4, errors: 0, protectedMarks: 431,
  running: 0, rateHz: 0, avgBlackD: '-1.5%',
};
const DENOISE_TOTALS_DONE = {
  total: 387, done: 387, flagged: 0, clean: 383, reviewed: 4, errors: 0, protectedMarks: 431,
  running: 0, rateHz: 0, avgBlackD: '-1.5%',
};

const DENOISE_FLAG_COUNTS = {
  residualNoise:   7,
  protectConflict: 5,
  markAtRisk:      4,
  textEroded:      3,
  holesFilled:     2,
  blobRemains:     2, // 23 raw; some pages carry multiple — flagged is 18
};

// First-pass detector summary (shown on Overview + banner).
const DENOISE_DETECT = {
  pagesScanned: 387,
  marksFound:   431,
  byKind: { pageNum: 372, signature: 31, catchword: 19, footnote: 9 },
  lowConf:      14,   // protected but conf < 0.5 → surfaced as mark-at-risk
};

Object.assign(window, {
  DENOISE_FLAGS, MARK_KINDS, DENOISE_ROWS,
  DENOISE_TOTALS_RUNNING, DENOISE_TOTALS_REVIEW, DENOISE_TOTALS_DONE,
  DENOISE_FLAG_COUNTS, DENOISE_DETECT,
});
