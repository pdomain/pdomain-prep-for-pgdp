/**
 * Pure-function line-level diff between two strings.
 *
 * Used by the per-page re-OCR diff view in `TextReviewPage` (P1 #7):
 * after the user clicks "Re-OCR this page", we want to show what
 * changed between the prior text and the new text inline. This
 * module does the bookkeeping; the presentational component lives
 * in `lineDiff.tsx`. The UI wire-up to `TextReviewPage` is iter 14.
 *
 * Algorithm: classic LCS over lines via O(n*m) dp table, then
 * back-trace to emit equal/delete/insert events. Page text is at
 * most a few thousand lines so the quadratic table is comfortable.
 * If we ever hit a multi-thousand-line page where this is too slow
 * we can swap in Myers / Hunt–McIlroy without changing this file's
 * exported shape.
 */

export type DiffKind = "equal" | "delete" | "insert";

export interface DiffLine {
  kind: DiffKind;
  /** 1-based line number in `prior`, or `null` for inserts. */
  priorLineNo: number | null;
  /** 1-based line number in `next`, or `null` for deletes. */
  nextLineNo: number | null;
  /** The literal line content (no trailing `\n`). */
  text: string;
}

/**
 * Split a string into lines. We intentionally drop a single
 * trailing empty string produced by `"foo\n".split("\n")` so a
 * file that happens to end with `\n` does not generate a phantom
 * blank line at the end of the diff. A genuine trailing blank
 * line in the source (i.e. the input ends with `\n\n`) survives
 * because only ONE trailing empty is dropped.
 */
function splitLines(s: string): string[] {
  if (s === "") return [];
  const parts = s.split("\n");
  if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

/**
 * Diff two strings line-by-line. Output is an ordered list of
 * `equal` / `delete` / `insert` events covering every line of
 * both inputs exactly once (equal lines appear once, deletes
 * appear once, inserts appear once).
 */
export function diffLines(prior: string, next: string): DiffLine[] {
  const a = splitLines(prior);
  const b = splitLines(next);
  const n = a.length;
  const m = b.length;

  // dp[i][j] = LCS length of a[0..i) and b[0..j).
  // Use a flat Int32Array so it stays cheap even at a few thousand
  // lines per side (~1000*1000*4B = 4MB worst case, fine).
  const dp = new Int32Array((n + 1) * (m + 1));
  const w = m + 1;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (a[i] === b[j]) {
        dp[i * w + j] = (dp[(i + 1) * w + (j + 1)] ?? 0) + 1;
      } else {
        const down = dp[(i + 1) * w + j] ?? 0;
        const right = dp[i * w + (j + 1)] ?? 0;
        dp[i * w + j] = down >= right ? down : right;
      }
    }
  }

  // Back-trace. Emit deletes before inserts at a given divergence
  // point so the visual pairing pass in `lineDiff.tsx` can group
  // adjacent delete+insert into a single row.
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    // noUncheckedIndexedAccess: loop bounds guarantee i < n and j < m
    const ai = a[i]!;
    const bj = b[j]!;
    if (ai === bj) {
      out.push({
        kind: "equal",
        priorLineNo: i + 1,
        nextLineNo: j + 1,
        text: ai,
      });
      i++;
      j++;
    } else if ((dp[(i + 1) * w + j] ?? 0) >= (dp[i * w + (j + 1)] ?? 0)) {
      out.push({
        kind: "delete",
        priorLineNo: i + 1,
        nextLineNo: null,
        text: ai,
      });
      i++;
    } else {
      out.push({
        kind: "insert",
        priorLineNo: null,
        nextLineNo: j + 1,
        text: bj,
      });
      j++;
    }
  }
  while (i < n) {
    // noUncheckedIndexedAccess: i < n guarantees a[i] is defined
    out.push({
      kind: "delete",
      priorLineNo: i + 1,
      nextLineNo: null,
      text: a[i]!,
    });
    i++;
  }
  while (j < m) {
    // noUncheckedIndexedAccess: j < m guarantees b[j] is defined
    out.push({
      kind: "insert",
      priorLineNo: null,
      nextLineNo: j + 1,
      text: b[j]!,
    });
    j++;
  }
  return out;
}
