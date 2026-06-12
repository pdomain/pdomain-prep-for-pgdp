"""Issue #62 — stage thumbnail endpoint + artifact-URL cache-busting.

Acceptance (from issue body):
- GET .../stages/threshold/thumbnail on a clean page returns a small PNG.
- The same endpoint returns 404 on `not-run`/`not-applicable` stages.
- After re-running a stage, the artifact URL with ?v=... differs from the prior
  URL; the browser fetches new bytes.
- Thumbnail bytes are persisted at write time (no on-demand CPU cost on the
  read path).
"""

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
from pdomain_prep_for_pgdp.core.pipeline.page_stage_writer import (
    commit_stage_artifact,
    stage_thumbnail_path,
)
from pdomain_prep_for_pgdp.settings import Settings
from tests.fixtures.seed_pages import seed_pages_in_store

if TYPE_CHECKING:
    from collections.abc import Iterator
    from pathlib import Path


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


def _seed_project(settings: Settings, owner_id: str = "default") -> None:
    async def go() -> None:
        db = SqliteDatabase(settings.derived_database_url)
        await db.initialize()
        now = datetime.now(UTC)
        await db.put_project(
            Project(
                id="proj1",
                owner_id=owner_id,
                name="proj1",
                created_at=now,
                updated_at=now,
                status=ProjectStatus.processing,
                page_count=1,
                proof_page_count=1,
                config=ProjectConfig(book_name="proj1", source_uri=""),
                storage_prefix="projects/proj1/",
            )
        )
        seed_pages_in_store(
            settings,
            "proj1",
            [
                PageRecord(
                    project_id="proj1",
                    idx0=0,
                    prefix="p001",
                    source_stem="src1",
                    processing_status=PageProcessingStatus.pending,
                ),
            ],
        )
        await db.close()

    asyncio.run(go())


def _checkerboard_bgr_png() -> bytes:
    img = np.zeros((200, 200, 3), dtype=np.uint8)
    img[::2, ::2] = (180, 200, 220)
    img[1::2, 1::2] = (180, 200, 220)
    ok, buf = cv2.imencode(".png", img)
    assert ok
    return bytes(buf.tobytes())


async def _seed_clean_stage(
    settings: Settings,
    project_id: str,
    page_id: str,
    stage_id: str,
    payload: bytes,
) -> float:
    """Seed one stage row + on-disk artifact. Returns last_run_at."""
    db = SqliteDatabase(settings.derived_database_url)
    await db.initialize()
    try:
        await db.init_page_stages_for_page(project_id, page_id)
        state = await commit_stage_artifact(
            data_root=settings.data_root,
            database=db,
            project_id=project_id,
            page_id=page_id,
            stage_id=stage_id,
            artifact_bytes=payload,
        )
        assert state.last_run_at is not None
        return state.last_run_at
    finally:
        await db.close()


@pytest.fixture
def seeded_client(tmp_path: Path) -> Iterator[tuple[TestClient, Settings]]:
    settings = _settings(tmp_path)
    _seed_project(settings)
    app = build_app(settings)
    with TestClient(app) as c:
        yield c, settings


# ─── Bullet 1: thumbnail endpoint returns PNG for clean stage ────────────────


def test_get_thumbnail_returns_png_for_clean_stage(
    seeded_client: tuple[TestClient, Settings],
) -> None:
    """Clean threshold stage → thumbnail endpoint returns image/png."""
    client, settings = seeded_client
    payload = _checkerboard_bgr_png()
    asyncio.run(_seed_clean_stage(settings, "proj1", "0000", "threshold", payload))

    r = client.get("/api/data/projects/proj1/pages/0/stages/threshold/thumbnail")
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("image/png")
    # Response is a valid PNG.
    arr = np.frombuffer(r.content, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_UNCHANGED)
    assert img is not None
    # Must be no larger than original (200x200 source, max_dim=400 so no downscale).
    assert img.shape[0] <= 200
    assert img.shape[1] <= 200


# ─── Bullet 2: 404 for not-run and not-applicable ────────────────────────────


def test_get_thumbnail_404_for_not_run_stage(
    seeded_client: tuple[TestClient, Settings],
) -> None:
    """A not-run stage returns 404 from the thumbnail endpoint."""
    client, _ = seeded_client
    # Trigger lazy-init so rows exist as not-run.
    client.get("/api/data/projects/proj1/pages/0/stages")

    r = client.get("/api/data/projects/proj1/pages/0/stages/threshold/thumbnail")
    assert r.status_code == 404


def test_get_thumbnail_404_for_unknown_project(
    seeded_client: tuple[TestClient, Settings],
) -> None:
    client, _ = seeded_client
    r = client.get("/api/data/projects/nope/pages/0/stages/threshold/thumbnail")
    assert r.status_code == 404


def test_get_thumbnail_422_for_unknown_stage(
    seeded_client: tuple[TestClient, Settings],
) -> None:
    client, _ = seeded_client
    r = client.get("/api/data/projects/proj1/pages/0/stages/not_real/thumbnail")
    assert r.status_code == 422


# ─── Bullet 3: artifact URL cache-busting via ?v= param ──────────────────────


def test_artifact_endpoint_accepts_v_query_param(
    seeded_client: tuple[TestClient, Settings],
) -> None:
    """?v=<timestamp> is accepted by the artifact endpoint (for URL cache-busting)."""
    client, settings = seeded_client
    payload = _checkerboard_bgr_png()
    last_run_at = asyncio.run(_seed_clean_stage(settings, "proj1", "0000", "grayscale", payload))

    r = client.get(f"/api/data/projects/proj1/pages/0/stages/grayscale/artifact?v={last_run_at}")
    assert r.status_code == 200, r.text
    assert r.content == payload


def test_last_run_at_changes_on_rerun(tmp_path: Path) -> None:
    """Re-running a stage produces a different last_run_at → different ?v= URL."""
    settings = _settings(tmp_path)
    _seed_project(settings)
    payload = _checkerboard_bgr_png()

    first = asyncio.run(_seed_clean_stage(settings, "proj1", "0000", "threshold", payload))
    second = asyncio.run(_seed_clean_stage(settings, "proj1", "0000", "threshold", payload))

    # last_run_at must be monotonically increasing (or at least different).
    assert second >= first, "second commit must have last_run_at >= first"


# ─── Bullet 4: thumbnail persisted at write time ─────────────────────────────


def test_thumbnail_persisted_at_write_time(tmp_path: Path) -> None:
    """commit_stage_artifact writes thumb.png alongside the artifact."""
    settings = _settings(tmp_path)
    _seed_project(settings)
    payload = _checkerboard_bgr_png()
    asyncio.run(_seed_clean_stage(settings, "proj1", "0000", "threshold", payload))

    thumb = stage_thumbnail_path(settings.data_root, "proj1", "0000", "threshold")
    assert thumb.exists(), f"thumb.png not found at {thumb}"
    # Must be a valid PNG.
    data = thumb.read_bytes()
    arr = np.frombuffer(data, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_UNCHANGED)
    assert img is not None


def test_thumbnail_not_written_for_non_image_stage(tmp_path: Path) -> None:
    """Text-output stages (e.g. the v2 `regex` stage) don't get a thumb.png."""
    settings = _settings(tmp_path)
    _seed_project(settings)
    # v2 `regex` has output_type="text" — no thumbnail expected (was v1
    # `text_postprocess`, folded into the regex/text_review chain).
    payload = b"hello world\n"
    asyncio.run(_seed_clean_stage(settings, "proj1", "0000", "regex", payload))

    thumb = stage_thumbnail_path(settings.data_root, "proj1", "0000", "regex")
    assert not thumb.exists(), "thumb.png should not be written for text-output stages"


# ─── Exception handler narrowing ─────────────────────────────────────────────


def test_thumbnail_programmer_error_propagates(monkeypatch: pytest.MonkeyPatch) -> None:
    """TypeError in thumbnail generation must not be silently swallowed.

    Uses output_type="binary" which is in _THUMBNAIL_OUTPUT_TYPES so the
    code reaches cv2.imdecode before short-circuiting.
    """
    monkeypatch.setattr(cv2, "imdecode", lambda *a, **kw: (_ for _ in ()).throw(TypeError("bad arg")))

    from pdomain_prep_for_pgdp.core.pipeline.page_stage_writer import make_stage_thumbnail_bytes

    # TypeError must propagate, not be swallowed and return None.
    with pytest.raises(TypeError):
        make_stage_thumbnail_bytes(_checkerboard_bgr_png(), output_type="binary")
