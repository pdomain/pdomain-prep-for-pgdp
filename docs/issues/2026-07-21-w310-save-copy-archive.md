---
Status: active
Owner: CT
Created: 2026-07-21
Last verified: 2026-11-12
Kind: issue
Level: I1
---

# Save-a-copy is `comingSoon`; archive tool keep list is MOCK_ITEMS (W3.10)

## Agent Index

- **Kind:** issue
- **Status:** active
- **Level:** I1
- **Last verified:** 2026-11-12
- **Resolution:** On master. Save a copy is `06d9a5c` (`9d1e2a4`). The keep list is the project's stage files.
- **Severity:** Medium — the export and the keep list were missing. Both paths now exist.
- **Affected version:** pdomain-prep-for-pgdp (main @ 2026-07-21)
- **Read when:** implementing project export, archive stage inventory, or manage actions.
- **Search terms:** comingSoon, saveCopy, export_project_copy, MOCK_ITEMS, ArchiveTool, manage actions, W3.10
- **Relates to:** [pipeline completion review](../plans/2026-07-21-pipeline-completion-review.md)

## Summary

Project manage UI marks **Save a copy…** as `comingSoon` with a no-op
handler, while a stub `POST /api/data/projects/{id}/export` returns a
synthetic `copy_id` without copying artifacts. Separately, the pipeline
**Archive** tool seeds its keep/drop list from hardcoded `MOCK_ITEMS` rather
than a real project-stage / artifact inventory. Users cannot export a project
copy or truthfully choose what the archive stage retains.

## Impact

- Save-a-copy is dead in the UI despite service mapping to `/export`.
- Export API looks successful but does not produce a downloadable project copy.
- Archive overview keep list misrepresents disk usage and artifact classes.

## Environment / versions

```
FE manage: frontend/src/pages/projects/ProjectsPage.tsx (comingSoon saveCopy)
FE service: frontend/src/services/projects.ts runManageAction saveCopy
API: api/data/projects.py export_project_copy (I1 stub)
Archive: frontend/src/pages/pipeline/tools/ArchiveTool.tsx MOCK_ITEMS
```

## Evidence

### Current source verification — 2026-11-07

Save a copy remains disabled/coming-soon, the export route returns only a synthetic copy id, and ArchiveTool
starts from MOCK_ITEMS. Checked ProjectsPage.tsx, api/data/projects.py, and ArchiveTool.tsx.

This is source inspection, not a fresh browser/GPU run. Older source excerpts and July review dates below
are historical snapshots; the current findings above take precedence where implementation changed.

### 1. Manage UI comingSoon

```
# ProjectsPage.tsx ~1390–1397
<ManageRow
  id="saveCopy"
  label="Save a copy…"
  …
  comingSoon
  onAction={() => {}} // no-op until export route exists
/>
```

Archived-state row (~1420–1426) is likewise `comingSoon`.

### 2. Export route is a stub

```
# api/data/projects.py ~585–610
@router.post("/projects/{project_id}/export", …)
async def export_project_copy(…):
    """… At I1: creates a stub export record. Full artifact copy …
    deferred to I2 when storage adapter supports multi-key copy."""
    …
    return `_ExportResponse`(project_id=…, copy_id=uuid.uuid4().hex, …)
```

No zip download, no storage copy of source/stages.

### 3. Service assumes a real export

```
# services/projects.ts ~389–393
case "saveCopy": {
  await api.post(`/api/data/projects/${…}/export`);
  return { action };
}
```

UI never calls it while `comingSoon` remains.

### 4. ArchiveTool mock inventory

```
# ArchiveTool.tsx ~33–48, 169
const MOCK_ITEMS: ArchiveItem[] = [
  { name: "Original scans", meta: "source TIFFs / JPEGs — 2.1 GB", keep: true },
  …
];
…
initialItems: MOCK_ITEMS,
```

Parent plan: archive PARTIAL / THIN — “Project-stage inventory only; mock keep
list.” W3.10 done-when: “Manage actions no longer `comingSoon`” + real inventory.

## Root-cause hypotheses

1. **(Most likely) I1 stub + design fidelity** — export and archive UI shipped
   for shell completeness; multi-key copy and inventory API deferred.
2. **Storage adapter limitation** — docstring cites multi-key copy as I2
   prerequisite for full export.

## Defects to fix

1. **Real save-a-copy / export** — produce downloadable project archive or
   documented partial export; remove `comingSoon` when usable. (Primary)
2. **Replace ArchiveTool MOCK_ITEMS** with inventory from backend (stage dirs /
   size / keep policy).
3. **Align service + UI + OpenAPI** so stub success responses cannot be
   mistaken for full copies if partial remains.

## Next steps

1. Spec export artifact set (source only vs source+clean stages vs full dual-write tree).
2. Implement export download path; wire ManageRow; tests for bytes/manifest.
3. API for archive keep inventory; feed ArchiveTool; drop MOCK_ITEMS.

## What is NOT broken

- Archive/restore/delete manage actions for project lifecycle.
- Pipeline archive **stage** backend callable may still run inventory-shaped
  project-stage logic (separate from MOCK keep list UI).
- MSW mock handlers for saveCopy in unit tests are test-only.

## Resolution

On master. Save a copy is `06d9a5c` (`9d1e2a4`): `GET /api/data/projects/{id}/export` returns the project zip. The keep
list is the project's stage files. `build_archive_keep_list` reads page-stage and project-stage files and skips the
toggle store. `GET /api/data/projects/{id}/project-stages/archive/items` returns those rows, and the archive tool loads
that list instead of `MOCK_ITEMS`. A project with no stage files has an empty list. Retire this report through
`doc-retirer` when the issue file itself is closed.

- Tests: `tests/test_archive_keep_list.py` and `tests/test_project_export.py`.
