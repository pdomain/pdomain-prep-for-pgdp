"""Tests that main() calls bootstrap_spa with the actual bound port.

The suite registry (via bootstrap_spa → register_self) records the live port
so cross-app linking reads the right address. These tests verify the wire-up
without starting uvicorn.

After refactor to Option B: bootstrap_spa replaces the inline register_self +
URL-print block. _pick_port still resolves the §L1-aware port; that result is
passed as preferred= to bootstrap_spa.
"""

from __future__ import annotations

import socket
from contextlib import closing
from unittest.mock import MagicMock, patch


def _find_free_port() -> int:
    """Return a free local TCP port (released immediately)."""
    with closing(socket.socket(socket.AF_INET, socket.SOCK_STREAM)) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def test_main_calls_bootstrap_spa_with_actual_port() -> None:
    """main() must call bootstrap_spa(preferred=<chosen port>)."""
    free_port = _find_free_port()

    mock_uvicorn = MagicMock()
    mock_bootstrap_spa = MagicMock(return_value=free_port)

    with (
        patch("pdomain_prep_for_pgdp.__main__.uvicorn", mock_uvicorn),
        patch("pdomain_prep_for_pgdp.__main__.bootstrap_spa", mock_bootstrap_spa),
        patch("pdomain_prep_for_pgdp.__main__.webbrowser"),
    ):
        from pdomain_prep_for_pgdp.__main__ import main

        main(["--port", str(free_port), "--no-browser"])

    # bootstrap_spa must have been called once with preferred= equal to the
    # chosen port.
    assert mock_bootstrap_spa.call_count == 1
    _, kwargs = mock_bootstrap_spa.call_args
    assert kwargs.get("preferred") == free_port


def test_main_bootstrap_spa_called_before_uvicorn() -> None:
    """bootstrap_spa must be called before uvicorn.run so the registry
    reflects the port before the server starts accepting connections."""
    free_port = _find_free_port()

    call_order: list[str] = []

    def fake_bootstrap_spa(**kwargs: object) -> int:
        call_order.append("bootstrap_spa")
        return int(kwargs.get("preferred", free_port))

    def fake_uvicorn_run(*args: object, **kwargs: object) -> None:
        call_order.append("uvicorn.run")

    mock_uvicorn = MagicMock()
    mock_uvicorn.run.side_effect = fake_uvicorn_run

    with (
        patch("pdomain_prep_for_pgdp.__main__.uvicorn", mock_uvicorn),
        patch("pdomain_prep_for_pgdp.__main__.bootstrap_spa", side_effect=fake_bootstrap_spa),
        patch("pdomain_prep_for_pgdp.__main__.webbrowser"),
    ):
        from pdomain_prep_for_pgdp.__main__ import main

        main(["--port", str(free_port), "--no-browser"])

    assert call_order == ["bootstrap_spa", "uvicorn.run"], (
        f"Expected bootstrap_spa before uvicorn.run, got: {call_order}"
    )


def test_main_bootstrap_spa_receives_fallback_port() -> None:
    """When the preferred port is busy (default, non-explicit), bootstrap_spa
    receives the OS-assigned fallback port, not the preferred port.

    _pick_port resolves the fallback; the result is passed as preferred= to
    bootstrap_spa, so the suite registry sees the actual bound address.
    """
    # Block a port.
    blocker = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    blocker.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 0)
    blocker.bind(("127.0.0.1", 0))
    blocker.listen(1)
    busy_port = int(blocker.getsockname()[1])

    mock_uvicorn = MagicMock()
    captured: list[int] = []

    def fake_bootstrap_spa(**kwargs: object) -> int:
        preferred = int(kwargs.get("preferred", 0))
        captured.append(preferred)
        return preferred

    try:
        with (
            patch("pdomain_prep_for_pgdp.__main__.uvicorn", mock_uvicorn),
            patch("pdomain_prep_for_pgdp.__main__.bootstrap_spa", side_effect=fake_bootstrap_spa),
            patch("pdomain_prep_for_pgdp.__main__.webbrowser"),
            # Override the Settings.port default so the test controls the collision.
            patch("pdomain_prep_for_pgdp.__main__.Settings") as mock_settings_cls,
        ):
            mock_settings = mock_settings_cls.return_value
            mock_settings.host = "127.0.0.1"
            mock_settings.port = busy_port
            mock_settings.config_dir = None
            mock_settings.frontend_dev_url = None

            from pdomain_prep_for_pgdp.__main__ import main

            main(["--no-browser"])  # no --port → non-explicit, fallback allowed
    finally:
        blocker.close()

    assert len(captured) == 1, "bootstrap_spa should have been called once"
    assert captured[0] != busy_port, (
        f"bootstrap_spa received busy_port {busy_port}; expected OS-assigned fallback"
    )
    assert captured[0] > 0
