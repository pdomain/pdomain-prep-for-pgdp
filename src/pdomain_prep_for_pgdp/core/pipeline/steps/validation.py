"""validation stage — aggregates page facts → ValidationReport.

PLACEMENT: App-local PGDP-specific (docs/specs/library-placement.md §3).

Stage scope: project (stage-registry-v2.md §2, row #19)
  - Inputs: page-scoped text_review artifacts (attestation.json), illustration
    artifacts, page_order artifact
  - Outputs: ValidationReport JSON (api-v2-deltas.md §3)
  - Rules: data-driven so F5.6 can render them

ValidationReport schema (api-v2-deltas.md §3):
  blockers: list[ValidationBlocker]   — must be zero for build_package gate
  warnings: list[ValidationWarning]
  blocker_count: int
  warning_count: int
  passed: bool

Rule inventory (data-driven, code strings for F5.6 rendering):

  BLOCKERS (prevent build_package):
    missing_text_review     — page has no text_review artifact at all
    unattested_text_review  — text_review artifact exists but attestation is empty/missing clean status

  WARNINGS (logged but don't block):
    open_wordcheck_flags    — page has unresolved wordcheck flags (future: when wordcheck flags exist)
    missing_illustrations   — page has illustration_regions but no illustrations artifact (future)

This module provides:
  1. validate_project(project_id, page_ids, data_root) -> dict
     Pure function: scans artifacts, returns ValidationReport dict.
  2. validation_v2_cpu(...) -> bytes
     Stage callable registered in V2_STAGE_IMPL.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from pdomain_prep_for_pgdp.core.pipeline.pgdp_naming import (
    validate_package_naming,
    validate_pgdp_filename,
)

if TYPE_CHECKING:
    from pathlib import Path


# ────────────────────────────────────────────────────────────────────────────
# Rule definitions (data-driven)
# ────────────────────────────────────────────────────────────────────────────

# Each rule: (code, severity, message_template)
_RULES: list[tuple[str, str, str]] = [
    ("missing_text_review", "blocker", "Page {page_id}: no text_review artifact found"),
    ("unattested_text_review", "blocker", "Page {page_id}: text_review not attested as clean"),
]


def _get_text_review_dir(data_root: Path, project_id: str, page_id: str) -> Path:
    return data_root / "projects" / project_id / "pages" / page_id / "stages" / "text_review"


def _check_text_review(
    data_root: Path,
    project_id: str,
    page_id: str,
) -> list[dict[str, Any]]:
    """Check text_review for a single page. Returns list of blocker dicts."""
    issues: list[dict[str, Any]] = []
    text_review_dir = _get_text_review_dir(data_root, project_id, page_id)
    output_txt = text_review_dir / "output.txt"
    attestation_json = text_review_dir / "attestation.json"

    if not output_txt.exists():
        issues.append(
            {
                "page_id": page_id,
                "stage_id": "text_review",
                "message": f"Page {page_id}: no text_review artifact found",
                "code": "missing_text_review",
            }
        )
        return issues

    # Check attestation
    if not attestation_json.exists():
        issues.append(
            {
                "page_id": page_id,
                "stage_id": "text_review",
                "message": f"Page {page_id}: text_review not attested as clean",
                "code": "unattested_text_review",
            }
        )
        return issues

    try:
        attestation = json.loads(attestation_json.read_bytes())
    except (json.JSONDecodeError, OSError):
        attestation = {}

    # Attestation must have status=clean (non-empty attestation with clean status)
    if not attestation or attestation.get("status") != "clean":
        issues.append(
            {
                "page_id": page_id,
                "stage_id": "text_review",
                "message": f"Page {page_id}: text_review not attested as clean",
                "code": "unattested_text_review",
            }
        )

    return issues


# ────────────────────────────────────────────────────────────────────────────
# Core validation (pure function, scans artifacts on disk)
# ────────────────────────────────────────────────────────────────────────────


def validate_project(
    project_id: str,
    page_ids: list[str],
    data_root: Path,
    page_prefixes: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Aggregate page facts into a ValidationReport dict.

    Scans each page's text_review artifact for blockers. Returns a dict
    matching the ValidationReport schema from api-v2-deltas.md §3.

    Rules are data-driven (see _RULES above) so F5.6 can render them.

    Args:
        project_id: Project identifier.
        page_ids: Ordered list of page IDs to validate.
        data_root: Root of the on-disk data tree.
        page_prefixes: Optional mapping of page_id → PGDP filename prefix
            (e.g. "f001", "p045"). When supplied, PGDP naming compliance
            rules are checked for each prefix and added as blockers if
            violated. When None, the naming check is skipped (legacy path).

    Naming rules applied when page_prefixes is provided:
        - basename_too_long  : prefix > 8 chars
        - invalid_chars      : prefix contains chars outside [A-Za-z0-9_-]
        - uppercase_ext      : extension is not lowercase (always .png/.txt here)
        - disallowed_ext     : extension not in .png/.txt/.jpg
        - ad_substring       : "ad" appears in prefix (ad-blocker risk)
        - sort_order         : sorted(prefixes) disagrees with page reading order

    Reference:
        https://www.pgdp.net/wiki/DP_Official_Documentation:CP_and_PM/Content_Providing_FAQ
    """
    blockers: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []

    for page_id in page_ids:
        page_blockers = _check_text_review(data_root, project_id, page_id)
        blockers.extend(page_blockers)

    # ── PGDP naming compliance check (when prefixes are known) ────────────────
    if page_prefixes:
        naming_errors: list[str] = []
        for page_id in page_ids:
            prefix = page_prefixes.get(page_id, page_id)
            for ext in (".png", ".txt"):
                naming_errors.extend(validate_pgdp_filename(prefix, ext))

        # Check sort order as a package-level rule
        prospective_names: list[str] = []
        for page_id in page_ids:
            prefix = page_prefixes.get(page_id, page_id)
            prospective_names.append(f"{prefix}.png")
            prospective_names.append(f"{prefix}.txt")
        naming_errors.extend(validate_package_naming(prospective_names, page_order=list(page_ids)))

        if naming_errors:
            blockers.append(
                {
                    "page_id": None,
                    "stage_id": "build_package",
                    "message": f"PGDP naming violations: {'; '.join(naming_errors)}",
                    "code": "pgdp_naming",
                }
            )
    # ─────────────────────────────────────────────────────────────────────────

    return {
        "project_id": project_id,
        "run_at": datetime.now(UTC).isoformat(),
        "blockers": blockers,
        "warnings": warnings,
        "blocker_count": len(blockers),
        "warning_count": len(warnings),
        "passed": len(blockers) == 0,
    }


# ────────────────────────────────────────────────────────────────────────────
# v2 stage callable — registered in V2_STAGE_IMPL
# ────────────────────────────────────────────────────────────────────────────


def validation_v2_cpu(
    project_id: str,
    page_ids: list[str],
    data_root: Path,
    cfg: Any = None,
) -> bytes:
    """v2 validation stage callable.

    Takes project_id + ordered page_ids + data_root (artifact root).
    Returns JSON bytes of the ValidationReport.

    The stage is project-scoped; the runner passes all page IDs in the project.
    Gate for build_package: report.passed must be True.
    """
    _ = cfg
    report = validate_project(project_id=project_id, page_ids=page_ids, data_root=data_root)
    return json.dumps(report).encode("utf-8")
