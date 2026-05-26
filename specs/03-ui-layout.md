# Spec 03 — Frontend UI Layout

## Framework

React 19 + Vite, TypeScript throughout. Component library: shadcn/ui (Radix
primitives + Tailwind). Canvas: react-konva. Routing: React Router v7 with
file-based routes. State: Zustand for UI state, TanStack Query for server state.

---

## Route Structure

```
/                           → redirect to /projects
/projects                   → ProjectListPage
/projects/new               → NewProjectPage (wizard)
/projects/:id               → ProjectLayout (shell with nav)
  /projects/:id/configure   → ConfigurePage (tagger + book settings)
  /projects/:id/pipeline    → PipelinePage (batch steps)
  /projects/:id/page/:idx   → PageWorkbenchPage (per-page editor)
  /projects/:id/package     → PackagePage (download)
/settings                   → SettingsPage (SystemDefaults — global, not per-project)
```

The Settings page exists outside the project hierarchy because system defaults
apply to every project. In hosted/multi-user mode the JWT identity scopes
which row of `SystemDefaults` is loaded.

React Router loaders fetch project + page data before rendering; suspense
boundaries show skeletons during load.

---

## App Shell

```
┌──────────────────────────────────────────────────────────────────┐
│  pdomain-prep-for-pgdp  /  belloc-the-four-men    [🔔 3]  [Settings ⚙] │
│  ──────────────────────────────────────────────────────────────  │
│  [Configure]  [Pipeline]  [Package]         current: Configure  │
└──────────────────────────────────────────────────────────────────┘
```

Three top-level nav items inside a project. The gear in the upper-right opens
the global SettingsPage (system defaults, OCR engine choice, scanno list,
hyphenation list — the things you tune once and forget).

The **Open Tasks bell** (🔔) shows a numeric badge for outstanding human-input
items (currently: pages awaiting `text_review` attestation, per
[`docs/specs/pipeline-task-model.md`](../docs/specs/pipeline-task-model.md)
Q7). Clicking it opens a dropdown listing each item with click-through to
the relevant page. Hidden when the badge is zero.

The Page Workbench is not a nav item — it opens over the current view as a
full-page route change, with a back-link.

When a project has any `awaiting_review` job, a **persistent banner** appears
under the nav bar on every project route: "N pages awaiting review before
package can build" with a primary "Review next page" button that navigates
to the next unreviewed page in the workbench.

---

## ProjectListPage  (`/projects`)

```
┌────────────────────────────────────────────────┐
│  Your Projects                  [+ New Project]│
│                                                │
│  ┌─────────────────────────────────────────┐  │
│  │ belloc-the-four-men                     │  │
│  │ Configure · 386 pages                   │  │
│  │ ████████░░░░  60%    [Open]  [Delete]   │  │
│  ├─────────────────────────────────────────┤  │
│  │ twain-huck-finn                         │  │
│  │ Pipeline  · 320 pages                   │  │
│  │ ██████████░░  80%    [Open]             │  │
│  └─────────────────────────────────────────┘  │
└────────────────────────────────────────────────┘
```

Progress = steps complete / total steps (weighted by step complexity).

---

## NewProjectPage  (`/projects/new`)

Two-step wizard rendered as a `<Dialog>` over the project list.

### Step 1 — Book details + source

```
Book name  ___________________________

Source
  ( ) Upload zip file  [ Choose file… ]
  (•) S3 path          s3://bucket/path/to/source/
  ( ) Local path       /home/user/…  (dev only)

Projects S3 prefix   s3://my-bucket/projects/

              [Cancel]   [Create →]
```

### Step 2 — Ingest progress

(auto-starts; job polling via TanStack Query)

```
Extracting source images        ████████████░░  85%
Generating thumbnails           ████░░░░░░░░░░  32%

                                         [Cancel]
```
Navigates to `/projects/:id/configure` on completion.

---

## ConfigurePage  (`/projects/:id/configure`)

### Layout

```
┌─ Book Settings ──────────────────────────────────────────────────┐
│  (collapsed accordion — click to expand)                         │
└──────────────────────────────────────────────────────────────────┘
┌─ Page Tagger ────────────────────────────────────────────────────┐
│  Filter: [All ▼]   [Show split parents ☐]                        │
│         [Auto-detect blanks]  [Auto-detect plates]               │
│  Select: [All] [None]  Tag: [BLANK][PLATE-B][PLATE-P][TOP][…]   │
│                                                                  │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌────────┐ ┌────────┐ ┌──────┐     │
│  │f001  │ │f002  │ │f003  │ │p011-1  │ │p011-2  │ │p012  │  …  │
│  │[img] │ │[img] │ │[img] │ │[child] │ │[child] │ │[img] │     │
│  └──────┘ └──────┘ └──────┘ └────────┘ └────────┘ └──────┘     │
│                                                                  │
│  (click any thumbnail → /projects/:id/page/:page_id)             │
└──────────────────────────────────────────────────────────────────┘
```

Split-child pages appear inline with auto-suffixed indices
(`p011-1`, `p011-2`, …) following their parent in the source-order
sequence. The parent is hidden by default; the "Show split parents"
toggle reveals it.

#### Book Settings accordion sections

The accordion is intentionally small. Most state that the notebook kept here
has moved onto individual pages (page tagger / PageWorkbench) or onto
SystemDefaults (Settings page).

| Section | Fields |
|---|---|
| Identity | book_name, source_uri |
| Page ranges | proof_start/end, cover, title, frontmatter, bodymatter, page number starts |
| Crops applied to all pages | initial_crop_all (L/R/T/B), ocr_crop_top/bottom/left/right |
| Book-specific text fixes | custom_scannos textarea, custom_regex_passes editor |
| Default overrides (advanced) | sparse override map for any SystemDefaults field, e.g. `page_h_w_ratio` for this book only |

Everything else — `text_threshold`, `default_fuzzy_pct`, `default_pixel_count_*`,
the standard scanno list, hyphenation join list, default OCR engine and model,
DPI — lives in the global SettingsPage as `SystemDefaults`.

Per-page knobs (alignment, page type, threshold override, crop override,
deskew override, morph, rotated standard, single-dimension rescale, OCR-bbox
edge finding) are all on the page tagger and PageWorkbench, not here.

#### Page Tagger Grid

Each cell is a `<button>` wrapping a thumbnail `<img>` and badge strip.

**Cell states** (visual border colour):

- Default (grey border): no overrides
- Blank (white / dashed): `page.page_type === "blank"`
- Plate (blue): `page.page_type` is `plate_b`/`plate_p`/`plate_r`
- Override dot (orange): any field of `page.config_overrides` is non-null
- Splits (purple bar): `page.splits` non-empty
- Suggestion (yellow + ✦): auto-detect candidate pending confirmation
- Error (red): last processing failed

**Multi-select**: Shift+click range, Ctrl+click individual. Selected cells get a
checkmark overlay. Toolbar tag buttons apply to all selected.

**Thumbnail click**: navigates to PageWorkbench for that page (`push` to history
so Back returns to ConfigurePage with scroll position restored via `sessionStorage`).

---

## PipelinePage  (`/projects/:id/pipeline`)

```
┌──────────────────────────────────────────────────────────────────┐
│  Batch Pipeline                                                  │
│                                                                  │
│  ┌── Step 4: Proofing Images ──────────────────────────────┐    │
│  │  ✓ Complete · 386 pages · 0 errors                      │    │
│  │  GPU: local CUDA  ·  Completed 2026-05-01 14:22          │    │
│  │  [Re-run all ▾]  [Re-run selected…]                     │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ┌── Step 6: OCR Crop ─────────────────────────────────────┐    │
│  │  ◌ Pending                                               │    │
│  │  Requires: Step 4 complete                               │    │
│  │  [Run →]                                                │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  … (steps 7, 8 similarly)                                        │
│                                                                  │
│  ── Active job ────────────────────────────────────────────      │
│  Step 7: OCR · p234/386  ██████████░░░░  64%                    │
│  [View log]  [Cancel]                                            │
└──────────────────────────────────────────────────────────────────┘
```

Active job progress comes from SSE: `GET /api/gpu/jobs/:id/events` — each event
is a JSON line `{page, total, message}`. TanStack Query `useQuery` polls
`/api/gpu/jobs/:id` as a fallback if SSE disconnects.

---

## PageWorkbenchPage  (`/projects/:id/page/:page_id`)

This is the most complex view. See spec 06 for the full interaction design.
The React implementation maps as follows.

### Component Tree

```
<PageWorkbench>
  <WorkbenchHeader />              ← nav arrows, "Mark reviewed", "Reverse split", back link
  <div class="workbench-layout">
    <StageChainRail />             ← 22 stage chips with status pills + per-row run buttons
    <ArtifactViewerPane />         ← side-by-side compare of selected stage + chosen upstream
    <StageControlsPanel />         ← config fields filtered to the selected stage
    <CanvasPanel>                  ← used for split-creation and illustration-region drawing
      <ModeBar />                  ← View / Draw Split / Draw Illustration
      <KonvaStage>
        <Layer name="image">       ← currently-selected stage's artifact
        <Layer name="splits-preview"> ← preview rectangles for split creation
        <Layer name="words">       ← OCR word boxes (optional, when stage = ocr)
        <Layer name="illustrations"> ← illustration region boxes (when stage = extract_illustrations)
        <Layer name="draw">        ← live drawing preview rectangle
      </KonvaStage>
      <ZoomControls />
    </CanvasPanel>
    <OcrPanel />                   ← OCR text editor (text_postprocess artifact view)
  </div>
</PageWorkbench>
```

The `<StageChainRail />` reads `GET /api/pages/{page_id}/stages` and listens
on the page's job SSE stream for stage transitions. The
`<ArtifactViewerPane />` reads
`GET /api/pages/{page_id}/stages/{stage_id}/artifact` for the selected
stage and a chosen upstream comparison.

For split-child pages, the header also shows a "Reverse split" button that
calls `POST /api/pages/{page_id}/unsplit`.

### Konva Stage

```typescript
// Canvas is the processed image dimensions; Konva handles scaling to container
<Stage
  width={containerWidth}
  height={containerHeight}
  scaleX={zoom}
  scaleY={zoom}
  draggable={canvasMode === 'view'}
  onMouseDown={handleMouseDown}
  onMouseMove={handleMouseMove}
  onMouseUp={handleMouseUp}
>
  <Layer>
    <KonvaImage image={imageEl} />
  </Layer>
  <Layer>
    {splits.map(split => (
      <SplitRect
        key={split.suffix}
        split={split}
        selected={selectedSuffix === split.suffix}
        color={SPLIT_COLORS[split.readingOrder % SPLIT_COLORS.length]}
        onSelect={() => setSelectedSuffix(split.suffix)}
      />
    ))}
    {drawPreview && <DrawPreviewRect rect={drawPreview} />}
  </Layer>
  <Layer listening={false}>
    {wordsVisible && ocrWords.map(w => <WordRect key={w.id} word={w} />)}
  </Layer>
</Stage>
```

The image is loaded with `useImage` (react-konva). When `processedImageUrl`
changes (new GPU result), `useImage` fetches it and Konva re-renders the image
layer without unmounting the stage — preserving zoom/pan state.

### Live Re-process

```typescript
// In ControlPanel — any config field change calls this
const reprocess = useDebouncedCallback(async () => {
  const result = await gpuApi.processPage({
    projectId, idx0,
    overrides: configOverrides,   // current control panel values
  });
  setProcessedImageUrl(result.presignedUrl);
  setProcessedImageDimensions(result.dimensions);
  rescaleSplits(result.dimensions);   // adjust stored coords if canvas changed size
}, 400);
```

---

## PackagePage  (`/projects/:id/package`)

```
┌──────────────────────────────────────────────────────────────────┐
│  Package for PGDP                                                │
│                                                                  │
│  ✓  386 text files                                               │
│  ✓  386 proofing images                                          │
│  ✓  23 illustration files                                        │
│  Estimated zip: ~42 MB                                           │
│                                                                  │
│  [Build package]                                                 │
│                                                                  │
│  belloc-the-four-men_pgdp.zip  ·  42.1 MB  ·  Ready            │
│  [⬇ Download]   [Copy S3 path]                                  │
└──────────────────────────────────────────────────────────────────┘
```

Download is a presigned S3 URL (1-hour expiry) returned by the Data API.

---

## SettingsPage (`/settings`)

A single form mapped 1:1 to `SystemDefaults` (spec 01). Reachable from the
gear in the app shell.

```
┌──────────────────────────────────────────────────────────────────┐
│  Settings                                              [Close ×]  │
│                                                                  │
│  Image processing defaults                                       │
│    text_threshold        [140]        page_h_w_ratio    [1.65]  │
│    default_fuzzy_pct     [0.02]                                  │
│    default_pixel_count_columns [150]   default_pixel_count_rows [75] │
│                                                                  │
│  OCR                                                             │
│    Default engine          [doctr ▼]                             │
│    Default DocTR model     [small_default ▼]                     │
│    Tesseract DPI           [150]                                 │
│    OCR-bbox min words      [5]                                   │
│                                                                  │
│  Text post-processing                                            │
│    Standard scanno list     [open editor… (124 entries)]         │
│    Hyphenation join list    [open editor… (842 entries)]         │
│                                                                  │
│  [ Save ]                                                        │
└──────────────────────────────────────────────────────────────────┘
```

Saved via `PUT /api/data/system/defaults`. Changes apply immediately to all
projects unless overridden by `ProjectConfig.default_overrides`.

---

## Global State (Zustand)

```typescript
interface AppStore {
  // Project
  currentProjectId: string | null;

  // Page Workbench
  workbench: {
    idx0: number;
    configOverrides: PageConfigOverrides;
    splits: PageSplit[];
    selectedSplitSuffix: string | null;
    canvasMode: 'view' | 'draw_split' | 'draw_illustration';
    drawPreview: Rect | null;
    zoom: number;
    wordsVisible: bool;
    dirty: boolean;
  };

  // Tagger selection
  tagger: {
    selectedIdxs: Set<number>;
    filterType: string;
  };
}
```

Server state (project, page records, system defaults, job status) lives
entirely in TanStack Query cache — not in Zustand.

---

## Data Fetching Patterns

```typescript
// Project data — cached, background refetch
const { data: project } = useQuery({
  queryKey: ['project', projectId],
  queryFn: () => dataApi.getProject(projectId),
  staleTime: 30_000,
});

// Page list — infinite scroll in tagger
const { data } = useInfiniteQuery({
  queryKey: ['pages', projectId],
  queryFn: ({ pageParam }) => dataApi.listPages(projectId, { cursor: pageParam }),
  getNextPageParam: (last) => last.nextCursor,
});

// GPU job — poll until terminal state
const { data: job } = useQuery({
  queryKey: ['job', jobId],
  queryFn: () => gpuApi.getJob(jobId),
  enabled: !!jobId,
  refetchInterval: (data) =>
    data?.status === 'running' ? 2000 : false,
});
```

---

## Component Library Notes

**shadcn/ui** provides: Button, Dialog, Drawer, Accordion, Badge, Select,
Slider, Tabs, Toast, Tooltip. Install only what's used (components are copied
into `src/components/ui/`, not an npm dependency).

**react-konva** version must be aligned with React 19. Use `react-konva@19` or
the `konva` package directly with a thin wrapper if the binding lags.

**TanStack Query** v5: `useQuery`, `useMutation`, `useInfiniteQuery`. Configure
a global `QueryClient` with `defaultOptions.queries.staleTime = 10_000`.

---

## Env Config Injection

The frontend bundle ships inside the Python wheel. At startup the FastAPI
process generates `/env.js` based on runtime env vars:

```html
<script src="/env.js"></script>
```
```javascript
// env.js — generated per-process
window.__ENV__ = {
  API_BASE_URL: "",                // empty = same origin (the FastAPI process)
  CDN_BASE_URL: "/cdn",            // local mode; or https://cdn.example.com for managed
  GPU_BACKEND: "modal",            // shown in the UI for status awareness
  AUTH_MODE: "none",               // "none" | "apikey" | "jwt"
  DISPATCH_INTERVAL_SECONDS: 300,  // 0 = immediate; non-zero shows scheduling info
};
```

Same static build works for local, self-hosted, and managed because
`API_BASE_URL=""` resolves all calls against the same origin and the
deployment-specific bits come from runtime env. The Vite build uses
`import.meta.env.VITE_*` only for build-time constants (feature flags,
app version).
