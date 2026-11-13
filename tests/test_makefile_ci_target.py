"""Guard: `just ci` must include `openapi-export` before `frontend-build`.

Without this guard, ship-issue bot cycles that add FastAPI routes without
manually running `make openapi-export` would fail at the drift guard check
(`test_openapi_spec_committed.py`) when `success.sh` runs `make ci`.

Root cause of issue #65 bounce.
"""

from __future__ import annotations

import shlex
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]


def _show_ci() -> str:
    """Return the rendered command body for the `ci` recipe."""
    result = subprocess.run(
        ["just", "--show", "ci"],
        capture_output=True,
        text=True,
        cwd=REPO_ROOT,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    return result.stdout


def _extract_ci_deps() -> list[str]:
    """Return the ordered task names invoked by the `ci` recipe."""
    return [
        task
        for line in _show_ci().splitlines()
        if line.startswith("    just --quiet ")
        for task in shlex.split(line)[2:]
    ]


def test_ci_includes_openapi_export() -> None:
    deps = _extract_ci_deps()
    assert "openapi-export" in deps, f"`ci` recipe must include `openapi-export`. Current deps: {deps}"


def test_ci_openapi_export_before_frontend_build() -> None:
    deps = _extract_ci_deps()
    assert "openapi-export" in deps, f"`ci` recipe must include `openapi-export`. Current deps: {deps}"
    assert "frontend-build" in deps, f"`ci` recipe must include `frontend-build`. Current deps: {deps}"
    idx_export = deps.index("openapi-export")
    idx_build = deps.index("frontend-build")
    assert idx_export < idx_build, (
        f"`openapi-export` must come before `frontend-build` in `ci` recipe. Current deps: {deps}"
    )


def test_ci_test_after_openapi_export() -> None:
    """pytest gate must still run after openapi-export so a broken app still fails ci."""
    deps = _extract_ci_deps()
    assert "openapi-export" in deps, f"`ci` recipe must include `openapi-export`. Current deps: {deps}"
    assert "test" in deps, f"`ci` recipe must include `test`. Current deps: {deps}"
    idx_export = deps.index("openapi-export")
    idx_test = deps.index("test")
    assert idx_export < idx_test, (
        f"`test` must come after `openapi-export` in `ci` recipe. Current deps: {deps}"
    )
