#!/usr/bin/env python3
"""Flip pd-* ``[tool.uv.sources]`` entries to each sibling's git ``master``.

Transient helper for ``ci-against-master.sh``. Pure text transform so it is
unit-testable; the orchestrator backs up and restores the file, so this never
needs to preserve formatting beyond producing valid TOML.
"""

from __future__ import annotations

import re
import sys
import tomllib


def flip_sources(text: str, owner: str, siblings: list[str]) -> str:
    """Return *text* with each sibling's uv source rewritten to git ``master``.

    Args:
        text: Full ``pyproject.toml`` contents.
        owner: GitHub org/owner (e.g. ``"pdomain"``).
        siblings: pd-* package names whose ``[tool.uv.sources]`` entry should
            be flipped from a registry index to ``{ git = ..., branch = "master" }``.

    Raises:
        ValueError: if a requested sibling has no ``[tool.uv.sources]`` entry.
    """
    for sib in siblings:
        pattern = re.compile(rf"(?m)^{re.escape(sib)}\s*=\s*\{{[^}}]*\}}\s*$")
        replacement = f'{sib} = {{ git = "https://github.com/{owner}/{sib}.git", branch = "master" }}'
        text, count = pattern.subn(replacement, text)
        if count == 0:
            raise ValueError(f"no [tool.uv.sources] entry found for {sib!r} to flip")
    tomllib.loads(text)  # fail loudly on invalid TOML
    return text


def _main(argv: list[str]) -> int:
    if len(argv) < 3:
        print(
            "usage: git_master_sources.py <pyproject.toml> <owner> <sibling>...",
            file=sys.stderr,
        )
        return 2
    path, owner, siblings = argv[0], argv[1], argv[2:]
    with open(path, encoding="utf-8") as fh:
        original = fh.read()
    flipped = flip_sources(original, owner, siblings)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(flipped)
    print(f"flipped {len(siblings)} pd-* source(s) to git master in {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(_main(sys.argv[1:]))
