"""Full pipeline e2e: ingest -> process -> ocr -> postprocess -> package.

Currently asserts the steps that don't require model downloads (ingest,
text-postprocess, package). Uses a mock GPU backend for batch_process_pages
so the test stays hermetic.
"""

from __future__ import annotations

import io
import time
import zipfile

import numpy as np
import pytest
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


def _wait_for_job(client: TestClient, job_id: str, timeout: float = 5.0) -> str:
    deadline = time.time() + timeout
    while time.time() < deadline:
        r = client.get(f"/api/data/jobs/{job_id}")
        s = r.json()["status"]
        if s in {"complete", "error", "cancelled", "awaiting_review"}:
            return s
        time.sleep(0.05)
    raise AssertionError(f"job {job_id} did not complete within {timeout}s")


def test_ingest_then_assign_prefixes_then_package(client: TestClient) -> None:
    pytest.importorskip("cv2")

    # Create + upload + ingest.
    create = client.post(
        "/api/data/projects",
        json={"name": "Test E2E", "source_type": "zip"},
    )
    project_id = create.json()["project"]["id"]
    upload_url = create.json()["upload_url"]
    upload_key = create.json()["upload_key"]
    client.put(upload_url, content=_zip([(f"p{i:02d}.png", _png(50, 50)) for i in range(3)]))
    ingest = client.post(
        "/api/gpu/ingest",
        json={"project_id": project_id, "source_key": upload_key, "source_type": "zip"},
    )
    assert _wait_for_job(client, ingest.json()["job_id"]) == "complete"

    # Configure ranges -> assign_prefixes runs as a side-effect of PATCH.
    patch = client.patch(
        f"/api/data/projects/{project_id}/config",
        json={
            "project_config": {
                "proof_start_idx0": 0,
                "proof_end_idx0": 2,
                "frontmatter_start_idx0": 0,
                "frontmatter_end_idx0": 0,
                "bodymatter_start_idx0": 1,
                "bodymatter_end_idx0": 2,
            }
        },
    )
    assert patch.status_code == 200

    pages = client.get(f"/api/data/projects/{project_id}/pages").json()["pages"]
    by_idx = {p["idx0"]: p for p in pages}
    assert by_idx[0]["prefix"].startswith("f")
    assert by_idx[1]["prefix"].startswith("p")
    assert by_idx[2]["prefix"].startswith("p")

    # Submit a build_package job — proves the runner picks up the handler.
    # Pages have no text_review=clean rows, so the job parks in awaiting_review.
    pkg = client.post(
        "/api/gpu/jobs",
        json={"project_id": project_id, "job_type": "build_package"},
    )
    assert pkg.status_code == 202
    assert _wait_for_job(client, pkg.json()["job_id"]) == "awaiting_review"

    pages = client.get(f"/api/data/projects/{project_id}/pages").json()["pages"]
    assert len(pages) == 3
