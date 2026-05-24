"""Cover the small helpers in `core.ingest`.

Locks in:
  - zip directory entries are skipped (`_enumerate_zip`),
  - folder enumeration filters non-image extensions,
  - `_make_thumbnail_bytes` resizes images larger than THUMBNAIL_MAX_DIM
    (the resize branch),
  - `_make_thumbnail_bytes` leaves small images at their native size.
"""

from __future__ import annotations

import io
import zipfile
from datetime import UTC, datetime

import numpy as np
import pytest

from pd_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pd_prep_for_pgdp.adapters.storage.filesystem import FilesystemStorage
from pd_prep_for_pgdp.core.ingest import (
    THUMBNAIL_MAX_DIM,
    _make_thumbnail_bytes,
    unzip_source,
)
from pd_prep_for_pgdp.core.models import (
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
        id="ih1",
        owner_id="default",
        name="t",
        created_at=now,
        updated_at=now,
        status=ProjectStatus.ingesting,
        page_count=0,
        proof_page_count=0,
        config=ProjectConfig(book_name="t", source_uri=""),
        pipeline_state=PipelineState(),
        storage_prefix="projects/ih1/",
    )


@pytest.mark.asyncio
async def test_unzip_skips_directory_entries(db, storage) -> None:
    """A zip with bare directory entries (e.g. created by GUI tools) shouldn't
    cause spurious PageRecords — `_enumerate_zip` skips them."""
    pytest.importorskip("cv2")
    project = _project()
    await db.put_project(project)

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        # Two real images, plus a bare directory entry.
        zf.writestr("imgs/", b"")  # directory entry
        zf.writestr("imgs/p1.png", _png(50, 50))
        zf.writestr("imgs/p2.png", _png(50, 50))
    src_key = "projects/ih1/source.zip"
    await storage.put_bytes(src_key, buf.getvalue())

    result = await unzip_source(
        project=project, source_type="zip", source_key=src_key, storage=storage, database=db
    )
    # 2 pages — directory entry skipped (otherwise it'd be 3).
    assert result.page_count == 2


@pytest.mark.asyncio
async def test_unzip_local_folder_skips_non_image_files(db, storage) -> None:
    """`_enumerate_folder` filters by extension; .txt files shouldn't become
    pages."""
    project = _project()
    await db.put_project(project)
    folder = "projects/ih1/raw/"
    await storage.put_bytes(f"{folder}img1.png", _png(40, 40))
    await storage.put_bytes(f"{folder}README.txt", b"not an image")
    await storage.put_bytes(f"{folder}img2.jpg", _png(40, 40))

    result = await unzip_source(
        project=project, source_type="local_folder", source_key=folder, storage=storage, database=db
    )
    assert result.page_count == 2


def test_make_thumbnail_resizes_large_image() -> None:
    """An image whose short side exceeds THUMBNAIL_MAX_DIM gets resized."""
    cv2 = pytest.importorskip("cv2")
    big = _png(THUMBNAIL_MAX_DIM * 3, THUMBNAIL_MAX_DIM * 3)  # 1200x1200
    out = _make_thumbnail_bytes(big)
    decoded = cv2.imdecode(np.frombuffer(out, dtype=np.uint8), cv2.IMREAD_COLOR)
    h, w = decoded.shape[:2]
    # Short side should be ~THUMBNAIL_MAX_DIM (resize step).
    assert min(h, w) <= THUMBNAIL_MAX_DIM


def test_make_thumbnail_keeps_small_image_at_native_size() -> None:
    """An image already smaller than THUMBNAIL_MAX_DIM is encoded as-is."""
    cv2 = pytest.importorskip("cv2")
    small = _png(80, 60)
    out = _make_thumbnail_bytes(small)
    decoded = cv2.imdecode(np.frombuffer(out, dtype=np.uint8), cv2.IMREAD_COLOR)
    h, w = decoded.shape[:2]
    # No resize — original dimensions retained (cv2 jpg encoding doesn't
    # change shape).
    assert (h, w) == (80, 60)


# ─── thumbnail_for_page (pool-friendly per-page worker) ────────────────────


def test_thumbnail_for_page_returns_success_payload() -> None:
    """The pool-friendly worker returns (idx0, stem, jpg_bytes, None) on
    success.

    Top-level module function with all-picklable args + return so it can be
    dispatched to a `ProcessPoolExecutor`. No shared state, no closures, no
    storage handles — the parent process owns I/O.
    """
    pytest.importorskip("cv2")
    from pd_prep_for_pgdp.core.ingest import thumbnail_for_page

    src = _png(80, 60)
    idx0, stem, jpg, err = thumbnail_for_page(7, "p007", src)
    assert idx0 == 7
    assert stem == "p007"
    assert err is None
    assert jpg is not None
    assert jpg[:3] == b"\xff\xd8\xff"  # JPEG magic


def test_thumbnail_for_page_returns_error_on_corrupt_bytes() -> None:
    """Corrupt source bytes surface as the error slot of the result tuple
    rather than raising — so a failed page in a pool worker doesn't kill
    the whole batch and the orchestrator can record the per-page error."""
    pytest.importorskip("cv2")
    from pd_prep_for_pgdp.core.ingest import thumbnail_for_page

    idx0, stem, jpg, err = thumbnail_for_page(3, "bad", b"not an image at all")
    assert idx0 == 3
    assert stem == "bad"
    assert jpg is None
    assert err is not None
    assert "bad" not in err  # stem is in the bookkeeping tuple, not the message
    # error originates in the Pillow header-check layer or the cv2 decode layer
    assert any(kw in err.lower() for kw in ("imdecode", "cv2", "cannot read image header", "cannot identify"))


def test_thumbnail_for_page_is_top_level_picklable() -> None:
    """Sanity-check picklability — required for ProcessPoolExecutor dispatch."""
    import pickle

    from pd_prep_for_pgdp.core.ingest import thumbnail_for_page

    blob = pickle.dumps(thumbnail_for_page)
    restored = pickle.loads(blob)
    # Restored ref points at the same module-level function.
    assert restored is thumbnail_for_page
