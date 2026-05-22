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
7. Cascade dirty: `compute_dirty_descendants(stage_id)` returns the
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
import hashlib
import json
import logging
from time import time
from typing import TYPE_CHECKING, Any

import cv2  # pyright: ignore[reportMissingImports]
import numpy as np

from pd_prep_for_pgdp.core.models import PageRecord, PageStageState, PageStageStatus, ResolvedPageConfig
from pd_prep_for_pgdp.core.stage_events import StageEventBroker, stage_events_key

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
from .stage_dag import compute_dirty_descendants, get_stage, not_applicable_stages_for_page_type
from .stage_registry import StageNotImplemented, get_stage_impl
from .stage_write_executor import StageWriteExecutor, _write_artifact_file_async

if TYPE_CHECKING:
    from pathlib import Path

    from pd_prep_for_pgdp.adapters.database.base import IDatabase
    from pd_prep_for_pgdp.adapters.storage.base import IStorage

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
) -> None:
    if broker is None:
        return
    key = stage_events_key(project_id, page_id)
    await broker.publish(key, {"type": event_type, "stage_id": stage_id, "status": status})


# ─── Typed exceptions ───────────────────────────────────────────────────────


class StageDependenciesNotMet(RuntimeError):  # noqa: N818  # intentional: signals unmet deps, not an error state
    """Raised before any mutation when one or more `depends_on` rows are not `clean`.

    The exception's args[0] message names the offending stage_ids; programmatic
    consumers can read `.missing` for the typed list.
    """

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

# Maps stage_id → set of PageConfigOverrides field names the stage reads.
# Used for two purposes:
#   1. cascade_dirty_for_config_change: dirty only stages whose fields changed.
#   2. _compute_config_hash: include only relevant fields in the hash so
#      reindex --heal can detect config-driven staleness.
# Stages absent from this map read no per-page config fields.
STAGE_CONFIG_FIELDS: dict[str, frozenset[str]] = {
    "initial_crop": frozenset({"initial_crop"}),
    "manual_deskew_pre": frozenset({"deskew_before_crop", "flip_horizontal", "flip_vertical"}),
    "threshold": frozenset({"threshold_level"}),
    "find_content_edges": frozenset({"fuzzy_pct", "pixel_count_columns", "pixel_count_rows"}),
    "crop_to_content": frozenset({"white_space_additional"}),
    "auto_deskew": frozenset({"skip_auto_deskew", "deskew_after_crop"}),
    "morph_fill": frozenset({"do_morph"}),
    "rescale": frozenset({"single_dimension_rescale"}),
    "ocr_crop": frozenset({"rotated_standard"}),
    "ocr": frozenset({"use_ocr_bbox_edge"}),
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
        to_dirty.update(compute_dirty_descendants(sid))

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
) -> Any:
    """Load page + project + system defaults from DB and resolve to a
    ``ResolvedPageConfig``.

    Falls back to ``_default_resolved_page_config()`` (all-default values) when
    any DB lookup returns ``None`` — this keeps existing tests that don't seed
    project/page records working without modification.
    """
    from pd_prep_for_pgdp.core.config_resolver import resolve_page_config

    from .stage_registry import _default_resolved_page_config

    project = await database.get_project(project_id)
    if project is None:
        return _default_resolved_page_config()

    try:
        idx0 = int(page_id)
    except ValueError:
        return _default_resolved_page_config()

    page = await database.get_page(project_id, idx0)
    if page is None:
        return _default_resolved_page_config()

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
    return img


def _encode_image_to_png(img: np.ndarray) -> bytes:
    """Encode an ndarray (2-D or 3-D) to PNG bytes."""
    ok, buf = cv2.imencode(".png", img)
    if not ok:
        raise RuntimeError("cv2.imencode failed for stage output")
    return bytes(buf.tobytes())


async def _load_parent_artifact(
    *,
    data_root: Path,
    database: IDatabase,
    project_id: str,
    page_id: str,
    parent_stage_id: str,
    write_executor: StageWriteExecutor | None = None,
) -> Any:
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
    parent_stage = get_stage(parent_stage_id)

    # Check in-memory cache first (deferred-write path): the parent's file may
    # not yet be on disk if its write is still in the executor queue.
    if write_executor is not None:
        cached = write_executor.consume_artifact((project_id, page_id, parent_stage_id))
        if cached is not None:
            if parent_stage.output_type in _IMAGE_OUTPUT_TYPES:
                return _decode_image_bytes(cached)
            if parent_stage.output_type in _JSON_OUTPUT_TYPES:
                return json.loads(cached)
            # Compound or passthrough — return raw bytes; caller handles.
            return cached

    if parent_stage.output_type in COMPOUND_OUTPUT_TYPES:
        # Compound-output stages write multiple files; the single-file writer
        # refuses to produce a canonical path for them. Look in the stage
        # directory for the first `output.*` file to support downstream
        # stages that consume their text output (e.g. text_postprocess
        # consuming the text artifact from ocr).
        stage_dir = data_root / "projects" / project_id / "pages" / page_id / "stages" / parent_stage_id
        output_files = sorted(
            f for f in (stage_dir.iterdir() if stage_dir.exists() else []) if f.name.startswith("output.")
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

    if parent_stage.output_type in _IMAGE_OUTPUT_TYPES:
        return _decode_image_bytes(raw)
    if parent_stage.output_type in _JSON_OUTPUT_TYPES:
        return json.loads(raw)
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
    descendant_ids = compute_dirty_descendants(stage_id)
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
) -> None:
    """Dirty split children's decode_source when stage_id is at or before each child's split_at_stage.

    Spec: docs/specs/pipeline-task-model.md §"Cross-page dirty propagation: split children".
    """
    children = await database.list_pages_by_parent_id(project_id, page_id)
    if not children:
        return

    descendants_of_stage = compute_dirty_descendants(stage_id)

    for child in children:
        if child.split_at_stage is None:
            continue
        at_or_before = stage_id == child.split_at_stage or child.split_at_stage in descendants_of_stage
        if not at_or_before:
            continue
        child_page_id = f"{child.idx0:04d}"
        decode_row = await database.get_page_stage(project_id, child_page_id, "decode_source")
        if decode_row is None:
            continue
        if decode_row.status in {PageStageStatus.clean, PageStageStatus.failed}:
            await database.put_page_stage(decode_row.model_copy(update={"status": PageStageStatus.dirty}))
        # Cascade dirty from decode_source to its descendants within the child.
        await _cascade_dirty(
            database=database,
            project_id=project_id,
            page_id=child_page_id,
            stage_id="decode_source",
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

    # Register in-memory bytes for downstream stages (drop-on-last-consumer).
    num_consumers = sum(1 for s in _stage_dag_module.STAGE_DAG if stage_id in s.depends_on)
    write_executor.put_artifact((project_id, page_id, stage_id), artifact_bytes, num_consumers)

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

    _stage = get_stage(stage_id)
    _thumb_bytes = make_stage_thumbnail_bytes(artifact_bytes, _stage.output_type)
    _thumb_path = stage_thumbnail_path(data_root, project_id, page_id, stage_id) if _thumb_bytes else None
    _tp, _ab, _thp, _thb = target_path, artifact_bytes, _thumb_path, _thumb_bytes
    write_executor.submit_write(
        lambda: _write_artifact_file_async(_tp, _ab, thumb_path=_thp, thumb_bytes=_thb),
        on_failure=_on_failure,
        loop=loop,
    )

    return state


def _call_impl(impl: Any, artifacts: list[Any], cfg: Any) -> Any:
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
    resolved_config: Any | None = None,
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
        Canonical stage_id from `PAGE_STAGE_IDS`.
    device
        ``"cpu"`` (default) or ``"cuda"``. Slice 3 has only cpu impls; cuda
        will fall through to `KeyError` from the registry — caller should
        either fall back to cpu or surface the gap.
    storage
        IStorage adapter; only consulted for root stages whose input is the
        per-page upload (today: ``ingest_source`` reads bytes via
        ``storage.get_bytes(page_source_key)``). Optional everywhere else.
    page_source_key
        IStorage key of the page's uploaded source file (``PageRecord.source_key``);
        required iff ``stage_id == 'ingest_source'``. Other stages ignore it.
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
    stage = get_stage(stage_id)

    # Detect split-child decode_source before the dependency check. A child
    # page's decode_source reads the PARENT's ingest_source artifact (not its
    # own), so both the dep check and the artifact loading differ from the
    # normal single-page path.  We look up the PageRecord once here and reuse
    # it below — this avoids a second DB round-trip inside _resolve_config.
    _child_decode_page: PageRecord | None = None
    if stage_id == "decode_source":
        try:
            _idx0 = int(page_id)
            _page_rec = await database.get_page(project_id, _idx0)
            if _page_rec is not None and _page_rec.parent_page_id is not None:
                _child_decode_page = _page_rec
        except (ValueError, TypeError):
            pass

    # Step 1: dependency check.
    if _child_decode_page is not None:
        # Child decode_source: the dependency is the PARENT's ingest_source,
        # not the child's own (child pages don't have a source file of their own).
        _parent_ingest = await database.get_page_stage(
            project_id,
            _child_decode_page.parent_page_id or "",  # parent_page_id is always set when parent_page is set
            "ingest_source",
        )
        if _parent_ingest is None or _parent_ingest.status != PageStageStatus.clean:
            raise StageDependenciesNotMet(
                "decode_source",
                [f"parent[{_child_decode_page.parent_page_id}]:ingest_source"],
            )
    elif stage.depends_on:
        rows = await database.list_page_stages_for_page(project_id, page_id)
        rows_by_stage = {r.stage_id: r for r in rows}

        if stage.any_parent_ok:
            # At least one parent must be clean (e.g. ocr_crop's alternative
            # producers: canvas_map for normal pages, blank_proof_synth for
            # blank pages). If none are clean, report all as missing.
            has_clean_parent = any(
                rows_by_stage.get(parent_id) is not None
                and rows_by_stage[parent_id].status == PageStageStatus.clean
                for parent_id in stage.depends_on
            )
            if not has_clean_parent:
                raise StageDependenciesNotMet(
                    stage_id,
                    list(stage.depends_on),
                )
        else:
            # All parents must be clean (standard multi-parent dep check).
            missing = [
                parent_id
                for parent_id in stage.depends_on
                if (rows_by_stage.get(parent_id) is None)
                or (rows_by_stage[parent_id].status != PageStageStatus.clean)
            ]
            if missing:
                raise StageDependenciesNotMet(stage_id, missing)

    # Step 3: mark running so the UI / GET endpoint sees the transition.
    await _mark_running(
        database=database,
        project_id=project_id,
        page_id=page_id,
        stage_id=stage_id,
    )
    await _emit(stage_events, project_id, page_id, "stage-status", stage_id, "running")
    await _emit(stage_events, project_id, page_id, "stage-progress", stage_id, "running")

    # Resolve per-page config. When the caller pre-resolves (e.g. the sync route
    # handler), use that value directly. Otherwise read the latest page + project
    # + system rows from DB so config changes between request and execution are
    # always picked up (the async job path guarantees this because the job
    # handler calls run_stage after potentially waiting in the queue).
    if resolved_config is not None:
        cfg = resolved_config
    else:
        cfg = await _resolve_config(database=database, project_id=project_id, page_id=page_id)
    _cfg_hash = _compute_config_hash(cfg, stage_id)

    # Sentinel for the impl's in-memory output; set inside the else branch
    # (non-ingest_source path) so the post-run not-applicable logic can read it.
    output: Any = None

    # Step 4-5: load inputs, dispatch.
    try:
        # Current algorithm version for this stage — written into the DB row on
        # success so future reads can detect staleness against STAGE_VERSIONS.
        _stage_ver = _stage_dag_module.STAGE_VERSIONS.get(stage_id, 1)

        # Resolve the impl. Lookup failures (unknown stage / device) are
        # programmer errors and should surface as KeyError from the registry —
        # caller is expected to validate before now. If we did get here with
        # a bad device, treat it as a stage failure for safety.
        try:
            impl = get_stage_impl(stage_id, device)
        except KeyError as exc:
            raise StageRunFailed(f"stage {stage_id!r} has no impl registered for device {device!r}") from exc

        # Root-stage path: `ingest_source` has no parents and reads its bytes
        # from IStorage at `page_source_key`. The artifact written to disk is
        # the source bytes verbatim (output_type='image_bytes'); no cv2
        # decode/encode round-trip. This is the chain root that lets the user
        # click `ingest_source` first without any manual SQLite seeding.
        if stage_id == "ingest_source":
            if storage is None or page_source_key is None:
                # ValueError flows through the catch-all `except Exception`
                # branch below, which calls `_mark_failed` and wraps in
                # StageRunFailed (Q9 fail-loud).
                raise ValueError(
                    f"stage {stage_id!r} requires `storage` + `page_source_key` to read "
                    "the per-page upload; route handler must pass both"
                )
            source_bytes = await storage.get_bytes(page_source_key)
            artifact_bytes = _call_impl(impl, [source_bytes], cfg)
            if not isinstance(artifact_bytes, (bytes, bytearray)):
                raise TypeError(
                    f"stage {stage_id!r} impl returned {type(artifact_bytes).__name__}, "
                    "expected bytes for output_type='image_bytes'"
                )
            committed = await commit_stage_artifact(
                data_root=data_root,
                database=database,
                project_id=project_id,
                page_id=page_id,
                stage_id=stage_id,
                artifact_bytes=bytes(artifact_bytes),
                stage_version=_stage_ver,
            )
        elif _child_decode_page is not None:
            # Split-child decode_source path: load the PARENT's ingest_source
            # artifact, crop to source_crop_bbox, and write the cropped image.
            # The input_hash records (parent_page_id, source_crop_bbox) so that
            # a parent re-ingest correctly marks this row dirty via the cross-page
            # cascade below (spec §"Cross-page dirty propagation: split children").
            _parent_pid = _child_decode_page.parent_page_id
            _bbox = _child_decode_page.source_crop_bbox  # (x, y, w, h)
            assert _parent_pid is not None
            assert _bbox is not None

            parent_img = await _load_parent_artifact(
                data_root=data_root,
                database=database,
                project_id=project_id,
                page_id=_parent_pid,
                parent_stage_id="ingest_source",
                write_executor=write_executor,
            )

            # Crop to bbox (x, y, w, h) in source-image coordinate space.
            # Clamp to image bounds to guard against out-of-range bboxes.
            _bx, _by, _bw, _bh = _bbox
            _img_h, _img_w = parent_img.shape[:2]
            _y1, _y2 = max(0, _by), min(_img_h, _by + _bh)
            _x1, _x2 = max(0, _bx), min(_img_w, _bx + _bw)
            cropped = parent_img[_y1:_y2, _x1:_x2]
            artifact_bytes_crop = _encode_image_to_png(cropped)

            # Identity hash: deterministic on (parent_page_id, source_crop_bbox).
            # Changing either value changes the hash (acceptance bullet 2).
            _child_input_hash = hashlib.sha256(
                json.dumps(
                    {
                        "parent_page_id": _parent_pid,
                        "source_crop_bbox": list(_bbox),
                    },
                    sort_keys=True,
                ).encode()
            ).hexdigest()

            committed = await commit_stage_artifact(
                data_root=data_root,
                database=database,
                project_id=project_id,
                page_id=page_id,
                stage_id=stage_id,
                artifact_bytes=artifact_bytes_crop,
                stage_version=_stage_ver,
                content_hash=_child_input_hash,
                config_hash=_cfg_hash,
            )
        else:
            # Load parents.
            # - any_parent_ok stages (e.g. ocr_crop): load only the first clean
            #   parent in depends_on order (whichever branch ran for this page).
            # - Standard stages: load all parents. Single-parent passes the bare
            #   artifact; multi-parent passes positional args in depends_on order.
            parent_artifacts: list[Any] = []

            if stage.any_parent_ok:
                # Find the first clean parent and load only that one.
                rows_snapshot = await database.list_page_stages_for_page(project_id, page_id)
                rows_by_stage_snapshot = {r.stage_id: r for r in rows_snapshot}
                chosen_parent: str | None = next(
                    (
                        pid
                        for pid in stage.depends_on
                        if rows_by_stage_snapshot.get(pid) is not None
                        and rows_by_stage_snapshot[pid].status == PageStageStatus.clean
                    ),
                    None,
                )
                if chosen_parent is None:
                    # Should not happen — dep-check passed — but guard anyway.
                    raise StageDependenciesNotMet(stage_id, list(stage.depends_on))
                parent_artifacts.append(
                    await _load_parent_artifact(
                        data_root=data_root,
                        database=database,
                        project_id=project_id,
                        page_id=page_id,
                        parent_stage_id=chosen_parent,
                        write_executor=write_executor,
                    )
                )
            else:
                for parent_id in stage.depends_on:
                    parent_artifacts.append(
                        await _load_parent_artifact(
                            data_root=data_root,
                            database=database,
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
                if not isinstance(output, dict):
                    raise TypeError(
                        f"stage {stage_id!r} has compound output_type {stage.output_type!r}; "
                        f"impl must return dict[str, bytes], got {type(output).__name__}"
                    )
                primary_filename = COMPOUND_PRIMARY_FILENAME[stage.output_type]
                committed = await commit_stage_artifacts_multi(
                    data_root=data_root,
                    database=database,
                    project_id=project_id,
                    page_id=page_id,
                    stage_id=stage_id,
                    files=output,
                    primary_filename=primary_filename,
                    stage_version=_stage_ver,
                    config_hash=_cfg_hash,
                )
            else:
                # Single-file stages: encode to bytes then commit.
                if stage.output_type in _JSON_OUTPUT_TYPES:
                    # Coerce numpy scalar types (int64, float32, etc.) to native
                    # Python so json.dumps can serialise without a custom encoder.
                    if isinstance(output, (tuple, list)):
                        output = [int(v) if isinstance(v, np.generic) else v for v in output]
                    artifact_bytes = json.dumps(output).encode()
                elif stage.output_type == "text":
                    artifact_bytes = output.encode() if isinstance(output, str) else bytes(output)
                elif stage.output_type in _PASSTHROUGH_BYTES_OUTPUT_TYPES or isinstance(
                    output, (bytes, bytearray)
                ):
                    artifact_bytes = bytes(output)
                else:
                    # Image / gray / binary / image_bytes stages return ndarrays.
                    artifact_bytes = _encode_image_to_png(output)

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
                )
    except StageNotImplemented as exc:
        await _mark_failed(
            database=database,
            project_id=project_id,
            page_id=page_id,
            stage_id=stage_id,
            error_message=str(exc),
        )
        await _emit(stage_events, project_id, page_id, "stage-status", stage_id, "failed")
        raise StageRunFailed(str(exc)) from exc
    except StageArtifactWriteError as exc:
        await _mark_failed(
            database=database,
            project_id=project_id,
            page_id=page_id,
            stage_id=stage_id,
            error_message=f"dual-write failed: {exc}",
        )
        await _emit(stage_events, project_id, page_id, "stage-status", stage_id, "failed")
        raise StageRunFailed(f"dual-write failed for {stage_id!r}: {exc}") from exc
    except StageRunFailed:
        # Already shaped — re-raise as-is.
        raise
    except Exception as exc:
        await _mark_failed(
            database=database,
            project_id=project_id,
            page_id=page_id,
            stage_id=stage_id,
            error_message=f"{type(exc).__name__}: {exc}",
        )
        await _emit(stage_events, project_id, page_id, "stage-status", stage_id, "failed")
        raise StageRunFailed(f"stage {stage_id!r} impl raised {type(exc).__name__}: {exc}") from exc

    # Step 8a: if auto_detect_attrs just ran, mark not-applicable stages based
    # on the detected page type. This happens before dirty cascade so the
    # cascade skips these rows (they're not `clean`/`failed`).
    if stage_id == "auto_detect_attrs" and isinstance(output, dict):
        na_ids = not_applicable_stages_for_page_type(output.get("suggested_type", "normal"))
        if na_ids:
            await _mark_not_applicable(
                database=database,
                project_id=project_id,
                page_id=page_id,
                stage_ids=na_ids,
            )

    # Step 8b: cascade dirty — emit stage-status events for all descendants
    # that the cascade will mark dirty. The SSE subscribers refetch the full
    # stage list on any event, so emitting the full descendant set is correct
    # even if some rows were already dirty or not-run.
    descendant_ids = compute_dirty_descendants(stage_id)
    await _cascade_dirty(
        database=database,
        project_id=project_id,
        page_id=page_id,
        stage_id=stage_id,
    )
    for desc_id in descendant_ids:
        await _emit(stage_events, project_id, page_id, "stage-status", desc_id, "dirty")

    # Step 8c: cross-page cascade — dirty split children's decode_source when
    # this stage is at or before each child's split_at_stage (issue #55).
    await _cascade_dirty_to_split_children(
        database=database,
        project_id=project_id,
        page_id=page_id,
        stage_id=stage_id,
    )

    # Emit clean event for the completed stage after the cascade.
    await _emit(stage_events, project_id, page_id, "stage-status", stage_id, "clean")

    return committed
