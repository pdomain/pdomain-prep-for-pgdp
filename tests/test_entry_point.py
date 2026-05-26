"""Smoke tests for `pgdp-prep` entry point.

Locks in:
  - `--version` exits 0 with a version line,
  - `--help` exits 0 and lists the spec-09 flags (--host, --port, --reload,
    --frontend-dev, --no-browser).

The entry point is what `uv tool install` puts on PATH; spec 09 §"Local"
treats this as the user-facing surface of the wheel.
"""

from __future__ import annotations

import pytest


def test_version_prints_and_exits_zero(capsys: pytest.CaptureFixture[str]) -> None:
    from pdomain_prep_for_pgdp.__main__ import main

    rc = main(["--version"])
    assert rc == 0
    out = capsys.readouterr().out.strip()
    assert out  # something printed
    # The hatch-vcs default in unbuilt mode is "0.0.0+unknown"; in built mode
    # it's a real semver. Either way, it's a single line of non-whitespace.
    assert "\n" not in out


def test_help_exits_zero_and_lists_spec_flags(
    capsys: pytest.CaptureFixture[str],
) -> None:
    from pdomain_prep_for_pgdp.__main__ import main

    with pytest.raises(SystemExit) as exc:
        main(["--help"])
    # argparse's --help raises SystemExit(0).
    assert exc.value.code == 0
    out = capsys.readouterr().out
    for flag in ("--host", "--port", "--reload", "--frontend-dev", "--no-browser"):
        assert flag in out, f"--help should mention {flag}"
