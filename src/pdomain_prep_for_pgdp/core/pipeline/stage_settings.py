"""Per-stage settings store — effective-settings resolution with precedence.

Spec: docs/specs/stage-registry-v2.md §5.2 (SettingsChange event)
      docs/specs/2026-06-10-statechart-convergence-design.md (B2 settings)

Resolution precedence (highest → lowest):
  1. Project override — a per-run per-project override saved via ``save_override``.
  2. Saved project default — a project-level "my default" saved via ``save_as_default``.
  3. Registry default — the caller-supplied ``registry_default`` dict.

Operations that mutate state append a ``SettingsChange`` event to the supplied
``PrepProjectAggregate`` (if provided). This keeps the event-sourcing store
as the system-of-record for audit / reindex.

Storage: a SQLite DB (one per project data_root, path passed at construction).
The schema uses one table with a ``tier`` discriminator ('override' | 'default').

This module is intentionally thin and side-effect free with respect to the runner.
It does NOT read STAGE_IMPL or stage_dag — callers supply the registry_default.
"""

from __future__ import annotations

import json
import sqlite3
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    import os

    from pdomain_prep_for_pgdp.core.pipeline.prep_aggregate import PrepProjectAggregate

_SCHEMA = """
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


class StageSettingsStore:
    """SQLite-backed store for per-stage, per-project settings.

    Resolution precedence: override > saved default > registry default.

    Usage::

        store = StageSettingsStore(data_root / "stage_settings.db")
        effective = store.get_effective(
            project_id, "denoise", registry_default={"min_component_area": 6}
        )
        store.save_as_default(project_id, "denoise", {"min_component_area": 12},
                              aggregate=agg, registry_default=..., actor_id="user-1")
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

    def _current_effective(
        self, project_id: str, stage_id: str, registry_default: dict[str, Any]
    ) -> dict[str, Any]:
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

        Resolution: override > saved default > registry_default.
        Returns a fresh dict; mutating it does not affect stored state.
        """
        return self._current_effective(project_id, stage_id, registry_default)

    # ── Mutation operations ───────────────────────────────────────────────────

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
