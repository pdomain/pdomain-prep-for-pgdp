"""Per-stage kwargs adapter for project-scoped job execution (W0.2 / B2).

The job runner used to pass one generic bag (project_id, page_ids, data_root,
book_name, cfg) to every project stage. Python callables without ``**kwargs``
raise TypeError on extras, and zip / submit_check need parent artifacts that
were never loaded.

This module builds only the kwargs each stage accepts, and injects:

- ``zip_bytes`` from ``stages/build_package/output.zip``
- ``zip_sha256`` / ``zip_size_bytes`` / ``page_count`` from the zip stage manifest
"""

from __future__ import annotations

import inspect
import json
from typing import TYPE_CHECKING, Any

from pdomain_prep_for_pgdp.core.pipeline.project_stages import _ARTIFACT_FILES

if TYPE_CHECKING:
    from collections.abc import Callable
    from pathlib import Path


class ProjectStageArtifactError(RuntimeError):
    """Raised when a parent project-stage artifact required by the adapter is missing."""


def project_stage_artifact_path(data_root: Path, project_id: str, stage_id: str) -> Path:
    """Canonical on-disk path for a project stage's dual-written artifact."""
    filename = _ARTIFACT_FILES.get(stage_id, "output.json")
    return data_root / "projects" / project_id / "stages" / stage_id / filename


def _filter_to_signature(impl_callable: Callable[..., Any], kwargs: dict[str, object]) -> dict[str, object]:
    """Drop kwargs the callable does not accept (unless it has ``**kwargs``)."""
    sig = inspect.signature(impl_callable)
    if any(p.kind == inspect.Parameter.VAR_KEYWORD for p in sig.parameters.values()):
        return dict(kwargs)
    allowed = set(sig.parameters)
    return {k: v for k, v in kwargs.items() if k in allowed}


def build_project_stage_call_kwargs(
    *,
    stage_id: str,
    impl_callable: Callable[..., Any],
    project_id: str,
    page_ids: list[str],
    data_root: Path,
    book_name: str = "",
    started_at_iso: str | None = None,
    cfg: object = None,
) -> dict[str, object]:
    """Build kwargs for a project-stage CPU callable.

    Loads parent artifacts for zip and submit_check. Filters to the
    callable's signature so unexpected keywords never reach the impl.
    """
    base: dict[str, object] = {
        "project_id": project_id,
        "page_ids": page_ids,
        "data_root": data_root,
        "book_name": book_name,
        "cfg": cfg,
    }
    if started_at_iso is not None:
        # build_package uses built_at; zip uses recorded_at — both get the run timestamp.
        base["built_at"] = started_at_iso
        base["recorded_at"] = started_at_iso

    if stage_id == "zip":
        bp_path = project_stage_artifact_path(data_root, project_id, "build_package")
        if not bp_path.is_file():
            raise ProjectStageArtifactError(
                f"build_package artifact missing at {bp_path} (required for zip stage)"
            )
        base["zip_bytes"] = bp_path.read_bytes()

    if stage_id == "submit_check":
        zip_path = project_stage_artifact_path(data_root, project_id, "zip")
        if not zip_path.is_file():
            raise ProjectStageArtifactError(
                f"zip artifact missing at {zip_path} (required for submit_check stage)"
            )
        try:
            manifest = json.loads(zip_path.read_bytes().decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ProjectStageArtifactError(
                f"zip artifact at {zip_path} is not valid JSON manifest: {exc}"
            ) from exc
        if not isinstance(manifest, dict):
            raise ProjectStageArtifactError(f"zip artifact at {zip_path} is not a JSON object")
        sha = manifest.get("sha256")
        size = manifest.get("size_bytes")
        if not isinstance(sha, str) or not sha:
            raise ProjectStageArtifactError(f"zip manifest missing sha256 at {zip_path}")
        if not isinstance(size, int):
            raise ProjectStageArtifactError(f"zip manifest missing size_bytes at {zip_path}")
        base["zip_sha256"] = sha
        base["zip_size_bytes"] = size
        # Prefer page list length over zip member count (png+txt+pgdp.json inflate file_count).
        base["page_count"] = len(page_ids)

    if stage_id == "source":
        # source expects source_bytes, not the project kwargs bag. Re-run of
        # project-scoped source via this job path is not supported yet.
        raise ProjectStageArtifactError(
            "project-stage job path cannot run 'source' without source_bytes; use the ingest path instead"
        )

    return _filter_to_signature(impl_callable, base)
