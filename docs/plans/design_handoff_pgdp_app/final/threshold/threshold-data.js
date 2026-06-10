// threshold-data.js — Threshold-stage (stage 6, Image group) sample data.
// 15 binarized pages + 3 still-running skeletons. Converts each grayscale
// page to bilevel (pure black/white) for OCR. Pages where the binarizer was
// uncertain (low contrast, uneven light, bleed-through) surface for review.
//
// per-page state:
//   running  — worker still binarizing
//   clean    — binarization passed every check
//   flagged  — ran but a check failed (review needed)
//   reviewed — user inspected a flagged page and accepted
//   failed   — worker errored
//
// method   = binarizer that ran ('otsu' | 'sauvola' | 'adaptive')
// thresh   = chosen threshold value 0..255 (global) / window mean (adaptive)
// blackPct = fraction of the page that came out black (ink coverage)
// contrast = source contrast estimate 0..1 (the quality signal)

const THRESH_FLAGS = {
  speckle:     { label: 'speckle',      tone: 'var(--mismatch)', desc: 'Output carries excessive black speckle / pepper noise' },
  brokenText:  { label: 'broken-text',  tone: 'var(--mismatch)', desc: 'Strokes broke up or dropped out (over-thresholded)' },
  bleedThrough:{ label: 'bleed-through',tone: 'var(--fuzzy)',    desc: 'Show-through from the reverse side came out black' },
  lowContrast: { label: 'low-contrast', tone: 'var(--ocr)',      desc: 'Source contrast too low for a reliable threshold' },
  unevenLight: { label: 'uneven-light', tone: 'var(--fuzzy)',    desc: 'Illumination gradient over-darkened one side' },
  inkBleed:    { label: 'ink-bleed',    tone: 'var(--gt)',       desc: 'Heavy ink spread / blobbing (under-thresholded)' },
};

const THRESH_ROWS = [
  { idx: 0,  prefix: 'p0001', state: 'clean',   method: 'sauvola', thresh: 138, blackPct: 0.11, contrast: 0.82, pageNumber: '1' },
  { idx: 1,  prefix: 'p0002', state: 'clean',   method: 'sauvola', thresh: 142, blackPct: 0.10, contrast: 0.80, pageNumber: '2' },
  { idx: 2,  prefix: 'p0003', state: 'clean',   method: 'otsu',    thresh: 151, blackPct: 0.12, contrast: 0.86, pageNumber: '3' },
  // Flagged: low contrast (faded print)
  { idx: 3,  prefix: 'p0004', state: 'flagged', flags: ['lowContrast'],
    method: 'sauvola', thresh: 119, blackPct: 0.07, contrast: 0.34, pageNumber: '4' },
  // Flagged: bleed-through + speckle
  { idx: 4,  prefix: 'p0005', state: 'flagged', flags: ['bleedThrough', 'speckle'],
    method: 'otsu', thresh: 168, blackPct: 0.21, contrast: 0.58, pageNumber: '5' },
  { idx: 5,  prefix: 'p0006', state: 'clean',   method: 'sauvola', thresh: 140, blackPct: 0.11, contrast: 0.79, pageNumber: '6' },
  // Reviewed
  { idx: 6,  prefix: 'p0007', state: 'reviewed', flags: ['unevenLight'],
    method: 'adaptive', thresh: 134, blackPct: 0.14, contrast: 0.62, pageNumber: '7' },
  // Flagged: broken text (over-thresholded)
  { idx: 7,  prefix: 'p0008', state: 'flagged', flags: ['brokenText'],
    method: 'sauvola', thresh: 108, blackPct: 0.06, contrast: 0.49, pageNumber: '8' },
  { idx: 8,  prefix: 'p0009', state: 'clean',   method: 'sauvola', thresh: 139, blackPct: 0.11, contrast: 0.81, pageNumber: '9' },
  // Flagged: ink bleed (under-thresholded, blobbing)
  { idx: 9,  prefix: 'p0010', state: 'flagged', flags: ['inkBleed'],
    method: 'otsu', thresh: 176, blackPct: 0.28, contrast: 0.71, pageNumber: '10' },
  { idx: 10, prefix: 'p0011', state: 'clean',   method: 'sauvola', thresh: 141, blackPct: 0.10, contrast: 0.83, pageNumber: '11' },
  // Flagged: uneven light (gradient over one margin)
  { idx: 11, prefix: 'p0012', state: 'flagged', flags: ['unevenLight', 'speckle'],
    method: 'adaptive', thresh: 130, blackPct: 0.17, contrast: 0.55, pageNumber: '12' },
  // Reviewed
  { idx: 12, prefix: 'p0013', state: 'reviewed', flags: ['speckle'],
    method: 'sauvola', thresh: 146, blackPct: 0.13, contrast: 0.68, pageNumber: '13' },
  { idx: 13, prefix: 'p0014', state: 'clean',   method: 'sauvola', thresh: 140, blackPct: 0.11, contrast: 0.84, pageNumber: '14' },
  // Flagged: low contrast again
  { idx: 14, prefix: 'p0015', state: 'flagged', flags: ['lowContrast', 'brokenText'],
    method: 'sauvola', thresh: 112, blackPct: 0.05, contrast: 0.31, pageNumber: '15' },
  { idx: 15, prefix: 'p0016', state: 'running' },
  { idx: 16, prefix: 'p0017', state: 'running' },
  { idx: 17, prefix: 'p0018', state: 'running' },
];

const THRESH_TOTALS_RUNNING = {
  total: 387, done: 168, flagged: 12, clean: 152, reviewed: 4, errors: 0,
  running: 219, rateHz: 14.8, avgBlack: '11.8%',
};
const THRESH_TOTALS_REVIEW = {
  total: 387, done: 387, flagged: 26, clean: 357, reviewed: 4, errors: 0,
  running: 0, rateHz: 0, avgBlack: '12.4%',
};
const THRESH_TOTALS_DONE = {
  total: 387, done: 387, flagged: 0, clean: 383, reviewed: 4, errors: 0,
  running: 0, rateHz: 0, avgBlack: '12.4%',
};

const THRESH_FLAG_COUNTS = {
  speckle:      8,
  lowContrast:  6,
  bleedThrough: 4,
  unevenLight:  4,
  brokenText:   4,
  inkBleed:     3, // 29 raw; some pages carry multiple — flagged is 26
};

Object.assign(window, {
  THRESH_FLAGS, THRESH_ROWS,
  THRESH_TOTALS_RUNNING, THRESH_TOTALS_REVIEW, THRESH_TOTALS_DONE,
  THRESH_FLAG_COUNTS,
});
