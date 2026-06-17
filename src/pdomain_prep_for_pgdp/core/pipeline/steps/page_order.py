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
  - ``prefix``: the v2 PGDP filename prefix (from compute_prefix_v2), or null for skip pages.
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


# ────────────────────────────────────────────────────────────────────────────
# Manifest data structures
# ────────────────────────────────────────────────────────────────────────────

MANIFEST_VERSION = 2
"""Current naming manifest schema version.

Increment when the JSON schema changes in a backward-incompatible way.
Consumers may reject manifests with an older version; the stage runner
always regenerates on re-run.

v2 (P1.7): adds ``label`` and ``run_id`` per entry, derived from
``compute_labels`` over ``NumberingRun`` objects rather than from
``compute_prefix_v2`` alone.  The ``prefix`` and ``export_name`` fields
are still present and retain the same shape for backward compatibility;
full migration to runs-derived prefixes lands in P3.1.
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
    """Materialize the naming manifest artifact (v2).

    Computes a ``label`` and ``run_id`` per page via ``compute_labels`` over
    the supplied ``runs`` + ``leaf_assignments``.  Also derives ``prefix`` via
    ``compute_prefix_v2`` when ``project_config`` is available (legacy path;
    full migration to runs-derived prefixes lands in P3.1).

    Args:
        project_id: Project identifier (informational; not written to manifest).
        ordered_pages: Pages in reading order (caller applies PageReorder events
            before calling this).
        project_config: ProjectConfig with range fields used by
            ``compute_prefix_v2``.  When ``None`` the ``prefix`` field in every
            entry is ``None`` (acceptable when only ``label``/``run_id`` are
            needed, e.g. in tests that don't exercise the prefix path).
        data_root: Accepted for API compatibility (not used by this function).
        numeric_export: When True, populate ``export_name`` for each non-skip
            page with a bare zero-padded sequence number (e.g. "005").  The
            PGDP validator validates export_name values; consumers should use
            export_name when it is non-None and fall back to prefix otherwise.
        runs: ``NumberingRun`` objects used by ``compute_labels``.  When
            ``None`` or empty, ``compute_labels`` produces empty/MARKER labels
            (no numbering applied — stopgap until the runs-wiring lands in P1.9).
        leaf_assignments: ``{idx0: (leaf_role, run_id | None)}`` per page.
            When ``None`` or a page is absent from the dict, the role is derived
            from ``page_type_to_leaf_role(page.page_type)`` and ``run_id`` is
            ``None``.

    Returns:
        UTF-8 JSON bytes of the naming manifest.
    """
    from pdomain_prep_for_pgdp.core.models import LeafRole
    from pdomain_prep_for_pgdp.core.numbering import Leaf, compute_labels
    from pdomain_prep_for_pgdp.core.numbering_migration import page_type_to_leaf_role

    _ = data_root  # available for future disk-caching
    _ = project_id  # available for future project-scoped logic

    _runs: list[NumberingRun] = runs if runs is not None else []
    _leaf_assignments: dict[int, tuple[LeafRole, str | None]] = (
        leaf_assignments if leaf_assignments is not None else {}
    )

    # Build Leaf objects for compute_labels and collect stored run_id per scan.
    # Blank leaves are always passed to compute_labels with run_id=None so they
    # produce a MARKER label (not a consumed counter slot).  The manifest's
    # run_id field still records the assignment's run_id for provenance.
    leaves: list[Leaf] = []
    # stored_run_id_map: the run_id from the assignment (for the manifest field)
    stored_run_id_map: dict[int, str | None] = {}
    for page in ordered_pages:
        if page.idx0 in _leaf_assignments:
            leaf_role, assigned_run_id = _leaf_assignments[page.idx0]
        else:
            leaf_role, _plate_side = page_type_to_leaf_role(page.page_type)
            assigned_run_id = None
        stored_run_id_map[page.idx0] = assigned_run_id
        # Blank leaves: always None so compute_labels emits MARKER, not a number.
        leaf_run_id = None if leaf_role is LeafRole.blank else assigned_run_id
        leaves.append(Leaf(scan=page.idx0, leaf_role=leaf_role, run_id=leaf_run_id))

    # Map: idx0 -> label string
    label_map: dict[int, str] = compute_labels(leaves, _runs)

    pages_by_idx = {p.idx0: p for p in ordered_pages}

    # Compute prefix via legacy path when project_config is available.
    if project_config is not None:
        from pdomain_prep_for_pgdp.core.prefix import compute_prefix_v2, export_name_for_seq

        prefix_map: dict[int, str | None] = {
            p.idx0: compute_prefix_v2(p.idx0, project_config, pages_by_idx) for p in ordered_pages
        }
        total_non_skip = sum(
            1
            for p in ordered_pages
            if p.idx0 >= project_config.proof_start_idx0
            and p.idx0 <= project_config.proof_end_idx0
            and p.page_type.value != "skip"
        )
    else:
        prefix_map = {p.idx0: None for p in ordered_pages}
        total_non_skip = sum(1 for p in ordered_pages if p.page_type.value != "skip")

    entries: list[dict[str, Any]] = []
    skip_ids: list[str] = []
    non_skip_seq = 0

    for page in ordered_pages:
        page_id = _page_id_for_idx0(page.idx0)
        prefix = prefix_map[page.idx0]
        role = page.page_type.value
        label = label_map.get(page.idx0, "")
        run_id = stored_run_id_map.get(page.idx0)

        if prefix is None and project_config is not None:
            skip_ids.append(page_id)
            export_name: str | None = None
        elif prefix is None:
            # project_config is None — derive skip from page_type
            if page.page_type.value == "skip":
                skip_ids.append(page_id)
            export_name = None
        elif numeric_export and project_config is not None:
            from pdomain_prep_for_pgdp.core.prefix import export_name_for_seq

            export_name = export_name_for_seq(non_skip_seq, total=total_non_skip)
            non_skip_seq += 1
        else:
            export_name = None
            if prefix is not None:
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


def page_order_v2_cpu(
    ordered_pages: list[PageRecord],
    project_id: str,
    data_root: Path,
    project_config: ProjectConfig | None = None,
    cfg: Any = None,
) -> bytes:
    """v2 page_order stage callable.

    Takes the ordered pages list (sorted by reading_order / with any
    PageReorder events already applied by the caller) + the ProjectConfig.

    Returns UTF-8 JSON bytes: the naming manifest (version, pages, skip_ids).

    The stage is project-scoped; the runner calls this with all pages in
    the project's current reading order.
    """
    _ = cfg

    if project_config is None:
        # Fallback for callers that pass only page_ids (legacy integration path).
        # In this case we can't compute prefixes, so we emit a minimal manifest
        # that marks all pages as skip with null prefix.  The full runner always
        # passes project_config.
        raise ValueError(
            "page_order_v2_cpu requires project_config to compute naming prefixes. "
            "Pass project_config= from the stage runner."
        )

    return materialize_naming_manifest(
        project_id=project_id,
        ordered_pages=ordered_pages,
        project_config=project_config,
        data_root=data_root,
        runs=[],
        leaf_assignments={},
    )
