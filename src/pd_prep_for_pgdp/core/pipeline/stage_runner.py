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
2. Validate the stage isn't compound-output (Slice 3 single-file
   contract). Else raise `StageOutputUnsupported`.
3. Mark the page_stages row `running` and commit. The GET endpoint
   sees the transition immediately.
4. Load each parent's clean artifact off disk. For image-typed parents,
   decode bytes → ndarray. For json-typed parents, parse. (Slice 3
   only handles the image case — the only stages with real impls are
   grayscale/threshold/invert, all image-in/image-out.)
5. Look up `STAGE_IMPL[stage_id][device]` (cpu by default).
6. Call it with the loaded input(s).
7. Encode the output (ndarray → PNG bytes) and dual-write via
   `commit_stage_artifact`. That writes the file, fsyncs, atomically
   renames, then upserts the DB row to `clean`.
8. Cascade dirty: `compute_dirty_descendants(stage_id)` returns the
   transitive set of stage_ids downstream. For each one currently
   `clean` or `failed`, set status `dirty`. Rows already `not-run` or
   `dirty` stay as-is.
9. Return the new `PageStageState`.

## Failure model

- `StageDependenciesNotMet`: dep rows aren't `clean`. Raised before any
  state mutation; row stays `not-run` / whatever it was.
- `StageOutputUnsupported`: stage's `output_type` is in
  `COMPOUND_OUTPUT_TYPES`. Single-file writer can't dual-write; raise
  before mutation. Row stays `not-run`.
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

import logging
from pathlib import Path
from time import time

import cv2  # type: ignore[import-not-found]
import numpy as np

from ...adapters.database.base import IDatabase
from ...adapters.storage.base import IStorage
from ..models import PageStageState, PageStageStatus
from .page_stage_writer import (
    COMPOUND_OUTPUT_TYPES,
    StageArtifactWriteError,
    commit_stage_artifact,
    stage_artifact_path,
)
from .stage_dag import compute_dirty_descendants, get_stage
from .stage_registry import StageNotImplemented, get_stage_impl

log = logging.getLogger(__name__)


# ─── Typed exceptions ───────────────────────────────────────────────────────


class StageDependenciesNotMet(RuntimeError):
    """Raised before any mutation when one or more `depends_on` rows are not `clean`.

    The exception's args[0] message names the offending stage_ids; programmatic
    consumers can read `.missing` for the typed list.
    """

    def __init__(self, stage_id: str, missing: list[str]) -> None:
        self.stage_id = stage_id
        self.missing = missing
        super().__init__(f"stage {stage_id!r}: dependencies not clean; missing or non-clean: {missing}")


class StageOutputUnsupported(RuntimeError):
    """Raised when the stage's `output_type` is compound (`ocr`, `extract_illustrations`,
    `text_review`).

    Slice 3 ships only the single-file writer; the multi-artifact writer
    lands in a later slice. This is a clear breadcrumb so callers see
    which surfaces still need the second writer.
    """


class StageRunFailed(RuntimeError):
    """Raised when the registered impl or the dual-write commit failed.

    The page_stages row will already have been marked `failed` by the
    runner (with the underlying exception's text in `error_message`)
    before this is raised. Q9: fail loudly — the route handler / dispatcher
    is expected to surface this to the user, not swallow it.
    """


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
) -> np.ndarray:
    """Load a parent stage's clean artifact, decoded into the runner's
    canonical in-memory type.

    Slice 3 only handles image parents (PNG / JPG bytes → ndarray). When
    the runner extends to json/text/bbox parents (later slices), this
    becomes a dispatch table keyed on `Stage.output_type`.
    """
    path = stage_artifact_path(data_root, project_id, page_id, parent_stage_id)
    if not path.exists():
        # Reconciler-visible drift: the row claims clean but the file is gone.
        # Surface as a dependency-not-met so the caller can heal it.
        raise StageDependenciesNotMet(
            parent_stage_id,
            [f"{parent_stage_id}: artifact missing at {path}"],
        )
    return _decode_image_bytes(path.read_bytes())


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

    Returns
    -------
    PageStageState
        The freshly-committed row (status=clean on success).

    Raises
    ------
    StageDependenciesNotMet
        Before any mutation, when not all parents are clean.
    StageOutputUnsupported
        Before any mutation, when the stage's output_type is compound.
    StageRunFailed
        After marking the row `failed` and updating the DB.
    """
    stage = get_stage(stage_id)

    # Step 2 (early): refuse compound-output stages — single-file writer only.
    if stage.output_type in COMPOUND_OUTPUT_TYPES:
        raise StageOutputUnsupported(
            f"stage {stage_id!r} has compound output_type {stage.output_type!r}; "
            "the multi-artifact writer is not implemented yet (M2 slice 3 ships "
            "the single-file contract only)"
        )

    # Step 1: dependency check.
    if stage.depends_on:
        rows = await database.list_page_stages_for_page(project_id, page_id)
        rows_by_stage = {r.stage_id: r for r in rows}
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

    # Step 4-5: load inputs, dispatch.
    try:
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
            artifact_bytes = impl(source_bytes)
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
            )
        else:
            # Load parents. Single-parent stages pass the bare ndarray; multi-parent
            # stages pass a tuple in the `Stage.depends_on` order (Slice 3 only
            # exercises grayscale/threshold/invert which are all single-parent —
            # the multi-parent dispatch path lands when `crop_to_content` etc.
            # get real impls).
            parent_artifacts: list[np.ndarray] = []
            for parent_id in stage.depends_on:
                parent_artifacts.append(
                    await _load_parent_artifact(
                        data_root=data_root,
                        database=database,
                        project_id=project_id,
                        page_id=page_id,
                        parent_stage_id=parent_id,
                    )
                )

            if len(parent_artifacts) == 1:
                output = impl(parent_artifacts[0])
            else:
                output = impl(*parent_artifacts)

            # Step 7: encode + dual-write. (Slice 3 only emits PNGs since the
            # three real impls all return ndarrays; later slices generalise this
            # by branching on `Stage.output_type`.)
            artifact_bytes = _encode_image_to_png(output)
            committed = await commit_stage_artifact(
                data_root=data_root,
                database=database,
                project_id=project_id,
                page_id=page_id,
                stage_id=stage_id,
                artifact_bytes=artifact_bytes,
            )
    except StageNotImplemented as exc:
        await _mark_failed(
            database=database,
            project_id=project_id,
            page_id=page_id,
            stage_id=stage_id,
            error_message=str(exc),
        )
        raise StageRunFailed(str(exc)) from exc
    except StageArtifactWriteError as exc:
        await _mark_failed(
            database=database,
            project_id=project_id,
            page_id=page_id,
            stage_id=stage_id,
            error_message=f"dual-write failed: {exc}",
        )
        raise StageRunFailed(f"dual-write failed for {stage_id!r}: {exc}") from exc
    except StageRunFailed:
        # Already shaped — re-raise as-is.
        raise
    except Exception as exc:  # noqa: BLE001 — Q9 fail-loud catch-all
        await _mark_failed(
            database=database,
            project_id=project_id,
            page_id=page_id,
            stage_id=stage_id,
            error_message=f"{type(exc).__name__}: {exc}",
        )
        raise StageRunFailed(f"stage {stage_id!r} impl raised {type(exc).__name__}: {exc}") from exc

    # Step 8: cascade dirty.
    await _cascade_dirty(
        database=database,
        project_id=project_id,
        page_id=page_id,
        stage_id=stage_id,
    )

    return committed
