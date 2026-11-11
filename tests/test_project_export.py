"""Save a copy produces a zip of the whole project."""

from __future__ import annotations

import asyncio
import io
import json
import sqlite3
import zipfile
from datetime import UTC, datetime
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
from pdomain_prep_for_pgdp.core.pipeline.page_stage_writer import commit_stage_artifact
from pdomain_prep_for_pgdp.core.project_export import MANIFEST_NAME, write_project_zip
from pdomain_prep_for_pgdp.settings import Settings
from tests.fixtures.seed_pages import seed_pages_in_store

if TYPE_CHECKING:
    from collections.abc import Iterator
    from pathlib import Path


def test_zip_holds_every_project_file_and_the_manifest(tmp_path: Path) -> None:
    project_dir = tmp_path / "proj"
    (project_dir / "stages" / "zip").mkdir(parents=True)
    (project_dir / "stages" / "zip" / "output.bin").write_bytes(b"abc")
    destination = tmp_path / "copy.zip"

    write_project_zip(project_dir, b'{"format_version": 1}', destination)

    with zipfile.ZipFile(destination) as archive:
        assert archive.read("project/stages/zip/output.bin") == b"abc"
        assert archive.read(MANIFEST_NAME) == b'{"format_version": 1}'


def test_zip_copies_committed_rows_from_a_database_in_wal_mode(tmp_path: Path) -> None:
    project_dir = tmp_path / "proj"
    project_dir.mkdir()
    db_path = project_dir / "events.db"
    live = sqlite3.connect(db_path)
    _ = live.execute("PRAGMA journal_mode=WAL")
    _ = live.execute("CREATE TABLE t (v TEXT)")
    _ = live.execute("INSERT INTO t VALUES ('kept')")
    live.commit()
    destination = tmp_path / "copy.zip"

    write_project_zip(project_dir, b"{}", destination)
    live.close()

    with zipfile.ZipFile(destination) as archive:
        names = archive.namelist()
        extracted = archive.extract("project/events.db", tmp_path / "out")
    assert not [name for name in names if name.endswith(("-wal", "-shm"))]
    copy = sqlite3.connect(extracted)
    assert copy.execute("SELECT v FROM t").fetchall() == [("kept",)]
    copy.close()


def test_zip_keeps_a_file_that_only_looks_like_a_database(tmp_path: Path) -> None:
    project_dir = tmp_path / "proj"
    project_dir.mkdir()
    (project_dir / "notes.db").write_bytes(b"this is not sqlite data at all")
    destination = tmp_path / "copy.zip"

    write_project_zip(project_dir, b"{}", destination)

    with zipfile.ZipFile(destination) as archive:
        assert archive.read("project/notes.db") == b"this is not sqlite data at all"


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
    async def go() -> None:
        db = SqliteDatabase(settings.derived_database_url)
        await db.initialize()
        now = datetime.now(UTC)
        await db.put_project(
            Project(
                id="proj1",
                owner_id="default",
                name="My Book: Vol/1",
                created_at=now,
                updated_at=now,
                status=ProjectStatus.processing,
                page_count=1,
                proof_page_count=1,
                config=ProjectConfig(book_name="proj1", source_uri=""),
                storage_prefix="projects/proj1/",
                registry_version=2,
            )
        )
        _ = await db.init_page_stages_for_page("proj1", "0000")
        _ = await commit_stage_artifact(
            data_root=settings.data_root,
            database=db,
            project_id="proj1",
            page_id="0000",
            stage_id="threshold",
            artifact_bytes=b"\x89PNG\r\n\x1a\nnot a real image",
        )
        await db.close()

    asyncio.run(go())
    seed_pages_in_store(
        settings,
        "proj1",
        [
            PageRecord(
                project_id="proj1",
                idx0=0,
                prefix="p001",
                source_stem="src0",
                processing_status=PageProcessingStatus.pending,
            )
        ],
    )


@pytest.fixture
def client_and_settings(tmp_path: Path) -> Iterator[tuple[TestClient, Settings]]:
    settings = _settings(tmp_path)
    _seed(settings)
    with TestClient(build_app(settings)) as client:
        yield client, settings


def test_route_downloads_project_files_and_stage_rows(
    client_and_settings: tuple[TestClient, Settings],
) -> None:
    client, _ = client_and_settings

    response = client.get("/api/data/projects/proj1/export")

    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/zip"
    assert 'filename="My-Book-Vol-1-copy.zip"' in response.headers["content-disposition"]
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        names = archive.namelist()
        manifest = json.loads(archive.read(MANIFEST_NAME))
    assert "project/pages/0000/stages/threshold/output.png" in names
    assert "project/.pd-pages/events.db" in names
    assert manifest["format_version"] == 1
    assert manifest["project"]["id"] == "proj1"
    assert {row["stage_id"] for row in manifest["page_stages"]} >= {"threshold"}


def test_route_removes_its_working_file(
    client_and_settings: tuple[TestClient, Settings],
) -> None:
    client, settings = client_and_settings

    assert client.get("/api/data/projects/proj1/export").status_code == 200

    assert list((settings.data_root / "exports").glob("*.zip")) == []


def test_route_returns_404_for_an_unknown_project(
    client_and_settings: tuple[TestClient, Settings],
) -> None:
    client, _ = client_and_settings

    assert client.get("/api/data/projects/nope/export").status_code == 404


def test_the_stub_post_route_is_gone(
    client_and_settings: tuple[TestClient, Settings],
) -> None:
    client, _ = client_and_settings

    assert client.post("/api/data/projects/proj1/export").status_code == 405
