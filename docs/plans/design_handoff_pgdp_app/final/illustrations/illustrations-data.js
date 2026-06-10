// illustrations-data.js — stage 17 · Illustrations (detect + extract)
// Reads the illustration zones marked in Page layout (stage 9) and extracts
// each region as a standalone high-res crop, kept as grayscale/contone
// (never the bilevel text image) so plates survive into the proof pack.

const ILL_COUNTS = { detected: 54, extracted: 49, review: 3, flagged: 2 };

// kinds drive how a region is extracted + named.
const ILL_KINDS = [
  { id: 'plate',   name: 'Halftone plate',     tone: 'ocr',   keep: 'grayscale · 300dpi' },
  { id: 'line',    name: 'Line engraving',     tone: 'gt',    keep: 'bilevel · 600dpi' },
  { id: 'initial', name: 'Decorative initial', tone: 'fuzzy', keep: 'bilevel · inline' },
  { id: 'figure',  name: 'Inline figure',      tone: 'para',  keep: 'grayscale · 300dpi' },
];

// Sample extracted illustrations for the gallery.
const ILL_ITEMS = [
  { id: 'i012', page: 'p.012', kind: 'plate',   w: 1840, h: 2360, status: 'extracted', note: 'Frontispiece — full-page halftone' },
  { id: 'i047', page: 'p.047', kind: 'line',    w: 1120, h: 880,  status: 'extracted', note: 'Map engraving' },
  { id: 'i061', page: 'p.061', kind: 'initial', w: 320,  h: 320,  status: 'extracted', note: 'Drop-cap “W”' },
  { id: 'i088', page: 'p.088', kind: 'figure',  w: 980,  h: 720,  status: 'review',    note: 'Bounds clip caption — extend down?' },
  { id: 'i103', page: 'p.103', kind: 'plate',   w: 1760, h: 2280, status: 'extracted', note: 'Tipped-in plate' },
  { id: 'i124', page: 'p.124', kind: 'line',    w: 760,  h: 1180, status: 'flagged',   note: 'Detected inside text column — false positive?' },
  { id: 'i150', page: 'p.150', kind: 'figure',  w: 1040, h: 640,  status: 'review',    note: 'Two figures share one zone — split?' },
  { id: 'i177', page: 'p.177', kind: 'initial', w: 300,  h: 300,  status: 'extracted', note: 'Drop-cap “T”' },
  { id: 'i201', page: 'p.201', kind: 'plate',   w: 1820, h: 2340, status: 'extracted', note: 'Portrait plate' },
  { id: 'i219', page: 'p.219', kind: 'line',    w: 900,  h: 700,  status: 'review',    note: 'Overlaps page number — trim bottom' },
];

Object.assign(window, { ILL_COUNTS, ILL_KINDS, ILL_ITEMS });
