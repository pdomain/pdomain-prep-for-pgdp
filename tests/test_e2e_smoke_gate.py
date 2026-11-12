"""`make ci` runs the Playwright smoke subset and keeps heavy browser tests opt-in."""

from __future__ import annotations

import ast
import re
import tomllib
from pathlib import Path

import pytest

ROOT = Path(__file__).parent.parent
SMOKE_TESTS = [
    ("test_convergence_app_loads.py", "test_app_loads_no_console_errors"),
    ("test_w62_gap_tests.py", "test_all_stage_tool_slots_render_non_placeholder"),
    ("test_upload_flow.py", "test_upload_zip_navigates_to_import_page"),
]


def _make_rule(target: str) -> str:
    text = (ROOT / "Makefile").read_text()
    match = re.search(rf"^{re.escape(target)}:(.*(?:\n\t.*)*)", text, flags=re.MULTILINE)
    assert match is not None, f"no make target {target}"
    return match.group(1)


def test_ci_gates_on_the_smoke_subset() -> None:
    assert "e2e-smoke" in _make_rule("ci").split("\n")[0].split()


def test_smoke_target_builds_the_spa_and_selects_only_the_marker() -> None:
    rule = _make_rule("e2e-smoke")
    assert "frontend-build" in rule.split("\n")[0]
    assert "--group e2e" in rule
    assert "-m e2e_smoke" in rule


def test_full_e2e_target_stays_unfiltered() -> None:
    assert "-m " not in _make_rule("e2e")


def test_marker_is_registered() -> None:
    pyproject = tomllib.loads((ROOT / "pyproject.toml").read_text())
    markers = pyproject["tool"]["pytest"]["ini_options"]["markers"]
    assert any(marker.startswith("e2e_smoke:") for marker in markers)


@pytest.mark.parametrize(("filename", "test_name"), SMOKE_TESTS)
def test_smoke_test_carries_the_marker(filename: str, test_name: str) -> None:
    module = ast.parse((ROOT / "tests" / "e2e" / filename).read_text())
    function = next(
        node for node in module.body if isinstance(node, ast.FunctionDef) and node.name == test_name
    )
    decorators = [ast.unparse(decorator) for decorator in function.decorator_list]
    assert "pytest.mark.e2e_smoke" in decorators
