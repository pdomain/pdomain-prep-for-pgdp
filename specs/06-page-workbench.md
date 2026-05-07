# Spec 06 — Page Workbench

## Concept

The **PageWorkbench** is the primary per-page editing surface. It replaces the
notebook's pattern of "edit variables, re-run step, inspect output" with an
interactive loop: change a parameter → GPU re-processes the page within ~1s →
updated image appears immediately.

The batch pipeline (spec 02) still exists, but it becomes a convenience
operation — "run the workbench headlessly for all pages" — rather than the
primary workflow. Any page that needs non-default treatment gets opened in the
workbench directly.

---

## What the Workbench Does

1. **Live GPU preview** — any config change re-processes this page on the GPU
   and updates the displayed image, with a 400 ms debounce
2. **Split editor** — draw rectangular regions on the processed image; define
   reading order; each region becomes its own PGDP output file
3. **OCR preview** — trigger OCR for this page (or any individual split) and see
   word-level results as overlays on the image
4. **Illustration regions** — draw extraction bboxes directly on the source image
   (integrates spec 05; the same `ui.interactive_image` surface with a mode toggle)
5. **Text review** — OCR text side-by-side with the image, editable

Opening the workbench for a page is always safe: it never writes to the batch
output directories unless the user explicitly clicks "Commit to project".

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

## Data Model — PageSplit

Splits live on `PageRecord.splits` (a list of `PageSplit`) — see spec 08.
There is no project-level dict of splits; per-page state lives on the page.

```python
class PageSplit(BaseModel):
    suffix: str              # appended to page prefix: "p045a", "p045b"
    reading_order: int       # 0-based; determines file sort order in output

    # Bbox in PROCESSED image coordinates.
    # "Processed" = after initial_crop + colorToGray + threshold + invert +
    #               find_edges + crop_to_content + deskew (steps 4d–4k).
    # This is the image the user sees in the workbench canvas.
    # None = extends to the image edge in that direction.
    L: int | None = None
    R: int | None = None
    T: int | None = None
    B: int | None = None

    # How to render this split as a PGDP page
    scale_to_standard_page: bool = True
    # True:  crop to this region, then rescale to standard page H/W (step 4m)
    # False: crop to this region, preserve its natural aspect ratio (useful for
    #        column headers, short sections, ornamental breaks)

    # Per-split overrides (None = inherit from page/project config)
    alignment: AlignmentOverride | None = None
    ocr_engine: Literal["doctr", "tesseract"] | None = None
```

**Reading order and suffixes** — the user assigns `reading_order` by dragging
splits in the reading-order list. The `suffix` can be:

- Auto-generated: `"a"`, `"b"`, `"c"`, … based on reading_order index
- Manually overridden for legacy notebook compatibility: `"cl"`, `"cr"`, `"ch"`

**No splits = whole page.** A page with no entry in `page_splits` outputs as
a single file, as before.

---

## UI Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│  pd-prep-for-pgdp  /  belloc-the-four-men  /  p045 (idx 49)        │
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

## Live GPU Processing

Every change to a processing parameter (threshold, crop, deskew, etc.) triggers
a re-process of the current page via the GPU pipeline (Step 4 sub-steps 4c–4o
for this one page).

```python
@debounce(0.4)
async def reprocess_current_page():
    page_state.processing = True
    ii.source = SPINNER_IMAGE   # show spinner immediately
    result_path = await run.io_bound(
        run_page_pipeline,
        idx0=page_state.idx0,
        config=current_config_overrides(),  # read from the control panel
        output_dir=workbench_temp_dir,      # separate from batch output
    )
    page_state.processed_image_path = result_path
    ii.source = result_path
    page_state.processing = False
```

`run_page_pipeline()` runs steps 4c–4o synchronously (in a thread pool) for
a single page, writes to a temp directory, and returns the path. It uses the
GPU functions from pd-book-tools where available.

**Image coord consistency:** when `source` changes to a newly processed image,
the `content` SVG stays the same. If the reprocessing changed the image
dimensions (e.g. deskew expanded the canvas), the split coordinates need
to be scaled to the new dimensions. The pipeline returns the new image dimensions,
and any stored splits are scaled proportionally:

```python
def rescale_splits(splits, old_hw, new_hw):
    sy = new_hw[0] / old_hw[0]
    sx = new_hw[1] / old_hw[1]
    for s in splits:
        if s.L: s.L = int(s.L * sx)
        if s.R: s.R = int(s.R * sx)
        if s.T: s.T = int(s.T * sy)
        if s.B: s.B = int(s.B * sy)
```

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

## "Commit to Project" Button

Until the user clicks "Commit to Project", workbench changes are local to the
temp directory (`processing/workbench_temp/p045/`). Committing does two things:

1. **Saves config changes** to `BookConfig` (writes `book_config.json`)
2. **Copies processed images** to the canonical batch output directories
   (`proofing_images_png/`, `pre_ocr_images_png/`, `ocr_images_png/`)
   — one file per split, with correctly named prefixes

This avoids accidentally overwriting batch-processed output that the user hasn't
reviewed.

Navigating away without committing shows a "Unsaved changes — commit or discard?"
dialog.

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

## Integration with Batch Pipeline

When the batch pipeline (spec 02 step 4p) processes a page that has entries in
`page.splits`, it applies each split as follows:

```python
for split in sorted(page.splits, key=lambda s: s.reading_order):
    split_img = crop_to_rectangle(
        img_processed,                  # intermediate after deskew (step 4k output)
        minX=split.L or 0,
        maxX=split.R if split.R is not None else img_w,
        minY=split.T or 0,
        maxY=split.B if split.B is not None else img_h,
    )
    if split.scale_to_standard_page:
        split_img = rescale_image(split_img)
        split_img = map_content_onto_scaled_canvas(
            split_img,
            force_align=split.alignment or cfg.alignment,
            height_width_ratio=cfg.page_h_w_ratio,
        )

    full_prefix = f"{page.prefix}{split.suffix}"
    write_png(split_img, proofing_images_png / f"{stem}_{full_prefix}.png")
```

`PageRecord.splits` supersedes the notebook's `split_page_sections` entirely.

---

## Amendment to App Architecture (spec 00)

The overall flow becomes:

```
[Ingest + Thumbnails]
         │
         ▼
[Configure / Tag pages]  →  [PageWorkbench for any page, anytime]
         │                           ↑
         ▼                    (click any thumbnail)
[Batch pipeline: run all pages]
         │
         ▼
[Inspect + Package]
```

The PageWorkbench is available from any point. The batch pipeline is a
"run everything at full quality" convenience, not the only path.

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
