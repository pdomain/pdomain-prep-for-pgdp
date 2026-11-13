"""archive stage — terminal cold-storage manifest.

PLACEMENT: App-local PGDP-specific (docs/specs/library-placement.md §4.2).
           Long-running: LongJobRunner seam noted for B5 route wiring.

Stage scope: project (stage-registry-v2.md §2, row #24)
  - Gate: submit_check must be clean + GateConfirmation(submit_confirm) appended
  - Inputs: artifact inventory (scans all project stage artifacts)
  - Outputs: archive_manifest JSON (terminal)
  - Effect: marks the project pipeline complete

The archive manifest records:
  project_id: str
  archived_at: str (ISO UTC)
  pipeline_complete: bool  — always True (marks terminal state)
  artifacts: list[dict]    — inventory of all project-stage artifact files
    each: {stage_id, artifact_path, size_bytes, sha256}

This is the terminal stage — archive is_terminal=True in V2_STAGE_DAG.
After archive runs, no further stage mutations are expected.

LongJobRunner seam: scanning and hashing all artifacts can be long for
large books. B5 route layer wraps this in a LongJobRunner.submit() call.

This module provides:
  1. build_archive_manifest(project_id, data_root) -> bytes
     Pure function: scans artifacts, returns manifest JSON bytes.
  2. archive_v2_cpu(...) -> bytes
     Stage callable registered in V2_STAGE_IMPL.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from collections.abc import Mapping
    from pathlib import Path

from pdomain_prep_for_pgdp.core.models import V2_PROJECT_STAGE_IDS

_TOGGLE_STORE_NAME = "item_toggles.json"


@dataclass(frozen=True, slots=True)
class ArchiveKeepItem:
    """One stage file the archive tool can keep or drop."""

    name: str
    meta: str
    keep: bool


def _files_under(root: Path) -> list[Path]:
    if not root.is_dir():
        return []
    found: list[Path] = []
    for path in root.rglob("*"):
        if path.is_symlink() or not path.is_file():
            continue
        if path.name.startswith(".") or path.name == _TOGGLE_STORE_NAME:
            continue
        found.append(path)
    return found


def _stage_artifact_files(project_dir: Path) -> list[Path]:
    files: list[Path] = []
    pages = project_dir / "pages"
    if pages.is_dir():
        for page_dir in pages.iterdir():
            if page_dir.is_dir():
                files.extend(_files_under(page_dir / "stages"))
    files.extend(_files_under(project_dir / "stages"))
    return files


def build_archive_keep_list(
    project_dir: Path,
    toggles: Mapping[str, bool] | None = None,
) -> list[ArchiveKeepItem]:
    """List one project's stage files as archive keep/drop rows.

    ``name`` is the path relative to ``project_dir``. A missing project
    directory, or a project with no stage files, returns an empty list.
    ``toggles`` overrides the default keep flag for matching names. The
    toggle store itself is not a stage artifact.
    """
    if not project_dir.is_dir():
        return []
    chosen = {} if toggles is None else toggles
    rows: list[ArchiveKeepItem] = []
    for path in _stage_artifact_files(project_dir):
        try:
            size = path.stat().st_size
        except OSError:
            continue
        name = path.relative_to(project_dir).as_posix()
        rows.append(
            ArchiveKeepItem(
                name=name,
                meta=f"{size} B",
                keep=chosen.get(name, True),
            )
        )
    rows.sort(key=lambda item: item.name)
    return rows


# ────────────────────────────────────────────────────────────────────────────
# Artifact inventory (pure function, scans filesystem)
# ────────────────────────────────────────────────────────────────────────────


def _inventory_project_artifacts(
    project_id: str,
    data_root: Path,
) -> list[dict[str, Any]]:
    """Scan all project-stage artifact directories and return an inventory.

    For each V2_PROJECT_STAGE_IDS stage, checks the stage artifact directory
    under data_root/projects/<project_id>/stages/<stage_id>/ and lists any
    artifact files found (with size + sha256).

    Returns a list of artifact dicts:
      {stage_id, artifact_path, size_bytes, sha256}

    Files that don't exist are silently omitted.
    """
    inventory: list[dict[str, Any]] = []
    stage_dir_base = data_root / "projects" / project_id / "stages"

    if not stage_dir_base.exists():
        return inventory

    for stage_id in V2_PROJECT_STAGE_IDS:
        stage_dir = stage_dir_base / stage_id
        if not stage_dir.exists():
            continue

        for artifact_file in sorted(stage_dir.iterdir()):
            if not artifact_file.is_file():
                continue
            try:
                data = artifact_file.read_bytes()
                sha256 = hashlib.sha256(data).hexdigest()
                size_bytes = len(data)
            except OSError:
                continue

            inventory.append(
                {
                    "stage_id": stage_id,
                    "artifact_path": str(artifact_file.relative_to(data_root)),
                    "size_bytes": size_bytes,
                    "sha256": sha256,
                }
            )

    return inventory


# ────────────────────────────────────────────────────────────────────────────
# Core archive manifest (pure function)
# ────────────────────────────────────────────────────────────────────────────


def build_archive_manifest(
    project_id: str,
    data_root: Path,
) -> bytes:
    """Build the cold-storage archive manifest.

    Scans all project-stage artifact files and returns a manifest JSON.
    The manifest records pipeline_complete=True (terminal stage).

    Returns UTF-8 JSON bytes.
    """
    artifacts = _inventory_project_artifacts(project_id=project_id, data_root=data_root)

    manifest: dict[str, Any] = {
        "project_id": project_id,
        "archived_at": datetime.now(UTC).isoformat(),
        "pipeline_complete": True,
        "artifact_count": len(artifacts),
        "artifacts": artifacts,
    }

    return json.dumps(manifest, indent=2).encode("utf-8")


# ────────────────────────────────────────────────────────────────────────────
# v2 stage callable — registered in V2_STAGE_IMPL
# ────────────────────────────────────────────────────────────────────────────


def archive_v2_cpu(
    project_id: str,
    data_root: Path,
    cfg: Any = None,
) -> bytes:
    """v2 archive stage callable (terminal).

    Takes project_id + data_root.
    Returns JSON bytes of the archive manifest.

    This is the terminal stage — after archive runs, pipeline_complete=True
    and no further stage mutations are expected.

    LongJobRunner seam: B5 route layer wraps this in an async Job.
    Gate: caller must ensure submit_check stage is clean + GateConfirmation
    appended before dispatching archive.
    """
    _ = cfg
    return build_archive_manifest(project_id=project_id, data_root=data_root)
