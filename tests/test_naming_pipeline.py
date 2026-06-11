"""Tests for the naming pipeline: skip/cover PageType, naming manifest, build_package wiring.

TDD-first for:
  1. compute_prefix with skip and cover PageType values
  2. assign_prefixes with skip (ignore=True) and cover (c-prefix)
  3. materialize_naming_manifest: JSON schema, skip_ids, prefix computation
  4. load_naming_manifest: present, absent, wrong version
  5. build_submission_zip: skip pages excluded from zip
  6. build_package_v2_cpu: loads manifest from disk when page_prefixes=None
  7. Route-level: PATCH page_type=skip → page_order stale → re-run regenerates manifest
"""

from __future__ import annotations

import json
import zipfile
from datetime import UTC, datetime
from pathlib import Path  # noqa: TC003  # used at runtime (tmp_path construction)

import pytest

from pdomain_prep_for_pgdp.core.models import (
    PageRecord,
    PageType,
    PipelineState,
    Project,
    ProjectConfig,
    ProjectStatus,
)
from pdomain_prep_for_pgdp.core.prefix import compute_prefix

# ─── helpers ──────────────────────────────────────────────────────────────────


def _cfg(
    *,
    proof_start: int = 0,
    proof_end: int = 10,
    fm_start: int = 0,
    fm_end: int = 2,
    bm_start: int = 3,
    bm_end: int = 10,
    fm_nbr_start: int = 1,
    bm_nbr_start: int = 1,
) -> ProjectConfig:
    return ProjectConfig(
        book_name="test",
        source_uri="",
        proof_start_idx0=proof_start,
        proof_end_idx0=proof_end,
        frontmatter_start_idx0=fm_start,
        frontmatter_end_idx0=fm_end,
        bodymatter_start_idx0=bm_start,
        bodymatter_end_idx0=bm_end,
        frontmatter_page_nbr_start=fm_nbr_start,
        bodymatter_page_nbr_start=bm_nbr_start,
    )


def _page(project_id: str, idx0: int, page_type: PageType = PageType.normal) -> PageRecord:
    return PageRecord(
        project_id=project_id,
        idx0=idx0,
        prefix="",
        source_stem=f"src_{idx0:03d}",
        page_type=page_type,
    )


def _project(project_id: str = "p1", **cfg_kwargs) -> Project:
    now = datetime.now(UTC)
    return Project(
        id=project_id,
        owner_id="default",
        name="t",
        created_at=now,
        updated_at=now,
        status=ProjectStatus.configuring,
        page_count=0,
        proof_page_count=0,
        config=ProjectConfig(book_name="t", source_uri="", **cfg_kwargs),
        pipeline_state=PipelineState(),
        storage_prefix=f"projects/{project_id}/",
    )


# ─── 1. compute_prefix: skip and cover ────────────────────────────────────────


class TestComputePrefixSkipCover:
    def test_skip_returns_none_inside_proof_range(self) -> None:
        cfg = _cfg(proof_start=0, proof_end=5, fm_start=0, fm_end=2, bm_start=3, bm_end=5)
        pages = {2: _page("p", 2, PageType.skip)}
        assert compute_prefix(2, cfg, pages) is None

    def test_skip_outside_range_also_none(self) -> None:
        cfg = _cfg(proof_start=0, proof_end=3, fm_start=0, fm_end=1, bm_start=2, bm_end=3)
        pages = {5: _page("p", 5, PageType.skip)}
        assert compute_prefix(5, cfg, pages) is None

    def test_cover_returns_c_prefix(self) -> None:
        cfg = _cfg(proof_start=0, proof_end=5, fm_start=0, fm_end=2, bm_start=3, bm_end=5)
        pages = {0: _page("p", 0, PageType.cover)}
        result = compute_prefix(0, cfg, pages)
        assert result is not None
        assert result.startswith("c")

    def test_cover_numbered_c001(self) -> None:
        cfg = _cfg(proof_start=0, proof_end=5, fm_start=0, fm_end=2, bm_start=3, bm_end=5)
        pages = {0: _page("p", 0, PageType.cover)}
        assert compute_prefix(0, cfg, pages) == "c001"

    def test_multiple_cover_pages_get_sequential_c_numbers(self) -> None:
        cfg = _cfg(proof_start=0, proof_end=5, fm_start=0, fm_end=2, bm_start=3, bm_end=5)
        pages = {
            0: _page("p", 0, PageType.cover),
            1: _page("p", 1, PageType.cover),
        }
        assert compute_prefix(0, cfg, pages) == "c001"
        assert compute_prefix(1, cfg, pages) == "c002"

    def test_cover_does_not_consume_frontmatter_number(self) -> None:
        """Cover page before frontmatter should not shift f001 → f002."""
        cfg = _cfg(proof_start=0, proof_end=5, fm_start=0, fm_end=2, bm_start=3, bm_end=5)
        pages = {
            0: _page("p", 0, PageType.cover),
            1: _page("p", 1, PageType.normal),  # first fm page
            2: _page("p", 2, PageType.normal),
        }
        assert compute_prefix(0, cfg, pages) == "c001"
        # Frontmatter numbering should start at f001 (cover not counted in fm run)
        assert compute_prefix(1, cfg, pages) == "f001"
        assert compute_prefix(2, cfg, pages) == "f002"

    def test_normal_blank_unchanged(self) -> None:
        """Ensure existing normal/blank behavior is not regressed.

        The existing compute_prefix has a known off-by-one: bodymatter_page_nbr_start=1
        produces "p000" for the first body page (not "p001"). This is preserved
        and must not be changed by the skip/cover additions.
        """
        cfg = _cfg(proof_start=0, proof_end=4, fm_start=0, fm_end=1, bm_start=2, bm_end=4)
        pages = {
            0: _page("p", 0, PageType.normal),
            1: _page("p", 1, PageType.blank),
            2: _page("p", 2, PageType.normal),
        }
        assert compute_prefix(0, cfg, pages) == "f001"
        assert compute_prefix(1, cfg, pages) == "f002"
        # Known existing behavior: first bodymatter page with bm_nbr_start=1 → "p000"
        assert compute_prefix(2, cfg, pages) == "p000"

    def test_plate_suffix_unchanged(self) -> None:
        cfg = _cfg(proof_start=0, proof_end=3, fm_start=0, fm_end=0, bm_start=1, bm_end=3)
        pages = {
            0: _page("p", 0, PageType.normal),
            1: _page("p", 1, PageType.normal),
            2: _page("p", 2, PageType.plate_p),
            3: _page("p", 3, PageType.normal),
        }
        assert compute_prefix(2, cfg, pages) is not None
        assert compute_prefix(2, cfg, pages).endswith("p")  # type: ignore[union-attr]


# ─── 2. assign_prefixes: skip + cover ─────────────────────────────────────────


@pytest.mark.asyncio
async def test_assign_prefixes_skip_gets_empty_prefix_and_ignore(tmp_path: Path) -> None:
    from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
    from pdomain_prep_for_pgdp.core.assign_prefixes import assign_prefixes
    from pdomain_prep_for_pgdp.core.page_service_helpers import list_page_records
    from pdomain_prep_for_pgdp.core.page_store_factory import build_page_service
    from pdomain_prep_for_pgdp.settings import Settings
    from tests.fixtures.seed_pages import seed_pages_in_store

    project = _project(
        "p1",
        proof_start_idx0=0,
        proof_end_idx0=3,
        frontmatter_start_idx0=0,
        frontmatter_end_idx0=1,
        bodymatter_start_idx0=2,
        bodymatter_end_idx0=3,
    )
    settings = Settings(
        host="127.0.0.1",
        port=8765,
        data_root=tmp_path / "data",
        config_dir=tmp_path / "config",
        storage_backend="filesystem",
        database_url=f"sqlite:///{(tmp_path / 's.db').as_posix()}",
        auth_mode="none",
        gpu_backend="cpu",
        dispatch_interval_seconds=0,
    )
    db = SqliteDatabase(f"sqlite:///{(tmp_path / 's.db').as_posix()}")
    await db.initialize()
    await db.put_project(project)
    seed_pages_in_store(
        settings,
        project.id,
        [
            _page(project.id, 0, PageType.skip),  # inside proof range — should be ignored
            _page(project.id, 1, PageType.normal),
            _page(project.id, 2, PageType.normal),
            _page(project.id, 3, PageType.normal),
        ],
    )
    svc = build_page_service(settings.data_root, project.id)
    await assign_prefixes(project=project, page_service=svc)
    result = list_page_records(svc, project.id)
    by_idx = {p.idx0: p for p in result}
    # skip page: prefix="" and ignore=True despite being inside proof range
    assert by_idx[0].ignore is True
    assert by_idx[0].prefix == ""
    # normal pages: prefix non-empty and ignore=False
    assert by_idx[1].ignore is False
    assert by_idx[1].prefix != ""


@pytest.mark.asyncio
async def test_assign_prefixes_cover_gets_c_prefix(tmp_path: Path) -> None:
    from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
    from pdomain_prep_for_pgdp.core.assign_prefixes import assign_prefixes
    from pdomain_prep_for_pgdp.core.page_service_helpers import list_page_records
    from pdomain_prep_for_pgdp.core.page_store_factory import build_page_service
    from pdomain_prep_for_pgdp.settings import Settings
    from tests.fixtures.seed_pages import seed_pages_in_store

    project = _project(
        "p2",
        proof_start_idx0=0,
        proof_end_idx0=3,
        frontmatter_start_idx0=0,
        frontmatter_end_idx0=1,
        bodymatter_start_idx0=2,
        bodymatter_end_idx0=3,
    )
    settings = Settings(
        host="127.0.0.1",
        port=8765,
        data_root=tmp_path / "data",
        config_dir=tmp_path / "config",
        storage_backend="filesystem",
        database_url=f"sqlite:///{(tmp_path / 's.db').as_posix()}",
        auth_mode="none",
        gpu_backend="cpu",
        dispatch_interval_seconds=0,
    )
    db = SqliteDatabase(f"sqlite:///{(tmp_path / 's.db').as_posix()}")
    await db.initialize()
    await db.put_project(project)
    seed_pages_in_store(
        settings,
        project.id,
        [
            _page(project.id, 0, PageType.cover),
            _page(project.id, 1, PageType.normal),
            _page(project.id, 2, PageType.normal),
            _page(project.id, 3, PageType.normal),
        ],
    )
    svc = build_page_service(settings.data_root, project.id)
    await assign_prefixes(project=project, page_service=svc)
    result = list_page_records(svc, project.id)
    by_idx = {p.idx0: p for p in result}
    assert by_idx[0].prefix == "c001"
    assert by_idx[0].ignore is False
    # frontmatter pages should start at f001 (cover not counted in fm run)
    assert by_idx[1].prefix.startswith("f")


# ─── 3. materialize_naming_manifest ───────────────────────────────────────────


class TestMaterializeNamingManifest:
    def _pages_and_cfg(self) -> tuple[list[PageRecord], ProjectConfig]:
        cfg = _cfg(
            proof_start=0,
            proof_end=4,
            fm_start=0,
            fm_end=1,
            bm_start=2,
            bm_end=4,
        )
        pages = [
            _page("proj", 0, PageType.cover),
            _page("proj", 1, PageType.normal),
            _page("proj", 2, PageType.normal),
            _page("proj", 3, PageType.skip),
            _page("proj", 4, PageType.blank),
        ]
        return pages, cfg

    def test_returns_json_bytes(self, tmp_path: Path) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.steps.page_order import materialize_naming_manifest

        pages, cfg = self._pages_and_cfg()
        result = materialize_naming_manifest("proj", pages, cfg, tmp_path)
        parsed = json.loads(result)
        assert parsed["version"] == 1
        assert "pages" in parsed
        assert "skip_ids" in parsed

    def test_pages_array_length_matches_input(self, tmp_path: Path) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.steps.page_order import materialize_naming_manifest

        pages, cfg = self._pages_and_cfg()
        parsed = json.loads(materialize_naming_manifest("proj", pages, cfg, tmp_path))
        assert len(parsed["pages"]) == len(pages)

    def test_skip_page_has_null_prefix(self, tmp_path: Path) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.steps.page_order import materialize_naming_manifest

        pages, cfg = self._pages_and_cfg()
        parsed = json.loads(materialize_naming_manifest("proj", pages, cfg, tmp_path))
        skip_entry = next(e for e in parsed["pages"] if e["role"] == "skip")
        assert skip_entry["prefix"] is None

    def test_skip_ids_populated(self, tmp_path: Path) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.steps.page_order import materialize_naming_manifest

        pages, cfg = self._pages_and_cfg()
        parsed = json.loads(materialize_naming_manifest("proj", pages, cfg, tmp_path))
        # idx0=3 is skip, page_id = "0003"
        assert "0003" in parsed["skip_ids"]

    def test_cover_page_has_c_prefix(self, tmp_path: Path) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.steps.page_order import materialize_naming_manifest

        pages, cfg = self._pages_and_cfg()
        parsed = json.loads(materialize_naming_manifest("proj", pages, cfg, tmp_path))
        cover_entry = next(e for e in parsed["pages"] if e["role"] == "cover")
        assert cover_entry["prefix"] is not None
        assert cover_entry["prefix"].startswith("c")

    def test_normal_pages_have_f_or_p_prefix(self, tmp_path: Path) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.steps.page_order import materialize_naming_manifest

        pages, cfg = self._pages_and_cfg()
        parsed = json.loads(materialize_naming_manifest("proj", pages, cfg, tmp_path))
        normal_entries = [e for e in parsed["pages"] if e["role"] == "normal"]
        for e in normal_entries:
            assert e["prefix"] is not None
            assert e["prefix"][0] in ("f", "p")

    def test_page_id_field_format(self, tmp_path: Path) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.steps.page_order import materialize_naming_manifest

        pages, cfg = self._pages_and_cfg()
        parsed = json.loads(materialize_naming_manifest("proj", pages, cfg, tmp_path))
        for e in parsed["pages"]:
            assert len(e["page_id"]) == 4
            assert e["page_id"].isdigit()

    def test_idx0_present(self, tmp_path: Path) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.steps.page_order import materialize_naming_manifest

        pages, cfg = self._pages_and_cfg()
        parsed = json.loads(materialize_naming_manifest("proj", pages, cfg, tmp_path))
        for i, e in enumerate(parsed["pages"]):
            assert e["idx0"] == pages[i].idx0


# ─── 4. load_naming_manifest ──────────────────────────────────────────────────


class TestLoadNamingManifest:
    def _write_manifest(self, path: Path, manifest: dict) -> None:
        manifest_path = path / "projects" / "proj" / "stages" / "page_order" / "output.json"
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        manifest_path.write_text(json.dumps(manifest))

    def test_load_valid_manifest(self, tmp_path: Path) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.steps.page_order import (
            MANIFEST_VERSION,
            load_naming_manifest,
        )

        self._write_manifest(
            tmp_path,
            {
                "version": MANIFEST_VERSION,
                "pages": [
                    {"page_id": "0001", "idx0": 1, "role": "normal", "prefix": "f001"},
                    {"page_id": "0002", "idx0": 2, "role": "skip", "prefix": None},
                ],
                "skip_ids": ["0002"],
            },
        )
        manifest = load_naming_manifest(tmp_path, "proj")
        assert manifest.version == MANIFEST_VERSION
        assert len(manifest.pages) == 2
        assert "0002" in manifest.skip_set()
        assert manifest.page_prefixes() == {"0001": "f001"}

    def test_missing_manifest_raises(self, tmp_path: Path) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.steps.page_order import (
            MissingNamingManifest,
            load_naming_manifest,
        )

        with pytest.raises(MissingNamingManifest):
            load_naming_manifest(tmp_path, "nonexistent_project")

    def test_wrong_version_raises(self, tmp_path: Path) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.steps.page_order import (
            MissingNamingManifest,
            load_naming_manifest,
        )

        self._write_manifest(
            tmp_path,
            {"version": 99, "pages": [], "skip_ids": []},
        )
        with pytest.raises(MissingNamingManifest):
            load_naming_manifest(tmp_path, "proj")

    def test_invalid_json_raises(self, tmp_path: Path) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.steps.page_order import (
            MissingNamingManifest,
            load_naming_manifest,
        )

        bad_path = tmp_path / "projects" / "proj" / "stages" / "page_order" / "output.json"
        bad_path.parent.mkdir(parents=True, exist_ok=True)
        bad_path.write_text("NOT VALID JSON{{{")
        with pytest.raises(MissingNamingManifest):
            load_naming_manifest(tmp_path, "proj")

    def test_page_prefixes_excludes_none_prefix_entries(self, tmp_path: Path) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.steps.page_order import (
            MANIFEST_VERSION,
            load_naming_manifest,
        )

        self._write_manifest(
            tmp_path,
            {
                "version": MANIFEST_VERSION,
                "pages": [
                    {"page_id": "0001", "idx0": 1, "role": "normal", "prefix": "f001"},
                    {"page_id": "0002", "idx0": 2, "role": "skip", "prefix": None},
                    {"page_id": "0003", "idx0": 3, "role": "cover", "prefix": "c001"},
                ],
                "skip_ids": ["0002"],
            },
        )
        manifest = load_naming_manifest(tmp_path, "proj")
        prefixes = manifest.page_prefixes()
        assert "0001" in prefixes
        assert "0003" in prefixes
        assert "0002" not in prefixes


# ─── 5. build_submission_zip: skip pages excluded ─────────────────────────────


class TestBuildSubmissionZipSkip:
    def _write_page_artifacts(self, data_root: Path, project_id: str, page_ids: list[str]) -> None:
        for pid in page_ids:
            page_base = data_root / "projects" / project_id / "pages" / pid / "stages"
            (page_base / "canvas_map").mkdir(parents=True, exist_ok=True)
            (page_base / "text_review").mkdir(parents=True, exist_ok=True)
            (page_base / "canvas_map" / "output.png").write_bytes(b"FAKE_PNG")
            (page_base / "text_review" / "output.txt").write_text("text")

    def test_skip_pages_not_in_zip(self, tmp_path: Path) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.steps.build_package import build_submission_zip

        data_root = tmp_path / "data"
        page_ids = ["0001", "0002", "0003"]
        self._write_page_artifacts(data_root, "proj", page_ids)

        result = build_submission_zip(
            project_id="proj",
            page_ids=page_ids,
            data_root=data_root,
            book_name="test",
            page_prefixes={"0001": "f001", "0002": "f002", "0003": "f003"},
            skip_ids=frozenset({"0002"}),
            built_at="2026-01-01T00:00:00+00:00",
        )

        import io

        with zipfile.ZipFile(io.BytesIO(result)) as zf:
            names = zf.namelist()

        assert "f001.png" in names
        assert "f003.png" in names
        # skip page f002 must NOT appear
        assert "f002.png" not in names
        assert "f002.txt" not in names

    def test_non_skip_pages_all_in_zip(self, tmp_path: Path) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.steps.build_package import build_submission_zip

        data_root = tmp_path / "data"
        page_ids = ["0001", "0002"]
        self._write_page_artifacts(data_root, "proj", page_ids)

        result = build_submission_zip(
            project_id="proj",
            page_ids=page_ids,
            data_root=data_root,
            page_prefixes={"0001": "f001", "0002": "f002"},
            skip_ids=frozenset(),
            built_at="2026-01-01T00:00:00+00:00",
        )
        import io

        with zipfile.ZipFile(io.BytesIO(result)) as zf:
            names = zf.namelist()
        assert "f001.png" in names
        assert "f002.png" in names

    def test_cover_page_named_c001_in_zip(self, tmp_path: Path) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.steps.build_package import build_submission_zip

        data_root = tmp_path / "data"
        page_ids = ["0000", "0001"]
        self._write_page_artifacts(data_root, "proj", page_ids)

        result = build_submission_zip(
            project_id="proj",
            page_ids=page_ids,
            data_root=data_root,
            page_prefixes={"0000": "c001", "0001": "f001"},
            skip_ids=frozenset(),
            built_at="2026-01-01T00:00:00+00:00",
        )
        import io

        with zipfile.ZipFile(io.BytesIO(result)) as zf:
            names = zf.namelist()
        assert "c001.png" in names
        assert "f001.png" in names


# ─── 6. build_package_v2_cpu loads manifest from disk ─────────────────────────


class TestBuildPackageV2CpuManifestIntegration:
    def _write_page_artifacts(self, data_root: Path, project_id: str, page_ids: list[str]) -> None:
        for pid in page_ids:
            page_base = data_root / "projects" / project_id / "pages" / pid / "stages"
            (page_base / "canvas_map").mkdir(parents=True, exist_ok=True)
            (page_base / "text_review").mkdir(parents=True, exist_ok=True)
            (page_base / "canvas_map" / "output.png").write_bytes(b"FAKE_PNG")
            (page_base / "text_review" / "output.txt").write_text("text")

    def _write_naming_manifest(self, data_root: Path, project_id: str, manifest: dict) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.steps.page_order import MANIFEST_VERSION

        path = data_root / "projects" / project_id / "stages" / "page_order" / "output.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({**{"version": MANIFEST_VERSION}, **manifest}))

    def test_loads_manifest_and_excludes_skip(self, tmp_path: Path) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.steps.build_package import build_package_v2_cpu

        data_root = tmp_path / "data"
        page_ids = ["0001", "0002", "0003"]
        self._write_page_artifacts(data_root, "proj", page_ids)
        self._write_naming_manifest(
            data_root,
            "proj",
            {
                "pages": [
                    {"page_id": "0001", "idx0": 1, "role": "normal", "prefix": "f001"},
                    {"page_id": "0002", "idx0": 2, "role": "skip", "prefix": None},
                    {"page_id": "0003", "idx0": 3, "role": "normal", "prefix": "p001"},
                ],
                "skip_ids": ["0002"],
            },
        )
        result = build_package_v2_cpu(
            project_id="proj",
            page_ids=page_ids,
            data_root=data_root,
            book_name="test",
            built_at="2026-01-01T00:00:00+00:00",
        )
        import io

        with zipfile.ZipFile(io.BytesIO(result)) as zf:
            names = zf.namelist()
        assert "f001.png" in names
        assert "p001.png" in names
        assert "0002.png" not in names

    def test_raises_missing_manifest_when_no_manifest(self, tmp_path: Path) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.steps.build_package import build_package_v2_cpu
        from pdomain_prep_for_pgdp.core.pipeline.steps.page_order import MissingNamingManifest

        data_root = tmp_path / "data"
        with pytest.raises(MissingNamingManifest):
            build_package_v2_cpu(
                project_id="missing_proj",
                page_ids=["0001"],
                data_root=data_root,
            )

    def test_explicit_page_prefixes_bypass_manifest(self, tmp_path: Path) -> None:
        """Passing page_prefixes explicitly bypasses manifest loading (legacy/test path)."""
        from pdomain_prep_for_pgdp.core.pipeline.steps.build_package import build_package_v2_cpu

        data_root = tmp_path / "data"
        page_ids = ["0001"]
        self._write_page_artifacts(data_root, "proj", page_ids)
        # No manifest file — should not raise because page_prefixes is explicit
        result = build_package_v2_cpu(
            project_id="proj",
            page_ids=page_ids,
            data_root=data_root,
            page_prefixes={"0001": "f001"},
            skip_ids=frozenset(),
            built_at="2026-01-01T00:00:00+00:00",
        )
        import io

        with zipfile.ZipFile(io.BytesIO(result)) as zf:
            names = zf.namelist()
        assert "f001.png" in names
