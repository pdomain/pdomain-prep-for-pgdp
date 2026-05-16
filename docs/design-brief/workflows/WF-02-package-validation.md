# Workflow: Package Validation Report

**Priority:** P1
**Affects:** `03-project-configure.md` Pipeline tab (adds validation step before download)
**Audience:** Content provider

## Problem

The "Download package" link appears after build_package completes, but there is no
automated check that the package meets PGDP's submission requirements. The user
may download and upload a package that fails PGDP's Project Quick Check.

## Goal

Before the download link activates, run a local validation pass and surface any
PGDP-requirement failures or warnings so the user can fix them in the app.

## Actor & Entry Points

- **Who:** Content provider after all pages are reviewed
- **Enters from:** Pipeline tab → build_package completes → validation runs automatically

## Step-by-Step Flow

1. `build_package` job completes → validation pass runs automatically.
2. Validation checks (run server-side on the assembled `for_zip/` contents):
   - (a) Every proof-range page has both `.png` and `.txt`
   - (b) PNG+TXT base names match
   - (c) Page prefix sequence has no gaps or duplicates
   - (d) All PNG files are 1-bit (black & white), not 8-bit grayscale
   - (e) All page PNG file sizes < 100 KB (PGDP target for dial-up accessibility)
   - (f) Illustration images within size limits (inline ≤ 256 KB, linked ≤ 1 MB)
   - (g) Zip filename is valid ASCII, no leading hyphen, lowercase `.zip` extension
   - (h) No corrupt PNGs (PIL can open all files)
3. Results: PASS (all green) or WARNINGS (amber) or ERRORS (red, blocks download).
4. Validation summary panel appears in Pipeline tab.
5. User can click through to each failing page.

## Happy Path Mockup Spec

### Validation Panel (in Pipeline tab, after build_package)

**PASS state:**

Green checkmark icon. "Package validation passed — 387 pages, all checks green."
"Download package" primary button (full-width below).

**WARNINGS state:**

Amber triangle icon. "Package ready with warnings — review before uploading to PGDP."

Collapsible list of warnings (Accordion):

- ⚠ "14 pages > 100 KB — may be slow for proofreaders on older connections"
  → [Show pages] link → list of page prefixes with sizes

"Download anyway" secondary button + "Download package" primary button.

**ERRORS state:**

Red X icon. "Package has errors — fix before uploading to PGDP."

Collapsible list of errors:

- ✗ "3 pages have 8-bit grayscale PNG (PGDP requires 1-bit B&W)"
  → [Fix automatically] button (re-runs threshold stage on failing pages)
  → [Show pages] link → clickable list navigating to each workbench

"Download package" button disabled until errors resolved.

### Validation Detail Row

Each check result: icon (✓ / ⚠ / ✗) + check name + count + expand arrow.
Expanded: list of affected pages (prefix + filename) as monospace chips,
each chip links to `/projects/:id/pages/:idx0`.

## Edge Cases

- Validation takes > 5s → progress spinner in panel header
- Re-run after fixing error → re-validate button in panel

## Open Design Questions

- Should "Fix automatically" re-run just the failing pages or the entire package?
- Should the 100 KB file size warning be configurable?
