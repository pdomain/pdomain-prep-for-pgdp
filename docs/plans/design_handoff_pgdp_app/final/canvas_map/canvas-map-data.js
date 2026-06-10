// canvas-map-data.js — Canvas map (stage 14, Compose group) sample data.
// The final composition step. Places every cropped page onto ONE common
// canvas: derives a common aspect ratio from the pages that are mostly body
// text, centres each page's content, and adds uniform margins — with special
// handling for page-split children (rebuild the cut-edge margin) and for
// facing-page sidenotes (widen + mirror the OUTER margin across verso/recto).

// Derived common canvas — taken from the body-text cluster, not the outliers.
const COMMON_CANVAS = {
  w: 2480, h: 3400, ratioWH: 2480 / 3400, ratioLabel: '0.729 (≈ 5 : 6.86)',
  bodyPages: 312, outliers: 41, dpi: 300,
  marginsMM: { top: 16, outer: 20, bottom: 18, inner: 14 }, // outer/inner mirror on facing pages
};

// Page-dimension scatter for the aspect analysis. Body cluster is tight near
// the common ratio; outliers (plates, title, foldouts) sit away from it.
// x = width index, y = height index (schematic 0..1), body flag.
const ASPECT_POINTS = (() => {
  const pts = [];
  // tight body cluster
  for (let i = 0; i < 26; i++) {
    pts.push({ x: 0.52 + (Math.sin(i * 2.3) * 0.05), y: 0.60 + (Math.cos(i * 1.7) * 0.05), body: true });
  }
  // outliers
  [[0.30, 0.45], [0.78, 0.42], [0.66, 0.85], [0.40, 0.80], [0.85, 0.66], [0.24, 0.66], [0.72, 0.30], [0.46, 0.34]]
    .forEach(([x, y]) => pts.push({ x, y, body: false }));
  return pts;
})();

const CMAP_FLAGS = {
  splitChild:     { label: 'split-child',    tone: 'var(--ocr)',      desc: 'Page came from a column/row split — the cut edge has no natural margin, so it is rebuilt' },
  sidenote:       { label: 'sidenote',       tone: 'var(--fuzzy)',    desc: 'Marginalia in the outer margin — that margin is widened and mirrored across the spread' },
  oversize:       { label: 'oversize',       tone: 'var(--mismatch)', desc: 'Content larger than the common canvas — scale down to fit or exclude' },
  aspectOutlier:  { label: 'aspect-outlier', tone: 'var(--gt)',       desc: 'Page aspect far from the common ratio (plate / foldout) — fit within, do not stretch' },
  marginTight:    { label: 'margin-tight',   tone: 'var(--mismatch)', desc: 'Content sits too close to a canvas edge after placement' },
  facingMismatch: { label: 'facing-mismatch',tone: 'var(--fuzzy)',    desc: 'Verso / recto margins do not mirror — the spread reads lopsided' },
};

// margins: { t, o, b, i } = top, outer, bottom, inner (as fraction of canvas).
const CMAP_ROWS = [
  { idx: 0,  prefix: 'p0001', state: 'clean', pageNumber: '1',  side: 'recto', margins: { t:.05, o:.06, b:.055, i:.04 } },
  { idx: 1,  prefix: 'p0002', state: 'clean', pageNumber: '2',  side: 'verso', margins: { t:.05, o:.06, b:.055, i:.04 } },
  // Split child (from a column split) — inner cut margin rebuilt
  { idx: 2,  prefix: 'p0003a', state: 'flagged', flags: ['splitChild'], pageNumber: '3', side: 'recto', split: 'col',
    margins: { t:.05, o:.06, b:.055, i:.01 } },
  { idx: 3,  prefix: 'p0003b', state: 'flagged', flags: ['splitChild'], pageNumber: '4', side: 'verso', split: 'col',
    margins: { t:.05, o:.06, b:.055, i:.01 } },
  // Sidenote page — outer margin widened (verso → left)
  { idx: 4,  prefix: 'p0005', state: 'flagged', flags: ['sidenote'], pageNumber: '5', side: 'verso', sidenote: 'L',
    margins: { t:.05, o:.13, b:.055, i:.04 } },
  { idx: 5,  prefix: 'p0006', state: 'clean', pageNumber: '6',  side: 'recto', margins: { t:.05, o:.06, b:.055, i:.04 } },
  // Reviewed: aspect outlier (full-page plate)
  { idx: 6,  prefix: 'p0007', state: 'reviewed', flags: ['aspectOutlier'], pageNumber: '7', side: 'verso', illust: true,
    margins: { t:.08, o:.10, b:.08, i:.09 } },
  // Oversize content
  { idx: 7,  prefix: 'p0008', state: 'flagged', flags: ['oversize'], pageNumber: '8', side: 'recto',
    margins: { t:.01, o:.015, b:.01, i:.01 } },
  { idx: 8,  prefix: 'p0009', state: 'clean', pageNumber: '9',  side: 'verso', margins: { t:.05, o:.06, b:.055, i:.04 } },
  // Sidenote page — outer margin widened (recto → right)
  { idx: 9,  prefix: 'p0010', state: 'flagged', flags: ['sidenote'], pageNumber: '10', side: 'recto', sidenote: 'R',
    margins: { t:.05, o:.13, b:.055, i:.04 } },
  { idx: 10, prefix: 'p0011', state: 'clean', pageNumber: '11', side: 'verso', margins: { t:.05, o:.06, b:.055, i:.04 } },
  // Facing mismatch — verso/recto margins don't mirror
  { idx: 11, prefix: 'p0012', state: 'flagged', flags: ['facingMismatch'], pageNumber: '12', side: 'verso',
    margins: { t:.05, o:.045, b:.055, i:.075 } },
  { idx: 12, prefix: 'p0013', state: 'reviewed', flags: ['marginTight'], pageNumber: '13', side: 'recto',
    margins: { t:.02, o:.025, b:.02, i:.02 } },
  { idx: 13, prefix: 'p0014', state: 'clean', pageNumber: '14', side: 'verso', margins: { t:.05, o:.06, b:.055, i:.04 } },
  // Split child (row split)
  { idx: 14, prefix: 'p0015a', state: 'flagged', flags: ['splitChild'], pageNumber: '15', side: 'recto', split: 'row',
    margins: { t:.01, o:.06, b:.055, i:.04 } },
  { idx: 15, prefix: 'p0016', state: 'running' },
  { idx: 16, prefix: 'p0017', state: 'running' },
  { idx: 17, prefix: 'p0018', state: 'running' },
];

// Facing-page spreads (verso|recto) for the Spreads tab.
const CMAP_SPREADS = [
  { id: 'sp-1', verso: 'p0002', recto: 'p0003', mirror: true,  sidenote: null, note: 'standard spread · margins mirror' },
  { id: 'sp-2', verso: 'p0005', recto: 'p0006', mirror: true,  sidenote: 'verso', note: 'sidenote on verso · outer (left) margin widened both sides' },
  { id: 'sp-3', verso: 'p0009', recto: 'p0010', mirror: true,  sidenote: 'recto', note: 'sidenote on recto · outer (right) margin widened both sides' },
  { id: 'sp-4', verso: 'p0012', recto: 'p0013', mirror: false, sidenote: null, note: 'facing-mismatch · inner margins do not align' },
];

const CMAP_TOTALS_RUNNING = {
  total: 387, placed: 240, flagged: 9, clean: 226, reviewed: 5, splits: 7, sidenotes: 18,
  running: 147, rateHz: 16.2,
};
const CMAP_TOTALS_REVIEW = {
  total: 387, placed: 387, flagged: 17, clean: 363, reviewed: 7, splits: 7, sidenotes: 31,
  running: 0, rateHz: 0,
};
const CMAP_TOTALS_DONE = {
  total: 387, placed: 387, flagged: 0, clean: 380, reviewed: 7, splits: 7, sidenotes: 31,
  running: 0, rateHz: 0,
};

const CMAP_FLAG_COUNTS = {
  sidenote:       8,
  splitChild:     7,
  aspectOutlier:  5,
  oversize:       3,
  facingMismatch: 2,
  marginTight:    2, // 27 raw; some pages carry multiple — flagged is 17
};

Object.assign(window, {
  COMMON_CANVAS, ASPECT_POINTS, CMAP_FLAGS, CMAP_ROWS, CMAP_SPREADS,
  CMAP_TOTALS_RUNNING, CMAP_TOTALS_REVIEW, CMAP_TOTALS_DONE, CMAP_FLAG_COUNTS,
});
