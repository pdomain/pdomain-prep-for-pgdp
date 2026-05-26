"""Tests-first for `PATCH /pages/{idx0}/text` matching the OCR output keys.

When OCR runs it writes `projects/{id}/ocr_text/{source_stem}_{full_prefix}.txt`
and records the path on `PageOutput.ocr_text_key`. Step-9 text review must
write to the SAME key so the package step picks up the edited text.

Locks in:
  - `PATCH .../text` writes to `outputs[*].ocr_text_key` when present,
  - the response `text_key` matches what subsequent `GET .../text/{suffix}`
    reads, so the round-trip works on the same path.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pdomain_prep_for_pgdp.bootstrap import build_app
from pdomain_prep_for_pgdp.core.models import (
    PageOutput,
    PageProcessingStatus,
    PageRecord,
    PipelineState,
    Project,
    ProjectConfig,
    ProjectStatus,
)
from pdomain_prep_for_pgdp.settings import Settings


@pytest.fixture
def settings(tmp_path) -> Settings:
    return Settings(
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


def test_patch_text_writes_to_ocr_text_key_recorded_on_output(
    settings: Settings,
) -> None:
    """Seed via a fresh asyncio loop, then run TestClient on its own loop.

    `TestClient` spins up its own event loop on `__enter__`. Sharing a loop
    with our seeding work would leave the runner-task / dispatcher-task
    cancelled-but-pending in subsequent tests, so we run a throwaway loop
    just for the seed.
    """
    app = build_app(settings)

    import asyncio

    async def _seed() -> tuple[str, str]:
        db = SqliteDatabase(settings.derived_database_url)
        await db.initialize()
        now = datetime.now(UTC)
        project_id = "tr1"
        ocr_text_key = f"projects/{project_id}/ocr_text/src_007_p007.txt"
        project = Project(
            id=project_id,
            owner_id="default",
            name="t",
            created_at=now,
            updated_at=now,
            status=ProjectStatus.reviewing,
            page_count=1,
            proof_page_count=1,
            config=ProjectConfig(book_name="t", source_uri=""),
            pipeline_state=PipelineState(),
            storage_prefix=f"projects/{project_id}/",
        )
        await db.put_project(project)
        page = PageRecord(
            project_id=project_id,
            idx0=0,
            prefix="p007",
            source_stem="src_007",
            outputs=[
                PageOutput(
                    full_prefix="p007",
                    split_suffix=None,
                    reading_order=0,
                    ocr_text_key=ocr_text_key,
                    ocr_status=PageProcessingStatus.complete,
                )
            ],
        )
        await db.put_page(page)
        await db.close()
        return project_id, ocr_text_key

    project_id, expected_key = asyncio.run(_seed())

    with TestClient(app) as client:
        r = client.patch(
            f"/api/data/projects/{project_id}/pages/0/text",
            json={"split_suffix": None, "text": "Edited text from review."},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["text_key"] == expected_key

        # Confirm round-trip: GET reads the same path.
        r2 = client.get(f"/api/data/projects/{project_id}/pages/0/text/_")
        assert r2.status_code == 200
        assert "Edited text from review." in r2.json()["text"]
