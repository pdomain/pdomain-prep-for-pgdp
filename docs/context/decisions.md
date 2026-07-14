# Decisions and lifecycle tombstones

## Agent Index

- **Kind:** decision
- **Status:** active
- **Read when:** researching durable choices, implementation deviations, or retired documents.
- **Search terms:** decisions, tombstones, retired specs, implementation deviations.

## Context

The 2026-07-14 docgraph migration compared legacy documents with current code, tests, architecture, and concrete
implementation commits. Much of the live retrieval set described completed implementation waves or
pre-convergence UI.

## Decision

Current architecture, generated OpenAPI, source, and tests replace completed execution plans and superseded design
briefs. Useful unbuilt ideas move to [the intent map](intent-map.md). Historical rationale and changed direction
stay here.

## Consequences

Live retrieval becomes smaller and current. Git history retains deleted execution detail. This file records why
each group retired and where its durable content remains.

## Supersedes / Superseded-by

This ledger supplements [architecture decisions](../decisions/architecture-decisions.md). It does not replace
that document's product decisions.

## Implementation deviations preserved

- The pipeline moved from older numbered steps and registry v2 to the current 24-stage, version 3 registry.
- Backend project-wide fan-out shipped and was later removed in favor of frontend-driven per-stage execution.
- Statechart convergence replaced legacy page-specific surfaces with XState v5 machines and a single tool registry.
- Word deletion shipped with persistent restore rather than the proposed five-second timer.
- GPU memory work shipped in phase order 1, 3, then 2. The proposed representative performance benchmark was not
  recorded as completed.

## 2026-07-14 retirement tombstones

Removal commit: `fdd88cd`.

- `specs/00-overview.md` through `specs/09-deployment.md` and `specs/REFACTOR-PROPOSAL.md`: superseded initial
  design set. Current architecture, generated OpenAPI, code, and tests replace it. The migration review found
  material divergence in registry version, XState ownership, API generation, and page persistence.

- `docs/archive/architecture/legacy-docs-readme.md`: superseded navigation. `docs/README.md` and current
  architecture replace it.
- `docs/archive/plans/2026-05-16-backend-quality-hardening.md`: implemented. Its safeguards remain in code/tests
  and architecture.
- `docs/archive/plans/roadmap-shipped.md`: historical ledger; material deviations are retained here and in git history.
- `docs/archive/research/code-quality-audit-2026-05-16.md`: resolved point-in-time audit. Its safety rationale
  remains in current tests and decisions.
- `docs/archive/specs/*.md`: implemented or superseded early designs. Current pipeline/frontend architecture and
  residual intent replace them.
- `docs/plans/2026-06-10-statechart-convergence.md` and `docs/plans/design_handoff_pgdp_app/**`:
  implemented/superseded. `docs/architecture/statechart-convergence-notes.md` and current frontend code replace
  them.
- `docs/plans/2026-06-11-gpu-memory-pipeline.md`: implemented with the phase-order and benchmark deviations
  retained above.
- `docs/plans/2026-06-11-seam-remediation.md` and `docs/plans/2026-06-12-residue-cleanup-prompt.md`:
  implemented/partial. The intent map retains the unresolved residue.
- `docs/plans/2026-06-15-grayscale-pipeline-implementation.md`: implemented. Current grayscale code, tests, and
  architecture replace the checklist.
- `docs/plans/pd-ui-design-handoff-implementation.md`: superseded mixed implementation plan. Current convergence
  architecture replaces it.
- `docs/research/2026-05-22-deep-code-review-security-scan.md`: retired historical scan. Shipped security
  invariants remain in tests, while unresolved hardening remains deferred.
- `docs/specs/2026-05-24-issue-123-*.md` through `issue-130-*.md`: implemented security fixes. Current route/core
  tests and security invariants replace the plans.
- `docs/specs/2026-06-10-statechart-convergence-design.md`, `pipeline-task-model.md`, `stage-registry-v2.md`,
  `machine-stage-map.md`, `library-placement.md`, and `api-v2-deltas.md`: implemented and then superseded by
  current architecture, registry version 3, code, and generated OpenAPI.
- `docs/specs/2026-06-15-grayscale-pipeline.md` and `2026-06-15-page-numbering-runs-model.md`: implemented. Current
  code/tests and registry version 3 replace execution projections.
- `docs/specs/design-brief-index.md`, `design-system.md`, `existing-ui/**`, and `workflows/**`: pre-convergence
  design bundle. Current UI architecture replaces shipped portions, and the intent map preserves worthwhile
  unbuilt ideas.
- `docs/specs/futures-managed-adapter-pgdp.md`: deferred note retired from live specs after its managed-adapter
  ideas moved to the intent map.

## Removed-path audit

Commit `fdd88cd` removed every path below. The grouped tombstones above record each path's outcome, replacement,
retained rationale, and remaining work; this literal list makes the per-document audit trail searchable.

- `docs/archive/architecture/legacy-docs-readme.md`
- `docs/archive/plans/2026-05-16-backend-quality-hardening.md`
- `docs/archive/plans/roadmap-shipped.md`
- `docs/archive/research/code-quality-audit-2026-05-16.md`
- `docs/archive/specs/2026-05-11-pipeline-task-model-design.md`
- `docs/archive/specs/2026-05-11-project-fanout-awaiting-review-design.md`
- `docs/archive/specs/2026-05-11-search-across-pages-design.md`
- `docs/archive/specs/2026-05-13-konva-rotate-design.md`
- `docs/archive/specs/2026-05-13-m4-migration-disk-cost-design.md`
- `docs/archive/specs/2026-05-13-word-delete-undo-design.md`
- `docs/archive/specs/2026-05-15-hifi-redesign-plan-session-prompt.md`
- `docs/archive/specs/2026-05-16-ui-design-documentation-for-claude-design-plan.md`
- `docs/plans/2026-06-10-statechart-convergence.md`
- `docs/plans/2026-06-11-gpu-memory-pipeline.md`
- `docs/plans/2026-06-11-seam-remediation.md`
- `docs/plans/2026-06-12-residue-cleanup-prompt.md`
- `docs/plans/2026-06-15-grayscale-pipeline-implementation.md`
- `docs/plans/design_handoff_pgdp_app/COMPONENT_INDEX.md`
- `docs/plans/design_handoff_pgdp_app/PROMPT.md`
- `docs/plans/design_handoff_pgdp_app/README.md`
- `docs/plans/design_handoff_pgdp_app/statechart-authoring-guide.md`
- `docs/plans/design_handoff_pgdp_app/statecharts/README.md`
- `docs/plans/design_handoff_pgdp_app/statecharts/pipeline-plan.md`
- `docs/plans/pd-ui-design-handoff-implementation.md`
- `docs/research/2026-05-22-deep-code-review-security-scan.md`
- `docs/specs/2026-05-11-workbench-artifact-viewer-design.md`
- `docs/specs/2026-05-15-hifi-redesign-plan.md`
- `docs/specs/2026-05-24-issue-123-spa-fallback-path-traversal.md`
- `docs/specs/2026-05-24-issue-124-cdn-auth-bypass.md`
- `docs/specs/2026-05-24-issue-126-job-retry-payload-override.md`
- `docs/specs/2026-05-24-issue-127-ingest-arbitrary-source-key.md`
- `docs/specs/2026-05-24-issue-128-packaging-filename-escape.md`
- `docs/specs/2026-05-24-issue-129-resource-bounds.md`
- `docs/specs/2026-05-24-issue-130-text-review-lost-edits.md`
- `docs/specs/2026-05-24-pd-ui-design-handoff-implementation.md`
- `docs/specs/2026-06-10-statechart-convergence-design.md`
- `docs/specs/2026-06-15-grayscale-pipeline.md`
- `docs/specs/2026-06-15-page-numbering-runs-model.md`
- `docs/specs/api-v2-deltas.md`
- `docs/specs/design-brief-index.md`
- `docs/specs/design-system.md`
- `docs/specs/existing-ui/00-project-list.md`
- `docs/specs/existing-ui/01-new-project.md`
- `docs/specs/existing-ui/02-jobs-page.md`
- `docs/specs/existing-ui/03-project-configure.md`
- `docs/specs/existing-ui/04-page-workbench.md`
- `docs/specs/existing-ui/05-text-review.md`
- `docs/specs/existing-ui/06-crops-grid.md`
- `docs/specs/existing-ui/07-review-queue.md`
- `docs/specs/existing-ui/08-settings.md`
- `docs/specs/existing-ui/09-shell.md`
- `docs/specs/futures-managed-adapter-pgdp.md`
- `docs/specs/library-placement.md`
- `docs/specs/machine-stage-map.md`
- `docs/specs/pipeline-task-model.md`
- `docs/specs/stage-registry-v2.md`
- `docs/specs/workflows/WF-01-folder-upload.md`
- `docs/specs/workflows/WF-02-package-validation.md`
- `docs/specs/workflows/WF-03-source-quality.md`
- `docs/specs/workflows/WF-04-metadata-collection.md`
- `docs/specs/workflows/WF-05-hyphen-join-workbench.md`
- `docs/specs/workflows/WF-06-regex-workbench.md`
- `docs/specs/workflows/WF-07-project-comments.md`
- `docs/specs/workflows/WF-08-illustration-format.md`
- `docs/specs/workflows/WF-09-page-reorder.md`
- `docs/specs/workflows/WF-10-batch-crop-review.md`
- `docs/specs/workflows/WF-11-gegl-grayscale.md`
- `docs/specs/workflows/WF-12-settings-enhancements.md`
- `specs/00-overview.md`
- `specs/01-book-config.md`
- `specs/02-pipeline-steps.md`
- `specs/03-ui-layout.md`
- `specs/04-gpu-acceleration.md`
- `specs/05-illustrations.md`
- `specs/06-page-workbench.md`
- `specs/07-api-design.md`
- `specs/08-data-models.md`
- `specs/09-deployment.md`
- `specs/REFACTOR-PROPOSAL.md`
