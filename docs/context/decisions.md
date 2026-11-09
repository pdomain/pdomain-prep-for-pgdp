---
Status: active
Kind: decision
Last verified: 2026-11-07
---

# Decisions and lifecycle tombstones

## Agent Index

- **Kind:** decision
- **Status:** active
- **Last verified:** 2026-11-07
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
- `docs/issues/2026-07-21-w00-text-chain-contract.md`
- `docs/issues/2026-07-21-w02-project-stage-job-adapter.md`
- `docs/issues/2026-07-21-w03-text-review-attestation.md`
- `docs/issues/2026-07-21-w04-multi-page-stage-run.md`
- `docs/issues/2026-07-21-w05-text-zones-split-contract.md`
- `docs/issues/2026-07-21-w06-golden-path-ci.md`

## 2026-11-06 retirement tombstones

### 2026-11-06 Retired: Wave 0 book-path issues

- Old path: `docs/issues/2026-07-21-w00-text-chain-contract.md`
- Old path: `docs/issues/2026-07-21-w02-project-stage-job-adapter.md`
- Old path: `docs/issues/2026-07-21-w03-text-review-attestation.md`
- Old path: `docs/issues/2026-07-21-w04-multi-page-stage-run.md`
- Old path: `docs/issues/2026-07-21-w05-text-zones-split-contract.md`
- Old path: `docs/issues/2026-07-21-w06-golden-path-ci.md`
- Outcome: implemented
- Superseded by: `docs/architecture/03-pipeline.md` section Book path contracts
- Removal commit: 6b2db15c51323f539ebce28d8b7d517dbd78a54f
- Rationale kept: `docs/architecture/03-pipeline.md` and the tests named in that section
- Remaining work: none for Wave 0. Wave 1 and later stay on the completion plan.

### 2026-11-07 Retired: Wave 1 text and pack issues

- Old path: `docs/issues/2026-07-21-w11-regex-full-postprocess.md`
- Old path: `docs/issues/2026-07-21-w12-wordcheck-scanno-list.md`
- Old path: `docs/issues/2026-07-21-w13-hyphen-join-decisions.md`
- Old path: `docs/issues/2026-07-21-w14-text-tools-live-sse.md`
- Old path: `docs/issues/2026-07-21-w15-illustrations-extract.md`
- Old path: `docs/issues/2026-07-21-w16-validation-preflight.md`
- Old path: `docs/issues/2026-07-21-w17-build-package-cover-oxipng.md`
- Outcome: implemented
- Superseded by: `docs/architecture/03-pipeline.md` section Book path contracts
- Removal commit: 2633a4dba7dc6ec4b3f639409611a3a80c7c56d5
- Rationale kept: `docs/architecture/03-pipeline.md` and the tests named in that section
- Remaining work: regex can still join a kept hyphen when the prefix is on the join list.
  A hyphen POST does not mark project stages dirty.
  A failed decision commit can leave `decisions.json` ahead of `output.txt`.
  A corrupt decision file is treated as empty.
  A failed OCR load during hydrate keeps the live channel closed until the tool is opened again.
  Wave 2 and later stay on the completion plan.

## 2026-11-07 plan consolidation

### Retired: numbering-runs P1–P3 implementation plan

- Old path: `docs/plans/2026-06-17-page-numbering-runs-model.md`
- Outcome: implemented
- Superseded by: [page-numbering architecture](../architecture/08-page-numbering.md)
- Removal commit: e0d64e0bbba5cec43ccc4f8936d19fc569d531a8
- Rationale kept: runs, counted blanks, marker handling, persistence, manifest v2, registry-v3 migration,
  and the interior-skip correction remain in architecture.
- Evidence: `814510d`, `29144a8`, `af6c807`, `f57b5f0`, `1e36ce5`, and the numbering tests cited there.
- Remaining work: OCR-folio detector, persisted flags and advance gate (W3.9); broader Source
  back/duplicate/inserted-kind design; faithful upper-case Roman and alphabetic UI round trips (intent map).

### Retired: Source/grayscale completion and fidelity plans

- Old path: `docs/plans/hifi-loader-source-grayscale-complete.md`
- Old path: `docs/plans/hifi-deferred-items-fixes.md`
- Outcome: implemented
- Superseded by: [image preparation and settings](../architecture/09-image-prep-settings.md)
- Removal commit: e0d64e0bbba5cec43ccc4f8936d19fc569d531a8
- Rationale kept: ingest thumbnails, reversible removal, event-recorded mutations, project-channel SSE,
  real grayscale images, and distinct durable back/duplicate labels remain in architecture.
- Evidence: `0c12b37`, `363bfaf`, `a2e09d8`, `bbe6e66`, `805053f`, and the tests cited there.
- Remaining work: archived-project Save a copy was explicitly outside these arcs and remains W3.10.
  Live screenshot/GPU verification was not repeated during this consolidation.

### Retired: original GPU grayscale and shared-settings plan

- Old path: `docs/plans/grayscale-gpu-and-shared-settings-tiers.md`
- Outcome: superseded by shipped implementation and the active W2.5 follow-up
- Superseded by: [image preparation and settings](../architecture/09-image-prep-settings.md)
- Removal commit: e0d64e0bbba5cec43ccc4f8936d19fc569d531a8
- Rationale kept: tier storage and precedence, CUDA-to-GPU dispatch, device selection, and the composable
  grayscale pipeline replace the earlier flat mode/gamma design.
- Evidence: `9df1101`, `825f287`, `244cbc0`, `aadd1a7`, `8159659`, `7894d32`, and the tests cited there.
- Deviation: app-wide preferences have no project event log; the proposal's all-tier event logging did not ship literally.
- Remaining work: non-grayscale settings UI is W2.5. Compute panel and representative-book GPU validation remain deferred.

### Retired: July review-fixes plan and residual umbrella

- Old path: `docs/plans/2026-07-14-review-fixes.md`
- Old path: `docs/issues/2026-07-21-parallel-2026-07-14-review-fixes.md`
- Outcome: implemented
- Superseded by: [backend safeguards](../architecture/02-backend.md#suite-identity-authentication-and-job-safeguards)
  and [frontend authentication](../architecture/04-frontend.md#auth-in-the-spa)
- Removal commit: e0d64e0bbba5cec43ccc4f8936d19fc569d531a8
- Rationale kept: suite middleware avoids included-router topology traps; preferences migrate without clobbering;
  enqueue resolves device; timeouts do not kill OS threads; ZIP reads leave the event loop; rerun creates jobs;
  SPA suite calls authenticate. The dependency pin already exceeds the requested minimum.
- Evidence: `e575a58`, `5c51cbd`, `2138459`, `5486c4b`, `3b45464`, `6aadd44`, `7dbf3fa`, and `29f60ca`.
- Remaining work: none of the original nine tasks. W3.8 remains open for broader architecture verification.
  This supersedes the umbrella's partial-task-8 assessment and its obsolete claim that W0.4 remained open.

## 2026-11-07 source verification and warning audit

The audit reviewed all 36 age warnings against repository source, configuration, tests, or normative pointers.
Verification dates on historical research cover its current repository boundary only; external research,
licenses, release state, benchmark estimates, and live deployments were not rechecked.
Normative owner rules were preserved. Architecture now distinguishes implementation deviations from locked intent.
The earlier numbering receipt's reference to an unfinished advance gate is corrected by current source:
`fetchFolios`, reconciliation, and `sequenceClean` exist; real detector integration remains W3.9.

### Retired: Ruff version-skew report

- Old path: `docs/issues/2026-08-08-ruff-version-skew.md`
- Outcome: implemented
- Superseded by: [lint toolchain](../architecture/07-testing.md#lint-toolchain)
- Removal commit: 2a78a794303a20707740cb399e6efc05fffee10f
- Evidence: `9e6ebf1`, `tests/test_lint_toolchain_pinned.py`, pre-commit, pyproject.toml, and uv.lock.
  Hook, lock, and minimum now agree on 0.16.7, with hook/lock and floor guards.
- Rationale kept: independent hook/project versions must be compared, not merely bumped once.
- Remaining work: none of this report. August counts and findings remain historical in Git.

### Retired: dependency-refresh auto-land report

- Old path: `docs/issues/2026-08-08-dep-refresh-cannot-auto-land.md`
- Outcome: superseded
- Superseded by: [local build/release commands](../architecture/06-deployment.md#build-and-release-commands)
- Removal commit: 2a78a794303a20707740cb399e6efc05fffee10f
- Evidence: `e22bdd2` removed workflows. The repository no longer has a dependency-refresh scheduler.
- Rationale kept: dated branches can accumulate under the former design; local release scripts now own this checkout.
- Remaining work: none for the removed workflow. No remote repository settings or sibling branch counts were rechecked.

### Retired: architecture freshness report W3.8

- Old path: `docs/issues/2026-07-21-w38-stale-docs-refresh.md`
- Outcome: implemented
- Superseded by: [overview](../architecture/01-overview.md), [backend](../architecture/02-backend.md),
  [frontend](../architecture/04-frontend.md), and [convergence history/current corrections](../architecture/statechart-convergence-notes.md)
- Removal commit: 2a78a794303a20707740cb399e6efc05fffee10f
- Evidence: source audit of registry, bootstrap, job/stage writers, API inventory, frontend services/tools,
  current dependency constraints, and repository build/release scripts on 2026-11-07.
- Rationale kept: current contracts must be separated from convergence-era design and dated decision history.
- Remaining work: product gaps remain in their active issues, including W2.1–W2.5 and W3.2–W3.7/W3.9/W3.10.
  Their existence does not make an accurately documented missing feature a remaining W3.8 defect.

### 2026-11-09 Retired: Issue-tracker migration handoff (2026-07-17)

- Old path: `docs/handoff/2026-07-17-issue-tracker-migration.md`
- Outcome: abandoned
- Superseded by: the GitHub issue migration entry in [intent map](intent-map.md)
- Removal commit: (fill after commit)
- Rationale kept: The migration never started. All 48 issues are still open on GitHub. Only the
  `docs/issues/` scaffold from `6d8c4ac` shipped. The open work and the where-to-file question now
  live in the intent map.
- Remaining work: the GitHub issue migration in the intent map

### 2026-11-09 Retired: Pipeline completion queue handoff (2026-07-21)

- Old path: `docs/handoff/2026-07-21-142632-pipeline-completion-queue.md`
- Outcome: superseded
- Superseded by: [completion plan](../plans/2026-07-21-pipeline-completion-review.md) and
  [current state](current-state.md)
- Removal commit: (fill after commit)
- Rationale kept: Wave 0 and Wave 1 shipped, with removal commits `6b2db15` and `2633a4d` recorded
  above. The local-first priority is in the intent map. The queue resumes at Wave 2 under the issues
  index.
- Remaining work: Wave 2 onward, already tracked in the issues index
