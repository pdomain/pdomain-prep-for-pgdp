// pr-data.js — Page roles & numbering ("Runs") sample data.
//
// Models the book as an ORDERED LIST OF NUMBERING RUNS. Each run is a
// contiguous span of leaves in scan order that shares a numbering style
// (roman / arabic / none), a start value, and a step. Roles (text page /
// plate / blank / cover) are a property of each leaf. This is the data the
// "Runs" tab edits; the existing Sequence tab reconciles OCR folios against
// the labels these runs compute.
//
// The three cases the model has to handle cleanly:
//   1. [Blank Page]      — a blank that PARTICIPATES (kept in scan order,
//                          excluded from the run, emits "[Blank Page]").
//   2. unnumbered plate  — illustration leaf outside any arabic run, with a
//      + facing blank      facing blank whose side (recto/verso) matters.
//   3. renumbering       — N runs, incl. a publisher's catalogue bound to the
//                          back with its OWN sequence (arabic 1…).

/* ---------- role taxonomy (per leaf) ---------- */
const PR_ROLES = {
  text:  { label: 'Text page',    short: 'text',   tone: 'var(--exact)',    icon: 'file',  desc: 'Bilevel + OCR. Carries a number from its run.' },
  plate: { label: 'Plate',        short: 'plate',  tone: 'var(--fuzzy)',    icon: 'image', desc: 'Grayscale photo, no OCR. Usually unnumbered.' },
  blank: { label: '[Blank Page]', short: 'blank',  tone: 'var(--ink-3)',    icon: 'file',  desc: 'Kept in order, emits the [Blank Page] marker.' },
  skip:  { label: 'Skip',         short: 'skip',   tone: 'var(--gt)',       icon: 'x',     desc: 'Cover / endpaper. Dropped — not in the book.' },
};

/* ---------- numbering styles ---------- */
const PR_STYLES = {
  'roman-lower': { label: 'roman · lower', sample: 'i, ii, iii' },
  'roman-upper': { label: 'roman · upper', sample: 'I, II, III' },
  'arabic':      { label: 'arabic',        sample: '1, 2, 3' },
  'alpha':       { label: 'letter',        sample: 'A, B, C' },
  'none':        { label: 'unnumbered',    sample: '—' },
};

/* ---------- the runs (ordered, scan order) ----------
   span = [firstScan, lastScan] inclusive. count = leaves the run labels.
   start MODE: 'set' (explicit `start` value) or 'continue' (pick up the
   previous numbering run's last number + step, while staying a SEPARATE
   run). `lastNum` is the run's final arabic label, used to resolve a
   following run that continues. */
const PR_RUNS = [
  { id: 'cover',    label: 'Cover & endpapers',     style: 'none',        startMode: 'set',      start: '—', step: 0, role: 'skip',  span: [1, 4],     count: 4,   tone: 'var(--gt)',     computed: 'dropped',          note: 'Front + back cover, pastedowns.' },
  { id: 'front',    label: 'Front matter',          style: 'roman-lower', startMode: 'set',      start: 'i', step: 1, role: 'text',  span: [5, 16],    count: 12,  lastNum: null, tone: 'var(--ocr)',    computed: 'i – xii',          note: 'Half-title, title, preface, contents.' },
  { id: 'body',     label: 'Body',                  style: 'arabic',      startMode: 'set',      start: '1', step: 1, role: 'text',  span: [17, 326],  count: 310, lastNum: 310,  tone: 'var(--exact)',  computed: '1 – 310',          note: '12 plates interleaved — held out of the count.' },
  { id: 'plates',   label: 'Plates',                style: 'none',        startMode: 'set',      start: '—', step: 0, role: 'plate', span: null,       count: 12,  tone: 'var(--fuzzy)',  computed: 'unnumbered',       note: 'Interleaved in the body; each faces a blank.' },
  { id: 'appendix', label: 'Appendix',              style: 'arabic',      startMode: 'continue', start: '311', step: 1, role: 'text', span: [327, 360], count: 30,  lastNum: 340,  tone: 'color-mix(in oklab, var(--exact) 55%, var(--accent))', computed: '311 – 340 · cont', note: 'Same arabic sequence as the body — kept as its own run.' },
  { id: 'cat',      label: "Publisher's catalogue", style: 'arabic',      startMode: 'set',      start: '1', step: 1, role: 'text',  span: [363, 378], count: 16,  lastNum: 16,   tone: 'var(--accent)', computed: '1 – 16 · own seq',  note: 'Bound to the back. Restarts at 1.' },
];

/* ---------- resolve a run's effective start value ----------
   For a 'continue' run, walk back to the nearest preceding numbering run
   that has a numeric last label and pick up at lastNum + step. Returns the
   display value plus, for continue, the run it continues from. */
function PR_startInfo(run, runs) {
  if (run.startMode !== 'continue') return { mode: 'set', display: run.start };
  const idx = runs.indexOf(run);
  for (let i = idx - 1; i >= 0; i--) {
    const p = runs[i];
    if (p.style !== 'none' && typeof p.lastNum === 'number') {
      return { mode: 'continue', from: p.label, display: String(p.lastNum + (run.step || 1)) };
    }
  }
  return { mode: 'continue', display: run.start };
}

/* ---------- leaf slices (scan order) for the table / outline ----------
   A representative window around the two interesting boundaries: a plate +
   facing blank inside the body, and the body→catalogue renumber. */
const PR_LEAVES_PLATE = [
  { scan: 134, role: 'text',  folio: '112', label: '112',          run: 'body' },
  { scan: 135, role: 'text',  folio: '113', label: '113',          run: 'body' },
  { scan: 136, role: 'plate', folio: null,  label: '—',            run: 'plates', tag: 'Plate VIII', note: 'faces p. 113 · recto', flag: 'unnumbered' },
  { scan: 137, role: 'blank', folio: null,  label: '[Blank Page]', run: null,     note: 'verso of plate', flag: 'marker' },
  { scan: 138, role: 'text',  folio: '114', label: '114',          run: 'body' },
  { scan: 139, role: 'text',  folio: '115', label: '115',          run: 'body' },
];
const PR_LEAVES_CAT = [
  { scan: 359, role: 'text',  folio: '339', label: '339',          run: 'body' },
  { scan: 360, role: 'text',  folio: '340', label: '340',          run: 'body' },
  { scan: 361, role: 'blank', folio: null,  label: '[Blank Page]', run: null,    note: 'end of body' },
  { scan: 362, role: 'skip',  folio: null,  label: '—',            run: 'cover', note: 'divider leaf' },
  { scan: 363, role: 'text',  folio: '1',   label: '1',            run: 'cat',   boundary: true, flag: 'renumber', note: 'catalogue restarts at 1' },
  { scan: 364, role: 'text',  folio: '2',   label: '2',            run: 'cat' },
];
// Body → appendix: a structural boundary where the numbering CONTINUES
// (body ends 310, appendix picks up at 311) even though it's a separate run.
const PR_LEAVES_APPENDIX = [
  { scan: 324, role: 'text',  folio: '309', label: '309',          run: 'body' },
  { scan: 325, role: 'text',  folio: '310', label: '310',          run: 'body' },
  { scan: 326, role: 'blank', folio: null,  label: '[Blank Page]', run: null,       note: 'end of body proper' },
  { scan: 327, role: 'text',  folio: '311', label: '311',          run: 'appendix', boundary: true, flag: 'continue', note: 'Appendix — numbering continues from the body' },
  { scan: 328, role: 'text',  folio: '312', label: '312',          run: 'appendix' },
];

/* ---------- totals ---------- */
const PR_TOTALS = {
  leaves: 387, runs: 5,
  text: 352, plates: 12, blanks: 9, skipped: 14,
  unresolved: 3,   // leaves whose role/run the user hasn't confirmed
};

/* ---------- ribbon ticks (full book, compressed) ----------
   Build one tick per leaf, coloured by the run it belongs to, so Option A
   can show the whole 387-leaf book as a single strip. Plates/blanks get
   their own marks so they read as interruptions in the body run. */
const PR_TICKS = (() => {
  const ticks = [];
  const push = (n, kind, run) => { for (let i = 0; i < n; i++) ticks.push({ kind, run }); };
  push(4, 'skip', 'cover');
  push(12, 'text', 'front');
  // body with a few interleaved plate+blank pairs
  let bodyLeft = 310, platesLeft = 6;
  const chunk = Math.floor(bodyLeft / (platesLeft + 1));
  for (let p = 0; p <= platesLeft; p++) {
    const take = p === platesLeft ? bodyLeft : chunk;
    push(take, 'text', 'body'); bodyLeft -= take;
    if (p < platesLeft) { push(1, 'plate', 'plates'); push(1, 'blank', null); }
  }
  push(30, 'text', 'appendix');   // continues the body's sequence
  push(1, 'blank', null);
  push(1, 'skip', 'cover');
  push(16, 'text', 'cat');
  return ticks;
})();

Object.assign(window, {
  PR_ROLES, PR_STYLES, PR_RUNS, PR_startInfo,
  PR_LEAVES_PLATE, PR_LEAVES_CAT, PR_LEAVES_APPENDIX, PR_TOTALS, PR_TICKS,
});
