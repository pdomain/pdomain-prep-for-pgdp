"""B2 — per-stage settings store.

TDD tests for the stage_settings module:
  - effective settings resolution: project override > saved default > registry default
  - save-as-default: persists settings as the project-level default
  - revert: restores to saved default
  - reset: restores to registry default
  - every change appends a SettingsChange event via PrepProjectAggregate

Spec: docs/specs/stage-registry-v2.md §5.2 (SettingsChange event)
      docs/specs/2026-06-10-statechart-convergence-design.md (B2 settings)
"""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from pathlib import Path

# ──────────────────────────────────────────────────────────────────────────────
# Import guard
# ──────────────────────────────────────────────────────────────────────────────


def test_stage_settings_importable() -> None:
    """StageSettingsStore is importable from the correct module path."""
    from pdomain_prep_for_pgdp.core.pipeline.stage_settings import StageSettingsStore

    assert StageSettingsStore is not None


# ──────────────────────────────────────────────────────────────────────────────
# Resolution precedence
# ──────────────────────────────────────────────────────────────────────────────


def test_effective_settings_returns_registry_default_when_nothing_saved(tmp_path: Path) -> None:
    """Effective settings falls back to registry default when no overrides are saved."""
    from pdomain_prep_for_pgdp.core.pipeline.stage_settings import StageSettingsStore

    store = StageSettingsStore(tmp_path / "settings.db")
    project_id = "proj-1"
    stage_id = "denoise"
    registry_default = {"min_component_area": 6, "median_kernel_size": 0}

    effective = store.get_effective(project_id, stage_id, registry_default=registry_default)
    assert effective == registry_default


def test_effective_settings_returns_saved_default_over_registry(tmp_path: Path) -> None:
    """Effective settings uses saved project default over registry default."""
    from pdomain_prep_for_pgdp.core.pipeline.stage_settings import StageSettingsStore

    store = StageSettingsStore(tmp_path / "settings.db")
    project_id = "proj-1"
    stage_id = "denoise"
    registry_default = {"min_component_area": 6, "median_kernel_size": 0}
    saved_default = {"min_component_area": 10, "median_kernel_size": 0}

    store.save_as_default(project_id, stage_id, saved_default)
    effective = store.get_effective(project_id, stage_id, registry_default=registry_default)
    assert effective == saved_default


def test_effective_settings_project_override_wins(tmp_path: Path) -> None:
    """Project override (per-run settings) wins over saved default and registry default."""
    from pdomain_prep_for_pgdp.core.pipeline.stage_settings import StageSettingsStore

    store = StageSettingsStore(tmp_path / "settings.db")
    project_id = "proj-1"
    stage_id = "denoise"
    registry_default: dict[str, Any] = {"min_component_area": 6, "median_kernel_size": 0}
    saved_default: dict[str, Any] = {"min_component_area": 10, "median_kernel_size": 0}
    override: dict[str, Any] = {"min_component_area": 20, "median_kernel_size": 3}

    store.save_as_default(project_id, stage_id, saved_default)
    store.save_override(project_id, stage_id, override)
    effective = store.get_effective(project_id, stage_id, registry_default=registry_default)
    assert effective == override


def test_resolution_precedence_order(tmp_path: Path) -> None:
    """Resolution: override > saved_default > registry_default — three tiers tested together."""
    from pdomain_prep_for_pgdp.core.pipeline.stage_settings import StageSettingsStore

    store = StageSettingsStore(tmp_path / "settings.db")
    proj = "proj-prec"
    stage = "dewarp"
    reg_default: dict[str, Any] = {"confidence_threshold": 0.5}
    saved: dict[str, Any] = {"confidence_threshold": 0.7}
    override: dict[str, Any] = {"confidence_threshold": 0.9}

    # Tier 1: registry default only
    assert store.get_effective(proj, stage, registry_default=reg_default) == reg_default

    # Tier 2: saved default wins over registry
    store.save_as_default(proj, stage, saved)
    assert store.get_effective(proj, stage, registry_default=reg_default) == saved

    # Tier 3: override wins over saved default
    store.save_override(proj, stage, override)
    assert store.get_effective(proj, stage, registry_default=reg_default) == override


# ──────────────────────────────────────────────────────────────────────────────
# Operations: save-as-default, revert, reset
# ──────────────────────────────────────────────────────────────────────────────


def test_save_as_default_persists(tmp_path: Path) -> None:
    """save_as_default makes the settings survive a store recreation."""
    from pdomain_prep_for_pgdp.core.pipeline.stage_settings import StageSettingsStore

    db_path = tmp_path / "settings.db"
    store1 = StageSettingsStore(db_path)
    store1.save_as_default("proj-1", "denoise", {"min_component_area": 15})

    store2 = StageSettingsStore(db_path)
    reg_default: dict[str, Any] = {"min_component_area": 6}
    effective = store2.get_effective("proj-1", "denoise", registry_default=reg_default)
    assert effective == {"min_component_area": 15}


def test_revert_removes_override(tmp_path: Path) -> None:
    """revert removes the project override, falling back to saved default."""
    from pdomain_prep_for_pgdp.core.pipeline.stage_settings import StageSettingsStore

    store = StageSettingsStore(tmp_path / "settings.db")
    proj, stage = "proj-1", "denoise"
    reg_default: dict[str, Any] = {"min_component_area": 6}
    saved: dict[str, Any] = {"min_component_area": 10}
    override: dict[str, Any] = {"min_component_area": 20}

    store.save_as_default(proj, stage, saved)
    store.save_override(proj, stage, override)

    # confirm override is active
    assert store.get_effective(proj, stage, registry_default=reg_default) == override

    store.revert(proj, stage)
    # after revert, falls back to saved default
    assert store.get_effective(proj, stage, registry_default=reg_default) == saved


def test_reset_removes_both_override_and_saved_default(tmp_path: Path) -> None:
    """reset removes both override and saved default, falling back to registry default."""
    from pdomain_prep_for_pgdp.core.pipeline.stage_settings import StageSettingsStore

    store = StageSettingsStore(tmp_path / "settings.db")
    proj, stage = "proj-1", "denoise"
    reg_default: dict[str, Any] = {"min_component_area": 6}
    saved: dict[str, Any] = {"min_component_area": 10}
    override: dict[str, Any] = {"min_component_area": 20}

    store.save_as_default(proj, stage, saved)
    store.save_override(proj, stage, override)

    store.reset(proj, stage)
    # after reset, back to registry default
    assert store.get_effective(proj, stage, registry_default=reg_default) == reg_default


def test_revert_with_no_saved_default_falls_to_registry(tmp_path: Path) -> None:
    """revert when no saved default exists falls back to registry default."""
    from pdomain_prep_for_pgdp.core.pipeline.stage_settings import StageSettingsStore

    store = StageSettingsStore(tmp_path / "settings.db")
    proj, stage = "proj-1", "denoise"
    reg_default: dict[str, Any] = {"min_component_area": 6}
    override: dict[str, Any] = {"min_component_area": 20}

    store.save_override(proj, stage, override)
    store.revert(proj, stage)
    assert store.get_effective(proj, stage, registry_default=reg_default) == reg_default


# ──────────────────────────────────────────────────────────────────────────────
# SettingsChange events via PrepProjectAggregate
# ──────────────────────────────────────────────────────────────────────────────


def test_save_as_default_appends_settings_change_event(tmp_path: Path) -> None:
    """save_as_default appends a SettingsChange event with before/after payload."""
    from pdomain_prep_for_pgdp.core.pipeline.prep_aggregate import PrepProjectAggregate
    from pdomain_prep_for_pgdp.core.pipeline.stage_settings import StageSettingsStore

    store = StageSettingsStore(tmp_path / "settings.db")
    project_id = uuid.uuid4()
    agg = PrepProjectAggregate(project_id=project_id)
    stage_id = "denoise"
    reg_default: dict[str, Any] = {"min_component_area": 6}
    new_settings: dict[str, Any] = {"min_component_area": 12}

    store.save_as_default(
        str(project_id),
        stage_id,
        new_settings,
        aggregate=agg,
        registry_default=reg_default,
        actor_id="default",
    )

    events = list(agg.pending_events)
    settings_events = [e for e in events if type(e).__name__ == "SettingsChange"]
    assert len(settings_events) == 1, f"expected 1 SettingsChange, got {len(settings_events)}"
    ev = settings_events[0]
    assert ev.scope == "stage"
    assert ev.stage_id == stage_id
    assert ev.before == reg_default
    assert ev.after == new_settings


def test_save_override_appends_settings_change_event(tmp_path: Path) -> None:
    """save_override appends a SettingsChange event with before/after payload."""
    from pdomain_prep_for_pgdp.core.pipeline.prep_aggregate import PrepProjectAggregate
    from pdomain_prep_for_pgdp.core.pipeline.stage_settings import StageSettingsStore

    store = StageSettingsStore(tmp_path / "settings.db")
    project_id = uuid.uuid4()
    stage_id = "denoise"
    reg_default: dict[str, Any] = {"min_component_area": 6}
    saved_default: dict[str, Any] = {"min_component_area": 10}
    override: dict[str, Any] = {"min_component_area": 25}

    # Establish a saved default so "before" is not just the registry default
    store.save_as_default(str(project_id), stage_id, saved_default)

    agg = PrepProjectAggregate(project_id=project_id)
    store.save_override(
        str(project_id),
        stage_id,
        override,
        aggregate=agg,
        registry_default=reg_default,
        actor_id="default",
    )

    events = list(agg.pending_events)
    settings_events = [e for e in events if type(e).__name__ == "SettingsChange"]
    assert len(settings_events) == 1, f"expected 1 SettingsChange, got {len(settings_events)}"
    ev = settings_events[0]
    assert ev.scope == "stage"
    assert ev.stage_id == stage_id
    assert ev.before == saved_default  # saved default was active before the override
    assert ev.after == override


def test_revert_appends_settings_change_event(tmp_path: Path) -> None:
    """revert appends a SettingsChange event."""
    from pdomain_prep_for_pgdp.core.pipeline.prep_aggregate import PrepProjectAggregate
    from pdomain_prep_for_pgdp.core.pipeline.stage_settings import StageSettingsStore

    store = StageSettingsStore(tmp_path / "settings.db")
    project_id = uuid.uuid4()
    proj_str = str(project_id)
    stage_id = "denoise"
    reg_default: dict[str, Any] = {"min_component_area": 6}
    saved: dict[str, Any] = {"min_component_area": 10}
    override: dict[str, Any] = {"min_component_area": 20}

    store.save_as_default(proj_str, stage_id, saved)
    store.save_override(proj_str, stage_id, override)

    agg = PrepProjectAggregate(project_id=project_id)
    store.revert(
        proj_str,
        stage_id,
        aggregate=agg,
        registry_default=reg_default,
        actor_id="default",
    )

    events = list(agg.pending_events)
    settings_events = [e for e in events if type(e).__name__ == "SettingsChange"]
    assert len(settings_events) == 1
    ev = settings_events[0]
    assert ev.before == override
    assert ev.after == saved  # reverted to saved default


def test_reset_appends_settings_change_event(tmp_path: Path) -> None:
    """reset appends a SettingsChange event."""
    from pdomain_prep_for_pgdp.core.pipeline.prep_aggregate import PrepProjectAggregate
    from pdomain_prep_for_pgdp.core.pipeline.stage_settings import StageSettingsStore

    store = StageSettingsStore(tmp_path / "settings.db")
    project_id = uuid.uuid4()
    proj_str = str(project_id)
    stage_id = "denoise"
    reg_default: dict[str, Any] = {"min_component_area": 6}
    override: dict[str, Any] = {"min_component_area": 20}

    store.save_override(proj_str, stage_id, override)
    agg = PrepProjectAggregate(project_id=project_id)

    store.reset(
        proj_str,
        stage_id,
        aggregate=agg,
        registry_default=reg_default,
        actor_id="default",
    )

    events = list(agg.pending_events)
    settings_events = [e for e in events if type(e).__name__ == "SettingsChange"]
    assert len(settings_events) == 1
    ev = settings_events[0]
    assert ev.before == override
    assert ev.after == reg_default


# ──────────────────────────────────────────────────────────────────────────────
# Cross-project isolation
# ──────────────────────────────────────────────────────────────────────────────


def test_settings_isolated_per_project(tmp_path: Path) -> None:
    """Settings for different projects in the same DB are isolated."""
    from pdomain_prep_for_pgdp.core.pipeline.stage_settings import StageSettingsStore

    store = StageSettingsStore(tmp_path / "settings.db")
    reg_default: dict[str, Any] = {"min_component_area": 6}

    store.save_as_default("proj-A", "denoise", {"min_component_area": 10})
    store.save_as_default("proj-B", "denoise", {"min_component_area": 20})

    assert store.get_effective("proj-A", "denoise", registry_default=reg_default) == {
        "min_component_area": 10
    }
    assert store.get_effective("proj-B", "denoise", registry_default=reg_default) == {
        "min_component_area": 20
    }


def test_settings_isolated_per_stage(tmp_path: Path) -> None:
    """Settings for different stages in the same project are isolated."""
    from pdomain_prep_for_pgdp.core.pipeline.stage_settings import StageSettingsStore

    store = StageSettingsStore(tmp_path / "settings.db")
    proj = "proj-1"
    reg_denoise: dict[str, Any] = {"min_component_area": 6}
    reg_dewarp: dict[str, Any] = {"confidence_threshold": 0.5}

    store.save_as_default(proj, "denoise", {"min_component_area": 12})
    # dewarp has no saved default

    assert store.get_effective(proj, "denoise", registry_default=reg_denoise) == {"min_component_area": 12}
    assert store.get_effective(proj, "dewarp", registry_default=reg_dewarp) == reg_dewarp


# ──────────────────────────────────────────────────────────────────────────────
# Legacy 2-tier schema migration (stale CHECK constraint)
# ──────────────────────────────────────────────────────────────────────────────
#
# Pre-existing project DBs were created by the OLD 2-tier code, whose schema
# carried ``CHECK (tier IN ('override', 'default'))``.  ``CREATE TABLE IF NOT
# EXISTS`` never re-runs on those DBs, so the stale CHECK survives and rejects
# the new ``tier='page:{page_id}'`` rows written by ``save_page_override``,
# producing a 500 (sqlite3.IntegrityError).  The store must detect and migrate
# the stale schema on open, losslessly preserving existing rows.


# The verbatim OLD 2-tier schema (with the stale CHECK) used to seed a legacy DB.
_LEGACY_2TIER_SCHEMA = """
CREATE TABLE IF NOT EXISTS stage_settings (
    project_id  TEXT NOT NULL,
    stage_id    TEXT NOT NULL,
    tier        TEXT NOT NULL,   -- 'override' | 'default'
    settings    TEXT NOT NULL,   -- JSON blob
    updated_at  REAL NOT NULL,
    PRIMARY KEY (project_id, stage_id, tier),
    CHECK (tier IN ('override', 'default'))
);
CREATE INDEX IF NOT EXISTS stage_settings_proj ON stage_settings(project_id);
"""


def _seed_legacy_db(db_path: Path, *, project_id: str) -> None:
    """Create a DB with the OLD 2-tier schema and one legacy flat grayscale row."""
    import sqlite3

    conn = sqlite3.connect(str(db_path))
    try:
        conn.executescript(_LEGACY_2TIER_SCHEMA)
        conn.execute(
            "INSERT INTO stage_settings (project_id, stage_id, tier, settings, updated_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (project_id, "grayscale", "override", '{"mode": "standard", "sampler_radius": 2}', 1.0),
        )
        conn.commit()
    finally:
        conn.close()


def _table_has_check(db_path: Path) -> bool:
    """True if the stored stage_settings DDL still contains a CHECK clause."""
    import sqlite3

    conn = sqlite3.connect(str(db_path))
    try:
        row = conn.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='stage_settings'"
        ).fetchone()
    finally:
        conn.close()
    return bool(row) and "CHECK" in row[0].upper()


def test_legacy_2tier_db_save_page_override_succeeds(tmp_path: Path) -> None:
    """Opening a store against a legacy 2-tier DB migrates away the stale CHECK.

    Regression: ``save_page_override`` writing ``tier='page:{page_id}'`` must no
    longer raise ``sqlite3.IntegrityError: CHECK constraint failed``.
    """
    from pdomain_prep_for_pgdp.core.pipeline.stage_settings import StageSettingsStore

    db_path = tmp_path / "stage_settings.db"
    project_id = "legacy-proj"
    _seed_legacy_db(db_path, project_id=project_id)
    assert _table_has_check(db_path), "fixture should start with the stale CHECK"

    store = StageSettingsStore(db_path)
    # Stale CHECK must be gone after open.
    assert not _table_has_check(db_path), "CHECK should be removed by migration"

    # The blocking operation must now succeed.
    store.save_page_override(
        project_id,
        "grayscale",
        "0007",
        {"converter": "luma_bt709"},
    )
    page_ov = store.get_page_override(project_id, "grayscale", "0007")
    assert page_ov == {"converter": "luma_bt709"}


def test_legacy_2tier_db_preserves_legacy_row_and_resolves(tmp_path: Path) -> None:
    """The legacy 'override' row survives migration and resolves to the migrated config.

    The legacy flat ``{mode: standard}`` row stays in the 'override' tier (which
    the new read path consults as a page-level fallback) and must resolve via
    ``migrate_grayscale_settings`` to ``converter='luma'``.
    """
    from pdomain_prep_for_pgdp.core.pipeline.stage_settings import StageSettingsStore

    db_path = tmp_path / "stage_settings.db"
    project_id = "legacy-proj"
    _seed_legacy_db(db_path, project_id=project_id)

    store = StageSettingsStore(db_path)

    # Raw legacy row is preserved verbatim in the 'override' tier.
    raw = store._read_tier(project_id, "grayscale", "override")
    assert raw == {"mode": "standard", "sampler_radius": 2}

    # Registry default for grayscale (nested pipeline shape).
    from pdomain_prep_for_pgdp.core.pipeline.stage_settings import STAGE_SETTINGS_DEFAULTS

    reg = STAGE_SETTINGS_DEFAULTS["grayscale"]
    # No page:{page_id} row → falls back to legacy 'override' → migrated to converter=luma.
    effective = store.get_effective_3tier(project_id, "grayscale", "0007", registry_default=reg)
    assert effective["converter"] == "luma"


def test_legacy_2tier_db_migration_idempotent(tmp_path: Path) -> None:
    """Opening the store twice against the same (now-migrated) DB does not error."""
    from pdomain_prep_for_pgdp.core.pipeline.stage_settings import StageSettingsStore

    db_path = tmp_path / "stage_settings.db"
    project_id = "legacy-proj"
    _seed_legacy_db(db_path, project_id=project_id)

    StageSettingsStore(db_path)  # first open migrates
    assert not _table_has_check(db_path)
    # Second open must be a no-op (no CHECK to migrate) and must not raise.
    store2 = StageSettingsStore(db_path)
    assert not _table_has_check(db_path)
    # And it still works.
    store2.save_page_override(project_id, "grayscale", "0001", {"converter": "luma"})
    assert store2.get_page_override(project_id, "grayscale", "0001") == {"converter": "luma"}


def test_fresh_db_has_no_check_and_is_not_migrated(tmp_path: Path) -> None:
    """A fresh DB (created by the current _SCHEMA) has no CHECK and needs no migration."""
    from pdomain_prep_for_pgdp.core.pipeline.stage_settings import StageSettingsStore

    db_path = tmp_path / "stage_settings.db"
    store = StageSettingsStore(db_path)
    assert not _table_has_check(db_path)
    # page override works on a fresh DB too.
    store.save_page_override("p", "grayscale", "0001", {"converter": "luma"})
    assert store.get_page_override("p", "grayscale", "0001") == {"converter": "luma"}
