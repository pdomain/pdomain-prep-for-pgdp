"""S3-backed IStorage implementation.

Lazy-imports `boto3` and `botocore` so the dependency stays optional (only
the `[s3]` extra needs them).

Missing-object handling
-----------------------
boto3's ``head_object`` and ``get_object`` can raise
``botocore.exceptions.ClientError`` with ``response['Error']['Code']`` equal
to ``'NoSuchKey'`` (standard S3) or a numeric ``'404'`` (some S3-compatible
stores).  The adapter normalises these to ``FileNotFoundError`` so callers and
route handlers that already catch ``FileNotFoundError`` receive a meaningful
typed exception rather than an opaque 500-class ``ClientError``.

Other ``ClientError`` codes (e.g. ``AccessDenied``, ``InternalError``) are
re-raised unchanged so they still surface as HTTP 500s.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime
from typing import TYPE_CHECKING, NotRequired, Protocol, TypedDict, cast, override

import anyio.to_thread

from .base import IStorage, ObjectInfo

if TYPE_CHECKING:
    from collections.abc import AsyncIterator


# ── helpers ───────────────────────────────────────────────────────────────────

_MISSING_CODES: frozenset[str] = frozenset({"NoSuchKey", "NotFound", "404"})


def _is_missing_object_error(exc: Exception) -> bool:
    """Return True if *exc* is a botocore ClientError that means 'object not found'.

    Checks ``response['Error']['Code']`` against known missing-object codes
    and also falls back to ``response['ResponseMetadata']['HTTPStatusCode'] == 404``.
    """
    response = getattr(exc, "response", None)
    if response is None:
        return False
    error_code: str = response.get("Error", {}).get("Code", "")
    if error_code in _MISSING_CODES:
        return True
    http_status: int = response.get("ResponseMetadata", {}).get("HTTPStatusCode", 0)
    return http_status == 404


class _S3Body(Protocol):
    def read(self) -> bytes: ...


class _S3GetObjectResponse(TypedDict):
    Body: _S3Body


class _S3ObjectEntry(TypedDict):
    Key: str
    Size: int
    LastModified: datetime


class _S3ListObjectsResponse(TypedDict):
    IsTruncated: bool
    Contents: NotRequired[list[_S3ObjectEntry]]
    NextContinuationToken: NotRequired[str]


class _S3Exceptions(Protocol):
    NoSuchKey: type[Exception]


class _S3Client(Protocol):
    exceptions: _S3Exceptions

    def put_object(self, **kwargs: object) -> object: ...

    def get_object(self, **kwargs: object) -> _S3GetObjectResponse: ...

    def head_object(self, **kwargs: object) -> object: ...

    def delete_object(self, **kwargs: object) -> object: ...

    def list_objects_v2(self, **kwargs: object) -> _S3ListObjectsResponse: ...

    def generate_presigned_url(self, operation_name: str, **kwargs: object) -> str: ...


class S3Storage(IStorage):
    def __init__(self, bucket: str, cdn_url_base: str | None = None, prefix: str = "") -> None:
        try:
            import boto3  # pyright: ignore[reportMissingImports]
        except ImportError as e:
            raise RuntimeError(
                "S3 storage requires the [s3] extra: install with 'pip install pdomain-prep-for-pgdp[s3]'"
            ) from e

        client_factory = cast(Callable[[str], _S3Client], boto3.client)
        self._bucket: str = bucket
        self._cdn: str | None = (cdn_url_base or "").rstrip("/") or None
        self._prefix: str = prefix.strip("/")
        self._client: _S3Client = client_factory("s3")

    def _full_key(self, key: str) -> str:
        if not self._prefix:
            return key.lstrip("/")
        return f"{self._prefix}/{key.lstrip('/')}"

    @override
    async def put_bytes(self, key: str, data: bytes, content_type: str = "") -> None:
        def _put() -> None:
            _ = self._client.put_object(
                Bucket=self._bucket,
                Key=self._full_key(key),
                Body=data,
                ContentType=content_type,
            )

        await anyio.to_thread.run_sync(_put)

    @override
    async def get_bytes(self, key: str) -> bytes:
        def _get() -> bytes:
            try:
                response = self._client.get_object(Bucket=self._bucket, Key=self._full_key(key))
            except Exception as exc:
                if _is_missing_object_error(exc):
                    raise FileNotFoundError(self._full_key(key)) from exc
                raise
            return response["Body"].read()

        return await anyio.to_thread.run_sync(_get)

    @override
    async def exists(self, key: str) -> bool:
        def _head() -> bool:
            try:
                _ = self._client.head_object(Bucket=self._bucket, Key=self._full_key(key))
                return True
            except self._client.exceptions.NoSuchKey:
                return False
            except Exception as exc:
                if _is_missing_object_error(exc):
                    return False
                raise

        return await anyio.to_thread.run_sync(_head)

    @override
    async def delete(self, key: str) -> None:
        def _delete() -> None:
            _ = self._client.delete_object(Bucket=self._bucket, Key=self._full_key(key))

        await anyio.to_thread.run_sync(_delete)

    @override
    async def list_prefix(self, prefix: str) -> AsyncIterator[ObjectInfo]:
        full_prefix = self._full_key(prefix)
        token: str | None = None
        while True:
            page = await anyio.to_thread.run_sync(
                lambda current_token=token: self._client.list_objects_v2(
                    Bucket=self._bucket,
                    Prefix=full_prefix,
                    ContinuationToken=current_token,
                )
            )
            for obj in page.get("Contents", []):
                yield ObjectInfo(
                    key=obj["Key"],
                    size=obj["Size"],
                    last_modified_epoch=obj["LastModified"].timestamp(),
                )
            if not page["IsTruncated"]:
                break
            token = page.get("NextContinuationToken")

    @override
    async def presign_put(self, key: str, content_type: str, expires_in: int = 3600) -> str:
        return await anyio.to_thread.run_sync(
            lambda: self._client.generate_presigned_url(
                "put_object",
                Params={
                    "Bucket": self._bucket,
                    "Key": self._full_key(key),
                    "ContentType": content_type,
                },
                ExpiresIn=expires_in,
            )
        )

    @override
    async def presign_get(self, key: str, expires_in: int = 3600) -> str:
        if self._cdn:
            return f"{self._cdn}/{self._full_key(key)}"
        return await anyio.to_thread.run_sync(
            lambda: self._client.generate_presigned_url(
                "get_object",
                Params={"Bucket": self._bucket, "Key": self._full_key(key)},
                ExpiresIn=expires_in,
            )
        )
