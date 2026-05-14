"""Step 10 — assemble the PGDP submission zip.

A PGDP package is a zip containing:
  - `<prefix>.png` — proofing image per page (or per split: `<prefix><suffix>.png`)
  - `<prefix>.txt` — OCR text per page (or per split)
  - `images/` — extracted illustrations / decorations / plates
  - `pgdp.json` — manifest (book name + page list) for the submission UI

Driven by `IStorage` so the same code path works for filesystem and S3.
"""

from __future__ import annotations

import io
import json
import logging
import zipfile
from dataclasses import dataclass
from datetime import UTC, datetime

import oxipng

from ..adapters.storage import IStorage
from .models import PageRecord, Project

log = logging.getLogger(__name__)

_OXIPNG_LEVEL = 4


def _optimize_png(data: bytes) -> bytes:
    """Return losslessly optimised PNG bytes (oxipng level 4).

    Falls back to the original bytes on any error — a failed optimisation
    must never drop a page from the package.
    """
    try:
        return oxipng.optimize_from_memory(data, level=_OXIPNG_LEVEL)
    except Exception:
        log.warning("oxipng optimisation failed; using original bytes", exc_info=True)
        return data


@dataclass
class PackagingResult:
    package_key: str
    page_count: int
    illustration_count: int
    bytes_written: int


async def build_package(
    *,
    project: Project,
    pages: list[PageRecord],
    storage: IStorage,
    optimize_png: bool | None = None,
) -> PackagingResult:
    """Build the PGDP zip and write it to `for_zip/<project_id>.zip`.

    ``optimize_png`` controls lossless oxipng optimisation of proofing images.
    When ``None`` (default) the value is read from ``project.config.optimize_png``.
    Pass ``False`` explicitly to skip optimisation regardless of project config.
    """
    run_optimize = optimize_png if optimize_png is not None else project.config.optimize_png
    buf = io.BytesIO()
    page_count = 0
    illustration_count = 0
    cover_prefix: str | None = None
    title_prefix: str | None = None

    cover_idx0 = project.config.cover_idx0
    title_idx0 = project.config.title_idx0

    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for page in sorted(pages, key=lambda p: p.idx0):
            if page.ignore:
                continue
            for output in sorted(page.outputs, key=lambda o: o.reading_order):
                img_bytes: bytes | None = None
                if output.for_zip_image_key and await storage.exists(output.for_zip_image_key):
                    img_bytes = await storage.get_bytes(output.for_zip_image_key)
                    if run_optimize:
                        img_bytes = _optimize_png(img_bytes)
                    zf.writestr(f"{output.full_prefix}.png", img_bytes)
                    page_count += 1

                # Cover page: first reading-order output of the cover page is
                # aliased as `cover.png` so PGDP picks it up automatically.
                if (
                    cover_idx0 is not None
                    and page.idx0 == cover_idx0
                    and output.reading_order == 0
                    and img_bytes is not None
                    and cover_prefix is None
                ):
                    zf.writestr("cover.png", img_bytes)
                    cover_prefix = page.prefix or page.source_stem

                if output.for_zip_text_key and await storage.exists(output.for_zip_text_key):
                    txt_bytes = await storage.get_bytes(output.for_zip_text_key)
                    zf.writestr(f"{output.full_prefix}.txt", txt_bytes)

            if title_idx0 is not None and page.idx0 == title_idx0:
                title_prefix = page.prefix or page.source_stem

            for region in page.illustration_regions:
                key_stem = f"{page.prefix}_{region.index:02d}"
                ext = region.output_format
                key = f"projects/{project.id}/hi_res/{key_stem}.{ext}"
                if await storage.exists(key):
                    data = await storage.get_bytes(key)
                    zf.writestr(f"images/{key_stem}.{ext}", data)
                    illustration_count += 1

        manifest: dict[str, object] = {
            "book_name": project.config.book_name,
            "project_id": project.id,
            "built_at": datetime.now(UTC).isoformat(),
            "page_count": page_count,
            "illustration_count": illustration_count,
            "pages": [
                {
                    "prefix": page.prefix,
                    "idx0": page.idx0,
                    "page_type": page.page_type.value,
                    "splits": [s.suffix for s in page.splits],
                }
                for page in sorted(pages, key=lambda p: p.idx0)
                if not page.ignore
            ],
        }
        if cover_prefix is not None:
            manifest["cover_prefix"] = cover_prefix
        if title_prefix is not None:
            manifest["title_prefix"] = title_prefix
        zf.writestr("pgdp.json", json.dumps(manifest, indent=2))

    package_bytes = buf.getvalue()
    package_key = f"projects/{project.id}/for_zip/{project.config.book_name}.zip"
    await storage.put_bytes(package_key, package_bytes, "application/zip")

    return PackagingResult(
        package_key=package_key,
        page_count=page_count,
        illustration_count=illustration_count,
        bytes_written=len(package_bytes),
    )
