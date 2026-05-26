"""Tests-first for the job-events pub/sub broker.

Behavior under test:
  - `publish(job_id, event)` delivers to every active `subscribe(job_id)`
    iterator within milliseconds (no polling).
  - Late subscribers don't see events that fired before they subscribed
    (events are not buffered — a fresh listener gets only future events).
  - Multiple subscribers on the same job_id all receive the event (fan-out).
  - Iterators stop when the broker closes the channel.
  - Subscribing to an unknown job_id is fine; events for that job arrive
    once `publish(...)` is called.
"""

from __future__ import annotations

import asyncio

import pytest


@pytest.mark.asyncio
async def test_subscriber_receives_published_event() -> None:
    from pdomain_prep_for_pgdp.core.job_events import JobEventBroker

    broker = JobEventBroker()
    received: list[dict] = []

    async def listen() -> None:
        async for event in broker.subscribe("job-1"):
            received.append(event)
            if event.get("status") == "complete":
                break

    listener = asyncio.create_task(listen())
    await asyncio.sleep(0.01)  # let the listener settle on the queue

    await broker.publish("job-1", {"status": "running", "current": 1})
    await broker.publish("job-1", {"status": "complete", "current": 5})

    await asyncio.wait_for(listener, timeout=1.0)
    assert [e["status"] for e in received] == ["running", "complete"]


@pytest.mark.asyncio
async def test_fanout_to_multiple_subscribers() -> None:
    from pdomain_prep_for_pgdp.core.job_events import JobEventBroker

    broker = JobEventBroker()

    async def listen() -> dict:
        async for event in broker.subscribe("job-x"):
            return event
        return {}

    a = asyncio.create_task(listen())
    b = asyncio.create_task(listen())
    await asyncio.sleep(0.01)
    await broker.publish("job-x", {"status": "running"})
    a_result, b_result = await asyncio.wait_for(asyncio.gather(a, b), timeout=1.0)
    assert a_result == {"status": "running"}
    assert b_result == {"status": "running"}


@pytest.mark.asyncio
async def test_publish_before_subscribe_does_not_buffer() -> None:
    from pdomain_prep_for_pgdp.core.job_events import JobEventBroker

    broker = JobEventBroker()
    await broker.publish("job-late", {"status": "running"})

    received: list[dict] = []

    async def listen() -> None:
        async for event in broker.subscribe("job-late"):
            received.append(event)
            break

    listener = asyncio.create_task(listen())
    await asyncio.sleep(0.05)
    # No buffered events — listener is still waiting.
    assert received == []
    await broker.publish("job-late", {"status": "complete"})
    await asyncio.wait_for(listener, timeout=1.0)
    assert received == [{"status": "complete"}]


@pytest.mark.asyncio
async def test_close_terminates_iterator() -> None:
    from pdomain_prep_for_pgdp.core.job_events import JobEventBroker

    broker = JobEventBroker()
    received: list[dict] = []

    async def listen() -> None:
        async for event in broker.subscribe("job-c"):
            received.append(event)

    listener = asyncio.create_task(listen())
    await asyncio.sleep(0.01)
    await broker.publish("job-c", {"status": "running"})
    await asyncio.sleep(0.01)
    await broker.close("job-c")
    await asyncio.wait_for(listener, timeout=1.0)
    # Got the running event; closure ended the iterator without raising.
    assert received == [{"status": "running"}]


@pytest.mark.asyncio
async def test_publishing_to_no_subscribers_is_a_noop() -> None:
    from pdomain_prep_for_pgdp.core.job_events import JobEventBroker

    broker = JobEventBroker()
    # No exception even though nobody is listening.
    await broker.publish("nobody-home", {"status": "running"})
    await broker.close("nobody-home")
