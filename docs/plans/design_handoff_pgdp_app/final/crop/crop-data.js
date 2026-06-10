// crop-data.js — Crop-stage sample data.
// 15 cropped pages + 3 still-cropping skeletons. Mixed flags so the review
// grid shows realistic content (under-crop, over-crop, asymmetric,
// overflow, deskew-fail, loose, near-edge).
//
// per-page state:
//   running  — worker still cropping; no bbox yet
//   clean    — auto-crop passed all checks
//   flagged  — auto-crop ran but failed one or more checks (review needed)
//   reviewed — user reviewed a flagged page and accepted as-is
//   failed   — worker errored on this page
//
// bbox is normalized to the source image (0..1, t/r/b/l). The deviations
// from a "centered" bbox are what makes flagged thumbs look off in the grid.

const CROP_FLAGS = {
  over:       { label: 'over-crop',  tone: 'var(--mismatch)', desc: 'Crop bites into the page block' },
  under:      { label: 'under-crop', tone: 'var(--ocr)',      desc: 'Margins still include scanner shadow' },
  loose:      { label: 'loose',      tone: 'var(--ocr)',      desc: 'Bbox larger than typical for this run' },
  asymmetric: { label: 'asymmetric', tone: 'var(--gt)',       desc: 'Left/right or top/bottom margins differ by >12%' },
  overflow:   { label: 'overflow',   tone: 'var(--mismatch)', desc: 'Bbox extends past source image edge' },
  deskewFail: { label: 'deskew·fail',tone: 'var(--fuzzy)',    desc: 'Could not infer skew angle confidently' },
  nearEdge:   { label: 'near-edge',  tone: 'var(--fuzzy)',    desc: 'Bbox within 1.5% of source edge' },
  finger:     { label: 'finger',     tone: 'var(--mismatch)', desc: 'Detected hand / jig artifact in margin' },
};

// 15 reviewed pages, sprinkled with flags.
// bbox: { t, r, b, l } in normalized 0..1 inset from the source image.
const CROP_ROWS = [
  // Clean pages
  { idx: 0,  prefix: 'p0001', state: 'clean',   bbox: { t:.07, r:.10, b:.07, l:.10 }, pageNumber: '1', tone: 'light' },
  { idx: 1,  prefix: 'p0002', state: 'clean',   bbox: { t:.07, r:.10, b:.07, l:.10 }, pageNumber: '2', tone: 'light' },
  { idx: 2,  prefix: 'p0003', state: 'clean',   bbox: { t:.07, r:.10, b:.07, l:.10 }, pageNumber: '3', tone: 'light' },
  // Flagged: under-crop (margins too generous — scanner shadow visible)
  { idx: 3,  prefix: 'p0004', state: 'flagged', flags: ['under'],
    bbox: { t:.03, r:.04, b:.03, l:.04 }, pageNumber: '4', tone: 'light' },
  // Flagged: over-crop, asymmetric (left margin eaten)
  { idx: 4,  prefix: 'p0005', state: 'flagged', flags: ['over', 'asymmetric'],
    bbox: { t:.09, r:.07, b:.09, l:.22 }, pageNumber: '5', tone: 'light' },
  // Clean
  { idx: 5,  prefix: 'p0006', state: 'clean',   bbox: { t:.08, r:.10, b:.07, l:.10 }, pageNumber: '6', tone: 'light' },
  // Reviewed (user accepted as-is)
  { idx: 6,  prefix: 'p0007', state: 'reviewed', flags: ['loose'],
    bbox: { t:.05, r:.06, b:.05, l:.06 }, pageNumber: '7', tone: 'light' },
  // Flagged: overflow (bbox extends past source)
  { idx: 7,  prefix: 'p0008', state: 'flagged', flags: ['overflow', 'nearEdge'],
    bbox: { t:.01, r:.02, b:.01, l:.02 }, pageNumber: '8', tone: 'light' },
  { idx: 8,  prefix: 'p0009', state: 'clean',   bbox: { t:.07, r:.10, b:.08, l:.10 }, pageNumber: '9', tone: 'light' },
  // Flagged: deskew failed
  { idx: 9,  prefix: 'p0010', state: 'flagged', flags: ['deskewFail'],
    bbox: { t:.07, r:.09, b:.07, l:.10 }, pageNumber: '10', tone: 'light', skewDeg: 3.2 },
  { idx: 10, prefix: 'p0011', state: 'clean',   bbox: { t:.07, r:.10, b:.07, l:.10 }, pageNumber: '11', tone: 'light' },
  // Flagged: finger detected in margin
  { idx: 11, prefix: 'p0012', state: 'flagged', flags: ['finger', 'nearEdge'],
    bbox: { t:.06, r:.04, b:.07, l:.10 }, pageNumber: '12', tone: 'light' },
  // Reviewed
  { idx: 12, prefix: 'p0013', state: 'reviewed', flags: ['asymmetric'],
    bbox: { t:.07, r:.06, b:.07, l:.16 }, pageNumber: '13', tone: 'light' },
  { idx: 13, prefix: 'p0014', state: 'clean',   bbox: { t:.07, r:.10, b:.07, l:.10 }, pageNumber: '14', tone: 'light' },
  // Flagged: over-crop, loose
  { idx: 14, prefix: 'p0015', state: 'flagged', flags: ['over'],
    bbox: { t:.13, r:.14, b:.12, l:.14 }, pageNumber: '15', tone: 'light' },
  // Still cropping (running) — skeleton cards
  { idx: 15, prefix: 'p0016', state: 'running' },
  { idx: 16, prefix: 'p0017', state: 'running' },
  { idx: 17, prefix: 'p0018', state: 'running' },
];

// Counts shown in banners — lie slightly so totals read across artboards as
// if the project had 387 pages (matches Source totals).
const CROP_TOTALS_RUNNING = {
  total:    387,
  cropped:  285,
  flagged:  18,
  clean:    248,
  reviewed: 6,
  errors:   1,
  running:  102,
  rateHz:   8.4,
  avgMargin: '9.2%',
};
const CROP_TOTALS_REVIEW = {
  total:    387,
  cropped:  387,
  flagged:  31,
  clean:    349,
  reviewed: 7,
  errors:   0,
  running:  0,
  rateHz:   0,
  avgMargin: '9.4%',
};
const CROP_TOTALS_DONE = {
  total:    387,
  cropped:  387,
  flagged:  0,
  clean:    380,
  reviewed: 7,
  errors:   0,
  running:  0,
  rateHz:   0,
  avgMargin: '9.4%',
};

// Per-flag counts for filter chips on the Pages tab (review state).
const CROP_FLAG_COUNTS = {
  over:       9,
  under:      4,
  asymmetric: 7,
  overflow:   3,
  deskewFail: 2,
  nearEdge:   5,
  loose:      1,
  finger:     1, // 32 raw; some pages have multiple — flagged is 31
};

Object.assign(window, {
  CROP_FLAGS, CROP_ROWS,
  CROP_TOTALS_RUNNING, CROP_TOTALS_REVIEW, CROP_TOTALS_DONE,
  CROP_FLAG_COUNTS,
});
