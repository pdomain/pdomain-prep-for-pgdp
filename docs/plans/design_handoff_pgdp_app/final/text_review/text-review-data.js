// text-review-data.js — Text review stage (stage 16, Text group) sample data.
// The human proofing pass. After Wordcheck auto-flags scannos and a human
// clears that queue, Text review is the LAST human gate before packaging:
// a person reads each flagged page against the final composited image,
// approves it, edits it, or leaves a comment for the team to discuss.
//
// Works on the FINAL cropped + canvas-mapped pages (post Canvas map), so the
// page renders show the uniform-canvas composited look, not raw scans.
//
// per-page review state: clean | pending | approved | discuss | running
//   clean    — nothing flagged; auto-passed, no human needed
//   pending  — in the review queue, awaiting a human
//   approved — a reviewer signed it off
//   discuss  — a reviewer opened a question; needs team discussion

/* ---------------------- reason taxonomy ----------------------
   Why a page entered the human queue. Carried concerns from upstream
   (held scannos, low-score words) plus human-raised ones (layout, markup,
   open comments). */
const TR_REASONS = {
  heldScanno: { label: 'held scanno',  tone: 'var(--mismatch)', desc: 'A Wordcheck suspect the auto-step could not resolve — needs a human eye' },
  lowScore:   { label: 'low-score',    tone: 'var(--fuzzy)',    desc: 'OCR scored a word low; confirm it against the scan' },
  layout:     { label: 'layout',       tone: 'var(--ocr)',      desc: 'Paragraphing, footnote or poetry structure to confirm' },
  markup:     { label: 'markup',       tone: 'var(--gt)',       desc: 'Italics / small-caps / heading to confirm' },
  comment:    { label: 'open comment', tone: 'var(--accent)',   desc: 'A reviewer raised a question for the team' },
};

/* ---------------------- reviewers ----------------------
   The team working this book. Initials avatars (no person icon in the set). */
const TR_REVIEWERS = [
  { id: 'MO', name: 'M. Okafor',   hue: 'var(--exact)',    assigned: 14, done: 11 },
  { id: 'JL', name: 'J. Lindqvist', hue: 'var(--ocr)',     assigned: 11, done: 6 },
  { id: 'RP', name: 'R. Patel',    hue: 'var(--accent)',   assigned: 6,  done: 2 },
];

/* Per-page review state. `concerns` = open items on the page; `reasons` =
   which kinds; `reviewer` = who signed it off (approved) or owns it. */
const TR_ROWS = [
  { idx: 0,  prefix: 'p0001', state: 'approved', pageNumber: '1',  folio: 'i',   concerns: 0, reviewer: 'MO' },
  { idx: 1,  prefix: 'p0002', state: 'clean',    pageNumber: '2',  folio: 'ii',  concerns: 0 },
  { idx: 2,  prefix: 'p0003', state: 'approved', pageNumber: '3',  folio: '1',   concerns: 0, reviewer: 'MO' },
  { idx: 3,  prefix: 'p0004', state: 'pending',  pageNumber: '4',  folio: '2',   concerns: 3, reasons: ['heldScanno', 'lowScore'], reviewer: 'MO' },
  { idx: 4,  prefix: 'p0005', state: 'discuss',  pageNumber: '5',  folio: '3',   concerns: 2, reasons: ['heldScanno', 'comment'], reviewer: 'JL' },
  { idx: 5,  prefix: 'p0006', state: 'clean',    pageNumber: '6',  folio: '4',   concerns: 0 },
  { idx: 6,  prefix: 'p0007', state: 'pending',  pageNumber: '7',  folio: '5',   concerns: 2, reasons: ['layout'], reviewer: 'JL' },
  { idx: 7,  prefix: 'p0008', state: 'discuss',  pageNumber: '8',  folio: '6',   concerns: 1, reasons: ['comment'], reviewer: 'RP' },
  { idx: 8,  prefix: 'p0009', state: 'approved', pageNumber: '9',  folio: '7',   concerns: 0, reviewer: 'MO' },
  { idx: 9,  prefix: 'p0010', state: 'pending',  pageNumber: '10', folio: '8',   concerns: 4, reasons: ['lowScore', 'markup'], reviewer: 'JL' },
  { idx: 10, prefix: 'p0011', state: 'clean',    pageNumber: '11', folio: '9',   concerns: 0 },
  { idx: 11, prefix: 'p0012', state: 'pending',  pageNumber: '12', folio: '10',  concerns: 2, reasons: ['heldScanno'], reviewer: 'RP' },
  { idx: 12, prefix: 'p0013', state: 'approved', pageNumber: '13', folio: '11',  concerns: 0, reviewer: 'JL' },
  { idx: 13, prefix: 'p0014', state: 'clean',    pageNumber: '14', folio: '12',  concerns: 0 },
  { idx: 14, prefix: 'p0015', state: 'discuss',  pageNumber: '15', folio: '13',  concerns: 3, reasons: ['layout', 'comment'], reviewer: 'MO' },
  { idx: 15, prefix: 'p0016', state: 'pending',  pageNumber: '16', folio: '14',  concerns: 1, reasons: ['markup'], reviewer: 'MO' },
  { idx: 16, prefix: 'p0017', state: 'approved', pageNumber: '17', folio: '15',  concerns: 0, reviewer: 'JL' },
  { idx: 17, prefix: 'p0018', state: 'pending',  pageNumber: '18', folio: '16',  concerns: 2, reasons: ['lowScore'], reviewer: 'RP' },
];

/* ---------------------- the Review queue (hero) ----------------------
   One row per open concern awaiting a human. Excerpt shown in context with
   the word in question marked; `note` is what to check; `action` is the
   suggested resolution. Status: open | approved | discuss. */
const TR_QUEUE = [
  { id: 'q1',  page: 'p0004', folio: '2',  line: 12, reason: 'heldScanno', ctxL: 'across the', word: 'modem', ctxR: 'world of men', suggest: 'modern', note: 'Wordcheck unsure — rn/m on rough type', status: 'open', reviewer: 'MO', comments: 0 },
  { id: 'q2',  page: 'p0004', folio: '2',  line: 19, reason: 'lowScore',   ctxL: 'the salt', word: 'estuary', ctxR: 'at dawn', suggest: null, note: 'OCR score 71% — confirm spelling', status: 'open', reviewer: 'MO', comments: 0 },
  { id: 'q3',  page: 'p0005', folio: '3',  line: 4,  reason: 'heldScanno', ctxL: 'on that', word: 'dav', ctxR: 'we set out', suggest: 'day', note: 'y/v swap — looks right but kept by policy', status: 'discuss', reviewer: 'JL', comments: 2 },
  { id: 'q4',  page: 'p0005', folio: '3',  line: 22, reason: 'comment',    ctxL: 'a quotation in', word: 'Greek', ctxR: 'follows here', suggest: null, note: 'JL: is the Greek transliterated or kept as-is?', status: 'discuss', reviewer: 'JL', comments: 3 },
  { id: 'q5',  page: 'p0007', folio: '5',  line: 1,  reason: 'layout',     ctxL: '', word: 'running head', ctxR: '', suggest: null, note: 'Confirm header is dropped, not part of the body', status: 'open', reviewer: 'JL', comments: 0 },
  { id: 'q6',  page: 'p0007', folio: '5',  line: 28, reason: 'layout',     ctxL: 'see footnote', word: '*', ctxR: 'below', suggest: null, note: 'Footnote anchor — does it bind to the right note?', status: 'open', reviewer: 'JL', comments: 1 },
  { id: 'q7',  page: 'p0010', folio: '8',  line: 9,  reason: 'lowScore',   ctxL: 'we stood', word: 'together', ctxR: 'at last', suggest: null, note: 'Joined from "to gether" upstream — verify', status: 'open', reviewer: 'JL', comments: 0 },
  { id: 'q8',  page: 'p0010', folio: '8',  line: 14, reason: 'markup',     ctxL: 'the title', word: 'Survivals', ctxR: 'was printed', suggest: null, note: 'Italic run — confirm extent of the emphasis', status: 'open', reviewer: 'JL', comments: 0 },
  { id: 'q9',  page: 'p0012', folio: '10', line: 31, reason: 'heldScanno', ctxL: 'across the', word: 'tlie', ctxR: 'wide moor', suggest: 'the', note: 'h/li — low score, auto-fix not applied', status: 'open', reviewer: 'RP', comments: 0 },
  { id: 'q10', page: 'p0015', folio: '13', line: 6,  reason: 'comment',    ctxL: 'a stanza of', word: 'verse', ctxR: 'begins here', suggest: null, note: 'MO: keep original line breaks for the poem?', status: 'discuss', reviewer: 'MO', comments: 4 },
  { id: 'q11', page: 'p0015', folio: '13', line: 18, reason: 'layout',     ctxL: '', word: 'block quote', ctxR: '', suggest: null, note: 'Indented quotation — mark as /* … */?', status: 'open', reviewer: 'MO', comments: 0 },
  { id: 'q12', page: 'p0016', folio: '14', line: 22, reason: 'markup',     ctxL: 'small-caps', word: 'CHAPTER II', ctxR: 'heading', suggest: null, note: 'Confirm small-caps vs full caps in source', status: 'open', reviewer: 'MO', comments: 0 },
];

/* ---------------------- comment threads ----------------------
   The discussion layer. Anchored to a page + excerpt. Open vs resolved. */
const TR_COMMENTS = [
  { id: 'c1', page: 'p0005', folio: '3',  anchor: 'a quotation in Greek follows here', author: 'J. Lindqvist', initials: 'JL', hue: 'var(--ocr)', time: '14 min ago', body: 'There is a short Greek phrase mid-paragraph. PGDP guideline is to keep it as-is and let the Greek round get it — should we leave a [Greek] note?', status: 'open', replies: 2 },
  { id: 'c2', page: 'p0015', folio: '13', anchor: 'a stanza of verse begins here', author: 'M. Okafor', initials: 'MO', hue: 'var(--exact)', time: '38 min ago', body: 'Poem spans two pages. Proposing we preserve the original line breaks and indent with /* */ rather than reflowing. Agree?', status: 'open', replies: 3 },
  { id: 'c3', page: 'p0008', folio: '6',  anchor: 'the printer\u2019s ornament', author: 'R. Patel', initials: 'RP', hue: 'var(--accent)', time: '1 hr ago', body: 'Decorative ornament between sections — drop it from the text and let Illustrations pick it up, yes?', status: 'open', replies: 1 },
  { id: 'c4', page: 'p0005', folio: '3',  anchor: 'on that dav we set out', author: 'M. Okafor', initials: 'MO', hue: 'var(--exact)', time: '1 hr ago', body: 'dav → day is obviously right; the held flag is just policy on y/v swaps. Approving.', status: 'resolved', replies: 0 },
  { id: 'c5', page: 'p0002', folio: 'ii', anchor: 'half-title verso', author: 'J. Lindqvist', initials: 'JL', hue: 'var(--ocr)', time: '2 hr ago', body: 'Blank verso — marked [Blank Page] per the formatting guide.', status: 'resolved', replies: 0 },
];

/* ---------------------- totals ---------------------- */
const TR_TOTALS_RUNNING = {
  total: 387, done: 214, clean: 196, pending: 14, approved: 4, discuss: 0,
  queue: 18, comments: 2, running: 173, rateHz: 18.0,
};
const TR_TOTALS_REVIEW = {
  total: 387, done: 387, clean: 332, pending: 31, approved: 19, discuss: 5,
  queue: 31, comments: 5, commentsOpen: 3, running: 0, rateHz: 0,
};
const TR_TOTALS_DONE = {
  total: 387, done: 387, clean: 332, pending: 0, approved: 55, discuss: 0,
  queue: 0, comments: 5, commentsOpen: 0, running: 0, rateHz: 0,
};

// reason distribution across the open queue (for the Overview chart)
const TR_REASON_COUNTS = { heldScanno: 9, lowScore: 8, layout: 7, markup: 4, comment: 3 };

Object.assign(window, {
  TR_REASONS, TR_REVIEWERS, TR_ROWS, TR_QUEUE, TR_COMMENTS,
  TR_TOTALS_RUNNING, TR_TOTALS_REVIEW, TR_TOTALS_DONE, TR_REASON_COUNTS,
});
