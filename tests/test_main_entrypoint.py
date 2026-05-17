"""Smoke tests for the `pgdp-prep` console entry point.

We can't actually run uvicorn from the test process, but we can:
  - cover `_parse_args` for the visible flags,
  - cover the `--version` short-circuit (returns 0 without booting uvicorn),
  - cover `_parse_args` defaults.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from pd_prep_for_pgdp.__main__ import _parse_args, main

if TYPE_CHECKING:
    import pytest


def test_parse_args_defaults() -> None:
    args = _parse_args([])
    assert args.host is None
    assert args.port is None
    assert args.reload is False
    assert args.frontend_dev is None
    assert args.no_browser is False
    assert args.version is False


def test_parse_args_explicit_flags() -> None:
    args = _parse_args(
        [
            "--host",
            "0.0.0.0",
            "--port",
            "9000",
            "--reload",
            "--frontend-dev",
            "http://localhost:5173",
            "--no-browser",
        ]
    )
    assert args.host == "0.0.0.0"
    assert args.port == 9000
    assert args.reload is True
    assert args.frontend_dev == "http://localhost:5173"
    assert args.no_browser is True


def test_main_version_flag_prints_and_exits(capsys: pytest.CaptureFixture[str]) -> None:
    """`pgdp-prep --version` prints the version and returns 0 without
    booting uvicorn."""
    rc = main(["--version"])
    assert rc == 0
    out = capsys.readouterr().out.strip()
    # Version is whatever hatch-vcs derived; just assert it's not empty.
    assert out != ""
