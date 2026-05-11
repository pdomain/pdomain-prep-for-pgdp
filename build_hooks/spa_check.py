"""Hatchling build hook that fails the build when the SPA bundle is missing.

The wheel `force-include`s `src/pd_prep_for_pgdp/static/` so the published
distribution can serve the React SPA without Node at install time. If a
contributor runs ``uv build`` (or ``hatch build``, ``pip wheel .``, etc.)
without first running ``make frontend-build``, the hatchling
``force-include`` silently no-ops on the missing directory and the wheel
ends up shipping a blank app.

This hook closes that gap: it runs before the wheel artifacts are gathered
and raises a clear error pointing the user at ``make frontend-build``.

Wired in ``pyproject.toml`` as::

    [tool.hatch.build.hooks.custom]
    path = "build_hooks/spa_check.py"

The CI side of this guard lives in ``.github/workflows/release.yml`` (see
roadmap §22); this hook is the locally-runnable counterpart so the same
failure mode is caught regardless of how the wheel is produced.
"""

from __future__ import annotations

import os
from pathlib import Path

from hatchling.builders.hooks.plugin.interface import BuildHookInterface


class SpaBundleCheckHook(BuildHookInterface):
    """Refuse to build a wheel that wouldn't include the SPA bundle."""

    PLUGIN_NAME = "custom"

    # Path (relative to the project root) that must exist and be non-empty
    # for the wheel's force-include of ``src/pd_prep_for_pgdp/static`` to
    # actually ship the SPA.
    SPA_INDEX_REL = Path("src") / "pd_prep_for_pgdp" / "static" / "index.html"

    def initialize(self, version: str, build_data: dict) -> None:
        # Only enforce on the wheel target; sdists deliberately omit the
        # built SPA (it gets rebuilt by `make build` / CI).
        if self.target_name != "wheel":
            return

        # Editable installs (`uv pip install -e .`, `make refresh-version`,
        # `make install-local`) are dev-only and never published. The
        # editable wheel just maps the source dir, so the contributor can
        # `make frontend-build` later and the running app picks it up
        # without a reinstall. Skipping the SPA check here lets `make ci`
        # → `make setup` → editable rebuild succeed before
        # `make frontend-build` has had a chance to run.
        if version == "editable":
            return

        # Escape hatch for environments that intentionally build a wheel
        # without the SPA (e.g. publishing a "headless" wheel for tests).
        # Undocumented on purpose — the supported path is `make build`.
        if os.environ.get("PD_PREP_SKIP_SPA_CHECK") == "1":
            return

        index = Path(self.root) / self.SPA_INDEX_REL
        if not index.is_file() or index.stat().st_size == 0:
            raise RuntimeError(
                "pd-prep-for-pgdp: SPA bundle is missing — refusing to "
                f"build a wheel without {self.SPA_INDEX_REL}.\n"
                "Run `make frontend-build` first (or `make build`, which "
                "chains the frontend build before `uv build`).\n"
                "If you really want a wheel without the SPA, set "
                "PD_PREP_SKIP_SPA_CHECK=1."
            )
