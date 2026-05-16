"""Cover `adapters.storage.s3.S3Storage` without standing up real AWS.

Most of the body just hands work off to boto3, so we mock `boto3.client`
and assert the request shapes (Bucket, Key prefixing, presign args).

Locks in:
  - constructor raises a clear RuntimeError when [s3] extra isn't installed,
  - constructor strips trailing/leading slashes from cdn_url_base + prefix,
  - `_full_key` honors the prefix,
  - `put_bytes` forwards Body + ContentType,
  - `get_bytes` decodes the streaming Body,
  - `presign_get` returns the CDN URL when cdn_url_base is set,
  - `presign_get` calls boto3 when cdn_url_base is unset.

When [s3] isn't installed, only the import-error test runs.
"""

from __future__ import annotations

import sys
from typing import Any

import pytest


def test_s3_storage_missing_boto3_raises_clear_error(monkeypatch: pytest.MonkeyPatch) -> None:
    """When `boto3` isn't on the path, S3Storage's constructor raises a
    RuntimeError pointing at the [s3] extra (better than ImportError)."""
    import builtins

    real = builtins.__import__

    def block(name, *a, **kw):
        if name == "boto3":
            raise ImportError("no boto")
        return real(name, *a, **kw)

    monkeypatch.setattr(builtins, "__import__", block)

    # Re-import to get a fresh class definition under the blocked import.
    sys.modules.pop("pd_prep_for_pgdp.adapters.storage.s3", None)
    from pd_prep_for_pgdp.adapters.storage.s3 import S3Storage

    with pytest.raises(RuntimeError, match=r"\[s3\] extra"):
        S3Storage(bucket="b")


# Below tests need a fake boto3 in sys.modules — ground them so they
# only run when we can replace the real boto3 (or none is installed).


class _FakeS3Client:
    """Boto3 client stand-in. Records calls; returns canned dicts."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.exceptions = type("_NS", (), {"NoSuchKey": LookupError})()

    def put_object(self, **kw):
        self.calls.append(("put_object", kw))
        return {}

    def get_object(self, **kw):
        self.calls.append(("get_object", kw))

        class _Body:
            def read(self_inner):
                return b"fake-bytes"

        return {"Body": _Body()}

    def head_object(self, **kw):
        self.calls.append(("head_object", kw))
        return {}

    def delete_object(self, **kw):
        self.calls.append(("delete_object", kw))
        return {}

    def list_objects_v2(self, **kw):
        self.calls.append(("list_objects_v2", kw))
        return {"Contents": [], "IsTruncated": False}

    def generate_presigned_url(self, op, *, Params, ExpiresIn):
        self.calls.append(("presign", {"op": op, "Params": Params, "ExpiresIn": ExpiresIn}))
        return f"https://signed.example/{Params.get('Key', '')}?op={op}"


@pytest.fixture
def fake_boto3(monkeypatch: pytest.MonkeyPatch):
    """Inject a fake `boto3` module so S3Storage can be exercised."""
    import types

    fake_client = _FakeS3Client()
    fake_module = types.ModuleType("boto3")
    fake_module.client = lambda _name: fake_client
    monkeypatch.setitem(sys.modules, "boto3", fake_module)
    # Ensure the s3 module reloads its lazy import.
    sys.modules.pop("pd_prep_for_pgdp.adapters.storage.s3", None)
    return fake_client


@pytest.mark.asyncio
async def test_constructor_with_prefix_strips_slashes(fake_boto3: _FakeS3Client) -> None:
    from pd_prep_for_pgdp.adapters.storage.s3 import S3Storage

    s = S3Storage(bucket="b", prefix="/projects/", cdn_url_base="https://cdn.example/")
    assert s._prefix == "projects"
    assert s._cdn == "https://cdn.example"


@pytest.mark.asyncio
async def test_full_key_honors_prefix(fake_boto3: _FakeS3Client) -> None:
    from pd_prep_for_pgdp.adapters.storage.s3 import S3Storage

    s = S3Storage(bucket="b", prefix="data")
    assert s._full_key("/foo/bar") == "data/foo/bar"
    s2 = S3Storage(bucket="b")
    assert s2._full_key("/foo/bar") == "foo/bar"


@pytest.mark.asyncio
async def test_put_bytes_forwards_body_and_content_type(fake_boto3: _FakeS3Client) -> None:
    from pd_prep_for_pgdp.adapters.storage.s3 import S3Storage

    s = S3Storage(bucket="my-bucket", prefix="proj")
    await s.put_bytes("a/b.png", b"raw-bytes", content_type="image/png")
    name, kw = fake_boto3.calls[-1]
    assert name == "put_object"
    assert kw["Bucket"] == "my-bucket"
    assert kw["Key"] == "proj/a/b.png"
    assert kw["Body"] == b"raw-bytes"
    assert kw["ContentType"] == "image/png"


@pytest.mark.asyncio
async def test_get_bytes_reads_streaming_body(fake_boto3: _FakeS3Client) -> None:
    from pd_prep_for_pgdp.adapters.storage.s3 import S3Storage

    s = S3Storage(bucket="b")
    out = await s.get_bytes("k")
    assert out == b"fake-bytes"


@pytest.mark.asyncio
async def test_presign_get_uses_cdn_when_configured(fake_boto3: _FakeS3Client) -> None:
    from pd_prep_for_pgdp.adapters.storage.s3 import S3Storage

    s = S3Storage(bucket="b", cdn_url_base="https://cdn.example")
    url = await s.presign_get("foo/bar.png")
    assert url == "https://cdn.example/foo/bar.png"
    # Did NOT call boto3 — the fake client has no presign call recorded.
    assert not any(c[0] == "presign" for c in fake_boto3.calls)


@pytest.mark.asyncio
async def test_presign_get_falls_back_to_boto_when_no_cdn(fake_boto3: _FakeS3Client) -> None:
    from pd_prep_for_pgdp.adapters.storage.s3 import S3Storage

    s = S3Storage(bucket="b")
    url = await s.presign_get("foo/bar.png")
    assert "signed.example" in url
    assert any(c[0] == "presign" for c in fake_boto3.calls)


@pytest.mark.asyncio
async def test_exists_returns_true_when_head_succeeds(fake_boto3: _FakeS3Client) -> None:
    from pd_prep_for_pgdp.adapters.storage.s3 import S3Storage

    s = S3Storage(bucket="b")
    assert await s.exists("k") is True
    assert ("head_object", {"Bucket": "b", "Key": "k"}) in [(n, kw) for n, kw in fake_boto3.calls]


@pytest.mark.asyncio
async def test_exists_returns_false_on_no_such_key(fake_boto3: _FakeS3Client) -> None:
    from pd_prep_for_pgdp.adapters.storage.s3 import S3Storage

    s = S3Storage(bucket="b")

    def _raise(*_a, **_kw):
        raise fake_boto3.exceptions.NoSuchKey("not found")

    fake_boto3.head_object = _raise  # type: ignore[method-assign]
    assert await s.exists("k") is False


@pytest.mark.asyncio
async def test_exists_reraises_non_nosuchkey_errors(fake_boto3: _FakeS3Client) -> None:
    """Credentials/throttling errors must propagate from exists(), not return False."""
    from pd_prep_for_pgdp.adapters.storage.s3 import S3Storage

    s = S3Storage(bucket="b")

    def _boom(*_a, **_kw):
        raise RuntimeError("network blip")

    fake_boto3.head_object = _boom  # type: ignore[method-assign]
    with pytest.raises(RuntimeError, match="network blip"):
        await s.exists("k")


@pytest.mark.asyncio
async def test_delete_calls_boto_delete_object(fake_boto3: _FakeS3Client) -> None:
    from pd_prep_for_pgdp.adapters.storage.s3 import S3Storage

    s = S3Storage(bucket="b", prefix="proj")
    await s.delete("k")
    assert ("delete_object", {"Bucket": "b", "Key": "proj/k"}) in [(n, kw) for n, kw in fake_boto3.calls]


@pytest.mark.asyncio
async def test_list_prefix_walks_continuation_tokens(fake_boto3: _FakeS3Client) -> None:
    """If the first page is truncated, list_prefix follows the continuation
    token until IsTruncated becomes False."""
    from datetime import datetime as _dt

    from pd_prep_for_pgdp.adapters.storage.s3 import S3Storage

    pages = [
        {
            "Contents": [
                {"Key": "p/a.png", "Size": 10, "LastModified": _dt(2025, 1, 1)},
            ],
            "IsTruncated": True,
            "NextContinuationToken": "t1",
        },
        {
            "Contents": [
                {"Key": "p/b.png", "Size": 20, "LastModified": _dt(2025, 1, 2)},
            ],
            "IsTruncated": False,
        },
    ]
    call_idx = {"n": 0}

    def list_objects_v2(**_kw):
        i = call_idx["n"]
        call_idx["n"] += 1
        return pages[i]

    fake_boto3.list_objects_v2 = list_objects_v2  # type: ignore[method-assign]

    s = S3Storage(bucket="b")
    keys = [obj.key async for obj in s.list_prefix("p/")]
    assert keys == ["p/a.png", "p/b.png"]
    assert call_idx["n"] == 2  # two pages fetched


@pytest.mark.asyncio
async def test_presign_put_calls_boto_with_content_type(fake_boto3: _FakeS3Client) -> None:
    from pd_prep_for_pgdp.adapters.storage.s3 import S3Storage

    s = S3Storage(bucket="b")
    url = await s.presign_put("foo/bar.zip", "application/zip", expires_in=900)
    assert "signed.example" in url
    presign_calls = [c for c in fake_boto3.calls if c[0] == "presign"]
    assert presign_calls, "expected a presign call"
    _name, kw = presign_calls[-1]
    assert kw["op"] == "put_object"
    assert kw["Params"]["ContentType"] == "application/zip"
    assert kw["ExpiresIn"] == 900
