/**
 * Styling normalisation contract tests (ocr-container-meta #331 — Phase 2.7d).
 *
 * Mirrors the pd-ocr-labeler-spa Phase 2.5b contract (meta #264):
 *   1. No class-variance-authority in package.json.
 *   2. No direct `lucide-react` imports in production source.
 *   3. Key shell components use design-system tokens, not raw Tailwind palette.
 *
 * These tests pin the *after* state. They fail against the current source and
 * become green when the refactor commit lands.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import pkg from "../../package.json";

// ── helpers ────────────────────────────────────────────────────────────────

/** Recursively collect all .ts/.tsx paths under a directory. */
function collectSrc(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...collectSrc(full));
    } else if (full.endsWith(".ts") || full.endsWith(".tsx")) {
      results.push(full);
    }
  }
  return results;
}

const SRC_DIR = join(import.meta.dirname, "..");

/** Production-only source: exclude test files and the local-shims shim file. */
const prodFiles = collectSrc(SRC_DIR).filter(
  (p) =>
    !p.includes(".test.") &&
    !p.includes("/test/") &&
    !p.endsWith("local-shims.tsx"),
);

// ── 1. No class-variance-authority ────────────────────────────────────────

describe("class-variance-authority (CVA) absence", () => {
  it("is not listed in package.json dependencies", () => {
    const deps = {
      ...(pkg.dependencies as Record<string, string>),
      ...(pkg.devDependencies as Record<string, string>),
    };
    expect(deps["class-variance-authority"]).toBeUndefined();
  });

  it("is not imported in any production source file", () => {
    const hits = prodFiles.filter((p) =>
      readFileSync(p, "utf8").includes("class-variance-authority"),
    );
    expect(hits, `CVA import found in: ${hits.join(", ")}`).toHaveLength(0);
  });
});

// ── 2. No direct lucide-react imports ────────────────────────────────────

describe("lucide-react direct imports (banned in production source)", () => {
  it("no production file imports directly from lucide-react", () => {
    const LUCIDE_IMPORT = /from\s+['"]lucide-react['"]/;
    const hits = prodFiles.filter((p) =>
      LUCIDE_IMPORT.test(readFileSync(p, "utf8")),
    );
    expect(
      hits,
      `Direct lucide-react import found in: ${hits.join(", ")}`,
    ).toHaveLength(0);
  });
});

// ── 3. Shell components use design-system tokens ──────────────────────────

// Raw Tailwind slate palette classes absent from production components
// after the normalisation sweep.
//
// Exemptions (kept intentionally):
//   bg-amber-N / from-amber-N / to-amber-N — brand glyph gradient
//   bg-indigo-600 / bg-indigo-700 — PageWorkbenchPage "commit OCR" button (specialist)
//   bg-teal-600 — PageWorkbenchPage split-mode highlight (specialist)
//   bg-red-N / bg-blue-N / bg-green-N — PageWorkbenchPage mode btn hues (specialist)
//   bg-black/40, bg-black/30 — overlay scrim pending --overlay-scrim token
//   bg-gradient-to-br — CSS gradient utility, not a palette color
//   text-white on bg-accent / bg-status-error surfaces — accepted as token-adjacent
const BANNED_PALETTE =
  /\b(bg|text|border|hover:bg|hover:text|hover:border)-slate-\d+\b/;

describe("palette colour classes absent from key shell components", () => {
  it("TopNav uses token classes instead of bg-slate-*", () => {
    const src = readFileSync(
      join(SRC_DIR, "components/shell/TopNav.tsx"),
      "utf8",
    );
    const found = BANNED_PALETTE.exec(src);
    expect(
      found,
      `Raw palette classes still present in TopNav: ${found?.[0]}`,
    ).toBeNull();
  });

  it("UserMenu uses token classes instead of bg-slate-*", () => {
    const src = readFileSync(
      join(SRC_DIR, "components/shell/UserMenu.tsx"),
      "utf8",
    );
    const found = BANNED_PALETTE.exec(src);
    expect(
      found,
      `Raw palette classes still present in UserMenu: ${found?.[0]}`,
    ).toBeNull();
  });

  it("OpenTasksPopover uses token classes instead of bg-slate-*", () => {
    const src = readFileSync(
      join(SRC_DIR, "components/OpenTasksPopover.tsx"),
      "utf8",
    );
    const found = BANNED_PALETTE.exec(src);
    expect(
      found,
      `Raw palette classes still present in OpenTasksPopover: ${found?.[0]}`,
    ).toBeNull();
  });
});

// ── 4. ESLint restriction exists for lucide-react ──────────────────────────

describe("ESLint no-restricted-imports rule for lucide-react", () => {
  it("eslint.config.js contains a no-restricted-imports rule for lucide-react", () => {
    const eslintConfig = readFileSync(
      join(SRC_DIR, "../eslint.config.js"),
      "utf8",
    );
    expect(eslintConfig).toContain("lucide-react");
    expect(eslintConfig).toContain("no-restricted-imports");
  });
});
