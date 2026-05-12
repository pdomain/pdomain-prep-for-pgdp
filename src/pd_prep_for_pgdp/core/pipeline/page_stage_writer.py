"""Dual-write commit + reconciliation primitives for the per-page stage DAG.

Spec: `docs/specs/pipeline-task-model.md` §"Dual-write reconciliation"
(Q1-followup) and §"Persistence model" (Q3 + Q9).

The writer owns the canonical "stage produced an artifact" transition:

    write tmp file → fsync → atomic rename → DB upsert (status=clean)

On any failure the writer raises ``StageArtifactWriteError`` and rolls
back to a clean prior state — Q9 is "always fail loudly". Callers that
want to record the failure as ``status=failed`` (e.g. the route handler
or the runner) catch and translate.

The reconciler walks the on-disk tree under
``<data_root>/projects/<project_id>/pages/<page_id>/stages/`` and
compares against the ``page_stages`` rows for the same scope. It is a
pure detector — no mutation. ``pgdp-prep reindex --heal`` is the
mutator (M1 §D).

Local-mode-only at M1: the writer reaches through `Path` directly so
it can invoke `os.fsync` and `os.replace`. The IStorage abstraction's
`put_bytes` doesn't expose those primitives. When S3 mode lands, this
module gains an `S3PageStageWriter` sibling that implements the same
public contract using server-side multipart upload + DynamoDB
conditional writes (or whatever the cloud-mode design picks); for now,
the contract is local-mode-only and the route handler is gated by
storage_backend in production.
"""

from __future__ import annotations

import contextlib
import hashlib
import os
import uuid
from dataclasses import dataclass
from pathlib import Path
from time import time
from typing import Final

from ...adapters.database import IDatabase
from ...core.models import PageStageState, PageStageStatus
from .stage_dag import STAGE_DAG, get_stage

# ─── Output extension mapping ────────────────────────────────────────────────

# Maps the stage's `output_type` string (per `Stage.output_type`) to the
# file extension used for `output.<ext>` on disk. Only the concrete-single-
# file types are listed here; multi-artifact stages (`words+text`,
# `hi_res_crops`, `text+attestation`) are not yet representable as a single
# `output.<ext>` and raise a `StageArtifactWriteError` if a caller tries to
# commit them through this writer. Those stages will get a sibling writer
# in M2 (when the runner actually fires them).
OUTPUT_EXT_BY_TYPE: Final[dict[str, str]] = {
    "image_bytes": "png",
    "image": "png",
    "gray": "png",
    "binary": "png",
    "jpeg_bytes": "jpg",
    "text": "txt",
    "page_attrs": "json",
    "illustration_regions": "json",
    "bbox": "json",
}

# Stages whose output is a multi-file directory or otherwise compound.
# Listed explicitly so we fail with a clear message rather than KeyError.
COMPOUND_OUTPUT_TYPES: Final[frozenset[str]] = frozenset(
    {
        "words+text",  # ocr -> {words.json, raw.txt}
        "hi_res_crops",  # extract_illustrations -> N crops
        "text+attestation",  # text_review -> {output.txt, attestation.json}
    }
)

# Primary filename for each compound-output type — this is the file the
# DB `artifact_key` column points to (spec §"Filesystem layout").
# Callers can index this to get the primary name without hardcoding it.
COMPOUND_PRIMARY_FILENAME: Final[dict[str, str]] = {
    "words+text": "words.json",
    "hi_res_crops": "crops.json",
    "text+attestation": "output.txt",
}


class StageArtifactWriteError(RuntimeError):
    """Raised when `commit_stage_artifact` fails part-way through.

    The writer guarantees that on any failure the system is left either
    fully pre-write (no new file, no DB change) or fully rolled back to
    the prior file (if one existed). The exception's message names the
    stage and the failing sub-step.
    """


def write_artifact_file_sync(target_path: Path, artifact_bytes: bytes) -> None:
    """Write artifact bytes to disk atomically using tmp + fsync + rename.

    File-only counterpart to :func:`commit_stage_artifact` — does NOT touch
    the DB. Used by the deferred-write executor: the DB row is updated
    optimistically by the runner before submitting this to the thread pool;
    if this raises, the runner's ``on_failure`` callback flips the row to
    ``failed`` (Q9).

    Raises :exc:`StageArtifactWriteError` on any filesystem failure.
    """
    target_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_uuid = uuid.uuid4().hex
    tmp_path = target_path.with_name(f"{target_path.name}.tmp-{tmp_uuid}")

    try:
        fd = os.open(str(tmp_path), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
        try:
            with os.fdopen(fd, "wb") as fp:
                fp.write(artifact_bytes)
                fp.flush()
                os.fsync(fp.fileno())
        except BaseException:
            raise
    except BaseException as exc:
        with contextlib.suppress(OSError):
            tmp_path.unlink(missing_ok=True)
        raise StageArtifactWriteError(
            f"deferred write failed (tmp write to {target_path.name!r}): {exc!r}"
        ) from exc

    try:
        os.replace(str(tmp_path), str(target_path))
    except OSError as exc:
        with contextlib.suppress(OSError):
            tmp_path.unlink(missing_ok=True)
        raise StageArtifactWriteError(
            f"deferred write failed (rename to {target_path.name!r}): {exc!r}"
        ) from exc


def _ext_for_stage(stage_id: str) -> str:
    """Resolve the canonical file extension for `stage_id`'s output, or raise.

    Raises ``StageArtifactWriteError`` for compound-output stages and
    ``KeyError`` for unknown stage_ids.
    """
    stage = get_stage(stage_id)
    if stage.output_type in COMPOUND_OUTPUT_TYPES:
        raise StageArtifactWriteError(
            f"stage {stage_id!r} has compound output_type {stage.output_type!r}; "
            "use the dedicated multi-artifact writer (not yet implemented at M1 §C). "
            "Single-file commits via commit_stage_artifact don't apply."
        )
    try:
        return OUTPUT_EXT_BY_TYPE[stage.output_type]
    except KeyError as exc:
        raise StageArtifactWriteError(
            f"stage {stage_id!r} has output_type {stage.output_type!r} which has no "
            "extension mapping in OUTPUT_EXT_BY_TYPE; add one or use a sibling writer."
        ) from exc


def stage_artifact_path(
    data_root: Path,
    project_id: str,
    page_id: str,
    stage_id: str,
) -> Path:
    """Return the canonical absolute path for a stage's `output.<ext>` artifact.

    Layout per spec §"Filesystem layout":
    ``<data_root>/projects/<project_id>/pages/<page_id>/stages/<stage_id>/output.<ext>``.

    Raises ``StageArtifactWriteError`` if the stage has a compound output.
    """
    ext = _ext_for_stage(stage_id)
    return data_root / "projects" / project_id / "pages" / page_id / "stages" / stage_id / f"output.{ext}"


def stage_artifact_key(project_id: str, page_id: str, stage_id: str) -> str:
    """Return the IStorage key for a stage's `output.<ext>` artifact.

    Same layout as :func:`stage_artifact_path` but rooted relative to the
    storage's prefix root (no leading `<data_root>` slash).
    """
    ext = _ext_for_stage(stage_id)
    return f"projects/{project_id}/pages/{page_id}/stages/{stage_id}/output.{ext}"


def compute_content_hash(data: bytes) -> str:
    """sha256-hex of the artifact bytes (Q1: `content_hash` policy)."""
    return hashlib.sha256(data).hexdigest()


# ─── commit_stage_artifact ──────────────────────────────────────────────────


async def commit_stage_artifact(
    *,
    data_root: Path,
    database: IDatabase,
    project_id: str,
    page_id: str,
    stage_id: str,
    artifact_bytes: bytes,
    stage_version: int = 1,
    content_hash: str | None = None,
    job_id: str | None = None,
) -> PageStageState:
    """Atomically commit a stage's output artifact + DB row.

    Steps (Q1-followup dual-write contract):

    1. Compute the canonical path. Ensure the parent dir exists.
    2. Write to a sibling temp file ``output.<ext>.tmp-<uuid>``.
    3. ``os.fsync`` the temp file's descriptor.
    4. If a prior ``output.<ext>`` exists, snapshot it to a sibling
       ``.tmp-prior-<uuid>`` so we can restore on later DB failure.
    5. ``os.replace`` the temp into the canonical name.
    6. Upsert the ``page_stages`` row to ``status=clean`` with the
       artifact key, hash, version, and ``last_run_at=time()``.
    7. On any failure: clean up temp files, restore prior file if we
       had snapshotted it, raise ``StageArtifactWriteError``. The DB
       row is NOT touched on file-side failures, and on DB-side
       failures the file is rolled back.

    Q9 ("always fail loudly"): no swallowed exceptions. Callers that
    want to record `failed` translate the raise themselves.
    """
    if content_hash is None:
        content_hash = compute_content_hash(artifact_bytes)

    target_path = stage_artifact_path(data_root, project_id, page_id, stage_id)
    artifact_key = stage_artifact_key(project_id, page_id, stage_id)

    target_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_uuid = uuid.uuid4().hex
    tmp_path = target_path.with_name(f"{target_path.name}.tmp-{tmp_uuid}")
    prior_snapshot: Path | None = None

    # Step 2-3: write tmp + fsync. Failures here leave nothing behind that
    # we need to clean up beyond the (possibly partial) tmp file.
    try:
        fd = os.open(str(tmp_path), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
        try:
            with os.fdopen(fd, "wb") as fp:
                fp.write(artifact_bytes)
                fp.flush()
                os.fsync(fp.fileno())
        except BaseException:
            # fdopen took ownership of fd already; nothing extra to close.
            raise
    except BaseException as exc:
        if tmp_path.exists():
            with contextlib.suppress(OSError):
                tmp_path.unlink()
        raise StageArtifactWriteError(f"failed to write tmp artifact for {stage_id!r}: {exc!r}") from exc

    # Step 4: snapshot prior file (if any) so we can roll back on DB failure.
    if target_path.exists():
        prior_snapshot = target_path.with_name(f"{target_path.name}.tmp-prior-{tmp_uuid}")
        try:
            os.replace(str(target_path), str(prior_snapshot))
        except OSError as exc:
            if tmp_path.exists():
                tmp_path.unlink()
            raise StageArtifactWriteError(f"failed to snapshot prior {stage_id!r} artifact: {exc!r}") from exc

    # Step 5: atomic rename tmp -> canonical.
    try:
        os.replace(str(tmp_path), str(target_path))
    except OSError as exc:
        if tmp_path.exists():
            tmp_path.unlink()
        if prior_snapshot is not None and prior_snapshot.exists():
            with contextlib.suppress(OSError):
                os.replace(str(prior_snapshot), str(target_path))
        raise StageArtifactWriteError(
            f"failed to rename tmp artifact to {target_path.name!r}: {exc!r}"
        ) from exc

    # Step 6: DB upsert. On failure, roll the file change back.
    state = PageStageState(
        project_id=project_id,
        page_id=page_id,
        stage_id=stage_id,
        status=PageStageStatus.clean,
        stage_version=stage_version,
        artifact_key=artifact_key,
        input_hash=content_hash,
        last_run_at=time(),
        error_message=None,
        job_id=job_id,
    )
    try:
        await database.put_page_stage(state)
    except BaseException as exc:
        # File rollback: replace canonical with the snapshot, or delete it
        # if no prior file existed.
        with contextlib.suppress(OSError):
            if prior_snapshot is not None and prior_snapshot.exists():
                os.replace(str(prior_snapshot), str(target_path))
            elif target_path.exists():
                target_path.unlink()
        raise StageArtifactWriteError(f"DB upsert failed for {stage_id!r}: {exc!r}") from exc

    # Cleanup: prior snapshot is no longer needed.
    if prior_snapshot is not None and prior_snapshot.exists():
        with contextlib.suppress(OSError):
            prior_snapshot.unlink()

    return state


# ─── commit_stage_artifacts_multi ───────────────────────────────────────────


async def commit_stage_artifacts_multi(
    *,
    data_root: Path,
    database: IDatabase,
    project_id: str,
    page_id: str,
    stage_id: str,
    files: dict[str, bytes],
    primary_filename: str,
    stage_version: int = 1,
    job_id: str | None = None,
) -> PageStageState:
    """Atomically commit a set of stage output files + DB row.

    Used for compound-output stages whose ``output_type`` is in
    ``COMPOUND_OUTPUT_TYPES`` (``words+text``, ``hi_res_crops``,
    ``text+attestation``). Mirrors ``commit_stage_artifact``'s
    dual-write contract for each file:

    1. Create the stage directory if needed.
    2. For each ``(filename, data)`` in ``files``: write to a sibling
       ``.tmp-<uuid>`` then ``os.fsync``.
    3. Snapshot any pre-existing file that would be overwritten.
    4. Atomic-rename every tmp into its canonical name.
    5. Upsert the ``page_stages`` DB row as ``status=clean``.  The
       ``artifact_key`` column points to ``primary_filename`` within
       the stage directory.
    6. On any failure: unlink all tmp files, restore snapshots, raise
       ``StageArtifactWriteError``.

    ``primary_filename`` must be a key in ``files``.
    """
    if primary_filename not in files:
        raise StageArtifactWriteError(
            f"primary_filename {primary_filename!r} not in files dict for stage {stage_id!r}"
        )

    stage_dir = data_root / "projects" / project_id / "pages" / page_id / "stages" / stage_id
    stage_dir.mkdir(parents=True, exist_ok=True)

    tmp_uuid = uuid.uuid4().hex
    # Map from canonical path -> tmp path for cleanup and rename.
    tmp_paths: dict[Path, Path] = {}
    # Snapshots of pre-existing files (canonical -> snapshot path).
    snapshots: dict[Path, Path] = {}

    # Step 2-3: write all tmps + fsync.
    try:
        for filename, data in files.items():
            target = stage_dir / filename
            tmp = target.with_name(f"{filename}.tmp-{tmp_uuid}")
            tmp_paths[target] = tmp
            try:
                fd = os.open(str(tmp), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
                try:
                    with os.fdopen(fd, "wb") as fp:
                        fp.write(data)
                        fp.flush()
                        os.fsync(fp.fileno())
                except BaseException:
                    raise
            except BaseException as exc:
                if tmp.exists():
                    with contextlib.suppress(OSError):
                        tmp.unlink()
                raise StageArtifactWriteError(
                    f"failed to write tmp artifact {filename!r} for stage {stage_id!r}: {exc!r}"
                ) from exc
    except StageArtifactWriteError:
        # Clean up any tmps already written before the failure.
        for t in tmp_paths.values():
            if t.exists():
                with contextlib.suppress(OSError):
                    t.unlink()
        raise

    # Step 4: snapshot pre-existing files.
    try:
        for target, _tmp in tmp_paths.items():
            if target.exists():
                snap = target.with_name(f"{target.name}.tmp-prior-{tmp_uuid}")
                try:
                    os.replace(str(target), str(snap))
                    snapshots[target] = snap
                except OSError as exc:
                    # Roll back tmps already written.
                    for t in tmp_paths.values():
                        if t.exists():
                            with contextlib.suppress(OSError):
                                t.unlink()
                    # Restore any snapshots already moved.
                    for canon, snap2 in snapshots.items():
                        if snap2.exists():
                            with contextlib.suppress(OSError):
                                os.replace(str(snap2), str(canon))
                    raise StageArtifactWriteError(
                        f"failed to snapshot prior {target.name!r} for stage {stage_id!r}: {exc!r}"
                    ) from exc
    except StageArtifactWriteError:
        raise

    # Step 5: atomic rename tmps -> canonical names.
    try:
        for target, tmp in tmp_paths.items():
            try:
                os.replace(str(tmp), str(target))
            except OSError as exc:
                # Roll back: remove any canonical files already placed, restore
                # snapshots, remove remaining tmps.
                for _t2, canon2 in {v: k for k, v in tmp_paths.items()}.items():
                    # Remove already-placed canonical files (except those with snapshot).
                    if canon2.exists() and canon2 not in snapshots:
                        with contextlib.suppress(OSError):
                            canon2.unlink()
                for canon, snap in snapshots.items():
                    if snap.exists():
                        with contextlib.suppress(OSError):
                            os.replace(str(snap), str(canon))
                for t in tmp_paths.values():
                    if t.exists():
                        with contextlib.suppress(OSError):
                            t.unlink()
                raise StageArtifactWriteError(
                    f"failed to rename tmp {target.name!r} for stage {stage_id!r}: {exc!r}"
                ) from exc
    except StageArtifactWriteError:
        raise

    # Step 6: DB upsert.
    primary_key = f"projects/{project_id}/pages/{page_id}/stages/{stage_id}/{primary_filename}"
    primary_hash = compute_content_hash(files[primary_filename])
    state = PageStageState(
        project_id=project_id,
        page_id=page_id,
        stage_id=stage_id,
        status=PageStageStatus.clean,
        stage_version=stage_version,
        artifact_key=primary_key,
        input_hash=primary_hash,
        last_run_at=time(),
        error_message=None,
        job_id=job_id,
    )
    try:
        await database.put_page_stage(state)
    except BaseException as exc:
        # Roll back all file writes: restore snapshots or remove placed files.
        for target in tmp_paths:
            snap = snapshots.get(target)
            if snap is not None and snap.exists():
                with contextlib.suppress(OSError):
                    os.replace(str(snap), str(target))
            elif target.exists():
                with contextlib.suppress(OSError):
                    target.unlink()
        raise StageArtifactWriteError(f"DB upsert failed for {stage_id!r}: {exc!r}") from exc

    # Cleanup: remove snapshots.
    for snap in snapshots.values():
        if snap.exists():
            with contextlib.suppress(OSError):
                snap.unlink()

    return state


# ─── reconcile_page ──────────────────────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class OrphanFile:
    """A file under `pages/<page_id>/stages/<stage_id>/` with no matching clean DB row.

    `relative_key` is the IStorage-style relative key, useful for both
    logging and `--heal`'s move-to-quarantine target.
    """

    project_id: str
    page_id: str
    stage_id: str
    relative_key: str
    absolute_path: Path
    reason: str  # "no-row" or "stale-hash"


@dataclass(frozen=True, slots=True)
class MissingFile:
    """A `clean` page_stages row whose on-disk artifact is gone."""

    project_id: str
    page_id: str
    stage_id: str
    expected_path: Path


@dataclass(frozen=True, slots=True)
class HashMismatch:
    """A `clean` row + on-disk file whose hashes don't agree."""

    project_id: str
    page_id: str
    stage_id: str
    absolute_path: Path
    db_hash: str | None
    file_hash: str


@dataclass(frozen=True, slots=True)
class ReconcileReport:
    """What `reconcile_page` found. `is_clean` is True iff every list is empty."""

    project_id: str
    page_id: str
    orphan_files: tuple[OrphanFile, ...]
    missing_files: tuple[MissingFile, ...]
    hash_mismatches: tuple[HashMismatch, ...]

    @property
    def is_clean(self) -> bool:
        return not (self.orphan_files or self.missing_files or self.hash_mismatches)


async def reconcile_page(
    *,
    data_root: Path,
    database: IDatabase,
    project_id: str,
    page_id: str,
) -> ReconcileReport:
    """Detect drift between the `page_stages` rows and the on-disk artifacts.

    Pure detector. Returns a :class:`ReconcileReport`; never mutates state.
    The `--heal` CLI in M1 §D is the mutator.

    Algorithm:

    1. Fetch all `page_stages` rows for `(project_id, page_id)`.
    2. Walk every directory under
       ``<data_root>/projects/<project_id>/pages/<page_id>/stages/`` and
       enumerate `output.*` files.
    3. For each row with status `clean`: file must exist at the expected
       path AND hash must match `input_hash`. Report `MissingFile` or
       `HashMismatch` accordingly.
    4. For each on-disk file: must have a matching `clean` row at the
       expected path AND that row's `input_hash` must match the file's
       sha256. Report `OrphanFile(reason="no-row")` if the row is missing
       or non-clean; `OrphanFile(reason="stale-hash")` if the hash differs.
    """
    rows = await database.list_page_stages_for_page(project_id, page_id)
    rows_by_stage: dict[str, PageStageState] = {r.stage_id: r for r in rows}

    page_root = data_root / "projects" / project_id / "pages" / page_id / "stages"
    on_disk: dict[str, Path] = {}  # stage_id -> path of output.* file (only one expected)
    orphans: list[OrphanFile] = []
    missing: list[MissingFile] = []
    mismatches: list[HashMismatch] = []

    if page_root.exists():
        for stage_dir in sorted(p for p in page_root.iterdir() if p.is_dir()):
            stage_id = stage_dir.name
            output_files = sorted(
                p for p in stage_dir.iterdir() if p.is_file() and p.name.startswith("output.")
            )
            # Skip tmp files — they're transient mid-write artifacts.
            output_files = [p for p in output_files if ".tmp-" not in p.name]
            if not output_files:
                continue
            # Multi-artifact stages legitimately have multiple files. For now,
            # only the single-file convention is tracked. Take the first
            # `output.*` and report the rest, if any, as orphans (they
            # shouldn't exist under the single-file contract).
            primary = output_files[0]
            on_disk[stage_id] = primary
            for extra in output_files[1:]:
                rel = extra.relative_to(data_root).as_posix()
                orphans.append(
                    OrphanFile(
                        project_id=project_id,
                        page_id=page_id,
                        stage_id=stage_id,
                        relative_key=rel,
                        absolute_path=extra,
                        reason="extra-file",
                    )
                )

    # Pass 1: rows that promise files.
    for stage_id, row in rows_by_stage.items():
        if row.status != PageStageStatus.clean:
            continue
        # Determine expected path. We need the stage's output_type to know
        # the extension; if we can't (compound stages), fall back to "any
        # file under the stage dir" for missing detection.
        try:
            expected = stage_artifact_path(data_root, project_id, page_id, stage_id)
        except StageArtifactWriteError:
            # Compound stages aren't yet writable through this writer; if a
            # row claims clean for one, treat it as a "missing" report at
            # the stage-dir level.
            expected = page_root / stage_id / "output"
        if not expected.exists():
            missing.append(
                MissingFile(
                    project_id=project_id,
                    page_id=page_id,
                    stage_id=stage_id,
                    expected_path=expected,
                )
            )
            continue
        # File exists — hash check.
        try:
            disk_bytes = expected.read_bytes()
        except OSError:
            missing.append(
                MissingFile(
                    project_id=project_id,
                    page_id=page_id,
                    stage_id=stage_id,
                    expected_path=expected,
                )
            )
            continue
        file_hash = compute_content_hash(disk_bytes)
        if row.input_hash is not None and row.input_hash != file_hash:
            mismatches.append(
                HashMismatch(
                    project_id=project_id,
                    page_id=page_id,
                    stage_id=stage_id,
                    absolute_path=expected,
                    db_hash=row.input_hash,
                    file_hash=file_hash,
                )
            )

    # Pass 2: on-disk files that don't have a matching clean row.
    known_stage_ids = {s.id for s in STAGE_DAG}
    for stage_id, path in on_disk.items():
        if stage_id not in known_stage_ids:
            # File under an unknown stage_id is always an orphan.
            rel = path.relative_to(data_root).as_posix()
            orphans.append(
                OrphanFile(
                    project_id=project_id,
                    page_id=page_id,
                    stage_id=stage_id,
                    relative_key=rel,
                    absolute_path=path,
                    reason="unknown-stage",
                )
            )
            continue
        row = rows_by_stage.get(stage_id)
        if row is None or row.status != PageStageStatus.clean:
            rel = path.relative_to(data_root).as_posix()
            orphans.append(
                OrphanFile(
                    project_id=project_id,
                    page_id=page_id,
                    stage_id=stage_id,
                    relative_key=rel,
                    absolute_path=path,
                    reason="no-row" if row is None else "non-clean-row",
                )
            )
            continue
        # Hash mismatch already caught in pass 1; skip duplicates.

    return ReconcileReport(
        project_id=project_id,
        page_id=page_id,
        orphan_files=tuple(orphans),
        missing_files=tuple(missing),
        hash_mismatches=tuple(mismatches),
    )
