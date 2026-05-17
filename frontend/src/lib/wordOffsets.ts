/**
 * Pure character-offset mapping between an OCR word list and the
 * rendered page text the user edits in `TextReviewPage`'s textarea.
 *
 * Why a separate file: the actual highlight UI (Konva overlay + click
 * handlers) is the next-iteration job. The offset bookkeeping is a
 * pure function — it deserves to be testable and reusable in
 * isolation, so when the Konva layer lands it can just call
 * `wordToRange` / `offsetToWord` instead of reimplementing the math.
 *
 * Wire shape — mirrors `src/pd_prep_for_pgdp/core/models.py::OcrWord`.
 * Once the OpenAPI export covers the OCR endpoint these can be
 * replaced with the generated types.
 */
export interface BoundingBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface OcrWord {
  id: string;
  text: string;
  confidence: number;
  bounding_box: BoundingBox;
  split_suffix?: string | null;
}

/** Half-open character range `[start, end)` into the textarea text. */
export interface CharRange {
  start: number;
  end: number;
}

/**
 * Index built once per (text, words) pair. `ranges[i]` is the
 * resolved char range for `words[i]`, or `null` when the word's
 * literal text could not be located in `text` in reading-order
 * sequence (e.g. fused into a drop cap, or consumed by a
 * post-processing fix). Unresolved words are still allowed; they
 * simply have no clickable bbox highlight.
 */
export interface WordOffsetIndex {
  text: string;
  words: ReadonlyArray<OcrWord>;
  ranges: ReadonlyArray<CharRange | null>;
  /**
   * Resolved ranges sorted by `start`, paired with the original
   * word index. Used by `offsetToWord` for O(log n) lookup.
   */
  sorted: ReadonlyArray<{ start: number; end: number; wordIndex: number }>;
}

/**
 * Build the offset index. Walks `text` left-to-right, locating each
 * word's literal `.text` at or after the current cursor.
 *
 * The matcher tolerates intervening whitespace (spaces, tabs, CR/LF)
 * — that's the spacer pd-book-tools inserts between words in the
 * same line, and the double-newline it inserts between blocks. It
 * does NOT skip non-whitespace characters: if a word is fused into a
 * drop cap (`"R'" + "EADER!" → "R'EADER!"`) the second word won't
 * match and is recorded as `null`, which is the desired conservative
 * outcome.
 *
 * Empty / whitespace-only word.text values are ignored (recorded as
 * null) — those are positionally-tracked OCR artefacts, see
 * `pd_book_tools/ocr/block.py::text`.
 */
export function buildWordOffsetIndex(
  text: string,
  words: ReadonlyArray<OcrWord>,
): WordOffsetIndex {
  const ranges: Array<CharRange | null> = new Array(words.length).fill(null);
  let cursor = 0;

  for (let i = 0; i < words.length; i++) {
    // noUncheckedIndexedAccess: i < words.length guarantees defined
    const w = words[i]!;
    const wt = w.text;
    if (!wt || wt.trim() === "") {
      ranges[i] = null;
      continue;
    }

    // Skip whitespace from the cursor, but stop as soon as we hit a
    // non-ws char so we anchor at the next "real" token start.
    let probe = cursor;
    while (probe < text.length && /\s/.test(text[probe] ?? "")) probe++;

    if (text.startsWith(wt, probe)) {
      ranges[i] = { start: probe, end: probe + wt.length };
      cursor = probe + wt.length;
      continue;
    }

    // Bounded forward search — the word may have been edited / split
    // / merged in `text`. Cap the window so we never silently skip
    // huge chunks (which would make later words match wrong tokens).
    const window = Math.min(text.length, probe + Math.max(64, wt.length * 4));
    const found = text.indexOf(wt, probe);
    if (found !== -1 && found < window) {
      ranges[i] = { start: found, end: found + wt.length };
      cursor = found + wt.length;
    } else {
      ranges[i] = null;
      // Don't advance cursor — keep trying to match later words from
      // the same anchor.
    }
  }

  const sorted = ranges
    .map((r, wordIndex) =>
      r ? { start: r.start, end: r.end, wordIndex } : null,
    )
    .filter(
      (x): x is { start: number; end: number; wordIndex: number } => x !== null,
    )
    .sort((a, b) => a.start - b.start || a.end - b.end);

  return { text, words, ranges, sorted };
}

/**
 * Char-range for the word at `wordIndex`, or `null` if it could not
 * be resolved against `text`. Out-of-range indices return `null`.
 */
export function wordToRange(
  index: WordOffsetIndex,
  wordIndex: number,
): CharRange | null {
  if (wordIndex < 0 || wordIndex >= index.ranges.length) return null;
  // noUncheckedIndexedAccess: bounds checked above
  return index.ranges[wordIndex] ?? null;
}

/**
 * Find the word containing the given character `offset`. Returns
 * `null` when the offset is inside whitespace / a newline / a
 * non-OCR section of the text. O(log n) via binary search on
 * `sorted`.
 *
 * Half-open semantics: an offset that lands on the closing boundary
 * of a word (i.e. `offset === range.end`) is considered to be AFTER
 * that word — it's the first position of the following gap. This
 * matches typical textarea cursor behaviour (cursor sits between
 * characters).
 */
export function offsetToWord(
  index: WordOffsetIndex,
  offset: number,
): { wordIndex: number; range: CharRange } | null {
  const arr = index.sorted;
  if (arr.length === 0) return null;
  let lo = 0;
  let hi = arr.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    // noUncheckedIndexedAccess: lo..hi stay within arr.length bounds
    const r = arr[mid]!;
    if (offset < r.start) hi = mid - 1;
    else if (offset >= r.end) lo = mid + 1;
    else
      return { wordIndex: r.wordIndex, range: { start: r.start, end: r.end } };
  }
  return null;
}
