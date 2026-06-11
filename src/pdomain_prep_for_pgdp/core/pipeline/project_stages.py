"""ProjectStageStore — dual-write store for project-scoped stage state.

Spec: docs/specs/api-v2-deltas.md §3 (ProjectStageState, ProjectStageStatus)
      docs/specs/stage-registry-v2.md §2.2 (8 project-scoped stages)

Mirrors the page_stages dual-write contract:
  state change = artifact on disk + ProjectStageState DB row + event in eventsourcing
  crash between writes leaves reindex-recoverable state.

The store is SQLite-backed (a simple per-project table). The dual-write
contract is identical to PageStageState; the schema differs only in that
project_stages has no page_id column and uses V2_PROJECT_STAGE_IDS.
"""

from __future__ import annotations

import sqlite3
from typing import TYPE_CHECKING

from pdomain_prep_for_pgdp.core.models import (
    V2_PROJECT_STAGE_IDS,
    ProjectStageState,
    ProjectStageStatus,
)
from pdomain_prep_for_pgdp.core.pipeline.stage_dag import compute_v2_dirty_descendants

if TYPE_CHECKING:
    from pathlib import Path

# Artifact filenames per project-scoped stage (mirrors stage-registry-v2.md §6)
_ARTIFACT_FILES: dict[str, str] = {
    "source": "output.json",
    "page_order": "output.json",
    "validation": "output.json",
    "proof_pack": "output.json",  # placeholder; real=directory artifact
    "build_package": "output.zip",
    "zip": "output.zip",
    "submit_check": "output.json",
    "archive": "output.json",
}

_PROJECT_STAGE_STATUS_VALUES = "('not-run', 'running', 'clean', 'dirty', 'failed')"

_PROJECT_STAGE_ID_VALUES = "(" + ", ".join(f"'{s}'" for s in V2_PROJECT_STAGE_IDS) + ")"

_SCHEMA = f"""
CREATE TABLE IF NOT EXISTS project_stages (
    project_id    TEXT    NOT NULL,
    stage_id      TEXT    NOT NULL,
    status        TEXT    NOT NULL DEFAULT 'not-run',
    stage_version INTEGER NOT NULL DEFAULT 2,
    artifact_key  TEXT,
    config_hash   TEXT,
    input_hash    TEXT,
    last_run_at   REAL,
    duration_ms   INTEGER,
    error_message TEXT,
    job_id        TEXT,
    PRIMARY KEY (project_id, stage_id),
    CHECK (status IN {_PROJECT_STAGE_STATUS_VALUES}),
    CHECK (stage_id IN {_PROJECT_STAGE_ID_VALUES})
);
CREATE INDEX IF NOT EXISTS project_stages_proj
    ON project_stages(project_id);
"""

_RowTuple = tuple[
    str, str, str, int, str | None, str | None, str | None, float | None, int | None, str | None, str | None
]


def _row_to_state(row: _RowTuple) -> ProjectStageState:
    (
        project_id,
        stage_id,
        status,
        stage_version,
        artifact_key,
        config_hash,
        input_hash,
        last_run_at,
        duration_ms,
        error_message,
        job_id,
    ) = row
    return ProjectStageState(
        project_id=project_id,
        stage_id=stage_id,
        status=ProjectStageStatus(status),
        stage_version=stage_version,
        artifact_key=artifact_key,
        config_hash=config_hash,
        input_hash=input_hash,
        last_run_at=last_run_at,
        duration_ms=duration_ms,
        error_message=error_message,
        job_id=job_id,
    )


class ProjectStageStore:
    """SQLite-backed store for project-scoped stage state rows.

    One store instance per project (or shared per data_root with project_id
    scoping). Thread-safe via WAL mode.
    """

    def __init__(self, db_path: Path) -> None:
        self._db_path = db_path
        self._ensure_schema()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self._db_path), timeout=10.0)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    def _ensure_schema(self) -> None:
        with self._connect() as conn:
            conn.executescript(_SCHEMA)

    def write(self, state: ProjectStageState) -> None:
        """Upsert a ProjectStageState row.

        This is the "row" half of the dual-write contract. The caller is
        responsible for writing the artifact first and the event after.
        """
        with self._connect() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO project_stages
                    (project_id, stage_id, status, stage_version, artifact_key,
                     config_hash, input_hash, last_run_at, duration_ms, error_message, job_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    state.project_id,
                    state.stage_id,
                    state.status.value,
                    state.stage_version,
                    state.artifact_key,
                    state.config_hash,
                    state.input_hash,
                    state.last_run_at,
                    state.duration_ms,
                    state.error_message,
                    state.job_id,
                ),
            )

    def read(self, project_id: str, stage_id: str) -> ProjectStageState | None:
        """Return the stage row, or None if not yet initialised."""
        with self._connect() as conn:
            cur = conn.execute(
                """
                SELECT project_id, stage_id, status, stage_version, artifact_key,
                       config_hash, input_hash, last_run_at, duration_ms, error_message, job_id
                FROM project_stages
                WHERE project_id = ? AND stage_id = ?
                """,
                (project_id, stage_id),
            )
            row = cur.fetchone()
        if row is None:
            return None
        return _row_to_state(row)

    def list_for_project(self, project_id: str) -> list[ProjectStageState]:
        """Return all stage rows for a project, ordered by stage_id."""
        with self._connect() as conn:
            cur = conn.execute(
                """
                SELECT project_id, stage_id, status, stage_version, artifact_key,
                       config_hash, input_hash, last_run_at, duration_ms, error_message, job_id
                FROM project_stages
                WHERE project_id = ?
                ORDER BY stage_id
                """,
                (project_id,),
            )
            rows = cur.fetchall()
        return [_row_to_state(r) for r in rows]

    def mark_dirty(self, project_id: str, stage_id: str) -> None:
        """Mark a single project stage row as 'dirty' (stale)."""
        with self._connect() as conn:
            conn.execute(
                "UPDATE project_stages SET status = 'dirty' WHERE project_id = ? AND stage_id = ?",
                (project_id, stage_id),
            )


def init_project_stages(project_id: str) -> list[ProjectStageState]:
    """Return the initial list of 8 ProjectStageState rows (all not-run).

    These are NOT written to the DB — the caller writes them via
    ProjectStageStore.write() as part of project creation.
    """
    return [
        ProjectStageState(
            project_id=project_id,
            stage_id=sid,
            status=ProjectStageStatus.not_run,
        )
        for sid in V2_PROJECT_STAGE_IDS
    ]


def infer_project_stage_from_artifact(
    project_id: str,
    stage_id: str,
    data_root: Path,
) -> ProjectStageState | None:
    """Infer stage status from on-disk artifact presence.

    Used by reindex to recover from crash between artifact write and row write.
    Returns a ProjectStageState with status='clean' if the artifact exists,
    or status='not-run' if it doesn't exist. Returns None for unknown stage_id.
    """
    if stage_id not in V2_PROJECT_STAGE_IDS:
        return None

    artifact_file = _ARTIFACT_FILES.get(stage_id, "output.json")
    artifact_path = data_root / "projects" / project_id / "stages" / stage_id / artifact_file

    status = ProjectStageStatus.clean if artifact_path.exists() else ProjectStageStatus.not_run
    artifact_key: str | None = None
    if artifact_path.exists():
        artifact_key = str(artifact_path.relative_to(data_root))

    return ProjectStageState(
        project_id=project_id,
        stage_id=stage_id,
        status=status,
        artifact_key=artifact_key,
    )


def mark_dirty_descendants(
    project_id: str,
    caused_by_stage_id: str,
    store: ProjectStageStore,
) -> list[str]:
    """Mark all project-scoped downstream stages as 'dirty'.

    Uses compute_v2_dirty_descendants to find all stages downstream of
    caused_by_stage_id (traverses cross-scope edges). Only project-scoped
    stage IDs (V2_PROJECT_STAGE_IDS) are updated in the store.

    This is the gate chain cascade: any upstream re-run (page-scoped OR
    project-scoped) calls this to mark downstream project stages stale.

    Returns the list of stage IDs that were updated.
    """
    try:
        descendants = compute_v2_dirty_descendants(caused_by_stage_id)
    except KeyError:
        # caused_by_stage_id not in v2 DAG (e.g. legacy stage ID) — no-op
        return []

    updated: list[str] = []
    for stage_id in V2_PROJECT_STAGE_IDS:
        if stage_id not in descendants:
            continue
        with store._connect() as conn:
            conn.execute(
                "UPDATE project_stages SET status = 'dirty' WHERE project_id = ? AND stage_id = ?",
                (project_id, stage_id),
            )
        updated.append(stage_id)

    return updated


def check_stage_gate(
    project_id: str,
    stage_id: str,
    store: ProjectStageStore,
) -> tuple[bool, str | None]:
    """Check whether all direct project-scoped deps of stage_id are clean.

    Returns (ok, reason):
      ok=True  — all direct project-scoped deps are clean; stage may run.
      ok=False — at least one dep is not clean; reason describes the blocker.

    Only checks project-scoped deps (V2_PROJECT_STAGE_IDS). Page-scoped deps
    are checked separately by the page-stage runner.
    """
    from pdomain_prep_for_pgdp.core.pipeline.stage_dag import get_v2_stage

    try:
        stage = get_v2_stage(stage_id)
    except KeyError:
        return False, f"Unknown stage {stage_id!r}"

    project_scoped_deps = [d for d in stage.depends_on if d in V2_PROJECT_STAGE_IDS]

    for dep_id in project_scoped_deps:
        dep_row = store.read(project_id, dep_id)
        if dep_row is None or dep_row.status != ProjectStageStatus.clean:
            status_str = dep_row.status.value if dep_row else "not-run"
            return False, f"Dep {dep_id!r} is {status_str!r} (must be clean)"

    return True, None


def reindex_project_stages(
    project_id: str,
    data_root: Path,
    store: ProjectStageStore,
) -> dict[str, str]:
    """Rebuild all project stage rows from on-disk artifacts.

    Scans each of the 8 project-scoped stage artifact locations. For each:
    - If artifact present: upsert row with status='clean'.
    - If artifact absent: upsert row with status='not-run' (unless row is
      already 'dirty' or 'failed', in which case preserve existing status).

    Returns a summary dict {stage_id: status_set}.
    """
    summary: dict[str, str] = {}
    for sid in V2_PROJECT_STAGE_IDS:
        inferred = infer_project_stage_from_artifact(project_id, sid, data_root)
        if inferred is None:
            continue
        # Preserve existing dirty/failed state if row already exists
        existing = store.read(project_id, sid)
        if existing is not None and existing.status in (
            ProjectStageStatus.dirty,
            ProjectStageStatus.failed,
        ):
            summary[sid] = existing.status.value
            continue
        store.write(inferred)
        summary[sid] = inferred.status.value
    return summary
