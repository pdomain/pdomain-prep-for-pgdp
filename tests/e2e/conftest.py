"""Session-scoped fixtures for Playwright E2E tests.

`live_server` builds + serves the SPA and FastAPI together on a random port,
yields the base URL, and tears the server down at session end. The bundled
SPA is built once per session (the same way the wheel ships it) so tests
exercise the production-shaped routing — not the Vite dev path.

Per-test isolation comes from `data_root` being a tmp directory unique to
each test run; we don't reset between tests in a single session.
"""

from __future__ import annotations

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
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()

    base_url = f"http://{settings.host}:{settings.port}"
    deadline = time.monotonic() + 10
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
