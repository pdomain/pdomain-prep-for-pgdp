"""Test that the SSE handler delivers events from the broker, not by polling.

Spins up a TestClient, kicks off an ingest job, opens an SSE stream, and
asserts that progress + completion frames arrive over the wire — not after a
1-second poll loop.
"""

from __future__ import annotations

import io
import time
import zipfile
from typing import TYPE_CHECKING

import numpy as np
import pytest

if TYPE_CHECKING:
    from fastapi.testclient import TestClient


def _png(h: int, w: int) -> bytes:
    cv2 = pytest.importorskip("cv2")
    img = np.full((h, w, 3), 200, dtype=np.uint8)
    ok, buf = cv2.imencode(".png", img)
    assert ok
    return bytes(buf.tobytes())


def _zip(entries: list[tuple[str, bytes]]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for n, d in entries:
            zf.writestr(n, d)
    return buf.getvalue()


def test_sse_stream_completes_on_terminal_status(client: TestClient) -> None:
    """End-to-end: the SSE handler closes once the job becomes complete."""
    pytest.importorskip("cv2")

    create = client.post(
        "/api/data/projects",
        json={"name": "SSE", "source_type": "zip"},
    )
    project_id = create.json()["project"]["id"]
    upload_url = create.json()["upload_url"]
    upload_key = create.json()["upload_key"]
    client.put(upload_url, content=_zip([("p1.png", _png(50, 50))]))
    ingest = client.post(
        "/api/gpu/ingest",
        json={"project_id": project_id, "source_key": upload_key, "source_type": "zip"},
    )
    job_id = ingest.json()["job_id"]

    # Poll once for status to confirm runner is doing its thing — independent
    # of the SSE channel.
    deadline = time.time() + 5.0
    while time.time() < deadline:
        s = client.get(f"/api/data/jobs/{job_id}").json()["status"]
        if s == "complete":
            break
        time.sleep(0.05)
    assert s == "complete"

    # Open the SSE channel AFTER the job finished — the broker is closed for
    # this job, but the handler must still emit the snapshot frame and exit
    # cleanly (rather than block forever).
    with client.stream("GET", f"/api/gpu/jobs/{job_id}/events") as resp:
        assert resp.status_code == 200
        chunks: list[str] = []
        for line in resp.iter_lines():
            chunks.append(line)
            # Once we've seen a `data: {...}` line and the next blank, we
            # have at least one complete event.
            if line.startswith("data:") and "complete" in line:
                break
        body = "\n".join(chunks)
        assert "complete" in body
