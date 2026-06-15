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
  4. **All** (app-wide) default — persisted in a JSON file at
     ``data_root/stage_settings_all.json``, keyed by stage_id.  Reads/writes go
     through ``AppWideStageSettings``.  No event log (not project-scoped).
  5. Registry default — the ``STAGE_SETTINGS_DEFAULTS`` dict for the stage.

Storage tiers:
- **page** tier: SQLite ``stage_settings`` table with ``tier='page:{page_id}'``
  (sparse — only fields that differ from the project default are stored).
- **project** tier: SQLite ``stage_settings`` table with ``tier='default'``
  (the existing "save as default" mechanism, kept backwards-compatible).
- **all** tier: ``data_root/stage_settings_all.json``
  (JSON dict ``{stage_id: {field: value, ...}, ...}``).

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
    # grayscale (Wave-2): conversion mode + sampler tuning
    "grayscale": {
        "mode": "perceptual",
        "sampler_radius": 3,
        "gamma": 1.1,
        "output_range_min": 12,
        "output_range_max": 248,
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
    # grayscale (Wave-2) — keys differ from ResolvedPageConfig field names
    "mode": "grayscale_mode",
    "sampler_radius": "grayscale_sampler_radius",
    "gamma": "grayscale_gamma",
    "output_range_min": "grayscale_output_range_min",
    "output_range_max": "grayscale_output_range_max",
    # The remaining keys match their ResolvedPageConfig field names directly.
}


def apply_stage_settings_to_config(
    cfg: ResolvedPageConfig,
    stage_id: str,
    effective_settings: dict[str, Any],
) -> ResolvedPageConfig:
    """Merge effective stage settings into a ``ResolvedPageConfig``.

    Precedence rule: per-page ``PageConfigOverrides`` values embedded in ``cfg``
    are NOT overwritten (they already won at resolve_page_config time).

    Only the fields declared in ``STAGE_SETTINGS_DEFAULTS[stage_id]`` are
    considered.  Unknown keys in ``effective_settings`` are ignored to allow
    forward-compatible settings dicts stored in older projects.

    Returns a new ``ResolvedPageConfig`` (``model_copy``); the input is
    unchanged.
    """
    if not effective_settings:
        return cfg

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
    """App-wide stage settings persisted to ``data_root/stage_settings_all.json``.

    Stores a top-level dict keyed by stage_id; each value is a sparse dict of
    field overrides.  Reads and writes are file-atomic (write-to-temp + rename).

    This is the **all** tier — applies to every project when no project-level or
    page-level setting overrides that field.
    """

    def __init__(self, data_root: str | os.PathLike[str]) -> None:
        from pathlib import Path

        self._path = Path(data_root) / "stage_settings_all.json"

    def _load(self) -> dict[str, dict[str, Any]]:
        if not self._path.exists():
            return {}
        try:
            data = json.loads(self._path.read_bytes().decode("utf-8"))
            if isinstance(data, dict):
                return data
        except Exception:  # noqa: S110
            pass
        return {}

    def _save(self, data: dict[str, dict[str, Any]]) -> None:
        import contextlib
        import os
        import tempfile

        self._path.parent.mkdir(parents=True, exist_ok=True)
        dir_ = str(self._path.parent)
        fd, tmp = tempfile.mkstemp(dir=dir_, prefix=".stage_settings_all_", suffix=".json.tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(data, f)
            os.replace(tmp, str(self._path))
        except Exception:
            with contextlib.suppress(OSError):
                os.unlink(tmp)
            raise

    def get(self, stage_id: str) -> dict[str, Any] | None:
        """Return the app-wide settings for ``stage_id``, or ``None`` if not set."""
        data = self._load()
        val = data.get(stage_id)
        if val is None or not isinstance(val, dict):
            return None
        return dict(val)

    def put(self, stage_id: str, settings: dict[str, Any]) -> None:
        """Write app-wide settings for ``stage_id``."""
        data = self._load()
        data[stage_id] = dict(settings)
        self._save(data)

    def delete(self, stage_id: str) -> None:
        """Remove app-wide settings for ``stage_id`` (no-op if not set)."""
        data = self._load()
        if stage_id in data:
            del data[stage_id]
            self._save(data)

    def all_stages(self) -> dict[str, dict[str, Any]]:
        """Return all stored app-wide settings, keyed by stage_id."""
        return dict(self._load())


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
