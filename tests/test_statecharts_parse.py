"""Statechart YAML hygiene tests.

Every YAML file under docs/plans/design_handoff_pgdp_app/statecharts/ must:
  1. Parse successfully with yaml.safe_load (no mapping-value / scalar errors).
  2. Have a top-level ``machine`` key (the convention across all 31 files).
"""

from __future__ import annotations

import pathlib

import pytest
import yaml

_STATECHARTS_DIR = (
    pathlib.Path(__file__).parent.parent / "docs" / "plans" / "design_handoff_pgdp_app" / "statecharts"
)

_YAML_FILES = sorted(_STATECHARTS_DIR.glob("*.yaml"))


@pytest.mark.parametrize("yaml_path", _YAML_FILES, ids=lambda p: p.name)
def test_statechart_parses(yaml_path: pathlib.Path) -> None:
    """The file must parse as strict YAML without errors."""
    content = yaml_path.read_text(encoding="utf-8")
    # Should not raise yaml.YAMLError
    doc = yaml.safe_load(content)
    assert doc is not None, f"{yaml_path.name}: document is empty"


@pytest.mark.parametrize("yaml_path", _YAML_FILES, ids=lambda p: p.name)
def test_statechart_has_machine_key(yaml_path: pathlib.Path) -> None:
    """Every statechart must have a top-level ``machine`` key."""
    content = yaml_path.read_text(encoding="utf-8")
    try:
        doc = yaml.safe_load(content)
    except yaml.YAMLError:
        pytest.skip("File does not parse yet — fix parsing first")
    assert isinstance(doc, dict), f"{yaml_path.name}: top-level is not a mapping"
    assert "machine" in doc, (
        f"{yaml_path.name}: missing top-level 'machine' key; found keys: {list(doc.keys())[:5]}"
    )
