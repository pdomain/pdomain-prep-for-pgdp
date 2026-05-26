"""Guard: the committed openapi.json must match what build_app() emits now.

Why: `frontend/src/api/types.ts` is (eventually) generated from
`openapi.json` via `openapi-typescript`. If the FastAPI surface drifts
without regenerating the spec, the frontend silently goes stale. This
guard fails CI when the committed spec no longer matches the live one,
forcing a `make openapi-export` + commit.

Drift fix-it: run `make openapi-export` and commit the updated
`openapi.json` (and, once npm is wired in CI, `frontend/src/api/types.ts`).
"""

from __future__ import annotations

import json
from pathlib import Path

from pdomain_prep_for_pgdp.bootstrap import build_app

REPO_ROOT = Path(__file__).resolve().parent.parent
COMMITTED_SPEC = REPO_ROOT / "openapi.json"


def test_committed_openapi_spec_exists() -> None:
    assert COMMITTED_SPEC.exists(), f"{COMMITTED_SPEC} is missing. Run `make openapi-export` and commit it."


def test_committed_openapi_spec_matches_live_app() -> None:
    live = build_app().openapi()
    committed = json.loads(COMMITTED_SPEC.read_text())
    assert live == committed, (
        "Committed openapi.json drifted from build_app().openapi(). "
        "Run `make openapi-export` and commit the updated openapi.json."
    )
