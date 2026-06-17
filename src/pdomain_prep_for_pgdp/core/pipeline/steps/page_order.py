"""page_order stage — materializes project reading order + naming manifest.

PLACEMENT: App-local PGDP-specific (docs/specs/library-placement.md §3).

Stage scope: project (stage-registry-v2.md §2, row #12)
  - Inputs: page records (roles, page_type) + ProjectConfig ranges + reading order
  - Outputs: JSON naming manifest (application/json)
  - Events: PageReorder (eventsourcing, full before/after arrays)

Reading order is determined by:
  1. User-specified reorder (drag-drop in UI), captured as PageReorder events.
  2. Default: source ingest order (idx0 lexicographic order).

The stage artifact is a JSON object with schema:

    {
      "version": 2,
      "pages": [
        {"page_id": "0005", "idx0": 5, "role": "normal", "prefix": "000f001", "export_name": null, "label": "1",    "run_id": "run-a"},
        {"page_id": "0006", "idx0": 6, "role": "blank",  "prefix": "001f002", "export_name": null, "label": "",     "run_id": null},
        {"page_id": "0007", "idx0": 7, "role": "skip",   "prefix": null,       "export_name": null, "label": "",     "run_id": null},
        {"page_id": "0008", "idx0": 8, "role": "cover",  "prefix": "003e",     "export_name": null, "label": "i",   "run_id": "run-b"},
        ...
      ],
      "skip_ids": ["0007", ...]
    }

  - ``role``: the PageType string value for the page.
  - ``prefix``: the v2 PGDP filename prefix (from compute_prefixes_from_runs),
    or null for skip / unassigned pages.
    Format: ``<seq:3-4><type><folio?>`` — e.g. "000f001", "003e", "012pp".
  - ``export_name``: bare numeric filename for use in the submission zip when the
    numeric-export option is enabled (e.g. "005"). Null when numeric export is off.
  - ``skip_ids``: page_ids excluded from the submission zip (role == "skip").

The consumer (build_package) loads this manifest to get page_prefixes and the
skip-exclusion set.  If the manifest is absent or stale (page_order status !=
clean), build_package raises MissingNamingManifest.

Backward compatibility: re-running the stage regenerates the manifest; no
migration needed — it's a derived artifact.

This module provides:
  1. NamingManifestEntry — typed dataclass for one manifest row.
  2. NamingManifest — full manifest (version + pages + skip_ids).
  3. materialize_naming_manifest(project_id, ordered_pages, project_config,
                                  data_root) -> bytes
     Pure function: builds manifest bytes from ordered PageRecords + config.
  4. load_naming_manifest(data_root, project_id) -> NamingManifest
     Load and parse the on-disk manifest; raises MissingNamingManifest if absent.
  5. make_page_reorder_event(...) -> dict
     Pure event constructor (no side effects).
  6. page_order_v2_cpu(...) -> bytes
     Stage callable registered in V2_STAGE_IMPL.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from pathlib import Path

    from pdomain_prep_for_pgdp.core.models import (
        LeafRole,
        NumberingRun,
        PageRecord,
        ProjectConfig,
    )
    from pdomain_prep_for_pgdp.core.numbering import Leaf


# ────────────────────────────────────────────────────────────────────────────
# Manifest data structures
# ────────────────────────────────────────────────────────────────────────────

MANIFEST_VERSION = 2
"""Current naming manifest schema version.

Increment when the JSON schema changes in a backward-incompatible way.
Consumers may reject manifests with an older version; the stage runner
always regenerates on re-run.

v2 (P1.9): ``label`` and ``run_id`` per entry are derived from
``compute_labels`` over ``NumberingRun`` objects, and ``prefix`` is derived
from the SAME runs via ``compute_prefixes_from_runs`` (the byte-stable
successor to the now-deleted ``compute_prefix_v2``).  ``export_name`` retains
its numeric-export shape.  ProjectConfig ranges are no longer consulted.
"""


@dataclass
class NamingManifestEntry:
    """One row in the naming manifest."""

    page_id: str
    """Canonical page identifier (e.g. "0005")."""
    idx0: int
    """Zero-based scan index."""
    role: str
    """PageType value (e.g. "normal", "blank", "skip", "cover", "plate_b")."""
    prefix: str | None
    """v2 PGDP filename prefix (e.g. "000f001", "003e"), or None for skip pages."""
    export_name: str | None = None
    """Bare numeric export basename (e.g. "005") when numeric export is enabled.

    Populated by ``materialize_naming_manifest`` when the numeric export option
    is on; None otherwise.  The PGDP validator validates export_name values,
    not the descriptive prefix strings.
    """


@dataclass
class NamingManifest:
    """Deserialized naming manifest artifact."""

    version: int
    pages: list[NamingManifestEntry] = field(default_factory=list)
    skip_ids: list[str] = field(default_factory=list)

    def page_prefixes(self) -> dict[str, str]:
        """Return {page_id: prefix} for all non-skip pages."""
        return {e.page_id: e.prefix for e in self.pages if e.prefix is not None}

    def skip_set(self) -> frozenset[str]:
        """Return the set of page_ids excluded from the package."""
        return frozenset(self.skip_ids)


class MissingNamingManifest(RuntimeError):  # noqa: N818  # intentional: describes missing artifact, not an error state
    """Raised by load_naming_manifest when the artifact is absent or unreadable.

    The caller (build_package) should surface this as a stage-gate failure:
    the page_order stage must be re-run before building the package.
    """


# ────────────────────────────────────────────────────────────────────────────
# Manifest path helper
# ────────────────────────────────────────────────────────────────────────────


def _manifest_path(data_root: Path, project_id: str) -> Path:
    return data_root / "projects" / project_id / "stages" / "page_order" / "output.json"


# ────────────────────────────────────────────────────────────────────────────
# Core materialization (pure function)
# ────────────────────────────────────────────────────────────────────────────


def _page_id_for_idx0(idx0: int) -> str:
    return f"{idx0:04d}"


def _proof_start_for(leaves: list[Leaf], runs: list[NumberingRun]) -> int | None:
    """Return the seq origin: the smallest in-proof scan, or None if none.

    A scan is "in proof" iff it is assigned to a run, or it is a cover / plate
    / blank leaf (these get a filename even without a run, except skips). Skip
    leaves and unassigned text leaves are excluded.  This reproduces the legacy
    ``proof_start_idx0`` origin from the runs model (after range deletion).
    """
    from pdomain_prep_for_pgdp.core.models import LeafRole

    in_proof = [
        leaf.scan
        for leaf in leaves
        if leaf.leaf_role in (LeafRole.cover, LeafRole.plate, LeafRole.blank) or leaf.run_id is not None
    ]
    return min(in_proof) if in_proof else None


def materialize_naming_manifest(
    project_id: str,
    ordered_pages: list[PageRecord],
    project_config: ProjectConfig | None,
    data_root: Path,
    *,
    numeric_export: bool = False,
    runs: list[NumberingRun] | None = None,
    leaf_assignments: dict[int, tuple[LeafRole, str | None]] | None = None,
) -> bytes:
    """Materialize the naming manifest artifact (v2 — runs-derived).

    Computes a ``label`` (styled display) and ``run_id`` per page via
    ``compute_labels`` over the supplied ``runs`` + ``leaf_assignments``, and
    derives the v2 filename ``prefix`` from the same runs via
    ``compute_prefixes_from_runs`` (the byte-stable successor to the deleted
    ``compute_prefix_v2``).  ``project_config`` is no longer used for naming —
    it is accepted for signature compatibility only.

    Args:
        project_id: Project identifier (informational; not written to manifest).
        ordered_pages: Pages in reading order (caller applies PageReorder events
            before calling this).
        project_config: Deprecated; ignored for naming (kept for callers that
            still pass it).
        data_root: Accepted for API compatibility (not used by this function).
        numeric_export: When True, populate ``export_name`` for each non-skip
            page with a bare zero-padded sequence number (e.g. "005").
        runs: ``NumberingRun`` objects used by ``compute_labels`` +
            ``compute_prefixes_from_runs``.  Empty -> every page is a marker /
            unnumbered (no run assigned).
        leaf_assignments: ``{idx0: (leaf_role, run_id | None)}`` per page.
            When a page is absent, the role is derived from
            ``page_type_to_leaf_role(page.page_type)`` and ``run_id`` is None.

    Returns:
        UTF-8 JSON bytes of the naming manifest.
    """
    from pdomain_prep_for_pgdp.core.numbering import (
        Leaf,
        compute_labels,
        compute_prefixes_from_runs,
    )
    from pdomain_prep_for_pgdp.core.numbering_migration import page_type_to_leaf_role
    from pdomain_prep_for_pgdp.core.prefix import export_name_for_seq

    _ = data_root  # available for future disk-caching
    _ = project_id  # available for future project-scoped logic
    _ = project_config  # deprecated: naming is fully runs-derived

    _runs: list[NumberingRun] = runs if runs is not None else []
    _leaf_assignments: dict[int, tuple[LeafRole, str | None]] = (
        leaf_assignments if leaf_assignments is not None else {}
    )

    # Build Leaf objects + collect stored run_id per scan.  A leaf's run_id is
    # taken directly from the assignment: a blank WITH a run is a counted page
    # (consumes a number), a blank WITHOUT a run is a [Blank Page] marker.
    leaves: list[Leaf] = []
    stored_run_id_map: dict[int, str | None] = {}
    plate_suffixes: dict[int, str] = {}
    for page in ordered_pages:
        if page.idx0 in _leaf_assignments:
            leaf_role, assigned_run_id = _leaf_assignments[page.idx0]
        else:
            leaf_role, _plate_side = page_type_to_leaf_role(page.page_type)
            assigned_run_id = None
        stored_run_id_map[page.idx0] = assigned_run_id
        # Preserve the exact legacy plate filename letter from page_type.
        _legacy_plate = {"plate_b": "b", "plate_p": "p", "plate_r": "r"}
        if page.page_type.value in _legacy_plate:
            plate_suffixes[page.idx0] = _legacy_plate[page.page_type.value]
        leaves.append(Leaf(scan=page.idx0, leaf_role=leaf_role, run_id=assigned_run_id))

    # Styled display label per scan (roman/arabic/marker/unnumbered).
    label_map: dict[int, str] = compute_labels(leaves, _runs)

    # Runs-derived v2 filename prefix per scan (replaces compute_prefix_v2).
    proof_start = _proof_start_for(leaves, _runs)
    if proof_start is None:
        prefix_map: dict[int, str | None] = {p.idx0: None for p in ordered_pages}
    else:
        max_scan = max((leaf.scan for leaf in leaves), default=proof_start)
        seq_width = 4 if (max_scan - proof_start + 1) > 999 else 3
        prefix_map = compute_prefixes_from_runs(
            leaves,
            _runs,
            proof_start=proof_start,
            seq_width=seq_width,
            plate_suffixes=plate_suffixes,
        )

    total_non_skip = sum(1 for p in ordered_pages if prefix_map.get(p.idx0) is not None)

    entries: list[dict[str, Any]] = []
    skip_ids: list[str] = []
    non_skip_seq = 0

    for page in ordered_pages:
        page_id = _page_id_for_idx0(page.idx0)
        prefix = prefix_map[page.idx0]
        role = page.page_type.value
        label = label_map.get(page.idx0, "")
        run_id = stored_run_id_map.get(page.idx0)

        if prefix is None:
            # No filename -> excluded from the submission zip (skip / unassigned).
            skip_ids.append(page_id)
            export_name: str | None = None
        elif numeric_export:
            export_name = export_name_for_seq(non_skip_seq, total=total_non_skip)
            non_skip_seq += 1
        else:
            export_name = None
            non_skip_seq += 1

        entries.append(
            {
                "page_id": page_id,
                "idx0": page.idx0,
                "role": role,
                "prefix": prefix,
                "export_name": export_name,
                "label": label,
                "run_id": run_id,
            }
        )

    manifest: dict[str, Any] = {
        "version": MANIFEST_VERSION,
        "pages": entries,
        "skip_ids": skip_ids,
    }
    return json.dumps(manifest, indent=2).encode("utf-8")


# ────────────────────────────────────────────────────────────────────────────
# Manifest loader
# ────────────────────────────────────────────────────────────────────────────


def load_naming_manifest(data_root: Path, project_id: str) -> NamingManifest:
    """Load and parse the on-disk naming manifest for a project.

    Raises:
        MissingNamingManifest: if the artifact is absent, unreadable, or
            has an incompatible version.
    """
    path = _manifest_path(data_root, project_id)
    if not path.exists():
        raise MissingNamingManifest(
            f"page_order naming manifest not found at {path}. "
            "Re-run the page_order stage before building the package."
        )
    try:
        raw = json.loads(path.read_bytes())
    except (OSError, json.JSONDecodeError) as exc:
        raise MissingNamingManifest(f"page_order naming manifest at {path} is unreadable: {exc}") from exc

    version = raw.get("version", 0)
    if version != MANIFEST_VERSION:
        raise MissingNamingManifest(
            f"page_order naming manifest version {version} is not supported "
            f"(expected {MANIFEST_VERSION}). Re-run the page_order stage."
        )

    pages = [
        NamingManifestEntry(
            page_id=e["page_id"],
            idx0=e["idx0"],
            role=e["role"],
            prefix=e.get("prefix"),
            export_name=e.get("export_name"),
        )
        for e in raw.get("pages", [])
    ]
    return NamingManifest(
        version=version,
        pages=pages,
        skip_ids=raw.get("skip_ids", []),
    )


# ────────────────────────────────────────────────────────────────────────────
# Event constructor (pure, no side effects)
# ────────────────────────────────────────────────────────────────────────────


# ────────────────────────────────────────────────────────────────────────────
# Legacy compatibility shim (for tests that used the old text-manifest API)
# ────────────────────────────────────────────────────────────────────────────


def materialize_page_order(
    project_id: str,
    page_ids: list[str],
    data_root: Path,
) -> bytes:
    """DEPRECATED: legacy newline-separated manifest shim.

    Existing tests that call this function directly still work.  New code
    should call ``materialize_naming_manifest`` instead.

    Returns UTF-8 bytes: one page_id per line, trailing newline.
    This is the old text/plain format — used only for backward compatibility.
    """
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


def _load_leaf_assignments(
    data_root: Path,
    project_id: str,
) -> tuple[list[PageRecord], dict[int, tuple[LeafRole, str | None]]]:
    """Load ordered PageRecords + per-page (leaf_role, run_id) from the store.

    Reads each page's persisted ``PrepPageExtension`` (P1.2 fields) to recover
    the Page-Order classification.  For pages not yet classified by Page Order
    (``leaf_role is None``) the role falls back to
    ``page_type_to_leaf_role(page_type)`` and ``run_id`` stays None.

    Returns ``(ordered_pages, {idx0: (leaf_role, run_id)})`` sorted by idx0.
    """
    from pdomain_ops.pages import get_extension

    from pdomain_prep_for_pgdp.core.numbering_migration import page_type_to_leaf_role
    from pdomain_prep_for_pgdp.core.page_service_helpers import (
        _ext_to_page_record,
        _get_proj_page_ids,
    )
    from pdomain_prep_for_pgdp.core.page_store_factory import build_page_service
    from pdomain_prep_for_pgdp.core.prep_extension import PrepPageExtension

    service = build_page_service(data_root, project_id)
    pages: list[PageRecord] = []
    assignments: dict[int, tuple[LeafRole, str | None]] = {}
    for page_uuid in _get_proj_page_ids(service, project_id):
        try:
            page_agg = service.store.get_page(page_uuid)
            ext = get_extension(page_agg.record, "prep", PrepPageExtension)
        except Exception:  # noqa: S112
            continue
        if ext is None:
            continue
        pages.append(_ext_to_page_record(ext))
        if ext.leaf_role is not None:
            assignments[ext.idx0] = (ext.leaf_role, ext.run_id)
        else:
            role, _side = page_type_to_leaf_role(ext.page_type)
            assignments[ext.idx0] = (role, None)
    pages.sort(key=lambda p: p.idx0)
    return pages, assignments


def compute_project_prefixes(
    data_root: Path,
    project_id: str,
    ordered_pages: list[PageRecord],
    *,
    page_assignments: dict[int, tuple[LeafRole, str | None]] | None = None,
) -> dict[int, str | None]:
    """Return ``{idx0: v2 prefix | None}`` for ``ordered_pages`` from runs.

    Loads the project's persisted NumberingRuns and per-page leaf
    classification, then derives the runs-based v2 filename prefix for each
    page in ``ordered_pages`` (using each page's *current* idx0 as the scan).

    Used by ``reorder_pages`` / ``insert_page`` to keep the denormalised
    ``PageRecord.prefix`` in step with the runs model.  The authoritative
    naming is still the page_order manifest (re-run the stage); this is a
    convenience refresh of the per-page prefix field.

    Args:
        data_root: Artifact root (used when ``page_assignments`` is None).
        project_id: Project identifier.
        ordered_pages: Pages in their *new* reading order, with each page's
            ``idx0`` already updated to its new position.
        page_assignments: Optional pre-built ``{new_idx0: (leaf_role, run_id)}``
            map.  When supplied, this is used directly instead of loading
            assignments from the store by the pages' current ``idx0``.

            **This parameter exists specifically for ``reorder_pages``**, which
            mutates ``page.idx0`` before calling this function.  At that point
            the store still holds *old* idx0 keys, so looking up
            ``assignments[page.idx0]`` would return the previous occupant's
            run_id — a stale-position bug.  The caller must build
            ``page_assignments`` before mutating idx0 (mapping each page's
            new position to the assignment it carried at its old position).

            When omitted (e.g. from ``insert_page``), assignments are loaded
            from the store by current idx0, which is correct for insert because
            existing pages' idx0 is already flushed before this call.

    Pages with no run + non-special role -> None (excluded).
    """
    from pdomain_prep_for_pgdp.core.models import LeafRole
    from pdomain_prep_for_pgdp.core.numbering import (
        Leaf,
        compute_prefixes_from_runs,
    )
    from pdomain_prep_for_pgdp.core.numbering_migration import page_type_to_leaf_role
    from pdomain_prep_for_pgdp.core.numbering_store import load_runs

    if page_assignments is not None:
        assignments = page_assignments
    else:
        _, assignments = _load_leaf_assignments(data_root, project_id)
    runs = load_runs(data_root, project_id).runs

    leaves: list[Leaf] = []
    plate_suffixes: dict[int, str] = {}
    legacy_plate = {"plate_b": "b", "plate_p": "p", "plate_r": "r"}
    for page in ordered_pages:
        if page.idx0 in assignments:
            role, run_id = assignments[page.idx0]
        else:
            role, _side = page_type_to_leaf_role(page.page_type)
            run_id = None
        if page.page_type.value in legacy_plate:
            plate_suffixes[page.idx0] = legacy_plate[page.page_type.value]
        leaves.append(Leaf(scan=page.idx0, leaf_role=role, run_id=run_id))

    proof_start = _proof_start_for(leaves, runs)
    if proof_start is None:
        return {p.idx0: None for p in ordered_pages}
    max_scan = max((leaf.scan for leaf in leaves), default=proof_start)
    seq_width = 4 if (max_scan - proof_start + 1) > 999 else 3
    _ = LeafRole  # keep import explicit for type clarity
    return compute_prefixes_from_runs(
        leaves,
        runs,
        proof_start=proof_start,
        seq_width=seq_width,
        plate_suffixes=plate_suffixes,
    )


def page_order_v2_cpu(
    project_id: str,
    page_ids: list[str],
    data_root: Path,
    book_name: str = "",
    cfg: Any = None,
) -> bytes:
    """v2 page_order stage callable (runner calling convention).

    Loads the project's PageRecords + persisted Page-Order leaf classification
    (``leaf_role`` / ``run_id`` from ``PrepPageExtension``) and the persisted
    ``NumberingRunsArtifact``, then materializes the runs-derived naming
    manifest.  Naming is fully runs-based — no ProjectConfig ranges.

    Args:
        project_id: project identifier.
        page_ids: ordered page ids from the runner (informational; reading
            order is recovered from the store's ``reading_order`` / idx0).
        data_root: artifact + store root.
        book_name: project book name (unused by naming; accepted for signature
            compatibility with the project-stage runner).
        cfg: ignored.

    Returns:
        UTF-8 JSON bytes of the naming manifest (version, pages, skip_ids).
    """
    _ = (page_ids, book_name, cfg)

    from pdomain_prep_for_pgdp.core.numbering_store import load_runs

    ordered_pages, leaf_assignments = _load_leaf_assignments(data_root, project_id)
    runs_artifact = load_runs(data_root, project_id)

    return materialize_naming_manifest(
        project_id=project_id,
        ordered_pages=ordered_pages,
        project_config=None,
        data_root=data_root,
        runs=runs_artifact.runs,
        leaf_assignments=leaf_assignments,
    )
