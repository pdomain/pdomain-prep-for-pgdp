"""ranges->runs migration helpers (the one place that reads old range config).

Invoked by the registry-version re-derive path on the v2->v3 bump.

IMPORTANT: the legacy frontmatter/bodymatter range fields were DELETED from
``ProjectConfig`` in P1.9.  An old (registry_version=2) project's config blob
still contains them on disk, but ``ProjectConfig.model_validate`` silently
drops them (pydantic ``extra="ignore"``).  The migration therefore reads the
ranges out of the RAW stored config dict via :class:`LegacyRanges`, never via
a parsed ``ProjectConfig``.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from pdomain_prep_for_pgdp.core.models import (
    LeafRole,
    NumberingRun,
    PageType,
    PlateSide,
    RunStyle,
    StartMode,
)

if TYPE_CHECKING:
    from pathlib import Path


@dataclass(frozen=True)
class LegacyRanges:
    """The deleted ProjectConfig range fields, read from a raw config dict.

    Holds exactly the front/body numbering ranges the v2 project carried.
    Built via :meth:`from_config_dict` from the raw stored JSON so the
    migration does not depend on the (now-deleted) ProjectConfig fields.
    """

    proof_start_idx0: int = 0
    proof_end_idx0: int = 0
    frontmatter_start_idx0: int = 0
    frontmatter_end_idx0: int = 0
    bodymatter_start_idx0: int = 0
    bodymatter_end_idx0: int = 0
    frontmatter_page_nbr_start: int = 1
    bodymatter_page_nbr_start: int = 1

    @classmethod
    def from_config_dict(cls, config: dict[str, Any]) -> LegacyRanges:
        """Read the legacy range fields out of a raw config dict.

        Missing keys fall back to the historical ProjectConfig defaults.
        """

        def _i(key: str, default: int) -> int:
            v = config.get(key, default)
            return int(v) if isinstance(v, (int, float)) else default

        return cls(
            proof_start_idx0=_i("proof_start_idx0", 0),
            proof_end_idx0=_i("proof_end_idx0", 0),
            frontmatter_start_idx0=_i("frontmatter_start_idx0", 0),
            frontmatter_end_idx0=_i("frontmatter_end_idx0", 0),
            bodymatter_start_idx0=_i("bodymatter_start_idx0", 0),
            bodymatter_end_idx0=_i("bodymatter_end_idx0", 0),
            frontmatter_page_nbr_start=_i("frontmatter_page_nbr_start", 1),
            bodymatter_page_nbr_start=_i("bodymatter_page_nbr_start", 1),
        )


_ROLE_MAP: dict[PageType, tuple[LeafRole, PlateSide | None]] = {
    PageType.normal: (LeafRole.text, None),
    PageType.blank: (LeafRole.blank, None),
    PageType.skip: (LeafRole.skip, None),
    PageType.cover: (LeafRole.cover, None),
    PageType.plate_p: (LeafRole.plate, PlateSide.recto),
    PageType.plate_b: (LeafRole.plate, PlateSide.verso),
    PageType.plate_r: (LeafRole.plate, PlateSide.verso),
}

_NO_RUN_TYPES: frozenset[PageType] = frozenset({PageType.skip, PageType.cover})


def page_type_to_leaf_role(pt: PageType) -> tuple[LeafRole, PlateSide | None]:
    """Map a Source-layer PageType to a Page-Order leaf role + plate side."""
    return _ROLE_MAP[pt]


def seed_runs_from_ranges(
    ranges: LegacyRanges,
    page_types: dict[int, PageType],
) -> tuple[list[NumberingRun], dict[int, str | None]]:
    """Seed numbering runs from the legacy frontmatter/bodymatter ranges.

    Returns (runs, {scan: run_id | None}).  Cover/skip and out-of-proof
    pages map to None (no run).  The roman/arabic split + start numbers come
    straight from the legacy ranges so migrated labels stay byte-stable.
    """
    # Migration contract: these ids ("frontmatter", "bodymatter") are stable identifiers
    # persisted in the DB by the v2->v3 migration.  P1.9 golden byte-stability depends on
    # them — do not rename without bumping the registry version.
    front = NumberingRun(
        id="frontmatter",
        label="Front matter",
        style=RunStyle.roman_lower,
        start_mode=StartMode.set,
        start=ranges.frontmatter_page_nbr_start,
        step=1,
        span=(ranges.frontmatter_start_idx0, ranges.frontmatter_end_idx0),
    )
    body = NumberingRun(
        id="bodymatter",
        label="Body",
        style=RunStyle.arabic,
        start_mode=StartMode.set,
        start=ranges.bodymatter_page_nbr_start,
        step=1,
        span=(ranges.bodymatter_start_idx0, ranges.bodymatter_end_idx0),
    )
    assign: dict[int, str | None] = {}
    for scan, pt in page_types.items():
        if scan < ranges.proof_start_idx0 or scan > ranges.proof_end_idx0 or pt in _NO_RUN_TYPES:
            assign[scan] = None
        elif ranges.frontmatter_start_idx0 <= scan <= ranges.frontmatter_end_idx0:
            assign[scan] = front.id
        elif ranges.bodymatter_start_idx0 <= scan <= ranges.bodymatter_end_idx0:
            assign[scan] = body.id
        else:
            # In-proof but outside both declared ranges — default to body.
            assign[scan] = body.id
    return [front, body], assign


# ─── v2 -> v3 one-shot project migration ─────────────────────────────────────


def migrate_project_to_v3(
    data_root: Path,
    project_id: str,
    raw_config: dict[str, Any],
) -> None:
    """One-shot ranges->runs migration for a single existing (v2) project.

    Reads the legacy ranges out of ``raw_config`` (the project's raw stored
    config dict — NOT a parsed ProjectConfig, whose range fields were deleted),
    seeds the front/body NumberingRuns, persists them via ``save_runs``, and
    stamps each in-store page's ``PrepPageExtension`` with the derived
    ``leaf_role`` / ``run_id`` / ``plate_side``.

    Idempotent: re-running over an already-migrated project re-derives the same
    runs + assignments from the (still-present) raw config.  The caller is
    responsible for bumping ``project.registry_version`` to 3 and persisting the
    project row.

    Uses ``update_page_extension`` (model_copy) so the existing extension's
    other fields are preserved (``put_page_records`` would drop the new
    leaf fields).
    """
    from pdomain_ops.pages import get_extension

    from pdomain_prep_for_pgdp.core.models import NumberingRunsArtifact
    from pdomain_prep_for_pgdp.core.numbering_store import save_runs
    from pdomain_prep_for_pgdp.core.page_service_helpers import (
        _get_proj_page_ids,
        update_page_extension,
    )
    from pdomain_prep_for_pgdp.core.page_store_factory import build_page_service
    from pdomain_prep_for_pgdp.core.prep_extension import PrepPageExtension

    ranges = LegacyRanges.from_config_dict(raw_config)

    service = build_page_service(data_root, project_id)
    page_types: dict[int, PageType] = {}
    for page_uuid in _get_proj_page_ids(service, project_id):
        try:
            page_agg = service.store.get_page(page_uuid)
            ext = get_extension(page_agg.record, "prep", PrepPageExtension)
        except Exception:  # noqa: BLE001, S112
            continue
        if ext is not None:
            page_types[ext.idx0] = ext.page_type

    runs, assign = seed_runs_from_ranges(ranges, page_types)

    # Persist the runs artifact (numbering_store also feeds page_order naming).
    save_runs(data_root, project_id, NumberingRunsArtifact(runs=runs))

    # Stamp each page's leaf classification.
    for idx0, pt in page_types.items():
        leaf_role, plate_side = page_type_to_leaf_role(pt)
        update_page_extension(
            service,
            project_id,
            idx0,
            leaf_role=leaf_role,
            run_id=assign.get(idx0),
            plate_side=plate_side,
        )


def seed_default_runs(data_root: Path, project_id: str) -> None:
    """Seed a single default arabic body run for a NEW project.

    Called after ingest so a fresh project is numbered out of the box (parity
    with the old default front/body ranges).  Creates one ``bodymatter`` run
    (arabic, start=1) spanning all ingested pages and assigns every text/blank
    leaf to it; plates/covers/skips get no run.  No-op if runs already exist.
    """
    from pdomain_ops.pages import get_extension

    from pdomain_prep_for_pgdp.core.models import NumberingRunsArtifact
    from pdomain_prep_for_pgdp.core.numbering_store import load_runs, save_runs
    from pdomain_prep_for_pgdp.core.page_service_helpers import (
        _get_proj_page_ids,
        update_page_extension,
    )
    from pdomain_prep_for_pgdp.core.page_store_factory import build_page_service
    from pdomain_prep_for_pgdp.core.prep_extension import PrepPageExtension

    if load_runs(data_root, project_id).runs:
        return  # already seeded / migrated

    service = build_page_service(data_root, project_id)
    page_types: dict[int, PageType] = {}
    for page_uuid in _get_proj_page_ids(service, project_id):
        try:
            page_agg = service.store.get_page(page_uuid)
            ext = get_extension(page_agg.record, "prep", PrepPageExtension)
        except Exception:  # noqa: BLE001, S112
            continue
        if ext is not None:
            page_types[ext.idx0] = ext.page_type

    if not page_types:
        return

    body = NumberingRun(
        id="bodymatter",
        label="Body",
        style=RunStyle.arabic,
        start_mode=StartMode.set,
        start=1,
        step=1,
        span=(min(page_types), max(page_types)),
    )
    save_runs(data_root, project_id, NumberingRunsArtifact(runs=[body]))

    for idx0, pt in page_types.items():
        leaf_role, plate_side = page_type_to_leaf_role(pt)
        run_id = None if pt in _NO_RUN_TYPES or leaf_role is LeafRole.plate else body.id
        update_page_extension(
            service,
            project_id,
            idx0,
            leaf_role=leaf_role,
            run_id=run_id,
            plate_side=plate_side,
        )
