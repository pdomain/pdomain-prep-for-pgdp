"""Filesystem-backed IStorage implementation.

Used by the local install and by self-hosted deployments that don't want S3.
Presigned GET URLs return `/cdn/<key>` paths; FastAPI's StaticFiles mount
serves them.
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

import anyio

from .base import IStorage, ObjectInfo

if TYPE_CHECKING:
    from collections.abc import AsyncIterator


class FilesystemStorage(IStorage):
    def __init__(self, root: Path, cdn_url_base: str = "/cdn") -> None:
        self._root = root
        self._cdn = cdn_url_base.rstrip("/")
        self._root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        # Defence against path traversal — keys are joined under the root and
        # must resolve to a child of it.
        #
        # Reject absolute paths before stripping. On Unix, leading "/" makes
        # Path.is_absolute() True. On Windows, "C:/foo" is also caught here.
        # We check the original key so that a bare "/" prefix isn't silently
        # swallowed by lstrip and allowed through.
        if Path(key).is_absolute():
            raise ValueError(f"storage key must be relative, got: {key!r}")
        clean = key.lstrip("/")
        if Path(clean).is_absolute():
            # Windows-style path after stripping (shouldn't occur on Unix, but
            # belt-and-suspenders for portable operation).
            raise ValueError(f"storage key must be relative, got: {key!r}")
        p = (self._root / clean).resolve()
        root_resolved = self._root.resolve()
        if root_resolved not in p.parents and p != root_resolved:
            raise ValueError(f"key escapes data root: {key!r}")
        return p

    async def put_bytes(self, key: str, data: bytes, content_type: str = "") -> None:
        p = self._path(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        await anyio.Path(p).write_bytes(data)

    async def get_bytes(self, key: str) -> bytes:
        return await anyio.Path(self._path(key)).read_bytes()

    async def exists(self, key: str) -> bool:
        return await anyio.Path(self._path(key)).exists()

    async def delete(self, key: str) -> None:
        p = self._path(key)
        if p.exists():
            p.unlink()

    async def list_prefix(self, prefix: str) -> AsyncIterator[ObjectInfo]:  # pyright: ignore[reportIncompatibleMethodOverride]
        base = self._path(prefix)
        if not base.exists():
            return
        for f in base.rglob("*"):
            if f.is_file():
                rel = f.relative_to(self._root).as_posix()
                stat = f.stat()
                yield ObjectInfo(key=rel, size=stat.st_size, last_modified_epoch=stat.st_mtime)

    async def presign_put(self, key: str, content_type: str, expires_in: int = 3600) -> str:
        # Filesystem mode does direct uploads through the FastAPI process; the
        # caller PUTs to /cdn/<key> with the same path it uses to GET.
        return f"{self._cdn}/{key.lstrip('/')}"

    async def presign_get(self, key: str, expires_in: int = 3600) -> str:
        return f"{self._cdn}/{key.lstrip('/')}"
