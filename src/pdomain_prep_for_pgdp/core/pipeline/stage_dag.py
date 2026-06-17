"""Stage DAG v2 — 24-stage registry (16 page-scoped + 8 project-scoped).

Spec: `docs/specs/stage-registry-v2.md` §2 (canonical v2 stage table).
      `docs/specs/pipeline-task-model.md` §"Per-page stage DAG" (locked 2026-05-07).

Stage IDs are stable strings used as DB keys (in `page_stages.stage_id`
and `project_stages.stage_id`), storage path components
(`projects/<id>/pages/<page_id>/stages/<stage_id>/output.<ext>`), and API
query strings.

The v1 22-stage STAGE_DAG was removed at R3 (W6.3 leftovers). All v1
projects are blocked at the HTTP 409 registry-version gate, so no active
code path reaches v1 stage IDs.

## Stage versioning (Q4 lock)

Each v2 page stage stores a ``stage_version`` integer in the ``page_stages``
DB row; project stages use a fixed default of 2. When the stage algorithm
changes, update the caller to write a new version. ``pgdp-prep reindex
--heal`` proactively marks stale rows ``dirty`` without running the stages.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from typing import Literal

# Registry version constant — stage-registry-v2.md §1.
# Stamped on the `projects.registry_version` column at project-creation time.
# Any API access to a project whose registry_version < REGISTRY_VERSION triggers
# the auto re-derive migration (core/pipeline/registry_version.py +
# core/numbering_migration.py), then proceeds.
#
# v3 (P1.9): page numbering moved from ProjectConfig frontmatter/bodymatter
# RANGES to the NumberingRun runs model.  The v2->v3 migration seeds runs from
# the (now deleted) ranges read out of the raw stored config blob and stamps
# per-page leaf_role/run_id/plate_side.
REGISTRY_VERSION: int = 3


# ─── Registry v2 DAG (stage-registry-v2.md §2) ──────────────────────────────
#
# The 24 v2 stages replace the 22 v1 micro-stages. The v1 STAGE_DAG was
# removed at R3 (W6.3). All v1 projects receive HTTP 409.
#
# Key differences from v1:
# - Scope field: "page" (16 stages) or "project" (8 stages).
# - Group field: "Source" | "Image prep" | "OCR" | "Compose" | "Text" | "Pack".
# - Cross-scope deps: e.g. grayscale depends on "source" (project-scoped).
#   compute_v2_dirty_descendants traverses these edges so a project-scope
#   re-run can mark page-scope descendants dirty and vice-versa.


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

# Per-stage algorithm version registry (Q4 lock).
# Bump a value by hand when the stage's algorithm changes. The runner and
# route layer check this dict on every row read; stale rows
# (row.stage_version < V2_STAGE_VERSIONS[stage_id]) are treated as dirty.
# All v2 stages start at version 1.
V2_STAGE_VERSIONS: dict[str, int] = {s.id: 1 for s in V2_STAGE_DAG}

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
