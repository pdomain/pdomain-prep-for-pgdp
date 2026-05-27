"""Tests-first for `ModalBackend` dispatch using a Fake Modal runtime.

The real `modal.Function.lookup(app, fn).remote.aio(payload)` call can't
run in this devcontainer, but the dispatch shape can: build a fake
`Function` object whose `remote.aio` returns a canned response, monkeypatch
`modal.Function` so `_load_function` finds it, and assert the backend
serialises requests + parses responses correctly.

Locks in:
  - `process_page` serialises `ProcessPageRequest`, awaits `.remote.aio`,
    and re-validates as `ProcessPageResponse`,
  - `run_ocr` serialises `OcrPageRequest` -> `OcrPageResponse`,
  - `run_batch` sends a list of dicts, receives a list of dicts.
"""

from __future__ import annotations

import sys
from types import SimpleNamespace
from typing import Any

import pytest
from pdomain_ops.gpu import (
    BatchJobItem,
    OcrPageRequest,
    ProcessPageRequest,
)

from pdomain_prep_for_pgdp.core.models import PageConfigOverrides


class FakeFunction:
    def __init__(self, return_value: Any):
        self._rv = return_value
        self.calls: list[Any] = []
        self.remote = SimpleNamespace(aio=self._aio)

    async def _aio(self, payload: Any) -> Any:
        self.calls.append(payload)
        if callable(self._rv):
            return self._rv(payload)
        return self._rv


class FakeFunctionRegistry:
    """Mimics `modal.Function.lookup(app, fn)`."""

    def __init__(self, fns: dict[tuple[str, str], FakeFunction]):
        self._fns = fns

    def lookup(self, app: str, fn: str) -> FakeFunction:
        return self._fns[(app, fn)]


@pytest.fixture
def modal_module(monkeypatch: pytest.MonkeyPatch):
    """Inject a fake `modal` module so `from modal import Function` works."""
    fns: dict[tuple[str, str], FakeFunction] = {}
    registry = FakeFunctionRegistry(fns)
    fake = SimpleNamespace(Function=registry)
    monkeypatch.setitem(sys.modules, "modal", fake)
    return fns


@pytest.mark.asyncio
async def test_process_page_serialises_request_and_validates_response(modal_module) -> None:
    from pdomain_ops.gpu import ModalStageDispatcher as ModalBackend

    expected_response = {
        "processed_image_key": "projects/p/processed/x.png",
        "processed_image_url": "https://cdn.example/x.png",
        "dimensions": [1100, 800],
        "processing_time_ms": 1234,
        "backend": "modal",
        "cold_start_ms": 12000,
    }
    fn = FakeFunction(return_value=expected_response)
    modal_module[("pgdp-prep", "process_page")] = fn

    backend = ModalBackend(token_id="x", token_secret="y", app_name="pgdp-prep")
    req = ProcessPageRequest(
        project_id="p",
        idx0=42,
        config_overrides=PageConfigOverrides(threshold_level=200).model_dump(mode="json"),
        output_context="commit",
    )
    resp = await backend.process_page(req)

    assert resp.processed_image_key == expected_response["processed_image_key"]
    assert resp.dimensions == (1100, 800)
    assert resp.cold_start_ms == 12000

    # Backend got a JSON-serialisable dict, not the Pydantic model.
    assert isinstance(fn.calls[0], dict)
    assert fn.calls[0]["idx0"] == 42
    assert fn.calls[0]["config_overrides"]["threshold_level"] == 200


@pytest.mark.asyncio
async def test_run_ocr_round_trip(modal_module) -> None:
    from pdomain_ops.gpu import ModalStageDispatcher as ModalBackend

    fn = FakeFunction(
        return_value={
            "text": "hello world",
            "words": [],
            "text_key": "projects/p/ocr_text/x.txt",
        }
    )
    modal_module[("pgdp-prep", "run_ocr")] = fn

    backend = ModalBackend(token_id="x", token_secret="y", app_name="pgdp-prep")
    resp = await backend.run_ocr(OcrPageRequest(project_id="p", idx0=7))
    assert resp.text == "hello world"
    assert resp.text_key == "projects/p/ocr_text/x.txt"
    assert fn.calls[0]["idx0"] == 7


@pytest.mark.asyncio
async def test_run_batch_sends_list_of_dicts(modal_module) -> None:
    from pdomain_ops.gpu import ModalStageDispatcher as ModalBackend

    def echo(payload: list[dict]) -> list[dict]:
        return [
            {
                "job_type": item["job_type"],
                "project_id": item["project_id"],
                "idx0": item["idx0"],
                "ok": True,
                "payload": {},
            }
            for item in payload
        ]

    fn = FakeFunction(return_value=echo)
    modal_module[("pgdp-prep", "run_batch")] = fn

    backend = ModalBackend(token_id="x", token_secret="y", app_name="pgdp-prep")
    items = [
        BatchJobItem(job_type="batch_process_pages", project_id="p", idx0=0),
        BatchJobItem(job_type="batch_process_pages", project_id="p", idx0=1),
    ]
    results = await backend.run_batch(items)

    assert len(results) == 2
    assert results[0].ok is True
    assert results[1].idx0 == 1

    # Confirm the wire payload was a plain list[dict].
    sent = fn.calls[0]
    assert isinstance(sent, list)
    assert all(isinstance(p, dict) for p in sent)
    assert sent[0]["idx0"] == 0
