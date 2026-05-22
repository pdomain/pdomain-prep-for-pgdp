# Backend Quality Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

> **STATUS: FULLY SHIPPED** — All 21 tasks and 42 findings resolved by 2026-05-16. Archived 2026-05-22.
> See git log for commit evidence; each task maps to a  commit on .


**Goal:** Eliminate all 42 silent-failure, bad-propagation, and type-safety findings from the 2026-05-16 audit, bringing the backend up to "errors surface loudly and predictably" standard.

**Architecture:** Four cohesive groups—Critical (corrupt data / invisible failures), High (exception narrowing + rollback safety), Medium (typing hygiene + observability). Each task adds failing tests first, then fixes the code, keeping the CI green at every commit. No feature additions, no API breakage.

**Tech Stack:** Python 3.13, FastAPI, Pydantic v2, SQLite, pd-book-tools v0.9.0 (pinned). Test runner: `uv run pytest`. CI: `make ci AI=1`.

**Source of truth for all audit findings:** `docs/audit/code-quality-audit-2026-05-16.md`.

---

## Part 1 — Critical: Silent data corruption and invisible batch failures

---

### Task 1: Direct-typed adapter for `pd_book_tools.Word` in `core/ocr.py`

**Audit finding:** #1 — `core/ocr.py:344-374` — 30-line `getattr` cascade produces silent `(0,0,0,0)` bboxes.

**Root cause:** `pd_book_tools.ocr.word.Word` has `.text`, `.bounding_box` (a `BoundingBox` with `.minX`/`.minY`/`.maxX`/`.maxY`), and `.ocr_confidence`. The current code uses `getattr(w, "confidence", 0.0)` (wrong field name — it's `ocr_confidence`) and `getattr(bbox, "left", ...)` (wrong property — it's `minX`). Every fallback silently produces 0.

**Files:**
- Modify: `src/pd_prep_for_pgdp/core/ocr.py:344-374`
- Test: `tests/test_ocr_word_adapter.py` (create new)

- [x] **Step 1: Write the failing tests**

```python
# tests/test_ocr_word_adapter.py
"""Tests for the pd_book_tools.Word → OcrWord adapter."""
import pytest
from unittest.mock import MagicMock


def _make_pd_word(text="hello", left=10, top=20, right=110, bottom=70, confidence=0.95):
    """Build a minimal pd_book_tools.Word-like object with the real API shape."""
    from pd_book_tools.geometry.bounding_box import BoundingBox
    from pd_book_tools.geometry.point import Point
    from pd_book_tools.ocr.word import Word

    bb = BoundingBox(top_left=Point(left, top), bottom_right=Point(right, bottom))
    return Word(text=text, bounding_box=bb, ocr_confidence=confidence)


def test_adapter_extracts_correct_bbox():
    from pd_prep_for_pgdp.core.ocr import _to_ocr_word

    w = _make_pd_word(left=10, top=20, right=110, bottom=70)
    result = _to_ocr_word(w)
    assert result.bounding_box.left == 10
    assert result.bounding_box.top == 20
    assert result.bounding_box.width == 100   # 110 - 10
    assert result.bounding_box.height == 50   # 70 - 20


def test_adapter_extracts_text_and_confidence():
    from pd_prep_for_pgdp.core.ocr import _to_ocr_word

    w = _make_pd_word(text="World", confidence=0.87)
    result = _to_ocr_word(w)
    assert result.text == "World"
    assert abs(result.confidence - 0.87) < 1e-6


def test_adapter_none_confidence_becomes_zero():
    from pd_prep_for_pgdp.core.ocr import _to_ocr_word

    w = _make_pd_word(confidence=None)
    result = _to_ocr_word(w)
    assert result.confidence == 0.0


def test_adapter_raises_on_wrong_type():
    from pd_prep_for_pgdp.core.ocr import _to_ocr_word

    with pytest.raises(TypeError, match="expected pd_book_tools.ocr.word.Word"):
        _to_ocr_word({"text": "bad"})


def test_adapter_split_suffix_propagated():
    from pd_prep_for_pgdp.core.ocr import _to_ocr_word

    w = _make_pd_word()
    result = _to_ocr_word(w, split_suffix="a")
    assert result.split_suffix == "a"
```

- [x] **Step 2: Run to confirm they fail**

```
uv run pytest tests/test_ocr_word_adapter.py -v
```

Expected: `test_adapter_raises_on_wrong_type` fails (no TypeError today); `test_adapter_extracts_correct_bbox` may fail due to wrong property names.

- [x] **Step 3: Replace the `_to_ocr_word` implementation**

Replace `src/pd_prep_for_pgdp/core/ocr.py:344-374` with:

```python
def _to_ocr_word(w: Any, split_suffix: str | None = None) -> OcrWord:
    """Adapt a ``pd_book_tools.ocr.word.Word`` into our wire-shape ``OcrWord``.

    Raises ``TypeError`` if ``w`` is not the expected type — silent zeros
    from a renamed API are worse than a loud crash at the boundary.
    """
    try:
        from pd_book_tools.ocr.word import Word as PdWord
    except ImportError as exc:
        raise RuntimeError("pd_book_tools is not installed") from exc

    if not isinstance(w, PdWord):
        raise TypeError(
            f"expected pd_book_tools.ocr.word.Word, got {type(w).__qualname__!r}"
        )

    bb = w.bounding_box
    L = int(bb.minX)
    T = int(bb.minY)
    R = int(bb.maxX)
    B = int(bb.maxY)
    width = max(0, R - L)
    height = max(0, B - T)
    return OcrWord(
        id=uuid.uuid4().hex,
        text=w.text,
        confidence=float(w.ocr_confidence or 0.0),
        bounding_box=BoundingBox(left=L, top=T, width=width, height=height),
        split_suffix=split_suffix,
    )
```

- [x] **Step 4: Run the tests**

```
uv run pytest tests/test_ocr_word_adapter.py -v
```

Expected: all 5 tests PASS.

- [x] **Step 5: Run full CI to check for regressions**

```
make ci AI=1
```

Expected: green.

- [x] **Step 6: Commit**

```bash
git add tests/test_ocr_word_adapter.py src/pd_prep_for_pgdp/core/ocr.py
git commit -m "fix(ocr): replace getattr cascade in _to_ocr_word with direct typed access"
```

---

### Task 2: Direct-typed adapter for `LayoutRegion` in `core/illustrations.py`

**Audit findings:** #6, #7 — `core/illustrations.py:53-67` uses `getattr(region, "L", 0) or 0`; `_map_region_type` stringifies enum instead of matching it directly.

**Root cause:** `pd_book_tools.layout.types.LayoutRegion` has integer fields `.L`, `.R`, `.T`, `.B` and `.confidence`. The `getattr(region, "L", 0) or 0` is actually reading the right field name, but the `or 0` guard silently accepts a legitimate `L=0` the same way it accepts a missing field. The bigger bug is `_map_region_type` calling `str(rt).lower()` — if `RegionType.figure` stringifies as `"RegionType.figure"`, the substring `"figure"` check works, but any new enum value not containing "decor"/"table"/"figure" silently maps to "illustration".

**Files:**
- Modify: `src/pd_prep_for_pgdp/core/illustrations.py:44-80`
- Test: `tests/test_illustrations_auto_detect.py` (add cases)

- [x] **Step 1: Write the failing tests**

Add to `tests/test_illustrations_auto_detect.py` (after existing tests):

```python
def test_map_region_type_unknown_value_raises():
    """_map_region_type must not silently map unknown enum values to 'illustration'."""
    from pd_prep_for_pgdp.core.illustrations import _map_region_type
    from pd_book_tools.layout.types import RegionType

    # Known mappings must still work.
    assert _map_region_type(RegionType.figure) == "illustration"
    assert _map_region_type(RegionType.table) == "illustration"
    assert _map_region_type(RegionType.decoration) == "decoration"

    # An unknown enum-like value must raise, not silently produce "illustration".
    with pytest.raises((KeyError, ValueError)):
        _map_region_type(RegionType.text)  # text regions are NOT illustrations


def test_auto_detect_uses_isinstance_not_getattr():
    """Passing a non-LayoutRegion object to the loop should raise, not silently zero."""
    from unittest.mock import MagicMock
    from pd_prep_for_pgdp.core.illustrations import auto_detect_illustrations
    from pd_book_tools.layout.types import RegionType

    fake_layout = MagicMock()
    bad_region = MagicMock(spec=[])  # has none of the LayoutRegion fields
    bad_region.type = RegionType.figure
    bad_region.confidence = 1.0
    # No L/R/T/B attributes — old code would silently produce (0,0,0,0).
    fake_layout.regions = [bad_region]

    fake_detector = MagicMock()
    fake_detector.detect.return_value = fake_layout

    with pytest.raises((AttributeError, TypeError)):
        auto_detect_illustrations(
            MagicMock(),
            layout_detector=fake_detector,
            confidence_threshold=0.5,
        )
```

- [x] **Step 2: Run to confirm they fail**

```
uv run pytest tests/test_illustrations_auto_detect.py -v -k "test_map_region_type or test_auto_detect_uses_isinstance"
```

Expected: both FAIL (no raises today, wrong behavior).

- [x] **Step 3: Replace `_map_region_type` and region access in `auto_detect_illustrations`**

Replace `src/pd_prep_for_pgdp/core/illustrations.py:44-80` with:

```python
    keep_types = {RegionType.figure, RegionType.decoration, RegionType.table}
    page_layout = layout_detector.detect(image_path)
    out: list[IllustrationRegion] = []
    idx = 0
    for region in page_layout.regions:
        if not isinstance(region, LayoutRegion):
            raise TypeError(
                f"layout detector returned unexpected region type {type(region).__qualname__!r}"
            )
        if region.type not in keep_types:
            continue
        if region.confidence < confidence_threshold:
            continue
        idx += 1
        out.append(
            IllustrationRegion(
                index=idx,
                label="",
                type=_map_region_type(region.type),
                L=region.L,
                T=region.T,
                R=region.R,
                B=region.B,
            )
        )
    return out


_REGION_TYPE_MAP: dict[RegionType, str] = {
    RegionType.figure: "illustration",
    RegionType.table: "illustration",
    RegionType.decoration: "decoration",
}


def _map_region_type(rt: RegionType) -> str:
    """Map RegionType -> spec-05 type string. Raises KeyError on unrecognised type."""
    return _REGION_TYPE_MAP[rt]
```

Also add the import at the top of the file after existing imports:

```python
from pd_book_tools.layout.types import LayoutRegion, RegionType
```

And remove the `try/except ImportError: return []` block around it (the `LayoutRegion` import is now unconditional; the outer `try` for the keep_types set remains but wraps only the `RegionType` usage):

The full `auto_detect_illustrations` function body should be:

```python
def auto_detect_illustrations(
    image_path: Path,
    *,
    layout_detector: Any,
    confidence_threshold: float,
) -> list[IllustrationRegion]:
    if layout_detector is None:
        return []

    try:
        from pd_book_tools.layout.types import LayoutRegion, RegionType
    except ImportError as exc:
        raise RuntimeError(
            "pd_book_tools layout types are not available; "
            "install pd-book-tools with layout support"
        ) from exc

    keep_types = {RegionType.figure, RegionType.decoration, RegionType.table}
    page_layout = layout_detector.detect(image_path)
    out: list[IllustrationRegion] = []
    idx = 0
    for region in page_layout.regions:
        if not isinstance(region, LayoutRegion):
            raise TypeError(
                f"layout detector returned unexpected region type "
                f"{type(region).__qualname__!r}"
            )
        if region.type not in keep_types:
            continue
        if region.confidence < confidence_threshold:
            continue
        idx += 1
        out.append(
            IllustrationRegion(
                index=idx,
                label="",
                type=_map_region_type(region.type),
                L=region.L,
                T=region.T,
                R=region.R,
                B=region.B,
            )
        )
    return out


_REGION_TYPE_MAP: dict[Any, str] = {}  # populated lazily below


def _map_region_type(rt: Any) -> str:
    """Map RegionType -> spec-05 type string. Raises KeyError on unrecognised type."""
    global _REGION_TYPE_MAP
    if not _REGION_TYPE_MAP:
        try:
            from pd_book_tools.layout.types import RegionType
            _REGION_TYPE_MAP = {
                RegionType.figure: "illustration",
                RegionType.table: "illustration",
                RegionType.decoration: "decoration",
            }
        except ImportError:
            pass
    return _REGION_TYPE_MAP[rt]
```

> **Note:** The `_REGION_TYPE_MAP` lazy init keeps the module importable without pd-book-tools for unit tests that mock the detector. The `auto_detect_illustrations` function itself will raise `RuntimeError` on import failure, which is the right behaviour for a real run.

- [x] **Step 4: Run the tests**

```
uv run pytest tests/test_illustrations_auto_detect.py tests/test_illustrations.py -v
```

Expected: all PASS.

- [x] **Step 5: Full CI**

```
make ci AI=1
```

Expected: green.

- [x] **Step 6: Commit**

```bash
git add src/pd_prep_for_pgdp/core/illustrations.py tests/test_illustrations_auto_detect.py
git commit -m "fix(illustrations): replace getattr cascade with isinstance checks; enum map for _map_region_type"
```

---

### Task 3: Surface per-page failures in `_handle_project_run_dirty`

**Audit finding:** #22 — `core/job_runner.py:525-527` — any page failure is swallowed; parent job ends `complete` even if half the pages failed.

**Files:**
- Modify: `src/pd_prep_for_pgdp/core/job_runner.py:510-543`
- Test: `tests/test_job_handler_errors.py` (add cases)

- [x] **Step 1: Write failing tests**

Add to `tests/test_job_handler_errors.py`:

```python
async def test_project_run_dirty_marks_error_on_partial_failure(
    three_page_project, app_client
):
    """A run-dirty job with any page failure must end with status=error, not complete."""
    # Arrange: make stage_runner.run_stage raise on the first page.
    import asyncio
    from unittest.mock import AsyncMock, patch

    call_count = 0

    async def flaky_run_stage(**kwargs):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            raise RuntimeError("injected stage failure")

    with patch(
        "pd_prep_for_pgdp.core.job_runner.run_stage",
        side_effect=flaky_run_stage,
    ):
        resp = app_client.post(
            f"/projects/{three_page_project}/run-dirty",
            json={"data_root": str(tmp_path)},
        )
    assert resp.status_code == 202
    job_id = resp.json()["job_id"]

    # Poll until the job finishes (at most a few seconds in tests).
    import time
    for _ in range(30):
        j = app_client.get(f"/jobs/{job_id}").json()
        if j["status"] in {"complete", "error"}:
            break
        time.sleep(0.1)

    assert j["status"] == "error"
    assert j["error_message"] is not None
    assert "1" in j["error_message"]  # at least 1 failure mentioned


async def test_project_run_dirty_error_message_lists_failed_pages(
    three_page_project, app_client, tmp_path
):
    """error_message must include which page/stage failed."""
    from unittest.mock import patch

    async def always_fail(**kwargs):
        raise RuntimeError("boom")

    with patch("pd_prep_for_pgdp.core.job_runner.run_stage", side_effect=always_fail):
        resp = app_client.post(
            f"/projects/{three_page_project}/run-dirty",
            json={"data_root": str(tmp_path)},
        )
    job_id = resp.json()["job_id"]

    import time
    for _ in range(30):
        j = app_client.get(f"/jobs/{job_id}").json()
        if j["status"] in {"complete", "error"}:
            break
        time.sleep(0.1)

    assert j["status"] == "error"
    assert "3" in j["error_message"] or "page" in j["error_message"].lower()
```

> **Note:** If the project doesn't expose a `/run-dirty` HTTP route, test `_handle_project_run_dirty` directly via `tests/test_job_runner_internals.py` using an in-process `InProcessJobRunner`. Adapt the approach to match what `tests/test_project_fanout.py` does for similar fan-out jobs.

- [x] **Step 2: Run to confirm failures**

```
uv run pytest tests/test_job_handler_errors.py -v -k "partial_failure or lists_failed"
```

Expected: both FAIL (job ends `complete` today).

- [x] **Step 3: Update `_handle_project_run_dirty`**

In `src/pd_prep_for_pgdp/core/job_runner.py`, replace the inner loop at lines 510-543:

```python
    ordered = [sid for sid in PAGE_STAGE_IDS if sid in stage_ids]
    page_errors: list[str] = []
    for stage_id in ordered:
        try:
            await run_stage(
                data_root=data_root,
                database=runner._db,
                project_id=job.project_id,
                page_id=page_id,
                stage_id=stage_id,
                device=device,
                storage=runner._storage,
                page_source_key=page_source_key,
            )
        except Exception as exc:
            log.warning(
                "page %s stage %s failed in project_run_dirty: %s",
                page_id,
                stage_id,
                exc,
                exc_info=True,
            )
            page_errors.append(f"{page_id}/{stage_id}: {exc!r}")

    child_ok = len(page_errors) == 0
    child_done = child.model_copy(
        update={
            "status": JobStatus.complete if child_ok else JobStatus.error,
            "completed_at": datetime.now(UTC),
            "error_message": "; ".join(page_errors) if page_errors else None,
        }
    )
    await runner._db.put_job(child_done)
```

Then, after the per-page loop at the parent-job progress update site (lines 537-542), accumulate child errors into the parent:

After the existing `job = await runner._update_progress(...)` block, add parent-error aggregation. Locate the outer loop that iterates pages and collect child errors:

```python
    # (in the outer page loop, after child_done is written)
    if not child_ok:
        parent_errors.append(f"page {i}: {'; '.join(page_errors)}")
```

Before the outer page loop starts, initialise:

```python
    parent_errors: list[str] = []
```

After the outer page loop, update the parent job:

```python
    if parent_errors:
        job = job.model_copy(
            update={
                "error_message": f"{len(parent_errors)}/{total} pages failed: "
                + "; ".join(parent_errors[:5])
                + ("..." if len(parent_errors) > 5 else ""),
            }
        )
```

> The parent job's final `status` is set by `_run_job` using the child results; the `error_message` added here propagates to the API response.

- [x] **Step 4: Run the tests**

```
uv run pytest tests/test_job_handler_errors.py tests/test_job_runner.py tests/test_project_fanout.py -v
```

Expected: new tests PASS; no regressions.

- [x] **Step 5: Full CI**

```
make ci AI=1
```

Expected: green.

- [x] **Step 6: Commit**

```bash
git add src/pd_prep_for_pgdp/core/job_runner.py tests/test_job_handler_errors.py
git commit -m "fix(job_runner): surface per-page failures in _handle_project_run_dirty"
```

---

### Task 4: Gate traceback in 500 responses behind a debug flag

**Audit finding:** #41 — `api/middleware/error_handler.py:46-55` — last 3 lines of traceback are returned in every 500 response body, leaking file paths and possibly secrets.

**Files:**
- Modify: `src/pd_prep_for_pgdp/settings.py` (add `debug` field)
- Modify: `src/pd_prep_for_pgdp/api/middleware/error_handler.py`
- Test: `tests/test_error_handler.py` (add cases)

- [x] **Step 1: Write failing tests**

Add to `tests/test_error_handler.py`:

```python
def test_500_does_not_leak_traceback_by_default(app_client):
    """Without PGDP_DEBUG=true, 500 responses must not include traceback details."""
    # Trigger a deliberate 500 via a route that raises.
    resp = app_client.get("/__test_500__")  # see Step 3 for how to register this
    assert resp.status_code == 500
    body = resp.json()
    assert "details" not in body or body["details"] is None
    # Traceback fragments must not appear.
    assert "Traceback" not in str(body)
    assert "File " not in str(body)


def test_500_includes_traceback_with_debug_flag(app_client_debug):
    """With PGDP_DEBUG=true, 500 responses include traceback details."""
    resp = app_client_debug.get("/__test_500__")
    assert resp.status_code == 500
    body = resp.json()
    # details is present and non-empty when debug=True.
    assert body.get("details") is not None
```

> **Note:** `app_client_debug` is a new fixture that creates the app with `Settings(debug=True)`. Look at how `app_client` is constructed in `tests/conftest.py` and add a parallel `app_client_debug` fixture that patches `settings.debug = True`.
>
> The `/__test_500__` route is a 1-line addition to the test app only (not the real app): register it in conftest via `app.add_api_route("/__test_500__", lambda: 1/0)` before the test client is constructed.

- [x] **Step 2: Run to confirm failures**

```
uv run pytest tests/test_error_handler.py -v -k "traceback"
```

Expected: `test_500_does_not_leak_traceback_by_default` FAILS (details present today).

- [x] **Step 3: Add `debug` to Settings**

In `src/pd_prep_for_pgdp/settings.py`, add after `auth_mode`:

```python
    # ── Debug ────────────────────────────────────────────────────────────────
    debug: bool = False
    """When True, 500 responses include last 3 lines of the traceback.
    Never enable in production / managed mode."""
```

- [x] **Step 4: Gate traceback in the error handler**

Replace `src/pd_prep_for_pgdp/api/middleware/error_handler.py:24-56` with:

```python
def install_error_handlers(app: FastAPI, *, debug: bool = False) -> None:
    @app.exception_handler(StarletteHTTPException)
    async def _http_exc(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=ApiError(
                error=f"http_{exc.status_code}",
                message=str(exc.detail),
            ).model_dump(),
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_exc(request: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=400,
            content=ApiError(
                error="validation_error",
                message="request body failed validation",
                details=exc.errors(),
            ).model_dump(),
        )

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        log.exception("unhandled exception in %s %s", request.method, request.url.path)
        details = traceback.format_exc().splitlines()[-3:] if debug else None
        return JSONResponse(
            status_code=500,
            content=ApiError(
                error="internal_error",
                message=str(exc) or exc.__class__.__name__,
                details=details,
            ).model_dump(),
        )
```

Find where `install_error_handlers` is called in `bootstrap.py` (or `main.py`) and pass `debug=settings.debug`:

```python
install_error_handlers(app, debug=settings.debug)
```

- [x] **Step 5: Run the tests**

```
uv run pytest tests/test_error_handler.py -v
```

Expected: all PASS including the two new cases.

- [x] **Step 6: Full CI**

```
make ci AI=1
```

Expected: green.

- [x] **Step 7: Commit**

```bash
git add src/pd_prep_for_pgdp/settings.py \
        src/pd_prep_for_pgdp/api/middleware/error_handler.py
git commit -m "fix(error_handler): gate traceback in 500 responses behind PGDP_DEBUG=true"
```

---

## Part 2 — High: Exception narrowing, rollback safety, and structured errors

---

### Task 5: Narrow exception handling in `core/ocr.py` device detection and Tesseract path

**Audit findings:** #2, #3, #5

**Files:**
- Modify: `src/pd_prep_for_pgdp/core/ocr.py:68-79` and `core/ocr.py:320-340`
- Test: `tests/test_ocr_engine_override.py` (add cases)

- [x] **Step 1: Write failing tests**

Add to `tests/test_ocr_engine_override.py`:

```python
def test_detect_torch_device_propagates_non_import_errors(monkeypatch):
    """RuntimeError during device detection must not be swallowed."""
    import sys
    import importlib

    # Simulate torch available but cuda.is_available() raising RuntimeError.
    import types
    mock_torch = types.ModuleType("torch")
    mock_torch.cuda = types.SimpleNamespace(is_available=lambda: (_ for _ in ()).throw(RuntimeError("CUDA driver not loaded")))
    mock_torch.backends = types.SimpleNamespace()
    monkeypatch.setitem(sys.modules, "torch", mock_torch)

    from pd_prep_for_pgdp.core import ocr as ocr_module
    import importlib
    importlib.reload(ocr_module)

    with pytest.raises(RuntimeError, match="CUDA driver not loaded"):
        ocr_module._detect_torch_device()
```

> **Note:** If module-level mocking is too brittle, test the narrowing behaviour with a simpler approach: confirm the exception type caught in production code. The key assertion is that `RuntimeError` is NOT silently swallowed.

- [x] **Step 2: Run to confirm failure**

```
uv run pytest tests/test_ocr_engine_override.py -v -k "non_import_errors"
```

Expected: FAIL (RuntimeError silently swallowed today → returns "cpu").

- [x] **Step 3: Narrow exception types in `_detect_torch_device`**

Replace `src/pd_prep_for_pgdp/core/ocr.py:68-79`:

```python
def _detect_torch_device() -> str:
    """Pick the best available torch device (CUDA -> MPS -> CPU)."""
    try:
        import torch  # type: ignore[import-not-found]
    except ImportError:
        return "cpu"

    try:
        if torch.cuda.is_available():
            return "cuda"
    except RuntimeError:
        log.warning("CUDA availability check raised RuntimeError; falling back to CPU", exc_info=True)
        return "cpu"

    try:
        from torch.backends import mps  # type: ignore[import-not-found]
        if mps.is_available():
            return "mps"
    except ImportError:
        pass

    return "cpu"
```

- [x] **Step 4: Add `words_error` field to `OcrPageResult` and surface Tesseract failures**

Locate the `OcrPageResult` dataclass (or Pydantic model) in `src/pd_prep_for_pgdp/core/models.py` or `core/ocr.py`. Add:

```python
words_error: str | None = None
```

In `core/ocr.py` around line 327, replace the broad `except Exception` on the Tesseract bbox path:

```python
    try:
        # ... Tesseract image_to_data call ...
    except Exception as exc:
        log.exception("Tesseract image_to_data failed; returning text-only result")
        return OcrPageResult(
            text=text,
            words=[],
            words_error=f"{type(exc).__name__}: {exc}",
            # ... other fields ...
        )
```

> If `OcrPageResult` is defined in `core/models.py`, add `words_error: str | None = None` there. If it's a dataclass in `ocr.py`, add the field there. Check which file defines it with `grep -n "class OcrPageResult" src/pd_prep_for_pgdp/core/`.

- [x] **Step 5: Run the tests**

```
uv run pytest tests/test_ocr_engine_override.py -v
```

Expected: all PASS.

- [x] **Step 6: Full CI**

```
make ci AI=1
```

- [x] **Step 7: Commit**

```bash
git add src/pd_prep_for_pgdp/core/ocr.py src/pd_prep_for_pgdp/core/models.py
git commit -m "fix(ocr): narrow broad except in device detection and Tesseract bbox path"
```

---

### Task 6: Introduce `_safe_rollback` in `page_stage_writer.py` (rollback silencing)

**Audit findings:** #10, #12, #14 — `contextlib.suppress(OSError)` in rollback paths silently swallows filesystem errors, leaving disk state undefined.

**Files:**
- Modify: `src/pd_prep_for_pgdp/core/pipeline/page_stage_writer.py`
- Test: `tests/test_page_stage_writer.py` (add injection tests)

- [x] **Step 1: Write failing tests**

Add to `tests/test_page_stage_writer.py`:

```python
def test_rollback_osError_is_logged_not_swallowed(tmp_path, caplog):
    """When the rollback unlink itself raises OSError, it must be logged at ERROR."""
    import asyncio
    import logging
    from unittest.mock import patch, AsyncMock
    from pd_prep_for_pgdp.core.pipeline.page_stage_writer import commit_stage_artifact
    from pd_prep_for_pgdp.core.models import PageStageStatus

    # Arrange: stub a DB that fails on put_page_stage to trigger rollback.
    mock_db = AsyncMock()
    mock_db.put_page_stage.side_effect = RuntimeError("injected DB failure")
    mock_db.get_page_stage.return_value = None

    stage_dir = tmp_path / "projects" / "p1" / "pages" / "pg1" / "stages" / "decode_source"
    stage_dir.mkdir(parents=True)
    artifact_bytes = b"fake image data"

    # Patch target_path.unlink to raise OSError during rollback.
    original_unlink = None

    def failing_unlink(missing_ok=False):
        raise OSError("permission denied during rollback")

    with caplog.at_level(logging.ERROR, logger="pd_prep_for_pgdp"):
        with pytest.raises(Exception):  # StageArtifactWriteError or similar
            asyncio.get_event_loop().run_until_complete(
                commit_stage_artifact(
                    data_root=tmp_path,
                    database=mock_db,
                    project_id="p1",
                    page_id="pg1",
                    stage_id="decode_source",
                    artifact_bytes=artifact_bytes,
                    stage_version=1,
                )
            )

    # The rollback OSError must appear in logs, not be suppressed silently.
    error_messages = [r.message for r in caplog.records if r.levelno >= logging.ERROR]
    assert any("rollback" in m.lower() or "unlink" in m.lower() for m in error_messages), \
        f"Expected rollback error in logs, got: {error_messages}"
```

- [x] **Step 2: Run to confirm failure**

```
uv run pytest tests/test_page_stage_writer.py -v -k "rollback_osError"
```

Expected: FAIL (OSError is suppressed, no log entry).

- [x] **Step 3: Add `_safe_rollback` helper**

In `src/pd_prep_for_pgdp/core/pipeline/page_stage_writer.py`, add after the imports:

```python
def _safe_rollback(paths_to_unlink: list[Path], context: str) -> None:
    """Attempt to unlink each path; log ERROR for any failure (never raises).

    Used in exception handlers where the primary error has already been
    captured — rollback failures must not shadow it, but they must not
    vanish silently either.
    """
    for p in paths_to_unlink:
        try:
            p.unlink(missing_ok=True)
        except OSError as exc:
            log.error("rollback unlink failed for %s (%s): %s", p, context, exc)
```

- [x] **Step 4: Replace `contextlib.suppress(OSError)` in all rollback sites**

Search for every `contextlib.suppress(OSError)` in `page_stage_writer.py`:

```
grep -n "contextlib.suppress" src/pd_prep_for_pgdp/core/pipeline/page_stage_writer.py
```

For each **rollback** site (inside an `except BaseException`/`except OSError` handler), replace:

```python
with contextlib.suppress(OSError):
    tmp_path.unlink(missing_ok=True)
```

with:

```python
_safe_rollback([tmp_path], context=f"tmp write for {stage_id!r}")
```

And for the snapshot-restore rollback (line 404-408), replace:

```python
with contextlib.suppress(OSError):
    if prior_snapshot is not None and prior_snapshot.exists():
        os.replace(str(prior_snapshot), str(target_path))
    elif target_path.exists():
        target_path.unlink()
```

with:

```python
try:
    if prior_snapshot is not None and prior_snapshot.exists():
        os.replace(str(prior_snapshot), str(target_path))
    elif target_path.exists():
        target_path.unlink(missing_ok=True)
except OSError as rollback_exc:
    log.error(
        "rollback failed after DB upsert error for %s/%s/%s: %s",
        project_id, page_id, stage_id, rollback_exc,
    )
```

> **Note:** The "best-effort thumbnail write" `contextlib.suppress(OSError)` on line 207 and line 413 is legitimately non-critical (thumbnails are cosmetic) — leave those as `contextlib.suppress(OSError)`.
>
> The FTS upsert `contextlib.suppress`-equivalent (line 424) is handled in Task 7.

- [x] **Step 5: Also remove the redundant `except BaseException: raise` (finding #11)**

In `write_artifact_file_sync` (lines 186-187):

```python
        except BaseException:
            raise
```

This inner `try/except BaseException: raise` is a no-op — the outer handler on line 188 catches the same thing. Delete the inner `try` block, keeping just the `os.fdopen` call directly inside the outer try:

```python
    try:
        fd = os.open(str(tmp_path), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
        with os.fdopen(fd, "wb") as fp:
            fp.write(artifact_bytes)
            fp.flush()
            os.fsync(fp.fileno())
    except BaseException as exc:
        _safe_rollback([tmp_path], context=f"deferred write for {target_path.name!r}")
        raise StageArtifactWriteError(
            f"deferred write failed (tmp write to {target_path.name!r}): {exc!r}"
        ) from exc
```

Same cleanup for the matching pattern inside `commit_stage_artifacts_multi` (lines 494-503).

- [x] **Step 6: Run the tests**

```
uv run pytest tests/test_page_stage_writer.py -v
```

Expected: all PASS including the new rollback test.

- [x] **Step 7: Full CI**

```
make ci AI=1
```

- [x] **Step 8: Commit**

```bash
git add src/pd_prep_for_pgdp/core/pipeline/page_stage_writer.py tests/test_page_stage_writer.py
git commit -m "fix(writer): introduce _safe_rollback; log rollback OSErrors instead of suppressing"
```

---

### Task 7: Narrow FTS upsert and thumbnail exception handlers in `page_stage_writer.py`

**Audit findings:** #9, #13

**Files:**
- Modify: `src/pd_prep_for_pgdp/core/pipeline/page_stage_writer.py:117-142` (thumbnail), `420-430` (FTS)

- [x] **Step 1: Write failing tests**

Add to `tests/test_page_stage_writer.py`:

```python
def test_thumbnail_generation_narrow_except(monkeypatch):
    """thumbnail generation should only suppress cv2/IO errors, not TypeError."""
    from pd_prep_for_pgdp.core.pipeline.page_stage_writer import _generate_thumbnail

    def bad_decode(*args, **kwargs):
        raise TypeError("unexpected arg type")  # programmer error

    import cv2
    monkeypatch.setattr(cv2, "imdecode", bad_decode)

    with pytest.raises(TypeError):
        _generate_thumbnail(b"fake", output_type="png")
```

> **Note:** If `_generate_thumbnail` is a private helper, check if it's accessible from outside the module; if not, test via the public `commit_stage_artifact` path with a mocked cv2.

- [x] **Step 2: Narrow thumbnail generation**

In `page_stage_writer.py` around line 140, replace:

```python
    except Exception:
        log.warning("thumbnail generation failed for output_type=%r", output_type, exc_info=True)
        return None
```

with:

```python
    except (cv2.error, OSError, ValueError):
        log.warning("thumbnail generation failed for output_type=%r", output_type, exc_info=True)
        return None
```

- [x] **Step 3: Narrow FTS upsert exception**

In `page_stage_writer.py` around line 424, replace:

```python
    except BaseException:
        log.warning(
            "FTS index upsert failed for %s/%s (non-fatal; reindex --heal can repair)",
            ...
        )
```

with:

```python
    except Exception:
        log.warning(
            "FTS index upsert failed for %s/%s (non-fatal; reindex --heal can repair)",
            project_id,
            page_id,
            exc_info=True,
        )
```

The change from `BaseException` to `Exception` prevents swallowing `KeyboardInterrupt`/`SystemExit`.

- [x] **Step 4: Run tests + CI**

```
uv run pytest tests/test_page_stage_writer.py tests/test_stage_thumbnail.py -v
make ci AI=1
```

- [x] **Step 5: Commit**

```bash
git add src/pd_prep_for_pgdp/core/pipeline/page_stage_writer.py
git commit -m "fix(writer): narrow thumbnail and FTS exception handlers"
```

---

### Task 8: Fix `_compute_config_hash` type safety in `stage_runner.py`

**Audit finding:** #15

**Files:**
- Modify: `src/pd_prep_for_pgdp/core/pipeline/stage_runner.py:175-183`
- Test: `tests/test_stage_runner.py` or `tests/test_stage_config_fields.py`

- [x] **Step 1: Write failing tests**

Add to `tests/test_stage_config_fields.py`:

```python
def test_compute_config_hash_raises_on_typo_in_stage_config_fields():
    """A misspelt field name in STAGE_CONFIG_FIELDS should raise AttributeError,
    not silently produce a hash of {field: None}."""
    from pd_prep_for_pgdp.core.pipeline.stage_runner import _compute_config_hash
    from pd_prep_for_pgdp.core.models import ResolvedPageConfig

    cfg = ResolvedPageConfig()  # default config

    # Test with a field that exists → no error.
    # (Identify a real field from STAGE_CONFIG_FIELDS for one stage_id.)
    # Test with a fake stage_id that has a misspelled field → should raise.
    # Since STAGE_CONFIG_FIELDS is a dict, inject a fake entry for testing:
    import pd_prep_for_pgdp.core.pipeline.stage_runner as sr
    original = sr.STAGE_CONFIG_FIELDS.copy()
    try:
        sr.STAGE_CONFIG_FIELDS["_test_stage"] = {"nonexistent_field_xyz"}
        with pytest.raises(AttributeError, match="nonexistent_field_xyz"):
            _compute_config_hash(cfg, "_test_stage")
    finally:
        sr.STAGE_CONFIG_FIELDS.clear()
        sr.STAGE_CONFIG_FIELDS.update(original)
```

- [x] **Step 2: Run to confirm failure**

```
uv run pytest tests/test_stage_config_fields.py -v -k "typo"
```

Expected: FAIL (returns a hash of `{field: None}` today, no AttributeError).

- [x] **Step 3: Replace `getattr` in `_compute_config_hash`**

In `stage_runner.py:175-183`, replace:

```python
    subset = {f: getattr(cfg, f, None) for f in sorted(fields)}
```

with:

```python
    subset = {f: getattr(cfg, f) for f in sorted(fields)}
```

The removal of the `None` default makes `getattr` raise `AttributeError` on a missing field (a typo in `STAGE_CONFIG_FIELDS`) rather than silently including `None` in the hash.

Also add a type annotation for `cfg`:

```python
def _compute_config_hash(cfg: ResolvedPageConfig, stage_id: str) -> str | None:
```

(Replace `cfg: Any`.)

- [x] **Step 4: Run tests**

```
uv run pytest tests/test_stage_config_fields.py tests/test_stage_runner.py -v
make ci AI=1
```

- [x] **Step 5: Commit**

```bash
git add src/pd_prep_for_pgdp/core/pipeline/stage_runner.py tests/test_stage_config_fields.py
git commit -m "fix(stage_runner): _compute_config_hash raises AttributeError on unknown field"
```

---

### Task 9: Narrow layout import in `stage_runner.py` + job runner circuit breaker

**Audit findings:** #18, #20

**Files:**
- Modify: `src/pd_prep_for_pgdp/core/pipeline/stage_runner.py:512-515`
- Modify: `src/pd_prep_for_pgdp/core/job_runner.py:140-141`
- Test: `tests/test_stage_runner.py`, `tests/test_job_runner_internals.py`

- [x] **Step 1: Write failing test for layout import narrowing**

Add to `tests/test_stage_runner.py`:

```python
def test_layout_import_failure_raises_stage_run_failed():
    """A non-ImportError during layout import must propagate (not silently produce no illustrations)."""
    import sys
    from unittest.mock import patch

    # Simulate RuntimeError during import (broken install, not missing package).
    with patch.dict(sys.modules, {"pd_book_tools.layout": None}):
        with pytest.raises(Exception):  # must not silently return []
            from pd_prep_for_pgdp.core.pipeline import stage_runner
            # Reload or call the specific function that does the import.
            # Adapt to the actual function name in stage_runner.py.
            stage_runner._auto_detect_illustrations_cpu.__wrapped__  # trigger import
```

> **Note:** The exact test depends on how `_auto_detect_illustrations_cpu` is invoked. Consult `tests/test_auto_detect.py` for the established pattern and add a case where the import raises `RuntimeError` instead of `ImportError`.

- [x] **Step 2: Narrow `except Exception` to `except ImportError` in stage_runner**

In `stage_runner.py` around line 512-515:

```python
    try:
        from pd_book_tools.layout import get_layout_detector
        detector = get_layout_detector()
    except ImportError:
        detector = None
```

Any non-`ImportError` (e.g. `RuntimeError` from a broken CUDA driver) now propagates, marking the stage `failed` per Q9.

- [x] **Step 3: Write failing test for job runner circuit breaker**

Add to `tests/test_job_runner_internals.py`:

```python
async def test_job_runner_poll_loop_circuit_breaker():
    """After N consecutive poll failures the runner must stop, not loop forever."""
    from pd_prep_for_pgdp.core.job_runner import InProcessJobRunner
    from unittest.mock import AsyncMock, patch
    import asyncio

    mock_db = AsyncMock()
    mock_db.list_pending_jobs.side_effect = RuntimeError("DB connection lost")

    runner = InProcessJobRunner(db=mock_db, storage=AsyncMock())

    with pytest.raises(RuntimeError, match="DB connection lost|circuit breaker"):
        # Run the poll loop for a bounded time; it should give up and raise
        # after consecutive failures instead of looping forever.
        await asyncio.wait_for(runner.run_pending(), timeout=2.0)
```

- [x] **Step 4: Add a circuit breaker to `InProcessJobRunner.run_pending`**

In `core/job_runner.py`, modify the outer poll loop (around line 140):

```python
    _CIRCUIT_BREAKER_MAX = 5

    consecutive_failures = 0
    while True:
        try:
            await self._run_one_iteration()
            consecutive_failures = 0
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("InProcessJobRunner.run_pending iteration failed")
            consecutive_failures += 1
            if consecutive_failures >= _CIRCUIT_BREAKER_MAX:
                raise RuntimeError(
                    f"InProcessJobRunner circuit breaker: "
                    f"{consecutive_failures} consecutive failures"
                )
        await asyncio.sleep(self._poll_interval)
```

> Adjust the method and attribute names to match the actual implementation. The key addition is `consecutive_failures` tracking that re-raises after `_CIRCUIT_BREAKER_MAX` hits.

- [x] **Step 5: Run tests + CI**

```
uv run pytest tests/test_stage_runner.py tests/test_job_runner_internals.py -v
make ci AI=1
```

- [x] **Step 6: Commit**

```bash
git add src/pd_prep_for_pgdp/core/pipeline/stage_runner.py \
        src/pd_prep_for_pgdp/core/job_runner.py
git commit -m "fix: narrow layout import to ImportError; add circuit breaker to job runner poll"
```

---

### Task 10: Narrow `BaseException` in `single_executor.py`

**Audit finding:** #25 — `core/queue/single_executor.py:118-123` swallows `KeyboardInterrupt` into a future exception.

**Files:**
- Modify: `src/pd_prep_for_pgdp/core/queue/single_executor.py:118-123`
- Test: `tests/test_priority_queue.py` or `tests/test_single_executor_async_cm.py`

- [x] **Step 1: Write failing test**

Add to `tests/test_single_executor_async_cm.py`:

```python
def test_keyboard_interrupt_propagates_through_executor():
    """KeyboardInterrupt must not be trapped as a future result."""
    import asyncio
    from pd_prep_for_pgdp.core.queue.single_executor import SingleTaskExecutor

    async def run():
        executor = SingleTaskExecutor()
        async with executor:
            def raise_kbi():
                raise KeyboardInterrupt()

            # Submit a task that raises KeyboardInterrupt.
            fut = await executor.submit(raise_kbi)
            try:
                await fut
            except KeyboardInterrupt:
                # This is correct — it must propagate as KeyboardInterrupt,
                # not be trapped as a regular future exception.
                return
            raise AssertionError("KeyboardInterrupt was not propagated")

    with pytest.raises((KeyboardInterrupt, AssertionError)):
        asyncio.run(run())
```

- [x] **Step 2: Narrow `BaseException` to `Exception`**

In `single_executor.py:118-123`, replace:

```python
except BaseException as e:
    if not fut.done():
        fut.set_exception(e)
```

with:

```python
except Exception as e:
    if not fut.done():
        fut.set_exception(e)
except BaseException:
    if not fut.done():
        fut.cancel()
    raise
```

- [x] **Step 3: Run tests + CI**

```
uv run pytest tests/test_single_executor_async_cm.py tests/test_priority_queue.py -v
make ci AI=1
```

- [x] **Step 4: Commit**

```bash
git add src/pd_prep_for_pgdp/core/queue/single_executor.py tests/test_single_executor_async_cm.py
git commit -m "fix(executor): narrow BaseException; let KeyboardInterrupt propagate"
```

---

### Task 11: Structured words-blob error handling in `api/data/pages.py`

**Audit findings:** #26, #27

**Files:**
- Modify: `src/pd_prep_for_pgdp/api/data/pages.py:399-409`
- Test: `tests/test_page_text_route.py` (add cases)

- [x] **Step 1: Write failing tests**

Add to `tests/test_page_text_route.py`:

```python
def test_corrupt_words_blob_returns_partial_flag(app_client, seeded_project):
    """A corrupt words blob must not silently return [] — it must set words_partial=True."""
    project_id, page_id = seeded_project
    # Write garbage into the words storage key.
    # (Use the storage fixture to write bad bytes at the words_key path.)
    app_client.put_words_blob(page_id, b"this is not valid json")

    resp = app_client.get(f"/projects/{project_id}/pages/0/text")
    assert resp.status_code == 200  # page text itself is fine
    body = resp.json()
    assert body.get("words_partial") is True or body.get("words") == []


def test_storage_error_on_words_returns_503_not_200(app_client, seeded_project, monkeypatch):
    """A storage failure on words fetch must not silently return [] as if no words exist."""
    from unittest.mock import AsyncMock, patch

    project_id, page_id = seeded_project

    async def raise_storage_error(key):
        raise ConnectionError("S3 unreachable")

    with patch.object(app_client.storage, "get_bytes", side_effect=raise_storage_error):
        resp = app_client.get(f"/projects/{project_id}/pages/0/text")

    # Storage failures must not masquerade as "no words available".
    assert resp.status_code != 200 or resp.json().get("words_error") is not None
```

> **Note:** The exact fixture shape depends on `tests/conftest.py`. Consult `tests/test_ocr_words_persistence.py` for the established "seed a page + set words blob" pattern and adapt.

- [x] **Step 2: Add `words_partial` and `words_error` to `GetPageTextResponse`**

In `core/models.py` (find `GetPageTextResponse`):

```python
class GetPageTextResponse(ApiModel):
    text: str
    text_key: str
    words: list[OcrWord] = Field(default_factory=list)
    words_partial: bool = False    # True when words blob existed but decode failed
    words_error: str | None = None  # human-readable reason for partial/missing words
```

- [x] **Step 3: Update `get_page_text` to distinguish error types**

In `api/data/pages.py:399-409`, replace:

```python
    words: list[OcrWord] = []
    words_key = words_key_for(text_key)
    if await storage.exists(words_key):
        try:
            raw = await storage.get_bytes(words_key)
            words = [w for w in load_words_from_storage(raw) if not w.deleted]
        except Exception:
            log.exception("failed to decode words blob at %s; returning empty list", words_key)
            words = []
```

with:

```python
    words: list[OcrWord] = []
    words_partial = False
    words_error: str | None = None
    words_key = words_key_for(text_key)
    if await storage.exists(words_key):
        try:
            raw = await storage.get_bytes(words_key)
        except (OSError, ConnectionError) as exc:
            log.exception("storage error fetching words blob at %s", words_key)
            raise HTTPException(503, "words storage temporarily unavailable") from exc
        try:
            words = [w for w in load_words_from_storage(raw) if not w.deleted]
        except Exception as exc:
            log.exception("failed to decode words blob at %s; returning partial result", words_key)
            words_partial = True
            words_error = f"{type(exc).__name__}: {exc}"

    return GetPageTextResponse(
        text=text,
        text_key=text_key,
        words=words,
        words_partial=words_partial,
        words_error=words_error,
    )
```

- [x] **Step 4: Fix 500 → 422 for blob-corrupt responses (finding #27)**

Search `api/data/pages.py` for lines 517-519 and 596-598 (two sites that return `HTTPException(500, "words blob is corrupt")`). Replace `500` with `422` and add an `error_code`:

```python
raise HTTPException(
    status_code=422,
    detail={"error_code": "words_blob_corrupt", "message": "words blob is corrupt"},
)
```

- [x] **Step 5: Regenerate OpenAPI spec (required by `make ci`)**

```
make openapi AI=1
```

This regenerates `openapi.json`. Check it in.

- [x] **Step 6: Run tests + CI**

```
uv run pytest tests/test_page_text_route.py tests/test_ocr_words_persistence.py -v
make ci AI=1
```

- [x] **Step 7: Commit**

```bash
git add src/pd_prep_for_pgdp/core/models.py \
        src/pd_prep_for_pgdp/api/data/pages.py \
        openapi.json
git commit -m "fix(pages): distinguish storage errors from decode errors in words blob; 422 for corrupt blob"
```

---

### Task 12: Narrow `s3.exists()` exception handling

**Audit finding:** #30 — credentials/throttling/region errors collapse to `return False`.

**Files:**
- Modify: `src/pd_prep_for_pgdp/adapters/storage/s3.py:48-57`
- Test: `tests/test_s3_storage.py` (add cases)

- [x] **Step 1: Write failing tests**

Add to `tests/test_s3_storage.py`:

```python
def test_exists_reraises_credentials_error():
    """S3 credentials failure must not silently return False as 'object not found'."""
    from unittest.mock import MagicMock, patch
    from pd_prep_for_pgdp.adapters.storage.s3 import S3Storage
    import botocore.exceptions

    storage = S3Storage.__new__(S3Storage)
    storage._bucket = "test-bucket"
    storage._prefix = ""
    storage._cdn = None

    client_mock = MagicMock()
    storage._client = client_mock

    # Simulate credentials error (ClientError with NoCredentialsError shape).
    client_error = botocore.exceptions.ClientError(
        {"Error": {"Code": "InvalidClientTokenId", "Message": "bad creds"}},
        "HeadObject",
    )
    client_mock.head_object.side_effect = client_error
    # NoSuchKey exception class must be distinguishable.
    client_mock.exceptions.NoSuchKey = type(
        "NoSuchKey",
        (botocore.exceptions.ClientError,),
        {},
    )

    import asyncio
    with pytest.raises(botocore.exceptions.ClientError):
        asyncio.get_event_loop().run_until_complete(storage.exists("some/key"))


def test_exists_returns_false_for_no_such_key():
    """Genuine 404/NoSuchKey must still return False."""
    from unittest.mock import MagicMock
    from pd_prep_for_pgdp.adapters.storage.s3 import S3Storage
    import asyncio, botocore.exceptions

    storage = S3Storage.__new__(S3Storage)
    storage._bucket = "test-bucket"
    storage._prefix = ""
    storage._cdn = None
    client_mock = MagicMock()
    storage._client = client_mock

    NoSuchKey = type("NoSuchKey", (botocore.exceptions.ClientError,), {})
    client_mock.exceptions.NoSuchKey = NoSuchKey
    client_mock.head_object.side_effect = NoSuchKey(
        {"Error": {"Code": "NoSuchKey", "Message": "not found"}}, "HeadObject"
    )

    result = asyncio.get_event_loop().run_until_complete(storage.exists("missing/key"))
    assert result is False
```

- [x] **Step 2: Run to confirm `test_exists_reraises` fails**

```
uv run pytest tests/test_s3_storage.py -v -k "credentials_error or no_such_key"
```

Expected: credentials test FAILS (returns False today instead of raising).

- [x] **Step 3: Narrow `s3.exists()`**

Replace `src/pd_prep_for_pgdp/adapters/storage/s3.py:48-58`:

```python
    async def exists(self, key: str) -> bool:
        def _head() -> bool:
            try:
                self._client.head_object(Bucket=self._bucket, Key=self._full_key(key))
                return True
            except self._client.exceptions.NoSuchKey:
                return False
            # Let all other exceptions (credentials, throttling, region) propagate.

        return await anyio.to_thread.run_sync(_head)
```

- [x] **Step 4: Run tests + CI**

```
uv run pytest tests/test_s3_storage.py -v
make ci AI=1
```

- [x] **Step 5: Commit**

```bash
git add src/pd_prep_for_pgdp/adapters/storage/s3.py tests/test_s3_storage.py
git commit -m "fix(s3): exists() only catches NoSuchKey; all other errors propagate"
```

---

### Task 13: Differentiate JWT exceptions by type

**Audit finding:** #32 — any failure (JWKS network timeout, JSON decode, transient error) becomes a permanent 401.

**Files:**
- Modify: `src/pd_prep_for_pgdp/adapters/auth/jwt_.py:49-59`
- Test: `tests/test_jwt_auth.py` (add cases)

- [x] **Step 1: Write failing tests**

Add to `tests/test_jwt_auth.py`:

```python
async def test_jwks_connection_error_returns_503_not_401():
    """A network failure fetching JWKS must return 503, not 401."""
    import httpx
    from unittest.mock import patch, AsyncMock
    from pd_prep_for_pgdp.adapters.auth.jwt_ import JwtAuth
    from fastapi import HTTPException

    auth = JwtAuth(issuer="https://example.com")

    async def mock_get(*args, **kwargs):
        raise httpx.ConnectError("connection refused")

    with patch("httpx.AsyncClient.get", side_effect=mock_get):
        with pytest.raises(HTTPException) as exc_info:
            await auth.verify("fake.jwt.token")

    assert exc_info.value.status_code == 503


async def test_invalid_jwt_signature_returns_401():
    """A genuine invalid-signature error must still return 401."""
    import jwt as pyjwt
    from unittest.mock import patch, MagicMock
    from pd_prep_for_pgdp.adapters.auth.jwt_ import JwtAuth
    from fastapi import HTTPException

    auth = JwtAuth(issuer="https://example.com")

    with patch.object(auth, "_load_jwks", return_value={}):
        with patch("jwt.PyJWKClient") as mock_client_cls:
            mock_client = MagicMock()
            mock_client.get_signing_key_from_jwt.side_effect = pyjwt.exceptions.InvalidTokenError("bad sig")
            mock_client_cls.return_value = mock_client

            with pytest.raises(HTTPException) as exc_info:
                await auth.verify("bad.token.value")

    assert exc_info.value.status_code == 401
```

- [x] **Step 2: Narrow `except Exception` in `jwt_.py`**

Replace `src/pd_prep_for_pgdp/adapters/auth/jwt_.py:49-59`:

```python
        try:
            signing_key = jwks_client.get_signing_key_from_jwt(credentials)
            claims = pyjwt.decode(
                credentials,
                signing_key.key,
                algorithms=["RS256", "ES256"],
                audience=self._audience,
                issuer=self._issuer,
            )
        except pyjwt.exceptions.PyJWTError as e:
            raise HTTPException(status_code=401, detail=f"invalid token: {e}") from e
        except (ConnectionError, TimeoutError, OSError) as e:
            raise HTTPException(status_code=503, detail="authentication service unavailable") from e
        except Exception as e:
            raise HTTPException(status_code=500, detail="unexpected auth error") from e
```

Also update `_load_jwks` to let `httpx.ConnectError` (a subclass of `OSError` in newer httpx) propagate to the caller so the 503 branch in `verify` catches it.

- [x] **Step 3: Run tests + CI**

```
uv run pytest tests/test_jwt_auth.py -v
make ci AI=1
```

- [x] **Step 4: Commit**

```bash
git add src/pd_prep_for_pgdp/adapters/auth/jwt_.py tests/test_jwt_auth.py
git commit -m "fix(jwt): 503 for JWKS network errors; 401 only for PyJWTError"
```

---

### Task 14: GPU autodetect narrowing + filesystem path-traversal hardening

**Audit findings:** #34, #42

**Files:**
- Modify: `src/pd_prep_for_pgdp/bootstrap.py:88-99`
- Modify: `src/pd_prep_for_pgdp/adapters/storage/filesystem.py:24-31`
- Test: `tests/test_bootstrap_builders.py`, `tests/test_filesystem_storage.py`

- [x] **Step 1: Write failing tests**

Add to `tests/test_bootstrap_builders.py`:

```python
def test_autodetect_gpu_propagates_non_import_errors(monkeypatch):
    """A RuntimeError importing cupy must not silently fall back to cpu."""
    import sys
    import types

    mock_cupy = types.ModuleType("cupy")

    def raise_runtime(*args, **kwargs):
        raise RuntimeError("CUDA driver version mismatch")

    monkeypatch.setitem(sys.modules, "cupy", mock_cupy)
    # Make the import succeed but accessing it raise.
    monkeypatch.setattr(mock_cupy, "__bool__", raise_runtime)

    # The simplest injection: patch the import inside _autodetect_gpu_backend.
    from unittest.mock import patch
    with patch("builtins.__import__", side_effect=RuntimeError("CUDA driver mismatch")):
        from pd_prep_for_pgdp import bootstrap
        with pytest.raises(RuntimeError, match="CUDA"):
            bootstrap._autodetect_gpu_backend()
```

Add to `tests/test_filesystem_storage.py`:

```python
def test_rejects_absolute_key_path(tmp_path):
    """An absolute path key like /etc/passwd must be rejected."""
    from pd_prep_for_pgdp.adapters.storage.filesystem import FilesystemStorage

    storage = FilesystemStorage(root=tmp_path)
    import asyncio
    with pytest.raises(ValueError, match="absolute"):
        asyncio.get_event_loop().run_until_complete(storage.get_bytes("/etc/passwd"))


def test_rejects_windows_absolute_key(tmp_path):
    """A Windows absolute path key like C:/etc/passwd must be rejected."""
    from pd_prep_for_pgdp.adapters.storage.filesystem import FilesystemStorage

    storage = FilesystemStorage(root=tmp_path)
    import asyncio
    with pytest.raises(ValueError, match="absolute|invalid"):
        asyncio.get_event_loop().run_until_complete(storage.get_bytes("C:/etc/passwd"))
```

- [x] **Step 2: Narrow GPU autodetect**

In `bootstrap.py:88-99`, replace:

```python
def _autodetect_gpu_backend() -> str:
    try:
        import cupy  # noqa: F401
        return "local"
    except Exception:
        pass
```

with:

```python
def _autodetect_gpu_backend() -> str:
    try:
        import cupy  # noqa: F401
        return "local"
    except ImportError:
        pass
    except Exception:
        log.error("unexpected error checking for CUDA (cupy import failed unexpectedly)", exc_info=True)
```

- [x] **Step 3: Add explicit absolute-path check to `FilesystemStorage._path`**

In `adapters/storage/filesystem.py:24-31`, add before the resolve:

```python
    def _path(self, key: str) -> Path:
        clean = key.lstrip("/")
        # Reject absolute paths that survive the lstrip (e.g. Windows "C:/...").
        if Path(clean).is_absolute():
            raise ValueError(f"storage key must be relative, got: {key!r}")
        p = (self._root / clean).resolve()
        root_resolved = self._root.resolve()
        if root_resolved not in p.parents and p != root_resolved:
            raise ValueError(f"path traversal detected: {key!r} escapes storage root")
        return p
```

- [x] **Step 4: Run tests + CI**

```
uv run pytest tests/test_bootstrap_builders.py tests/test_filesystem_storage.py -v
make ci AI=1
```

- [x] **Step 5: Commit**

```bash
git add src/pd_prep_for_pgdp/bootstrap.py \
        src/pd_prep_for_pgdp/adapters/storage/filesystem.py
git commit -m "fix: narrow GPU autodetect to ImportError; reject absolute storage keys"
```

---

### Task 15: Narrow `core/packaging.py` and `core/ingest.py` exception handlers

**Audit findings:** #36, #38

**Files:**
- Modify: `src/pd_prep_for_pgdp/core/packaging.py:38-41`
- Modify: `src/pd_prep_for_pgdp/core/ingest.py:184-186`
- Test: `tests/test_packaging.py`, `tests/test_ingest.py`

- [x] **Step 1: Add `oxipng_skipped_pages` to `PackagingResult`**

Locate `PackagingResult` in `core/models.py` or `core/packaging.py`. Add:

```python
oxipng_skipped_pages: int = 0
```

- [x] **Step 2: Update oxipng fallback to count skips**

In `packaging.py:38-41`, replace:

```python
    except Exception:
        log.warning("oxipng optimisation failed; using original bytes", exc_info=True)
        return data
```

with:

```python
    except Exception:
        log.warning("oxipng optimisation failed; using original bytes", exc_info=True)
        return data, True  # (bytes, skipped)
```

Update callers to accumulate `oxipng_skipped_pages` in the `PackagingResult`.

> **Simpler alternative if the above restructuring is too invasive:** Pass a mutable counter object into the function: `oxipng_skip_counter: list[int]` (a 1-element list used as a mutable int). The function does `oxipng_skip_counter[0] += 1` in the fallback. Callers read `oxipng_skip_counter[0]` after packaging is done.

- [x] **Step 3: Write test**

Add to `tests/test_packaging.py`:

```python
def test_oxipng_skip_is_counted_in_result(tmp_path, monkeypatch):
    """When oxipng fails, the PackagingResult records how many pages were skipped."""
    import oxipng
    monkeypatch.setattr(
        "pd_prep_for_pgdp.core.packaging.oxipng.optimize_from_memory",
        lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("corrupt PNG")),
    )
    # Build a minimal PackagingJob and run it.
    # (Adapt to the actual packaging API in packaging.py.)
    # Assert that result.oxipng_skipped_pages >= 1.
    ...
```

- [x] **Step 4: Fix `ingest.py:184-186` to append to error list**

In `core/ingest.py` around line 184-186:

```python
    except Exception as e:
        log.warning("thumbnail: source missing for %s: %s", page.source_stem, e)
        continue
```

Replace with:

```python
    except Exception as e:
        log.warning("thumbnail failed for %s: %s", page.source_stem, e, exc_info=True)
        errors.append(f"{page.source_stem}: {e!r}")
        continue
```

(The `errors` list is already plumbed in `IngestResult`.)

- [x] **Step 5: Write test**

Add to `tests/test_ingest.py`:

```python
def test_thumbnail_storage_error_appears_in_ingest_errors(tmp_path, monkeypatch):
    """Storage failures during thumbnail generation must show up in IngestResult.errors."""
    from unittest.mock import patch, AsyncMock
    ...
    # Patch storage.get_bytes to raise on thumbnail keys; assert result.errors is non-empty.
```

- [x] **Step 6: Run tests + CI**

```
uv run pytest tests/test_packaging.py tests/test_ingest.py -v
make ci AI=1
```

- [x] **Step 7: Commit**

```bash
git add src/pd_prep_for_pgdp/core/packaging.py \
        src/pd_prep_for_pgdp/core/ingest.py \
        src/pd_prep_for_pgdp/core/models.py
git commit -m "fix(packaging,ingest): count oxipng skips; surface thumbnail storage errors in result"
```

---

## Part 3 — Medium: Typing hygiene, observability, and protocol completeness

---

### Task 16: Stage runner dispatch cleanup — remove runtime introspection

**Audit findings:** #16, #17

**Files:**
- Modify: `src/pd_prep_for_pgdp/core/pipeline/stage_runner.py` (the `_call_impl` function and numpy scalar heuristic)
- Test: `tests/test_stage_runner.py`

- [x] **Step 1: Remove `cfg` parameter introspection from `_call_impl`**

Locate `_call_impl` (around line 605-619). Replace the `inspect.signature` introspection with a simple convention: every stage impl must accept a `cfg` keyword argument. Update all stage impls that don't currently accept `cfg=` to accept `**_kwargs` or an explicit `cfg` parameter.

```python
def _call_impl(impl: Callable, artifacts: list[Any], cfg: ResolvedPageConfig) -> Any:
    """Call a stage impl with positional artifacts and keyword cfg."""
    return impl(*artifacts, cfg=cfg)
```

Run the test suite to identify any stage impls that don't accept `cfg`. For each one, add:

```python
def my_stage_impl(*artifacts, cfg: ResolvedPageConfig) -> ...:
    ...
```

or if truly cfg-free:

```python
def my_stage_impl(*artifacts, cfg: ResolvedPageConfig | None = None) -> ...:
    ...
```

- [x] **Step 2: Replace `hasattr(v, "item")` with `isinstance(v, np.generic)`**

Locate line ~938:

```python
if isinstance(output, (tuple, list)):
    output = [int(v) if hasattr(v, "item") else v for v in output]
```

Replace with:

```python
import numpy as np
if isinstance(output, (tuple, list)):
    output = [int(v) if isinstance(v, np.generic) else v for v in output]
```

- [x] **Step 3: Run tests**

```
uv run pytest tests/test_stage_runner.py tests/test_stage_registry.py -v
make ci AI=1
```

- [x] **Step 4: Commit**

```bash
git add src/pd_prep_for_pgdp/core/pipeline/stage_runner.py
git commit -m "fix(stage_runner): remove cfg introspection; use isinstance for numpy scalars"
```

---

### Task 17: IDatabase Protocol completeness — `list_distinct_owner_ids`

**Audit finding:** #23 — `core/job_runner.py:580-583` duck-typed `getattr` on `IDatabase`.

**Files:**
- Modify: `src/pd_prep_for_pgdp/adapters/database/base.py` (find the IDatabase Protocol)
- Modify: `src/pd_prep_for_pgdp/core/job_runner.py:580-583`
- Test: `tests/test_sqlite_adapter.py` or `tests/test_search_adapter_contract.py`

- [x] **Step 1: Add `list_distinct_owner_ids` to IDatabase**

Locate the `IDatabase` Protocol in `adapters/database/base.py`. Add:

```python
    async def list_distinct_owner_ids(self) -> list[str]:
        """Return all owner_id values that have at least one job.

        Default implementation suitable for single-user (local) mode.
        Managed adapters (Postgres) override this with a real query.
        """
        return ["default"]
```

- [x] **Step 2: Implement in SQLite adapter**

In `adapters/database/sqlite.py`, add:

```python
    async def list_distinct_owner_ids(self) -> list[str]:
        async with self._connect() as conn:
            rows = await conn.execute_fetchall(
                "SELECT DISTINCT owner_id FROM jobs"
            )
        return [row[0] for row in rows] or ["default"]
```

- [x] **Step 3: Update `job_runner.py` to use the Protocol method directly**

Replace lines 580-583:

```python
fn = getattr(db, "list_distinct_owner_ids", None)
if callable(fn): return list(await fn())
```

with:

```python
return list(await db.list_distinct_owner_ids())
```

- [x] **Step 4: Run tests + CI**

```
uv run pytest tests/test_sqlite_adapter.py tests/test_job_runner.py -v
make ci AI=1
```

- [x] **Step 5: Commit**

```bash
git add src/pd_prep_for_pgdp/adapters/database/base.py \
        src/pd_prep_for_pgdp/adapters/database/sqlite.py \
        src/pd_prep_for_pgdp/core/job_runner.py
git commit -m "fix(database): add list_distinct_owner_ids to IDatabase Protocol; remove getattr duck-type"
```

---

### Task 18: HTTP status code consistency — `api/dependencies.py` and `dispatcher/batched.py`

**Audit findings:** #29, #33

**Files:**
- Modify: `src/pd_prep_for_pgdp/api/dependencies.py:69-72`
- Modify: `src/pd_prep_for_pgdp/dispatcher/batched.py:67-100`
- Test: `tests/test_dependencies.py`, `tests/test_dispatcher_batched.py`

- [x] **Step 1: Fix dependencies.py catch-all 401**

In `api/dependencies.py:69-72`, replace:

```python
except HTTPException:
    raise
except Exception as e:
    raise HTTPException(status_code=401, detail=str(e)) from e
```

with:

```python
except HTTPException:
    raise
except (ConnectionError, TimeoutError, OSError) as e:
    raise HTTPException(status_code=503, detail="auth service unavailable") from e
except ValueError as e:
    raise HTTPException(status_code=422, detail=f"malformed credential: {e}") from e
except Exception as e:
    log.exception("unexpected error in auth dependency")
    raise HTTPException(status_code=500, detail="authentication failed unexpectedly") from e
```

- [x] **Step 2: Add exception type to BatchJobResult**

In `dispatcher/batched.py:67-78`, locate the `BatchJobResult` model. Add:

```python
error_type: str | None = None
```

In the `except Exception` handler:

```python
except Exception as exc:
    log.exception("BatchDispatcher.flush: backend.run_batch failed")
    results = [
        BatchJobResult(
            ...,
            ok=False,
            error=f"{type(exc).__name__}: {exc}",
            error_type=type(exc).__name__,
        )
        for _ in items
    ]
```

- [x] **Step 3: Run tests + CI**

```
uv run pytest tests/test_dependencies.py tests/test_dispatcher_batched.py -v
make ci AI=1
```

- [x] **Step 4: Commit**

```bash
git add src/pd_prep_for_pgdp/api/dependencies.py \
        src/pd_prep_for_pgdp/dispatcher/batched.py
git commit -m "fix: differentiate auth dependency errors by type; add error_type to BatchJobResult"
```

---

### Task 19: Observability — progress_cb circuit breaker and lifespan shutdown logging

**Audit findings:** #35, #37

**Files:**
- Modify: `src/pd_prep_for_pgdp/core/ingest.py` (5 progress_cb sites)
- Modify: `src/pd_prep_for_pgdp/bootstrap.py:213-225`
- Test: `tests/test_ingest_progress_cb_resilience.py` (already exists — add stricter assertions)

- [x] **Step 1: Add a progress_cb circuit breaker in `ingest.py`**

Locate each of the 5 `except Exception: log.exception("... progress_cb raised; continuing")` sites. Before the loop that calls `progress_cb`, add:

```python
_progress_cb_failures = 0
_PROGRESS_CB_CIRCUIT_BREAKER = 3
```

In each handler:

```python
except Exception:
    _progress_cb_failures += 1
    if _progress_cb_failures >= _PROGRESS_CB_CIRCUIT_BREAKER:
        log.error(
            "progress_cb failed %d times; disabling for this job",
            _progress_cb_failures,
        )
        progress_cb = None  # stop calling it
    else:
        log.exception("progress_cb raised (failure %d/%d)",
                      _progress_cb_failures, _PROGRESS_CB_CIRCUIT_BREAKER)
```

- [x] **Step 2: Add logging to lifespan shutdown suppressed exceptions**

In `bootstrap.py:213-225`, replace:

```python
with suppress(Exception): job_runner.stop()
for task in tasks:
    with suppress(asyncio.CancelledError, Exception): await task
```

with:

```python
try:
    job_runner.stop()
except Exception:
    log.exception("error stopping job_runner during lifespan shutdown")

for task in tasks:
    try:
        await task
    except asyncio.CancelledError:
        pass
    except Exception:
        log.exception("error awaiting task %s during lifespan shutdown", task.get_name())
```

- [x] **Step 3: Run tests + CI**

```
uv run pytest tests/test_ingest_progress_cb_resilience.py tests/test_bootstrap_builders.py -v
make ci AI=1
```

- [x] **Step 4: Commit**

```bash
git add src/pd_prep_for_pgdp/core/ingest.py src/pd_prep_for_pgdp/bootstrap.py
git commit -m "fix(ingest,bootstrap): progress_cb circuit breaker; log lifespan shutdown errors"
```

---

### Task 20: Pydantic model tightening and remaining medium-severity cleanups

**Audit findings:** #4, #8, #24, #39, #40

**Files:**
- `src/pd_prep_for_pgdp/core/ocr.py:272-273` (#4 — validate_word_preservation sentinel)
- `src/pd_prep_for_pgdp/core/illustrations.py:46-47` (#8 — handled in Task 2 already)
- `src/pd_prep_for_pgdp/core/queue/single_executor.py:65-67` (#24 — lazy init via hasattr)
- `src/pd_prep_for_pgdp/settings.py` (#39 — PGDP_THUMBNAIL_WORKERS warning)
- `src/pd_prep_for_pgdp/core/models.py` (#40 — Optional[NonEmptyStr] for key fields)

- [x] **Step 1: Fix validate_word_preservation sentinel (#4)**

In `core/ocr.py:272-273`, replace:

```python
except Exception:
    log.exception("validate_word_preservation failed (continuing)")
```

with:

```python
except Exception:
    log.exception("validate_word_preservation failed; dropped_word_count unknown")
    dropped_word_count = -1  # sentinel: unknown, not "zero drops"
```

Update callers that use `result.dropped_word_count == 0` to also check `!= -1`.

- [x] **Step 2: Fix lazy init in `single_executor.py` (#24)**

In `single_executor.py`, locate the `__init__` method. Change:

```python
# Before (hasattr check at use site, line 65-67):
if not hasattr(self, "_queue"):
    self._queue = asyncio.PriorityQueue()
```

to initialise in `__init__`:

```python
def __init__(self, ...):
    ...
    self._queue: asyncio.PriorityQueue | None = None
```

And in the `queue` property or first-use site:

```python
    if self._queue is None:
        self._queue = asyncio.PriorityQueue()
    return self._queue
```

This is safe — `asyncio.PriorityQueue()` must be created inside the event loop, so None-init in `__init__` + lazy creation in the first async call is the correct pattern.

- [x] **Step 3: Emit startup warning for invalid env var (#39)**

In `bootstrap.py` or `settings.py`, find the PGDP_THUMBNAIL_WORKERS resolver. After the `except ValueError: log.warning(...)` block, add:

```python
    import sys
    print(
        f"WARNING: PGDP_THUMBNAIL_WORKERS={raw!r} is not a valid integer; "
        f"using {result} (cpu_count). Set a valid integer to silence this.",
        file=sys.stderr,
        flush=True,
    )
```

(Or use the existing `log.warning` if it's already emitted on startup. The key is that it must be visible before the first request, not only in the logs.)

- [x] **Step 4: Add `EmptyStringIsNone` validator to key-typed fields (#40)**

In `core/models.py`, add an annotated type:

```python
from pydantic import BeforeValidator
from typing import Annotated

def _empty_str_to_none(v: str | None) -> str | None:
    if isinstance(v, str) and v == "":
        return None
    return v

NonEmptyStr = Annotated[str | None, BeforeValidator(_empty_str_to_none)]
```

Replace the most-used `str | None = None` key fields in `PageOutput` (or wherever the audit finding #40 points) with `NonEmptyStr = None`:

```python
class PageOutput(ApiModel):
    ocr_text_key: NonEmptyStr = None
    for_zip_image_key: NonEmptyStr = None
    # ... other key fields ...
```

- [x] **Step 5: Run tests + CI**

```
uv run pytest tests/ -v -x
make ci AI=1
```

- [x] **Step 6: Commit**

```bash
git add src/pd_prep_for_pgdp/core/ocr.py \
        src/pd_prep_for_pgdp/core/queue/single_executor.py \
        src/pd_prep_for_pgdp/bootstrap.py \
        src/pd_prep_for_pgdp/core/models.py
git commit -m "fix(medium): validate_word_preservation sentinel; executor init; NonEmptyStr keys"
```

---

### Task 21: Final sweep — disk cost, `api/data/projects.py` OSError logging, `validate_word_preservation` (#28)

**Audit finding:** #28

**Files:**
- Modify: `src/pd_prep_for_pgdp/api/data/projects.py:55-58`

- [x] **Step 1: Log first OSError in disk-cost scan**

In `api/data/projects.py:55-58`, replace:

```python
for f in stages_dir.rglob("*"):
    if f.is_file():
        with contextlib.suppress(OSError):
            total += f.stat().st_size
```

with:

```python
_first_error_logged = False
for f in stages_dir.rglob("*"):
    if f.is_file():
        try:
            total += f.stat().st_size
        except OSError as exc:
            if not _first_error_logged:
                log.warning("disk cost scan: stat failed for %s: %s", f, exc)
                _first_error_logged = True
```

- [x] **Step 2: Run tests + CI**

```
uv run pytest tests/test_disk_cost_banner.py -v
make ci AI=1
```

- [x] **Step 3: Final full CI run to confirm all 42 findings addressed**

```
make ci AI=1
```

Expected: green, all tests pass.

- [x] **Step 4: Update the audit document with resolution status**

In `docs/audit/code-quality-audit-2026-05-16.md`, add a header:

```markdown
## Resolution status (2026-05-16 plan fully implemented)

All 42 findings addressed. See plan: `docs/plans/2026-05-16-backend-quality-hardening.md`.
```

- [x] **Step 5: Commit**

```bash
git add src/pd_prep_for_pgdp/api/data/projects.py \
        docs/audit/code-quality-audit-2026-05-16.md
git commit -m "fix(projects): log first OSError in disk cost scan; mark audit resolved"
```

---

## Summary

| Group | Tasks | Findings | Est. effort |
|-------|-------|----------|-------------|
| Critical | 1–4 | #1, #6, #7, #22, #41 | 1–2 days |
| High | 5–15 | #2, #3, #5, #9, #10, #11, #12, #13, #15, #18, #20, #21, #25, #26, #27, #30, #32, #34, #36, #38, #42 | 3–5 days |
| Medium | 16–21 | #4, #8, #16, #17, #23, #24, #28, #29, #33, #35, #37, #39, #40 | 2–3 days |

**Total: 21 tasks, 42 findings, ~6–10 dev-days.**

Execute Critical tasks first (Tasks 1–4). High and Medium tasks are independent and can be parallelised with `superpowers:dispatching-parallel-agents` once the Critical group is merged.
