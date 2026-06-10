"""submit_check stage — dry-run SubmitCheckReport + GateConfirmation.

PLACEMENT: App-local PGDP-specific (docs/specs/library-placement.md §4.2).

Stage scope: project (stage-registry-v2.md §2, row #23)
  - Gate: zip must be clean
  - Inputs: zip manifest (sha256, size_bytes, file_count) from zip stage
  - Outputs: SubmitCheckReport JSON (api-v2-deltas.md §3)

SubmitCheckReport schema (api-v2-deltas.md §3):
  project_id: str
  run_at: str (ISO UTC)
  zip_sha256: str
  zip_size_bytes: int
  file_count: int
  issues: list[str]  -- human-readable warnings or errors
  passed: bool       -- True when no blocking issues

The actual SUBMIT confirmation appends a GateConfirmation event
(gate="submit_confirm") — this is an explicit two-step gate before archive.

Blocking rules (→ passed=False):
  - zip_size_bytes == 0      → "zip_empty"
  - page_count == 0          → "zero_page_count"

This module provides:
  1. run_submit_check(project_id, zip_sha256, zip_size_bytes, page_count, data_root) -> dict
     Pure function: checks constraints, returns SubmitCheckReport dict.
  2. make_gate_confirmation_event(...) -> dict
     Pure event constructor (no side effects).
  3. submit_check_v2_cpu(...) -> bytes
     Stage callable registered in V2_STAGE_IMPL.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any, Literal

if TYPE_CHECKING:
    from pathlib import Path


# ────────────────────────────────────────────────────────────────────────────
# Core submit-check validation (pure function)
# ────────────────────────────────────────────────────────────────────────────


def run_submit_check(
    project_id: str,
    zip_sha256: str,
    zip_size_bytes: int,
    page_count: int,
    data_root: Path,
) -> dict[str, Any]:
    """Run the pre-submit dry-run check.

    Args:
        project_id: Project identifier.
        zip_sha256: SHA256 hex digest of the submission zip (from zip stage).
        zip_size_bytes: Size in bytes of the submission zip.
        page_count: Number of pages expected in the submission.
        data_root: Data root (available for future artifact cross-checks).

    Returns a dict matching the SubmitCheckReport schema.

    Blocking rules:
        zip_empty        — zip_size_bytes == 0
        zero_page_count  — page_count == 0
    """
    _ = data_root  # reserved for future artifact cross-checks

    issues: list[str] = []

    if zip_size_bytes == 0:
        issues.append("zip_empty: submission zip is empty (0 bytes)")

    if page_count == 0:
        issues.append("zero_page_count: submission has no pages")

    return {
        "project_id": project_id,
        "run_at": datetime.now(UTC).isoformat(),
        "zip_sha256": zip_sha256,
        "zip_size_bytes": zip_size_bytes,
        "file_count": page_count,  # file_count = number of pages in submission
        "issues": issues,
        "passed": len(issues) == 0,
    }


# ────────────────────────────────────────────────────────────────────────────
# Gate confirmation event constructor (pure, no side effects)
# ────────────────────────────────────────────────────────────────────────────


def make_gate_confirmation_event(
    *,
    gate: Literal["two_step_delete", "submit_confirm"],
    target_id: str,
    actor_id: str,
) -> dict[str, Any]:
    """Construct a GateConfirmation event dict.

    Matches the GateConfirmation event payload from stage-registry-v2.md §5.2.
    The caller passes this to PrepProjectAggregate.record_gate_confirmation
    for eventsourcing persistence.

    gate="submit_confirm" is used when the user explicitly confirms they
    want to proceed to archive after reviewing the SubmitCheckReport.
    """
    return {
        "event_type": "GateConfirmation",
        "gate": gate,
        "target_id": target_id,
        "actor_id": actor_id,
    }


# ────────────────────────────────────────────────────────────────────────────
# v2 stage callable — registered in V2_STAGE_IMPL
# ────────────────────────────────────────────────────────────────────────────


def submit_check_v2_cpu(
    project_id: str,
    zip_sha256: str,
    zip_size_bytes: int,
    page_count: int,
    data_root: Path,
    cfg: Any = None,
) -> bytes:
    """v2 submit_check stage callable.

    Takes project_id + zip_sha256 + zip_size_bytes + page_count + data_root.
    Returns JSON bytes of the SubmitCheckReport.

    The actual SUBMIT (→ archive) requires a GateConfirmation event to be
    appended first (gate="submit_confirm"). The route layer (B5) handles
    the two-step gate before dispatching the archive stage.
    """
    _ = cfg
    report = run_submit_check(
        project_id=project_id,
        zip_sha256=zip_sha256,
        zip_size_bytes=zip_size_bytes,
        page_count=page_count,
        data_root=data_root,
    )
    return json.dumps(report).encode("utf-8")
