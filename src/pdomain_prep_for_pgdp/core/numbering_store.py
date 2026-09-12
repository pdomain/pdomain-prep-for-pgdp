"""Project-scoped numbering-runs artifact store (dual-write to events).

Persists/loads a ``NumberingRunsArtifact`` at
``<data_root>/projects/<id>/stages/page_order/runs.json``.

This path shadows (and supersedes) the legacy W4 Group 2 ``runs.json``
written by ``put_page_order_runs`` — the file format is now the richer
``NumberingRunsArtifact`` schema rather than a bare list.
"""

from __future__ import annotations

import json
import logging
import os
from typing import TYPE_CHECKING
from uuid import uuid4

if TYPE_CHECKING:
    from pathlib import Path


from pydantic import ValidationError

from pdomain_prep_for_pgdp.core.models import NumberingRunsArtifact

log = logging.getLogger(__name__)


def _open_staged(path: Path) -> tuple[int, Path]:
    """Create a staging file beside *path*, open for writing.

    Not ``tempfile.mkstemp``: that hardcodes 0600 and ignores the umask, which
    is right for a private scratch file and wrong for one about to be
    published, because a rename preserves the mode. Passing the mode to
    ``os.open`` lets the kernel apply the umask exactly as for a plain
    ``open()``, so there is no chmod to forget and no umask to read. 0666, not
    0777: nothing published this way is a program.

    ``O_EXCL`` keeps ``mkstemp``'s guarantee that creation fails rather than
    opening an existing file or following a symlink into one.
    """
    while True:
        staged = path.parent / f".{path.name}.{uuid4().hex}.tmp"
        try:
            return os.open(staged, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o666), staged
        except FileExistsError:  # pragma: no cover - needs a uuid4 collision
            continue


def _runs_path(data_root: Path, project_id: str) -> Path:
    return data_root / "projects" / project_id / "stages" / "page_order" / "runs.json"


def load_runs(data_root: Path, project_id: str) -> NumberingRunsArtifact:
    """Load the persisted runs artifact; returns an empty artifact if absent."""
    path = _runs_path(data_root, project_id)
    if not path.exists():
        return NumberingRunsArtifact()
    raw = path.read_bytes()
    try:
        return NumberingRunsArtifact.model_validate_json(raw)
    except ValidationError:
        # Legacy: the file may be a bare JSON array (list[dict]) written by the
        # old W4 Group 2 handler.  Treat as empty so a re-PUT rewrites cleanly.
        log.warning("numbering_store: runs.json has unexpected format; treating as empty")
        parsed = json.loads(raw)
        if isinstance(parsed, list):
            return NumberingRunsArtifact(runs=[])
        return NumberingRunsArtifact()


def save_runs(data_root: Path, project_id: str, artifact: NumberingRunsArtifact) -> None:
    """Atomically persist the runs artifact to disk."""
    path = _runs_path(data_root, project_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    # Atomic write: stage a sibling file, then rename it over the target.
    fd, staged = _open_staged(path)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            _ = f.write(artifact.model_dump_json(indent=2))
        staged.replace(path)
    except Exception:
        staged.unlink(missing_ok=True)
        raise
