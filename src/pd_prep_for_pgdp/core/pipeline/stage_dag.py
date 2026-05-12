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
3. Bump `STAGE_VERSIONS[stage_id]` in `core/pipeline/registry.py` (M2).
4. Update the relevant smoke-test in `docs/08-roadmap.md`.

A note on stage count: spec STAGE_VERSIONS table lists 22 stages.
`docs/08-roadmap.md` M1 still says "16-stage registry" — that's stale
roadmap text from before the spec was finalised. The spec is authoritative
and this module enumerates all 22.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from typing import Literal


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
        code_pointer="pd_prep_for_pgdp.core.ingest:unzip_source",
    ),
    Stage(
        id="thumbnail",
        input_type="image_bytes",
        output_type="jpeg_bytes",
        depends_on=("ingest_source",),
        default_status="not-run",
        code_pointer="pd_prep_for_pgdp.core.ingest:_make_thumbnail_bytes",
    ),
    Stage(
        id="auto_detect_attrs",
        input_type="image_bytes",
        output_type="page_attrs",
        depends_on=("ingest_source",),
        default_status="not-run",
        code_pointer="pd_prep_for_pgdp.core.auto_detect:auto_detect_page_attrs",
    ),
    Stage(
        id="auto_detect_illustrations",
        input_type="image_bytes",
        output_type="illustration_regions",
        depends_on=("ingest_source",),
        default_status="not-run",
        code_pointer="pd_prep_for_pgdp.core.illustrations:auto_detect_illustrations",
    ),
    # ── Decomposed from process_page_cpu (4c-4o). ──────────────────────────
    Stage(
        id="decode_source",
        input_type="image_bytes",
        output_type="image",
        depends_on=("ingest_source",),
        default_status="not-run",
        code_pointer="pd_prep_for_pgdp.core.pipeline.process_page:cv2.imdecode",
    ),
    Stage(
        id="initial_crop",
        input_type="image",
        output_type="image",
        depends_on=("decode_source",),
        default_status="not-run",
        code_pointer="pd_book_tools.image_processing:crop_edges",
    ),
    Stage(
        id="manual_deskew_pre",
        input_type="image",
        output_type="image",
        depends_on=("initial_crop",),
        default_status="not-run",
        code_pointer="pd_book_tools.image_processing:rotate_image",
    ),
    Stage(
        id="grayscale",
        input_type="image",
        output_type="gray",
        depends_on=("manual_deskew_pre",),
        default_status="not-run",
        code_pointer="pd_book_tools.image_processing:cv2_convert_to_grayscale",
    ),
    Stage(
        id="threshold",
        input_type="gray",
        output_type="binary",
        depends_on=("grayscale",),
        default_status="not-run",
        code_pointer="pd_book_tools.image_processing:otsu_binary_thresh",
    ),
    Stage(
        id="invert",
        input_type="binary",
        output_type="binary",
        depends_on=("threshold",),
        default_status="not-run",
        code_pointer="pd_book_tools.image_processing:invert_image",
    ),
    Stage(
        id="find_content_edges",
        input_type="binary",
        output_type="bbox",
        depends_on=("invert",),
        default_status="not-run",
        code_pointer="pd_book_tools.image_processing:find_edges",
    ),
    # crop_to_content has TWO parents: it reads `inverted` (image) AND
    # `content_bbox` (4-tuple). Both must be fresh for the crop to be valid.
    Stage(
        id="crop_to_content",
        input_type="binary+bbox",
        output_type="binary",
        depends_on=("invert", "find_content_edges"),
        default_status="not-run",
        code_pointer="pd_book_tools.image_processing:crop_to_rectangle",
    ),
    Stage(
        id="auto_deskew",
        input_type="binary",
        output_type="binary",
        depends_on=("crop_to_content",),
        default_status="not-run",
        code_pointer="pd_book_tools.image_processing:auto_deskew",
    ),
    Stage(
        id="morph_fill",
        input_type="binary",
        output_type="binary",
        depends_on=("auto_deskew",),
        default_status="not-run",
        code_pointer="pd_book_tools.image_processing:morph_fill",
    ),
    Stage(
        id="rescale",
        input_type="binary",
        output_type="image",
        depends_on=("morph_fill",),
        default_status="not-run",
        code_pointer="pd_book_tools.image_processing:rescale_image",
    ),
    Stage(
        id="canvas_map",
        input_type="image",
        output_type="image_bytes",  # PNG
        depends_on=("rescale",),
        default_status="not-run",
        code_pointer="pd_book_tools.image_processing:map_content_onto_scaled_canvas",
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
        code_pointer="pd_prep_for_pgdp.core.pipeline.blank_proof:synthesise_blank_proof",
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
        code_pointer="pd_prep_for_pgdp.core.pipeline.crop_for_ocr:crop_for_ocr",
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
        code_pointer="pd_prep_for_pgdp.core.illustrations:extract_illustration",
        is_terminal=True,
    ),
    Stage(
        id="ocr",
        input_type="image_bytes",
        output_type="words+text",
        depends_on=("ocr_crop",),
        default_status="not-run",
        code_pointer="pd_prep_for_pgdp.core.ocr:run_ocr",
    ),
    Stage(
        id="text_postprocess",
        input_type="text",
        output_type="text",
        depends_on=("ocr",),
        default_status="not-run",
        code_pointer="pd_prep_for_pgdp.core.text_postprocess:postprocess_text",
    ),
    Stage(
        id="text_review",
        input_type="text",
        output_type="text+attestation",
        depends_on=("text_postprocess",),
        default_status="not-run",
        code_pointer="pd_prep_for_pgdp.core.pipeline:text_review_gate",
        is_terminal=True,
    ),
)


# Module-level immutable handle. Tests assert exhaustiveness via
# `PAGE_STAGE_IDS`; production callers iterate this for ordered access.
STAGE_DAG: tuple[Stage, ...] = _STAGE_DAG_TABLE


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


def compute_dirty_descendants(stage_id: str) -> frozenset[str]:
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
