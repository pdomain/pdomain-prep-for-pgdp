"""W0.3 — per-page text_review attestation writer (B3).

Issue: docs/issues/2026-07-21-w03-text-review-attestation.md

Attest rewrites attestation.json to status=clean so validation no longer
emits unattested_text_review without hand-seeded files.
"""

from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING

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
from pdomain_prep_for_pgdp.core.pipeline.page_stage_writer import commit_stage_artifacts_multi
from pdomain_prep_for_pgdp.core.pipeline.steps.validation import validation_v2_cpu
from pdomain_prep_for_pgdp.core.pipeline.text_review_attestation import (
    TextReviewAttestError,
    attest_text_review_page,
)
from pdomain_prep_for_pgdp.settings import Settings
from tests.fixtures.seed_pages import seed_pages_in_store

if TYPE_CHECKING:
    pass


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


def _seed_project(settings: Settings, project_id: str = "proj1", n_pages: int = 2) -> None:
    async def go() -> None:
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
                page_count=n_pages,
                proof_page_count=n_pages,
                config=ProjectConfig(book_name=project_id, source_uri=""),
                storage_prefix=f"projects/{project_id}/",
                registry_version=3,
            )
        )
        await db.close()

    asyncio.run(go())
    seed_pages_in_store(
        settings,
        project_id,
        [
            PageRecord(
                project_id=project_id,
                idx0=i,
                prefix=f"p{i + 1:03d}",
                source_stem=f"src{i}",
                processing_status=PageProcessingStatus.pending,
            )
            for i in range(n_pages)
        ],
    )


async def _seed_text_review_empty_attestation(
    data_root: Path,
    database: SqliteDatabase,
    project_id: str,
    page_id: str,
    text: str = "Page prose.\n",
) -> None:
    await database.init_page_stages_for_page(project_id, page_id)
    await commit_stage_artifacts_multi(
        data_root=data_root,
        database=database,
        project_id=project_id,
        page_id=page_id,
        stage_id="text_review",
        files={
            "output.txt": text.encode("utf-8"),
            "attestation.json": b"{}",
        },
        primary_filename="output.txt",
    )


@pytest.mark.asyncio
async def test_attest_writes_status_clean(tmp_path: Path) -> None:
    data_root = tmp_path
    project_id, page_id = "p1", "0000"
    db = SqliteDatabase(f"sqlite:///{(tmp_path / 's.db').as_posix()}")
    await db.initialize()
    await _seed_text_review_empty_attestation(data_root, db, project_id, page_id)

    result = await attest_text_review_page(
        data_root=data_root,
        database=db,
        project_id=project_id,
        page_id=page_id,
        actor_id="user1",
        note="looks good",
    )
    assert result["status"] == "clean"
    assert result["actor_id"] == "user1"

    path = (
        data_root
        / "projects"
        / project_id
        / "pages"
        / page_id
        / "stages"
        / "text_review"
        / "attestation.json"
    )
    on_disk = json.loads(path.read_text(encoding="utf-8"))
    assert on_disk["status"] == "clean"
    assert on_disk["note"] == "looks good"
    # Preserve page text
    txt = (
        data_root / "projects" / project_id / "pages" / page_id / "stages" / "text_review" / "output.txt"
    ).read_text(encoding="utf-8")
    assert txt == "Page prose.\n"


@pytest.mark.asyncio
async def test_attest_requires_output_txt(tmp_path: Path) -> None:
    data_root = tmp_path
    project_id, page_id = "p1", "0000"
    db = SqliteDatabase(f"sqlite:///{(tmp_path / 's.db').as_posix()}")
    await db.initialize()
    await db.init_page_stages_for_page(project_id, page_id)

    with pytest.raises(TextReviewAttestError, match=r"output\.txt"):
        await attest_text_review_page(
            data_root=data_root,
            database=db,
            project_id=project_id,
            page_id=page_id,
            actor_id="user1",
        )


@pytest.mark.asyncio
async def test_validation_clears_unattested_after_attest(tmp_path: Path) -> None:
    data_root = tmp_path
    project_id = "p1"
    page_ids = ["0000", "0001"]
    db = SqliteDatabase(f"sqlite:///{(tmp_path / 's.db').as_posix()}")
    await db.initialize()

    for page_id in page_ids:
        await _seed_text_review_empty_attestation(
            data_root, db, project_id, page_id, text=f"Text for {page_id}\n"
        )

    before = json.loads(
        validation_v2_cpu(project_id=project_id, page_ids=page_ids, data_root=data_root).decode()
    )
    unattested = [i for i in before.get("blockers", []) if i.get("code") == "unattested_text_review"]
    assert len(unattested) == 2

    for page_id in page_ids:
        await attest_text_review_page(
            data_root=data_root,
            database=db,
            project_id=project_id,
            page_id=page_id,
            actor_id="user1",
        )

    after = json.loads(
        validation_v2_cpu(project_id=project_id, page_ids=page_ids, data_root=data_root).decode()
    )
    unattested_after = [i for i in after.get("blockers", []) if i.get("code") == "unattested_text_review"]
    assert unattested_after == []


def test_api_attest_route_and_validation(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1", n_pages=2)

    async def seed() -> None:
        db = SqliteDatabase(settings.derived_database_url)
        await db.initialize()
        try:
            for idx0 in (0, 1):
                page_id = f"{idx0:04d}"
                await _seed_text_review_empty_attestation(
                    settings.data_root, db, "proj1", page_id, text=f"Page {idx0}\n"
                )
        finally:
            await db.close()

    asyncio.run(seed())

    app = build_app(settings)
    with TestClient(app) as client:
        for idx0 in (0, 1):
            r = client.post(
                f"/api/data/projects/proj1/pages/{idx0}/stages/text_review/attest",
                json={"note": "ok"},
            )
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["status"] == "clean"
            assert body["page_id"] == f"{idx0:04d}"

        # Spot-check on-disk attestation
        att = (
            settings.data_root
            / "projects"
            / "proj1"
            / "pages"
            / "0000"
            / "stages"
            / "text_review"
            / "attestation.json"
        )
        assert json.loads(att.read_text(encoding="utf-8"))["status"] == "clean"

    # Validation pure path sees clean attestations
    report = json.loads(
        validation_v2_cpu(
            project_id="proj1",
            page_ids=["0000", "0001"],
            data_root=settings.data_root,
        ).decode()
    )
    unattested = [i for i in report.get("blockers", []) if i.get("code") == "unattested_text_review"]
    assert unattested == []
