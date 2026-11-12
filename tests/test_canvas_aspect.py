"""Canvas-map aspect points come from real page images."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import TYPE_CHECKING

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pdomain_prep_for_pgdp.bootstrap import build_app
from pdomain_prep_for_pgdp.core.models import (
    PageProcessingStatus,
    PageRecord,
    Project,
    ProjectConfig,
    ProjectStatus,
)
from pdomain_prep_for_pgdp.core.pipeline.canvas_aspect import png_dimensions, split_body_pages
from pdomain_prep_for_pgdp.core.pipeline.page_stage_writer import commit_stage_artifact
from pdomain_prep_for_pgdp.settings import Settings
from tests.fixtures.seed_pages import seed_pages_in_store

if TYPE_CHECKING:
    from collections.abc import Iterator
    from pathlib import Path


def _png(height: int, width: int) -> bytes:
    ok, buf = cv2.imencode(".png", np.zeros((height, width), dtype=np.uint8))
    assert ok
    return bytes(buf.tobytes())


def test_png_dimensions_reads_the_header() -> None:
    assert png_dimensions(_png(130, 100)) == (100, 130)


def test_png_dimensions_rejects_other_bytes() -> None:
    assert png_dimensions(b"not a png, but longer than the png header") is None


def test_split_body_pages_marks_pages_near_the_median() -> None:
    median, body = split_body_pages([1.30, 1.31, 1.29, 1.32, 0.8, 2.0])

    assert median == pytest.approx(1.305)
    assert body == [True, True, True, True, False, False]


def test_split_body_pages_handles_no_pages() -> None:
    assert split_body_pages([]) == (None, [])


def _settings(tmp_path: Path) -> Settings:
    return Settings(
        host="127.0.0.1",
        port=8765,
        data_root=tmp_path / "data",
        config_dir=tmp_path / "config",
        storage_backend="filesystem",
        database_url=f"sqlite:///{(tmp_path / 's.db').as_posix()}",
        gpu_backend="cpu",
        dispatch_interval_seconds=0,
        auth_mode="none",
    )


def _seed(settings: Settings) -> None:
    sizes = [(0, 130, 100), (1, 131, 100), (2, 80, 100)]

    async def go() -> None:
        db = SqliteDatabase(settings.derived_database_url)
        await db.initialize()
        now = datetime.now(UTC)
        await db.put_project(
            Project(
                id="proj1",
                owner_id="default",
                name="proj1",
                created_at=now,
                updated_at=now,
                status=ProjectStatus.processing,
                page_count=4,
                proof_page_count=4,
                config=ProjectConfig(book_name="proj1", source_uri=""),
                storage_prefix="projects/proj1/",
                registry_version=2,
            )
        )
        for idx0, height, width in sizes:
            page_id = f"{idx0:04d}"
            _ = await db.init_page_stages_for_page("proj1", page_id)
            _ = await commit_stage_artifact(
                data_root=settings.data_root,
                database=db,
                project_id="proj1",
                page_id=page_id,
                stage_id="post_transform_crop",
                artifact_bytes=_png(height, width),
            )
        await db.close()

    asyncio.run(go())
    seed_pages_in_store(
        settings,
        "proj1",
        [
            PageRecord(
                project_id="proj1",
                idx0=idx0,
                prefix=f"p{idx0:03d}",
                source_stem=f"src{idx0}",
                processing_status=PageProcessingStatus.pending,
            )
            for idx0 in range(4)
        ],
    )


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    settings = _settings(tmp_path)
    _seed(settings)
    with TestClient(build_app(settings)) as test_client:
        yield test_client


URL = "/api/data/projects/proj1/project-stages/canvas_map/aspect-points"


def test_route_returns_a_point_for_each_page_with_an_image(client: TestClient) -> None:
    response = client.get(URL)

    assert response.status_code == 200, response.text
    body = response.json()
    assert [(p["pageId"], p["width"], p["height"], p["body"]) for p in body["points"]] == [
        ("0000", 100, 130, True),
        ("0001", 100, 131, True),
        ("0002", 100, 80, False),
    ]
    assert body["bodyRatio"] == pytest.approx(1.3)
    assert body["canvasRatio"] == pytest.approx(1.294)


def test_route_reports_the_project_canvas_ratio(client: TestClient) -> None:
    saved = client.put(
        "/api/data/projects/proj1/stages/canvas_map/settings",
        json={"page_h_w_ratio": 1.5},
    )
    assert saved.status_code == 200, saved.text

    assert client.get(URL).json()["canvasRatio"] == pytest.approx(1.5)


def test_route_returns_404_for_an_unknown_project(client: TestClient) -> None:
    response = client.get("/api/data/projects/nope/project-stages/canvas_map/aspect-points")

    assert response.status_code == 404
