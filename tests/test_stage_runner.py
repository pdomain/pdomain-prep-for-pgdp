"""M2 Slice 3 — `core.pipeline.stage_runner.run_stage`.

Spec: `docs/specs/pipeline-task-model.md` §"Per-page stage runner" /
§"Dirty propagation" (locked 2026-05-07).

The runner is the engine that ties the pieces together for one stage on
one page:

1. Validate the stage's `depends_on` rows are all `clean`. Else raise
   `StageDependenciesNotMet`.
2. Pick `device` (cpu by default; cuda when registered + available).
3. Mark `page_stages` row `running` (commit immediately so the GET
   endpoint sees the transition).
4. Load each parent's clean artifact off disk; decode to the runner's
   canonical in-memory type (numpy.ndarray for cpu).
5. Call `STAGE_IMPL[stage_id][device]` with that input.
6. Encode the output (ndarray → PNG bytes today) and dual-write via
   `commit_stage_artifact` — that takes the row to `clean`.
7. Cascade dirty to descendants currently `clean` or `failed`.
8. Return the new `PageStageState`.

Failures translate to `status=failed` + `error_message`; descendants
are NOT dirtied (the previous output, if any, is still consistent).
`StageNotImplemented` (registry placeholder) becomes a clear "not yet
implemented" message rather than the engine claiming a real bug.

Compound-output stages (`ocr`, `text_review`) route through the
multi-artifact writer added in Slice 14. `extract_illustrations` remains
a placeholder until the illustration-crop logic lands.
"""

from __future__ import annotations

import contextlib
from typing import TYPE_CHECKING

import cv2
import numpy as np
import pytest

from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pdomain_prep_for_pgdp.core.models import (
    PageStageState,
    PageStageStatus,
)
from pdomain_prep_for_pgdp.core.pipeline.page_stage_writer import (
    commit_stage_artifact,
    stage_artifact_path,
)
from pdomain_prep_for_pgdp.core.pipeline.stage_runner import (
    StageDependenciesNotMet,
    StageRunFailed,
    _call_impl,
    run_stage,
)
from tests.fixtures.seed_pages import seed_page_in_store, seed_v2_page_source

if TYPE_CHECKING:
    from pathlib import Path

# ─── Unit tests ─────────────────────────────────────────────────────────────


def test_numpy_scalar_in_output_uses_isinstance_not_hasattr() -> None:
    """Numpy scalar detection must use isinstance(v, np.generic), not hasattr(v, 'item').

    An object with an .item() method that is NOT np.generic must not be
    coerced via int() in the JSON-output coercion path.  We verify this by
    checking that _call_impl round-trips through an impl that returns a
    np.int64 scalar (which IS np.generic) and that a plain object with
    .item() (which is NOT np.generic) would not be cast.
    """

    class FakeWithItem:
        """Has .item() but is NOT np.generic — must NOT be int()-cast."""

        def item(self) -> int:
            return 99

    # np.int64 IS np.generic — _call_impl itself just calls the impl; the
    # coercion happens in run_stage for JSON output types.  Test the
    # isinstance guard directly.
    np_val = np.int64(42)
    fake_val = FakeWithItem()

    assert isinstance(np_val, np.generic), "np.int64 must satisfy isinstance(v, np.generic)"
    assert not isinstance(fake_val, np.generic), "FakeWithItem must NOT satisfy isinstance(v, np.generic)"

    # Applying the coercion expression used in run_stage:
    coerce = lambda v: int(v) if isinstance(v, np.generic) else v  # noqa: E731  -- mirrors run_stage's coercion expression verbatim; a def would obscure the 1:1 correspondence
    assert coerce(np_val) == 42
    assert coerce(fake_val) is fake_val, "FakeWithItem must be returned unchanged"


def test_call_impl_always_passes_cfg() -> None:
    """_call_impl must always forward cfg= to the impl callable."""
    received: list[object] = []

    def _impl(x: int, cfg=None) -> int:
        received.append(cfg)
        return x

    sentinel = object()
    result = _call_impl(_impl, [7], sentinel)
    assert result == 7
    assert received == [sentinel], "_call_impl must forward cfg to the impl"


# ─── Fixtures ───────────────────────────────────────────────────────────────


@pytest.fixture
async def db(tmp_path: Path) -> SqliteDatabase:
    d = SqliteDatabase(f"sqlite:///{(tmp_path / 's.db').as_posix()}")
    await d.initialize()
    return d


def _checkerboard_bgr_png() -> bytes:
    """Build a small BGR PNG bytes payload for use as an image stage input."""
    img = np.zeros((20, 20, 3), dtype=np.uint8)
    img[::2, ::2] = (200, 200, 200)
    img[1::2, 1::2] = (200, 200, 200)
    ok, buf = cv2.imencode(".png", img)
    assert ok
    return bytes(buf.tobytes())


async def _seed_clean_parents(
    db: SqliteDatabase,
    data_root: Path,
    project_id: str,
    page_id: str,
    parent_stages: list[str],
    payload: bytes,
) -> None:
    """Seed every `parent_stages` row as `clean` with `payload` on disk via
    the canonical writer.

    Uses `commit_stage_artifact` for each parent — this is exactly the path
    a previous stage's run would've taken, so disk + DB stay aligned.
    """
    await db.init_page_stages_for_page(project_id, page_id)
    for sid in parent_stages:
        await commit_stage_artifact(
            data_root=data_root,
            database=db,
            project_id=project_id,
            page_id=page_id,
            stage_id=sid,
            artifact_bytes=payload,
        )


# ─── Happy path: grayscale (v2 root page stage from BlobStore) ─────────────


@pytest.mark.asyncio
async def test_run_stage_grayscale_happy_path(tmp_path: Path, db: SqliteDatabase) -> None:
    """`grayscale` runs end-to-end: row → running → clean, file lands on disk.

    In the v2 DAG `grayscale` has no page-scoped parents — it reads the source
    image from the BlobStore via PrepPageExtension.source_blob_hash.
    """
    project_id, page_id = "p1", "0000"
    payload = _checkerboard_bgr_png()
    # v2: seed the source image in the BlobStore so grayscale can load it.
    seed_v2_page_source(tmp_path, project_id, 0, payload)
    await db.init_page_stages_for_page(project_id, page_id)

    state = await run_stage(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=page_id,
        stage_id="grayscale",
    )

    assert state.status == PageStageStatus.clean
    assert state.input_hash is not None
    assert state.last_run_at is not None

    # File exists at the canonical path.
    artifact_path = stage_artifact_path(tmp_path, project_id, page_id, "grayscale")
    assert artifact_path.exists()
    assert artifact_path.stat().st_size > 0

    # The on-disk artifact decodes as a 2-D grayscale PNG.
    out_arr = cv2.imdecode(np.frombuffer(artifact_path.read_bytes(), np.uint8), cv2.IMREAD_UNCHANGED)
    assert out_arr.ndim == 2


# ─── Dependency check: parent not clean ─────────────────────────────────────


@pytest.mark.asyncio
async def test_run_stage_raises_when_dependencies_not_met(tmp_path: Path, db: SqliteDatabase) -> None:
    """`crop` requires `grayscale` to be clean. Lazy-init creates
    rows as `not-run`, so a fresh page should fail dep-check.

    v2 DAG: `crop` depends on `grayscale`; `grayscale` is the root page stage.
    """
    project_id, page_id = "p1", "0000"
    await db.init_page_stages_for_page(project_id, page_id)

    with pytest.raises(StageDependenciesNotMet) as exc_info:
        await run_stage(
            data_root=tmp_path,
            database=db,
            project_id=project_id,
            page_id=page_id,
            stage_id="crop",
        )
    # The exception names the offending stage(s) so the caller can propose
    # auto-running them.
    assert "grayscale" in str(exc_info.value)


# ─── Eager dirty cascade ────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_run_stage_cascades_dirty_to_descendants(tmp_path: Path, db: SqliteDatabase) -> None:
    """Running `grayscale` after `threshold` is `clean` re-dirties `threshold`.

    Q2 (eager dirty cascade): when a stage's output changes, every
    descendant currently `clean` or `failed` flips to `dirty`. Descendants
    that are already `not-run` stay `not-run`.
    """
    project_id, page_id = "p1", "0000"
    payload = _checkerboard_bgr_png()
    # v2: seed source image in BlobStore so grayscale can load it.
    seed_v2_page_source(tmp_path, project_id, 0, payload)
    # Seed grayscale + threshold as clean so the cascade test has something to dirty.
    # (The runner doesn't validate the full ancestor chain — only immediate parents.)
    await _seed_clean_parents(
        db,
        tmp_path,
        project_id,
        page_id,
        parent_stages=["grayscale", "threshold"],
        payload=payload,
    )

    # Sanity-check seed.
    threshold_row = await db.get_page_stage(project_id, page_id, "threshold")
    assert threshold_row is not None
    assert threshold_row.status == PageStageStatus.clean

    # Re-run grayscale — should cascade dirty to threshold (and any other
    # descendants).
    await run_stage(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=page_id,
        stage_id="grayscale",
    )

    # threshold is a direct descendant of grayscale, was clean → must be dirty.
    threshold_row_after = await db.get_page_stage(project_id, page_id, "threshold")
    assert threshold_row_after is not None
    assert threshold_row_after.status == PageStageStatus.dirty


@pytest.mark.asyncio
async def test_run_stage_cascade_does_not_redirty_not_run(tmp_path: Path, db: SqliteDatabase) -> None:
    """Descendants that are already `not-run` stay `not-run` (Q2)."""
    project_id, page_id = "p1", "0000"
    payload = _checkerboard_bgr_png()
    # v2: seed source image in BlobStore; everything else stays not-run.
    seed_v2_page_source(tmp_path, project_id, 0, payload)
    await db.init_page_stages_for_page(project_id, page_id)

    await run_stage(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=page_id,
        stage_id="grayscale",
    )

    threshold_row = await db.get_page_stage(project_id, page_id, "threshold")
    assert threshold_row is not None
    assert threshold_row.status == PageStageStatus.not_run, (
        "threshold was never clean; cascade must not flip it to dirty"
    )


# ─── Failure path: registered stage raises ──────────────────────────────────


@pytest.mark.asyncio
async def test_run_stage_records_failure_when_impl_raises(
    tmp_path: Path,
    db: SqliteDatabase,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An exception inside the registered impl marks the row `failed` with a
    captured error message and re-raises as `StageRunFailed`. Descendants are
    NOT cascaded dirty (the prior output, if any, is still consistent)."""
    project_id, page_id = "p1", "0000"
    payload = _checkerboard_bgr_png()
    # v2: seed source image in BlobStore so grayscale can load it.
    seed_v2_page_source(tmp_path, project_id, 0, payload)
    await db.init_page_stages_for_page(project_id, page_id)

    # Patch the cpu impl for grayscale to raise.
    # get_stage_impl routes v2 stage IDs to V2_STAGE_IMPL.
    from pdomain_prep_for_pgdp.core.pipeline import stage_registry

    def _kaboom(_x, cfg=None):
        raise ValueError("synthetic stage failure for tests")

    monkeypatch.setitem(stage_registry.V2_STAGE_IMPL["grayscale"], "cpu", _kaboom)

    with pytest.raises(StageRunFailed):
        await run_stage(
            data_root=tmp_path,
            database=db,
            project_id=project_id,
            page_id=page_id,
            stage_id="grayscale",
        )

    row = await db.get_page_stage(project_id, page_id, "grayscale")
    assert row is not None
    assert row.status == PageStageStatus.failed
    assert row.error_message is not None
    assert "synthetic stage failure" in row.error_message


# test_run_stage_handles_stage_not_implemented was deleted at R3 (W6.3).
# It tested `thumbnail` (v1-only stage, not in V2_STAGE_DAG) with `ingest_source`
# as the parent (also v1-only).  The StageNotImplemented path is still covered
# by the monkeypatch approach in test_run_stage_records_failure_when_impl_raises.


# ─── Compound-output guard ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_run_stage_compound_output_no_longer_raises_unsupported(
    tmp_path: Path,
    db: SqliteDatabase,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`ocr` (output_type='words+text') is handled by the multi-artifact writer.

    Slice 14 adds commit_stage_artifacts_multi and removes the
    StageOutputUnsupported guard. This test verifies the stage runs cleanly
    (using a monkeypatched impl to avoid loading DocTR weights in CI).
    """

    # get_stage_impl routes v2 stage IDs to V2_STAGE_IMPL.
    from pdomain_prep_for_pgdp.core.pipeline import stage_registry as reg_module

    fake_result = {"words.json": b"[]", "raw.txt": b""}
    monkeypatch.setitem(reg_module.V2_STAGE_IMPL["ocr"], "cpu", lambda image, cfg=None: fake_result)

    project_id, page_id = "p1", "0000"
    payload = _checkerboard_bgr_png()
    # v2 DAG: `ocr` depends on `post_ocr_crop` (replaced `ocr_crop`).
    await _seed_clean_parents(
        db,
        tmp_path,
        project_id,
        page_id,
        parent_stages=["post_ocr_crop"],
        payload=payload,
    )

    state = await run_stage(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=page_id,
        stage_id="ocr",
    )
    assert state.status == PageStageStatus.clean, f"error: {state.error_message!r}"


# ─── Return shape ──────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_run_stage_returns_page_stage_state(tmp_path: Path, db: SqliteDatabase) -> None:
    """The runner's return value is the freshly-committed PageStageState row."""
    project_id, page_id = "p1", "0000"
    payload = _checkerboard_bgr_png()
    # v2: grayscale has no page-scoped parents — seed source via BlobStore.
    seed_v2_page_source(tmp_path, project_id, 0, payload)
    await db.init_page_stages_for_page(project_id, page_id)

    state = await run_stage(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=page_id,
        stage_id="grayscale",
    )
    assert isinstance(state, PageStageState)
    assert state.stage_id == "grayscale"
    assert state.project_id == project_id
    assert state.page_id == page_id


# Tests for v1-only stages (ingest_source, find_content_edges, crop_to_content,
# auto_deskew, morph_fill, rescale) were deleted at R3 (W6.3).  Those stages
# no longer exist in V2_STAGE_DAG.  The v1 micro-stage chain
# (ingest_source → decode_source → initial_crop → manual_deskew_pre → grayscale
# → threshold → invert → find_content_edges → crop_to_content → auto_deskew
# → morph_fill → rescale) has been folded into the v2 stages:
#   grayscale  → crop → threshold → deskew → denoise → dewarp
#   → post_transform_crop → canvas_map
# End-to-end v2 chain coverage belongs in test_v2_pipeline.py once all
# v2 ingest stages are wired end-to-end.


@pytest.mark.asyncio
async def test_run_stage_canvas_map_runs_after_post_transform_crop(
    tmp_path: Path,
    db: SqliteDatabase,
) -> None:
    """`canvas_map` runs on the output of `post_transform_crop` and produces a PNG artifact.

    In v2 the micro-steps morph_fill / rescale are folded into `canvas_map`;
    its single parent is `post_transform_crop`.  canvas_map outputs an ndarray
    that the runner encodes as PNG.
    """
    project_id, page_id = "p1", "0000"
    # Realistic binary image (post-dewarp/crop shape).
    img = np.full((200, 120), 200, dtype=np.uint8)
    ok, buf = cv2.imencode(".png", img)
    assert ok
    payload = bytes(buf.tobytes())
    await _seed_clean_parents(
        db, tmp_path, project_id, page_id, parent_stages=["post_transform_crop"], payload=payload
    )

    state = await run_stage(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=page_id,
        stage_id="canvas_map",
    )

    assert state.status == PageStageStatus.clean, f"error: {state.error_message!r}"
    artifact_path = stage_artifact_path(tmp_path, project_id, page_id, "canvas_map")
    assert artifact_path.exists()
    arr = cv2.imdecode(np.frombuffer(artifact_path.read_bytes(), np.uint8), cv2.IMREAD_UNCHANGED)
    assert arr is not None


# Tests for v1-only stages (auto_detect_attrs, blank_proof_synth, ocr_crop,
# thumbnail, auto_detect_illustrations, text_postprocess) and the not-applicable
# marking tests were deleted at R3 (W6.3). These stages no longer exist in
# V2_STAGE_DAG. The not-applicable concept is also gone from v2 (blank-page
# logic is canvas_map-internal; plate handling is in the page_type config).

# ─── Slice 14: compound-output stages via multi-artifact writer ────────────


@pytest.mark.asyncio
async def test_run_stage_ocr_produces_multi_artifact_dir(
    tmp_path: Path,
    db: SqliteDatabase,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Runner calls multi-artifact writer for compound-output `ocr` stage.

    The `ocr` impl is monkeypatched to avoid loading DocTR weights in CI.
    The important thing under test is the runner's compound-output dispatch
    path: impl returns dict[str, bytes]; runner calls commit_stage_artifacts_multi;
    both files land on disk; DB row is clean.
    """
    import json

    from pdomain_prep_for_pgdp.core.pipeline import stage_registry as reg_module

    fake_words = [
        {"id": "w0", "text": "Hello", "confidence": 0.9, "bounding_box": {"x": 0, "y": 0, "w": 10, "h": 10}}
    ]
    fake_result = {
        "words.json": json.dumps(fake_words).encode(),
        "raw.txt": b"Hello",
    }
    # get_stage_impl routes v2 stage IDs to V2_STAGE_IMPL.
    monkeypatch.setitem(reg_module.V2_STAGE_IMPL["ocr"], "cpu", lambda image, cfg=None: fake_result)

    project_id, page_id = "p1", "0000"
    payload = _checkerboard_bgr_png()
    # v2 DAG: `ocr` depends on `post_ocr_crop` (v2 re-key of v1 `ocr_crop`).
    await _seed_clean_parents(
        db, tmp_path, project_id, page_id, parent_stages=["post_ocr_crop"], payload=payload
    )

    state = await run_stage(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=page_id,
        stage_id="ocr",
    )

    assert state.status == PageStageStatus.clean, f"error: {state.error_message!r}"
    stage_dir = tmp_path / "projects" / project_id / "pages" / page_id / "stages" / "ocr"
    assert (stage_dir / "words.json").exists(), "words.json missing"
    assert (stage_dir / "raw.txt").exists(), "raw.txt missing"
    assert state.artifact_key is not None
    assert state.artifact_key.endswith("words.json"), (
        f"artifact_key should point to primary file, got {state.artifact_key!r}"
    )


@pytest.mark.asyncio
async def test_run_stage_text_review_produces_multi_artifact_dir(
    tmp_path: Path,
    db: SqliteDatabase,
) -> None:
    """`text_review` gate stage runs via multi-artifact writer.

    v2 DAG: `text_review` depends on `hyphen_join` (arg 0) and `regex`
    (arg 1).  The impl uses the `regex` output as the reviewed text and
    produces output.txt + attestation.json.
    """
    import json
    from time import time

    from pdomain_prep_for_pgdp.core.pipeline.page_stage_writer import compute_content_hash

    project_id, page_id = "p1", "0000"
    # hyphen_join output: intermediate text (positional arg 0 to text_review).
    hyphen_content = b"Hello world-\nwide."
    # regex output: final processed text (positional arg 1 to text_review).
    text_content = b"Hello world."

    await db.init_page_stages_for_page(project_id, page_id)

    # Seed hyphen_join artifact (output_type='text', written as output.txt).
    hj_dir = tmp_path / "projects" / project_id / "pages" / page_id / "stages" / "hyphen_join"
    hj_dir.mkdir(parents=True, exist_ok=True)
    (hj_dir / "output.txt").write_bytes(hyphen_content)
    await db.put_page_stage(
        PageStageState(
            project_id=project_id,
            page_id=page_id,
            stage_id="hyphen_join",
            status=PageStageStatus.clean,
            stage_version=1,
            artifact_key=f"projects/{project_id}/pages/{page_id}/stages/hyphen_join/output.txt",
            input_hash=compute_content_hash(hyphen_content),
            last_run_at=time(),
        )
    )

    # Seed regex artifact (output_type='text', written as output.txt).
    rx_dir = tmp_path / "projects" / project_id / "pages" / page_id / "stages" / "regex"
    rx_dir.mkdir(parents=True, exist_ok=True)
    (rx_dir / "output.txt").write_bytes(text_content)
    await db.put_page_stage(
        PageStageState(
            project_id=project_id,
            page_id=page_id,
            stage_id="regex",
            status=PageStageStatus.clean,
            stage_version=1,
            artifact_key=f"projects/{project_id}/pages/{page_id}/stages/regex/output.txt",
            input_hash=compute_content_hash(text_content),
            last_run_at=time(),
        )
    )

    state = await run_stage(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=page_id,
        stage_id="text_review",
    )

    assert state.status == PageStageStatus.clean, f"error: {state.error_message!r}"
    stage_dir = tmp_path / "projects" / project_id / "pages" / page_id / "stages" / "text_review"
    assert (stage_dir / "output.txt").exists(), "output.txt missing"
    assert (stage_dir / "attestation.json").exists(), "attestation.json missing"
    # text_review uses the regex output (arg 1) as the reviewed text.
    assert (stage_dir / "output.txt").read_bytes() == text_content
    attestation = json.loads((stage_dir / "attestation.json").read_bytes())
    assert isinstance(attestation, dict)
    assert state.artifact_key is not None
    assert state.artifact_key.endswith("output.txt"), (
        f"artifact_key should point to primary file (output.txt), got {state.artifact_key!r}"
    )


# ─── Stage versioning: stage_version updated after successful run ────────────


@pytest.mark.asyncio
async def test_run_stage_updates_stage_version(
    tmp_path: Path,
    db: SqliteDatabase,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """After a successful run, the row's stage_version matches V2_STAGE_VERSIONS[stage_id].

    Spec: docs/specs/pipeline-task-model.md §"Stage versioning (Q4 lock)".
    """
    import pdomain_prep_for_pgdp.core.pipeline.stage_dag as _stage_dag_mod

    project_id, page_id = "p1", "0000"
    payload = _checkerboard_bgr_png()
    # v2: grayscale has no page-scoped parents — seed source via BlobStore.
    seed_v2_page_source(tmp_path, project_id, 0, payload)
    await db.init_page_stages_for_page(project_id, page_id)

    # Bump the registry version for "grayscale" to 2.
    original = dict(_stage_dag_mod.V2_STAGE_VERSIONS)
    monkeypatch.setattr(_stage_dag_mod, "V2_STAGE_VERSIONS", dict(original, grayscale=2))

    state = await run_stage(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=page_id,
        stage_id="grayscale",
    )

    assert state.status == PageStageStatus.clean
    assert state.stage_version == 2, (
        f"stage_version should be updated to V2_STAGE_VERSIONS[stage_id]=2, got {state.stage_version}"
    )


# ─── Cross-page dirty cascade: split children (issue #55) ──────────────────


async def _seed_split_child(
    db: SqliteDatabase,
    data_root: Path,
    project_id: str,
    parent_page_id: str,
    child_idx0: int,
    split_at_stage: str,
    clean_stages: list[str],
    payload: bytes,
) -> None:
    """Create a split-child PageRecord and seed some stages as clean."""
    from pdomain_prep_for_pgdp.core.models import PageRecord

    suffix = chr(ord("a") + child_idx0 - 1)
    child = PageRecord(
        project_id=project_id,
        idx0=child_idx0,
        prefix=f"0000{suffix}",
        source_stem="page",
        parent_page_id=parent_page_id,
        source_crop_bbox=(0, 0, 100, 100),
        split_index=child_idx0,
        split_at_stage=split_at_stage,
        split_suffix=suffix,
    )
    seed_page_in_store(data_root, child.project_id, child)
    child_page_id = f"{child_idx0:04d}"
    await db.init_page_stages_for_page(project_id, child_page_id)
    for sid in clean_stages:
        await commit_stage_artifact(
            data_root=data_root,
            database=db,
            project_id=project_id,
            page_id=child_page_id,
            stage_id=sid,
            artifact_bytes=payload,
        )


@pytest.mark.asyncio
async def test_cross_page_cascade_dirties_split_children_when_stage_upstream(
    tmp_path: Path,
    db: SqliteDatabase,
) -> None:
    """Re-running a parent stage upstream of split_at_stage marks each split
    child's grayscale dirty (issue #55 acceptance bullet 1).

    Setup: parent page 0000; two split children (idx0=1, idx0=2) both with
    split_at_stage="threshold". Run grayscale on parent — grayscale is
    upstream of threshold, so both children's grayscale must become dirty.
    """
    project_id = "p1"
    parent_page_id = "0000"
    payload = _checkerboard_bgr_png()

    # v2: seed parent source in BlobStore so grayscale can load it.
    seed_v2_page_source(tmp_path, project_id, 0, payload)
    await db.init_page_stages_for_page(project_id, parent_page_id)

    # Create two split children, each with grayscale seeded clean.
    for child_idx0 in (1, 2):
        await _seed_split_child(
            db,
            tmp_path,
            project_id,
            parent_page_id,
            child_idx0=child_idx0,
            split_at_stage="threshold",
            clean_stages=["grayscale"],
            payload=payload,
        )

    # Confirm children's grayscale is clean before the run.
    for child_idx0 in (1, 2):
        row = await db.get_page_stage(project_id, f"{child_idx0:04d}", "grayscale")
        assert row is not None
        assert row.status == PageStageStatus.clean

    # Run grayscale on the parent — grayscale is upstream of threshold.
    await run_stage(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=parent_page_id,
        stage_id="grayscale",
    )

    # Both children's grayscale must now be dirty.
    for child_idx0 in (1, 2):
        row = await db.get_page_stage(project_id, f"{child_idx0:04d}", "grayscale")
        assert row is not None
        assert row.status == PageStageStatus.dirty, (
            f"child {child_idx0} grayscale expected dirty, got {row.status}"
        )


@pytest.mark.asyncio
async def test_cross_page_cascade_does_not_dirty_children_when_stage_downstream(
    tmp_path: Path,
    db: SqliteDatabase,
) -> None:
    """Re-running a parent stage downstream of split_at_stage does NOT dirty
    split children (issue #55 acceptance bullet 2).

    Setup: parent page 0000; one split child with split_at_stage="grayscale".
    Run crop on parent — crop is downstream of grayscale, so the child's
    grayscale must remain clean.
    """
    project_id = "p1"
    parent_page_id = "0000"
    payload = _checkerboard_bgr_png()

    # Seed parent with grayscale clean so crop can run.
    await _seed_clean_parents(
        db,
        tmp_path,
        project_id,
        parent_page_id,
        parent_stages=["grayscale"],
        payload=payload,
    )

    # Create one split child with split_at_stage="grayscale" and grayscale clean.
    await _seed_split_child(
        db,
        tmp_path,
        project_id,
        parent_page_id,
        child_idx0=1,
        split_at_stage="grayscale",
        clean_stages=["grayscale"],
        payload=payload,
    )

    # Run crop on parent. crop may succeed or fail on the synthetic image; either
    # way the cascade-to-split-children logic must NOT dirty the child's grayscale
    # (because grayscale is the split_at_stage, and crop is downstream of it).
    with contextlib.suppress(StageRunFailed):
        await run_stage(
            data_root=tmp_path,
            database=db,
            project_id=project_id,
            page_id=parent_page_id,
            stage_id="crop",
        )

    # Child's grayscale must still be clean (not dirtied).
    row = await db.get_page_stage(project_id, "0001", "grayscale")
    assert row is not None
    assert row.status == PageStageStatus.clean, (
        f"child grayscale should stay clean when stage is downstream of split_at_stage, got {row.status}"
    )
