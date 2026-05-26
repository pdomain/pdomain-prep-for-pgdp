# Spec 05 — Illustration & Decoration Extraction

## Purpose

Post-processors need the original-quality images of illustrations, decorative
elements, maps, and full-page plates — not the rescaled, thresholded proofing
images used for OCR. This step extracts regions from the **original source scan**
at native resolution with minimal processing, producing images that go into the
PGDP package alongside the proofing images and text files.

---

## Taxonomy of Extractable Content

| Type | Source | Example PGDP filename |
|---|---|---|
| Full-page plate | `page.page_type == "plate_p"` (auto-synthesised region) | `i_p007p.jpg` |
| Inline illustration | `page.illustration_regions[i]` | `i_p045_01.jpg` |
| Decoration / ornament | `page.illustration_regions[i].type == "decoration"` | `i_p012_01.png` |
| Multi-illustration page | Multiple entries in `page.illustration_regions` | `i_p112_01.jpg`, `i_p112_02.jpg` |
| Standalone illustration file | Pre-placed in `hi_res_jpg/` | `i_p045_01.jpg` (user-supplied) |

---

## Data Model

`IllustrationRegion` lives on `PageRecord.illustration_regions` (one list per
page) — see specs 01 and 08. There is no project-level dict of regions.

```python
class IllustrationRegion(BaseModel):
    # Position in the ORIGINAL source image (pixels, 0-indexed).
    # All None = full page (used automatically for plate_p pages).
    L: int | None = None
    R: int | None = None
    T: int | None = None
    B: int | None = None

    index: int = 1                          # illustration number on the page (1-based)
    label: str = ""                         # human label, not in filename
    type: Literal["illustration", "decoration", "plate"] = "illustration"
    output_format: Literal["jpg", "png"] = "jpg"
    jpeg_quality: int = 85

    convert_to_grayscale: bool = False
    # Future: descreen: bool = False        # halftone removal for photographic plates
```

**Plate pages** (`page.page_type == "plate_p"`) automatically get a full-page
`IllustrationRegion(L=None, R=None, T=None, B=None, type="plate")` synthesised
at extraction time. The user does not need to add them manually; they can edit
the entry if they want to crop the plate.

---

## Output Naming Convention

Follows the notebook's `hi_res_jpg/` naming convention:

| Scenario | Filename |
|---|---|
| Single illustration on page p045 | `i_p045_01.jpg` |
| Second illustration on same page | `i_p045_02.jpg` |
| Full-page plate on page p007 (prefix `p007p`) | `i_p007p.jpg` |
| Decoration on f003 | `i_f003_01.png` |

Filename construction:
```python
def illustration_filename(prefix: str, region: IllustrationRegion) -> str:
    if region.type == "plate":
        # plate_pages_p already have 'p' appended to prefix, e.g. "p007p"
        return f"i_{prefix}.{region.output_format}"
    else:
        return f"i_{prefix}_{region.index:02d}.{region.output_format}"
```

Output location: `processing/hi_res_jpg/` (same as notebook). Copied to
`for_zip/` during Step 10 — packaging step already handles this directory.

---

## Extraction Pipeline (`extract_illustrations` stage)

`extract_illustrations` is a per-page stage in the canonical DAG (see
[`docs/specs/pipeline-task-model.md`](../docs/specs/pipeline-task-model.md)
§Per-page stage DAG). It depends on `auto_detect_illustrations` (which
populates suggestions onto `PageRecord.illustration_regions`) plus any
user edits to those regions. It can be run independently from the
workbench's stage rail or fanned out via
`POST /api/projects/{id}/stages/extract_illustrations/run-all`.

**Input:** Original source image — `processing/original_as_jpg/<stem>.jpg`
(or the original source file if no JP2 conversion was needed, or any
`original_override_*` file if present).

**Output:** `processing/hi_res_jpg/i_<prefix>_<n>.<ext>`

**Processing per region:**

```python
from pdomain_book_tools.image_processing.cv2_processing import (
    read_image, crop_to_rectangle, write_jpg, write_png,
    cv2_convert_to_grayscale,
)

def extract_illustration(
    source_path: Path,
    region: IllustrationRegion,
    output_path: Path,
):
    img = read_image(source_path)          # full-resolution BGR uint8
    h, w = img.shape[:2]

    L = region.L or 0
    R = region.R or w
    T = region.T or 0
    B = region.B or h

    img_crop = crop_to_rectangle(img, minX=L, maxX=R, minY=T, maxY=B)

    if region.convert_to_grayscale:
        img_crop = cv2_convert_to_grayscale(img_crop)

    if region.output_format == "jpg":
        write_jpg(img_crop, output_path, quality=region.jpeg_quality)
    else:
        write_png(img_crop, output_path)
```

**Intentionally minimal processing:**  No rescaling, no thresholding, no deskew
(unless the region has an explicit `deskew_angle` override — deferred for now).
The goal is to preserve the source material faithfully. Post-processors and
PGDP's own tools handle further processing.

**Parallelism:** ThreadPoolExecutor, same pattern as other steps.

---

## Region Detection (Semi-Automatic Suggestions)

To help the user locate illustrations and decorations without manually entering
pixel coordinates, the UI offers a "Detect regions" button per page. PGDP
submission packages need both illustrations (figures, plates, photographs)
and decorations (ornaments, chapter headpieces, decorative rules), so the
detector returns both categories with a `type` label.

The detector is **pluggable**. Users pick a model in Settings (per-system
default) or per-page in the workbench. The pipeline ships an adapter
interface and several backends; new models can be added without touching
pipeline code.

```python
# Imported from pdomain_book_tools.layout — the detector protocol and adapters
# live in the shared library so OCR (Step 7) and illustration extraction
# (Step 4.5) consume the same PageLayout.
from pdomain_book_tools.layout import LayoutDetector, PageLayout, get_detector
```

The detector returns a :class:`PageLayout` (list of typed regions plus
image dims). Step 4.5 filters to figure / decoration / table regions for
illustration crops; Step 7 passes the same PageLayout into
``Page.reorganize_page(layout=…)`` to drive caption association and
header/footer stripping.

### Available detector backends

| Key | Approach | Model | Notes |
|---|---|---|---|
| `contour` | Pixel/contour heuristic (no model) | — | Fast, no download; weak on decorations or illustrations within text columns |
| `pp-doclayout-plus-l` | RT-DETR-L on PP-DocLayout's 20-category corpus | [`PaddlePaddle/PP-DocLayout_plus-L_safetensors`](https://huggingface.co/PaddlePaddle/PP-DocLayout_plus-L_safetensors) | ~132 MB Apache-2.0 weights, ~150–200 ms CPU / ~30 ms GPU. Includes `seal` for engraved insignia (good for 19th-century books) and a dedicated `figure_title` for caption association. |
| `none` | No suggestions; user draws every region | — | For users who don't want any auto-suggestion. |

Model files are cached in `$HF_HOME` (or `~/.cache/huggingface/`) the same way
DocTR models are. First detection on a fresh install pulls the chosen model
once; subsequent runs are local.

``transformers>=4.45`` is a **base dependency** of ``pdomain-book-tools`` — the
RT-DETR inference path is always available, no opt-in extra. All other deps
(``torch``, ``torchvision``, ``opencv-python``, ``pillow``,
``huggingface_hub``) were already required.

DocLayout-YOLO and DocLayNet-DETR are explicitly **not** in scope.
Ultralytics (the YOLO framework) is AGPL-3.0 and would contaminate the
managed-mode SaaS planned in spec 09; DocLayNet-DETR is Apache 2.0 but
covers fewer categories (11 vs 20) and is slower than RT-DETR-L on CPU.
A single well-supported model keeps the adapter surface small.

### Category mapping

PP-DocLayout_plus-L emits 20 native labels; the adapter maps them to the
:class:`pdomain_book_tools.layout.types.RegionType` enum
(``figure`` / ``decoration`` / ``caption`` / ``header`` / ``footer`` /
``text`` / ``table`` / etc.) via :data:`PP_DOCLAYOUT_TO_PGDP` in
``pdomain_book_tools/layout/_mappings.py``:

```python
# pdomain_book_tools/layout/_mappings.py
PP_DOCLAYOUT_TO_PGDP = {
    "paragraph_title":     "section",
    "doc_title":           "title",
    "text":                "text",
    "abstract":            "text",
    "image":               "figure",        # PGDP "illustration"
    "chart":               "figure",        # PGDP "illustration"
    "figure_title":        "caption",       # caption-association uses this
    "table":               "table",
    "table_title":         "caption",
    "formula":             "formula",
    "formula_number":      None,            # subsumed by adjacent formula
    "header":              "header",        # dropped before reorg
    "footer":              "footer",
    "page_number":         "footer",
    "footnote":            "footnote",
    "list_of_references":  "list",
    "reference":           "list",
    "sidebar_text":        "abandoned",     # margin notes; drop by default
    "algorithm":           "text",
    "seal":                "decoration",    # engraved insignia / chapter heads
}
```

A region whose mapped value is ``None`` is dropped. Step 4.5 filters
``RegionType.{figure, decoration, table}`` for illustration crops; Step 7
passes the full ``PageLayout`` into ``Page.reorganize_page(layout=…)`` so
captions, headers, and footers also benefit. The user can change the
mapping per-project via ``ProjectConfig.layout_category_overrides`` if
needed (e.g. flip ``sidebar_text → "text"`` for a book with running side
notes that should be kept).

The PP-DocLayout training corpus includes a sizeable "ancient books"
slice — ``seal`` and several heading/sidebar categories surface
19th-century engravings that DocLayNet's modern-paper corpus largely
misses. This is the primary reason for choosing PP-DocLayout over
DocLayNet for the PGDP use case.

### Backend implementations

All adapters live in ``pdomain_book_tools/layout/``. The module ships a
``contour`` heuristic (no model deps) and one model adapter:
``pp-doclayout-plus-l``. The full source is in
``pdomain_book_tools/layout/adapters/pp_doclayout.py`` — the relevant excerpt:

```python
# pdomain_book_tools/layout/adapters/pp_doclayout.py
from transformers import RTDetrForObjectDetection, RTDetrImageProcessor

class PPDocLayoutPlusLDetector:
    HF_REPO = "PaddlePaddle/PP-DocLayout_plus-L_safetensors"

    def __init__(self, device="cpu", confidence=0.5, checkpoint_path=None):
        repo = checkpoint_path or self.HF_REPO
        self._processor = RTDetrImageProcessor.from_pretrained(repo)
        self._model = RTDetrForObjectDetection.from_pretrained(repo).to(device)
        ...

    @torch.inference_mode()
    def detect(self, source) -> PageLayout:
        # PIL → RT-DETR processor → model → post-process; map each native
        # label to RegionType via PP_DOCLAYOUT_TO_PGDP; build a PageLayout.
        ...
```

A user-supplied fine-tuned checkpoint (HF repo or local directory) plugs in
via ``checkpoint_path``:

```bash
pd-ocr --layout-aware \
       --layout-checkpoint ~/my-finetuned-pp-doclayout/ \
       page.png
```

### Detector selection

```python
# pdomain_book_tools/layout/registry.py
def get_detector(key, device="cpu", confidence=0.5, checkpoint_path=None):
    if key == "none":              return NullDetector()
    if key == "contour":           return ContourDetector()
    if key == "pp-doclayout-plus-l":
        try:
            from .adapters.pp_doclayout import PPDocLayoutPlusLDetector
        except ImportError as e:
            raise ImportError(
                "Layout detection requires `transformers`. "
                "Install with: uv tool install 'pdomain-book-tools[layout]'"
            ) from e
        return PPDocLayoutPlusLDetector(device, confidence, checkpoint_path)
    raise ValueError(f"Unknown layout detector: {key!r}")
```

The detector is memoised by ``(key, device, confidence, checkpoint_path)``.
Switching key clears the relevant cache entry; switching the model
checkpoint at runtime (Settings page change) is therefore safe.

### API

`POST /api/gpu/suggest-illustrations` (spec 07) gains an optional `detector`
field; when omitted it uses `system_defaults.layout_detector` resolved through
`ProjectConfig.default_overrides`:

```python
class SuggestIllustrationsRequest(BaseModel):
    project_id: str
    idx0: int
    detector: str | None = None   # None = use SystemDefaults.layout_detector

class SuggestIllustrationsResponse(BaseModel):
    regions: list[IllustrationRegion]
    detector_used: str
    inference_time_ms: int
```

Results are shown as overlay boxes in the UI — solid blue border for
`illustration`, dashed orange for `decoration`, solid green for `plate`. The
user accepts, rejects, or edits each suggestion.

### Performance

Run on the **source image at native resolution** (not the processed proofing
image — illustrations are extracted from the source).

| Detector | 3000×5000 px page CPU | GPU (T4) |
|---|---|---|
| `contour` | ~50 ms | n/a |
| `pp-doclayout-plus-l` | ~150–200 ms | ~30 ms |

For batch detection across a 400-page book, ``pp-doclayout-plus-l``
finishes in ~1.5 minutes on CPU, ~15 s on GPU — within the 5-minute batch
dispatcher window in managed mode (spec 09). Interactive use in the
workbench stays well under the 200 ms perceptible threshold even on CPU.

The :class:`PageLayout` returned by each adapter records ``inference_ms``
so the workbench can show a progress / time-remaining estimate before
kicking off a whole-book detection pass.

---

## UI — IllustrationsView

New tab in the project view (between PipelineView and InspectView in the tab order).

### Layout

```
┌──────────────────────────────────────────────────────────────────┐
│ Illustrations & Decorations                    [Extract All →]   │
│                                                                  │
│ Pages with illustrations: 23 pages marked                        │
│ Plate pages (auto): 3   |   Inline: 18   |   Decorations: 5    │
│                                                                  │
│ ┌──── Page List ────┐  ┌──── Source Image Viewer ───────────────┐│
│ │ p007p  [plate]    │  │  p045  —  source at 1:4 zoom           ││
│ │ p045   [2 regions]│  │                                         ││
│ │ p112   [1 region] │  │  [scrollable, zoomable source image]    ││
│ │ p189p  [plate]    │  │                                         ││
│ │ ...               │  │  bbox1: ████████████████ [Edit][Del]   ││
│ │                   │  │  bbox2: ████████         [Edit][Del]   ││
│ │ [+ Add page]      │  │                                         ││
│ │                   │  │  [+ Draw new region]                   ││
│ │                   │  │  [Detect regions]                       ││
│ └───────────────────┘  └────────────────────────────────────────┘│
│                                                                  │
│ Region details (selected: bbox1)                                  │
│  Index: [01]  Type: [illustration ▼]  Format: [jpg ▼] Q:[85]    │
│  L:[245] R:[1840] T:[380] B:[1620]    [ Grayscale ☐ ]           │
│  Label: [Map of Sussex                             ]             │
│  [ Preview Extraction ]                                          │
│  [preview thumbnail shown if run]                                │
└──────────────────────────────────────────────────────────────────┘
```

### Detector Selector

In the Illustrations tab toolbar:

```
[ Detect regions ▼ ]   ◄ contour (no model)
                         pp-doclayout-plus-l (recommended) ✓
                         none
```

The selected value writes to `SystemDefaults.layout_detector` (Settings page)
or `ProjectConfig.default_overrides.layout_detector` (book-level override).
First use of `pp-doclayout-plus-l` triggers a one-time ~132 MB HF download.

### Bbox Drawing Interaction

NiceGUI's `ui.interactive_image` fires `on_mouse` events with image coordinates
scaled to the original image dimensions (use the `transform` parameter to pass the
display-to-source scale factor). Drawing workflow:

1. User clicks "Draw new region" — enters drawing mode
2. First click: sets `(L, T)` corner — a cross-hair appears
3. Mouse move: shows live rectangle preview
4. Second click: sets `(R, B)` corner — region is committed and added to config
5. User can drag edges of existing regions to resize (deferred: initial version
   uses numeric fields only for resizing)

For the initial implementation, numeric coordinate entry fields are sufficient;
the image viewer shows the bbox overlays but editing is done in the fields.
Live drawing mode is a stretch goal.

**Zoom controls:** "+" / "–" buttons + mouse wheel. Display at a fraction of
original size (e.g. 1:4 for a 4000px-wide source → 1000px display). The
reported mouse coordinates must be scaled back by the zoom factor before storing.

```python
# When user clicks on ui.interactive_image at display coords (dx, dy):
zoom = current_zoom_factor            # e.g. 0.25 for 1:4
src_x = int(dx / zoom)
src_y = int(dy / zoom)
```

### Coordinate Entry Panel

When a region is selected in the list, numeric fields allow precise coordinate
entry. Fields update the region in real time:

```
L: [____]  R: [____]   (horizontal extent in source pixels)
T: [____]  B: [____]   (vertical extent in source pixels)
```

"Preview Extraction" runs `extract_illustration()` for this region and shows a
thumbnail (max 400px) in the panel.

### Page List Behaviour

- Plate pages (`plate_pages_p`) appear automatically with a `[plate]` badge and
  a pre-populated full-page region. The user can adjust the region if needed.
- Clicking "+ Add page" opens a page selector showing pages NOT already listed;
  the user picks one and is immediately shown the source image viewer for that page.
- A page is removed from the list (and all its regions deleted from config) via a
  trash icon on the page list row.

---

## Integration with `project.build_package`

`project.build_package` copies `hi_res/` files into `for_zip/`. No
changes required to packaging itself — the `extract_illustrations`
stage populates `hi_res/` and packaging picks them up automatically.

The package summary in PackageView shows the illustration count:

```
• 386 text files
• 386 proofing images
• 23 illustration files   ← from hi_res/
```

---

## Cross-spec references

The DAG-related parts of this spec (where `extract_illustrations` sits
in the dependency graph, what its inputs are) are authoritatively
defined in `docs/specs/pipeline-task-model.md`. Per-stage UI and
workbench wiring is in `specs/06-page-workbench.md` and
`specs/03-ui-layout.md`. `IllustrationRegion` lives on `PageRecord` —
see `specs/01-book-config.md` and `specs/08-data-models.md`.

---

## Open Questions

1. **Descreen for photographic halftones.** Scanned photographs often have a
   halftone dot pattern that is distracting in digital editions. A descreen pass
   (Gaussian blur followed by upscale, or FFT-based notch filter) could be
   applied optionally. Deferred until there is a concrete use case. The
   `IllustrationRegion.type = "plate"` flag reserves the field for this.

2. **Multi-page illustrations.** Some large fold-out maps or illustrations span
   two physical pages. The current model handles each source image independently.
   A future `multi_page_illustration` config entry could stitch adjacent pages.
   Deferred.

3. **Whole-book detection pass.** Now that a model-based detector exists, the
   Illustrations tab can offer "Detect across all pages" to bulk-suggest regions
   for the entire book in one job. ``pp-doclayout-plus-l`` is fast enough on
   CPU (~1.5 min for a 400-page book). Pages where the detector finds nothing
   are simply skipped — no false positives.

4. **Fine-tuning a custom detector.** PGDP-specific page layouts (engraved
   chapter heads, decorative initials, marginalia) are underrepresented even
   in PP-DocLayout's training corpus. A future `pd-ocr-trainer` workflow
   could fine-tune PP-DocLayout_plus-L on labeled regions captured during
   proofing — same pattern as DocTR fine-tuning for recognition. Output is a
   standard HF checkpoint directory; users select it via
   `--layout-checkpoint` (CLI) or `ProjectConfig.layout_checkpoint`
   (workbench). Deferred until enough labeled regions exist.

5. **Coordinate space precision.** The bbox coordinates are stored in original
   source pixel space. If the user later supplies an `original_override_jpg` (a
   different scan), the coordinates may no longer be valid. The UI should warn
   when an override image has different dimensions than the original.
