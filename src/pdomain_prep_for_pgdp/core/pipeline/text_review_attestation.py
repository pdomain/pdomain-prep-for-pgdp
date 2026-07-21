"""Per-page text_review attestation writer (W0.3 / B3).

Validation requires ``attestation.json`` with ``status == "clean"``. The stage
impl dual-writes empty ``{}``; this module rewrites the attestation while
preserving ``output.txt``, via the multi-artifact dual-write path.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from pdomain_prep_for_pgdp.core.pipeline.page_stage_writer import commit_stage_artifacts_multi

if TYPE_CHECKING:
    from pathlib import Path

    from pdomain_prep_for_pgdp.adapters.database.base import IDatabase


class TextReviewAttestError(RuntimeError):
    """Raised when text_review cannot be attested (missing artifacts, etc.)."""


def _stage_dir(data_root: Path, project_id: str, page_id: str) -> Path:
    return data_root / "projects" / project_id / "pages" / page_id / "stages" / "text_review"


def build_clean_attestation(
    *,
    actor_id: str,
    note: str | None = None,
    attested_at: str | None = None,
) -> dict[str, Any]:
    """Build the attestation JSON body for a clean (attested) page."""
    body: dict[str, Any] = {
        "status": "clean",
        "actor_id": actor_id,
        "attested_at": attested_at if attested_at is not None else datetime.now(UTC).isoformat(),
    }
    if note is not None and note != "":
        body["note"] = note
    return body


async def attest_text_review_page(
    *,
    data_root: Path,
    database: IDatabase,
    project_id: str,
    page_id: str,
    actor_id: str,
    note: str | None = None,
    attested_at: str | None = None,
) -> dict[str, Any]:
    """Mark one page's text_review as attested clean (dual-write).

    Requires an existing ``output.txt`` (stage must have been run). Rewrites
    ``attestation.json`` and re-commits the compound stage so the page_stages
    row stays clean and content-hashed.
    """
    stage_dir = _stage_dir(data_root, project_id, page_id)
    output_path = stage_dir / "output.txt"
    if not output_path.is_file():
        raise TextReviewAttestError(
            f"text_review output.txt missing at {output_path}; run text_review before attesting"
        )

    text_bytes = output_path.read_bytes()
    attestation = build_clean_attestation(
        actor_id=actor_id,
        note=note,
        attested_at=attested_at,
    )
    att_bytes = json.dumps(attestation).encode("utf-8")

    await commit_stage_artifacts_multi(
        data_root=data_root,
        database=database,
        project_id=project_id,
        page_id=page_id,
        stage_id="text_review",
        files={"output.txt": text_bytes, "attestation.json": att_bytes},
        primary_filename="output.txt",
    )
    return attestation
