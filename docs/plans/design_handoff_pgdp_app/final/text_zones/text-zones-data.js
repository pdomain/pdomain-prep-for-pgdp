// text-zones-data.js — Text-zones stage (stage 9, OCR group) sample data.
// Layout detection: segments each page into typed zones (heading / body /
// running head+foot / marginalia / illustration / caption / table / footnote)
// and linearises a reading order — the structural map OCR reads against.
//
// The optional piece: when the detected layout looks like the scan is really
// TWO pages (independent columns side by side, or stacked top/bottom blocks),
// the stage offers a layout-driven PAGE SPLIT into child pages. Splitting
// here — not blindly — because layout detection is what actually finds the
// column gutter / row divider.
//
// per-page state:
//   running   — worker still segmenting
//   clean      — zones + reading order resolved, nothing flagged
//   flagged    — a layout check failed (review needed)
//   split      — a page split was suggested (lives in the Splits tab)
//   reviewed   — user inspected a flagged/split page and resolved it
//   failed     — worker errored
//
// layoutKind drives the zone template + thumbnail. split{} present on
// split-candidate pages.

const ZONE_TYPES = {
  heading:      { label: 'heading',      tone: 'var(--accent)' },
  body:         { label: 'body',         tone: 'var(--ocr)' },
  header:       { label: 'running head', tone: 'var(--gt)' },
  footer:       { label: 'running foot', tone: 'var(--gt)' },
  marginalia:   { label: 'marginalia',   tone: 'var(--fuzzy)' },
  illustration: { label: 'illustration', tone: 'var(--exact)' },
  caption:      { label: 'caption',      tone: 'var(--exact)' },
  table:        { label: 'table',        tone: 'var(--mismatch)' },
  footnote:     { label: 'footnote',     tone: 'var(--gt)' },
};

// Normalised zone templates per layout archetype: { type, x, y, w, h }
// (0..1 inside the page). order is the reading-order index.
const ZONE_TEMPLATES = {
  single: [
    { type: 'header',  x: .14, y: .05, w: .50, h: .035, order: 1 },
    { type: 'footer',  x: .42, y: .93, w: .16, h: .035, order: 99 },
    { type: 'heading', x: .14, y: .11, w: .56, h: .05,  order: 2 },
    { type: 'body',    x: .14, y: .19, w: .72, h: .70,  order: 3 },
  ],
  twoCol: [
    { type: 'header',  x: .12, y: .05, w: .50, h: .035, order: 1 },
    { type: 'footer',  x: .44, y: .93, w: .12, h: .035, order: 99 },
    { type: 'body',    x: .10, y: .11, w: .37, h: .80,  order: 2, col: 'L' },
    { type: 'body',    x: .53, y: .11, w: .37, h: .80,  order: 3, col: 'R' },
  ],
  rowSplit: [
    { type: 'heading', x: .14, y: .06, w: .50, h: .045, order: 1, row: 'T' },
    { type: 'body',    x: .14, y: .13, w: .72, h: .33,  order: 2, row: 'T' },
    { type: 'heading', x: .14, y: .54, w: .50, h: .045, order: 3, row: 'B' },
    { type: 'body',    x: .14, y: .61, w: .72, h: .31,  order: 4, row: 'B' },
  ],
  illustrated: [
    { type: 'header',       x: .14, y: .05, w: .50, h: .035, order: 1 },
    { type: 'body',         x: .14, y: .11, w: .72, h: .26,  order: 2 },
    { type: 'illustration', x: .22, y: .40, w: .56, h: .30,  order: 3 },
    { type: 'caption',      x: .30, y: .72, w: .40, h: .03,  order: 4 },
    { type: 'body',         x: .14, y: .78, w: .72, h: .13,  order: 5 },
  ],
  table: [
    { type: 'header',  x: .14, y: .05, w: .50, h: .035, order: 1 },
    { type: 'heading', x: .14, y: .11, w: .46, h: .045, order: 2 },
    { type: 'table',   x: .12, y: .19, w: .76, h: .58,  order: 3 },
    { type: 'body',    x: .14, y: .80, w: .72, h: .11,  order: 4 },
  ],
  footnoted: [
    { type: 'header',   x: .14, y: .05, w: .50, h: .035, order: 1 },
    { type: 'body',     x: .14, y: .11, w: .72, h: .62,  order: 2 },
    { type: 'footnote', x: .14, y: .78, w: .72, h: .14,  order: 3 },
  ],
};

const ZONE_FLAGS = {
  splitSuggested: { label: 'split?',       tone: 'var(--ocr)',      desc: 'Layout looks like two pages — a column or row split is offered' },
  readingOrder:   { label: 'reading-order',tone: 'var(--fuzzy)',    desc: 'Reading order across zones was ambiguous' },
  mergedBlocks:   { label: 'merged-blocks',tone: 'var(--mismatch)', desc: 'Two columns segmented as one block (under-segmented)' },
  strayZone:      { label: 'stray-zone',   tone: 'var(--gt)',       desc: 'A zone the classifier could not type (margin noise / smudge)' },
  tableDetected:  { label: 'table',        tone: 'var(--accent)',   desc: 'A table region needs structured handling downstream' },
  zoneOverlap:    { label: 'overlap',      tone: 'var(--mismatch)', desc: 'Two zones overlap — segmentation conflict' },
};

const ZONE_ROWS = [
  { idx: 0,  prefix: 'p0001', state: 'clean', layoutKind: 'single',   pageNumber: '1',  zones: 4, paras: 9,  lines: 38, words: 312 },
  { idx: 1,  prefix: 'p0002', state: 'clean', layoutKind: 'single',   pageNumber: '2',  zones: 4, paras: 8,  lines: 36, words: 298 },
  // Split candidate: two independent columns (really two pages)
  { idx: 2,  prefix: 'p0003', state: 'split', layoutKind: 'twoCol',   pageNumber: '3',  zones: 4, paras: 12, lines: 64, words: 540,
    flags: ['splitSuggested'], split: { axis: 'col', conf: 0.88, into: 2, gutter: 0.50 } },
  { idx: 3,  prefix: 'p0004', state: 'clean', layoutKind: 'illustrated', pageNumber: '4', zones: 5, paras: 6,  lines: 22, words: 180 },
  // Flagged: merged blocks (two columns read as one)
  { idx: 4,  prefix: 'p0005', state: 'flagged', layoutKind: 'twoCol', pageNumber: '5',  zones: 3, paras: 10, lines: 60, words: 505,
    flags: ['mergedBlocks', 'readingOrder'] },
  { idx: 5,  prefix: 'p0006', state: 'clean', layoutKind: 'single',   pageNumber: '6',  zones: 4, paras: 9,  lines: 37, words: 305 },
  // Split candidate: stacked top/bottom (two articles on one leaf)
  { idx: 6,  prefix: 'p0007', state: 'split', layoutKind: 'rowSplit', pageNumber: '7',  zones: 4, paras: 11, lines: 52, words: 430,
    flags: ['splitSuggested'], split: { axis: 'row', conf: 0.74, into: 2, gutter: 0.50 } },
  // Flagged: table detected
  { idx: 7,  prefix: 'p0008', state: 'flagged', layoutKind: 'table',  pageNumber: '8',  zones: 4, paras: 3,  lines: 28, words: 210,
    flags: ['tableDetected'] },
  { idx: 8,  prefix: 'p0009', state: 'clean', layoutKind: 'footnoted', pageNumber: '9', zones: 3, paras: 7,  lines: 41, words: 360 },
  // Reviewed split (already resolved → split applied)
  { idx: 9,  prefix: 'p0010', state: 'reviewed', layoutKind: 'twoCol', pageNumber: '10', zones: 4, paras: 12, lines: 66, words: 548,
    flags: ['splitSuggested'], split: { axis: 'col', conf: 0.91, into: 2, gutter: 0.49, applied: true } },
  { idx: 10, prefix: 'p0011', state: 'clean', layoutKind: 'single',   pageNumber: '11', zones: 4, paras: 8,  lines: 35, words: 290 },
  // Flagged: stray zone (unclassified smudge)
  { idx: 11, prefix: 'p0012', state: 'flagged', layoutKind: 'single', pageNumber: '12', zones: 5, paras: 9,  lines: 38, words: 300,
    flags: ['strayZone'] },
  // Split candidate: two columns, lower confidence
  { idx: 12, prefix: 'p0013', state: 'split', layoutKind: 'twoCol',   pageNumber: '13', zones: 4, paras: 12, lines: 62, words: 520,
    flags: ['splitSuggested'], split: { axis: 'col', conf: 0.63, into: 2, gutter: 0.51 } },
  { idx: 13, prefix: 'p0014', state: 'clean', layoutKind: 'illustrated', pageNumber: '14', zones: 5, paras: 5, lines: 19, words: 150 },
  // Flagged: zone overlap
  { idx: 14, prefix: 'p0015', state: 'flagged', layoutKind: 'footnoted', pageNumber: '15', zones: 4, paras: 8, lines: 44, words: 372,
    flags: ['zoneOverlap', 'readingOrder'] },
  { idx: 15, prefix: 'p0016', state: 'running' },
  { idx: 16, prefix: 'p0017', state: 'running' },
  { idx: 17, prefix: 'p0018', state: 'running' },
];

const ZONE_TOTALS_RUNNING = {
  total: 387, done: 176, flagged: 9, clean: 158, splits: 4, reviewed: 5, errors: 0,
  running: 211, rateHz: 6.8, zonesAvg: 4.2,
};
const ZONE_TOTALS_REVIEW = {
  total: 387, done: 387, flagged: 16, clean: 358, splits: 7, reviewed: 6, errors: 0,
  running: 0, rateHz: 0, zonesAvg: 4.3,
};
const ZONE_TOTALS_DONE = {
  total: 387, done: 387, flagged: 0, clean: 374, splits: 7, reviewed: 13, errors: 0,
  running: 0, rateHz: 0, zonesAvg: 4.3,
};

const ZONE_FLAG_COUNTS = {
  splitSuggested: 7,
  readingOrder:   5,
  mergedBlocks:   3,
  tableDetected:  3,
  strayZone:      2,
  zoneOverlap:    2, // 22 raw; some pages carry multiple — flagged is 16 (+7 split)
};

// Zone-type distribution across the book (for Overview).
const ZONE_TYPE_COUNTS = {
  body: 612, heading: 198, header: 372, footer: 358, marginalia: 41,
  illustration: 54, caption: 49, table: 12, footnote: 88,
};

Object.assign(window, {
  ZONE_TYPES, ZONE_TEMPLATES, ZONE_FLAGS, ZONE_ROWS,
  ZONE_TOTALS_RUNNING, ZONE_TOTALS_REVIEW, ZONE_TOTALS_DONE,
  ZONE_FLAG_COUNTS, ZONE_TYPE_COUNTS,
});
