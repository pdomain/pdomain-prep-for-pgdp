"""Seed page-stage artifacts through the real dual-write path, for browser tests."""

from __future__ import annotations

import asyncio
import json
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import TYPE_CHECKING

import cv2
import numpy as np

from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pdomain_prep_for_pgdp.core.models import PageStageStatus
from pdomain_prep_for_pgdp.core.pipeline.page_stage_writer import (
    commit_stage_artifact,
    commit_stage_artifacts_multi,
)

if TYPE_CHECKING:
    from collections.abc import Coroutine, Mapping, Sequence

    from pdomain_prep_for_pgdp.settings import Settings


@dataclass(frozen=True)
class ReviewPageSeed:
    page_id: str
    flags: tuple[tuple[str, str], ...]
    attested: bool = False


def run_outside_loop[T](coro: Coroutine[object, object, T]) -> T:
    """Run a coroutine from a test whose thread already runs Playwright's event loop."""
    with ThreadPoolExecutor(max_workers=1) as pool:
        return pool.submit(asyncio.run, coro).result()


def gradient_png(height: int = 64, width: int = 256) -> bytes:
    row = np.linspace(0, 255, width, dtype=np.uint8)
    ok, buf = cv2.imencode(".png", np.tile(row, (height, 1)))
    assert ok
    return bytes(buf.tobytes())


async def _commit_stages(
    settings: Settings,
    project_id: str,
    page_stages: Mapping[str, Sequence[tuple[str, bytes]]],
    dirty: Sequence[tuple[str, str]],
) -> None:
    db = SqliteDatabase(settings.derived_database_url)
    await db.initialize()
    try:
        for page_id, stages in page_stages.items():
            _ = await db.init_page_stages_for_page(project_id, page_id)
            for stage_id, data in stages:
                _ = await commit_stage_artifact(
                    data_root=settings.data_root,
                    database=db,
                    project_id=project_id,
                    page_id=page_id,
                    stage_id=stage_id,
                    artifact_bytes=data,
                )
        for page_id, stage_id in dirty:
            state = await db.get_page_stage(project_id, page_id, stage_id)
            assert state is not None
            await db.put_page_stage(state.model_copy(update={"status": PageStageStatus.dirty}))
    finally:
        await db.close()


async def _seed_review_pages(settings: Settings, project_id: str, pages: Sequence[ReviewPageSeed]) -> None:
    db = SqliteDatabase(settings.derived_database_url)
    await db.initialize()
    try:
        for seed in pages:
            _ = await db.init_page_stages_for_page(project_id, seed.page_id)
            flags = [
                {"word_id": word_id, "word_text": text, "flag_reason": "bad_word", "status": "open"}
                for word_id, text in seed.flags
            ]
            flags_json = {"flags": flags, "flagged_count": len(flags), "total_words": 100}
            _ = await commit_stage_artifacts_multi(
                data_root=settings.data_root,
                database=db,
                project_id=project_id,
                page_id=seed.page_id,
                stage_id="wordcheck",
                files={"flags.json": json.dumps(flags_json).encode(), "output.txt": b"page prose\n"},
                primary_filename="output.txt",
            )
            attestation = {"status": "clean", "actor_id": "seed"} if seed.attested else {}
            _ = await commit_stage_artifacts_multi(
                data_root=settings.data_root,
                database=db,
                project_id=project_id,
                page_id=seed.page_id,
                stage_id="text_review",
                files={"output.txt": b"page prose\n", "attestation.json": json.dumps(attestation).encode()},
                primary_filename="output.txt",
            )
            if not seed.attested:
                state = await db.get_page_stage(project_id, seed.page_id, "text_review")
                assert state is not None
                await db.put_page_stage(state.model_copy(update={"status": PageStageStatus.dirty}))
    finally:
        await db.close()


def seed_review_pages(settings: Settings, project_id: str, pages: Sequence[ReviewPageSeed]) -> None:
    """Write the wordcheck flags and text_review rows that the live review queue reads."""
    run_outside_loop(_seed_review_pages(settings, project_id, pages))


def commit_stages(
    settings: Settings,
    project_id: str,
    page_stages: Mapping[str, Sequence[tuple[str, bytes]]],
    dirty: Sequence[tuple[str, str]] = (),
) -> None:
    """Commit each page's listed stage outputs, then mark the ``dirty`` (page, stage) rows stale."""
    run_outside_loop(_commit_stages(settings, project_id, page_stages, dirty))
