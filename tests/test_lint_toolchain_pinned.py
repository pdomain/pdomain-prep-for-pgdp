"""Guard: the lint gate and the project must run the same ruff.

Why: the pre-commit hook pins ruff by `rev:`, while the project resolves its
own ruff through `uv.lock`. Nothing links the two. When the hook pin moved to
v0.16.2 while the lock stayed at 0.15.21, the newer ruff reported 70 findings
the older one did not implement, so `uv run ruff check` passed and
`make pre-commit-check` failed on the same clean tree. The gate was red for
days and a developer had no way to tell whose lint failure it was.

This guard fails the moment the two drift again.

Drift fix-it: decide which version wins, then make both agree.

  - Adopt the hook's version (the usual choice, and what
    `docs/issues/2026-08-08-ruff-version-skew.md` did):
    raise the `ruff>=` floor in `pyproject.toml` to that version and run
    `uv lock --upgrade-package ruff`. Expect new findings; fix them rather
    than suppressing them.
  - Or pin the hook back: set `rev:` to the locked version.

See `docs/issues/2026-08-08-ruff-version-skew.md` for the full report.
"""

from __future__ import annotations

import tomllib
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent
PRE_COMMIT_CONFIG = REPO_ROOT / ".pre-commit-config.yaml"
UV_LOCK = REPO_ROOT / "uv.lock"
PYPROJECT = REPO_ROOT / "pyproject.toml"

_RUFF_HOOK_REPO = "ruff-pre-commit"


def _hook_ruff_version() -> str:
    """The ruff version the pre-commit gate runs, from its `rev:` pin."""
    config = yaml.safe_load(PRE_COMMIT_CONFIG.read_text())
    for repo in config["repos"]:
        if _RUFF_HOOK_REPO in repo["repo"]:
            # Tags are `vX.Y.Z`; a frozen SHA would carry `# frozen: vX.Y.Z`.
            return str(repo["rev"]).lstrip("v")
    msg = f"no {_RUFF_HOOK_REPO} repo found in {PRE_COMMIT_CONFIG.name}"
    raise AssertionError(msg)


def _locked_ruff_version() -> str:
    """The ruff version the project resolves, from the lockfile."""
    lock = tomllib.loads(UV_LOCK.read_text())
    for package in lock["package"]:
        if package["name"] == "ruff":
            return str(package["version"])
    msg = f"ruff is not present in {UV_LOCK.name}"
    raise AssertionError(msg)


def _ruff_floor() -> str:
    """The `ruff>=` floor declared for the dev dependency group."""
    project = tomllib.loads(PYPROJECT.read_text())
    for spec in project["dependency-groups"]["dev"]:
        if spec.replace(" ", "").startswith("ruff>="):
            return spec.split(">=", 1)[1].strip()
    msg = "no `ruff>=` constraint found in the dev dependency group"
    raise AssertionError(msg)


def _as_tuple(version: str) -> tuple[int, ...]:
    return tuple(int(part) for part in version.split("."))


def test_hook_and_lockfile_run_the_same_ruff() -> None:
    """The gate's ruff and the project's ruff must be the same version."""
    hook = _hook_ruff_version()
    locked = _locked_ruff_version()
    assert hook == locked, (
        f"ruff version skew: the pre-commit hook pins {hook} but uv.lock resolves {locked}. "
        "`uv run ruff check` and `make pre-commit-check` will disagree on the same tree. "
        "See this module's docstring for the fix."
    )


def test_ruff_floor_cannot_resolve_behind_the_hook() -> None:
    """The `ruff>=` floor must not allow re-resolving below the gate's version.

    Matching the lock once is not enough. With a floor below the hook's pin, a
    later `uv lock` can legally land on an older ruff and reopen the same gap.
    """
    floor = _ruff_floor()
    hook = _hook_ruff_version()
    assert _as_tuple(floor) >= _as_tuple(hook), (
        f"the dev group allows ruff>={floor}, which is below the hook's pin of {hook}. "
        f"A re-resolve could fall behind the gate. Raise the floor to >={hook}."
    )
