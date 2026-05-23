"""IStorage Protocol — filesystem and S3 implementations conform to this."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    from collections.abc import AsyncIterator


@dataclass(frozen=True)
class ObjectInfo:
    key: str
    size: int
    last_modified_epoch: float


class IStorage(Protocol):
    """Object-store interface used by the pipeline + API.

    Keys are forward-slash-joined paths under a single root (filesystem) or
    bucket prefix (S3). Implementations must accept any key the pipeline
    constructs without further normalisation.
    """

    async def put_bytes(self, key: str, data: bytes, content_type: str = "") -> None: ...

    async def get_bytes(self, key: str) -> bytes: ...

    async def exists(self, key: str) -> bool: ...

    async def delete(self, key: str) -> None: ...

    def list_prefix(self, prefix: str) -> AsyncIterator[ObjectInfo]: ...

    async def presign_put(self, key: str, content_type: str, expires_in: int = 3600) -> str: ...

    async def presign_get(self, key: str, expires_in: int = 3600) -> str: ...
