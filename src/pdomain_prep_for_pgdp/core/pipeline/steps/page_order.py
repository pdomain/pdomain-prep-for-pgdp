"""page_order stage — materializes project reading order.

PLACEMENT: App-local PGDP-specific (docs/specs/library-placement.md §3).

Stage scope: project (stage-registry-v2.md §2, row #12)
  - Inputs: page-id list (from source + text_zones all-pages-settled)
  - Outputs: ordered page-id manifest (text/plain, newline-separated)
  - Events: PageReorder (eventsourcing, full before/after arrays)

Reading order is determined by:
  1. User-specified reorder (drag-drop in UI), captured as PageReorder events.
  2. Default: source ingest order (idx0 lexicographic order).

The stage artifact is a newline-separated list of page IDs in reading order.
Re-running after a page-set change (add/remove pages) recomputes from the
current page set, applying any previously-recorded PageReorder events.

PageReorder events follow the spec §5.2 vocabulary:
  - event_type: "PageReorder"
  - new_order: list[str]  — full ordered page-id sequence after the reorder
  - previous_order: list[str]  — full ordered page-id sequence before
  - actor_id: str

This module provides:
  1. materialize_page_order(project_id, page_ids, data_root) -> bytes
     Pure function: takes page_ids, returns manifest bytes.
  2. make_page_reorder_event(...) -> dict
     Pure event constructor (no side effects).
  3. page_order_v2_cpu(...) -> bytes
     Stage callable registered in V2_STAGE_IMPL.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from pathlib import Path


# ────────────────────────────────────────────────────────────────────────────
# Core materialization (pure function)
# ────────────────────────────────────────────────────────────────────────────


def materialize_page_order(
    project_id: str,
    page_ids: list[str],
    data_root: Path,
) -> bytes:
    """Materialize the page reading order manifest.

    Takes the list of page IDs in their current order (caller is responsible
    for sorting by reading_order / applying any PageReorder events before
    calling this). Writes a newline-separated list of page IDs.

    Returns UTF-8 bytes: one page_id per line, trailing newline.

    Re-running after a page-set change recomputes from the provided page_ids.
    The data_root is accepted for API compatibility (future: could write a
    cached artifact to disk); currently not used for reading.
    """
    _ = data_root  # available for future disk-caching
    _ = project_id  # available for future project-scoped logic
    content = "\n".join(page_ids) + ("\n" if page_ids else "")
    return content.encode("utf-8")


# ────────────────────────────────────────────────────────────────────────────
# Event constructor (pure, no side effects)
# ────────────────────────────────────────────────────────────────────────────


def make_page_reorder_event(
    *,
    new_order: list[str],
    previous_order: list[str],
    actor_id: str,
) -> dict[str, Any]:
    """Construct a PageReorder event dict.

    Matches the PageReorder event payload from docs/specs/stage-registry-v2.md §5.2:
      - new_order: full ordered page-id sequence after the reorder
      - previous_order: full ordered page-id sequence before

    The caller passes this to PrepProjectAggregate.record_page_reorder for
    eventsourcing persistence.
    """
    return {
        "event_type": "PageReorder",
        "new_order": list(new_order),
        "previous_order": list(previous_order),
        "actor_id": actor_id,
    }


# ────────────────────────────────────────────────────────────────────────────
# v2 stage callable — registered in V2_STAGE_IMPL
# ────────────────────────────────────────────────────────────────────────────


def page_order_v2_cpu(
    page_ids: list[str],
    project_id: str,
    data_root: Path,
    cfg: Any = None,
) -> bytes:
    """v2 page_order stage callable.

    Takes the ordered page_ids list (sorted by reading_order from the DB,
    with any PageReorder events already applied by the caller).

    Returns UTF-8 bytes: one page_id per line (the page-order artifact).

    The stage is project-scoped; the runner calls this with all page IDs in
    the project's current reading order.
    """
    _ = cfg
    return materialize_page_order(
        project_id=project_id,
        page_ids=page_ids,
        data_root=data_root,
    )
