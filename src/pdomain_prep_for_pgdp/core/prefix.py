"""Export-filename helper.

After P1.9 the page-prefix computation moved entirely to the runs model
(``core/numbering.compute_prefixes_from_runs``).  The legacy range-based
``compute_prefix`` / ``compute_prefix_v2`` and their helpers were deleted.

This module retains only ``export_name_for_seq`` — the numeric export-name
formatter used by the page_order naming manifest when numeric export is on.

v2 numeric export: ``export_name_for_seq``
  Returns bare zero-padded seq string for use as zip entry basenames.
  This is an export-time rename only; manifests carry both prefix and
  export_name.  PGDP validates the EXPORT names.
"""

from __future__ import annotations


def export_name_for_seq(seq: int, *, total: int) -> str:
    """Return the numeric export basename for a zero-based sequence number.

    For total ≤ 999: 3-digit zero-padded (e.g. "012").
    For total > 999: 4-digit zero-padded (e.g. "0012").

    This is the bare filename used in the submission zip when numeric export
    is enabled (``build_package`` export option).  The PGDP validator validates
    these names (not the descriptive prefixes).

    Note: ``seq`` here is a 0-based sequence position, NOT the idx0.  The
    caller is responsible for mapping idx0 → seq (skipping skip pages).
    """
    width = 4 if total > 999 else 3
    return f"{seq:0{width}d}"
