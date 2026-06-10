// dewarp-data.js — Dewarp-stage (stage 4) sample data.
// 15 dewarped pages + 3 still-running skeletons. The worker fits a 2D warp
// mesh per page (from text-line curvature + page-edge curvature) and
// resamples to flat. Pages where the fit was uncertain surface for review.
//
// per-page state:
//   running  — worker still fitting/resampling; no output yet
//   clean    — auto-dewarp passed every check
//   flagged  — dewarp ran but a check failed (review needed)
//   reviewed — user inspected a flagged page and accepted as-is
//   skipped  — dewarp disabled for this page (illustration / no text)
//   failed   — worker errored on this page
//
// curveDeg = the gutter curvature measured on the SOURCE (how much "smile"
// the binding put into the page). 0 = already flat. The thumb skews/curves
// its "before" ghost by this much; the dewarped output is flat.
// conf = mesh-fit confidence 0..1 (text-line confidence score).

const DEWARP_FLAGS = {
  lowConfidence: { label: 'low-score',    tone: 'var(--ocr)',      desc: 'Text-line mesh fit had a low score' },
  extremeCurve:  { label: 'extreme-curve',tone: 'var(--mismatch)', desc: 'Gutter curvature exceeded threshold (> 18°)' },
  meshConflict:  { label: 'mesh-conflict',tone: 'var(--fuzzy)',    desc: 'Text-line mesh disagreed with the edge-fit mesh' },
  noText:        { label: 'no-text',      tone: 'var(--gt)',       desc: 'Too few text lines to fit a mesh (illustration page)' },
  overWarp:      { label: 'over-warp',    tone: 'var(--mismatch)', desc: 'Output is more distorted than the input (regression)' },
  gutterMissed:  { label: 'gutter-missed',tone: 'var(--fuzzy)',    desc: 'Could not locate the gutter edge confidently' },
};

// 15 dewarped pages, sprinkled with flags.
const DEWARP_ROWS = [
  { idx: 0,  prefix: 'p0001', state: 'clean',   curveDeg: 4.2,  conf: 0.97, pageNumber: '1' },
  { idx: 1,  prefix: 'p0002', state: 'clean',   curveDeg: 5.1,  conf: 0.95, pageNumber: '2' },
  { idx: 2,  prefix: 'p0003', state: 'clean',   curveDeg: 3.4,  conf: 0.98, pageNumber: '3' },
  // Flagged: low confidence (faint print near gutter)
  { idx: 3,  prefix: 'p0004', state: 'flagged', flags: ['lowConfidence'],
    curveDeg: 9.8,  conf: 0.51, pageNumber: '4' },
  // Flagged: extreme curve (deep into a tight binding)
  { idx: 4,  prefix: 'p0005', state: 'flagged', flags: ['extremeCurve', 'lowConfidence'],
    curveDeg: 22.5, conf: 0.44, pageNumber: '5' },
  { idx: 5,  prefix: 'p0006', state: 'clean',   curveDeg: 6.0,  conf: 0.93, pageNumber: '6' },
  // Reviewed (user accepted as-is)
  { idx: 6,  prefix: 'p0007', state: 'reviewed', flags: ['meshConflict'],
    curveDeg: 11.2, conf: 0.62, pageNumber: '7' },
  // Flagged: mesh conflict (text-lines say one thing, edges another)
  { idx: 7,  prefix: 'p0008', state: 'flagged', flags: ['meshConflict', 'gutterMissed'],
    curveDeg: 14.6, conf: 0.58, pageNumber: '8' },
  { idx: 8,  prefix: 'p0009', state: 'clean',   curveDeg: 4.8,  conf: 0.96, pageNumber: '9' },
  // Skipped: illustration plate, no text lines
  { idx: 9,  prefix: 'p0010', state: 'skipped', flags: ['noText'],
    curveDeg: 7.1,  conf: 0.0,  pageNumber: '10', illust: true },
  { idx: 10, prefix: 'p0011', state: 'clean',   curveDeg: 5.5,  conf: 0.94, pageNumber: '11' },
  // Flagged: over-warp regression (output worse than input)
  { idx: 11, prefix: 'p0012', state: 'flagged', flags: ['overWarp'],
    curveDeg: 8.3,  conf: 0.71, pageNumber: '12' },
  // Reviewed
  { idx: 12, prefix: 'p0013', state: 'reviewed', flags: ['gutterMissed'],
    curveDeg: 10.1, conf: 0.66, pageNumber: '13' },
  { idx: 13, prefix: 'p0014', state: 'clean',   curveDeg: 3.9,  conf: 0.97, pageNumber: '14' },
  // Flagged: extreme curve again
  { idx: 14, prefix: 'p0015', state: 'flagged', flags: ['extremeCurve'],
    curveDeg: 19.7, conf: 0.69, pageNumber: '15' },
  // Still running — skeleton cards
  { idx: 15, prefix: 'p0016', state: 'running' },
  { idx: 16, prefix: 'p0017', state: 'running' },
  { idx: 17, prefix: 'p0018', state: 'running' },
];

// Totals — read across artboards as if the project had 387 pages.
const DEWARP_TOTALS_RUNNING = {
  total: 387, done: 142, flagged: 9, clean: 121, reviewed: 4, skipped: 6, errors: 0,
  running: 245, rateHz: 5.1, avgCurve: '8.6°',
};
const DEWARP_TOTALS_REVIEW = {
  total: 387, done: 387, flagged: 22, clean: 347, reviewed: 4, skipped: 14, errors: 0,
  running: 0, rateHz: 0, avgCurve: '8.9°',
};
const DEWARP_TOTALS_DONE = {
  total: 387, done: 387, flagged: 0, clean: 369, reviewed: 4, skipped: 14, errors: 0,
  running: 0, rateHz: 0, avgCurve: '8.9°',
};

// Per-flag counts for the filter drill-down chips (review state).
const DEWARP_FLAG_COUNTS = {
  lowConfidence: 8,
  extremeCurve:  5,
  meshConflict:  4,
  gutterMissed:  3,
  overWarp:      2,
  noText:        3, // 25 raw; some pages carry multiple — flagged is 22
};

Object.assign(window, {
  DEWARP_FLAGS, DEWARP_ROWS,
  DEWARP_TOTALS_RUNNING, DEWARP_TOTALS_REVIEW, DEWARP_TOTALS_DONE,
  DEWARP_FLAG_COUNTS,
});
