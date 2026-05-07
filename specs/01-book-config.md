# Spec 01 — Configuration Model

## Overview

The notebook had a single ~150-line `BookConfig` mixing book identity, image
processing tunables, and per-page override dicts. This app splits that into
**three resolution tiers** so each piece of state lives where it makes sense:

```
┌─────────────────────────────────────────────────┐
│ A. SystemDefaults     ~/.config/pgdp-prep/      │  edit-once-and-forget
│                                                 │
│ B. ProjectConfig      projects/<id>/project.json│  per-book identity & ranges
│                                                 │
│ C. PageRecord         projects/<id>/pages/N.json│  per-page state & overrides
└─────────────────────────────────────────────────┘
        ↓                ↓                ↓
       resolve_page_config(...)  →  ResolvedPageConfig
                                    (flat dataclass consumed by the pipeline)
```

A pipeline step never looks at any of these directly. It receives a
`ResolvedPageConfig` produced by a single resolver call. Resolution rule is
simple: **page override > project default override > system default**.

This split is what makes the app feel like a project manager rather than a
notebook. Most user attention shifts to the page tagger and PageWorkbench
where per-page state belongs; the project-level form shrinks to identity and
page ranges.

---

## Layer A — `SystemDefaults`

Stored at `~/.config/pgdp-prep/defaults.json` in **local** mode and in a
`system_defaults` table in **hosted** mode (one row per user; an admin row
acts as fallback). Edited from the Settings page.

```python
from pydantic import BaseModel

class SystemDefaults(BaseModel):
    # Image processing fallbacks
    text_threshold: int = 140                # used when Otsu fails
    page_h_w_ratio: float = 1.65             # target canvas aspect
    default_fuzzy_pct: float = 0.02          # edge-finding smoothing
    default_pixel_count_columns: int = 150
    default_pixel_count_rows: int = 75

    # OCR
    ocr_engine: str = "doctr"                # "doctr" | "tesseract"
    ocr_model_key: str | None = None         # default DocTR model profile
    ocr_dpi: int = 150                       # for Tesseract
    ocr_bbox_edge_min_words: int = 5

    # Layout / illustration detection (spec 05)
    layout_detector: str = "pp-doclayout-plus-l"  # "none" | "contour" | "pp-doclayout-plus-l"
    layout_detector_confidence: float = 0.5  # confidence threshold (0..1)
    layout_checkpoint: str | None = None     # HF repo or local path for a
                                             # fine-tuned PP-DocLayout checkpoint

    # Text post-processing — book-agnostic
    standard_scannos: dict[str, str] = {}    # word → replacement
    hyphenation_join_list: list[str] = []    # common-endings/beginnings (was hyphenated-line-join.json)
```

These are tuned once per installation. They never need to live inside a
project. The Settings page has one form; defaults persist to disk.

---

## Layer B — `ProjectConfig`

Stored at `projects/<id>/project.json`. This is what shows in the "Book Settings"
form on the Configure page — roughly 12 fields plus an optional defaults override.

```python
class ProjectConfig(BaseModel):
    # ── Identity ──────────────────────────────────────────────
    book_name: str
    source_uri: str                # zip path, S3 prefix, or local folder

    # ── Page ranges (0-indexed in source-file sort order) ─────
    proof_start_idx0: int = 0
    proof_end_idx0: int = 0
    cover_idx0: int | None = None
    title_idx0: int | None = None
    frontmatter_start_idx0: int = 0
    frontmatter_end_idx0: int = 0
    bodymatter_start_idx0: int = 0
    bodymatter_end_idx0: int = 0
    frontmatter_page_nbr_start: int = 1   # first f### number
    bodymatter_page_nbr_start: int = 1    # first p### number

    # ── Crops applied to all pages ────────────────────────────
    initial_crop_all: tuple[int, int, int, int] = (0, 0, 0, 0)
    # (left_px, right_px, top_px, bottom_px) — strips scanner frame from every page

    ocr_crop_top: int = 0
    ocr_crop_bottom: int = 0
    ocr_crop_left: int = 0
    ocr_crop_right: int = 0

    # ── Book-specific text post-processing ────────────────────
    custom_regex_passes: list[tuple[str, str]] = []
    custom_scannos: dict[str, str] = {}    # merged with system standard_scannos

    # ── Layout detection category mapping override ────────────
    # Sparse map: model label → PGDP type ("illustration" | "decoration" | "plate" | None).
    # Lets a math-heavy book treat formulas as illustrations, etc.
    layout_category_overrides: dict[str, str | None] = {}

    # ── Optional override of system defaults for this project ─
    # Only fields the user explicitly tunes for this book. Sparse.
    default_overrides: dict[str, object] = {}
```

**What is no longer here.** Compared with the notebook config, the following
fields have moved off the project entirely:

| Removed field | Now lives at |
|---|---|
| `plate_pages_b/_p/_r`, `non_plate_blank_pages` | `PageRecord.page_type` |
| `align_top_pages`, `align_center_pages`, `align_bottom_pages` | `PageRecord.alignment` |
| `skip_auto_deskew`, `do_morph`, `skip_denoise` (lists) | `PageRecord.config_overrides` |
| `rotated_standard_pages`, `single_dimension_rescale` | `PageRecord.config_overrides` |
| `ocr_bbox_edge_pages` | `PageRecord.config_overrides.use_ocr_bbox_edge` |
| `initial_crop` (per-page dict) | `PageRecord.config_overrides.initial_crop` |
| `white_space_additional` (dict) | `PageRecord.config_overrides.white_space_additional` |
| `edge_finding_adjust` (dict) | `PageRecord.config_overrides.fuzzy_pct/pixel_count_*` |
| `threshold_level_adjust` (dict) | `PageRecord.config_overrides.threshold_level` |
| `deskew_before_crop`, `deskew_after_crop` (dicts) | `PageRecord.config_overrides` |
| `split_page_sections` | **Sibling child pages** keyed on `parent_page_id` (canonical spec Q6 lock; see spec 06 §Data Model — splits as sibling pages) |
| `illustration_regions` | `PageRecord.illustration_regions` (see spec 05) |
| `text_threshold`, `page_h_w_ratio`, `default_fuzzy_pct`, `default_pixel_count_*` | `SystemDefaults` (overridable per-project via `default_overrides`) |

Editing `project.json` by hand becomes much less common — most state now lives
on individual pages and is edited through the tagger / workbench.

---

## Layer C — `PageRecord`

Stored at `projects/<id>/pages/<idx0>.json`. Spec 08 has the full schema; this
section covers only the configuration-resolution surface.

```python
class PageRecord(BaseModel):
    id: str                        # opaque; encodes parent chain for split children
    idx0: int                      # 0-based source-file index (root); inherited from parent for children
    prefix: str                    # "p045", "f003", "p007p", "p045a" (with split suffix)
    source_stem: str

    # Identity-level page properties (replace the BookConfig page lists)
    page_type: PageType            # "normal" | "blank" | "plate_b" | "plate_p" | "plate_r"
    alignment: AlignmentOverride   # "default" | "top" | "center" | "bottom"

    # Per-page processing overrides (None on every field = inherit)
    config_overrides: PageConfigOverrides

    # Splits as sibling pages — see spec 08 and the canonical pipeline
    # task-model spec §Splits as sibling pages (Q6 lock).
    parent_page_id: str | None = None
    source_crop_bbox: tuple[int, int, int, int] | None = None
    split_index: int | None = None
    split_at_stage: str | None = None
    split_suffix: str | None = None
    reading_order: int | None = None

    # Page-level structural data (see spec 05)
    illustration_regions: list[IllustrationRegion] = []

    # ... S3 keys, processing status, outputs (spec 08)


class PageConfigOverrides(BaseModel):
    initial_crop: tuple[int, int, int, int] | None = None
    white_space_additional: tuple[float, float, float, float] | None = None
    threshold_level: int | None = None       # None = Otsu auto
    fuzzy_pct: float | None = None
    pixel_count_columns: int | None = None
    pixel_count_rows: int | None = None
    skip_auto_deskew: bool | None = None
    deskew_before_crop: float | None = None  # manual angle override (degrees)
    deskew_after_crop: float | None = None
    do_morph: bool | None = None
    skip_denoise: bool | None = None
    use_ocr_bbox_edge: bool | None = None    # GPU-only; falls back when no GPU
    rotated_standard: bool | None = None
    single_dimension_rescale: bool | None = None
```

Every override field is nullable. `null` means "use the resolved default for
this layer up the chain." The UI shows a checkbox or pencil-icon next to each
field — unchecked = inherit, checked = override with the entered value.

---

## Resolver

A single helper produces the flat object the pipeline consumes:

```python
class ResolvedPageConfig(BaseModel):
    """Flat, fully-resolved per-page config. No None values for tunables."""
    # From SystemDefaults (possibly overridden by ProjectConfig.default_overrides
    # and then by PageRecord.config_overrides)
    text_threshold: int
    page_h_w_ratio: float
    fuzzy_pct: float
    pixel_count_columns: int
    pixel_count_rows: int
    ocr_bbox_edge_min_words: int
    ocr_engine: str
    ocr_model_key: str | None
    ocr_dpi: int

    # From ProjectConfig (project-wide crops applied to every page)
    initial_crop_all: tuple[int, int, int, int]
    ocr_crop: tuple[int, int, int, int]   # (top, bottom, left, right)

    # From PageRecord (page-level)
    page_type: PageType
    alignment: AlignmentOverride
    initial_crop: tuple[int, int, int, int] | None
    white_space_additional: tuple[float, float, float, float] | None
    threshold_level: int | None             # None = Otsu (intentionally preserved)
    skip_auto_deskew: bool
    deskew_before_crop: float | None
    deskew_after_crop: float | None
    do_morph: bool
    skip_denoise: bool
    use_ocr_bbox_edge: bool
    rotated_standard: bool
    single_dimension_rescale: bool


def resolve_page_config(
    system: SystemDefaults,
    project: ProjectConfig,
    page: PageRecord,
) -> ResolvedPageConfig:
    """Merge: page override > project default override > system default."""

    def pick(field: str, page_value, fallback):
        if page_value is not None:
            return page_value
        if field in project.default_overrides:
            return project.default_overrides[field]
        return fallback

    o = page.config_overrides
    return ResolvedPageConfig(
        text_threshold              = pick("text_threshold",              None,                  system.text_threshold),
        page_h_w_ratio              = pick("page_h_w_ratio",              None,                  system.page_h_w_ratio),
        fuzzy_pct                   = pick("fuzzy_pct",                   o.fuzzy_pct,           system.default_fuzzy_pct),
        pixel_count_columns         = pick("pixel_count_columns",         o.pixel_count_columns, system.default_pixel_count_columns),
        pixel_count_rows            = pick("pixel_count_rows",            o.pixel_count_rows,    system.default_pixel_count_rows),
        ocr_bbox_edge_min_words     = pick("ocr_bbox_edge_min_words",     None,                  system.ocr_bbox_edge_min_words),
        ocr_engine                  = pick("ocr_engine",                  None,                  system.ocr_engine),
        ocr_model_key               = pick("ocr_model_key",               None,                  system.ocr_model_key),
        ocr_dpi                     = pick("ocr_dpi",                     None,                  system.ocr_dpi),

        initial_crop_all = project.initial_crop_all,
        ocr_crop         = (project.ocr_crop_top, project.ocr_crop_bottom,
                            project.ocr_crop_left, project.ocr_crop_right),

        page_type                   = page.page_type,
        alignment                   = page.alignment,
        initial_crop                = o.initial_crop,
        white_space_additional      = o.white_space_additional,
        threshold_level             = o.threshold_level,
        skip_auto_deskew            = o.skip_auto_deskew or False,
        deskew_before_crop          = o.deskew_before_crop,
        deskew_after_crop           = o.deskew_after_crop,
        do_morph                    = o.do_morph or False,
        skip_denoise                = o.skip_denoise or False,
        use_ocr_bbox_edge           = o.use_ocr_bbox_edge or False,
        rotated_standard            = o.rotated_standard or False,
        single_dimension_rescale    = o.single_dimension_rescale or False,
    )
```

Pipeline call sites become:

```python
cfg = resolve_page_config(system, project, page)

if cfg.threshold_level is None:
    img = otsu_binary_thresh(img)            # auto
else:
    img = binary_thresh(img, cfg.threshold_level)

if not cfg.skip_auto_deskew:
    img, *_ = auto_deskew(img)
```

No dict lookups. No "either idx0 or prefix as the key" gymnastics. The pipeline
sees a flat object and the resolver is the single point that knows how layers
combine.

`resolve_page_config` is implemented once in **shared code** (see spec 00 —
shared module layout). Both the local install and the hosted backend import
the same function.

---

## Derived helpers

Properties that used to live on `BookConfig` move onto a small computation
module that takes the project + a list of pages and returns a sorted index:

```python
def blank_page_idxs(pages: Sequence[PageRecord]) -> list[int]:
    return sorted(p.idx0 for p in pages
                  if p.page_type in {"blank", "plate_b", "plate_r"})

def split_source_idxs(pages: Sequence[PageRecord]) -> list[int]:
    return sorted(p.idx0 for p in pages if p.splits)

def ocr_crop_skip_idxs(pages: Sequence[PageRecord]) -> list[int]:
    out = set()
    for p in pages:
        cfg = resolve_page_config(_system, _project, p)
        if (p.page_type in {"blank", "plate_b", "plate_p", "plate_r"}
                or cfg.alignment in {"center", "bottom"}
                or cfg.rotated_standard
                or cfg.single_dimension_rescale
                or p.splits):
            out.add(p.idx0)
    return sorted(out)
```

These do not need to be cached — the entire per-page set fits in memory for any
realistic book.

---

## Page-prefix computation

`compute_prefix(idx0, project, pages)` is unchanged in spirit but now reads
`page.page_type` instead of `BookConfig.plate_pages_*`:

```python
def compute_prefix(idx0: int, project: ProjectConfig,
                   pages_by_idx: Mapping[int, PageRecord]) -> str | None:
    if idx0 < project.proof_start_idx0 or idx0 > project.proof_end_idx0:
        return None

    def is_unnumbered_plate(i: int) -> bool:
        p = pages_by_idx.get(i)
        return p is not None and p.page_type in {"plate_b", "plate_p", "plate_r"}

    fidx = project.frontmatter_page_nbr_start
    for k in range(project.frontmatter_start_idx0,
                   min(idx0, project.frontmatter_end_idx0 + 1)):
        if not is_unnumbered_plate(k):
            fidx += 1

    pidx = project.bodymatter_page_nbr_start
    for k in range(project.bodymatter_start_idx0,
                   min(idx0, project.bodymatter_end_idx0 + 1)):
        if not is_unnumbered_plate(k):
            pidx += 1

    if project.frontmatter_start_idx0 <= idx0 <= project.frontmatter_end_idx0:
        prefix = f"f{fidx - 1:03d}"
    else:
        prefix = f"p{pidx - 1:03d}"

    page = pages_by_idx.get(idx0)
    if page:
        if page.page_type == "plate_b": prefix += "b"
        elif page.page_type == "plate_p": prefix += "p"
        elif page.page_type == "plate_r": prefix += "r"

    return prefix
```

---

## Persistence

| File | Format | Updated by |
|---|---|---|
| `~/.config/pgdp-prep/defaults.json` (local) / `system_defaults` row (hosted) | JSON | Settings page |
| `projects/<id>/project.json` | JSON (Pydantic `model_dump_json`) | Configure page Book Settings |
| `projects/<id>/pages/<idx0>.json` | JSON, one file per page | Page tagger + PageWorkbench |

In **hosted** mode each file is also addressable as an S3 object under the
project prefix; the `IStorage` adapter (spec 09) makes this transparent. There
is no separate `book_config.json` — the legacy notebook field set is gone.

---

## Auto-detection (new project setup)

Auto-detection is unchanged in spirit but now writes results onto `PageRecord`s,
not into project-level lists:

| Detected | Sets |
|---|---|
| Mostly-white scan | `page.page_type = "blank"` (suggestion, yellow ring) |
| Color page (non-grayscale source) | `page.page_type = "plate_p"` (suggestion) |
| Content occupies <50% of column | `page.alignment = "center"` (suggestion) |
| Median image aspect | `system.page_h_w_ratio` (or `project.default_overrides`) |

Each suggestion is shown in the tagger as a yellow highlight; the user
confirms or overrides per page.

---

## Visual page tagger (UI summary)

The tagger is the primary editor for page-typed fields. Full layout in spec 03.

**Grid view:** thumbnails of all source pages.

- Page prefix label
- Tag badges: BLANK / PLATE-B / PLATE-P / PLATE-R / TOP / CENTER / BOTTOM
- Override indicator (orange dot) if any `config_overrides` field is set
- Yellow ring + ✦ for unconfirmed auto-detect suggestions
- Click → open per-page detail panel (or PageWorkbench for full editing)

**Bulk actions toolbar:**

- Set range: proof start/end, frontmatter/bodymatter boundaries
- Auto-detect blanks / plates buttons (writes suggestions into `page_type`)
- Selected pages: assign `page_type` or `alignment` in bulk

**Per-page detail panel (right drawer):**

- Thumbnail preview
- Inputs for every `PageConfigOverrides` field, each with an "inherit / override" toggle
- "Open in Workbench" button for full live-preview editing (spec 06)
