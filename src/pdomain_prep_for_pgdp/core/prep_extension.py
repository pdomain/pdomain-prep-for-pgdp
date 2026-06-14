"""PrepPageExtension — all prep-domain page state stored in PageRecord.extensions["prep"].

All operational fields that live on prep's old PageRecord migrate here.
Stored via pdomain_ops.pages.set_extension(record, "prep", ext) /
get_extension(record, "prep", PrepPageExtension).
ops never imports this module.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import Field, model_validator

from pdomain_prep_for_pgdp.core.models import (
    AlignmentOverride,
    ApiModel,
    IllustrationRegion,
    PageConfigOverrides,
    PageOutput,
    PageProcessingStatus,
    PageSplit,
    PageType,
)


class PrepPageExtension(ApiModel):
    """All prep-domain page state — serialised into PageRecord.extensions["prep"].

    Split-linkage fields follow the all-or-none contract from the retired
    prep PageRecord: if parent_page_id is set, then source_crop_bbox,
    split_index, split_at_stage, and split_suffix must ALL be set. Root
    pages must have all four as None.
    """

    # ── Core prep identity ──────────────────────────────────────────────
    project_id: str
    idx0: int
    prefix: str
    source_stem: str
    ignore: bool = False
    """Effective exclusion flag: True when derived_ignore OR manual_ignore.

    ``derived_ignore`` is set by ``assign_prefixes`` (out-of-range or
    page_type==skip). ``manual_ignore`` is set by the user via
    PATCH /pages/{idx0} {"ignore": true}.  Callers that need to
    distinguish the source should read ``manual_ignore`` directly.
    """

    manual_ignore: bool = False
    """User-set soft-exclude flag.  Preserved by ``assign_prefixes`` even
    when derived exclusion does not apply (e.g. an in-range normal page
    that the user manually removed).  The effective ``ignore`` value equals
    ``derived_ignore OR manual_ignore``.
    """

    # ── Page classification ─────────────────────────────────────────────
    page_type: PageType = PageType.normal
    alignment: AlignmentOverride = AlignmentOverride.default
    config_overrides: PageConfigOverrides = Field(default_factory=PageConfigOverrides)

    # ── Split definitions (parent-side) ────────────────────────────────
    splits: list[PageSplit] = Field(default_factory=list)
    illustration_regions: list[IllustrationRegion] = Field(default_factory=list)

    # ── Blob hashes (content-addressed, BlobStore keys) ────────────────
    source_blob_hash: str | None = None
    thumbnail_blob_hash: str | None = None
    processed_image_blob_hash: str | None = None
    ocr_image_blob_hash: str | None = None

    # ── Processing state ────────────────────────────────────────────────
    processing_status: PageProcessingStatus = PageProcessingStatus.pending
    processing_job_id: str | None = None
    processing_error: str | None = None
    last_processed_at: datetime | None = None

    # ── OCR output records ──────────────────────────────────────────────
    outputs: list[PageOutput] = Field(default_factory=list)

    # ── Split-child linkage (child-side) ───────────────────────────────
    parent_page_id: str | None = None
    """UUID string of the parent page. None for root pages."""

    source_crop_bbox: tuple[int, int, int, int] | None = None
    """(x, y, w, h) in parent source-image coords. Required for split children."""

    split_index: int | None = None
    """1-based sibling index. None for root pages."""

    split_at_stage: str | None = None
    """Stage ID at which the split was created. None for root pages."""

    split_suffix: str | None = None
    """User-chosen suffix appended to prefix (e.g. 'a', 'b'). None for root pages."""

    reading_order: int = 0
    """Output sort order. Defaults to 0 for root pages."""

    @model_validator(mode="after")
    def _validate_split_fields_all_or_none(self) -> PrepPageExtension:
        """Enforce all-or-none for split-child linkage fields.

        If parent_page_id is set: source_crop_bbox, split_index, split_at_stage,
        and split_suffix must ALL be non-None.
        If parent_page_id is None: none of those four may be set.
        reading_order is exempt — it has a real default for all pages.
        """
        peers: dict[str, Any] = {
            "source_crop_bbox": self.source_crop_bbox,
            "split_index": self.split_index,
            "split_at_stage": self.split_at_stage,
            "split_suffix": self.split_suffix,
        }
        missing = [name for name, value in peers.items() if value is None]
        present = [name for name, value in peers.items() if value is not None]

        if self.parent_page_id is not None:
            if missing:
                raise ValueError(
                    f"split-child PrepPageExtension (parent_page_id={self.parent_page_id!r}) "
                    f"requires all split fields; missing: {missing}"
                )
        elif present:
            raise ValueError(
                f"root PageRecord (parent_page_id=None) must not set split fields; got: {present}"
            )
        return self
