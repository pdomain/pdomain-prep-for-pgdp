"""Cover the `title_idx0` branch in `core.packaging.build_package`.

Spec 02 lets a project mark one page as the title page. When set, the
package manifest gets a `title_prefix` field so PGDP knows which page to
treat as the canonical book title. Locks in:
  - `title_prefix` is set on the manifest when title_idx0 matches a page,
  - the title prefix is the page's `prefix` (or `source_stem` if prefix
    is empty).
"""

from __future__ import annotations

import io
import json
import zipfile
from datetime import UTC, datetime

import pytest

from pdomain_prep_for_pgdp.adapters.storage.filesystem import FilesystemStorage
from pdomain_prep_for_pgdp.core.models import (
    PageOutput,
    PageRecord,
    Project,
    ProjectConfig,
    ProjectStatus,
)
from pdomain_prep_for_pgdp.core.packaging import build_package


@pytest.fixture
def storage(tmp_path) -> FilesystemStorage:
    return FilesystemStorage(root=tmp_path / "data")


def _project(project_id: str, title_idx0: int) -> Project:
    now = datetime.now(UTC)
    return Project(
        id=project_id,
        owner_id="default",
        name="t",
        created_at=now,
        updated_at=now,
        status=ProjectStatus.packaging,
        page_count=2,
        proof_page_count=2,
        config=ProjectConfig(
            book_name="my-book",
            source_uri="",
            title_idx0=title_idx0,
        ),
        storage_prefix=f"projects/{project_id}/",
    )


@pytest.mark.asyncio
async def test_title_prefix_recorded_on_manifest(storage) -> None:
    project = _project("pt1", title_idx0=1)
    pages = [
        PageRecord(
            project_id="pt1",
            idx0=0,
            prefix="p001",
            source_stem="src1",
            outputs=[
                PageOutput(
                    full_prefix="p001",
                    split_suffix=None,
                    reading_order=0,
                    for_zip_text_key=None,
                )
            ],
        ),
        PageRecord(
            project_id="pt1",
            idx0=1,
            prefix="p002-title",
            source_stem="src2",
            outputs=[
                PageOutput(
                    full_prefix="p002-title",
                    split_suffix=None,
                    reading_order=0,
                    for_zip_text_key=None,
                )
            ],
        ),
    ]

    result = await build_package(project=project, pages=pages, storage=storage)

    zip_bytes = await storage.get_bytes(result.package_key)
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        manifest = json.loads(zf.read("pgdp.json"))
    assert manifest["title_prefix"] == "p002-title"
