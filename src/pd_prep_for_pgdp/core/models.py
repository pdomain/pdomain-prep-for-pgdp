"""Pydantic models — source of truth for both persistence and the wire format.

Mirrors spec 08 verbatim. Frontend types are generated from /openapi.json via
`openapi-typescript`; do not maintain a parallel TypeScript definition.
"""

from __future__ import annotations

from datetime import UTC, datetime
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

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
    center = "center"
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

    proofing_image_key: str | None = None
    pre_ocr_image_key: str | None = None
    ocr_image_key: str | None = None
    ocr_text_key: str | None = None
    for_zip_image_key: str | None = None
    for_zip_text_key: str | None = None

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


# ─── Job ─────────────────────────────────────────────────────────────────────


class JobStatus(str, Enum):
    queued = "queued"
    scheduled = "scheduled"
    running = "running"
    complete = "complete"
    error = "error"
    cancelled = "cancelled"


class JobType(str, Enum):
    # Source ingestion is split into two stages so the user sees discrete
    # progress + can keep working on the project page while thumbnails finish.
    unzip = "unzip"
    thumbnails = "thumbnails"
    batch_process_pages = "batch_process_pages"
    batch_ocr = "batch_ocr"
    batch_text_postprocess = "batch_text_postprocess"
    batch_extract_illustrations = "batch_extract_illustrations"
    build_package = "build_package"


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
    """Job-type-specific arguments. e.g. batch_process_pages -> {"page_idxs": [...]}.
    The jobs table stores Job as JSON, so this is schema-migration-free."""


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
