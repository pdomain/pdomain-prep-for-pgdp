"""`run_stage` — per-page stage execution engine for the granular DAG.

Spec: `docs/specs/pipeline-task-model.md` §"Per-page stage runner" /
§"Dirty propagation" (Q2) / §"Persistence model" (Q3 + Q9) / §"Q5 —
STAGE_IMPL registry" / §"Q10 — device-aware in-memory artifacts"
(all locked 2026-05-07).

The runner is the **single load-bearing function** that the route
handler / job dispatcher / smoke tests all funnel through. It owns the
`(running → clean | failed)` state transition for one stage on one page,
and the eager dirty cascade that follows on success.

## Sequence

1. Validate every `Stage.depends_on` row is `clean`. Else raise
   `StageDependenciesNotMet` with the offending stage_ids — the caller
   decides whether to recursively run them or surface the dep gap to
   the user.
2. Mark the page_stages row `running` and commit. The GET endpoint
   sees the transition immediately.
3. Load each parent's clean artifact off disk. For image-typed parents,
   decode bytes → ndarray. For json-typed parents, parse. For compound-
   output parents (e.g. `ocr`), scan the stage dir and return the first
   `output.*` file.
4. Look up `STAGE_IMPL[stage_id][device]` (cpu by default).
5. Call it with the loaded input(s).
6. Encode the output and dual-write:
   - Compound-output stages (output_type in COMPOUND_OUTPUT_TYPES):
     impl returns dict[str, bytes]; runner calls
     `commit_stage_artifacts_multi` with all files atomically.
   - Single-file stages: encode (PNG/JSON/text/bytes) then call
     `commit_stage_artifact` with the single artifact bytes.
7. Cascade dirty: `compute_v2_dirty_descendants(stage_id)` returns the
   transitive set of stage_ids downstream. For each one currently
   `clean` or `failed`, set status `dirty`. Rows already `not-run` or
   `dirty` stay as-is.
8. Return the new `PageStageState`.

## Failure model

- `StageDependenciesNotMet`: dep rows aren't `clean`. Raised before any
  state mutation; row stays `not-run` / whatever it was.
- `StageRunFailed`: the registered impl (or the encode/write step)
  raised. The runner catches, marks the row `failed` with the
  exception message, then re-raises wrapped in `StageRunFailed`.
  **No dirty cascade on failure** — the previous output, if any, is
  still consistent.
- `StageNotImplemented` from the registry is caught by the same
  failure path; the error_message captures the registry's
  "not yet implemented in registry" wording so the chip rail's
  tooltip explains itself.
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import json
import logging
from time import time
from typing import TYPE_CHECKING, cast

import cv2
import numpy as np

from pdomain_prep_for_pgdp.core.models import (
    V2_PAGE_STAGE_IDS,
    V2_PROJECT_STAGE_IDS,
    PageRecord,
    PageStageState,
    PageStageStatus,
    ResolvedPageConfig,
)
from pdomain_prep_for_pgdp.core.page_service_helpers import (
    _get_page_agg_and_ext,
    get_page_record,
    list_page_records_by_parent_id,
)
from pdomain_prep_for_pgdp.core.stage_events import (
    StageEventBroker,
    project_page_stage_events_key,
    stage_events_key,
)

from . import stage_dag as _stage_dag_module
from .page_stage_writer import (
    COMPOUND_OUTPUT_TYPES,
    COMPOUND_PRIMARY_FILENAME,
    StageArtifactWriteError,
    commit_stage_artifact,
    commit_stage_artifacts_multi,
    compute_content_hash,
    make_stage_thumbnail_bytes,
    stage_artifact_key,
    stage_artifact_path,
    stage_thumbnail_path,
)
from .stage_dag import (
    compute_v2_dirty_descendants,
    get_v2_stage,
)
from .stage_registry import (
    CompoundStageOutput,
    ImageArray,
    JsonStageOutput,
    PageAttrsOutput,
    StageArtifact,
    StageImpl,
    StageNotImplemented,
    default_resolved_page_config,
    get_stage_impl,
)
from .stage_write_executor import StageWriteExecutor, write_artifact_file_async

if TYPE_CHECKING:
    import uuid as uuid_mod
    from pathlib import Path

    from pdomain_prep_for_pgdp.adapters.database.base import IDatabase
    from pdomain_prep_for_pgdp.adapters.storage.base import IStorage
    from pdomain_prep_for_pgdp.core.page_store_factory import PageService
    from pdomain_prep_for_pgdp.core.prep_extension import PrepPageExtension


def load_page_extension_from_store(
    service: PageService,
    page_id: uuid_mod.UUID,
) -> PrepPageExtension | None:
    """Load a PrepPageExtension from the event store by page UUID."""
    from pdomain_ops.pages import get_extension as _ops_get_ext

    from pdomain_prep_for_pgdp.core.prep_extension import PrepPageExtension as _PrepExt

    page_agg = service.store.get_page(page_id)
    return _ops_get_ext(page_agg.record, "prep", _PrepExt)


# output_type values that are serialised as JSON rather than PNG.
_JSON_OUTPUT_TYPES: frozenset[str] = frozenset({"bbox", "page_attrs", "illustration_regions"})

# output_type values that are ndarrays and must be PNG-encoded.
_IMAGE_OUTPUT_TYPES: frozenset[str] = frozenset({"image", "gray", "binary", "image_bytes"})

# output_type values where the impl returns raw bytes (already encoded).
# The runner writes these verbatim — no PNG or JSON round-trip.
# `jpeg_bytes` (thumbnail stage): impl returns JPEG bytes from cv2.imencode.
_PASSTHROUGH_BYTES_OUTPUT_TYPES: frozenset[str] = frozenset({"jpeg_bytes"})

log = logging.getLogger(__name__)


async def _emit(
    broker: StageEventBroker | None,
    project_id: str,
    page_id: str,
    event_type: str,
    stage_id: str,
    status: str,
    *,
    extra: dict[str, object] | None = None,
) -> None:
    if broker is None:
        return
    payload: dict[str, object] = {"type": event_type, "stage_id": stage_id, "status": status}
    if extra:
        payload.update(extra)
    # Publish to the per-page channel (keyed by project_id:page_id).
    per_page_key = stage_events_key(project_id, page_id)
    await broker.publish(per_page_key, payload)
    # Also publish to the project-wide page-stage channel so a single
    # subscriber can receive completions for all pages without N connections.
    project_key = project_page_stage_events_key(project_id)
    await broker.publish(project_key, payload)


# ─── Typed exceptions ───────────────────────────────────────────────────────


class StageDependenciesNotMet(RuntimeError):  # noqa: N818  # intentional: signals unmet deps, not an error state
    """Raised before any mutation when one or more `depends_on` rows are not `clean`.

    The exception's args[0] message names the offending stage_ids; programmatic
    consumers can read `.missing` for the typed list.
    """

    stage_id: str
    missing: list[str]

    def __init__(self, stage_id: str, missing: list[str]) -> None:
        self.stage_id = stage_id
        self.missing = missing
        super().__init__(f"stage {stage_id!r}: dependencies not clean; missing or non-clean: {missing}")


class StageOutputUnsupported(RuntimeError):  # noqa: N818  # stable route-layer API name; renaming would break callers
    """Formerly raised when a compound-output stage was attempted before the
    multi-artifact writer existed (Slice 3 era). Retained for API route
    compatibility (`pages.py` catches it → 501); the runner no longer raises
    it since Slice 14 added `commit_stage_artifacts_multi`.
    """


class StageRunFailed(RuntimeError):  # noqa: N818  # intentional: describes the event (run failed), caught by route handlers
    """Raised when the registered impl or the dual-write commit failed.

    The page_stages row will already have been marked `failed` by the
    runner (with the underlying exception's text in `error_message`)
    before this is raised. Q9: fail loudly — the route handler / dispatcher
    is expected to surface this to the user, not swallow it.
    """


# ─── Config-field mapping ────────────────────────────────────────────────────

# Maps stage_id → set of ResolvedPageConfig field names the stage reads.
# Used for two purposes:
#   1. cascade_dirty_for_config_change: dirty only stages whose fields changed.
#   2. _compute_config_hash: include only relevant fields in the hash so
#      reindex --heal can detect config-driven staleness.
# Stages absent from this map read no per-page config fields.
#
# W1 note: stage-settings fields (denoise_min_component_area, etc.) are listed
# here alongside per-page PageConfigOverrides fields.  A settings change
# causes _compute_config_hash to differ → triggers dirty cascade → re-run
# uses the new effective value.
STAGE_CONFIG_FIELDS: dict[str, frozenset[str]] = {
    "initial_crop": frozenset({"initial_crop"}),
    "manual_deskew_pre": frozenset({"deskew_before_crop", "flip_horizontal", "flip_vertical"}),
    "threshold": frozenset({"threshold_level"}),
    "find_content_edges": frozenset({"fuzzy_pct", "pixel_count_columns", "pixel_count_rows"}),
    # crop (v2: absorbs initial_crop + find_content_edges + crop_to_content)
    "crop": frozenset({"white_space_additional", "initial_crop"}),
    "crop_to_content": frozenset({"white_space_additional"}),
    # deskew (v2: absorbs manual_deskew_pre post-crop + auto_deskew)
    "deskew": frozenset({"skip_auto_deskew", "deskew_after_crop"}),
    "auto_deskew": frozenset({"skip_auto_deskew", "deskew_after_crop"}),
    # denoise (W1.2): stage-settings fields in ResolvedPageConfig
    "denoise": frozenset({"denoise_min_component_area", "denoise_median_kernel_size", "skip_denoise"}),
    # canvas_map (v2: absorbs morph_fill + rescale + canvas_map)
    "canvas_map": frozenset({"do_morph", "single_dimension_rescale", "page_h_w_ratio", "alignment"}),
    "morph_fill": frozenset({"do_morph"}),
    "rescale": frozenset({"single_dimension_rescale"}),
    # post_transform_crop (W1.6): new stage-settings field
    "post_transform_crop": frozenset({"post_transform_crop_insets"}),
    # post_ocr_crop (v2 name) + legacy ocr_crop (v1 name): both map ocr_crop
    "post_ocr_crop": frozenset({"ocr_crop", "rotated_standard"}),
    "ocr_crop": frozenset({"rotated_standard"}),
    "ocr": frozenset({"use_ocr_bbox_edge"}),
    # grayscale (Wave-2): the resolved GrayscaleConfigModel field on ResolvedPageConfig.
    # A settings change on the nested pipeline config → config hash differs → dirty cascade.
    "grayscale": frozenset({"grayscale"}),
}


def _compute_config_hash(cfg: ResolvedPageConfig, stage_id: str) -> str | None:
    """sha256 of the resolved config fields relevant to ``stage_id``.

    Returns ``None`` when ``stage_id`` has no entry in ``STAGE_CONFIG_FIELDS``
    (no config fields → no config hash needed for reconciliation).
    """
    fields = STAGE_CONFIG_FIELDS.get(stage_id)
    if not fields:
        return None
    subset = {f: getattr(cfg, f) for f in sorted(fields)}
    return hashlib.sha256(json.dumps(subset, default=str).encode()).hexdigest()


async def cascade_dirty_for_config_change(
    *,
    database: IDatabase,
    project_id: str,
    page_id: str,
    changed_fields: set[str],
) -> None:
    """Dirty stages whose config-field sets overlap with ``changed_fields``, plus
    all of their transitive descendants.

    Called by the ``PATCH /pages/{idx0}`` route when ``config_overrides`` changes
    so the chip rail reflects the stale state immediately without waiting for
    ``reindex --heal``.

    Rows already ``dirty`` or ``not-run`` are left unchanged; only ``clean`` and
    ``failed`` rows are flipped.
    """
    directly_affected = {sid for sid, fields in STAGE_CONFIG_FIELDS.items() if fields & changed_fields}
    if not directly_affected:
        return

    to_dirty: set[str] = set()
    for sid in directly_affected:
        to_dirty.add(sid)
        to_dirty.update(compute_v2_dirty_descendants(sid))

    rows = await database.list_page_stages_for_page(project_id, page_id)
    for row in rows:
        if row.stage_id not in to_dirty:
            continue
        if row.status not in {PageStageStatus.clean, PageStageStatus.failed}:
            continue
        await database.put_page_stage(row.model_copy(update={"status": PageStageStatus.dirty}))


async def _resolve_config(
    *,
    database: IDatabase,
    project_id: str,
    page_id: str,
    page_service: PageService | None = None,
) -> ResolvedPageConfig:
    """Load page + project + system defaults from DB and resolve to a
    ``ResolvedPageConfig``.

    Falls back to ``_default_resolved_page_config()`` (all-default values) when
    any DB lookup returns ``None`` — this keeps existing tests that don't seed
    project/page records working without modification.
    """
    from pdomain_prep_for_pgdp.core.config_resolver import resolve_page_config

    project = await database.get_project(project_id)
    if project is None:
        return default_resolved_page_config()

    try:
        idx0 = int(page_id)
    except ValueError:
        return default_resolved_page_config()

    # Look up the page from the event store (page_service) when available;
    # page_service is built from data_root in run_stage and cascaded to callers.
    page: PageRecord | None = None
    if page_service is not None:
        page = get_page_record(page_service, project_id, idx0)
    if page is None:
        return default_resolved_page_config()

    system = await database.get_system_defaults(project.owner_id)
    return resolve_page_config(system, project.config, page)


# ─── Helpers ────────────────────────────────────────────────────────────────


def _decode_image_bytes(data: bytes) -> np.ndarray:
    """Decode PNG / JPEG bytes to a BGR ndarray for cv2-style stages.

    For grayscale/binary parents whose on-disk PNG is single-channel,
    cv2.imdecode auto-detects the channel count when called with
    ``IMREAD_UNCHANGED``. Stages downstream of `grayscale` (e.g.
    `threshold`, `invert`) take 2-D arrays; stages upstream
    (`manual_deskew_pre` → `grayscale`) take 3-D BGR — but Slice 3
    only runs the three implemented stages, so we use UNCHANGED to
    accommodate both single- and 3-channel parents.
    """
    arr = np.frombuffer(data, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_UNCHANGED)
    if img is None:
        raise ValueError("cv2.imdecode returned None — corrupt or empty image bytes")
    return cast("ImageArray", img)


def _encode_image_to_png(img: np.ndarray) -> bytes:
    """Encode an ndarray (2-D or 3-D) to PNG bytes."""
    ok, buf = cv2.imencode(".png", img)
    if not ok:
        raise RuntimeError("cv2.imencode failed for stage output")
    return bytes(buf.tobytes())


def _decode_json_output(raw: bytes, output_type: str) -> JsonStageOutput:
    parsed = cast("object", json.loads(raw))
    if output_type == "bbox":
        if not isinstance(parsed, list):
            raise TypeError(f"expected bbox list for output_type={output_type!r}")
        parsed_list = cast("list[object]", parsed)
        if len(parsed_list) != 4:
            raise TypeError(f"expected bbox list for output_type={output_type!r}")
        if not all(isinstance(v, int) for v in parsed_list):
            raise TypeError(f"expected integer bbox values for output_type={output_type!r}")
        left, right, top, bottom = parsed_list
        return cast("JsonStageOutput", (left, right, top, bottom))
    if output_type == "page_attrs":
        if not isinstance(parsed, dict):
            raise TypeError(f"expected dict for output_type={output_type!r}")
        return cast("PageAttrsOutput", cast("object", parsed))
    if output_type == "illustration_regions":
        if not isinstance(parsed, list):
            raise TypeError(f"expected list for output_type={output_type!r}")
        return cast("JsonStageOutput", parsed)
    raise ValueError(f"unsupported JSON output_type {output_type!r}")


def _require_image_artifact(value: StageArtifact, *, stage_id: str) -> ImageArray:
    if not isinstance(value, np.ndarray):
        raise TypeError(f"stage {stage_id!r} expected an image artifact, got {type(value).__name__}")
    return value


def _require_compound_output(value: StageArtifact, *, stage_id: str) -> CompoundStageOutput:
    if not isinstance(value, dict):
        raise TypeError(f"stage {stage_id!r} expected dict[str, bytes], got {type(value).__name__}")
    result: dict[str, bytes] = {}
    for key, item in value.items():
        if not isinstance(item, (bytes, bytearray)):
            raise TypeError(f"stage {stage_id!r} expected dict[str, bytes], got {type(item).__name__}")
        result[key] = bytes(item)
    return result


async def _load_parent_artifact(
    *,
    data_root: Path,
    project_id: str,
    page_id: str,
    parent_stage_id: str,
    write_executor: StageWriteExecutor | None = None,
) -> StageArtifact:
    """Load a parent stage's clean artifact, decoded into the runner's
    canonical in-memory type.

    Dispatch is on the parent's `Stage.output_type`:

    - Image types (`image`, `gray`, `binary`, `image_bytes`): PNG/JPEG bytes
      decoded to numpy.ndarray via cv2.imdecode.
    - JSON types (`bbox`, `page_attrs`, `illustration_regions`): JSON text
      file parsed to a Python object (list/dict).
    - Compound-output parents (`words+text`, `hi_res_crops`,
      `text+attestation`): `stage_artifact_path` raises for these, so we
      look in the stage directory for the first `output.*` file (fallback
      for when the multi-artifact writer seeds a primary text/json file).
    - Other types: return raw bytes; the impl must handle them.
    """
    # Resolve parent stage output type from v2 DAG.
    _parent_output_type = get_v2_stage(parent_stage_id).output_type

    # Check in-memory cache first (deferred-write path): the parent's file may
    # not yet be on disk if its write is still in the executor queue.
    if write_executor is not None:
        cached = write_executor.consume_artifact((project_id, page_id, parent_stage_id))
        if cached is not None:
            # Phase 1 ndarray passthrough: when the parent put an ndarray into
            # the cache, return it directly for image-type parents without
            # calling cv2.imdecode (saves one decode per stage on the hot path).
            if isinstance(cached, np.ndarray):
                if _parent_output_type in _IMAGE_OUTPUT_TYPES:
                    return cached  # already decoded — no cv2.imdecode needed
                # Unexpected: non-image stage produced an ndarray. Encode to bytes
                # so the rest of the pipeline can handle it normally.
                ok, buf = cv2.imencode(".png", cached)
                if not ok:
                    raise RuntimeError(f"cv2.imencode failed for cached ndarray from {parent_stage_id!r}")
                cached_bytes: bytes = bytes(buf.tobytes())
                if _parent_output_type in _JSON_OUTPUT_TYPES:
                    return _decode_json_output(cached_bytes, _parent_output_type)
                return cached_bytes
            # Bytes path (legacy): decode as before.
            # Phase 2: cupy device arrays are not expected at this point (they
            # are kept on-device via the segment runner; non-bytes/ndarray entries
            # fall through to the disk path).
            if isinstance(cached, bytes):
                if _parent_output_type in _IMAGE_OUTPUT_TYPES:
                    return _decode_image_bytes(cached)
                if _parent_output_type in _JSON_OUTPUT_TYPES:
                    return _decode_json_output(cached, _parent_output_type)
                # Compound or passthrough — return raw bytes; caller handles.
                return cached

    if _parent_output_type in COMPOUND_OUTPUT_TYPES:
        # Compound-output stages write multiple files; the single-file writer
        # refuses to produce a canonical path for them. Look in the stage
        # directory for the first `output.*` file to support downstream
        # stages that consume their text output (e.g. text_postprocess
        # consuming the text artifact from ocr).
        stage_dir = data_root / "projects" / project_id / "pages" / page_id / "stages" / parent_stage_id
        output_files: list[Path] = []
        if stage_dir.exists():
            output_files = sorted(
                path for path in stage_dir.iterdir() if path.is_file() and path.name.startswith("output.")
            )
        if not output_files:
            raise StageDependenciesNotMet(
                parent_stage_id,
                [f"{parent_stage_id}: compound artifact directory empty at {stage_dir}"],
            )
        return output_files[0].read_bytes()

    path = stage_artifact_path(data_root, project_id, page_id, parent_stage_id)
    if not path.exists():
        # Reconciler-visible drift: the row claims clean but the file is gone.
        # Surface as a dependency-not-met so the caller can heal it.
        raise StageDependenciesNotMet(
            parent_stage_id,
            [f"{parent_stage_id}: artifact missing at {path}"],
        )

    raw = path.read_bytes()

    if _parent_output_type in _IMAGE_OUTPUT_TYPES:
        return _decode_image_bytes(raw)
    if _parent_output_type in _JSON_OUTPUT_TYPES:
        return _decode_json_output(raw, _parent_output_type)
    # Fall back to raw bytes for unknown types; the impl must handle them.
    return raw


async def _cascade_dirty(
    *,
    database: IDatabase,
    project_id: str,
    page_id: str,
    stage_id: str,
) -> None:
    """Set descendants of `stage_id` from `clean`/`failed` to `dirty`.

    Q2 (eager cascade): a stage's re-run invalidates every downstream
    artifact that was previously consistent with the old output. Rows
    that are `not-run` or already `dirty` stay as-is.
    """
    descendant_ids = compute_v2_dirty_descendants(stage_id)
    if not descendant_ids:
        return
    # Fetch current rows for the page; flip those that are clean/failed.
    rows = await database.list_page_stages_for_page(project_id, page_id)
    for row in rows:
        if row.stage_id not in descendant_ids:
            continue
        if row.status not in {PageStageStatus.clean, PageStageStatus.failed}:
            continue
        await database.put_page_stage(row.model_copy(update={"status": PageStageStatus.dirty}))


async def _cascade_dirty_to_split_children(
    *,
    database: IDatabase,
    project_id: str,
    page_id: str,
    stage_id: str,
    page_service: PageService | None = None,
    data_root: Path | None = None,
) -> None:
    """Dirty split children's grayscale when stage_id is at or before each child's split_at_stage.

    In v2, `grayscale` is the root page stage (replaces v1 `decode_source`).
    When a parent page re-runs a stage that is upstream of (or equal to) a
    child's `split_at_stage`, the child must re-process from its root stage.

    Spec: docs/specs/pipeline-task-model.md §"Cross-page dirty propagation: split children".
    """
    # Use event-store lookup: page_id here is the zero-padded idx0 string (e.g. "0001").
    # The parent_page_id stored in PrepPageExtension is also a zero-padded idx0 string.
    _page_service_split: PageService | None = None
    if page_service is not None:
        _page_service_split = page_service
    elif data_root is not None:
        from pdomain_prep_for_pgdp.core.page_store_factory import build_page_service as _bps

        _page_service_split = _bps(data_root, project_id)
    if _page_service_split is not None:
        children = list_page_records_by_parent_id(_page_service_split, project_id, page_id)
    else:
        children = []
    if not children:
        return

    descendants_of_stage = compute_v2_dirty_descendants(stage_id)

    for child in children:
        if child.split_at_stage is None:
            continue
        at_or_before = stage_id == child.split_at_stage or child.split_at_stage in descendants_of_stage
        if not at_or_before:
            continue
        child_page_id = f"{child.idx0:04d}"
        # v2 root page stage: `grayscale` (replaced v1 `decode_source`).
        root_row = await database.get_page_stage(project_id, child_page_id, "grayscale")
        if root_row is None:
            continue
        if root_row.status in {PageStageStatus.clean, PageStageStatus.failed}:
            await database.put_page_stage(root_row.model_copy(update={"status": PageStageStatus.dirty}))
        # Cascade dirty from grayscale to its descendants within the child.
        await _cascade_dirty(
            project_id=project_id,
            page_id=child_page_id,
            stage_id="grayscale",
            database=database,
        )


async def _mark_running(
    *,
    database: IDatabase,
    project_id: str,
    page_id: str,
    stage_id: str,
) -> PageStageState:
    """Idempotently set the row to `running` and commit (so GET sees it).

    If the row doesn't exist yet (page wasn't lazy-init'd), create one.
    """
    existing = await database.get_page_stage(project_id, page_id, stage_id)
    if existing is None:
        # Lazy-init won't have happened if the caller went straight to run_stage
        # without listing first. Synthesise a not-run row, then flip it.
        existing = PageStageState(
            project_id=project_id,
            page_id=page_id,
            stage_id=stage_id,
            status=PageStageStatus.not_run,
        )
    running = existing.model_copy(
        update={
            "status": PageStageStatus.running,
            "error_message": None,
        }
    )
    await database.put_page_stage(running)
    return running


async def _mark_failed(
    *,
    database: IDatabase,
    project_id: str,
    page_id: str,
    stage_id: str,
    error_message: str,
) -> None:
    """Record `status=failed` with the given message; preserves last clean
    artifact_key/input_hash so the workbench can still show the prior output.
    """
    existing = await database.get_page_stage(project_id, page_id, stage_id)
    if existing is None:
        existing = PageStageState(
            project_id=project_id,
            page_id=page_id,
            stage_id=stage_id,
            status=PageStageStatus.not_run,
        )
    failed = existing.model_copy(
        update={
            "status": PageStageStatus.failed,
            "error_message": error_message,
            "last_run_at": time(),
        }
    )
    await database.put_page_stage(failed)


async def _mark_not_applicable(
    *,
    database: IDatabase,
    project_id: str,
    page_id: str,
    stage_ids: frozenset[str],
) -> None:
    """Upsert page_stages rows for the given stage IDs to `not-applicable`.

    Called after `auto_detect_attrs` runs and reveals a non-normal page type.
    Rows already in `not-run` are created/updated; rows already `not-applicable`
    are left unchanged (idempotent). Rows that are `clean` from a prior run
    on a different page type are overwritten — the type detection is the
    authoritative source.
    """
    rows = await database.list_page_stages_for_page(project_id, page_id)
    rows_by_stage = {r.stage_id: r for r in rows}
    for sid in stage_ids:
        existing = rows_by_stage.get(sid)
        if existing is None:
            existing = PageStageState(
                project_id=project_id,
                page_id=page_id,
                stage_id=sid,
                status=PageStageStatus.not_run,
            )
        if existing.status == PageStageStatus.not_applicable:
            continue  # already correct; skip the write
        await database.put_page_stage(existing.model_copy(update={"status": PageStageStatus.not_applicable}))


# ─── Deferred-write commit helper ────────────────────────────────────────────


async def _commit_single_artifact(
    *,
    data_root: Path,
    database: IDatabase,
    project_id: str,
    page_id: str,
    stage_id: str,
    artifact_bytes: bytes,
    stage_version: int,
    write_executor: StageWriteExecutor | None,
    config_hash: str | None = None,
    artifact_ndarray: np.ndarray | None = None,
) -> PageStageState:
    """Commit a single-file artifact, synchronously or via deferred write.

    When ``write_executor`` is ``None`` the existing :func:`commit_stage_artifact`
    path is used (full dual-write atomicity). When an executor is provided the
    DB row is updated optimistically to ``clean`` and the file write is submitted
    to the executor's background pool:

    - Downstream stages can load the artifact from the executor's in-memory cache
      without waiting for disk I/O.
    - If the file write fails, the ``on_failure`` callback marks the row
      ``failed`` and cascades dirty to descendants (Q9).

    Phase 1 ndarray passthrough:
    When ``artifact_ndarray`` is supplied AND ``write_executor`` is provided,
    the ndarray is stored in the executor's cache (so downstream stages avoid
    ``cv2.imdecode``), and the PNG encode is deferred to the background write
    thread.  ``artifact_bytes`` is still used for ``content_hash`` when the
    executor path is taken — callers that have already encoded once for other
    reasons (e.g. thumbnail generation) pass it here; callers that want to avoid
    ALL hot-path encodes should compute the hash from raw ndarray bytes instead
    (future optimisation, tracked in Phase 2).
    """
    if write_executor is None:
        return await commit_stage_artifact(
            data_root=data_root,
            database=database,
            project_id=project_id,
            page_id=page_id,
            stage_id=stage_id,
            artifact_bytes=artifact_bytes,
            stage_version=stage_version,
            config_hash=config_hash,
        )

    # Deferred path: optimistic DB update then background file write.
    content_hash = compute_content_hash(artifact_bytes)
    artifact_key_str = stage_artifact_key(project_id, page_id, stage_id)
    target_path = stage_artifact_path(data_root, project_id, page_id, stage_id)

    state = PageStageState(
        project_id=project_id,
        page_id=page_id,
        stage_id=stage_id,
        status=PageStageStatus.clean,
        stage_version=stage_version,
        artifact_key=artifact_key_str,
        input_hash=content_hash,
        config_hash=config_hash,
        last_run_at=time(),
        error_message=None,
    )
    await database.put_page_stage(state)

    # Register in-memory artifact for downstream stages (drop-on-last-consumer).
    # Phase 1: when an ndarray is available, cache it directly so downstream
    # stages receive the ndarray without re-decoding the PNG bytes.
    num_consumers = sum(1 for s in _stage_dag_module.V2_STAGE_DAG if stage_id in s.depends_on)
    _cache_value: bytes | np.ndarray = artifact_ndarray if artifact_ndarray is not None else artifact_bytes
    write_executor.put_artifact((project_id, page_id, stage_id), _cache_value, num_consumers)

    # Submit file write; blocks if queue at capacity (back-pressure, Q8).
    loop = asyncio.get_running_loop()

    async def _on_failure(exc: Exception) -> None:
        await _mark_failed(
            database=database,
            project_id=project_id,
            page_id=page_id,
            stage_id=stage_id,
            error_message=f"deferred write failed: {exc}",
        )
        await _cascade_dirty(
            database=database,
            project_id=project_id,
            page_id=page_id,
            stage_id=stage_id,
        )

    _stage_for_thumb = get_v2_stage(stage_id)

    # Phase 1: when we have an ndarray, build the thumbnail from it directly
    # (avoid decode) and defer the PNG encode for the main artifact to the
    # background write thread. The thumbnail is still encoded to JPEG here,
    # but it is much smaller than the full artifact.
    if artifact_ndarray is not None and _stage_for_thumb.output_type in _IMAGE_OUTPUT_TYPES:
        # Thumbnail from ndarray: resize and JPEG-encode in the write factory.
        # This is a small encode and runs in the background thread.
        _arr_for_thumb = artifact_ndarray
        _thumb_path = stage_thumbnail_path(data_root, project_id, page_id, stage_id)
        _tp = target_path
        _ab_captured = artifact_bytes  # PNG bytes already computed; use for write

        async def _write_with_ndarray_thumb() -> None:
            # Generate thumbnail from ndarray in the write thread.
            _thumb_b: bytes | None = None
            try:
                import cv2 as _cv2

                _tmax = 300
                _h, _w = _arr_for_thumb.shape[:2]
                _scale = min(_tmax / max(_h, _w, 1), 1.0)
                _thumb_img = (
                    _cv2.resize(
                        _arr_for_thumb,
                        (max(1, int(_w * _scale)), max(1, int(_h * _scale))),
                        interpolation=_cv2.INTER_AREA,
                    )
                    if _scale < 1.0
                    else _arr_for_thumb
                )
                _ok, _buf = _cv2.imencode(".png", _thumb_img)
                _thumb_b = bytes(_buf.tobytes()) if _ok else None
            except Exception:
                _thumb_b = None

            await write_artifact_file_async(
                _tp,
                _ab_captured,
                thumb_path=_thumb_path if _thumb_b else None,
                thumb_bytes=_thumb_b,
            )

        write_executor.submit_write(
            _write_with_ndarray_thumb,
            on_failure=_on_failure,
            loop=loop,
        )
    else:
        _thumb_bytes = make_stage_thumbnail_bytes(artifact_bytes, _stage_for_thumb.output_type)
        _thumb_path = stage_thumbnail_path(data_root, project_id, page_id, stage_id) if _thumb_bytes else None
        _tp, _ab, _thp, _thb = target_path, artifact_bytes, _thumb_path, _thumb_bytes
        write_executor.submit_write(
            lambda: write_artifact_file_async(_tp, _ab, thumb_path=_thp, thumb_bytes=_thb),
            on_failure=_on_failure,
            loop=loop,
        )

    return state


def _call_impl(impl: StageImpl, artifacts: list[StageArtifact], cfg: ResolvedPageConfig) -> StageArtifact:
    """Call a stage impl with its input artifacts and resolved config.

    All registered stage impls accept ``cfg`` as a keyword argument (defaulting
    to ``None``).  The ``cfg`` keyword is always forwarded — no runtime
    signature introspection required.
    """
    return impl(artifacts[0], cfg=cfg) if len(artifacts) == 1 else impl(*artifacts, cfg=cfg)


# ─── Public entry point ────────────────────────────────────────────────────


async def run_stage(
    *,
    data_root: Path,
    database: IDatabase,
    project_id: str,
    page_id: str,
    stage_id: str,
    device: str = "cpu",
    storage: IStorage | None = None,
    page_source_key: str | None = None,
    write_executor: StageWriteExecutor | None = None,
    stage_events: StageEventBroker | None = None,
    resolved_config: ResolvedPageConfig | None = None,
    page_service: PageService | None = None,
) -> PageStageState:
    """Run one stage on one page. Dual-writes its artifact, then cascades
    dirty downstream.

    Parameters
    ----------
    data_root
        Filesystem-storage root. Used by the writer to compute artifact paths.
    database
        IDatabase adapter (typed against `IDatabase` from `adapters.database.base`).
    project_id, page_id
        Identifies the row scope.
    stage_id
        Canonical stage_id from `V2_PAGE_STAGE_IDS`.
    device
        ``"cpu"`` (default) or ``"cuda"``. ``"cuda"``/``"gpu"`` are normalized
        to the ``"gpu"`` impl key by the registry; an unknown device string
        (e.g. ``"mps"``) falls back to ``"cpu"`` rather than raising KeyError.
    storage
        IStorage adapter. Accepted for backward compatibility; not used by
        any v2 stage (v2 root ``grayscale`` reads from BlobStore, not IStorage).
    page_source_key
        Accepted for backward compatibility; not used by any v2 stage.
    resolved_config
        Pre-resolved ``ResolvedPageConfig`` (or equivalent). When provided,
        skips the internal ``_resolve_config`` DB lookup — useful for route
        handlers that already resolved config earlier in the request. When
        ``None`` (the default), the runner resolves config from DB as before,
        preserving backward compatibility.

    Returns
    -------
    PageStageState
        The freshly-committed row (status=clean on success).

    Raises
    ------
    StageDependenciesNotMet
        Before any mutation, when not all parents are clean.
    StageRunFailed
        After marking the row `failed` and updating the DB.
    """
    # Load the v2 stage definition. Cross-scope deps (project-scoped stages like
    # "source") are stripped from depends_on for artifact loading — they are
    # enforced at the project-stage level, not the page_stages table.
    _is_v2_page_stage = stage_id in V2_PAGE_STAGE_IDS
    _v2_stage = get_v2_stage(stage_id)
    _v2_page_deps = tuple(dep for dep in _v2_stage.depends_on if dep not in V2_PROJECT_STAGE_IDS)
    stage = _v2_stage

    # Build page_service from data_root if not provided by the caller.
    _ps: PageService | None = page_service
    if _ps is None:
        from pdomain_prep_for_pgdp.core.page_store_factory import build_page_service as _bps

        _ps = _bps(data_root, project_id)

    # Step 1: dependency check.
    if _v2_page_deps:
        # v2 path: use the filtered page-scoped deps (cross-scope deps
        # like "source" have already been excluded from _v2_page_deps).
        rows = await database.list_page_stages_for_page(project_id, page_id)
        rows_by_stage = {r.stage_id: r for r in rows}
        # v2 DAG has no any_parent_ok; all listed page deps must be clean.
        missing = [
            parent_id
            for parent_id in _v2_page_deps
            if (rows_by_stage.get(parent_id) is None)
            or (rows_by_stage[parent_id].status != PageStageStatus.clean)
        ]
        if missing:
            raise StageDependenciesNotMet(stage_id, missing)

    # Step 3: mark running so the UI / GET endpoint sees the transition.
    _ = await _mark_running(
        database=database,
        project_id=project_id,
        page_id=page_id,
        stage_id=stage_id,
    )
    await _emit(stage_events, project_id, page_id, "stage-status", stage_id, "running")
    await _emit(stage_events, project_id, page_id, "stage-progress", stage_id, "running")

    # W2.1: record StageRunStarted in PrepProjectAggregate (warn-and-continue).
    _started_at_ms = time() * 1000
    _prep_agg_job_id = f"sync:{stage_id}:{page_id}"
    try:
        import uuid as _uuid_mod

        from pdomain_prep_for_pgdp.core.pipeline.prep_aggregate import (
            PrepApplication as _PrepApp,
        )
        from pdomain_prep_for_pgdp.core.pipeline.prep_aggregate import (
            PrepProjectAggregate as _PrepAgg,
        )

        _events_db = data_root / "projects" / project_id / "events.db"
        _events_db.parent.mkdir(parents=True, exist_ok=True)
        _agg_app_start = _PrepApp(
            env={
                "PERSISTENCE_MODULE": "eventsourcing.sqlite",
                "SQLITE_DBNAME": str(_events_db),
            }
        )
        # Derive UUID: standard UUID if project_id is a valid UUID-hex/hyphen,
        # else uuid5 in OID namespace (same pattern as job_runner.py W2.1).
        try:
            _proj_uuid = _uuid_mod.UUID(project_id)
        except ValueError:
            _proj_uuid = _uuid_mod.uuid5(_uuid_mod.NAMESPACE_OID, project_id)
        _agg_uuid_start = _PrepAgg.create_id(_proj_uuid)
        try:
            _agg_start: _PrepAgg = _agg_app_start.repository.get(_agg_uuid_start)  # type: ignore[assignment]
        except Exception:
            _agg_start = _PrepAgg(project_id=_proj_uuid)
        _agg_start.record_stage_run_started(
            stage_id=stage_id,
            page_id=page_id,
            job_id=_prep_agg_job_id,
            actor_id="default",
        )
        _agg_app_start.save(_agg_start)
    except Exception as _e_start:  # pragma: no cover
        log.warning("W2.1 StageRunStarted event failed (non-fatal): %s", _e_start)

    # Resolve per-page config. When the caller pre-resolves (e.g. the sync route
    # handler), use that value directly. Otherwise read the latest page + project
    # + system rows from DB so config changes between request and execution are
    # always picked up (the async job path guarantees this because the job
    # handler calls run_stage after potentially waiting in the queue).
    if resolved_config is not None:
        cfg = resolved_config
    else:
        cfg = await _resolve_config(
            database=database, project_id=project_id, page_id=page_id, page_service=_ps
        )

    # W1.1: merge effective stage settings into cfg — 3-tier (page > project > all > registry).
    #
    # Precedence (highest wins):
    #   per-page PageConfigOverrides (baked into cfg by _resolve_config above)
    #   > page-tier StageSettingsStore settings (sparse per-page override)
    #   > project-tier StageSettingsStore settings (save_as_default)
    #   > all-tier AppWideStageSettings (backed by LocalFilePrefs / ui-prefs.json)
    #   > registry default (STAGE_SETTINGS_DEFAULTS)
    #
    # apply_stage_settings_to_config only writes the stage-settings-specific
    # fields on ResolvedPageConfig; it does NOT overwrite per-page overrides.
    #
    # Only stages with entries in STAGE_SETTINGS_DEFAULTS have tunable settings;
    # for all other stages this is a fast no-op (no DB open, no I/O).
    from pdomain_prep_for_pgdp.core.pipeline.stage_settings import (
        STAGE_SETTINGS_DEFAULTS,
        AppWideStageSettings,
        StageSettingsStore,
        apply_stage_settings_to_config,
    )

    _stage_registry_defaults = STAGE_SETTINGS_DEFAULTS.get(stage_id)
    if _stage_registry_defaults is not None:
        _settings_db_path = data_root / "projects" / project_id / "stage_settings.db"
        _settings_db_path.parent.mkdir(parents=True, exist_ok=True)
        _settings_store = StageSettingsStore(_settings_db_path)
        _app_wide = AppWideStageSettings(data_root)
        _effective = _settings_store.get_effective_3tier(
            project_id,
            stage_id,
            page_id,
            registry_default=_stage_registry_defaults,
            app_wide=_app_wide,
        )
        cfg = apply_stage_settings_to_config(cfg, stage_id, _effective)

    _cfg_hash = _compute_config_hash(cfg, stage_id)

    # Sentinel for the impl's in-memory output; set inside the else branch
    # (non-ingest_source path) so the post-run not-applicable logic can read it.
    output: StageArtifact | None = None

    # Step 4-5: load inputs, dispatch.
    try:
        # Current algorithm version for this stage — written into the DB row on
        # success so future reads can detect staleness against V2_STAGE_VERSIONS.
        _stage_ver = _stage_dag_module.V2_STAGE_VERSIONS.get(stage_id, 1)

        # Resolve the impl. An unknown stage_id raises KeyError (programmer
        # error — caller must validate before now). An unknown device string
        # now falls back to "cpu" via _DEVICE_TO_IMPL_KEY (Task 2.1), so
        # only a missing stage_id causes KeyError here; wrap it as a stage failure.
        try:
            impl = get_stage_impl(stage_id, device)
        except KeyError as exc:
            raise StageRunFailed(f"stage {stage_id!r} has no impl registered for device {device!r}") from exc

        if _is_v2_page_stage and not _v2_page_deps and _v2_stage.input_type == "image_bytes":
            # v2 root page stage (e.g. `grayscale`): no page-scoped parents, but
            # needs the raw source image. Load source bytes from BlobStore via
            # PrepPageExtension.source_blob_hash.
            if _ps is None:
                raise ValueError(
                    f"v2 root stage {stage_id!r} requires page_service (PageService); "
                    + "the runner should have built it from data_root above"
                )
            try:
                _idx0_int = int(page_id)
            except (ValueError, TypeError):
                _idx0_int = -1
            _, _prep_ext = _get_page_agg_and_ext(_ps, project_id, _idx0_int)
            if _prep_ext is None or not _prep_ext.source_blob_hash:
                raise ValueError(
                    f"v2 root stage {stage_id!r}: page {page_id!r} has no source_blob_hash "
                    + "in PrepPageExtension — ingest the project source first "
                    + "(project-stage 'source' must be clean)"
                )
            _src_bytes = _ps.blobs.read(_prep_ext.source_blob_hash)
            _src_img = _decode_image_bytes(_src_bytes)
            output = _call_impl(impl, [_src_img], cfg)

            # Encode and commit. v2 root page stages output ndarray (gray/image).
            _v2root_arr = _require_image_artifact(output, stage_id=stage_id)
            artifact_bytes_v2root = _encode_image_to_png(_v2root_arr)
            # Phase 1: pass ndarray to executor cache for image-type root stages.
            _v2root_ndarray_cache: np.ndarray | None = _v2root_arr if write_executor is not None else None
            committed = await _commit_single_artifact(
                data_root=data_root,
                database=database,
                project_id=project_id,
                page_id=page_id,
                stage_id=stage_id,
                artifact_bytes=artifact_bytes_v2root,
                stage_version=_stage_ver,
                write_executor=write_executor,
                config_hash=_cfg_hash,
                artifact_ndarray=_v2root_ndarray_cache,
            )
        else:
            # Load parents.
            # Load all page-scoped parents. Single-parent passes the bare
            # artifact; multi-parent passes positional args in _v2_page_deps order.
            parent_artifacts: list[StageArtifact] = []

            for parent_id in _v2_page_deps:
                parent_artifacts.append(
                    await _load_parent_artifact(
                        data_root=data_root,
                        project_id=project_id,
                        page_id=page_id,
                        parent_stage_id=parent_id,
                        write_executor=write_executor,
                    )
                )

            output = _call_impl(impl, parent_artifacts, cfg)

            # Step 7: encode then commit (sync or deferred).
            if stage.output_type in COMPOUND_OUTPUT_TYPES:
                # Compound-output stages return dict[str, bytes]; each entry
                # is a named file in the stage directory. The primary file is
                # looked up in COMPOUND_PRIMARY_FILENAME.
                # Deferred writes for compound stages are not yet implemented;
                # they always use the synchronous multi-artifact writer.
                compound_output = _require_compound_output(output, stage_id=stage_id)
                primary_filename = COMPOUND_PRIMARY_FILENAME[stage.output_type]
                committed = await commit_stage_artifacts_multi(
                    data_root=data_root,
                    database=database,
                    project_id=project_id,
                    page_id=page_id,
                    stage_id=stage_id,
                    files=compound_output,
                    primary_filename=primary_filename,
                    stage_version=_stage_ver,
                    config_hash=_cfg_hash,
                )
            else:
                # Single-file stages: encode to bytes then commit.
                if stage.output_type in _JSON_OUTPUT_TYPES:
                    # Coerce numpy scalar types (int64, float32, etc.) to native
                    # Python so json.dumps can serialise without a custom encoder.
                    json_output: object = output
                    if isinstance(output, (tuple, list)):
                        json_output = [int(v) if isinstance(v, np.generic) else v for v in output]
                    artifact_bytes = json.dumps(json_output).encode()
                elif stage.output_type == "text":
                    if isinstance(output, str):
                        artifact_bytes = output.encode()
                    elif isinstance(output, (bytes, bytearray)):
                        artifact_bytes = bytes(output)
                    else:
                        raise TypeError(
                            f"stage {stage_id!r} expected text output, got {type(output).__name__}"
                        )
                elif stage.output_type in _PASSTHROUGH_BYTES_OUTPUT_TYPES:
                    if not isinstance(output, (bytes, bytearray)):
                        raise TypeError(
                            f"stage {stage_id!r} expected byte output, got {type(output).__name__}"
                        )
                    artifact_bytes = bytes(output)
                elif isinstance(output, (bytes, bytearray)):
                    artifact_bytes = bytes(output)
                else:
                    # Image / gray / binary / image_bytes stages return ndarrays.
                    # Phase 1 ndarray passthrough: when we have an executor, store
                    # the ndarray in the cache and defer the PNG encode to the write
                    # thread. We still need bytes for the content_hash and the sync
                    # path, so encode unconditionally here (one encode per stage).
                    _img_arr = _require_image_artifact(output, stage_id=stage_id)
                    artifact_bytes = _encode_image_to_png(_img_arr)

                # Determine whether to pass the ndarray for cache passthrough.
                # Only image-type stages produce ndarrays; others are already bytes.
                _ndarray_for_cache: np.ndarray | None = None
                if (
                    write_executor is not None
                    and stage.output_type in _IMAGE_OUTPUT_TYPES
                    and isinstance(output, np.ndarray)
                ):
                    _ndarray_for_cache = cast("np.ndarray", output)

                committed = await _commit_single_artifact(
                    data_root=data_root,
                    database=database,
                    project_id=project_id,
                    page_id=page_id,
                    stage_id=stage_id,
                    artifact_bytes=artifact_bytes,
                    stage_version=_stage_ver,
                    write_executor=write_executor,
                    config_hash=_cfg_hash,
                    artifact_ndarray=_ndarray_for_cache,
                )
    except StageNotImplemented as exc:
        _err_msg_ni = str(exc)
        await _mark_failed(
            database=database,
            project_id=project_id,
            page_id=page_id,
            stage_id=stage_id,
            error_message=_err_msg_ni,
        )
        await _emit(stage_events, project_id, page_id, "stage-status", stage_id, "failed")
        # W2.1: StageRunFailed event (non-fatal if event recording fails).
        try:
            _duration_ni = int(time() * 1000 - _started_at_ms)
            import uuid as _uuid_mod

            from pdomain_prep_for_pgdp.core.pipeline.prep_aggregate import (
                PrepApplication as _PrepApp,
            )
            from pdomain_prep_for_pgdp.core.pipeline.prep_aggregate import (
                PrepProjectAggregate as _PrepAgg,
            )

            _events_db_ni = data_root / "projects" / project_id / "events.db"
            _app_ni = _PrepApp(
                env={
                    "PERSISTENCE_MODULE": "eventsourcing.sqlite",
                    "SQLITE_DBNAME": str(_events_db_ni),
                }
            )
            try:
                _puid_ni = _uuid_mod.UUID(project_id)
            except ValueError:
                _puid_ni = _uuid_mod.uuid5(_uuid_mod.NAMESPACE_OID, project_id)
            _aid_ni = _PrepAgg.create_id(_puid_ni)
            try:
                _agg_ni: _PrepAgg = _app_ni.repository.get(_aid_ni)  # type: ignore[assignment]
            except Exception:
                _agg_ni = _PrepAgg(project_id=_puid_ni)
            _agg_ni.record_stage_run_failed(
                stage_id=stage_id,
                page_id=page_id,
                error_message=_err_msg_ni,
                duration_ms=_duration_ni,
                actor_id="default",
            )
            _app_ni.save(_agg_ni)
        except Exception as _e_ni:  # pragma: no cover
            log.warning("W2.1 StageRunFailed event failed (non-fatal): %s", _e_ni)
        raise StageRunFailed(str(exc)) from exc
    except StageArtifactWriteError as exc:
        _err_msg_aw = f"dual-write failed: {exc}"
        await _mark_failed(
            database=database,
            project_id=project_id,
            page_id=page_id,
            stage_id=stage_id,
            error_message=_err_msg_aw,
        )
        await _emit(stage_events, project_id, page_id, "stage-status", stage_id, "failed")
        # W2.1: StageRunFailed event.
        try:
            _duration_aw = int(time() * 1000 - _started_at_ms)
            import uuid as _uuid_mod

            from pdomain_prep_for_pgdp.core.pipeline.prep_aggregate import (
                PrepApplication as _PrepApp,
            )
            from pdomain_prep_for_pgdp.core.pipeline.prep_aggregate import (
                PrepProjectAggregate as _PrepAgg,
            )

            _events_db_aw = data_root / "projects" / project_id / "events.db"
            _app_aw = _PrepApp(
                env={
                    "PERSISTENCE_MODULE": "eventsourcing.sqlite",
                    "SQLITE_DBNAME": str(_events_db_aw),
                }
            )
            try:
                _puid_aw = _uuid_mod.UUID(project_id)
            except ValueError:
                _puid_aw = _uuid_mod.uuid5(_uuid_mod.NAMESPACE_OID, project_id)
            _aid_aw = _PrepAgg.create_id(_puid_aw)
            try:
                _agg_aw: _PrepAgg = _app_aw.repository.get(_aid_aw)  # type: ignore[assignment]
            except Exception:
                _agg_aw = _PrepAgg(project_id=_puid_aw)
            _agg_aw.record_stage_run_failed(
                stage_id=stage_id,
                page_id=page_id,
                error_message=_err_msg_aw,
                duration_ms=_duration_aw,
                actor_id="default",
            )
            _app_aw.save(_agg_aw)
        except Exception as _e_aw:  # pragma: no cover
            log.warning("W2.1 StageRunFailed event failed (non-fatal): %s", _e_aw)
        raise StageRunFailed(f"dual-write failed for {stage_id!r}: {exc}") from exc
    except StageRunFailed:
        # Already shaped — re-raise as-is.
        raise
    except Exception as exc:
        _err_msg_ex = f"{type(exc).__name__}: {exc}"
        await _mark_failed(
            database=database,
            project_id=project_id,
            page_id=page_id,
            stage_id=stage_id,
            error_message=_err_msg_ex,
        )
        await _emit(stage_events, project_id, page_id, "stage-status", stage_id, "failed")
        # W2.1: StageRunFailed event.
        try:
            _duration_ex = int(time() * 1000 - _started_at_ms)
            import uuid as _uuid_mod

            from pdomain_prep_for_pgdp.core.pipeline.prep_aggregate import (
                PrepApplication as _PrepApp,
            )
            from pdomain_prep_for_pgdp.core.pipeline.prep_aggregate import (
                PrepProjectAggregate as _PrepAgg,
            )

            _events_db_ex = data_root / "projects" / project_id / "events.db"
            _app_ex = _PrepApp(
                env={
                    "PERSISTENCE_MODULE": "eventsourcing.sqlite",
                    "SQLITE_DBNAME": str(_events_db_ex),
                }
            )
            try:
                _puid_ex = _uuid_mod.UUID(project_id)
            except ValueError:
                _puid_ex = _uuid_mod.uuid5(_uuid_mod.NAMESPACE_OID, project_id)
            _aid_ex = _PrepAgg.create_id(_puid_ex)
            try:
                _agg_ex: _PrepAgg = _app_ex.repository.get(_aid_ex)  # type: ignore[assignment]
            except Exception:
                _agg_ex = _PrepAgg(project_id=_puid_ex)
            _agg_ex.record_stage_run_failed(
                stage_id=stage_id,
                page_id=page_id,
                error_message=_err_msg_ex,
                duration_ms=_duration_ex,
                actor_id="default",
            )
            _app_ex.save(_agg_ex)
        except Exception as _e_ex:  # pragma: no cover
            log.warning("W2.1 StageRunFailed event failed (non-fatal): %s", _e_ex)
        raise StageRunFailed(f"stage {stage_id!r} impl raised {type(exc).__name__}: {exc}") from exc

    # W2.1: StageRunCompleted event (non-fatal if event recording fails).
    try:
        _duration_ok = int(time() * 1000 - _started_at_ms)
        import uuid as _uuid_mod

        from pdomain_prep_for_pgdp.core.pipeline.prep_aggregate import (
            PrepApplication as _PrepApp,
        )
        from pdomain_prep_for_pgdp.core.pipeline.prep_aggregate import (
            PrepProjectAggregate as _PrepAgg,
        )

        _events_db_ok = data_root / "projects" / project_id / "events.db"
        _app_ok = _PrepApp(
            env={
                "PERSISTENCE_MODULE": "eventsourcing.sqlite",
                "SQLITE_DBNAME": str(_events_db_ok),
            }
        )
        try:
            _puid_ok = _uuid_mod.UUID(project_id)
        except ValueError:
            _puid_ok = _uuid_mod.uuid5(_uuid_mod.NAMESPACE_OID, project_id)
        _aid_ok = _PrepAgg.create_id(_puid_ok)
        try:
            _agg_ok: _PrepAgg = _app_ok.repository.get(_aid_ok)  # type: ignore[assignment]
        except Exception:
            _agg_ok = _PrepAgg(project_id=_puid_ok)
        _agg_ok.record_stage_run_completed(
            stage_id=stage_id,
            page_id=page_id,
            status="clean",
            duration_ms=_duration_ok,
            artifact_key=committed.artifact_key or "",
            actor_id="default",
        )
        _app_ok.save(_agg_ok)
    except Exception as _e_ok:  # pragma: no cover
        log.warning("W2.1 StageRunCompleted event failed (non-fatal): %s", _e_ok)

    # Step 8b: cascade dirty — emit stage-status events for all descendants
    # that the cascade will mark dirty. The SSE subscribers refetch the full
    # stage list on any event, so emitting the full descendant set is correct
    # even if some rows were already dirty or not-run.
    descendant_ids = compute_v2_dirty_descendants(stage_id)
    await _cascade_dirty(
        database=database,
        project_id=project_id,
        page_id=page_id,
        stage_id=stage_id,
    )
    for desc_id in descendant_ids:
        await _emit(stage_events, project_id, page_id, "stage-status", desc_id, "dirty")

    # Step 8c: cross-page cascade — dirty split children's grayscale (v2 root)
    # when this stage is at or before each child's split_at_stage (issue #55).
    await _cascade_dirty_to_split_children(
        database=database,
        project_id=project_id,
        page_id=page_id,
        stage_id=stage_id,
        page_service=_ps,
        data_root=data_root,
    )

    # Emit clean event for the completed stage after the cascade.
    # Carry last_run_at (epoch seconds) and idx0 so the frontend can set
    # lastRunAt in the artifact URL cache-buster and know which page completed.
    # idx0 is derived from page_id (zero-padded string like "0000" → 0).
    _clean_extra: dict[str, object] = {}
    if committed.last_run_at is not None:
        _clean_extra["last_run_at"] = committed.last_run_at
    with contextlib.suppress(ValueError):
        _clean_extra["idx0"] = int(page_id)
    await _emit(stage_events, project_id, page_id, "stage-status", stage_id, "clean", extra=_clean_extra)

    return committed


# ─── Segment-wired multi-stage helpers (Phase 2 wiring) ───────────────────────


def run_image_prep_chain(
    image: np.ndarray,
    *,
    stage_ids: list[str],
    device: str = "cpu",
    cfg: ResolvedPageConfig | None = None,
) -> tuple[object, str]:
    """Run a sequence of image-prep stages through the segment runner.

    This is a thin wrapper over :func:`segment_runner.run_image_segment` that
    is importable from ``stage_runner`` so callers do not need to know about
    the segment runner module directly.

    When ``device`` maps to a GPU device and CuPy is available, consecutive
    GPU-capable stages keep the working array as a CuPy ndarray.  The array
    is downloaded to numpy at CPU-only stage boundaries and on return (if the
    caller does not pass it to a :class:`StageWriteExecutor`).

    Parameters
    ----------
    image
        Initial numpy ndarray input.
    stage_ids
        Ordered list of v2 stage IDs to run in sequence.
    device
        ``"cpu"`` (default) or ``"local"``/``"gpu"``/``"cuda"`` for GPU.
    cfg
        Resolved per-page config.  When ``None``, the segment runner uses
        stage-level defaults.

    Returns
    -------
    (result_array, final_device)
        ``result_array``: numpy or CuPy ndarray (whatever the last stage produced).
        ``final_device``: ``"cpu"`` or ``"gpu"``/``"local"`` indicating the device
        of the returned array.
    """
    from .segment_runner import run_image_segment

    return run_image_segment(image, stage_ids=stage_ids, device=device, cfg=cfg)


async def run_image_prep_chain_with_events(
    *,
    image: np.ndarray,
    stage_ids: list[str],
    device: str = "cpu",
    cfg: ResolvedPageConfig | None = None,
    data_root: Path,
    database: IDatabase,
    project_id: str,
    page_id: str,
    write_executor: StageWriteExecutor | None = None,
    stage_events: StageEventBroker | None = None,
) -> dict[str, str]:
    """Run a sequence of image-prep stages via the segment runner, emitting
    per-stage DB rows and SSE events (running → clean) for each stage.

    Contract:
    - Calls :func:`run_image_prep_chain` ONCE for the entire ``stage_ids``
      sequence (not N individual :func:`run_stage` calls).
    - Per-stage ``page_stages`` rows are written (running → clean).
    - Per-stage SSE events are emitted (stage-status: running, then clean).
    - Artifacts are written via ``write_executor`` (deferred path) or
      synchronously via :func:`commit_stage_artifact` when executor is None.
    - Each stage's artifact is produced from its slice of the segment output
      by taking the intermediate array at that point in the chain.

    Used by:
    - ``_handle_run_page_stage`` (job_runner) when payload requests multiple
      consecutive GPU-capable image-prep stages.
    - The Phase-3 batch orchestrator's pre-OCR chain (future).

    Returns
    -------
    dict[str, str]
        Maps ``stage_id → "clean"`` for each successfully completed stage.
        On failure the exception propagates (no partial success map).
    """
    from .segment_runner import _get_stage_impl_with_fallback, _is_device_array, _is_gpu_device, _to_numpy
    from .stage_registry import (
        GPU_CAPABLE_STAGES,
        default_resolved_page_config,
    )

    if cfg is None:
        cfg = default_resolved_page_config()

    # Design contract: each stage's impl executes EXACTLY ONCE per chain run.
    #
    # This function IS the segment — it maintains the working array on-device
    # across consecutive GPU-capable stages (same logic as run_image_segment's
    # internal loop), and simultaneously captures per-stage intermediates for
    # artifact writes and SSE events.
    #
    # Do NOT call run_image_segment here.  Doing so would be a full extra pass
    # over all N stages before the per-stage artifact loop, causing 2N impl
    # calls — double execution and double GPU work.
    #
    # GPU upload happens on the first GPU-capable stage; download happens on a
    # CPU-only stage boundary or before PNG encoding.  This mirrors the logic
    # in segment_runner.run_image_segment exactly.

    _stage_ver_map = __import__(
        "pdomain_prep_for_pgdp.core.pipeline.stage_dag",
        fromlist=["V2_STAGE_VERSIONS"],
    ).V2_STAGE_VERSIONS

    use_gpu = _is_gpu_device(device)

    # ── Single pass: per-stage impl dispatch + artifact capture ───────────────
    # Each impl is called exactly once.  The working array stays on-device when
    # consecutive GPU-capable stages run; it is downloaded at CPU-stage
    # boundaries and before PNG encoding.
    result: dict[str, str] = {}
    current_image: object = image

    for stage_id in stage_ids:
        # Mark running
        await _mark_running(
            database=database,
            project_id=project_id,
            page_id=page_id,
            stage_id=stage_id,
        )
        await _emit(stage_events, project_id, page_id, "stage-status", stage_id, "running")

        try:
            stage_gpu_capable = stage_id in GPU_CAPABLE_STAGES

            if use_gpu and stage_gpu_capable:
                # GPU path: upload if not already on device.
                if not _is_device_array(current_image):
                    import cupy as _cp  # pyright: ignore[reportMissingImports]

                    assert isinstance(current_image, np.ndarray), (
                        f"expected ndarray before GPU upload, got {type(current_image)}"
                    )
                    current_image = _cp.asarray(current_image)
                impl = _get_stage_impl_with_fallback(stage_id, "gpu")
            else:
                # CPU path: download if currently on GPU.
                if _is_device_array(current_image):
                    current_image = _to_numpy(current_image)
                if not isinstance(current_image, np.ndarray):
                    current_image = np.asarray(current_image)
                impl = _get_stage_impl_with_fallback(stage_id, "cpu")

            stage_out_raw = impl(current_image, cfg=cfg)
            current_image = stage_out_raw

            # Download to numpy for artifact encoding.
            _out_np: np.ndarray
            if isinstance(stage_out_raw, np.ndarray):
                _out_np = stage_out_raw
            elif _is_device_array(stage_out_raw):
                _out_np = _to_numpy(stage_out_raw)
            else:
                _out_np = np.asarray(stage_out_raw)

            artifact_bytes = _encode_image_to_png(_out_np)

            _stage_ver = _stage_ver_map.get(stage_id, 1)
            _cfg_hash = _compute_config_hash(cfg, stage_id)
            _ndarray_for_cache: np.ndarray | None = _out_np if write_executor is not None else None

            await _commit_single_artifact(
                data_root=data_root,
                database=database,
                project_id=project_id,
                page_id=page_id,
                stage_id=stage_id,
                artifact_bytes=artifact_bytes,
                stage_version=_stage_ver,
                write_executor=write_executor,
                config_hash=_cfg_hash,
                artifact_ndarray=_ndarray_for_cache,
            )

        except Exception as exc:
            err_msg = f"segment chain stage {stage_id!r}: {type(exc).__name__}: {exc}"
            await _mark_failed(
                database=database,
                project_id=project_id,
                page_id=page_id,
                stage_id=stage_id,
                error_message=err_msg,
            )
            await _emit(stage_events, project_id, page_id, "stage-status", stage_id, "failed")
            raise StageRunFailed(err_msg) from exc

        # Cascade dirty for this stage
        await _cascade_dirty(
            database=database,
            project_id=project_id,
            page_id=page_id,
            stage_id=stage_id,
        )
        # Enrich clean event with last_run_at + idx0 for PAGE_PUSH bridge.
        _chain_clean_extra: dict[str, object] = {"last_run_at": time()}
        with contextlib.suppress(ValueError):
            _chain_clean_extra["idx0"] = int(page_id)
        await _emit(
            stage_events, project_id, page_id, "stage-status", stage_id, "clean", extra=_chain_clean_extra
        )
        result[stage_id] = "clean"

    return result
