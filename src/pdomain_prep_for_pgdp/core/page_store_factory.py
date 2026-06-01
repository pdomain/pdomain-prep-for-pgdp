"""Factory for per-project PageService (event store + blob store).

Each project gets its own events.db + blobs/ dir under
<data_root>/projects/<project_id>/.pd-pages/.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from pdomain_ops.blob_store import BlobStore
from pdomain_ops.page_aggregate import PagesApplication
from pdomain_ops.page_server import LocalPageStore, PageStore


@dataclass(frozen=True)
class PageService:
    """Local page service: event store + blob store for one project."""

    store: PageStore
    blobs: BlobStore
    app: PagesApplication


def build_page_service(data_root: Path, project_id: str) -> PageService:
    """Create a PageService backed by a per-project SQLite event store.

    Creates <data_root>/projects/<project_id>/.pd-pages/ if absent.
    The caller is responsible for calling app.close() on shutdown if desired.
    """
    pd_pages = Path(data_root) / "projects" / project_id / ".pd-pages"
    pd_pages.mkdir(parents=True, exist_ok=True)
    blobs = BlobStore(project_dir=pd_pages)

    db_path = pd_pages / "events.db"
    app = PagesApplication(
        env={
            "PERSISTENCE_MODULE": "eventsourcing.sqlite",
            "SQLITE_DBNAME": str(db_path),
        }
    )
    store: PageStore = LocalPageStore(app)
    return PageService(store=store, blobs=blobs, app=app)
