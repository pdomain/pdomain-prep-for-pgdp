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


def test_accepts_quoted_managed_actions_and_local_workflows(tmp_path: Path) -> None:
    workflows = tmp_path / ".github" / "workflows"
    workflows.mkdir(parents=True)
    (workflows / "ci.yml").write_text(
        "jobs:\n"
        "  ci:\n"
        "    steps:\n"
        '      - uses: "actions/checkout@abc123"\n'
        "      - uses: './.github/workflows/regen.yml'\n",
        encoding="utf-8",
    )

    update_github_actions.verify_managed_actions(workflows)


def test_current_workflows_use_only_managed_actions() -> None:
    update_github_actions.verify_managed_actions()


def test_update_workflow_refs_updates_quoted_action_refs(tmp_path: Path) -> None:
    workflow = tmp_path / "ci.yml"
    workflow.write_text(
        "jobs:\n"
        "  ci:\n"
        "    steps:\n"
        '      - uses: "actions/checkout@oldoldoldoldoldoldoldoldoldoldoldoldoldoldoldoldold1"\n'
        "      - uses: 'astral-sh/setup-uv@oldoldoldoldoldoldoldoldoldoldoldoldoldoldoldoldold2'\n",
        encoding="utf-8",
    )
    releases = {
        "actions/checkout": update_github_actions.ActionRelease(tag="v-test", sha="a" * 40),
        "astral-sh/setup-uv": update_github_actions.ActionRelease(tag="v-test", sha="b" * 40),
    }

    assert update_github_actions.update_workflow_refs(workflow, releases=releases)
    text = workflow.read_text(encoding="utf-8")
    assert f'uses: "actions/checkout@{"a" * 40}"' in text
    assert f"uses: 'astral-sh/setup-uv@{'b' * 40}'" in text


def test_update_uv_version_refs_updates_quoted_setup_uv(tmp_path: Path) -> None:
    workflow = tmp_path / "ci.yml"
    workflow.write_text(
        "jobs:\n"
        "  ci:\n"
        "    steps:\n"
        '      - uses: "astral-sh/setup-uv@oldoldoldoldoldoldoldoldoldoldoldoldoldoldoldoldold2"\n'
        "        with:\n"
        '          version: "0.1.0"\n',
        encoding="utf-8",
    )

    assert update_github_actions.update_uv_version_refs(workflow, version="0.11.16")
    assert 'version: "0.11.16"' in workflow.read_text(encoding="utf-8")


def test_update_uv_version_refs_updates_quoted_setup_uv_with_inline_comment(tmp_path: Path) -> None:
    workflow = tmp_path / "ci.yml"
    workflow.write_text(
        "jobs:\n"
        "  ci:\n"
        "    steps:\n"
        '      - uses: "astral-sh/setup-uv@oldoldoldoldoldoldoldoldoldoldoldoldoldoldoldoldold2"  # v8.1.0\n'
        "        with:\n"
        '          version: "0.1.0"\n',
        encoding="utf-8",
    )

    assert update_github_actions.update_uv_version_refs(workflow, version="0.11.16")
    assert 'version: "0.11.16"' in workflow.read_text(encoding="utf-8")


def _make_fake_runner(uv_version: str = "0.11.99") -> object:
    """Return a fake GhRunner that simulates latest_release and latest_uv_version responses."""
    import json
    import subprocess

    sha_a = "a" * 40

    _responses: dict[str, dict[str, object]] = {}
    for action in update_github_actions.MANAGED_ACTIONS:
        release_key = f"repos/{action}/releases/latest"
        _responses[release_key] = {"tag_name": "v99.0.0"}
        tag_ref_key = f"repos/{action}/git/ref/tags/v99.0.0"
        _responses[tag_ref_key] = {"object": {"type": "commit", "sha": sha_a}}
    _responses["repos/astral-sh/uv/releases/latest"] = {"tag_name": f"v{uv_version}"}

    def fake_runner(command: list[str]) -> subprocess.CompletedProcess[str]:
        endpoint = command[-1]
        payload = _responses.get(endpoint, {})
        return subprocess.CompletedProcess(command, 0, stdout=json.dumps(payload), stderr="")

    return fake_runner


def test_update_github_actions_does_not_modify_pyproject(tmp_path: Path) -> None:
    """update_github_actions must not touch pyproject.toml under any circumstances.

    The >=0.11.16 required-version floor is a deliberate contributor floor and
    must not auto-track the latest uv release.  Pinning to latest would cause
    the dep-refresh job to self-poison: it writes a bare version (read as ==)
    that the already-running older uv then fails to satisfy.
    """
    workflows = tmp_path / ".github" / "workflows"
    workflows.mkdir(parents=True)
    sha = "c" * 40
    (workflows / "ci.yml").write_text(
        f"jobs:\n"
        f"  ci:\n"
        f"    steps:\n"
        f'      - uses: "actions/checkout@{sha}"\n'
        f"        with:\n"
        f'          version: "0.11.16"\n',
        encoding="utf-8",
    )

    pyproject = tmp_path / "pyproject.toml"
    original_content = '[tool.uv]\nrequired-version = ">=0.11.16"\n'
    pyproject.write_text(original_content, encoding="utf-8")

    fake_runner = _make_fake_runner(uv_version="0.11.99")

    changed = update_github_actions.update_github_actions(
        workflow_dir=workflows,
        runner=fake_runner,
    )

    # pyproject.toml must NOT be in the changed paths list
    changed_names = [p.name for p in changed]
    assert "pyproject.toml" not in changed_names, (
        f"update_github_actions must not modify pyproject.toml, but it returned {changed}"
    )

    # pyproject.toml content must be unchanged on disk
    assert pyproject.read_text(encoding="utf-8") == original_content, (
        "pyproject.toml was modified on disk even though it must not be touched"
    )
