// ocr-data.js — OCR stage (stage 10, OCR group) sample data.
// Recognises glyphs → tokens on the binarized + zoned pages. Each page gets a
// mean confidence, word/line counts, and a set of low-confidence tokens that
// surface for review. The Recognition tab overlays the recognised words on the
// page image, coloured by confidence.
//
// per-page state: running | clean | flagged | reviewed | failed
// meanConf 0..1 ; lowConf = count of words below the threshold.

// Engines. DocTR (your model) is primary and GPU-backed with a CPU fallback;
// Tesseract is the secondary fallback. Each engine carries its OWN config
// (models + languages), so the settings panel swaps when you change engine.
const OCR_ENGINES = {
  doctr: {
    id: 'doctr', name: 'DocTR', kind: 'primary', tag: 'your model',
    blurb: 'In-house DocTR model. GPU-accelerated (CUDA) with a CPU fallback.',
    backends: true,                       // GPU/CPU split applies
    perPageGpuSec: 0.42, perPageCpuSec: 5.8,
    config: {
      detModel: ['db_resnet50', 'db_mobilenet_v3_large', 'linknet_resnet18', 'book-edges-v1 · HF'],
      recModel: ['crnn_vgg16_bn', 'parseq', 'master', 'english-books-v2 · HF'],
      lang:     ['Latin · eng/fra/lat', 'Greek · grc', 'Multilingual'],
    },
    // Advanced: specific detection + recognition checkpoints, incl. custom
    // weights pulled from the Hugging Face hub. recog default is our English
    // book-corpus fine-tune.
    weights: {
      detect: [
        { name: 'db_resnet50',           source: 'built-in',    note: 'default · general' },
        { name: 'db_mobilenet_v3_large', source: 'built-in',    note: 'fast · lower VRAM' },
        { name: 'linknet_resnet18',      source: 'built-in',    note: 'dense / small text' },
        { name: 'book-edges-v1',         source: 'huggingface', repo: 'pgdp/doctr-book-edges',  note: 'tuned on book page scans' },
      ],
      recog: [
        { name: 'crnn_vgg16_bn',         source: 'built-in',    note: 'stock default' },
        { name: 'parseq',                source: 'built-in',    note: 'robust · slower' },
        { name: 'master',                source: 'built-in',    note: 'transformer' },
        { name: 'english-books-v2',      source: 'huggingface', repo: 'pgdp/doctr-eng-books-v2', note: 'custom · English book corpus', active: true },
      ],
    },
  },
  tesseract: {
    id: 'tesseract', name: 'Tesseract 5.3', kind: 'fallback', tag: 'fallback',
    blurb: 'LSTM engine, CPU-only. Used when DocTR is unavailable or per page.',
    backends: false,                      // CPU only
    perPageCpuSec: 1.9,
    config: {
      langpack: ['eng', 'eng + grc', 'fra', 'lat', 'Custom traineddata…'],
      psm:      ['Auto (3)', 'Single column (4)', 'Single block (6)'],
    },
  },
};
// Default effective engine (used by banner / overview / recognition copy).
const OCR_ENGINE = { name: 'DocTR', model: 'db_resnet50 + crnn_vgg16_bn', psm: 'From zones', backend: 'GPU · CUDA' };

// Page-level overrides of the stage engine/model — for multilingual books or
// the odd page that needs a different model (e.g. Greek). Pages inherit the
// stage config unless listed here.
const OCR_OVERRIDES = [
  { pages: 'p0008',         count: 1, engine: 'doctr',     lang: 'Greek · grc',          reason: 'Greek epigraph' },
  { pages: 'p0140 – p0148', count: 9, engine: 'doctr',     lang: 'Greek · grc',          reason: 'Appendix B · Greek quotations' },
  { pages: 'p0203',         count: 1, engine: 'doctr',     lang: 'Multilingual',         reason: 'Latin + Greek footnotes' },
  { pages: 'p0212',         count: 1, engine: 'tesseract', lang: 'lat',                  reason: 'fallback · DocTR low score' },
];

const OCR_FLAGS = {
  lowConfidence: { label: 'low-score',   tone: 'var(--fuzzy)',    desc: 'Words the model scored below the threshold — worth a proof' },
  garbledRun:    { label: 'garbled',     tone: 'var(--mismatch)', desc: 'A run of tokens reads as gibberish — likely a bad region' },
  dictMiss:      { label: 'dict-miss',   tone: 'var(--ocr)',      desc: 'Words not in the lexicon (names, archaic spellings, OCR errors)' },
  mixedScript:   { label: 'mixed-script',tone: 'var(--gt)',       desc: 'More than one script detected (e.g. Latin + Greek)' },
  rotatedText:   { label: 'rotated',     tone: 'var(--gt)',       desc: 'A text block runs vertically / rotated (sidebar, table head)' },
  noTextFound:   { label: 'no-text',     tone: 'var(--ink-4)',    desc: 'No recognisable text — illustration or blank page' },
};

const OCR_ROWS = [
  { idx: 0,  prefix: 'p0001', state: 'clean',   pageNumber: '1',  meanConf: 0.984, words: 312, lines: 38, lowConf: 2,  lang: 'eng' },
  { idx: 1,  prefix: 'p0002', state: 'clean',   pageNumber: '2',  meanConf: 0.978, words: 298, lines: 36, lowConf: 3,  lang: 'eng' },
  { idx: 2,  prefix: 'p0003', state: 'clean',   pageNumber: '3',  meanConf: 0.981, words: 305, lines: 37, lowConf: 2,  lang: 'eng' },
  // Flagged: low confidence (faded ink)
  { idx: 3,  prefix: 'p0004', state: 'flagged', flags: ['lowConfidence'], pageNumber: '4', meanConf: 0.872, words: 289, lines: 35, lowConf: 24, lang: 'eng' },
  // Flagged: garbled run + dict miss
  { idx: 4,  prefix: 'p0005', state: 'flagged', flags: ['garbledRun', 'dictMiss'], pageNumber: '5', meanConf: 0.804, words: 276, lines: 34, lowConf: 41, lang: 'eng' },
  { idx: 5,  prefix: 'p0006', state: 'clean',   pageNumber: '6',  meanConf: 0.976, words: 301, lines: 37, lowConf: 4,  lang: 'eng' },
  // Reviewed: dict miss (proper names) accepted
  { idx: 6,  prefix: 'p0007', state: 'reviewed', flags: ['dictMiss'], pageNumber: '7', meanConf: 0.945, words: 264, lines: 33, lowConf: 12, lang: 'eng' },
  // Flagged: mixed script (a Greek epigraph) — overridden to a Greek model
  { idx: 7,  prefix: 'p0008', state: 'flagged', flags: ['mixedScript'], pageNumber: '8', meanConf: 0.918, words: 251, lines: 32, lowConf: 16, lang: 'eng + grc', override: { engine: 'doctr', label: 'grc', lang: 'Greek · grc' } },
  { idx: 8,  prefix: 'p0009', state: 'clean',   pageNumber: '9',  meanConf: 0.972, words: 308, lines: 38, lowConf: 5,  lang: 'eng' },
  // Flagged: no text (illustration plate)
  { idx: 9,  prefix: 'p0010', state: 'flagged', flags: ['noTextFound'], pageNumber: '10', meanConf: 0.0, words: 0, lines: 0, lowConf: 0, lang: '—', illust: true },
  { idx: 10, prefix: 'p0011', state: 'clean',   pageNumber: '11', meanConf: 0.969, words: 296, lines: 36, lowConf: 6,  lang: 'eng' },
  // Flagged: rotated text (a vertical sidebar)
  { idx: 11, prefix: 'p0012', state: 'flagged', flags: ['rotatedText'], pageNumber: '12', meanConf: 0.931, words: 271, lines: 35, lowConf: 14, lang: 'eng' },
  { idx: 12, prefix: 'p0013', state: 'reviewed', flags: ['lowConfidence'], pageNumber: '13', meanConf: 0.889, words: 283, lines: 35, lowConf: 19, lang: 'eng' },
  { idx: 13, prefix: 'p0014', state: 'clean',   pageNumber: '14', meanConf: 0.974, words: 300, lines: 37, lowConf: 5,  lang: 'eng' },
  // Flagged: garbled run (ink-bleed region survived)
  { idx: 14, prefix: 'p0015', state: 'flagged', flags: ['garbledRun'], pageNumber: '15', meanConf: 0.842, words: 268, lines: 34, lowConf: 33, lang: 'eng' },
  { idx: 15, prefix: 'p0016', state: 'running' },
  { idx: 16, prefix: 'p0017', state: 'running' },
  { idx: 17, prefix: 'p0018', state: 'running' },
];

// Recognised lines for the Recognition tab (p0005 — a flagged page).
// conf per word; low-conf words carry a suggestion.
const OCR_SAMPLE_LINES = [
  { words: [['The', .99], ['ancient', .98], ['mariner', .97], ['stoppeth', .94], ['one', .99], ['of', .99], ['three.', .96]] },
  { words: [['By', .99], ['thy', .97], ['long', .98], ['grey', .62, 'gray'], ['beard', .96], ['and', .99], ['glittering', .91], ['eye,', .95]] },
  { words: [['Now', .98], ['wherefore', .88], ['stopp', .41, "stopp'st"], ['thou', .97], ['me?', .96]] },
  { words: [['The', .99], ['Bridegrooms', .58, "Bridegroom's"], ['doors', .94], ['are', .99], ['opened', .93], ['wide,', .95]] },
  { words: [['And', .99], ['l', .38, 'I'], ['am', .98], ['next', .96], ['of', .99], ['kin;', .90]] },
  { words: [['The', .99], ['guests', .95], ['are', .99], ['met,', .94], ['the', .99], ['feast', .96], ['is', .99], ['set:', .92]] },
  { words: [['May', .97], ['st', .44, "May'st"], ['hear', .95], ['the', .99], ['merry', .96], ['din.', .89]] },
];

const OCR_LOWCONF_TOKENS = [
  { word: 'grey',        conf: .62, suggest: 'gray',       line: 2 },
  { word: 'stopp',       conf: .41, suggest: "stopp'st",   line: 3 },
  { word: "Bridegrooms", conf: .58, suggest: "Bridegroom's",line: 4 },
  { word: 'l',           conf: .38, suggest: 'I',          line: 5 },
  { word: 'st',          conf: .44, suggest: "May'st",     line: 7 },
];

const OCR_TOTALS_RUNNING = {
  total: 387, done: 188, flagged: 9, clean: 174, reviewed: 5, errors: 0,
  running: 199, rateHz: 3.2, meanConf: 0.958, words: '71.2k', lowConfWords: 412,
};
const OCR_TOTALS_REVIEW = {
  total: 387, done: 387, flagged: 18, clean: 362, reviewed: 7, errors: 0,
  running: 0, rateHz: 0, meanConf: 0.961, words: '118.4k', lowConfWords: 968,
};
const OCR_TOTALS_DONE = {
  total: 387, done: 387, flagged: 0, clean: 380, reviewed: 7, errors: 0,
  running: 0, rateHz: 0, meanConf: 0.961, words: '118.4k', lowConfWords: 968,
};

const OCR_FLAG_COUNTS = {
  lowConfidence: 7,
  dictMiss:      5,
  garbledRun:    4,
  rotatedText:   3,
  mixedScript:   2,
  noTextFound:   2, // 23 raw; some pages carry multiple — flagged is 18
};

// Confidence histogram buckets (share of words), 50%..100%.
const OCR_CONF_HIST = [0.01, 0.02, 0.03, 0.05, 0.09, 0.8]; // last bucket = 95-100%

Object.assign(window, {
  OCR_ENGINE, OCR_ENGINES, OCR_OVERRIDES, OCR_FLAGS, OCR_ROWS, OCR_SAMPLE_LINES, OCR_LOWCONF_TOKENS,
  OCR_TOTALS_RUNNING, OCR_TOTALS_REVIEW, OCR_TOTALS_DONE, OCR_FLAG_COUNTS, OCR_CONF_HIST,
});
