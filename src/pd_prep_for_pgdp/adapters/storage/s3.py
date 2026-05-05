"""S3-backed IStorage implementation.

Lazy-imports `boto3` so the dependency stays optional (only the `[s3]` extra
needs it).
"""

from __future__ import annotations

from collections.abc import AsyncIterator

import anyio.to_thread

from .base import IStorage, ObjectInfo


class S3Storage(IStorage):
    def __init__(self, bucket: str, cdn_url_base: str | None = None, prefix: str = "") -> None:
        try:
            import boto3
        except ImportError as e:
            raise RuntimeError(
                "S3 storage requires the [s3] extra: install with 'pip install pd-prep-for-pgdp[s3]'"
            ) from e

        self._bucket = bucket
        self._cdn = (cdn_url_base or "").rstrip("/") or None
        self._prefix = prefix.strip("/")
        self._client = boto3.client("s3")

    def _full_key(self, key: str) -> str:
        if not self._prefix:
            return key.lstrip("/")
        return f"{self._prefix}/{key.lstrip('/')}"

    async def put_bytes(self, key: str, data: bytes, content_type: str = "") -> None:
        kwargs = {"Bucket": self._bucket, "Key": self._full_key(key), "Body": data}
        if content_type:
            kwargs["ContentType"] = content_type
        await anyio.to_thread.run_sync(lambda: self._client.put_object(**kwargs))

    async def get_bytes(self, key: str) -> bytes:
        def _get() -> bytes:
            r = self._client.get_object(Bucket=self._bucket, Key=self._full_key(key))
            return r["Body"].read()

        return await anyio.to_thread.run_sync(_get)

    async def exists(self, key: str) -> bool:
        def _head() -> bool:
            try:
                self._client.head_object(Bucket=self._bucket, Key=self._full_key(key))
                return True
            except self._client.exceptions.NoSuchKey:
                return False
            except Exception:
                return False

        return await anyio.to_thread.run_sync(_head)

    async def delete(self, key: str) -> None:
        await anyio.to_thread.run_sync(
            lambda: self._client.delete_object(Bucket=self._bucket, Key=self._full_key(key))
        )

    async def list_prefix(self, prefix: str) -> AsyncIterator[ObjectInfo]:
        full_prefix = self._full_key(prefix)
        token: str | None = None
        while True:
            kwargs = {"Bucket": self._bucket, "Prefix": full_prefix}
            if token:
                kwargs["ContinuationToken"] = token
            page = await anyio.to_thread.run_sync(
                lambda kw=kwargs: self._client.list_objects_v2(**kw)
            )
            for obj in page.get("Contents", []):
                yield ObjectInfo(
                    key=obj["Key"],
                    size=obj["Size"],
                    last_modified_epoch=obj["LastModified"].timestamp(),
                )
            if not page.get("IsTruncated"):
                break
            token = page.get("NextContinuationToken")

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
