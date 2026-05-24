"""Edge cases for `api.cdn.cdn_put`.

The existing `test_cdn_upload.py` smoke-tests via httpx, but httpx
normalises `..` before sending, so the route's own traversal guard at
the top of `cdn_put` is unexercised. These tests call the handler
directly with a fake Request, so we cover the literal `key=".."`
and `key="/abs/..."` rejection paths.

Also covers: storage's own `ValueError` on path-escape becomes a 400
(handler unwraps the storage exception cleanly).
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi import HTTPException

from pd_prep_for_pgdp.adapters.auth.base import UserContext
from pd_prep_for_pgdp.adapters.storage.filesystem import FilesystemStorage
from pd_prep_for_pgdp.api.cdn import cdn_put

# Minimal authenticated user for direct-call tests.
_DEFAULT_USER = UserContext()


class _FakeRequest:
    """Minimal Request stand-in with `body()` and a `headers` dict."""

    def __init__(self, body: bytes = b"", content_type: str = "application/octet-stream") -> None:
        self._body = body
        self.headers = {"content-type": content_type}

    async def body(self) -> bytes:
        return self._body


@pytest.fixture
def storage(tmp_path) -> FilesystemStorage:
    return FilesystemStorage(root=tmp_path / "data")


@pytest.mark.asyncio
async def test_cdn_put_rejects_dotdot_segment_directly(storage: FilesystemStorage) -> None:
    req: Any = _FakeRequest()
    with pytest.raises(HTTPException) as exc:
        await cdn_put("projects/../leak", req, user=_DEFAULT_USER, storage=storage)
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_cdn_put_rejects_absolute_path(storage: FilesystemStorage) -> None:
    req: Any = _FakeRequest()
    # The route receives the path-param without the leading slash by default
    # under FastAPI/Starlette routing, but if a client crafts a request
    # that bypasses normalisation the handler still rejects it.
    with pytest.raises(HTTPException) as exc:
        await cdn_put("/etc/passwd", req, user=_DEFAULT_USER, storage=storage)
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_cdn_put_returns_400_when_storage_raises_value_error(
    storage: FilesystemStorage,
) -> None:
    """If storage's path-traversal guard fires (e.g. a key that resolves
    outside the data root), the route turns the ValueError into a 400."""

    class _RejectingStorage:
        async def put_bytes(self, *_a, **_kw) -> None:
            raise ValueError("escapes data root")

    req: Any = _FakeRequest(body=b"x")
    with pytest.raises(HTTPException) as exc:
        await cdn_put("projects/legit/key", req, user=_DEFAULT_USER, storage=_RejectingStorage())  # type: ignore[arg-type]
    assert exc.value.status_code == 400
    assert "escapes" in str(exc.value.detail)
