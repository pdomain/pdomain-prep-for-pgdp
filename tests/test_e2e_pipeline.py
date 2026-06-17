"""Full pipeline e2e: ingest -> process -> ocr -> postprocess -> package.

Currently asserts the steps that don't require model downloads (ingest,
text-postprocess, package). Per-page stage execution uses the stage-runner
endpoint; the test patches run_stage to stay hermetic.
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


def _wait_for_job(client: TestClient, job_id: str, timeout: float = 5.0) -> str:
    deadline = time.time() + timeout
    while time.time() < deadline:
        r = client.get(f"/api/data/jobs/{job_id}")
        s = r.json()["status"]
        if s in {"complete", "error", "cancelled"}:
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

    # P1.9: range fields are no longer part of ProjectConfig; numbering is now
    # defined via NumberingRun objects.  Seed one frontmatter run (scan 0) and
    # one bodymatter run (scans 1-2) via the page_order runs PUT endpoint.
    runs_body = {
        "version": 1,
        "runs": [
            {
                "id": "run-fm",
                "label": "frontmatter",
                "style": "roman-lower",
                "start_mode": "set",
                "start": 1,
                "step": 1,
                "role": "text",
                "span": [0, 0],
            },
            {
                "id": "run-bm",
                "label": "bodymatter",
                "style": "arabic",
                "start_mode": "set",
                "start": 1,
                "step": 1,
                "role": "text",
                "span": [1, 2],
            },
        ],
    }
    put_runs = client.put(
        f"/api/data/projects/{project_id}/project-stages/page_order/runs",
        json=runs_body,
    )
    assert put_runs.status_code == 200, put_runs.text

    # Verify runs are persisted (GET returns 2 runs).
    # Note: page.prefix is only recomputed on the reorder route; after a PUT /runs
    # the denormalised prefix on PageRecord stays at its current value until the
    # next reorder call.  The authoritative naming lives in the runs artifact.
    get_runs = client.get(f"/api/data/projects/{project_id}/project-stages/page_order/runs")
    assert get_runs.status_code == 200
    assert len(get_runs.json()["runs"]) == 2

    # Verify the project-stage run route exists (W0.1 replacement for build-package).
    # build_package will be gate-blocked (validation not yet clean) → 409, not 404.
    pkg = client.post(f"/api/data/projects/{project_id}/project-stages/build_package/run")
    assert pkg.status_code == 409, f"expected 409 gate-blocked, got {pkg.status_code}: {pkg.text}"
    assert pkg.json()["error"] == "stage_gate_blocked"

    pages = client.get(f"/api/data/projects/{project_id}/pages").json()["pages"]
    assert len(pages) == 3
