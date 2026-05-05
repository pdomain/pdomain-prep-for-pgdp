"""Tests-first for auto-detection of illustrations during ingest.

Spec 05 says ingest can run the layout detector and write suggested
`illustration_regions` onto each PageRecord (the user confirms or rejects
in the page tagger). This test suite locks in:
  - when a layout detector is provided, regions land on each page,
  - regions below the confidence threshold are dropped,
  - non-illustration region types (e.g. text) are filtered out,
  - when no detector is provided (the default), no regions are written.
"""

from __future__ import annotations

import io
import zipfile
from datetime import UTC, datetime
from typing import Any

import numpy as np
import pytest

from pd_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pd_prep_for_pgdp.adapters.storage.filesystem import FilesystemStorage
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


def _zip(entries: list[tuple[str, bytes]]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for n, d in entries:
            zf.writestr(n, d)
    return buf.getvalue()


def _project(project_id: str = "p1") -> Project:
    now = datetime.now(UTC)
    return Project(
        id=project_id,
        owner_id="default",
        name="t",
        created_at=now,
        updated_at=now,
        status=ProjectStatus.ingesting,
        page_count=0,
        proof_page_count=0,
        config=ProjectConfig(book_name="t", source_uri=""),
        pipeline_state=PipelineState(),
        storage_prefix=f"projects/{project_id}/",
    )


# ─── Fake layout detector that mimics pd_book_tools.layout API ──────────────


class _FakeRegion:
    def __init__(self, type_name: str, L: int, R: int, T: int, B: int, conf: float):
        self.L = L
        self.R = R
        self.T = T
        self.B = B
        self.confidence = conf
        self.type = _FakeRegionType(type_name)


class _FakeRegionType:
    def __init__(self, name: str):
        self.name = name

    def __eq__(self, other: object) -> bool:
        return getattr(other, "name", None) == self.name

    def __hash__(self) -> int:
        return hash(self.name)


class _FakeLayoutPage:
    def __init__(self, regions: list[_FakeRegion]):
        self.regions = regions


class FakeLayoutDetector:
    """Returns regions in the order they're configured (one queue entry per page).

    `_build_page_records` writes each source to a temp file before invoking
    the detector, so we consume a pre-configured queue rather than keying
    on filename.
    """

    def __init__(self, per_call_regions: list[list[_FakeRegion]]):
        self._queue = list(per_call_regions)

    def detect(self, image_path: Any) -> _FakeLayoutPage:
        regions = self._queue.pop(0) if self._queue else []
        return _FakeLayoutPage(regions)


@pytest.fixture
async def db(tmp_path) -> SqliteDatabase:
    d = SqliteDatabase(f"sqlite:///{(tmp_path / 's.db').as_posix()}")
    await d.initialize()
    return d


@pytest.fixture
def storage(tmp_path) -> FilesystemStorage:
    return FilesystemStorage(root=tmp_path / "data")


@pytest.mark.asyncio
async def test_layout_detector_writes_regions_to_pages(
    db: SqliteDatabase, storage: FilesystemStorage, monkeypatch: pytest.MonkeyPatch
) -> None:
    pytest.importorskip("cv2")
    from pd_prep_for_pgdp.core.ingest import ingest_source

    project = _project()
    await db.put_project(project)
    zip_bytes = _zip(
        [
            ("p1.png", _png(200, 300)),
            ("p2.png", _png(200, 300)),
        ]
    )
    src_key = f"projects/{project.id}/source.zip"
    await storage.put_bytes(src_key, zip_bytes)

    detector = FakeLayoutDetector(
        [
            [
                _FakeRegion("figure", 10, 100, 10, 100, 0.9),
                _FakeRegion("text", 0, 200, 100, 200, 0.95),  # filtered (wrong type)
                _FakeRegion("figure", 110, 200, 10, 100, 0.3),  # below threshold
            ],
            [_FakeRegion("decoration", 0, 50, 0, 50, 0.8)],
        ]
    )

    # Stub the RegionType import inside core.illustrations so the type filter
    # uses our fake set.
    class _FakeRegionTypeEnum:
        figure = _FakeRegionType("figure")
        decoration = _FakeRegionType("decoration")
        table = _FakeRegionType("table")

    fake_module = type("_FakeMod", (), {"RegionType": _FakeRegionTypeEnum})

    import sys

    monkeypatch.setitem(sys.modules, "pd_book_tools.layout.types", fake_module)

    await ingest_source(
        project=project,
        source_type="zip",
        source_key=src_key,
        storage=storage,
        database=db,
        auto_detect=True,
        layout_detector=detector,
        layout_confidence=0.5,
    )

    pages, _, _ = await db.list_pages(project.id, None, 100)
    by_stem = {p.source_stem: p for p in pages}
    assert len(by_stem["p1"].illustration_regions) == 1  # figure (high conf) only
    assert by_stem["p1"].illustration_regions[0].L == 10
    assert by_stem["p1"].illustration_regions[0].type == "illustration"
    assert len(by_stem["p2"].illustration_regions) == 1
    assert by_stem["p2"].illustration_regions[0].type == "decoration"


@pytest.mark.asyncio
async def test_no_detector_means_no_regions(
    db: SqliteDatabase, storage: FilesystemStorage
) -> None:
    pytest.importorskip("cv2")
    from pd_prep_for_pgdp.core.ingest import ingest_source

    project = _project()
    await db.put_project(project)
    zip_bytes = _zip([("p1.png", _png(50, 50))])
    src_key = f"projects/{project.id}/source.zip"
    await storage.put_bytes(src_key, zip_bytes)

    await ingest_source(
        project=project,
        source_type="zip",
        source_key=src_key,
        storage=storage,
        database=db,
        auto_detect=True,
        layout_detector=None,
    )

    pages, _, _ = await db.list_pages(project.id, None, 100)
    assert pages[0].illustration_regions == []
