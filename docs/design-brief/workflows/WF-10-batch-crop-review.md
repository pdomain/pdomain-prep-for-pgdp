# Workflow: Batch Crop Review (CropsGridPage Enhancements)

**Priority:** P1 (#P1.2 in roadmap)
**Affects:** `06-crops-grid.md` (existing screen; extend with quality flags + bulk actions)
**Audience:** Content provider after initial pipeline run

## Problem

The CropsGridPage exists but is read-only — it shows canvas_map thumbnails but
offers no way to flag, annotate, or bulk-act on pages with crop problems.

## Goal

Make the crops grid interactive: show quality flags on thumbnails, support
multi-select, and offer bulk "re-run from initial_crop" for a selection.

## Step-by-Step Flow

1. User navigates to `/projects/:id/crops` after pipeline run.
2. Grid shows all canvas_map thumbnails. Quality flags appear as badges.
3. User visually scans for bad crops.
4. Clicks problem thumbnails to select them (checkboxes appear on hover).
5. Shift+click to range-select a group.
6. Bulk action bar appears at bottom of screen: "Re-run from initial_crop (5 pages)"
7. Clicks "Re-run" → all selected pages re-run stages initial_crop through canvas_map.
8. Thumbnails update in real-time via SSE.
9. User can also click any single thumbnail → opens workbench for that page.

## Happy Path Mockup Spec

### Grid Cell (enhanced)

Each cell (square, ~200px):

- canvas_map thumbnail (fills cell, object-fit: contain, white bg)
- Bottom overlay bar (32px, semi-transparent dark): page prefix (mono) + stage status dot
- Quality flag badges (top-right corner): amber "blurry" / "skew" / "dark" chips
- On hover: checkbox appears top-left; cell border highlights (accent color)
- On checked: checkbox filled; cell border stays highlighted

### Bulk Action Bar (sticky bottom, appears when ≥1 selected)

Fixed bottom bar (56px), bg-surface, border-top, shadow-up.
Left: "5 pages selected" count. Center: "Re-run from initial_crop" primary button.
"Clear selection" ghost button. Right: keyboard hint "Shift+click to range-select".

## Open Design Questions

- Should the grid support sorting (by stage status, by quality score)?
- Should there be a "crop only" mode where the user can draw the crop bbox directly on the thumbnail?
