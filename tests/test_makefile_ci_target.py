"""Guard: `make ci` must include `openapi-export` before `frontend-build`.

Without this guard, ship-issue bot cycles that add FastAPI routes without
manually running `make openapi-export` would fail at the drift guard check
(`test_openapi_spec_committed.py`) when `success.sh` runs `make ci`.

Root cause of issue #65 bounce.
"""

from __future__ import annotations

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
MAKEFILE = REPO_ROOT / "Makefile"


def _extract_ci_deps() -> list[str]:
    """Return the ordered dependency list for the `ci` target."""
    text = MAKEFILE.read_text()
    m = re.search(r"^ci:\s+([^\n#]+)", text, flags=re.MULTILINE)
    assert m is not None, "Make target 'ci' not found in Makefile"
    return m.group(1).split()


def test_ci_includes_openapi_export() -> None:
    deps = _extract_ci_deps()
    assert "openapi-export" in deps, f"`ci` target must include `openapi-export`. Current deps: {deps}"


def test_ci_openapi_export_before_frontend_build() -> None:
    deps = _extract_ci_deps()
    assert "openapi-export" in deps, f"`ci` target must include `openapi-export`. Current deps: {deps}"
    assert "frontend-build" in deps, f"`ci` target must include `frontend-build`. Current deps: {deps}"
    idx_export = deps.index("openapi-export")
    idx_build = deps.index("frontend-build")
    assert idx_export < idx_build, (
        f"`openapi-export` must come before `frontend-build` in `ci` target. Current order: {deps}"
    )


def test_ci_test_after_openapi_export() -> None:
    """pytest gate must still run after openapi-export so a broken app still fails ci."""
    deps = _extract_ci_deps()
    assert "openapi-export" in deps, f"`ci` target must include `openapi-export`. Current deps: {deps}"
    assert "test" in deps, f"`ci` target must include `test`. Current deps: {deps}"
    idx_export = deps.index("openapi-export")
    idx_test = deps.index("test")
    assert idx_export < idx_test, (
        f"`test` must come after `openapi-export` in `ci` target. Current order: {deps}"
    )
