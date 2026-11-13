"""`just ci` runs the Playwright smoke subset and keeps heavy browser tests opt-in."""

from __future__ import annotations

import ast
import shlex
import subprocess
import tomllib
from pathlib import Path

import pytest

ROOT = Path(__file__).parent.parent
SMOKE_TESTS = [
    ("test_convergence_app_loads.py", "test_app_loads_no_console_errors"),
    ("test_w62_gap_tests.py", "test_all_stage_tool_slots_render_non_placeholder"),
    ("test_upload_flow.py", "test_upload_zip_navigates_to_import_page"),
]


def _show_recipe(name: str) -> str:
    """Return the rendered command body for a just recipe."""
    result = subprocess.run(
        ["just", "--show", name],
        capture_output=True,
        text=True,
        cwd=ROOT,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    return result.stdout


def _recipe_tasks(name: str) -> list[str]:
    """Return the ordered task names invoked by a just recipe."""
    return [
        task
        for line in _show_recipe(name).splitlines()
        if line.startswith("    just --quiet ")
        for task in shlex.split(line)[2:]
    ]


def test_ci_gates_on_the_smoke_subset() -> None:
    assert "e2e-smoke" in _recipe_tasks("ci")


def test_smoke_target_builds_the_spa_and_selects_only_the_marker() -> None:
    rule = _show_recipe("e2e-smoke")
    assert "frontend-build" in _recipe_tasks("e2e-smoke")
    assert "--group e2e" in rule
    assert "-m e2e_smoke" in rule


def test_full_e2e_target_stays_unfiltered() -> None:
    assert "-m " not in _show_recipe("e2e")


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
