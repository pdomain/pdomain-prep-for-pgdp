"""Guard: `make openapi-export` must write the spec where the drift guard reads it.

Iter-9 caught a silent inconsistency: the Makefile target was writing to
``frontend/openapi.json`` while ``tests/test_openapi_spec_committed.py``
asserts the committed spec at repo-root ``openapi.json`` matches
``build_app().openapi()``. A user who ran ``make openapi-export`` and
committed the result was *not* updating the file the drift guard checks,
so the guard would fire on the next CI run with a misleading "drifted
from build_app()" message.

This test parses the ``openapi-export`` recipe in ``Makefile`` and asserts
the ``export_openapi.py`` invocation writes to repo-root ``openapi.json``
(the same path used by ``test_openapi_spec_committed.COMMITTED_SPEC``).

Cheap to keep, immediate to fail if the target regresses.
"""

from __future__ import annotations

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
MAKEFILE = REPO_ROOT / "Makefile"


def _extract_target_body(name: str) -> str:
    """Return the recipe lines (tab-prefixed) for the named Make target."""
    text = MAKEFILE.read_text()
    # Match `name:` at column 0, capture every following tab-indented line.
    pattern = rf"^{re.escape(name)}:[^\n]*\n((?:\t[^\n]*\n)+)"
    m = re.search(pattern, text, flags=re.MULTILINE)
    assert m is not None, f"Make target {name!r} not found in Makefile"
    return m.group(1)


def test_openapi_export_target_writes_to_repo_root_openapi_json() -> None:
    body = _extract_target_body("openapi-export")
    # The export script call must target repo-root `openapi.json`, not
    # `frontend/openapi.json` — the drift guard reads `<repo>/openapi.json`.
    assert "scripts/export_openapi.py openapi.json" in body, (
        "openapi-export target must write the spec to repo-root openapi.json "
        "(the path test_openapi_spec_committed.py asserts against). Found "
        "recipe body:\n" + body
    )
    assert "scripts/export_openapi.py frontend/openapi.json" not in body, (
        "openapi-export target writes to frontend/openapi.json, but the drift "
        "guard reads repo-root openapi.json — running the target will not "
        "refresh the file the guard checks."
    )
