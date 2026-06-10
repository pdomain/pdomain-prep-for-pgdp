#!/usr/bin/env python3
"""Verify that every statechart YAML under docs/plans/design_handoff_pgdp_app/statecharts/
parses as strict YAML and has the expected top-level ``machine`` key.

Usage:
    python scripts/check_statecharts.py
    # or from Makefile / CI:
    uv run python scripts/check_statecharts.py

Exit codes:
    0 — all files OK
    1 — one or more files failed to parse or are missing the ``machine`` key
"""

from __future__ import annotations

import pathlib
import sys

import yaml

_STATECHARTS_DIR = (
    pathlib.Path(__file__).parent.parent / "docs" / "plans" / "design_handoff_pgdp_app" / "statecharts"
)


def main() -> int:
    yaml_files = sorted(_STATECHARTS_DIR.glob("*.yaml"))
    if not yaml_files:
        print(f"ERROR: no YAML files found under {_STATECHARTS_DIR}", file=sys.stderr)
        return 1

    failures: list[str] = []

    for path in yaml_files:
        content = path.read_text(encoding="utf-8")
        try:
            doc = yaml.safe_load(content)
        except yaml.YAMLError as exc:
            msg = str(exc).splitlines()[0]
            failures.append(f"{path.name}: YAML parse error — {msg}")
            continue

        if not isinstance(doc, dict):
            failures.append(f"{path.name}: top-level is not a mapping (got {type(doc).__name__})")
            continue

        if "machine" not in doc:
            top_keys = list(doc.keys())[:5]
            failures.append(f"{path.name}: missing top-level 'machine' key; found: {top_keys}")

    if failures:
        print(f"check_statecharts: {len(failures)} failure(s):", file=sys.stderr)
        for msg in failures:
            print(f"  {msg}", file=sys.stderr)
        return 1

    print(f"check_statecharts: {len(yaml_files)} files OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
