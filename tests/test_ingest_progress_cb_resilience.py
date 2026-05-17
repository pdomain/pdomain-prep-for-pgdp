"""Lock in defensive paths in `core.ingest`:

- `unzip_source` swallows a raising `progress_cb` and keeps going (the
  job runner shouldn't be killed by a UI-side reporting bug),
- `generate_thumbnails` swallows a raising `progress_cb` likewise,
- `generate_thumbnails` skips pages that already have a thumbnail and
  pages with no `source_key`,
- `generate_thumbnails` returns 0 + advances pipeline state when there
  are no pages to thumbnail (the early-return at total==0),
- `generate_thumbnails` skips pages whose `source_key` is missing on
  storage (the get_bytes try/except).
"""

from __future__ import annotations

import io
import zipfile
from datetime import UTC, datetime

import numpy as np
import pytest

from pd_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pd_prep_for_pgdp.adapters.storage.filesystem import FilesystemStorage
from pd_prep_for_pgdp.core.ingest import generate_thumbnails, unzip_source
from pd_prep_for_pgdp.core.models import (
    PageRecord,
    PipelineState,
    Project,
    ProjectConfig,
    ProjectStatus,
)


def _png(h: int, w: int) -> bytes:
    cv2 = pytest.importorskip("cv2")
    img = np.full((h, w, 3), 200, dtype=np.uint8)
    ok, buf = cv2.imencode(".png", img)
    assert ok
    return bytes(buf.tobytes())


def _zip(entries: list[tuple[str, bytes]]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, data in entries:
            zf.writestr(name, data)
    return buf.getvalue()


@pytest.fixture
async def db(tmp_path) -> SqliteDatabase:
    d = SqliteDatabase(f"sqlite:///{(tmp_path / 's.db').as_posix()}")
    await d.initialize()
    return d


@pytest.fixture
def storage(tmp_path) -> FilesystemStorage:
    return FilesystemStorage(root=tmp_path / "data")


def _project() -> Project:
    now = datetime.now(UTC)
    return Project(
        id="ip1",
        owner_id="default",
        name="t",
        created_at=now,
        updated_at=now,
        status=ProjectStatus.ingesting,
        page_count=0,
        proof_page_count=0,
        config=ProjectConfig(book_name="t", source_uri=""),
        pipeline_state=PipelineState(),
        storage_prefix="projects/ip1/",
    )


@pytest.mark.asyncio
async def test_unzip_swallows_raising_progress_cb(db, storage) -> None:
    pytest.importorskip("cv2")
    project = _project()
    await db.put_project(project)
    src_key = "projects/ip1/source.zip"
    await storage.put_bytes(src_key, _zip([("p1.png", _png(50, 50)), ("p2.png", _png(50, 50))]))

    async def boom(_c, _t, _s):
        raise RuntimeError("UI-side reporting failure")

    result = await unzip_source(
        project=project,
        source_type="zip",
        source_key=src_key,
        storage=storage,
        database=db,
        progress_cb=boom,
    )
    # Pages were still ingested despite progress_cb raising.
    assert result.page_count == 2


@pytest.mark.asyncio
async def test_thumbnails_swallows_raising_progress_cb(db, storage) -> None:
    pytest.importorskip("cv2")
    project = _project()
    await db.put_project(project)
    src_key = "projects/ip1/source.zip"
    await storage.put_bytes(src_key, _zip([("p1.png", _png(50, 50))]))
    await unzip_source(project=project, source_type="zip", source_key=src_key, storage=storage, database=db)
    refreshed = await db.get_project(project.id)
    assert refreshed is not None

    async def boom(_c, _t, _s):
        raise RuntimeError("UI-side reporting failure")

    result = await generate_thumbnails(project=refreshed, storage=storage, database=db, progress_cb=boom)
    assert result.page_count == 1


@pytest.mark.asyncio
async def test_thumbnails_skips_pages_already_thumbed(db, storage) -> None:
    """If a page already has thumbnail_key, the regenerate run should leave
    it alone (the `if page.thumbnail_key: continue` branch)."""
    pytest.importorskip("cv2")
    project = _project()
    await db.put_project(project)
    # Pre-thumbnail a page; no source_key needed.
    page = PageRecord(
        project_id=project.id,
        idx0=0,
        prefix="p001",
        source_stem="src1",
        thumbnail_key="projects/ip1/thumbnails/src1.jpg",  # already set
    )
    await db.put_pages([page])

    result = await generate_thumbnails(project=project, storage=storage, database=db)
    # No new thumbnails generated — early-return path.
    assert result.page_count == 0


@pytest.mark.asyncio
async def test_thumbnails_skips_pages_with_no_source_key(db, storage) -> None:
    """A page without source_key (defensive, shouldn't normally happen) is
    silently skipped — handler doesn't crash."""
    project = _project()
    await db.put_project(project)
    page = PageRecord(
        project_id=project.id,
        idx0=0,
        prefix="p001",
        source_stem="src1",
        # source_key intentionally None
    )
    await db.put_pages([page])

    result = await generate_thumbnails(project=project, storage=storage, database=db)
    assert result.page_count == 0


@pytest.mark.asyncio
async def test_thumbnails_skips_missing_source_on_storage(db, storage) -> None:
    """Page references a source_key that isn't on storage — log and skip."""
    project = _project()
    await db.put_project(project)
    page = PageRecord(
        project_id=project.id,
        idx0=0,
        prefix="p001",
        source_stem="src1",
        source_key="projects/ip1/source/never_uploaded.png",
    )
    await db.put_pages([page])

    result = await generate_thumbnails(project=project, storage=storage, database=db)
    assert result.page_count == 0


@pytest.mark.asyncio
async def test_unzip_circuit_breaker_uses_consecutive_semantics(db, storage) -> None:
    """unzip_source circuit breaker must count *consecutive* failures, not cumulative.

    A callback that fails twice, succeeds once, then fails twice more should NOT
    trip the breaker (only 2 consecutive at most). Three consecutive failures in
    a row SHOULD trip it and disable the callback.
    """
    pytest.importorskip("cv2")
    project = _project()
    await db.put_project(project)
    src_key = "projects/ip1/source.zip"
    # Need enough pages to exercise: fail, fail, ok, fail, fail (5 pages min)
    pages_data = [(f"p{i}.png", _png(50, 50)) for i in range(5)]
    await storage.put_bytes(src_key, _zip(pages_data))

    call_count = 0
    fail_pattern = [True, True, False, True, True]  # fail=True, succeed=False

    async def intermittent_cb(_c, _t, _s):
        nonlocal call_count
        idx = call_count
        call_count += 1
        if idx < len(fail_pattern) and fail_pattern[idx]:
            raise RuntimeError(f"cb failure at call {idx}")

    result = await unzip_source(
        project=project,
        source_type="zip",
        source_key=src_key,
        storage=storage,
        database=db,
        progress_cb=intermittent_cb,
    )
    # Despite failures, all 5 pages must be ingested.
    assert result.page_count == 5
    # The breaker should NOT have tripped (max consecutive = 2 < threshold of 3),
    # so the callback must have been invoked for all 5 pages.
    assert call_count == 5


@pytest.mark.asyncio
async def test_unzip_circuit_breaker_trips_on_three_consecutive(db, storage) -> None:
    """Three consecutive unzip progress_cb failures MUST disable the callback."""
    pytest.importorskip("cv2")
    project = _project()
    await db.put_project(project)
    src_key = "projects/ip1/source.zip"
    pages_data = [(f"p{i}.png", _png(50, 50)) for i in range(5)]
    await storage.put_bytes(src_key, _zip(pages_data))

    call_count = 0

    async def always_fail(_c, _t, _s):
        nonlocal call_count
        call_count += 1
        raise RuntimeError("always fails")

    result = await unzip_source(
        project=project,
        source_type="zip",
        source_key=src_key,
        storage=storage,
        database=db,
        progress_cb=always_fail,
    )
    # All 5 pages must still be ingested despite cb failures.
    assert result.page_count == 5
    # Circuit breaker fires after 3 consecutive failures — callback must NOT be
    # called for pages 4 and 5.
    assert call_count == 3


@pytest.mark.asyncio
async def test_progress_cb_disabled_after_max_failures(db, storage) -> None:
    """After 3 consecutive failures, progress_cb must be disabled (not called further).

    Generates 5 pages so the cb would be invoked 5 times if the circuit breaker
    didn't kick in. With the breaker, it should stop after exactly 3 failures
    and the remaining pages proceed without calling it.
    """
    pytest.importorskip("cv2")
    project = _project()
    await db.put_project(project)
    src_key = "projects/ip1/source.zip"
    pages_data = [(f"p{i}.png", _png(50, 50)) for i in range(5)]
    await storage.put_bytes(src_key, _zip(pages_data))
    await unzip_source(project=project, source_type="zip", source_key=src_key, storage=storage, database=db)
    refreshed = await db.get_project(project.id)
    assert refreshed is not None

    call_count = 0

    async def always_boom(_c, _t, _s):
        nonlocal call_count
        call_count += 1
        raise RuntimeError("cb always fails")

    result = await generate_thumbnails(
        project=refreshed,
        storage=storage,
        database=db,
        progress_cb=always_boom,
        thumbnail_workers=1,
    )
    # All 5 thumbnails must still be generated despite cb failures.
    assert result.page_count == 5
    # Circuit breaker fires after 3 consecutive failures — cb must NOT be
    # called for pages 4 and 5.
    assert call_count == 3
