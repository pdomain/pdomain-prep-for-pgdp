// variations.jsx — WF-05 Hyphen-Join Workbench.
// Two surfaces:
//   1. Per-book Hyphen Report panel (lives in Project Configure → Settings tab)
//   2. Global Settings library (replaces the textarea on /settings)
// Reuses ProjectConfigureFrame + TopNav from pipeline-shell.jsx.

const { useState: useS5 } = React;

/* ====================================================================
   Sample data
==================================================================== */

// 7 undecided cases · variety: place names, archaic forms, possible compounds.
// Each shows a line-break ↵ between the two halves.
const UNDECIDED_CASES = [
  {
    id: 1, head: 'end', tail: 'orsham',
    before: '…in Sussex passing the village of', after: 'road, near Storrington…',
    pageId: 'p014', line: 23,
    proposal: 'join',
    confidence: 0.83,
    note: 'No matching rule. \'end-\' not in beginnings list.',
    postBook: { flaggedAt: '3m ago', by: 'jsmith', reason: 'likely OCR error on proper noun — defer to corpus normalisation' },
    bookContext: {
      summary: 'Unique to this page. No other "Endorsham" or "end-X" in book.',
      bias: 'neutral',
    },
    ngrams: {
      series: {
        joined: [0,0,0,0,0,0,0,0,0,0,0,0],
        hyphen: [0,0,0,0,0,0,0,0,0,0,0,0],
      },
      verdict: 'No data — likely OCR / scanno of a proper noun.',
      verdictBias: 'neutral',
    },
  },
  {
    id: 2, head: 'after', tail: 'wards',
    before: 'and they were brought home', after: 'to a more sober humour…',
    pageId: 'p029', line: 8,
    proposal: 'join', confidence: 0.97,
    note: '\'after-\' is in 41 books as always-join.',
    bookContext: {
      summary: '"afterwards" appears 18× elsewhere · "after-wards" 0×',
      bias: 'join',
      counts: { joined: 18, hyphen: 0 },
    },
    ngrams: {
      series: {
        joined: [0.18,0.22,0.31,0.45,0.58,0.71,0.83,0.90,0.94,0.97,0.99,1.00],
        hyphen: [0.06,0.07,0.06,0.05,0.04,0.03,0.02,0.01,0.01,0.01,0.00,0.00],
      },
      verdict: '"afterwards" 100:1 since 1900.',
      verdictBias: 'join',
    },
  },
  /* cross-page case · word breaks at the foot of one page,
     continues at the top of the next (after running header is skipped). */
  {
    id: 3, head: 'common', tail: 'wealth',
    before: '…the foundations of an English', after: 'were laid not by statesmen…',
    pageId: 'p036', line: 38,
    crossPage: { fromPage: 'p036', toPage: 'p037', fromLine: 38, toLine: 1, skipped: 'running head' },
    proposal: 'join', confidence: 0.94,
    note: 'No rule entry. \'common-\' not registered.',
    bookContext: {
      summary: '"Commonwealth" appears 11× elsewhere · "common-wealth" 0×',
      bias: 'join',
      counts: { joined: 11, hyphen: 0 },
    },
    ngrams: {
      series: {
        joined: [0.22,0.34,0.40,0.51,0.62,0.70,0.78,0.84,0.89,0.93,0.96,1.00],
        hyphen: [0.04,0.05,0.07,0.09,0.08,0.06,0.04,0.03,0.02,0.01,0.01,0.01],
      },
      verdict: '"Commonwealth" dominant since 1750.',
      verdictBias: 'join',
    },
  },
  {
    id: 4, head: 'to', tail: 'day',
    before: 'a habit of mind which', after: 'survives in but a few quarters…',
    pageId: 'p052', line: 4,
    proposal: 'keep', confidence: 0.66,
    note: 'Archaic · pre-1920 books prefer "to-day".',
    postBook: { flaggedAt: '2m ago', by: 'jsmith', reason: 'author-style conflict with default rule — needs corpus pass' },
    bookContext: {
      summary: '"today" appears 5× elsewhere · "to-day" 1× (p008, this case)',
      bias: 'join',
      counts: { joined: 5, hyphen: 1 },
      override: 'This author favours "today" — proposal conflicts with local usage.',
    },
    ngrams: {
      series: {
        joined: [0.05,0.08,0.12,0.16,0.20,0.26,0.34,0.48,0.68,0.88,0.96,1.00],
        hyphen: [0.10,0.18,0.32,0.55,0.72,0.85,0.78,0.55,0.28,0.10,0.03,0.01],
      },
      verdict: '"today" crossed "to-day" in the 1920s. Belloc pub. 1912.',
      verdictBias: 'keep',
    },
  },
  {
    id: 5, head: 'self', tail: 'evident',
    before: 'a truth so plain it is', after: 'to all who have ears…',
    pageId: 'p077', line: 22,
    proposal: 'keep', confidence: 0.91,
    note: 'Compound preserved · 98% of editions.',
    bookContext: {
      summary: '"self-evident" appears 2× elsewhere · "selfevident" 0×',
      bias: 'keep',
      counts: { joined: 0, hyphen: 2 },
    },
    ngrams: {
      series: {
        joined: [0.01,0.01,0.02,0.02,0.02,0.02,0.02,0.02,0.03,0.04,0.05,0.06],
        hyphen: [0.40,0.55,0.70,0.85,0.92,0.96,0.98,0.99,0.97,0.95,0.92,0.90],
      },
      verdict: '"self-evident" 18:1 throughout the modern era.',
      verdictBias: 'keep',
    },
  },
  /* cross-page case · skip the running head AND a footnote block at the
     foot of the source page before resuming body text on the next page. */
  {
    id: 6, head: 'fore', tail: 'shadowed',
    before: '…the long Augustan peace had', after: 'the temperance of a later age…',
    pageId: 'p108', line: 41,
    crossPage: { fromPage: 'p108', toPage: 'p109', fromLine: 41, toLine: 2, skipped: 'footnote block + running head' },
    proposal: 'join', confidence: 0.99,
    note: 'Common compound.',
    bookContext: {
      summary: '"foreshadowed" appears 6× elsewhere · "fore-shadowed" 0×',
      bias: 'join',
      counts: { joined: 6, hyphen: 0 },
    },
    ngrams: {
      series: {
        joined: [0.40,0.52,0.60,0.66,0.72,0.78,0.83,0.88,0.92,0.95,0.97,1.00],
        hyphen: [0.18,0.20,0.18,0.14,0.10,0.07,0.04,0.03,0.02,0.01,0.01,0.01],
      },
      verdict: '"foreshadowed" dominant since 1700.',
      verdictBias: 'join',
    },
  },
  {
    id: 7, head: 'Cuck', tail: 'field',
    before: 'the road bends north toward', after: 'and from thence to Brighton…',
    pageId: 'p141', line: 19,
    proposal: 'join', confidence: 0.88,
    note: 'Place name · capitalised · likely proper noun.',
    bookContext: {
      summary: '"Cuckfield" appears 4× elsewhere · "Cuck-field" 0×',
      bias: 'join',
      counts: { joined: 4, hyphen: 0 },
    },
    ngrams: {
      series: {
        joined: [0.30,0.42,0.55,0.70,0.85,0.92,0.95,0.97,0.98,0.99,1.00,1.00],
        hyphen: [0.10,0.14,0.18,0.20,0.16,0.10,0.06,0.03,0.02,0.01,0.01,0.01],
      },
      verdict: '"Cuckfield" 50:1 since 1900. Sussex village (real).',
      verdictBias: 'join',
    },
  },
];

// 3 mismatched-dash pairs — same word, both joined AND hyphenated in this book.
const MISMATCHED = [
  { joined: 'bosham',     joinedCount: 3, hyphenated: 'bos-ham',   hyphenCount: 1, pages: ['p042','p077','p081','p129'] },
  { joined: 'westgate',   joinedCount: 5, hyphenated: 'west-gate', hyphenCount: 2, pages: ['p018','p044','p067','p092','p101','p144','p166'] },
  { joined: 'lordship',   joinedCount: 8, hyphenated: 'lord-ship', hyphenCount: 1, pages: ['p022','p031','p048','p056','p079','p082','p103','p119','p171'] },
];

// Tag-input chip data for the library variant.
const HYPHEN_RULES = {
  beginnings: ['after-','non-','pre-','re-','self-','semi-','sub-','super-','un-','well-','co-','anti-','de-','dis-','ex-','inter-','mid-','over-','post-','under-'],
  endings:    ['-day','-hood','-less','-like','-ness','-ship','-ward','-wise','-fold','-most'],
  alwaysJoin: ['after-noon','any-thing','any-where','some-thing','some-where','to-gether','with-out','with-in','to-morrow','to-night','him-self','her-self','my-self','your-self','our-selves'],
  alwaysKeep: ['well-nigh','to-day','self-evident','well-known','sister-in-law','mother-in-law','off-hand','on-going','pre-war','post-war','un-English','co-operate','re-enter'],
};

// Auto-joined cases grouped by word. The 42 from the stat tile total.
// Each row = 1 unique joined word; instances are the line-break occurrences
// the rule library auto-joined. User validates one row at a time.
const AUTO_JOINED_WORDS = [
  {
    joined: 'afternoon', head: 'after', tail: 'noon',
    rule: { kind: 'beginning', match: 'after-' },
    bookFreq: { joined: 22, hyphen: 0 },
    instances: [
      { pageId: 'p004', line: 12, before: 'we shall meet in the', after: 'and walk down to the river' },
      { pageId: 'p027', line: 8,  before: 'a long', after: 'spent in idleness' },
      { pageId: 'p051', line: 33, before: 'by the close of', after: 'the storm had passed' },
      { pageId: 'p078', line: 21, before: 'every', after: 'in those years was the same' },
      { pageId: 'p092', line: 7,  before: 'a thundering', after: 'of late autumn' },
      { pageId: 'p117', line: 19, before: 'a single', after: 'sufficed to mend it' },
      { pageId: 'p145', line: 4,  before: 'and one', after: 'in November he was gone' },
      { pageId: 'p163', line: 28, before: 'the slow', after: 'wore upon him' },
    ],
    validated: true,
  },
  {
    joined: 'without', head: 'with', tail: 'out',
    rule: { kind: 'always-join', match: 'with-out' },
    bookFreq: { joined: 47, hyphen: 0 },
    instances: [
      { pageId: 'p007', line: 31, before: 'and so he went', after: 'a word of complaint' },
      { pageId: 'p019', line: 14, before: 'the hills stretched', after: 'visible end' },
      { pageId: 'p041', line: 5,  before: 'we cannot speak', after: 'first considering' },
      { pageId: 'p089', line: 22, before: 'and yet,', after: 'a single objection,' },
      { pageId: 'p134', line: 11, before: 'he passed', after: 'a sound or a sign' },
      { pageId: 'p178', line: 38, before: 'a place', after: 'memory or record' },
    ],
    validated: true,
  },
  {
    joined: 'fellowship', head: 'fellow', tail: 'ship',
    rule: { kind: 'ending', match: '-ship' },
    bookFreq: { joined: 6, hyphen: 0 },
    instances: [
      { pageId: 'p011', line: 5,  before: 'the bond of', after: 'between them was old' },
      { pageId: 'p048', line: 18, before: 'a true', after: 'forged in adversity' },
      { pageId: 'p102', line: 30, before: 'and the', after: 'of the road' },
      { pageId: 'p159', line: 9,  before: 'their long', after: 'was at an end' },
    ],
    validated: false,
  },
  {
    joined: 'because', head: 'be', tail: 'cause',
    rule: { kind: 'syllable', match: 'auto · 99% conf' },
    bookFreq: { joined: 31, hyphen: 0 },
    instances: [
      { pageId: 'p018', line: 22, before: 'and that', after: 'of all that had happened' },
      { pageId: 'p054', line: 15, before: 'simply', after: 'no one else would' },
      { pageId: 'p087', line: 3,  before: '', after: 'he was no longer young' },
      { pageId: 'p121', line: 26, before: 'precisely', after: 'of the season' },
    ],
    validated: false,
  },
  {
    joined: 'something', head: 'some', tail: 'thing',
    rule: { kind: 'always-join', match: 'some-thing' },
    bookFreq: { joined: 19, hyphen: 0 },
    instances: [
      { pageId: 'p024', line: 8,  before: 'there was', after: 'in his eye' },
      { pageId: 'p063', line: 19, before: 'I caught', after: 'of the older spirit' },
      { pageId: 'p114', line: 12, before: 'and yet', after: 'remained' },
    ],
    validated: false,
  },
  {
    joined: 'overwhelming', head: 'over', tail: 'whelming',
    rule: { kind: 'beginning', match: 'over-' },
    bookFreq: { joined: 4, hyphen: 1 },
    instances: [
      { pageId: 'p033', line: 14, before: 'an', after: 'sense of loss' },
      { pageId: 'p091', line: 27, before: 'the', after: 'press of business' },
    ],
    validated: false,
    flag: 'check', // bookFreq shows 1 instance of "over-whelming" elsewhere — possible mismatch
  },
  {
    joined: 'within', head: 'with', tail: 'in',
    rule: { kind: 'always-join', match: 'with-in' },
    bookFreq: { joined: 38, hyphen: 0 },
    instances: [
      { pageId: 'p045', line: 39, before: 'a sound came', after: 'the cottage' },
      { pageId: 'p077', line: 11, before: '', after: 'the next year' },
      { pageId: 'p129', line: 23, before: 'and', after: 'the hour of the dawn' },
    ],
    validated: false,
  },
  {
    joined: 'wonderful', head: 'wonder', tail: 'ful',
    rule: { kind: 'ending', match: '-ful' },
    bookFreq: { joined: 7, hyphen: 0 },
    instances: [
      { pageId: 'p052', line: 18, before: 'a most', after: 'morning in May' },
      { pageId: 'p106', line: 4,  before: 'the', after: 'quietness of the place' },
    ],
    validated: false,
  },
  {
    joined: 'captain', head: 'cap', tail: 'tain',
    rule: { kind: 'syllable', match: 'auto · 97% conf' },
    bookFreq: { joined: 12, hyphen: 0 },
    instances: [
      { pageId: 'p067', line: 3,  before: 'the old', after: 'gave the order' },
      { pageId: 'p148', line: 30, before: 'a young', after: 'fresh from Sandhurst' },
    ],
    validated: false,
  },
  {
    joined: 'superfluous', head: 'super', tail: 'fluous',
    rule: { kind: 'beginning', match: 'super-' },
    bookFreq: { joined: 1, hyphen: 0 },
    instances: [
      { pageId: 'p082', line: 25, before: 'every word seemed', after: 'in his speech' },
    ],
    validated: false,
  },
];

/* Synthesised n-gram series for an auto-joined word. The auto-joined list
   was originally text-only; n-gram series are now baked in (cached from the
   shared app-wide n-gram cache) so the sparkline can render inline. Shape:
   12 ticks evenly spaced 1700→2020, normalised 0..1 relative frequency. */
const ngramsForAutoJoined = (w) => {
  // Words with a competing hyphen form in this book get a more interesting
  // (joined-dominant but not unanimous) curve. Pure-joined words get a
  // clean monotonic rise.
  if (w.flag === 'check' || w.bookFreq.hyphen > 0) {
    return {
      cachedAt: '4d ago',
      series: {
        joined: [0.10,0.18,0.28,0.38,0.50,0.60,0.66,0.70,0.74,0.78,0.81,0.83],
        hyphen: [0.20,0.32,0.41,0.45,0.42,0.38,0.30,0.24,0.18,0.14,0.11,0.09],
      },
      verdict: 'Joined dominant but competing form persists.',
    };
  }
  // Stable monotonic-joined curve with a small early bump for the hyphen form.
  return {
    cachedAt: '4d ago',
    series: {
      joined: [0.15,0.25,0.38,0.52,0.65,0.76,0.84,0.90,0.94,0.97,0.99,1.00],
      hyphen: [0.08,0.10,0.10,0.09,0.07,0.05,0.03,0.02,0.01,0.01,0.00,0.00],
    },
    verdict: 'Joined form dominant since 1750.',
  };
};

const SCANNOS = [
  { find: 'tlie',    replace: 'the',    count: 12, ignoreCase: false },
  { find: 'thc',     replace: 'the',    count: 8,  ignoreCase: false },
  { find: 'tbe',     replace: 'the',    count: 4,  ignoreCase: false },
  { find: 'arid',    replace: 'and',    count: 17, ignoreCase: false },
  { find: 'aud',     replace: 'and',    count: 9,  ignoreCase: false },
  { find: 'oi',      replace: 'of',     count: 22, ignoreCase: false },
  { find: 'ot',      replace: 'of',     count: 6,  ignoreCase: false },
  { find: 'iii',     replace: 'in',     count: 3,  ignoreCase: false },
  { find: 'rn',      replace: 'm',      count: 41, ignoreCase: true },
  { find: 'modem',   replace: 'modern', count: 5,  ignoreCase: true },
  { find: 'arc',     replace: 'are',    count: 14, ignoreCase: false },
];

/* ====================================================================
   Atomic building blocks
==================================================================== */

const Pip = ({ tone, children }) => {
  const c = `var(--${tone})`;
  return (
    <span className="mono" style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '1px 7px', borderRadius: 99,
      fontSize: 10, fontWeight: 600, letterSpacing: '.02em',
      color: c,
      background: `color-mix(in srgb, ${c} 12%, transparent)`,
      border: `1px solid color-mix(in srgb, ${c} 35%, transparent)`,
    }}>
      <span style={{ width: 5, height: 5, borderRadius: 99, background: c }} />
      {children}
    </span>
  );
};

const Kbd = ({ children }) => (
  <span style={{
    display: 'inline-grid', placeItems: 'center',
    minWidth: 16, height: 16, padding: '0 4px',
    background: 'var(--bg-sunk)', border: '1px solid var(--border-3)', borderBottomWidth: 2,
    borderRadius: 3,
    fontFamily: 'var(--mono-font)', fontSize: 9.5, fontWeight: 600,
    color: 'var(--ink-2)',
  }}>{children}</span>
);

/* The line-break glyph used inline in snippets. */
const LB = () => (
  <span className="mono" style={{
    color: 'var(--ink-4)', padding: '0 4px', userSelect: 'none',
    fontSize: '0.85em',
  }}>↵</span>
);

/* Page-break glyph for cross-page hyphens. Shows the page transition + what
   was skipped between (running head, folio, footnote block, etc). */
const PageBreak = ({ cp }) => (
  <span style={{
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '1px 6px', margin: '0 4px', borderRadius: 4,
    background: 'color-mix(in srgb, var(--gt) 12%, transparent)',
    border: '1px solid color-mix(in srgb, var(--gt) 35%, transparent)',
    fontFamily: 'var(--mono-font)', fontSize: 10, fontWeight: 600,
    color: 'var(--gt)', verticalAlign: 'middle',
  }}>
    <span>{cp.fromPage}↓</span>
    <span style={{ color: 'var(--ink-4)' }}>·</span>
    <span style={{ color: 'var(--ink-3)', fontWeight: 500 }}>skip {cp.skipped}</span>
    <span style={{ color: 'var(--ink-4)' }}>·</span>
    <span>↑{cp.toPage}</span>
  </span>
);

/* Google Books Ngram Viewer link · opens in new tab. */
const ngramHref = (word) =>
  `https://books.google.com/ngrams/graph?content=${encodeURIComponent(word)},${encodeURIComponent(word.replace(/-/g, ''))},${encodeURIComponent(word.replace(/(.)$/, '-$1').replace(/^-/, ''))}&year_start=1700&year_end=2019&corpus=en-2019`;

const NgramLink = ({ c }) => {
  const joined  = `${c.head}${c.tail}`;
  const hyphen  = `${c.head}-${c.tail}`;
  const url = `https://books.google.com/ngrams/graph?content=${encodeURIComponent(joined)},${encodeURIComponent(hyphen)}&year_start=1700&year_end=2019&corpus=en-2019`;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '2px 8px', borderRadius: 5,
      background: 'var(--bg-raised)', border: '1px solid var(--border-1)',
      color: 'var(--ink-2)', textDecoration: 'none',
      fontFamily: 'var(--mono-font)', fontSize: 10.5, fontWeight: 500,
      cursor: 'pointer',
    }}>
      <span>ngrams</span>
      <span style={{ color: 'var(--ink-4)', fontSize: 9 }}>↗</span>
    </a>
  );
};

/* Inline two-line sparkline rendered from a case's ngrams.series.
   X-axis is 12 evenly-spaced ticks from 1700 to 2020.
   Y-axis is normalised 0..1 relative usage. */
const Sparkline = ({ series, w = 220, h = 36 }) => {
  const all = [...series.joined, ...series.hyphen];
  const max = Math.max(0.01, ...all);
  const n = series.joined.length;
  const pad = 2;
  const pts = (arr) => arr.map((v, i) => {
    const x = pad + (i / (n - 1)) * (w - pad * 2);
    const y = h - pad - (v / max) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const tickXs = [];
  for (let year = 1700; year <= 2020; year += 50) {
    const p = (year - 1700) / (2020 - 1700);
    tickXs.push(pad + p * (w - pad * 2));
  }
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} style={{ display: 'block' }}>
      {/* axis backdrop */}
      <rect x="0" y="0" width={w} height={h} fill="var(--bg-sunk)" rx="3" />
      {/* faint baseline */}
      <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="var(--border-1)" strokeWidth="1" />
      {tickXs.map((x, i) => (
        <line key={i} x1={x} y1={h - pad - 2} x2={x} y2={h - pad} stroke="var(--ink-4)" strokeWidth="1" />
      ))}
      {/* joined series */}
      <polyline points={pts(series.joined)} fill="none" stroke="var(--exact)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      {/* hyphen series */}
      <polyline points={pts(series.hyphen)} fill="none" stroke="var(--fuzzy)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" strokeDasharray="2 2" />
    </svg>
  );
};

const NgramsBlock = ({ c, big }) => {
  const ng = c.ngrams;
  if (!ng) return null;
  const proposed = c.proposal;
  const conflict = ng.verdictBias !== 'neutral' && ng.verdictBias !== proposed;
  return (
    <div style={{
      padding: '10px 12px', borderRadius: 7,
      background: 'var(--bg-surface)',
      border: '1px solid var(--border-1)',
      display: 'flex', gap: 12, alignItems: 'center',
    }}>
      <Sparkline series={ng.series} w={big ? 260 : 200} h={big ? 44 : 36} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          fontSize: 9.5, fontWeight: 700, letterSpacing: '.08em',
          textTransform: 'uppercase', color: 'var(--ink-4)',
        }}>
          <span>Ngrams · 1700–2020</span>
          <span style={{ color: 'var(--ink-4)' }}>·</span>
          <span style={{ color: 'var(--exact)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
            <span style={{ width: 8, height: 2, background: 'var(--exact)' }} /> joined
          </span>
          <span style={{ color: 'var(--fuzzy)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
            <svg width="12" height="2"><line x1="0" y1="1" x2="12" y2="1" stroke="var(--fuzzy)" strokeWidth="2" strokeDasharray="2 2" /></svg>
            hyphen
          </span>
        </div>
        <div style={{
          marginTop: 4, fontSize: 11.5,
          color: conflict ? 'var(--mismatch)' : 'var(--ink-1)',
          lineHeight: 1.4, fontWeight: 500,
        }}>{ng.verdict}</div>
      </div>
      <NgramLink c={c} />
    </div>
  );
};

/* Context snippet renderer — shows surrounding text with the broken word
   highlighted. Word is rendered as head + LB + tail and underlined in amber
   so the eye lands on the decision target. Cross-page cases render a
   PageBreak indicator in place of the line break. */
const ContextSnippet = ({ c, dim }) => (
  <span style={{
    fontSize: 12.5, color: dim ? 'var(--ink-3)' : 'var(--ink-2)',
    lineHeight: 1.55,
  }}>
    {c.before}{' '}
    <span style={{
      borderBottom: `2px solid color-mix(in srgb, ${c.crossPage ? 'var(--gt)' : 'var(--fuzzy)'} 60%, transparent)`,
      color: 'var(--ink-1)', fontWeight: 500,
    }}>
      <span className="mono">{c.head}-</span>
      {c.crossPage ? <PageBreak cp={c.crossPage} /> : <LB />}
      <span className="mono">{c.tail}</span>
    </span>{' '}
    {c.after}
  </span>
);

/* Proposed result · two pills side by side. The proposal=='join' side is
   accent-tinted, the other dim. */
const ProposalPills = ({ c, big }) => {
  const joinSel = c.proposal === 'join';
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      <span className="mono" style={{
        padding: big ? '4px 10px' : '2px 8px', borderRadius: 5,
        fontSize: big ? 13.5 : 12, fontWeight: 600,
        color: joinSel ? 'var(--exact)' : 'var(--ink-3)',
        background: joinSel
          ? 'color-mix(in srgb, var(--exact) 12%, transparent)'
          : 'var(--bg-raised)',
        border: `1px solid ${joinSel
          ? 'color-mix(in srgb, var(--exact) 40%, transparent)'
          : 'var(--border-1)'}`,
        textDecoration: joinSel ? 'none' : 'line-through',
        textDecorationColor: 'var(--ink-4)',
        textDecorationThickness: '1px',
      }}>{c.head}{c.tail}</span>
      <span style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>vs</span>
      <span className="mono" style={{
        padding: big ? '4px 10px' : '2px 8px', borderRadius: 5,
        fontSize: big ? 13.5 : 12, fontWeight: 600,
        color: !joinSel ? 'var(--fuzzy)' : 'var(--ink-3)',
        background: !joinSel
          ? 'color-mix(in srgb, var(--fuzzy) 12%, transparent)'
          : 'var(--bg-raised)',
        border: `1px solid ${!joinSel
          ? 'color-mix(in srgb, var(--fuzzy) 40%, transparent)'
          : 'var(--border-1)'}`,
        textDecoration: !joinSel ? 'none' : 'line-through',
        textDecorationColor: 'var(--ink-4)',
        textDecorationThickness: '1px',
      }}>{c.head}-{c.tail}</span>
    </div>
  );
};

/* Stat tile · used in the report header. */
const StatTile = ({ value, label, tone = 'ink-2', small }) => (
  <div style={{
    flex: 1, padding: small ? '10px 12px' : '14px 16px',
    background: 'var(--bg-surface)', border: '1px solid var(--border-1)',
    borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 4,
  }}>
    <div className="mono" style={{
      fontSize: small ? 20 : 26, fontWeight: 700,
      color: tone.startsWith('--') ? `var(${tone})` : `var(--${tone})`,
      letterSpacing: '-0.02em', lineHeight: 1,
    }}>{value}</div>
    <div style={{
      fontSize: 10.5, fontWeight: 600, letterSpacing: '.08em',
      textTransform: 'uppercase', color: 'var(--ink-3)',
    }}>{label}</div>
  </div>
);

/* Section header — uppercase tracked label with optional right-side hotkey hint. */
const SectionHead = ({ title, hint, right }) => (
  <div style={{
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '12px 16px', borderBottom: '1px solid var(--border-1)',
  }}>
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
      <span style={{
        fontSize: 10.5, fontWeight: 700, letterSpacing: '.1em',
        textTransform: 'uppercase', color: 'var(--ink-3)',
      }}>{title}</span>
      {hint ? <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>{hint}</span> : null}
    </div>
    {right}
  </div>
);

/* List | Queue segmented toggle. Used in V2 and V3 so users can see they
   are alternate views of the same review queue. */
const ViewToggle = ({ active }) => (
  <div style={{
    display: 'inline-flex', padding: 3, gap: 2,
    background: 'var(--bg-raised)', border: '1px solid var(--border-1)',
    borderRadius: 7,
  }}>
    {[
      { id: 'list',  name: 'List',  icon: 'grip', key: 'L' },
      { id: 'queue', name: 'Queue', icon: 'eye',  key: 'Q' },
    ].map(o => {
      const on = active === o.id;
      return (
        <div key={o.id} style={{
          padding: '3px 9px', borderRadius: 5, cursor: 'pointer',
          background: on ? 'var(--bg-surface)' : 'transparent',
          boxShadow: on ? '0 0 0 1px var(--border-2)' : 'none',
          color: on ? 'var(--ink-1)' : 'var(--ink-3)',
          fontSize: 11.5, fontWeight: on ? 600 : 500,
          display: 'inline-flex', alignItems: 'center', gap: 5,
        }}>
          <Icon name={o.icon} size={11} />
          {o.name}
          <Kbd>{o.key}</Kbd>
        </div>
      );
    })}
  </div>
);

/* ====================================================================
   Hyphen Report — Header block (stat tiles + accordion chrome)
   shared by all four panel variants.
==================================================================== */

const ReportHeader = ({ open = true }) => (
  <div style={{
    background: 'var(--bg-surface)', border: '1px solid var(--border-1)',
    borderRadius: 10, padding: '14px 16px',
    display: 'flex', alignItems: 'center', gap: 16,
  }}>
    <Icon name={open ? 'chevD' : 'chevR'} size={14} style={{ color: 'var(--ink-3)' }} />
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)' }}>Hyphen Join Report</div>
      <div className="mono" style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>
        belloc-survivals · ran 4 min ago · 387 pages scanned
      </div>
    </div>
    <Button variant="ghost" size="sm" icon="refresh">Re-scan</Button>
  </div>
);

const ReportStatTiles = () => (
  <div style={{ display: 'flex', gap: 12 }}>
    <StatTile value="42" label="auto-joined" tone="exact" />
    <StatTile value="7"  label="undecided"   tone="fuzzy" />
    <StatTile value="3"  label="mismatched"  tone="mismatch" />
    <StatTile value="14" label="auto-kept"   tone="ink-2" />
    <StatTile
      value="5"
      label={<>for post-book <span style={{ color: 'var(--ink-4)', fontWeight: 500 }}>· 2 cross-page · 3 flagged</span></>}
      tone="gt"
    />
  </div>
);

/* ====================================================================
   V1 · Undecided list as rows  (matches brief verbatim)
==================================================================== */

const HyphenRow = ({ c, idx, selected }) => (
  <div style={{
    display: 'grid',
    gridTemplateColumns: '24px 1fr 200px 260px',
    gap: 12, alignItems: 'center',
    padding: '12px 16px',
    background: selected ? 'color-mix(in srgb, var(--accent) 6%, var(--bg-surface))' : 'transparent',
    borderBottom: '1px solid var(--border-1)',
    borderLeft: selected ? '2px solid var(--accent)' : '2px solid transparent',
  }}>
    <span className="mono" style={{ fontSize: 11, color: 'var(--ink-4)', textAlign: 'right' }}>{idx + 1}</span>

    <div style={{ minWidth: 0 }}>
      <ContextSnippet c={c} />
      <div className="mono" style={{
        marginTop: 4, fontSize: 10.5, color: 'var(--ink-4)',
        display: 'flex', gap: 8, alignItems: 'center',
      }}>
        <span style={{ color: 'var(--ink-3)' }}>{c.pageId}</span>
        <span>·</span>
        <span>L{c.line}</span>
        <span>·</span>
        <span>score {c.confidence.toFixed(2)}</span>
      </div>
    </div>

    <ProposalPills c={c} />

    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
      <Button variant="outline" size="sm">
        <span style={{ color: 'var(--exact)' }}>✓ Always join</span>
      </Button>
      <Button variant="outline" size="sm">
        <span style={{ color: 'var(--mismatch)' }}>✗ Keep</span>
      </Button>
      <Button variant="ghost" size="sm">This book</Button>
    </div>
  </div>
);

const UndecidedListV1 = () => (
  <div style={{
    background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 10,
    overflow: 'hidden',
  }}>
    <SectionHead
      title="Undecided · 7"
      hint="No matching rule in library"
      right={
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <Kbd>J</Kbd><Kbd>K</Kbd>
          <span style={{ fontSize: 11, color: 'var(--ink-4)', marginRight: 6 }}>navigate</span>
          <Button variant="outline" size="sm" icon="check">Apply all proposed</Button>
        </div>
      }
    />
    {UNDECIDED_CASES.map((c, i) => (
      <HyphenRow key={c.id} c={c} idx={i} selected={i === 0} />
    ))}
  </div>
);

/* ====================================================================
   V2 · Undecided as cards — richer per-item context
==================================================================== */

const BookContextLine = ({ ctx, c }) => {
  if (!ctx) return null;
  const proposed = c.proposal === 'join' ? 'join' : 'keep';
  const conflict = ctx.bias && ctx.bias !== 'neutral' && ctx.bias !== proposed;
  const tone = conflict ? 'mismatch' : ctx.bias === 'neutral' ? 'ink-3' : (proposed === 'join' ? 'exact' : 'fuzzy');
  const toneVar = tone === 'ink-3' ? 'var(--ink-3)' : `var(--${tone})`;
  return (
    <div style={{
      padding: '8px 10px', borderRadius: 6,
      background: conflict
        ? 'color-mix(in srgb, var(--mismatch) 10%, var(--bg-surface))'
        : 'var(--bg-sunk)',
      border: `1px solid ${conflict
        ? 'color-mix(in srgb, var(--mismatch) 35%, var(--border-1))'
        : 'var(--border-1)'}`,
      display: 'flex', alignItems: 'flex-start', gap: 8,
    }}>
      <span style={{
        flex: '0 0 auto', marginTop: 2,
        width: 6, height: 6, borderRadius: 99, background: toneVar,
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, color: 'var(--ink-1)', lineHeight: 1.5 }}>
          <span style={{
            fontSize: 9.5, fontWeight: 700, letterSpacing: '.08em',
            textTransform: 'uppercase', color: 'var(--ink-4)', marginRight: 6,
          }}>In this book</span>
          <span className="mono" style={{ color: 'var(--ink-2)' }}>{ctx.summary}</span>
        </div>
        {ctx.override ? (
          <div style={{
            marginTop: 4, fontSize: 11, color: 'var(--mismatch)', lineHeight: 1.45,
            display: 'flex', alignItems: 'flex-start', gap: 6,
          }}>
            <Icon name="alert" size={11} style={{ marginTop: 2, flex: '0 0 auto' }} />
            <span>{ctx.override}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
};

const HyphenCard = ({ c, idx, focused, decided }) => {
  const proposed = c.proposal === 'join' ? `${c.head}${c.tail}` : `${c.head}-${c.tail}`;
  return (
    <div style={{
      background: decided
        ? 'color-mix(in srgb, var(--exact) 8%, var(--bg-surface))'
        : focused
          ? 'color-mix(in srgb, var(--accent) 7%, var(--bg-surface))'
          : 'var(--bg-surface)',
      border: `1.5px solid ${decided
        ? 'color-mix(in srgb, var(--exact) 50%, var(--border-1))'
        : focused ? 'var(--accent)' : 'var(--border-1)'}`,
      boxShadow: focused && !decided
        ? '0 0 0 4px color-mix(in srgb, var(--accent) 18%, transparent)'
        : 'none',
      borderRadius: 9, padding: 14,
      display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0,
      position: 'relative',
      opacity: decided ? 0.65 : 1,
      transition: 'opacity 180ms',
    }}>
      {focused && !decided ? (
        <span style={{
          position: 'absolute', top: -10, left: 12,
          padding: '2px 8px', borderRadius: 99,
          background: 'var(--accent)', color: 'var(--accent-ink)',
          fontFamily: 'var(--mono-font)', fontSize: 9.5, fontWeight: 700,
          letterSpacing: '.06em', textTransform: 'uppercase',
          display: 'inline-flex', alignItems: 'center', gap: 5,
        }}>
          <span style={{
            width: 5, height: 5, borderRadius: 99, background: 'var(--accent-ink)',
          }} />
          focus
        </span>
      ) : null}
      {decided ? (
        <span style={{
          position: 'absolute', top: -10, left: 12,
          padding: '2px 8px', borderRadius: 99,
          background: 'var(--exact)', color: '#0b1409',
          fontFamily: 'var(--mono-font)', fontSize: 9.5, fontWeight: 700,
          letterSpacing: '.06em', textTransform: 'uppercase',
          display: 'inline-flex', alignItems: 'center', gap: 5,
        }}>
          <Icon name="check" size={9} stroke={3} />
          joined · sliding out
        </span>
      ) : null}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>#{idx + 1}</span>
          <Pip tone={c.proposal === 'join' ? 'exact' : 'fuzzy'}>
            {c.proposal === 'join' ? 'proposes join' : 'proposes keep'}
          </Pip>
          {c.crossPage ? <Pip tone="gt">cross-page</Pip> : null}
        </div>
        <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>
          {c.crossPage
            ? `${c.crossPage.fromPage} → ${c.crossPage.toPage} · score ${c.confidence.toFixed(2)}`
            : `${c.pageId} · L${c.line} · score ${c.confidence.toFixed(2)}`}
        </span>
      </div>

      <div style={{
        padding: '10px 12px', background: 'var(--bg-sunk)',
        border: '1px solid var(--border-1)', borderRadius: 7,
      }}>
        <ContextSnippet c={c} />
      </div>

      <BookContextLine ctx={c.bookContext} c={c} />

      <NgramsBlock c={c} />

      <div style={{
        fontSize: 11, color: 'var(--ink-4)',
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <Icon name="info" size={11} />
        <span style={{
          fontSize: 9.5, fontWeight: 700, letterSpacing: '.08em',
          textTransform: 'uppercase', color: 'var(--ink-4)', marginRight: 2,
        }}>Prior</span>
        <span style={{ color: 'var(--ink-3)' }}>{c.note}</span>
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        paddingTop: 8, borderTop: '1px dashed var(--border-1)',
      }}>
        <span className="mono" style={{
          padding: '4px 10px', borderRadius: 5, fontSize: 13, fontWeight: 600,
          color: 'var(--ink-1)', background: 'var(--bg-raised)',
          border: '1px solid var(--border-2)',
        }}>{proposed}</span>
        <div style={{ flex: 1 }} />
        <Button variant={focused && !decided ? 'primary' : 'outline'} size="sm">
          {focused && !decided
            ? <><span>✓ Always join</span> <Kbd>Y</Kbd></>
            : <span style={{ color: 'var(--exact)' }}>✓ Always join</span>}
        </Button>
        <Button variant="outline" size="sm">
          {focused && !decided
            ? <><span style={{ color: 'var(--mismatch)' }}>✗ Keep</span> <Kbd>N</Kbd></>
            : <span style={{ color: 'var(--mismatch)' }}>✗ Keep</span>}
        </Button>
        <Button variant="ghost" size="sm">
          {focused && !decided ? <>Book only <Kbd>B</Kbd></> : 'Book only'}
        </Button>
        <Button variant="ghost" size="sm">
          {focused && !decided ? <>Skip <Kbd>S</Kbd></> : 'Skip'}
        </Button>
      </div>
    </div>
  );
};

const UndecidedListV2 = () => (
  <div>
    <SectionHead
      title="Undecided · 7"
      hint="J/K move focus · Y/N/B/S decide · Q switches to Queue view"
      right={
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <ViewToggle active="list" />
          <span className="mono" style={{
            fontSize: 11, color: 'var(--ink-2)',
            padding: '3px 9px', borderRadius: 5,
            background: 'var(--bg-raised)', border: '1px solid var(--border-1)',
          }}>3 of 7</span>
          <Button variant="outline" size="sm" icon="check">Apply all proposed</Button>
        </div>
      }
    />
    <div style={{
      display: 'grid', gridTemplateColumns: '1fr 1fr',
      gap: 14, marginTop: 14,
    }}>
      {UNDECIDED_CASES.slice(0, 6).map((c, i) => (
        <HyphenCard key={c.id} c={c} idx={i}
          decided={i === 0}
          focused={i === 1} />
      ))}
    </div>
  </div>
);

/* ====================================================================
   V3 · Queue mode — one undecided at a time, big, keyboard-driven
==================================================================== */

const QueueSidebar = ({ activeId }) => (
  <div style={{
    width: 260, flex: '0 0 auto',
    background: 'var(--bg-surface)', border: '1px solid var(--border-1)',
    borderRadius: 10, overflow: 'hidden',
    display: 'flex', flexDirection: 'column',
  }}>
    <SectionHead title="Queue · 7 cases" />
    <div style={{ flex: 1, overflow: 'auto' }}>
      {UNDECIDED_CASES.map(c => {
        const on = c.id === activeId;
        const flagged = !!c.postBook;
        const cross   = !!c.crossPage;
        const deferred = flagged || cross;
        return (
          <div key={c.id} style={{
            padding: '9px 14px', borderBottom: '1px solid var(--border-1)',
            background: on ? 'color-mix(in srgb, var(--accent) 8%, var(--bg-surface))' : 'transparent',
            borderLeft: on ? '2px solid var(--accent)' : '2px solid transparent',
            display: 'flex', flexDirection: 'column', gap: 3,
            opacity: deferred ? 0.85 : 1,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="mono" style={{
                fontSize: 12, color: 'var(--ink-1)', fontWeight: 600,
                textDecoration: deferred ? 'line-through' : 'none',
                textDecorationColor: 'var(--ink-4)',
              }}>
                {c.head}-{c.tail}
              </span>
              {deferred ? (
                <span title={cross ? 'cross-page — auto-routed' : c.postBook.reason} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 3,
                  padding: '0 5px', borderRadius: 3,
                  background: 'color-mix(in srgb, var(--gt) 14%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--gt) 35%, transparent)',
                  fontFamily: 'var(--mono-font)', fontSize: 9, fontWeight: 700,
                  letterSpacing: '.04em', color: 'var(--gt)',
                }}>
                  <span style={{ width: 4, height: 4, borderRadius: 99, background: 'var(--gt)' }} />
                  post-book
                </span>
              ) : null}
            </div>
            <span className="mono" style={{ fontSize: 10, color: 'var(--ink-4)' }}>
              {c.pageId} · L{c.line}
              {cross ? ' · cross-page' : flagged ? ' · flagged' : ` · ${c.proposal === 'join' ? 'join' : 'keep'}`}
            </span>
          </div>
        );
      })}
    </div>
    <div style={{
      padding: '8px 14px', borderTop: '1px solid var(--border-1)',
      background: 'var(--bg-page)',
      display: 'flex', alignItems: 'center', gap: 6,
      fontSize: 11, color: 'var(--ink-3)',
    }}>
      <Icon name="bell" size={12} style={{ color: 'var(--gt)' }} />
      <span><span style={{ color: 'var(--ink-1)', fontWeight: 600 }} className="mono">5</span> bound for post-book</span>
    </div>
  </div>
);

const QueueCase = ({ c }) => {
  const proposed = c.proposal === 'join' ? `${c.head}${c.tail}` : `${c.head}-${c.tail}`;
  const alt      = c.proposal === 'join' ? `${c.head}-${c.tail}` : `${c.head}${c.tail}`;
  return (
    <div style={{
      flex: 1, background: 'var(--bg-surface)', border: '1px solid var(--border-1)',
      borderRadius: 10, padding: '20px 24px',
      display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0,
    }}>
      {/* page reference + similar count */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span className="mono" style={{
          padding: '3px 9px', borderRadius: 5,
          background: 'var(--bg-raised)', border: '1px solid var(--border-1)',
          fontSize: 11, fontWeight: 600, color: 'var(--ink-1)',
        }}>{c.pageId}</span>
        <span className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>line {c.line} · score {c.confidence.toFixed(2)}</span>
        <div style={{ flex: 1 }} />
        <Button variant="ghost" size="sm" icon="eye">View on page</Button>
      </div>

      {/* big word display */}
      <div style={{
        padding: '24px 20px', background: 'var(--bg-sunk)',
        border: '1px solid var(--border-1)', borderRadius: 8,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
      }}>
        <span className="mono" style={{
          fontSize: 32, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--ink-2)',
        }}>
          {c.head}<span style={{ color: 'var(--fuzzy)' }}>-</span>
          <LB />
          {c.tail}
        </span>
        <div style={{
          display: 'flex', gap: 14, alignItems: 'center',
          fontFamily: 'var(--mono-font)', fontSize: 18, fontWeight: 600,
        }}>
          <span style={{
            padding: '6px 14px', borderRadius: 7,
            color: c.proposal === 'join' ? 'var(--exact)' : 'var(--ink-3)',
            background: c.proposal === 'join'
              ? 'color-mix(in srgb, var(--exact) 12%, transparent)' : 'var(--bg-raised)',
            border: `2px solid ${c.proposal === 'join'
              ? 'color-mix(in srgb, var(--exact) 50%, transparent)' : 'var(--border-1)'}`,
          }}>{proposed}</span>
          <span style={{ color: 'var(--ink-4)', fontWeight: 400, fontSize: 14 }}>or</span>
          <span style={{
            padding: '6px 14px', borderRadius: 7,
            color: c.proposal !== 'join' ? 'var(--fuzzy)' : 'var(--ink-3)',
            background: c.proposal !== 'join'
              ? 'color-mix(in srgb, var(--fuzzy) 12%, transparent)' : 'var(--bg-raised)',
            border: `2px solid ${c.proposal !== 'join'
              ? 'color-mix(in srgb, var(--fuzzy) 50%, transparent)' : 'var(--border-1)'}`,
          }}>{alt}</span>
        </div>
      </div>

      {/* paragraph context */}
      <div>
        <div style={{
          fontSize: 9.5, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase',
          color: 'var(--ink-4)', marginBottom: 6,
        }}>Context</div>
        <div style={{
          fontSize: 14, color: 'var(--ink-1)', lineHeight: 1.7,
          padding: '12px 14px', background: 'var(--bg-page)',
          border: '1px solid var(--border-1)', borderRadius: 7,
          fontFamily: 'Georgia, "Times New Roman", serif',
        }}>
          {c.before}{' '}
          <span style={{
            background: 'color-mix(in srgb, var(--fuzzy) 22%, transparent)',
            padding: '0 3px', borderRadius: 3,
          }}>{c.head}-<LB />{c.tail}</span>{' '}
          {c.after}
        </div>
      </div>

      {/* analysis note */}
      <div style={{
        padding: '10px 12px', borderRadius: 7,
        background: 'color-mix(in srgb, var(--ocr) 8%, var(--bg-surface))',
        border: '1px solid color-mix(in srgb, var(--ocr) 30%, var(--border-1))',
        fontSize: 12, color: 'var(--ink-2)',
        display: 'flex', alignItems: 'flex-start', gap: 10,
      }}>
        <Icon name="info" size={13} style={{ color: 'var(--ocr)', marginTop: 1, flex: '0 0 auto' }} />
        <span><span style={{
          fontSize: 9.5, fontWeight: 700, letterSpacing: '.08em',
          textTransform: 'uppercase', color: 'var(--ink-4)', marginRight: 6,
        }}>Prior</span>{c.note}</span>
      </div>

      {/* in-book context */}
      <BookContextLine ctx={c.bookContext} c={c} />

      {/* ngrams sparkline */}
      <NgramsBlock c={c} big />

      {/* big action bar */}
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 8,
        paddingTop: 6, borderTop: '1px dashed var(--border-1)',
      }}>
        <div style={{ display: 'flex', gap: 10 }}>
          <Button variant="primary" size="lg" full>
            <span>✓ Always join</span><Kbd>Y</Kbd>
          </Button>
          <Button variant="outline" size="lg" full>
            <span style={{ color: 'var(--mismatch)' }}>✗ Always keep</span><Kbd>N</Kbd>
          </Button>
          <Button variant="ghost" size="lg" full>
            <span>This book only</span><Kbd>B</Kbd>
          </Button>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <Button variant="outline" size="md" full style={{
            background: 'color-mix(in srgb, var(--gt) 8%, transparent)',
            borderColor: 'color-mix(in srgb, var(--gt) 40%, var(--border-2))',
          }}>
            <Icon name="bell" size={13} style={{ color: 'var(--gt)' }} />
            <span style={{ color: 'var(--gt)' }}>Flag for post-book processing</span>
            <Kbd>F</Kbd>
          </Button>
          <Button variant="ghost" size="md" full>
            <span style={{ color: 'var(--ink-3)' }}>Skip — decide later</span><Kbd>S</Kbd>
          </Button>
        </div>
        <div style={{
          fontSize: 10.5, color: 'var(--ink-4)', textAlign: 'center', lineHeight: 1.55,
        }}>
          <Icon name="info" size={10} style={{ marginRight: 4, verticalAlign: '-1px' }} />
          Flagged cases are bundled into <span className="mono" style={{ color: 'var(--ink-3)' }}>post-processing-notes.json</span> in
          the export package. No decision is made here.
        </div>
      </div>
    </div>
  );
};

/* ====================================================================
   V5 · Auto-joined validation — grouped by word, expandable instances
==================================================================== */

/* Tiny inline snippet for a single instance: shows the line break in context. */
const InstanceLine = ({ inst, head, tail }) => (
  <div style={{
    display: 'grid', gridTemplateColumns: '80px 1fr 28px',
    gap: 10, alignItems: 'center',
    padding: '6px 10px 6px 16px',
    fontSize: 11.5, lineHeight: 1.5,
    borderTop: '1px dashed var(--border-1)',
  }}>
    <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>
      {inst.pageId} · L{inst.line}
    </span>
    <span style={{ color: 'var(--ink-2)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
      …{inst.before}{' '}
      <span style={{
        background: 'color-mix(in srgb, var(--exact) 12%, transparent)',
        padding: '0 3px', borderRadius: 3, color: 'var(--ink-1)',
      }}>
        <span className="mono">{head}-</span><LB /><span className="mono">{tail}</span>
      </span>{' '}
      {inst.after}…
    </span>
    <button title="Re-flag this single instance" style={{
      width: 22, height: 22, border: '1px solid var(--border-1)',
      borderRadius: 4, background: 'transparent',
      color: 'var(--ink-4)', cursor: 'pointer',
      display: 'grid', placeItems: 'center',
    }}>
      <span style={{ fontSize: 13 }}>×</span>
    </button>
  </div>
);

const RuleChipInline = ({ rule }) => {
  const palette = {
    'beginning':   { color: 'var(--block)', label: 'beginning' },
    'ending':      { color: 'var(--para)',  label: 'ending' },
    'always-join': { color: 'var(--exact)', label: 'always-join' },
    'always-keep': { color: 'var(--fuzzy)', label: 'always-keep' },
    'syllable':    { color: 'var(--ocr)',   label: 'syllable' },
  };
  const p = palette[rule.kind] || palette.syllable;
  return (
    <span className="mono" style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '1px 7px', borderRadius: 4,
      fontSize: 10.5, fontWeight: 500,
      color: p.color,
      background: `color-mix(in srgb, ${p.color} 12%, transparent)`,
      border: `1px solid color-mix(in srgb, ${p.color} 33%, transparent)`,
    }}>
      <span style={{ width: 5, height: 5, borderRadius: 99, background: p.color }} />
      <span style={{ fontWeight: 600 }}>{p.label}</span>
      <span style={{ color: 'var(--ink-3)' }}>·</span>
      <span>{rule.match}</span>
    </span>
  );
};

const NgramSparklineCell = ({ w }) => {
  const ng = ngramsForAutoJoined(w);
  return (
    <div
      title={`${ng.verdict} · cached ${ng.cachedAt}`}
      style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-start' }}>
      <Sparkline series={ng.series} w={140} h={26} />
      <div style={{
        display: 'flex', alignItems: 'center', gap: 5,
        fontSize: 9.5, color: 'var(--ink-4)',
        fontFamily: 'var(--mono-font, monospace)',
      }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 3,
          padding: '0 4px', height: 13, borderRadius: 3,
          background: 'var(--bg-raised)', border: '1px solid var(--border-1)',
          color: 'var(--ink-3)', letterSpacing: '.04em',
        }}>
          <span style={{ width: 5, height: 5, borderRadius: 99, background: 'var(--exact)' }} />
          cached
        </span>
        <span>1700–2020</span>
      </div>
    </div>
  );
};

const AutoJoinedRow = ({ w, expanded, selected }) => {
  const flagged = w.flag === 'check';
  return (
    <div style={{
      borderBottom: '1px solid var(--border-1)',
      background: selected
        ? 'color-mix(in srgb, var(--accent) 5%, transparent)'
        : flagged
          ? 'color-mix(in srgb, var(--fuzzy) 5%, transparent)'
          : 'transparent',
      borderLeft: selected ? '2px solid var(--accent)' : '2px solid transparent',
    }}>
      {/* Row header */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '24px 1fr 64px 200px 1fr 150px 200px',
        gap: 12, alignItems: 'center',
        padding: '10px 16px',
      }}>
        <span style={{ color: 'var(--ink-4)', cursor: 'pointer', display: 'inline-flex' }}>
          <Icon name={expanded ? 'chevD' : 'chevR'} size={12} />
        </span>

        <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="mono" style={{
            padding: '4px 10px', borderRadius: 5,
            background: 'var(--bg-raised)', border: '1px solid var(--border-2)',
            fontSize: 13, fontWeight: 600, color: 'var(--ink-1)',
          }}>{w.joined}</span>
          {w.validated ? (
            <Pip tone="exact">validated</Pip>
          ) : flagged ? (
            <Pip tone="fuzzy">check</Pip>
          ) : null}
        </div>

        <span className="mono" style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-1)', textAlign: 'right' }}>
          ×{w.instances.length}
        </span>

        <RuleChipInline rule={w.rule} />

        <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
          {w.bookFreq.joined}× joined elsewhere
          {w.bookFreq.hyphen > 0 ? (
            <> · <span style={{ color: 'var(--mismatch)', fontWeight: 600 }}>{w.bookFreq.hyphen}× hyphen</span></>
          ) : ''}
        </span>

        <NgramSparklineCell w={w} />

        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          <Button variant={w.validated ? 'primary' : 'outline'} size="sm">
            {w.validated ? '✓ Validated' : '✓ Looks right'}
          </Button>
          <Button variant="outline" size="sm">
            <span style={{ color: 'var(--mismatch)' }}>↶ Re-flag</span>
          </Button>
        </div>
      </div>

      {expanded ? (
        <div style={{ background: 'var(--bg-page)', paddingBottom: 6 }}>
          {w.instances.map((inst, i) => (
            <InstanceLine key={i} inst={inst} head={w.head} tail={w.tail} />
          ))}
        </div>
      ) : null}
    </div>
  );
};

const AutoJoinedList = () => (
  <div style={{
    background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 10,
    overflow: 'hidden',
  }}>
    <SectionHead
      title="Auto-joined · 42"
      hint={`${AUTO_JOINED_WORDS.length} unique words · validate in bulk`}
      right={
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            fontSize: 11, color: 'var(--ink-3)',
          }}>
            <span style={{ width: 8, height: 8, borderRadius: 99, background: 'var(--exact)' }} />
            {AUTO_JOINED_WORDS.filter(w => w.validated).length} validated
            <span style={{ color: 'var(--ink-4)' }}>·</span>
            <span style={{ width: 8, height: 8, borderRadius: 99, background: 'var(--fuzzy)' }} />
            1 flagged
          </span>
          <Button variant="outline" size="sm" icon="check">Validate all unflagged</Button>
        </div>
      }
    />
    <div style={{
      display: 'grid',
      gridTemplateColumns: '24px 1fr 64px 200px 1fr 150px 200px',
      gap: 12,
      padding: '8px 16px', background: 'var(--bg-page)',
      borderBottom: '1px solid var(--border-1)',
      fontSize: 9.5, fontWeight: 700, letterSpacing: '.1em',
      textTransform: 'uppercase', color: 'var(--ink-4)',
    }}>
      <span>·</span>
      <span>Word · status</span>
      <span style={{ textAlign: 'right' }}>Count</span>
      <span>Rule</span>
      <span>In book</span>
      <span>Ngrams</span>
      <span style={{ textAlign: 'right' }}>Validate</span>
    </div>
    {AUTO_JOINED_WORDS.map((w, i) => (
      <AutoJoinedRow key={w.joined} w={w}
        expanded={i === 2}
        selected={i === 5}
      />
    ))}
  </div>
);

/* ====================================================================
   V4 · Mismatched dash report
==================================================================== */

const MismatchRow = ({ m, hot }) => (
  <div style={{
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr 200px',
    gap: 14, alignItems: 'center',
    padding: '14px 16px', borderBottom: '1px solid var(--border-1)',
    background: hot ? 'color-mix(in srgb, var(--mismatch) 5%, transparent)' : 'transparent',
  }}>
    {/* joined form */}
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span className="mono" style={{
        padding: '5px 11px', borderRadius: 6, fontSize: 13.5, fontWeight: 600,
        color: 'var(--exact)',
        background: 'color-mix(in srgb, var(--exact) 12%, transparent)',
        border: '1px solid color-mix(in srgb, var(--exact) 35%, transparent)',
      }}>{m.joined}</span>
      <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>×{m.joinedCount}</span>
    </div>
    {/* hyphenated form */}
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span className="mono" style={{
        padding: '5px 11px', borderRadius: 6, fontSize: 13.5, fontWeight: 600,
        color: 'var(--fuzzy)',
        background: 'color-mix(in srgb, var(--fuzzy) 12%, transparent)',
        border: '1px solid color-mix(in srgb, var(--fuzzy) 35%, transparent)',
      }}>{m.hyphenated}</span>
      <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>×{m.hyphenCount}</span>
    </div>
    {/* pages */}
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {m.pages.slice(0, 6).map(p => (
        <span key={p} className="mono" style={{
          padding: '1px 7px', borderRadius: 3,
          background: 'var(--bg-raised)', border: '1px solid var(--border-1)',
          fontSize: 10.5, color: 'var(--ink-2)', cursor: 'pointer',
        }}>{p}</span>
      ))}
      {m.pages.length > 6 ? (
        <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-4)', padding: '1px 4px' }}>
          +{m.pages.length - 6}
        </span>
      ) : null}
    </div>
    {/* actions */}
    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
      <Button variant="outline" size="sm">
        Use <span className="mono" style={{ color: 'var(--exact)' }}>{m.joined}</span>
      </Button>
      <Button variant="outline" size="sm">
        Use <span className="mono" style={{ color: 'var(--fuzzy)' }}>{m.hyphenated}</span>
      </Button>
    </div>
  </div>
);

const MismatchedReportV4 = () => (
  <div style={{
    background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 10,
    overflow: 'hidden',
  }}>
    <SectionHead
      title={<>Mismatched dashes · 3 <span style={{ color: 'var(--gt)', fontWeight: 600 }}>· post-book</span></>}
      hint="Same word, both forms present · auto-bundled into post-processing notes"
      right={
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="mono" style={{
            padding: '2px 8px', borderRadius: 4,
            background: 'color-mix(in srgb, var(--gt) 12%, transparent)',
            border: '1px solid color-mix(in srgb, var(--gt) 35%, transparent)',
            fontSize: 10.5, fontWeight: 600, color: 'var(--gt)',
            display: 'inline-flex', alignItems: 'center', gap: 4,
          }}>
            <Icon name="bell" size={10} />
            corpus pass
          </span>
          <Button variant="ghost" size="sm" icon="download">Export pairs</Button>
        </div>
      }
    />
    {/* header row */}
    <div style={{
      display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 200px', gap: 14,
      padding: '8px 16px', background: 'var(--bg-page)',
      borderBottom: '1px solid var(--border-1)',
      fontSize: 9.5, fontWeight: 700, letterSpacing: '.1em',
      textTransform: 'uppercase', color: 'var(--ink-4)',
    }}>
      <span>Joined form</span>
      <span>Hyphenated form</span>
      <span>Pages</span>
      <span style={{ textAlign: 'right' }}>Resolve</span>
    </div>
    {MISMATCHED.map((m, i) => <MismatchRow key={m.joined} m={m} hot={i === 0} />)}
  </div>
);

/* ====================================================================
   Frame composites — Hyphen Report (per-book) views
==================================================================== */

const PerBookFrame = ({ theme, children, sub }) => (
  <ProjectConfigureFrame theme={theme} currentTab="settings">
    {/* Subhead row · ties this section to the settings tab visually */}
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
      <div>
        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink-1)' }}>Text post-process</div>
        <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>{sub}</div>
      </div>
      <Button variant="ghost" size="sm" icon="wrench">Edit global library</Button>
    </div>
    <ReportHeader />
    <ReportStatTiles />
    {children}
  </ProjectConfigureFrame>
);

const HyphenV1 = ({ theme }) => (
  <PerBookFrame theme={theme} sub="Hyphen Join Report · 42 auto-joined of 49 cross-line cases. 7 need a decision.">
    <UndecidedListV1 />
  </PerBookFrame>
);

const HyphenV2 = ({ theme }) => (
  <PerBookFrame theme={theme} sub="Card grid · keyboard-driven. Focus moves with J/K; Y/N/B/S decide the focused card.">
    <UndecidedListV2 />
  </PerBookFrame>
);

const PostBookNotesPreview = () => {
  const flagged = UNDECIDED_CASES.filter(c => c.postBook);
  const crossPage = UNDECIDED_CASES.filter(c => c.crossPage);
  const mismatchedFmt = MISMATCHED;
  return (
    <div style={{
      background: 'var(--bg-surface)', border: '1px solid var(--border-1)',
      borderRadius: 10, overflow: 'hidden',
    }}>
      <SectionHead
        title={<>Post-processing notes <span style={{ color: 'var(--gt)' }}>· bundled for export</span></>}
        hint={`${flagged.length + crossPage.length + mismatchedFmt.length} items will ride along with the package`}
        right={
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span className="mono" style={{
              padding: '2px 7px', borderRadius: 4,
              background: 'var(--bg-raised)', border: '1px solid var(--border-1)',
              fontSize: 10.5, color: 'var(--ink-2)',
            }}>post-processing-notes.json</span>
            <Button variant="ghost" size="sm" icon="eye">Preview</Button>
            <Button variant="ghost" size="sm" icon="download">Export</Button>
          </div>
        }
      />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 0 }}>
        {/* Flagged */}
        <div style={{ padding: '12px 14px', borderRight: '1px solid var(--border-1)' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            fontSize: 9.5, fontWeight: 700, letterSpacing: '.1em',
            textTransform: 'uppercase', color: 'var(--ink-4)', marginBottom: 8,
          }}>
            <Icon name="bell" size={11} style={{ color: 'var(--gt)' }} />
            <span>Flagged · {flagged.length}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {flagged.map(c => (
              <div key={c.id} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span className="mono" style={{ fontSize: 11.5, color: 'var(--ink-1)', fontWeight: 600 }}>
                  {c.head}-{c.tail}
                  <span style={{ color: 'var(--ink-4)', fontWeight: 400 }}> · {c.pageId} L{c.line}</span>
                </span>
                <span style={{ fontSize: 10.5, color: 'var(--ink-3)', lineHeight: 1.4 }}>
                  {c.postBook.reason}
                </span>
              </div>
            ))}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, opacity: 0.6 }}>
              <span className="mono" style={{ fontSize: 11.5, color: 'var(--ink-2)' }}>
                end-orsham
                <span style={{ color: 'var(--ink-4)' }}> · p014 L23</span>
              </span>
              <span style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>
                possible OCR error on proper noun
              </span>
            </div>
          </div>
        </div>

        {/* Cross-page */}
        <div style={{ padding: '12px 14px', borderRight: '1px solid var(--border-1)' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            fontSize: 9.5, fontWeight: 700, letterSpacing: '.1em',
            textTransform: 'uppercase', color: 'var(--ink-4)', marginBottom: 8,
          }}>
            <Icon name="swap" size={11} style={{ color: 'var(--gt)' }} />
            <span>Cross-page · {crossPage.length}</span>
            <span style={{ fontWeight: 500, color: 'var(--ink-4)', letterSpacing: 0, textTransform: 'none' }}>· auto-routed</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {crossPage.map(c => (
              <div key={c.id} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span className="mono" style={{ fontSize: 11.5, color: 'var(--ink-1)', fontWeight: 600 }}>
                  {c.head}-{c.tail}
                  <span style={{ color: 'var(--ink-4)', fontWeight: 400 }}> · {c.crossPage.fromPage}→{c.crossPage.toPage}</span>
                </span>
                <span style={{ fontSize: 10.5, color: 'var(--ink-3)', lineHeight: 1.4 }}>
                  skip {c.crossPage.skipped}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Mismatched dashes */}
        <div style={{ padding: '12px 14px' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            fontSize: 9.5, fontWeight: 700, letterSpacing: '.1em',
            textTransform: 'uppercase', color: 'var(--ink-4)', marginBottom: 8,
          }}>
            <Icon name="alert" size={11} style={{ color: 'var(--gt)' }} />
            <span>Mismatched · {mismatchedFmt.length}</span>
            <span style={{ fontWeight: 500, color: 'var(--ink-4)', letterSpacing: 0, textTransform: 'none' }}>· corpus pass</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {mismatchedFmt.map(m => (
              <div key={m.joined} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span className="mono" style={{ fontSize: 11.5, color: 'var(--ink-1)', fontWeight: 600 }}>
                  {m.joined}
                  <span style={{ color: 'var(--ink-4)' }}> ↔ </span>
                  {m.hyphenated}
                </span>
                <span style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>
                  {m.joinedCount}× joined / {m.hyphenCount}× hyphen · {m.pages.length} pages
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

const HyphenV3 = ({ theme }) => (
  <ProjectConfigureFrame theme={theme} currentTab="settings">
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
      <div>
        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink-1)' }}>Hyphen Join · Queue mode</div>
        <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>
          Decide one case at a time. Keyboard-driven. <Kbd>F</Kbd> flags for post-book processing.
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <ViewToggle active="queue" />
        <Button variant="ghost" size="sm" icon="wrench">Edit global library</Button>
      </div>
    </div>
    <ReportStatTiles />
    <div style={{ display: 'flex', gap: 16, alignItems: 'stretch', minHeight: 0 }}>
      <QueueSidebar activeId={2} />
      <QueueCase c={UNDECIDED_CASES[1]} />
    </div>
    <PostBookNotesPreview />
  </ProjectConfigureFrame>
);

const HyphenV4 = ({ theme }) => (
  <PerBookFrame theme={theme} sub="Mismatched dash report · same word, both joined and hyphenated forms present in this book.">
    <MismatchedReportV4 />
  </PerBookFrame>
);

const HyphenV5 = ({ theme }) => (
  <PerBookFrame theme={theme} sub="Auto-joined validation · grouped by word. Each row = one unique joined word. Expand to see every instance. The 'overwhelming' row is flagged because the book also contains an un-joined 'over-whelming'.">
    <AutoJoinedList />
  </PerBookFrame>
);

/* ====================================================================
   Global Settings library · shell
==================================================================== */

const SettingsPageFrame = ({ theme, children, currentTab }) => {
  const tabs = [
    { id: 'general',  name: 'General' },
    { id: 'ocr',      name: 'OCR' },
    { id: 'scannos',  name: 'Scannos',     count: SCANNOS.length },
    { id: 'hyphens',  name: 'Hyphen rules', count:
      HYPHEN_RULES.beginnings.length + HYPHEN_RULES.endings.length +
      HYPHEN_RULES.alwaysJoin.length + HYPHEN_RULES.alwaysKeep.length },
  ];
  return (
    <div className="pgd" data-theme={theme} style={{
      width: '100%', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden',
      background: 'var(--bg-page)',
    }}>
      <TopNav />
      <main style={{ flex: 1, overflow: 'auto' }}>
        <div style={{ maxWidth: 920, margin: '0 auto', padding: '32px 32px 64px' }}>
          {/* Page header */}
          <div style={{
            display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
            marginBottom: 8,
          }}>
            <div>
              <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--ink-1)' }}>
                Settings
              </h1>
              <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 4 }}>
                System-wide defaults applied to every new project.
              </div>
            </div>
            <Button variant="primary" size="md" icon="check">Save changes</Button>
          </div>

          {/* Tabs */}
          <div style={{
            marginTop: 18, borderBottom: '1px solid var(--border-1)',
            display: 'flex', gap: 22,
          }}>
            {tabs.map(t => (
              <div key={t.id} style={{ position: 'relative', height: 36, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <span style={{
                  fontSize: 12, fontWeight: 500,
                  color: t.id === currentTab ? 'var(--ink-1)' : 'var(--ink-3)',
                }}>{t.name}</span>
                {t.count != null ? (
                  <span className="mono" style={{
                    fontSize: 10, padding: '1px 5px', borderRadius: 4,
                    background: t.id === currentTab
                      ? 'color-mix(in srgb, var(--accent) 20%, transparent)'
                      : 'var(--bg-raised)',
                    color: t.id === currentTab ? 'var(--accent)' : 'var(--ink-3)',
                  }}>{t.count}</span>
                ) : null}
                {t.id === currentTab ? (
                  <span style={{
                    position: 'absolute', left: 0, right: 0, bottom: -1, height: 2,
                    background: 'var(--accent)', borderRadius: '2px 2px 0 0',
                  }} />
                ) : null}
              </div>
            ))}
          </div>

          <div style={{ marginTop: 22, display: 'flex', flexDirection: 'column', gap: 18 }}>
            {children}
          </div>
        </div>
      </main>
    </div>
  );
};

/* ---------------------- Hyphen rules tab (V5) ---------------------- */

const RuleChip = ({ text, big }) => (
  <span style={{
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: big ? '3px 9px' : '2px 7px',
    borderRadius: 6,
    background: 'var(--bg-raised)', border: '1px solid var(--border-2)',
    fontFamily: 'var(--mono-font)', fontSize: big ? 12 : 11, color: 'var(--ink-1)',
  }}>
    {text}
    <span style={{ color: 'var(--ink-4)', cursor: 'pointer', lineHeight: 0.7, fontSize: 14 }}>×</span>
  </span>
);

const TagList = ({ title, sub, items, addLabel, tone, dense }) => (
  <div style={{
    background: 'var(--bg-surface)', border: '1px solid var(--border-1)',
    borderRadius: 9, overflow: 'hidden',
  }}>
    <div style={{
      padding: '12px 14px', borderBottom: '1px solid var(--border-1)',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    }}>
      <div>
        <div style={{
          display: 'flex', alignItems: 'baseline', gap: 8,
        }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-1)' }}>{title}</span>
          <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>{items.length}</span>
          {tone ? <Pip tone={tone}>{tone === 'exact' ? 'join' : 'keep'}</Pip> : null}
        </div>
        {sub ? <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 3 }}>{sub}</div> : null}
      </div>
      <Button variant="ghost" size="sm" icon="plus">{addLabel}</Button>
    </div>
    <div style={{
      padding: 12,
      display: 'flex', flexWrap: 'wrap', gap: dense ? 5 : 6,
    }}>
      {items.map(t => <RuleChip key={t} text={t} />)}
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '2px 8px', borderRadius: 6,
        border: '1px dashed var(--border-2)',
        fontFamily: 'var(--mono-font)', fontSize: 11, color: 'var(--ink-4)', cursor: 'text',
      }}>+ add…</span>
    </div>
  </div>
);

const HyphenLibraryTab = () => (
  <>
    <div style={{
      padding: '12px 16px', borderRadius: 9,
      background: 'color-mix(in srgb, var(--ocr) 8%, var(--bg-surface))',
      border: '1px solid color-mix(in srgb, var(--ocr) 30%, var(--border-1))',
      display: 'flex', gap: 12, alignItems: 'flex-start',
    }}>
      <Icon name="info" size={14} style={{ color: 'var(--ocr)', marginTop: 2 }} />
      <div style={{ flex: 1, fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.55 }}>
        Cross-line hyphens are auto-joined when the head matches a <b>beginning</b> or the tail matches an <b>ending</b>,
        and forced into the <b>always-join</b> or <b>always-keep</b> form when present in those lists.
        These rules apply to <i>every new project</i>; per-book overrides live in the project's Settings tab.
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <Button variant="ghost" size="sm" icon="download">Export JSON</Button>
        <Button variant="outline" size="sm" icon="download">Import JSON</Button>
      </div>
    </div>

    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
      <TagList
        title="Beginnings"
        sub="head fragment ending in '-' · e.g. join 'self-' + 'evident'."
        items={HYPHEN_RULES.beginnings}
        addLabel="Add beginning"
      />
      <TagList
        title="Endings"
        sub="tail fragment starting with '-' · e.g. join 'after-' + '-noon'."
        items={HYPHEN_RULES.endings}
        addLabel="Add ending"
      />
      <TagList
        title="Always join"
        sub="Specific words to always join across a line break."
        items={HYPHEN_RULES.alwaysJoin}
        addLabel="Add word"
        tone="exact"
        dense
      />
      <TagList
        title="Always keep hyphen"
        sub="Specific compounds to always preserve."
        items={HYPHEN_RULES.alwaysKeep}
        addLabel="Add word"
        tone="fuzzy"
        dense
      />
    </div>
  </>
);

/* ---------------------- Scannos tab (V6) ---------------------- */

const ScannosTable = () => (
  <div style={{
    background: 'var(--bg-surface)', border: '1px solid var(--border-1)',
    borderRadius: 9, overflow: 'hidden',
  }}>
    <div style={{
      padding: '12px 14px', borderBottom: '1px solid var(--border-1)',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    }}>
      <div>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-1)' }}>OCR scannos · find &rarr; replace</div>
        <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 3 }}>
          Applied after text_post_process. Counts show occurrences in current project.
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <Button variant="ghost" size="sm" icon="download">CSV</Button>
        <Button variant="outline" size="sm" icon="plus">Add row</Button>
      </div>
    </div>
    {/* col head */}
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1.2fr 1.2fr 90px 110px 90px',
      gap: 12,
      padding: '8px 14px', background: 'var(--bg-page)',
      borderBottom: '1px solid var(--border-1)',
      fontSize: 9.5, fontWeight: 700, letterSpacing: '.1em',
      textTransform: 'uppercase', color: 'var(--ink-4)',
    }}>
      <span>Find</span>
      <span>Replace</span>
      <span>Count</span>
      <span>Ignore case</span>
      <span style={{ textAlign: 'right' }}>·</span>
    </div>
    {SCANNOS.map((s, i) => (
      <div key={i} style={{
        display: 'grid',
        gridTemplateColumns: '1.2fr 1.2fr 90px 110px 90px',
        gap: 12, alignItems: 'center',
        padding: '8px 14px', borderBottom: i === SCANNOS.length - 1 ? 'none' : '1px solid var(--border-1)',
      }}>
        <Input value={s.find} mono />
        <Input value={s.replace} mono />
        <span className="mono" style={{ fontSize: 11.5, color: s.count > 10 ? 'var(--accent)' : 'var(--ink-2)', fontWeight: 600 }}>
          {s.count}
        </span>
        <span>
          <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 16, height: 16, borderRadius: 3,
            background: s.ignoreCase ? 'var(--accent)' : 'var(--bg-raised)',
            border: `1px solid ${s.ignoreCase ? 'var(--accent)' : 'var(--border-2)'}`,
            color: 'var(--accent-ink)',
          }}>
            {s.ignoreCase ? <Icon name="check" size={11} stroke={3} /> : null}
          </span>
        </span>
        <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
          <Button variant="ghost" size="sm" icon="search" />
          <Button variant="ghost" size="sm">
            <span style={{ color: 'var(--ink-4)' }}>×</span>
          </Button>
        </div>
      </div>
    ))}
  </div>
);

const ScannosLibraryTab = () => (
  <>
    <div style={{
      padding: '12px 16px', borderRadius: 9,
      background: 'color-mix(in srgb, var(--ocr) 8%, var(--bg-surface))',
      border: '1px solid color-mix(in srgb, var(--ocr) 30%, var(--border-1))',
      display: 'flex', gap: 12, alignItems: 'flex-start',
    }}>
      <Icon name="info" size={14} style={{ color: 'var(--ocr)', marginTop: 2 }} />
      <div style={{ flex: 1, fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.55 }}>
        OCR scannos are find/replace pairs applied after <span className="mono">text_post_process</span>.
        Counts show occurrences across the open project (belloc-survivals).
      </div>
    </div>
    <ScannosTable />
  </>
);

/* ---------------------- Settings frame wrappers ---------------------- */

const SettingsHyphens = ({ theme }) => (
  <SettingsPageFrame theme={theme} currentTab="hyphens">
    <HyphenLibraryTab />
  </SettingsPageFrame>
);

const SettingsScannos = ({ theme }) => (
  <SettingsPageFrame theme={theme} currentTab="scannos">
    <ScannosLibraryTab />
  </SettingsPageFrame>
);

/* ====================================================================
   Exports
==================================================================== */

Object.assign(window, {
  HyphenV1, HyphenV2, HyphenV3, HyphenV4, HyphenV5,
  SettingsHyphens, SettingsScannos,
  // Inner content components — exported so the final/hyphen_join/ app
  // can compose them inside PipelineTemplate without the wf05 wf-only
  // ProjectConfigureFrame chrome.
  StatTile, SectionHead, Kbd, ViewToggle,
  ReportHeader, ReportStatTiles,
  UndecidedListV1, UndecidedListV2,
  AutoJoinedList, MismatchedReportV4,
  QueueSidebar, QueueCase, PostBookNotesPreview,
  Pip, LB, PageBreak, ContextSnippet, ProposalPills, NgramsBlock, Sparkline,
  AUTO_JOINED_WORDS, UNDECIDED_CASES, MISMATCHED,
});
