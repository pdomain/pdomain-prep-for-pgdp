// scanno-data.js — Scannocheck stage (stage 12, OCR group) sample data.
// Catches "scannos" — OCR scan errors — in the recognised text. Two kinds
// matter: ordinary scannos that produce a non-word (caught by the lexicon),
// and STEALTH scannos that produce a real but wrong word (e.g. he→be,
// arid→and) that a plain spellcheck sails past — caught by scanno patterns +
// context. Suspects are queued for the proofer; clean text flows on.
//
// per-page state: running | clean | flagged | reviewed | failed
// suspects = count of flagged tokens on the page.

const SCANNO_TYPES = {
  substitution: { label: 'substitution', tone: 'var(--mismatch)', desc: 'Char-swap scanno producing a non-word (rn→m, cl→d, l→1)' },
  stealth:      { label: 'stealth',      tone: 'var(--fuzzy)',    desc: 'Produces a REAL but wrong word — passes a plain spellcheck' },
  splitWord:    { label: 'split-word',   tone: 'var(--ocr)',      desc: 'One word wrongly broken in two (to gether)' },
  joinedWord:   { label: 'joined-word',  tone: 'var(--ocr)',      desc: 'Two words run together (ofthe)' },
  dictMiss:     { label: 'dict-miss',    tone: 'var(--gt)',       desc: 'Not in the lexicon — may be a name / archaism, not an error' },
  punct:        { label: 'punctuation',  tone: 'var(--gt)',       desc: 'Stray or garbled punctuation (,, ;. “ unmatched)' },
};

// Per-page suspect counts. meanScore = OCR score for the page's suspects.
const SCANNO_ROWS = [
  { idx: 0,  prefix: 'p0001', state: 'clean',   pageNumber: '1',  suspects: 0,  words: 312 },
  { idx: 1,  prefix: 'p0002', state: 'clean',   pageNumber: '2',  suspects: 1,  words: 298, kinds: ['dictMiss'] },
  { idx: 2,  prefix: 'p0003', state: 'clean',   pageNumber: '3',  suspects: 0,  words: 305 },
  // Flagged: substitution scannos (rn→m etc.)
  { idx: 3,  prefix: 'p0004', state: 'flagged', pageNumber: '4',  suspects: 9,  words: 289, kinds: ['substitution', 'stealth'] },
  { idx: 4,  prefix: 'p0005', state: 'flagged', pageNumber: '5',  suspects: 14, words: 276, kinds: ['substitution', 'joinedWord'] },
  { idx: 5,  prefix: 'p0006', state: 'clean',   pageNumber: '6',  suspects: 1,  words: 301, kinds: ['dictMiss'] },
  // Reviewed
  { idx: 6,  prefix: 'p0007', state: 'reviewed', pageNumber: '7', suspects: 4,  words: 264, kinds: ['stealth'] },
  // Flagged: stealth scannos (real words, wrong)
  { idx: 7,  prefix: 'p0008', state: 'flagged', pageNumber: '8',  suspects: 6,  words: 251, kinds: ['stealth', 'punct'] },
  { idx: 8,  prefix: 'p0009', state: 'clean',   pageNumber: '9',  suspects: 0,  words: 308 },
  // Flagged: split / joined words
  { idx: 9,  prefix: 'p0010', state: 'flagged', pageNumber: '10', suspects: 7,  words: 297, kinds: ['splitWord', 'joinedWord'] },
  { idx: 10, prefix: 'p0011', state: 'clean',   pageNumber: '11', suspects: 1,  words: 296, kinds: ['dictMiss'] },
  { idx: 11, prefix: 'p0012', state: 'flagged', pageNumber: '12', suspects: 5,  words: 271, kinds: ['substitution'] },
  { idx: 12, prefix: 'p0013', state: 'reviewed', pageNumber: '13', suspects: 8, words: 283, kinds: ['substitution', 'stealth'] },
  { idx: 13, prefix: 'p0014', state: 'clean',   pageNumber: '14', suspects: 0,  words: 300 },
  { idx: 14, prefix: 'p0015', state: 'flagged', pageNumber: '15', suspects: 11, words: 268, kinds: ['substitution', 'punct'] },
  { idx: 15, prefix: 'p0016', state: 'running' },
  { idx: 16, prefix: 'p0017', state: 'running' },
  { idx: 17, prefix: 'p0018', state: 'running' },
];

// The Suspects queue — one row per flagged token. before/after show the
// suspect word and the proposed fix; ctxL / ctxR are the surrounding words.
const SCANNO_SUSPECTS = [
  { id: 's1', page: 'p0004', line: 12, type: 'substitution', word: 'modem',  fix: 'modern',  ctxL: 'a far',         ctxR: 'reader would', score: 0.71, rule: 'rn → m' },
  { id: 's2', page: 'p0004', line: 19, type: 'stealth',      word: 'arid',   fix: 'and',     ctxL: 'the salt',      ctxR: 'the sea',     score: 0.93, rule: 'stealth list', note: 'real word — caught by context' },
  { id: 's3', page: 'p0005', line: 4,  type: 'substitution', word: 'dav',    fix: 'day',     ctxL: 'on that',       ctxR: 'we set',      score: 0.64, rule: 'y → v' },
  { id: 's4', page: 'p0005', line: 22, type: 'joinedWord',   word: 'ofthe',  fix: 'of the',  ctxL: 'the edge',      ctxR: 'world',       score: 0.80, rule: 'split run-on' },
  { id: 's5', page: 'p0008', line: 7,  type: 'stealth',      word: 'be',     fix: 'he',      ctxL: 'and then',      ctxR: 'spoke',       score: 0.88, rule: 'stealth list', note: 'real word — caught by context' },
  { id: 's6', page: 'p0008', line: 15, type: 'punct',        word: '";',     fix: ';”',      ctxL: 'all is well',   ctxR: 'cried she',  score: 0.59, rule: 'quote / semicolon order' },
  { id: 's7', page: 'p0010', line: 9,  type: 'splitWord',    word: 'to gether', fix: 'together', ctxL: 'we stood',  ctxR: 'at last',     score: 0.77, rule: 'join split' },
  { id: 's8', page: 'p0012', line: 31, type: 'substitution', word: 'tlie',   fix: 'the',     ctxL: 'across',        ctxR: 'wide moor',   score: 0.55, rule: 'h → li' },
];

const SCANNO_TOTALS_RUNNING = {
  total: 387, done: 192, flagged: 7, clean: 180, reviewed: 5, errors: 0, suspects: 72, stealth: 14,
  running: 195, rateHz: 41.0,
};
const SCANNO_TOTALS_REVIEW = {
  total: 387, done: 387, flagged: 16, clean: 364, reviewed: 7, errors: 0, suspects: 146, stealth: 31,
  running: 0, rateHz: 0,
};
const SCANNO_TOTALS_DONE = {
  total: 387, done: 387, flagged: 0, clean: 380, reviewed: 7, errors: 0, suspects: 146, stealth: 31,
  running: 0, rateHz: 0,
};

const SCANNO_TYPE_COUNTS = {
  substitution: 58,
  stealth:      31,
  joinedWord:   22,
  splitWord:    17,
  punct:        12,
  dictMiss:     6, // 146 suspects total
};

// Word-list builder candidates — ranked good/bad word recommendations with
// the evidence behind each (MVP signal mix: in-book frequency, OCR score,
// edit-distance near-miss, NER / gazetteer, stealth-context). Each is a
// recommendation a human accepts/rejects; accepted entries write the per-book
// good_words / bad_words lists, and confirmed ones can promote to the library.
const LIST_CANDIDATES = [
  // ----- good-word candidates (stop flagging) -----
  { id: 'g1', list: 'good', token: 'Belloc',     norm: 'belloc',     count: 41, score: 0.97, rank: 0.96,
    ev: ['×41 · every chapter', 'NER · PERSON', 'caps consistent', 'OCR 97%'], note: "author surname" },
  { id: 'g2', list: 'good', token: 'Bacalôa',    norm: 'bacaloa',    count: 6,  score: 0.88, rank: 0.9,
    ev: ['×6', 'GeoNames hit · place', 'diacritic form', 'OCR 88%'], note: 'place name · add â form' },
  { id: 'g3', list: 'good', token: 'colour',     norm: 'colour',     count: 23, score: 0.96, rank: 0.88,
    ev: ['×23', 'lemma family · colour/-ed/-s', 'British spelling', 'OCR 96%'], note: 'period spelling' },
  { id: 'g4', list: 'good', token: 'Thrasymene', norm: 'thrasymene', count: 3,  score: 0.82, rank: 0.74,
    ev: ['×3', 'gazetteer · classical place', 'caps consistent', 'OCR 82%'], note: 'classical toponym' },
  { id: 'g5', list: 'good', token: "o'erbrimming", norm: 'oerbrimming', count: 1, score: 0.79, rank: 0.46,
    ev: ['×1 · hapax', 'morph · o’er + brimming', 'OCR 79%'], note: 'poetic · review' },
  // ----- bad-word candidates (always flag) -----
  { id: 'b1', list: 'bad', token: 'tlie',  fix: 'the',     norm: 'tlie',  count: 5, score: 0.55, rank: 0.95,
    ev: ['×5', 'edit-dist 1 · the', 'rule li→h', 'OCR 55%'], rule: 'li → h' },
  { id: 'b2', list: 'bad', token: 'modem', fix: 'modern',  norm: 'modem', count: 3, score: 0.71, rank: 0.86,
    ev: ['×3', 'edit-dist 1 · modern', 'rule rn→m', 'OCR 71%'], rule: 'rn → m' },
  { id: 'b3', list: 'bad', token: 'arid',  fix: 'and',     norm: 'arid',  count: 4, score: 0.93, rank: 0.82, stealth: true,
    ev: ['×4', 'real word', 'stealth list', 'bad context vs “and”'], rule: 'stealth · arid/and' },
  { id: 'b4', list: 'bad', token: 'ofthe', fix: 'of the',  norm: 'ofthe', count: 7, score: 0.80, rank: 0.8,
    ev: ['×7', 'joined run-on', 'splits to 2 dict words', 'OCR 80%'], rule: 'split joined' },
  { id: 'b5', list: 'bad', token: 'dav',   fix: 'day',     norm: 'dav',   count: 2, score: 0.64, rank: 0.62,
    ev: ['×2', 'edit-dist 1 · day', 'rule y→v', 'OCR 64%'], rule: 'y → v' },
];
const LIST_TOTALS = { good: 5, bad: 5, accepted: 0, promoted: 0, bookGood: 38, bookBad: 64, libraryGood: '12.4k', libraryBad: '3.1k' };

Object.assign(window, {
  SCANNO_TYPES, SCANNO_ROWS, SCANNO_SUSPECTS, LIST_CANDIDATES, LIST_TOTALS,
  SCANNO_TOTALS_RUNNING, SCANNO_TOTALS_REVIEW, SCANNO_TOTALS_DONE, SCANNO_TYPE_COUNTS,
});
