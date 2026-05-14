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
import subprocess
import sys
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


def _extract_target_deps(name: str) -> list[str]:
    """Return ordered list of prerequisite names for the named Make target."""
    text = MAKEFILE.read_text()
    # Match `name: dep1 dep2 ... ## optional comment`
    pattern = rf"^{re.escape(name)}:\s*([^#\n]+)"
    m = re.search(pattern, text, flags=re.MULTILINE)
    assert m is not None, f"Make target {name!r} not found in Makefile"
    return m.group(1).split()


def test_ci_includes_openapi_export_before_frontend_build() -> None:
    """openapi-export must run before frontend-build in make ci."""
    deps = _extract_target_deps("ci")
    assert "openapi-export" in deps, (
        f"ci target must include openapi-export so types.gen.ts is always "
        f"regenerated before the TypeScript build. Current deps: {deps}"
    )
    assert "frontend-build" in deps, f"ci target must include frontend-build. Deps: {deps}"
    oe_idx = deps.index("openapi-export")
    fb_idx = deps.index("frontend-build")
    assert oe_idx < fb_idx, (
        f"openapi-export (at position {oe_idx}) must appear before "
        f"frontend-build (at position {fb_idx}) so types.gen.ts is fresh "
        f"before the TypeScript compile. Deps: {deps}"
    )


def test_ci_test_gate_is_after_openapi_export() -> None:
    """pytest gate (test) must come after openapi-export so a broken app still fails ci."""
    deps = _extract_target_deps("ci")
    assert "test" in deps, f"ci target must include test. Deps: {deps}"
    assert "openapi-export" in deps, f"ci target must include openapi-export. Deps: {deps}"
    oe_idx = deps.index("openapi-export")
    test_idx = deps.index("test")
    assert oe_idx < test_idx, (
        f"openapi-export (at position {oe_idx}) must appear before "
        f"test (at position {test_idx}) so a broken FastAPI app is caught "
        f"by the pytest gate. Deps: {deps}"
    )


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


def test_export_openapi_script_writes_trailing_newline(tmp_path: Path) -> None:
    out = tmp_path / "openapi.json"
    result = subprocess.run(
        [sys.executable, str(REPO_ROOT / "scripts" / "export_openapi.py"), str(out)],
        capture_output=True,
        text=True,
        cwd=str(REPO_ROOT),
    )
    assert result.returncode == 0, f"export_openapi.py failed: {result.stderr}"
    assert out.read_bytes().endswith(b"\n"), (
        "export_openapi.py must write JSON with a trailing newline so the "
        "end-of-file-fixer pre-commit hook passes during `make ci`."
    )
