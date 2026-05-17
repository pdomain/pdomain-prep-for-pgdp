"""Illustration extraction — Step 4.5 of the pipeline (spec 05).

Mirrors the `--extract-illustrations` block in pd-ocr-cli/ocr_to_txt.py:503-526:
  - run the layout detector on the SOURCE image,
  - keep regions of type {figure, decoration, table} above a confidence threshold,
  - crop with cv2 at `[T:B, L:R]`,
  - write to `i_<stem>_<NN>.{jpg|png}`.

Plate pages (`page_type == "plate_p"`) automatically get a synthesised full-page
region at extraction time if none is configured.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from .models import (
    IllustrationRegion,
    PageRecord,
    PageType,
    SystemDefaults,
)

if TYPE_CHECKING:
    from pathlib import Path

log = logging.getLogger(__name__)


_REGION_TYPE_MAP: dict[Any, str] = {}


def _map_region_type(rt: Any) -> str:
    """Map RegionType -> spec-05 type string. Raises KeyError on unrecognised type."""
    global _REGION_TYPE_MAP
    if not _REGION_TYPE_MAP:
        try:
            from pd_book_tools.layout.types import RegionType  # pyright: ignore[reportMissingImports]

            _REGION_TYPE_MAP = {
                RegionType.figure: "illustration",
                RegionType.table: "illustration",
                RegionType.decoration: "decoration",
            }
        except ImportError:
            pass
    return _REGION_TYPE_MAP[rt]


def auto_detect_illustrations(
    image_path: Path,
    *,
    layout_detector: Any,
    confidence_threshold: float,
) -> list[IllustrationRegion]:
    """Run the layout detector and return spec-05 IllustrationRegions.

    Caller is responsible for de-duping against already-confirmed regions on
    the page record. Output `index` values are 1-based, contiguous, and
    correspond to the order regions are returned by the detector.
    """
    if layout_detector is None:
        return []

    try:
        from pd_book_tools.layout.types import (  # pyright: ignore[reportMissingImports]
            LayoutRegion,
            RegionType,
        )
    except ImportError as exc:
        raise RuntimeError("pd_book_tools layout types are not available") from exc

    keep_types = {RegionType.figure, RegionType.decoration, RegionType.table}
    page_layout = layout_detector.detect(image_path)
    out: list[IllustrationRegion] = []
    idx = 0
    for region in page_layout.regions:
        if not isinstance(region, LayoutRegion):
            raise TypeError(f"layout detector returned unexpected region type {type(region).__qualname__!r}")
        if region.type not in keep_types:
            continue
        if region.confidence < confidence_threshold:
            continue
        idx += 1
        out.append(
            IllustrationRegion(
                index=idx,
                label="",
                type=_map_region_type(region.type),  # pyright: ignore[reportArgumentType]
                L=region.L,
                T=region.T,
                R=region.R,
                B=region.B,
            )
        )
    return out


def extract_illustration(
    *,
    source_image_bytes: bytes,
    region: IllustrationRegion,
) -> bytes:
    """Extract a single illustration region from the source image bytes.

    Coordinates are in SOURCE image space (per spec 05). Returns encoded
    image bytes in the region's `output_format`.
    """
    import io

    import numpy as np  # pyright: ignore[reportMissingImports]

    try:
        import cv2  # pyright: ignore[reportMissingImports]
    except ImportError as e:
        raise RuntimeError("cv2 required for illustration extraction") from e

    arr = np.frombuffer(source_image_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("could not decode source image")

    h, w = img.shape[:2]
    L = max(0, int(region.L or 0))
    T = max(0, int(region.T or 0))
    R = min(w, int(region.R or w))
    B = min(h, int(region.B or h))
    if R <= L or B <= T:
        raise ValueError(f"empty region after clamping: L={L} R={R} T={T} B={B}")

    crop = img[T:B, L:R]
    if region.convert_to_grayscale:
        crop = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)

    if region.output_format == "png":
        ok, buf = cv2.imencode(".png", crop)
    else:
        ok, buf = cv2.imencode(".jpg", crop, [int(cv2.IMWRITE_JPEG_QUALITY), int(region.jpeg_quality)])
    if not ok:
        raise RuntimeError(f"cv2.imencode failed for {region.output_format}")
    return bytes(io.BytesIO(buf.tobytes()).getvalue())


def synthesise_plate_region(page: PageRecord, source_dimensions: tuple[int, int]) -> IllustrationRegion:
    """Plate pages with no configured region get a full-page region."""
    h, w = source_dimensions
    return IllustrationRegion(
        index=1,
        label="auto-plate",
        type="plate" if page.page_type == PageType.plate_p else "illustration",
        L=0,
        T=0,
        R=w,
        B=h,
        output_format="jpg",
        jpeg_quality=92,
    )


def regions_for_page(
    page: PageRecord,
    *,
    system: SystemDefaults,
    source_dimensions: tuple[int, int] | None = None,
) -> list[IllustrationRegion]:
    """Return the regions that Step 4.5 should extract for `page`.

    - User-configured regions on the PageRecord always win.
    - Plate pages with no configured region fall back to a synthesised full-page region.
    """
    if page.illustration_regions:
        return list(page.illustration_regions)
    if page.page_type == PageType.plate_p and source_dimensions is not None:
        return [synthesise_plate_region(page, source_dimensions)]
    return []
