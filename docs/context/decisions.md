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

The removal commit is the migration commit containing these tombstones.

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
