"""Tests that `_enumerate_zip` offloads zip decompression off the event loop.

`_enumerate_zip` used to open the zip and call `zf.read()` inline on the
event loop, blocking it for the duration of decompression. The fix
dispatches the blocking work to a worker thread via
`anyio.to_thread.run_sync` and only does the stem-collision bookkeeping +
async `storage.put_bytes` calls back on the loop.
"""

from __future__ import annotations

import io
import zipfile
from dataclasses import dataclass
from typing import TYPE_CHECKING, ParamSpec, TypeVar

import anyio.to_thread
import pytest

if TYPE_CHECKING:
    from collections.abc import Callable

_P = ParamSpec("_P")
_R = TypeVar("_R")


@dataclass
class _ZipLimits:
    """Mirrors the shape of Settings fields consumed by the guard."""

    max_source_zip_bytes: int = 2 * 1024 * 1024 * 1024
    max_zip_entries: int = 2000
    max_entry_uncompressed_bytes: int = 100 * 1024 * 1024
    max_total_uncompressed_bytes: int = 5 * 1024 * 1024 * 1024


def _make_zip(entries: list[tuple[str, bytes]]) -> bytes:
    """Build an in-memory zip from (filename, data) pairs."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_STORED) as zf:
        for name, data in entries:
            zf.writestr(name, data)
    return buf.getvalue()


@pytest.mark.asyncio
async def test_enumerate_zip_dispatches_decompression_via_run_sync(tmp_path, monkeypatch) -> None:
    """`_enumerate_zip` dispatches its decompression helper through
    `anyio.to_thread.run_sync` rather than reading zip entries inline."""
    from pdomain_prep_for_pgdp.adapters.storage.filesystem import FilesystemStorage
    from pdomain_prep_for_pgdp.core.ingest import _enumerate_zip

    raw = _make_zip(
        [
            ("page0001.png", b"page-one-bytes"),
            ("page0002.png", b"page-two-bytes"),
        ]
    )

    storage = FilesystemStorage(root=tmp_path / "data")
    project_id = "proj_offload"
    source_key = f"projects/{project_id}/source.zip"
    await storage.put_bytes(source_key, raw)

    dispatched_fn_names: list[str] = []
    real_run_sync = anyio.to_thread.run_sync

    async def _spy_run_sync(fn: Callable[_P, _R], *args: _P.args, **kwargs: _P.kwargs) -> _R:
        dispatched_fn_names.append(getattr(fn, "__name__", repr(fn)))
        return await real_run_sync(fn, *args, **kwargs)

    monkeypatch.setattr(anyio.to_thread, "run_sync", _spy_run_sync)

    limits = _ZipLimits()
    entries = await _enumerate_zip(storage, source_key, project_id, limits=limits)

    assert "_read_zip_entries" in dispatched_fn_names, (
        f"expected _read_zip_entries to be dispatched via run_sync, got: {dispatched_fn_names}"
    )
    assert len(entries) == 2
    stems = {e.stem for e in entries}
    assert stems == {"page0001", "page0002"}
