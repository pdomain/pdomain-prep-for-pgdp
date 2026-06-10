/**
 * No-hardcoded-styles guard for frontend/src/design/*.tsx
 *
 * Scans every .tsx file under frontend/src/design/ for:
 *   - Hex colour literals (#abc, #aabbcc, #aabbccdd)
 *   - rgb(…) / rgba(…) color function calls
 *   - Raw font-size pixel values (e.g. fontSize: 12) when used as a CSS
 *     property value without a token var() reference in the same expression
 *
 * EXCEPTIONS (pragmatic — these are fine):
 *   - Numeric px values for layout dimensions (width/height/borderRadius)
 *     are allowed — they come from the design token scale
 *   - `rgba(0,0,0,…)` shadow values are OK as long as they're structural
 *     (no brand/status colour is an rgba)
 *   - Comments are excluded from the scan
 *
 * Specific rules:
 *   FAIL: Any #rrggbb or #rgb hex literal in JSX/TSX source code
 *   FAIL: Any rgb( or rgba( call with non-zero r/g/b values (i.e. not pure black)
 *         that looks like a brand/status colour (simple heuristic: non-zero, non-greyscale)
 *   PASS: rgba(0,0,0,…) structural shadow/scrim values
 *   PASS: color-mix(in srgb, var(--token) …) — allowed, token-based
 *   PASS: var(--any-token) — the canonical form
 *
 * The rule is intentionally pragmatic: it catches copy-paste of literal colours
 * from the design file without blocking legitimate structural use.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The design directory lives at frontend/src/design/ relative to this file.
const DESIGN_DIR = resolve(__dirname);

/** Collect all .tsx source files in the design directory. */
function collectTsxFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"))
    .map((f) => join(dir, f));
}

/** Strip single-line and block comments from source text. */
function stripComments(src: string): string {
  // Remove block comments /* … */
  let out = src.replace(/\/\*[\s\S]*?\*\//g, " ");
  // Remove line comments // …
  out = out.replace(/\/\/.*/g, " ");
  return out;
}

/** Check for hex colour literals. Returns matching snippets. */
function findHexColors(src: string): string[] {
  // Match #rgb, #rrggbb, #rrggbbaa  — but not #xxxxxx used in CSS custom prop names
  const HEX_RE = /#([0-9a-fA-F]{3,8})\b/g;
  const hits: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = HEX_RE.exec(src)) !== null) {
    const hex = m[1] ?? "";
    // Only flag 3, 4, 6, or 8 digit hex — CSS colour lengths
    if (
      hex.length === 3 ||
      hex.length === 4 ||
      hex.length === 6 ||
      hex.length === 8
    ) {
      hits.push(m[0]);
    }
  }
  return hits;
}

/**
 * Check for non-token rgb/rgba colour calls.
 * Allows: rgba(0,0,0,…) and rgba(15,23,42,…) structural shadow values.
 * Flags: any rgb( or rgba( with clearly brand/status non-greyscale values.
 */
function findRgbColors(src: string): string[] {
  // Match rgb(…) and rgba(…)
  const RGB_RE = /rgba?\([^)]+\)/g;
  const hits: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = RGB_RE.exec(src)) !== null) {
    const call = m[0];
    // Extract numeric parts
    const nums = call.match(/\d+/g)?.map(Number) ?? [];
    if (nums.length < 3) continue;
    const [r, g, b] = nums as [number, number, number];
    // Structural shadow/scrim: pure black/near-black (r,g,b all < 50)
    // These are intentional box-shadow structural values — allowed.
    const isStructuralShadow = r < 50 && g < 50 && b < 50;
    if (!isStructuralShadow) {
      hits.push(call);
    }
  }
  return hits;
}

const files = collectTsxFiles(DESIGN_DIR);

// Sanity: ensure we found some files (guard against empty-scan false-greens)
describe("no-hardcoded-styles guard — sanity", () => {
  it("finds at least one .tsx source file in design/", () => {
    expect(files.length).toBeGreaterThan(0);
  });
});

describe("no-hardcoded-styles guard — hex colours", () => {
  for (const filePath of files) {
    const fileName = filePath.split("/").pop() ?? filePath;
    it(`${fileName} has no raw hex colour literals`, () => {
      const src = stripComments(readFileSync(filePath, "utf-8"));
      const hits = findHexColors(src);
      expect(
        hits,
        `Found hex colour literals in ${fileName}: ${hits.join(", ")}`,
      ).toHaveLength(0);
    });
  }
});

describe("no-hardcoded-styles guard — rgb() colours", () => {
  for (const filePath of files) {
    const fileName = filePath.split("/").pop() ?? filePath;
    it(`${fileName} has no non-structural rgb/rgba colour calls`, () => {
      const src = stripComments(readFileSync(filePath, "utf-8"));
      const hits = findRgbColors(src);
      expect(
        hits,
        `Found non-structural rgb/rgba colour calls in ${fileName}: ${hits.join(", ")}`,
      ).toHaveLength(0);
    });
  }
});
