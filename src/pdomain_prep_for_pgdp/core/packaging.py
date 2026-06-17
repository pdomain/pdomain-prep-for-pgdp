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
import re
import zipfile
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import TYPE_CHECKING

import oxipng

if TYPE_CHECKING:
    from pdomain_prep_for_pgdp.adapters.storage import IStorage

    from .models import PageRecord, Project

log = logging.getLogger(__name__)

_OXIPNG_LEVEL = 4

# Keep only ASCII alphanumeric, hyphen, dot, parens, space.
# [a-zA-Z0-9] rather than \w: Python \w matches all Unicode letters/digits,
# which would allow non-ASCII chars to pass silently — the goal is ASCII-only.
_UNSAFE_CHARS = re.compile(r"[^a-zA-Z0-9\-._() ]")


def _safe_package_slug(book_name: str, fallback: str) -> str:
    """Return a filesystem-safe ASCII slug for use in a storage key.

    Strips path separators, control chars, OS-reserved characters, and
    consecutive dot sequences that could form relative-path components (e.g. ..).
    Falls back to *fallback* (typically project.id) if the result is empty.

    Transformation chain for ``"../../evil"``:
        slash→_  : ``".._.._evil"``
        char filter: unchanged  (dots and _ are both in safe set)
        collapse ..: ``"._._evil"``
        strip('. _'): ``"evil"``
    """
    # Replace path separators with underscore
    name = re.sub(r"[\\/]", "_", book_name)
    # Remove remaining unsafe characters (anything not in the ASCII safe set)
    name = _UNSAFE_CHARS.sub("", name)
    # Collapse consecutive dots (e.g. ".." from "../../" → ".") so that
    # slash-replaced underscores between dot groups cannot re-form ".." after strip.
    name = re.sub(r"\.{2,}", ".", name)
    # Strip leading/trailing dots, spaces, and underscores.
    # Dots: hidden-file prefix on POSIX, Windows reserved.
    # Leading underscores: left over from stripped path separators.
    name = name.strip(". _")
    return name if name else fallback


def _optimize_png(data: bytes, *, skip_counter: list[int] | None = None) -> bytes:
    """Return losslessly optimised PNG bytes (oxipng level 4).

    Falls back to the original bytes on any error — a failed optimisation
    must never drop a page from the package.

    When *skip_counter* is provided (a single-element ``list[int]``), its
    first element is incremented each time the fallback path is taken, allowing
    callers to accumulate a page-level skip count without changing the return type.
    """
    try:
        return oxipng.optimize_from_memory(data, level=_OXIPNG_LEVEL)
    except Exception:
        log.warning("oxipng optimisation failed; using original bytes", exc_info=True)
        if skip_counter is not None:
            skip_counter[0] += 1
        return data


@dataclass
class PackagingResult:
    package_key: str
    page_count: int
    illustration_count: int
    bytes_written: int
    oxipng_skipped_pages: int = 0


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
    _skip_counter: list[int] = [0]
    cover_prefix: str | None = None

    # P1.9: cover is identified by page_type (cover_idx0/title_idx0 ranges
    # deleted).  Title aliasing has no runs-model equivalent and is dropped.
    from .models import PageType as _PageType

    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for page in sorted(pages, key=lambda p: p.idx0):
            if page.ignore:
                continue
            for output in sorted(page.outputs, key=lambda o: o.reading_order):
                img_bytes: bytes | None = None
                if output.for_zip_image_key and await storage.exists(output.for_zip_image_key):
                    img_bytes = await storage.get_bytes(output.for_zip_image_key)
                    if run_optimize:
                        img_bytes = _optimize_png(img_bytes, skip_counter=_skip_counter)
                    zf.writestr(f"{output.full_prefix}.png", img_bytes)
                    page_count += 1

                # Cover page: first reading-order output of the cover page is
                # aliased as `cover.png` so PGDP picks it up automatically.
                if (
                    page.page_type == _PageType.cover
                    and output.reading_order == 0
                    and img_bytes is not None
                    and cover_prefix is None
                ):
                    zf.writestr("cover.png", img_bytes)
                    cover_prefix = page.prefix or page.source_stem

                if output.for_zip_text_key and await storage.exists(output.for_zip_text_key):
                    txt_bytes = await storage.get_bytes(output.for_zip_text_key)
                    zf.writestr(f"{output.full_prefix}.txt", txt_bytes)

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
        zf.writestr("pgdp.json", json.dumps(manifest, indent=2))

    package_bytes = buf.getvalue()
    slug = _safe_package_slug(project.config.book_name, fallback=project.id)
    package_key = f"projects/{project.id}/for_zip/{slug}.zip"
    # Belt-and-suspenders: assert the key stays under this project's prefix.
    # _safe_package_slug guarantees no path separators in the slug, but we
    # verify explicitly so any future regression is caught immediately.
    # Imported inline to avoid a circular import chain through api/data/__init__.py.
    from pdomain_prep_for_pgdp.api.data.storage_keys import assert_project_scoped_key

    assert_project_scoped_key(project.id, package_key)
    await storage.put_bytes(package_key, package_bytes, "application/zip")

    return PackagingResult(
        package_key=package_key,
        page_count=page_count,
        illustration_count=illustration_count,
        bytes_written=len(package_bytes),
        oxipng_skipped_pages=_skip_counter[0],
    )
