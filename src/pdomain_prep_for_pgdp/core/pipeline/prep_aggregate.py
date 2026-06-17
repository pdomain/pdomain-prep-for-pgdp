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

    # ── Page mutations (hi-fi Source/Files slice) ────────────────────────────

    @event("PageTypeChanged")
    def record_page_type_changed(
        self,
        page_id: str,
        previous_type: str,
        new_type: str,
        actor_id: str,
    ) -> None:
        """Record a page_type change (normal/blank/plate_b/plate_p/plate_r/skip/cover)."""

    @event("PageIgnoreSet")
    def record_page_ignore_set(
        self,
        page_id: str,
        ignore: bool,
        actor_id: str,
    ) -> None:
        """Record setting or clearing the ignore (soft-exclude) flag for a page.

        Tracked so the change is reversible and appears in project history.
        ``ignore=True`` means the page is excluded from the output package;
        ``ignore=False`` restores it.  The `page_type` field is not changed
        by this operation — ignore is orthogonal to type classification.
        """

    @event("PageRoleSet")
    def record_page_role_set(
        self,
        page_id: str,
        previous_role: str | None,
        new_role: str | None,
        actor_id: str,
    ) -> None:
        """Record setting the page_role sub-label (e.g. "back", "duplicate", or None).

        page_role is distinct from page_type: both "back" and "duplicate" map
        to page_type="skip" for packaging, but page_role preserves the user's
        distinct label so the Source/Files UI chip survives reload.

        Recorded alongside any PageTypeChanged event in the same handler
        invocation (dual-write contract: one handler call, two events).
        ``new_role=None`` clears the role (page becomes a plain skip or normal).
        """

    @event("PageInserted")
    def record_page_inserted(
        self,
        at_idx0: int,
        new_page_id: str,
        actor_id: str,
    ) -> None:
        """Record insertion of a new blank page at a given position.

        ``at_idx0`` is the final idx0 of the inserted page after shifting.
        Reversible via the event log (reindex can replay this event).
        """

    # ── Numbering runs (P1/P2/P3 leaf+runs events) ──────────────────────────

    @event("NumberingRunsChanged")
    def record_numbering_runs_changed(
        self,
        before: list[dict[str, Any]],
        after: list[dict[str, Any]],
        actor_id: str,
    ) -> None:
        """Record a full-array replacement of the project's numbering runs.

        ``before`` is the runs list prior to the change (empty list on first
        write); ``after`` is the new runs list as dicts (NumberingRun.model_dump).
        """

    @event("LeafRoleSet")
    def record_leaf_role_set(
        self,
        page_id: str,
        previous_role: str | None,
        new_role: str | None,
        actor_id: str,
    ) -> None:
        """Record setting or clearing the leaf role for a page."""

    @event("LeafRunSet")
    def record_leaf_run_set(
        self,
        page_id: str,
        previous_run_id: str | None,
        new_run_id: str | None,
        actor_id: str,
    ) -> None:
        """Record assigning a page to a numbering run (or clearing the assignment)."""

    @event("FolioOverridden")
    def record_folio_overridden(
        self,
        page_id: str,
        label_override: str | None,
        actor_id: str,
    ) -> None:
        """Record a manual folio label override for a page.

        ``label_override=None`` clears a prior override (reverts to computed label).
        """

    @event("PlateTagSet")
    def record_plate_tag_set(
        self,
        page_id: str,
        plate_tag: str | None,
        actor_id: str,
    ) -> None:
        """Record setting or clearing the plate-type tag for a page.

        ``plate_tag`` is one of the plate sub-type strings ("b", "p", "r") or
        ``None`` to clear the tag.
        """


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
