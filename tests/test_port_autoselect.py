"""Tests for L1 — local-mode port auto-select fallback (`_pick_port`).

Spec (docs/08-roadmap.md §L1):

  1. Try the configured default port first.
  2. If EADDRINUSE, fall back to an OS-assigned free port (port=0).
  3. If the user passed `--port N` explicitly, do NOT fall back —
     raise / surface the collision so explicit intent is preserved.

The picker returns the bound port number; the caller is responsible
for then handing it to uvicorn. We probe with a real TCP socket on
127.0.0.1 because that's exactly what uvicorn will do, and on Linux
this is a sub-millisecond syscall — no fixtures, no mocks.
"""

from __future__ import annotations

import socket
from contextlib import closing

import pytest

from pd_prep_for_pgdp.__main__ import _pick_port


def _bind_blocker(port: int = 0) -> socket.socket:
    """Bind 127.0.0.1:`port` and return the holding socket."""
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 0)
    s.bind(("127.0.0.1", port))
    s.listen(1)
    return s


def test_default_port_free_returns_default() -> None:
    """When the preferred port is free, it's returned as-is."""
    # Reserve a known-free port by binding port=0, reading the kernel's
    # pick, then closing — the port is almost-certainly still free a few
    # microseconds later (the kernel won't immediately recycle it).
    with closing(_bind_blocker(0)) as probe:
        free_port = probe.getsockname()[1]

    chosen = _pick_port("127.0.0.1", free_port, explicit=False)
    assert chosen == free_port


def test_default_port_taken_falls_back_to_os_assigned(
    capsys: pytest.CaptureFixture[str],
) -> None:
    """When the preferred port is busy and the user didn't ask for it
    explicitly, the picker returns an OS-assigned free port and logs
    the substitution."""
    blocker = _bind_blocker(0)
    busy_port = blocker.getsockname()[1]
    try:
        chosen = _pick_port("127.0.0.1", busy_port, explicit=False)
    finally:
        blocker.close()

    assert chosen != busy_port
    assert chosen > 0
    out = capsys.readouterr().out
    assert str(busy_port) in out  # mentions the busy port
    assert "in use" in out.lower() or "fall" in out.lower()


def test_explicit_port_collision_raises() -> None:
    """`--port N` is honored exactly: collision should NOT fall back."""
    blocker = _bind_blocker(0)
    busy_port = blocker.getsockname()[1]
    try:
        with pytest.raises(OSError):
            _pick_port("127.0.0.1", busy_port, explicit=True)
    finally:
        blocker.close()


def test_explicit_port_free_returns_it() -> None:
    """`--port N` on a free port returns N."""
    with closing(_bind_blocker(0)) as probe:
        free_port = probe.getsockname()[1]

    chosen = _pick_port("127.0.0.1", free_port, explicit=True)
    assert chosen == free_port
