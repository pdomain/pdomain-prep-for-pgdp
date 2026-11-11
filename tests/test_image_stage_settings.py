"""Image-stage review controls map onto real settings and change stage output."""

from __future__ import annotations

import asyncio
import hashlib
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pdomain_prep_for_pgdp.bootstrap import build_app
from pdomain_prep_for_pgdp.core.models import (
    JobType,
    PageProcessingStatus,
    PageRecord,
    Project,
    ProjectConfig,
    ProjectStatus,
    ResolvedPageConfig,
)
from pdomain_prep_for_pgdp.core.pipeline.page_stage_writer import (
    commit_stage_artifact,
    stage_artifact_path,
)
from pdomain_prep_for_pgdp.core.pipeline.stage_runner import run_stage
from pdomain_prep_for_pgdp.core.pipeline.stage_settings import (
    STAGE_SETTINGS_DEFAULTS,
    StageSettingsStore,
    apply_stage_settings_to_config,
)
from pdomain_prep_for_pgdp.settings import Settings
from tests.fixtures.seed_pages import seed_pages_in_store

if TYPE_CHECKING:
    from collections.abc import Iterator

SCHEMA_FILE = Path(__file__).parent.parent / "frontend/src/pages/pipeline/tools/stageSchemas.ts"


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


def _seed_project(settings: Settings, pages: list[tuple[int, str]]) -> None:
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
                page_count=len(pages),
                proof_page_count=len(pages),
                config=ProjectConfig(book_name="proj1", source_uri=""),
                storage_prefix="projects/proj1/",
                registry_version=2,
            )
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
                prefix=prefix,
                source_stem=f"src{idx0}",
                processing_status=PageProcessingStatus.pending,
            )
            for idx0, prefix in pages
        ],
    )


def _store(settings: Settings) -> StageSettingsStore:
    return StageSettingsStore(settings.data_root / "projects" / "proj1" / "stage_settings.db")


def _gradient_png() -> bytes:
    img = np.tile(np.linspace(0, 255, 256, dtype=np.uint8), (64, 1))
    ok, buf = cv2.imencode(".png", img)
    assert ok
    return bytes(buf.tobytes())


def _queued_rerun_jobs(settings: Settings) -> list[str]:
    async def go() -> list[str]:
        db = SqliteDatabase(settings.derived_database_url)
        await db.initialize()
        try:
            jobs = await db.list_recent_jobs("default", 20)
        finally:
            await db.close()
        return [str(j.payload["page_id"]) for j in jobs if j.type == JobType.run_page_stage]

    return asyncio.run(go())


@pytest.fixture
def client_and_settings(tmp_path: Path) -> Iterator[tuple[TestClient, Settings]]:
    settings = _settings(tmp_path)
    _seed_project(settings, [(0, "p001"), (12, "")])
    with TestClient(build_app(settings)) as client:
        yield client, settings


def _resolved(**overrides: object) -> ResolvedPageConfig:
    base = ResolvedPageConfig.model_construct(threshold_level=None, skip_denoise=False)
    return base.model_copy(update=overrides)


def test_threshold_has_a_registry_entry() -> None:
    assert STAGE_SETTINGS_DEFAULTS["threshold"] == {"threshold_level": None}


def test_unset_threshold_keeps_the_page_config_value() -> None:
    cfg = _resolved(threshold_level=99)

    assert apply_stage_settings_to_config(cfg, "threshold", {"threshold_level": None}).threshold_level == 99


def test_set_threshold_replaces_the_page_config_value() -> None:
    cfg = _resolved(threshold_level=99)

    assert apply_stage_settings_to_config(cfg, "threshold", {"threshold_level": 150}).threshold_level == 150


def test_unset_skip_denoise_keeps_the_page_config_value() -> None:
    cfg = _resolved(skip_denoise=True)

    assert apply_stage_settings_to_config(cfg, "denoise", {"skip_denoise": None}).skip_denoise is True


def test_set_skip_denoise_reaches_the_config() -> None:
    cfg = _resolved(skip_denoise=False)

    assert apply_stage_settings_to_config(cfg, "denoise", {"skip_denoise": True}).skip_denoise is True


def _schema_control_keys() -> dict[str, list[str]]:
    source = SCHEMA_FILE.read_text(encoding="utf-8")
    keys_by_stage: dict[str, list[str]] = {}
    for block in re.split(r"(?=stageId: \")", source)[1:]:
        match = re.match(r'stageId: "(\w+)"', block)
        assert match is not None
        controls = block.split("controls: [", 1)[1].split("confirmLabel:", 1)[0]
        keys_by_stage[match.group(1)] = re.findall(r'\bkey: "(\w+)"', controls)
    return keys_by_stage


def test_every_review_control_is_a_real_stage_setting() -> None:
    keys_by_stage = _schema_control_keys()

    assert set(keys_by_stage) == {
        "threshold",
        "deskew",
        "denoise",
        "dewarp",
        "post_transform_crop",
        "canvas_map",
        "post_ocr_crop",
    }
    for stage_id, keys in keys_by_stage.items():
        assert set(keys) <= set(STAGE_SETTINGS_DEFAULTS.get(stage_id, {})), stage_id


def test_review_rows_use_the_runner_page_id(
    client_and_settings: tuple[TestClient, Settings],
) -> None:
    client, _ = client_and_settings

    response = client.get("/api/data/projects/proj1/project-stages/threshold/pages")

    assert response.status_code == 200, response.text
    rows = response.json()["rows"]
    assert [(row["idx"], row["prefix"], row["idx0"]) for row in rows] == [
        ("0000", "p001", 0),
        ("0012", "12", 12),
    ]


def test_rerun_saves_settings_on_each_page(
    client_and_settings: tuple[TestClient, Settings],
) -> None:
    client, settings = client_and_settings

    response = client.post(
        "/api/data/projects/proj1/project-stages/threshold/rerun",
        json={"page_ids": ["0000", "0012"], "settings": {"threshold_level": 170}},
    )

    assert response.status_code == 200, response.text
    store = _store(settings)
    assert store.get_page_override("proj1", "threshold", "0000") == {"threshold_level": 170}
    assert store.get_page_override("proj1", "threshold", "0012") == {"threshold_level": 170}


def test_rerun_keeps_other_page_settings(
    client_and_settings: tuple[TestClient, Settings],
) -> None:
    client, settings = client_and_settings
    _store(settings).save_page_override("proj1", "denoise", "0000", {"median_kernel_size": 3})

    response = client.post(
        "/api/data/projects/proj1/project-stages/denoise/rerun",
        json={"page_ids": ["0000"], "settings": {"min_component_area": 20}},
    )

    assert response.status_code == 200, response.text
    assert _store(settings).get_page_override("proj1", "denoise", "0000") == {
        "median_kernel_size": 3,
        "min_component_area": 20,
    }


def test_rerun_without_settings_writes_nothing(
    client_and_settings: tuple[TestClient, Settings],
) -> None:
    client, settings = client_and_settings

    response = client.post(
        "/api/data/projects/proj1/project-stages/threshold/rerun",
        json={"page_ids": ["0000"]},
    )

    assert response.status_code == 200, response.text
    assert _store(settings).get_page_override("proj1", "threshold", "0000") is None
    assert _queued_rerun_jobs(settings) == ["0000"]


def test_rerun_rejects_an_unknown_setting_before_queueing(
    client_and_settings: tuple[TestClient, Settings],
) -> None:
    client, settings = client_and_settings

    response = client.post(
        "/api/data/projects/proj1/project-stages/threshold/rerun",
        json={"page_ids": ["0000"], "settings": {"method": "sauvola"}},
    )

    assert response.status_code == 422
    assert "method" in response.json()["message"]
    assert _store(settings).get_page_override("proj1", "threshold", "0000") is None
    assert _queued_rerun_jobs(settings) == []


def _run_threshold_after_rerun(client: TestClient, settings: Settings, level: int) -> str:
    response = client.post(
        "/api/data/projects/proj1/project-stages/threshold/rerun",
        json={"page_ids": ["0000"], "settings": {"threshold_level": level}},
    )
    assert response.status_code == 200, response.text

    async def go() -> None:
        db = SqliteDatabase(settings.derived_database_url)
        await db.initialize()
        try:
            await run_stage(
                data_root=settings.data_root,
                database=db,
                project_id="proj1",
                page_id="0000",
                stage_id="threshold",
            )
        finally:
            await db.close()

    asyncio.run(go())
    path = stage_artifact_path(settings.data_root, "proj1", "0000", "threshold")
    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_changing_threshold_level_changes_the_output(
    client_and_settings: tuple[TestClient, Settings],
) -> None:
    client, settings = client_and_settings

    async def seed_parent() -> None:
        db = SqliteDatabase(settings.derived_database_url)
        await db.initialize()
        try:
            await db.init_page_stages_for_page("proj1", "0000")
            await commit_stage_artifact(
                data_root=settings.data_root,
                database=db,
                project_id="proj1",
                page_id="0000",
                stage_id="crop",
                artifact_bytes=_gradient_png(),
            )
        finally:
            await db.close()

    asyncio.run(seed_parent())

    low = _run_threshold_after_rerun(client, settings, 40)
    high = _run_threshold_after_rerun(client, settings, 200)
    low_again = _run_threshold_after_rerun(client, settings, 40)

    assert low != high
    assert low == low_again


async def _commit_clean(settings: Settings, stage_id: str) -> float:
    db = SqliteDatabase(settings.derived_database_url)
    await db.initialize()
    try:
        _ = await db.init_page_stages_for_page("proj1", "0000")
        state = await commit_stage_artifact(
            data_root=settings.data_root,
            database=db,
            project_id="proj1",
            page_id="0000",
            stage_id=stage_id,
            artifact_bytes=_gradient_png(),
        )
    finally:
        await db.close()
    assert state.last_run_at is not None
    return state.last_run_at


def _first_row(client: TestClient, stage_id: str) -> dict[str, object]:
    response = client.get(f"/api/data/projects/proj1/project-stages/{stage_id}/pages")
    assert response.status_code == 200, response.text
    rows: list[dict[str, object]] = response.json()["rows"]
    return rows[0]


def test_clean_page_row_links_stage_and_parent_images(
    client_and_settings: tuple[TestClient, Settings],
) -> None:
    client, settings = client_and_settings
    parent_run = asyncio.run(_commit_clean(settings, "crop"))
    stage_run = asyncio.run(_commit_clean(settings, "threshold"))

    row = _first_row(client, "threshold")

    base = "/api/data/projects/proj1/pages/0/stages"
    assert row["thumbUrl"] == f"{base}/threshold/thumbnail?v={stage_run}"
    assert row["afterUrl"] == f"{base}/threshold/artifact?v={stage_run}"
    assert row["beforeUrl"] == f"{base}/crop/artifact?v={parent_run}"


def test_page_without_stage_output_shows_the_parent_image(
    client_and_settings: tuple[TestClient, Settings],
) -> None:
    client, settings = client_and_settings
    parent_run = asyncio.run(_commit_clean(settings, "crop"))

    row = _first_row(client, "threshold")

    assert "afterUrl" not in row
    assert row["thumbUrl"] == f"/api/data/projects/proj1/pages/0/stages/crop/thumbnail?v={parent_run}"


def test_page_with_no_outputs_has_no_image_links(
    client_and_settings: tuple[TestClient, Settings],
) -> None:
    client, _ = client_and_settings

    row = _first_row(client, "threshold")

    assert not {"thumbUrl", "afterUrl", "beforeUrl"} & row.keys()


def test_rerun_response_keeps_page_identity_and_image_links(
    client_and_settings: tuple[TestClient, Settings],
) -> None:
    client, settings = client_and_settings
    parent_run = asyncio.run(_commit_clean(settings, "crop"))
    _ = asyncio.run(_commit_clean(settings, "threshold"))

    response = client.post(
        "/api/data/projects/proj1/project-stages/threshold/rerun",
        json={"page_ids": ["0000"]},
    )

    assert response.status_code == 200, response.text
    row = response.json()["rows"][0]
    assert (row["idx"], row["prefix"], row["idx0"], row["state"]) == ("0000", "p001", 0, "flagged")
    assert "afterUrl" not in row
    assert row["beforeUrl"] == f"/api/data/projects/proj1/pages/0/stages/crop/artifact?v={parent_run}"


@pytest.mark.parametrize(
    ("stage_id", "values"),
    [
        ("threshold", {"threshold_level": 150}),
        ("deskew", {"skip_auto_deskew": False}),
        ("denoise", {"min_component_area": 20}),
    ],
)
def test_each_tier_is_reported_as_the_setting_source(
    client_and_settings: tuple[TestClient, Settings],
    stage_id: str,
    values: dict[str, object],
) -> None:
    client, _ = client_and_settings
    key, value = next(iter(values.items()))
    resolved = f"/api/data/projects/proj1/pages/0/stages/{stage_id}/settings/resolved"

    assert client.get(resolved).json()["sources"][key] == "registry"

    assert client.put(f"/api/data/settings/stages/{stage_id}", json=values).status_code == 200
    assert client.get(resolved).json()["sources"][key] == "all"

    assert client.put(f"/api/data/projects/proj1/stages/{stage_id}/settings", json=values).status_code == 200
    assert client.get(resolved).json()["sources"][key] == "project"

    page = f"/api/data/projects/proj1/pages/0/stages/{stage_id}/settings/page"
    assert client.put(page, json=values).status_code == 200
    body = client.get(resolved).json()
    assert body["sources"][key] == "page"
    assert body["effective"][key] == value

    other_page = client.get(f"/api/data/projects/proj1/pages/12/stages/{stage_id}/settings/resolved")
    assert other_page.json()["sources"][key] == "project"
