"""Configuration resolver.

Merges the three layers (`SystemDefaults` -> `ProjectConfig.default_overrides`
-> `PageRecord.config_overrides`) into a flat `ResolvedPageConfig` consumed by
the pipeline. Implementation follows spec 01.

Resolution rule: page override > project default override > system default.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from .models import (
    PageRecord,
    PageType,
    ProjectConfig,
    ResolvedPageConfig,
    SystemDefaults,
)

if TYPE_CHECKING:
    from collections.abc import Mapping, Sequence


def _pick(field: str, page_value: Any, project_overrides: Mapping[str, Any], fallback: Any) -> Any:
    """Page override wins, then project default override, then system fallback."""
    if page_value is not None:
        return page_value
    if field in project_overrides:
        return project_overrides[field]
    return fallback


def resolve_page_config(
    system: SystemDefaults,
    project: ProjectConfig,
    page: PageRecord,
) -> ResolvedPageConfig:
    """Merge: page override > project default override > system default."""

    o = page.config_overrides
    po = project.default_overrides

    return ResolvedPageConfig(
        text_threshold=_pick("text_threshold", None, po, system.text_threshold),
        page_h_w_ratio=_pick("page_h_w_ratio", None, po, system.page_h_w_ratio),
        fuzzy_pct=_pick("default_fuzzy_pct", o.fuzzy_pct, po, system.default_fuzzy_pct),
        pixel_count_columns=_pick(
            "default_pixel_count_columns",
            o.pixel_count_columns,
            po,
            system.default_pixel_count_columns,
        ),
        pixel_count_rows=_pick(
            "default_pixel_count_rows",
            o.pixel_count_rows,
            po,
            system.default_pixel_count_rows,
        ),
        ocr_bbox_edge_min_words=_pick("ocr_bbox_edge_min_words", None, po, system.ocr_bbox_edge_min_words),
        ocr_engine=_pick("ocr_engine", None, po, system.ocr_engine),
        ocr_model_key=_pick("ocr_model_key", None, po, system.ocr_model_key),
        ocr_dpi=_pick("ocr_dpi", None, po, system.ocr_dpi),
        initial_crop_all=project.initial_crop_all,
        ocr_crop=(
            project.ocr_crop_top,
            project.ocr_crop_bottom,
            project.ocr_crop_left,
            project.ocr_crop_right,
        ),
        page_type=page.page_type,
        alignment=page.alignment,
        initial_crop=o.initial_crop,
        white_space_additional=o.white_space_additional,
        threshold_level=o.threshold_level,
        skip_auto_deskew=bool(o.skip_auto_deskew),
        deskew_before_crop=o.deskew_before_crop,
        deskew_after_crop=o.deskew_after_crop,
        do_morph=bool(o.do_morph),
        skip_denoise=bool(o.skip_denoise),
        use_ocr_bbox_edge=bool(o.use_ocr_bbox_edge),
        rotated_standard=bool(o.rotated_standard),
        single_dimension_rescale=bool(o.single_dimension_rescale),
        flip_horizontal=bool(o.flip_horizontal),
        flip_vertical=bool(o.flip_vertical),
    )


# ─── Derived helpers (operate on a list of pages) ───────────────────────────


def blank_page_idxs(pages: Sequence[PageRecord]) -> list[int]:
    """Pages that should NOT generate proofing image / OCR output."""
    return sorted(
        p.idx0 for p in pages if p.page_type in {PageType.blank, PageType.plate_b, PageType.plate_r}
    )


def split_source_idxs(pages: Sequence[PageRecord]) -> list[int]:
    """Pages that the splitter has marked with at least one PageSplit."""
    return sorted(p.idx0 for p in pages if p.splits)


def ocr_crop_skip_idxs(
    system: SystemDefaults, project: ProjectConfig, pages: Sequence[PageRecord]
) -> list[int]:
    """Pages where the uniform OCR crop should NOT be applied."""
    plate_types = {PageType.plate_b, PageType.plate_p, PageType.plate_r, PageType.blank}
    out: set[int] = set()
    for p in pages:
        cfg = resolve_page_config(system, project, p)
        if (
            p.page_type in plate_types
            or cfg.alignment.value in {"center", "bottom"}
            or cfg.rotated_standard
            or cfg.single_dimension_rescale
            or p.splits
        ):
            out.add(p.idx0)
    return sorted(out)
