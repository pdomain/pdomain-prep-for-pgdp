"""End-to-end happy path: create project -> upload zip via /cdn -> ingest -> list pages."""

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


def test_create_project_upload_zip_ingest_lists_pages(client: TestClient) -> None:
    pytest.importorskip("cv2")

    # 1. Create a project — returns a /cdn/<key> upload URL in filesystem mode.
    create = client.post(
        "/api/data/projects",
        json={"name": "End-to-end Book", "source_type": "zip"},
    )
    assert create.status_code == 200, create.text
    body = create.json()
    project_id = body["project"]["id"]
    upload_url = body["upload_url"]
    upload_key = body["upload_key"]
    assert upload_url
    assert upload_key

    # 2. PUT the zip bytes to the upload URL.
    zip_bytes = _zip([("p1.png", _png(50, 50)), ("p2.png", _png(50, 50)), ("p3.png", _png(50, 50))])
    put = client.put(upload_url, content=zip_bytes)
    assert put.status_code in (200, 204), put.text

    # 3. Kick off ingest.
    ingest = client.post(
        "/api/gpu/ingest",
        json={"project_id": project_id, "source_key": upload_key, "source_type": "zip"},
    )
    assert ingest.status_code == 202, ingest.text
    job_id = ingest.json()["job_id"]

    # 4. Poll the job until complete (the InProcessJobRunner is running in the
    # TestClient lifespan).
    deadline = time.time() + 5.0
    final_status = None
    while time.time() < deadline:
        r = client.get(f"/api/data/jobs/{job_id}")
        assert r.status_code == 200
        s = r.json()["status"]
        if s in {"complete", "error"}:
            final_status = s
            break
        time.sleep(0.05)

    assert final_status == "complete", f"job did not complete: {final_status}"

    # 5. Pages should now be populated.
    pages = client.get(f"/api/data/projects/{project_id}/pages")
    assert pages.status_code == 200
    listing = pages.json()
    assert listing["total"] == 3
    assert [p["idx0"] for p in listing["pages"]] == [0, 1, 2]
