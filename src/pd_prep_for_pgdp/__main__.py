"""Console entry point: `pgdp-prep` (also `python -m pd_prep_for_pgdp`)."""

from __future__ import annotations

import argparse
import contextlib
import errno
import os
import socket
import sys
import webbrowser
from typing import TYPE_CHECKING, Protocol, cast

import uvicorn

from .settings import Settings

if TYPE_CHECKING:
    from pathlib import Path

LAST_PORT_FILENAME = "last-port"


class _MainArgs(Protocol):
    host: str | None
    port: int | None
    reload: bool
    frontend_dev: str | None
    no_browser: bool
    version: bool


class _SubcommandModule(Protocol):
    def main(self, argv: list[str] | None = None) -> int: ...


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
        _ = (config_dir / LAST_PORT_FILENAME).write_text(f"{port}\n", encoding="utf-8")
    except OSError:
        pass


def _parse_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(prog="pgdp-prep", description=__doc__)
    _ = p.add_argument("--host", default=None, help="bind host (default 127.0.0.1)")
    _ = p.add_argument("--port", type=int, default=None, help="bind port (default 8765)")
    _ = p.add_argument("--reload", action="store_true", help="enable uvicorn auto-reload")
    _ = p.add_argument(
        "--frontend-dev",
        default=None,
        metavar="URL",
        help="proxy unknown asset paths to a Vite dev server (e.g. http://localhost:5173)",
    )
    _ = p.add_argument("--no-browser", action="store_true", help="don't open a browser tab on start")
    _ = p.add_argument("--version", action="store_true", help="print version and exit")
    return p.parse_args(argv)


def _try_bind(host: str, port: int) -> bool:
    """Probe-bind `host:port`. Return True if free, False on EADDRINUSE.

    Other OSErrors (permission denied, invalid host, etc.) propagate.
    """
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            probe.bind((host, port))
    except OSError as e:
        if e.errno == errno.EADDRINUSE:
            return False
        raise
    else:
        return True


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
        chosen = int(cast("tuple[str, int]", probe.getsockname())[1])
    print(  # noqa: T201  # CLI user-facing fallback notice
        f"Port {preferred} in use; falling back to OS-assigned port {chosen}.",
    )
    _persist(chosen)
    return chosen


def _export_bound_env(host: str, port: int) -> None:
    """Export the bound host/port to the process environment.

    `Settings` reads `PGDP_HOST` / `PGDP_PORT`, so writing them here
    before `uvicorn.run` ensures the FastAPI app sees the actual bound
    values rather than the configured defaults. This is what powers
    `GET /api/server-info` (§L1 step 3).

    Idempotent and overwrites — by design. The kernel-assigned port
    must win over any stale `PGDP_PORT` in the parent shell.
    """
    os.environ["PGDP_HOST"] = host
    os.environ["PGDP_PORT"] = str(port)


_SUBCOMMANDS: dict[str, str] = {
    # subcommand name -> dotted module path; module must expose `main(argv)`.
    "reindex": "pd_prep_for_pgdp.cli.reindex",
    "migrate-projects": "pd_prep_for_pgdp.cli.migrate_projects",
}


def _dispatch_subcommand(argv: list[str]) -> int | None:
    """If ``argv[0]`` is a known subcommand, run it and return its exit code.

    Returns ``None`` if no subcommand matched, in which case the caller
    falls through to the default "start the server" behaviour.
    """
    if not argv or argv[0].startswith("-"):
        return None
    name = argv[0]
    module_path = _SUBCOMMANDS.get(name)
    if module_path is None:
        return None
    import importlib

    mod = cast("_SubcommandModule", cast("object", importlib.import_module(module_path)))
    return mod.main(argv[1:])


def main(argv: list[str] | None = None) -> int:
    raw_argv = sys.argv[1:] if argv is None else argv

    # Subcommand dispatch wins over flag parsing — `pgdp-prep reindex --heal`
    # must hand the rest of argv to the subcommand, not parse `--heal` as a
    # server flag.
    sub_rc = _dispatch_subcommand(raw_argv)
    if sub_rc is not None:
        return sub_rc

    args = cast("_MainArgs", cast("object", _parse_args(raw_argv)))

    if args.version:
        from . import __version__

        print(__version__)  # noqa: T201  # --version flag writes to stdout by convention
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

    # Export the bound host/port to the process env so the child workers
    # (and the FastAPI app via `Settings`) see the actual bound values
    # instead of the configured defaults. `GET /api/server-info` reads
    # these — see §L1 step 3.
    _export_bound_env(host, port)

    url = f"http://{host}:{port}"
    print(f"Listening on {url}")  # noqa: T201  # startup banner intentionally goes to stdout

    if not args.no_browser and not args.reload:
        with contextlib.suppress(Exception):
            _ = webbrowser.open(url, new=1)

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
