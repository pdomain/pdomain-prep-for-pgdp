"""Console entry point: `pgdp-prep` (also `python -m pd_prep_for_pgdp`)."""

from __future__ import annotations

import argparse
import errno
import socket
import sys
import webbrowser
from pathlib import Path

import uvicorn

from .settings import Settings

LAST_PORT_FILENAME = "last-port"


def _read_last_port(config_dir: Path) -> int | None:
    """Read the persisted port from `<config_dir>/last-port`.

    Returns the port, or None if the file is missing, unreadable, or
    contains something that doesn't parse as a valid TCP port number.
    """
    path = config_dir / LAST_PORT_FILENAME
    try:
        raw = path.read_text(encoding="utf-8").strip()
    except (FileNotFoundError, OSError):
        return None
    try:
        port = int(raw)
    except ValueError:
        return None
    if port < 1 or port > 65535:
        return None
    return port


def _write_last_port(config_dir: Path, port: int) -> None:
    """Persist the bound port to `<config_dir>/last-port`.

    Best-effort: failures are swallowed because persistence is purely
    a UX optimisation — losing it just means the next start falls back
    to the configured default. Creates `config_dir` if missing.
    """
    try:
        config_dir.mkdir(parents=True, exist_ok=True)
        (config_dir / LAST_PORT_FILENAME).write_text(f"{port}\n", encoding="utf-8")
    except OSError:
        pass


def _parse_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(prog="pgdp-prep", description=__doc__)
    p.add_argument("--host", default=None, help="bind host (default 127.0.0.1)")
    p.add_argument("--port", type=int, default=None, help="bind port (default 8765)")
    p.add_argument("--reload", action="store_true", help="enable uvicorn auto-reload")
    p.add_argument(
        "--frontend-dev",
        default=None,
        metavar="URL",
        help="proxy unknown asset paths to a Vite dev server (e.g. http://localhost:5173)",
    )
    p.add_argument("--no-browser", action="store_true", help="don't open a browser tab on start")
    p.add_argument("--version", action="store_true", help="print version and exit")
    return p.parse_args(argv)


def _try_bind(host: str, port: int) -> bool:
    """Probe-bind `host:port`. Return True if free, False on EADDRINUSE.

    Other OSErrors (permission denied, invalid host, etc.) propagate.
    """
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            probe.bind((host, port))
        return True
    except OSError as e:
        if e.errno == errno.EADDRINUSE:
            return False
        raise


def _pick_port(
    host: str,
    preferred: int,
    *,
    explicit: bool,
    config_dir: Path | None = None,
) -> int:
    """Pick a bindable TCP port on `host`.

    Behavior (spec: docs/08-roadmap.md §L1):

      - If `explicit` is False and `config_dir` carries a `last-port`
        file naming a free port, return that port. Persists the same
        value back (so the file's mtime tracks the last successful
        start).
      - Otherwise try `preferred`. If free, return it.
      - If `preferred` is taken AND `explicit` is False, fall back to
        an OS-assigned free port (`bind(0)`) and log the substitution
        to stdout.
      - If `preferred` is taken AND `explicit` is True, re-raise the
        OSError — explicit intent is preserved, no silent fallback,
        and the persisted port is left untouched.

    On every successful bind (default or explicit), the chosen port
    is persisted to `<config_dir>/last-port` so the next start
    re-prefers it.

    The probe uses a real TCP listener — same syscall uvicorn will
    issue moments later. There is a tiny TOCTOU window between probe
    and uvicorn.run; that's acceptable for a local-dev affordance and
    matches the standard pattern (`socket.bind(0)` for ephemeral picks).
    """

    def _persist(port: int) -> None:
        if config_dir is not None:
            _write_last_port(config_dir, port)

    # Persisted port wins (default-mode only).
    if not explicit and config_dir is not None:
        last = _read_last_port(config_dir)
        if last is not None and _try_bind(host, last):
            _persist(last)
            return last

    # Try the preferred port.
    if _try_bind(host, preferred):
        _persist(preferred)
        return preferred

    # preferred is busy.
    if explicit:
        raise OSError(errno.EADDRINUSE, f"port {preferred} is in use")

    # Default-port collision: hand off to the kernel.
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind((host, 0))
        chosen = probe.getsockname()[1]
    print(
        f"Port {preferred} in use; falling back to OS-assigned port {chosen}.",
    )
    _persist(chosen)
    return chosen


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(sys.argv[1:] if argv is None else argv)

    if args.version:
        from . import __version__

        print(__version__)
        return 0

    settings = Settings()
    host = args.host or settings.host
    explicit_port = args.port is not None
    preferred_port = args.port or settings.port

    if args.frontend_dev:
        settings.frontend_dev_url = args.frontend_dev

    # --reload re-spawns the process; the child re-runs uvicorn.run and
    # would otherwise duplicate the probe (and could pick a different
    # ephemeral port on retry). Skip auto-select under --reload — the
    # user is in dev-loop mode and a hard error is more informative.
    port = (
        preferred_port
        if args.reload
        else _pick_port(
            host,
            preferred_port,
            explicit=explicit_port,
            config_dir=settings.config_dir,
        )
    )

    url = f"http://{host}:{port}"
    print(f"Listening on {url}")

    if not args.no_browser and not args.reload:
        try:
            webbrowser.open(url, new=1)
        except Exception:
            pass

    uvicorn.run(
        "pd_prep_for_pgdp.bootstrap:build_app",
        host=host,
        port=port,
        reload=args.reload,
        factory=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
