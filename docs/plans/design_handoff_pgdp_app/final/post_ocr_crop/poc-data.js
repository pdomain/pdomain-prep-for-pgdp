// poc-data.js — Post-OCR crop (stage 13, Compose group) sample data.
// The third and final content crop. Runs after OCR + layout are known, so it
// can crop to the TRUE content extent — the union of the text-block, kept
// marginalia (sidenotes, folio), and any illustration zones — instead of
// guessing from page edges. Trims dead margin precisely without clipping real
// content. Feeds Canvas map, which then normalises everything to one canvas.
//
// contentBox: normalized bbox (t/r/b/l) of detected content (text + zones).
// crop:       the proposed crop bbox (usually contentBox + small padding).
// side:       'verso' | 'recto' — which side marginalia sits on (outer margin).

const POC_FLAGS = {
  contentTight:  { label: 'content-tight',  tone: 'var(--mismatch)', desc: 'Proposed crop bit into the text-block bbox' },
  wideMargin:    { label: 'wide-margin',    tone: 'var(--ocr)',      desc: 'Large empty margin OCR confirms is blank — crop could go tighter' },
  marginaliaClip:{ label: 'sidenote-clip',  tone: 'var(--fuzzy)',    desc: 'Crop would clip a detected sidenote / marginalia in the outer margin' },
  strayMark:     { label: 'stray-mark',     tone: 'var(--gt)',       desc: 'Isolated mark outside the main block — keep (folio) or drop (noise)?' },
  noText:        { label: 'no-text',        tone: 'var(--gt)',       desc: 'No OCR text — crop to the illustration zone instead' },
  skewedBlock:   { label: 'skewed-block',   tone: 'var(--fuzzy)',    desc: 'Text block not square to the page — content bbox is loose' },
};

const POC_ROWS = [
  { idx: 0,  prefix: 'p0001', state: 'clean', pageNumber: '1',  side: 'recto',
    contentBox: { t:.12, r:.16, b:.13, l:.16 }, crop: { t:.09, r:.12, b:.10, l:.12 } },
  { idx: 1,  prefix: 'p0002', state: 'clean', pageNumber: '2',  side: 'verso',
    contentBox: { t:.12, r:.16, b:.13, l:.16 }, crop: { t:.09, r:.12, b:.10, l:.12 } },
  { idx: 2,  prefix: 'p0003', state: 'clean', pageNumber: '3',  side: 'recto',
    contentBox: { t:.12, r:.16, b:.13, l:.16 }, crop: { t:.09, r:.12, b:.10, l:.12 } },
  // Flagged: content-tight (crop into text)
  { idx: 3,  prefix: 'p0004', state: 'flagged', flags: ['contentTight'], pageNumber: '4', side: 'verso',
    contentBox: { t:.12, r:.16, b:.13, l:.16 }, crop: { t:.15, r:.19, b:.16, l:.19 } },
  // Flagged: sidenote on the outer (left/verso) margin would be clipped
  { idx: 4,  prefix: 'p0005', state: 'flagged', flags: ['marginaliaClip'], pageNumber: '5', side: 'verso',
    contentBox: { t:.12, r:.16, b:.13, l:.05 }, crop: { t:.10, r:.13, b:.11, l:.18 }, sidenote: 'L' },
  { idx: 5,  prefix: 'p0006', state: 'clean', pageNumber: '6',  side: 'recto',
    contentBox: { t:.12, r:.16, b:.13, l:.16 }, crop: { t:.09, r:.12, b:.10, l:.12 } },
  // Reviewed: wide margin accepted (tightened)
  { idx: 6,  prefix: 'p0007', state: 'reviewed', flags: ['wideMargin'], pageNumber: '7', side: 'verso',
    contentBox: { t:.18, r:.30, b:.20, l:.20 }, crop: { t:.15, r:.26, b:.17, l:.17 } },
  // Flagged: stray mark (a folio number out in the margin)
  { idx: 7,  prefix: 'p0008', state: 'flagged', flags: ['strayMark'], pageNumber: '8', side: 'recto',
    contentBox: { t:.12, r:.16, b:.13, l:.16 }, crop: { t:.09, r:.12, b:.10, l:.12 }, stray: 'br' },
  { idx: 8,  prefix: 'p0009', state: 'clean', pageNumber: '9',  side: 'verso',
    contentBox: { t:.12, r:.16, b:.13, l:.16 }, crop: { t:.09, r:.12, b:.10, l:.12 } },
  // Flagged: no text — illustration page
  { idx: 9,  prefix: 'p0010', state: 'flagged', flags: ['noText'], pageNumber: '10', side: 'recto', illust: true,
    contentBox: { t:.16, r:.18, b:.20, l:.18 }, crop: { t:.13, r:.15, b:.17, l:.15 } },
  { idx: 10, prefix: 'p0011', state: 'clean', pageNumber: '11', side: 'verso',
    contentBox: { t:.12, r:.16, b:.13, l:.16 }, crop: { t:.09, r:.12, b:.10, l:.12 } },
  // Flagged: sidenote on outer (right/recto) margin
  { idx: 11, prefix: 'p0012', state: 'flagged', flags: ['marginaliaClip'], pageNumber: '12', side: 'recto',
    contentBox: { t:.12, r:.05, b:.13, l:.16 }, crop: { t:.10, r:.18, b:.11, l:.13 }, sidenote: 'R' },
  { idx: 12, prefix: 'p0013', state: 'reviewed', flags: ['skewedBlock'], pageNumber: '13', side: 'verso',
    contentBox: { t:.12, r:.16, b:.13, l:.16 }, crop: { t:.09, r:.12, b:.10, l:.12 } },
  { idx: 13, prefix: 'p0014', state: 'clean', pageNumber: '14', side: 'recto',
    contentBox: { t:.12, r:.16, b:.13, l:.16 }, crop: { t:.09, r:.12, b:.10, l:.12 } },
  // Flagged: content-tight at the foot (folio sat just below the block)
  { idx: 14, prefix: 'p0015', state: 'flagged', flags: ['contentTight', 'strayMark'], pageNumber: '15', side: 'verso',
    contentBox: { t:.12, r:.16, b:.08, l:.16 }, crop: { t:.10, r:.13, b:.16, l:.13 }, stray: 'bl' },
  { idx: 15, prefix: 'p0016', state: 'running' },
  { idx: 16, prefix: 'p0017', state: 'running' },
  { idx: 17, prefix: 'p0018', state: 'running' },
];

const POC_TOTALS_RUNNING = {
  total: 387, cropped: 221, flagged: 10, clean: 205, reviewed: 6, errors: 0,
  running: 166, rateHz: 10.4, avgTrim: '7.8%',
};
const POC_TOTALS_REVIEW = {
  total: 387, cropped: 387, flagged: 19, clean: 360, reviewed: 8, errors: 0,
  running: 0, rateHz: 0, avgTrim: '8.2%',
};
const POC_TOTALS_DONE = {
  total: 387, cropped: 387, flagged: 0, clean: 379, reviewed: 8, errors: 0,
  running: 0, rateHz: 0, avgTrim: '8.2%',
};

const POC_FLAG_COUNTS = {
  marginaliaClip: 6,
  contentTight:   5,
  strayMark:      4,
  wideMargin:     2,
  skewedBlock:    2,
  noText:         2, // 21 raw; some pages carry multiple — flagged is 19
};

Object.assign(window, {
  POC_FLAGS, POC_ROWS, POC_TOTALS_RUNNING, POC_TOTALS_REVIEW, POC_TOTALS_DONE, POC_FLAG_COUNTS,
});
