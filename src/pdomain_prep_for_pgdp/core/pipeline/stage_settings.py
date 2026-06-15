"""Per-stage settings store — effective-settings resolution with 3-tier precedence.

Spec: docs/specs/stage-registry-v2.md §5.2 (SettingsChange event)
      docs/specs/2026-06-10-statechart-convergence-design.md (B2 settings)

Effective-settings precedence (highest wins):
  1. Per-page ``PageConfigOverrides`` — already resolved into ``ResolvedPageConfig``
     by ``resolve_page_config`` before ``run_stage`` calls this module.  These are
     never overwritten by stage settings.
  2. **Page** override — sparse per-page per-stage override saved via
     ``save_page_override``.  Only the fields present in the stored dict override
     those fields; all other fields fall through to lower tiers.
  3. **Project** default — a project-level "my default" saved via
     ``save_as_default``.
  4. **All** (app-wide) default — persisted via ``pdomain-ops`` ``LocalFilePrefs``
     under the key ``stage_settings.<stage_id>`` in the suite's
     ``ui-prefs.json``.  Reads/writes go through ``AppWideStageSettings``.
     No event log (not project-scoped).
  5. Registry default — the ``STAGE_SETTINGS_DEFAULTS`` dict for the stage.

Storage tiers:
- **page** tier: SQLite ``stage_settings`` table with ``tier='page:{page_id}'``
  (sparse — only fields that differ from the project default are stored).
- **project** tier: SQLite ``stage_settings`` table with ``tier='default'``
  (the existing "save as default" mechanism, kept backwards-compatible).
- **all** tier: ``pdomain-ops`` ``LocalFilePrefs`` under the app key
  ``stage_settings.<stage_id>`` in the suite's shared ``ui-prefs.json``.
  Migration fallback: ``data_root/stage_settings_all.json`` is read if the
  prefs key is absent and the file exists.

The ``resolve_effective_3tier`` function merges field-by-field in the order above:
page field ?? project field ?? all field ?? registry field.

The run path in ``stage_runner.py`` passes ``page_id`` to
``StageSettingsStore.get_effective_3tier`` so per-page overrides are applied
at execution time for each page.
"""

from __future__ import annotations

import json
import sqlite3
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    import os

    from pdomain_prep_for_pgdp.core.models import ResolvedPageConfig
    from pdomain_prep_for_pgdp.core.pipeline.prep_aggregate import PrepProjectAggregate

_SCHEMA = """
CREATE TABLE IF NOT EXISTS stage_settings (
    project_id  TEXT NOT NULL,
    stage_id    TEXT NOT NULL,
    tier        TEXT NOT NULL,   -- 'override' | 'default' | 'page:{page_id}'
    settings    TEXT NOT NULL,   -- JSON blob
    updated_at  REAL NOT NULL,
    PRIMARY KEY (project_id, stage_id, tier)
);
CREATE INDEX IF NOT EXISTS stage_settings_proj ON stage_settings(project_id);
"""

# ── Registry defaults ─────────────────────────────────────────────────────────
#
# STAGE_SETTINGS_DEFAULTS maps v2 stage_id → the "registry default" dict passed
# to StageSettingsStore.get_effective when no project-level settings are saved.
#
# Keys in each dict must correspond 1:1 to ResolvedPageConfig fields (for shared
# fields) or to the stage-settings-specific field names on ResolvedPageConfig
# (for the new W1 knobs).  apply_stage_settings_to_config() maps these to the
# correct ResolvedPageConfig fields.
#
# Stages absent from this map have no tunable stage-level settings.

STAGE_SETTINGS_DEFAULTS: dict[str, dict[str, Any]] = {
    # denoise (W1.2): component-area and median-kernel thresholds
    "denoise": {
        "min_component_area": 6,
        "median_kernel_size": 0,
    },
    # deskew (W1.3): skip_auto_deskew (default True = always skip in registry)
    "deskew": {
        "skip_auto_deskew": True,
    },
    # canvas_map (W1.4 + W1.5): do_morph toggle + page aspect ratio
    "canvas_map": {
        "do_morph": False,
        "page_h_w_ratio": 1.294,
    },
    # post_transform_crop (W1.6): (top, bottom, left, right) pixel insets
    "post_transform_crop": {
        "post_transform_crop_insets": (0, 0, 0, 0),
    },
    # post_ocr_crop (W1.7): (top, bottom, left, right) pixel trims
    "post_ocr_crop": {
        "ocr_crop": (0, 0, 0, 0),
    },
    # crop (W1.8): fractional whitespace-pad after bbox crop
    "crop": {
        "white_space_additional": None,
    },
    # grayscale (Wave-2): nested pipeline config shape.
    # Matches GrayscaleConfigModel defaults: flatten off, converter=luma,
    # channel=green, color2gray defaults, clahe off, output_range=None.
    # Legacy flat fields (mode/gamma/sampler_radius/output_range_min/max) are
    # migrated on read via migrate_grayscale_settings() before this default is
    # consumed.
    "grayscale": {
        "flatten": {"enabled": False, "radius": 64, "strength": 1.0},
        "converter": "luma",
        "channel": "green",
        "color2gray": {
            "radius": 300,
            "samples": 4,
            "iterations": 10,
            "enhance_shadows": False,
        },
        "clahe": {"enabled": False, "clip_limit": 2.0, "tile_grid": 8},
        "output_range": None,
    },
}

# ── Settings key → ResolvedPageConfig field mapping ───────────────────────────
#
# Maps the key used in the settings dict to the ResolvedPageConfig field name.
# When they match, the key is omitted (identity mapping assumed).
# Used by apply_stage_settings_to_config to write the correct attribute.

_SETTINGS_KEY_TO_FIELD: dict[str, str] = {
    "min_component_area": "denoise_min_component_area",
    "median_kernel_size": "denoise_median_kernel_size",
    # The remaining keys match their ResolvedPageConfig field names directly.
    # NOTE: grayscale stage uses a special path in apply_stage_settings_to_config
    # (migrate_grayscale_settings + GrayscaleConfigModel.from_settings → .grayscale)
    # rather than flat-field assignment, so its keys do not appear here.
}


def migrate_grayscale_settings(d: dict[str, Any]) -> dict[str, Any]:
    """Migrate a legacy flat grayscale settings dict to the nested pipeline shape.

    Detects a legacy dict by the presence of ``mode``, ``gamma``,
    ``sampler_radius``, or ``output_range_min``/``output_range_max`` keys.
    A dict already in the nested pipeline shape (has ``converter``, ``flatten``,
    or ``clahe`` keys) is returned unchanged (idempotent).

    Legacy → nested mapping:
      ``mode == "perceptual"``  →  ``converter = "luma_bt709"``  (OQ-1 exact continuity)
      ``mode == "standard"``    →  ``converter = "luma"``
      ``output_range_min`` + ``output_range_max``  →  ``output_range: [min, max]``
      ``gamma`` and ``sampler_radius`` have no direct pipeline equivalent; they
      are dropped (the new pipeline models those concerns differently).

    An empty dict is returned as-is.
    """
    if not d:
        return d

    # Already in nested shape — pass through unchanged.
    nested_shape_keys = frozenset({"converter", "flatten", "clahe", "color2gray"})
    if nested_shape_keys & d.keys():
        return d

    # Legacy shape detected — build the nested equivalent.
    result: dict[str, Any] = {}

    # converter: map legacy mode → pipeline converter
    mode = d.get("mode", "standard")
    result["converter"] = "luma_bt709" if mode == "perceptual" else "luma"

    # output_range: combine flat min/max into a list
    range_min = d.get("output_range_min")
    range_max = d.get("output_range_max")
    if range_min is not None and range_max is not None:
        result["output_range"] = [range_min, range_max]

    # gamma and sampler_radius: no direct pipeline equivalent; dropped.
    # (The new pipeline models contrast/tone through clahe and flatten.)

    return result


def apply_stage_settings_to_config(
    cfg: ResolvedPageConfig,
    stage_id: str,
    effective_settings: dict[str, Any],
) -> ResolvedPageConfig:
    """Merge effective stage settings into a ``ResolvedPageConfig``.

    Precedence rule: per-page ``PageConfigOverrides`` values embedded in ``cfg``
    are NOT overwritten (they already won at resolve_page_config time).

    For the ``grayscale`` stage the settings dict is first run through
    ``migrate_grayscale_settings`` (converts legacy flat fields to the nested
    pipeline shape) and then built into ``ResolvedPageConfig.grayscale`` via
    ``GrayscaleConfigModel.from_settings``.  This path is separate from the
    flat-field assignment used by other stages so that the 3-tier resolution
    for non-grayscale stages is not affected.

    For all other stages: only the fields declared in
    ``STAGE_SETTINGS_DEFAULTS[stage_id]`` are considered.  Unknown keys in
    ``effective_settings`` are ignored to allow forward-compatible settings
    dicts stored in older projects.

    Returns a new ``ResolvedPageConfig`` (``model_copy``); the input is
    unchanged.
    """
    if not effective_settings:
        return cfg

    # ── Grayscale stage: nested pipeline config path ──────────────────────
    if stage_id == "grayscale":
        from pdomain_prep_for_pgdp.core.models import GrayscaleConfigModel

        migrated = migrate_grayscale_settings(effective_settings)
        grayscale_model = GrayscaleConfigModel.from_settings(migrated)
        return cfg.model_copy(update={"grayscale": grayscale_model})

    # ── All other stages: flat-field assignment ────────────────────────────
    registry_defaults = STAGE_SETTINGS_DEFAULTS.get(stage_id, {})
    updates: dict[str, Any] = {}

    for key, value in effective_settings.items():
        if key not in registry_defaults:
            # Unknown key — future-compat ignore.
            continue
        field = _SETTINGS_KEY_TO_FIELD.get(key, key)
        if not hasattr(cfg, field):
            # Field not on ResolvedPageConfig yet — ignore.
            continue
        updates[field] = value

    if not updates:
        return cfg
    return cfg.model_copy(update=updates)


def resolve_effective_3tier(
    page_settings: dict[str, Any] | None,
    project_settings: dict[str, Any] | None,
    all_settings: dict[str, Any] | None,
    registry_default: dict[str, Any],
) -> dict[str, Any]:
    """Merge four tiers field-by-field, highest precedence first.

    Resolution order per field:
      page_settings[key] ?? project_settings[key] ?? all_settings[key] ?? registry_default[key]

    Only keys declared in ``registry_default`` are considered.
    Returns a fresh dict.
    """
    result: dict[str, Any] = {}
    for key, reg_val in registry_default.items():
        if page_settings is not None and key in page_settings:
            result[key] = page_settings[key]
        elif project_settings is not None and key in project_settings:
            result[key] = project_settings[key]
        elif all_settings is not None and key in all_settings:
            result[key] = all_settings[key]
        else:
            result[key] = reg_val
    return result


def resolve_effective_with_sources(
    page_settings: dict[str, Any] | None,
    project_settings: dict[str, Any] | None,
    all_settings: dict[str, Any] | None,
    registry_default: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, str]]:
    """Like ``resolve_effective_3tier`` but also returns the tier source per field.

    Returns ``(effective, sources)`` where ``sources`` maps each field key to
    one of ``"page"``, ``"project"``, ``"all"``, or ``"registry"``.
    """
    result: dict[str, Any] = {}
    sources: dict[str, str] = {}
    for key, reg_val in registry_default.items():
        if page_settings is not None and key in page_settings:
            result[key] = page_settings[key]
            sources[key] = "page"
        elif project_settings is not None and key in project_settings:
            result[key] = project_settings[key]
            sources[key] = "project"
        elif all_settings is not None and key in all_settings:
            result[key] = all_settings[key]
            sources[key] = "all"
        else:
            result[key] = reg_val
            sources[key] = "registry"
    return result, sources


class AppWideStageSettings:
    """App-wide stage settings persisted via pdomain-ops ``LocalFilePrefs``.

    Each stage's settings are stored as a per-app blob under the key
    ``stage_settings.<stage_id>`` in the suite's shared ``ui-prefs.json`` file.
    This allows a single user-scoped prefs store to hold all app-wide stage
    defaults alongside other suite preferences.

    **Migration fallback:** if the prefs key for a stage is absent but the
    legacy ``data_root/stage_settings_all.json`` file exists (written by the
    prior JSON-file implementation), ``get()`` reads from that file for the
    requested stage.  Writes always go to prefs — never to the legacy file.

    This is the **all** tier — applies to every project when no project-level or
    page-level setting overrides that field.

    Parameters
    ----------
    data_root
        Used solely for the legacy migration fallback path
        ``data_root/stage_settings_all.json``.
    prefs_root
        Passed directly to ``LocalFilePrefs(root=prefs_root)``.  When ``None``
        the default platformdirs-based path is used (respects the
        ``PD_SUITE_DATA_DIR`` env var, which tests can monkeypatch).
    """

    _PREFS_KEY_PREFIX = "stage_settings."

    def __init__(
        self,
        data_root: str | os.PathLike[str],
        *,
        prefs_root: str | os.PathLike[str] | None = None,
    ) -> None:
        from pathlib import Path

        from pdomain_ops.suite.prefs import LocalFilePrefs

        self._legacy_path = Path(data_root) / "stage_settings_all.json"
        _root = Path(prefs_root) if prefs_root is not None else None
        self._prefs = LocalFilePrefs(root=_root)

    # ── private ──────────────────────────────────────────────────────────────

    def _prefs_key(self, stage_id: str) -> str:
        return f"{self._PREFS_KEY_PREFIX}{stage_id}"

    def _load_legacy(self) -> dict[str, dict[str, Any]]:
        """Read the legacy JSON file if it exists; return {} otherwise."""
        if not self._legacy_path.exists():
            return {}
        try:
            data = json.loads(self._legacy_path.read_bytes().decode("utf-8"))
            if isinstance(data, dict):
                return data
        except Exception:  # noqa: S110
            pass
        return {}

    # ── Public API ────────────────────────────────────────────────────────────

    def get(self, stage_id: str) -> dict[str, Any] | None:
        """Return the app-wide settings for ``stage_id``, or ``None`` if not set.

        Reads from prefs first; falls back to the legacy JSON file if the prefs
        key is absent but the legacy file exists.
        """
        apps = self._prefs.read().apps
        key = self._prefs_key(stage_id)
        if key in apps:
            val = apps[key]
            if isinstance(val, dict):
                return dict(val)
            return None

        # Migration fallback: prefs key absent — check the legacy JSON file.
        legacy = self._load_legacy()
        val = legacy.get(stage_id)
        if val is None or not isinstance(val, dict):
            return None
        return dict(val)

    def put(self, stage_id: str, settings: dict[str, Any]) -> None:
        """Write app-wide settings for ``stage_id`` to prefs."""
        self._prefs.write_app(self._prefs_key(stage_id), dict(settings))

    def delete(self, stage_id: str) -> None:
        """Remove app-wide settings for ``stage_id`` from prefs (no-op if not set).

        ``LocalFilePrefs.write_app`` only upserts a key; there is no public
        delete-key method on the adapter.  We use the adapter's internal
        lock + raw read/write primitives for an atomic in-place key removal.
        """
        key = self._prefs_key(stage_id)
        with self._prefs._acquire():
            data = self._prefs._read_raw()
            apps_in_file = data.get("apps", {})
            if key in apps_in_file:
                del apps_in_file[key]
                data["apps"] = apps_in_file
                self._prefs._write_raw(data)

    def all_stages(self) -> dict[str, dict[str, Any]]:
        """Return all stored app-wide settings, keyed by stage_id.

        Returns only entries from prefs (not the legacy JSON file).
        Legacy entries are surfaced individually via ``get()``.
        """
        apps = self._prefs.read().apps
        prefix = self._PREFS_KEY_PREFIX
        result: dict[str, dict[str, Any]] = {}
        for key, val in apps.items():
            if key.startswith(prefix) and isinstance(val, dict):
                stage_id = key[len(prefix) :]
                result[stage_id] = dict(val)
        return result


class StageSettingsStore:
    """SQLite-backed store for per-stage, per-project, and per-page settings.

    Tiers stored in this DB:
    - ``'default'``: project-level default (save_as_default)
    - ``'override'``: project-level per-run override (save_override) [legacy]
    - ``'page:{page_id}'``: sparse per-page override (save_page_override)

    Resolution when used stand-alone (without the app-wide 'all' tier):
        override > saved default > registry default.

    For full 3-tier resolution including the 'all' tier, use
    ``get_effective_3tier`` or ``get_effective_3tier_with_sources``.
    """

    def __init__(self, db_path: str | os.PathLike[str]) -> None:
        self._db_path = str(db_path)
        self._ensure_schema()

    # ── internal ──────────────────────────────────────────────────────────────

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._db_path, timeout=10.0)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    def _ensure_schema(self) -> None:
        with self._connect() as conn:
            conn.executescript(_SCHEMA)
            self._migrate_legacy_2tier_check(conn)

    @staticmethod
    def _migrate_legacy_2tier_check(conn: sqlite3.Connection) -> None:
        """Drop the stale ``CHECK (tier IN ('override','default'))`` constraint.

        Pre-3-tier project DBs were created with a 2-tier schema carrying that
        CHECK.  ``CREATE TABLE IF NOT EXISTS`` never re-runs on those DBs, so the
        stale CHECK survives and rejects the new ``tier='page:{page_id}'`` rows
        written by ``save_page_override`` (sqlite3.IntegrityError).

        SQLite cannot drop a CHECK via ``ALTER TABLE``, so this rebuilds the
        table: create a CHECK-free clone, copy every row verbatim, drop the old
        table, rename.  Tier values map identity — the new read path still
        consults both ``'default'`` (project tier) and ``'override'`` (page-level
        fallback), so no row remapping is needed; legacy flat grayscale settings
        in those rows are normalized on read by ``migrate_grayscale_settings``.

        Idempotent: a no-op on fresh / already-migrated DBs (those whose stored
        DDL has no CHECK clause).
        """
        row = conn.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='stage_settings'"
        ).fetchone()
        if row is None or "CHECK" not in (row[0] or "").upper():
            # Fresh DB (just created CHECK-free) or already migrated — nothing to do.
            return

        conn.execute("BEGIN IMMEDIATE")
        try:
            conn.execute("""
                CREATE TABLE stage_settings_migrated (
                    project_id  TEXT NOT NULL,
                    stage_id    TEXT NOT NULL,
                    tier        TEXT NOT NULL,
                    settings    TEXT NOT NULL,
                    updated_at  REAL NOT NULL,
                    PRIMARY KEY (project_id, stage_id, tier)
                )
            """)
            conn.execute("""
                INSERT INTO stage_settings_migrated
                    (project_id, stage_id, tier, settings, updated_at)
                SELECT project_id, stage_id, tier, settings, updated_at
                FROM stage_settings
            """)
            conn.execute("DROP TABLE stage_settings")
            conn.execute("ALTER TABLE stage_settings_migrated RENAME TO stage_settings")
            conn.execute("CREATE INDEX IF NOT EXISTS stage_settings_proj ON stage_settings(project_id)")
            conn.execute("COMMIT")
        except Exception:
            conn.execute("ROLLBACK")
            raise

    def _read_tier(self, project_id: str, stage_id: str, tier: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            cur = conn.execute(
                "SELECT settings FROM stage_settings WHERE project_id=? AND stage_id=? AND tier=?",
                (project_id, stage_id, tier),
            )
            row = cur.fetchone()
        if row is None:
            return None
        return dict(json.loads(row[0]))

    def _write_tier(self, project_id: str, stage_id: str, tier: str, settings: dict[str, Any]) -> None:
        import time

        with self._connect() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO stage_settings (project_id, stage_id, tier, settings, updated_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (project_id, stage_id, tier, json.dumps(settings), time.time()),
            )

    def _delete_tier(self, project_id: str, stage_id: str, tier: str) -> None:
        with self._connect() as conn:
            conn.execute(
                "DELETE FROM stage_settings WHERE project_id=? AND stage_id=? AND tier=?",
                (project_id, stage_id, tier),
            )

    @staticmethod
    def _page_tier_key(page_id: str) -> str:
        return f"page:{page_id}"

    def _current_effective(
        self, project_id: str, stage_id: str, registry_default: dict[str, Any]
    ) -> dict[str, Any]:
        """Legacy 2-tier resolution (override > default > registry)."""
        override = self._read_tier(project_id, stage_id, "override")
        if override is not None:
            return override
        saved = self._read_tier(project_id, stage_id, "default")
        if saved is not None:
            return saved
        return dict(registry_default)

    # ── Public read API ───────────────────────────────────────────────────────

    def get_effective(
        self,
        project_id: str,
        stage_id: str,
        *,
        registry_default: dict[str, Any],
    ) -> dict[str, Any]:
        """Return the effective settings for ``(project_id, stage_id)``.

        Legacy 2-tier resolution: override > saved default > registry_default.
        Use ``get_effective_3tier`` for the full 4-tier chain.
        Returns a fresh dict; mutating it does not affect stored state.
        """
        return self._current_effective(project_id, stage_id, registry_default)

    def get_project_default(self, project_id: str, stage_id: str) -> dict[str, Any] | None:
        """Return the project-level saved default, or None if not set."""
        return self._read_tier(project_id, stage_id, "default")

    def get_page_override(self, project_id: str, stage_id: str, page_id: str) -> dict[str, Any] | None:
        """Return the per-page sparse override dict, or None if not set."""
        return self._read_tier(project_id, stage_id, self._page_tier_key(page_id))

    def get_effective_3tier(
        self,
        project_id: str,
        stage_id: str,
        page_id: str | None,
        *,
        registry_default: dict[str, Any],
        app_wide: AppWideStageSettings | None = None,
    ) -> dict[str, Any]:
        """Full 4-tier resolution: page > project > all > registry.

        Parameters
        ----------
        page_id
            Zero-padded idx0 page identifier (e.g. ``"0000"``). When ``None``,
            the page tier is skipped (project-level or app-level GET).
        app_wide
            ``AppWideStageSettings`` instance providing the 'all' tier.
            When ``None``, the all tier is skipped.

        For the ``grayscale`` stage, each tier's settings dict is passed
        through ``migrate_grayscale_settings`` before the key-by-key merge so
        that legacy flat dicts (``{mode: perceptual}``, etc.) stored at any
        tier are normalised to the nested pipeline shape before resolution.
        This ensures that a legacy project-tier dict contributes the correct
        ``converter`` key into the merge even when a higher tier only provides
        a subset of the full nested shape.
        """
        page_settings: dict[str, Any] | None = None
        if page_id is not None:
            page_settings = self._read_tier(project_id, stage_id, self._page_tier_key(page_id))
            if page_settings is None:
                # Fall back to legacy 'override' tier (written by the old PUT .../settings route).
                page_settings = self._read_tier(project_id, stage_id, "override")

        project_settings = self._read_tier(project_id, stage_id, "default")

        all_settings: dict[str, Any] | None = None
        if app_wide is not None:
            all_settings = app_wide.get(stage_id)

        # Per-tier migration for the grayscale stage: normalize legacy flat dicts
        # (e.g. {mode: perceptual}) to nested pipeline shape before the key-by-key
        # merge, so the "converter" key is present for resolution even when a tier
        # stored data in the old flat format.
        if stage_id == "grayscale":
            if page_settings is not None:
                page_settings = migrate_grayscale_settings(page_settings)
            if project_settings is not None:
                project_settings = migrate_grayscale_settings(project_settings)
            if all_settings is not None:
                all_settings = migrate_grayscale_settings(all_settings)

        return resolve_effective_3tier(page_settings, project_settings, all_settings, registry_default)

    def get_effective_3tier_with_sources(
        self,
        project_id: str,
        stage_id: str,
        page_id: str | None,
        *,
        registry_default: dict[str, Any],
        app_wide: AppWideStageSettings | None = None,
    ) -> tuple[dict[str, Any], dict[str, str]]:
        """Like ``get_effective_3tier`` but also returns the tier source per field.

        Returns ``(effective, sources)`` where ``sources[key]`` is one of
        ``"page"``, ``"project"``, ``"all"``, or ``"registry"``.

        Per-tier grayscale migration is applied for the same reason as in
        ``get_effective_3tier`` — see that method's docstring for details.
        """
        page_settings: dict[str, Any] | None = None
        if page_id is not None:
            page_settings = self._read_tier(project_id, stage_id, self._page_tier_key(page_id))
            if page_settings is None:
                # Fall back to legacy 'override' tier (written by the old PUT .../settings route).
                page_settings = self._read_tier(project_id, stage_id, "override")

        project_settings = self._read_tier(project_id, stage_id, "default")

        all_settings: dict[str, Any] | None = None
        if app_wide is not None:
            all_settings = app_wide.get(stage_id)

        # Per-tier migration for the grayscale stage (same rationale as get_effective_3tier).
        if stage_id == "grayscale":
            if page_settings is not None:
                page_settings = migrate_grayscale_settings(page_settings)
            if project_settings is not None:
                project_settings = migrate_grayscale_settings(project_settings)
            if all_settings is not None:
                all_settings = migrate_grayscale_settings(all_settings)

        return resolve_effective_with_sources(page_settings, project_settings, all_settings, registry_default)

    # ── Mutation operations ───────────────────────────────────────────────────

    def save_page_override(
        self,
        project_id: str,
        stage_id: str,
        page_id: str,
        settings: dict[str, Any],
        *,
        aggregate: PrepProjectAggregate | None = None,
        registry_default: dict[str, Any] | None = None,
        actor_id: str = "default",
    ) -> None:
        """Save a sparse per-page override for this stage.

        Appends a ``SettingsChange`` event to ``aggregate`` when supplied.
        """
        before: dict[str, Any] = {}
        if aggregate is not None and registry_default is not None:
            before = self._current_effective(project_id, stage_id, registry_default)

        self._write_tier(project_id, stage_id, self._page_tier_key(page_id), settings)

        if aggregate is not None and registry_default is not None:
            aggregate.record_settings_change(
                scope="stage",
                stage_id=stage_id,
                before=before,
                after=dict(settings),
                actor_id=actor_id,
            )

    def delete_page_override(
        self,
        project_id: str,
        stage_id: str,
        page_id: str,
        *,
        aggregate: PrepProjectAggregate | None = None,
        registry_default: dict[str, Any] | None = None,
        actor_id: str = "default",
    ) -> None:
        """Remove the per-page override, reverting to project/all/registry resolution."""
        before: dict[str, Any] = {}
        if aggregate is not None and registry_default is not None:
            before = self._current_effective(project_id, stage_id, registry_default)

        self._delete_tier(project_id, stage_id, self._page_tier_key(page_id))

        if aggregate is not None and registry_default is not None:
            after = self._current_effective(project_id, stage_id, registry_default)
            aggregate.record_settings_change(
                scope="stage",
                stage_id=stage_id,
                before=before,
                after=after,
                actor_id=actor_id,
            )

    def save_as_default(
        self,
        project_id: str,
        stage_id: str,
        settings: dict[str, Any],
        *,
        aggregate: PrepProjectAggregate | None = None,
        registry_default: dict[str, Any] | None = None,
        actor_id: str = "default",
    ) -> None:
        """Save ``settings`` as the project-level default for this stage.

        Appends a ``SettingsChange`` event to ``aggregate`` when supplied.
        ``before`` in the event is the effective settings before this write.
        """
        before: dict[str, Any] = {}
        if aggregate is not None and registry_default is not None:
            before = self._current_effective(project_id, stage_id, registry_default)

        self._write_tier(project_id, stage_id, "default", settings)

        if aggregate is not None and registry_default is not None:
            aggregate.record_settings_change(
                scope="stage",
                stage_id=stage_id,
                before=before,
                after=dict(settings),
                actor_id=actor_id,
            )

    def save_override(
        self,
        project_id: str,
        stage_id: str,
        settings: dict[str, Any],
        *,
        aggregate: PrepProjectAggregate | None = None,
        registry_default: dict[str, Any] | None = None,
        actor_id: str = "default",
    ) -> None:
        """Save a per-run project override for this stage.

        Appends a ``SettingsChange`` event to ``aggregate`` when supplied.
        """
        before: dict[str, Any] = {}
        if aggregate is not None and registry_default is not None:
            before = self._current_effective(project_id, stage_id, registry_default)

        self._write_tier(project_id, stage_id, "override", settings)

        if aggregate is not None and registry_default is not None:
            aggregate.record_settings_change(
                scope="stage",
                stage_id=stage_id,
                before=before,
                after=dict(settings),
                actor_id=actor_id,
            )

    def revert(
        self,
        project_id: str,
        stage_id: str,
        *,
        aggregate: PrepProjectAggregate | None = None,
        registry_default: dict[str, Any] | None = None,
        actor_id: str = "default",
    ) -> None:
        """Remove the project override, reverting to saved default (or registry default).

        Appends a ``SettingsChange`` event to ``aggregate`` when supplied.
        ``before`` = override (or saved default if no override), ``after`` =
        saved default (or registry default if no saved default).
        """
        before: dict[str, Any] = {}
        if aggregate is not None and registry_default is not None:
            before = self._current_effective(project_id, stage_id, registry_default)

        self._delete_tier(project_id, stage_id, "override")

        if aggregate is not None and registry_default is not None:
            after = self._current_effective(project_id, stage_id, registry_default)
            aggregate.record_settings_change(
                scope="stage",
                stage_id=stage_id,
                before=before,
                after=after,
                actor_id=actor_id,
            )

    def reset(
        self,
        project_id: str,
        stage_id: str,
        *,
        aggregate: PrepProjectAggregate | None = None,
        registry_default: dict[str, Any] | None = None,
        actor_id: str = "default",
    ) -> None:
        """Remove both override and saved default, reverting to registry default.

        Appends a ``SettingsChange`` event to ``aggregate`` when supplied.
        ``before`` = current effective, ``after`` = registry_default.
        """
        before: dict[str, Any] = {}
        if aggregate is not None and registry_default is not None:
            before = self._current_effective(project_id, stage_id, registry_default)

        self._delete_tier(project_id, stage_id, "override")
        self._delete_tier(project_id, stage_id, "default")

        if aggregate is not None and registry_default is not None:
            aggregate.record_settings_change(
                scope="stage",
                stage_id=stage_id,
                before=before,
                after=dict(registry_default),
                actor_id=actor_id,
            )
