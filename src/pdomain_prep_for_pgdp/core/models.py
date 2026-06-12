"""Pydantic models — source of truth for both persistence and the wire format.

Mirrors spec 08 verbatim. Frontend types are generated from /openapi.json via
`openapi-typescript`; do not maintain a parallel TypeScript definition.
"""

from __future__ import annotations

from datetime import UTC, datetime
from enum import Enum
from typing import Annotated, Any, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field


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
    author: str = ""
    """Book author — shown in attributes panel bib section."""

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
    skip = "skip"
    """Leaf excluded from the package entirely (cover/endpaper/divider).

    A skip page is not written to the submission zip — no .png, no .txt.
    It is also excluded from all pairing checks. ``compute_prefix`` returns
    ``None`` for skip pages (same as pages outside the proof range).
    """
    cover = "cover"
    """Cover image included in the package under the ``c``-prefix series.

    A cover page is treated like a normal page but named with the ``c``
    type-code (e.g. ``c001``) so it sorts before the front-matter ``f``
    pages. It does NOT consume a frontmatter or bodymatter folio number.
    ``compute_prefix`` returns a ``c``-prefixed string for cover pages.
    """


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
    string from `V2_PAGE_STAGE_IDS`). Typically `post_transform_crop`; the
    spec permits any stage whose output is an image."""

    split_suffix: str | None = None
    """The user-chosen suffix that gets appended in the page prefix
    (`a`, `b`, `cl`, ...)."""

    reading_order: int = 0
    """Determines output sort order across siblings. Inherited from the
    user's split definition. Defaults to 0 for root pages."""

    # Note: the all-or-none split validator has been removed from PageRecord.
    # PageRecord is a wire-shape model only (API response); the invariant is
    # now enforced by PrepPageExtension (src/pdomain_prep_for_pgdp/core/prep_extension.py).


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
    storage_prefix: str
    archived: bool = False
    # Disk-cost banner fields (M4 spec §Disk-cost banner).
    # Computed on GET /api/data/projects/{id}; zero means "no stage artifacts yet"
    # and the banner hides itself.  `source_zip_bytes` is set once at ingest.
    stage_artifacts_bytes: int = 0
    source_zip_bytes: int = 0
    # Registry version stamp — stage-registry-v2.md §1.
    # 2 for all new projects; 1 for projects created before the B1 re-cut.
    # The guard in core/pipeline/registry_version.py raises RegistryVersionMismatch
    # (HTTP 409) for v1 projects.
    registry_version: int = 2


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

    # ── Stage-settings fields (W1) ────────────────────────────────────────────
    # These carry the effective stage-level settings resolved from StageSettingsStore
    # (override > saved default > registry default).  They are NOT per-page
    # PageConfigOverrides — they are per-stage tunable knobs that the UI exposes
    # via the settings panel and that run_stage merges into cfg before dispatch.

    # denoise (W1.2)
    denoise_min_component_area: int = 6
    """Minimum connected-component area (pixels) kept by denoise_binary.
    Components smaller than this are treated as speckle and removed."""
    denoise_median_kernel_size: int = 0
    """Median filter kernel size for denoise_binary. 0 = disabled."""

    # post_transform_crop (W1.6): (top, bottom, left, right) pixel insets
    post_transform_crop_insets: tuple[int, int, int, int] = (0, 0, 0, 0)
    """Post-transform crop insets in pixels: (top, bottom, left, right).
    Applied after dewarp; default (0,0,0,0) is a pass-through."""


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
    # Per-page stage execution via the async route (?async=true).
    # payload: {"project_id": str, "page_id": str, "stage_id": str, "device": str}  # noqa: ERA001
    run_page_stage = "run_page_stage"
    # Project-scoped stage execution (W0.1 — replaces deprecated build_package /
    # project_run_dirty / project_run_stage_all_pages job types).
    # payload: {"stage_id": str, "device": str}  # noqa: ERA001
    run_project_stage = "run_project_stage"
    # Phase 3: batch-OCR all pages in a project in one predictor call.
    # payload: {"device": str, "batch_size": int|null, "pipeline_slots": int}  # noqa: ERA001
    run_project_ocr_batch = "run_project_ocr_batch"


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


# ─── Registry v2 stage IDs (stage-registry-v2.md §2) ────────────────────────
#
# V2_PAGE_STAGE_IDS / V2_PROJECT_STAGE_IDS are the canonical v2 sets per
# stage-registry-v2.md §2.1-2.2 (B1 re-cut). The v1 PAGE_STAGE_IDS tuple
# was removed at I1 — all production code now uses V2_PAGE_STAGE_IDS.
#
# Order in V2_PAGE_STAGE_IDS matches a valid topological walk of the page-
# scoped subgraph (each stage's page-scoped deps appear before it). Cross-scope
# deps (source → grayscale) are omitted from topological ordering because
# `source` is project-scoped; the page-scoped chain starts at `grayscale`.
#
# The SQLite CHECK constraint for new DBs is built from V2_PAGE_STAGE_IDS.
# Old DBs with v1 stage IDs are invalid by design (breaking change; no
# migration — stage-registry-v2.md §2 note).

V2_PAGE_STAGE_IDS: tuple[str, ...] = (
    "grayscale",
    "crop",
    "threshold",
    "deskew",
    "denoise",
    "dewarp",
    "post_transform_crop",
    "text_zones",
    "canvas_map",
    "post_ocr_crop",
    "ocr",
    "wordcheck",
    "hyphen_join",
    "regex",
    "illustrations",
    "text_review",
)

V2_PROJECT_STAGE_IDS: tuple[str, ...] = (
    "source",
    "page_order",
    "validation",
    "proof_pack",
    "build_package",
    "zip",
    "submit_check",
    "archive",
)


# ─── ProjectStageStatus (api-v2-deltas.md §3) ────────────────────────────────
#
# Distinct from PageStageStatus: project-scoped stages do NOT have a
# `not_applicable` state — all 8 project stages apply to every project.
# Do not alias or reuse PageStageStatus for project-scoped stage fields.


class ProjectStageStatus(str, Enum):
    """Per-project-stage status — api-v2-deltas.md §3.

    No `not_applicable` value: all 8 project stages apply to every project.
    """

    not_run = "not-run"
    running = "running"
    clean = "clean"
    dirty = "dirty"
    failed = "failed"


# ─── ProjectStageState (api-v2-deltas.md §3) ─────────────────────────────────


class ProjectStageState(ApiModel):
    """One project-stage row — state of project-scoped stage `stage_id`.

    Mirrors PageStageState but scoped to a project (no `page_id` field;
    `project_id` is the scope). api-v2-deltas.md §3.
    """

    project_id: str
    stage_id: str  # one of the 8 V2_PROJECT_STAGE_IDS
    status: ProjectStageStatus = ProjectStageStatus.not_run
    stage_version: int = 2
    artifact_key: str | None = None
    config_hash: str | None = None
    input_hash: str | None = None
    last_run_at: float | None = None  # epoch seconds
    duration_ms: int | None = None
    error_message: str | None = None
    job_id: str | None = None


# ─── v2 schema additions on Project ──────────────────────────────────────────
#
# registry_version is stamped at project-creation time (REGISTRY_VERSION = 2
# for new projects). The guard in core/pipeline/registry_version.py raises
# RegistryVersionMismatch (HTTP 409) for v1 projects.
# Default=2 so existing code paths that construct Project(...) without
# this field produce v2 rows; callers that load v1 rows from the DB pass
# registry_version=1 explicitly.


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


# ─── v2 API schemas (api-v2-deltas.md §3) ────────────────────────────────────


class StageRunRequest(ApiModel):
    """Request body for POST .../stages/{stage_id}/run (page and project).

    api-v2-deltas.md §3.
    """

    force: bool = False
    """Re-run even if the stage is already clean. Defaults False."""
    async_: bool = Field(False, alias="async")
    """Return a Job immediately rather than blocking. Always True for project-scoped stages."""

    model_config = ConfigDict(
        json_schema_serialization_defaults_required=True,
        populate_by_name=True,
    )


class PageStageSummary(ApiModel):
    """Per-stage-ID aggregate for PipelineSnapshot.page_stages_summary.

    stale_count resolution (B5): per-stage count of pages where that stage
    is dirty (the straightforward reading of api-v2-deltas.md §1.5 NEEDS_CONTEXT).
    This is the most useful interpretation for pipelineShell — it tells the
    frontend exactly how many pages need re-running for each stage.

    api-v2-deltas.md §3 (Additional schemas).
    """

    stage_id: str
    worst_status: str
    """Worst status across all pages for this stage_id. Enum values from PageStageStatus."""
    stale_count: int
    """Count of pages where this stage has status=dirty."""
    flagged_count: int
    """Count of pages where this stage has status=flagged."""


class ProjectAutomation(ApiModel):
    """Automation toggles embedded in PipelineSnapshot.

    Mirrors the automation context block in pipeline-shell.yaml.
    api-v2-deltas.md §3 (Additional schemas).
    """

    auto_run_after_ingest: bool = False
    rerun_downstream_on_stale: bool = False
    notify_on_error: bool = False
    pause_on_flag_pct: int = 0


class ValidationBlocker(ApiModel):
    """One blocking issue in a ValidationReport. api-v2-deltas.md §3."""

    page_id: str | None = None
    stage_id: str
    message: str
    code: str


class ValidationWarning(ApiModel):
    """One warning in a ValidationReport. api-v2-deltas.md §3."""

    page_id: str | None = None
    stage_id: str
    message: str
    code: str


class ValidationReport(ApiModel):
    """Artifact written by the validation project-stage. api-v2-deltas.md §3."""

    project_id: str
    run_at: datetime
    blockers: list[ValidationBlocker]
    warnings: list[ValidationWarning]
    blocker_count: int
    warning_count: int
    passed: bool


class SubmitCheckReport(ApiModel):
    """Artifact written by the submit_check project-stage. api-v2-deltas.md §3."""

    project_id: str
    run_at: datetime
    zip_sha256: str
    zip_size_bytes: int
    file_count: int
    issues: list[str]
    passed: bool


class PageOrderUpdate(ApiModel):
    """Stored artifact and event payload for page_order stage. api-v2-deltas.md §3."""

    new_order: list[str]
    previous_order: list[str]
    actor_id: str = "default"
    timestamp: datetime = Field(default_factory=lambda: datetime.now(UTC))
