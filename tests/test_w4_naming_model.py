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
from pdomain_prep_for_pgdp.core.numbering import Leaf as _Leaf
from pdomain_prep_for_pgdp.core.numbering import compute_prefixes_from_runs as _cpfr
from pdomain_prep_for_pgdp.core.numbering_migration import LegacyRanges as _LegacyRanges
from pdomain_prep_for_pgdp.core.numbering_migration import (
    page_type_to_leaf_role as _pt2lr,
)
from pdomain_prep_for_pgdp.core.numbering_migration import (
    seed_runs_from_ranges as _seed,
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
# Unit tests: prefix format (ported from compute_prefix_v2 → compute_prefixes_from_runs)
# ─────────────────────────────────────────────────────────────────────────────
#
# P1.9: compute_prefix_v2 was deleted.  These tests now drive
# compute_prefixes_from_runs directly with migration-seeded runs, using the
# same frozen byte-stable expectations established during the cross-check.
# The canonical helper pattern mirrors tests/test_numbering_migration.py.


def _prefixes(
    page_types: dict[int, PageType],
    *,
    proof_start: int = 0,
    proof_end: int | None = None,
    fm_start: int = 0,
    fm_end: int | None = None,
    bm_start: int | None = None,
    bm_end: int | None = None,
    fm_nbr_start: int = 1,
    bm_nbr_start: int = 1,
) -> dict[int, str | None]:
    """Build LegacyRanges, seed runs, compute prefixes — canonical helper."""
    scans = sorted(page_types)
    n = len(scans)
    if proof_end is None:
        proof_end = scans[-1]
    if fm_end is None:
        fm_end = scans[n // 2 - 1] if n > 1 else proof_end
    if bm_start is None:
        bm_start = fm_end + 1
    if bm_end is None:
        bm_end = proof_end
    rg = _LegacyRanges(
        proof_start_idx0=proof_start,
        proof_end_idx0=proof_end,
        frontmatter_start_idx0=fm_start,
        frontmatter_end_idx0=fm_end,
        frontmatter_page_nbr_start=fm_nbr_start,
        bodymatter_start_idx0=bm_start,
        bodymatter_end_idx0=bm_end,
        bodymatter_page_nbr_start=bm_nbr_start,
    )
    runs, assign = _seed(rg, page_types)
    leaves = [_Leaf(scan=s, leaf_role=_pt2lr(page_types[s])[0], run_id=assign.get(s)) for s in scans]
    legacy_plate = {PageType.plate_b: "b", PageType.plate_p: "p", PageType.plate_r: "r"}
    plate_suffixes = {s: legacy_plate[pt] for s, pt in page_types.items() if pt in legacy_plate}
    seq_width = 4 if (proof_end - proof_start + 1) > 999 else 3
    return _cpfr(leaves, runs, proof_start=proof_start, seq_width=seq_width, plate_suffixes=plate_suffixes)


class TestComputePrefixV2Format:
    """Prefix format: <seq:3-4><type><folio?> — ported to compute_prefixes_from_runs."""

    def test_normal_page_frontmatter_format(self) -> None:
        """Normal frontmatter page: seq+f+folio (e.g. 000f001)."""
        # proof 0..9, fm 0..4, bm 5..9
        pts = dict.fromkeys(range(10), PageType.normal)
        result = _prefixes(pts, proof_end=9, fm_end=4, bm_start=5, bm_end=9)
        assert result[0] == "000f001"

    def test_normal_page_bodymatter_format(self) -> None:
        """Normal bodymatter page: seq+p+folio (e.g. 005p001)."""
        pts = dict.fromkeys(range(10), PageType.normal)
        result = _prefixes(pts, proof_end=9, fm_end=4, bm_start=5, bm_end=9)
        assert result[5] == "005p001"

    def test_cover_page_uses_type_e(self) -> None:
        """Cover pages use type letter 'e' (CT decision)."""
        pts = dict.fromkeys(range(10), PageType.normal)
        pts[0] = PageType.cover
        # cover at 0, fm starts at 1
        result = _prefixes(pts, proof_end=9, fm_start=1, fm_end=9, bm_start=5, bm_end=9)
        assert result[0] is not None
        assert result[0].startswith("000e")

    def test_skip_page_returns_none(self) -> None:
        """Skip pages return None (excluded from package)."""
        pts = dict.fromkeys(range(10), PageType.normal)
        pts[3] = PageType.skip
        result = _prefixes(pts, proof_end=9, fm_end=4, bm_start=5, bm_end=9)
        assert result[3] is None

    def test_out_of_range_page_returns_none(self) -> None:
        """Pages outside proof range return None (not assigned to any run)."""
        # proof 2..8, fm 2..4, bm 5..8; pages 0,1,9 are outside
        pts = dict.fromkeys(range(10), PageType.normal)
        result = _prefixes(pts, proof_start=2, proof_end=8, fm_start=2, fm_end=4, bm_start=5, bm_end=8)
        assert result[0] is None  # before range
        assert result[9] is None  # after range

    def test_plate_page_gets_plate_suffix(self) -> None:
        """Plate pages include plate type suffix (b/p/r) — no separate folio."""
        pts = dict.fromkeys(range(10), PageType.normal)
        pts[3] = PageType.plate_p
        # all 10 in fm run (proof 0..9, fm 0..9)
        result = _prefixes(pts, proof_end=9, fm_end=9, bm_start=5, bm_end=9)
        assert result[3] is not None
        assert result[3].startswith("003f")
        assert result[3].endswith("p")

    def test_seq_is_zero_padded_3_digits(self) -> None:
        """For small books (≤999 pages), seq is 3 zero-padded digits."""
        pts = dict.fromkeys(range(100), PageType.normal)
        result = _prefixes(pts, proof_end=99, fm_end=49, bm_start=50, bm_end=99)
        assert result[12] is not None
        assert result[12][:3] == "012"

    def test_folio_counter_increments(self) -> None:
        """Folio counter increments for each numbered page."""
        pts = dict.fromkeys(range(10), PageType.normal)
        result = _prefixes(pts, proof_end=9, fm_end=9, bm_start=5, bm_end=9)
        assert result[0] == "000f001"
        assert result[1] == "001f002"
        assert result[2] == "002f003"

    def test_prefix_length_within_pgdp_limit(self) -> None:
        """All generated prefixes are ≤ 8 chars (PGDP naming rule)."""
        types: dict[int, PageType] = {
            **dict.fromkeys(range(100), PageType.normal),
            5: PageType.cover,
            10: PageType.plate_p,
            20: PageType.skip,
        }
        # cover at 5 is inside fm; fm 0..49, bm 50..99
        result = _prefixes(types, proof_end=99, fm_start=0, fm_end=49, bm_start=50, bm_end=99)
        for scan, prefix in result.items():
            if prefix is not None:
                assert len(prefix) <= 8, f"prefix {prefix!r} for scan {scan} is too long"

    def test_sort_order_equals_binding_order(self) -> None:
        """Prefixes sort lexicographically in binding order (seq prefix guarantees it)."""
        pts = dict.fromkeys(range(10), PageType.normal)
        result = _prefixes(pts, proof_end=9, fm_end=4, bm_start=5, bm_end=9)
        non_none = [result[i] for i in sorted(result) if result[i] is not None]
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
    """End-to-end wired-path: materialize_naming_manifest (with runs) → load_naming_manifest.

    P1.9: config-based prefix derivation was removed.  These tests now pass
    ``runs=`` + ``leaf_assignments=`` to materialize_naming_manifest so the
    manifest carries real v2 prefixes, mirroring the production call from
    page_order_v2_cpu.
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

    def _seed_runs_for_pages(
        self,
        page_types: dict[int, PageType],
        *,
        fm_end: int,
        bm_start: int,
        bm_end: int,
    ):  # type: ignore[return]
        """Seed runs via LegacyRanges helper, matching the migration seeder."""
        from pdomain_prep_for_pgdp.core.numbering_migration import (
            LegacyRanges,
            page_type_to_leaf_role,
            seed_runs_from_ranges,
        )

        scans = sorted(page_types)
        rg = LegacyRanges(
            proof_start_idx0=scans[0],
            proof_end_idx0=scans[-1],
            frontmatter_start_idx0=scans[0],
            frontmatter_end_idx0=fm_end,
            frontmatter_page_nbr_start=1,
            bodymatter_start_idx0=bm_start,
            bodymatter_end_idx0=bm_end,
            bodymatter_page_nbr_start=1,
        )
        runs, assign = seed_runs_from_ranges(rg, page_types)
        leaf_assignments = {s: (page_type_to_leaf_role(page_types[s])[0], assign.get(s)) for s in scans}
        return runs, leaf_assignments

    def test_stage_output_uses_v2_prefixes(self, tmp_path: Path) -> None:
        """page_order stage emits v2 manifest: seq+type+folio format round-trips."""
        import json

        from pdomain_prep_for_pgdp.core.pipeline.steps.page_order import (
            load_naming_manifest,
            materialize_naming_manifest,
        )

        cfg = ProjectConfig(book_name="test", source_uri="")
        page_types = {
            0: PageType.cover,
            1: PageType.normal,
            2: PageType.normal,
            3: PageType.normal,
            4: PageType.normal,
        }
        pages = self._make_pages(5, types=page_types)
        # cover at 0, fm 1..1, bm 2..4
        runs, leaf_assignments = self._seed_runs_for_pages(page_types, fm_end=1, bm_start=2, bm_end=4)
        manifest_bytes = materialize_naming_manifest(
            "proj", pages, cfg, tmp_path, runs=runs, leaf_assignments=leaf_assignments
        )

        # Write to disk to test load_naming_manifest round-trip.
        manifest_path = tmp_path / "projects" / "proj" / "stages" / "page_order" / "output.json"
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        manifest_path.write_bytes(manifest_bytes)

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

        cfg = ProjectConfig(book_name="test", source_uri="")
        page_types = {
            0: PageType.normal,
            1: PageType.normal,
            2: PageType.skip,
            3: PageType.normal,
            4: PageType.normal,
        }
        pages = self._make_pages(5, types=page_types)
        runs, leaf_assignments = self._seed_runs_for_pages(page_types, fm_end=1, bm_start=2, bm_end=4)
        manifest_bytes = materialize_naming_manifest(
            "proj",
            pages,
            cfg,
            tmp_path,
            numeric_export=True,
            runs=runs,
            leaf_assignments=leaf_assignments,
        )

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

        cfg = ProjectConfig(book_name="test", source_uri="")
        page_types = {
            0: PageType.normal,
            1: PageType.skip,
            2: PageType.normal,
            3: PageType.normal,
        }
        pages = self._make_pages(4, types=page_types, project_id="proj2")
        runs, leaf_assignments = self._seed_runs_for_pages(page_types, fm_end=1, bm_start=2, bm_end=3)
        manifest_bytes = materialize_naming_manifest(
            "proj2", pages, cfg, tmp_path, runs=runs, leaf_assignments=leaf_assignments
        )

        manifest_path = tmp_path / "projects" / "proj2" / "stages" / "page_order" / "output.json"
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        manifest_path.write_bytes(manifest_bytes)

        manifest = load_naming_manifest(tmp_path, "proj2")
        assert "0001" in manifest.skip_set()
        assert "0001" not in manifest.page_prefixes()
