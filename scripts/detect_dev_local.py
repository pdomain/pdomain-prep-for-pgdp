#!/usr/bin/env python3
"""Detect whether the current venv has an editable / dev-local install of
``pd-book-tools``.

Exit code:
    0 — dev-local detected (editable sibling install / marker file / env override).
    1 — canonical (no editable sibling).

Detection precedence (per ``docs/dev-local-upgrade-flow.md``):

1. ``uv pip show pd-book-tools`` reports an ``Editable project location:`` line.
2. Marker file at ``.venv/.dev-local`` exists.
3. Env var ``PD_DEV_LOCAL`` is set to a truthy value (``1``/``true``/``yes``/``on``).

The script is deliberately tolerant: failures from ``uv`` (missing binary,
non-zero exit) fall through to the marker + env checks rather than
crashing, so it's safe to run on machines where ``uv`` is uninstalled.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

_TRUTHY = {"1", "true", "yes", "on"}


def _uv_reports_editable() -> bool:
    uv = shutil.which("uv")
    if uv is None:
        return False
    try:
        result = subprocess.run(
            [uv, "pip", "show", "pd-book-tools"],
            capture_output=True,
            text=True,
            check=False,
            timeout=10,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    if result.returncode != 0:
        return False
    return any(line.lower().startswith("editable project location:") for line in result.stdout.splitlines())


def _marker_file_present() -> bool:
    return Path(".venv", ".dev-local").is_file()


def _env_override() -> bool:
    raw = os.environ.get("PD_DEV_LOCAL", "")
    return raw.strip().lower() in _TRUTHY


def main() -> int:
    if _uv_reports_editable():
        return 0
    if _marker_file_present():
        return 0
    if _env_override():
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
