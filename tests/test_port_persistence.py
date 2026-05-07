"""Tests for L1 step 2 — `last-port` persistence.

Spec (docs/08-roadmap.md §L1 sub-point 1):

  - On every successful bind, the bound port is written to a small
    state file (`<config_dir>/last-port`) so the next start can
    re-prefer it.
  - On startup, if `last-port` exists and names a free port, that wins
    over the configured default.
  - If `last-port` is missing or names a busy port, fall through:
    default-port → port=0.
  - Explicit `--port N` does NOT read the persistence file (intent
    must override history) but DOES write on success so subsequent
    default-mode starts pick it up.

The functions under test are pure: `read_last_port(config_dir)` and
`write_last_port(config_dir, port)`. The picker calls them at the
right times; main wires `Settings.config_dir` in.
"""

from __future__ import annotations

import socket
from contextlib import closing
from pathlib import Path

import pytest

from pd_prep_for_pgdp.__main__ import (
    _pick_port,
    _read_last_port,
    _write_last_port,
)


def _bind_blocker(port: int = 0) -> socket.socket:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 0)
    s.bind(("127.0.0.1", port))
    s.listen(1)
    return s


# ── Pure read/write helpers ──────────────────────────────────────────


def test_write_then_read_roundtrip(tmp_path: Path) -> None:
    _write_last_port(tmp_path, 12345)
    assert _read_last_port(tmp_path) == 12345


def test_read_returns_none_when_missing(tmp_path: Path) -> None:
    assert _read_last_port(tmp_path) is None


def test_read_returns_none_on_garbage(tmp_path: Path) -> None:
    (tmp_path / "last-port").write_text("not-a-port", encoding="utf-8")
    assert _read_last_port(tmp_path) is None


def test_read_returns_none_on_out_of_range(tmp_path: Path) -> None:
    (tmp_path / "last-port").write_text("99999999", encoding="utf-8")
    assert _read_last_port(tmp_path) is None


def test_write_creates_parent_dir(tmp_path: Path) -> None:
    """`config_dir` may not exist on first run."""
    target = tmp_path / "deeply" / "nested" / "config"
    _write_last_port(target, 12345)
    assert (target / "last-port").read_text().strip() == "12345"


# ── Picker integration ───────────────────────────────────────────────


def test_picker_prefers_persisted_over_default(tmp_path: Path) -> None:
    """When `last-port` names a free port, picker returns it instead
    of the configured default."""
    with closing(_bind_blocker(0)) as probe:
        free_port = probe.getsockname()[1]
    _write_last_port(tmp_path, free_port)

    # Default 8765 may or may not be free; the picker must return
    # the persisted port either way.
    chosen = _pick_port("127.0.0.1", 8765, explicit=False, config_dir=tmp_path)
    assert chosen == free_port


def test_picker_falls_through_when_persisted_busy(tmp_path: Path) -> None:
    """If `last-port` names a busy port, picker falls through to the
    configured default (which we also make busy here, so it cascades
    to port=0)."""
    busy = _bind_blocker(0)
    busy_port = busy.getsockname()[1]
    _write_last_port(tmp_path, busy_port)

    busy2 = _bind_blocker(0)
    busy2_port = busy2.getsockname()[1]
    try:
        chosen = _pick_port("127.0.0.1", busy2_port, explicit=False, config_dir=tmp_path)
    finally:
        busy.close()
        busy2.close()

    assert chosen != busy_port
    assert chosen != busy2_port
    assert chosen > 0


def test_picker_writes_persisted_on_success(tmp_path: Path) -> None:
    """Every successful pick writes the bound port back to last-port."""
    with closing(_bind_blocker(0)) as probe:
        free_port = probe.getsockname()[1]

    chosen = _pick_port("127.0.0.1", free_port, explicit=False, config_dir=tmp_path)
    assert chosen == free_port
    assert _read_last_port(tmp_path) == free_port


def test_picker_writes_persisted_after_fallback(tmp_path: Path) -> None:
    """Even when the preferred port was busy and we fell through to
    port=0, the OS-chosen port should be persisted."""
    blocker = _bind_blocker(0)
    busy_port = blocker.getsockname()[1]
    try:
        chosen = _pick_port("127.0.0.1", busy_port, explicit=False, config_dir=tmp_path)
    finally:
        blocker.close()

    assert _read_last_port(tmp_path) == chosen


def test_picker_explicit_ignores_persisted(tmp_path: Path) -> None:
    """`--port N` ignores `last-port` entirely (intent overrides history)."""
    # Persist a free port that is NOT the explicit one.
    with closing(_bind_blocker(0)) as probe:
        persisted_port = probe.getsockname()[1]
    _write_last_port(tmp_path, persisted_port)

    with closing(_bind_blocker(0)) as probe:
        explicit_port = probe.getsockname()[1]

    chosen = _pick_port("127.0.0.1", explicit_port, explicit=True, config_dir=tmp_path)
    assert chosen == explicit_port  # not persisted_port
    # And explicit-success rewrites last-port to the explicit choice.
    assert _read_last_port(tmp_path) == explicit_port


def test_picker_explicit_collision_does_not_overwrite_persisted(
    tmp_path: Path,
) -> None:
    """Failed binds must not corrupt the persisted port."""
    _write_last_port(tmp_path, 54321)
    blocker = _bind_blocker(0)
    busy_port = blocker.getsockname()[1]
    try:
        with pytest.raises(OSError):
            _pick_port("127.0.0.1", busy_port, explicit=True, config_dir=tmp_path)
    finally:
        blocker.close()
    assert _read_last_port(tmp_path) == 54321
