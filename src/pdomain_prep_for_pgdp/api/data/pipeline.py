"""/api/data/pipeline/* — REMOVED in I1.

This module previously provided a deprecated GET /pipeline/stages/{stage_id}/fields
route. That route was removed at I1 per api-v2-deltas.md §4. The replacement
is GET /projects/{id}/pipeline (PipelineSnapshot).

The router is retained as an empty stub so any code that still imports it
does not break at import time.
"""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(tags=["pipeline"])
