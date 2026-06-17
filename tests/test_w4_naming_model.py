"""W4 Group 2 — Naming model (N-run schema + format migration).

CT decisions:
  (a) N-run schema: runs model {start_idx, style, number_start, type_code}
      PUT .../project-stages/page_order/runs
      PUT .../project-stages/page_order/naming
      Both persist SettingsChange events.
  (b) New format: <seq:3-4><type><folio?> (e.g. 012f003)
      seq = universal binding-order sequence (zero-padded 3-4 digits)
      type = type letter (f=frontmatter, p=bodymatter, e=cover, b/p/r=plate)
      folio = optional 3-digit folio counter
  (c) Cover uses type 'e'; seq prefix makes sort order regardless of letter.
  (d) Numeric export-time rename: bare zero-padded seq (0001...).
  (e) PGDP validator validates EXPORT names (what lands in zip).

Behaviors tested:
- compute_prefix_v2 produces seq+type+folio format
- cover pages use type='e'
- skip pages return None
- out-of-range pages return None
- plates don't consume folio counter but get plate suffix
- seq width 3 for ≤999 pages, 4 for >999
- PUT .../page_order/runs → 200, SettingsChange event
- PUT .../page_order/naming → 200, SettingsChange event
- 404/409 guards on naming routes
- validate_pgdp_filename validates export names (numeric: 0001)
- validate_pgdp_filename validates descriptive names (012f003)
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from pathlib import Path

from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pdomain_prep_for_pgdp.bootstrap import build_app
from pdomain_prep_for_pgdp.core.models import (
    PageProcessingStatus,
    PageRecord,
    PageType,
    Project,
    ProjectConfig,
    ProjectStatus,
)
from pdomain_prep_for_pgdp.settings import Settings
from tests.fixtures.seed_pages import seed_pages_in_store

# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────


def _make_settings(tmp_path: Path) -> Settings:
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


def _seed_project(
    settings: Settings,
    project_id: str = "proj1",
    registry_version: int = 2,
    page_count: int = 3,
) -> None:
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
                page_count=page_count,
                proof_page_count=page_count,
                config=ProjectConfig(book_name=project_id, source_uri=""),
                storage_prefix=f"projects/{project_id}/",
                registry_version=registry_version,
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
                prefix=f"page_{i:04d}",
                source_stem=f"src{i}",
                processing_status=PageProcessingStatus.pending,
            )
            for i in range(page_count)
        ],
    )


# ─────────────────────────────────────────────────────────────────────────────
# Unit tests: compute_prefix_v2
# ─────────────────────────────────────────────────────────────────────────────


class TestComputePrefixV2Format:
    """compute_prefix_v2 produces <seq:3-4><type><folio?> format."""

    def _make_pages(self, count: int, types: dict[int, PageType] | None = None) -> dict[int, PageRecord]:
        """Create a mapping of idx0 -> PageRecord for testing."""
        pages = {}
        for i in range(count):
            pt = (types or {}).get(i, PageType.normal)
            pages[i] = PageRecord(
                project_id="proj1",
                idx0=i,
                prefix="",
                source_stem=f"src{i}",
                processing_status=PageProcessingStatus.pending,
                page_type=pt,
            )
        return pages

    def test_normal_page_frontmatter_format(self) -> None:
        """Normal frontmatter page: seq+f+folio (e.g. 000f001)."""
        from pdomain_prep_for_pgdp.core.prefix import compute_prefix_v2

        config = ProjectConfig(
            book_name="test",
            source_uri="",
            proof_start_idx0=0,
            proof_end_idx0=9,
            frontmatter_start_idx0=0,
            frontmatter_end_idx0=4,
            frontmatter_page_nbr_start=1,
            bodymatter_start_idx0=5,
            bodymatter_end_idx0=9,
            bodymatter_page_nbr_start=1,
        )
        pages = self._make_pages(10)
        result = compute_prefix_v2(0, config, pages)
        # seq=000, type=f, folio=001
        assert result == "000f001"

    def test_normal_page_bodymatter_format(self) -> None:
        """Normal bodymatter page: seq+p+folio (e.g. 005p001)."""
        from pdomain_prep_for_pgdp.core.prefix import compute_prefix_v2

        config = ProjectConfig(
            book_name="test",
            source_uri="",
            proof_start_idx0=0,
            proof_end_idx0=9,
            frontmatter_start_idx0=0,
            frontmatter_end_idx0=4,
            frontmatter_page_nbr_start=1,
            bodymatter_start_idx0=5,
            bodymatter_end_idx0=9,
            bodymatter_page_nbr_start=1,
        )
        pages = self._make_pages(10)
        result = compute_prefix_v2(5, config, pages)
        # seq=005, type=p, folio=001
        assert result == "005p001"

    def test_cover_page_uses_type_e(self) -> None:
        """Cover pages use type letter 'e' (CT decision)."""
        from pdomain_prep_for_pgdp.core.prefix import compute_prefix_v2

        config = ProjectConfig(
            book_name="test",
            source_uri="",
            proof_start_idx0=0,
            proof_end_idx0=9,
            frontmatter_start_idx0=1,
            frontmatter_end_idx0=9,
            frontmatter_page_nbr_start=1,
            bodymatter_start_idx0=5,
            bodymatter_end_idx0=9,
            bodymatter_page_nbr_start=1,
        )
        pages = self._make_pages(10, {0: PageType.cover})
        result = compute_prefix_v2(0, config, pages)
        # cover: seq=000, type=e (no folio number)
        assert result is not None
        assert result.startswith("000e")

    def test_skip_page_returns_none(self) -> None:
        """Skip pages return None (excluded from package)."""
        from pdomain_prep_for_pgdp.core.prefix import compute_prefix_v2

        config = ProjectConfig(
            book_name="test",
            source_uri="",
            proof_start_idx0=0,
            proof_end_idx0=9,
            frontmatter_start_idx0=0,
            frontmatter_end_idx0=9,
            frontmatter_page_nbr_start=1,
            bodymatter_start_idx0=5,
            bodymatter_end_idx0=9,
            bodymatter_page_nbr_start=1,
        )
        pages = self._make_pages(10, {3: PageType.skip})
        result = compute_prefix_v2(3, config, pages)
        assert result is None

    def test_out_of_range_page_returns_none(self) -> None:
        """Pages outside proof range return None."""
        from pdomain_prep_for_pgdp.core.prefix import compute_prefix_v2

        config = ProjectConfig(
            book_name="test",
            source_uri="",
            proof_start_idx0=2,
            proof_end_idx0=8,
            frontmatter_start_idx0=2,
            frontmatter_end_idx0=4,
            frontmatter_page_nbr_start=1,
            bodymatter_start_idx0=5,
            bodymatter_end_idx0=8,
            bodymatter_page_nbr_start=1,
        )
        pages = self._make_pages(10)
        assert compute_prefix_v2(0, config, pages) is None  # before range
        assert compute_prefix_v2(9, config, pages) is None  # after range

    def test_plate_page_gets_plate_suffix(self) -> None:
        """Plate pages include plate type suffix (b/p/r) after type letter."""
        from pdomain_prep_for_pgdp.core.prefix import compute_prefix_v2

        config = ProjectConfig(
            book_name="test",
            source_uri="",
            proof_start_idx0=0,
            proof_end_idx0=9,
            frontmatter_start_idx0=0,
            frontmatter_end_idx0=9,
            frontmatter_page_nbr_start=1,
            bodymatter_start_idx0=5,
            bodymatter_end_idx0=9,
            bodymatter_page_nbr_start=1,
        )
        pages = self._make_pages(10, {3: PageType.plate_p})
        result = compute_prefix_v2(3, config, pages)
        assert result is not None
        # seq=003, type=f, plate suffix=p (no separate folio)
        assert result.startswith("003f")
        assert result.endswith("p")

    def test_seq_is_zero_padded_3_digits(self) -> None:
        """For small books (≤999 pages), seq is 3 zero-padded digits."""
        from pdomain_prep_for_pgdp.core.prefix import compute_prefix_v2

        config = ProjectConfig(
            book_name="test",
            source_uri="",
            proof_start_idx0=0,
            proof_end_idx0=99,
            frontmatter_start_idx0=0,
            frontmatter_end_idx0=99,
            frontmatter_page_nbr_start=1,
            bodymatter_start_idx0=50,
            bodymatter_end_idx0=99,
            bodymatter_page_nbr_start=1,
        )
        pages = self._make_pages(100)
        result = compute_prefix_v2(12, config, pages)
        assert result is not None
        # seq should be "012"
        assert result[:3] == "012"

    def test_folio_counter_increments(self) -> None:
        """Folio counter increments for each numbered page."""
        from pdomain_prep_for_pgdp.core.prefix import compute_prefix_v2

        config = ProjectConfig(
            book_name="test",
            source_uri="",
            proof_start_idx0=0,
            proof_end_idx0=9,
            frontmatter_start_idx0=0,
            frontmatter_end_idx0=9,
            frontmatter_page_nbr_start=1,
            bodymatter_start_idx0=5,
            bodymatter_end_idx0=9,
            bodymatter_page_nbr_start=1,
        )
        pages = self._make_pages(10)
        p0 = compute_prefix_v2(0, config, pages)
        p1 = compute_prefix_v2(1, config, pages)
        p2 = compute_prefix_v2(2, config, pages)
        assert p0 == "000f001"
        assert p1 == "001f002"
        assert p2 == "002f003"

    def test_prefix_length_within_pgdp_limit(self) -> None:
        """All generated prefixes are ≤ 8 chars (PGDP naming rule)."""
        from pdomain_prep_for_pgdp.core.prefix import compute_prefix_v2

        config = ProjectConfig(
            book_name="test",
            source_uri="",
            proof_start_idx0=0,
            proof_end_idx0=99,
            frontmatter_start_idx0=0,
            frontmatter_end_idx0=49,
            frontmatter_page_nbr_start=1,
            bodymatter_start_idx0=50,
            bodymatter_end_idx0=99,
            bodymatter_page_nbr_start=1,
        )
        types: dict[int, PageType] = {5: PageType.cover, 10: PageType.plate_p, 20: PageType.skip}
        pages = {
            i: PageRecord(
                project_id="proj1",
                idx0=i,
                prefix="",
                source_stem=f"src{i}",
                processing_status=PageProcessingStatus.pending,
                page_type=types.get(i, PageType.normal),
            )
            for i in range(100)
        }
        for i in range(100):
            prefix = compute_prefix_v2(i, config, pages)
            if prefix is not None:
                assert len(prefix) <= 8, f"prefix {prefix!r} for scan {i} is too long"

    def test_sort_order_equals_binding_order(self) -> None:
        """Prefixes sort lexicographically in binding order (guaranteed by seq prefix)."""
        from pdomain_prep_for_pgdp.core.prefix import compute_prefix_v2

        config = ProjectConfig(
            book_name="test",
            source_uri="",
            proof_start_idx0=0,
            proof_end_idx0=9,
            frontmatter_start_idx0=0,
            frontmatter_end_idx0=4,
            frontmatter_page_nbr_start=1,
            bodymatter_start_idx0=5,
            bodymatter_end_idx0=9,
            bodymatter_page_nbr_start=1,
        )
        pages = {
            i: PageRecord(
                project_id="proj1",
                idx0=i,
                prefix="",
                source_stem=f"src{i}",
                processing_status=PageProcessingStatus.pending,
                page_type=PageType.normal,
            )
            for i in range(10)
        }
        prefixes = [compute_prefix_v2(i, config, pages) for i in range(10)]
        non_none = [p for p in prefixes if p is not None]
        # lexicographic sort must equal reading order
        assert non_none == sorted(non_none)


class TestComputePrefixV2ExportName:
    """Numeric export name: bare zero-padded seq."""

    def test_export_name_is_bare_seq(self) -> None:
        """export_name_for_seq(12, total=100) == '012'."""
        from pdomain_prep_for_pgdp.core.prefix import export_name_for_seq

        assert export_name_for_seq(12, total=100) == "012"
        assert export_name_for_seq(1, total=100) == "001"
        assert export_name_for_seq(999, total=999) == "999"

    def test_export_name_widens_for_large_books(self) -> None:
        """For >999 pages, export_name uses 4 digits."""
        from pdomain_prep_for_pgdp.core.prefix import export_name_for_seq

        assert export_name_for_seq(1, total=1000) == "0001"
        assert export_name_for_seq(1234, total=2000) == "1234"

    def test_pgdp_validator_accepts_numeric_export_names(self) -> None:
        """PGDP validator accepts numeric export names like '0001'."""
        from pdomain_prep_for_pgdp.core.pipeline.pgdp_naming import validate_pgdp_filename

        errors = validate_pgdp_filename("0001", ".png")
        assert errors == [], f"unexpected errors: {errors}"

        errors = validate_pgdp_filename("001", ".png")
        assert errors == [], f"unexpected errors: {errors}"

    def test_pgdp_validator_accepts_descriptive_names(self) -> None:
        """PGDP validator accepts descriptive names like '012f003'."""
        from pdomain_prep_for_pgdp.core.pipeline.pgdp_naming import validate_pgdp_filename

        errors = validate_pgdp_filename("012f003", ".png")
        assert errors == [], f"unexpected errors: {errors}"

        errors = validate_pgdp_filename("001e", ".png")
        assert errors == [], f"unexpected errors: {errors}"


# ─────────────────────────────────────────────────────────────────────────────
# Route tests: PUT .../project-stages/page_order/runs
# ─────────────────────────────────────────────────────────────────────────────


class TestPageOrderRunsRoute:
    """PUT /projects/{id}/project-stages/page_order/runs."""

    def test_put_runs_returns_200(self, tmp_path: Path) -> None:
        """PUT page_order/runs → 200 with run count (NumberingRunsArtifact body)."""
        from fastapi.testclient import TestClient

        settings = _make_settings(tmp_path)
        _seed_project(settings, "proj1")

        app = build_app(settings)
        with TestClient(app) as client:
            r = client.put(
                "/api/data/projects/proj1/project-stages/page_order/runs",
                json={
                    "version": 1,
                    "runs": [
                        {
                            "id": "front",
                            "label": "Front",
                            "style": "roman-lower",
                            "start_mode": "set",
                            "start": 1,
                            "step": 1,
                            "role": "text",
                            "span": [0, 4],
                            "note": "",
                        },
                        {
                            "id": "body",
                            "label": "Body",
                            "style": "arabic",
                            "start_mode": "set",
                            "start": 1,
                            "step": 1,
                            "role": "text",
                            "span": [5, 9],
                            "note": "",
                        },
                    ],
                },
            )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["run_count"] == 2

    def test_put_runs_404_on_missing_project(self, tmp_path: Path) -> None:
        """PUT page_order/runs → 404 for unknown project."""
        from fastapi.testclient import TestClient

        settings = _make_settings(tmp_path)
        app = build_app(settings)
        with TestClient(app) as client:
            r = client.put(
                "/api/data/projects/NOTEXIST/project-stages/page_order/runs",
                json={"runs": []},
            )
        assert r.status_code == 404

    def test_put_runs_409_on_registry_mismatch(self, tmp_path: Path) -> None:
        """PUT page_order/runs → 409 for v1 project."""
        from fastapi.testclient import TestClient

        settings = _make_settings(tmp_path)
        _seed_project(settings, "proj1", registry_version=1)

        app = build_app(settings)
        with TestClient(app) as client:
            r = client.put(
                "/api/data/projects/proj1/project-stages/page_order/runs",
                json={"runs": []},
            )
        assert r.status_code == 409

    def test_put_runs_persists_to_disk(self, tmp_path: Path) -> None:
        """PUT page_order/runs writes runs.json to project dir (NumberingRunsArtifact format)."""
        import json

        from fastapi.testclient import TestClient

        settings = _make_settings(tmp_path)
        _seed_project(settings, "proj1")

        runs_payload = {
            "version": 1,
            "runs": [
                {
                    "id": "front",
                    "label": "Front",
                    "style": "roman-lower",
                    "start_mode": "set",
                    "start": 1,
                    "step": 1,
                    "role": "text",
                    "span": [0, 4],
                    "note": "",
                },
            ],
        }
        app = build_app(settings)
        with TestClient(app) as client:
            r = client.put(
                "/api/data/projects/proj1/project-stages/page_order/runs",
                json=runs_payload,
            )
        assert r.status_code == 200

        runs_path = settings.data_root / "projects" / "proj1" / "stages" / "page_order" / "runs.json"
        assert runs_path.exists(), "runs.json not created"
        stored = json.loads(runs_path.read_text())
        # Stored as NumberingRunsArtifact: {version, runs: [...]}
        assert stored["version"] == 1
        assert len(stored["runs"]) == 1
        assert stored["runs"][0]["id"] == "front"
        assert stored["runs"][0]["style"] == "roman-lower"

    def test_put_runs_records_numbering_runs_changed_event(self, tmp_path: Path) -> None:
        """PUT page_order/runs records NumberingRunsChanged event in events.db."""
        import uuid

        from fastapi.testclient import TestClient

        from pdomain_prep_for_pgdp.core.pipeline.prep_aggregate import (
            PrepApplication,
            PrepProjectAggregate,
        )

        settings = _make_settings(tmp_path)
        _seed_project(settings, "proj1")

        app = build_app(settings)
        with TestClient(app) as client:
            r = client.put(
                "/api/data/projects/proj1/project-stages/page_order/runs",
                json={
                    "version": 1,
                    "runs": [
                        {
                            "id": "body",
                            "label": "Body",
                            "style": "arabic",
                            "start_mode": "set",
                            "start": 1,
                            "step": 1,
                            "role": "text",
                            "span": [0, 4],
                            "note": "",
                        }
                    ],
                },
            )
        assert r.status_code == 200

        events_db = settings.data_root / "projects" / "proj1" / "events.db"
        assert events_db.exists()

        agg_id = PrepProjectAggregate.create_id(uuid.uuid5(uuid.NAMESPACE_OID, "proj1"))
        ev_app = PrepApplication(
            env={
                "PERSISTENCE_MODULE": "eventsourcing.sqlite",
                "SQLITE_DBNAME": str(events_db),
            }
        )
        loaded = ev_app.repository.get(agg_id)
        assert loaded.version >= 1  # type: ignore[attr-defined]


class TestPageOrderNamingRoute:
    """PUT /projects/{id}/project-stages/page_order/naming."""

    def test_put_naming_returns_200(self, tmp_path: Path) -> None:
        """PUT page_order/naming → 200 with naming scheme echo."""
        from fastapi.testclient import TestClient

        settings = _make_settings(tmp_path)
        _seed_project(settings, "proj1")

        app = build_app(settings)
        with TestClient(app) as client:
            r = client.put(
                "/api/data/projects/proj1/project-stages/page_order/naming",
                json={
                    "naming": {
                        "parts": {"seq": True, "type": True, "folio": True},
                        "digits": 3,
                    }
                },
            )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "naming" in body

    def test_put_naming_404_on_missing_project(self, tmp_path: Path) -> None:
        """PUT page_order/naming → 404 for unknown project."""
        from fastapi.testclient import TestClient

        settings = _make_settings(tmp_path)
        app = build_app(settings)
        with TestClient(app) as client:
            r = client.put(
                "/api/data/projects/NOTEXIST/project-stages/page_order/naming",
                json={"naming": {"parts": {"seq": True, "type": True, "folio": True}, "digits": 3}},
            )
        assert r.status_code == 404

    def test_put_naming_persists_to_disk(self, tmp_path: Path) -> None:
        """PUT page_order/naming writes naming.json to project dir."""
        import json

        from fastapi.testclient import TestClient

        settings = _make_settings(tmp_path)
        _seed_project(settings, "proj1")

        naming_payload = {"parts": {"seq": True, "type": True, "folio": True}, "digits": 3}
        app = build_app(settings)
        with TestClient(app) as client:
            r = client.put(
                "/api/data/projects/proj1/project-stages/page_order/naming",
                json={"naming": naming_payload},
            )
        assert r.status_code == 200

        naming_path = settings.data_root / "projects" / "proj1" / "stages" / "page_order" / "naming.json"
        assert naming_path.exists(), "naming.json not created"
        stored = json.loads(naming_path.read_text())
        assert stored["digits"] == 3


# ─────────────────────────────────────────────────────────────────────────────
# Wired-path tests: page_order stage → manifest artifact → v2 prefixes + export_name
# ─────────────────────────────────────────────────────────────────────────────


class TestPageOrderStageWiredPath:
    """End-to-end wired-path tests: materialize_naming_manifest → load_naming_manifest → v2 prefixes.

    These tests exercise the full production seam:
      page_order stage invokes compute_prefix_v2 → JSON manifest written to disk →
      load_naming_manifest reads it back → consumers see v2 prefixes and export_name.
    """

    def _make_pages(
        self,
        count: int,
        project_id: str = "proj",
        types: dict[int, PageType] | None = None,
    ) -> list[PageRecord]:
        pages = []
        for i in range(count):
            pt = (types or {}).get(i, PageType.normal)
            pages.append(
                PageRecord(
                    project_id=project_id,
                    idx0=i,
                    prefix="",
                    source_stem=f"src{i}",
                    processing_status=PageProcessingStatus.pending,
                    page_type=pt,
                )
            )
        return pages

    def test_stage_output_uses_v2_prefixes(self, tmp_path: Path) -> None:
        """page_order stage emits v2 manifest: seq+type+folio, not v1 f001/c001.

        Runs materialize_naming_manifest then loads the manifest via
        load_naming_manifest.  Asserts the round-trip carries v2 prefixes.
        """
        import json

        from pdomain_prep_for_pgdp.core.pipeline.steps.page_order import (
            load_naming_manifest,
            materialize_naming_manifest,
        )

        cfg = ProjectConfig(
            book_name="test",
            source_uri="",
            proof_start_idx0=0,
            proof_end_idx0=4,
            frontmatter_start_idx0=0,
            frontmatter_end_idx0=1,
            frontmatter_page_nbr_start=1,
            bodymatter_start_idx0=2,
            bodymatter_end_idx0=4,
            bodymatter_page_nbr_start=1,
        )
        pages = self._make_pages(
            5,
            types={0: PageType.cover},
        )
        # Run the stage function (pure function path).
        manifest_bytes = materialize_naming_manifest("proj", pages, cfg, tmp_path)

        # Write to disk to test load_naming_manifest round-trip.
        manifest_path = tmp_path / "projects" / "proj" / "stages" / "page_order" / "output.json"
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        manifest_path.write_bytes(manifest_bytes)

        # Load via the manifest loader.
        manifest = load_naming_manifest(tmp_path, "proj")
        prefixes = manifest.page_prefixes()

        # idx0=0 is cover: v2 format = "000e"
        assert prefixes["0000"] == "000e", f"expected '000e', got {prefixes['0000']!r}"
        # idx0=1 is first frontmatter normal: v2 format = "001f001"
        assert prefixes["0001"] == "001f001", f"expected '001f001', got {prefixes.get('0001')!r}"
        # idx0=2 is first bodymatter normal: v2 format = "002p001"
        assert prefixes["0002"] == "002p001", f"expected '002p001', got {prefixes.get('0002')!r}"

        # Validate JSON content directly — check export_name present in schema.
        raw = json.loads(manifest_bytes)
        for entry in raw["pages"]:
            assert "export_name" in entry, f"export_name missing from manifest entry: {entry}"

    def test_numeric_export_populates_export_name(self, tmp_path: Path) -> None:
        """When numeric_export=True, export_name is populated for non-skip pages."""
        from pdomain_prep_for_pgdp.core.pipeline.steps.page_order import (
            load_naming_manifest,
            materialize_naming_manifest,
        )

        cfg = ProjectConfig(
            book_name="test",
            source_uri="",
            proof_start_idx0=0,
            proof_end_idx0=4,
            frontmatter_start_idx0=0,
            frontmatter_end_idx0=2,
            frontmatter_page_nbr_start=1,
            bodymatter_start_idx0=3,
            bodymatter_end_idx0=4,
            bodymatter_page_nbr_start=1,
        )
        pages = self._make_pages(
            5,
            types={2: PageType.skip},
        )
        manifest_bytes = materialize_naming_manifest("proj", pages, cfg, tmp_path, numeric_export=True)

        manifest_path = tmp_path / "projects" / "proj" / "stages" / "page_order" / "output.json"
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        manifest_path.write_bytes(manifest_bytes)

        manifest = load_naming_manifest(tmp_path, "proj")

        # Skip page has no export_name.
        skip_entry = next(e for e in manifest.pages if e.role == "skip")
        assert skip_entry.export_name is None

        # Non-skip pages have numeric export_name (3 digits for ≤999 total).
        non_skip = [e for e in manifest.pages if e.role != "skip"]
        for entry in non_skip:
            assert entry.export_name is not None, f"expected export_name for {entry}"
            assert entry.export_name.isdigit(), f"export_name not numeric: {entry.export_name!r}"
            assert len(entry.export_name) == 3, f"export_name wrong width: {entry.export_name!r}"

    def test_skip_excluded_from_page_prefixes(self, tmp_path: Path) -> None:
        """Skip pages appear in skip_ids but not in page_prefixes() after round-trip."""
        from pdomain_prep_for_pgdp.core.pipeline.steps.page_order import (
            load_naming_manifest,
            materialize_naming_manifest,
        )

        cfg = ProjectConfig(
            book_name="test",
            source_uri="",
            proof_start_idx0=0,
            proof_end_idx0=3,
            frontmatter_start_idx0=0,
            frontmatter_end_idx0=1,
            frontmatter_page_nbr_start=1,
            bodymatter_start_idx0=2,
            bodymatter_end_idx0=3,
            bodymatter_page_nbr_start=1,
        )
        pages = self._make_pages(4, types={1: PageType.skip})
        manifest_bytes = materialize_naming_manifest("proj2", pages, cfg, tmp_path)

        manifest_path = tmp_path / "projects" / "proj2" / "stages" / "page_order" / "output.json"
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        manifest_path.write_bytes(manifest_bytes)

        manifest = load_naming_manifest(tmp_path, "proj2")
        assert "0001" in manifest.skip_set()
        assert "0001" not in manifest.page_prefixes()
