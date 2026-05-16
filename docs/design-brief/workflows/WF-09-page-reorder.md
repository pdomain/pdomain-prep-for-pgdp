# Workflow: Page Reorder

**Priority:** P1 (#P1.1 in roadmap)
**Affects:** `03-project-configure.md` Pages tab (adds drag-to-reorder + confirmation)
**Audience:** Content provider when scans arrive out of order

## Problem

If Internet Archive scans are out of order, or if the user detects a mis-ordered page
after ingest, there is no way to reorder pages without re-ingesting from scratch.

## Goal

Allow the user to drag-and-drop page rows in the Pages tab to reorder them;
the new order propagates to prefix assignment and package output.

## Step-by-Step Flow

1. User opens Pages tab in ProjectConfigurePage.
2. Sees GripVertical handle on left of each row.
3. Drags a row up or down to new position.
4. Ghosted row shows target position. Other rows shift to make space.
5. On drop: optimistic reorder applied instantly.
6. Confirmation toast: "Page reordered — prefixes will update. [Undo]"
7. `PATCH /api/data/projects/:id/pages/reorder` fires in background.
8. All downstream stages for affected pages are marked dirty.
9. Prefix chips on each row refresh to show new assignments (f001, p001, etc.).

## Happy Path Mockup Spec

### Pages Tab with Drag Handle

Each PageRow, leftmost: `GripVertical` icon (16px, ink-3 color).
On hover: cursor: grab; handle highlights to ink-1.
On drag: row becomes semi-transparent (50% opacity), ghost shows solid at new position.
Other rows animate smoothly as drag target moves.

### Post-Drop State

Moved row flashes amber briefly (1s animation) to indicate change.
Prefix in that row (and all rows after it if order changed) updates:

- Old: "p020" → New: "p019" (if moved up one slot)

Row toast (inline, not full sonner toast): "Prefixes updated — 12 pages dirty."

### Multi-Select Reorder

Shift+click to select a range → drag the group together.
Ghost shows all selected rows stacked.

## Edge Cases

- Reorder while pipeline running → warning dialog: "Reordering will dirty N pages. Running stages will complete first. Continue?"
- Reorder to before proof_start → "This page will be outside the proof range."

## Open Design Questions

- Should reorder also update `proof_start_idx0` / `proof_end_idx0` in project config
  if a page is moved outside the current range?
- Should there be an "auto-sort" button that re-sorts by filename?
