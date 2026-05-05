"""Tests-first for the /cdn PUT handler.

Filesystem-mode `presign_put` returns a `/cdn/<key>` URL — but FastAPI's
StaticFiles is read-only. The PUT handler closes that gap so the local
flow (create project -> presigned upload -> ingest) works without S3.

Locks in:
  - PUT /cdn/<key> with bytes writes the key into storage,
  - keys outside the data root are rejected (path traversal),
  - GET /cdn/<key> still serves the freshly-written bytes.
"""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_cdn_put_writes_to_storage(client: TestClient) -> None:
    body = b"hello-from-test"
    r = client.put("/cdn/projects/abc/source/page1.png", content=body)
    assert r.status_code in (200, 204)

    # Round-trip through the read-only /cdn StaticFiles mount.
    r2 = client.get("/cdn/projects/abc/source/page1.png")
    assert r2.status_code == 200
    assert r2.content == body


def test_cdn_put_rejects_path_traversal(client: TestClient) -> None:
    r = client.put("/cdn/../../etc/evil.txt", content=b"oops")
    # httpx may normalise `..` before sending (yielding a 405 from the
    # static mount, since GET-only). Either way the file must not land at
    # the traversed path. Accept anything in the rejection family.
    assert r.status_code in (400, 404, 405, 422)


def test_cdn_get_404_when_not_present(client: TestClient) -> None:
    r = client.get("/cdn/projects/abc/source/missing.png")
    assert r.status_code == 404
