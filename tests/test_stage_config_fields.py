"""Integration test: STAGE_CONFIG_FIELDS consistency.

Acceptance criterion from issue #65:
  "Integration test catches a mismatch between declared read_fields and
  actual reads."

Two checks:
1. Every field in STAGE_CONFIG_FIELDS is a valid PageConfigOverrides field
   name (no typos, no stale names after a rename).

2. Source-code inspection: for each stage with a real CPU impl, any
   PageConfigOverrides field accessed as `cfg.<field>` in the impl must be
   declared in STAGE_CONFIG_FIELDS. An undeclared access means
   cascade_dirty_for_config_change will silently miss marking the stage
   dirty when that field changes.

   Note: the converse direction (declared but not yet accessed) is
   intentionally NOT checked here — many stages have aspirational
   declarations for future cfg plumbing (see M2/M3 stubs).
"""

from __future__ import annotations

import inspect
import re

from pd_prep_for_pgdp.core.models import PageConfigOverrides
from pd_prep_for_pgdp.core.pipeline.stage_registry import _REAL_CPU_IMPLS
from pd_prep_for_pgdp.core.pipeline.stage_runner import STAGE_CONFIG_FIELDS


def test_stage_config_fields_are_valid_overrides_field_names() -> None:
    """All declared fields exist on PageConfigOverrides (no typos / renames)."""
    valid = set(PageConfigOverrides.model_fields.keys())
    for stage_id, fields in STAGE_CONFIG_FIELDS.items():
        for field in fields:
            assert field in valid, (
                f"STAGE_CONFIG_FIELDS[{stage_id!r}] declares {field!r} "
                f"but PageConfigOverrides has no such field. "
                f"Valid fields: {sorted(valid)}"
            )


def test_no_undeclared_config_field_accesses_in_stage_impls() -> None:
    """cfg.<field> accesses in impl source must be declared in STAGE_CONFIG_FIELDS.

    An undeclared access means cascade_dirty_for_config_change will miss
    dirtying this stage when that field changes — a silent staleness bug.

    Only PageConfigOverrides fields are checked; ResolvedPageConfig-only
    fields (ocr_engine, page_h_w_ratio, etc.) are not per-page overrideable
    so they're out of scope for cascade-dirty logic.
    """
    valid_overrides = set(PageConfigOverrides.model_fields.keys())
    for stage_id, impl in _REAL_CPU_IMPLS.items():
        source = inspect.getsource(impl)
        accessed = set(re.findall(r"\bcfg\.(\w+)", source))
        relevant_accesses = accessed & valid_overrides
        declared = STAGE_CONFIG_FIELDS.get(stage_id, frozenset())
        undeclared = relevant_accesses - declared
        assert not undeclared, (
            f"Stage {stage_id!r} accesses cfg.{undeclared} "
            f"but those fields are not in STAGE_CONFIG_FIELDS[{stage_id!r}]. "
            f"Add them so cascade_dirty_for_config_change marks the stage dirty "
            f"when those fields change. Declared: {sorted(declared)}"
        )
