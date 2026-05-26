# Spec 06 — Page Workbench

## Concept

The **PageWorkbench** is the primary per-page editing surface for the
per-page stage DAG (canonical spec
[`docs/specs/pipeline-task-model.md`](../docs/specs/pipeline-task-model.md)).
It replaces the notebook's pattern of "edit variables, re-run step,
inspect output" with an interactive loop: select a stage, change its
parameters, click "Run from here" → the chosen stage and its DAG-
downstream stages re-execute → the artifact viewer updates.

Project-level fan-out (`POST /api/projects/{id}/run-dirty`,
`POST /api/projects/{id}/stages/{stage_id}/run-all`) still exists but
becomes a convenience operation — "run the workbench headlessly for
all pages" — rather than the primary workflow. Any page that needs
non-default treatment gets opened in the workbench directly.

---

## What the Workbench Does

1. **Stage chain rail** — every per-page stage shows its current
   status (`clean`, `dirty`, `failed`, `not-run`, `not-applicable`)
   with per-row run buttons (`▶ Run this`, `▶ Run from here`).
2. **Per-stage artifact viewer** — selecting a stage in the rail
   loads its on-disk artifact in a side-by-side compare with the
   chosen upstream stage's artifact.
3. **Per-stage controls** — the controls panel filters
   `ResolvedPageConfig` fields to only those the selected stage reads,
   then "Apply + Run this stage" / "Apply + Run from here" PATCHes
   the page config and fires the appropriate run.
4. **Split-as-sibling-pages editor** — "Create split" enters
   bbox-drawing mode against the current selected stage's artifact;
   on commit, `POST /api/pages/{page_id}/split` creates N child pages
   (each with its own DAG state). Children appear in the page list with
   auto-suffixed indices (`f042-1`, `f042-2`); the parent is hidden by
   default. "Reverse split" lives on each child's header.
5. **Illustration regions** — draw extraction bboxes directly on the
   source image (integrates spec 05). `extract_illustrations` is the
   stage; the existing illustration panel is its viewer.
6. **Text review (gate stage)** — OCR text side-by-side with the
   image, editable. The "Mark page reviewed" button transitions
   `text_review` from `dirty` to `clean`. Re-running upstream stages
   flips it back to `dirty`.

Opening the workbench for a page is always safe: it reads on-disk
artifacts but does not run the pipeline. Stage runs only happen when
the user explicitly clicks a run button.

---

## Where It Lives in the App

The workbench is a route: `/project/{id}/page/{idx0}`

It is entered from:

- Any thumbnail in the `PageTaggerGrid` (click thumbnail)
- Any page card in `InspectView` (click thumbnail)
- Navigation arrows in `TextReviewView`
- From the batch pipeline error list (click on an errored page)

The tab bar from `ProjectView` is still visible at the top, so the user can
return to the batch pipeline or other views without losing context.

---

## Data Model — splits as sibling pages

Splits are **first-class sibling pages**, not config on the parent
(canonical spec Q6 lock). When the user splits a page, the framework
creates N new `Page` rows whose `parent_page_id` references the
parent. Each child runs the full per-page DAG independently with its
own `page_stages` row set.

Per spec 08, the `Page` model carries the split fields:

```python
class Page(BaseModel):
    id: str                        # opaque; encodes parent chain for split children
    project_id: str
    idx0: int                      # 0-based source-file index (root pages); inherited from parent for children
    prefix: str                    # f001 / p045 / p045a (with split suffix appended for children)
    source_stem: str

    # Split-related (NULL on root pages)
    parent_page_id: str | None = None
    source_crop_bbox: tuple[int, int, int, int] | None = None  # (x, y, w, h) on the parent's source image
    split_index: int | None = None                              # 1-based, sibling order
    split_at_stage: str | None = None                           # the parent stage at which the split was created
    reading_order: int | None = None
    split_suffix: str | None = None

    # ... other PageRecord fields (page_type, alignment, config_overrides, ...)
```

**Reading order and suffixes.** The user assigns `reading_order` and
`split_suffix` at split-creation time. The suffix is appended to the
parent's prefix (`p045` parent + suffix `a` ⇒ child prefix `p045a`).
Recursive splits compose suffixes left-to-right (`p045ab` for a
grandchild whose parent's suffix was `a` and whose own suffix is `b`).

**No splits = whole page.** A root page with no children outputs as a
single file — the existing single-page behavior.

**Split workflow in the UI:**

1. User opens a parent page in the workbench, navigates to a stage
   whose artifact is an image (typically `auto_detect_attrs` /
   `auto_deskew`).
2. Clicks "Create split"; enters bbox-drawing mode.
3. Draws N rectangles on the artifact, assigns suffix + reading order.
4. Clicks "Commit splits"; the workbench POSTs to
   `/api/pages/{page_id}/split` with `{children: [...], split_at_stage}`.
5. The backend creates the children, hides the parent in the page
   list (default), and the workbench navigates to the first child.

**Reverse split:** on any child page header, "Reverse split" deletes
all sibling children of this page and restores the parent to visible.
The parent's stage state is unaffected.

The user can run different parameters on each child — for example, a
two-column page where the left column needs `auto_deskew` to run and
the right column doesn't. The previous "splits = config on `ocr_crop`"
model could not express this.

---

## UI Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│  pdomain-prep-for-pgdp  /  belloc-the-four-men  /  p045 (idx 49)        │
│  [◄ p044]  [p045]  [p046 ►]          [Commit to project]  [Close ×]│
│                                                                      │
│  ┌── Controls ─────────┐  ┌── Canvas ──────────────────────────┐   │
│  │                     │  │                                     │   │
│  │  View mode:         │  │   [ui.interactive_image]            │   │
│  │  (•)Processed       │  │                                     │   │
│  │  ( )Source          │  │   SVG overlays:                     │   │
│  │  ( )Side-by-side    │  │   • split regions (coloured rects)  │   │
│  │                     │  │   • OCR word boxes (if loaded)      │   │
│  │  Canvas mode:       │  │   • illustration regions (if mode)  │   │
│  │  [View ▼]           │  │   • drawing preview (while drawing) │   │
│  │  View               │  │                                     │   │
│  │  Draw split         │  │   Zoom: [ – ]  50%  [ + ]          │   │
│  │  Draw illustration  │  └────────────────────────────────────┘   │
│  │                     │                                            │
│  │  ─ Processing ────  │  ┌── Splits ──────────────────────────┐   │
│  │  Threshold: [Otsu]  │  │  Reading order  (drag to reorder)  │   │
│  │  Initial crop:      │  │  ┌─────────────────────────────┐   │   │
│  │  L[0]R[0]T[0]B[0]  │  │  │ 1. [a] T:0   B:900  full W │●│   │   │
│  │  Skip deskew: [ ]  │  │  │ 2. [b] T:900 B:1800 L:0 R:½ │●│   │   │
│  │  Deskew angle: [–] │  │  │ 3. [c] T:900 B:1800 L:½ R:W │●│   │   │
│  │  Fuzzy pct: [0.02] │  │  └─────────────────────────────┘   │   │
│  │  Px cols:   [100]  │  │  [+ Add split]  [Auto-detect cols]  │   │
│  │  Px rows:   [50]   │  │  [Clear all splits]                 │   │
│  │  Morph fill: [ ]   │  └────────────────────────────────────┘   │
│  │                     │                                            │
│  │  [▶ Re-process]     │  ┌── OCR / Text ──────────────────────┐   │
│  │  ● processing…      │  │  [Run OCR for this page]            │   │
│  │                     │  │  [Run OCR for split a only]         │   │
│  │  ─ Page type ─────  │  │                                     │   │
│  │  (•)Normal          │  │  Split a:  [editable textarea]      │   │
│  │  ( )Blank           │  │  Split b:  [editable textarea]      │   │
│  │  ( )Plate-B         │  │  Split c:  [editable textarea]      │   │
│  │  ( )Plate-P         │  └────────────────────────────────────┘   │
│  │  Alignment:         │                                            │
│  │  [Default ▼]        │                                            │
│  └─────────────────────┘                                            │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Canvas — `ui.interactive_image`

```python
ii = ui.interactive_image(
    source=processed_image_path,
    content=svg_overlay_string,
    events=["mousedown", "mousemove", "mouseup", "click"],
    cross=False,
    on_mouse=handle_mouse_event,
)
```

`image_x`, `image_y` in the mouse event are **actual image pixel coordinates**,
not display pixels. NiceGUI scales them automatically regardless of zoom level.
This means stored split coordinates are always in image space — no manual
scale conversion needed.

### SVG Overlay

The `content` parameter accepts a raw SVG string. The SVG viewport matches the
image dimensions exactly. Overlay is rebuilt and pushed via `ii.content = new_svg`
on every state change. This is non-flickering (no image reload).

SVG elements rendered:

- **Split regions**: semi-transparent coloured rectangles with suffix label
- **Selected split**: heavier border + resize handles (corner circles)
- **Drawing preview**: dashed outline updated on every `mousemove`
- **OCR words**: thin blue rectangles when word overlay is active
- **Illustration regions**: orange dashed rectangles when illustration mode active

```python
def build_svg(
    page_state: PageWorkbenchState,
    img_w: int,
    img_h: int,
) -> str:
    parts = ['<svg xmlns="http://www.w3.org/2000/svg">']

    colors = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"]

    for i, split in enumerate(sorted(page_state.splits, key=lambda s: s.reading_order)):
        L = split.L or 0
        R = split.R or img_w
        T = split.T or 0
        B = split.B or img_h
        color = colors[i % len(colors)]
        selected = split.suffix == page_state.selected_split_suffix
        stroke_w = 4 if selected else 2
        opacity = 0.25 if selected else 0.15

        parts.append(
            f'<rect x="{L}" y="{T}" width="{R-L}" height="{B-T}" '
            f'fill="{color}" fill-opacity="{opacity}" '
            f'stroke="{color}" stroke-width="{stroke_w}" stroke-dasharray="{"none" if selected else "8,4"}"/>'
        )
        parts.append(
            f'<text x="{L+8}" y="{T+28}" fill="{color}" font-size="24" font-weight="bold">'
            f'{split.suffix} [{i+1}]</text>'
        )
        if selected:
            # Resize handles at corners
            for hx, hy in [(L, T), (R, T), (L, B), (R, B)]:
                parts.append(
                    f'<circle cx="{hx}" cy="{hy}" r="10" '
                    f'fill="white" stroke="{color}" stroke-width="3"/>'
                )

    if page_state.ocr_words_visible:
        for word in page_state.ocr_words:
            bb = word.bounding_box
            parts.append(
                f'<rect x="{bb.left}" y="{bb.top}" '
                f'width="{bb.width}" height="{bb.height}" '
                f'fill="none" stroke="#3b82f6" stroke-width="1" fill-opacity="0"/>'
            )

    if page_state.draw_preview:
        x1, y1, x2, y2 = page_state.draw_preview
        L, R = min(x1, x2), max(x1, x2)
        T, B = min(y1, y2), max(y1, y2)
        parts.append(
            f'<rect x="{L}" y="{T}" width="{R-L}" height="{B-T}" '
            f'fill="none" stroke="#6366f1" stroke-width="3" stroke-dasharray="6,3"/>'
        )

    parts.append('</svg>')
    return ''.join(parts)
```

### Drawing Mode

When `canvas_mode == "draw_split"`:

```python
draw_state = {"active": False, "x1": 0, "y1": 0}

def handle_mouse_event(e: MouseEventArguments):
    if canvas_mode != "draw_split":
        return
    if e.type == "mousedown":
        draw_state["active"] = True
        draw_state["x1"] = int(e.image_x)
        draw_state["y1"] = int(e.image_y)
    elif e.type == "mousemove" and draw_state["active"]:
        page_state.draw_preview = (
            draw_state["x1"], draw_state["y1"],
            int(e.image_x), int(e.image_y)
        )
        ii.content = build_svg(page_state, img_w, img_h)
    elif e.type == "mouseup" and draw_state["active"]:
        draw_state["active"] = False
        page_state.draw_preview = None
        commit_new_split(
            draw_state["x1"], draw_state["y1"],
            int(e.image_x), int(e.image_y)
        )
```

When `canvas_mode == "view"`, mouse events select/deselect regions (click inside
a rect selects it; click outside deselects).

---

## Stage-driven re-execution

The workbench does not run a "live preview" pipeline on every parameter
change. The user explicitly chooses a stage to re-run. Two affordances:

- **Apply + Run this stage** — fires
  `POST /api/pages/{page_id}/stages/{stage_id}/run?mode=single`. Runs
  only this stage; downstream stages are marked `dirty`.
- **Apply + Run from here** — fires
  `POST /api/pages/{page_id}/stages/{stage_id}/run?mode=from`. Runs
  this stage and all downstream stages serially.

Both endpoints PATCH `page.config_overrides` first (with debounced
mutations), then dispatch the stage run. The stage rail listens on
the page's job SSE stream and updates row status live.

Because every stage's output is persisted on disk (Q3 locked), the
artifact viewer always reads from disk; it does not require a live
in-memory run. Opening a page in the workbench costs only object-
storage reads.

When a stage that produces an image (e.g. `canvas_map`) re-runs and
the output dimensions change, child split-pages whose
`source_crop_bbox` was defined against an upstream stage's coordinate
space are unaffected — the child's bbox is in the parent's
`split_at_stage` output coordinates, which only changes when the
parent re-runs *that specific stage*. When it does, the framework
marks every child's `decode_source` dirty (eager cascade) and the
user must re-run the children — no implicit bbox rescaling.

---

## Split Editor Panel

### Reading Order List

A drag-reorder list of all splits for the current page. Each row shows:

- Drag handle (⠿)
- Colour swatch matching the canvas overlay
- Suffix label (editable inline)
- Bbox summary: `T:0 B:900 full-width`
- `scale_to_standard_page` toggle icon
- Delete button

```
Reading order  (drag to reorder)
┌───────────────────────────────────────────┐
│ ⠿  ●  [a]  T:0   B:900   full-W   ⊞  🗑  │
│ ⠿  ●  [b]  T:900 B:1800  L:0  R:½  ⊞  🗑  │
│ ⠿  ●  [c]  T:900 B:1800  L:½  R:W  ⊞  🗑  │
└───────────────────────────────────────────┘
[ + Add split ]   [ Auto-detect columns ]
```

When a row is clicked, the corresponding region is highlighted on the canvas
and the coordinate fields in the detail panel update.

### Auto-detect Columns Button

Runs a column-detection heuristic on the processed image:

1. Sum pixel values along the horizontal axis → column density profile
2. Find sustained vertical "gaps" (columns of low pixel density) that run ≥60%
   of the image height → these are column gutters
3. Each gutter defines a split boundary
4. Propose splits ordered left-to-right (one split per column)

This handles the common two-column and three-column index cases without manual
bbox drawing.

### Coordinate Entry (Selected Split)

When a split is selected in the list, its exact coordinates are editable:

```
Selected: split b
  T [900_] B [1800]   (rows in processed image)
  L [  0_] R [740_]   (cols; leave blank for image edge)
  Suffix: [b_______]
  Scale to standard page: [✓]
  Alignment override:     [Default ▼]
  OCR engine override:    [Inherit  ▼]
```

---

## OCR Preview Panel

```
┌──────────────────────────────────────────────────────────┐
│ OCR / Text                    [Show word boxes ☐]        │
│                                                          │
│ [Run OCR — all splits]   [Run OCR — split a]             │
│                                                          │
│ Split a  ▾                                    [Edit]     │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ This is the OCR'd text for split a.                  │ │
│ │ Each paragraph on its own line as PGDP expects.      │ │
│ └──────────────────────────────────────────────────────┘ │
│ Split b  ▾                                    [Edit]     │
│ (collapsed)                                              │
│ Split c  ▾                                    [Edit]     │
│ (collapsed)                                              │
└──────────────────────────────────────────────────────────┘
```

**"Show word boxes"** toggles OCR word bboxes as thin blue rectangles on the
canvas. Hovering a word box shows the OCR text in a tooltip. Clicking a word
opens a small inline editor (like pd-ocr-labeler, but without bbox editing).

Word coordinates from DocTR are in the split's local coordinate space;
the workbench transforms them to the full processed-image space for display.

OCR results are cached per (split, config-hash) so navigating away and back
does not re-run OCR.

---

## View Modes

| Mode | Left panel shows | Right panel shows |
|---|---|---|
| Processed | Processed image (output of step 4 pipeline) | Splits + OCR text |
| Source | Original source image at native resolution | Illustration regions |
| Side-by-side | Source (left) + Processed (right) | Splits on processed side |

Mode toggle is at the top of the controls panel. "Source" mode is used to draw
illustration bboxes (spec 05); the illustration overlay only appears in Source mode.

---

## No "Commit to Project" — every run is a real run

The pre-2026-05-07 workbench had a separate "workbench_temp/" directory
and a "Commit to Project" button. With the per-page DAG model, every
stage run writes to the canonical per-page artifact path
(`projects/<id>/pages/<page_id>/stages/<stage_id>/output.<ext>`) and
the DB row reflects it immediately. There is no temp staging.

Why this is safer than it sounds:

- The user can always re-run any stage to recover; nothing is destructive.
- Re-runs cascade dirty propagation; any downstream stage that consumed
  an old artifact is correctly marked stale.
- The `text_review` gate prevents accidentally building a package from
  half-cooked output (the gate stage requires explicit human attestation).
- The `pgdp-prep reindex` CLI (canonical spec §Dual-write
  reconciliation) heals any DB↔disk drift if a process crashed mid-run.

---

## Navigation

**Arrow keys / header arrows** navigate prev/next page within the proof range.
Committed changes persist across navigation.

**Jump to page** field in the header accepts:

- A 0-based index: `49`
- A page prefix: `p045`
- A source filename stem: `fourmenfarrago00belluoft_0050`

---

## Workbench State (in memory, per page)

```python
@dataclass
class PageWorkbenchState:
    idx0: int
    prefix: str

    # Current processed image
    processed_image_path: Path | None = None
    processed_img_hw: tuple[int, int] | None = None

    # Source image
    source_image_path: Path | None = None
    source_img_hw: tuple[int, int] | None = None

    # Per-page config overrides (live, not yet committed)
    config_overrides: PageConfigOverrides = field(default_factory=PageConfigOverrides)

    # Splits (live copy, not yet committed)
    splits: list[PageSplit] = field(default_factory=list)

    # Canvas state
    canvas_mode: str = "view"        # "view" | "draw_split" | "draw_illustration"
    selected_split_suffix: str | None = None
    draw_preview: tuple[int,int,int,int] | None = None   # (x1,y1,x2,y2) while drawing

    # OCR
    ocr_words: list[Word] = field(default_factory=list)
    ocr_words_visible: bool = False
    ocr_text_per_split: dict[str, str] = field(default_factory=dict)

    # UI
    processing: bool = False
    dirty: bool = False              # True if uncommitted changes exist


```

The workbench reads and writes the canonical `PageConfigOverrides` defined in
spec 08 (every field nullable; `None` = inherit). It does not maintain a
parallel "live copy" structure — workbench edits are direct mutations of
`page.config_overrides` (with debounced PATCH writes through `useMutation`).
`page_type` and `alignment` live on `PageRecord` directly, not inside
`config_overrides`.

---

## Integration with the per-page DAG

When the user creates a split, the backend:

1. Persists N new child `Page` rows with `parent_page_id` set to the
   parent, and `source_crop_bbox` set from the user's drawing on the
   parent's chosen-stage artifact.
2. For each child, inserts `page_stages` rows for every stage with
   status `not-run`, except `ingest_source` which runs immediately
   (and re-runs if the parent's `split_at_stage` output changes).
3. Triggers `page.run_dirty(child_id)` (or leaves it for the user to
   click "Run dirty") so each child's full DAG executes independently.

When the parent's `split_at_stage` output changes (because the user
re-ran a stage on the parent that's upstream of where the split was
made), every child's `decode_source` is marked dirty automatically by
the framework's eager dirty cascade.

There is **no** flattening step — the whole pipeline produces one
`page_id`-keyed artifact tree per page (root or child), and
`project.build_package` walks pages in `(parent_idx0, split_index)`
order to put split siblings adjacent in the zip.

---

## Amendment to App Architecture (spec 00)

The overall flow becomes:

```
[Ingest + Thumbnails + auto_detect_*]
         │
         ▼
[PageWorkbench for any page, anytime — run / inspect any stage]
         │
         ├── [Create split → N child pages, each runs DAG independently]
         │
         └── [Project-level run-dirty / run-stage-all-pages]
                        │
                        ▼
              [text_review on every page (gate stage)]
                        │
                        ▼
              [project.build_package — gated by awaiting_review]
```

The PageWorkbench is available from any point. The project-level
fan-out is a "run everything at full quality" convenience, not the
only path.

---

## Framework Amendment (supersedes original NiceGUI design)

This spec was originally written for NiceGUI. The app is now a React SPA (see
spec 03). The design intent is unchanged; the implementation mapping is:

| Original (NiceGUI) | React implementation |
|---|---|
| `ui.interactive_image` with SVG `content=` | `react-konva` Stage with Layers |
| `on_mouse` callback with `image_x/y` | Konva `onMouseDown/Move/Up` events; coordinates in image space via `stage.getPointerPosition()` scaled by `1/zoom` |
| `ii.content = new_svg` for overlay updates | React state update → Konva Layer re-render (no flicker; only the Layer redraws) |
| `run.io_bound(run_page_pipeline)` | `useMutation` calling `POST /api/gpu/process-page`; result URL set into Konva Image node |
| `@debounce(0.4)` on config change | `useDebouncedCallback` (use-debounce package) |
| NiceGUI drag-reorder list | `dnd-kit` sortable list for reading order |
| NiceGUI `ui.textarea` | shadcn/ui `<Textarea>` with `onChange` → `PATCH /api/data/projects/:id/pages/:idx/text` |

### Coordinate Space in Konva

The Konva `Stage` is set to the processed image's natural dimensions and scaled
to fit the container with CSS `transform: scale(zoom)`. The `stage.getPointerPosition()`
returns display-space coords; divide by `zoom` to get image-space coords for
storing in `PageSplit.L/R/T/B`.

```typescript
const handleMouseDown = (e: KonvaEventObject<MouseEvent>) => {
  if (canvasMode !== 'draw_split') return;
  const pos = e.target.getStage()!.getPointerPosition()!;
  drawState.current = {
    active: true,
    x1: Math.round(pos.x / zoom),
    y1: Math.round(pos.y / zoom),
  };
};
```

Split rectangles are Konva `<Rect>` nodes with `listening={true}` and
`onClick={() => setSelectedSuffix(split.suffix)}`. Label text is a Konva
`<Text>` node in the same `<Group>`.

### Image Loading

```typescript
const [image] = useImage(processedImageUrl ?? '');
// When processedImageUrl changes (new GPU result), useImage fetches and
// updates the KonvaImage automatically. The Stage and all overlays remain
// mounted — no zoom/pan reset.
```
