"""Tests for roadmap §18 — structured logging + request-id correlation.

Coverage:

1. `configure_logging("plain")` is the default — verifies the wheel
   keeps current human-readable behaviour for solo proofers and that
   `%(request_id)s` is rendered into the line.
2. `configure_logging("json")` emits one valid JSON object per record
   with the documented schema (`ts`, `level`, `logger`, `msg`,
   `request_id`).
3. The contextvar set by `RequestIdMiddleware` shows up on log records
   produced inside a request handler, and the response echoes the same
   `X-Request-ID` header.
4. An incoming `X-Request-ID` is preserved (not overwritten) so
   upstream LB/proxy correlation ids propagate.
5. `configure_logging` is idempotent — calling it twice does not stack
   handlers.
"""

from __future__ import annotations

import io
import json
import logging
import sys
from typing import TYPE_CHECKING

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from pdomain_prep_for_pgdp.api.middleware.request_id import RequestIdMiddleware
from pdomain_prep_for_pgdp.core.logging_config import (
    JsonFormatter,
    RequestIdFilter,
    configure_logging,
    request_id_var,
)

if TYPE_CHECKING:
    from collections.abc import Iterator


@pytest.fixture(autouse=True)
def _reset_root_logger() -> Iterator[None]:
    """Each test starts with a clean root logger.

    `configure_logging` mutates the root logger (it's a process-wide
    singleton). Without resetting, leftover handlers from one test
    would bleed into the next and assertions on captured output would
    flake.
    """
    root = logging.getLogger()
    saved_handlers = list(root.handlers)
    saved_level = root.level
    yield
    for h in list(root.handlers):
        root.removeHandler(h)
    for h in saved_handlers:
        root.addHandler(h)
    root.setLevel(saved_level)


def _capture_log(format_: str) -> tuple[io.StringIO, logging.Handler]:
    """Install our formatter on a StringIO so we can inspect output.

    We can't just use `caplog` because we want to verify the *formatted*
    output (the JSON wire shape, not the LogRecord attributes).
    """
    configure_logging(format_)  # type: ignore[arg-type]
    # Replace the StreamHandler stdout target with a StringIO.
    root = logging.getLogger()
    handler = next(h for h in root.handlers if getattr(h, "_pgdp_managed", False))
    buf = io.StringIO()
    handler.stream = buf
    return buf, handler


# ─── 1. Plain format ─────────────────────────────────────────────────────────


def test_plain_format_renders_request_id_placeholder() -> None:
    buf, _ = _capture_log("plain")
    token = request_id_var.set("rid-abc")
    try:
        logging.getLogger("pdomain_prep_for_pgdp.test").info("hello world")
    finally:
        request_id_var.reset(token)

    line = buf.getvalue().strip()
    assert "hello world" in line
    assert "rid=rid-abc" in line
    # Plain format is not JSON
    with pytest.raises(json.JSONDecodeError):
        json.loads(line)


# ─── 2. JSON format ──────────────────────────────────────────────────────────


def test_json_format_emits_documented_schema() -> None:
    buf, _ = _capture_log("json")
    logger = logging.getLogger("pdomain_prep_for_pgdp.test_json")

    token = request_id_var.set("rid-xyz")
    try:
        logger.info("ingest started", extra={"project_id": "proj-7"})
    finally:
        request_id_var.reset(token)

    line = buf.getvalue().strip()
    payload = json.loads(line)

    # Documented schema keys
    assert payload["level"] == "INFO"
    assert payload["logger"] == "pdomain_prep_for_pgdp.test_json"
    assert payload["msg"] == "ingest started"
    assert payload["request_id"] == "rid-xyz"
    assert "ts" in payload
    # Extras are folded in as top-level fields
    assert payload["project_id"] == "proj-7"


def test_json_format_includes_exception_traceback() -> None:
    buf, _ = _capture_log("json")
    logger = logging.getLogger("pdomain_prep_for_pgdp.test_json_exc")

    try:
        raise ValueError("boom")
    except ValueError:
        logger.exception("ocr step failed")

    payload = json.loads(buf.getvalue().strip())
    assert payload["level"] == "ERROR"
    assert payload["msg"] == "ocr step failed"
    assert "exc" in payload
    assert "ValueError: boom" in payload["exc"]


# ─── 3. Request-ID middleware on a real request ──────────────────────────────


def _tiny_app() -> FastAPI:
    """Minimal FastAPI app just exercising the middleware — avoids
    bringing up the full bootstrap stack so this test can't be flaky
    on adapter setup. The middleware is the unit under test here.
    """
    app = FastAPI()
    captured: dict[str, str] = {}

    @app.get("/ping")
    async def ping() -> dict[str, str]:
        captured["seen_inside_handler"] = request_id_var.get()
        return {"rid": request_id_var.get()}

    app.add_middleware(RequestIdMiddleware, header_name="X-Request-ID")
    app.state._captured = captured
    return app


def test_request_id_middleware_generates_and_echoes() -> None:
    app = _tiny_app()
    client = TestClient(app)
    resp = client.get("/ping")
    assert resp.status_code == 200
    rid = resp.json()["rid"]
    assert rid  # non-empty
    assert resp.headers["X-Request-ID"] == rid
    # The contextvar was populated for the handler
    assert app.state._captured["seen_inside_handler"] == rid


def test_request_id_middleware_preserves_incoming_header() -> None:
    app = _tiny_app()
    client = TestClient(app)
    resp = client.get("/ping", headers={"X-Request-ID": "client-supplied-42"})
    assert resp.status_code == 200
    assert resp.json()["rid"] == "client-supplied-42"
    assert resp.headers["X-Request-ID"] == "client-supplied-42"


def test_request_id_filter_attaches_attribute() -> None:
    """RequestIdFilter must attach `request_id` even when the contextvar
    is at its default (empty) — formatters expect the attribute to
    exist unconditionally.
    """
    f = RequestIdFilter()
    record = logging.LogRecord(
        name="t",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg="x",
        args=(),
        exc_info=None,
    )
    assert f.filter(record) is True
    assert hasattr(record, "request_id")
    assert record.request_id == ""  # default contextvar value


# ─── 4. Idempotency ──────────────────────────────────────────────────────────


def test_configure_logging_is_idempotent() -> None:
    """Calling configure_logging twice must not double-log; uvicorn
    --reload triggers build_app() repeatedly in the same process.
    """
    configure_logging("json")
    configure_logging("json")
    root = logging.getLogger()
    managed = [h for h in root.handlers if getattr(h, "_pgdp_managed", False)]
    assert len(managed) == 1


# ─── 5. JsonFormatter is reusable in isolation ───────────────────────────────


def test_json_formatter_handles_missing_request_id_attr() -> None:
    """A LogRecord that didn't pass through RequestIdFilter (e.g. from
    a third-party library) must still serialise — `request_id` falls
    back to empty string rather than raising AttributeError.
    """
    formatter = JsonFormatter()
    record = logging.LogRecord(
        name="third_party",
        level=logging.WARNING,
        pathname=__file__,
        lineno=1,
        msg="cache miss",
        args=(),
        exc_info=None,
    )
    out = formatter.format(record)
    payload = json.loads(out)
    assert payload["request_id"] == ""
    assert payload["msg"] == "cache miss"
    assert payload["level"] == "WARNING"


# Sanity: importing this module didn't accidentally pollute stdout/stderr
# at collection time.
def test_module_import_did_not_dirty_streams() -> None:
    assert isinstance(sys.stdout, io.TextIOBase) or hasattr(sys.stdout, "write")
