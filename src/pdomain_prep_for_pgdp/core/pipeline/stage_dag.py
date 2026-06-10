"""Per-page stage DAG — single source of truth for stage IDs, edges, and
input/output artifact types.

Spec: `docs/specs/pipeline-task-model.md` §"Per-page stage DAG" (locked
2026-05-07).

Stage IDs are stable strings used as DB keys (in `page_stages.stage_id`),
storage path components (`pages/<page_id>/stages/<stage_id>/output.<ext>`),
and API query strings. The full set is mirrored in
`core.models.PAGE_STAGE_IDS`; that tuple is the source the SQLite CHECK
constraint pins against. Any change here must be reflected there too.

The DAG is hard-coded — there is no plugin layer. Adding a stage requires:

1. Append it to `PAGE_STAGE_IDS` in `core/models.py`.
2. Add a `Stage(...)` row in `_STAGE_DAG_TABLE` below.
3. Bump `STAGE_VERSIONS[stage_id]` in this module (see below).
4. Update the relevant smoke-test in `docs/08-roadmap.md`.

A note on stage count: spec STAGE_VERSIONS table lists 22 stages.
`docs/08-roadmap.md` M1 still says "16-stage registry" — that's stale
roadmap text from before the spec was finalised. The spec is authoritative
and this module enumerates all 22.

## Stage versioning (Q4 lock)

Each stage has an integer version in ``STAGE_VERSIONS`` below. When the
stage's algorithm changes (e.g. after a ``pdomain-book-tools`` upgrade or a
logic fix), bump its value by hand::

    STAGE_VERSIONS["thumbnail"] = 2  # bumped: new resize algorithm

On the next read of a ``page_stages`` row, if ``row.stage_version <
STAGE_VERSIONS[stage_id]``, the row is treated as ``dirty`` regardless
of its stored status.  The next successful stage run overwrites the
version.  ``pgdp-prep reindex --heal`` proactively marks stale rows
``dirty`` without running the stages.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from typing import Literal

# Registry version constant — stage-registry-v2.md §1.
# Stamped on the `projects.registry_version` column at project-creation time.
# Any API access to a project whose registry_version < REGISTRY_VERSION returns
# HTTP 409 via RegistryVersionMismatch (core/pipeline/registry_version.py).
REGISTRY_VERSION: int = 2


@dataclass(frozen=True, slots=True)
class Stage:
    """One per-page DAG stage — immutable.

    Attributes
    ----------
    id
        Stable stage identifier; one of `core.models.PAGE_STAGE_IDS`.
    input_type
        String name of the in-memory artifact type the stage consumes.
        Examples: `"bytes"` (raw source), `"image"` (BGR ndarray), `"binary"`
        (1-channel binary ndarray), `"image+bbox"` (image plus a 4-tuple),
        `"text"`, `"words"`, `"none"` (project-level fan-in only).
    output_type
        String name of the artifact this stage emits. Same naming
        convention as `input_type`.
    depends_on
        Stage IDs whose outputs are direct DAG inputs to this stage.
        Empty tuple for the root (`ingest_source`).
    default_status
        Whether the row should start as `not-run` (most stages) or `clean`
        (stages whose work is implicitly performed by ingest, e.g.
        `ingest_source` itself once a project is uploaded). Persisted state
        in `page_stages` overrides this; this is just the bootstrap value.
    code_pointer
        Best-effort dotted-path-style reference to the function or module
        that implements this stage today. Used by the workbench debug view
        to deep-link the developer; not required to be importable.
    is_terminal
        True iff the stage's output is consumed by `build_package`. Only
        `text_review` and `extract_illustrations` are terminal today.
    """

    id: str
    input_type: str
    output_type: str
    depends_on: tuple[str, ...]
    default_status: Literal["not-run", "clean"]
    code_pointer: str
    is_terminal: bool = False
    any_parent_ok: bool = False
    """When True, at least one clean parent satisfies the dependency check.

    Used for stages with alternative producers — e.g. `ocr_crop` reads
    from *either* `canvas_map` (normal pages) *or* `blank_proof_synth`
    (blank / plate pages). Both parent IDs are listed in `depends_on` so
    dirty-cascade and topo-sort are correct; this flag tells the runner
    not to require all parents to be simultaneously clean.

    The runner picks the *first* clean parent in `depends_on` order.
    """


# The 22 canonical stages. Order mirrors `PAGE_STAGE_IDS`; the DAG is
# acyclic so any topo order is valid, but keeping these aligned simplifies
# assertions in `tests/test_pipeline_dag.py`.
_STAGE_DAG_TABLE: tuple[Stage, ...] = (
    # ── Pre-existing-today (already discrete; just naming them). ────────────
    Stage(
        id="ingest_source",
        input_type="bytes",
        output_type="image_bytes",
        depends_on=(),
        default_status="clean",
        code_pointer="pdomain_prep_for_pgdp.core.ingest:unzip_source",
    ),
    Stage(
        id="thumbnail",
        input_type="image_bytes",
        output_type="jpeg_bytes",
        depends_on=("ingest_source",),
        default_status="not-run",
        code_pointer="pdomain_prep_for_pgdp.core.ingest:_make_thumbnail_bytes",
    ),
    Stage(
        id="auto_detect_attrs",
        input_type="image_bytes",
        output_type="page_attrs",
        depends_on=("ingest_source",),
        default_status="not-run",
        code_pointer="pdomain_prep_for_pgdp.core.auto_detect:auto_detect_page_attrs",
    ),
    Stage(
        id="auto_detect_illustrations",
        input_type="image_bytes",
        output_type="illustration_regions",
        depends_on=("ingest_source",),
        default_status="not-run",
        code_pointer="pdomain_prep_for_pgdp.core.illustrations:auto_detect_illustrations",
    ),
    # ── Per-page pipeline stage DAG. ───────────────────────────────────────
    Stage(
        id="decode_source",
        input_type="image_bytes",
        output_type="image",
        depends_on=("ingest_source",),
        default_status="not-run",
        code_pointer="pdomain_prep_for_pgdp.core.pipeline.process_page:cv2.imdecode",
    ),
    Stage(
        id="initial_crop",
        input_type="image",
        output_type="image",
        depends_on=("decode_source",),
        default_status="not-run",
        code_pointer="pdomain_book_tools.image_processing:crop_edges",
    ),
    Stage(
        id="manual_deskew_pre",
        input_type="image",
        output_type="image",
        depends_on=("initial_crop",),
        default_status="not-run",
        code_pointer="pdomain_book_tools.image_processing:rotate_image",
    ),
    Stage(
        id="grayscale",
        input_type="image",
        output_type="gray",
        depends_on=("manual_deskew_pre",),
        default_status="not-run",
        code_pointer="pdomain_book_tools.image_processing:cv2_convert_to_grayscale",
    ),
    Stage(
        id="threshold",
        input_type="gray",
        output_type="binary",
        depends_on=("grayscale",),
        default_status="not-run",
        code_pointer="pdomain_book_tools.image_processing:otsu_binary_thresh",
    ),
    Stage(
        id="invert",
        input_type="binary",
        output_type="binary",
        depends_on=("threshold",),
        default_status="not-run",
        code_pointer="pdomain_book_tools.image_processing:invert_image",
    ),
    Stage(
        id="find_content_edges",
        input_type="binary",
        output_type="bbox",
        depends_on=("invert",),
        default_status="not-run",
        code_pointer="pdomain_book_tools.image_processing:find_edges",
    ),
    # crop_to_content has TWO parents: it reads `inverted` (image) AND
    # `content_bbox` (4-tuple). Both must be fresh for the crop to be valid.
    Stage(
        id="crop_to_content",
        input_type="binary+bbox",
        output_type="binary",
        depends_on=("invert", "find_content_edges"),
        default_status="not-run",
        code_pointer="pdomain_book_tools.image_processing:crop_to_rectangle",
    ),
    Stage(
        id="auto_deskew",
        input_type="binary",
        output_type="binary",
        depends_on=("crop_to_content",),
        default_status="not-run",
        code_pointer="pdomain_book_tools.image_processing:auto_deskew",
    ),
    Stage(
        id="morph_fill",
        input_type="binary",
        output_type="binary",
        depends_on=("auto_deskew",),
        default_status="not-run",
        code_pointer="pdomain_book_tools.image_processing:morph_fill",
    ),
    Stage(
        id="rescale",
        input_type="binary",
        output_type="image",
        depends_on=("morph_fill",),
        default_status="not-run",
        code_pointer="pdomain_book_tools.image_processing:rescale_image",
    ),
    Stage(
        id="canvas_map",
        input_type="image",
        output_type="image_bytes",  # PNG
        depends_on=("rescale",),
        default_status="not-run",
        code_pointer="pdomain_book_tools.image_processing:map_content_onto_scaled_canvas",
    ),
    # ── Alt to canvas_map for blank-page short-circuit. ────────────────────
    # Per spec §"Blank-page short circuit": for `page_type ∈ {blank, plate_b,
    # plate_r}` the standard image-processing chain is `not-applicable`, and
    # this stage substitutes a synthesised blank PNG. Depends on
    # `auto_detect_attrs` because it reads `page_type` and `page_h_w_ratio`.
    Stage(
        id="blank_proof_synth",
        input_type="page_attrs",
        output_type="image_bytes",  # PNG
        depends_on=("auto_detect_attrs",),
        default_status="not-run",
        code_pointer="pdomain_prep_for_pgdp.core.pipeline.blank_proof:synthesise_blank_proof",
    ),
    # ── Post-Step-4 chain. ──────────────────────────────────────────────────
    # `ocr_crop` consumes `proofing_image`, which is produced by EITHER
    # canvas_map (normal pages) OR blank_proof_synth (blank pages). Per spec:
    # "the DAG is the same downstream of canvas_map / blank_proof_synth (they
    # are the two producers of proofing_image)". Listing both as parents
    # means the runner uses whichever is `clean` for this page.
    Stage(
        id="ocr_crop",
        input_type="image_bytes",
        output_type="image_bytes",
        depends_on=("canvas_map", "blank_proof_synth"),
        default_status="not-run",
        code_pointer="pdomain_prep_for_pgdp.core.pipeline.crop_for_ocr:crop_for_ocr",
        # Either canvas_map (normal pages) or blank_proof_synth (blank pages)
        # is clean for a given page. The runner picks whichever is clean first.
        any_parent_ok=True,
    ),
    Stage(
        id="extract_illustrations",
        input_type="image_bytes+regions",
        output_type="hi_res_crops",
        depends_on=("auto_detect_illustrations",),
        default_status="not-run",
        code_pointer="pdomain_prep_for_pgdp.core.illustrations:extract_illustration",
        is_terminal=True,
    ),
    Stage(
        id="ocr",
        input_type="image_bytes",
        output_type="words+text",
        depends_on=("ocr_crop",),
        default_status="not-run",
        code_pointer="pdomain_prep_for_pgdp.core.ocr:run_ocr",
    ),
    Stage(
        id="text_postprocess",
        input_type="text",
        output_type="text",
        depends_on=("ocr",),
        default_status="not-run",
        code_pointer="pdomain_prep_for_pgdp.core.text_postprocess:postprocess_text",
    ),
    Stage(
        id="text_review",
        input_type="text",
        output_type="text+attestation",
        depends_on=("text_postprocess",),
        default_status="not-run",
        code_pointer="pdomain_prep_for_pgdp.core.pipeline:text_review_gate",
        is_terminal=True,
    ),
)


# Module-level immutable handle. Tests assert exhaustiveness via
# `PAGE_STAGE_IDS`; production callers iterate this for ordered access.
STAGE_DAG: tuple[Stage, ...] = _STAGE_DAG_TABLE

# Per-stage algorithm version registry (Q4 lock).
# Bump a value by hand when the stage's algorithm changes.  The runner and
# route layer check this dict on every row read; stale rows (row.stage_version
# < STAGE_VERSIONS[stage_id]) are treated as dirty so they are rerun.
STAGE_VERSIONS: dict[str, int] = {
    "ingest_source": 1,
    "thumbnail": 1,
    "auto_detect_attrs": 1,
    "auto_detect_illustrations": 1,
    "decode_source": 1,
    "initial_crop": 1,
    "manual_deskew_pre": 1,
    "grayscale": 1,
    "threshold": 1,
    "invert": 1,
    "find_content_edges": 1,
    "crop_to_content": 1,
    "auto_deskew": 1,
    "morph_fill": 1,
    "rescale": 1,
    "canvas_map": 1,
    "blank_proof_synth": 1,
    "ocr_crop": 1,
    "extract_illustrations": 1,
    "ocr": 1,
    "text_postprocess": 1,
    "text_review": 1,
}


# Lookup helpers ---------------------------------------------------------


_BY_ID: dict[str, Stage] = {s.id: s for s in STAGE_DAG}


def get_stage(stage_id: str) -> Stage:
    """Return the Stage with the given id, or raise KeyError."""
    return _BY_ID[stage_id]


def topological_order() -> tuple[Stage, ...]:
    """Return STAGE_DAG in topological order (sources first).

    The hand-authored declaration order in `_STAGE_DAG_TABLE` is already
    a valid topological order, but this function does an explicit Kahn
    sort so the contract holds even if the table is reordered later.
    """
    in_degree = {s.id: len(s.depends_on) for s in STAGE_DAG}
    queue: deque[str] = deque(sid for sid, d in in_degree.items() if d == 0)
    out: list[Stage] = []
    while queue:
        sid = queue.popleft()
        out.append(_BY_ID[sid])
        for child in STAGE_DAG:
            if sid in child.depends_on:
                in_degree[child.id] -= 1
                if in_degree[child.id] == 0:
                    queue.append(child.id)
    if len(out) != len(STAGE_DAG):
        raise RuntimeError("stage DAG has a cycle — check `_STAGE_DAG_TABLE` declarations")
    return tuple(out)


# Stages not-applicable for blank / plate_b / plate_r pages: the full
# image-processing chain is skipped; blank_proof_synth handles the output.
_NOT_APPLICABLE_BLANK: frozenset[str] = frozenset(
    {
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
    }
)

# Stages not-applicable for plate_p pages: extract_illustrations is the
# meaningful output; OCR / text stages are skipped.
_NOT_APPLICABLE_PLATE_P: frozenset[str] = frozenset(
    {
        "ocr_crop",
        "ocr",
        "text_postprocess",
        "text_review",
    }
)


def not_applicable_stages_for_page_type(page_type: str) -> frozenset[str]:
    """Return stage IDs that are not-applicable for the given page type string.

    For blank / plate_b / plate_r: the image-processing chain is skipped.
    For plate_p: the OCR / text chain is skipped.
    For normal (or unknown): returns empty frozenset.
    """
    if page_type in {"blank", "plate_b", "plate_r"}:
        return _NOT_APPLICABLE_BLANK
    if page_type == "plate_p":
        return _NOT_APPLICABLE_PLATE_P
    return frozenset()


def compute_dirty_descendants(stage_id: str) -> frozenset[str]:  # v1 — page-scoped only
    """Return the transitive set of stage IDs downstream of ``stage_id``.

    A re-run of `stage_id` (or any change to its config / input fingerprint)
    must mark these as `dirty`. The returned set does NOT include
    `stage_id` itself.

    Raises ``KeyError`` if ``stage_id`` is not in the DAG.
    """
    if stage_id not in _BY_ID:
        raise KeyError(stage_id)

    # BFS over the reverse-adjacency view: which stages have `stage_id`
    # (or one of its descendants) as a dependency?
    children: dict[str, list[str]] = {sid: [] for sid in _BY_ID}
    for s in STAGE_DAG:
        for parent in s.depends_on:
            children[parent].append(s.id)

    seen: set[str] = set()
    queue: deque[str] = deque(children[stage_id])
    while queue:
        sid = queue.popleft()
        if sid in seen:
            continue
        seen.add(sid)
        for grandchild in children[sid]:
            if grandchild not in seen:
                queue.append(grandchild)
    return frozenset(seen)


# ─── Registry v2 DAG (stage-registry-v2.md §2) ──────────────────────────────
#
# The 24 v2 stages replace the 22 v1 micro-stages. Both DAGs coexist in this
# module during the B1-B5 transition; v1 STAGE_DAG is retained for backward
# compat with tests and DB rows that haven't been migrated. All new code uses
# V2_STAGE_DAG.
#
# Key differences from v1:
# - Scope field: "page" (16 stages) or "project" (8 stages).
# - Group field: "Source" | "Image prep" | "OCR" | "Compose" | "Text" | "Pack".
# - Cross-scope deps: e.g. grayscale depends on "source" (project-scoped).
#   compute_v2_dirty_descendants traverses these edges so a project-scope
#   re-run can mark page-scope descendants dirty and vice-versa.
# - blank_proof_synth is folded into canvas_map (internal branch). Not a
#   separate stage in v2.
# - The v2 DAG has no `any_parent_ok` — blank-page logic is canvas_map-internal.


@dataclass(frozen=True, slots=True)
class V2Stage:
    """One v2 DAG stage — immutable.

    Attributes
    ----------
    id
        Stable stage identifier — one of V2_PAGE_STAGE_IDS or V2_PROJECT_STAGE_IDS.
    scope
        "page" for per-page stages; "project" for project-scoped stages.
    group
        Launcher group: one of Source / Image prep / OCR / Compose / Text / Pack.
    depends_on
        Direct DAG parents (dirty-propagation edges). May include cross-scope deps.
    input_type
        Artifact type consumed. "none" for root stages (source).
    output_type
        Artifact type produced.
    is_terminal
        True iff this is a terminal stage with no downstream in v2 (archive only).
    """

    id: str
    scope: Literal["page", "project"]
    group: str
    depends_on: tuple[str, ...]
    input_type: str
    output_type: str
    is_terminal: bool = False


_V2_STAGE_DAG_TABLE: tuple[V2Stage, ...] = (
    # ── Project-scoped stages ────────────────────────────────────────────────
    V2Stage(
        id="source",
        scope="project",
        group="Source",
        depends_on=(),
        input_type="none",
        output_type="page_attrs",
    ),
    # ── Page-scoped: Image prep chain ────────────────────────────────────────
    # grayscale absorbs: manual_deskew_pre (pre-crop flip/rotate component)
    V2Stage(
        id="grayscale",
        scope="page",
        group="Image prep",
        depends_on=("source",),  # cross-scope: source must be clean
        input_type="image_bytes",
        output_type="gray",
    ),
    # crop absorbs: initial_crop + find_content_edges + crop_to_content
    V2Stage(
        id="crop",
        scope="page",
        group="Image prep",
        depends_on=("grayscale",),
        input_type="gray",
        output_type="binary",
    ),
    # threshold absorbs: threshold + invert
    V2Stage(
        id="threshold",
        scope="page",
        group="Image prep",
        depends_on=("crop",),
        input_type="binary",
        output_type="binary",
    ),
    # deskew absorbs: manual_deskew_pre (post-crop rotation) + auto_deskew
    V2Stage(
        id="deskew",
        scope="page",
        group="Image prep",
        depends_on=("threshold",),
        input_type="binary",
        output_type="binary",
    ),
    # denoise: new stage (no legacy counterpart; algo in pdomain-book-tools B2)
    V2Stage(
        id="denoise",
        scope="page",
        group="Image prep",
        depends_on=("deskew",),
        input_type="binary",
        output_type="binary",
    ),
    # dewarp: new stage (uses GeometryPipeline from pdomain-book-tools)
    V2Stage(
        id="dewarp",
        scope="page",
        group="Image prep",
        depends_on=("denoise",),
        input_type="binary",
        output_type="binary",
    ),
    # post_transform_crop: new stage (user-reviewable pre-canvas crop point)
    V2Stage(
        id="post_transform_crop",
        scope="page",
        group="Image prep",
        depends_on=("dewarp",),
        input_type="binary",
        output_type="binary",
    ),
    # canvas_map absorbs: morph_fill + rescale + legacy canvas_map + blank_proof_synth branch
    V2Stage(
        id="canvas_map",
        scope="page",
        group="Compose",
        depends_on=("post_transform_crop",),
        input_type="binary",
        output_type="image_bytes",
    ),
    # text_zones: new stage (zone detection was inside process_page monolith)
    V2Stage(
        id="text_zones",
        scope="page",
        group="OCR",
        depends_on=("post_transform_crop",),
        input_type="binary",
        output_type="zone_json",
    ),
    # post_ocr_crop absorbs: legacy ocr_crop (OCR-margin trim)
    V2Stage(
        id="post_ocr_crop",
        scope="page",
        group="Image prep",
        depends_on=("canvas_map",),
        input_type="image_bytes",
        output_type="image_bytes",
    ),
    # ocr: re-keyed from v1 ocr
    V2Stage(
        id="ocr",
        scope="page",
        group="OCR",
        depends_on=("post_ocr_crop",),
        input_type="image_bytes",
        output_type="words+text",
    ),
    # wordcheck: new stage (scanno/word-list checking split from text_postprocess)
    V2Stage(
        id="wordcheck",
        scope="page",
        group="Text",
        depends_on=("ocr",),
        input_type="words+text",
        output_type="text",
    ),
    # hyphen_join: new stage
    V2Stage(
        id="hyphen_join",
        scope="page",
        group="Text",
        depends_on=("wordcheck",),
        input_type="text",
        output_type="text",
    ),
    # regex: re-keyed from text_postprocess
    V2Stage(
        id="regex",
        scope="page",
        group="Text",
        depends_on=("hyphen_join",),
        input_type="text",
        output_type="text",
    ),
    # text_review: re-keyed from v1 text_review; deps: hyphen_join + regex
    V2Stage(
        id="text_review",
        scope="page",
        group="Text",
        depends_on=("hyphen_join", "regex"),
        input_type="text",
        output_type="text+attestation",
    ),
    # illustrations absorbs: auto_detect_illustrations + extract_illustrations
    # depends on source (cross-scope) for thumbnail artifact
    V2Stage(
        id="illustrations",
        scope="page",
        group="Compose",
        depends_on=("source",),  # cross-scope: thumbnail from source
        input_type="image_bytes",
        output_type="hi_res_crops",
    ),
    # ── Project-scoped: ordering + validation + pack chain ───────────────────
    # page_order: new stage (drag-drop reorder was UI-only in v1)
    # cross-scope deps: source (project) + text_zones (all pages settled)
    V2Stage(
        id="page_order",
        scope="project",
        group="Compose",
        depends_on=("source", "text_zones"),
        input_type="none",
        output_type="text",
    ),
    # validation: new stage (aggregates page flags → blockers/warnings report)
    # cross-scope deps: text_review (all pages) + illustrations (all pages) + page_order
    V2Stage(
        id="validation",
        scope="project",
        group="Pack",
        depends_on=("text_review", "illustrations", "page_order"),
        input_type="none",
        output_type="validation_report",
    ),
    # proof_pack: new stage
    V2Stage(
        id="proof_pack",
        scope="project",
        group="Pack",
        depends_on=("validation",),
        input_type="validation_report",
        output_type="proof_bundle",
    ),
    # build_package: re-cut from v1 (was page-scoped + implicit gate)
    V2Stage(
        id="build_package",
        scope="project",
        group="Pack",
        depends_on=("proof_pack",),
        input_type="proof_bundle",
        output_type="submission_zip",
    ),
    # zip: new stage (was part of build_package)
    V2Stage(
        id="zip",
        scope="project",
        group="Pack",
        depends_on=("build_package",),
        input_type="submission_zip",
        output_type="submission_zip",
    ),
    # submit_check: new stage (dry-run validation before archive)
    V2Stage(
        id="submit_check",
        scope="project",
        group="Pack",
        depends_on=("zip",),
        input_type="submission_zip",
        output_type="archive_manifest",
    ),
    # archive: new stage (terminal)
    V2Stage(
        id="archive",
        scope="project",
        group="Pack",
        depends_on=("submit_check",),
        input_type="archive_manifest",
        output_type="archive_manifest",
        is_terminal=True,
    ),
)

# Immutable handle to the v2 DAG.
V2_STAGE_DAG: tuple[V2Stage, ...] = _V2_STAGE_DAG_TABLE

_V2_BY_ID: dict[str, V2Stage] = {s.id: s for s in V2_STAGE_DAG}


def get_v2_stage(stage_id: str) -> V2Stage:
    """Return the V2Stage with the given id, or raise KeyError."""
    return _V2_BY_ID[stage_id]


def compute_v2_dirty_descendants(stage_id: str) -> frozenset[str]:
    """Return the transitive set of v2 stage IDs downstream of ``stage_id``.

    Unlike v1's compute_dirty_descendants, this traverses cross-scope edges:
    a page-scoped stage re-run can mark project-scoped descendants dirty and
    vice-versa. The returned set does NOT include ``stage_id`` itself.

    Raises ``KeyError`` if ``stage_id`` is not in the v2 DAG.
    """
    if stage_id not in _V2_BY_ID:
        raise KeyError(stage_id)

    # Build reverse-adjacency (children) map across all 24 v2 stages.
    children: dict[str, list[str]] = {s.id: [] for s in V2_STAGE_DAG}
    for s in V2_STAGE_DAG:
        for parent in s.depends_on:
            if parent in children:
                children[parent].append(s.id)

    seen: set[str] = set()
    queue: deque[str] = deque(children[stage_id])
    while queue:
        sid = queue.popleft()
        if sid in seen:
            continue
        seen.add(sid)
        for grandchild in children[sid]:
            if grandchild not in seen:
                queue.append(grandchild)
    return frozenset(seen)
