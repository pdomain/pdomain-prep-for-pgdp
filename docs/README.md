---
Kind: process
Status: active
Owner: CT
Created: 2026-07-14
Last verified: 2026-11-12
---

# docs/

## Agent Index

- **Kind:** process
- **Status:** active
- **Last verified:** 2026-11-12
- **Read when:** locating current architecture, intent, decisions, plans, research, or runbooks.
- **Search terms:** documentation index, architecture, plans, process, context.

This index explains where each type of repository documentation belongs and links to the current set.

| Folder | Purpose | Use when |
| --- | --- | --- |
| `architecture/` | How the system works today. | Capturing current modules, data flow, contracts, and diagrams. |
| `archive/` | Cold storage for the nine active folders. | A doc is shipped, superseded, or abandoned. |
| `decisions/` | Dated, append-only ADRs. | Recording a choice, context, alternatives, and consequences. |
| `plans/` | Active execution — what order to make a spec real. | Sequencing work for an approved spec. |
| `process/` | Cross-cutting workflow conventions. | Capturing verification, merge, release, and other team practices. |
| `research/` | Investigation in progress. Messy by design. | Exploring before committing to a design. |
| `runbooks/` | Operational reference. | An on-call or ops task needs a recipe. |
| `specs/` | Aspirational, pre-implementation design. | Describing what to build, before code. |
| `templates/` | Issue, spec, plan, ADR boilerplate. | Adding a starter template for a new doc type. |
| `usage/` | How to consume this app, tool, or library. | A user or integrator needs usage guidance. |

Empty folders are intentional and tracked via `.gitkeep`.

The forward queue is the [roadmap](plans/roadmap.md). Evidence for open defects lives in
[local issue reports](issues/README.md). The
[July pipeline review](plans/2026-07-21-pipeline-completion-review.md) is the record of Waves 0–3.
Open work no longer lives in GitHub Issues. The 2026-11-09
[cutover decision](decisions/2026-11-09-github-issues-cutover.md) maps each former issue to its new place.

## Current documentation

- Context: [current state](context/current-state.md), [intent map](context/intent-map.md), and
  [decisions and tombstones](context/decisions.md).
- Architecture: [overview](architecture/01-overview.md), [backend](architecture/02-backend.md),
  [pipeline](architecture/03-pipeline.md), [frontend](architecture/04-frontend.md),
  [events and jobs](architecture/05-events-and-jobs.md), [deployment](architecture/06-deployment.md),
  [testing](architecture/07-testing.md), and
  [statechart convergence](architecture/statechart-convergence-notes.md),
  [page numbering](architecture/08-page-numbering.md), and
  [image preparation and settings](architecture/09-image-prep-settings.md), and
  [repository boundary](architecture/10-repository-boundary.md).
- Durable decisions: [architecture decisions](decisions/architecture-decisions.md),
  [API-key server-side proxy](decisions/2026-05-23-apikey-server-side-proxy.md), and
  [roadmap is the queue](decisions/2026-11-12-roadmap-is-the-queue.md).
- Plans: [roadmap](plans/roadmap.md),
  [compute settings backlog](plans/2026-06-08-compute-settings-panel-backlog.md), and
  [July pipeline review](plans/2026-07-21-pipeline-completion-review.md).
- Process and operations: [lint deviations](process/lint-deviations.md),
  [writing style](process/writing-style.md), and [local upgrade flow](runbooks/dev-local-upgrade-flow.md).
- Research: [scanno findings](research/findings-scannos.md).
