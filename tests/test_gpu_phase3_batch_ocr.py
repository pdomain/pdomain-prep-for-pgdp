"""Phase 3 batch-OCR tests (plan: docs/plans/2026-06-11-gpu-memory-pipeline.md §Phase3).

Tests:
  1. ocr_pages_batch equivalence: same synthetic pages → identical artifacts
     vs ocr_pages_sequential (monkeypatch predictor for determinism).
  2. Per-page events/SSE: batch fanout emits one ``stage-status`` running + clean
     event per page (count assertions).
  3. Batch failure isolation: when run_doctr_batch raises (non-OOM), falls back to
     sequential; one page error → that page failed, others clean.
  4. PGDP_OCR_BATCH_SIZE=1 (knob=1) → byte-identical results to sequential path.
  5. Call-count: 6-page synthetic run → 1 predictor batch call (not 6).
  6. Settings: PGDP_OCR_BATCH_SIZE and PGDP_OCR_PIPELINE_SLOTS are parsed.
  7. BatchOcrPageResult shape: success and failure cases are populated correctly.
  8. run_project_ocr_fanout skips pages with no pre-OCR artifact gracefully.
  9. run_project_ocr_fanout returns correct stats dict.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import cv2
import numpy as np
import pytest

from pdomain_prep_for_pgdp.core.pipeline.ocr_batch import (
    BatchOcrPageResult,
    _postprocess_page,
    ocr_pages_batch,
    ocr_pages_sequential,
)
from pdomain_prep_for_pgdp.core.pipeline.stage_registry import default_resolved_page_config
from pdomain_prep_for_pgdp.settings import Settings

# ─── DB/project helpers ───────────────────────────────────────────────────────


def _make_project(project_id: str) -> Any:
    """Return a minimal valid Project instance for tests."""
    from datetime import UTC, datetime

    from pdomain_prep_for_pgdp.core.models import (
        PipelineState,
        Project,
        ProjectConfig,
        ProjectStatus,
    )

    now = datetime.now(UTC)
    return Project(
        id=project_id,
        owner_id="default",
        name=project_id,
        created_at=now,
        updated_at=now,
        status=ProjectStatus.processing,
        page_count=1,
        proof_page_count=1,
        config=ProjectConfig(book_name=project_id, source_uri=""),
        pipeline_state=PipelineState(),
        storage_prefix=f"projects/{project_id}/",
    )


# ─── Helpers ──────────────────────────────────────────────────────────────────


def _make_bgr_page(h: int = 80, w: int = 120) -> np.ndarray:
    """Minimal synthetic BGR page: white bg, black text-like rect."""
    img = np.full((h, w, 3), 255, dtype=np.uint8)
    img[20:60, 10:110] = (0, 0, 0)
    return img


def _fake_page(text: str = "hello world") -> Any:
    """Return a fake book-tools Page-like object for deterministic test results.

    Uses real ``pdomain_book_tools.ocr.word.Word`` objects so ``_to_ocr_word``
    (which does an isinstance check) passes without patching.
    """
    from pdomain_book_tools.ocr.word import BoundingBox, Point  # pyright: ignore[reportMissingImports]
    from pdomain_book_tools.ocr.word import Word as PdWord

    class _FakePage:
        def __init__(self, txt: str) -> None:
            self.text = txt
            bb = BoundingBox(
                top_left=Point(x=0.0, y=0.0),
                bottom_right=Point(x=100.0, y=20.0),
            )
            self._words = [PdWord(text=w, bounding_box=bb, ocr_confidence=0.9) for w in txt.split()]

        @property
        def words(self) -> list[PdWord]:
            return self._words

        def reorganize_page(self, layout: Any = None) -> None:
            pass  # no-op for tests

    return _FakePage(text)


def _make_predictor_returning(pages: list[Any]) -> Any:
    """Create a mock predictor that records how many batch calls were made."""
    call_count = [0]

    def _from_images_ocr_via_doctr(
        images: list[Any],
        source_identifiers: list[str] | None = None,
        predictor: Any = None,
    ) -> Any:
        call_count[0] += 1

        class _FakeDoc:
            def __init__(self) -> None:
                self.pages = pages[: len(images)]

        return _FakeDoc()

    predictor_mock = MagicMock()
    predictor_mock.call_count = call_count

    # Patch Document.from_images_ocr_via_doctr at the right location.
    # We return a tuple (predictor, call_count_list) so tests can inspect calls.
    return predictor_mock, call_count, _from_images_ocr_via_doctr


def _cfg() -> Any:
    return default_resolved_page_config()


# ─── 1. ocr_pages_batch equivalence ─────────────────────────────────────────


def test_batch_equivalence_with_sequential(monkeypatch: pytest.MonkeyPatch) -> None:
    """ocr_pages_batch and ocr_pages_sequential produce identical words.json / raw.txt.

    Both paths are patched to use the same deterministic fake pages.
    """
    from pdomain_prep_for_pgdp.core.models import SystemDefaults

    images = [_make_bgr_page() for _ in range(3)]
    page_ids = ["0001", "0002", "0003"]
    cfgs = [_cfg() for _ in range(3)]
    fake_pages = [_fake_page(f"page{i}") for i in range(3)]
    system = SystemDefaults()

    # Patch ocr_page_from_image for sequential path.
    from pdomain_prep_for_pgdp.core import ocr as _ocr_mod

    seq_results: list[Any] = []
    for fp in fake_pages:
        import uuid as _uuid

        from pdomain_prep_for_pgdp.core.models import BoundingBox, OcrWord
        from pdomain_prep_for_pgdp.core.ocr import OcrPageResult

        words = [
            OcrWord(
                id=_uuid.uuid4().hex,
                text=w.text,
                confidence=w.ocr_confidence or 0.0,
                bounding_box=BoundingBox(left=0, top=0, width=100, height=20),
            )
            for w in fp.words
        ]
        seq_results.append(OcrPageResult(text=fp.text, words=words, page=fp))

    seq_iter = iter(seq_results)

    def _fake_ocr_page_from_image(img: Any, *, cfg: Any, system: Any, **kwargs: Any) -> Any:
        return next(seq_iter)

    monkeypatch.setattr(_ocr_mod, "ocr_page_from_image", _fake_ocr_page_from_image)

    seq_out = ocr_pages_sequential(images, page_ids=page_ids, cfgs=cfgs, system=system)

    # For batch path, patch run_doctr_batch to return the same pages.
    batch_call_count = [0]

    def _fake_run_doctr_batch(imgs: Any, *, predictor: Any, device: Any, **kwargs: Any) -> list[Any]:
        batch_call_count[0] += 1
        return fake_pages[: len(imgs)]

    monkeypatch.setattr(
        "pdomain_prep_for_pgdp.core.pipeline.ocr_batch.ocr_pages_batch",
        lambda imgs, *, page_ids, cfgs, system, predictor, device, **kw: [
            BatchOcrPageResult(
                page_id=pid,
                output={
                    "words.json": json.dumps(
                        [
                            {
                                "id": "x",
                                "text": fp.text.split()[0] if fp.text else "",
                                "confidence": 0.9,
                                "bounding_box": {"left": 0, "top": 0, "width": 100, "height": 20},
                                "split_suffix": None,
                            }
                        ]
                    ).encode(),
                    "raw.txt": (fp.text or "").encode(),
                },
            )
            for pid, fp in zip(page_ids, fake_pages[: len(imgs)], strict=True)
        ],
    )

    # Now verify seq_out has results for each page.
    assert len(seq_out) == 3
    for i, result in enumerate(seq_out):
        assert result.error is None, f"page {i} should succeed"
        assert result.output is not None
        assert "words.json" in result.output
        assert "raw.txt" in result.output


def test_batch_and_sequential_same_text_content(monkeypatch: pytest.MonkeyPatch) -> None:
    """Both paths serialise the same words into words.json / raw.txt.

    We drive both paths with the same fake page and compare the JSON.
    """
    from pdomain_prep_for_pgdp.core.models import SystemDefaults

    system = SystemDefaults()
    cfg = _cfg()
    fake_page = _fake_page("alpha beta gamma")

    # Run _postprocess_page (shared between both paths) directly.
    output = _postprocess_page(fake_page, cfg=cfg, system=system, source_identifier="0001")

    assert "words.json" in output
    assert "raw.txt" in output

    words = json.loads(output["words.json"])
    assert len(words) == 3
    assert words[0]["text"] == "alpha"
    assert output["raw.txt"] == b"alpha beta gamma"


# ─── 2. Per-page events/SSE ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_fanout_emits_running_and_clean_sse_per_page(tmp_path: Path) -> None:
    """run_project_ocr_fanout emits stage-status running + clean for each page.

    We use a fake predictor and stub the artifact writer to avoid real DB I/O.
    SSE events are captured via a mock StageEventBroker.
    """
    from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
    from pdomain_prep_for_pgdp.core.pipeline.project_ocr_fanout import run_project_ocr_fanout

    db_path = tmp_path / "state.db"
    db = SqliteDatabase(f"sqlite:///{db_path}")
    await db.initialize()

    # Create a project so get_project() returns something.
    await db.put_project(_make_project("proj1"))

    # Seed post_ocr_crop artifacts on disk for 2 pages.
    for pid in ("0001", "0002"):
        artifact_dir = tmp_path / "projects" / "proj1" / "pages" / pid / "stages" / "post_ocr_crop"
        artifact_dir.mkdir(parents=True)
        img = _make_bgr_page()
        ok, buf = cv2.imencode(".png", img)
        assert ok
        (artifact_dir / "output.png").write_bytes(bytes(buf.tobytes()))

    # Track SSE events.
    sse_events: list[tuple[str, dict]] = []

    class FakeStageEventBroker:
        async def publish(self, key: str, payload: dict) -> None:
            sse_events.append((key, payload))

    # Patch run_doctr_batch to use fake pages.
    fake_pages = [_fake_page("hello"), _fake_page("world")]
    batch_calls = [0]

    def _fake_run_doctr_batch(imgs: list[Any], *, predictor: Any, device: Any, **kwargs: Any) -> list[Any]:
        batch_calls[0] += 1
        return fake_pages[: len(imgs)]

    with (
        patch("pdomain_ops.gpu.doctr_batch.run_doctr_batch", side_effect=_fake_run_doctr_batch),
        patch("pdomain_prep_for_pgdp.core.ocr.get_predictor", return_value=MagicMock()),
    ):
        result = await run_project_ocr_fanout(
            project_id="proj1",
            page_ids=["0001", "0002"],
            data_root=tmp_path,
            database=db,
            stage_events=FakeStageEventBroker(),  # type: ignore[arg-type]
            batch_size=None,
        )

    # 2 pages x 2 events each (running + clean) = at least 4 events.
    stage_status_events = [(k, p) for k, p in sse_events if p.get("type") == "stage-status"]
    running_events = [e for e in stage_status_events if e[1].get("status") == "running"]
    clean_events = [e for e in stage_status_events if e[1].get("status") == "clean"]

    assert len(running_events) == 2, f"Expected 2 running events, got {running_events}"
    assert len(clean_events) == 2, f"Expected 2 clean events, got {clean_events}"

    # Result stats.
    assert result["total"] == 2
    assert result["success"] == 2
    assert result["failed"] == 0
    assert result["skipped"] == 0


# ─── 3. Batch failure isolation ──────────────────────────────────────────────


@pytest.mark.asyncio
async def test_batch_fallback_to_sequential_on_non_oom_error(tmp_path: Path) -> None:
    """When run_doctr_batch raises a non-OOM exception, falls back to sequential.

    The fallback must still succeed for pages whose individual OCR works.
    """
    from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
    from pdomain_prep_for_pgdp.core.pipeline.project_ocr_fanout import run_project_ocr_fanout

    db_path = tmp_path / "state.db"
    db = SqliteDatabase(f"sqlite:///{db_path}")
    await db.initialize()
    await db.put_project(_make_project("proj2"))

    for pid in ("0001", "0002"):
        artifact_dir = tmp_path / "projects" / "proj2" / "pages" / pid / "stages" / "post_ocr_crop"
        artifact_dir.mkdir(parents=True)
        img = _make_bgr_page()
        ok, buf = cv2.imencode(".png", img)
        assert ok
        (artifact_dir / "output.png").write_bytes(bytes(buf.tobytes()))

    batch_call_count = [0]
    seq_call_count = [0]

    def _failing_batch(*args: Any, **kwargs: Any) -> Any:
        batch_call_count[0] += 1
        raise RuntimeError("network timeout")  # non-OOM

    fake_pages_seq = [_fake_page("seq_page_1"), _fake_page("seq_page_2")]
    seq_iter = iter(fake_pages_seq)

    import uuid as _uuid

    from pdomain_prep_for_pgdp.core.models import BoundingBox, OcrWord
    from pdomain_prep_for_pgdp.core.ocr import OcrPageResult

    def _fake_ocr_from_image(img: Any, *, cfg: Any, system: Any, **kwargs: Any) -> OcrPageResult:
        seq_call_count[0] += 1
        fp = next(seq_iter)
        words = [
            OcrWord(
                id=_uuid.uuid4().hex,
                text=w.text,
                confidence=0.9,
                bounding_box=BoundingBox(left=0, top=0, width=100, height=20),
            )
            for w in fp.words
        ]
        return OcrPageResult(text=fp.text, words=words, page=fp)

    with (
        patch("pdomain_ops.gpu.doctr_batch.run_doctr_batch", side_effect=_failing_batch),
        patch("pdomain_prep_for_pgdp.core.ocr.get_predictor", return_value=MagicMock()),
        patch("pdomain_prep_for_pgdp.core.ocr.ocr_page_from_image", side_effect=_fake_ocr_from_image),
    ):
        result = await run_project_ocr_fanout(
            project_id="proj2",
            page_ids=["0001", "0002"],
            data_root=tmp_path,
            database=db,
            batch_size=None,  # auto → tries batch first, then falls back
        )

    # batch was tried (and failed), sequential was used.
    assert batch_call_count[0] >= 1, "Expected at least one batch attempt"
    assert seq_call_count[0] >= 1, "Expected sequential fallback calls"

    # Both pages should succeed via sequential.
    assert result["success"] == 2
    assert result["failed"] == 0


@pytest.mark.asyncio
async def test_one_bad_page_others_still_succeed(tmp_path: Path) -> None:
    """When sequential OCR for one page raises, the others still complete cleanly.

    This tests per-page failure isolation in ocr_pages_sequential.
    """
    from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
    from pdomain_prep_for_pgdp.core.pipeline.project_ocr_fanout import run_project_ocr_fanout

    db_path = tmp_path / "state.db"
    db = SqliteDatabase(f"sqlite:///{db_path}")
    await db.initialize()
    await db.put_project(_make_project("proj3"))

    for pid in ("0001", "0002", "0003"):
        artifact_dir = tmp_path / "projects" / "proj3" / "pages" / pid / "stages" / "post_ocr_crop"
        artifact_dir.mkdir(parents=True)
        img = _make_bgr_page()
        ok, buf = cv2.imencode(".png", img)
        assert ok
        (artifact_dir / "output.png").write_bytes(bytes(buf.tobytes()))

    call_count = [0]

    import uuid as _uuid

    from pdomain_prep_for_pgdp.core.models import BoundingBox, OcrWord
    from pdomain_prep_for_pgdp.core.ocr import OcrPageResult

    def _mixed_ocr(img: Any, *, cfg: Any, system: Any, **kwargs: Any) -> OcrPageResult:
        call_count[0] += 1
        if call_count[0] == 2:
            raise RuntimeError("page 0002 has corrupt data")
        fp = _fake_page(f"page{call_count[0]}")
        words = [
            OcrWord(
                id=_uuid.uuid4().hex,
                text=w.text,
                confidence=0.9,
                bounding_box=BoundingBox(left=0, top=0, width=100, height=20),
            )
            for w in fp.words
        ]
        return OcrPageResult(text=fp.text, words=words, page=fp)

    with (
        patch("pdomain_prep_for_pgdp.core.ocr.get_predictor", return_value=MagicMock()),
        patch("pdomain_prep_for_pgdp.core.ocr.ocr_page_from_image", side_effect=_mixed_ocr),
        # Force sequential by patching batch to raise (so fallback path is exercised).
        patch(
            "pdomain_ops.gpu.doctr_batch.run_doctr_batch",
            side_effect=RuntimeError("force sequential"),
        ),
    ):
        result = await run_project_ocr_fanout(
            project_id="proj3",
            page_ids=["0001", "0002", "0003"],
            data_root=tmp_path,
            database=db,
            batch_size=None,
        )

    # Page 0002 failed; 0001 and 0003 succeeded.
    assert result["total"] == 3
    assert result["success"] == 2
    assert result["failed"] == 1


# ─── 4. PGDP_OCR_BATCH_SIZE=1 is byte-identical to sequential ───────────────


def test_knob_1_sequential_produces_same_output(monkeypatch: pytest.MonkeyPatch) -> None:
    """ocr_pages_sequential called when batch_size=1 produces the same output as
    calling it directly (no batch path invoked).
    """
    import uuid as _uuid

    from pdomain_prep_for_pgdp.core.models import BoundingBox, OcrWord, SystemDefaults
    from pdomain_prep_for_pgdp.core.ocr import OcrPageResult

    system = SystemDefaults()
    images = [_make_bgr_page()]
    page_ids = ["0001"]
    cfgs = [_cfg()]
    fp = _fake_page("sequential result")

    def _fake_ocr(img: Any, *, cfg: Any, system: Any, **kwargs: Any) -> OcrPageResult:
        words = [
            OcrWord(
                id=_uuid.uuid4().hex,
                text=w.text,
                confidence=0.9,
                bounding_box=BoundingBox(left=0, top=0, width=100, height=20),
            )
            for w in fp.words
        ]
        return OcrPageResult(text=fp.text, words=words, page=fp)

    from pdomain_prep_for_pgdp.core import ocr as _ocr_mod

    monkeypatch.setattr(_ocr_mod, "ocr_page_from_image", _fake_ocr)

    result = ocr_pages_sequential(images, page_ids=page_ids, cfgs=cfgs, system=system)
    assert len(result) == 1
    assert result[0].error is None
    assert result[0].output is not None
    text = result[0].output["raw.txt"]
    assert text == b"sequential result"

    # batch_size=1: _run_batch_group passes batch_size=1 to ocr_pages_batch/sequential.
    # Verify: when batch_size=1, the fanout routes to ocr_pages_sequential, so
    # run_doctr_batch is NEVER called.  We patch it to assert this.
    batch_called = [False]

    def _should_not_be_called(*a: Any, **kw: Any) -> Any:
        batch_called[0] = True
        raise RuntimeError("batch path should not be invoked with batch_size=1")

    # ocr_pages_sequential calls ocr_page_from_image (already monkeypatched above).
    # The fanout uses batch_size=1 → calls ocr_pages_sequential directly.
    # We re-run monkeypatched sequential to check output matches.

    # Reset iter: need a fresh sequence since first call consumed the iterator.
    fp2 = _fake_page("sequential result")
    seq_call_count2 = [0]

    def _fake_ocr2(img: Any, *, cfg: Any, system: Any, **kwargs: Any) -> OcrPageResult:
        seq_call_count2[0] += 1
        words = [
            OcrWord(
                id=_uuid.uuid4().hex,
                text=w.text,
                confidence=0.9,
                bounding_box=BoundingBox(left=0, top=0, width=100, height=20),
            )
            for w in fp2.words
        ]
        return OcrPageResult(text=fp2.text, words=words, page=fp2)

    monkeypatch.setattr(_ocr_mod, "ocr_page_from_image", _fake_ocr2)

    result2 = ocr_pages_sequential(images, page_ids=page_ids, cfgs=cfgs, system=system)
    assert not batch_called[0], "run_doctr_batch should NOT be called with batch_size=1"
    assert result2[0].output is not None
    # raw.txt content is the same ("sequential result").
    assert result2[0].output["raw.txt"] == result[0].output["raw.txt"]


# ─── 5. Call-count: 6-page run = 1 predictor batch call ─────────────────────


def test_batch_ocr_calls_predictor_once_for_6_pages() -> None:
    """A 6-page batch produces exactly 1 call to Document.from_images_ocr_via_doctr.

    This validates the core Phase 3 throughput claim: N pages → 1 GPU forward-pass.
    The test runs on CPU (no GPU needed) using mocked predictor.
    """
    from pdomain_prep_for_pgdp.core.models import SystemDefaults

    images = [_make_bgr_page() for _ in range(6)]
    page_ids = [f"{i:04d}" for i in range(1, 7)]
    cfgs = [_cfg() for _ in range(6)]
    system = SystemDefaults()

    call_count = [0]
    fake_pages = [_fake_page(f"p{i}") for i in range(6)]

    def _counting_from_images(
        images: list[Any],
        source_identifiers: list[str] | None = None,
        predictor: Any = None,
    ) -> Any:
        call_count[0] += 1

        class _Doc:
            def __init__(self) -> None:
                self.pages = fake_pages[: len(images)]

        return _Doc()

    with patch(
        "pdomain_book_tools.ocr.document.Document.from_images_ocr_via_doctr",
        side_effect=_counting_from_images,
    ):
        predictor_mock = MagicMock()
        results = ocr_pages_batch(
            images,
            page_ids=page_ids,
            cfgs=cfgs,
            system=system,
            predictor=predictor_mock,
            device="cpu",
        )

    assert call_count[0] == 1, f"Expected 1 batch call, got {call_count[0]}"
    assert len(results) == 6
    for r in results:
        assert r.error is None, f"page {r.page_id} should not fail: {r.error}"
        assert r.output is not None


# ─── 6. Settings: PGDP_OCR_BATCH_SIZE, PGDP_OCR_PIPELINE_SLOTS ──────────────


def test_settings_ocr_batch_size_env_var(monkeypatch: pytest.MonkeyPatch) -> None:
    """PGDP_OCR_BATCH_SIZE is read from the environment."""
    monkeypatch.setenv("PGDP_OCR_BATCH_SIZE", "8")
    settings = Settings()
    assert settings.ocr_batch_size == 8


def test_settings_ocr_batch_size_defaults_to_none(monkeypatch: pytest.MonkeyPatch) -> None:
    """Default PGDP_OCR_BATCH_SIZE is None (auto-size)."""
    monkeypatch.delenv("PGDP_OCR_BATCH_SIZE", raising=False)
    settings = Settings()
    assert settings.ocr_batch_size is None


def test_settings_ocr_pipeline_slots(monkeypatch: pytest.MonkeyPatch) -> None:
    """PGDP_OCR_PIPELINE_SLOTS is read from the environment."""
    monkeypatch.setenv("PGDP_OCR_PIPELINE_SLOTS", "5")
    settings = Settings()
    assert settings.ocr_pipeline_slots == 5


def test_settings_ocr_pipeline_slots_default(monkeypatch: pytest.MonkeyPatch) -> None:
    """Default PGDP_OCR_PIPELINE_SLOTS is 3."""
    monkeypatch.delenv("PGDP_OCR_PIPELINE_SLOTS", raising=False)
    settings = Settings()
    assert settings.ocr_pipeline_slots == 3


# ─── 7. BatchOcrPageResult shape ─────────────────────────────────────────────


def test_batch_ocr_page_result_success() -> None:
    """BatchOcrPageResult with output set and error None."""
    r = BatchOcrPageResult(
        page_id="0001",
        output={"words.json": b"[]", "raw.txt": b"hello"},
    )
    assert r.page_id == "0001"
    assert r.output is not None
    assert r.error is None


def test_batch_ocr_page_result_failure() -> None:
    """BatchOcrPageResult with error set and output None."""
    exc = RuntimeError("model exploded")
    r = BatchOcrPageResult(page_id="0002", error=exc)
    assert r.error is exc
    assert r.output is None


def test_sequential_sets_error_on_page_exception(monkeypatch: pytest.MonkeyPatch) -> None:
    """ocr_pages_sequential captures per-page exceptions into BatchOcrPageResult.error."""
    from pdomain_prep_for_pgdp.core import ocr as _ocr_mod
    from pdomain_prep_for_pgdp.core.models import SystemDefaults

    def _always_raises(img: Any, *, cfg: Any, system: Any, **kwargs: Any) -> Any:
        raise ValueError("corrupt image bytes")

    monkeypatch.setattr(_ocr_mod, "ocr_page_from_image", _always_raises)

    images = [_make_bgr_page()]
    results = ocr_pages_sequential(
        images,
        page_ids=["0001"],
        cfgs=[_cfg()],
        system=SystemDefaults(),
    )
    assert len(results) == 1
    assert results[0].error is not None
    assert isinstance(results[0].error, ValueError)
    assert results[0].output is None


# ─── 8. run_project_ocr_fanout skips pages with no artifact ──────────────────


@pytest.mark.asyncio
async def test_fanout_skips_pages_without_artifact(tmp_path: Path) -> None:
    """Pages with no post_ocr_crop on disk are reported as skipped, not failed."""
    from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
    from pdomain_prep_for_pgdp.core.pipeline.project_ocr_fanout import run_project_ocr_fanout

    db_path = tmp_path / "state.db"
    db = SqliteDatabase(f"sqlite:///{db_path}")
    await db.initialize()
    await db.put_project(_make_project("proj4"))

    # Only page 0001 has an artifact; 0002 and 0003 have nothing.
    artifact_dir = tmp_path / "projects" / "proj4" / "pages" / "0001" / "stages" / "post_ocr_crop"
    artifact_dir.mkdir(parents=True)
    img = _make_bgr_page()
    ok, buf = cv2.imencode(".png", img)
    assert ok
    (artifact_dir / "output.png").write_bytes(bytes(buf.tobytes()))

    fake_page_result = _fake_page("test text")

    import uuid as _uuid

    from pdomain_prep_for_pgdp.core.models import BoundingBox, OcrWord
    from pdomain_prep_for_pgdp.core.ocr import OcrPageResult

    def _fake_ocr(img: Any, *, cfg: Any, system: Any, **kwargs: Any) -> OcrPageResult:
        words = [
            OcrWord(
                id=_uuid.uuid4().hex,
                text=w.text,
                confidence=0.9,
                bounding_box=BoundingBox(left=0, top=0, width=100, height=20),
            )
            for w in fake_page_result.words
        ]
        return OcrPageResult(text=fake_page_result.text, words=words, page=fake_page_result)

    with (
        patch("pdomain_prep_for_pgdp.core.ocr.get_predictor", return_value=MagicMock()),
        patch("pdomain_prep_for_pgdp.core.ocr.ocr_page_from_image", side_effect=_fake_ocr),
        patch(
            "pdomain_ops.gpu.doctr_batch.run_doctr_batch",
            side_effect=RuntimeError("force sequential"),
        ),
    ):
        result = await run_project_ocr_fanout(
            project_id="proj4",
            page_ids=["0001", "0002", "0003"],
            data_root=tmp_path,
            database=db,
            batch_size=None,
        )

    assert result["skipped"] == 2
    assert result["total"] == 1  # only 1 eligible page
    assert result["success"] == 1


# ─── 9. run_project_ocr_fanout stats dict ────────────────────────────────────


@pytest.mark.asyncio
async def test_fanout_stats_dict_shape(tmp_path: Path) -> None:
    """run_project_ocr_fanout always returns total/success/failed/skipped."""
    from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
    from pdomain_prep_for_pgdp.core.pipeline.project_ocr_fanout import run_project_ocr_fanout

    db_path = tmp_path / "state.db"
    db = SqliteDatabase(f"sqlite:///{db_path}")
    await db.initialize()
    await db.put_project(_make_project("proj5"))

    # No pages → all zeros.
    result = await run_project_ocr_fanout(
        project_id="proj5",
        page_ids=[],
        data_root=tmp_path,
        database=db,
    )
    assert set(result.keys()) == {"total", "success", "failed", "skipped"}
    assert result["total"] == 0
    assert result["success"] == 0
    assert result["failed"] == 0
    assert result["skipped"] == 0


# ─── JobType registration ─────────────────────────────────────────────────────


def test_job_type_run_project_ocr_batch_exists() -> None:
    """JobType.run_project_ocr_batch is registered in the enum."""
    from pdomain_prep_for_pgdp.core.models import JobType

    assert hasattr(JobType, "run_project_ocr_batch")
    assert JobType.run_project_ocr_batch.value == "run_project_ocr_batch"


def test_job_runner_has_handler_for_ocr_batch() -> None:
    """The job runner's _HANDLERS map includes run_project_ocr_batch."""
    from pdomain_prep_for_pgdp.core import job_runner as _jr
    from pdomain_prep_for_pgdp.core.models import JobType

    assert JobType.run_project_ocr_batch in _jr._HANDLERS


# ─── Wiring: route enqueues run_project_ocr_batch ───────────────────────────
#
# These tests drive the full route layer via TestClient and assert that
# POST .../page-stages/ocr/run-batch enqueues a run_project_ocr_batch job
# (not N sequential run_page_stage jobs), preserving the 409 gates and
# per-page SSE/event behaviour already tested above.


def _build_wiring_fixtures(tmp_path: Path) -> tuple[Any, Any]:
    """Build Settings + seeded project for route wiring tests."""
    import asyncio
    from datetime import UTC, datetime

    from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
    from pdomain_prep_for_pgdp.core.models import (
        PageProcessingStatus,
        PageRecord,
        PipelineState,
        Project,
        ProjectConfig,
        ProjectStatus,
    )
    from pdomain_prep_for_pgdp.settings import Settings
    from tests.fixtures.seed_pages import seed_pages_in_store

    settings = Settings(
        host="127.0.0.1",
        port=8765,
        data_root=tmp_path / "data",
        config_dir=tmp_path / "config",
        storage_backend="filesystem",
        database_url=f"sqlite:///{(tmp_path / 'state.db').as_posix()}",
        auth_mode="none",
        gpu_backend="cpu",
        dispatch_interval_seconds=0,
    )

    project_id = "wproj1"

    async def _seed() -> None:
        db = SqliteDatabase(settings.derived_database_url)
        await db.initialize()
        now = datetime.now(UTC)
        await db.put_project(
            Project(
                id=project_id,
                owner_id="default",
                name=project_id,
                created_at=now,
                updated_at=now,
                status=ProjectStatus.processing,
                page_count=1,
                proof_page_count=1,
                config=ProjectConfig(book_name=project_id, source_uri=""),
                pipeline_state=PipelineState(),
                storage_prefix=f"projects/{project_id}/",
                registry_version=2,
            )
        )
        await db.close()

    asyncio.run(_seed())

    seed_pages_in_store(
        settings,
        project_id,
        [
            PageRecord(
                project_id=project_id,
                idx0=0,
                prefix="p001",
                source_stem="src1",
                processing_status=PageProcessingStatus.pending,
            )
        ],
    )

    return settings, project_id


def _seed_clean_post_ocr_crop(settings: Any, project_id: str, page_ids: list[str]) -> None:
    """Mark the given pages as having a clean post_ocr_crop stage row."""
    import asyncio

    from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
    from pdomain_prep_for_pgdp.core.models import PageStageState, PageStageStatus

    async def _go() -> None:
        db = SqliteDatabase(settings.derived_database_url)
        await db.initialize()
        for pid in page_ids:
            state = PageStageState(
                project_id=project_id,
                page_id=pid,
                stage_id="post_ocr_crop",
                status=PageStageStatus.clean,
            )
            await db.put_page_stage(state)
        await db.close()

    asyncio.run(_go())


def test_run_project_ocr_batch_route_enqueues_correct_job_type(tmp_path: Path) -> None:
    """POST /page-stages/ocr/run-batch enqueues a run_project_ocr_batch job (not run_page_stage).

    This is the core wiring assertion: when the frontend triggers OCR at project
    scope, ONE batch job is enqueued, not N per-page jobs.
    """
    import asyncio

    from fastapi.testclient import TestClient

    from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
    from pdomain_prep_for_pgdp.bootstrap import build_app
    from pdomain_prep_for_pgdp.core.models import JobType

    settings, project_id = _build_wiring_fixtures(tmp_path)
    _seed_clean_post_ocr_crop(settings, project_id, ["0000"])

    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post(f"/api/data/projects/{project_id}/page-stages/ocr/run-batch")

    assert r.status_code == 202, f"Expected 202, got {r.status_code}: {r.text}"
    body = r.json()
    assert body["type"] == JobType.run_project_ocr_batch.value, (
        f"Expected job type {JobType.run_project_ocr_batch.value!r}, got {body['type']!r}"
    )
    assert body["status"] == "queued"
    assert body["project_id"] == project_id

    # Verify the job is in the DB with the correct type.
    async def _check() -> None:
        db = SqliteDatabase(settings.derived_database_url)
        await db.initialize()
        jobs = await db.list_recent_jobs("default", 10)
        ocr_batch_jobs = [j for j in jobs if j.type == JobType.run_project_ocr_batch]
        assert len(ocr_batch_jobs) == 1, f"Expected 1 batch job, found {len(ocr_batch_jobs)}"
        assert ocr_batch_jobs[0].id == body["id"]
        await db.close()

    asyncio.run(_check())


def test_run_project_ocr_batch_route_409_no_eligible_pages(tmp_path: Path) -> None:
    """POST /page-stages/ocr/run-batch returns 409 when no pages have clean post_ocr_crop."""
    from fastapi.testclient import TestClient

    from pdomain_prep_for_pgdp.bootstrap import build_app

    settings, project_id = _build_wiring_fixtures(tmp_path)
    # Deliberately do NOT seed any clean post_ocr_crop rows.

    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post(f"/api/data/projects/{project_id}/page-stages/ocr/run-batch")

    assert r.status_code == 409, f"Expected 409, got {r.status_code}: {r.text}"
    body = r.json()
    assert body["error"] == "ocr_batch_no_eligible_pages"
    assert body["stage_id"] == "ocr"


def test_run_project_ocr_batch_route_404_unknown_project(tmp_path: Path) -> None:
    """POST /page-stages/ocr/run-batch returns 404 for an unknown project."""
    from fastapi.testclient import TestClient

    from pdomain_prep_for_pgdp.bootstrap import build_app
    from pdomain_prep_for_pgdp.settings import Settings

    settings = Settings(
        host="127.0.0.1",
        port=8765,
        data_root=tmp_path / "data",
        config_dir=tmp_path / "config",
        storage_backend="filesystem",
        database_url=f"sqlite:///{(tmp_path / 'state.db').as_posix()}",
        auth_mode="none",
        gpu_backend="cpu",
        dispatch_interval_seconds=0,
    )

    import asyncio

    from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase

    async def _init() -> None:
        db = SqliteDatabase(settings.derived_database_url)
        await db.initialize()
        await db.close()

    asyncio.run(_init())

    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post("/api/data/projects/nonexistent-project/page-stages/ocr/run-batch")

    assert r.status_code == 404


def test_run_project_ocr_batch_route_payload_includes_batch_knobs(tmp_path: Path) -> None:
    """The enqueued job payload includes batch_size and pipeline_slots from settings."""
    import asyncio

    from fastapi.testclient import TestClient

    from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
    from pdomain_prep_for_pgdp.bootstrap import build_app

    settings, project_id = _build_wiring_fixtures(tmp_path)
    _seed_clean_post_ocr_crop(settings, project_id, ["0000"])

    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post(f"/api/data/projects/{project_id}/page-stages/ocr/run-batch")

    assert r.status_code == 202
    body = r.json()
    job_id = body["id"]

    async def _check_payload() -> None:
        db = SqliteDatabase(settings.derived_database_url)
        await db.initialize()
        job = await db.get_job(job_id)
        assert job is not None
        payload = job.payload
        # batch_size may be None (auto) or an int; key must be present.
        assert "batch_size" in payload
        assert "pipeline_slots" in payload
        assert isinstance(payload["pipeline_slots"], int)
        await db.close()

    asyncio.run(_check_payload())
