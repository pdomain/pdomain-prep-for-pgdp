# Spec 02 — Pipeline Steps

Each step reads from storage, writes to storage, and records its completion
status in `pipeline_state` (part of `Project`). Steps can be re-run for all
pages or a subset of pages without re-running earlier steps.

Pipeline functions live in `core/pipeline/` (spec 09) and are called from both
the in-process FastAPI handlers and the Modal worker. Every step takes a
`ResolvedPageConfig` (spec 01) per page rather than reaching into raw config
layers.

```python
def run_step4_for_page(
    project: ProjectConfig,
    page: PageRecord,
    cfg: ResolvedPageConfig,
    storage: IStorage,
    debug: bool = False,
) -> StepResult: ...
```

The handler builds `cfg = resolve_page_config(system, project, page)` once and
passes it down. Pipeline code never sees `system`, `project`, or `page` raw.

---

## Pipeline State

```python
class StepStatus(str, Enum):
    pending  = "pending"
    running  = "running"
    complete = "complete"
    error    = "error"

class StepState(BaseModel):
    status: StepStatus = StepStatus.pending
    pages_complete: list[int] = Field(default_factory=list)
    pages_error: dict[int, str] = Field(default_factory=dict)
    started_at: datetime | None = None
    completed_at: datetime | None = None
    job_id: str | None = None

class PipelineState(BaseModel):
    steps: dict[int, StepState] = Field(default_factory=dict)
```

---

## Step 0 — Ingest

**Purpose:** Enumerate source images, extract zip if needed, validate all
files are readable, write initial `PageRecord` per source page.

**Input:** `project.source_uri` (folder, zip path, or S3 prefix)

**Output:**

- `source/` populated with extracted images
- `processing/original_thumbnail/` populated (Step 1 can run after)
- One `PageRecord` per source page written via storage adapter

```python
# If zip:
zipfile.ZipFile(source_path).extractall(storage.source_dir)

# Enumerate and sort:
source_files = sorted(storage.list_prefix("source/"))

for idx, f in enumerate(source_files):
    img = pd_book_tools.image_processing.cv2_processing.read_image(f)
    if img is None:
        # Mark page as error, continue
        ...
    page = PageRecord(
        project_id=project.id, idx0=idx,
        prefix="",                                 # filled in by Step 3
        source_stem=Path(f).stem,
        ignore=(idx < project.proof_start_idx0
                or idx > project.proof_end_idx0),
    )
    storage.put_json(f"pages/{idx}.json", page.model_dump())
```

**Errors:** unsupported file type → skip with warning. Corrupt image →
mark page as error, continue.

---

## Step 1 — Convert JP2 → JPG

**Purpose:** Internet Archive sources are JPEG2000. Convert all to high-quality
JPEG. Skip if already JPG/PNG.

**Input:** `source/*.jp2`
**Output:** `processing/original_as_jpg/*.jpg`
**Parallelism:** ThreadPoolExecutor, max_workers=8

```python
img = cv2.imread(str(source_path), cv2.IMREAD_COLOR)
cv2.imwrite(str(target_path), img, [cv2.IMWRITE_JPEG_QUALITY, 100])
```

JPGs are still produced unconditionally so thumbnails (Step 2) and override
files (Step 4a) work uniformly even when Step 4 reads JP2 directly into GPU
memory.

---

## Step 2 — Thumbnails

**Purpose:** 400 px JPGs for the visual page tagger.

**Input:** `processing/original_as_jpg/*.jpg`
**Output:** `processing/original_thumbnail/*.jpg`
**Parallelism:** ThreadPoolExecutor (CPU count)

```python
from pd_book_tools.image_processing.cv2_processing import create_file_thumbnail

create_file_thumbnail(
    source_file_path=source_path,
    target_file_path=target_path,
    jpeg_quality=85,
    max_dimension=400,
)
```

Thumbnails must exist before the page tagger UI loads.

---

## Step 3 — Configure (Interactive)

**Purpose:** User configures `ProjectConfig` (Book Settings accordion) and
per-page state (`PageRecord.page_type`, `alignment`, `config_overrides`,
`splits`, `illustration_regions`) through the visual page tagger and the
PageWorkbench.

This step is "complete" when the user clicks **Begin Pipeline** on the
Pipeline page (or the workbench is committed for every page that needs
non-default treatment).

**Saves:** `project.json`, `pages/<idx0>.json` (one per modified page).

`PageRecord.prefix` is filled in here by `compute_prefix(idx0, project, pages)`
once the proof range / frontmatter / bodymatter ranges are set.

---

## Step 4 — Proofing Image Pipeline

**Purpose:** The core image processing pipeline. Produces the final
PGDP-standard proofing image for each page.

**Input:** `processing/original_as_jpg/<stem>.jpg` (or original source)

**Output:**

- `processing/proofing_images_png/<stem>_<prefix>.png` — final proofing image
- `processing/pre_ocr_images_png/<stem>_<prefix>.png` — same image (Step 6 crops this)
- `processing/debug_png/<stem>_<prefix>_*.png` — debug intermediates (if `debug=True`)

**Parallelism:** Pages run in parallel via ThreadPoolExecutor. GPU sub-steps
serialize through the GPU executor; CPU sub-steps parallelize freely.

The handler resolves the per-page config once:

```python
cfg = resolve_page_config(system, project, page)
```

`cfg` is a flat `ResolvedPageConfig`. Every sub-step below reads from `cfg`.

### 4a. Resolve source file

Priority order (highest first):

1. `grayscale_override_png/<stem>.png`
2. `grayscale_override_jpg/<stem>.jpg`
3. `original_override_png/<stem>.png`
4. `original_override_jpg/<stem>.jpg`
5. `original_as_jpg/<stem>.jpg`
6. `source/<stem>.jp2`

Override files allow the user to supply a manually pre-processed image for
problem pages without changing pipeline parameters.

### 4b. Blank page handling

```python
if cfg.page_type in {"blank", "plate_b", "plate_r"}:
    create_blank_proof(
        proofing_image_file=proofing_image_path,
        pre_ocr_target_file=pre_ocr_path,
        h_w_ratio=cfg.page_h_w_ratio,
    )
    return
```

Sub-steps 4c–4o are skipped for blank pages.

### 4c. Load image directly to GPU

```python
import cupy as cp
from nvidia import nvimgcodec

decoder = nvimgcodec.Decoder()
nv_img  = decoder.read(str(source_path))
img_cp  = cp.asarray(nv_img)            # (H, W, 3) uint8 RGB on GPU
```

CPU fallback (no nvImageCodec):
```python
from pd_book_tools.image_processing.cv2_processing import read_image
img_cp = cp.asarray(read_image(source_path))
```

### 4d. Initial crop (GPU)

Removes scanner frame pixels from all four edges. Per-page override beats
project-wide setting:

```python
from pd_book_tools.image_processing.cupy_processing import crop_edges

crop = cfg.initial_crop or cfg.initial_crop_all
L, R, T, B = crop
img_cp = crop_edges(img_cp, top=T, bottom=B, left=L, right=R)
```

### 4e. Optional deskew before crop

For pages with a manual `deskew_before_crop` angle override (significant
border skew that would confuse edge-finding):

```python
if cfg.deskew_before_crop is not None:
    from pd_book_tools.image_processing.cupy_processing import rotate_image_gpu
    img_cp = rotate_image_gpu(img_cp, angle_deg=cfg.deskew_before_crop, cval=0)
```

### 4f. Color-to-grayscale (GPU)

```python
from pd_book_tools.image_processing.cupy_processing import cupy_colorToGray

img_gray_cp = (
    cupy_colorToGray(img_cp.astype(cp.float32) / 255.0) * 255
).clip(0, 255).astype(cp.uint8)
```

### 4g. Threshold (GPU)

```python
from pd_book_tools.image_processing.cupy_processing import (
    otsu_binary_thresh, binary_thresh_gpu,
)

if cfg.threshold_level is None:                     # Otsu auto
    img_thresh_cp = (
        otsu_binary_thresh(img_gray_cp.astype(cp.float32) / 255.0) * 255
    ).astype(cp.uint8)
else:
    img_thresh_cp = binary_thresh_gpu(img_gray_cp, level=cfg.threshold_level)
```

`text=0`, `bg=255` after this step.

### 4h. Invert (GPU)

```python
from pd_book_tools.image_processing.cupy_processing import invert_image
img_inv_cp = invert_image(img_thresh_cp)            # text=255, bg=0
```

### 4i. Find content edges (GPU)

Two modes: pixel-based (default) and OCR-bbox-based. OCR-bbox requires GPU
DocTR and falls back to pixel-based when DocTR finds fewer than
`cfg.ocr_bbox_edge_min_words` words.

```python
from pd_book_tools.image_processing.cupy_processing import find_edges_gpu
from pd_book_tools.image_processing.gpu_utils import gpu_available

use_ocr_bbox = cfg.use_ocr_bbox_edge and gpu_available()

result = None
if use_ocr_bbox:
    from pd_book_tools.image_processing.ocr_edge_finding import find_edges_from_ocr_bboxes
    result = find_edges_from_ocr_bboxes(
        img_thresh=cp.asnumpy(img_thresh_cp),
        predictor=get_doctr_predictor(cfg.ocr_model_key),
        min_words=cfg.ocr_bbox_edge_min_words,
    )

if result is not None:
    minX, maxX, minY, maxY = result
else:
    minX, maxX, minY, maxY = find_edges_gpu(
        img_cp=img_inv_cp,
        fuzzy_pct=cfg.fuzzy_pct,
        pixel_count_columns=cfg.pixel_count_columns,
        pixel_count_rows=cfg.pixel_count_rows,
    )
```

### 4j. Crop to content (GPU)

```python
from pd_book_tools.image_processing.cupy_processing import (
    crop_to_rectangle, add_whitespace_percentage_gpu,
)

img_cropped_cp = crop_to_rectangle(img_inv_cp, minX, maxX, minY, maxY)

if cfg.white_space_additional is not None:
    img_cropped_cp = add_whitespace_percentage_gpu(
        img_cropped_cp, *cfg.white_space_additional
    )
```

### 4k. Auto-deskew (GPU)

Skip when `cfg.skip_auto_deskew` is set, or for pages whose alignment is not
default, or for `single_dimension_rescale` / `rotated_standard` pages.

```python
from pd_book_tools.image_processing.cupy_processing import auto_deskew_gpu, rotate_image_gpu

if cfg.deskew_after_crop is not None:
    img_deskewed_cp = rotate_image_gpu(img_cropped_cp, angle_deg=cfg.deskew_after_crop, cval=0)
elif cfg.skip_auto_deskew or cfg.alignment != "default" \
     or cfg.single_dimension_rescale or cfg.rotated_standard:
    img_deskewed_cp = img_cropped_cp
else:
    img_deskewed_cp, _, _ = auto_deskew_gpu(img_cropped_cp, pct=0.30)
```

### 4l. Morph fill (GPU, optional)

```python
from pd_book_tools.image_processing.cupy_processing import morph_fill
if cfg.do_morph:
    img_deskewed_cp = morph_fill(img_deskewed_cp)
```

### 4m. Re-invert and rescale to standard page size

```python
from pd_book_tools.image_processing.cupy_processing import rescale_image_gpu

img_rescaled_cp = rescale_image_gpu(
    invert_image(img_deskewed_cp),                  # back to text=0, bg=255
    target_short_side=1000,
)
# Aspect-shape is applied downstream in step 4n via
# map_content_onto_scaled_canvas(..., height_width_ratio=cfg.page_h_w_ratio).
```

### 4n. Map onto standard canvas (GPU)

```python
from pd_book_tools.image_processing.cupy_processing import map_content_onto_scaled_canvas_gpu
from pd_book_tools.image_processing.cv2_processing import Alignment

alignment = {
    "default": Alignment.DEFAULT,
    "top":     Alignment.TOP,
    "center":  Alignment.CENTER,
    "bottom":  Alignment.BOTTOM,
}[cfg.alignment]

img_final_cp = map_content_onto_scaled_canvas_gpu(
    img_rescaled_cp,
    force_align=alignment,
    height_width_ratio=cfg.page_h_w_ratio,
)
```

### 4o. Transfer to CPU and write output

```python
from pd_book_tools.image_processing.cv2_processing import write_png
from pd_book_tools.image_processing.external_tools import run_optipng

img_final = cp.asnumpy(img_final_cp)
write_png(img_final, proofing_image_path)
write_png(img_final, pre_ocr_path)
run_optipng(proofing_image_path)
run_optipng(pre_ocr_path)
```

### 4p. Apply page splits

When `page.splits` is non-empty, each `PageSplit` becomes an independent
output page. Source coordinate space is the deskewed image (4k output) by
convention; the workbench draws on that same image.

```python
for split in sorted(page.splits, key=lambda s: s.reading_order):
    section_prefix = f"{page.prefix}{split.suffix}"

    L = split.L or 0
    R = split.R if split.R is not None else img_rescaled_cp.shape[1]
    T = split.T or 0
    B = split.B if split.B is not None else img_rescaled_cp.shape[0]
    img_section_cp = img_rescaled_cp[T:B, L:R]

    if split.scale_to_standard_page:
        img_section_cp = map_content_onto_scaled_canvas_gpu(
            img_section_cp,
            force_align=Alignment[
                (split.alignment or cfg.alignment).upper()
            ],
            height_width_ratio=cfg.page_h_w_ratio,
        )

    img_section = cp.asnumpy(img_section_cp)
    section_proofing = proofing_dir / f"{page.source_stem}_{section_prefix}.png"
    section_pre_ocr  = pre_ocr_dir  / f"{page.source_stem}_{section_prefix}.png"
    write_png(img_section, section_proofing)
    write_png(img_section, section_pre_ocr)
    run_optipng(section_proofing)
    run_optipng(section_pre_ocr)
```

Each split becomes a `PageOutput` entry on the page record. The unsplit source
page is also written for inspection but flagged `is_section_source=True`;
packaging skips those.

`PageOutput` ordering on the page record matches `reading_order`. Packaging
iterates outputs across pages in idx0 order, so split pages stay in
document sequence (`p020a`, `p020b` between `p019` and `p021`).

---

## Step 4.5 — Illustration Extraction

Spec 05 covers the algorithm and data model. Layout detection lives in
``pd_book_tools.layout`` — the protocol, registry, and the single shipping
model adapter (``pp-doclayout-plus-l``) all live in the shared library so
this step (illustration crops) and Step 7 (OCR + reorg) consume the same
:class:`PageLayout`.

Per page, for each ``page.illustration_regions[i]``, crop the region from
the **original source image** at native resolution and write to
``processing/hi_res_jpg/``. When the user has not yet curated regions for a
page, ``get_detector(...).detect(source_path)`` produces a
:class:`PageLayout`; the figure / decoration / table regions in that
layout populate the suggestion list.

Plate pages (``page_type == "plate_p"``) automatically synthesise a
full-page region if none is configured.

**Input:** `processing/original_as_jpg/<stem>.jpg` (or override source)
**Output:** `processing/hi_res_jpg/i_<prefix>_<n>.<ext>`

```python
from pd_book_tools.layout import get_detector
from pd_book_tools.layout.types import RegionType
from core.illustrations import extract_illustration

# Auto-suggest from the layout model when the page has no curated regions.
if not page.illustration_regions:
    detector = get_detector(cfg.layout_detector)  # cached per process
    layout = detector.detect(source_path)
    suggested = [
        r for r in layout.regions
        if r.type in {RegionType.figure, RegionType.decoration, RegionType.table}
    ]
    page.illustration_regions = [as_illustration_region(r) for r in suggested]

for region in page.illustration_regions:
    output_path = hi_res_dir / illustration_filename(page.prefix, region)
    extract_illustration(source_path, region, output_path)
```

---

## Step 5 — Inspect Proofing Images (Interactive)

User reviews proofing images. Anomalies are fixed by:

1. Adjusting `PageRecord.config_overrides` (per-page) and re-running Step 4
   for affected pages.
2. Placing a manual override image in `original_override_*/` and re-running.

Completion: user clicks "Approve Proofing Images".

---

## Step 6 — Crop for OCR

**Purpose:** Apply a uniform crop before OCR to remove running headers,
page numbers, decorative borders.

**Input:** `processing/pre_ocr_images_png/<stem>_<prefix>.png`
**Output:** `processing/ocr_images_png/<stem>_<prefix>.png`

```python
from pd_book_tools.image_processing.cv2_processing import crop_edges

if page_should_skip_ocr_crop(page, cfg):
    shutil.copyfile(pre_ocr_path, ocr_path)
else:
    img = read_image(pre_ocr_path)
    top, bottom, left, right = cfg.ocr_crop
    img = crop_edges(img, top=top, bottom=bottom, left=left, right=right)
    write_png(img, ocr_path)
```

`page_should_skip_ocr_crop()` returns True for blank pages, plate-P pages,
non-default alignment, `rotated_standard`, `single_dimension_rescale`, or
when the page has splits (sections are already tightly bounded).

---

## Step 7 — OCR

**Input:** `processing/ocr_images_png/<stem>_<prefix>.png`
**Output:** `processing/ocr_text/<stem>_<prefix>.txt`

```python
from pd_book_tools.layout import get_detector
from pd_book_tools.ocr.document import Document

if page_is_blank(page):
    target_text_file.write_text("[Blank Page]\n")
    continue

# Reuse the cached detector from Step 4.5; a single forward pass per page
# feeds both illustration extraction and reorg. PageLayout is per-page and
# stays in memory for the duration of this step.
layout = None
if cfg.layout_detector and cfg.layout_detector != "none":
    layout = get_detector(cfg.layout_detector).detect(source_path)

if cfg.ocr_engine == "doctr":
    img = read_image(ocr_image_path)
    predictor = get_doctr_predictor(cfg.ocr_model_key)
    doc = Document.from_image_ocr_via_doctr(img, source_identifier=page.prefix, predictor=predictor)
    page_obj = doc.pages[0]
    page_obj.reorganize_page(layout=layout)  # layout-aware when supplied
    text = doc_to_pgdp_text(doc)
elif cfg.ocr_engine == "tesseract":
    from pd_book_tools.ocr.cv2_tesseract import tesseract_ocr_cv2_image
    img = read_image(ocr_image_path)
    p = tesseract_ocr_cv2_image(img, source_path=str(ocr_image_path))
    p.reorganize_page(layout=layout)
    text = page_to_pgdp_text(p)

target_text_file.write_text(text)
```

DocTR runs on GPU (when available) and serializes through the GPU executor.
Tesseract uses ThreadPoolExecutor (max_workers=8).

When ``cfg.layout_detector`` is set, ``Page.reorganize_page(layout=…)``
strips high-confidence header / footer / footnote / abandoned regions
**before** the geometric reorg pipeline runs, then attaches caption blocks
to figure / decoration / table regions **after**. Layout is treated as a
hint — the geometric heuristics in ``reorganize_page_utils.py`` still run
as the safety net, so a noisy model never makes output worse than it would
be without layout. See spec 05 for the detector list and PP-DocLayout
category mapping.

`doc_to_pgdp_text` / `page_to_pgdp_text` convert the structured OCR output
into PGDP plain text: words separated by spaces, lines by newlines,
paragraphs by blank lines.

---

## Step 8 — Text Post-Processing (Automated)

Sequential regex passes against all OCR text files. The standard scanno list
and hyphenation join list come from `SystemDefaults`; book-specific entries
come from `ProjectConfig`.

| Pass | Description | Source |
|---|---|---|
| 1. Curly quotes | Normalise to ASCII | hardcoded |
| 2. Em-dash normalize | `—` → `--` | hardcoded |
| 3. Em-dash line-wrap | Join split `--` | hardcoded |
| 4. Trailing punct | Remove space before `:;!?` | hardcoded |
| 5. Hyphen line-join | Use `system.hyphenation_join_list` | system |
| 6. Standard scannos | `system.standard_scannos` | system |
| 7. Custom scannos | `project.custom_scannos` | project |
| 8. Custom regex | `project.custom_regex_passes` | project |

CPU only. ThreadPoolExecutor across files.

---

## Step 9 — Text Review (Interactive)

User reviews OCR text side-by-side with proofing images. Allows:

- Direct text editing (writes via `PATCH /api/data/projects/{id}/pages/{idx0}/text`)
- Ad-hoc regex passes with preview
- `find_mismatched_dashes()` across all files

Completion: user clicks "Approve Text".

---

## Step 10 — Package

```python
import shutil, zipfile

for page in pages:
    for output in page.outputs:
        if output.is_section_source:
            continue
        shutil.copyfile(output.proofing_image_path, for_zip / f"{output.full_prefix}.png")
        shutil.copyfile(output.ocr_text_path,       for_zip / f"{output.full_prefix}.txt")

# Hi-res illustrations:
for f in hi_res_dir.iterdir():
    shutil.copyfile(f, for_zip / f.name)

with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
    for f in sorted(for_zip.iterdir()):
        zf.write(f, arcname=f.name)
```

The zip is offered as a download in the UI (`GET /api/data/projects/{id}/assets/download-url`
with `key=for_zip/<book_name>_pgdp.zip`).
