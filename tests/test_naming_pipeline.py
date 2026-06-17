"""Tests for the naming pipeline: naming manifest, build_package wiring.

P1.9 NOTE: compute_prefix (v1) and assign_prefixes were deleted.
  - Section 1 (TestComputePrefixSkipCover) is removed; equivalent coverage in
    tests/test_numbering_migration.py golden tests.
  - Section 2 (assign_prefixes integration tests) is removed; assign_prefixes no
    longer exists. Equivalent coverage: tests/test_page_order_runs_route.py.
  - Sections 3-6 (materialize_naming_manifest, load_naming_manifest,
    build_submission_zip, build_package_v2_cpu) are KEPT unchanged — those
    functions still exist with the same API.

Remaining TDD-first for:
  3. materialize_naming_manifest: JSON schema, skip_ids, prefix computation
  4. load_naming_manifest: present, absent, wrong version
  5. build_submission_zip: skip pages excluded from zip
  6. build_package_v2_cpu: loads manifest from disk when page_prefixes=None
"""

from __future__ import annotations

import json
import zipfile
from pathlib import Path  # used at runtime (tmp_path construction)

import pytest

from pdomain_prep_for_pgdp.core.models import (
    PageRecord,
    PageType,
    ProjectConfig,
)

# ─── helpers ──────────────────────────────────────────────────────────────────


def _cfg() -> ProjectConfig:
    """Minimal config — range fields dropped in P1.9; naming driven by runs."""
    return ProjectConfig(
        book_name="test",
        source_uri="",
    )


def _page(project_id: str, idx0: int, page_type: PageType = PageType.normal) -> PageRecord:
    return PageRecord(
        project_id=project_id,
        idx0=idx0,
        prefix="",
        source_stem=f"src_{idx0:03d}",
        page_type=page_type,
    )


# ─── 3. materialize_naming_manifest ───────────────────────────────────────────


class TestMaterializeNamingManifest:
    def _pages_and_cfg(self) -> tuple[list[PageRecord], ProjectConfig]:
        cfg = _cfg()
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
        assert parsed["version"] == 2
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

    def test_cover_page_has_e_suffix_v2(self, tmp_path: Path) -> None:
        """v2 manifest: cover page uses seq+e format (e.g. '000e'), not 'c001'."""
        from pdomain_prep_for_pgdp.core.pipeline.steps.page_order import materialize_naming_manifest

        pages, cfg = self._pages_and_cfg()
        parsed = json.loads(materialize_naming_manifest("proj", pages, cfg, tmp_path))
        cover_entry = next(e for e in parsed["pages"] if e["role"] == "cover")
        assert cover_entry["prefix"] is not None
        # v2 format: <seq:3>e — no "c" prefix, ends with "e"
        assert cover_entry["prefix"].endswith("e"), (
            f"expected v2 cover prefix ending with 'e', got {cover_entry['prefix']!r}"
        )
        assert not cover_entry["prefix"].startswith("c"), (
            f"v1 cover prefix 'c' leaked into v2 manifest: {cover_entry['prefix']!r}"
        )

    def test_normal_pages_have_v2_prefix_format(self, tmp_path: Path) -> None:
        """v2 manifest: normal pages use seq+f/p+folio format (e.g. '001f001').

        P1.9: prefixes require NumberingRun objects.  Pass runs + leaf_assignments
        so the two normal pages (idx0=1,2) get non-None prefixes.
        """
        from pdomain_prep_for_pgdp.core.models import LeafRole, NumberingRun, RunStyle
        from pdomain_prep_for_pgdp.core.pipeline.steps.page_order import materialize_naming_manifest

        pages, cfg = self._pages_and_cfg()
        # Single bodymatter run covering the two normal pages (scans 1 and 2).
        run = NumberingRun(id="run-bm", role=LeafRole.text, style=RunStyle.arabic, start=1, span=(1, 2))
        leaf_assignments = {
            1: (LeafRole.text, "run-bm"),
            2: (LeafRole.text, "run-bm"),
        }
        parsed = json.loads(
            materialize_naming_manifest(
                "proj",
                pages,
                cfg,
                tmp_path,
                runs=[run],
                leaf_assignments=leaf_assignments,
            )
        )
        normal_entries = [e for e in parsed["pages"] if e["role"] == "normal"]
        for e in normal_entries:
            assert e["prefix"] is not None
            # v2 prefix: starts with digits (the seq), contains f or p after the digits
            prefix = e["prefix"]
            assert any(c in prefix for c in ("f", "p")), f"expected v2 prefix with 'f' or 'p', got {prefix!r}"

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
