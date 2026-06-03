from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
UPDATER_PATH = ROOT / "scripts" / "update_github_actions.py"
spec = importlib.util.spec_from_file_location("update_github_actions", UPDATER_PATH)
assert spec is not None
assert spec.loader is not None
update_github_actions = importlib.util.module_from_spec(spec)
spec.loader.exec_module(update_github_actions)


def test_detects_unmanaged_workflow_action(tmp_path: Path) -> None:
    workflows = tmp_path / ".github" / "workflows"
    workflows.mkdir(parents=True)
    (workflows / "ci.yml").write_text(
        "name: ci\njobs:\n  ci:\n    steps:\n      - uses: example/not-managed@abc123\n",
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="example/not-managed"):
        update_github_actions.verify_managed_actions(workflows)


def test_accepts_local_workflow_call(tmp_path: Path) -> None:
    workflows = tmp_path / ".github" / "workflows"
    workflows.mkdir(parents=True)
    (workflows / "release.yml").write_text(
        "jobs:\n  regen:\n    uses: ./.github/workflows/regen.yml\n",
        encoding="utf-8",
    )

    update_github_actions.verify_managed_actions(workflows)


def test_current_workflows_use_only_managed_actions() -> None:
    update_github_actions.verify_managed_actions()
