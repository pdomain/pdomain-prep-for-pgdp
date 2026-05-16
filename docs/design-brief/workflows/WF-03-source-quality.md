# Workflow: Source Quality Assessment

**Priority:** P1
**Affects:** `03-project-configure.md` (adds post-ingest attention banner + filtered page list)
**Audience:** Content provider after ingest

## Problem

After ingest, the user has no automated signal about which pages are likely to
be problematic before running the full pipeline. Blurry, skewed, or damaged pages
produce garbage OCR — discovered only after the expensive OCR stage runs.

## Goal

After ingest, automatically flag pages that are likely to need manual intervention,
and surface them as an actionable list so the user can fix settings before the bulk pipeline run.

## Step-by-Step Flow

1. Ingest completes → quality assessment runs per page (lightweight, CPU):
   - Blur score (Laplacian variance < threshold → flagged as blurry)
   - Contrast check (std dev of pixel values < threshold → too dark/light)
   - Skew estimation > 5° → "heavy skew, may need manual deskew"
   - Content bbox coverage < 20% of image → "mostly blank or very small text area"
2. Pages with flags are tagged with `quality_flags` in their PageRecord.
3. Configure page shows "Source quality report" banner if any flags exist.

## Happy Path Mockup Spec

### Quality Banner (in ProjectConfigurePage, Pages tab, post-ingest)

Amber left-accent banner:
"⚠ 8 pages flagged for review — source quality issues detected before pipeline run."
"[View flagged pages]" → filters page list to flagged only. "[Dismiss]" button.

### Flagged Page Row (in page list)

Page row gets an amber quality warning badge alongside the normal status badges:
"blurry" / "dark" / "heavy skew" / "sparse content". Multiple badges stack.

### Filtered View ("Flagged pages" filter)

Filter chip in Pages tab toolbar: All | Flagged | Errors | (existing filters).
When "Flagged" active: shows only pages with quality_flags.
Clicking a row → workbench with source stage selected.

## Edge Cases

- 0 flags → no banner shown
- All pages flagged → banner says "All pages flagged" with orange border

## Open Design Questions

- What thresholds for blur/contrast? Should these be configurable in Settings?
- Should flags be re-evaluated after the user provides overrides?
