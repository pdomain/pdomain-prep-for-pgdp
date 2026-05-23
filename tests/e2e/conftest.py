"""Session-scoped fixtures for Playwright E2E tests.

`live_server` builds + serves the SPA and FastAPI together on a random port,
yields the base URL, and tears the server down at session end. The bundled
SPA is built once per session (the same way the wheel ships it) so tests
exercise the production-shaped routing — not the Vite dev path.

Per-test isolation comes from `data_root` being a tmp directory unique to
each test run; we don't reset between tests in a single session.
"""

from __future__ import annotations

import asyncio
import socket
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

import httpx
import pytest
import uvicorn

from pd_prep_for_pgdp.bootstrap import build_app
from pd_prep_for_pgdp.settings import Settings

if TYPE_CHECKING:
    from collections.abc import Iterator


def pytest_configure(config: pytest.Config) -> None:
    """Add e2e-specific warning filters on top of the pyproject.toml baseline.

    Two categories of third-party noise are suppressed here so the global
    ``filterwarnings = ["error"]`` policy can stay strict for unit tests:

    * **websockets / uvicorn** — uvicorn probes ``websockets.legacy`` during
      WebSocket-protocol auto-detection at server startup.  Both the
      ``websockets`` library and uvicorn's own websockets impl emit
      ``DeprecationWarning``s on import.  These are uvicorn's debt to fix;
      we cannot suppress them from our code.

    * **PytestUnhandledThreadExceptionWarning** — the uvicorn daemon thread's
      event loop may be closed by the GC after ``server.should_exit = True``
      is set and before ``thread.join()`` completes.  The thread itself exits
      cleanly; this warning is a daemon-thread teardown ordering artefact, not
      a functional bug.
    """
    config.addinivalue_line(
        "filterwarnings",
        "ignore::DeprecationWarning:websockets.*",
    )
    config.addinivalue_line(
        "filterwarnings",
        "ignore::DeprecationWarning:uvicorn.protocols.websockets.*",
    )
    config.addinivalue_line(
        "filterwarnings",
        "ignore::pytest.PytestUnhandledThreadExceptionWarning",
    )


@dataclass
class LiveServer:
    base_url: str
    settings: Settings


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _spa_built() -> bool:
    """`make e2e` runs `frontend-build` first; this is just the safety net."""
    static = Path(__file__).resolve().parents[2] / "src" / "pd_prep_for_pgdp" / "static"
    return static.is_dir() and any(static.iterdir())


def _run_server(server: uvicorn.Server) -> None:
    """Run uvicorn in a dedicated event loop to avoid pytest-asyncio interference.

    pytest-asyncio with ``asyncio_mode = "auto"`` installs a running event loop
    on the main thread before session fixtures run. ``server.run()`` internally
    calls ``asyncio.run()`` which raises "cannot be called from a running event
    loop" when invoked from within that context. Running in an explicit fresh
    loop in a worker thread sidesteps the conflict.
    """
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        loop.run_until_complete(server.serve())
    finally:
        loop.close()


@pytest.fixture(scope="session")
def live_server(tmp_path_factory: pytest.TempPathFactory) -> Iterator[LiveServer]:
    if not _spa_built():
        pytest.skip("SPA not built — run `make frontend-build` (or `make e2e`) before pytest tests/e2e")

    data_root = tmp_path_factory.mktemp("e2e-data")
    config_dir = tmp_path_factory.mktemp("e2e-config")
    settings = Settings(
        host="127.0.0.1",
        port=_free_port(),
        data_root=data_root,
        config_dir=config_dir,
        storage_backend="filesystem",
        database_url=f"sqlite:///{(data_root / 'state.db').as_posix()}",
        gpu_backend="cpu",
        dispatch_interval_seconds=0,
        auth_mode="none",
        cdn_enabled=True,
    )
    app = build_app(settings)
    config = uvicorn.Config(app, host=settings.host, port=settings.port, log_level="warning")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=_run_server, args=(server,), daemon=True)
    thread.start()

    base_url = f"http://{settings.host}:{settings.port}"
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        try:
            r = httpx.get(f"{base_url}/api/data/projects", timeout=0.5)
            if r.status_code == 200:
                break
        except httpx.HTTPError:
            time.sleep(0.1)
    else:
        server.should_exit = True
        thread.join(timeout=2)
        raise RuntimeError(f"uvicorn did not become ready at {base_url}")

    yield LiveServer(base_url=base_url, settings=settings)

    server.should_exit = True
    thread.join(timeout=5)


_TEST_API_KEY = "test-key-xyzzy"
_TEST_SESSION_SECRET = "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20"


@pytest.fixture(scope="session")
def apikey_live_server(tmp_path_factory: pytest.TempPathFactory) -> Iterator[LiveServer]:
    """Like ``live_server`` but boots with ``auth_mode="apikey"`` so the
    session-cookie proxy flow is exercised end-to-end by the browser.

    The server is launched once for the whole test session; individual tests
    must log in (and log out) as needed to establish or clear the session.
    """
    if not _spa_built():
        pytest.skip("SPA not built — run `make frontend-build` (or `make e2e`) before pytest tests/e2e")

    data_root = tmp_path_factory.mktemp("e2e-apikey-data")
    config_dir = tmp_path_factory.mktemp("e2e-apikey-config")
    settings = Settings(
        host="127.0.0.1",
        port=_free_port(),
        data_root=data_root,
        config_dir=config_dir,
        storage_backend="filesystem",
        database_url=f"sqlite:///{(data_root / 'state.db').as_posix()}",
        gpu_backend="cpu",
        dispatch_interval_seconds=0,
        auth_mode="apikey",
        api_key=_TEST_API_KEY,
        session_secret=_TEST_SESSION_SECRET,
    )
    app = build_app(settings)
    config = uvicorn.Config(app, host=settings.host, port=settings.port, log_level="warning")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=_run_server, args=(server,), daemon=True)
    thread.start()

    base_url = f"http://{settings.host}:{settings.port}"
    # In apikey mode the /api/auth/me endpoint returns 401 for unauthenticated
    # requests, so we probe /healthz (always 200) for readiness.
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        try:
            r = httpx.get(f"{base_url}/healthz", timeout=0.5)
            if r.status_code == 200:
                break
        except httpx.HTTPError:
            time.sleep(0.1)
    else:
        server.should_exit = True
        thread.join(timeout=2)
        raise RuntimeError(f"uvicorn did not become ready at {base_url}")

    yield LiveServer(base_url=base_url, settings=settings)

    server.should_exit = True
    thread.join(timeout=5)
