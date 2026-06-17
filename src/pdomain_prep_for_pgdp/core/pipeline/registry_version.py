"""Registry version guard — stage-registry-v2.md §1.

HTTP 409 shape for version mismatch:
    {"error": "registry_version_mismatch", "project_version": N, "server_version": 2}

The guard is called from route handlers (B5) for any API access to a project.
This module is import-cycle-free: it imports only REGISTRY_VERSION from stage_dag
and Project (via TYPE_CHECKING to avoid cycles).
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from pdomain_prep_for_pgdp.core.pipeline.stage_dag import REGISTRY_VERSION

if TYPE_CHECKING:
    from pathlib import Path

    from pdomain_prep_for_pgdp.adapters.database.base import IDatabase
    from pdomain_prep_for_pgdp.core.models import Project

log = logging.getLogger(__name__)


class RegistryVersionMismatchError(Exception):
    """Raised when a project's registry_version != REGISTRY_VERSION.

    Callers (route handlers) catch this and return HTTP 409 with the body
    produced by ``as_dict()``.
    """

    def __init__(self, project_version: int) -> None:
        self.project_version = project_version
        super().__init__(f"registry_version_mismatch: project={project_version}, server={REGISTRY_VERSION}")

    def as_dict(self) -> dict[str, object]:
        """Return the structured 409 body (stage-registry-v2.md §1)."""
        return {
            "error": "registry_version_mismatch",
            "project_version": self.project_version,
            "server_version": REGISTRY_VERSION,
        }


def check_registry_version(project: Project) -> None:
    """Raise RegistryVersionMismatchError if the project is on an old registry version.

    Call from any route handler that runs a v2-stage operation on a project.

    Note: callers should ``await migrate_if_needed(...)`` BEFORE this so that a
    v2 (range-config) project is auto-migrated to v3 (runs) rather than blocked.
    Only pre-v2 (v1) projects still raise.
    """
    pv = getattr(project, "registry_version", 1)  # default 1 for legacy rows
    if pv != REGISTRY_VERSION:
        raise RegistryVersionMismatchError(project_version=pv)


async def migrate_if_needed(
    project: Project,
    db: IDatabase,
    data_root: Path,
) -> Project:
    """Auto-migrate a v2 (range-config) project to v3 (runs) in place.

    The v2->v3 ranges->runs migration is the only auto-migration: it reads the
    legacy ranges from the RAW stored config (via ``db.get_project_raw_config``,
    because ``ProjectConfig`` no longer carries them), seeds + persists the
    NumberingRuns, stamps per-page leaf classification, then bumps
    ``registry_version`` to 3 and persists the project row.

    Idempotent and safe to call before every guarded route.  Projects already
    at the current version (or pre-v2) are returned unchanged; pre-v2 (v1)
    projects continue to raise via :func:`check_registry_version` downstream.

    Returns the (possibly re-loaded) project.
    """
    pv = getattr(project, "registry_version", 1)
    if pv != 2:  # only v2 auto-migrates; v1 stays a 409, v3 is current
        return project

    from pdomain_prep_for_pgdp.core.numbering_migration import migrate_project_to_v3

    raw_config = await db.get_project_raw_config(project.id)
    if raw_config is None:
        # No stored config to read ranges from — nothing to seed; still bump
        # so the project is not perpetually blocked.
        raw_config = {}

    try:
        migrate_project_to_v3(data_root, project.id, raw_config)
    except Exception:  # pragma: no cover - migration must not wedge access
        log.exception("v2->v3 numbering migration failed for project %s", project.id)
        return project

    migrated = project.model_copy(update={"registry_version": REGISTRY_VERSION})
    await db.put_project(migrated)
    log.info("migrated project %s from registry v2 to v%d", project.id, REGISTRY_VERSION)
    return migrated
