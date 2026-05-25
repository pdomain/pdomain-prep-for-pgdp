/**
 * Two-column split-view renderer for the line-diff produced by
 * `lineDiff.ts`. Used by the per-page re-OCR diff feature
 * (P1 #7) — see iter 14 for the wire-up into `TextReviewPage`.
 *
 * Layout: a two-column grid with monospace text. Equal lines
 * appear in both columns; deletes appear left-only with a red
 * tint; inserts appear right-only with a green tint. Adjacent
 * delete/insert pairs (which the LCS back-trace emits in that
 * order — see `lineDiff.ts`) are paired into a single row so a
 * corrected line shows side-by-side. Unpaired runs (multiple
 * deletes with no matching inserts, or vice versa) stack with
 * the opposite column rendered as an empty placeholder cell, so
 * line numbers stay readable without invasive empty rows.
 *
 * Tailwind palette mirrors `TextReviewPage` / `WordBboxOverlay`:
 * slate-* for chrome, red-50/100 for deletes, emerald-50/100 for
 * inserts. No emoji, no intra-line word-diff (a future polish).
 */

import type { DiffLine } from "./lineDiff";

interface Props {
  diff: readonly DiffLine[];
  /** Optional class on the outer wrapper. */
  className?: string;
}

interface Row {
  left: DiffLine | null;
  right: DiffLine | null;
}

/**
 * Pair adjacent delete/insert into a single row. Single pass:
 *   - equal -> row with both columns
 *   - delete followed immediately by insert -> paired row
 *   - lone delete -> row with empty right
 *   - lone insert -> row with empty left
 */
function buildRows(diff: readonly DiffLine[]): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < diff.length; i++) {
    // noUncheckedIndexedAccess: i < diff.length guarantees defined
    const d = diff[i]!;
    if (d.kind === "equal") {
      rows.push({ left: d, right: d });
    } else if (d.kind === "delete") {
      const peek = diff[i + 1];
      if (peek?.kind === "insert") {
        rows.push({ left: d, right: peek });
        i++;
      } else {
        rows.push({ left: d, right: null });
      }
    } else {
      // insert with no preceding delete to pair with
      rows.push({ left: null, right: d });
    }
  }
  return rows;
}

function gutter(no: number | null): string {
  return no === null ? "" : String(no);
}

export function LineDiffView({ diff, className }: Props) {
  const rows = buildRows(diff);
  return (
    <div
      className={
        "overflow-auto rounded border border-border-2 bg-surface font-mono text-xs " +
        (className ?? "")
      }
    >
      <div className="grid grid-cols-2 divide-x divide-slate-200">
        <Column side="left" rows={rows} label="Prior" />
        <Column side="right" rows={rows} label="New" />
      </div>
    </div>
  );
}

function Column({
  side,
  rows,
  label,
}: {
  side: "left" | "right";
  rows: readonly Row[];
  label: string;
}) {
  return (
    <div>
      <div className="sticky top-0 z-10 border-b border-border-1 bg-page px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-ink-3">
        {label}
      </div>
      <div>
        {rows.map((row, idx) => {
          const cell = side === "left" ? row.left : row.right;
          // Render an empty row so paired/un-paired rows stay aligned
          // across columns (same vertical rhythm).
          if (cell === null) {
            return (
              <div
                key={idx}
                className="flex min-h-[1.25rem] items-start bg-page/50 px-2 leading-5"
              >
                <span className="w-8 select-none text-right text-ink-4">
                  &nbsp;
                </span>
                <span className="ml-2 whitespace-pre text-ink-4">&nbsp;</span>
              </div>
            );
          }
          const tint =
            cell.kind === "delete"
              ? "bg-red-50 text-red-900"
              : cell.kind === "insert"
                ? "bg-emerald-50 text-emerald-900"
                : "text-ink-2";
          const lineNo = side === "left" ? cell.priorLineNo : cell.nextLineNo;
          return (
            <div
              key={idx}
              className={`flex min-h-[1.25rem] items-start px-2 leading-5 ${tint}`}
            >
              <span className="w-8 select-none text-right text-ink-4">
                {gutter(lineNo)}
              </span>
              <span className="ml-2 whitespace-pre">
                {cell.text === "" ? " " : cell.text}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
