// sample-data.js — Source-stage sample data.
// 15 files with mixed states so the boards show realistic content.
//
// state machine:
//   pending  — thumbnail not yet generated (skeleton card)
//   ready    — thumbnail done, no mark yet (the user-action state)
//   page     — confirmed body page (carries pageNumber)
//   cover    — front cover / endpapers / title page — exclude
//   back     — back matter / colophon — exclude
//   blank    — blank scan — exclude
//   duplicate — duplicate of another file — exclude
//   inserted — synthetic page added by the user; has kind + optional note
//
// Each file also carries a `tone` (light/mid/dark) and an optional accent
// hue used by the FakeThumb component so the grid looks like a real book
// without needing actual images.

const SOURCE_FILES = [
  { idx: 0,  stem: 'belloc_0001.jp2', state: 'cover', tone: 'mid',  hue: 28 },
  { idx: 1,  stem: 'belloc_0002.jp2', state: 'cover', tone: 'light', hue: 28 },
  { idx: 2,  stem: 'belloc_0003.jp2', state: 'page',  tone: 'light', pageNumber: 'i'  },
  { idx: 3,  stem: 'belloc_0004.jp2', state: 'page',  tone: 'light', pageNumber: 'ii' },
  { idx: 4,  stem: 'belloc_0005.jp2', state: 'page',  tone: 'light', pageNumber: 'iii'},
  { idx: 5,  stem: 'belloc_0006.jp2', state: 'page',  tone: 'light', pageNumber: '1'  },
  { idx: 6,  stem: 'belloc_0007.jp2', state: 'page',  tone: 'light', pageNumber: '2'  },
  { idx: 7,  stem: '__inserted_001',  state: 'inserted', kind: 'missing', note: 'Missing page 3 from scan — sourced from another copy.' },
  { idx: 8,  stem: 'belloc_0008.jp2', state: 'page',  tone: 'light', pageNumber: '4'  },
  { idx: 9,  stem: 'belloc_0009.jp2', state: 'blank', tone: 'light' },
  { idx: 10, stem: 'belloc_0010.jp2', state: 'ready', tone: 'light' },
  { idx: 11, stem: 'belloc_0011.jp2', state: 'ready', tone: 'light' },
  { idx: 12, stem: 'belloc_0012.jp2', state: 'pending' },
  { idx: 13, stem: 'belloc_0013.jp2', state: 'pending' },
  { idx: 14, stem: 'belloc_0014.jp2', state: 'pending' },
];

// Counts that drive the banner numbers (we lie slightly so the banner shows
// totals as if the project had 387 files — easier to read across artboards).
const SOURCE_TOTALS = {
  files:     387,
  thumbed:   165,
  remaining: 222,
  rateHz:    14.2,
  marked: {
    page:  232,
    cover: 12,
    back:  6,
    blank: 8,
    duplicate: 0,
    inserted: 4,
  },
  unmarked: 125,
};

const SOURCE_TOTALS_DONE = {
  ...SOURCE_TOTALS,
  thumbed: 387, remaining: 0,
};

Object.assign(window, { SOURCE_FILES, SOURCE_TOTALS, SOURCE_TOTALS_DONE });
