"""PrepProjectAggregate — eventsourcing aggregate for v2 pipeline events.

Spec: docs/specs/stage-registry-v2.md §5 (event vocabulary)
      docs/specs/library-placement.md §4.1 (app-local aggregate, not promoted to ops)

New v2 event types (10 total, PascalCase per ops convention):
  StageRunStarted, StageRunCompleted, StageRunFailed, StageForcedStale,
  ReviewDecision, PageReorder, GateConfirmation, SettingsChange,
  WordlistPromotion, SplitFanout

Every event carries: actor_id, plus eventsourcing-implicit originator_id /
originator_version / timestamp.

Coexistence: both PrepProjectAggregate (this module) and pdomain_ops.page_aggregate
ProjectAggregate share the same events.db via aggregate UUID routing — the
eventsourcing library dispatches by aggregate ID, so they never collide.

This module is intentionally NOT promoted to pdomain-ops (library-placement.md
§4.1: PGDP-pipeline-domain events, not generic page-record events).
"""

from __future__ import annotations

import uuid
from typing import Any, Literal
from uuid import UUID

from eventsourcing.application import Application
from eventsourcing.domain import Aggregate, event


class PrepProjectAggregate(Aggregate):
    """Per-project event-sourced aggregate for v2 PGDP pipeline events.

    ``id`` is derived from the project_id UUID so it is stable across
    sessions — pass the same ``project_id`` to reconstruct the aggregate
    from stored events.

    Usage::

        project_id = uuid.UUID("...")
        agg = PrepProjectAggregate(project_id=project_id)
        agg.record_stage_run_started("grayscale", "0001", "job-1", actor_id="default")
        app.save(agg)
    """

    @event("PrepProjectCreated")
    def __init__(self, project_id: UUID) -> None:
        self._project_id = project_id

    @staticmethod
    def create_id(project_id: UUID) -> UUID:
        """Derive a stable aggregate ID from the project_id.

        Uses a deterministic UUID5 in the prep-for-pgdp namespace so the
        same project_id always maps to the same aggregate ID, even across
        process restarts.
        """
        _NS = UUID("6d7c8e9a-0b1c-4d2e-8f3a-5c6d7e8f9a0b")
        return uuid.uuid5(_NS, str(project_id))

    @property
    def project_id(self) -> UUID:
        return self._project_id

    # ── Stage run lifecycle ──────────────────────────────────────────────────

    @event("StageRunStarted")
    def record_stage_run_started(
        self,
        stage_id: str,
        page_id: str | None,
        job_id: str,
        actor_id: str,
    ) -> None:
        """Record that a stage execution has begun."""

    @event("StageRunCompleted")
    def record_stage_run_completed(
        self,
        stage_id: str,
        page_id: str | None,
        status: Literal["clean", "flagged"],
        duration_ms: int,
        artifact_key: str,
        actor_id: str,
    ) -> None:
        """Record successful stage completion."""

    @event("StageRunFailed")
    def record_stage_run_failed(
        self,
        stage_id: str,
        page_id: str | None,
        error_message: str,
        duration_ms: int,
        actor_id: str,
    ) -> None:
        """Record stage execution failure."""

    @event("StageForcedStale")
    def record_stage_forced_stale(
        self,
        stage_id: str,
        page_id: str | None,
        caused_by_stage: str,
        actor_id: str,
    ) -> None:
        """Record that a stage was marked stale by an upstream re-run."""

    # ── Review and decisions ────────────────────────────────────────────────

    @event("ReviewDecision")
    def record_review_decision(
        self,
        stage_id: str,
        page_id: str,
        decision: Literal["clean", "flagged", "reviewed"],
        note: str | None,
        actor_id: str,
    ) -> None:
        """Record a reviewer's decision on a page within a stage."""

    # ── Page ordering ───────────────────────────────────────────────────────

    @event("PageReorder")
    def record_page_reorder(
        self,
        new_order: list[str],
        previous_order: list[str],
        actor_id: str,
    ) -> None:
        """Record a page reorder mutation (full before/after for reindex)."""

    # ── Gate confirmations ──────────────────────────────────────────────────

    @event("GateConfirmation")
    def record_gate_confirmation(
        self,
        gate: Literal["two_step_delete", "submit_confirm"],
        target_id: str,
        actor_id: str,
    ) -> None:
        """Record a two-step gate confirmation."""

    # ── Settings changes ────────────────────────────────────────────────────

    @event("SettingsChange")
    def record_settings_change(
        self,
        scope: Literal["stage", "project"],
        stage_id: str | None,
        before: dict[str, Any],
        after: dict[str, Any],
        actor_id: str,
    ) -> None:
        """Record a stage or project settings change (full before/after)."""

    # ── Word list promotion ─────────────────────────────────────────────────

    @event("WordlistPromotion")
    def record_wordlist_promotion(
        self,
        word: str,
        source_stage: str,
        source_page_id: str,
        list_scope: Literal["project", "global"],
        actor_id: str,
    ) -> None:
        """Record a word promotion to the project or global word list."""

    # ── Split fanout ─────────────────────────────────────────────────────────

    @event("SplitFanout")
    def record_split_fanout(
        self,
        parent_page_id: str,
        split_stage: str,
        children: list[dict[str, Any]],
        actor_id: str,
    ) -> None:
        """Record text_zones APPLY_SPLIT creating sibling pages."""


class PrepApplication(Application[UUID]):
    """Eventsourcing application that persists PrepProjectAggregate events.

    Coexists with pdomain_ops.page_aggregate.PagesApplication in the same
    events.db via aggregate UUID routing (eventsourcing dispatches by ID).

    Usage::

        app = PrepApplication(env={
            "PERSISTENCE_MODULE": "eventsourcing.sqlite",
            "SQLITE_DBNAME": str(db_path),
        })
        agg = PrepProjectAggregate(project_id=uuid.uuid4())
        app.save(agg)
        loaded = app.repository.get(agg.id)
    """
