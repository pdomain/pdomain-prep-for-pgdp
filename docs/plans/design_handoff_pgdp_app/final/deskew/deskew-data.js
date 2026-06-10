// deskew-data.js — Deskew-stage (stage 5) sample data.
// 15 deskewed pages + 3 still-running skeletons. After dewarp flattens the
// page, deskew measures the residual rotation (text baselines vs horizontal)
// and rotates each page to a true rectangle. Low-confidence / large-angle
// pages surface for review.
//
// per-page state:
//   running  — worker still measuring/rotating
//   clean    — auto-deskew passed every check (residual < 0.5°)
//   flagged  — deskew ran but a check failed (review needed)
//   reviewed — user inspected a flagged page and accepted
//   skipped  — no baselines found (illustration) → left as-is
//   failed   — worker errored
//
// skewDeg  = rotation the worker detected on the input (signed; + = clockwise)
// residual = angle still left after the auto-rotation (the quality signal)
// conf     = baseline-angle confidence 0..1

const DESKEW_FLAGS = {
  lowAngleConf: { label: 'low-score',    tone: 'var(--ocr)',      desc: 'Skew-angle estimate had a low score' },
  multiAngle:   { label: 'multi-angle',  tone: 'var(--fuzzy)',    desc: 'Text blocks disagree on the rotation (multi-column / warp)' },
  extremeSkew:  { label: 'extreme-skew', tone: 'var(--mismatch)', desc: 'Detected rotation exceeded threshold (> 8°) — likely misfed' },
  residualSkew: { label: 'residual',     tone: 'var(--fuzzy)',    desc: 'After rotation the page is still off by > 0.5°' },
  overRotated:  { label: 'over-rotated', tone: 'var(--mismatch)', desc: 'Correction introduced new skew (regression)' },
  noBaseline:   { label: 'no-baseline',  tone: 'var(--gt)',       desc: 'No text baselines to measure from (illustration page)' },
};

const DESKEW_ROWS = [
  { idx: 0,  prefix: 'p0001', state: 'clean',   skewDeg: -1.4, residual: 0.1, conf: 0.98, pageNumber: '1' },
  { idx: 1,  prefix: 'p0002', state: 'clean',   skewDeg:  0.9, residual: 0.1, conf: 0.97, pageNumber: '2' },
  { idx: 2,  prefix: 'p0003', state: 'clean',   skewDeg: -2.1, residual: 0.2, conf: 0.96, pageNumber: '3' },
  // Flagged: low confidence (faint baselines)
  { idx: 3,  prefix: 'p0004', state: 'flagged', flags: ['lowAngleConf'],
    skewDeg: 3.6, residual: 0.4, conf: 0.52, pageNumber: '4' },
  // Flagged: extreme skew (page fed crooked into scanner)
  { idx: 4,  prefix: 'p0005', state: 'flagged', flags: ['extremeSkew', 'lowAngleConf'],
    skewDeg: 9.8, residual: 0.6, conf: 0.48, pageNumber: '5' },
  { idx: 5,  prefix: 'p0006', state: 'clean',   skewDeg: 1.2, residual: 0.1, conf: 0.95, pageNumber: '6' },
  // Reviewed
  { idx: 6,  prefix: 'p0007', state: 'reviewed', flags: ['multiAngle'],
    skewDeg: -2.8, residual: 0.7, conf: 0.61, pageNumber: '7' },
  // Flagged: multi-angle (two-column page, blocks disagree)
  { idx: 7,  prefix: 'p0008', state: 'flagged', flags: ['multiAngle', 'residualSkew'],
    skewDeg: 2.4, residual: 1.1, conf: 0.57, pageNumber: '8' },
  { idx: 8,  prefix: 'p0009', state: 'clean',   skewDeg: -0.7, residual: 0.1, conf: 0.97, pageNumber: '9' },
  // Skipped: full-page illustration
  { idx: 9,  prefix: 'p0010', state: 'skipped', flags: ['noBaseline'],
    skewDeg: 0, residual: 0, conf: 0.0, pageNumber: '10', illust: true },
  { idx: 10, prefix: 'p0011', state: 'clean',   skewDeg: 1.9, residual: 0.2, conf: 0.94, pageNumber: '11' },
  // Flagged: residual skew (rotation didn't fully correct)
  { idx: 11, prefix: 'p0012', state: 'flagged', flags: ['residualSkew'],
    skewDeg: -4.1, residual: 0.9, conf: 0.72, pageNumber: '12' },
  // Reviewed
  { idx: 12, prefix: 'p0013', state: 'reviewed', flags: ['overRotated'],
    skewDeg: 3.0, residual: 0.8, conf: 0.66, pageNumber: '13' },
  { idx: 13, prefix: 'p0014', state: 'clean',   skewDeg: -1.1, residual: 0.1, conf: 0.96, pageNumber: '14' },
  // Flagged: extreme skew again
  { idx: 14, prefix: 'p0015', state: 'flagged', flags: ['extremeSkew'],
    skewDeg: -8.7, residual: 0.5, conf: 0.70, pageNumber: '15' },
  { idx: 15, prefix: 'p0016', state: 'running' },
  { idx: 16, prefix: 'p0017', state: 'running' },
  { idx: 17, prefix: 'p0018', state: 'running' },
];

const DESKEW_TOTALS_RUNNING = {
  total: 387, done: 210, flagged: 11, clean: 188, reviewed: 5, skipped: 6, errors: 0,
  running: 177, rateHz: 11.3, avgAngle: '2.4°',
};
const DESKEW_TOTALS_REVIEW = {
  total: 387, done: 387, flagged: 19, clean: 354, reviewed: 5, skipped: 9, errors: 0,
  running: 0, rateHz: 0, avgAngle: '2.6°',
};
const DESKEW_TOTALS_DONE = {
  total: 387, done: 387, flagged: 0, clean: 373, reviewed: 5, skipped: 9, errors: 0,
  running: 0, rateHz: 0, avgAngle: '2.6°',
};

const DESKEW_FLAG_COUNTS = {
  lowAngleConf: 7,
  extremeSkew:  4,
  multiAngle:   4,
  residualSkew: 5,
  overRotated:  2,
  noBaseline:   3, // 25 raw; some pages carry multiple — flagged is 19
};

Object.assign(window, {
  DESKEW_FLAGS, DESKEW_ROWS,
  DESKEW_TOTALS_RUNNING, DESKEW_TOTALS_REVIEW, DESKEW_TOTALS_DONE,
  DESKEW_FLAG_COUNTS,
});
