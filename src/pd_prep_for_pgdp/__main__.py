"""Console entry point: `pgdp-prep` (also `python -m pd_prep_for_pgdp`)."""

from __future__ import annotations

import argparse
import errno
import socket
import sys
import webbrowser

import uvicorn

from .settings import Settings


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


def _pick_port(host: str, preferred: int, *, explicit: bool) -> int:
    """Pick a bindable TCP port on `host`.

    Behavior (spec: docs/08-roadmap.md §L1):

      - Try `preferred` first. If free, return it.
      - If `preferred` is taken AND `explicit` is False (i.e. the user
        accepted the default), fall back to an OS-assigned free port and
        log the substitution to stdout. Returns the OS-chosen port.
      - If `preferred` is taken AND `explicit` is True (user passed
        `--port N`), re-raise the OSError. Explicit intent is preserved;
        no silent fallback.

    The probe uses a real TCP listener — same syscall uvicorn will
    issue moments later. There is a tiny TOCTOU window between probe
    and uvicorn.run; that's acceptable for a local-dev affordance and
    matches the standard pattern (`socket.bind(0)` for ephemeral picks).
    """
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            probe.bind((host, preferred))
        return preferred
    except OSError as e:
        if e.errno != errno.EADDRINUSE:
            raise
        if explicit:
            raise
        # Default-port collision: hand off to the kernel.
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            probe.bind((host, 0))
            chosen = probe.getsockname()[1]
        print(
            f"Port {preferred} in use; falling back to OS-assigned port {chosen}.",
        )
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
    port = preferred_port if args.reload else _pick_port(host, preferred_port, explicit=explicit_port)

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
