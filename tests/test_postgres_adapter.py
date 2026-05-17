"""Tests for `adapters.database.postgres.PostgresDatabase`.

This is the scaffolding-pass test suite for P0 #2:

* When the ``[postgres]`` extra is **not** installed (the default dev
  venv until the extra is opted into), `bootstrap.build_database` must
  surface a clear RuntimeError pointing at the extra — never a raw
  ImportError or a misleading "module not found" trace.
* When psycopg **is** importable, the class enforces URL-shape
  validation eagerly (mirrors `SqliteDatabase`'s constructor guard) and
  short-circuits empty `put_pages` without requiring a connection.

Live-Postgres integration tests (CRUD round-trips, the full IDatabase
contract parametrised over sqlite | postgres) come in a follow-up slice
once a postgres service is wired into the dev container or CI.
"""

from __future__ import annotations

import importlib
import sys

import pytest

from pd_prep_for_pgdp.bootstrap import build_database
from pd_prep_for_pgdp.settings import Settings


def _settings(tmp_path, **overrides) -> Settings:
    base = {
        "host": "127.0.0.1",
        "port": 8765,
        "data_root": tmp_path / "data",
        "config_dir": tmp_path / "config",
        "storage_backend": "filesystem",
        "database_url": f"sqlite:///{(tmp_path / 's.db').as_posix()}",
        "gpu_backend": "cpu",
        "dispatch_interval_seconds": 0,
        "auth_mode": "none",
    }
    base.update(overrides)
    return Settings(**base)


# ── bootstrap surfaces a friendly error when [postgres] is missing ─────────


def test_build_database_postgres_extra_missing_raises_runtime_error(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """If `import psycopg` (or its transitive deps) fails, bootstrap must
    raise a RuntimeError that names the [postgres] extra. Without this,
    a user with a postgres URL but no extra installed gets a bare
    ImportError that doesn't tell them how to fix it.

    We force the failure mode by intercepting __import__ for the
    `pd_prep_for_pgdp.adapters.database.postgres` module so we don't
    need to manipulate the venv.
    """
    # Drop any previously imported postgres module so the next import
    # actually goes through __import__ and our patched loader fires.
    monkeypatch.delitem(sys.modules, "pd_prep_for_pgdp.adapters.database.postgres", raising=False)

    real_import = __builtins__["__import__"] if isinstance(__builtins__, dict) else __builtins__.__import__

    def block_postgres_module(name, globals=None, locals=None, fromlist=(), level=0):
        if name == "pd_prep_for_pgdp.adapters.database.postgres" or (
            fromlist and "PostgresDatabase" in fromlist and name.endswith("postgres")
        ):
            raise ImportError("simulated: psycopg not installed")
        return real_import(name, globals, locals, fromlist, level)

    import builtins

    monkeypatch.setattr(builtins, "__import__", block_postgres_module)

    settings = _settings(tmp_path, database_url="postgres://user@localhost/db")
    with pytest.raises(RuntimeError, match=r"\[postgres\] extra"):
        build_database(settings)


# ── direct-class checks (skip when psycopg unavailable) ────────────────────


@pytest.fixture
def postgres_module():
    """Load the postgres adapter module, skipping if psycopg is absent.

    Using `importorskip` on the adapter module (not just `psycopg`) gives
    a single skip point for everything below.
    """
    try:
        return importlib.import_module("pd_prep_for_pgdp.adapters.database.postgres")
    except ImportError as e:
        pytest.skip(f"[postgres] extra not installed: {e}")


def test_constructor_rejects_unrecognised_url(postgres_module) -> None:
    """Mirror of `test_sqlite_adapter.test_constructor_rejects_unrecognised_url`:
    bad URL fails fast with ValueError, before the connection attempt."""
    with pytest.raises(ValueError, match="unrecognised Postgres URL"):
        postgres_module.PostgresDatabase("sqlite:///nope")


def test_constructor_accepts_postgres_and_postgresql_schemes(postgres_module) -> None:
    """Both `postgres://` and `postgresql://` are valid URL prefixes —
    psycopg treats them as equivalent and we shouldn't reject either."""
    # No connection attempt happens until initialize(); construction is pure.
    postgres_module.PostgresDatabase("postgres://u@h/db")
    postgres_module.PostgresDatabase("postgresql://u@h/db")


@pytest.mark.asyncio
async def test_put_pages_empty_list_is_noop(postgres_module) -> None:
    """`put_pages([])` short-circuits before requiring a connection.
    Mirrors the SQLite contract — the assign-prefixes loop relies on this
    when no pages changed."""
    db = postgres_module.PostgresDatabase("postgres://u@h/db")
    # Should NOT raise — no initialize() call, no live connection.
    await db.put_pages([])
