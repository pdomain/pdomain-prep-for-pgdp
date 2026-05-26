"""Tests for §L1 step 3 — env passthrough so the running app learns its
bound `host:port`.

The bound port is decided in `__main__.py` BEFORE `uvicorn.run` (via
`_pick_port`). Once chosen, `__main__` exports it to the process env as
`PGDP_HOST` / `PGDP_PORT` so the child workers' `Settings()` picks up
the actual bound values rather than the configured defaults. This is
what `GET /api/server-info` reads.

Tests:
- Helper writes both keys with the right string types.
- A fresh `Settings()` after the helper runs reflects the exported values.
"""

from __future__ import annotations

import os

from pdomain_prep_for_pgdp.__main__ import _export_bound_env
from pdomain_prep_for_pgdp.settings import Settings


def test_export_bound_env_writes_host_and_port(monkeypatch) -> None:
    monkeypatch.delenv("PGDP_HOST", raising=False)
    monkeypatch.delenv("PGDP_PORT", raising=False)

    _export_bound_env("0.0.0.0", 9099)

    assert os.environ["PGDP_HOST"] == "0.0.0.0"
    # Env values are always strings; downstream Settings parses to int.
    assert os.environ["PGDP_PORT"] == "9099"


def test_settings_picks_up_exported_env(monkeypatch, tmp_path) -> None:
    """A child worker's `Settings()` reflects the exported bound values."""
    monkeypatch.delenv("PGDP_HOST", raising=False)
    monkeypatch.delenv("PGDP_PORT", raising=False)
    # Avoid .env file shadowing the test by chdir'ing somewhere clean.
    monkeypatch.chdir(tmp_path)

    _export_bound_env("127.0.0.1", 12345)

    s = Settings()
    assert s.host == "127.0.0.1"
    assert s.port == 12345
