// ptc-data.js — Post-transform crop (stage 7, Image group) sample data.
// Runs after dewarp + deskew. The geometric transforms move the page: deskew
// rotation leaves triangular black wedges in the corners, dewarp resampling
// softens the edges, and the true page rectangle has shifted. This pass
// re-crops the now-flat, now-square bilevel page tight to its real edges and
// trims the transform artifacts the Rough crop couldn't have known about.
//
// per-page state: running | clean | flagged | reviewed | failed
// bbox: normalized inset (t/r/b/l) of the tightened crop on the transformed
// page. corner: which corners carry rotation wedges (for the thumb).

const PTC_FLAGS = {
  rotationCorner: { label: 'rot-corner',   tone: 'var(--mismatch)', desc: 'Triangular black wedge left by the deskew rotation' },
  resampleBorder: { label: 'soft-border',  tone: 'var(--ocr)',      desc: 'Soft / grey fringe along an edge from dewarp resampling' },
  looseAfterFlat: { label: 'loose',        tone: 'var(--fuzzy)',    desc: 'Page edges shifted after flattening — crop now too generous' },
  overCropped:    { label: 'over-crop',    tone: 'var(--mismatch)', desc: 'Tightened crop bit into the text block' },
  edgeResidual:   { label: 'edge-residual',tone: 'var(--fuzzy)',    desc: 'Leftover scanner edge the rough crop missed, now exposed' },
  skewResidual:   { label: 'skew-residual',tone: 'var(--gt)',       desc: 'Tiny residual tilt — edges not perfectly axis-aligned yet' },
};

const PTC_ROWS = [
  { idx: 0,  prefix: 'p0001', state: 'clean',   bbox: { t:.05, r:.06, b:.05, l:.06 }, pageNumber: '1' },
  { idx: 1,  prefix: 'p0002', state: 'clean',   bbox: { t:.05, r:.06, b:.05, l:.06 }, pageNumber: '2' },
  { idx: 2,  prefix: 'p0003', state: 'clean',   bbox: { t:.05, r:.06, b:.05, l:.06 }, pageNumber: '3' },
  // Flagged: rotation corner wedge (deskew rotated ~3°)
  { idx: 3,  prefix: 'p0004', state: 'flagged', flags: ['rotationCorner'],
    bbox: { t:.04, r:.05, b:.04, l:.05 }, pageNumber: '4', corners: ['tl', 'br'], rot: 3.1 },
  // Flagged: rotation corner + edge residual
  { idx: 4,  prefix: 'p0005', state: 'flagged', flags: ['rotationCorner', 'edgeResidual'],
    bbox: { t:.03, r:.04, b:.03, l:.04 }, pageNumber: '5', corners: ['tr', 'bl'], rot: 4.2 },
  { idx: 5,  prefix: 'p0006', state: 'clean',   bbox: { t:.05, r:.06, b:.05, l:.06 }, pageNumber: '6' },
  // Reviewed: soft resample border accepted
  { idx: 6,  prefix: 'p0007', state: 'reviewed', flags: ['resampleBorder'],
    bbox: { t:.05, r:.07, b:.05, l:.07 }, pageNumber: '7' },
  // Flagged: over-cropped into text
  { idx: 7,  prefix: 'p0008', state: 'flagged', flags: ['overCropped'],
    bbox: { t:.10, r:.12, b:.10, l:.12 }, pageNumber: '8' },
  { idx: 8,  prefix: 'p0009', state: 'clean',   bbox: { t:.05, r:.06, b:.05, l:.06 }, pageNumber: '9' },
  // Flagged: loose after flatten (dewarp expanded the page)
  { idx: 9,  prefix: 'p0010', state: 'flagged', flags: ['looseAfterFlat'],
    bbox: { t:.02, r:.03, b:.02, l:.03 }, pageNumber: '10' },
  { idx: 10, prefix: 'p0011', state: 'clean',   bbox: { t:.05, r:.06, b:.05, l:.06 }, pageNumber: '11' },
  // Flagged: residual skew (not perfectly square)
  { idx: 11, prefix: 'p0012', state: 'flagged', flags: ['skewResidual', 'resampleBorder'],
    bbox: { t:.05, r:.06, b:.05, l:.06 }, pageNumber: '12', rot: 0.8 },
  { idx: 12, prefix: 'p0013', state: 'reviewed', flags: ['edgeResidual'],
    bbox: { t:.04, r:.05, b:.05, l:.05 }, pageNumber: '13' },
  { idx: 13, prefix: 'p0014', state: 'clean',   bbox: { t:.05, r:.06, b:.05, l:.06 }, pageNumber: '14' },
  // Flagged: rotation corner (heavier)
  { idx: 14, prefix: 'p0015', state: 'flagged', flags: ['rotationCorner'],
    bbox: { t:.06, r:.07, b:.06, l:.07 }, pageNumber: '15', corners: ['tl', 'tr', 'bl', 'br'], rot: 5.4 },
  { idx: 15, prefix: 'p0016', state: 'running' },
  { idx: 16, prefix: 'p0017', state: 'running' },
  { idx: 17, prefix: 'p0018', state: 'running' },
];

const PTC_TOTALS_RUNNING = {
  total: 387, cropped: 198, flagged: 11, clean: 180, reviewed: 5, errors: 0,
  running: 189, rateHz: 12.1, avgTrim: '3.1%',
};
const PTC_TOTALS_REVIEW = {
  total: 387, cropped: 387, flagged: 21, clean: 359, reviewed: 7, errors: 0,
  running: 0, rateHz: 0, avgTrim: '3.4%',
};
const PTC_TOTALS_DONE = {
  total: 387, cropped: 387, flagged: 0, clean: 380, reviewed: 7, errors: 0,
  running: 0, rateHz: 0, avgTrim: '3.4%',
};

const PTC_FLAG_COUNTS = {
  rotationCorner: 8,
  resampleBorder: 5,
  edgeResidual:   4,
  looseAfterFlat: 3,
  skewResidual:   2,
  overCropped:    1, // 23 raw; some pages carry multiple — flagged is 21
};

Object.assign(window, {
  PTC_FLAGS, PTC_ROWS, PTC_TOTALS_RUNNING, PTC_TOTALS_REVIEW, PTC_TOTALS_DONE, PTC_FLAG_COUNTS,
});
