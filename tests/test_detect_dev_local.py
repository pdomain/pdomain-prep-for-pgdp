"""Tests for ``scripts/detect_dev_local.py``.

The script exits 0 when a dev-local install of ``pdomain-book-tools`` is
detected and 1 otherwise. Detection precedence (per
``docs/architecture/dev-local-upgrade-flow.md``):

1. ``uv pip show pdomain-book-tools`` reports an ``Editable project location:`` line.
2. Marker file at ``.venv/.dev-local`` exists.
3. Env var ``PD_DEV_LOCAL=1``.

The tests fake each signal independently so the script is exercised
without mutating the real venv.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT = REPO_ROOT / "scripts" / "detect_dev_local.py"


def _run(env: dict[str, str], cwd: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(SCRIPT)],
        env=env,
        cwd=cwd,
        capture_output=True,
        text=True,
        check=False,
    )


def _base_env(tmp_path: Path, *, fake_uv: str | None = None) -> dict[str, str]:
    """Build a clean env that hides the real ``uv`` unless ``fake_uv`` is given.

    The fake uv script lives at ``tmp_path/bin/uv``; PATH is set so that
    only that directory (plus the python interpreter's dir, for
    ``sys.executable`` resolution) is searched. PD_DEV_LOCAL is unset.
    """

    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    if fake_uv is not None:
        uv_path = bin_dir / "uv"
        uv_path.write_text(fake_uv)
        uv_path.chmod(0o755)

    python_dir = str(Path(sys.executable).parent)
    return {
        "PATH": f"{bin_dir}:{python_dir}:/usr/bin:/bin",
        "HOME": str(tmp_path),
    }


def test_script_exists() -> None:
    assert SCRIPT.exists(), f"detect script missing at {SCRIPT}"


def test_exit_1_when_no_signals(tmp_path: Path) -> None:
    """Canonical install: uv reports a non-editable location; no marker; no env."""

    fake_uv = (
        "#!/usr/bin/env bash\n"
        "echo 'Name: pdomain-book-tools'\n"
        "echo 'Version: 0.9.0'\n"
        "echo 'Location: /opt/site-packages'\n"
    )
    env = _base_env(tmp_path, fake_uv=fake_uv)
    result = _run(env, cwd=tmp_path)
    assert result.returncode == 1, result.stdout + result.stderr


def test_exit_0_when_uv_reports_editable(tmp_path: Path) -> None:
    fake_uv = (
        "#!/usr/bin/env bash\n"
        "echo 'Name: pdomain-book-tools'\n"
        "echo 'Version: 0.9.0'\n"
        "echo 'Location: /workspaces/foo/.venv/lib/python3.13/site-packages'\n"
        "echo 'Editable project location: /workspaces/pdomain-book-tools'\n"
    )
    env = _base_env(tmp_path, fake_uv=fake_uv)
    result = _run(env, cwd=tmp_path)
    assert result.returncode == 0, result.stdout + result.stderr


def test_exit_0_when_marker_file_present(tmp_path: Path) -> None:
    """Marker fallback: even if uv reports canonical, the marker file wins."""

    fake_uv = "#!/usr/bin/env bash\necho 'Name: pdomain-book-tools'\necho 'Location: /opt/site-packages'\n"
    venv = tmp_path / ".venv"
    venv.mkdir()
    (venv / ".dev-local").write_text("")

    env = _base_env(tmp_path, fake_uv=fake_uv)
    result = _run(env, cwd=tmp_path)
    assert result.returncode == 0, result.stdout + result.stderr


def test_exit_0_when_env_var_set(tmp_path: Path) -> None:
    """Last-resort override: PD_DEV_LOCAL=1 forces dev-local detection."""

    fake_uv = "#!/usr/bin/env bash\necho 'Name: pdomain-book-tools'\necho 'Location: /opt/site-packages'\n"
    env = _base_env(tmp_path, fake_uv=fake_uv)
    env["PD_DEV_LOCAL"] = "1"
    result = _run(env, cwd=tmp_path)
    assert result.returncode == 0, result.stdout + result.stderr


def test_env_var_zero_does_not_trigger(tmp_path: Path) -> None:
    """``PD_DEV_LOCAL=0`` must not be read as truthy."""

    fake_uv = "#!/usr/bin/env bash\necho 'Name: pdomain-book-tools'\necho 'Location: /opt/site-packages'\n"
    env = _base_env(tmp_path, fake_uv=fake_uv)
    env["PD_DEV_LOCAL"] = "0"
    result = _run(env, cwd=tmp_path)
    assert result.returncode == 1, result.stdout + result.stderr


def test_uv_failure_falls_through_to_other_signals(tmp_path: Path) -> None:
    """If ``uv pip show`` exits non-zero, detection still considers marker + env."""

    fake_uv = "#!/usr/bin/env bash\nexit 2\n"
    env = _base_env(tmp_path, fake_uv=fake_uv)
    # No marker, no env — should be canonical (exit 1).
    result = _run(env, cwd=tmp_path)
    assert result.returncode == 1, result.stdout + result.stderr

    # Now add the marker — should flip to dev-local (exit 0).
    venv = tmp_path / ".venv"
    venv.mkdir()
    (venv / ".dev-local").write_text("")
    result2 = _run(env, cwd=tmp_path)
    assert result2.returncode == 0, result2.stdout + result2.stderr


def test_uv_missing_entirely(tmp_path: Path) -> None:
    """If ``uv`` is not on PATH, detection still works via the other signals."""

    env = _base_env(tmp_path, fake_uv=None)
    result = _run(env, cwd=tmp_path)
    assert result.returncode == 1, result.stdout + result.stderr

    env["PD_DEV_LOCAL"] = "1"
    result2 = _run(env, cwd=tmp_path)
    assert result2.returncode == 0, result2.stdout + result2.stderr


@pytest.mark.parametrize("truthy", ["1", "true", "yes", "on", "TRUE"])
def test_env_var_accepts_common_truthy_values(tmp_path: Path, truthy: str) -> None:
    env = _base_env(tmp_path, fake_uv=None)
    env["PD_DEV_LOCAL"] = truthy
    result = _run(env, cwd=tmp_path)
    assert result.returncode == 0, f"{truthy!r}: {result.stdout + result.stderr}"
