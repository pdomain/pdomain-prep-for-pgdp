"""The archive keep list is the project's stage files, not the mock catalog."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from fastapi.testclient import TestClient

from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pdomain_prep_for_pgdp.bootstrap import build_app
from pdomain_prep_for_pgdp.core.models import Project, ProjectConfig, ProjectStatus
from pdomain_prep_for_pgdp.core.pipeline.stage_dag import REGISTRY_VERSION
from pdomain_prep_for_pgdp.core.pipeline.steps.archive_stage import build_archive_keep_list
from pdomain_prep_for_pgdp.settings import Settings

if TYPE_CHECKING:
    from pathlib import Path

_MOCK_CATALOG = (
    "Original scans",
    "Finished package",
    "Full provenance trail",
    "Grayscale pages",
    "Processed pages",
    "OCR crops",
    "Text review markup",
    "Text review output",
)

_PAGE_ARTIFACT = "pages/0001/stages/threshold/output.png"
_PROJECT_ARTIFACT = "stages/zip/output.bin"


def test_inventory_lists_known_stage_files_and_omits_mock_names(tmp_path: Path) -> None:
    project = tmp_path / "book"
    page_stage = project / "pages" / "0001" / "stages" / "threshold"
    page_stage.mkdir(parents=True)
    (page_stage / "output.png").write_bytes(b"png-bytes")
    project_stage = project / "stages" / "zip"
    project_stage.mkdir(parents=True)
    (project_stage / "output.bin").write_bytes(b"zip")
    toggle_store = project / "stages" / "archive"
    toggle_store.mkdir()
    (toggle_store / "item_toggles.json").write_text("{}")

    names = [item.name for item in build_archive_keep_list(project)]

    assert names == [_PAGE_ARTIFACT, _PROJECT_ARTIFACT]
    assert not any(name in _MOCK_CATALOG for name in names)


def test_inventory_is_empty_without_stage_files(tmp_path: Path) -> None:
    empty = tmp_path / "empty"
    empty.mkdir()

    assert build_archive_keep_list(empty) == []
    assert build_archive_keep_list(tmp_path / "missing") == []


def _settings(tmp_path: Path) -> Settings:
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


def _seed(settings: Settings) -> None:
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
                page_count=1,
                proof_page_count=1,
                config=ProjectConfig(book_name="proj1", source_uri="", author="Test Author"),
                storage_prefix="projects/proj1/",
                registry_version=REGISTRY_VERSION,
            )
        )
        await db.close()

    asyncio.run(go())


def test_route_lists_the_stage_file_and_a_saved_drop(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    _seed(settings)
    project = settings.data_root / "projects" / "proj1"
    stage = project / "pages" / "0001" / "stages" / "threshold"
    stage.mkdir(parents=True)
    (stage / "output.png").write_bytes(b"png-bytes")
    toggles = project / "stages" / "archive"
    toggles.mkdir(parents=True)
    (toggles / "item_toggles.json").write_text(f'{{"{_PAGE_ARTIFACT}": false}}')

    with TestClient(build_app(settings)) as client:
        response = client.get("/api/data/projects/proj1/project-stages/archive/items")

    assert response.status_code == 200, response.text
    assert response.json() == {"items": [{"name": _PAGE_ARTIFACT, "meta": "9 B", "keep": False}]}
    assert "Original scans" not in response.text


def test_route_lists_nothing_when_the_project_has_no_stage_files(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    _seed(settings)

    with TestClient(build_app(settings)) as client:
        response = client.get("/api/data/projects/proj1/project-stages/archive/items")

    assert response.status_code == 200, response.text
    assert response.json() == {"items": []}


def test_route_saves_a_keep_flag_for_a_stage_path(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    _seed(settings)
    project = settings.data_root / "projects" / "proj1"
    stage = project / "pages" / "0001" / "stages" / "threshold"
    stage.mkdir(parents=True)
    (stage / "output.png").write_bytes(b"png-bytes")

    with TestClient(build_app(settings)) as client:
        saved = client.patch(
            f"/api/data/projects/proj1/project-stages/archive/items/{_PAGE_ARTIFACT}",
            json={"keep": False},
        )
        listed = client.get("/api/data/projects/proj1/project-stages/archive/items")

    assert saved.status_code == 200, saved.text
    assert listed.status_code == 200, listed.text
    assert listed.json()["items"] == [{"name": _PAGE_ARTIFACT, "meta": "9 B", "keep": False}]


def test_inventory_applies_a_saved_keep_flag(tmp_path: Path) -> None:
    project = tmp_path / "book"
    page_stage = project / "pages" / "0001" / "stages" / "threshold"
    page_stage.mkdir(parents=True)
    (page_stage / "output.png").write_bytes(b"png-bytes")

    rows = build_archive_keep_list(project, {_PAGE_ARTIFACT: False})

    assert len(rows) == 1
    assert rows[0].keep is False
