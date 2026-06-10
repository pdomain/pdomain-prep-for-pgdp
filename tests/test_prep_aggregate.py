"""Behavior 7 — PrepProjectAggregate: new event types with actor + timestamp + payload.

Spec: docs/specs/stage-registry-v2.md §5.2 (event vocabulary)
      docs/specs/library-placement.md §4.1 (app-local PrepProjectAggregate)
"""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pathlib import Path


def test_prep_aggregate_can_be_imported() -> None:
    """PrepProjectAggregate is importable from the correct module path."""
    from pdomain_prep_for_pgdp.core.pipeline.prep_aggregate import PrepProjectAggregate

    assert PrepProjectAggregate is not None


def test_stage_run_started_event_fires() -> None:
    """Calling record_stage_run_started appends a StageRunStarted event."""
    from pdomain_prep_for_pgdp.core.pipeline.prep_aggregate import PrepProjectAggregate

    project_id = uuid.uuid4()
    agg = PrepProjectAggregate(project_id=project_id)
    agg.record_stage_run_started(
        stage_id="grayscale",
        page_id="0001",
        job_id="job-123",
        actor_id="default",
    )
    # The aggregate should have pending events
    events = list(agg.pending_events)
    assert len(events) >= 1
    # Find the StageRunStarted event
    started = [e for e in events if type(e).__name__ == "StageRunStarted"]
    assert len(started) == 1, f"expected 1 StageRunStarted, got {len(started)}"
    ev = started[0]
    assert ev.stage_id == "grayscale"
    assert ev.page_id == "0001"
    assert ev.job_id == "job-123"
    assert ev.actor_id == "default"


def test_stage_run_completed_event_fires() -> None:
    """Calling record_stage_run_completed appends a StageRunCompleted event."""
    from pdomain_prep_for_pgdp.core.pipeline.prep_aggregate import PrepProjectAggregate

    project_id = uuid.uuid4()
    agg = PrepProjectAggregate(project_id=project_id)
    agg.record_stage_run_completed(
        stage_id="crop",
        page_id="0001",
        status="clean",
        duration_ms=150,
        artifact_key="projects/p/stages/crop/output.png",
        actor_id="default",
    )
    events = list(agg.pending_events)
    completed = [e for e in events if type(e).__name__ == "StageRunCompleted"]
    assert len(completed) == 1
    ev = completed[0]
    assert ev.stage_id == "crop"
    assert ev.status == "clean"
    assert ev.duration_ms == 150


def test_stage_run_failed_event_fires() -> None:
    """Calling record_stage_run_failed appends a StageRunFailed event."""
    from pdomain_prep_for_pgdp.core.pipeline.prep_aggregate import PrepProjectAggregate

    project_id = uuid.uuid4()
    agg = PrepProjectAggregate(project_id=project_id)
    agg.record_stage_run_failed(
        stage_id="ocr",
        page_id="0002",
        error_message="CUDA OOM",
        duration_ms=50,
        actor_id="system",
    )
    events = list(agg.pending_events)
    failed = [e for e in events if type(e).__name__ == "StageRunFailed"]
    assert len(failed) == 1
    assert failed[0].error_message == "CUDA OOM"
    assert failed[0].actor_id == "system"


def test_stage_forced_stale_event_fires() -> None:
    """Calling record_stage_forced_stale appends a StageForcedStale event."""
    from pdomain_prep_for_pgdp.core.pipeline.prep_aggregate import PrepProjectAggregate

    project_id = uuid.uuid4()
    agg = PrepProjectAggregate(project_id=project_id)
    agg.record_stage_forced_stale(
        stage_id="threshold",
        page_id="0001",
        caused_by_stage="crop",
        actor_id="system",
    )
    events = list(agg.pending_events)
    stale = [e for e in events if type(e).__name__ == "StageForcedStale"]
    assert len(stale) == 1
    assert stale[0].caused_by_stage == "crop"


def test_review_decision_event_fires() -> None:
    """Calling record_review_decision appends a ReviewDecision event."""
    from pdomain_prep_for_pgdp.core.pipeline.prep_aggregate import PrepProjectAggregate

    project_id = uuid.uuid4()
    agg = PrepProjectAggregate(project_id=project_id)
    agg.record_review_decision(
        stage_id="text_review",
        page_id="0001",
        decision="clean",
        note=None,
        actor_id="user1",
    )
    events = list(agg.pending_events)
    decisions = [e for e in events if type(e).__name__ == "ReviewDecision"]
    assert len(decisions) == 1
    assert decisions[0].decision == "clean"
    assert decisions[0].actor_id == "user1"


def test_page_reorder_event_fires() -> None:
    """Calling record_page_reorder appends a PageReorder event."""
    from pdomain_prep_for_pgdp.core.pipeline.prep_aggregate import PrepProjectAggregate

    project_id = uuid.uuid4()
    agg = PrepProjectAggregate(project_id=project_id)
    agg.record_page_reorder(
        new_order=["0001", "0000"],
        previous_order=["0000", "0001"],
        actor_id="user1",
    )
    events = list(agg.pending_events)
    reorders = [e for e in events if type(e).__name__ == "PageReorder"]
    assert len(reorders) == 1
    assert reorders[0].new_order == ["0001", "0000"]
    assert reorders[0].previous_order == ["0000", "0001"]


def test_gate_confirmation_event_fires() -> None:
    """Calling record_gate_confirmation appends a GateConfirmation event."""
    from pdomain_prep_for_pgdp.core.pipeline.prep_aggregate import PrepProjectAggregate

    project_id = uuid.uuid4()
    agg = PrepProjectAggregate(project_id=project_id)
    agg.record_gate_confirmation(
        gate="two_step_delete",
        target_id="proj-abc",
        actor_id="user1",
    )
    events = list(agg.pending_events)
    gates = [e for e in events if type(e).__name__ == "GateConfirmation"]
    assert len(gates) == 1
    assert gates[0].gate == "two_step_delete"


def test_settings_change_event_fires() -> None:
    """Calling record_settings_change appends a SettingsChange event."""
    from pdomain_prep_for_pgdp.core.pipeline.prep_aggregate import PrepProjectAggregate

    project_id = uuid.uuid4()
    agg = PrepProjectAggregate(project_id=project_id)
    agg.record_settings_change(
        scope="stage",
        stage_id="threshold",
        before={"threshold_level": None},
        after={"threshold_level": 120},
        actor_id="user1",
    )
    events = list(agg.pending_events)
    changes = [e for e in events if type(e).__name__ == "SettingsChange"]
    assert len(changes) == 1
    assert changes[0].before == {"threshold_level": None}
    assert changes[0].after == {"threshold_level": 120}


def test_wordlist_promotion_event_fires() -> None:
    """Calling record_wordlist_promotion appends a WordlistPromotion event."""
    from pdomain_prep_for_pgdp.core.pipeline.prep_aggregate import PrepProjectAggregate

    project_id = uuid.uuid4()
    agg = PrepProjectAggregate(project_id=project_id)
    agg.record_wordlist_promotion(
        word="colour",
        source_stage="wordcheck",
        source_page_id="0005",
        list_scope="project",
        actor_id="user1",
    )
    events = list(agg.pending_events)
    promotions = [e for e in events if type(e).__name__ == "WordlistPromotion"]
    assert len(promotions) == 1
    assert promotions[0].word == "colour"
    assert promotions[0].list_scope == "project"


def test_split_fanout_event_fires() -> None:
    """Calling record_split_fanout appends a SplitFanout event."""
    from pdomain_prep_for_pgdp.core.pipeline.prep_aggregate import PrepProjectAggregate

    project_id = uuid.uuid4()
    agg = PrepProjectAggregate(project_id=project_id)
    children = [
        {"page_id": "0001a", "split_index": 1, "source_crop_bbox": [0, 0, 300, 400]},
        {"page_id": "0001b", "split_index": 2, "source_crop_bbox": [300, 0, 600, 400]},
    ]
    agg.record_split_fanout(
        parent_page_id="0001",
        split_stage="text_zones",
        children=children,
        actor_id="system",
    )
    events = list(agg.pending_events)
    fanouts = [e for e in events if type(e).__name__ == "SplitFanout"]
    assert len(fanouts) == 1
    assert fanouts[0].parent_page_id == "0001"
    assert len(fanouts[0].children) == 2


def test_all_events_have_actor_id() -> None:
    """Every PrepProjectAggregate event method stores actor_id on the event."""
    from pdomain_prep_for_pgdp.core.pipeline.prep_aggregate import PrepProjectAggregate

    project_id = uuid.uuid4()
    agg = PrepProjectAggregate(project_id=project_id)

    agg.record_stage_run_started("grayscale", "0001", "job-1", actor_id="alice")
    agg.record_stage_run_completed("grayscale", "0001", "clean", 100, "k/v", actor_id="alice")
    agg.record_stage_run_failed("ocr", "0001", "err", 50, actor_id="system")
    agg.record_stage_forced_stale("threshold", "0001", "crop", actor_id="system")

    # All pipeline-lifecycle events (not the creation event) must carry actor_id
    pipeline_events = [
        e for e in agg.pending_events if type(e).__name__ not in ("PrepProjectCreated", "Created")
    ]
    assert len(pipeline_events) >= 4, "expected at least 4 pipeline events"
    for ev in pipeline_events:
        assert hasattr(ev, "actor_id"), f"event {type(ev).__name__} missing actor_id field"
        assert ev.actor_id in ("alice", "system"), (
            f"unexpected actor_id on {type(ev).__name__}: {ev.actor_id}"
        )


def test_prep_aggregate_persists_and_loads(tmp_path: Path) -> None:
    """PrepProjectAggregate events persist to events.db and reload correctly."""
    from pdomain_prep_for_pgdp.core.pipeline.prep_aggregate import (
        PrepApplication,
        PrepProjectAggregate,
    )

    db_path = tmp_path / "events.db"
    app = PrepApplication(
        env={
            "PERSISTENCE_MODULE": "eventsourcing.sqlite",
            "SQLITE_DBNAME": str(db_path),
        }
    )

    project_id = uuid.uuid4()
    agg = PrepProjectAggregate(project_id=project_id)
    agg.record_stage_run_started("grayscale", "0001", "job-1", actor_id="default")
    app.save(agg)

    # Reload
    loaded = app.repository.get(agg.id)
    assert loaded is not None
    # The aggregate state should be reconstructable (no crash)
    assert loaded.id == agg.id
