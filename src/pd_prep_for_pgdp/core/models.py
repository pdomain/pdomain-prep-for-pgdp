"""Pydantic models — source of truth for both persistence and the wire format.

Mirrors spec 08 verbatim. Frontend types are generated from /openapi.json via
`openapi-typescript`; do not maintain a parallel TypeScript definition.
"""

from __future__ import annotations

from datetime import UTC, datetime
from enum import Enum
from typing import Annotated, Any, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, model_validator


def _empty_str_to_none(v: str | None) -> str | None:
    """Coerce empty string to None for storage-key fields."""
    return None if v == "" else v


NonEmptyStr = Annotated[str | None, BeforeValidator(_empty_str_to_none)]

# ─── Shared base ─────────────────────────────────────────────────────────────


class ApiModel(BaseModel):
    """Base for wire-shape models.

    Sets `json_schema_serialization_defaults_required=True` so fields with
    `default_factory=...` (or simple defaults) are emitted as **required** in
    the serialization JSON Schema. The server always populates them on the
    way out, so the OpenAPI spec — and the `openapi-typescript` codegen
    derived from it — should treat them as guaranteed-present, not optional.

    Behavior on **input** is unchanged: defaults still apply when omitted,
    because Pydantic uses the *validation* schema (where these remain
    optional) for request bodies. FastAPI hands `model_json_schema(mode=...)`
    explicitly per direction.
    """

    model_config = ConfigDict(json_schema_serialization_defaults_required=True)


# ─── SystemDefaults ──────────────────────────────────────────────────────────


class SystemDefaults(ApiModel):
    text_threshold: int = 140
    page_h_w_ratio: float = 1.65
    default_fuzzy_pct: float = 0.02
    default_pixel_count_columns: int = 150
    default_pixel_count_rows: int = 75
    ocr_engine: Literal["doctr", "tesseract"] = "doctr"
    ocr_model_key: str | None = None
    ocr_dpi: int = 150
    ocr_bbox_edge_min_words: int = 5
    layout_detector: Literal["none", "contour", "pp-doclayout-plus-l"] = "pp-doclayout-plus-l"
    layout_detector_confidence: float = 0.5
    layout_checkpoint: str | None = None
    standard_scannos: dict[str, str] = Field(default_factory=dict)
    hyphenation_join_list: list[str] = Field(default_factory=list)


# ─── ProjectConfig ───────────────────────────────────────────────────────────


class ProjectConfig(ApiModel):
    book_name: str
    source_uri: str

    proof_start_idx0: int = 0
    proof_end_idx0: int = 0
    cover_idx0: int | None = None
    title_idx0: int | None = None
    frontmatter_start_idx0: int = 0
    frontmatter_end_idx0: int = 0
    bodymatter_start_idx0: int = 0
    bodymatter_end_idx0: int = 0
    frontmatter_page_nbr_start: int = 1
    bodymatter_page_nbr_start: int = 1

    initial_crop_all: tuple[int, int, int, int] = (0, 0, 0, 0)
    ocr_crop_top: int = 0
    ocr_crop_bottom: int = 0
    ocr_crop_left: int = 0
    ocr_crop_right: int = 0

    custom_regex_passes: list[tuple[str, str]] = Field(default_factory=list)
    custom_scannos: dict[str, str] = Field(default_factory=dict)

    layout_category_overrides: dict[str, str | None] = Field(default_factory=dict)

    optimize_png: bool = True
    """Run lossless oxipng optimisation on proofing images before packaging.

    Defaults to ``True`` (level-4 optimisation). Set to ``False`` to skip
    the pass during development for faster packaging turnaround.
    """

    default_overrides: dict[str, Any] = Field(default_factory=dict)
    """Sparse map: SystemDefaults field name -> override value for this project."""


# ─── PageRecord and friends ──────────────────────────────────────────────────


class PageType(str, Enum):
    normal = "normal"
    blank = "blank"
    plate_b = "plate_b"
    plate_p = "plate_p"
    plate_r = "plate_r"


class AlignmentOverride(str, Enum):
    default = "default"
    top = "top"
    center = "center"  # pyright: ignore[reportAssignmentType]  -- "center" shadows str.center; enum member wins at runtime
    bottom = "bottom"


class PageProcessingStatus(str, Enum):
    pending = "pending"
    processing = "processing"
    complete = "complete"
    error = "error"


class PageConfigOverrides(ApiModel):
    """Per-page processing overrides. Every field None = inherit."""

    initial_crop: tuple[int, int, int, int] | None = None
    white_space_additional: tuple[float, float, float, float] | None = None
    threshold_level: int | None = None
    fuzzy_pct: float | None = None
    pixel_count_columns: int | None = None
    pixel_count_rows: int | None = None
    skip_auto_deskew: bool | None = None
    deskew_before_crop: float | None = None
    deskew_after_crop: float | None = None
    do_morph: bool | None = None
    skip_denoise: bool | None = None
    use_ocr_bbox_edge: bool | None = None
    rotated_standard: bool | None = None
    single_dimension_rescale: bool | None = None
    manual_deskew_angle: float | None = None
    flip_horizontal: bool | None = None
    flip_vertical: bool | None = None


class PageSplit(ApiModel):
    """Replaces the notebook's `PageSectionSplit`. Coords in PROCESSED image space."""

    suffix: str
    reading_order: int

    L: int | None = None
    R: int | None = None
    T: int | None = None
    B: int | None = None

    scale_to_standard_page: bool = True
    alignment: AlignmentOverride | None = None
    ocr_engine: Literal["doctr", "tesseract"] | None = None


class IllustrationRegion(ApiModel):
    """Coords in SOURCE image space (original scan, pre-processing)."""

    index: int = 1
    label: str = ""
    type: Literal["illustration", "decoration", "plate"] = "illustration"

    L: int | None = None
    R: int | None = None
    T: int | None = None
    B: int | None = None

    output_format: Literal["jpg", "png"] = "jpg"
    jpeg_quality: int = 85
    convert_to_grayscale: bool = False


class PageOutput(ApiModel):
    """One per split, or one for whole page."""

    full_prefix: str
    split_suffix: str | None
    reading_order: int

    proofing_image_key: NonEmptyStr = None
    pre_ocr_image_key: NonEmptyStr = None
    ocr_image_key: NonEmptyStr = None
    ocr_text_key: NonEmptyStr = None
    for_zip_image_key: NonEmptyStr = None
    for_zip_text_key: NonEmptyStr = None

    ocr_status: PageProcessingStatus = PageProcessingStatus.pending
    ocr_job_id: str | None = None
    ocr_error: str | None = None


class PageRecord(ApiModel):
    project_id: str
    idx0: int
    prefix: str
    source_stem: str
    ignore: bool = False

    page_type: PageType = PageType.normal
    alignment: AlignmentOverride = AlignmentOverride.default

    config_overrides: PageConfigOverrides = Field(default_factory=PageConfigOverrides)

    splits: list[PageSplit] = Field(default_factory=list)
    illustration_regions: list[IllustrationRegion] = Field(default_factory=list)

    source_key: str | None = None
    thumbnail_key: str | None = None
    processed_image_key: str | None = None
    ocr_image_key: str | None = None

    processing_status: PageProcessingStatus = PageProcessingStatus.pending
    processing_job_id: str | None = None
    processing_error: str | None = None
    last_processed_at: datetime | None = None

    outputs: list[PageOutput] = Field(default_factory=list)

    # ── Split-child fields (M2 §E) ──────────────────────────────────────────
    # Spec: docs/specs/pipeline-task-model.md §"Splits as sibling pages
    # (Q6 lock)" → "Data model on Page". A split turns one parent page into
    # N sibling child pages; each child is a first-class PageRecord that
    # carries these five linking fields. All-or-none: a row either has
    # `parent_page_id` set with the four other split fields populated
    # (split-child), OR all five fields are None (root page). The validator
    # below enforces that contract. `reading_order` is the only non-null
    # field — root rows default to 0; siblings inherit the user's split
    # definition's order.

    parent_page_id: str | None = None
    """FK to the parent PageRecord's `page_id`. NULL for root pages.

    The parent page lives in the same project and is identified by its
    `page_id` string (today the zero-padded 4-digit `idx0`, e.g. `"0042"`).
    """

    source_crop_bbox: tuple[int, int, int, int] | None = None
    """`(x, y, w, h)` on the parent's source image, in original-source
    coordinate space. Required when `parent_page_id IS NOT NULL`.
    """

    split_index: int | None = None
    """1-based index among siblings (1, 2, 3, ...). NULL for root pages."""

    split_at_stage: str | None = None
    """The stage on the parent at which the split was created (a stage_id
    string from `PAGE_STAGE_IDS`). Typically `auto_detect_attrs`; the spec
    permits any stage whose output is an image."""

    split_suffix: str | None = None
    """The user-chosen suffix that gets appended in the page prefix
    (`a`, `b`, `cl`, ...)."""

    reading_order: int = 0
    """Determines output sort order across siblings. Inherited from the
    user's split definition. Defaults to 0 for root pages."""

    @model_validator(mode="after")
    def _validate_split_fields_all_or_none(self) -> PageRecord:
        """Enforce that split fields are all-or-none, keyed off `parent_page_id`.

        - If `parent_page_id` is set: `source_crop_bbox`, `split_index`,
          `split_at_stage`, `split_suffix` must ALL be set (non-None).
        - If `parent_page_id` is None: NONE of the four peers may be set.

        `reading_order` is exempt — it has a real default (0) and applies
        to every page.
        """
        peers = {
            "source_crop_bbox": self.source_crop_bbox,
            "split_index": self.split_index,
            "split_at_stage": self.split_at_stage,
            "split_suffix": self.split_suffix,
        }
        missing = [name for name, value in peers.items() if value is None]
        present = [name for name, value in peers.items() if value is not None]

        if self.parent_page_id is not None:
            if missing:
                raise ValueError(
                    f"split-child PageRecord (parent_page_id={self.parent_page_id!r}) "
                    f"requires all split fields; missing: {missing}"
                )
        elif present:
            raise ValueError(
                f"root PageRecord (parent_page_id=None) must not set split fields; got: {present}"
            )
        return self


# ─── Pipeline state ──────────────────────────────────────────────────────────


class StepStatus(str, Enum):
    pending = "pending"
    running = "running"
    complete = "complete"
    error = "error"


class StepState(ApiModel):
    status: StepStatus = StepStatus.pending
    pages_complete: list[int] = Field(default_factory=list)
    pages_error: dict[int, str] = Field(default_factory=dict)
    started_at: datetime | None = None
    completed_at: datetime | None = None
    job_id: str | None = None


# Step IDs match spec 02 (step 3 was renumbered out)
StepId = Literal[1, 2, 4, 5, 6, 7, 8, 9, 10]


class PipelineState(ApiModel):
    steps: dict[int, StepState] = Field(default_factory=dict)


# ─── Project (API wrapper) ───────────────────────────────────────────────────


class ProjectStatus(str, Enum):
    ingesting = "ingesting"
    configuring = "configuring"
    processing = "processing"
    reviewing = "reviewing"
    packaging = "packaging"
    complete = "complete"


class Project(ApiModel):
    id: str
    owner_id: str = "default"
    name: str
    created_at: datetime
    updated_at: datetime
    status: ProjectStatus
    page_count: int
    proof_page_count: int
    config: ProjectConfig
    pipeline_state: PipelineState
    storage_prefix: str
    archived: bool = False
    # Disk-cost banner fields (M4 spec §Disk-cost banner).
    # Computed on GET /api/data/projects/{id}; zero means "no stage artifacts yet"
    # and the banner hides itself.  `source_zip_bytes` is set once at ingest.
    stage_artifacts_bytes: int = 0
    source_zip_bytes: int = 0


# ─── ResolvedPageConfig (output of resolver; not persisted) ──────────────────


class ResolvedPageConfig(ApiModel):
    """Flat, fully-resolved per-page config consumed by the pipeline."""

    text_threshold: int
    page_h_w_ratio: float
    fuzzy_pct: float
    pixel_count_columns: int
    pixel_count_rows: int
    ocr_bbox_edge_min_words: int
    ocr_engine: Literal["doctr", "tesseract"]
    ocr_model_key: str | None
    ocr_dpi: int

    initial_crop_all: tuple[int, int, int, int]
    ocr_crop: tuple[int, int, int, int]  # (top, bottom, left, right)

    page_type: PageType
    alignment: AlignmentOverride
    initial_crop: tuple[int, int, int, int] | None
    white_space_additional: tuple[float, float, float, float] | None
    threshold_level: int | None
    skip_auto_deskew: bool
    deskew_before_crop: float | None
    deskew_after_crop: float | None
    do_morph: bool
    skip_denoise: bool
    use_ocr_bbox_edge: bool
    rotated_standard: bool
    single_dimension_rescale: bool
    flip_horizontal: bool
    flip_vertical: bool


# ─── Job ─────────────────────────────────────────────────────────────────────


class JobStatus(str, Enum):
    queued = "queued"
    scheduled = "scheduled"
    running = "running"
    awaiting_review = "awaiting_review"
    complete = "complete"
    error = "error"
    cancelled = "cancelled"


class JobType(str, Enum):
    # Source ingestion is split into two stages so the user sees discrete
    # progress + can keep working on the project page while thumbnails finish.
    unzip = "unzip"
    thumbnails = "thumbnails"
    build_package = "build_package"
    # Per-page stage execution via the async route (?async=true).
    # payload: {"project_id": str, "page_id": str, "stage_id": str, "device": str}  # noqa: ERA001
    run_page_stage = "run_page_stage"
    # Project-level fan-out: run every dirty stage on every page (M5).
    # payload: {"data_root": str, "stage_filter": str | None, "device": str}  # noqa: ERA001
    project_run_dirty = "project_run_dirty"
    # Run one specific stage on every page that needs it (M5).
    # payload: {"data_root": str, "stage_id": str, "device": str}  # noqa: ERA001
    project_run_stage_all_pages = "project_run_stage_all_pages"


class JobProgress(ApiModel):
    current: int = 0
    total: int = 0
    current_page: int | None = None
    message: str = ""


class Job(ApiModel):
    id: str
    project_id: str
    owner_id: str = "default"
    type: JobType
    status: JobStatus = JobStatus.queued
    progress: JobProgress = Field(default_factory=JobProgress)
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    started_at: datetime | None = None
    completed_at: datetime | None = None
    next_dispatch_at: datetime | None = None
    error_message: str | None = None
    gpu_backend: Literal["local", "cpu", "modal", "shared_container"] = "local"
    payload: dict[str, Any] = Field(default_factory=dict)
    """Job-type-specific arguments. e.g. run_page_stage -> {"page_id": "...", "stage_id": "..."}.
    The jobs table stores Job as JSON, so this is schema-migration-free."""


# ─── PageStageState (per-page stage DAG persistence) ────────────────────────


class PageStageStatus(str, Enum):
    """Per-stage status — see canonical spec §SQLite schema (Q1 lock).

    `not-applicable` indicates a stage is skipped because of page type
    (e.g. blank-page short-circuit skips `decode_source` … `morph_fill`).
    """

    not_run = "not-run"
    running = "running"
    clean = "clean"
    dirty = "dirty"
    failed = "failed"
    not_applicable = "not-applicable"


# Canonical stage-ID list — single source of truth at the model layer; the
# DAG module (M1 §B) re-uses this tuple to enumerate stages and the SQLite
# schema's CHECK constraint pins the same set. Order matches a reasonable
# topological walk of the DAG (per spec §"Per-page stage DAG"); the DAG
# module is the authority on actual edges.
PAGE_STAGE_IDS: tuple[str, ...] = (
    # Pre-existing-today (already discrete; just naming them).
    "ingest_source",
    "thumbnail",
    "auto_detect_attrs",
    "auto_detect_illustrations",
    # Per-page pipeline stages.
    "decode_source",
    "initial_crop",
    "manual_deskew_pre",
    "grayscale",
    "threshold",
    "invert",
    "find_content_edges",
    "crop_to_content",
    "auto_deskew",
    "morph_fill",
    "rescale",
    "canvas_map",
    # Alt to canvas_map for blank-page short-circuit.
    "blank_proof_synth",
    # Post-Step-4 chain.
    "ocr_crop",
    "extract_illustrations",
    "ocr",
    "text_postprocess",
    "text_review",
)


class PageStageState(ApiModel):
    """One per-page stage row — state of stage `stage_id` on page `page_id`.

    Spec: `docs/specs/pipeline-task-model.md` §"SQLite schema" (Q1 lock).

    `page_id` is a string so it can encode split-child identity later (e.g.
    `0042/splits/a` for the first split-child of page 42). For root pages
    today, `page_id` is the zero-padded 4-digit `idx0`.
    """

    project_id: str
    page_id: str
    stage_id: str
    status: PageStageStatus = PageStageStatus.not_run
    stage_version: int = 1
    artifact_key: str | None = None
    config_hash: str | None = None
    input_hash: str | None = None
    last_run_at: float | None = None  # epoch seconds
    duration_ms: int | None = None
    error_message: str | None = None
    job_id: str | None = None  # last job that touched this row


# ─── OCR ─────────────────────────────────────────────────────────────────────


class BoundingBox(ApiModel):
    left: int
    top: int
    width: int
    height: int


class OcrWord(ApiModel):
    id: str
    text: str
    confidence: float
    bounding_box: BoundingBox
    split_suffix: str | None = None
    deleted: bool = False
