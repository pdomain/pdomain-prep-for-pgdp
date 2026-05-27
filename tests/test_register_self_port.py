"""Tests that main() calls register_self with the actual bound port.

The suite registry records the live port so cross-app linking reads the
right address. This test verifies the wire-up without starting uvicorn.
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


def test_main_calls_register_self_with_actual_port() -> None:
    """main() must call register_self(actual_port=<chosen port>)."""
    free_port = _find_free_port()

    mock_uvicorn = MagicMock()
    mock_register_self = MagicMock()

    with (
        patch("pdomain_prep_for_pgdp.__main__.uvicorn", mock_uvicorn),
        patch("pdomain_prep_for_pgdp.__main__.register_self", mock_register_self),
        patch("pdomain_prep_for_pgdp.__main__.webbrowser"),
    ):
        from pdomain_prep_for_pgdp.__main__ import main

        main(["--port", str(free_port), "--no-browser"])

    # register_self must have been called with actual_port= equal to the
    # chosen port.
    assert mock_register_self.call_count == 1
    _, kwargs = mock_register_self.call_args
    assert kwargs.get("actual_port") == free_port


def test_main_register_self_called_before_uvicorn() -> None:
    """register_self must be called before uvicorn.run so the registry
    reflects the port before the server starts accepting connections."""
    free_port = _find_free_port()

    call_order: list[str] = []

    def fake_register_self(**kwargs: object) -> None:
        call_order.append("register_self")

    def fake_uvicorn_run(*args: object, **kwargs: object) -> None:
        call_order.append("uvicorn.run")

    mock_uvicorn = MagicMock()
    mock_uvicorn.run.side_effect = fake_uvicorn_run

    with (
        patch("pdomain_prep_for_pgdp.__main__.uvicorn", mock_uvicorn),
        patch("pdomain_prep_for_pgdp.__main__.register_self", side_effect=fake_register_self),
        patch("pdomain_prep_for_pgdp.__main__.webbrowser"),
    ):
        from pdomain_prep_for_pgdp.__main__ import main

        main(["--port", str(free_port), "--no-browser"])

    assert call_order == ["register_self", "uvicorn.run"], (
        f"Expected register_self before uvicorn.run, got: {call_order}"
    )


def test_main_register_self_fallback_port() -> None:
    """When the preferred port is busy (default, non-explicit), register_self
    receives the OS-assigned fallback port, not the preferred port."""
    # Block a port.
    blocker = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    blocker.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 0)
    blocker.bind(("127.0.0.1", 0))
    blocker.listen(1)
    busy_port = int(blocker.getsockname()[1])

    mock_uvicorn = MagicMock()
    captured: list[int] = []

    def fake_register_self(**kwargs: object) -> None:
        captured.append(int(kwargs.get("actual_port", 0)))

    try:
        with (
            patch("pdomain_prep_for_pgdp.__main__.uvicorn", mock_uvicorn),
            patch("pdomain_prep_for_pgdp.__main__.register_self", side_effect=fake_register_self),
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

    assert len(captured) == 1, "register_self should have been called once"
    assert captured[0] != busy_port, (
        f"register_self received busy_port {busy_port}; expected OS-assigned fallback"
    )
    assert captured[0] > 0
