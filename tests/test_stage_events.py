"""Tests-first for the stage-events pub/sub broker.

Mirrors test_job_events.py but for the page-scoped StageEventBroker.

Key: a composite string `"{project_id}:{page_id}"` fed by `stage_events_key(project_id, page_id)`.
"""

from __future__ import annotations

import asyncio

import pytest


@pytest.mark.asyncio
async def test_stage_subscriber_receives_published_event() -> None:
    from pd_prep_for_pgdp.core.stage_events import StageEventBroker, stage_events_key

    broker = StageEventBroker()
    key = stage_events_key("proj-1", "page-1")
    received: list[dict] = []

    async def listen() -> None:
        async for event in broker.subscribe(key):
            received.append(event)
            break

    listener = asyncio.create_task(listen())
    await asyncio.sleep(0.01)

    await broker.publish(key, {"type": "stage-status", "stage_id": "grayscale", "status": "running"})
    await asyncio.wait_for(listener, timeout=1.0)
    assert received == [{"type": "stage-status", "stage_id": "grayscale", "status": "running"}]


@pytest.mark.asyncio
async def test_stage_fanout_to_multiple_subscribers() -> None:
    from pd_prep_for_pgdp.core.stage_events import StageEventBroker, stage_events_key

    broker = StageEventBroker()
    key = stage_events_key("proj-x", "page-x")

    async def listen() -> dict:
        async for event in broker.subscribe(key):
            return event
        return {}

    a = asyncio.create_task(listen())
    b = asyncio.create_task(listen())
    await asyncio.sleep(0.01)
    ev = {"type": "stage-status", "stage_id": "threshold", "status": "clean"}
    await broker.publish(key, ev)
    a_result, b_result = await asyncio.wait_for(asyncio.gather(a, b), timeout=1.0)
    assert a_result == ev
    assert b_result == ev


@pytest.mark.asyncio
async def test_stage_publish_before_subscribe_does_not_buffer() -> None:
    from pd_prep_for_pgdp.core.stage_events import StageEventBroker, stage_events_key

    broker = StageEventBroker()
    key = stage_events_key("proj-late", "page-late")
    await broker.publish(key, {"type": "stage-status", "stage_id": "s", "status": "clean"})

    received: list[dict] = []

    async def listen() -> None:
        async for event in broker.subscribe(key):
            received.append(event)
            break

    listener = asyncio.create_task(listen())
    await asyncio.sleep(0.05)
    assert received == []  # no buffering
    await broker.publish(key, {"type": "stage-status", "stage_id": "s", "status": "dirty"})
    await asyncio.wait_for(listener, timeout=1.0)
    assert received == [{"type": "stage-status", "stage_id": "s", "status": "dirty"}]


@pytest.mark.asyncio
async def test_stage_events_isolated_by_key() -> None:
    """Events published for page-A do not reach listeners on page-B."""
    from pd_prep_for_pgdp.core.stage_events import StageEventBroker, stage_events_key

    broker = StageEventBroker()
    key_a = stage_events_key("proj", "page-a")
    key_b = stage_events_key("proj", "page-b")

    received_b: list[dict] = []

    async def listen_b() -> None:
        async for event in broker.subscribe(key_b):
            received_b.append(event)
            break

    listener = asyncio.create_task(listen_b())
    await asyncio.sleep(0.01)

    await broker.publish(key_a, {"type": "stage-status", "stage_id": "grayscale", "status": "clean"})
    await asyncio.sleep(0.05)
    assert received_b == []  # page-b got nothing

    await broker.publish(key_b, {"type": "stage-status", "stage_id": "threshold", "status": "clean"})
    await asyncio.wait_for(listener, timeout=1.0)
    assert len(received_b) == 1
