"""Factory for per-project PageService (event store + blob store).

Each project gets its own events.db + blobs/ dir under
<data_root>/projects/<project_id>/.pd-pages/.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from uuid import UUID

from pdomain_ops.blob_store import BlobStore
from pdomain_ops.page_aggregate import PagesApplication
from pdomain_ops.page_server import LocalPageStore, PageStore


class ExtPatchStore:
    """Sidecar JSON store for extension field patches not captured by events.

    The eventsourcing backend stores extension data only in the initial
    ``ImageIngested`` event.  Fields that must be updated post-creation
    (e.g. ``thumbnail_blob_hash`` after Step 2 thumbnail generation) are
    written here and merged by ``get_prep_extension``.

    File format: ``{page_id_str: {namespace: {field: value, ...}, ...}, ...}``
    stored at ``<pd_pages>/ext_patches.json``.
    """

    def __init__(self, pd_pages: Path) -> None:
        """Initialise, pointing at <pd_pages>/ext_patches.json."""
        self._path = pd_pages / "ext_patches.json"

    def _load(self) -> dict[str, dict[str, dict[str, Any]]]:
        """Load patches dict from disk, returning empty dict on missing file."""
        if not self._path.exists():
            return {}
        try:
            return json.loads(self._path.read_text())
        except (json.JSONDecodeError, OSError):
            return {}

    def _save(self, data: dict[str, dict[str, dict[str, Any]]]) -> None:
        """Write patches dict to disk."""
        self._path.write_text(json.dumps(data, indent=2))

    def set_fields(self, page_id: UUID, namespace: str, fields: dict[str, Any]) -> None:
        """Merge ``fields`` into the patch entry for ``page_id`` / ``namespace``."""
        data = self._load()
        pid = str(page_id)
        if pid not in data:
            data[pid] = {}
        if namespace not in data[pid]:
            data[pid][namespace] = {}
        data[pid][namespace].update(fields)
        self._save(data)

    def get_fields(self, page_id: UUID, namespace: str) -> dict[str, Any]:
        """Return patched fields for ``page_id`` / ``namespace``, or empty dict."""
        data = self._load()
        return data.get(str(page_id), {}).get(namespace, {})


@dataclass(frozen=True)
class PageService:
    """Local page service: event store + blob store for one project."""

    store: PageStore
    blobs: BlobStore
    app: PagesApplication
    ext_patches: ExtPatchStore = field(default_factory=lambda: ExtPatchStore(Path(".")))


def get_page_with_ext_patches(service: PageService, page_id: UUID) -> Any:
    """Load a PageAggregate and merge ext_patches into record.extensions.

    Eventsourcing only persists extension data in the initial ``ImageIngested``
    event.  Fields updated after creation (e.g. ``thumbnail_blob_hash``) are
    stored in the ``ExtPatchStore`` sidecar; this function merges them so
    callers get the full current extension state.

    Returns the ``PageAggregate`` with ``record.extensions`` updated in-place.
    """
    page_agg = service.store.get_page(page_id)
    patches = service.ext_patches.get_fields(page_id, "prep")
    if patches:
        existing = page_agg.record.extensions.get("prep", {})
        merged = {**existing, **patches}
        page_agg.record.extensions["prep"] = merged
    return page_agg


def build_page_service(data_root: Path, project_id: str) -> PageService:
    """Create a PageService backed by a per-project SQLite event store.

    Creates <data_root>/projects/<project_id>/.pd-pages/ if absent.
    The caller is responsible for calling app.close() on shutdown if desired.
    """
    pd_pages = Path(data_root) / "projects" / project_id / ".pd-pages"
    pd_pages.mkdir(parents=True, exist_ok=True)
    blobs = BlobStore(project_dir=pd_pages)
    ext_patches = ExtPatchStore(pd_pages)

    db_path = pd_pages / "events.db"
    app = PagesApplication(
        env={
            "PERSISTENCE_MODULE": "eventsourcing.sqlite",
            "SQLITE_DBNAME": str(db_path),
        }
    )
    store: PageStore = LocalPageStore(app)
    return PageService(store=store, blobs=blobs, app=app, ext_patches=ext_patches)
