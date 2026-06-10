"""Registry version guard — stage-registry-v2.md §1.

HTTP 409 shape for version mismatch:
    {"error": "registry_version_mismatch", "project_version": N, "server_version": 2}

The guard is called from route handlers (B5) for any API access to a project.
This module is import-cycle-free: it imports only REGISTRY_VERSION from stage_dag
and Project (via TYPE_CHECKING to avoid cycles).
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from pdomain_prep_for_pgdp.core.pipeline.stage_dag import REGISTRY_VERSION

if TYPE_CHECKING:
    from pdomain_prep_for_pgdp.core.models import Project


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


# Compat alias — B5 removes this once route handlers migrate.
RegistryVersionMismatch = RegistryVersionMismatchError


def check_registry_version(project: Project) -> None:
    """Raise RegistryVersionMismatchError if the project is on an old registry version.

    Call from any route handler that runs a v2-stage operation on a project.
    """
    pv = getattr(project, "registry_version", 1)  # default 1 for legacy rows
    if pv != REGISTRY_VERSION:
        raise RegistryVersionMismatchError(project_version=pv)
