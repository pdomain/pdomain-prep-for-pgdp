# UI Design Documentation for Claude Design — Implementation Plan

> **ARCHIVED 2026-05-16.** All seven document-generation tasks (1–7) shipped
> in commits `cccd8e8` → `455dc84`. The screenshot-automation task (8) shipped
> the four screens reachable without a project (`14c099c`); the remaining
> workbench screenshots require creating a real project and are captured
> manually as needed — not pending work. The shipped artifacts live in
> [`../design-brief/`](../design-brief/).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a complete design brief — existing screen docs + new workflow specs — that can be fed to Claude Design (claude.ai/design) to wireframe all pending pdomain-prep-for-pgdp features.

**Architecture:** Two output directories under `docs/design-brief/`: `existing-ui/` (one markdown + screenshot per screen) and `workflows/` (one design-brief markdown per new feature). A master `index.md` stitches them together as the root document for Claude Design. Screenshots are taken by running the app with `make run` and using Playwright to capture each screen at 1440×900.

**Tech Stack:** Python + Playwright (`make e2e` group), Markdown, existing `frontend/tailwind.config.ts` for design tokens, `make run-cpu` for local server.

---

## File Map

```
docs/design-brief/
  index.md                          ← master brief for Claude Design (root document)
  design-system.md                  ← colors, typography, spacing, component library
  existing-ui/
    00-project-list.md              ← ProjectListPage description + screenshot
    01-new-project.md               ← CreateProjectModal flow + screenshots
    02-jobs-page.md                 ← JobsPage description + screenshot
    03-project-configure.md         ← ProjectConfigurePage (pipeline/pages/settings tabs)
    04-page-workbench.md            ← PageWorkbenchPage (full workbench)
    05-text-review.md               ← TextReviewPage + WordBboxOverlay
    06-crops-grid.md                ← CropsGridPage (canvas_map thumbnail grid)
    07-review-queue.md              ← ProjectReviewQueuePage
    08-settings.md                  ← SettingsPage
    09-shell.md                     ← AppShell, TopNav, PageHeader, SearchModal, hotkeys
    screenshots/                    ← PNG screenshots (one per screen, 1440×900)
      00-project-list.png
      01-new-project-modal.png
      01-new-project-upload.png
      02-jobs-page.png
      03-configure-pipeline-tab.png
      03-configure-pages-tab.png
      03-configure-settings-tab.png
      04-workbench-view.png
      04-workbench-split-mode.png
      04-workbench-illustration-mode.png
      05-text-review.png
      06-crops-grid.png
      07-review-queue.png
      08-settings.png
  workflows/
    WF-01-folder-upload.md          ← P0.3: folder/directory ingest
    WF-02-package-validation.md     ← pre-download QA report
    WF-03-source-quality.md         ← post-ingest attention flags
    WF-04-metadata-collection.md    ← PGDP project metadata form
    WF-05-hyphen-join-workbench.md  ← cross-book rule library + mismatch report
    WF-06-regex-workbench.md        ← per-book multi-pass regex editor
    WF-07-project-comments.md       ← PGDP project comments generator
    WF-08-illustration-format.md    ← per-region format/size controls
    WF-09-page-reorder.md           ← drag-to-reorder pages in configure
    WF-10-batch-crop-review.md      ← CropsGridPage enhancements
    WF-11-gegl-grayscale.md         ← new perceptual grayscale stage controls
    WF-12-settings-enhancements.md  ← scanno library, shared hyphen rules
scripts/
  capture-screenshots.py            ← Playwright script to capture all screens
```

---

## Task 1: Design System Document

**Files:**
- Create: `docs/design-brief/design-system.md`

- [ ] **Step 1: Write the design system doc**

Create `docs/design-brief/design-system.md` with this exact content (values sourced from `frontend/tailwind.config.ts` and `frontend/src/styles/tokens.css`):

```markdown
# pdomain-prep-for-pgdp Design System

## Brand & Purpose
A book-scanning prep tool for Distributed Proofreaders (PGDP). Dark, professional tone.
Users are content providers and project managers handling scanned historical books.
UI should feel like a professional document-processing tool, not a consumer app.

## Color Tokens (CSS Variables → Tailwind utilities)

### Surface layers
| Token | Light | Dark | Usage |
|---|---|---|---|
| `bg-page` | `#f8fafc` | `#020617` | Full-page background |
| `bg-surface` | `#ffffff` | `#0f172a` | Card / panel backgrounds |
| `bg-raised` | `#f1f5f9` | `#1e293b` | Hover / secondary surfaces |
| `bg-sunk` | `#e2e8f0` | `#334155` | Depressed / input backgrounds |

### Borders
| Token | Light | Dark |
|---|---|---|
| `border-1` | `#e2e8f0` | `#334155` |
| `border-2` | `#cbd5e1` | `#475569` |
| `border-3` | `#94a3b8` | `#64748b` |

### Typography (ink)
| Token | Light | Dark | Usage |
|---|---|---|---|
| `ink-1` | `#0f172a` | `#f8fafc` | Primary text |
| `ink-2` | `#334155` | `#e2e8f0` | Secondary text |
| `ink-3` | `#64748b` | `#94a3b8` | Muted / label text |
| `ink-4` | `#94a3b8` | `#64748b` | Very muted / placeholder |

### Action & Brand
| Token | Light | Dark | Usage |
|---|---|---|---|
| `accent` | `#0f172a` | `#f1f5f9` | Primary button background |
| `accent-ink` | `#ffffff` | `#0f172a` | Primary button text |
| `brand` | `#f59e0b` | `#fbbf24` | Amber brand color |
| `brand-ink` | `#0f172a` | — | Brand text |

### Stage Status Colors
| Status | Color | Usage |
|---|---|---|
| `stage-clean` | `#10b981` (emerald) | Stage artifact up-to-date |
| `stage-dirty` | `#f59e0b` (amber) | Stage needs re-run |
| `stage-not-run` | `#cbd5e1` (slate-300) | Never executed |
| `stage-running` | `#3b82f6` (blue) | Currently executing (+ pulse animation) |
| `stage-failed` | `#ef4444` (red) | Last run errored |
| `stage-na` | `#e2e8f0` (slate-200) | Not applicable for this page type |

### Job/Task Status Colors
| Status | Color |
|---|---|
| Done / complete | `#10b981` |
| Running | `#3b82f6` |
| Queued | `#94a3b8` |
| Error | `#ef4444` |
| Awaiting review | `#f59e0b` |

## Typography
- **Sans:** Inter (400, 500, 600, 700) — all body, UI labels, headings
- **Mono:** JetBrains Mono (400, 500) — code, page prefixes (f001, p001), stems, technical IDs
- **Custom sizes:** `text-xxs` = 10px/1.2, `text-xs2` = 11px/1.3

## Component Library (Radix UI / shadcn-style)

### Layout Shell
- `AppShell` — 3-row CSS grid (header / main / footer), 100dvh
- `TopNav` — dark header bar: amber brand word, search pill (Cmd+K), bell icon, user avatar dropdown
- `PageHeader` — title + description + right-side action slot
- `ServerInfoFooter` — server URL display with copy button

### Primitives in use
- `Accordion`, `AlertDialog`, `Dialog`, `DropdownMenu`, `Popover`
- `Select`, `Tabs`, `Tooltip`, `Collapsible`, `ToggleGroup`, `Progress`, `Separator`
- `Button` (variants: primary / outline / ghost / secondary; sizes: sm/md/lg)
- `Badge` (colored dot + label, maps to status colors)
- `Card` (border + subtle shadow)
- `Input`, `Textarea`, `IconButton`, `KeyCap`, `StatTile`
- `StageCell` (stage status chip with color dot + label)
- `StatusPip` (colored dot only)
- Toast via `sonner`

### Icon set
Lucide React. Common icons: AlertTriangle, Bell, GripVertical, ChevronRight,
CheckCircle, HardDrive, Search, X, ArrowRight, Download, Upload.

## Interaction Patterns
- **Drag-to-reorder:** GripVertical handle on page rows
- **Multi-select:** Checkbox per row, Shift+click range, bulk action bar appears
- **Infinite scroll:** 200 items per page, cursor-based pagination
- **SSE live updates:** Stage chips pulse/update without user action
- **Keyboard shortcuts:** Cmd+K (search), ? (hotkey help), Escape (close modals)
- **Optimistic UI:** Page type/alignment changes apply instantly, sync in background
```

- [ ] **Step 2: Commit**

```bash
git -C /workspaces/ocr-container/pdomain-prep-for-pgdp add docs/design-brief/design-system.md
git -C /workspaces/ocr-container/pdomain-prep-for-pgdp commit -m "docs(design): design system reference for Claude Design brief"
```

---

## Task 2: Screenshot Capture Script

**Files:**
- Create: `scripts/capture-screenshots.py`

- [ ] **Step 1: Write the capture script**

```python
#!/usr/bin/env python3
"""
Playwright script to capture screenshots of all pdomain-prep-for-pgdp screens.
Requires: uv run --group e2e python scripts/capture-screenshots.py
Server must be running: make run-cpu (http://127.0.0.1:8765)
"""
import asyncio
import sys
from pathlib import Path

BASE_URL = "http://127.0.0.1:8765"
OUT_DIR = Path(__file__).parent.parent / "docs/design-brief/existing-ui/screenshots"
OUT_DIR.mkdir(parents=True, exist_ok=True)

VIEWPORT = {"width": 1440, "height": 900}


async def capture(playwright, url_path: str, filename: str, *, wait_ms: int = 1500, setup=None):
    browser = await playwright.chromium.launch()
    page = await browser.new_page(viewport=VIEWPORT)
    await page.goto(f"{BASE_URL}{url_path}")
    await page.wait_for_load_state("networkidle")
    if setup:
        await setup(page)
    await page.wait_for_timeout(wait_ms)
    out = OUT_DIR / filename
    await page.screenshot(path=str(out), full_page=False)
    print(f"  ✓ {filename}")
    await browser.close()


async def main():
    from playwright.async_api import async_playwright

    async with async_playwright() as pw:
        print("Capturing existing UI screens...")

        # 00 — ProjectListPage
        await capture(pw, "/", "00-project-list.png")

        # 01 — CreateProjectModal (trigger by clicking "+ New Project")
        async def open_create_modal(page):
            btn = page.get_by_role("button", name="New Project")
            if await btn.count():
                await btn.click()
                await page.wait_for_timeout(300)

        await capture(pw, "/", "01-new-project-modal.png", setup=open_create_modal)

        # 02 — JobsPage
        await capture(pw, "/jobs", "02-jobs-page.png")

        # 08 — SettingsPage
        await capture(pw, "/settings", "08-settings.png")

        # For project-specific routes: if no projects exist, screenshots show empty state.
        # These require a real project to exist. Capture with first available project.
        # The script prints instructions if no project is found.
        print("\nNote: Routes /projects/:id/* require an existing project.")
        print("Run the app, create a project, then re-run this script for workbench shots.")
        print("\nDone. Screenshots saved to:", OUT_DIR)


if __name__ == "__main__":
    asyncio.run(main())
```

- [ ] **Step 2: Make executable and test it runs without error (server not required to start)**

```bash
chmod +x /workspaces/ocr-container/pdomain-prep-for-pgdp/scripts/capture-screenshots.py
cd /workspaces/ocr-container/pdomain-prep-for-pgdp && \
  uv run --group e2e python scripts/capture-screenshots.py --help 2>&1 || echo "(no --help flag; script ran)"
```

Expected: Script exits cleanly (it will fail to connect to server, which is fine at this step).

- [ ] **Step 3: Commit**

```bash
git -C /workspaces/ocr-container/pdomain-prep-for-pgdp add scripts/capture-screenshots.py
git -C /workspaces/ocr-container/pdomain-prep-for-pgdp commit -m "scripts: Playwright screenshot capture for design brief"
```

---

## Task 3: Existing UI — Screen Documentation (batch)

**Files:**
- Create: `docs/design-brief/existing-ui/00-project-list.md`
- Create: `docs/design-brief/existing-ui/01-new-project.md`
- Create: `docs/design-brief/existing-ui/02-jobs-page.md`
- Create: `docs/design-brief/existing-ui/08-settings.md`
- Create: `docs/design-brief/existing-ui/09-shell.md`

Write one markdown file per screen. Each file follows this template:

```markdown
# Screen: [Name]

**Route:** `/path`
**Component:** `pages/ScreenPage.tsx`
**Screenshot:** `screenshots/NN-name.png`

## Purpose
[One paragraph: what the user is doing on this screen, who uses it, when they reach it.]

## Layout
[Prose description of the visual layout — columns, panels, scroll behavior. Reference tokens from design-system.md.]

## Component Inventory
| Component | Location | Description |
|---|---|---|
| ComponentName | top-left | What it does |

## State & Data
- **Data fetched:** `GET /api/...` → [shape]
- **User-mutable state:** [what changes and how]

## Key Interactions
- [Interaction] → [what happens]

## Empty / Error States
- No projects: [what is shown]
- Error: [what is shown]

## Open Design Questions
- [anything unclear or unresolved about this screen's design]
```

- [ ] **Step 1: Write `00-project-list.md`**

```markdown
# Screen: Project List

**Route:** `/`
**Component:** `pages/ProjectListPage.tsx`
**Screenshot:** `screenshots/00-project-list.png`

## Purpose
The home screen. Lists all projects the current user has created, with status
at a glance. Users land here after login and return here between books. A content
provider manages multiple books simultaneously; this screen is their dashboard.

## Layout
Single column, full width. TopNav across the top (amber brand, search, bell, user).
PageHeader below with "Projects" title and "+ New Project" button (primary, top-right).
Below that: a responsive grid of ProjectCards (3-column at 1440px, 2-col at 1024px,
1-col at 768px). Infinite scroll — 200 cards per page. No sidebar.

## Component Inventory
| Component | Location | Description |
|---|---|---|
| TopNav | header | Dark bar: brand word, search pill, bell, user menu |
| PageHeader | below nav | "Projects" h1 + "+ New Project" primary button |
| ProjectCard | grid | One card per project: name, page count, status badge, delete |
| CreateProjectModal | overlay | 2-step new-project dialog (see screen 01) |
| EmptyState | center | Illustration + CTA when no projects exist |

## State & Data
- **Data fetched:** `GET /api/data/projects?limit=200&cursor=…` → `Project[]`
- **User-mutable state:** Create (opens modal), Delete (AlertDialog confirmation)

## Key Interactions
- Click "+ New Project" → opens `CreateProjectModal`
- Click `ProjectCard` → navigates to `/projects/:id`
- Click delete icon on card → `AlertDialog` "Delete project? This is permanent." → `DELETE /api/data/projects/:id`
- Scroll to bottom → loads next 200 projects (infinite scroll)

## Empty / Error States
- No projects: centered illustration + "No projects yet" + "Create your first project" button
- Network error: inline error banner with retry button

## Open Design Questions
- Should ProjectCard show a thumbnail of the first page image?
- Should there be a search/filter bar above the grid for large project lists?
- Should projects be grouped by status (active / packaged / archived)?
```

- [ ] **Step 2: Write `01-new-project.md`**

```markdown
# Screen: New Project (Modal)

**Route:** `/` (modal overlay)
**Component:** `pages/ProjectListPage.tsx → CreateProjectModal`
**Screenshots:** `screenshots/01-new-project-modal.png`, `screenshots/01-new-project-upload.png`

## Purpose
Two-step wizard to create a project and upload source images. Step 1: book name.
Step 2: source upload (currently zip only — P0.3 blocker: folder not yet supported).
After upload completes, ingest runs automatically and the user is navigated to
`/projects/:id/configure`.

## Layout
Radix Dialog, centered at 560px wide, 2-step wizard. Step indicator at top.
Step 1: single text input for book name + Next button.
Step 2: drag-drop zone (dashed border, cloud-upload icon) + file picker fallback.
Progress bar replaces drag-drop zone during upload. SSE streams ingest progress.

## Component Inventory
| Component | Location | Description |
|---|---|---|
| Dialog | overlay | Focus-trapped modal with Escape-to-close |
| StepIndicator | top of dialog | "1 — Name → 2 — Upload" breadcrumb |
| Input | step 1 | Book name text field |
| DropZone | step 2 | Drag-drop target for .zip file |
| Progress | step 2 | Upload + ingest progress bar |
| FormErrorBanner | bottom | sonner toast on error |

## State & Data
- **Step 1 state:** `bookName` (string)
- **Step 2 state:** `file` (File | null), `uploadProgress` (0–100), `ingestJobId`
- **API calls:** `POST /api/data/projects` → create; PUT (upload URL) → upload zip;
  `POST /api/gpu/ingest` → trigger ingest; SSE → ingest progress

## Key Interactions
- Type book name → Next → shows step 2
- Drag zip file onto zone OR click to browse → file selected
- Click "Start Upload" → progress bar animates; SSE updates ingest status
- Ingest complete → navigate to `/projects/:id/configure`
- Escape / X → close modal (confirms if upload in progress)

## Empty / Error States
- Name empty: Next button disabled
- Wrong file type: "Please upload a .zip file" error
- Upload fails: error banner + "Retry" button
- Ingest fails: "Ingest failed — see error below" with job log excerpt

## Open Design Questions
- **P0.3:** How should folder upload work? Options:
  (a) Browser drag-drop a folder (webkitdirectory API, JSZip client-side)
  (b) Multi-file picker (select all files in folder)
  (c) Server-side: accept a path on the local filesystem (local-mode only)
- Should there be a step 3 for book metadata (author, language, clearance)?
  Or is metadata deferred to after configure?
- Should ingest progress show per-page thumbnails as they generate?
```

- [ ] **Step 3: Write `02-jobs-page.md`**

```markdown
# Screen: Jobs

**Route:** `/jobs`
**Component:** `pages/JobsPage.tsx`
**Screenshot:** `screenshots/02-jobs-page.png`

## Purpose
Global view of all background jobs across all projects. Users visit this when
something is running slowly, to diagnose a failure, or to check what's queued.
In local mode, jobs run immediately in-process; in managed mode they queue.

## Layout
Full-width single column. PageHeader "Jobs" with ToggleGroup filter (All /
Running / Queued / Done / Errored / Awaiting review) as a segmented control
in the header actions slot. Below: scrollable list of JobCard rows, newest first.
Polling at 5s for live updates.

## Component Inventory
| Component | Location | Description |
|---|---|---|
| ToggleGroup | header actions | Mutually exclusive filter: All/Running/Queued/Done/Errored/Review |
| JobCard | list rows | Type badge, project name, progress bar, status badge, log button, more ⋯ |
| Progress | in JobCard | Linear progress 0–100% |
| Badge | in JobCard | Status color-coded pill |
| EmptyState | center | "No jobs" when filter returns nothing |

## State & Data
- **Data fetched:** `GET /api/data/jobs?status=…` → `Job[]`, polling 5s
- **User-mutable state:** Filter selection

## Key Interactions
- Click filter chip → updates list
- Click "View logs" in JobCard → opens log drawer or expands card
- Click "⋯" on card → dropdown: cancel (if running/queued), retry (if errored)
- Click project name in JobCard → navigates to `/projects/:id`

## Empty / Error States
- No jobs match filter: "No [status] jobs" empty state
- Network error: banner with retry

## Open Design Questions
- Should jobs link directly to the specific page that failed (when job is per-page)?
- Should completed jobs be auto-hidden after N minutes?
```

- [ ] **Step 4: Write `08-settings.md`**

```markdown
# Screen: Settings

**Route:** `/settings`
**Component:** `pages/SettingsPage.tsx`
**Screenshot:** `screenshots/08-settings.png`

## Purpose
System-wide defaults that apply to all new projects. Power-user screen.
A content provider sets these once when they install the app, then rarely revisits.
Currently covers: OCR engine, layout detector, scannos list, hyphenation list.

## Layout
Single column, 640px max-width centered. PageHeader "Settings". Sections separated
by `Separator`. Each section: heading + form fields. Save button at bottom.

## Component Inventory
| Component | Location | Description |
|---|---|---|
| Select | OCR engine | Dropdown: "DocTR (default)", "Tesseract" |
| Select | Layout detector | Dropdown: detector model names |
| Textarea | Scannos | Tab-delimited find→replace pairs, one per line |
| Textarea | Hyphenation | Word list for cross-line hyphen joining |
| Button (primary) | bottom | "Save settings" |

## State & Data
- **Data fetched:** `GET /api/data/settings` → `SystemDefaults`
- **Draft state:** local copy edited before save
- **Save:** `PUT /api/data/settings`

## Key Interactions
- Edit any field → "Save settings" becomes enabled
- Click Save → `PUT` + success toast

## Empty / Error States
- Load error: error banner

## Open Design Questions
- **WF-12:** Scannos and hyphenation lists should become first-class libraries,
  not raw textareas. See WF-12-settings-enhancements.md.
- Should there be per-language settings sections?
- Should settings show a "test OCR on sample image" affordance?
```

- [ ] **Step 5: Write `09-shell.md`**

```markdown
# Screen: Application Shell

**Route:** all routes
**Component:** `components/shell/AppShell.tsx`, `TopNav.tsx`, `PageHeader.tsx`
**Screenshot:** n/a (appears on every screen)

## Purpose
Persistent chrome that frames every page. Provides navigation, global search,
job notifications, and user identity.

## Layout
CSS grid: 3 rows (auto / 1fr / auto). Full 100dvh height.
- **Row 1 (TopNav):** ~56px dark bar. Left: amber "pgdp-prep" brand word.
  Center: search pill "Search pages… ⌘K". Right: bell icon (with count badge),
  user avatar (opens dropdown).
- **Row 2 (main):** scrollable content area, bg-page.
- **Row 3 (ServerInfoFooter):** ~32px, server URL + copy button.

## Component Inventory
| Component | Description |
|---|---|
| `TopNav` | Dark header: brand, search pill, OpenTasksPopover (bell), UserMenu |
| `SearchModal` | Full-screen search dialog (Cmd+K): FTS5 query + snippet results |
| `OpenTasksPopover` | Bell popover: list of in-progress/attention items across all projects |
| `HotkeyHelpModal` | ? key: keyboard shortcut reference sheet |
| `UserMenu` | Avatar dropdown: username, theme toggle (light/dark), sign out |
| `ServerInfoFooter` | Bottom bar: server URL (selectable) + copy icon |

## Key Interactions
- Cmd+K → opens SearchModal (global FTS5 across all OCR text)
- ? → opens HotkeyHelpModal
- Bell click → OpenTasksPopover with task list
- Avatar → UserMenu with theme toggle and sign out
- Brand word → navigates to `/`

## Open Design Questions
- Should the bell show separate counts for "jobs running" vs "pages needing review"?
- Should TopNav include a breadcrumb for deep routes (project → page)?
```

- [ ] **Step 6: Commit**

```bash
git -C /workspaces/ocr-container/pdomain-prep-for-pgdp add docs/design-brief/existing-ui/
git -C /workspaces/ocr-container/pdomain-prep-for-pgdp commit -m "docs(design): screen descriptions 00-02, 08-09 for Claude Design brief"
```

---

## Task 4: Existing UI — Workbench Screens

**Files:**
- Create: `docs/design-brief/existing-ui/03-project-configure.md`
- Create: `docs/design-brief/existing-ui/04-page-workbench.md`
- Create: `docs/design-brief/existing-ui/05-text-review.md`
- Create: `docs/design-brief/existing-ui/06-crops-grid.md`
- Create: `docs/design-brief/existing-ui/07-review-queue.md`

- [ ] **Step 1: Write `03-project-configure.md`**

```markdown
# Screen: Project Configure

**Route:** `/projects/:projectId`
**Component:** `pages/ProjectConfigurePage.tsx`
**Screenshot:** `screenshots/03-configure-pipeline-tab.png`, `03-configure-pages-tab.png`, `03-configure-settings-tab.png`

## Purpose
The main project hub after ingest. Three tabs: Pipeline (orchestration controls),
Pages (full page list with drag-reorder and status), Settings (book-level config).
Users spend most of their "between books" time here: kicking off pipeline runs,
checking for errors, managing page order.

## Layout
PageHeader: book name + breadcrumb back to projects. Below: Tabs (Pipeline / Pages
/ Settings) full-width. Tab content fills remaining viewport height.

### Pipeline Tab
Left column (~320px): RunAllDirtyPanel (primary CTA), AwaitingReviewBanner (amber,
conditional), OpenTasksBell popover, DiskCostBanner. Right column: stage status
summary grid (22 stage chips, project-level aggregate clean/dirty/failed counts).

### Pages Tab
Toolbar: multi-select checkbox, bulk page-type dropdown, "Show split parents" toggle.
Full-width table: one PageRow per page. Columns: drag handle, page number (mono),
source stem (truncated), page type badge, alignment badge, stage status dot, chevron.
Infinite scroll at 200 rows. Shift+click range-select.
Clicking a row opens PageDrawer (right-side slide-in panel) OR navigates to workbench.

### Settings Tab
Book-level config form: proof range (start/end idx), frontmatter range + starting
page number, bodymatter range + starting page number, initial crop margins (4 numbers),
OCR crop margins (4 numbers), page H/W ratio, book-specific scannos textarea,
book-specific hyphenation textarea. Save button.

## Component Inventory
| Component | Tab | Description |
|---|---|---|
| `RunAllDirtyPanel` | Pipeline | "Run all dirty stages" CTA + job progress |
| `AwaitingReviewBanner` | Pipeline | Amber alert: N pages need review |
| `OpenTasksPopover` | Pipeline | Bell icon + task list |
| `DiskCostBanner` | Pipeline | Stage artifact disk usage |
| `PageRow` | Pages | Drag handle, page #, stem, badges, status |
| `PageDrawer` | Pages | Right-side slide-in with per-page config |
| Book settings form | Settings | Proof range, frontmatter, bodymatter, crops |

## State & Data
- **Data fetched:** `GET /api/data/projects/:id` → `Project`; `GET .../pages` → `Page[]`
- **Optimistic reorder:** `localPageOrder` state, patched on drag-end

## Key Interactions
- "Run all dirty stages" → `POST /api/data/projects/:id/run-dirty` + SSE progress
- "Build package" → `POST .../build-package` + SSE; button disabled until all reviewed
- Drag page row → optimistic reorder → `PATCH .../pages` with new order
- Shift+click rows → range select → bulk page-type dropdown applies to all selected
- Click page row → opens PageDrawer with that page's overrides
- Click workbench icon in PageDrawer → navigates to `/projects/:id/pages/:idx0`

## Empty / Error States
- Pages tab empty: "No pages yet — run ingest"
- Stage errors: page rows show red status dot; filter "Errors only" available

## Open Design Questions
- **WF-09 (page reorder):** Current drag-reorder UX needs detailed wireframe
- **WF-03 (source quality):** Should this screen show a "pages needing attention" banner post-ingest?
- Should the Pipeline tab show a per-stage breakdown across all pages (e.g., "12 pages with dirty OCR")?
```

- [ ] **Step 2: Write `04-page-workbench.md`**

```markdown
# Screen: Page Workbench

**Route:** `/projects/:projectId/pages/:idx0`
**Component:** `pages/PageWorkbenchPage.tsx`
**Screenshot:** `screenshots/04-workbench-view.png`, `04-workbench-split-mode.png`, `04-workbench-illustration-mode.png`

## Purpose
Single-page interactive pipeline editor. The user inspects each page's processing
output, tweaks per-page config, re-runs individual stages, draws splits and
illustration regions, and marks the page reviewed. This is the highest-density UI
in the app; users may spend minutes here on a difficult page.

## Layout
Four vertical zones (top to bottom):
1. **Workbench header** (~48px): breadcrumb (Project / Page N of M), prev/next arrows,
   edit-mode selector (View / Split / Illustration / Rotate), "Mark reviewed" button.
2. **StageChainRail** (~72px): horizontal scrollable chip strip, one chip per stage (22 total).
   Each chip: colored status dot, stage name (abbreviated), lazy thumbnail for image stages.
3. **Main pane** (fills remaining height): split 60/40 — ArtifactViewer (left) / StageControlsPanel (right).
4. **TextReview section** (below main pane, collapsible): OCR text textarea with word-count,
   "Mark page reviewed" CTA.

### ArtifactViewer (left 60%)
Top bar: primary stage selector (synced to chip rail) + compare stage selector (dropdown).
Two side-by-side image panes (or text for non-image stages). Image pane supports:
- Pinch-to-zoom / scroll-wheel zoom
- Konva canvas overlay for word bboxes, split regions, illustration regions
- Crosshair cursor in drawing modes

### StageControlsPanel (right 40%)
Header: selected stage name + "Apply & Run" / "Apply & Run from here" buttons.
Body: dynamic form fields for the selected stage's `PageConfigOverrides`.
Fields visible depend on selected stage:
- **grayscale**: (new WF-11) perceptual mode toggle
- **threshold**: threshold_level (0–255 slider + number input)
- **find_content_edges**: fuzzy_pct, pixel_count_columns, pixel_count_rows
- **auto_deskew**: skip_auto_deskew (checkbox), deskew_before_crop (angle), deskew_after_crop (angle)
- **canvas_map**: force_align (Top/Center/Bottom/Default), white_space_additional (4 margins), single_dimension_rescale, rotated_standard
- **morph_fill**: do_morph (checkbox), skip_denoise (checkbox)
- **ocr**: (no fields; OCR engine from system settings)
- **extract_illustrations**: (WF-08) format/size controls per region

## Edit Modes (mode selector in header)
| Mode | Canvas behavior |
|---|---|
| View | Read-only; click word bbox to select |
| Split | Draw rectangle bbox to define split regions; commit creates sibling pages |
| Illustration | Draw rectangle bbox to mark illustration regions |
| Rotate | Drag to set manual rotation angle; previews deskew_before/after_crop |

## Component Inventory
| Component | Zone | Description |
|---|---|---|
| `StageChainRail` | rail | 22 chips, color-coded, click to select/run |
| `ArtifactViewer` | left pane | Image/text artifact display with stage comparison |
| `StageControlsPanel` | right pane | Dynamic per-stage config form |
| Konva canvas | left pane | Word bboxes, split regions, illustration regions |
| `WordBboxOverlay` | canvas layer | Colored bboxes for each OcrWord |
| TextReview textarea | bottom | Collapsible OCR text editor |

## Key Interactions
- Click chip → selects stage; ArtifactViewer + StageControlsPanel update
- Click chip "run" icon → runs that stage (sync or async)
- Adjust field in StageControlsPanel → "Apply & Run" becomes enabled
- "Apply & Run" → saves overrides + re-runs selected stage
- "Apply & Run from here" → saves overrides + re-runs selected stage AND all downstream
- Draw bbox in Split mode → "Commit split" → creates N sibling pages
- Draw bbox in Illustration mode → adds region to page's illustration_regions list
- Click word bbox → selects word; "Delete selected" removes it
- Marquee drag → selects range of word bboxes
- prev/next arrows → navigate to adjacent pages (saves any pending changes first)

## Empty / Error States
- Stage not yet run: ArtifactViewer shows "Not run yet — click Run in the rail"
- Stage failed: ArtifactViewer shows error message + log excerpt
- Loading: skeleton shimmer in both panes

## Open Design Questions
- Should StageControlsPanel be a slide-out drawer on smaller viewports?
- Should the chip rail show elapsed time on the last run?
- Should "Apply & Run from here" show a preview of which stages will re-run?
```

- [ ] **Step 3: Write `05-text-review.md`**

```markdown
# Screen: Text Review

**Route:** `/projects/:projectId/pages/:idx0/review`
**Component:** `pages/TextReviewPage.tsx`
**Screenshot:** `screenshots/05-text-review.png`

## Purpose
Focused OCR text review for a single page. The user reads the OCR output, clicks
on problem words (highlighted in the word-bbox overlay), edits inline, and marks
the page reviewed. Also supports a "re-OCR diff" view to compare current text
against a fresh OCR pass.

## Layout
Two-pane layout (side-by-side at 1440px, stacked on mobile):
- **Left pane** (~50%): source proofing image with WordBboxOverlay.
  Split suffix selector (if page has splits) at top. Active word highlighted.
- **Right pane** (~50%): Textarea for OCR text (monospaced). Below textarea:
  word count, "Mark page reviewed" CTA, "Re-OCR & diff" button.
  If diff active: LineDiffView replaces textarea (line-by-line diff coloring).

## Component Inventory
| Component | Pane | Description |
|---|---|---|
| `WordBboxOverlay` | left | Konva bbox overlay; click-to-select syncs with textarea position |
| ToggleGroup | left top | Split suffix selector (if splits exist) |
| Textarea | right | OCR text; monospace; auto-height |
| `LineDiffView` | right (diff mode) | Side-by-side diff of old vs new OCR text |
| Undo window | right | 5s countdown bar after word delete |

## Key Interactions
- Click word bbox → scrolls textarea to that word's position; word highlighted
- Click word in textarea → highlights corresponding bbox
- Edit textarea → marks page dirty (unsaved)
- "Save" (auto or explicit) → `PUT /api/data/pages/:idx0/text`
- "Delete word" (via bbox click + delete button) → removes word from OcrWord list + text
- Undo window (5s) → can reverse last delete
- "Mark page reviewed" → `POST .../review` → transitions to clean; redirects to review queue or next page
- "Re-OCR & diff" → runs OCR again + shows diff vs current text
- Escape → exits diff view back to textarea

## Open Design Questions
- Undo strategy: server-side `OcrWord.deleted` flag (restore endpoint), or client debounce window?
- Should there be a "copy clean text to clipboard" button?
```

- [ ] **Step 4: Write `06-crops-grid.md` and `07-review-queue.md`**

```markdown
# Screen: Crops Grid

**Route:** `/projects/:projectId/crops`
**Component:** `pages/CropsGridPage.tsx`
**Screenshot:** `screenshots/06-crops-grid.png`

## Purpose
Batch crop review pass. Shows canvas_map stage thumbnails for every page in a
responsive grid so the user can visually scan for deskew failures, over-crops,
or alignment issues — without clicking into each page's workbench individually.
This is the "assembly line review" view for image processing quality.

## Layout
PageHeader "Crop Review" + back-to-project link. Below: responsive grid, 4 columns
at 1440px. Each cell: canvas_map thumbnail (square, object-fit: contain, white bg),
page prefix label (mono, below image), status dot (stage status), clickable → workbench.
Infinite scroll, 200 per page.

## Key Interactions
- Click any grid cell → navigates to `/projects/:id/pages/:idx0` (workbench, auto-selects canvas_map stage)

## Open Design Questions
- **WF-10:** Should this grid support bulk marking (e.g., "flag these pages for manual review")?
- Should cells show which specific issue was detected (e.g., "auto-deskew skipped", "near-margin content")?
```

```markdown
# Screen: Project Review Queue

**Route:** `/projects/:projectId/review`
**Component:** `pages/ProjectReviewQueuePage.tsx`
**Screenshot:** `screenshots/07-review-queue.png`

## Purpose
Filtered list of pages awaiting text review before `build_package` can resume.
The user works through this queue page-by-page until it is empty, at which point
the parked build_package job auto-resumes. This is the "final check" step.

## Layout
PageHeader "Review Queue" + count badge ("12 pages remaining"). Amber
ReviewQueueBanner below header. Then: same PageRow list as the Pages tab of
ProjectConfigurePage, filtered to `text_review.status = dirty`. "Review next
page →" CTA navigates to the first page in queue.

## Key Interactions
- "Review next page →" → navigates to `/projects/:id/pages/:idx0/review` for first unreviewed page
- Each page in list is clickable → navigates directly to that page's review
- When queue empties: banner changes to "All pages reviewed — package resuming" + auto-redirects
```

- [ ] **Step 5: Commit**

```bash
git -C /workspaces/ocr-container/pdomain-prep-for-pgdp add docs/design-brief/existing-ui/
git -C /workspaces/ocr-container/pdomain-prep-for-pgdp commit -m "docs(design): workbench screen descriptions 03-07 for Claude Design brief"
```

---

## Task 5: Workflow Specs — P0 and P1

**Files:**
- Create: `docs/design-brief/workflows/WF-01-folder-upload.md`
- Create: `docs/design-brief/workflows/WF-02-package-validation.md`
- Create: `docs/design-brief/workflows/WF-03-source-quality.md`
- Create: `docs/design-brief/workflows/WF-09-page-reorder.md`
- Create: `docs/design-brief/workflows/WF-10-batch-crop-review.md`

Each workflow doc follows this template for Claude Design:

```
# Workflow: [Name]

**Priority:** P0 / P1 / P2 / P3
**Affects:** [which existing screens change] + [new screens needed]
**Audience:** Content provider; solo PGDP project manager.

## Problem
[What is painful today. 1-2 sentences.]

## Goal
[What the user can do after this is built. 1 sentence.]

## Actor & Entry Points
- **Who:** [role]
- **Enters from:** [screen / trigger]

## Step-by-Step Flow
1. [step]
2. [step]
...

## Happy Path Mockup Spec
[Describe the layout of each new/changed screen in enough detail for Claude Design
to generate a wireframe. Include: component placement, copy, states, constraints.]

## Edge Cases & Error States
- [case] → [what happens]

## Open Design Questions
- [question]

## Constraints
- [technical constraint the design must respect]
```

- [ ] **Step 1: Write `WF-01-folder-upload.md`**

```markdown
# Workflow: Folder Upload (P0.3)

**Priority:** P0 — blocks real Internet Archive books (most common source)
**Affects:** `01-new-project.md` CreateProjectModal (step 2 redesign)
**Audience:** Content provider

## Problem
Internet Archive downloads are folders of JP2 or PNG files, not zip archives.
The user must manually zip them before uploading — error-prone, slow on 400-page books,
and unexpected for new users.

## Goal
Accept a folder of image files directly from the user's filesystem, without requiring
them to zip it first.

## Actor & Entry Points
- **Who:** Content provider creating a new project
- **Enters from:** CreateProjectModal step 2 (currently "Upload zip")

## Step-by-Step Flow
1. User clicks "+ New Project", enters book name, clicks Next.
2. Upload step shows two options: "Upload zip" (existing) or "Select folder" (new).
3. User clicks "Select folder" → OS file picker opens with directory selection enabled
   (`webkitdirectory` attribute).
4. User selects the IA download folder (contains 400 JP2 files).
5. Browser shows file count + total size: "387 files, 2.1 GB — ready to upload".
6. User clicks "Start Upload".
7. Browser zips files client-side (JSZip, streaming, with progress) OR sends as
   multipart batch. Progress bar shows "Zipping… 43%" then "Uploading… 71%".
8. On completion, ingest fires automatically (same as zip path).

## Happy Path Mockup Spec

### Step 2 — Source Upload (redesigned)
Two-up card layout within the dialog (560px wide):
- Left card: "Zip archive" — cloud-upload icon, "Drag a .zip here or click to browse",
  "Up to 200 MB", dashed border. Currently implemented path.
- Right card: "Folder of images" — folder icon, "Select a folder of JP2 / PNG / JPG files",
  "JP2, PNG, JPG supported", dashed border. New path.

Both cards same height (~140px). Selected card gets accent border + checkmark badge.

After folder selected (before upload):
- File count badge: "387 files selected"
- Total size: "2.1 GB"
- File type summary: "JP2 (380), PNG (7)"
- Warning if any unrecognized extensions: amber badge "3 files will be skipped"
- "Start Upload" primary button (full-width, bottom of dialog)

During upload (folder path):
- Progress bar replaces card area
- Two-line status: "Preparing files…" (zipping phase) / "Uploading…" (transfer phase)
- Percentage + bytes transferred
- "Cancel" ghost button

## Edge Cases & Error States
- Folder contains no image files → "No supported image files found in this folder"
- Folder > 5 GB → warning: "Large folder — upload may take several minutes"
- Mixed folder + zip drag → "Please select either a folder or a zip, not both"
- User selects a file instead of folder → "Please select a folder, not a file"
- Upload interrupted → "Upload paused — Resume or Start over" with resume button

## Open Design Questions
- Should folder upload zip client-side (JSZip) or send raw multipart?
  Client-side zip avoids multipart complexity but is slower for large folders.
- For local-mode only: offer a "Use local path" option? Type a filesystem path
  that the server reads directly (avoids browser upload entirely for localhost users).
- Should the file-count preview show a sortable list of detected filenames?

## Constraints
- `webkitdirectory` is Chrome/Firefox/Edge only; Safari has partial support.
- Zip files must use `.zip` extension for PGDP.
- Max zip size 200 MB (PGDP constraint) — client should warn if output zip will exceed.
```

- [ ] **Step 2: Write `WF-02-package-validation.md`**

```markdown
# Workflow: Package Validation Report

**Priority:** P1
**Affects:** `03-project-configure.md` Pipeline tab (adds validation step before download)
**Audience:** Content provider

## Problem
The "Download package" link appears after build_package completes, but there is no
automated check that the package meets PGDP's submission requirements. The user
may download and upload a package that fails PGDP's Project Quick Check, discovering
the error only after manually inspecting the rejection email.

## Goal
Before the download link activates, run a local validation pass and surface any
PGDP-requirement failures or warnings so the user can fix them in the app.

## Actor & Entry Points
- **Who:** Content provider after all pages are reviewed
- **Enters from:** Pipeline tab → build_package completes → validation runs automatically

## Step-by-Step Flow
1. `build_package` job completes → validation pass runs automatically.
2. Validation checks (run server-side on the assembled `for_zip/` contents):
   a. Every proof-range page has both `.png` and `.txt`
   b. PNG+TXT base names match
   c. Page prefix sequence has no gaps or duplicates
   d. All PNG files are 1-bit (black & white), not 8-bit grayscale
   e. All page PNG file sizes < 100 KB (PGDP target for dial-up accessibility)
   g. Illustration images within size limits (inline ≤ 256 KB, linked ≤ 1 MB)
   h. Zip filename is valid ASCII, no leading hyphen, lowercase `.zip` extension
   i. No corrupt PNGs (PIL can open all files)
3. Results: PASS (all green) or WARNINGS (amber) or ERRORS (red, blocks download).
4. Validation summary panel appears in Pipeline tab (replaces or augments download button).
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
- Should the 100 KB file size warning be configurable (some PGDP projects allow larger)?
```

- [ ] **Step 3: Write `WF-03-source-quality.md`**

```markdown
# Workflow: Source Quality Assessment

**Priority:** P1
**Affects:** `03-project-configure.md` (adds post-ingest attention banner + filtered page list)
**Audience:** Content provider after ingest

## Problem
After ingest, the user has no automated signal about which pages are likely to
be problematic before running the full pipeline. Pages that are blurry, skewed
beyond auto-deskew capability, too dark, or damaged produce garbage OCR — which
the user discovers only after the expensive OCR stage runs.

## Goal
After ingest, automatically flag pages that are likely to need manual intervention,
and surface them as an actionable list so the user can fix or override settings
before the bulk pipeline run.

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
- "blurry" / "dark" / "heavy skew" / "sparse content"
Multiple badges stack.

### Filtered View ("Flagged pages" filter)
Filter chip in Pages tab toolbar: All | Flagged | Errors | (existing filters)
When "Flagged" active: shows only pages with quality_flags. Same PageRow layout.
Clicking a row → workbench with source stage selected (so user sees the raw scan).

## Edge Cases
- 0 flags → no banner shown
- All pages flagged → banner says "All pages flagged" with orange border

## Open Design Questions
- What thresholds for blur/contrast? Should these be configurable in Settings?
- Should flags be re-evaluated after the user provides overrides (e.g., after manual deskew)?
```

- [ ] **Step 4: Write `WF-09-page-reorder.md`**

```markdown
# Workflow: Page Reorder

**Priority:** P1 (#P1.1 in roadmap)
**Affects:** `03-project-configure.md` Pages tab (adds drag-to-reorder + confirmation)
**Audience:** Content provider when scans arrive out of order

## Problem
If Internet Archive scans are out of order (e.g., a multi-run scan where odd and
even pages were scanned separately), or if the user detects a mis-ordered page
after ingest, there is no way to reorder pages without re-ingesting from scratch.

## Goal
Allow the user to drag-and-drop page rows in the Pages tab to reorder them;
the new order is saved and propagates to prefix assignment and package output.

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
- Reorder while pipeline running → warning dialog: "Reordering will dirty N pages.
  Running stages will complete first. Continue?"
- Reorder to before proof_start → "This page will be outside the proof range."

## Open Design Questions
- Should reorder also update `proof_start_idx0` / `proof_end_idx0` in project config
  if a page is moved outside the current range?
- Should there be an "auto-sort" button that re-sorts by filename?
```

- [ ] **Step 5: Write `WF-10-batch-crop-review.md`**

```markdown
# Workflow: Batch Crop Review (CropsGridPage Enhancements)

**Priority:** P1 (#P1.2 in roadmap)
**Affects:** `06-crops-grid.md` (existing screen; extend with quality flags + bulk actions)
**Audience:** Content provider after initial pipeline run

## Problem
The CropsGridPage exists but is read-only — it shows canvas_map thumbnails but
offers no way to flag, annotate, or bulk-act on pages with crop problems. The
user must click into each workbench individually to fix a bad crop.

## Goal
Make the crops grid interactive: show quality flags on thumbnails, support
multi-select, and offer bulk "re-run from initial_crop" for a selection.

## Step-by-Step Flow
1. User navigates to `/projects/:id/crops` after pipeline run.
2. Grid shows all canvas_map thumbnails. Quality flags appear as badges.
3. User visually scans for bad crops (common: over-cropped margins, skew not corrected).
4. Clicks problem thumbnails to select them (checkboxes appear on hover).
5. Shift+click to range-select a group.
6. Bulk action bar appears at bottom of screen: "Re-run from initial_crop (5 pages)"
7. Clicks "Re-run" → all selected pages re-run stages 4 (initial_crop) through canvas_map.
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
- Should there be a "crop only" mode where the user can draw the crop bbox
  directly on the thumbnail without opening the full workbench?
```

- [ ] **Step 6: Commit**

```bash
git -C /workspaces/ocr-container/pdomain-prep-for-pgdp add docs/design-brief/workflows/
git -C /workspaces/ocr-container/pdomain-prep-for-pgdp commit -m "docs(design): workflow specs WF-01 through WF-03, WF-09, WF-10"
```

---

## Task 6: Workflow Specs — P2 and P3

**Files:**
- Create: `docs/design-brief/workflows/WF-04-metadata-collection.md`
- Create: `docs/design-brief/workflows/WF-05-hyphen-join-workbench.md`
- Create: `docs/design-brief/workflows/WF-06-regex-workbench.md`
- Create: `docs/design-brief/workflows/WF-07-project-comments.md`
- Create: `docs/design-brief/workflows/WF-08-illustration-format.md`
- Create: `docs/design-brief/workflows/WF-11-gegl-grayscale.md`
- Create: `docs/design-brief/workflows/WF-12-settings-enhancements.md`

- [ ] **Step 1: Write `WF-04-metadata-collection.md`**

```markdown
# Workflow: PGDP Metadata Collection

**Priority:** P2
**Affects:** New step in project creation wizard (step 3) OR new "PGDP Export" page
**Audience:** Content provider who is also the project manager on PGDP

## Problem
After downloading the package zip, the user must manually enter all book metadata
into PGDP's project creation form: author (Last, First), full title, language,
character suites (Latin/Greek/etc.), genre, difficulty, credits (image preparer,
text preparer, OCR tool), and copyright clearance key. None of this is collected
by the app.

## Goal
Collect PGDP-required metadata and export it alongside the package zip as a
filled-in reference sheet the user can copy-paste into PGDP's form.

## Step-by-Step Flow
1. After book name step in CreateProjectModal, a new optional step 3 appears:
   "PGDP project details (optional — skip if not submitting to PGDP)".
2. User fills in fields (all optional at creation time, can be edited later).
3. Fields are saved to `ProjectConfig.pgdp_metadata`.
4. After `build_package` completes, a "PGDP Reference Sheet" section appears
   in the Pipeline tab alongside the download button.
5. Reference sheet shows all fields in copy-paste-friendly format.
6. "Copy all fields" button copies as tab-delimited text for easy form entry.

## Happy Path Mockup Spec

### Step 3 in CreateProjectModal (optional)
Dialog expands to show:
- "PGDP Project Details" header + "Skip →" link (right-aligned, ghost)
- Two-column form:
  Left column: Author (Last, First) text input; Full title text input;
    Subtitle text input (optional label)
  Right column: Language multi-select (primary + secondary from PGDP's list);
    Character suites multi-checkbox (Basic Latin ✓ by default, Greek, Cyrillic, etc.)
- Second row: Genre dropdown (PGDP's list); Difficulty radio (Easy / Average / Hard)
- Credits section (collapsible "Advanced"):
  Image preparer, Text preparer, OCR tool (Select: DocTR / Tesseract / ABBYY / Other)
- Clearance key text input (PGLAF clearance key, 8-char format hint)
- "Save & continue" primary button

### PGDP Reference Sheet (Pipeline tab, after build_package)
Card below the download/validation panel. Header "PGDP Submission Reference".
Two-column layout of field/value pairs:
  Name of Work: [title]    Author: [Last, First]
  Language: [lang]         Character Suites: [list]
  Genre: [genre]           Difficulty: [level]
  Credits: [formatted]     Clearance: [key]
Footer: "Copy all" button → copies as formatted text for PGDP form.

## Open Design Questions
- Should the app validate the clearance key format (8-char alphanumeric)?
- Should there be a "Search Library of Congress" button to autofill title/author from ISBN?
- Should character suites be auto-detected from the OCR text (detect non-Latin characters)?
```

- [ ] **Step 2: Write `WF-05-hyphen-join-workbench.md`**

```markdown
# Workflow: Hyphen-Join Rule Workbench

**Priority:** P2
**Affects:** `08-settings.md` (replace textarea with library UI) + new per-book panel in configure settings tab
**Audience:** Content provider during text post-processing

## Problem
The notebook had a shared `hyphenated-line-join.json` with beginnings, endings,
always-join, and always-hyphenate rule lists accumulated across books. The app
has only a raw textarea in Settings. There is no mismatched-dash detection report,
no way to discover new rules from the current book's text, and no cross-book
rule library.

## Goal
A structured hyphen-join workbench that:
(1) shows which cross-line hyphens were joined/left in the current book's OCR text,
(2) lets the user confirm/deny individual joins to build the rule library,
(3) surfaces a mismatched-dash detection report.

## Step-by-Step Flow
1. After `text_post_process` stage completes for all pages, the workbench runs
   a hyphen analysis pass: extract all cross-line hyphen cases from the OCR text.
2. "Hyphen Report" panel in Settings tab of ProjectConfigurePage shows:
   - Auto-joined count (applied from rule library)
   - Undecided count (no matching rule; shown as review list)
   - Mismatched dash count (e.g., "arding-ly" appears both joined and un-joined)
3. User reviews undecided cases one at a time:
   - Shows: "end-\norsham" → proposed join: "endorsham" | keep hyphen: "end-orsham"
   - Buttons: "Always join" (adds to library) / "Always keep hyphen" / "Skip" / "This book only"
4. Mismatched dash report shows pairs: "bosham (×3)" alongside "bos-ham (×1)" → resolve.
5. On resolve, `text_post_process` re-runs on affected pages.

## Happy Path Mockup Spec

### Hyphen Report Panel (Settings tab, ProjectConfigurePage)
Collapsible Accordion section: "Hyphen Join Report".
Header row: three StatTiles — "42 auto-joined | 7 undecided | 3 mismatched"
Expand: two sub-sections.

**Undecided hyphens list:**
Each row:
  Left: context snippet — "…Sussex _end-\norsham_ road…" (word in question highlighted, line break shown as ↵)
  Center: proposed join highlighted in green ("endorsham") OR original hyphen in amber ("end-orsham")
  Right: three buttons: "Always join ✓" (green) | "Keep ✗" (red) | "This book only ↗" (ghost)
"Apply all 'Always join'" batch button at bottom.

**Mismatched dash report:**
Two-column table: "Joined form" vs "Hyphenated form" vs "Count each".
Click either form → links to a TextReviewPage search for that word.

### Shared Rule Library (Settings page)
Replace scannos textarea with a tabbed panel:
- Tab "Scannos": table of find/replace pairs (add/delete rows, import/export CSV)
- Tab "Hyphen rules": four sub-lists (beginnings / endings / always-join / always-hyphenate),
  each as a tag-input component. Import from JSON. Export as JSON.

## Open Design Questions
- Should the rule library be workspace-global (across all books) or per-installation?
- Should new rules auto-trigger a re-run of `text_post_process` on the current book?
```

- [ ] **Step 3: Write `WF-06-regex-workbench.md`**

```markdown
# Workflow: Per-Book Regex Workbench

**Priority:** P2
**Affects:** Settings tab of `03-project-configure.md` (replaces raw textarea)
**Audience:** Content provider during text post-processing

## Problem
The notebook had ad-hoc regex cells (step 11) for book-specific text fixes. The
app has a "book-specific scannos" textarea in the settings tab, but no way to:
- Preview what a regex will match before applying it
- Apply multiple passes in sequence
- See a diff of what changed after applying

## Goal
A structured regex workbench for book-specific post-processing: write a regex,
preview matches across all pages' OCR text, apply it, see a diff.

## Step-by-Step Flow
1. User opens the "Regex" section in the Configure Settings tab.
2. Two text inputs: Find (regex, with `i` flag checkbox) + Replace (backreference-aware).
3. "Preview" button → scans all pages' OCR text, returns: match count + first 5 matches
   in context (snippet, with match highlighted).
4. User refines the regex until matches are correct.
5. "Apply to all pages" → runs find-replace across all text files + marks
   `text_post_process` dirty on affected pages.
6. Diff panel shows old→new for each affected page (collapsible per page).
7. User can add multiple regex passes as an ordered list; each has an enable/disable toggle.

## Happy Path Mockup Spec

### Regex Workbench Panel (in Configure Settings tab)
Header: "Text Regex Passes" + "Add pass" button.

**Pass row (each):**
Left: drag handle (reorder). Center: condensed display "s/pattern/replacement/i" (monospace).
Right: enable toggle + expand chevron.

**Expanded pass:**
- Find: text input (monospaced, full-width, `pattern` placeholder)
- Flags: checkboxes [i] case-insensitive, [m] multiline, [s] dot-all
- Replace: text input (monospaced, `$1 replacement` placeholder)
- Preview button → shows match count badge + first 5 snippets in a scrollable list
  (each snippet: "…context [MATCH] context…" with match in amber bg)
- Apply button → runs replacement + shows diff

**Diff panel (after apply):**
Collapsible list of affected pages (prefix label). Expand each → line diff:
removed lines in red bg, added lines in green bg (same styling as TextReviewPage LineDiffView).

## Open Design Questions
- Should "preview" run server-side or client-side (client-side is faster but
  requires shipping all OCR text to browser)?
```

- [ ] **Step 4: Write `WF-07-project-comments.md`**

```markdown
# Workflow: PGDP Project Comments Generator

**Priority:** P3
**Affects:** New "Submission" section in Pipeline tab after build_package
**Audience:** Content provider / project manager

## Problem
PGDP requires project managers to write project comments that explicitly describe
any non-standard formatting: plate pages, illustrations, split pages, poetry,
sidenotes, headers, small caps, blackletter. Writing these from scratch is
time-consuming and easy to forget.

## Goal
Auto-generate a draft project comments block from the book's configuration
(page type counts, illustration regions, special page handling) that the
user can copy into PGDP's project creation form.

## Step-by-Step Flow
1. After build_package, "PGDP Submission" card appears in Pipeline tab.
2. Card has two sub-panels: Package section (download link) + Project Comments section.
3. Project Comments section: "Generate draft" button.
4. On click: backend inspects the project config:
   - Count plate pages, blank pages, illustration pages
   - Detect special alignments (poetry-aligned pages)
   - Detect split pages (index columns, multi-column)
   - Detect any custom scannos applied
5. Returns a structured draft in PGDP project comment format.
6. Draft shown in editable textarea. User edits inline.
7. "Copy" button copies to clipboard.

## Happy Path Mockup Spec

### Project Comments Card
Card header: "PGDP Project Comments" + "Generate draft" button (secondary).
After generate: textarea (10 rows) pre-filled with draft like:

  This project has 6 plate pages (b suffix: blank backs; p suffix: full-page
  illustrations). Plate pages should be left blank.

  Pages 93-94 are a full-width map; the image is included as i_p088_01.jpg.

  [etc.]

Below textarea: character count + "Copy to clipboard" button.

## Open Design Questions
- Should the generator use Claude API to produce more natural prose?
- Should the comments follow a PGDP standard template format?
```

- [ ] **Step 5: Write `WF-08-illustration-format.md`**

```markdown
# Workflow: Illustration Format & Size Controls

**Priority:** P2
**Affects:** `04-page-workbench.md` StageControlsPanel for extract_illustrations stage
**Audience:** Content provider

## Problem
PGDP has specific requirements per illustration type:
- Line art / maps: PNG preferred
- Photographs / halftones: JPG required
- Inline illustrations: ≤ 256 KB, max 5000×5000 px
- Linked illustrations: ≤ 1 MB, max 5000×5000 px
The app exports illustrations at native source resolution with no format enforcement.

## Goal
Let the user specify format (PNG/JPG), quality (for JPG), and size constraints
per illustration region; show estimated output size before running the stage.

## Step-by-Step Flow
1. User selects `extract_illustrations` stage in the StageChainRail.
2. StageControlsPanel shows the illustration region list for this page.
3. Each region shows: bbox coords, auto-detected category, format/quality controls.
4. User sets format (PNG / JPG) and JPG quality (0–100) per region.
5. Estimated output file size shown (calculated from bbox dimensions + format).
6. Warning badge if estimated size exceeds PGDP limits.
7. User clicks "Apply & Run" → stage runs with the new settings.

## Happy Path Mockup Spec

### StageControlsPanel — extract_illustrations stage
Header: "Illustration Regions" + "Add region manually" button.

Each region row (Accordion):
  Header: "Region 1 — p045 area (320×480px)" + category badge ("illustration") + expand ▾

  Expanded:
  - Format: Select [PNG | JPG]
  - Quality (JPG only): slider 60–100, number input
  - Type: Select [Inline (≤256 KB) | Linked (≤1 MB) | Cover (≥1600×2560)]
  - Estimated size: "~84 KB" (green) or "~312 KB ⚠ exceeds inline limit" (amber)
  - Output preview: small thumbnail of the cropped region

Footer: "Apply & Run extract_illustrations" primary button

## Open Design Questions
- Should format auto-default based on auto-detected category (photo→JPG, line art→PNG)?
- Should the "type" (inline/linked) affect how the file is named in the output zip?
```

- [ ] **Step 6: Write `WF-11-gegl-grayscale.md`**

```markdown
# Workflow: Perceptual Grayscale Stage Controls

**Priority:** P1 (quality regression from notebook)
**Affects:** `04-page-workbench.md` StageControlsPanel for grayscale stage
**Audience:** Content provider processing color scans

## Problem
The notebook used GEGL C2G (color-to-grayscale) — a perceptual algorithm that
preserves local contrast in color images far better than luminosity-weighted
grayscale for historical books with age-stained, yellowed, or multi-toned pages.
The current app uses standard grayscale. This is a quality regression that affects
thresholding quality downstream.

## Goal
Add a grayscale mode selector to the grayscale stage controls, offering:
- Standard (luminosity-weighted) — current behavior, fast
- Perceptual (GEGL C2G equivalent from pdomain-book-tools) — better on color scans, slower

## Happy Path Mockup Spec

### StageControlsPanel — grayscale stage
"Grayscale mode" Select:
  - Standard (fast) — default for B&W source scans
  - Perceptual (slower, better for color/tinted scans)

When Perceptual selected: amber info callout:
  "ℹ Perceptual grayscale takes ~10–30s per page. Recommended for color or
  yellowed/tinted source scans."

Thumbnail in chip rail updates after re-run to show the difference.

## Open Design Questions
- Is GEGL available as a subprocess call, or does pdomain-book-tools provide a
  pure-Python equivalent? (Determines whether this is a STAGE_IMPL addition
  or a subprocess wrapper.)
- Should perceptual mode be auto-selected when the source image is detected
  as color (not already grayscale)?
```

- [ ] **Step 7: Write `WF-12-settings-enhancements.md`**

```markdown
# Workflow: Settings Page Enhancements

**Priority:** P2
**Affects:** `08-settings.md` (complete redesign of scannos + hyphenation sections)
**Audience:** Content provider

## Problem
The Settings page has raw textareas for scannos (tab-delimited find/replace) and
hyphenation (word list). These are error-prone to edit and don't support:
- Bulk import/export (e.g., from the notebook's JSON files)
- Per-entry enable/disable without deleting
- Testing a scanno against sample text before saving
- Organizing by language or category

## Goal
Replace raw textareas with structured, manageable rule library panels.

## Happy Path Mockup Spec

### Scannos Library (in Settings)
Tabbed panel header: "Scannos" tab | "Hyphen Rules" tab (see WF-05)

Scannos tab:
- Filter bar: search input + "Language" Select + "Category" Select
- Rule table (sortable):
  | Find (regex) | Replace | Category | Lang | Enabled | Actions |
  | "1n" | "in" | OCR errors | All | ✓ | edit | delete |
- "Add rule" button → inline form row
- "Import JSON / CSV" button → file picker → preview + confirm
- "Export" button → downloads as JSON or CSV

Each rule row editable inline (click to edit Find/Replace fields).
Enable/disable toggle per row (preserves rule without deleting).

## Open Design Questions
- Should the global scanno library be separate from per-book scannos?
  (Global = installed once; per-book = book-specific overrides in ProjectConfig)
- Should there be a "test rule" button that applies a scanno to a pasted text sample?
```

- [ ] **Step 8: Commit**

```bash
git -C /workspaces/ocr-container/pdomain-prep-for-pgdp add docs/design-brief/workflows/
git -C /workspaces/ocr-container/pdomain-prep-for-pgdp commit -m "docs(design): workflow specs WF-04 through WF-12"
```

---

## Task 7: Master Index for Claude Design

**Files:**
- Create: `docs/design-brief/index.md`

- [ ] **Step 1: Write `index.md`**

```markdown
# pdomain-prep-for-pgdp — Design Brief for Claude Design

**App:** pdomain-prep-for-pgdp — converts scanned book images into PGDP submission packages.
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
```

- [ ] **Step 2: Commit**

```bash
git -C /workspaces/ocr-container/pdomain-prep-for-pgdp add docs/design-brief/index.md
git -C /workspaces/ocr-container/pdomain-prep-for-pgdp commit -m "docs(design): master index.md — design brief root for Claude Design"
```

---

## Task 8: Run Screenshots (requires running app)

**Files:**
- Populate: `docs/design-brief/existing-ui/screenshots/`

- [ ] **Step 1: Start the app**

```bash
cd /workspaces/ocr-container/pdomain-prep-for-pgdp && make run-cpu
# Wait for "Uvicorn running on http://127.0.0.1:8765" in output
```

- [ ] **Step 2: Run the screenshot script**

```bash
cd /workspaces/ocr-container/pdomain-prep-for-pgdp && \
  uv run --group e2e python scripts/capture-screenshots.py
```

Expected output:
```
Capturing existing UI screens...
  ✓ 00-project-list.png
  ✓ 01-new-project-modal.png
  ✓ 02-jobs-page.png
  ✓ 08-settings.png
Note: Routes /projects/:id/* require an existing project...
```

- [ ] **Step 3: Create a test project and capture workbench screenshots**

Extend `scripts/capture-screenshots.py` with a fixture-project approach:
Call `POST /api/data/projects` with a synthetic name, then navigate to that project's routes
and capture the remaining screenshots. Or manually navigate to each screen after
creating a project via the UI.

- [ ] **Step 4: Commit screenshots**

```bash
git -C /workspaces/ocr-container/pdomain-prep-for-pgdp add docs/design-brief/existing-ui/screenshots/
git -C /workspaces/ocr-container/pdomain-prep-for-pgdp commit -m "docs(design): existing UI screenshots for Claude Design brief"
```

---

## Self-Review

### Spec coverage

| Gap from analysis | Covered in workflow? |
|---|---|
| Folder upload (P0.3) | ✓ WF-01 |
| Package validation | ✓ WF-02 |
| Source quality assessment | ✓ WF-03 |
| DPI metadata in PNGs | Not required — removed from scope |
| 1-bit PNG output | ✓ WF-02 (validation check + auto-fix) |
| Illustration format/size | ✓ WF-08 |
| Page reorder | ✓ WF-09 |
| Batch crop review | ✓ WF-10 |
| GEGL perceptual grayscale | ✓ WF-11 |
| Hyphen-join workbench | ✓ WF-05 |
| Mismatched-dash detection | ✓ WF-05 |
| Manual regex workbench | ✓ WF-06 |
| PGDP metadata collection | ✓ WF-04 |
| Project comments generator | ✓ WF-07 |
| Settings library redesign | ✓ WF-12 |
| CUDA STAGE_IMPL entries | Not in scope for design brief (implementation plan) |
| Duplicate project check | Not in scope for design brief (P3, API integration) |

### Placeholder scan
None — all workflow specs have concrete layout descriptions, copy, and interaction specs.

### Type consistency
All workflow docs reference existing component names from the frontend inventory
(StageControlsPanel, StageChainRail, ArtifactViewer, PageRow, etc.) consistently.
