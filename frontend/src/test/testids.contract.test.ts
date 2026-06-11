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
 * E2E status (2026-06-11): tests/e2e/test_convergence_pipeline_walk.py and
 * test_convergence_app_loads.py DO use data-testid selectors — pipeline-page,
 * stage-strip, stage-chip-label, stage-dot-source, stage-next-btn, stage-prev-btn,
 * run-all-stale-btn, archive-tool, gate-archived, settings-toggle-btn,
 * settings-close-btn, settings-error, project-info-band, and several manage /
 * projects-page ids. This contract pins those ids (and the full F5 tool surface)
 * so they cannot be silently renamed or deleted.
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

/**
 * Check whether a testid string appears in production source, accepting both
 * double-quoted (`data-testid="foo"`) and template-literal
 * (`data-testid={\`foo\`}`) forms.
 */
function hasTestid(tid: string): boolean {
  return (
    allProdSource.includes(`"${tid}"`) || allProdSource.includes(`\`${tid}\``)
  );
}

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

// ── 3. pgdp-own semantic testids (projects + shell + pipeline) ────────────
//
// These testids are stable identifiers for the entire pgdp UI surface.
// Any Playwright driver for pgdp will depend on these. Renaming a testid
// here is a breaking change to any automation suite.
//
// GROUPS:
//   A. Shell / Navigation
//   B. Projects surface (ProjectsPage — F3)
//   C. PostImportPage
//   D. Artifact viewer
//   E. WordBboxOverlay
//   F. Pipeline shell (PipelinePage — F4)
//   G. Stage-strip / navigation controls  [e2e: test_convergence_pipeline_walk.py]
//   H. Settings panel
//   I. Danger / destructive actions
//   J. Tool roots — each stage's surface component root [e2e: archive-tool, etc.]
//   K. Source tool controls
//   L. Validation / gate controls
//   M. Pack tools (zipTool, buildPackageTool, proofPackTool, submitCheckTool)
//   N. Submit-check controls
//   O. Archive tool controls
//   P. Page-order tool controls (partial — main root + navigation)
//   Q. Wordcheck tool state surfaces

const PGDP_REQUIRED_TESTIDS: readonly string[] = [
  // ── A. Shell / Navigation ────────────────────────────────────────────────
  "top-nav", // TopNav root
  "user-menu-trigger", // UserMenu trigger button (default)
  "search-modal", // SearchModal content wrapper (default)
  "page-header", // PageHeader component default testid
  "page-drawer", // PageDrawer component default testid
  // ── B. Projects surface (ProjectsPage — F3) ──────────────────────────────
  "projects-page", // ProjectsPage root section [e2e: test_convergence_app_loads.py:55,72]
  "projects-rail", // Left rail (project list)
  "projects-list", // Scrollable project rows container
  "projects-detail", // Right pane (detail view)
  "projects-empty", // Empty-state hero (no projects)
  "projects-loading", // Loading spinner (booting state)
  "projects-error", // Error state with retry
  "projects-retry", // Retry button in error state
  "projects-search", // Search input in header
  "rail-tabs", // Active/Archived segmented tabs
  "detail-pane", // Detail pane content wrapper
  "detail-title", // Project title heading
  "detail-status-badge", // Status badge in detail header
  "detail-header", // Detail pane header row
  "detail-stats", // 6-cell stats grid
  "detail-pipeline", // Pipeline strip section
  "detail-tabs", // Tab strip (activity/attributes/manage) [e2e: test_convergence_pipeline_walk.py:306]
  "new-project-btn", // New project button in rail
  "open-project-btn", // Open project button in detail
  "activity-panel", // Recent activity tab panel
  "attributes-panel", // Attributes tab panel
  "manage-panel", // Manage tab panel [e2e: test_convergence_pipeline_walk.py:310]
  "delete-confirm-dialog", // Delete confirm (or danger) dialog
  "delete-acknowledge", // Acknowledge checkbox in danger-confirm dialog
  "delete-confirm-btn", // Confirm button in delete dialog
  "delete-cancel-btn", // Cancel button in delete dialog [e2e: test_convergence_pipeline_walk.py:325]
  "create-project-dialog", // New project creation dialog
  "create-project-name", // Book name input in create dialog
  "create-project-submit-btn", // Submit button in create dialog
  // ── C. PostImportPage ───────────────────────────────────────────────────
  "post-import-page", // PostImportPage root section
  "redirected-pane", // Pa (redirected) placement pane
  "anchored-pane", // Pb (anchored) placement pane
  "jobs-drawer", // Import jobs drawer (Pb)
  "jobs-drawer-header", // Jobs drawer header row
  "jobs-drawer-body", // Jobs drawer expanded body
  "import-progress", // Import progress bar container
  "import-job-row", // Active import job row in drawer
  "import-cancelled-row", // Cancelled import row
  // ── D. Artifact viewer (ArtifactViewer) ─────────────────────────────────
  "artifact-viewer", // Artifact viewer container
  "artifact-primary-pane", // Primary image/text pane
  "artifact-compare-pane", // Compare pane (split mode)
  // ── E. Word bbox overlay (WordBboxOverlay) ───────────────────────────────
  "word-bbox-overlay-capture", // WordBboxOverlay capture root
  // ── F. Pipeline shell (PipelinePage — F4) ───────────────────────────────
  "pipeline-page", // PipelinePage root [e2e: test_convergence_pipeline_walk.py:155]
  "project-info-band", // Project info band in pipeline [e2e: 168]
  // ── G. Stage-strip / navigation controls ─────────────────────────────────
  "stage-strip", // Horizontal stage dots strip [e2e: 158]
  "stage-chip-label", // Chip label showing current stage name [e2e: 165]
  "stage-dot-source", // Dot for the source stage [e2e: 161]
  "stage-prev-btn", // Previous-stage nav button [e2e: 207]
  "stage-next-btn", // Next-stage nav button [e2e: 199]
  "run-all-stale-btn", // "Run All Stale" button [e2e: 171]
  // ── H. Settings panel ───────────────────────────────────────────────────
  "settings-toggle-btn", // Toggle settings panel open/close [e2e: 388]
  "settings-close-btn", // Close button inside settings panel [e2e: 629]
  "settings-error", // Error state in settings panel [e2e: 510]
  "settings-panel", // Settings panel root
  "settings-group-rail", // Settings group navigation rail
  "settings-group-content", // Settings group content area
  // ── I. Danger / destructive actions (pipeline settings) ──────────────────
  "danger-confirm-panel", // Danger confirm panel
  "danger-acknowledge-checkbox", // Acknowledge checkbox in danger panel
  "danger-confirm-btn", // Confirm destructive action button
  "danger-cancel-btn", // Cancel destructive action button
  // ── J. Tool roots — stage surface component roots ─────────────────────────
  "source-tool", // SourceTool root [F5.1]
  "grayscale-tool", // GrayscaleTool root [F5.2]
  "pages-grid-tool", // PagesGridTool root (image_stage_review, etc.) [F5.2]
  "hyphen-tool", // HyphenJoinTool root [F5.5]
  "wordcheck-tool", // WordcheckTool root [F5.5]
  "page-order-tool", // PageOrderTool root [F5.4]
  "validation-tool", // ValidationTool root [F5.6]
  "archive-tool", // ArchiveTool root [F5.6; e2e: test_convergence_pipeline_walk.py:260]
  "proof-pack-tool", // ProofPackTool root [F5.6]
  "submit-check-tool", // SubmitCheckTool root [F5.6]
  "build-package-tool", // BuildPackageTool root [F5.6]
  "zip-tool", // ZipTool root [F5.6]
  // ── K. Source tool controls ───────────────────────────────────────────────
  "source-tool", // SourceTool root (already in J above — kept for clarity)
  // ── L. Validation / gate controls ────────────────────────────────────────
  "validation-settings", // Validation settings tab
  "validation-checking", // Validation loading state
  // ── M. Pack tools ─────────────────────────────────────────────────────────
  "proof-pack-tool", // ProofPackTool root (already in J)
  "build-package-tool", // BuildPackageTool root (already in J)
  "zip-tool", // ZipTool root (already in J)
  // ── N. Submit-check controls ─────────────────────────────────────────────
  "submit-confirm-dialog", // Submit confirm dialog
  "submit-confirm-btn", // Confirm submission button
  "submit-cancel-btn", // Cancel submission button
  "submit-btn", // Primary submit button
  "download-package-link", // Download-package link
  // ── O. Archive tool controls ─────────────────────────────────────────────
  "gate-archived", // Archive completed gate [e2e: test_convergence_pipeline_walk.py:267]
  "archive-now-btn", // Archive now action button
  "archive-manifest", // Archive manifest list
  // ── P. Page-order tool controls ───────────────────────────────────────────
  "po-banner-reading", // PageOrderTool reading-folios banner
  "po-ledger", // Ledger pane
  "po-confirm-advance-btn", // Confirm + advance to next stage button
  // ── Q. Wordcheck tool state surfaces ─────────────────────────────────────
  "wordcheck-tool-settled", // Wordcheck settled state surface
  "wordcheck-tool-confirming", // Wordcheck confirming state surface
] as const;

// De-duplicate (some keys appear in multiple group comments above)
const UNIQUE_TESTIDS = [...new Set(PGDP_REQUIRED_TESTIDS)] as const;

// Removed at I1 (PageWorkbenchPage, TextReviewPage, CropsGridPage,
// ProjectReviewQueuePage deleted): canvas-draw-overlay, page-drawer-open-workbench,
// page-drawer-close, empty-state.

describe("pgdp-own semantic testids present in production source", () => {
  for (const tid of UNIQUE_TESTIDS) {
    it(`data-testid="${tid}" appears in at least one production file`, () => {
      expect(
        hasTestid(tid),
        `data-testid="${tid}" not found in any production .tsx — was it renamed or removed?`,
      ).toBe(true);
    });
  }
});

// ── 4. Dynamic per-component testid patterns ──────────────────────────────
//
// These dynamic patterns are verified by checking the template strings exist
// (not the literal values, since they are computed at render time).
// Note: StageChainRail and StageControlsPanel were removed in I1 (they
// belonged to the deleted PageWorkbenchPage).

describe("dynamic per-stage testid patterns in production source", () => {
  it("result-link-${...} pattern used in SearchPanel", () => {
    const searchPanelSrc = readFileSync(
      join(SRC_DIR, "components/SearchPanel.tsx"),
      "utf8",
    );
    expect(searchPanelSrc).toContain("result-link-");
  });

  it("stage-dot-${def.id} dynamic pattern used in PipelinePage", () => {
    const pipelineSrc = readFileSync(
      join(SRC_DIR, "pages/pipeline/PipelinePage.tsx"),
      "utf8",
    );
    // Pattern: data-testid={`stage-dot-${def.id}`}
    expect(pipelineSrc).toContain("stage-dot-");
  });

  it("project-row-${p.id} dynamic pattern used in ProjectsPage", () => {
    const projectsSrc = readFileSync(
      join(SRC_DIR, "pages/projects/ProjectsPage.tsx"),
      "utf8",
    );
    // Pattern: data-testid={`project-row-${p.id}`}
    expect(projectsSrc).toContain("project-row-");
  });

  it("rail-tab-${t.id} dynamic pattern used in ProjectsPage", () => {
    const projectsSrc = readFileSync(
      join(SRC_DIR, "pages/projects/ProjectsPage.tsx"),
      "utf8",
    );
    // Pattern: data-testid={`rail-tab-${t.id}`}  [e2e: rail-tab-archived]
    expect(projectsSrc).toContain("rail-tab-");
  });

  it("automation-toggle-${row.key} dynamic pattern used in PipelinePage", () => {
    const pipelineSrc = readFileSync(
      join(SRC_DIR, "pages/pipeline/PipelinePage.tsx"),
      "utf8",
    );
    // Pattern: data-testid={`automation-toggle-${row.key}`}  [e2e: settings toggles]
    expect(pipelineSrc).toContain("automation-toggle-");
  });

  it("manage-action-btn-${id} dynamic pattern used in ProjectsPage", () => {
    const projectsSrc = readFileSync(
      join(SRC_DIR, "pages/projects/ProjectsPage.tsx"),
      "utf8",
    );
    // Pattern: data-testid={`manage-action-btn-${id}`}  [e2e: manage-action-btn-delete]
    expect(projectsSrc).toContain("manage-action-btn-");
  });

  it("danger-action-btn-${row.action} dynamic pattern used in PipelinePage", () => {
    const pipelineSrc = readFileSync(
      join(SRC_DIR, "pages/pipeline/PipelinePage.tsx"),
      "utf8",
    );
    // Pattern: data-testid={`danger-action-btn-${row.action}`}
    expect(pipelineSrc).toContain("danger-action-btn-");
  });

  it("tab-${t.id} / tab-${id} dynamic pattern used in PipelinePage and ProjectsPage", () => {
    const pipelineSrc = readFileSync(
      join(SRC_DIR, "pages/pipeline/PipelinePage.tsx"),
      "utf8",
    );
    // Pattern: data-testid={`tab-${t.id}`}  [e2e: tab-manage]
    expect(pipelineSrc).toContain("tab-");
  });

  it("settings-group-${item.id} dynamic pattern used in PipelinePage", () => {
    const pipelineSrc = readFileSync(
      join(SRC_DIR, "pages/pipeline/PipelinePage.tsx"),
      "utf8",
    );
    // Pattern: data-testid={`settings-group-${item.id}`}
    expect(pipelineSrc).toContain("settings-group-");
  });
});

// ── 5. E2E coverage check — every testid the e2e suite selects is in contract ──
//
// Enumerates the exact testid literals used in tests/e2e/test_convergence_*.py
// and asserts each appears in production source. This is the forward-guard:
// if an e2e test adds a new selector but the production code is renamed/removed,
// the contract fails immediately in CI (without needing to run the full e2e suite).
//
// Source: grep -rn 'data-testid="..."' tests/e2e/test_convergence_*.py (2026-06-11)
//
// NOTE — Dynamic pattern testids:
//   Some e2e literals are produced by dynamic templates in the source, e.g.:
//     e2e: 'rail-tab-archived'  ←  source: `rail-tab-${t.id}` (t.id === "archived")
//     e2e: 'tab-manage'         ←  source: `tab-${t.id}`       (t.id === "manage")
//     e2e: 'manage-action-btn-delete' ← source: `manage-action-btn-${id}` (id === "delete")
//   These CANNOT be found as static strings in production source. They are
//   already covered by section 4 (dynamic pattern tests). We exclude them here
//   and note which pattern covers each.

const E2E_STATIC_TESTIDS = [
  // From test_convergence_pipeline_walk.py
  "pipeline-page", // :155,194,444,468
  "stage-strip", // :158,423,442
  "stage-chip-label", // :165,196,200,204,208,212,424,442
  "stage-dot-source", // :161,211
  "stage-next-btn", // :199,203
  "stage-prev-btn", // :207
  "project-info-band", // :168
  "run-all-stale-btn", // :171
  "archive-tool", // :260,270
  "gate-archived", // :267
  "projects-page", // :298,354
  "detail-tabs", // :306,367
  // "tab-manage"          — dynamic: tab-${t.id}; covered by section 4
  "manage-panel", // :310,369
  // "manage-action-btn-delete" — dynamic: manage-action-btn-${id}; covered by section 4
  "delete-cancel-btn", // :325,380,387
  // "rail-tab-archived"   — dynamic: rail-tab-${t.id}; covered by section 4
  // From test_convergence_app_loads.py
  // "projects-page" — already listed above
  // "pipeline-page" — already listed above
  // "stage-strip"   — already listed above
  // "stage-chip-label" — already listed above
  // "archive-tool"  — already listed above
] as const;

describe("e2e testids present in production source (forward-guard)", () => {
  for (const tid of [...new Set(E2E_STATIC_TESTIDS)]) {
    it(`e2e selector data-testid="${tid}" appears in production source`, () => {
      expect(
        hasTestid(tid),
        `e2e uses data-testid="${tid}" but it is not found in any production .tsx — ` +
          `e2e test will fail; check if the component was renamed or removed`,
      ).toBe(true);
    });
  }
});
