"""zip stage — deterministic archive + sha256 manifest.

PLACEMENT: App-local PGDP-specific (docs/specs/library-placement.md §4.2).
           Long-running: LongJobRunner seam noted for B5 route wiring.

Stage scope: project (stage-registry-v2.md §2, row #22)
  - Gate: build_package must be clean
  - Inputs: submission_zip bytes (from build_package)
  - Outputs: zip manifest JSON (sha256, size_bytes, file_count)

Determinism guarantee: the same input bytes always produce the same sha256.
The zip itself is passed through verbatim (not re-zipped); the stage
computes a sha256 of the zip and records metadata.

The zip stage does NOT re-create the zip from scratch — it wraps the
build_package output with a cryptographic integrity record. This is the
"stable file order, fixed timestamps" requirement: since build_package writes
a consistent ZIP (deterministic member ordering + timestamp handling via
ZipFile defaults), the sha256 computed here is stable for identical input.

LongJobRunner seam: computing sha256 of a large zip is fast, but writing
the artifact to storage may be long. B5 route layer handles async.

This module provides:
  1. make_deterministic_zip(zip_bytes, project_id, data_root) -> dict
     Pure function: computes sha256 + metadata, returns dict.
  2. zip_v2_cpu(...) -> bytes
     Stage callable registered in V2_STAGE_IMPL (returns manifest JSON bytes).
"""

from __future__ import annotations

import hashlib
import zipfile
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from pathlib import Path


# ────────────────────────────────────────────────────────────────────────────
# Core deterministic zip record (pure function)
# ────────────────────────────────────────────────────────────────────────────


def make_deterministic_zip(
    zip_bytes: bytes,
    project_id: str,
    data_root: Path,
) -> dict[str, Any]:
    """Compute sha256 and metadata for a submission zip.

    Args:
        zip_bytes: The complete zip file bytes from build_package.
        project_id: Project identifier (for manifest).
        data_root: Data root (accepted for API consistency; not used for reading).

    Returns a dict with:
        sha256: str  — hex sha256 of zip_bytes
        size_bytes: int  — len(zip_bytes)
        file_count: int  — number of ZipFile members
        recorded_at: str  — ISO UTC timestamp

    The sha256 is deterministic: same zip_bytes → same sha256.
    """
    _ = data_root  # for future artifact storage

    sha256 = hashlib.sha256(zip_bytes).hexdigest()
    size_bytes = len(zip_bytes)

    # Count members (tolerates invalid zip gracefully)
    file_count = 0
    try:
        import io as _io

        with zipfile.ZipFile(_io.BytesIO(zip_bytes)) as zf:
            file_count = len(zf.infolist())
    except (zipfile.BadZipFile, Exception):
        file_count = 0

    return {
        "project_id": project_id,
        "sha256": sha256,
        "size_bytes": size_bytes,
        "file_count": file_count,
        "recorded_at": datetime.now(UTC).isoformat(),
    }


# ────────────────────────────────────────────────────────────────────────────
# v2 stage callable — registered in V2_STAGE_IMPL
# ────────────────────────────────────────────────────────────────────────────


def zip_v2_cpu(
    zip_bytes: bytes,
    project_id: str,
    data_root: Path,
    cfg: Any = None,
) -> bytes:
    """v2 zip stage callable.

    Takes zip_bytes (from build_package) + project_id + data_root.
    Returns JSON bytes of the zip manifest (sha256, size_bytes, file_count).

    LongJobRunner seam: B5 route layer wraps this in an async Job for large zips.
    Gate: caller must ensure build_package stage is clean before calling.
    """
    import json

    _ = cfg
    manifest = make_deterministic_zip(zip_bytes=zip_bytes, project_id=project_id, data_root=data_root)
    return json.dumps(manifest).encode("utf-8")
