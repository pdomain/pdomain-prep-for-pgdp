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
import tempfile
from pathlib import Path

from pydantic import ValidationError

from pdomain_prep_for_pgdp.core.models import NumberingRunsArtifact

log = logging.getLogger(__name__)


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
    # Atomic write: write to a temp file in the same directory then rename.
    with tempfile.NamedTemporaryFile(
        mode="w",
        encoding="utf-8",
        dir=path.parent,
        delete=False,
        suffix=".tmp",
    ) as f:
        f.write(artifact.model_dump_json(indent=2))
        tmp_path = Path(f.name)
    tmp_path.replace(path)
