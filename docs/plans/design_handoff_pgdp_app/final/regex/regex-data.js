// regex-data.js — stage 18 · Regex pass (project-scoped find/replace)
// A saved, ordered set of regex rules run across every page’s proofer text.
// Rules apply top-to-bottom; each previews its matches before it’s committed,
// and the whole pass is reversible (a snapshot is taken before it runs).

const RX_COUNTS = { rules: 8, applied: 5, review: 2, pending: 1, matches: 4863 };

// status: applied · review (matches look off, needs a human) · pending (not run yet)
const RX_RULES = [
  { id:'r1', name:'Em-dash → double-hyphen', find:'\\u2014',                 repl:'--',          scope:'all pages', matches:412,  status:'applied', flags:'g'  },
  { id:'r2', name:'Straighten curly quotes', find:'[\\u201C\\u201D]',         repl:'"',           scope:'all pages', matches:2106, status:'applied', flags:'g'  },
  { id:'r3', name:'Straighten apostrophes',  find:'[\\u2018\\u2019]',         repl:"'",           scope:'all pages', matches:1187, status:'applied', flags:'g'  },
  { id:'r4', name:'Expand fi / fl ligatures',find:'\\uFB01|\\uFB02',          repl:'fi · fl',     scope:'all pages', matches:96,   status:'applied', flags:'g'  },
  { id:'r5', name:'Collapse repeated spaces', find:'  +',                     repl:'· (1 space)', scope:'all pages', matches:842,  status:'applied', flags:'gm' },
  { id:'r6', name:'Space before punctuation', find:' ([,.;:!?])',             repl:'$1',          scope:'body text', matches:34,   status:'review',  flags:'g'  },
  { id:'r7', name:'Normalise spaced ellipsis',find:'\\.\\s*\\.\\s*\\.',       repl:'...',         scope:'body text', matches:18,   status:'review',  flags:'g'  },
  { id:'r8', name:'Thought-break asterisks',  find:'^\\s*\\*( ?\\*){2}\\s*$', repl:'*       *       *', scope:'all pages', matches:5, status:'pending', flags:'gm' },
];

// preview diff for the highlighted rule (r6 · space before punctuation)
const RX_PREVIEW = {
  rule: 'r6',
  hunks: [
    { page:'p.043', before:'the garden , where the roses', after:'the garden, where the roses' },
    { page:'p.043', before:'asked him : “Why ?”',          after:'asked him: “Why?”' },
    { page:'p.118', before:'three things ; namely',        after:'three things; namely' },
    { page:'p.260', before:'M . Belloc remarked',          after:'M. Belloc remarked', warn:true },
  ],
};

Object.assign(window, { RX_COUNTS, RX_RULES, RX_PREVIEW });
