"""Write a project's files into a zip for Save a copy."""

from __future__ import annotations

import sqlite3
import tempfile
import zipfile
from pathlib import Path

MANIFEST_NAME = "pgdp-prep-export.json"
_SQLITE_SIDECARS = ("-wal", "-shm")
_DATABASE_SUFFIX = ".db"


def _sqlite_snapshot(source: Path, working_dir: Path) -> Path | None:
    """Copy a live SQLite file consistently; None means the file is not SQLite."""
    snapshot = working_dir / f"{source.name}.snapshot"
    source_db = sqlite3.connect(f"{source.as_uri()}?mode=ro", uri=True)
    target_db = sqlite3.connect(snapshot)
    try:
        source_db.backup(target_db)
    except sqlite3.DatabaseError:
        return None
    finally:
        source_db.close()
        target_db.close()
    return snapshot


def write_project_zip(project_dir: Path, manifest: bytes, destination: Path) -> None:
    """Zip ``project_dir`` under ``project/`` and add ``manifest`` at the root."""
    project_dir = project_dir.resolve()
    # Scans are already compressed, so storing them keeps a large export fast.
    with (
        zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_STORED, strict_timestamps=False) as archive,
        tempfile.TemporaryDirectory(dir=destination.parent) as working,
    ):
        archive.writestr(MANIFEST_NAME, manifest)
        for path in sorted(project_dir.rglob("*")):
            if not path.is_file() or path.name.endswith(_SQLITE_SIDECARS):
                continue
            arcname = f"project/{path.relative_to(project_dir).as_posix()}"
            snapshot = _sqlite_snapshot(path, Path(working)) if path.suffix == _DATABASE_SUFFIX else None
            archive.write(snapshot or path, arcname)
            if snapshot is not None:
                snapshot.unlink()
