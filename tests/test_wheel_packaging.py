"""Packaging regression tests for pdomain-prep-for-pgdp.

These assert invariants about how the project is *packaged*, not about the
running app.

Regression guard for the built frontend SPA: hatchling only ships files from
``src/pdomain_prep_for_pgdp/static/`` if that directory is explicitly
included via the ``artifacts`` field in the global ``[tool.hatch.build]``
section. Without the global entry the sdist silently omits the built SPA,
and any wheel built from that sdist ships 0 static files (HTTP 503 on every
page load after ``uv tool install``).

The RELEASE BUILD PATH:
  1. ``make build`` runs ``frontend-build`` (vite), then ``uv build --sdist``
     and ``uv build --wheel`` (both from the git source tree).
  2. The default ``uv build`` (without explicit flags) builds the sdist from
     source and then builds the wheel *from the sdist* in a temporary non-git
     directory. That pipeline is also tested here (``test_wheel_from_sdist_*``).

The failure mode (wheel-only ``force-include``, no global ``artifacts``):
  - Local ``uv build --wheel`` produced static files in wheel (passes locally).
  - ``uv build`` (default, sdist-then-wheel-from-sdist) produced 0 static
    files (fails on the ``uv tool install`` release path).

This file exercises both build paths to catch regressions early.
"""

from __future__ import annotations

import subprocess
import tarfile
import zipfile
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
PACKAGE_DIR = REPO_ROOT / "src" / "pdomain_prep_for_pgdp"
STATIC_SRC = PACKAGE_DIR / "static"

# Minimum number of static assets expected in a full build.
# A fresh ``make frontend-build`` produces ~79 files (index.html + .gitkeep +
# ~77 asset files). Use a conservative floor so the assertion does not break
# on minor font/chunk count changes, but large enough to catch "zero files"
# or "one file only" regressions.
MIN_STATIC_FILE_COUNT = 40


def _require_frontend(test_name: str) -> None:
    """Skip *test_name* when the frontend has not been built yet."""
    if not (STATIC_SRC / "index.html").exists():
        pytest.skip(
            f"{test_name}: static/index.html not present -- "
            "run `make frontend-build` first. "
            "This test is skipped in pure-Python CI runs without a prior build step."
        )


def _count_static_in_wheel(wheel_path: Path) -> tuple[int, bool]:
    """Return (static_file_count, has_index_html) for *wheel_path*."""
    with zipfile.ZipFile(wheel_path) as zf:
        names = zf.namelist()
    static = [n for n in names if "pdomain_prep_for_pgdp/static/" in n]
    has_index = any(n.endswith("pdomain_prep_for_pgdp/static/index.html") for n in names)
    return len(static), has_index


def _count_static_in_sdist(sdist_path: Path) -> tuple[int, bool]:
    """Return (static_file_count_in_src_subdir, has_index_html) for *sdist_path*.

    Only counts files under ``src/pdomain_prep_for_pgdp/static/`` (the built
    SPA), not the frontend source tree.
    """
    with tarfile.open(sdist_path) as tf:
        members = tf.getnames()
    static = [m for m in members if "src/pdomain_prep_for_pgdp/static/" in m]
    has_index = any(m.endswith("src/pdomain_prep_for_pgdp/static/index.html") for m in members)
    return len(static), has_index


# ---------------------------------------------------------------------------
# Static / config checks (always run, no frontend required)
# ---------------------------------------------------------------------------


def test_pyproject_global_artifacts_includes_static() -> None:
    """``pyproject.toml`` must declare a GLOBAL ``artifacts`` covering the static dir.

    This lightweight static check catches a misconfiguration before a wheel
    build is attempted. If the global artifacts entry is absent, hatchling
    silently omits the gitignored static/ directory when building the sdist,
    and any wheel built from that sdist (the ``uv build`` default path) ships
    with 0 static files — users see HTTP 503 on every page load.

    Per-target ``force-include`` alone is NOT sufficient: hatchling builds
    the wheel in a non-git temp dir from the sdist, and per-target includes
    do not carry into that path.
    """
    pyproject = (REPO_ROOT / "pyproject.toml").read_text(encoding="utf-8")
    assert "[tool.hatch.build]" in pyproject, (
        "pyproject.toml must have a GLOBAL [tool.hatch.build] table with "
        "`artifacts` so the gitignored static/ build output ships in the "
        "wheel. Without it, the wheel-from-sdist path produces a 503-only app."
    )
    assert "artifacts" in pyproject, (
        "pyproject.toml must declare `artifacts` in [tool.hatch.build] (global) "
        "so the gitignored static/ build output ships in the wheel. "
        "Without it every `uv tool install` produces a 503-only app."
    )
    assert "pdomain_prep_for_pgdp/static" in pyproject, (
        "pyproject.toml artifacts glob must cover src/pdomain_prep_for_pgdp/static/** so the built SPA ships."
    )


def test_makefile_build_uses_explicit_sdist_and_wheel() -> None:
    """The ``build`` Makefile target must build sdist and wheel separately from source.

    ``uv build`` (default, without explicit flags) builds the wheel *from the
    sdist* in a temporary non-git directory. If the sdist or wheel configuration
    is incorrect the frontend is silently dropped. Building both artifacts
    explicitly from the source tree (``uv build --sdist`` then
    ``uv build --wheel``) eliminates this failure mode.
    """
    makefile = (REPO_ROOT / "Makefile").read_text(encoding="utf-8")
    assert "uv build --sdist" in makefile and "uv build --wheel" in makefile, (
        "Makefile `build` target must run `uv build --sdist` and `uv build --wheel` "
        "as separate explicit commands (not bare `uv build`). "
        "Bare `uv build` builds the wheel from the sdist in a temp non-git dir, "
        "which can silently drop the gitignored static/ even when global `artifacts` "
        "is not configured."
    )


# ---------------------------------------------------------------------------
# Release-path artifact checks (require frontend to be built; marked slow)
# ---------------------------------------------------------------------------


@pytest.mark.slow
def test_wheel_from_source_contains_static(tmp_path: Path) -> None:
    """Building the wheel directly from the source tree must include the static dir.

    This mirrors ``uv build --wheel`` (wheel from source, not from sdist).
    """
    _require_frontend("test_wheel_from_source_contains_static")

    wheel_dir = tmp_path / "wheel-from-source"
    wheel_dir.mkdir()
    result = subprocess.run(
        ["uv", "build", "--wheel", "--out-dir", str(wheel_dir)],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, (
        f"uv build --wheel failed:\nstdout:\n{result.stdout}\nstderr:\n{result.stderr}"
    )

    wheels = sorted(wheel_dir.glob("pdomain_prep_for_pgdp-*.whl"))
    assert wheels, f"no wheel produced in {wheel_dir}"
    count, has_index = _count_static_in_wheel(wheels[-1])

    assert has_index, (
        "pdomain_prep_for_pgdp/static/index.html is missing from the wheel "
        "built directly from source. "
        f"Static files found: {count}. "
        "Check the global `artifacts` in pyproject.toml."
    )
    assert count >= MIN_STATIC_FILE_COUNT, (
        f"Only {count} static files in the wheel (expected >= {MIN_STATIC_FILE_COUNT}). "
        "The full SPA should contain index.html + manifest + assets. "
        "Check the global `artifacts` in pyproject.toml."
    )


@pytest.mark.slow
def test_sdist_contains_built_static(tmp_path: Path) -> None:
    """The sdist must include the built frontend SPA under src/pdomain_prep_for_pgdp/static/.

    Without the static dir in the sdist, ``uv build`` (default) produces a wheel
    from an sdist that has no static files, causing HTTP 503 on install.
    """
    _require_frontend("test_sdist_contains_built_static")

    sdist_dir = tmp_path / "sdist"
    sdist_dir.mkdir()
    result = subprocess.run(
        ["uv", "build", "--sdist", "--out-dir", str(sdist_dir)],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, (
        f"uv build --sdist failed:\nstdout:\n{result.stdout}\nstderr:\n{result.stderr}"
    )

    sdists = sorted(sdist_dir.glob("pdomain_prep_for_pgdp-*.tar.gz"))
    assert sdists, f"no sdist produced in {sdist_dir}"
    count, has_index = _count_static_in_sdist(sdists[-1])

    assert has_index, (
        "src/pdomain_prep_for_pgdp/static/index.html is missing from the sdist. "
        f"Static files found: {count}. "
        "The sdist must include the built SPA so that wheel-from-sdist pipelines "
        "can include the static files. Check [tool.hatch.build] artifacts in pyproject.toml."
    )
    assert count >= MIN_STATIC_FILE_COUNT, (
        f"Only {count} static files in the sdist (expected >= {MIN_STATIC_FILE_COUNT}). "
        "Check [tool.hatch.build] artifacts in pyproject.toml."
    )


@pytest.mark.slow
def test_wheel_from_sdist_contains_static(tmp_path: Path) -> None:
    """Building the wheel from an unpacked sdist (non-git dir) must include static files.

    This is the wheel-from-sdist path: extracts the sdist to a directory with
    no ``.git`` and builds the wheel from there. This faithfully reproduces what
    ``uv build`` (default) does internally, and what the CI runner would do if
    ``make build`` used bare ``uv build`` instead of explicit ``--sdist`` /
    ``--wheel`` flags.

    The historical failure mode: wheel-only ``force-include`` (no global
    ``artifacts``) passed locally but produced 0 static files on the
    wheel-from-sdist path (same as the CI release wheel path).
    """
    _require_frontend("test_wheel_from_sdist_contains_static")

    # Step 1: Build the sdist.
    sdist_dir = tmp_path / "sdist"
    sdist_dir.mkdir()
    result = subprocess.run(
        ["uv", "build", "--sdist", "--out-dir", str(sdist_dir)],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, f"sdist build failed:\nstdout:\n{result.stdout}\nstderr:\n{result.stderr}"
    sdists = sorted(sdist_dir.glob("pdomain_prep_for_pgdp-*.tar.gz"))
    assert sdists, f"no sdist produced in {sdist_dir}"

    # Step 2: Unpack the sdist into a fresh directory (no .git).
    unpack_dir = tmp_path / "sdist-unpacked"
    unpack_dir.mkdir()
    with tarfile.open(sdists[-1]) as tf:
        tf.extractall(unpack_dir)  # noqa: S202

    unpacked = sorted(unpack_dir.iterdir())
    assert unpacked, f"sdist extracted nothing into {unpack_dir}"
    sdist_root = unpacked[0]
    assert not (sdist_root / ".git").exists(), (
        "Unpacked sdist must NOT have a .git directory -- this simulates the "
        "non-git environment used by the CI wheel-from-sdist pipeline."
    )

    # Step 3: Build the wheel from the unpacked sdist (non-git environment).
    wheel_dir = tmp_path / "wheel-from-sdist"
    wheel_dir.mkdir()
    result = subprocess.run(
        ["uv", "build", "--wheel", "--out-dir", str(wheel_dir), str(sdist_root)],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, (
        f"wheel-from-sdist build failed:\nstdout:\n{result.stdout}\nstderr:\n{result.stderr}"
    )
    wheels = sorted(wheel_dir.glob("pdomain_prep_for_pgdp-*.whl"))
    assert wheels, f"no wheel produced in {wheel_dir}"
    count, has_index = _count_static_in_wheel(wheels[-1])

    assert has_index, (
        "pdomain_prep_for_pgdp/static/index.html is missing from the wheel "
        "built from the unpacked sdist (non-git directory). "
        "This is the historical CI release failure mode. "
        f"Static files found: {count}. "
        "Fix: add `artifacts` to GLOBAL [tool.hatch.build] AND use "
        "`uv build --sdist` + `uv build --wheel` in the Makefile build target."
    )
    assert count >= MIN_STATIC_FILE_COUNT, (
        f"Only {count} static files in the wheel-from-sdist "
        f"(expected >= {MIN_STATIC_FILE_COUNT}). "
        "This is the historical CI release failure mode."
    )


@pytest.mark.slow
def test_full_release_build_both_artifacts(tmp_path: Path) -> None:
    """The release build must produce a complete wheel and sdist (both with static files).

    Exercises the same sequence as the CI release workflow:
    1. frontend already built (``make frontend-build`` prerequisite)
    2. ``uv build --sdist`` then ``uv build --wheel`` from source

    Both artifacts must contain the full static dir.
    """
    _require_frontend("test_full_release_build_both_artifacts")

    out_dir = tmp_path / "release-out"
    out_dir.mkdir()

    # Build sdist and wheel from source (same as make build target).
    for flag in ("--sdist", "--wheel"):
        result = subprocess.run(
            ["uv", "build", flag, "--out-dir", str(out_dir)],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        assert result.returncode == 0, (
            f"uv build {flag} failed:\nstdout:\n{result.stdout}\nstderr:\n{result.stderr}"
        )

    wheels = sorted(out_dir.glob("pdomain_prep_for_pgdp-*.whl"))
    sdists = sorted(out_dir.glob("pdomain_prep_for_pgdp-*.tar.gz"))
    assert len(wheels) == 1, f"expected exactly one wheel, got: {wheels}"
    assert len(sdists) == 1, f"expected exactly one sdist, got: {sdists}"

    whl_count, whl_has_index = _count_static_in_wheel(wheels[0])
    sdist_count, sdist_has_index = _count_static_in_sdist(sdists[0])

    assert whl_has_index, (
        "static/index.html missing from wheel. "
        f"Wheel static files: {whl_count}. "
        "Check global `artifacts` in pyproject.toml."
    )
    assert whl_count >= MIN_STATIC_FILE_COUNT, (
        f"Wheel has only {whl_count} static files (expected >= {MIN_STATIC_FILE_COUNT})."
    )
    assert sdist_has_index, (
        "static/index.html missing from sdist under src/pdomain_prep_for_pgdp/static/. "
        f"Sdist static files: {sdist_count}. "
        "Check global `artifacts` in pyproject.toml."
    )
    assert sdist_count >= MIN_STATIC_FILE_COUNT, (
        f"Sdist has only {sdist_count} static files (expected >= {MIN_STATIC_FILE_COUNT})."
    )
