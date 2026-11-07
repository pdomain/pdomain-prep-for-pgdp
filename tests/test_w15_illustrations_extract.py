"""W1.5 — illustrations crops are packed under images/."""

from __future__ import annotations

import io
import json
import zipfile
from datetime import UTC, datetime
from pathlib import Path

import cv2
import numpy as np
import pytest

from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pdomain_prep_for_pgdp.core.models import (
    IllustrationRegion,
    PageProcessingStatus,
    PageRecord,
    PageStageStatus,
    PageType,
    Project,
    ProjectConfig,
    ProjectStatus,
)
from pdomain_prep_for_pgdp.core.page_service_helpers import update_page_extension
from pdomain_prep_for_pgdp.core.page_store_factory import build_page_service
from pdomain_prep_for_pgdp.core.pipeline.stage_registry import (
    _illustrations_v2_cpu,
    default_resolved_page_config,
)
from pdomain_prep_for_pgdp.core.pipeline.stage_runner import run_stage
from pdomain_prep_for_pgdp.core.pipeline.steps.build_package import build_submission_zip
from tests.fixtures.seed_pages import seed_pages_in_store


def _image() -> np.ndarray:
    image = np.zeros((40, 60, 3), dtype=np.uint8)
    image[:, :] = (240, 240, 240)
    image[5:25, 10:40] = (0, 0, 180)
    return image


def _png_bytes() -> bytes:
    ok, buf = cv2.imencode(".png", _image())
    assert ok
    return bytes(buf.tobytes())


def test_callable_writes_crop_and_primary_manifest() -> None:
    cfg = default_resolved_page_config().model_copy(
        update={
            "illustration_regions": [
                IllustrationRegion(index=3, L=10, T=5, R=40, B=25, output_format="jpg"),
            ]
        }
    )
    files = _illustrations_v2_cpu(_image(), cfg)
    assert "crops.json" in files
    assert "regions.json" in files
    assert "i_01.jpg" in files
    manifest = json.loads(files["crops.json"])
    assert manifest["crops"][0]["file"] == "i_01.jpg"
    assert manifest["crops"][0]["index"] == 3
    decoded = cv2.imdecode(np.frombuffer(files["i_01.jpg"], np.uint8), cv2.IMREAD_COLOR)
    assert decoded is not None
    assert decoded.shape[0] == 20
    assert decoded.shape[1] == 30


def test_plate_page_crops_without_a_saved_region() -> None:
    cfg = default_resolved_page_config().model_copy(
        update={"page_type": PageType.plate_p, "illustration_regions": []}
    )
    files = _illustrations_v2_cpu(_image(), cfg)
    assert "i_01.jpg" in files
    manifest = json.loads(files["crops.json"])
    assert manifest["crops"][0]["R"] == 60
    assert manifest["crops"][0]["B"] == 40


def test_v2_crop_dir_is_packed_and_legacy_dir_still_works(tmp_path: Path) -> None:
    project_id = "w15pack"
    page_id = "0001"
    stages = tmp_path / "projects" / project_id / "pages" / page_id / "stages"
    current = stages / "illustrations"
    legacy = stages / "extract_illustrations"
    current.mkdir(parents=True)
    legacy.mkdir()
    _ = (current / "crops.json").write_text(
        json.dumps({"crops": [{"file": "i_01.jpg", "index": 1}]}),
    )
    _ = (current / "i_01.jpg").write_bytes(b"\xff\xd8\xff\xd9")
    _ = (legacy / "old.jpg").write_bytes(b"\xff\xd8\xff\xd9")
    _ = (stages / "canvas_map").mkdir()
    _ = (stages / "canvas_map" / "output.png").write_bytes(b"png")
    _ = (stages / "text_review").mkdir()
    _ = (stages / "text_review" / "output.txt").write_text("Hello\n")

    packed = build_submission_zip(
        project_id=project_id,
        page_ids=[page_id],
        data_root=tmp_path,
        page_prefixes={page_id: "p001"},
        built_at="2026-11-06T00:00:00+00:00",
    )
    with zipfile.ZipFile(io.BytesIO(packed)) as archive:
        names = archive.namelist()
    assert "images/p001_01.jpg" in names
    assert "images/p001_02.jpg" not in names


def _page_stages(tmp_path: Path, project_id: str, page_id: str) -> Path:
    stages = tmp_path / "projects" / project_id / "pages" / page_id / "stages"
    for name in ("canvas_map", "text_review"):
        directory = stages / name
        directory.mkdir(parents=True)
        if name == "canvas_map":
            _ = (directory / "output.png").write_bytes(b"png")
        else:
            _ = (directory / "output.txt").write_text("Hello\n")
    return stages


def _zip_names(
    tmp_path: Path,
    project_id: str,
    page_id: str,
) -> list[str]:
    packed = build_submission_zip(
        project_id=project_id,
        page_ids=[page_id],
        data_root=tmp_path,
        page_prefixes={page_id: "p001"},
        built_at="2026-11-06T00:00:00+00:00",
    )
    with zipfile.ZipFile(io.BytesIO(packed)) as archive:
        return archive.namelist()


def test_crops_manifest_packs_named_files_and_skips_leftovers(tmp_path: Path) -> None:
    project_id = "w15manifest"
    page_id = "0001"
    stages = _page_stages(tmp_path, project_id, page_id)
    current = stages / "illustrations"
    legacy = stages / "extract_illustrations"
    current.mkdir()
    legacy.mkdir()
    _ = (current / "crops.json").write_text(
        json.dumps({"crops": [{"file": "i_01.png", "index": 1}]}),
    )
    _ = (current / "i_01.png").write_bytes(b"\x89PNG\r\n")
    _ = (current / "i_02.png").write_bytes(b"\x89PNG\r\nleftover")
    _ = (legacy / "old.jpg").write_bytes(b"\xff\xd8\xff\xd9")

    names = _zip_names(tmp_path, project_id, page_id)
    assert "images/p001_01.png" in names
    assert "images/p001_02.png" not in names
    assert "images/p001_01.jpg" not in names


def test_empty_crops_manifest_does_not_pack_legacy_files(tmp_path: Path) -> None:
    project_id = "w15empty"
    page_id = "0001"
    stages = _page_stages(tmp_path, project_id, page_id)
    current = stages / "illustrations"
    legacy = stages / "extract_illustrations"
    current.mkdir()
    legacy.mkdir()
    _ = (current / "crops.json").write_text('{"crops":[]}')
    _ = (legacy / "old.jpg").write_bytes(b"\xff\xd8\xff\xd9")

    names = _zip_names(tmp_path, project_id, page_id)
    assert not any(name.startswith("images/") for name in names)


def test_legacy_crops_pack_when_the_v2_manifest_is_absent(tmp_path: Path) -> None:
    project_id = "w15legacy"
    page_id = "0001"
    stages = _page_stages(tmp_path, project_id, page_id)
    legacy = stages / "extract_illustrations"
    legacy.mkdir(parents=True)
    _ = (legacy / "old.jpg").write_bytes(b"\xff\xd8\xff\xd9")

    names = _zip_names(tmp_path, project_id, page_id)
    assert "images/p001_01.jpg" in names


@pytest.mark.asyncio
async def test_runner_crop_is_in_the_submission_zip(tmp_path: Path) -> None:
    project_id, page_id = "w15", "0000"
    db = SqliteDatabase(f"sqlite:///{(tmp_path / 's.db').as_posix()}")
    await db.initialize()
    now = datetime.now(UTC)
    await db.put_project(
        Project(
            id=project_id,
            owner_id="default",
            name="w15",
            created_at=now,
            updated_at=now,
            status=ProjectStatus.processing,
            page_count=1,
            proof_page_count=1,
            config=ProjectConfig(book_name="w15", source_uri=""),
            storage_prefix=f"projects/{project_id}/",
        )
    )
    region = IllustrationRegion(index=1, L=10, T=5, R=40, B=25, output_format="png")
    seed_pages_in_store(
        tmp_path,
        project_id,
        [
            PageRecord(
                project_id=project_id,
                idx0=0,
                prefix="p001",
                source_stem="s",
                processing_status=PageProcessingStatus.pending,
                illustration_regions=[region],
            )
        ],
    )
    service = build_page_service(tmp_path, project_id)
    blob_hash = service.blobs.write(_png_bytes())
    updated = update_page_extension(service, project_id, 0, source_blob_hash=blob_hash)
    assert updated is not None
    assert updated.illustration_regions[0].L == 10
    await db.init_page_stages_for_page(project_id, page_id)
    stage_dir = tmp_path / "projects" / project_id / "pages" / page_id / "stages" / "illustrations"
    stage_dir.mkdir(parents=True)
    _ = (stage_dir / "i_99.png").write_bytes(b"stale-crop")
    state = await run_stage(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=page_id,
        stage_id="illustrations",
    )
    assert state.status == PageStageStatus.clean, state.error_message
    stage_dir = tmp_path / "projects" / project_id / "pages" / page_id / "stages" / "illustrations"
    assert (stage_dir / "crops.json").is_file()
    assert (stage_dir / "i_01.png").is_file()
    assert not (stage_dir / "i_99.png").is_file()
    assert "crops.json" in (state.artifact_key or "")

    _ = (stage_dir.parent / "canvas_map").mkdir()
    _ = (stage_dir.parent / "canvas_map" / "output.png").write_bytes(b"png")
    _ = (stage_dir.parent / "text_review").mkdir()
    _ = (stage_dir.parent / "text_review" / "output.txt").write_text("page\n")
    packed = build_submission_zip(
        project_id=project_id,
        page_ids=[page_id],
        data_root=tmp_path,
        page_prefixes={page_id: "p001"},
        built_at="2026-11-06T00:00:00+00:00",
    )
    with zipfile.ZipFile(io.BytesIO(packed)) as archive:
        names = archive.namelist()
        crop = archive.read("images/p001_01.png")
    assert "images/p001_01.png" in names
    assert crop == (stage_dir / "i_01.png").read_bytes()
    await db.close()
