# pd-prep-for-pgdp — Design Brief for Claude Design

**App:** pd-prep-for-pgdp — converts scanned book images into PGDP submission packages.
**Stack:** FastAPI + React 19 + Vite + TypeScript + TanStack Query + Konva + Tailwind.
**Design system:** See `design-system.md` for full token reference.
**Codebase:** Available for import to understand brand context.

## Purpose & Users

A web app used by **content providers** and **project managers** for the
Distributed Proofreaders (PGDP / distributedproofreaders.org) project —
a volunteer platform that proofreads digitized books for Project Gutenberg.

A **content provider (CP)** scans or downloads book images, prepares them
(grayscale, threshold, deskew, crop, OCR), and packages them for upload.
This app replaces a manual Jupyter notebook workflow.

## Existing Screens to Reference

| File | Screen | Route |
|---|---|---|
| `existing-ui/00-project-list.md` | Project List | `/` |
| `existing-ui/01-new-project.md` | New Project Modal | `/` (modal) |
| `existing-ui/02-jobs-page.md` | Jobs | `/jobs` |
| `existing-ui/03-project-configure.md` | Project Configure | `/projects/:id` |
| `existing-ui/04-page-workbench.md` | Page Workbench | `/projects/:id/pages/:idx0` |
| `existing-ui/05-text-review.md` | Text Review | `/projects/:id/pages/:idx0/review` |
| `existing-ui/06-crops-grid.md` | Crops Grid | `/projects/:id/crops` |
| `existing-ui/07-review-queue.md` | Review Queue | `/projects/:id/review` |
| `existing-ui/08-settings.md` | Settings | `/settings` |
| `existing-ui/09-shell.md` | App Shell | all routes |

Screenshots for each screen are in `existing-ui/screenshots/`.

## New Workflows to Wireframe (priority order)

| File | Workflow | Priority | Complexity |
|---|---|---|---|
| `workflows/WF-01-folder-upload.md` | Folder Upload | P0 | Medium — 2-step modal redesign |
| `workflows/WF-02-package-validation.md` | Package Validation Report | P1 | Medium — new panel in Pipeline tab |
| `workflows/WF-03-source-quality.md` | Source Quality Assessment | P1 | Low — banner + filtered list |
| `workflows/WF-09-page-reorder.md` | Page Reorder | P1 | Medium — drag-reorder with dirty propagation |
| `workflows/WF-10-batch-crop-review.md` | Batch Crop Review | P1 | Medium — grid + bulk actions |
| `workflows/WF-11-gegl-grayscale.md` | Perceptual Grayscale Controls | P1 | Low — 2 fields in StageControlsPanel |
| `workflows/WF-05-hyphen-join-workbench.md` | Hyphen-Join Workbench | P2 | High — new panel + library |
| `workflows/WF-06-regex-workbench.md` | Regex Workbench | P2 | Medium — structured editor |
| `workflows/WF-08-illustration-format.md` | Illustration Format Controls | P2 | Low — new fields in StageControlsPanel |
| `workflows/WF-04-metadata-collection.md` | PGDP Metadata Collection | P2 | Medium — wizard step + reference card |
| `workflows/WF-07-project-comments.md` | Project Comments Generator | P3 | Low — textarea + generate button |
| `workflows/WF-12-settings-enhancements.md` | Settings Library Panels | P2 | High — full Settings redesign |

## Suggested Claude Design Prompt

When importing this brief into Claude Design, use this as the starting prompt:

> I'm redesigning a book-scanning prep tool for Distributed Proofreaders.
> The existing screens are documented in `existing-ui/` with screenshots.
> The design system (colors, tokens, components) is in `design-system.md`.
> Please generate wireframes for the workflows listed in `workflows/`, starting
> with WF-01 (folder upload). Match the existing design system — dark navy
> primary actions, amber brand accents, slate backgrounds, Inter sans-serif.
> The audience is technical content providers who value information density
> over decorative elements.
