/**
 * Testid contract for pdomain-prep-for-pgdp after the full pdomain-ui migration (Phases 2.7a–2.7d).
 *
 * ocr-container-meta #332 — Phase 2.7e: Playwright driver pass.
 *
 * Two layers of contract:
 *
 * 1. pdomain-ui shell testids — The real AppShell (from @pdomain/pdomain-ui/shell)
 *    emits `data-testid="app-shell"`, `app-shell-header`, `app-shell-main`, etc.
 *    These are the strings Playwright drivers must use to anchor on the shell root.
 *    pgdp wraps AppShell in an additional `data-testid="app-shell"` div (Phase 2.4
 *    preservation contract) — both testids exist in the live DOM.
 *
 * 2. pgdp-own semantic testids — pipeline UI elements that any future Playwright
 *    driver or snapshot suite will depend on. These are validated via static file
 *    scan (same pattern as stylingNorm.test.ts), so they fail immediately if a
 *    refactor renames or drops a testid without updating this contract.
 *
 * Playwright status (2026-05-25): e2e tests in tests/e2e/ use Playwright sync API
 * but do NOT use data-testid selectors — they locate elements via page.locator()
 * with text/role selectors. This contract test pins the testid surface so a future
 * Playwright rewrite can rely on these ids being stable.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ── helpers ───────────────────────────────────────────────────────────────

const SRC_DIR = join(import.meta.dirname, "..");

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

/** Production-only source: exclude test files, test/ directory, and local-shims. */
const prodFiles = collectSrc(SRC_DIR).filter(
  (p) =>
    !p.includes(".test.") &&
    !p.includes("/test/") &&
    !p.endsWith("local-shims.tsx"),
);

/** All production source as one concatenated string for fast multi-id checks. */
const allProdSource = prodFiles.map((p) => readFileSync(p, "utf8")).join("\n");

// ── 1. App.tsx outer-wrapper contract ─────────────────────────────────────
//
// Phase 2.4 preserved data-testid="app-shell" on the div that wraps the pdomain-ui
// AppShell. This is the Playwright anchor for the shell root. The real pdomain-ui
// AppShell also emits this testid — the outer div ensures the selector works
// even when the pdomain-ui version changes.

describe("App.tsx outer-wrapper testid (Phase 2.4 preservation contract)", () => {
  const appSrc = readFileSync(join(SRC_DIR, "App.tsx"), "utf8");

  it('App.tsx has data-testid="app-shell" outer wrapper div', () => {
    expect(appSrc).toContain('data-testid="app-shell"');
  });

  it('App.tsx AppShell receives appId="pdomain-prep-for-pgdp"', () => {
    expect(appSrc).toContain('appId="pdomain-prep-for-pgdp"');
  });
});

// ── 2. pdomain-ui AppShell mock testid strings in App.test.tsx ────────────────
//
// The vitest mock renders pdomain-ui AppShell zones as divs with specific testids.
// These strings must match what the real AppShell emits so integration tests
// remain valid when the mock is swapped for the real component.
//
// Real AppShell emits (confirmed from pdomain-ui/src/shell/AppShell.tsx):
//   app-shell, app-shell-header, app-shell-rail, app-shell-drawer,
//   app-shell-main, app-shell-right, app-shell-footer

describe("App.test.tsx mock strings match real pdomain-ui AppShell contract", () => {
  const appTestSrc = readFileSync(join(SRC_DIR, "App.test.tsx"), "utf8");

  const expectedMockTestIds = [
    "pdomain-ui-app-shell",
    "pdomain-ui-app-shell-header",
    "pdomain-ui-app-shell-main",
  ] as const;

  for (const tid of expectedMockTestIds) {
    it(`mock uses data-testid="${tid}"`, () => {
      expect(appTestSrc).toContain(`data-testid="${tid}"`);
    });
  }
});

// ── 3. pgdp-own semantic testids (pipeline UI) ────────────────────────────
//
// These testids are stable identifiers for pipeline UI elements.
// Any Playwright driver for pgdp will depend on these. Renaming a testid
// here is a breaking change to any automation suite.

const PGDP_REQUIRED_TESTIDS: readonly string[] = [
  // ── Shell / Navigation ──────────────────────────────────────────────────
  "top-nav", // TopNav root — Playwright anchors header bar here
  "user-menu-trigger", // UserMenu trigger button (default)
  "search-modal", // SearchModal content wrapper (default)
  "page-header", // PageHeader component default testid
  "page-drawer", // PageDrawer component default testid
  // ── Stage pipeline rail ─────────────────────────────────────────────────
  "stage-chain-rail", // StageChainRail root — visible on all project pages
  // ── Project grid (ProjectListPage) ──────────────────────────────────────
  "project-grid", // Grid of project cards
  "stat-tile-row", // Statistics tile row (top of project list)
  "stat-total-pages", // "Total pages" stat tile
  "stat-awaiting-review", // "Awaiting review" stat tile
  // ── Stage controls (StageControlsPanel) ─────────────────────────────────
  "stage-controls-panel", // Right-side controls panel
  // ── Artifact viewer (ArtifactViewer) ────────────────────────────────────
  "artifact-viewer", // Artifact viewer container
  "artifact-primary-pane", // Primary image/text pane
  "artifact-compare-pane", // Compare pane (split mode)
  // ── Page workbench (PageWorkbenchPage) ──────────────────────────────────
  "canvas-draw-overlay", // Konva canvas draw overlay
  "word-bbox-overlay-capture", // WordBboxOverlay capture root
  // ── Download ────────────────────────────────────────────────────────────
  "download-package-link", // Final download link
  // ── Page row / drawer (workbench list) ──────────────────────────────────
  "page-drawer-open-workbench", // Button to open workbench from drawer
  "page-drawer-close", // Close drawer button
  // ── Search ──────────────────────────────────────────────────────────────
  "empty-state", // Empty-state placeholder (project list and search)
] as const;

describe("pgdp-own semantic testids present in production source", () => {
  for (const tid of PGDP_REQUIRED_TESTIDS) {
    it(`data-testid="${tid}" appears in at least one production file`, () => {
      expect(
        allProdSource,
        `data-testid="${tid}" not found in any production .tsx — was it renamed or removed?`,
      ).toContain(`"${tid}"`);
    });
  }
});

// ── 4. StageChainRail uses dynamic per-stage testids ─────────────────────
//
// These dynamic patterns are verified by checking the template strings exist
// (not the literal values, since they are computed at render time).

describe("dynamic per-stage testid patterns in production source", () => {
  it("stage-chip-${...} pattern used in StageChainRail", () => {
    const stageChainSrc = readFileSync(
      join(SRC_DIR, "components/StageChainRail.tsx"),
      "utf8",
    );
    expect(stageChainSrc).toContain("stage-chip-");
  });

  it("stage-run-btn-${...} pattern used in StageChainRail", () => {
    const stageChainSrc2 = readFileSync(
      join(SRC_DIR, "components/StageChainRail.tsx"),
      "utf8",
    );
    expect(stageChainSrc2).toContain("stage-run-btn-");
  });

  it("result-link-${...} pattern used in SearchPanel", () => {
    const searchPanelSrc = readFileSync(
      join(SRC_DIR, "components/SearchPanel.tsx"),
      "utf8",
    );
    expect(searchPanelSrc).toContain("result-link-");
  });
});
